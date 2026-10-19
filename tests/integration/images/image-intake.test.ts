import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { env } from '../../../src/config/env';
import { imageBody } from '../../../src/middleware/image-body';
import { errorHandler } from '../../../src/middleware/error-handler';
import { requestIdMiddleware } from '../../../src/middleware/request-id';
import { getImageProcessor, getImageStorage } from '../../../src/modules/images/image.ports';
import { storeUploadedImage } from '../../../src/modules/images/image.service';

const storage = getImageStorage();
const KEY_PATTERN =
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

/** A PNG-shaped buffer: signature, IHDR with the given size (the fake processor reads these). */
function png(width: number, height: number, totalLength = 64): Buffer {
  const bytes = Buffer.alloc(Math.max(totalLength, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A JPEG-shaped buffer whose extra bytes (after the header) hold a GPS marker. */
function jpegWithGps(): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0xff, 0xd8, 0xff, 0xe1]).copy(bytes, 0);
  bytes.writeUInt32BE(800, 16);
  bytes.writeUInt32BE(600, 20);
  return Buffer.concat([bytes, Buffer.from('Exif\0GPSLatitude=5.3600N GPSLongitude=4.0083W')]);
}

const app = express();
app.use(requestIdMiddleware);
app.post('/photo/:folder', imageBody(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const folder = req.params.folder as 'logos' | 'avatars' | 'products';
    res.status(201).json({ key: await storeUploadedImage(folder, req.body as Buffer) });
  } catch (err) {
    next(err);
  }
});
app.use(errorHandler);

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of await storage.listFiles(null, 1000)) await storage.delete(file.key);
});

const upload = (body: Buffer, contentType = 'image/png', folder = 'avatars') =>
  request(app).post(`/photo/${folder}`).set('Content-Type', contentType).send(body);

/** The typed JSON body of an answer. */
const reply = (res: request.Response) => res.body as { key: string; error: { code: string } };

const storedFiles = async () => storage.listFiles(null, 1000);

describe('IMG-003 good photo', () => {
  it('AC-1 stores a WebP copy under a new avatars key', async () => {
    const res = await upload(png(800, 600));
    expect(res.status).toBe(201);
    expect(reply(res).key).toMatch(KEY_PATTERN);
    const stored = await storage.get(reply(res).key);
    expect(stored).not.toBeNull();
    expect(stored!.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(stored!.subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  it('accepts a media type with parameters and upper case', async () => {
    const res = await upload(png(10, 10), 'IMAGE/PNG; charset=binary');
    expect(res.status).toBe(201);
  });

  it('never stores the received bytes', async () => {
    const received = png(800, 600);
    const res = await upload(received);
    const stored = await storage.get(reply(res).key);
    expect(stored!.equals(received)).toBe(false);
  });
});

describe('IMG-003 refusals', () => {
  it('AC-2 refuses 4 MB with the limit 3 MB', async () => {
    const res = await upload(png(100, 100, 4 * 1024 * 1024));
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('IMAGE_TOO_LARGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AC-2 refuses 5000 by 5000 pixels', async () => {
    const res = await upload(png(5000, 5000));
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('IMAGE_TOO_LARGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AC-2 refuses a GIF', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
    const res = await upload(gif, 'image/png');
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AC-2 refuses text sent as image/png', async () => {
    const res = await upload(Buffer.from('this is not an image, only plain text bytes'));
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AC-2 refuses an empty body', async () => {
    const res = await upload(Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('VALIDATION_ERROR');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AC-2 refuses a request with no body at all', async () => {
    const res = await request(app).post('/photo/avatars').set('Content-Type', 'image/png');
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-2 refuses Content-Type text/html', async () => {
    const res = await upload(png(800, 600), 'text/html');
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('UNSUPPORTED_IMAGE');
    expect(await storedFiles()).toHaveLength(0);
  });

  it('refuses a missing Content-Type', async () => {
    const res = await request(app).post('/photo/avatars').send(png(800, 600));
    expect(res.status).toBe(400);
    expect(reply(res).error.code).toBe('UNSUPPORTED_IMAGE');
  });

  it('refuses a body that is not stored as-is when encoded (Content-Encoding)', async () => {
    const res = await request(app)
      .post('/photo/avatars')
      .set('Content-Type', 'image/png')
      .set('Content-Encoding', 'gzip')
      .send(png(800, 600));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await storedFiles()).toHaveLength(0);
  });

  it('accepts a body of exactly the limit and refuses one byte more', async () => {
    const ok = await upload(png(100, 100, env.IMAGE_MAX_BYTES));
    expect(ok.status).toBe(201);
    const tooBig = await upload(png(100, 100, env.IMAGE_MAX_BYTES + 1));
    expect(tooBig.status).toBe(400);
    expect(reply(tooBig).error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('accepts exactly the pixel limit and refuses one pixel more', async () => {
    const ok = await upload(png(env.IMAGE_MAX_PIXELS, 1));
    expect(ok.status).toBe(201);
    const tooMany = await upload(png(env.IMAGE_MAX_PIXELS + 1, 1));
    expect(tooMany.status).toBe(400);
    expect(reply(tooMany).error.code).toBe('IMAGE_TOO_LARGE');
  });
});

describe('IMG-003 two uploads', () => {
  it('AC-3 gives two different keys for the same bytes', async () => {
    const bytes = png(800, 600);
    const first = await upload(bytes);
    const second = await upload(bytes);
    expect(reply(first).key).not.toBe(reply(second).key);
    expect(await storedFiles()).toHaveLength(2);
  });
});

describe('IMG-003 security', () => {
  it('AB-1 stores bytes that differ from the received ones and hold no GPS marker', async () => {
    const received = jpegWithGps();
    const res = await upload(received, 'image/jpeg');
    expect(res.status).toBe(201);
    const stored = await storage.get(reply(res).key);
    expect(stored!.equals(received)).toBe(false);
    expect(stored!.includes(Buffer.from('GPS'))).toBe(false);
    expect(stored!.includes(Buffer.from('Exif'))).toBe(false);
  });

  it('AB-2 refuses a 100 MB body announced by Content-Length, before decoding', async () => {
    const inspect = vi.spyOn(getImageProcessor(), 'inspect');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/photo/avatars',
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(100 * 1024 * 1024) },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.flushHeaders();
    });
    expect(status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
    expect(await storedFiles()).toHaveLength(0);
  });

  it('AB-2 refuses a 100 MB body streamed with no length, before decoding', async () => {
    const inspect = vi.spyOn(getImageProcessor(), 'inspect');
    const chunk = Buffer.alloc(1024 * 1024, 1);
    const outcome = await new Promise<{ status: number | null; body: string }>((resolve) => {
      let status: number | null = null;
      let body = '';
      let sent = 0;
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/photo/avatars',
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' },
      });
      req.on('response', (res) => {
        status = res.statusCode ?? null;
        res.on('data', (data: Buffer) => (body += data.toString()));
        res.on('end', () => resolve({ status, body }));
      });
      // The server may close the connection once it has refused the body.
      req.on('error', () => resolve({ status, body }));
      const writeMore = () => {
        while (sent < 100) {
          sent += 1;
          if (!req.write(chunk)) {
            req.once('drain', writeMore);
            return;
          }
        }
        req.end();
      };
      writeMore();
    });
    // The 4 MB streamed so far is over the 3 MB limit: refused, whatever the client sees.
    if (outcome.status !== null) {
      expect(outcome.status).toBe(400);
      expect(outcome.body).toContain('IMAGE_TOO_LARGE');
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(await storedFiles()).toHaveLength(0);
  });
});

describe('storeUploadedImage', () => {
  it('refuses an empty buffer with VALIDATION_ERROR', async () => {
    await expect(storeUploadedImage('logos', Buffer.alloc(0))).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('stores nothing when storage fails after a good check', async () => {
    vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('disk down'));
    await expect(storeUploadedImage('logos', png(10, 10))).rejects.toThrow('disk down');
    expect(await storedFiles()).toHaveLength(0);
  });
});
