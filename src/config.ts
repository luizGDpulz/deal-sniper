import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN is required'),
  ALLOWED_USER_IDS: z
    .string()
    .min(1, 'ALLOWED_USER_IDS must contain at least one Telegram user ID')
    .transform((raw) =>
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id))
    )
    .refine((ids) => ids.length > 0, {
      message: 'ALLOWED_USER_IDS must contain valid numeric Telegram user IDs',
    }),
  ALLOWED_CHAT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),

  TELEGRAM_API_ID: z.coerce.number().int().positive('TELEGRAM_API_ID must be a positive integer'),
  TELEGRAM_API_HASH: z.string().min(16, 'TELEGRAM_API_HASH is required'),
  TELEGRAM_SESSION: z.string().optional().default(''),

  TELEGRAM_FOLDER_NAME: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  DEDUPE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  UNSHORTEN_URLS: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  MAX_REDIRECTS: z.coerce.number().int().min(1).max(15).default(8),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(15000).default(5000),

  DATABASE_PATH: z.string().min(1).default('./data/deal-sniper.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
