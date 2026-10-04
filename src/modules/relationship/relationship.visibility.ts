import type { CustomerRelationship, Person, Prisma } from '@prisma/client';
import { toPublicPerson, type PublicPerson } from '../person/person.repository.js';

/** A relationship row with the parties loaded; absent parties are null or omitted. */
export type RelationshipRow = CustomerRelationship & {
  customerPerson?: Person | null;
  supplierPerson?: Person | null;
  customerOrganization?: { name: string; description: string | null } | null;
  supplierOrganization?: { name: string; description: string | null } | null;
};

/** A party as another party sees it: a person's public view or an organization. */
export type PartyView =
  | { kind: 'PERSON'; person: PublicPerson }
  | { kind: 'ORGANIZATION'; name: string };

export type SupplierSideParty =
  | { kind: 'PERSON'; person: PublicPerson }
  | { kind: 'ORGANIZATION'; name: string; description: string | null };

export type SupplierRelationshipView = {
  id: string;
  status: CustomerRelationship['status'];
  customer: PartyView | null;
  customer_label: string | null;
  supplier_notes: string | null;
  delivery_address: string | null;
  credit_limit: number | null;
  credit_limit_set_by_id: string | null;
  credit_limit_set_at: Date | null;
  balance: number;
  ended_by_party: CustomerRelationship['endedByParty'];
  created_at: Date;
};

export type CustomerRelationshipView = {
  id: string;
  status: CustomerRelationship['status'];
  supplier: SupplierSideParty | null;
  supplier_label: string | null;
  delivery_address: string | null;
  credit_limit: number | null;
  balance: number;
  ended_by_party: CustomerRelationship['endedByParty'];
  created_at: Date;
};

export type DriverRelationshipView = {
  id: string;
  customer_name: string | null;
  available_credit: number | null;
};

/**
 * The one predicate that says which relationships a viewer may see (v5.0.0-8.2.2).
 *
 * Live rows only (not deleted, not merged into another) where the viewer's
 * organizations are supplier or customer, or the viewer is the customer or
 * supplier person. An empty `organizationIds` adds no organization clause, so it
 * matches no organization row (v5.0.0-8.4.1). Identity comes from the session,
 * never from client-sent ids.
 */
export function visibleRelationsWhere(viewer: {
  personId: string;
  organizationIds: string[];
}): Prisma.CustomerRelationshipWhereInput {
  const parties: Prisma.CustomerRelationshipWhereInput[] = [
    { customerPersonId: viewer.personId },
    { supplierPersonId: viewer.personId },
  ];
  if (viewer.organizationIds.length > 0) {
    parties.push(
      { supplierOrganizationId: { in: viewer.organizationIds } },
      { customerOrganizationId: { in: viewer.organizationIds } }
    );
  }
  return { deletedAt: null, mergedIntoId: null, OR: parties };
}

/** Money is whole XAF, so a bigint always fits a safe JSON integer. */
function toNumber(value: bigint): number {
  return Number(value);
}

function customerOf(row: RelationshipRow): PartyView | null {
  if (row.customerPerson) return { kind: 'PERSON', person: toPublicPerson(row.customerPerson) };
  if (row.customerOrganization) {
    return { kind: 'ORGANIZATION', name: row.customerOrganization.name };
  }
  return null;
}

function supplierOf(row: RelationshipRow): SupplierSideParty | null {
  if (row.supplierPerson) return { kind: 'PERSON', person: toPublicPerson(row.supplierPerson) };
  if (row.supplierOrganization) {
    return {
      kind: 'ORGANIZATION',
      name: row.supplierOrganization.name,
      description: row.supplierOrganization.description,
    };
  }
  return null;
}

/**
 * Supplier-side view (CM-19, CM-20): includes `customer_label` and `supplier_notes`,
 * never `supplier_label`. Built from an explicit field list (v5.0.0-8.2.3); the
 * customer person goes through `toPublicPerson`.
 */
export function projectForSupplier(row: RelationshipRow): SupplierRelationshipView {
  return {
    id: row.id,
    status: row.status,
    customer: customerOf(row),
    customer_label: row.customerLabel,
    supplier_notes: row.supplierNotes,
    delivery_address: row.deliveryAddress,
    credit_limit: row.creditLimit === null ? null : toNumber(row.creditLimit),
    credit_limit_set_by_id: row.creditLimitSetById,
    credit_limit_set_at: row.creditLimitSetAt,
    balance: toNumber(row.balance),
    ended_by_party: row.endedByParty,
    created_at: row.createdAt,
  };
}

/**
 * Customer-side view (CM-19): includes `supplier_label`, never `customer_label` or
 * `supplier_notes`. Built from an explicit field list (v5.0.0-8.2.3).
 */
export function projectForCustomer(row: RelationshipRow): CustomerRelationshipView {
  return {
    id: row.id,
    status: row.status,
    supplier: supplierOf(row),
    supplier_label: row.supplierLabel,
    delivery_address: row.deliveryAddress,
    credit_limit: row.creditLimit === null ? null : toNumber(row.creditLimit),
    balance: toNumber(row.balance),
    ended_by_party: row.endedByParty,
    created_at: row.createdAt,
  };
}

/** An invitation as the invited supplier sees it: the id, the label and the customer's public view. */
export type SupplierInvitationView = {
  id: string;
  supplier_label: string | null;
  customer: PartyView | null;
};

/**
 * Invitation view for the invited person: an explicit field list (v5.0.0-8.2.3); the customer
 * person goes through `toPublicPerson`, so nothing but the public view leaves.
 */
export function projectInvitation(row: RelationshipRow): SupplierInvitationView {
  return { id: row.id, supplier_label: row.supplierLabel, customer: customerOf(row) };
}

/**
 * Driver view: the customer's name and the credit still available (limit minus
 * balance, null with no ceiling), never the limit or the balance themselves. The
 * name is the customer's public name, else the organization name, else the
 * supplier's own counter label (a driver works for the supplier).
 */
export function projectForDriver(row: RelationshipRow): DriverRelationshipView {
  return {
    id: row.id,
    customer_name:
      row.customerPerson?.fullName ?? row.customerOrganization?.name ?? row.customerLabel ?? null,
    available_credit: row.creditLimit === null ? null : toNumber(row.creditLimit - row.balance),
  };
}
