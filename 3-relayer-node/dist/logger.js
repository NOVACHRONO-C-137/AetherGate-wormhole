"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = require("winston");
const { combine, timestamp, printf, colorize, errors } = winston_1.format;
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}] ${stack || message}`;
});
exports.logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL ?? "info",
    format: combine(colorize({ all: true }), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), errors({ stack: true }), logFormat),
    transports: [
        new winston_1.transports.Console(),
        new winston_1.transports.File({
            filename: "logs/relayer-error.log",
            level: "error",
            format: combine(winston_1.format.uncolorize(), timestamp(), errors({ stack: true }), logFormat),
        }),
        new winston_1.transports.File({
            filename: "logs/relayer-combined.log",
            format: combine(winston_1.format.uncolorize(), timestamp(), errors({ stack: true }), logFormat),
        }),
    ],
});
//# sourceMappingURL=logger.js.map