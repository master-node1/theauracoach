import { verify } from '@/lib/email-auth';
import { emailAuthDeps } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return verify(request, emailAuthDeps());
}
