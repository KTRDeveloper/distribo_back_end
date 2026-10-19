# ADR-004: Where the design v16 work goes, and two new modules (images, billing)

Status: accepted

## Context
The backlog was built from design v10 (208 stories, all done). Design v16 is the same design, renamed and evolved: 176 changes, six new entities, and about a third of the elements touched. Three of the changes have no clear owner among the 14 modules of ADR-001:
- Images (v13): S3-compatible storage, re-encoded photos, a registry of copied photos (`ImageCopy`), server-only `*_key` fields on Person, Organization, Product and ProductVariant, and a nightly orphan cleanup. Four existing modules would each own a piece of it.
- Subscriptions (v15): `Subscription` is rewritten, and three entities are new: `SubscriptionPayment`, `SubscriptionReceipt` and `SubscriptionEvent`. They bring a payment on a website through an aggregator, a grace period, a pause, receipts with gap-free numbers, and a nightly reconciliation. In v10 the `organization` module owned `Subscription`; the new flows would double its size and mix payment data with business data.
- The catalogue (v12): `ProductVariant` and the contacts of an organization (`OrganizationContact`) are new entities, but each has an obvious owner.

The user decided on 2026-10-18: put the work in the existing modules, and create a module only for what fits none ("il faut placer le travail dans les modules existants; lorsque ça ne rentre dans aucun module, en créer un pour cela").

## Decision
1. Existing modules first:
   - `ProductVariant` belongs to the module `catalog` (CAT), with `Product`.
   - `OrganizationContact` belongs to the module `organization` (ORG), with `Organization`.
   - All other changes (person, auth, order, finance, delivery, admin, access, notification, sync, privacy, foundation) are stories in the module that already owns the element.
2. Two new modules, because their entities fit no existing module:
   - `images` (prefix IMG) owns `ImageCopy`. It holds the storage port with its fake adapter, the upload, replace and remove gestures for the logo, the avatar and product or variant photos, the "Reprendre une photo" copy, and the nightly orphan cleanup. The `*_key` columns stay in the tables of their own modules; those modules add them in their own migration stories.
   - `billing` (prefix BIL) owns `Subscription` (moved from `organization`), `SubscriptionPayment`, `SubscriptionReceipt` and `SubscriptionEvent`. It holds the payment flow behind an aggregator port with a fake adapter, the plans and price grid settings, scheduling and upgrade, grace and pause, reminders, receipts and credit notes, the event log, the nightly reconciliation, and the admin gestures `GIFT_DAYS`, `RECORD_PAYMENT` and `REFUND_PAYMENT`.
3. Module order: foundation, person, notification, access, auth, organization, relationship, catalog, order, finance, delivery, admin, **images**, **billing**, sync, privacy. `sync` and `privacy` depend on both new modules.
4. No cycle: a cross-module effect that would point backwards is a `kind: change` story in the later module, as in ADR-001.
   - The `OtpChallenge.organization_contact_id` column, its foreign key and its CHECK are added by an `organization` migration story. The new purposes `ORG_CONTACT_VERIFICATION` and `ACCESS_RESTORE` are added by an `auth` migration story.
   - `Subscription.payment_id` and its foreign key are added by `billing`.
   - When a phone number is released, `person` calls a hook that `organization` registers, so contacts using that number go back to pending without `person` importing `organization`.
   - The helpers that build image keys and URLs, and the environment variable for the public base URL, are a `foundation` story, so every module can use them without importing `images`.
5. Subscription stories that shipped in `organization` (ORG-012, ORG-013, ORG-014) are not edited. `billing` removes or replaces them with stories that `amend` them, and `organization` gets change stories for closing, reopening and transferring a business.

## Consequences
- 16 modules instead of 14. ADR-001 stays valid for the 14 original ones; this record adds two and moves `Subscription`.
- About 100 new stories, mostly change, migration and removal stories, because every old story is done.
- `images` and `billing` stay small enough for the module health limits (8 entities, 25 active stories) if the photo upload stories are split by owner (logo, avatar, product).
- Real S3 and image re-encoding libraries are not in the dependency allowlist: see ADR-005. Until it is accepted, every story uses a port with a fake adapter.
- Moving `Subscription` changes the module that owns its table, not its code: the repository file path under `src/modules/` is decided by the first `billing` story.
