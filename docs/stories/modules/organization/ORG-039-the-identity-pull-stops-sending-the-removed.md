---
id: ORG-039
title: The identity pull stops sending the removed fields
module: organization
kind: change
rev: 1
amends: [SYNC-003]
size: XS
risk: medium
depends_on: [ORG-029, SYNC-003]
read_first: [src/modules/sync/adapters/identity.adapter.ts, tests/integration/sync/pull-identity.test.ts]
design_refs: [synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone, identite-et-organisation/organization]
constraints: []
asvs: [v5.0.0-15.3.1]
---

# ORG-039 — The identity pull stops sending the removed fields

## Story
Technical story: the organizations and collaborations adapters of the pull stop selecting and sending `email` and `is_public_contact`, so that dropping both columns later breaks nothing.

## Context
- Exists: `organizationsAdapter` selects and sends `email`; `collaborationsAdapter` selects and sends `is_public_contact` (SYNC-003). Both fields leave the design: contacts replace them.
- Remove both from the `select` and from the row builders in `src/modules/sync/adapters/identity.adapter.ts`. Every other key, the `amount_held` rule and the filters stay.
- This story touches a file of the sync module because the columns belong to the organization module and ORG-032 and ORG-043 drop them; the order is: stop sending (here), then drop.
- The contacts, the plan fields and the logo reach the phone through their own SYNC stories.

## Acceptance criteria
```gherkin
Scenario: AC-1 The organization row has no email
  Given an organization whose stored `email` is "a@b.cm"
  When a member pulls
  Then the `organizations` row has no `email` key
Scenario: AC-2 The collaboration row has no flag
  Given a collaboration whose stored flag is true
  When a member pulls
  Then the `collaborations` row has no `is_public_contact` key
Scenario: AC-3 The rest of the rows is unchanged
  When a member pulls
  Then the rows still carry `id`, `name`, `description`, `status`, `created_at`, `server_updated_at` and the collaboration keys `person_id`, `organization_id`, `role`, `status`, `invited_at`, `accepted_at`, with `amount_held` only where it was sent
```

## Abuse cases
```gherkin
Scenario: AB-1 A forgotten flag is still sent to phones (information disclosure, T4)
  Given a collaborator of another business whose stored flag is true
  When any member of the viewer's business pulls
  Then no pulled row of any table carries `is_public_contact`
```

## Implementation
- Create: `tests/integration/sync/pull-identity-removed-fields.test.ts`
- Modify: `src/modules/sync/adapters/identity.adapter.ts`
- Pattern: `src/middleware/load-actor.ts`
- Dependencies: none added

## Security
- v5.0.0-15.3.1: both adapters keep an explicit list of fields; the two removed ones are not on it.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| no email | integration | AC-1 | stored email → no key in the organizations row |
| no flag | integration | AC-2 | stored true → no key in the collaborations row |
| rest unchanged | integration | AC-3 | the listed keys are present |
| forgotten flag | security | AB-1, CWE-200 | no pulled row carries the key |

Command: `npx vitest run tests/integration/sync/pull-identity-removed-fields.test.ts tests/integration/sync/pull-identity.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/sync/pull-identity.test.ts | seeds an `email` on organizations but never checks it among the pulled keys | unchanged |

## Out of scope
- Sending contacts, plan fields or the logo key: SYNC.
- Dropping the columns: ORG-032 and ORG-043.
