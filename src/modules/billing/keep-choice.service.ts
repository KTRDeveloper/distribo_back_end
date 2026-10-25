import type { Actor as OrganizationActor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { listTeamSeats } from '../organization/organization.repository.js';
import { listProductsOnSale, listPausedProducts } from '../catalog/catalog.repository.js';
import { insertKeepChoiceEvent, runInTransaction } from './subscription.repository.js';

export type KeepChoiceInput = { id: string; collaborationIds: string[]; productIds: string[] };
export type KeepChoiceView = { collaboration_ids: string[]; product_ids: string[] };

/**
 * Records a preference, not a plan change; later billing jobs apply the latest event.
 * All eligibility reads and the append share a transaction. Every ineligible id has the same
 * opaque failure, including another tenant's ids (ASVS 8.2.1, BIL-018 AC-3/AB-1).
 * @param actor Server-loaded organization membership; never identity from the request body.
 * @param input Validated, bounded lists and the gesture id handled by route idempotency.
 * @returns Only the two chosen lists, with no journal or membership metadata.
 * @throws FORBIDDEN for a non-owner; NOT_FOUND if any selected id is ineligible.
 */
export async function saveKeepChoice(
  actor: OrganizationActor,
  input: KeepChoiceInput
): Promise<KeepChoiceView> {
  if (actor.role !== 'OWNER') throw httpError(403, 'FORBIDDEN', 'Forbidden');

  return runInTransaction(async (tx) => {
    const seats = await listTeamSeats(tx, actor.organizationId);
    const onSale = await listProductsOnSale(tx, actor.organizationId);
    const paused = await listPausedProducts(tx, actor.organizationId);
    const seatIds = new Set(seats.map((seat) => seat.id));
    const productIds = new Set([...onSale, ...paused].map((product) => product.productId));
    if (
      input.collaborationIds.some((id) => !seatIds.has(id.toLowerCase())) ||
      input.productIds.some((id) => !productIds.has(id.toLowerCase()))
    ) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    const view = {
      collaboration_ids: input.collaborationIds,
      product_ids: input.productIds,
    };
    await insertKeepChoiceEvent(tx, actor.organizationId, actor.personId, view);
    return view;
  });
}
