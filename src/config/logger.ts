import winston from 'winston';
import fs from 'fs';
import config from './config';

if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  return info;
});

const consoleFormat = winston.format.combine(
  enumerateErrorFormat(),
  config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
  winston.format.splat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`)
);

const fileJsonFormat = winston.format.combine(
  enumerateErrorFormat(),
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: fileJsonFormat,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: fileJsonFormat,
    }),
  ],
});

export default logger;
