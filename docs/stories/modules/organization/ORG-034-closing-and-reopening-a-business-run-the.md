---
id: ORG-034
title: Closing and reopening a business run the lifecycle hooks
module: organization
kind: change
rev: 1
amends: [ORG-016, ORG-017]
size: S
risk: high
depends_on: [ORG-016, ORG-017, ORG-022, ORG-043]
read_first: [src/modules/organization/organization.service.ts, src/modules/sync/sync.registry.ts]
design_refs: [identite-et-organisation/organization]
constraints: [CM-10]
asvs: [v5.0.0-8.2.1, v5.0.0-2.3.3]
---

# ORG-034 — Closing and reopening a business run the lifecycle hooks

## Story
As an owner, I want closing and reopening my business to end its team and its plans in one step so that nothing stays paid or active on a closed business.

## Context
- Exists: `closeOrganization` (one transaction) and `reopenOrganization` (one conditional update, no transaction); `PAUSED` since ORG-022.
- Adds `src/modules/organization/lifecycle-hooks.ts`, patterned on the sync registry: `registerLifecycleHook({ onClose?, onReopen? })` stores a hook and returns a function that removes it; a hook with neither function throws. `runCloseHooks` and `runReopenHooks` call the hooks in registration order with `(tx, organizationId, now)`, in the caller's transaction; a failing hook aborts the operation.
- `closeOrganization` runs the close hooks last, after the old subscription is ended.
- `reopenOrganization` now runs in a transaction: `reopenClosedOrganization(tx, organizationId)`, then the reopen hooks, unless the update matched nothing.
- `revokeNonOwnerCollaborations` also turns `PAUSED` non-owner rows into `REVOKED` (CM-10). Like `INVITED` rows they have no access: no scope bump, no notice.
- `CM-10`: CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, plans stopped without refund; relations, balances, history and verified public contacts stay visible and payments stay possible; a reopened business restarts from the free plan.

## Acceptance criteria
```gherkin
Scenario: AC-1 Close runs the close hooks
  Given two hooks registered in order
  When the owner closes the business
  Then both `onClose` run in that order with the transaction, the organization id and the time of the close
Scenario: AC-2 A failing hook undoes the close
  Given an `onClose` that throws
  When the owner closes the business
  Then the answer is 500, the organization is still ACTIVE and nothing else changed
Scenario: AC-3 Paused members are revoked
  Given a PAUSED seller and an ACTIVE manager
  When the owner closes the business
  Then both are REVOKED and the owner is unchanged
  And only the manager gets a scope bump and an `organization.closed` notice
Scenario: AC-4 Reopen runs the reopen hooks in one transaction
  Given a CLOSED business and an `onReopen` that throws
  When the owner reopens it
  Then the answer is 500 and the business is still CLOSED
  And with a hook that does not throw, the business is ACTIVE and the hook ran once
Scenario: AC-5 Refused calls run no hook
  When the owner closes a CLOSED or SUSPENDED business, or reopens an ACTIVE or SUSPENDED one
  Then the answer is 409 and no hook ran
Scenario: AC-6 Registration
  When a hook with neither function is registered
  Then it throws
  And a hook removed with the returned function no longer runs
```

## Abuse cases
```gherkin
Scenario: AB-1 The owner lifts a moderation suspension (elevation)
  Given a SUSPENDED business with a reopen hook registered
  When its owner calls reopen
  Then the answer is 409, the status stays SUSPENDED and the hook did not run
```

## Implementation
- Create: `src/modules/organization/lifecycle-hooks.ts`, `tests/integration/organization/lifecycle-hooks.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`
- Pattern: `src/modules/sync/sync.registry.ts`
- Signatures:
  - `registerLifecycleHook(hook: LifecycleHook): () => void`
  - `runCloseHooks(tx: Prisma.TransactionClient, organizationId: string, now: Date): Promise<void>`
  - `runReopenHooks(tx: Prisma.TransactionClient, organizationId: string, now: Date): Promise<void>`
  - `reopenClosedOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<boolean>`
- Types:
  - `HookFn = (tx: Prisma.TransactionClient, organizationId: string, now: Date) => Promise<void>`
  - `LifecycleHook = { onClose?: HookFn; onReopen?: HookFn }`
- Errors: `ORGANIZATION_NOT_ACTIVE` 409, `ORGANIZATION_NOT_CLOSED` 409
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the organization id given to a hook is the actor's, never one from the body.
- v5.0.0-2.3.3: the hooks run inside the transaction, so a failure leaves no half-closed business.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| close hooks | integration | AC-1, CM-10 | two hooks → called in order with tx, id and date |
| failing close hook | integration | AC-2 | throw → 500 and every table as before |
| paused members | integration | AC-3, CM-10 | PAUSED and ACTIVE → REVOKED; bump and notice for the ACTIVE one only |
| reopen hooks | integration | AC-4 | throwing hook → CLOSED; normal hook → ACTIVE, one call |
| refusals | integration | AC-5 | four cases → 409, no call |
| registration | unit | AC-6 | empty hook throws; removed hook silent |
| suspension kept | security | AB-1, CWE-285 | SUSPENDED → 409, no call |

Command: `npx vitest run tests/integration/organization/lifecycle-hooks.test.ts tests/integration/organization/close.test.ts tests/integration/organization/reopen.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/close.test.ts | no collaboration is PAUSED | unchanged |
| tests/integration/organization/reopen.test.ts | reopens and refuses as before | unchanged |

## Out of scope
- Registering a hook: billing (BIL) ends the plans on close and keeps the free plan on reopen.
- Removing the old `subscriptions` call from close: BIL-005.
