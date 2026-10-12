import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';

/**
 * Encrypts cookie payloads (JWE, dir + A256GCM) with a key derived from SESSION_SECRET. Sealed
 * values are opaque to the browser and fail to open if tampered with or expired.
 */
const keys = new Map<string, Promise<Uint8Array>>();

function keyFor(secret: string): Promise<Uint8Array> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`aura-web-session:${secret}`))
      .then((digest) => new Uint8Array(digest));
    keys.set(secret, key);
  }
  return key;
}

export async function seal(payload: JWTPayload, secret: string, maxAge: number): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .encrypt(await keyFor(secret));
}

export async function unseal<T>(value: string | undefined, secret: string): Promise<T | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, await keyFor(secret));
    return payload as unknown as T;
  } catch {
    return null;
  }
}
