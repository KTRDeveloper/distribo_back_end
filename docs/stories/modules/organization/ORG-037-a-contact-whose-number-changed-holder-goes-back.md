---
id: ORG-037
title: A contact whose number changed holder goes back to pending
module: organization
kind: feature
rev: 1
amends: []
size: S
risk: high
depends_on: [ORG-024, PER-014, NTF-002]
read_first: [src/modules/organization/organization-contact.repository.ts, src/modules/person/phone-released.ts]
design_refs: [identite-et-organisation/organizationcontact, identite-et-organisation/person]
constraints: [CM-36, C-43]
asvs: [v5.0.0-8.2.1, v5.0.0-16.2.5]
---

# ORG-037 — A contact whose number changed holder goes back to pending

## Story
As an owner, I want a contact whose number now belongs to someone else to stop being shown so that nobody takes that person for my business.

## Context
- Exists: the contact table and repository (ORG-021, ORG-024); `registerPhoneReleasedHandler` (PER-014), fired by AUTH (recycled-number claim) and ADM (`RELEASE_PHONE`); `notify` and `recipientLanguage` (NTF).
- Adds `src/modules/organization/phone-released.handler.ts`: `handlePhoneReleased(event, tx)` and its registration when the file loads; `src/app.ts` imports the file next to the `.openapi.js` imports.
- The handler sets `verified_at` and `verification_method` to null on every live PHONE contact, of any business, whose `value` is the number and that is verified (C-43: both empty together). Value, slot and the rest stay. The owner's own change of number fires nothing: nothing changes by itself.
- For each business touched, the ACTIVE owner gets one notification `organization.contacts_review`, related `{type: 'organization', id}`, in their language. French: "Un de vos numeros de contact public a change de titulaire. Il n'est plus affiche. Verifiez vos contacts dans les reglages." English: "One of your public contact numbers has a new holder. It is no longer shown. Check your contacts in the settings." No number in the text. A business with no ACTIVE owner is still downgraded; nobody is notified.
- All writes run in the transaction of the release: a failure rolls the release back too (PER-014). Nothing is logged about the number.
- `CM-36`: When a phone number changes holder (recycled number), every `OrganizationContact` with that number goes back to pending (`verified_at` and `verification_method` cleared), is no longer published, and the owner is notified; when the owner changes their own number, nothing changes by itself.
- `C-43`: `OrganizationContact`: `slot` is set exactly when `kind = PHONE` and is between 1 and 3, unique per (`organization_id`, `slot`); at most one EMAIL per organization (partial unique index); unique per (`organization_id`, `value`); a PHONE `value` is in E.164 format; `verification_method` is set exactly when `verified_at` is set; all these uniqueness rules ignore deleted rows.

## Acceptance criteria
```gherkin
Scenario: AC-1 A verified contact goes back to pending
  Given a verified PHONE contact holding +237677123456
  When the number is released
  Then `verified_at` and `verification_method` are empty and `value` and `slot` are unchanged
Scenario Outline: AC-2 Only matching contacts change
  Given a contact <case>
  When +237677123456 is released
  Then the contact is left as it was
  Examples:
    | case                                  |
    | holding another number                |
    | of kind EMAIL                         |
    | already pending                       |
    | deleted                               |
Scenario: AC-3 Each owner is told once
  Given two businesses hold the number as a verified contact
  When the number is released
  Then each ACTIVE owner has one unread `organization.contacts_review` notification in their language, and no one else has one
Scenario: AC-4 The handler is registered at startup
  Given the application is loaded
  When `firePhoneReleased` is called inside a transaction
  Then the contacts of that number go back to pending
Scenario: AC-5 The release and the downgrade stand or fall together
  Given the notification fails
  When the release transaction is rolled back
  Then the contact is still verified
```

## Abuse cases
```gherkin
Scenario: AB-1 A recycled number keeps speaking for a business (spoofing, T8)
  Given a number released to a new holder was a verified contact of a business
  When the release is done
  Then the contact is pending, so the business is no longer published under that number
```

## Implementation
- Create: `src/modules/organization/phone-released.handler.ts`, `tests/integration/organization/contact-phone-released.test.ts`
- Modify: `src/modules/organization/organization-contact.repository.ts`, `src/app.ts`
- Pattern: `src/middleware/load-actor.ts`
- Signatures:
  - `handlePhoneReleased(event: { phoneNumber: string }, tx: Prisma.TransactionClient): Promise<void>`
  - `clearVerificationByNumber(tx: Prisma.TransactionClient, phoneNumber: string): Promise<string[]>`
- Dependencies: none added

## Security
- v5.0.0-8.2.1: the server decides the downgrade from the release, never a request.
- v5.0.0-16.2.5: neither the log nor the notification carries the number.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| downgrade | integration | AC-1, CM-36, C-43 | verified contact → both fields empty, value and slot kept |
| untouched rows | integration | AC-2 | each Examples row → unchanged |
| notifications | integration | AC-3 | two owners, one notification each, FR or EN; nobody else |
| registered | integration | AC-4 | firePhoneReleased in a transaction → contacts pending |
| atomic | integration | AC-5 | notify throws → rollback → contact still verified |
| recycled number | security | AB-1, CWE-290 | released number → contact pending |

Command: `npx vitest run tests/integration/organization/contact-phone-released.test.ts tests/integration/person/phone-released.test.ts`

## Out of scope
- The owner changing their own number: the application asks whether to keep the old one as a contact (phone screen); the server does nothing by itself.
