/**
 * supertest types `response.body` as `any`. Narrow it once, at the boundary,
 * to the shape a test actually asserts on instead of spreading `any` through
 * every property access.
 */
export function bodyOf<T>(response: { body: unknown }): T {
  return response.body as T;
}

export interface ErrorBody {
  error: { code: string; message?: string; details?: unknown };
}

/** Token pair returned by the auth endpoints that sign a person in. */
export interface TokenBody {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn?: number;
  user: { phoneNumber: string };
}

export interface OpenApiOperation {
  tags?: string[];
  security?: unknown[];
  requestBody?: { content: Record<string, { schema?: unknown }> };
  responses?: Record<string, unknown>;
}

/** The parts of a generated OpenAPI document the docs tests inspect. */
export interface OpenApiDoc {
  openapi: string;
  info: { title?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }> };
}
