export type HttpError = Error & {
  statusCode: number;
  code: string;
};

export function httpError(status: number, code: string, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = status;
  error.code = code;
  return error;
}
