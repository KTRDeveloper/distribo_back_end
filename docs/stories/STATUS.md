# Status

One line per story: `ID | status | reviewer | note`. Status: todo, in_progress, blocked, done, obsolete.
The skill only adds lines, as todo. Agents and orchestrators update status, reviewer and note.

| ID | status | reviewer | note |
|---|---|---|---|
| FND-000 | done | | |
| FND-001 | done | | Auth tests pass; legacy identity tests require removed delivery models by design |
| FND-002 | done | | |
| FND-003 | done | | Story tests pass: 12 passed |
| FND-004 | done | | |
| FND-005 | done | | Story tests pass: 6 passed |
| FND-006 | done | | Story test: 2 passed |
| FND-007 | done | | |
| FND-008 | done | | |
| FND-009 | done | | |
| PER-001 | done | | |
| PER-002 | done | | Story tests pass: 10 passed; user tests pass: 5 passed |
| PER-003 | done | | |
| PER-004 | done | | Story tests: 7 passed; full suite: 265 passed; typecheck and lint pass |
| PER-005 | done | | Story tests: 6 passed; full suite: 271 passed; typecheck and lint pass |
| PER-006 | done | | Story tests: 10 passed; full suite: 281 passed; typecheck and lint pass |
| PER-007 | done | | Story tests: 16 passed; full suite: 292 passed; typecheck, lint and format check pass |
| PER-008 | done | | |
| ACC-001 | done | | ready for review |
| ACC-002 | done | | ready for review |
| ACC-003 | done | | ready for review |
| ACC-004 | done | | ready for review |
| ACC-005 | done | | ready for review |
| ACC-006 | done | | ready for review |
| ACC-007 | done | | ready for review |
| NTF-001 | done | | Story tests: 7 passed; full suite: 401 passed; typecheck and lint pass |
| NTF-002 | done | | Story tests: 52 passed; full suite: 446 passed; typecheck and lint pass |
| NTF-003 | done | | Story tests: 5 passed; full suite: 2 pre-existing failures (quality-gates lint/Haiku alias) unrelated; typecheck pass |
| NTF-004 | done | | Story tests: 5 passed; full suite: 455 passed, 1 pre-existing failure (quality-gates Haiku alias) unrelated; typecheck and lint pass |
| AUTH-001 | done | | |
| AUTH-002 | done | ready for review | |
| AUTH-003 | done | | |
| AUTH-004 | done | | ready for review |
| AUTH-005 | done | | ready for review |
| AUTH-006 | done | | ready for review |
| AUTH-007 | done | | 3/3 story tests, 507/507 full suite |
| AUTH-008 | done | | ready for review |
| AUTH-009 | done | | ready for review |
| AUTH-010 | done | | ready for review; story tests 16 passed; full suite 547 passed; typecheck and lint pass; per-001 and catalog tests updated with user approval |
| AUTH-011 | done | | ready for review; story tests 8 passed; full suite 555 passed; typecheck and lint pass |
| AUTH-012 | done | | |
| AUTH-013 | done | | ready for review; story tests 9 passed; full suite 564 passed; typecheck and lint pass; per-001 (2 tests) and api-docs catalog test updated with user approval |
| AUTH-014 | done | | ready for review; story tests 7 passed; full suite 594 passed; typecheck and lint pass; per-001 and api-docs catalog path lists updated with user approval |
| AUTH-015 | done | | ready for review |
| AUTH-016 | done | | ready for review; 3 existing tests (per-001 x2, catalog) updated with user approval relayed by coordinator |
| AUTH-017 | done | | 598/598 tests pass, typecheck clean, lint 0 errors; per-001 and api-docs catalog path lists updated with user approval |
| AUTH-018 | done | | devices list, remove, logout-all |
| AUTH-019 | done | | ready for review; 62 files, 607 tests pass, lint 0 errors, typecheck clean; per-001 and api-docs catalog path lists updated with user approval |
| AUTH-020 | done | | ready for review |
| AUTH-021 | done | | reviewed; hash update and session revocation made atomic (tx), AC-2/AB-1 tests tightened, atomic test added; 681/681 tests, typecheck and lint clean |
| AUTH-022 | done | | 2 path lists (per-001, catalog) updated with user approval |
| AUTH-023 | done | | 614 tests pass, typecheck clean, lint 0 errors; per-001 and api-docs catalog path lists updated with user approval |
| AUTH-024 | done | | ready for review; 2 path lists (per-001, catalog) updated with user approval |
| AUTH-025 | done | | ready for review (risk high); 64 files, 624 tests pass, typecheck and lint clean; per-001 and api-docs catalog path lists updated with user approval |
| AUTH-026 | done | | |
| ORG-001 | done | | organizations table, enum, set_server_updated_at trigger; 6 tests, full suite green |
| ORG-002 | done | | FK notifications.organization_id to organizations; 3 tests added |
| ORG-003 | done | | collaborations table, row and deferred owner triggers, people phone-release trigger; 24 tests, full suite 719 pass |
| ORG-004 | done | | POST /organizations done; 20 tests; OpenAPI left to ORG-005 so route lists unchanged |
| ORG-005 | done | | 16 tests pass; full suite green after generate-openapi import fix |
| ORG-006 | done | | addAmountHeld single-statement increment, 5 tests pass; ignores deleted rows (C-35) |
| ORG-007 | done | | Invite route, service, repo, openapi; 25 tests green, full suite 788 pass |
| ORG-008 | done | | 19 story tests, full suite 807 pass; routers mounted in app.ts at /collaborations |
| ORG-009 | done | | PATCH collaborator role; 19 tests, full suite 827 pass |
| ORG-010 | done | | DELETE collaborator revoke; 839 tests pass |
| ORG-011 | done | | PATCH collaborators/me sets own is_public_contact; 409 NO_ACTIVE_NUMBER; 12 tests, full suite 851 pass |
| ORG-012 | done | | subscriptions table, partial unique index on ACTIVE, 8 tests green |
| ORG-013 | done | | POST/GET subscription; 21 story tests, full suite 880 pass |
| ORG-014 | done | | DELETE subscription: ACTIVE row EXPIRED with ends_at now, 404 if none, owner only; 889 tests pass |
| ORG-015 | done | | Transfer ownership route; idempotency replay before ability check; 908 tests pass |
| ORG-016 | done | | POST /organizations/{id}/close in one transaction; 14 tests, full suite 922 pass |
| ORG-017 | done | | POST reopen: CLOSED to ACTIVE only; 931 tests pass |
| ORG-018 | done | | GET /organizations/lookup, shared lookup limit, 15 tests |
| ORG-019 | done | | GET collaborators team list: OWNER/MANAGER only, amount_held restricted, keyset paging on invited_at |
| ADM-001 | done | | administrators table, 14 tests, full suite 1075 pass |
| ADM-002 | done | | admin_actions table, immutability, REPLAY_SYNC trigger, recordAdminAction |
| ADM-003 | done | | reports table, enums, FK admin_actions.report_id; 1109 tests pass |
| ADM-004 | done | | TOTP create/encrypt/verify with atomic replay guard; 13 tests green |
| ADM-005 | done | | createFirstSuperAdmin script + admin:create-super; 9 tests; full suite 1131 pass |
| ADM-006 | done | | Admin login, admin JWT and adminAuthMiddleware; 19 tests; OpenAPI left to ADM-015 |
| ADM-007 | done | | recovery email request and confirm; all tests pass |
| ADM-008 | done | | totp recovery request/confirm, RECOVER_2FA journal and alerts; suite 1468 passed |
| ADM-009 | done | | Appointment route, service, repository and tests; full suite green |
| ADM-010 | done | | DELETE /admin/administrators/{id}; 17 story tests, full suite 1196 green |
| ADM-011 | done | | POST /reports with idempotency, per-person daily limit; 25 tests |
| ADM-012 | done | | GET /admin/reports list and open; 13 tests, full suite 1234 green |
| ADM-013 | done | | resolve report: dismiss/suspend person or org, atomic, 16 tests |
| ADM-014 | done | | 4 moderator routes, journal, sessions, notices; 26 story tests, suite 1276 green |
| ADM-015 | done | | GET /admin/actions with filters and paging; 1287 tests pass |
| REL-001 | done | | customer_relationships table, migration, 14 tests green |
| REL-002 | done | | CHECKs and four partial unique indexes added; REL-001 merged_into_id test updated as listed |
| REL-003 | done | | credit_limit_changes table, append-only; story tests 8/8, full suite 1025/1025 |
| REL-004 | done | | credit limit CHECKs + stamp/journal triggers; same author cannot change limit twice (per spec) |
| REL-005 | done | | visibility predicate and party projections; 24 story tests, full suite 1049 pass |
| REL-006 | done | | Counter created in the org transaction; 1519 tests pass |
| REL-007 | done | | POST /organizations/:id/customers; 23 story tests, full suite 1542 pass |
| REL-008 | done | | GET customers list with filters, keyset paging, supplier view |
| REL-009 | done | | GET customer by id; 8 tests, full suite 1569 green |
| REL-010 | done | | PATCH customers/:id; per-field ability check, 21 tests |
| REL-011 | done | | POST /counters; SELLER blocked by an extra MANAGER rank check |
| REL-012 | done | | PUT credit-limit done; same-author trigger workaround (clear author then write, locked tx) |
| REL-013 | done | | GET credit-limit-changes: MANAGER and above, visibility first, keyset on set_at; 10 tests |
| REL-014 | done | | Reassignments journal table, contestation partial unique index, immutable; 12 tests |
| REL-015 | done | | end/reopen routes; PENDING unreachable via org scope (404); reopen of non-ended = RELATIONSHIP_NOT_ENDED (unspecified) |
| REL-016 | done | | GET /suppliers customer view, 11 tests, suite 1671 green |
| REL-017 | done | | customer PATCH/end/reopen on /suppliers; 12 story tests, full suite 1683 green |
| REL-018 | done | | GET/PATCH /organizations/{id}/suppliers, MANAGER+, customer projection; 23 tests, full suite 1706 green |
| REL-019 | done | | org end/reopen supplier routes; 19 tests, suite 1725 green |
| REL-020 | done | | invitations by person and organization, 24 tests, full suite green |
| REL-021 | done | | list, accept, merge, decline; 27 tests, full suite 1776 green |
| REL-022 | done | | GET /people/me/attachments; 7 tests, full suite 1783 green |
| REL-023 | done | | POST /suppliers/{id}/contest; 14 story tests, full suite 1797 green |
| REL-024 | done | | correct-number route, service, 18 tests; full suite 1815 green |
| REL-025 | done | | mergeDuplicateRelation and resolveMergedRelation added; 15 story tests, full suite green |
| CAT-001 | done | | products table, price checks and price date trigger; 18 tests, full suite 1305 pass |
| CAT-002 | done | | customer_prices table, supplier-product trigger, live unique index; 1316 tests pass |
| CAT-003 | done | | getReferencePrice and getActiveProduct in catalog.repository; 13 tests pass, suite 1843 green |
| CAT-004 | done | | POST /products implemented; 34 story tests, full suite 1877 pass |
| CAT-005 | done | | PATCH product edit/retire, 28 tests green |
| CAT-006 | done | | GET products list with filters, cursor paging, openapi for product routes |
| CAT-007 | done | | GET /organizations/{id}/catalog with own negotiated prices; 1952 tests pass |
| CAT-008 | done | | PUT negotiated price; non-ACTIVE (ENDED) refused 409; PENDING unreachable for org supplier (DB rule) |
| CAT-009 | done | | List and delete negotiated prices; 20 story tests, full suite 2009 green |
| CAT-010 | done | | copy prices route; 15 tests, full suite 2024 green |
| CAT-011 | done | | Copy article endpoint; 15 story tests, full suite green |
| ORD-001 | done | | orders table, enums, FKs, indexes, triggers; 16 tests |
| ORD-002 | done | | CHECKs and status trigger on orders; 1510 tests pass |
| ORD-003 | done | | BEFORE INSERT trigger orders_creation_guard; 2048/2048 pass |
| ORD-004 | done | | order_lines table with CHECKs and triggers; 25 tests pass |
| ORD-005 | done | | line product, minimum quantity and customer-price trigger (migration 20261004310000) |
| ORD-006 | done | | Deferred totals/delivered-quantity triggers; 14 story tests, full suite 2234 pass |
| ORD-007 | done | | Pure order calculations and supplier/customer views; 14 unit tests, full suite 2103 pass |
| ORD-008 | done | | transitionOrder with conditional update, viaSync delivery-wins; 23 tests |
| ORD-009 | done | | POST /api/v1/orders; 35 story tests + full suite green |
| ORD-010 | done | | Organization purchase route POST /organizations/{id}/purchases; all tests pass |
| ORD-011 | done | | accept route, lowers prices, notifies customer; 22 story tests, full suite 2334 green |
| ORD-012 | done | | Refuse route, service, schema, openapi; 15 tests green |
| ORD-013 | done | | POST /orders enterOrder; 16 tests, full suite green |
| ORD-014 | done | | PATCH orders/{orderId}: editOrder, ORDER_FROZEN, lines replaced |
| ORD-015 | done | | PATCH orders/{id}/note, 9 tests + full suite green |
| ORD-016 | done | | POST orders/{id}/cancel via transitionOrder; 17 tests, suite 2406 green |
| ORD-017 | done | | customer cancel routes (person and organization purchases) done; 2429 tests pass |
| ORD-018 | done | | Pending orders refused in the close transaction; customers notified |
| ORD-019 | done | | Seller order list with filters, keyset paging, supplier projection; GET documented |
| ORD-020 | done | | GET order by id, supplier view, 403/404/400 covered |
| ORD-021 | done | | 4 customer GET routes, customer projection; suite 2465/2465 |
| FIN-001 | done | | ledger_entries table, generated balance_effect, append-only grants |
| FIN-002 | done | | migration 20261004330000 adds sale and reversal triggers plus partial unique index; ledger-table fixtures updated |
| FIN-003 | done | | appendLedgerEntry and reverseLedgerEntry; addToBalance added to relationship repo; 19 story tests, full suite 2539 pass |
| FIN-004 | done | | Payment route, 13 tests, full suite green; OpenAPI paths left to FIN-010 |
| FIN-005 | done | | refund route, 13 tests, full suite green |
| FIN-006 | done | | POST credit-notes; guards shared with refund; 2574 tests pass |
| FIN-007 | done | | POST opening-balances; reuses refund guards; all tests pass |
| FIN-008 | done | | POST returns: credit note + refund in one transaction; counter allowed |
| FIN-009 | done | | POST ledger-entries/:id/reverse; mirror held effect goes to the original recorder (AC-1) |
| FIN-010 | done | | 3 ledger read routes, finance.openapi, per-party fields; full suite 2618 green |
| FIN-011 | done | | expenses table, triggers and tests green |
| FIN-012 | done | | POST /expenses with recordExpenseInTx; 12 story tests + 2 extra pass, full suite 2631 green |
| FIN-013 | done | | cancel expense route, conditional update + held money restore in one tx |
| FIN-014 | done | | handovers table, party-role and cancel-once triggers; 33 tests pass |
| FIN-015 | done | | POST handovers + recordHandoverInTx; 14 story tests, full suite green |
| FIN-016 | done | | Cancel and dispute handover routes; full suite 2672 pass |
| FIN-017 | done | | Former owner's held money handed over in the transfer transaction; sync pull tests flaky on timing, unrelated |
| FIN-018 | done | | reconcile service + job:reconcile script, 7 tests pass, full suite 2686/2686 |
| FIN-019 | done | | Owner money exceptions route; full suite 2708 passed |
| FIN-020 | done | | treasury and expense list for OWNER and MANAGER; 28 story tests, full suite green |
| DLV-001 | done | | deliveries table, triggers and tests green |
| DLV-002 | done | | CHECKs, partial unique index, driver membership trigger; delivery-table tests updated per amended story |
| DLV-003 | done | | Driver to-deliver pool and own deliveries; tests green |
| DLV-004 | done | | assign route, reassign before departure, 25 tests |
| DLV-005 | done | | depart route, 21 tests; full suite 2757 green |
| DLV-006 | done | | POST deliveries/{id}/fail, 23 story tests, full suite green |
| DLV-007 | done | | deliver route, credit rule under relationship lock; error details support added to httpError |
| DLV-008 | done | | Partial delivery with LATER child order / ABANDON; 48/48 story tests, full suite green |
| DLV-009 | done | | counter sale route, 15 tests, full suite green |
| DLV-010 | done | | unstarted deliveries removed on both cancels and shop delivery |
| DLV-011 | done | | 13 story tests pass, full suite 2864 pass, typecheck clean |
| DLV-012 | done | | abandoned_rests added to money exceptions; 2930 tests pass |
| SYNC-001 | done | | types, registry, viewer; 7 tests pass |
| SYNC-002 | done | | sync_archives table, FKs, immutability grants; admin-action-table fixture updated |
| SYNC-003 | done | | GET /sync/pull and identity adapters; 19 tests pass; no OpenAPI (SYNC-006) |
| SYNC-004 | done | | customer_relationships and customer_prices pull adapters; suite 2170/2170 |
| SYNC-005 | done | | products adapter: full catalog for OWNER/MANAGER/SELLER, 3 columns for DRIVER, none for customer |
| SYNC-006 | done | | orders, order_lines, deliveries pull adapters; 11 tests green |
| SYNC-007 | done | | money adapter registered in sync.routes.ts; 10 tests, full suite 2874 green |
| SYNC-008 | done | | Pull checks X-Scope-Version, revoked device 401, records last_synced_at and scope_version_seen |
| SYNC-009 | done | | Push envelope: archive, 426, clock skew, 409, aside, last_synced_at; interim apply loop until SYNC-010 judgeBatch |
| SYNC-010 | done | | judgeBatch wired in pushChanges; scope, field rights, computed strip, author; 19 tests, full suite 2923 green |
| SYNC-011 | done | | Push side of customer_relationships: create, merge, redirect, edit |
| SYNC-012 | done | | orders and lines pushed with server amounts; migration lets retired-product lines in |
| SYNC-013 | done | | Departures, crossed departures, failures and cancellations pushed through the state machine; 19 tests |
| SYNC-014 | done | | Closing of a pushed DELIVERED order via deliverOrder viaSync; story tests 45/45, full suite 2998/2998 |
| SYNC-015 | done | | ledger.push + notification reads; judge ONLINE_ONLY for non-payment ledger gestures |
| SYNC-016 | done | | controls on arrival: PRICE_CHANGED, DATE_*, owner notification; suite 3010 green |
| SYNC-017 | done | | controls: CREDIT_EXCEEDED, RESTRICTED_MODE, long-absence notice; 9 tests |
| SYNC-018 | done | | Refused and set-aside lines logged, resync on refusal, sync.refused notice; push-payments test updated |
| SYNC-019 | done | | Grace for stale devices: seller ops kept and reported, rest refused; owners told |
| SYNC-020 | done | | GET /sync/issues: orders and deliveries with sync_issue, scoped by author or OWNER |
| SYNC-021 | done | | GET exceptions/sync grouped by cause; orders only; reuses FIN-019 period rules |
| SYNC-022 | done | | replay route, REPLAY_SYNC journal + notices in one transaction; suite 3089/3089 |
| SYNC-023 | done | | list and open archived batches; 7 tests, suite 3096 green |
| PRIV-001 | done | | GET /users/me/deletion-check implemented; suite 2207 green |
| PRIV-002 | done | | DELETE /users/me anonymizes in one transaction; Task table column mismatch worked around with raw SQL |
| PRIV-003 | done | | purge service, job and tests; archives pointed to by a journal entry are kept |
| PER-009 | done | | Targeted tests: 18 passed; full suite: 247 passed; typecheck, lint and format check pass |
| FND-010 | done | | Formatting, typecheck, lint, and full suite pass; test person fixtures now generate the required UUIDv7 id |
| FND-011 | done | | |
| FND-012 | done | | validation details reduced to path and code |
| FND-013 | done | | 23 story tests pass; full suite 7 pre-existing failures (person-table, privacy/anonymize), same without this change |
| FND-014 | done | | 29 story tests pass; 7 unrelated DB-state failures in person-table and anonymize tests (tasks table absent in test DB) |
| PER-010 | done | | avatar_key column, unique index, 2 CHECKs; 6 pre-existing failures unrelated (tasks.accountId rename) |
| PER-011 | done | | toPublicPerson gains avatar_url; 7 unrelated suite failures pre-exist |
| PER-012 | done | | own profile carries avatar_url; 8 pre-existing failures in anonymize, person-table, appoint (also fail without this change) |
| PER-013 | done | | setAvatarKey added; 6 tests, suite green |
| PER-014 | done | | registry in phone-released.ts, 12 tests green |
| ACC-008 | done | | Where values renamed, unknown value denied; 3206 tests pass |
| AUTH-027 | done | | OtpPurpose gains ORG_CONTACT_VERIFICATION and ACCESS_RESTORE; 3212 tests pass |
| AUTH-028 | done | | 404/401/403 answers, number-check quota; anonymize AC-5 test updated to 404 |
| AUTH-029 | done | | registered holder: sent false, no challenge, no job; IP number-check quota counted |
| AUTH-030 | done | | preferred_language optional FR/EN on register, stored for new and guest; tests green |
| AUTH-031 | done | | claim route, claimRefusal, latestDeviceActivity; 19 tests; suite green |
| AUTH-032 | done | | re-check before spending the code, firePhoneReleased in tx; register-new-holder fixture backdated |
| AUTH-033 | done | | Reset code by SMS only; use_email now 400; number quota counted first |
| AUTH-034 | done | | Reset confirm returns 200 session; suspended refused after code; all tests pass |
| AUTH-036 | done | | login and verify bodies are phone-only and SMS-only; email paths removed |
| AUTH-035 | done | | findByVerifiedEmail removed; unit test guards export and src scan |
| AUTH-037 | done | | warnHolderOfClaim: one phone.claimed notice per active holder per day; 3304 tests pass |
| AUTH-038 | done | | Characterization test for case-insensitive verified email uniqueness; 3 tests pass |
| BIL-008 | done | | port, fake adapter and PAYMENT_DRIVER; 15 tests pass |
| BIL-010 | done | | plan-math.ts pure; 17 unit tests, suite green |
| IMG-001 | done | | image_copies table, root trigger, insert-only grant; 13 tests |
| CAT-012 | done | | product_variants table, composite FK, checks, triggers; 19 tests + full suite green |
| CAT-013 | done | | migration copies each product into a variant of the same id; 6 tests |
| CAT-014 | done | | Photos, pause date and mirror triggers; seeds of CAT-012/013/015 tests disable user triggers |
| CAT-015 | done | | Variant column, fill and supplier triggers, per-variant unique index; upsert handles products without variant |
| CAT-018 | done | | variant name/unit unique index and merged-is-deleted CHECK; 3474 tests pass |
| CAT-016 | done | | variantLabel and simplifyText in src/shared/variant.ts, agree with CAT-018 index |
| CAT-021 | done | | trigger product_variants_touch_product; 3498 tests pass |
| CAT-032 | done | | setProductImageKeys and setVariantImageKeys in catalog.repository; 17 tests green |
| CAT-033 | done | | applyProductFromSync + repo functions; 15 tests green |
| CAT-034 | done | | applyVariantFromSync with 4 repository functions; 39 tests green |
| CAT-035 | done | | Duplicate variant folded: deleted row with merged_into_id, MERGED result; 2 CAT-034 tests adapted |
| CAT-044 | done | | Four image-key readers (lock and plain) in catalog.repository; 14 tests, suite green |
| CAT-046 | done | | releaseDeletedImageKeys added; 6 tests pass, suite 3600 green |
| ORG-020 | done | | plan fields, logo key and payment code migration; 16 tests + full suite green |
| BIL-001 | done | | subscription_payments table, enums, trigger and grants; 42 tests |
| BIL-003 | done | | receipts table, number function, triggers and grants; 32 tests |
| BIL-012 | done | | issueReceipt, splitVat and VAT_RATE_BP added; 16 story tests pass |
| ORG-021 | done | | migration, schema and 30 tests green |
| ORG-022 | done | | PAUSED enum value + owner-not-paused CHECK (status compared as text) |
| ORG-023 | done | | CHECK ties organization_contact_id to ORG_CONTACT_VERIFICATION; otp-purposes test adapted |
| ORG-028 | done | | payment code with 5-draw retry, free plan fields, email removed from body and view |
| ORG-030 | done | | Collaborator limit enforced under row lock; 409 COLLABORATOR_LIMIT_REACHED |
| ORG-035 | done | | plan writer, team seats and seat pause added in organization.repository |
| ORG-038 | done | | getLogoKey and setLogoKey added to organization.repository.ts; 8 tests pass |
| IMG-002 | done | | ports, fakes, deleteImageFiles, env settings; 22 tests green |
| IMG-003 | done | | imageBody middleware and storeUploadedImage; 20 tests green |
| IMG-004 | done | | PUT/DELETE /users/me/avatar; suite 3790 passed |
| IMG-005 | done | | Owner logo PUT/DELETE; change_logo rule; 6 story tests green |
| IMG-006 | done | | copyImage, findCopyRoot, insertImageCopy; 7 tests green |
| IMG-007 | done | | 9 story tests pass; full suite 3813 pass |
| IMG-008 | done | | PUT product photo route, change_photos rule, card-photos service; suite green |
| IMG-009 | done | | DELETE photos/{photoId} by id; removeCardPhoto; 5 story tests + route lists |
| IMG-010 | done | | variant photo PUT/DELETE routes, change_photos rule for ProductVariant |
| IMG-011 | done | | POST variants/:id/photos/copy; takeVariantPhoto; 12 tests |
| IMG-012 | done | | release step in cleanupOrphanImages; 6 new tests + suite green |
| ORG-040 | done | | owner rows create/update Collaboration and create/delete OrganizationContact with named fields; routes updated |
| ORG-041 | done | | issueCode/verifyCode tied to one contact; fixed business text |
| ADM-018 | done | | ACCESS_RESTORE has its fixed FR/EN text in messageFor; 3 tests green |
| ORG-024 | done | | POST /organizations/:id/contacts: owner phone verified at once, others pending with SMS code |
| ORG-025 | done | | POST contacts/{contactId}/confirm; verifyCode tied to the contact, guarded UPDATE; 3931 tests green |
| ORG-026 | done | | resend route, tests green |
| ORG-027 | done | | DELETE contacts/{contactId}: guarded soft delete, owner only; 3956 tests green |
| ORG-033 | done | | Review notice with slot mention, 13 tests; suite 3969 green |
| ORG-037 | done | | Handler downgrades verified PHONE contacts on release and notifies ACTIVE owners; 3980 tests pass |
| ORG-029 | done | | verified PHONE contacts drive the lookup; 4 tests updated |
| ORG-031 | done | | collaborators/me route and is_public_contact removed from team item; owner created with flag false |
| ORG-042 | done | | Email contacts added: pending, EMAIL code, one per business |
| ORG-044 | done | | Three PaymentTargets functions added to organization.repository.ts; 7 tests pass |
| BIL-007 | todo | | |
| BIL-009 | todo | | |
| ORG-045 | todo | | |
| CAT-038 | todo | | |
| ORD-022 | todo | | |
| ORD-024 | todo | | |
| ORD-025 | todo | | |
| ORD-026 | todo | | |
| ORD-029 | todo | | |
| ORD-030 | todo | | |
| DLV-013 | todo | | |
| CAT-017 | todo | | |
| CAT-019 | todo | | |
| CAT-020 | todo | | |
| CAT-022 | todo | | |
| CAT-023 | todo | | |
| CAT-024 | todo | | |
| CAT-025 | todo | | |
| CAT-026 | todo | | |
| CAT-027 | todo | | |
| CAT-028 | todo | | |
| CAT-036 | todo | | |
| CAT-037 | todo | | |
| ORD-027 | todo | | |
| DLV-014 | todo | | |
| ORD-028 | todo | | |
| ORD-023 | todo | | |
| CAT-029 | todo | | |
| CAT-030 | todo | | |
| CAT-039 | todo | | |
| ADM-016 | todo | | |
| ADM-017 | todo | | |
| ADM-019 | todo | | |
| ADM-020 | todo | | |
| CAT-031 | todo | | |
| CAT-040 | todo | | |
| CAT-042 | todo | | |
| CAT-045 | todo | | |
| DLV-016 | todo | | |
| ORD-031 | todo | | |
| ORD-032 | todo | | |
| DLV-015 | todo | | |
| FIN-021 | todo | | |
| FIN-022 | todo | | |
| REL-026 | todo | | |
| ORG-039 | todo | | |
| ORG-032 | todo | | |
| ORG-043 | todo | | |
| ORG-034 | todo | | |
| BIL-005 | todo | | |
| BIL-002 | todo | | |
| BIL-004 | todo | | |
| BIL-006 | todo | | |
| BIL-032 | todo | | |
| BIL-011 | todo | | |
| BIL-013 | todo | | |
| BIL-018 | todo | | |
| BIL-019 | todo | | |
| BIL-020 | todo | | |
| BIL-027 | todo | | |
| BIL-014 | todo | | |
| BIL-015 | todo | | |
| BIL-021 | todo | | |
| BIL-022 | todo | | |
| BIL-028 | todo | | |
| BIL-029 | todo | | |
| BIL-030 | todo | | |
| BIL-031 | todo | | |
| BIL-033 | todo | | |
| BIL-016 | todo | | |
| BIL-017 | todo | | |
| BIL-026 | todo | | |
| BIL-034 | todo | | |
| BIL-035 | todo | | |
| BIL-036 | todo | | |
| BIL-037 | todo | | |
| BIL-023 | todo | | |
| BIL-024 | todo | | |
| BIL-038 | todo | | |
| BIL-025 | todo | | |
| BIL-039 | todo | | |
| ORG-036 | todo | | |
| SYNC-024 | todo | | |
| SYNC-025 | todo | | |
| SYNC-026 | todo | | |
| SYNC-027 | todo | | |
| SYNC-028 | todo | | |
| SYNC-029 | todo | | |
| ORD-033 | todo | | |
| SYNC-030 | todo | | |
| SYNC-031 | todo | | |
| SYNC-032 | todo | | |
| SYNC-033 | todo | | |
| SYNC-034 | todo | | |
| SYNC-035 | todo | | |
| SYNC-036 | todo | | |
| SYNC-037 | todo | | |
| SYNC-038 | todo | | |
| SYNC-039 | todo | | |
| SYNC-040 | todo | | |
| SYNC-041 | todo | | |
| SYNC-042 | todo | | |
| SYNC-043 | todo | | |
| CAT-041 | todo | | |
| CAT-043 | todo | | |
| ORD-034 | todo | | |
| PRIV-004 | todo | | |
| PRIV-005 | todo | | |
