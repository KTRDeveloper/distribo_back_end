import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * Adds `.openapi()` to every Zod schema. Must run before any module
 * registers schemas with `openApiRegistry` below.
 */
extendZodWithOpenApi(z);

/**
 * Shared, process-wide registry. Every feature module contributes its own
 * routes/schemas to this single instance from its own `[featurename].openapi.ts`
 * file, so feature modules never import each other directly (Constitution
 * Principle V) — they only depend on this shared `src/lib` infrastructure.
 */
export const openApiRegistry = new OpenAPIRegistry();

openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT access token returned by POST /auth/login or /auth/register/verify',
});

/**
 * Generic error response shape used by the existing error-handling
 * middleware (src/middleware/error-handler.ts) across every module.
 * Registered once here so feature modules reference it by name instead of
 * redefining it (which would otherwise require importing from each other).
 */
export const errorResponseSchema = openApiRegistry.register(
  'Error',
  z.object({
    error: z.object({
      message: z.string().openapi({ example: 'Invalid or expired token' }),
      code: z.string().openapi({ example: 'UNAUTHORIZED' }),
      requestId: z.string().optional(),
    }),
  })
);
