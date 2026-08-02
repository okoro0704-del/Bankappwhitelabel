import http from 'node:http';

import { dispatchFromUrl } from './router';
import { buildCorsHeaders } from './cors';
import { assertProductionEnvSafety, getSafeDeploymentConfigSummary } from '../config/production-guards';
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
    return { __invalidJson: true };
  }
};

const writeJson = (
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };

  if (statusCode === 204) {
    const { 'Content-Type': _ignored, ...withoutJson } = headers;
    res.writeHead(204, withoutJson);
    res.end();
    return;
  }

  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(body));
};

export const createApiServer = () => {
  return http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const authorization = req.headers.authorization ?? null;
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const corsHeaders = buildCorsHeaders(requestOrigin);

    try {
      if (method.toUpperCase() === 'OPTIONS') {
        writeJson(res, 204, null, corsHeaders);
        return;
      }

      const body = await readJsonBody(req);
      if (body && typeof body === 'object' && '__invalidJson' in body) {
        writeJson(
          res,
          400,
          {
            error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
          },
          corsHeaders,
        );
        return;
      }

      const result = await dispatchFromUrl({
        method,
        url,
        authorization,
        body,
        headers: {
          host: typeof req.headers.host === 'string' ? req.headers.host : undefined,
          'x-forwarded-host':
            typeof req.headers['x-forwarded-host'] === 'string'
              ? req.headers['x-forwarded-host']
              : undefined,
          origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
          'x-tenant-slug':
            typeof req.headers['x-tenant-slug'] === 'string'
              ? req.headers['x-tenant-slug']
              : undefined,
        },
      });

      writeJson(res, result.statusCode, result.body, corsHeaders);
    } catch (error) {
      logger.error({ error }, 'API server failure');
      writeJson(
        res,
        500,
        {
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        },
        corsHeaders,
      );
    }
  });
};

export const startApiServer = (
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST?.trim() || '0.0.0.0',
) => {
  try {
    assertProductionEnvSafety();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid production configuration';
    logger.error({ err: message }, 'Refusing to start: production configuration invalid');
    throw error;
  }

  const server = createApiServer();

  // Bind 0.0.0.0 so Railway/Docker healthchecks can reach the process (not localhost-only).
  server.listen(port, host, () => {
    logger.info(
      { port, host, deployment: getSafeDeploymentConfigSummary() },
      'API server listening',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down API server');
    server.close((error) => {
      if (error) {
        logger.error({ error }, 'Error during API server shutdown');
        process.exit(1);
      }
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return server;
};
