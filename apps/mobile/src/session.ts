import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The signed-in player's session token. Kept in the device keychain/keystore on phones and in
 * localStorage on web (SecureStore has no web implementation). The current value is also held in
 * memory so every API call can read it without waiting on storage.
 */

const KEY = 'season-challenger.session-token';

let token: string | null = null;
const listeners = new Set<(token: string | null) => void>();

function webStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
}

async function readStored(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return webStorage()?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

async function writeStored(value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const storage = webStorage();
      if (value === null) storage?.removeItem(KEY);
      else storage?.setItem(KEY, value);
    } else if (value === null) {
      await SecureStore.deleteItemAsync(KEY);
    } else {
      await SecureStore.setItemAsync(KEY, value);
    }
  } catch {
    // Storage can fail (private browsing, locked keychain). The session still works in memory
    // until the app closes.
  }
}

function update(next: string | null): void {
  if (next === token) return;
  token = next;
  for (const listener of listeners) listener(next);
}

/** The token held right now, or null when signed out. */
export function currentToken(): string | null {
  return token;
}

/** Called whenever the token changes (sign-in, sign-out, or a session the API rejected). */
export function onTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the saved token at app start. */
export async function loadToken(): Promise<string | null> {
  const stored = await readStored();
  // A sign-in that finished while storage was being read wins.
  if (token === null) update(stored);
  return token;
}

export async function saveToken(next: string): Promise<void> {
  update(next);
  await writeStored(next);
}

export async function clearToken(): Promise<void> {
  update(null);
  await writeStored(null);
}
