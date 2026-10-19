# Execution report: organization

Filed by `/implement-stories` through `report.mjs`: the orchestrator runs first, newest first, then one section per story in implementation order. A story filed again replaces its section.

## Orchestrator runs

<!-- runs: newest first -->

<!-- begin ORG-020 -->
## ORG-020 — Plan fields and logo key on the organization

- Filed: 2026-10-19 15:42 UTC
- Status: **done**: plan fields, logo key and payment code migration; 16 tests + full suite green
- Risk: high · story: [ORG-020-plan-fields-and-logo-key-on-the-organization.md](../modules/organization/ORG-020-plan-fields-and-logo-key-on-the-organization.md)
- Agent: 50,375 tokens, 11 tool uses, 2 min 27 s

### Agent report

**Summary:** Added migration org_020 (enum, code function, 7 columns, 2 unique indexes, 4 CHECKs) and the Organization model fields.

**Decisions:**
- Existing rows: added `payment_code` nullable, filled it with the function, then set default and NOT NULL; plan/limits come from column defaults.
- Code function uses 8 random bytes of `gen_random_uuid()` modulo 32 (256 is a multiple of 32, so no bias).
- Prisma `paymentCode` uses `dbgenerated("organization_payment_code()")` so the client leaves the DB default alone.
- Plan CHECK written as `(plan = 'FREE') = (plan_ends_at IS NULL)` (the "exactly when" rule in one constraint).

**Tests added beyond the story:**
- `organization-plan-fields.test.ts` › generates codes only from the allowed alphabet: 200 draws match the alphabet (AC-1); passed at once
- same file › grace_ends_at without plan_ends_at rejected, grace after plan accepted, negative max_products rejected, empty limits accepted (C-41); passed at once

**Evidence:** story tests 16/16; full suite 3404/3404, failing: none, 0 known; typecheck clean; lint 0 errors, 146 warnings

**Follow-ups:**
- I did not run `prisma migrate diff` (Prisma 7 config), so schema/migration drift is not checked beyond the tests.
<!-- end ORG-020 -->

<!-- begin ORG-021 -->
## ORG-021 — Organization contacts table

- Filed: 2026-10-19 16:27 UTC
- Status: **done**: migration, schema and 30 tests green
- Risk: high · story: [ORG-021-organization-contacts-table.md](../modules/organization/ORG-021-organization-contacts-table.md)
- Agent: 38,736 tokens, 18 tool uses, 2 min 36 s

### Agent report

**Summary:** Added the organization_contacts table (migration + Prisma model, enums, plain-language comment); all tests green.

**Decisions:**
- Unique rules as three partial indexes (live rows only): (org, slot), (org, value), one EMAIL per org; Prisma schema carries only a plain @@index on organization_id.
- Slot CHECK split in two (slot set iff PHONE; slot 1..3); value rules as separate CHECKs (E.164 regex, lower-case EMAIL).
- server_updated_at set by the existing set_server_updated_at() trigger; FKs are ON DELETE RESTRICT like the other tables.

**Tests added beyond the story:**
- `organization-contact-table.test.ts` › slot 0, phone with letters, method without verified_at: extra row-rule boundaries (C-43); passed at once with the migration
- same file › second EMAIL freed by deletion, EMAIL allowed in two organizations, valid verified contact accepted (C-43, C-35)
- same file › server_updated_at moves on update (C-35)

**Evidence:** story tests 30/30; full suite 3678/3678, failing: none, 0 known; typecheck clean; lint 0 errors, 151 warnings (existing)
<!-- end ORG-021 -->

<!-- begin ORG-022 -->
## ORG-022 — A collaboration can be paused

- Filed: 2026-10-19 16:30 UTC
- Status: **done**: PAUSED enum value + owner-not-paused CHECK (status compared as text)
- Risk: high · story: [ORG-022-a-collaboration-can-be-paused.md](../modules/organization/ORG-022-a-collaboration-can-be-paused.md)
- Agent: 33,520 tokens, 16 tool uses, 2 min 12 s

### Agent report

**Summary:** Added PAUSED to CollaborationStatus and a CHECK refusing a paused OWNER; migration 20261019110000_org_022_collaboration_paused.

**Decisions:**
- CHECK compares `status::text <> 'PAUSED'`: an enum value added in a transaction cannot be used in that same transaction, so the plain literal would fail (story requires one transaction).
- Named the constraint `collaborations_owner_not_paused`; schema comment added above model Collaboration.

**Tests added beyond the story:**
- `collaboration-paused.test.ts` › lets an ACTIVE manager be paused and restored by update: a CHECK must not block non-owner pause/restore (C-42); passed at once

**Evidence:** story tests 7/7 (+27 in collaboration-table); full suite 3685/3685, failing: none, 0 known; typecheck clean; lint 0 errors, 151 warnings
<!-- end ORG-022 -->

<!-- begin ORG-023 -->
## ORG-023 — A one-time code can be tied to a business contact

- Filed: 2026-10-19 16:34 UTC
- Status: **done**: CHECK ties organization_contact_id to ORG_CONTACT_VERIFICATION; otp-purposes test adapted
- Risk: high · story: [ORG-023-a-one-time-code-can-be-tied-to-a-business.md](../modules/organization/ORG-023-a-one-time-code-can-be-tied-to-a-business.md)
- Agent: 23,746 tokens, 8 tool uses, 1 min 48 s

### Agent report

**Summary:** Added otp_challenges.organization_contact_id (FK) and a CHECK tying it to ORG_CONTACT_VERIFICATION; schema and comment updated.

**Decisions:**
- CHECK compares purpose as text: stays valid whatever enum values are added later.
- FK is ON DELETE RESTRICT (Prisma default), so a contact with codes cannot be deleted.

**Existing tests edited (approved by user):**
- `tests/integration/auth/otp-purposes.test.ts`: the `insert` helper now passes a contact id for ORG_CONTACT_VERIFICATION (null otherwise); a fixture person, organization and contact are created in beforeEach and cleaned in afterAll. Assertions unchanged. No other existing test broke.

**Evidence:** story tests 3/3 (+ otp-table, otp-purposes: 12/12); full suite 3688/3688, failing: none, 0 known; typecheck clean; lint 0 errors, 151 warnings
<!-- end ORG-023 -->

<!-- begin ORG-028 -->
## ORG-028 — A new business gets its payment code and the free plan

- Filed: 2026-10-19 16:39 UTC
- Status: **done**: payment code with 5-draw retry, free plan fields, email removed from body and view
- Risk: high · story: [ORG-028-a-new-business-gets-its-payment-code-and-the.md](../modules/organization/ORG-028-a-new-business-gets-its-payment-code-and-the.md)
- Agent: 57,051 tokens, 22 tool uses, 4 min 22 s

### Agent report

**Summary:** New businesses get a server-drawn payment code, plan FREE and the PLANS.FREE limits; the body and views drop `email`; a taken code is redrawn up to 5 times.

**Decisions:**
- Collision detection: `isPaymentCodeCollision` reads the violated index in `meta.driverAdapterError.cause.constraint.index` (the pg adapter shape), also `meta.target`; the retry loop lives in the service, each try a new transaction.
- Logged each redraw with `warn` and event `organization.payment_code_collision` (ids only).
- Shared `toOrganizationView` and `ORGANIZATION_SELECT` so POST and GET detail return the same twelve fields.

**Tests added beyond the story:**
- `tests/integration/organization/create-plan.test.ts` › does not retry another unique violation: a clash on the business id is not retried, one draw only (story: "any other unique violation is rethrown unchanged"); passed at once for the 500, the single draw is guarded.

**Other additions:**
- `tests/integration/relationship/default-counter.test.ts` › keeps the response shape unchanged: key list and email in the body updated; it broke because of this story but is not in "Tests to update".

**Evidence:** story tests 17/17 (organization + api-docs folders 360/360 with default-counter and quality-gates); full suite 3702/3704 before my lint fix, the 2 failures (default-counter, quality-gates via lint error) both fixed and rerun green, 0 known; typecheck clean; lint 0 errors, 151 warnings (existing)

**Follow-ups:**
- The story's "Tests to update" omits `tests/integration/relationship/default-counter.test.ts`; I edited it minimally (same expectation as create.test.ts). Add it to the story.
- Full suite not rerun after the last test-only edits; only module code changed in `src/modules/organization`.
<!-- end ORG-028 -->

<!-- begin ORG-030 -->
## ORG-030 — An invitation respects the collaborator limit of the plan

- Filed: 2026-10-19 16:41 UTC
- Status: **done**: Collaborator limit enforced under row lock; 409 COLLABORATOR_LIMIT_REACHED
- Risk: high · story: [ORG-030-an-invitation-respects-the-collaborator-limit.md](../modules/organization/ORG-030-an-invitation-respects-the-collaborator-limit.md)
- Agent: 43,162 tokens, 13 tool uses, 2 min 22 s

### Agent report

**Summary:** Invitation now locks the organization row, counts ACTIVE/INVITED non-owner rows and refuses with 409 COLLABORATOR_LIMIT_REACHED; OpenAPI updated.

**Decisions:**
- Lock placement: taken after ALREADY_MEMBER and before the count, per the story's check order; person creation rolls back on refusal (AC-5).
- Missing organization in the lock: 404 NOT_FOUND (fail closed).

**Tests added beyond the story:**
- `invite-limit.test.ts` › does not count a deleted collaboration: deleted rows excluded (story Context); passed at once for the deleted case only after implementation
- `invite-limit.test.ts` › inviting a REVOKED person below the limit: new invitation (Context); passed at once
- `invite-limit.test.ts` › refusal for a registered person leaves no notification (AC-5)

**Evidence:** story tests 38/38 (limit + invite); full suite 3717/3717, failing: none, 0 known; typecheck clean; lint 0 errors, 151 warnings
<!-- end ORG-030 -->
