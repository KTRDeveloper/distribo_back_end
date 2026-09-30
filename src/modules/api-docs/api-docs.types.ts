import type { generateOpenApiDocument } from '../../lib/openapi/generator.js';

/**
 * TypeScript types for the api-docs module.
 */
export type OpenApiDocument = ReturnType<typeof generateOpenApiDocument>;
