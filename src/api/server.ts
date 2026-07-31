import http from 'node:http';

import { dispatchFromUrl } from './router';
import logger from '../utils/logger';

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { __invalidJson: true, raw };
  }
};

export const createApiServer = () => {
  return http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const authorization = req.headers.authorization ?? null;

    try {
      let body = await readJsonBody(req);
      if (body && typeof body === 'object' && '__invalidJson' in body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
          }),
        );
        return;
      }

      const result = await dispatchFromUrl({
        method,
        url,
        authorization,
        body,
      });

      res.writeHead(result.statusCode, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result.body));
    } catch (error) {
      logger.error({ error }, 'API server failure');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        }),
      );
    }
  });
};

export const startApiServer = (port = Number(process.env.PORT ?? 3000)) => {
  const server = createApiServer();
  server.listen(port, () => {
    logger.info({ port }, 'API server listening');
  });
  return server;
};
