import { Request, Response } from 'express';
import { getOpenApiDocument } from './api-docs.service.js';

/**
 * api-docs controller
 * Handles HTTP requests for the interactive API documentation.
 */

export const apiDocsController = {
  /**
   * GET /docs/openapi.json
   * Always reflects the current registered routes/schemas.
   */
  getOpenApiJson(_req: Request, res: Response) {
    res.json(getOpenApiDocument());
  },
};

/**
 * swagger-ui-express options. Swagger UI fetches the document from
 * /docs/openapi.json itself (rather than being handed a static object),
 * so the two routes always stay derived from the same generator call.
 * `persistAuthorization` keeps a bearer token entered via "Authorize"
 * across page reloads and subsequent "try it out" calls (FR-006).
 */
export const swaggerUiOptions = {
  swaggerOptions: {
    url: '/api/v1/docs/openapi.json',
    persistAuthorization: true,
  },
};
