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
| REL-010 | todo | | |
| REL-011 | todo | | |
| REL-012 | todo | | |
| REL-013 | todo | | |
| REL-014 | done | | Reassignments journal table, contestation partial unique index, immutable; 12 tests |
| REL-015 | todo | | |
| REL-016 | todo | | |
| REL-017 | todo | | |
| REL-018 | todo | | |
| REL-019 | todo | | |
| REL-020 | todo | | |
| REL-021 | todo | | |
| REL-022 | todo | | |
| REL-023 | todo | | |
| REL-024 | todo | | |
| REL-025 | todo | | |
| CAT-001 | done | | products table, price checks and price date trigger; 18 tests, full suite 1305 pass |
| CAT-002 | done | | customer_prices table, supplier-product trigger, live unique index; 1316 tests pass |
| CAT-003 | todo | | |
| CAT-004 | todo | | |
| CAT-005 | todo | | |
| CAT-006 | todo | | |
| CAT-007 | todo | | |
| CAT-008 | todo | | |
| CAT-009 | todo | | |
| CAT-010 | todo | | |
| CAT-011 | todo | | |
| ORD-001 | done | | orders table, enums, FKs, indexes, triggers; 16 tests |
| ORD-002 | done | | CHECKs and status trigger on orders; 1510 tests pass |
| ORD-003 | todo | | |
| ORD-004 | todo | | |
| ORD-005 | todo | | |
| ORD-006 | todo | | |
| ORD-007 | todo | | |
| ORD-008 | todo | | |
| ORD-009 | todo | | |
| ORD-010 | todo | | |
| ORD-011 | todo | | |
| ORD-012 | todo | | |
| ORD-013 | todo | | |
| ORD-014 | todo | | |
| ORD-015 | todo | | |
| ORD-016 | todo | | |
| ORD-017 | todo | | |
| ORD-018 | todo | | |
| ORD-019 | todo | | |
| ORD-020 | todo | | |
| ORD-021 | todo | | |
| FIN-001 | done | | ledger_entries table, generated balance_effect, append-only grants |
| FIN-002 | todo | | |
| FIN-003 | todo | | |
| FIN-004 | todo | | |
| FIN-005 | todo | | |
| FIN-006 | todo | | |
| FIN-007 | todo | | |
| FIN-008 | todo | | |
| FIN-009 | todo | | |
| FIN-010 | todo | | |
| FIN-011 | done | | expenses table, triggers and tests green |
| FIN-012 | todo | | |
| FIN-013 | todo | | |
| FIN-014 | done | | handovers table, party-role and cancel-once triggers; 33 tests pass |
| FIN-015 | todo | | |
| FIN-016 | todo | | |
| FIN-017 | todo | | |
| FIN-018 | todo | | |
| FIN-019 | todo | | |
| FIN-020 | todo | | |
| DLV-001 | done | | deliveries table, triggers and tests green |
| DLV-002 | todo | | |
| DLV-003 | todo | | |
| DLV-004 | todo | | |
| DLV-005 | todo | | |
| DLV-006 | todo | | |
| DLV-007 | todo | | |
| DLV-008 | todo | | |
| DLV-009 | todo | | |
| DLV-010 | todo | | |
| DLV-011 | todo | | |
| DLV-012 | todo | | |
| SYNC-001 | todo | | |
| SYNC-002 | todo | | |
| SYNC-003 | todo | | |
| SYNC-004 | todo | | |
| SYNC-005 | todo | | |
| SYNC-006 | todo | | |
| SYNC-007 | todo | | |
| SYNC-008 | todo | | |
| SYNC-009 | todo | | |
| SYNC-010 | todo | | |
| SYNC-011 | todo | | |
| SYNC-012 | todo | | |
| SYNC-013 | todo | | |
| SYNC-014 | todo | | |
| SYNC-015 | todo | | |
| SYNC-016 | todo | | |
| SYNC-017 | todo | | |
| SYNC-018 | todo | | |
| SYNC-019 | todo | | |
| SYNC-020 | todo | | |
| SYNC-021 | todo | | |
| SYNC-022 | todo | | |
| SYNC-023 | todo | | |
| PRIV-001 | todo | | |
| PRIV-002 | todo | | |
| PRIV-003 | todo | | |
| PER-009 | done | | Targeted tests: 18 passed; full suite: 247 passed; typecheck, lint and format check pass |
| FND-010 | done | | Formatting, typecheck, lint, and full suite pass; test person fixtures now generate the required UUIDv7 id |
| FND-011 | done | | |
| FND-012 | done | | validation details reduced to path and code |
