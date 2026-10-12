import * as SecureStore from 'expo-secure-store';
import { STORE_KEYS, deserialize, serialize, type StoredTokens } from './tokens';

/** Keychain (iOS) / Keystore-backed storage (Android). Tokens never go to AsyncStorage. */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadTokens(): Promise<StoredTokens | null> {
  const keys = Object.values(STORE_KEYS);
  const values = await Promise.all(keys.map((k) => SecureStore.getItemAsync(k, options)));
  return deserialize(Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null])));
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all(
    Object.entries(serialize(tokens)).map(([k, v]) => SecureStore.setItemAsync(k, v, options)),
  );
}

export async function clearTokens(): Promise<void> {
  await Promise.all(Object.values(STORE_KEYS).map((k) => SecureStore.deleteItemAsync(k, options)));
}
