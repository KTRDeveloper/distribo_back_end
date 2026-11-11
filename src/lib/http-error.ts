export type HttpError = Error & {
  statusCode: number;
  code: string;
  /** Safe, non-personal data the client may act on (for example a minimum amount). */
  details?: Record<string, unknown>;
  /** Response headers the global handler sets (for example `Retry-After`); never serialized. */
  headers?: Record<string, string>;
};

/**
 * Builds an application error the global handler maps to the one error shape.
 *
 * @param details - Optional safe fields added to the response under `error.details`; never put
 * input values, personal data or secrets in it.
 * @param headers - Optional response headers (for example `Retry-After` on a lock refusal). They are
 * stored non-enumerable so a serialized or logged error never carries their values (CWE-209).
 */
export function httpError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>
): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  if (headers !== undefined) {
    Object.defineProperty(error, 'headers', { value: headers, enumerable: false });
  }
  return error;
}
