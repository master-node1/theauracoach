import { logout } from '@/lib/auth-handlers';
import { authDeps } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return logout(request, authDeps());
}
