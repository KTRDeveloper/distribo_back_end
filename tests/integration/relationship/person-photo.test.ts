import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const CUSTOMER_ID = '0199c026-0000-7000-8000-000000000001';
const SUPPLIER_ID = '0199c026-0000-7000-8000-000000000002';
const SELLER_ID = '0199c026-0000-7000-8000-000000000003';
const STRANGER_ID = '0199c026-0000-7000-8000-000000000004';
const CUSTOMER_PHONE = '+237600026001';
const SUPPLIER_PHONE = '+237600026002';
const CUSTOMER_KEY = 'avatars/0199c026-0000-4000-8000-000000000001.webp';
const SUPPLIER_KEY = 'avatars/0199c026-0000-4000-8000-000000000002.webp';
const PUBLIC_FIELDS = ['avatar_url', 'phone_number', 'public_name', 'registered'];
const registeredAt = new Date('2026-01-01T00:00:00.000Z');

let organizationId: string;
let otherOrganizationId: string;

function invite() {
  return createAuthenticatedRequest(app, CUSTOMER_ID)
    .post('/api/v1/suppliers/invitations')
    .send({ id: newId(), phone_number: SUPPLIER_PHONE, supplier_label: 'Fixture seller' });
}

function expectPhoto(address: unknown, key: string) {
  expect(address).toEqual(expect.any(String));
  const url = new URL(address as string);
  expect(['http:', 'https:']).toContain(url.protocol);
  expect(url.pathname.endsWith(`/${key}`)).toBe(true);
}

type PublicPerson = {
  public_name: string | null;
  phone_number: string | null;
  registered: boolean;
  avatar_url: string | null;
};
type Item = { customer?: { person: PublicPerson }; supplier?: { person: PublicPerson } };
type Schema = {
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  required?: string[];
};
type Document = {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content: { 'application/json': { schema: Schema } } }> }
    >
  >;
};

const answers = [
  {
    name: 'seller customers',
    caller: SELLER_ID,
    path: () => `/api/v1/organizations/${organizationId}/customers`,
    documentPath: '/api/v1/organizations/{organizationId}/customers',
    party: 'customer',
    key: CUSTOMER_KEY,
    phone: CUSTOMER_PHONE,
  },
  {
    name: 'customer suppliers',
    caller: CUSTOMER_ID,
    path: () => '/api/v1/suppliers',
    documentPath: '/api/v1/suppliers',
    party: 'supplier',
    key: SUPPLIER_KEY,
    phone: SUPPLIER_PHONE,
  },
  {
    name: 'supplier invitations',
    caller: SUPPLIER_ID,
    path: () => '/api/v1/supplier-invitations',
    documentPath: '/api/v1/supplier-invitations',
    party: 'customer',
    key: CUSTOMER_KEY,
    phone: CUSTOMER_PHONE,
  },
] as const;

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: CUSTOMER_PHONE,
        avatarKey: CUSTOMER_KEY,
      },
      {
        id: SUPPLIER_ID,
        fullName: 'Paul Mbarga',
        phoneNumber: SUPPLIER_PHONE,
        avatarKey: SUPPLIER_KEY,
      },
      { id: SELLER_ID, fullName: 'Fixture Seller', phoneNumber: '+237600026003' },
      { id: STRANGER_ID, fullName: 'Fixture Stranger', phoneNumber: '+237600026004' },
    ].map((person) => ({
      ...person,
      registeredAt,
      phoneVerifiedAt: registeredAt,
      passwordHash: 'test-password-hash',
    })),
  });
  organizationId = newId();
  otherOrganizationId = newId();
  for (const [id, personId] of [
    [organizationId, SELLER_ID],
    [otherOrganizationId, STRANGER_ID],
  ]) {
    const response = await createAuthenticatedRequest(app, personId)
      .post('/api/v1/organizations')
      .send({ id, name: 'Fixture Photo Business' });
    expect(response.status).toBe(201);
  }
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${newId()}::uuid, ${organizationId}::uuid, ${CUSTOMER_ID}::uuid, ${SELLER_ID}::uuid)
  `;
});

describe('relationship person photos (REL-026)', () => {
  it('shows the registered supplier name and photo in the invitation response', async () => {
    const response = await invite();
    expect(response.status).toBe(201);
    const person = (response.body as Item).supplier!.person;
    expect(person).toMatchObject({ public_name: 'Paul Mbarga', registered: true });
    expect(Object.keys(person).sort()).toEqual(PUBLIC_FIELDS);
    expectPhoto(person.avatar_url, SUPPLIER_KEY);
  });

  it('shows null name and photo for a new number', async () => {
    const response = await createAuthenticatedRequest(app, CUSTOMER_ID)
      .post('/api/v1/suppliers/invitations')
      .send({ id: newId(), phone_number: '+237600026099', supplier_label: 'New supplier' });
    expect(response.status).toBe(201);
    expect((response.body as Item).supplier!.person).toEqual({
      public_name: null,
      phone_number: '+237600026099',
      registered: false,
      avatar_url: null,
    });
  });

  it.each(answers)('$name exposes exactly the four public person fields', async (answer) => {
    expect((await invite()).status).toBe(201);
    const response = await createAuthenticatedRequest(app, answer.caller).get(answer.path());
    expect(response.status).toBe(200);
    const people = (response.body as { items: Item[] }).items
      .filter((item) => item[answer.party]?.person)
      .map((item) => item[answer.party]!.person);
    expect(people).toHaveLength(1);
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual(PUBLIC_FIELDS);
      expect(person).toMatchObject({ phone_number: answer.phone, registered: true });
      expectPhoto(person.avatar_url, answer.key);
    }
  });

  it.each(answers)('$name documents the nullable photo address', async (answer) => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    expect(response.status).toBe(200);
    const document = response.body as Document;
    const schema =
      document.paths[answer.documentPath].get.responses['200'].content['application/json'].schema;
    const party = schema.properties!.items.items!.properties![answer.party];
    const person = party.anyOf!.find((branch) => branch.properties?.person)!.properties!.person;
    expect(person.properties).toHaveProperty('avatar_url', { type: ['string', 'null'] });
    expect(Object.keys(person.properties!).sort()).toEqual(PUBLIC_FIELDS);
    expect(person.required).toContain('avatar_url');
  });

  it('documents the four public supplier fields in the invitation creation response', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');
    expect(response.status).toBe(200);
    const document = response.body as Document;
    const schema =
      document.paths['/api/v1/suppliers/invitations'].post.responses['201'].content['application/json']
        .schema;
    const person = schema.properties!.supplier.anyOf!.find((branch) => branch.properties?.person)!
      .properties!.person;
    expect(person.properties).toHaveProperty('avatar_url', { type: ['string', 'null'] });
    expect(Object.keys(person.properties!).sort()).toEqual(PUBLIC_FIELDS);
    expect(person.required).toContain('avatar_url');
  });

  it.each(answers)('$name never exposes a stored key as a field or bare value', async (answer) => {
    expect((await invite()).status).toBe(201);
    const response = await createAuthenticatedRequest(app, answer.caller).get(answer.path());
    expect(response.status).toBe(200);
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('avatar_key');
    expect(json).not.toContain('avatarKey');
    expect(json).not.toContain(JSON.stringify(CUSTOMER_KEY));
    expect(json).not.toContain(JSON.stringify(SUPPLIER_KEY));
    expect(json).toContain(answer.key);
  });

  it('does not show another business customer or photo to a stranger', async () => {
    const response = await createAuthenticatedRequest(app, STRANGER_ID).get(
      `/api/v1/organizations/${otherOrganizationId}/customers`
    );
    expect(response.status).toBe(200);
    expect((response.body as { items: Item[] }).items.every((item) => item.customer === null)).toBe(
      true
    );
    const json = JSON.stringify(response.body);
    expect(json).not.toContain(CUSTOMER_PHONE);
    expect(json).not.toContain('Fixture Customer');
    expect(json).not.toContain(CUSTOMER_KEY);
  });

  it('does not expose an invitation customer photo to another supplier account', async () => {
    expect((await invite()).status).toBe(201);
    const response = await createAuthenticatedRequest(app, STRANGER_ID).get(
      '/api/v1/supplier-invitations'
    );
    expect(response.status).toBe(200);
    expect((response.body as { items: Item[] }).items).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(CUSTOMER_KEY);
  });
});
