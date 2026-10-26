import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { openApiRegistry } from '../../../src/lib/openapi/registry.js';
import { anonymizeRows } from '../../../src/modules/privacy/privacy.repository.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c036-0000-7000-8000-000000000001';
const PAUSED = '0199c036-0000-7000-8000-000000000002';
const ACTIVE = '0199c036-0000-7000-8000-000000000003';
const REVOKED = '0199c036-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c036-0000-7000-8000-000000000005';
const ORG = '0199c036-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c036-0000-7000-8000-0000000000b1';
const PAUSED_ROW = '0199c036-0000-7000-8000-0000000000c2';
const REG = new Date('2026-01-01T00:00:00.000Z');
const PERSON_KEYS = ['avatar_url', 'phone_number', 'public_name', 'registered'];

type CollaborationView = {
  id: string;
  role: string;
  status: string;
  person: {
    public_name: string | null;
    phone_number: string | null;
    registered: boolean;
    avatar_url: string | null;
  };
  amount_held?: number;
};

beforeEach(async () => {
  for (const [index, id] of [OWNER, PAUSED, ACTIVE, REVOKED, OTHER_OWNER].entries()) {
    await prisma.person.create({
      data: {
        id,
        fullName: 'Fixture Person',
        phoneNumber: `+23760003600${index + 1}`,
        phoneVerifiedAt: REG,
        registeredAt: REG,
        passwordHash: 'test-password-hash',
        scopeVersion: 7,
      },
    });
  }
  await prisma.organization.create({ data: { id: ORG, name: 'Fixture organization' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other organization' } });
  await prisma.collaboration.createMany({
    data: [
      {
        id: '0199c036-0000-7000-8000-0000000000c1',
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
      {
        id: PAUSED_ROW,
        personId: PAUSED,
        organizationId: ORG,
        role: 'SELLER',
        status: 'PAUSED',
        acceptedAt: REG,
        amountHeld: 5000n,
      },
      {
        id: '0199c036-0000-7000-8000-0000000000c3',
        personId: ACTIVE,
        organizationId: ORG,
        role: 'MANAGER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
      {
        id: '0199c036-0000-7000-8000-0000000000c4',
        personId: REVOKED,
        organizationId: ORG,
        role: 'DRIVER',
        status: 'REVOKED',
        acceptedAt: REG,
      },
      {
        id: '0199c036-0000-7000-8000-0000000000c5',
        personId: OTHER_OWNER,
        organizationId: OTHER_ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    ],
  });
});

describe('ORG-036 paused team members', () => {
  it('AC-1 lists ACTIVE, PAUSED and REVOKED members with only public person fields', async () => {
    const response = await createAuthenticatedRequest(app, OWNER).get(
      `/api/v1/organizations/${ORG}/collaborators`
    );

    expect(response.status).toBe(200);
    const { items } = bodyOf<{ items: CollaborationView[] }>(response);
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.status)).toEqual(
      expect.arrayContaining(['ACTIVE', 'PAUSED', 'REVOKED'])
    );
    const paused = items.find((item) => item.id === PAUSED_ROW);
    expect(paused).toMatchObject({
      status: 'PAUSED',
      amount_held: 5000,
      person: { avatar_url: null },
    });
    for (const item of items) expect(Object.keys(item.person).sort()).toEqual(PERSON_KEYS);
  });

  it('AC-2 changes a paused role without granting rights, changing money or sending a notice', async () => {
    const before = await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } });
    const response = await createAuthenticatedRequest(app, OWNER)
      .patch(`/api/v1/organizations/${ORG}/collaborators/${PAUSED_ROW}`)
      .send({ role: 'MANAGER' });

    expect(response.status).toBe(200);
    const view = bodyOf<CollaborationView>(response);
    expect(view).toMatchObject({ id: PAUSED_ROW, status: 'PAUSED', role: 'MANAGER' });
    expect(Object.keys(view.person).sort()).toEqual(PERSON_KEYS);
    expect(
      await prisma.collaboration.findUniqueOrThrow({ where: { id: PAUSED_ROW } })
    ).toMatchObject({
      status: 'PAUSED',
      role: 'MANAGER',
      amountHeld: 5000n,
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } })).scopeVersion).toBe(
      before.scopeVersion
    );
    expect(await prisma.notification.count()).toBe(0);
    const access = await createAuthenticatedRequest(app, PAUSED).get(
      `/api/v1/organizations/${ORG}/collaborators`
    );
    expect(access.status).toBe(404);
    expect(bodyOf<ErrorBody>(access).error.code).toBe('NOT_FOUND');
  });

  it('AC-3 revokes a paused seat while keeping held money, scope and notifications unchanged', async () => {
    const before = await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } });
    const response = await createAuthenticatedRequest(app, OWNER).delete(
      `/api/v1/organizations/${ORG}/collaborators/${PAUSED_ROW}`
    );

    expect(response.status).toBe(204);
    expect(
      await prisma.collaboration.findUniqueOrThrow({ where: { id: PAUSED_ROW } })
    ).toMatchObject({
      status: 'REVOKED',
      amountHeld: 5000n,
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } })).scopeVersion).toBe(
      before.scopeVersion
    );
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-4 anonymization revokes the paused seat without clearing its held money', async () => {
    expect(await prisma.$transaction((tx) => anonymizeRows(tx, PAUSED))).toBe(true);

    expect(
      await prisma.collaboration.findUniqueOrThrow({ where: { id: PAUSED_ROW } })
    ).toMatchObject({
      status: 'REVOKED',
      amountHeld: 5000n,
    });
    expect(await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } })).toMatchObject({
      status: 'ANONYMIZED',
      phoneNumber: null,
    });
  });

  it('AC-5 documents PAUSED statuses and avatar_url in all three public person objects', () => {
    const document = new OpenApiGeneratorV3(openApiRegistry.definitions).generateDocument({
      openapi: '3.0.3',
      info: { title: 'Fixture API', version: '1' },
    });
    const teamPath = document.paths['/api/v1/organizations/{organizationId}/collaborators'];
    const rolePath =
      document.paths['/api/v1/organizations/{organizationId}/collaborators/{collaborationId}'];
    const teamSchema: unknown = teamPath?.get?.responses['200'];
    const inviteSchema: unknown = teamPath?.post?.responses['201'];
    const roleSchema: unknown = rolePath?.patch?.responses['200'];
    const person = {
      type: 'object',
      properties: { avatar_url: { type: 'string', nullable: true } },
      required: expect.arrayContaining(PERSON_KEYS) as string[],
    };
    expect(teamSchema).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              items: {
                items: {
                  properties: {
                    status: { enum: expect.arrayContaining(['PAUSED']) as string[] },
                    person,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(roleSchema).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              status: { enum: expect.arrayContaining(['PAUSED']) as string[] },
              person,
            },
          },
        },
      },
    });
    expect(inviteSchema).toMatchObject({
      content: { 'application/json': { schema: { properties: { person } } } },
    });
  });

  it('AB-1 denies team and business reads and omits the paused business from my organizations', async () => {
    for (const suffix of ['/collaborators', '']) {
      const response = await createAuthenticatedRequest(app, PAUSED).get(
        `/api/v1/organizations/${ORG}${suffix}`
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    const response = await createAuthenticatedRequest(app, PAUSED).get('/api/v1/organizations');
    expect(response.status).toBe(200);
    expect(bodyOf<{ items: { id: string }[] }>(response).items).toEqual([]);
  });

  it.each(['patch', 'delete'] as const)(
    'hides a foreign paused seat from an owner attempting %s and changes nothing',
    async (method) => {
      const pending = createAuthenticatedRequest(app, OTHER_OWNER)[method](
        `/api/v1/organizations/${OTHER_ORG}/collaborators/${PAUSED_ROW}`
      );
      const response = await (method === 'patch' ? pending.send({ role: 'MANAGER' }) : pending);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(
        await prisma.collaboration.findUniqueOrThrow({ where: { id: PAUSED_ROW } })
      ).toMatchObject({
        role: 'SELLER',
        status: 'PAUSED',
        amountHeld: 5000n,
      });
      expect((await prisma.person.findUniqueOrThrow({ where: { id: PAUSED } })).scopeVersion).toBe(
        7
      );
      expect(await prisma.notification.count()).toBe(0);
    }
  );
});
