import { env } from './env.js';

/**
 * Application configuration aggregator
 * Exports validated environment variables and derived configuration
 */
export const config = {
  // Environment
  env: env.NODE_ENV,
  port: env.PORT,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  // Interactive API docs (/docs) must never be reachable in production (FR-008)
  docsEnabled: env.NODE_ENV !== 'production',

  // Database
  database: {
    url: env.DATABASE_URL,
  },

  // Redis
  redis: {
    url: env.REDIS_URL,
  },

  // JWT
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  // CORS
  cors: {
    origins: env.CORS_ORIGINS,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  // Logging
  logger: {
    level: env.LOG_LEVEL,
  },

  // OpenTelemetry
  otel: {
    serviceName: env.OTEL_SERVICE_NAME,
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },

  // Worker
  worker: {
    concurrency: env.WORKER_CONCURRENCY,
    maxRetries: env.WORKER_MAX_RETRIES,
  },

  // SMS (TextBee)
  sms: {
    textbeeApiKey: env.TEXTBEE_API_KEY,
  },

  // SMTP (secondary password-reset OTP channel)
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    fromAddress: env.SMTP_FROM_ADDRESS,
  },

  // OTP delivery
  otp: {
    deliveryQueueName: env.OTP_DELIVERY_QUEUE_NAME,
  },
} as const;

export type Config = typeof config;
