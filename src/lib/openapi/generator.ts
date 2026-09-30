import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { openApiRegistry } from './registry.js';

/**
 * Builds the full OpenAPI 3.1 document from whatever every feature module
 * has registered on the shared registry. Must only be called after all
 * `*.openapi.ts` registration files have been imported (see src/app.ts and
 * scripts/generate-openapi.ts) so every module's paths are present.
 */
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Distribo API',
      version: '1.0.0',
      description:
        'API for the Distribo delivery platform backend. Generated directly from the Zod ' +
        'schemas that validate each endpoint at runtime, so it always reflects the current API.',
    },
  });
}
