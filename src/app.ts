import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { config } from './config/index.js';
import { redis } from './lib/redis.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { getMetrics, getMetricsContentType } from './lib/metrics.js';

/**
 * Express application setup
 * Configures all middleware and routes
 */
export const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.cors.origins,
    credentials: true,
  })
);

// Compression middleware
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  // TODO: Fix RedisStore compatibility with ioredis v5
  // Using in-memory store for now
  // store: new RedisStore({
  //   // @ts-expect-error - Redis client type mismatch
  //   client: redis,
  //   prefix: 'rl:',
  // }),
  message: {
    error: {
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

app.use(limiter);

// Request ID middleware (must be before logger)
app.use(requestIdMiddleware);

// Request logging middleware
app.use(requestLogger);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/user/user.routes.js';
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
import remoteConfigRoutes from './modules/remote-config/remote-config.routes.js';
import { apiDocsRoutes } from './modules/api-docs/api-docs.routes.js';

// Register every module's OpenAPI paths/schemas on the shared registry
// (src/lib/openapi/registry.ts) before api-docs.routes.js generates the
// document. Import side effects only — nothing is exported from these.
import './modules/health/health.openapi.js';
import './modules/auth/auth.openapi.js';
import './modules/user/user.openapi.js';
import './modules/tasks/tasks.openapi.js';
import './modules/remote-config/remote-config.openapi.js';

const v1Router = express.Router();

// Metrics endpoint (before other routes)
v1Router.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', getMetricsContentType());
  const metrics = await getMetrics();
  res.send(metrics);
});

v1Router.use('/health', healthRoutes);
v1Router.use('/auth', authRoutes);
v1Router.use('/users', userRoutes);
v1Router.use('/tasks', tasksRoutes);
v1Router.use('/remote-config', remoteConfigRoutes);

// Interactive API docs — never reachable in production (FR-008)
if (config.docsEnabled) {
  v1Router.use('/docs', apiDocsRoutes);
}

app.use('/api/v1', v1Router);

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);
