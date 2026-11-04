import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type MasteryAnswer, type MasteryCall } from '../../src/api';
import { formatKickoff } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Loading, Message, Screen } from '../../src/ui';

const CONFIDENCE = [
  { label: 'Unsure', value: 0.4 },
  { label: 'Fairly sure', value: 0.7 },
  { label: 'Certain', value: 1 },
];

/** The option a stored answer picked, for highlighting. */
function pickedValue(answer: MasteryAnswer | undefined): string | null {
  if (!answer || answer.kind === 'range') return null;
  return answer.kind === 'topPlayer' ? answer.playerId : answer.pick;
}

function answerFrom(call: MasteryCall, value: string, previous?: MasteryAnswer): MasteryAnswer {
  switch (call.kind) {
    case 'outcome':
      return {
        kind: 'outcome',
        pick: value as 'home',
        confidence: previous?.kind === 'outcome' ? previous.confidence : 0.7,
      };
    case 'halfTimeLeader':
      return { kind: 'halfTimeLeader', pick: value as 'home' };
    case 'comparison':
      return { kind: 'comparison', pick: value as 'home' };
    case 'playerDuel':
      return { kind: 'playerDuel', pick: value as 'a' };
    default:
      return { kind: 'topPlayer', playerId: value };
  }
}

export default function AnalysisCardScreen() {
  const t = useTheme();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const qc = useQueryClient();
  const card = useQuery({
    queryKey: ['mastery', 'card', fixtureId],
    queryFn: () => api.masteryCard(fixtureId),
    retry: false,
  });
  const [answers, setAnswers] = useState<Record<string, MasteryAnswer>>({});

  useEffect(() => {
    if (!card.data) return;
    const saved: Record<string, MasteryAnswer> = {};
    for (const call of card.data.calls) if (call.answer) saved[call.id] = call.answer;
    setAnswers(saved);
  }, [card.data]);

  const submit = useMutation({
    mutationFn: () =>
      api.submitMasteryCard(
        card.data!.id,
        Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })),
      ),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (card.error instanceof ApiError && card.error.code === 'no_card') {
    return <Message title="No analysis card" body="This match started without one." />;
  }
  if (card.isError) return <Message title="Couldn't load this card" />;
  if (!card.data) return <Loading />;

  const { status, calls, fixture, rewardCoins, submittedAt, score } = card.data;
  const open = status === 'open';
  const complete = calls.every((c) => answers[c.id]);
  const set = (id: string, answer: MasteryAnswer) => setAnswers((a) => ({ ...a, [id]: answer }));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={[styles.title, { color: t.text }]}>
            {fixture.home.shortName} v {fixture.away.shortName}
          </Text>
          <Text style={{ color: t.muted }}>
            {open
              ? `Change your answers until kick-off, ${formatKickoff(fixture.kickoffAt)}. First submission pays ${rewardCoins} bonus coins.`
              : status === 'locked'
                ? 'Locked at kick-off. Results appear after full time.'
                : `Graded. Your score: ${score === null ? 'no card submitted' : Math.round(score)}.`}
          </Text>
        </Card>

        {calls.map((call) => (
          <CallCard
            key={call.id}
            call={call}
            open={open}
            answer={answers[call.id]}
            onAnswer={(a) => set(call.id, a)}
          />
        ))}

        {open ? (
          <View style={styles.submit}>
            {submit.isError ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: t.live }]}>
                {submit.error instanceof Error ? submit.error.message : 'That did not save.'}
              </Text>
            ) : null}
            {submit.isSuccess ? (
              <Text style={[styles.error, { color: t.accent }]}>Your card is saved.</Text>
            ) : null}
            <Button
              label={submittedAt ? 'Save changes' : 'Submit card'}
              onPress={() => submit.mutate()}
              disabled={!complete}
              busy={submit.isPending}
            />
            {!complete ? (
              <Text style={[styles.hint, { color: t.muted }]}>Answer every call to submit.</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function CallCard({
  call,
  open,
  answer,
  onAnswer,
}: {
  call: MasteryCall;
  open: boolean;
  answer: MasteryAnswer | undefined;
  onAnswer: (answer: MasteryAnswer) => void;
}) {
  const t = useTheme();
  const picked = pickedValue(answer);
  return (
    <Card>
      <Text style={[styles.prompt, { color: t.text }]}>{call.prompt}</Text>
      {call.range ? (
        <RangePicker range={call.range} open={open} answer={answer} onAnswer={onAnswer} />
      ) : (
        call.options.map((o) => {
          const selected = picked === o.value;
          const right = call.result?.correctOptions.includes(o.value);
          return (
            <Pressable
              key={o.value}
              disabled={!open}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: !open }}
              onPress={() => onAnswer(answerFrom(call, o.value, answer))}
              style={[
                styles.option,
                {
                  borderColor: selected ? t.accent : t.border,
                  backgroundColor: selected ? t.surface : 'transparent',
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              <Text style={{ color: t.text, fontWeight: selected ? '600' : '400' }}>{o.label}</Text>
              {o.detail ? <Text style={{ color: t.muted }}>{o.detail}</Text> : null}
              {right ? <Chip label="Right" tone="done" /> : null}
            </Pressable>
          );
        })
      )}
      {call.kind === 'outcome' && answer?.kind === 'outcome' ? (
        <View style={styles.confidence}>
          {CONFIDENCE.map((c) => {
            const selected = answer.confidence === c.value;
            return (
              <Pressable
                key={c.label}
                disabled={!open}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !open }}
                onPress={() => onAnswer({ ...answer, confidence: c.value })}
                style={[
                  styles.chipButton,
                  { borderColor: selected ? t.accent : t.border, borderWidth: selected ? 2 : 1 },
                ]}
              >
                <Text style={{ color: t.text }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {call.result ? (
        <Text style={[styles.result, { color: t.muted }]}>
          {call.result.summary}
          {call.result.accuracy === null ? '' : ` Accuracy ${Math.round(call.result.accuracy)}%.`}
        </Text>
      ) : null}
    </Card>
  );
}

function RangePicker({
  range,
  open,
  answer,
  onAnswer,
}: {
  range: NonNullable<MasteryCall['range']>;
  open: boolean;
  answer: MasteryAnswer | undefined;
  onAnswer: (answer: MasteryAnswer) => void;
}) {
  const t = useTheme();
  const min = answer?.kind === 'range' ? answer.min : range.start;
  const max = answer?.kind === 'range' ? answer.max : Math.min(range.ceiling, range.start + 2);
  const change = (nextMin: number, nextMax: number) => {
    if (nextMin < range.floor || nextMax > range.ceiling || nextMin > nextMax) return;
    if (nextMax - nextMin > range.maxWidth) return;
    onAnswer({ kind: 'range', min: nextMin, max: nextMax });
  };
  const stepper = (label: string, value: number, down: () => void, up: () => void) => (
    <View style={styles.stepper}>
      <Text style={{ color: t.muted }}>{label}</Text>
      <View style={styles.stepRow}>
        <Button label="−" kind="secondary" onPress={down} disabled={!open} />
        <Text style={[styles.stepValue, { color: t.text }]}>{value}</Text>
        <Button label="+" kind="secondary" onPress={up} disabled={!open} />
      </View>
    </View>
  );
  return (
    <View>
      <View style={styles.range}>
        {stepper(
          'From',
          min,
          () => change(min - 1, max),
          () => change(min + 1, max),
        )}
        {stepper(
          'To',
          max,
          () => change(min, max - 1),
          () => change(min, max + 1),
        )}
      </View>
      <Text style={[styles.hint, { color: t.muted }]}>
        {answer ? `A span of at most ${range.maxWidth}.` : 'Tap to set your range.'}
      </Text>
      {open && !answer ? (
        <Button
          label={`Use ${min} to ${max}`}
          kind="secondary"
          onPress={() => onAnswer({ kind: 'range', min, max })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  prompt: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  option: { padding: 12, borderRadius: 10, marginBottom: 8, minHeight: 44 },
  confidence: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  chipButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, minHeight: 44 },
  result: { marginTop: 8, lineHeight: 20 },
  submit: { paddingHorizontal: 16, marginTop: 8 },
  error: { marginBottom: 8 },
  hint: { marginTop: 8 },
  range: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  stepper: { flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  stepValue: { fontSize: 20, fontWeight: '600', minWidth: 28, textAlign: 'center' },
});
