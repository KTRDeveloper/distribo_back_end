import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, get } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return { ...original, config: { ...original.config, rateLimit: { windowMs: 60000, max: 2 } } };
});

import { app } from '../../../src/app.js';

const server = createServer(app);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

function requestFrom(localAddress: string) {
  return new Promise<{
    status: number | undefined;
    headers: import('node:http').IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const request = get(
      {
        hostname: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path: '/api/v1/health/live',
        localAddress,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body })
        );
        response.on('error', reject);
      }
    );
    request.on('error', reject);
  });
}

describe('application HTTP rate limiter with a test-only low quota', () => {
  it('allows the quota, returns the production 429 shape, and isolates client IPs', async () => {
    const first = await requestFrom('127.0.0.2');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    expect(first.headers['ratelimit-remaining']).toBe('1');
    expect((await requestFrom('127.0.0.2')).status).toBe(200);

    const blocked = await requestFrom('127.0.0.2');
    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.body)).toEqual({
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later' },
    });
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['x-ratelimit-limit']).toBeUndefined();

    const otherClient = await requestFrom('127.0.0.3');
    expect(otherClient.status).toBe(200);
    expect(otherClient.headers['ratelimit-remaining']).toBe('1');
  });
});
