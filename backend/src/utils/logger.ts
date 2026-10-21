import pino from 'pino';
import { getEnv } from '../config/env.js';

const env = getEnv();

const transport = env.NODE_ENV === 'development'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport,
  base: {
    service: 'sensoura-backend',
    mission: env.MISSION_NAME,
    phase: env.MISSION_PHASE,
    team: env.TEAM_ID,
  },
});

export function getLogger(name: string) {
  return logger.child({ module: name });
}