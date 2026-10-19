import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';
import { uniquePhone } from '../../helpers/phone.js';

type Registry = typeof import('../../../src/modules/person/phone-released.js');

let registry: Registry;
const fakeTx = { marker: 'tx' } as unknown as Prisma.TransactionClient;

beforeEach(async () => {
  // Each test starts with an empty registry (module state is reset).
  vi.resetModules();
  registry = await import('../../../src/modules/person/phone-released.js');
});

describe('phone released registry', () => {
  it('runs handlers in order with the number and the caller transaction (AC-1)', async () => {
    const calls: string[] = [];
    const first = vi.fn(() => {
      calls.push('first');
      return Promise.resolve();
    });
    const second = vi.fn(() => {
      calls.push('second');
      return Promise.resolve();
    });
    registry.registerPhoneReleasedHandler(first);
    registry.registerPhoneReleasedHandler(second);
    const phone = uniquePhone();

    await registry.firePhoneReleased(phone, fakeTx);

    expect(calls).toEqual(['first', 'second']);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ phoneNumber: phone }, fakeTx);
    expect(second).toHaveBeenCalledWith({ phoneNumber: phone }, fakeTx);
    expect(first.mock.calls[0]?.[1]).toBe(fakeTx);
  });

  it('keeps one entry when the same function is registered twice (AC-2)', async () => {
    const handler = vi.fn(async () => {});
    registry.registerPhoneReleasedHandler(handler);
    registry.registerPhoneReleasedHandler(handler);

    await registry.firePhoneReleased(uniquePhone(), fakeTx);
    expect(handler).toHaveBeenCalledTimes(1);
    await registry.firePhoneReleased(uniquePhone(), fakeTx);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('resolves when no handler is registered (AC-3)', async () => {
    await expect(registry.firePhoneReleased(uniquePhone(), fakeTx)).resolves.toBeUndefined();
  });

  it('stops the chain at the first failing handler (AC-4)', async () => {
    const boom = new Error('handler failed');
    const first = vi.fn(() => Promise.reject(boom));
    const second = vi.fn(async () => {});
    registry.registerPhoneReleasedHandler(first);
    registry.registerPhoneReleasedHandler(second);

    await expect(registry.firePhoneReleased(uniquePhone(), fakeTx)).rejects.toBe(boom);
    expect(second).not.toHaveBeenCalled();
  });

  it.each(['0677123456', '', '+0123456789', '+12345', ' +237677123456', '+237677123456\n'])(
    'rejects %j with a RangeError and runs no handler (AC-5, C-02)',
    async (bad) => {
      const handler = vi.fn(async () => {});
      registry.registerPhoneReleasedHandler(handler);

      await expect(registry.firePhoneReleased(bad, fakeTx)).rejects.toBeInstanceOf(RangeError);
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it('does not write the number to the logs', async () => {
    const spy = vi.spyOn(process.stdout, 'write');
    const phone = uniquePhone();
    registry.registerPhoneReleasedHandler(async () => {});

    await registry.firePhoneReleased(phone, fakeTx);

    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
    expect(written).not.toContain(phone);
  });
});

describe('phone released registry security', () => {
  it('rolls back the first handler write when the next handler throws (AB-1, CWE-662)', async () => {
    const personId = newId();
    registry.registerPhoneReleasedHandler(async ({ phoneNumber }, tx) => {
      await tx.person.create({
        data: { id: personId, phoneNumber, fullName: 'Rollback Person' },
      });
    });
    registry.registerPhoneReleasedHandler(() => Promise.reject(new Error('second handler failed')));

    await expect(
      prisma.$transaction(async (tx) => {
        await registry.firePhoneReleased(uniquePhone(), tx);
      })
    ).rejects.toThrow('second handler failed');

    expect(await prisma.person.findUnique({ where: { id: personId } })).toBeNull();
  });
});
