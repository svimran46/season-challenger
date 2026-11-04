import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  api,
  ApiError,
  session,
  type AcceptedVoucher,
  type CheckedVoucher,
  type Identity,
} from './api';
import './styles.css';

const messageOf = (error: unknown) => {
  if (error instanceof ApiError) {
    return error.code === 'too_many_attempts' && error.retryAfterSeconds
      ? `Too many failed attempts. Try again in ${Math.ceil(error.retryAfterSeconds / 60)} min.`
      : error.message;
  }
  return "Couldn't reach Season Challenger. Check the connection and try again.";
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text' | 'email';
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { label, onChange, ...input } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <input {...input} required onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (identity: Identity) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, ...identity } = await api.login(email, password);
      session.set(token);
      onSignedIn(identity);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <h1>Partner sign-in</h1>
      <p className="muted">Accept Season Challenger vouchers at your till.</p>
      <form onSubmit={submit} className="stack">
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error ? (
          <p role="alert" className="bad">
            {error}
          </p>
        ) : null}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function Accept() {
  const [code, setCode] = useState('');
  const [presentCode, setPresentCode] = useState('');
  const [reference, setReference] = useState('');
  const [checked, setChecked] = useState<CheckedVoucher | null>(null);
  const [accepted, setAccepted] = useState<AcceptedVoucher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept across retries, so a repeat after a lost reply cannot use a voucher twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const reset = () => {
    setCode('');
    setPresentCode('');
    setReference('');
    setChecked(null);
    setAccepted(null);
    setError(null);
    setRequestId(crypto.randomUUID());
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (accepted) {
    return (
      <section className="stack">
        <div className="result good" role="status">
          <h2>Voucher accepted</h2>
          <p className="big">{accepted.discountText}</p>
          <p>{accepted.title}</p>
          <p className="muted">
            {accepted.code} · Reference {accepted.usedReference}
          </p>
        </div>
        <button onClick={reset}>Next customer</button>
      </section>
    );
  }

  if (checked) {
    return (
      <section className="stack">
        <div className={`result ${checked.canAccept ? '' : 'bad-box'}`}>
          <h2>{checked.canAccept ? 'Valid voucher' : `This voucher is ${checked.status}`}</h2>
          <p className="big">{checked.discountText}</p>
          <p>{checked.title}</p>
          <p className="muted">{checked.terms}</p>
          <p className="muted">Expires {when(checked.expiresAt)}</p>
          {checked.usedAt ? (
            <p className="muted">
              Used {when(checked.usedAt)}, reference {checked.usedReference}
            </p>
          ) : null}
        </div>
        {checked.canAccept ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () =>
                setAccepted(await api.accept({ code, presentCode, reference, requestId })),
              );
            }}
          >
            <Field
              label="Receipt or booking reference"
              value={reference}
              onChange={setReference}
              autoFocus
            />
            {error ? (
              <p role="alert" className="bad">
                {error}
              </p>
            ) : null}
            <button disabled={busy}>{busy ? 'Accepting…' : 'Accept voucher'}</button>
          </form>
        ) : null}
        <button className="secondary" onClick={reset}>
          {checked.canAccept ? 'Cancel' : 'Try another'}
        </button>
      </section>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => setChecked(await api.check(code, presentCode)));
      }}
    >
      <p className="muted">
        Ask the customer to open their voucher and tap “Show at the till”. You need both codes.
      </p>
      <Field
        label="Voucher code"
        placeholder="SC-XXXX-XXXX"
        value={code}
        onChange={setCode}
        autoFocus
      />
      <Field
        label="Till code (6 digits)"
        inputMode="numeric"
        autoComplete="off"
        value={presentCode}
        onChange={setPresentCode}
      />
      {error ? (
        <p role="alert" className="bad">
          {error}
        </p>
      ) : null}
      <button disabled={busy}>{busy ? 'Checking…' : 'Check voucher'}</button>
    </form>
  );
}

function History() {
  const [items, setItems] = useState<AcceptedVoucher[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (from?: string) => {
    setError(null);
    try {
      const page = await api.history(from);
      setItems((old) => [...(from && old ? old : []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(messageOf(err));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <p role="alert" className="bad">
        {error}
      </p>
    );
  }
  if (!items) return <p className="muted">Loading…</p>;
  if (items.length === 0) return <p className="muted">No vouchers accepted yet.</p>;
  return (
    <section className="stack">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Voucher</th>
            <th>Reference</th>
            <th>Accepted by</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.code}>
              <td>{when(v.usedAt)}</td>
              <td>
                {v.title}
                <br />
                <span className="muted">{v.code}</span>
              </td>
              <td>{v.usedReference}</td>
              <td>{v.acceptedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor ? (
        <button className="secondary" onClick={() => void load(cursor)}>
          Load more
        </button>
      ) : null}
    </section>
  );
}

function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [checking, setChecking] = useState(() => session.token() !== null);
  const [tab, setTab] = useState<'accept' | 'history'>('accept');

  useEffect(() => {
    if (!session.token()) return;
    api
      .me()
      .then(setIdentity)
      .catch(() => session.clear())
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <main className="narrow muted">Loading…</main>;
  if (!identity) return <SignIn onSignedIn={setIdentity} />;

  const signOut = () => {
    void api.logout().catch(() => undefined);
    session.clear();
    setIdentity(null);
  };

  return (
    <>
      <header>
        <div>
          <strong>{identity.partner.name}</strong>
          <span className="muted"> · {identity.staff.name}</span>
        </div>
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </header>
      <nav aria-label="Sections">
        <button
          className={tab === 'accept' ? 'tab on' : 'tab'}
          aria-current={tab === 'accept' ? 'page' : undefined}
          onClick={() => setTab('accept')}
        >
          Accept
        </button>
        <button
          className={tab === 'history' ? 'tab on' : 'tab'}
          aria-current={tab === 'history' ? 'page' : undefined}
          onClick={() => setTab('history')}
        >
          History
        </button>
      </nav>
      <main className="narrow">{tab === 'accept' ? <Accept /> : <History />}</main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
