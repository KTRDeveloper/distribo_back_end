import { openApiRegistry } from '../../lib/openapi/registry.js';
import { healthResponseSchema, readinessResponseSchema, livenessResponseSchema } from './health.schemas.js';

/**
 * Registers the health module's routes with the shared OpenAPI registry.
 * Imported once (as a side effect) from src/app.ts so its paths are
 * included in the generated document.
 */

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  tags: ['health'],
  summary: 'Basic health check',
  responses: {
    200: {
      description: 'The service is up',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/health/ready',
  tags: ['health'],
  summary: 'Readiness check (database + Redis connectivity)',
  responses: {
    200: {
      description: 'The service is ready to accept traffic',
      content: { 'application/json': { schema: readinessResponseSchema } },
    },
    503: {
      description: 'The service is not ready (a dependency is unavailable)',
      content: { 'application/json': { schema: readinessResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/health/live',
  tags: ['health'],
  summary: 'Liveness check',
  responses: {
    200: {
      description: 'The service process is alive',
      content: { 'application/json': { schema: livenessResponseSchema } },
    },
  },
});
