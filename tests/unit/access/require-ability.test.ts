import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: { warn },
}));

import { requireAbility } from '../../../src/middleware/require-ability.js';

type ActorRole = NonNullable<Request['actor']>['role'];

function request(role?: ActorRole, body: Record<string, unknown> = {}): Request {
  return {
    actor: role
      ? {
          personId: '0199a4f2-8df8-7000-8000-000000000001',
          organizationId: '0199a4f2-8df8-7000-8000-000000000002',
          role,
        }
      : undefined,
    body,
  } as Request;
}

function invoke(middleware: ReturnType<typeof requireAbility>, req: Request, next = vi.fn()) {
  middleware(req, {} as Response, next as NextFunction);
  return next;
}

describe('requireAbility', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  it('allows an owner to close an organization', () => {
    const next = invoke(requireAbility('close', 'Organization'), request('OWNER'));

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses a seller and does not continue', () => {
    const next = invoke(requireAbility('close', 'Organization'), request('SELLER'));

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }),
    );
  });

  it('refuses a request without an actor', () => {
    const next = invoke(requireAbility('close', 'Organization'), request());

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }),
    );
  });

  it('checks conditions on the subject instance', () => {
    const deliveredNext = invoke(
      requireAbility('cancel', 'Order', () => ({ status: 'DELIVERED' })),
      request('SELLER'),
    );
    const confirmedNext = invoke(
      requireAbility('cancel', 'Order', () => ({ status: 'CONFIRMED' })),
      request('SELLER'),
    );

    expect(deliveredNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(confirmedNext).toHaveBeenCalledWith();
  });

  it('ignores a role forged in the request body', () => {
    const next = invoke(
      requireAbility('close', 'Organization'),
      request('SELLER', { role: 'OWNER' }),
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('logs each refusal without personal data', () => {
    invoke(requireAbility('close', 'Organization'), request('SELLER'));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      {
        event: 'permission_refused',
        personId: '0199a4f2-8df8-7000-8000-000000000001',
        action: 'close',
        subjectType: 'Organization',
      },
      'Permission refused',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('OWNER');
  });
});
