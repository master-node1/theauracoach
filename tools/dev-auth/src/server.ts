#!/usr/bin/env node
import { createServer } from 'node:http';
import { createDevIssuer } from './index';

/**
 * Local Cognito stand-in for docker compose.
 *   GET  /.well-known/jwks.json
 *   POST /token  {"sub":"…","email":"…","groups":["admin"]}  -> {"access_token":"…"}
 * Keys are generated at start-up and never persisted.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('dev-auth refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 4100);
  const issuer = process.env.DEV_AUTH_ISSUER ?? `http://localhost:${port}`;
  const dev = await createDevIssuer(issuer);
  createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(dev.jwks));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/token') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', async () => {
        try {
          const input = body ? JSON.parse(body) : {};
          const token = await dev.mintAccessToken(input);
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ access_token: token }));
        } catch {
          res.writeHead(400).end('{"error":"bad request"}');
        }
      });
      return;
    }
    res.writeHead(404).end();
  }).listen(port, '0.0.0.0', () => console.log(`dev-auth listening on :${port}, issuer ${issuer}`));
}

void main();
