import { forwardToApi } from '@/lib/api-proxy';
import { config } from '@/lib/config';
import { currentSession } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return forwardToApi(request, path, await currentSession(), config());
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
