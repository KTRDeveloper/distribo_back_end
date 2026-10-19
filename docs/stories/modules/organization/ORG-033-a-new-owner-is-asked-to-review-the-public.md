---
id: ORG-033
title: A new owner is asked to review the public contacts
module: organization
kind: change
rev: 1
amends: [ORG-015]
size: S
risk: medium
depends_on: [ORG-015, ORG-024, NTF-002]
read_first: [src/modules/organization/organization.service.ts, src/modules/organization/organization-contact.repository.ts]
design_refs: [identite-et-organisation/collaboration, identite-et-organisation/organizationcontact]
constraints: [CM-37]
asvs: [v5.0.0-8.2.1, v5.0.0-16.2.5]
---

# ORG-033 — A new owner is asked to review the public contacts

## Story
As an owner, I want a business I just received to ask me to review its public contacts so that the business is not found under the number of someone who left.

## Context
- Exists: `transferOwnership` (ORG-015) with its single transaction and the `ownership.received` notice; the contact repository (ORG-024); `toPublicPerson` (PER-005); `notify` and `recipientLanguage` (NTF).
- Adds, after the existing notice and in the same transaction: when the business has at least one live contact (not deleted), the new owner gets one notification `organization.contacts_review`, related `{type: 'organization', id}`, in their language. Contacts are never changed by a transfer.
- French: "Les contacts publics de {name} restent en place. Revoyez-les dans les reglages." English: "The public contacts of {name} stay in place. Review them in the settings."
- Mention: when a live PHONE contact has `value` equal to the former owner's current number (`toPublicPerson(...).phone_number`), the text adds, in French, " Le contact {slot} est le numero de l'ancien proprietaire. Le garder ?" and in English " Contact {slot} is the former owner's number. Keep it?". The slot and the words "former owner" replace the number and the name of the design, so the stored notice holds no personal data (open question).
- The former owner's email is never read, compared or written: only PHONE contacts can be mentioned.
- Adds `listLiveContacts(tx, organizationId): Promise<{ kind; slot; value }[]>` to `organization-contact.repository.ts`. The former owner is read with the existing `findCollaborationWithPerson`.
- `CM-37`: Ownership transfer: the public contacts stay in place; the new owner is invited to review them (`organization.contacts_review`), with a mention on a contact that is the former owner's number, never on his email, which is private (design lines 212, 1105)

## Acceptance criteria
```gherkin
Scenario: AC-1 The new owner is asked to review
  Given a business with two live contacts
  When the owner transfers it to an ACTIVE manager
  Then the new owner has one unread `organization.contacts_review` related to the organization, besides `ownership.received`
  And the text is in their language and holds the business name
Scenario: AC-2 No contact, no notice
  Given a business with no live contact, or only deleted ones
  When the ownership is transferred
  Then no `organization.contacts_review` exists
Scenario: AC-3 The former owner's number is mentioned
  Given the live PHONE contact in slot 2 holds the former owner's number
  When the ownership is transferred
  Then the text ends with the mention naming contact 2
  And it holds neither that number nor the former owner's name
Scenario Outline: AC-4 Other contacts get no mention
  Given the business has <case>
  When the ownership is transferred
  Then the notice has no mention
  Examples:
    | case                                                          |
    | a PHONE contact with another number                           |
    | an EMAIL contact equal to the former owner's email            |
    | a deleted contact with the former owner's number              |
Scenario: AC-5 Contacts and the transfer stay as they are
  When the ownership is transferred
  Then every contact keeps its value, slot and verification
  And a failing notification rolls the transfer back
```

## Abuse cases
```gherkin
Scenario: AB-1 The private email leaks to the new owner (disclosure)
  Given an EMAIL contact equals the former owner's email
  When the ownership is transferred
  Then the notice does not contain that address, nor "@"
```

## Implementation
- Create: `tests/integration/organization/transfer-contacts-review.test.ts`
- Modify: `src/modules/organization/organization.service.ts`, `src/modules/organization/organization-contact.repository.ts`
- Pattern: `src/middleware/load-actor.ts`
- Signatures:
  - `listLiveContacts(tx: Prisma.TransactionClient, organizationId: string): Promise<{ kind: 'PHONE' | 'EMAIL'; slot: number | null; value: string }[]>`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the organization comes from the loaded actor; contacts of another business are never read.
- v5.0.0-16.2.5: the notice carries no number, name or address.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| notice sent | integration | AC-1, CM-37 | two contacts → one notice, FR and EN, related organization |
| none | integration | AC-2 | no contact or deleted ones → none |
| mention | integration | AC-3 | slot 2 equals the former number → mention, no digits, no name |
| no mention | integration | AC-4 | each Examples row → no mention |
| unchanged and atomic | integration | AC-5 | contacts as before; notify fails → transfer rolled back |
| private email | security | AB-1, CWE-200 | EMAIL equals his email → no address, no "@" |

Command: `npx vitest run tests/integration/organization/transfer-contacts-review.test.ts tests/integration/organization/transfer.test.ts`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/organization/transfer.test.ts | counts the notifications after a transfer on a business with no public contact | unchanged: the review notice is sent only when a live contact exists |

## Out of scope
- Keeping or removing a contact: ORG-025 to ORG-027.
- The notice for a recycled number: ORG-037.
