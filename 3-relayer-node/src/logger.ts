import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(
    colorize({ all: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: "logs/relayer-error.log",
      level: "error",
      format: combine(format.uncolorize(), timestamp(), errors({ stack: true }), logFormat),
    }),
    new transports.File({
      filename: "logs/relayer-combined.log",
      format: combine(format.uncolorize(), timestamp(), errors({ stack: true }), logFormat),
    }),
  ],
});
