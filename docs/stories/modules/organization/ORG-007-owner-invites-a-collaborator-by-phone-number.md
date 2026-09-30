---
id: ORG-007
title: Owner invites a collaborator by phone number
module: organization
kind: feature
rev: 1
amends: []
size: M
risk: high
depends_on: [ORG-005, ACC-005, ACC-007, PER-005, NTF-002]
read_first: [docs/stories/modules/organization/contracts.md, src/modules/organization/organization.routes.ts]
design_refs: [identite-et-organisation/collaboration]
constraints: ['Collaboration.role:enum', 'Collaboration.status:enum', C-05]
asvs: [v5.0.0-8.2.1, v5.0.0-15.3.3, v5.0.0-2.4.1]
---

# ORG-007 — Owner invites a collaborator by phone number

## Story
As an owner, I want to invite someone by phone number with a role so that they can join my team when they register.

## Context
- Exists: `loadActor`, `assertOrganizationActive` (ORG-005); `requireAbility('manage', 'Collaboration')` (ACC-005, owner and network only); `idempotent()`; `findOrCreateByPhone`, `toPublicPerson` (PER-005); `notify`.
- Adds: `POST /api/v1/organizations/{organizationId}/collaborators` with `{ id, phone_number, role }`, role MANAGER, SELLER or DRIVER. Response 201 `{ id, person: { public_name, phone_number, registered }, role, status: 'INVITED', invited_at }`.
- The person is found or created as a guest by the number. A new row is INVITED with `is_public_contact` false. A REVOKED row of the same person is reused: status INVITED, new role, `invited_at` = now, `accepted_at` emptied. An ACTIVE or INVITED row answers 409 `ALREADY_MEMBER`.
- A registered invitee gets a notification `collaboration.invited`. Sending the WhatsApp or SMS invitation is done by the owner's phone.
- `Collaboration.role:enum`: one of OWNER, MANAGER, SELLER, DRIVER
- `Collaboration.status:enum`: one of INVITED, ACTIVE, REVOKED
- `C-05`: `Collaboration` is unique per (`person_id`, `organization_id`); an ACTIVE collaboration needs a registered person; every organization has exactly one ACTIVE OWNER at the end of each transaction; `is_public_contact` needs ACTIVE status and a person with an active number.

## Acceptance criteria
```gherkin
Scenario: AC-1 Invite a guest
  When the owner posts a new number and role SELLER
  Then the response is 201, a guest exists for the number and the collaboration is INVITED
Scenario: AC-2 Invite a registered person
  Then the invitee has one unread notification `collaboration.invited`
Scenario: AC-3 Re-invite after revocation
  Given a REVOKED collaboration for the number
  When the owner invites it again with role DRIVER
  Then the same row is INVITED with role DRIVER
Scenario Outline: AC-4 Refusals
  When the request has <problem>
  Then the response is <status> and nothing is stored
  Examples:
    | problem                                    | status                |
    | role OWNER                                 | 400 VALIDATION_ERROR  |
    | an ACTIVE or INVITED member's number       | 409 ALREADY_MEMBER    |
    | a landline                                 | 400 VALIDATION_ERROR  |
    | a SUSPENDED or CLOSED organization         | 409 ORGANIZATION_NOT_ACTIVE |
Scenario: AC-5 Repeat
  When the same body is posted twice
  Then one collaboration exists and both answers are equal
```

## Abuse cases
```gherkin
Scenario: AB-1 Non-owner invites (vertical)
  When a MANAGER, SELLER or DRIVER posts an invitation
  Then the response is 403 and nothing is stored
Scenario: AB-2 Invitation into another business (horizontal)
  When a member of A posts to business B
  Then the response is 404
Scenario: AB-3 Making an OWNER or an ACTIVE member by body (mass assignment)
  When the body contains status ACTIVE or role OWNER
  Then the response is 400
```

## Implementation
- Create: `tests/integration/organization/invite.test.ts`
- Modify: `src/modules/organization/organization.routes.ts`, `src/modules/organization/organization.schemas.ts`, `src/modules/organization/organization.service.ts`, `src/modules/organization/organization.repository.ts`, `src/modules/organization/organization.openapi.ts`
- Pattern: `src/modules/organization/organization.routes.ts`
- Signatures:
  - `inviteCollaborator(actor: Actor, input: InviteInput): Promise<CollaborationView>`
- Types:
  - `InviteInput = { id: string; phone_number: string; role: 'MANAGER' | 'SELLER' | 'DRIVER' }`
- Errors: `ALREADY_MEMBER` 409, `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404, `ORGANIZATION_NOT_ACTIVE` 409
- Dependencies: `express`, `zod`

## Security
- v5.0.0-8.2.1: route behind `loadActor` and `requireAbility('manage', 'Collaboration')`.
- v5.0.0-15.3.3: strict schema with three fields.
- v5.0.0-2.4.1: the person lookup limit of PER applies to the number.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| invite guest | integration | AC-1, C-05 | 201, guest, INVITED |
| notified | integration | AC-2 | notification row |
| re-invite | integration | AC-3, Collaboration.status:enum | same row INVITED, new role |
| refusals | integration | AC-4, Collaboration.role:enum | each Examples row → status |
| repeat | integration | AC-5 | one row, equal answers |
| non-owner | security | AB-1, WSTG-ATHZ-03 | 403 |
| other business | security | AB-2, WSTG-ATHZ-04 | 404 |
| mass assignment | security | AB-3, CWE-915 | 400 |

Command: `npx vitest run tests/integration/organization/invite.test.ts`

## Out of scope
- Accepting the invitation (ORG-008). Sending the message (client).
