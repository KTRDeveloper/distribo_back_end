# ADR-001: Module decomposition

Status: accepted

## Context
The design `data-model/modele-donnees-livraisons-v16.md` defines 24 entities, flows for online routes, an offline synchronization server and a policy table. The project already has a modular monolith (`src/modules/<name>/`) with auth, user, tasks, remote-config, health and api-docs modules, and an older delivery schema that no endpoint uses. Entities are grouped by aggregate, and no module depends on a later one in the order below, so a story can only need stories that come before it.

## Decision
One module per aggregate, one owning module per entity, acyclic dependencies. `foundation` owns no entity. `access`, `privacy` own none either: `access` is the pure policy engine (rules table, role order, ability builder, idempotency helper), `privacy` runs cross-cutting retention and account deletion at the end.

| module | prefix | owned entities | depends on | why |
|---|---|---|---|---|
| foundation | FND | none | none | Walking skeleton, CI and scans, two database roles, shared kernel (money rounding, E.164, UUIDv7, HTTP error helper) |
| person | PER | Person, PhoneNumberChangeLog | FND | The identity root every other entity points to; merges the old Account into Person |
| notification | NTF | Notification | PER, FND | Every module notifies; needs only a recipient |
| access | ACC | none | FND, PER | CASL rules table, `atLeast`, `abilityFor`, idempotency-key middleware; pure code, no database read, so identity and organization can use it |
| auth | AUTH | OtpChallenge, Device, RefreshToken | PER, NTF, ACC, FND | Registration, login with code, sessions per device, password and number changes |
| organization | ORG | Organization, Collaboration, Subscription | PER, NTF, ACC, AUTH, FND | Businesses, fixed roles, team, ownership transfer, closing, public contacts |
| relationship | REL | CustomerRelationship, CustomerRelationshipReassignment, CreditLimitChange | ORG, PER, NTF, ACC, FND | Customers, suppliers, counters, credit limit, contestation, visibility predicate |
| catalog | CAT | Product, CustomerPrice | ORG, REL, ACC, FND | Articles, negotiated prices, reference price |
| order | ORD | Order, OrderLine | REL, CAT, ORG, NTF, ACC, FND | Placing, accepting, refusing, cancelling, supplier-entered orders, state machine |
| finance | FIN | LedgerEntry, Expense, Handover | ORD, REL, ORG, NTF, ACC, FND | Ledger, balance and held-money caches, expenses, handovers, nightly check |
| delivery | DLV | Delivery | ORD, FIN, REL, ORG, NTF, ACC, FND | Departure, failure, "Commande livrée", partial delivery, counter sale |
| admin | ADM | Report, Administrator, AdminAction | PER, ORG, AUTH, NTF, ACC, FND | Reports, suspension, two-factor administrators, admin journal |
| sync | SYNC | SyncArchive | ADM and every module above | Pull, push, judging each line, archive, replay, full resync |
| privacy | PRIV | none | every module above | Account anonymization and the daily retention purge |

Cross-module effects that would create a cycle are written as `kind: change` stories in the later module, for example the default counter created with an organization (REL), the automatic handover at ownership transfer (FIN), the "Commerce fermé" refusal of pending orders (ORD).

## Contracts
| provider | provides (function, file, creating story) | consumers |
|---|---|---|
| FND | `roundAmount(quantityMilli, unitPrice)`, `src/shared/money.ts` | ORD, FIN, DLV, SYNC |
| FND | `normalizeE164(input)`, `src/shared/phone.ts` | PER, AUTH, ORG, REL |
| FND | `newId()` (UUIDv7), `src/shared/ids.ts` | SYNC and every create path |
| FND | `httpError(status, code, message)`, `src/lib/http-error.ts`, same shape as the existing errors | all |
| PER | `findByActivePhone`, `findOrCreateByPhone`, `toPublicPerson`, `bumpScopeVersion`, `releasePhoneNumber`, `src/modules/person/person.repository.ts` | AUTH, ORG, REL, ADM, SYNC |
| NTF | `notify({ recipientId, organizationId?, sourceEvent, content, related? })`, `src/modules/notification/notification.service.ts` | AUTH, ORG, REL, ORD, FIN, DLV, ADM, SYNC |
| ACC | `RULES`, `atLeast(role, min)`, `abilityFor(role, ctx)`, `requireAbility(action, subject)`, `idempotent()`, `src/shared/access/` and `src/middleware/` | ORG and every later module |
| AUTH | `authMiddleware` (JWT plus live device session), `issueSession`, `revokeSessions(personId, reason)`, `src/modules/auth/` | all routes, ADM, PRIV |
| ORG | `loadActor` middleware giving `{ personId, organizationId, role }`, `getActiveCollaboration`, `assertOrganizationActive`, `addAmountHeld(tx, personId, organizationId, delta)`, `findOrganizationsByPublicNumber` | REL and later |
| REL | `visibleRelationsWhere(actor)`, `projectRelationForParty`, `addToBalance(tx, relationId, delta)`, `setCreditLimit`, `mergeDuplicateRelations` | CAT, ORD, FIN, DLV, SYNC |
| CAT | `getReferencePrice(tx, relationId, productId)`, `catalogForCustomer` | ORD, SYNC |
| ORD | `transitionOrder(tx, orderId, to, actor)`, `computeTotals(lines, deliveryCost)` | DLV, FIN, SYNC |
| FIN | `appendLedgerEntry(tx, input)` (updates the two caches in the fixed order), `recordSaleAndPayment` | DLV, SYNC, ORG (ownership transfer change) |
| DLV | `deliverOrder(actor, orderId, input)` | SYNC |
| ADM | `recordAdminAction(tx, input)` | SYNC (replay), PRIV |
| SYNC | `judgeLine`, `archiveBatch`, `pull`, `push` | ADM (replay) through a change story |

## Consequences
- 14 modules and an estimated 150 to 190 stories, implemented mostly in the order FND, PER, NTF, ACC, AUTH, ORG, REL, CAT, ORD, FIN, DLV, ADM, SYNC, PRIV.
- Later modules edit earlier ones through change stories, so those stories carry a "Tests to update" list.
- The sync module is the largest and is split by SPIDR slices (pull, push per entity family, controls, archive, replay).
- ASVS level L2 for every module: personal data, business data and money flows, no special-category data. AUTH, ACC, FIN and SYNC are trusted for security decisions and could move to L3 if you ask for high assurance.
- A restructuring later means a new ADR; nothing here changes on its own.
