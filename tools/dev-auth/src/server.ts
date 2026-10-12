#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createDevIssuer, createOAuthHandlers, type OAuthResult } from './index';

/**
 * Local Cognito stand-in for docker compose.
 *   GET  /.well-known/jwks.json
 *   POST /token  {"sub":"…","email":"…","groups":["admin"]}  -> {"access_token":"…"}
 *   GET  /oauth2/authorize, POST /oauth2/token, POST /oauth2/revoke, GET /logout
 *        (Authorization Code + PKCE, shaped like the Cognito hosted endpoints)
 * Keys and sessions live in memory and are lost on restart.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, result: OAuthResult) {
  res.writeHead(result.status, result.headers).end(result.body);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('dev-auth refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 4100);
  const issuer = process.env.DEV_AUTH_ISSUER ?? `http://localhost:${port}`;
  const dev = await createDevIssuer(issuer);
  const oauth = createOAuthHandlers(dev, {
    accessTokenTtlSeconds: Number(process.env.DEV_AUTH_ACCESS_TOKEN_TTL ?? 900),
  });
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    try {
      if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(dev.jwks));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200).end('ok');
        return;
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const body = await readBody(req);
        const token = await dev.mintAccessToken(body ? JSON.parse(body) : {});
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ access_token: token }));
        return;
      }
      if (url.pathname === '/oauth2/authorize' && req.method === 'GET') {
        send(res, oauth.authorizePage(url.searchParams));
        return;
      }
      if (url.pathname === '/oauth2/authorize' && req.method === 'POST') {
        send(res, oauth.authorizeSubmit(new URLSearchParams(await readBody(req))));
        return;
      }
      if (url.pathname === '/oauth2/token' && req.method === 'POST') {
        send(res, await oauth.token(new URLSearchParams(await readBody(req))));
        return;
      }
      if (url.pathname === '/oauth2/revoke' && req.method === 'POST') {
        send(res, oauth.revoke(new URLSearchParams(await readBody(req))));
        return;
      }
      if (url.pathname === '/oauth2/token' && req.method === 'OPTIONS') {
        res
          .writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': 'content-type',
          })
          .end();
        return;
      }
      if (url.pathname === '/logout' && req.method === 'GET') {
        send(res, oauth.logout(url.searchParams));
        return;
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(400).end('{"error":"bad request"}');
    }
  }).listen(port, '0.0.0.0', () => console.log(`dev-auth listening on :${port}, issuer ${issuer}`));
}

void main();
