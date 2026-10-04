export type HttpError = Error & {
  statusCode: number;
  code: string;
  /** Safe, non-personal data the client may act on (for example a minimum amount). */
  details?: Record<string, unknown>;
};

/**
 * Builds an application error the global handler maps to the one error shape.
 *
 * @param details - Optional safe fields added to the response under `error.details`; never put
 * input values, personal data or secrets in it.
 */
export function httpError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
