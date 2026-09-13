import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { openApiRegistry } from '../../../../src/lib/openapi/registry.js';
import { generateOpenApiDocument } from '../../../../src/lib/openapi/generator.js';

describe('generateOpenApiDocument', () => {
  it('marks a route registered with deprecated: true as deprecated in the document (FR-009)', () => {
    openApiRegistry.registerPath({
      method: 'get',
      path: '/__test-only/deprecated-endpoint',
      tags: ['test'],
      deprecated: true,
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    });

    const doc = generateOpenApiDocument();

    expect(doc.paths['/__test-only/deprecated-endpoint'].get.deprecated).toBe(true);
  });

  it('produces a document with the expected OpenAPI 3.1 info block', () => {
    const doc = generateOpenApiDocument();

    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
  });
});
