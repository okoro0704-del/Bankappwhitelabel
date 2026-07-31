import pino from 'pino';

const redactPaths = [
  'password',
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'supabaseServiceRoleKey',
  'serviceRoleKey',
  'verificationCode',
  'netlifyAuthToken',
  'NETLIFY_AUTH_TOKEN',
  '*.password',
  '*.access_token',
  '*.refresh_token',
  '*.token',
  '*.authorization',
  '*.verificationCode',
  '*.netlifyAuthToken',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: redactPaths,
    remove: true,
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        },
});

export default logger;
