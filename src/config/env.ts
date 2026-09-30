import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

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
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN_DAYS: z.string().regex(/^\d+$/).transform(Number).default('30'),

  // CORS
  CORS_ORIGINS: z.string().transform((str) => str.split(',')),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).transform(Number).default('900000'),
  RATE_LIMIT_MAX: z.string().regex(/^\d+$/).transform(Number).default('100'),

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
});

// Validate and export environment variables
export const env = envSchema.parse(process.env);

// Export type for TypeScript
export type Env = z.infer<typeof envSchema>;
