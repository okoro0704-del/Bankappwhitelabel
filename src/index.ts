import { getClientEnvConfig } from './config/supabase';
import { startApiServer } from './api/server';
import { isAppError } from './utils/errors';
import logger from './utils/logger';

const bootstrap = async (): Promise<void> => {
  const config = getClientEnvConfig();
  const port = Number(process.env.PORT ?? 3000);

  logger.info(
    {
      supabaseUrl: config.supabaseUrl,
      port,
    },
    'Starting backend API server',
  );

  startApiServer(port);
};

bootstrap().catch((error: unknown) => {
  if (isAppError(error)) {
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
