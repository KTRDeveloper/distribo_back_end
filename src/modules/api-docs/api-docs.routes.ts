import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { apiDocsController, swaggerUiOptions } from './api-docs.controller.js';

/**
 * api-docs routes
 *
 * Mounted at /docs only when config.docsEnabled is true (see src/app.ts) —
 * FR-008 requires this interface to be unreachable in production, so it is
 * never registered there rather than merely being unlinked.
 */
export const apiDocsRoutes = Router();

// GET /docs/openapi.json - live-generated OpenAPI document
apiDocsRoutes.get('/openapi.json', (req, res) => apiDocsController.getOpenApiJson(req, res));

// GET /docs - interactive Swagger UI, bound to /docs/openapi.json
apiDocsRoutes.use('/', swaggerUi.serve, swaggerUi.setup(undefined, swaggerUiOptions));
