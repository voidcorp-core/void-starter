import pino, { type Logger } from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';
const level = process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info');

export const logger: Logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type { Logger };
