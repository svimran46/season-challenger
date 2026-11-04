import type {
  Answer,
  CallResolution,
  CardCall,
  PlayerMetric,
  Question,
  Side,
  TeamMetric,
} from './mastery';
import type { Club, Fixture, Player, Position } from './types';

/*
 * Building analysis cards: which calls a card holds, the rule for how many, and the words a
 * player reads. Every call is resolved from the stats snapshot alone. The feed has no formations
 * or line-ups, so there are no formation calls, and player calls cannot know who will start.
 */

export const MIN_CALLS_PER_CARD = 5;
export const MAX_CALLS_PER_CARD = 8;

/**
 * What question_template.resolver_key points at. Grading reads a stored call through this map:
 * the key picks the kind that gradeAnswer switches on, and params hold the rest of the question.
 */
export const RESOLVERS = {
  'match.outcome': 'outcome',
  'match.half_time_leader': 'halfTimeLeader',
  'team.range': 'range',
  'team.comparison': 'comparison',
  'player.duel': 'playerDuel',
  'player.top_fantasy': 'topPlayer',
} as const satisfies Record<string, Question['kind']>;

export type ResolverKey = keyof typeof RESOLVERS;

export interface QuestionTemplate {
  id: string;
  kind: Question['kind'];
  resolverKey: ResolverKey;
  /** Wording with {slots} filled by renderCall. */
  prompt: string;
}

/** One reusable template per kind of call. The Postgres store mirrors these into question_template. */
export const QUESTION_TEMPLATES: readonly QuestionTemplate[] = [
  {
    id: 'match-outcome',
    kind: 'outcome',
    resolverKey: 'match.outcome',
    prompt: 'Who wins {home} v {away}, and how sure are you?',
  },
  {
    id: 'half-time-leader',
    kind: 'halfTimeLeader',
    resolverKey: 'match.half_time_leader',
    prompt: 'Who leads at half time?',
  },
  {
    id: 'team-range',
    kind: 'range',
    resolverKey: 'team.range',
    prompt: '{subject} {metric}: call a range of up to {maxWidth}.',
  },
  {
    id: 'team-comparison',
    kind: 'comparison',
    resolverKey: 'team.comparison',
    prompt: 'Who has more {metric}?',
  },
  {
    id: 'player-duel',
    kind: 'playerDuel',
    resolverKey: 'player.duel',
    prompt: 'Key battle: {a} {aMetric} or {b} {bMetric}. Which number is higher?',
  },
  {
    id: 'top-player',
    kind: 'topPlayer',
    resolverKey: 'player.top_fantasy',
    prompt: 'Which of these players scores the most fantasy points?',
  },
];

function templateFor(kind: Question['kind']): QuestionTemplate {
  const template = QUESTION_TEMPLATES.find((t) => t.kind === kind);
  if (!template) throw new Error(`No question template for "${kind}".`);
  return template;
}

export class UnknownResolverError extends Error {
  constructor(resolverKey: string) {
    super(`No grading code for resolver key "${resolverKey}".`);
  }
}

/** A question as it is stored: its template, resolver key and everything except its kind. */
export function questionToRow(question: Question): {
  templateId: string;
  resolverKey: ResolverKey;
  params: Record<string, unknown>;
} {
  const { kind, ...params } = question;
  const template = templateFor(kind);
  return { templateId: template.id, resolverKey: template.resolverKey, params };
}

/** Back from a stored row to a question gradeAnswer can grade. An unknown key fails loudly. */
export function questionFromRow(resolverKey: string, params: unknown): Question {
  const kind = (RESOLVERS as Record<string, Question['kind'] | undefined>)[resolverKey];
  if (typeof kind !== 'string') throw new UnknownResolverError(resolverKey);
  return { ...(params as object), kind } as Question;
}

// ------------------------------------------------------------------- the 5-to-8 rule

export type CardIssueCode =
  'too_few_calls' | 'too_many_calls' | 'duplicate_call' | 'unresolvable_call';

export interface CardIssue {
  code: CardIssueCode;
  message: string;
}

export interface CardValidation {
  valid: boolean;
  errors: CardIssue[];
}

/** The stats a player's duel number can come from: a position's numbers are worth comparing. */
export const DUEL_METRICS: Record<Position, readonly PlayerMetric[]> = {
  GK: ['saves'],
  DEF: ['tackles'],
  MID: ['tackles', 'dribbles', 'assists', 'goals'],
  FWD: ['dribbles', 'goals', 'assists'],
};

function unresolvableReason(
  question: Question,
  playerById: ReadonlyMap<string, Player>,
): string | null {
  switch (question.kind) {
    case 'outcome':
    case 'halfTimeLeader':
    case 'comparison':
      return null;
    case 'range':
      if (question.metric === 'possession' && question.side === 'total') {
        return 'Total possession is always 100.';
      }
      return question.maxWidth > 0 ? null : 'A range call needs a width above 0.';
    case 'playerDuel': {
      if (question.a.playerId === question.b.playerId) return 'A duel needs two players.';
      for (const side of [question.a, question.b]) {
        const player = playerById.get(side.playerId);
        if (!player) return `Player ${side.playerId} is not in this match.`;
        if (!DUEL_METRICS[player.position].includes(side.metric)) {
          return `${side.metric} is not a stat to judge a ${player.position} on.`;
        }
      }
      return null;
    }
    case 'topPlayer': {
      if (new Set(question.candidateIds).size !== question.candidateIds.length) {
        return 'A candidate is listed twice.';
      }
      if (question.candidateIds.length < 2) return 'A top player call needs two candidates.';
      const missing = question.candidateIds.find((id) => !playerById.has(id));
      return missing ? `Player ${missing} is not in this match.` : null;
    }
  }
}

/** A card holds 5 to 8 different calls, and the stats snapshot must be able to resolve each. */
export function validateCard(
  questions: readonly Question[],
  players: readonly Player[],
): CardValidation {
  const errors: CardIssue[] = [];
  if (questions.length < MIN_CALLS_PER_CARD) {
    errors.push({
      code: 'too_few_calls',
      message: `A card needs at least ${MIN_CALLS_PER_CARD} calls, got ${questions.length}.`,
    });
  }
  if (questions.length > MAX_CALLS_PER_CARD) {
    errors.push({
      code: 'too_many_calls',
      message: `A card holds at most ${MAX_CALLS_PER_CARD} calls, got ${questions.length}.`,
    });
  }
  const playerById = new Map(players.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const question of questions) {
    const key = JSON.stringify(question);
    if (seen.has(key)) {
      errors.push({ code: 'duplicate_call', message: `The same call appears twice: ${key}.` });
    }
    seen.add(key);
    const reason = unresolvableReason(question, playerById);
    if (reason) errors.push({ code: 'unresolvable_call', message: reason });
  }
  return { valid: errors.length === 0, errors };
}

export class InvalidCardError extends Error {
  constructor(readonly errors: CardIssue[]) {
    super(`Generated an invalid card: ${errors.map((e) => e.message).join(' ')}`);
  }
}

// ------------------------------------------------------------------- the generator

export interface CardSource {
  fixture: Pick<Fixture, 'id' | 'homeClubId' | 'awayClubId'>;
  home: Club;
  away: Club;
  /** Players of both clubs. Anyone else is ignored. */
  players: readonly Player[];
}

export interface GeneratedCall extends RenderedCall {
  templateId: string;
  question: Question;
}

/** FNV-1a: small, stable across platforms, and enough to vary cards between fixtures. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const rotate = <T>(items: readonly T[], by: number): T[] => {
  const start = by % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
};

const RANGE_CALLS: readonly Extract<Question, { kind: 'range' }>[] = [
  { kind: 'range', metric: 'goals', side: 'total', maxWidth: 2 },
  { kind: 'range', metric: 'shots', side: 'total', maxWidth: 8 },
  { kind: 'range', metric: 'corners', side: 'total', maxWidth: 4 },
  { kind: 'range', metric: 'shotsOnTarget', side: 'total', maxWidth: 4 },
  { kind: 'range', metric: 'possession', side: 'home', maxWidth: 10 },
];

/** Goals are left out: who scores more is the outcome call already. */
const COMPARISON_METRICS: readonly TeamMetric[] = [
  'possession',
  'shots',
  'corners',
  'shotsOnTarget',
];

/** Battles worth a call: the home player's stat against the away player's. */
const DUEL_SHAPES: readonly {
  home: readonly [Position, PlayerMetric];
  away: readonly [Position, PlayerMetric];
}[] = [
  { home: ['FWD', 'dribbles'], away: ['DEF', 'tackles'] },
  { home: ['DEF', 'tackles'], away: ['FWD', 'dribbles'] },
  { home: ['MID', 'tackles'], away: ['MID', 'tackles'] },
  { home: ['MID', 'dribbles'], away: ['MID', 'dribbles'] },
  { home: ['FWD', 'goals'], away: ['FWD', 'goals'] },
  { home: ['GK', 'saves'], away: ['GK', 'saves'] },
];

const KIND_ORDER: readonly Question['kind'][] = [
  'outcome',
  'halfTimeLeader',
  'range',
  'comparison',
  'playerDuel',
  'topPlayer',
];

/** Highest-priced first: with no line-ups in the feed, price is the best guide to who matters. */
const byImportance = (a: Player, b: Player) =>
  b.credits - a.credits || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The same fixture and players always give the same card, whatever order the players arrive in.
 * Everything that varies between fixtures comes from a hash of the fixture id, so a card needs no
 * clock and no randomness. Team calls alone are enough for 5 to 8, so thin squads still get a card.
 */
export function generateCard(source: CardSource): GeneratedCall[] {
  const { fixture, home, away } = source;
  const roll = (salt: string) => hash(`${fixture.id}:${salt}`);
  const squad = (clubId: string) =>
    source.players.filter((p) => p.clubId === clubId).sort(byImportance);
  const homeSquad = squad(fixture.homeClubId);
  const awaySquad = squad(fixture.awayClubId);

  const ranges = rotate(RANGE_CALLS, roll('range'));
  const comparisons: Question[] = rotate(COMPARISON_METRICS, roll('comparison'))
    // A range on a metric already says plenty about who has more of it.
    .sort((a, b) => Number(a === ranges[0]?.metric) - Number(b === ranges[0]?.metric))
    .map((metric) => ({ kind: 'comparison', metric }));

  const used = new Set<string>();
  const keyPlayer = (players: readonly Player[], position: Position, salt: string) => {
    const pool = players.filter((p) => p.position === position && !used.has(p.id)).slice(0, 2);
    return pool.length > 0 ? pool[roll(salt) % pool.length] : undefined;
  };
  const duels: Question[] = [];
  for (const shape of rotate(DUEL_SHAPES, roll('duel'))) {
    if (duels.length === 2) break;
    const a = keyPlayer(homeSquad, shape.home[0], `duel:${duels.length}:home`);
    const b = keyPlayer(awaySquad, shape.away[0], `duel:${duels.length}:away`);
    if (!a || !b) continue;
    used.add(a.id);
    used.add(b.id);
    duels.push({
      kind: 'playerDuel',
      a: { playerId: a.id, metric: shape.home[1] },
      b: { playerId: b.id, metric: shape.away[1] },
    });
  }

  const candidates = [...homeSquad.slice(0, 2), ...awaySquad.slice(0, 2)].map((p) => p.id);
  const topPlayer: Question[] =
    homeSquad.length > 0 && awaySquad.length > 0
      ? [{ kind: 'topPlayer', candidateIds: candidates }]
      : [];

  // Most wanted first, so a shorter card keeps the variety and only ever drops from the end.
  const wanted: Question[] = [
    { kind: 'outcome' },
    { kind: 'halfTimeLeader' },
    ...ranges.slice(0, 1),
    ...duels.slice(0, 1),
    ...comparisons.slice(0, 1),
    ...topPlayer,
    ...ranges.slice(1, 2),
    ...duels.slice(1),
    ...comparisons.slice(1, 2),
    ...ranges.slice(2, 3),
  ];
  const size = MIN_CALLS_PER_CARD + (roll('size') % (MAX_CALLS_PER_CARD - MIN_CALLS_PER_CARD + 1));
  const questions = wanted
    .slice(0, size)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const check = validateCard(questions, [...homeSquad, ...awaySquad]);
  if (!check.valid) throw new InvalidCardError(check.errors);

  const names = { home, away, players: source.players };
  return questions.map((question) => ({
    templateId: templateFor(question.kind).id,
    question,
    ...renderCall(question, names),
  }));
}

// ------------------------------------------------------------------- answers

export type AnswerIssueCode =
  | 'missing_answer'
  | 'unknown_question'
  | 'duplicate_answer'
  | 'wrong_kind'
  | 'bad_confidence'
  | 'bad_range'
  | 'not_a_candidate';

export interface AnswerIssue {
  code: AnswerIssueCode;
  questionId: string;
  message: string;
}

export interface AnswerValidation {
  valid: boolean;
  errors: AnswerIssue[];
}

const RANGE_SCALES: Record<TeamMetric, { ceiling: number; start: number }> = {
  goals: { ceiling: 15, start: 2 },
  shots: { ceiling: 60, start: 22 },
  shotsOnTarget: { ceiling: 30, start: 8 },
  possession: { ceiling: 100, start: 50 },
  corners: { ceiling: 30, start: 9 },
};

export interface RangeScale {
  floor: number;
  ceiling: number;
  maxWidth: number;
  /** Where the app's steppers begin. Not a hint about the match. */
  start: number;
}

function rangeScale(question: Extract<Question, { kind: 'range' }>): RangeScale {
  const { ceiling, start } = RANGE_SCALES[question.metric];
  const perSide = question.side !== 'total' && question.metric !== 'possession';
  return { floor: 0, ceiling, maxWidth: question.maxWidth, start: perSide ? start >> 1 : start };
}

function answerProblem(
  question: Question,
  answer: Answer,
): { code: AnswerIssueCode; message: string } | null {
  if (question.kind !== answer.kind) {
    return {
      code: 'wrong_kind',
      message: `A ${question.kind} call cannot take a ${answer.kind} answer.`,
    };
  }
  if (answer.kind === 'outcome' && !(answer.confidence >= 1 / 3 && answer.confidence <= 1)) {
    return { code: 'bad_confidence', message: 'Confidence runs from 1/3 to 1.' };
  }
  if (answer.kind === 'range' && question.kind === 'range') {
    const { floor, ceiling, maxWidth } = rangeScale(question);
    const { min, max } = answer;
    // gradeAnswer pays 60 for any hit, so an over-wide range has to be stopped here.
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < floor || max > ceiling) {
      return { code: 'bad_range', message: `A range uses whole numbers ${floor} to ${ceiling}.` };
    }
    if (min > max || max - min > maxWidth) {
      return { code: 'bad_range', message: `A range can span at most ${maxWidth}.` };
    }
  }
  if (
    answer.kind === 'topPlayer' &&
    question.kind === 'topPlayer' &&
    !question.candidateIds.includes(answer.playerId)
  ) {
    return { code: 'not_a_candidate', message: 'That player is not one of the options.' };
  }
  return null;
}

/** A submission answers every call on the card once, each within what the call allows. */
export function validateAnswers(
  calls: readonly CardCall[],
  answers: readonly { questionId: string; answer: Answer }[],
): AnswerValidation {
  const errors: AnswerIssue[] = [];
  const questionById = new Map(calls.map((c) => [c.id, c.question]));
  const seen = new Set<string>();
  for (const { questionId, answer } of answers) {
    const question = questionById.get(questionId);
    if (!question) {
      errors.push({
        code: 'unknown_question',
        questionId,
        message: 'That call is not on this card.',
      });
      continue;
    }
    if (seen.has(questionId)) {
      errors.push({
        code: 'duplicate_answer',
        questionId,
        message: 'That call is answered twice.',
      });
    }
    seen.add(questionId);
    const problem = answerProblem(question, answer);
    if (problem) errors.push({ ...problem, questionId });
  }
  for (const { id } of calls) {
    if (!seen.has(id)) {
      errors.push({
        code: 'missing_answer',
        questionId: id,
        message: 'Every call needs an answer.',
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

// ------------------------------------------------------------------- the words a player reads

export interface CallNames {
  home: Pick<Club, 'id' | 'name' | 'shortName'>;
  away: Pick<Club, 'id' | 'name' | 'shortName'>;
  players: readonly Pick<Player, 'id' | 'clubId' | 'name' | 'position'>[];
}

export interface CallOption {
  /** What the answer sends: a pick such as "home" or "a", or a player id. */
  value: string;
  label: string;
  detail: string | null;
}

export interface RenderedCall {
  prompt: string;
  options: CallOption[];
  /** Range calls only. */
  range: RangeScale | null;
}

const TEAM_METRIC_LABELS: Record<TeamMetric, string> = {
  goals: 'goals',
  shots: 'shots',
  shotsOnTarget: 'shots on target',
  possession: 'possession',
  corners: 'corners',
};

const PLAYER_METRIC_LABELS: Record<PlayerMetric, string> = {
  goals: 'goals',
  assists: 'assists',
  tackles: 'tackles',
  dribbles: 'dribbles',
  saves: 'saves',
};

function fill(prompt: string, slots: Record<string, string | number>): string {
  return prompt.replace(/\{(\w+)\}/g, (_, slot: string) => String(slots[slot]));
}

const sideName = (side: Side | 'total', names: CallNames) =>
  side === 'total' ? 'Total' : side === 'home' ? names.home.name : names.away.name;

function playerNamer(names: CallNames) {
  const byId = new Map(names.players.map((p) => [p.id, p]));
  const club = (id: string) => (id === names.home.id ? names.home.shortName : names.away.shortName);
  return {
    name: (id: string) => byId.get(id)?.name ?? 'Unknown player',
    /** "HBC, FWD" */
    detail: (id: string) => {
      const player = byId.get(id);
      return player ? `${club(player.clubId)}, ${player.position}` : null;
    },
  };
}

/** The prompt and choices for a call, with club and player names filled in. */
export function renderCall(question: Question, names: CallNames): RenderedCall {
  const { prompt } = templateFor(question.kind);
  const players = playerNamer(names);
  const none = { options: [], range: null };
  const clubs: CallOption[] = [
    { value: 'home', label: names.home.name, detail: null },
    { value: 'away', label: names.away.name, detail: null },
  ];
  const withDraw = (draw: string): CallOption[] => [
    clubs[0]!,
    { value: 'draw', label: draw, detail: null },
    clubs[1]!,
  ];
  switch (question.kind) {
    case 'outcome':
      return {
        prompt: fill(prompt, { home: names.home.name, away: names.away.name }),
        options: withDraw('Draw'),
        range: null,
      };
    case 'halfTimeLeader':
      return { prompt: fill(prompt, {}), options: withDraw('Level'), range: null };
    case 'range':
      return {
        ...none,
        prompt: fill(prompt, {
          subject: sideName(question.side, names),
          metric: TEAM_METRIC_LABELS[question.metric],
          maxWidth: question.maxWidth,
        }),
        range: rangeScale(question),
      };
    case 'comparison':
      return {
        prompt: fill(prompt, { metric: TEAM_METRIC_LABELS[question.metric] }),
        options: clubs,
        range: null,
      };
    case 'playerDuel': {
      const option = (value: 'a' | 'b'): CallOption => ({
        value,
        label: players.name(question[value].playerId),
        detail: `${players.detail(question[value].playerId)}: ${PLAYER_METRIC_LABELS[question[value].metric]}`,
      });
      return {
        prompt: fill(prompt, {
          a: players.name(question.a.playerId),
          aMetric: PLAYER_METRIC_LABELS[question.a.metric],
          b: players.name(question.b.playerId),
          bMetric: PLAYER_METRIC_LABELS[question.b.metric],
        }),
        options: [option('a'), option('b')],
        range: null,
      };
    }
    case 'topPlayer':
      return {
        prompt: fill(prompt, {}),
        options: question.candidateIds.map((id) => ({
          value: id,
          label: players.name(id),
          detail: players.detail(id),
        })),
        range: null,
      };
  }
}

export interface CallOutcome {
  /** One line on what happened, for after grading. */
  summary: string;
  /** The options that were right. Empty for a range, or when a call ended level. */
  correctOptions: string[];
}

/** Turns a stored resolution into words and the options it proves right. */
export function describeResolution(
  question: Question,
  resolution: CallResolution,
  names: CallNames,
): CallOutcome {
  const players = playerNamer(names);
  const score = (r: { home: number; away: number }) => `${r.home}-${r.away}`;
  switch (resolution.kind) {
    case 'outcome':
      return {
        summary:
          resolution.actual === 'draw'
            ? `A ${score(resolution)} draw`
            : `${resolution.actual === 'home' ? names.home.name : names.away.name} won ${
                resolution.actual === 'home'
                  ? score(resolution)
                  : `${resolution.away}-${resolution.home}`
              }`,
        correctOptions: [resolution.actual],
      };
    case 'halfTimeLeader':
      return {
        summary:
          resolution.actual === 'draw'
            ? `Level at half time, ${score(resolution)}`
            : `${resolution.actual === 'home' ? names.home.name : names.away.name} led ${
                resolution.actual === 'home'
                  ? score(resolution)
                  : `${resolution.away}-${resolution.home}`
              } at half time`,
        correctOptions: [resolution.actual],
      };
    case 'range': {
      const q = question as Extract<Question, { kind: 'range' }>;
      return {
        summary: `${sideName(q.side, names)} ${TEAM_METRIC_LABELS[q.metric]}: ${resolution.actual}`,
        correctOptions: [],
      };
    }
    case 'comparison':
      return {
        summary: `${names.home.name} ${resolution.home}, ${names.away.name} ${resolution.away}`,
        correctOptions: resolution.actual === 'tie' ? [] : [resolution.actual],
      };
    case 'playerDuel': {
      const q = question as Extract<Question, { kind: 'playerDuel' }>;
      const line = (side: 'a' | 'b') =>
        `${players.name(q[side].playerId)} ${resolution[side]} ${PLAYER_METRIC_LABELS[q[side].metric]}`;
      return {
        summary: `${line('a')}, ${line('b')}`,
        correctOptions: resolution.actual === 'tie' ? [] : [resolution.actual],
      };
    }
    case 'topPlayer':
      return {
        summary: Object.entries(resolution.points)
          .sort(([, a], [, b]) => b - a)
          .map(([id, points]) => `${players.name(id)} ${points}`)
          .join(', '),
        correctOptions: resolution.best,
      };
  }
}
