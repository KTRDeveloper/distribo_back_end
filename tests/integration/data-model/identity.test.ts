import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { uniquePhone } from '../../helpers/phone';

describe('Data Model: Unified Person identity', () => {
  it('rejects a duplicate active Person phone number', async () => {
    const phoneNumber = uniquePhone();
    await prisma.person.create({
      data: { id: crypto.randomUUID(), phoneNumber },
    });

    await expect(
      prisma.person.create({
        data: { id: crypto.randomUUID(), phoneNumber },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
