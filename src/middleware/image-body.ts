import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { httpError } from '../lib/http-error.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** The media type of the header, lower case, without parameters. */
function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Reads a photo sent as raw bytes and leaves a Buffer in `req.body` (empty when no body came).
 * Only the declared types image/jpeg, image/png and image/webp pass; the declared type proves
 * nothing, `storeUploadedImage` inspects the content (ASVS v5.0.0-5.2.2). The size is checked
 * on `Content-Length` before any byte is read, and again while reading, which also covers a
 * body streamed with no length (ASVS v5.0.0-5.2.1). A compressed body is refused (no inflation,
 * so no decompression bomb). Both size refusals answer 400 `IMAGE_TOO_LARGE`; a wrong type
 * answers 400 `UNSUPPORTED_IMAGE`.
 */
export function imageBody(): RequestHandler {
  const parser = express.raw({ type: () => true, limit: env.IMAGE_MAX_BYTES, inflate: false });

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!IMAGE_TYPES.includes(mediaType(req.headers['content-type']))) {
      next(httpError(400, 'UNSUPPORTED_IMAGE', 'The file must be a JPEG, PNG or WebP image'));
      return;
    }

    const announced = req.headers['content-length'];
    if (announced !== undefined && Number(announced) > env.IMAGE_MAX_BYTES) {
      next(httpError(400, 'IMAGE_TOO_LARGE', 'The image is too large'));
      return;
    }

    parser(req, res, (err?: unknown) => {
      if (err) {
        const parserError = err as { type?: string; status?: number };
        if (parserError.type === 'entity.too.large' || parserError.status === 413) {
          next(httpError(400, 'IMAGE_TOO_LARGE', 'The image is too large'));
          return;
        }
        next(err);
        return;
      }
      if (!Buffer.isBuffer(req.body)) req.body = Buffer.alloc(0);
      next();
    });
  };
}
