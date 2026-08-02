import { getClientEnvConfig } from './config/supabase';
import { ProductionConfigError } from './config/production-guards';
import { startApiServer } from './api/server';
import { isAppError } from './utils/errors';
import logger from './utils/logger';

const bootstrap = async (): Promise<void> => {
  const config = getClientEnvConfig();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST?.trim() || '0.0.0.0';

  logger.info(
    {
      supabaseUrl: config.supabaseUrl,
      port,
      host,
    },
    'Starting backend API server',
  );

  startApiServer(port, host);
};

bootstrap().catch((error: unknown) => {
  if (error instanceof ProductionConfigError) {
    logger.error({ err: error.message }, 'Production configuration invalid');
  } else if (isAppError(error)) {
    logger.error(
      {
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
      },
      error.message,
    );
  } else {
    logger.error({ error }, 'Unexpected bootstrap failure');
  }

  process.exit(1);
});
