import { isServiceName, type ServiceName } from '@aura/contracts';
import { jwtVerify, SignJWT } from 'jose';
import type { ServiceCaller } from './decorators';
import { InvalidTokenError } from './user-token.verifier';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';
const TTL_SECONDS = 300;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Short-lived token one service presents to another (ADR-009). */
export async function mintServiceToken(input: {
  secret: string;
  issuer: ServiceName;
  audience: ServiceName;
  subUser?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const jwt = new SignJWT(input.subUser ? { sub_user: input.subUser } : {})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? TTL_SECONDS}s`);
  return jwt.sign(key(input.secret));
}

export async function verifyServiceToken(
  token: string,
  secret: string,
  self: ServiceName,
): Promise<ServiceCaller> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key(secret), {
      audience: self,
      algorithms: ['HS256'],
      clockTolerance: 5,
      maxTokenAge: `${TTL_SECONDS + 10}s`,
    }));
  } catch {
    throw new InvalidTokenError('Service token verification failed');
  }
  if (!isServiceName(payload.iss)) throw new InvalidTokenError('Unknown issuer');
  const subUser = payload.sub_user;
  return {
    service: payload.iss,
    ...(typeof subUser === 'string' ? { subUser } : {}),
  };
}
