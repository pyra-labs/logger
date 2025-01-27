import { Writable } from "node:stream";
import winston, { createLogger, type Logger, transports } from "winston";
import nodemailer from "nodemailer";
import config from "./config.js";
import type { ErrorCacheEntry } from "./types/ErrorCacheEntry.interface.js";

export interface AppLoggerOptions {
    name: string;
    dailyErrorCacheTimeMs: number;
}

export class AppLogger {
    protected logger: Logger;
    private dailyErrorCache = new Map<string, ErrorCacheEntry>();
    // TODO: Clear cache once a day
    private dailyErrorCacheTimeMs: number;

    constructor(options: AppLoggerOptions) {
        if (options.dailyErrorCacheTimeMs < 0) this.dailyErrorCacheTimeMs = 0;
        else this.dailyErrorCacheTimeMs = options.dailyErrorCacheTimeMs;

        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ level, message, timestamp }) => {
                return `[${timestamp}] ${level}: ${message}`;
            })
        )

        const mailFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.json({ space: 2})
        )

        const mailTransporter = nodemailer.createTransport({
            host: config.EMAIL_HOST,
            port: config.EMAIL_PORT,
            secure: false,
            auth: {
                user: config.EMAIL_USER,
                pass: config.EMAIL_PASSWORD,
            },
        });

        const dailyErrorCacheTimeMinutes = Math.round(this.dailyErrorCacheTimeMs / 1000 / 60);
        const mailTransportInstance = new winston.transports.Stream({
            stream: new Writable({
                write: (message, _, callback) => {
                    const parsedMessage = JSON.parse(message);
                    const cacheKey = `${parsedMessage.level}: ${parsedMessage.message}`;

                    const now = Date.now();
                    const cacheEntry = this.dailyErrorCache.get(cacheKey) || { count: 0, lastSent: 0 };
                    cacheEntry.count++;
                    
                    // Only send email if error has not been sent in the last errorEmailCacheTime seconds
                    if (now - cacheEntry.lastSent > this.dailyErrorCacheTimeMs) {
                        const emailSubject = this.dailyErrorCacheTimeMs > 0
                            ? `${options.name} Error (${cacheEntry.count} occurrences in past ${dailyErrorCacheTimeMinutes} minutes)`
                            : `${options.name} Error`;

                        for (const admin of config.EMAIL_TO) {
                            mailTransporter.sendMail({
                                from: config.EMAIL_FROM,
                                to: admin,
                                subject: emailSubject,
                                text: message,
                            }).catch((error) => {
                                console.error("Failed to send error email: ", error);
                            });
                        }

                        cacheEntry.count = 0;
                        cacheEntry.lastSent = now;
                    }

                    this.dailyErrorCache.set(cacheKey, cacheEntry);

                    callback();
                    return true;
                }
            }),
            level: 'error',
            format: mailFormat,
        });

        this.logger = createLogger({
            level: 'info',
            transports: [
                new transports.Console({ format: consoleFormat }),
                mailTransportInstance
            ],
            exceptionHandlers: [
                new transports.Console({ format: consoleFormat }),
                mailTransportInstance
            ],
            rejectionHandlers: [
                new transports.Console({ format: consoleFormat }),
                mailTransportInstance
            ],
        });

        process.on("uncaughtException", (error) => {
            this.logger.error(error.message);
        });

        process.on("unhandledRejection", (reason) => {
            this.logger.error(reason);
        });
    }
}