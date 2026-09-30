import { generateOpenApiDocument } from '../../lib/openapi/generator.js';
import type { OpenApiDocument } from './api-docs.types.js';

/**
 * Returns the current OpenAPI document, generated fresh from whatever every
 * feature module has registered on the shared registry (src/lib/openapi/registry.ts)
 * at the time of the call, so it always reflects the running code (FR-007).
 */
export function getOpenApiDocument(): OpenApiDocument {
  return generateOpenApiDocument();
}
