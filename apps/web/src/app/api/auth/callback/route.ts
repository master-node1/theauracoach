import { callback } from '@/lib/auth-handlers';
import { authDeps } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return callback(request, authDeps());
}
