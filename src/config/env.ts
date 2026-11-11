import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file (quiet: no dotenv banner in logs)
dotenv.config({ quiet: true });

// Zod schema for environment variable validation
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Key of the Android id fingerprint (HMAC); never logged
  ANDROID_ID_HASH_KEY: z.string().min(32, 'ANDROID_ID_HASH_KEY must be at least 32 characters'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.string().regex(/^\d+$/).transform(Number).default('90'),

  // CORS
  CORS_ORIGINS: z.string().transform((str) => str.split(',')),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).transform(Number).default('900000'),
  RATE_LIMIT_MAX: z.string().regex(/^\d+$/).transform(Number).default('100'),

  // Login lock (CM-05, provisional Q-005): minutes to wait after 5 failed attempts
  LOGIN_LOCK_MINUTES: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .default('5'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // OpenTelemetry (optional)
  OTEL_SERVICE_NAME: z.string().optional().default('node-ts-template'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // Worker Settings
  WORKER_CONCURRENCY: z.string().regex(/^\d+$/).transform(Number).default('5'),
  WORKER_MAX_RETRIES: z.string().regex(/^\d+$/).transform(Number).default('3'),

  // SMS (TextBee) — phone/OTP authentication
  TEXTBEE_API_KEY: z.string().min(1, 'TEXTBEE_API_KEY is required'),

  // Email (SMTP via Nodemailer) — secondary password-reset OTP channel
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.string().regex(/^\d+$/).transform(Number).default('587'),
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASSWORD: z.string().min(1, 'SMTP_PASSWORD is required'),
  SMTP_FROM_ADDRESS: z.string().email('SMTP_FROM_ADDRESS must be a valid email address'),

  // OTP delivery queue
  OTP_DELIVERY_QUEUE_NAME: z.string().default('otp-delivery'),

  // Public base address of stored images (ASVS v5.0.0-13.2.4): http(s), no trailing
  // slash, no query, no fragment. Changing storage provider changes only this value.
  IMAGE_PUBLIC_BASE_URL: z
    .string()
    .url()
    .max(2048)
    .refine((value) => /^https?:\/\//i.test(value), 'must start with http:// or https://')
    .refine((value) => !value.endsWith('/'), 'must not end with /')
    .refine((value) => !/[?#]/.test(value), 'must not contain a query or a fragment'),

  // Photo storage and processing (ADR-005): only the fake adapters exist until a human accepts
  // the ADR. Limits are positive integers: bytes of an uploaded file, pixels of its decoded image.
  IMAGE_DRIVER: z.enum(['fake']).default('fake'),
  IMAGE_MAX_BYTES: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .default('3145728'),
  IMAGE_MAX_PIXELS: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .default('12000000'),

  // Payment aggregator (ADR-006): only the fake adapter exists until a human accepts the ADR
  PAYMENT_DRIVER: z.enum(['fake']).default('fake'),

  // VAT rate of subscription receipts in basis points: 0 or 1925 (19.25 %)
  VAT_RATE_BP: z.enum(['0', '1925']).default('1925').transform(Number),
});

// Validate and export environment variables
export const env = envSchema.parse(process.env);

// Export type for TypeScript
export type Env = z.infer<typeof envSchema>;
