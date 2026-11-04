import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { clearToken, currentToken, loadToken, onTokenChange, saveToken } from './session';

interface Auth {
  /** True until the saved token has been read at start. */
  loading: boolean;
  signedIn: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/** Holds the session token. Must sit inside QueryClientProvider. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(currentToken);

  useEffect(() => {
    let loaded = false;
    const unsubscribe = onTokenChange((next) => {
      setToken(next);
      // Never show one player's cached wallet, entries or vouchers to the next.
      if (loaded) qc.clear();
    });
    void loadToken().then((stored) => {
      loaded = true;
      setToken(stored);
      setLoading(false);
    });
    return unsubscribe;
  }, [qc]);

  const signIn = useCallback(async (next: string) => {
    await saveToken(next);
  }, []);

  const signOut = useCallback(async () => {
    // Tell the API, but sign out here even if it cannot be reached.
    await api.signOut().catch(() => undefined);
    await clearToken();
    qc.clear();
  }, [qc]);

  const value = useMemo(
    () => ({ loading, signedIn: token !== null, signIn, signOut }),
    [loading, token, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
