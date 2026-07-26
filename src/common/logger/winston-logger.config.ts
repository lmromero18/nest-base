import { utilities } from 'nest-winston';
import * as path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { getEnv } from '../utils/env';

const appName = getEnv('APP_NAME', 'CENSO-API-PUBLICO');
const logDir = path.resolve(process.cwd(), getEnv('APP_LOG_DIR', 'logs'));

const onlyLevel = (level: string) =>
  winston.format((info) => {
    return info.level === level ? info : false;
  })();

const formatLogValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined && item !== '')
      .map((item) => formatLogValue(item))
      .filter((item) => item !== '')
      .join(' ');
  }

  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'M/D/YYYY, h:mm:ss A',
  }),
  winston.format.ms(),
  utilities.format.nestLike(appName, {
    colors: true,
    prettyPrint: true,
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'M/D/YYYY, h:mm:ss A',
  }),
  winston.format.printf(({ timestamp, level, message, context, stack }) => {
    const nestLevel = String(level).toUpperCase().padStart(7, ' ');
    const loggerContext = context ? `[${context}]` : '[Application]';

    const formattedStack = formatLogValue(stack);
    const formattedMessage = formatLogValue(message);

    const logMessage = formattedStack || formattedMessage;

    return `[Nest] ${process.pid}  - ${timestamp} ${nestLevel} ${loggerContext} ${logMessage}`;
  }),
);

const rotateOptions = {
  dirname: logDir,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: getEnv('APP_LOG_MAX_SIZE', '20m'),
  maxFiles: getEnv('APP_LOG_MAX_FILES', '14d'),
};

export const winstonLoggerOptions: winston.LoggerOptions = {
  level: getEnv('LOG_LEVEL', 'debug'),
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'application-%DATE%.log',
      level: 'debug',
      format: fileFormat,
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'info-%DATE%.log',
      level: 'info',
      format: winston.format.combine(onlyLevel('info'), fileFormat),
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'warning-%DATE%.log',
      level: 'warn',
      format: winston.format.combine(onlyLevel('warn'), fileFormat),
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'error-%DATE%.log',
      level: 'error',
      maxFiles: getEnv('APP_ERROR_LOG_MAX_FILES', '30d'),
      format: winston.format.combine(onlyLevel('error'), fileFormat),
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'debug-%DATE%.log',
      level: 'debug',
      format: winston.format.combine(onlyLevel('debug'), fileFormat),
    }),

    new winston.transports.DailyRotateFile({
      ...rotateOptions,
      filename: 'verbose-%DATE%.log',
      level: 'verbose',
      format: winston.format.combine(onlyLevel('verbose'), fileFormat),
    }),
  ],
};
