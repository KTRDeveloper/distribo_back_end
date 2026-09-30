---
id: ACC-006
title: Ability middleware
module: access
kind: technical
rev: 1
amends: []
size: S
risk: high
depends_on: [ACC-005, FND-006]
read_first: [src/middleware/auth.ts, src/types/express.d.ts]
design_refs: [acces-et-securite/la-couche-d-acces-et-la-table-des-regles]
constraints: []
asvs: [v5.0.0-8.2.1, v5.0.0-16.3.2]
---

# ACC-006 — Ability middleware

## Story
Technical story: provide `requireAbility`, which refuses a request when the caller's role in the organization may not do the action, so that routes declare their permission in one line.

## Context
- Exists: `abilityFor` with the complete rules (ACC-001 to ACC-005); `httpError`; `req.user` from `authMiddleware`.
- Adds: `src/middleware/require-ability.ts` and the `req.actor` type in `src/types/express.d.ts`: `{ personId: string; organizationId: string; role: Role }`, set later by the organization module (ORG-005).
- `requireAbility(action, subjectType, conditionsFrom?)` builds the ability with context `{ onServer: false, online: true, daysSinceSync: 0 }` and role from `req.actor`; when `conditionsFrom(req)` is given, its result is the subject instance used for the check.
- A missing `req.actor` answers 403 `FORBIDDEN`. A refusal logs `warn` event `permission_refused` with person id, action and subject type.

## Acceptance criteria
```gherkin
Scenario: AC-1 Allowed
  Given `req.actor.role` is OWNER
  When a route guarded by requireAbility('close', 'Organization') is called
  Then the handler runs
Scenario: AC-2 Refused
  Given `req.actor.role` is SELLER
  When the same route is called
  Then the response is 403 `FORBIDDEN` and the handler does not run
Scenario: AC-3 No actor
  When `req.actor` is missing
  Then the response is 403 `FORBIDDEN`
Scenario: AC-4 Condition on the subject
  Given requireAbility('cancel', 'Order', (req) => ({ status: 'DELIVERED' }))
  When a SELLER calls it
  Then the response is 403; with status CONFIRMED it is allowed
```

## Abuse cases
```gherkin
Scenario: AB-1 Role sent by the client (elevation)
  When the request body or header carries `role: OWNER`
  Then the decision still uses `req.actor.role` and the response is 403 for a SELLER
Scenario: AB-2 Refusals are traced (repudiation)
  When a request is refused
  Then a `warn` log with event `permission_refused` and no personal data exists
```

## Implementation
- Create: `src/middleware/require-ability.ts`, `tests/unit/access/require-ability.test.ts`
- Modify: `src/types/express.d.ts`
- Pattern: `src/middleware/auth.ts`
- Signatures:
  - `requireAbility(action: string, subjectType: string, conditionsFrom?: (req: Request) => Record<string, unknown>): RequestHandler`
- Types:
  - `Actor = { personId: string; organizationId: string; role: Role }`
- Errors: `FORBIDDEN` 403
- Dependencies: `express`, `@casl/ability`, `pino`

## Security
- v5.0.0-8.2.1: the role comes only from `req.actor`, never from the request.
- v5.0.0-16.3.2: every refusal is logged with a fixed event name.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| allowed | unit | AC-1 | OWNER actor → next called |
| refused | unit | AC-2 | SELLER actor → 403 FORBIDDEN, handler not called |
| no actor | unit | AC-3 | none → 403 |
| condition | unit | AC-4 | DELIVERED → 403; CONFIRMED → next |
| forged role | security | AB-1, CWE-269 | body role OWNER, actor SELLER → 403 |
| refusal log | security | AB-2, CWE-778 | refused call → one warn entry with event permission_refused |

Command: `npx vitest run tests/unit/access/require-ability.test.ts`

## Out of scope
- Loading `req.actor` from the database (ORG-005).
