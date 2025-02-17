import { Writable } from "node:stream";
import winston, { createLogger, type Logger, transports } from "winston";
import nodemailer from "nodemailer";
import config from "./config.js";
import type { ErrorCacheEntry } from "./types/ErrorCacheEntry.interface.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

/**
 * Options for the AppLogger class.
 * 
 * @property {string} name - The name of the application, included in the logs and emails.
 * @property {number} dailyErrorCacheTimeMs - The time in milliseconds to cache errors for before sending an email. Cleared daily. Eg: 1000 * 60 * 60 will send one email per hour if the same error is repeated, specifying how many times it occurred in the hour. 
 */
export interface AppLoggerOptions {
    name: string;
    dailyErrorCacheTimeMs?: number;
}

export class AppLogger {
    private name: string;

    protected logger: Logger;

    private dailyErrorCache = new Map<string, ErrorCacheEntry>();
    private dailyErrorCacheTimeMs: number;

    /**
     * Constructor for the AppLogger class.
     * 
     * @param {AppLoggerOptions} options - The {@link AppLoggerOptions} to set up the logger.
     */
    constructor(options: AppLoggerOptions) {
        this.name = options.name;

        if (options.dailyErrorCacheTimeMs === undefined || options.dailyErrorCacheTimeMs < 0) {
            this.dailyErrorCacheTimeMs = 0;
        } else {
            this.dailyErrorCacheTimeMs = options.dailyErrorCacheTimeMs;
        }    

        // Clear cache once a day
        setInterval(() => {
            this.dailyErrorCache.clear();
        }, 1000 * 60 * 60 * 24);

        const mailTransporter = nodemailer.createTransport({
            host: config.EMAIL_HOST,
            port: config.EMAIL_PORT,
            secure: false,
            auth: {
                user: config.EMAIL_USER,
                pass: config.EMAIL_PASSWORD,
            },
        });

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
                            ? `${this.name} Error (${cacheEntry.count} occurrences in past ${dailyErrorCacheTimeMinutes} minutes)`
                            : `${this.name} Error`;

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

    protected async sendEmail(subject: string, message: string): Promise<void> {
        try {
            const mailTransporter = nodemailer.createTransport({
                host: config.EMAIL_HOST,
                port: config.EMAIL_PORT,
                secure: false,
                auth: {
                    user: config.EMAIL_USER,
                    pass: config.EMAIL_PASSWORD,
                },
            });

            await Promise.all(config.EMAIL_TO.map(admin => 
                mailTransporter.sendMail({
                    from: config.EMAIL_FROM,
                    to: admin,
                    subject: `${this.name} | ${subject}`,
                    text: message,
                })
            ));
        } catch (error) {
            this.logger.error(`Failed to send warning email: ${error}`);
        }
    }
}