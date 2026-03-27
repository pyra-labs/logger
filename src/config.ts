import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    EMAIL_TO: z.string().optional().default("")
        .transform((str) => {
            try {
                if (!str) return [];
                const emails = str.split(',').map(email => email.trim());
                if (emails.length === 0) return [];

                if (!emails.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error();
                return emails;
            } catch {
                throw new Error("Invalid email list format: must be comma-separated email addresses");
            }
        }),
    EMAIL_FROM: z.string().email().optional(),
    EMAIL_HOST: z.string().optional(),
    EMAIL_PORT: z.coerce.number().min(0).optional(),
    EMAIL_USER: z.string().email().optional(),
    EMAIL_PASSWORD: z.string().optional(),
});

const config = envSchema.parse({
    EMAIL_TO: process.env.EMAIL_TO,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
});

export const isEmailConfigured = Boolean(
    config.EMAIL_TO.length > 0 &&
    config.EMAIL_FROM &&
    config.EMAIL_HOST &&
    config.EMAIL_PORT !== undefined &&
    config.EMAIL_USER &&
    config.EMAIL_PASSWORD
);

export default config;
