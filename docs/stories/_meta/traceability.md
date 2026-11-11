# Traceability

Built by build_backlog.py. A dash means not covered yet.

## Constraints
| constraint | stories | tests |
|---|---|---|
| Person:required | PER-002, PER-007 | PER-002: table shape; PER-007: limits |
| Person.phone_number:unique | PER-002 | PER-002: unique number |
| Person.preferred_language:enum | PER-002 | PER-002: enums |
| Person.status:enum | PER-002 | PER-002: enums |
| PhoneNumberChangeLog:required | PER-004 | PER-004: insert and read |
| PhoneNumberChangeLog:fk | PER-004 | PER-004: foreign key |
| Organization:required | ORG-001, ORG-004 | ORG-001: required and enum; ORG-004: create |
| Organization.payment_code:unique | ORG-020 | ORG-020: unique code |
| Organization.status:enum | ORG-001, ORG-016, ORG-017 | ORG-001: required and enum; ORG-016: close; ORG-017: reopen |
| Organization.plan:enum | ORG-020 | ORG-020: plan rules |
| Collaboration:required | ORG-003 | ORG-003: table rules |
| Collaboration.role:enum | ORG-003, ORG-005, ORG-007, ORG-009 | ORG-003: table rules; ORG-005: details; ORG-007: refusals; ORG-009: change |
| Collaboration.status:enum | ORG-003, ORG-007, ORG-010 | ORG-003: table rules; ORG-007: re-invite; ORG-010: revoke |
| Collaboration:fk | ORG-003 | ORG-003: table rules |
| OrganizationContact:required | ORG-021 | ORG-021: required, lists, keys |
| OrganizationContact.kind:enum | ORG-021 | ORG-021: required, lists, keys |
| OrganizationContact.verification_method:enum | ORG-021 | ORG-021: required, lists, keys |
| OrganizationContact:fk | ORG-021 | ORG-021: required, lists, keys |
| CustomerRelationship:required | REL-001 | REL-001: required |
| CustomerRelationship.status:enum | REL-001 | REL-001: enums and keys |
| CustomerRelationship.ended_by_party:enum | REL-001 | REL-001: enums and keys |
| CustomerRelationship:fk | REL-001 | REL-001: enums and keys |
| CustomerPrice:required | CAT-002 | CAT-002: author and keys |
| CustomerPrice:fk | CAT-015, CAT-002 | CAT-015: keys; CAT-002: author and keys |
| CustomerRelationshipReassignment:required | REL-014 | REL-014: required and keys |
| CustomerRelationshipReassignment:fk | REL-014 | REL-014: required and keys |
| CreditLimitChange:required | REL-003 | REL-003: add and read |
| CreditLimitChange:fk | REL-003 | REL-003: author and key |
| Product:required | CAT-001, CAT-014, CAT-004, CAT-011 | CAT-001: required and key; CAT-014: photo limit; CAT-004: create; CAT-011: copy |
| Product:fk | CAT-001 | CAT-001: required and key |
| ProductVariant:required | CAT-012 | CAT-012: required and keys |
| ProductVariant.status:enum | CAT-012 | CAT-012: required and keys |
| ProductVariant:fk | CAT-012 | CAT-012: required and keys |
| Order:required | ORD-001 | ORD-001: required |
| Order.placed_by_party:enum | ORD-001 | ORD-001: enums and keys |
| Order.status:enum | ORD-001 | ORD-001: enums and keys |
| Order.cancelled_by_party:enum | ORD-001 | ORD-001: enums and keys |
| Order.reception_mode:enum | ORD-036 | ORD-036: unknown mode |
| Order:fk | ORD-001 | ORD-001: enums and keys |
| OrderLine:required | ORD-004, ORD-025 | ORD-004: keys and required; ORD-025: required |
| OrderLine:fk | ORD-004, ORD-024 | ORD-004: keys and required; ORD-024: column and key |
| Delivery:required | DLV-001 | DLV-001: keys and author |
| Delivery:fk | DLV-001 | DLV-001: keys and author |
| LedgerEntry:required | FIN-001 | FIN-001: keys and author |
| LedgerEntry.kind:enum | FIN-001 | FIN-001: amount and mode |
| LedgerEntry.mode:enum | FIN-001 | FIN-001: amount and mode |
| LedgerEntry:fk | FIN-001 | FIN-001: keys and author |
| LedgerEntry.balance_effect:generated | FIN-001 | FIN-001: balance effect |
| Expense:required | FIN-011 | FIN-011: insert rules |
| Expense:fk | FIN-011 | FIN-011: insert rules |
| Handover:required | FIN-014 | FIN-014: insert rules |
| Handover:fk | FIN-014 | FIN-014: insert rules |
| Subscription:required | ORG-012, BIL-002 | ORG-012: required enum key; BIL-002: valid periods |
| Subscription.plan:enum | BIL-002 | BIL-002: valid periods |
| Subscription.origin:enum | BIL-002 | BIL-002: valid periods |
| Subscription.status:enum | ORG-012, ORG-014, BIL-002 | ORG-012: required enum key; ORG-014: end; BIL-002: valid periods |
| Subscription.end_reason:enum | BIL-002 | BIL-002: valid periods |
| Subscription:fk | ORG-012, BIL-002 | ORG-012: required enum key; BIL-002: valid periods |
| SubscriptionPayment:required | BIL-001 | BIL-001: wrong rows |
| SubscriptionPayment.provider_reference:unique | BIL-001 | BIL-001: wrong rows |
| SubscriptionPayment.plan:enum | BIL-001 | BIL-001: wrong rows |
| SubscriptionPayment.operator:enum | BIL-001 | BIL-001: wrong rows |
| SubscriptionPayment.status:enum | BIL-001 | BIL-001: wrong rows |
| SubscriptionPayment:fk | BIL-001 | BIL-001: wrong rows |
| SubscriptionReceipt:required | BIL-003 | BIL-003: receipt |
| SubscriptionReceipt.number:unique | BIL-003 | BIL-003: receipt |
| SubscriptionReceipt.kind:enum | BIL-003 | BIL-003: receipt |
| SubscriptionReceipt:fk | BIL-003 | BIL-003: receipt |
| SubscriptionEvent:required | BIL-004 | BIL-004: events |
| SubscriptionEvent.kind:enum | BIL-004 | BIL-004: events |
| SubscriptionEvent.actor:enum | BIL-004 | BIL-004: events |
| SubscriptionEvent:fk | BIL-004 | BIL-004: events |
| Report:required | ADM-003 | ADM-003: insert rules |
| Report.status:enum | ADM-003 | ADM-003: insert rules |
| Report.decision:enum | ADM-003 | ADM-003: insert rules |
| Report:fk | ADM-003 | ADM-003: defaults and keys |
| Administrator:required | ADM-001 | ADM-001: insert rules |
| Administrator.role:enum | ADM-001 | ADM-001: insert rules |
| Administrator:fk | ADM-001 | ADM-001: person key |
| AdminAction:required | ADM-002 | ADM-002: insert rules |
| AdminAction.action:enum | ADM-002, ADM-016 | ADM-002: insert rules; ADM-016: five actions |
| AdminAction:fk | ADM-002 | ADM-002: insert rules |
| Notification:required | NTF-001, NTF-002 | NTF-001: defaults; NTF-002: store |
| Notification.read_status:enum | NTF-001, NTF-004 | NTF-001: enum and fk; NTF-004: mark one |
| Notification:fk | ORG-002 | ORG-002: unknown organization; ORG-002: recipient key |
| SyncArchive:required | SYNC-002 | SYNC-002: required and keys |
| SyncArchive:fk | SYNC-002 | SYNC-002: required and keys |
| OtpChallenge:required | AUTH-001 | AUTH-001: defaults |
| OtpChallenge.purpose:enum | AUTH-001, AUTH-027 | AUTH-001: enums and fk; AUTH-027: purposes |
| OtpChallenge.channel:enum | AUTH-001 | AUTH-001: enums and fk |
| OtpChallenge:fk | AUTH-001 | AUTH-001: enums and fk |
| Device:required | AUTH-007 | AUTH-007: device defaults |
| Device.platform:enum | AUTH-007 | AUTH-007: enums and keys |
| Device:fk | AUTH-007 | AUTH-007: enums and keys |
| RefreshToken:required | AUTH-007 | AUTH-007: token rules |
| RefreshToken.token_hash:unique | AUTH-007 | AUTH-007: token rules |
| RefreshToken.revoked_reason:enum | AUTH-007 | AUTH-007: enums and keys |
| RefreshToken:fk | AUTH-007 | AUTH-007: enums and keys |
| ImageCopy:required | IMG-001 | IMG-001: wrong rows |
| C-01 | FND-005, FND-011, PER-002, NTF-001, AUTH-001, AUTH-007, ORG-001, CAT-001, ORG-003, ORG-012, ORG-021, REL-001, CAT-002, ORD-001, DLV-001, ORD-004 | FND-005: column helper; FND-011: fixture boundaries; PER-002: table shape; NTF-001: defaults; AUTH-001: defaults; AUTH-007: device defaults; ORG-001: defaults; CAT-001: defaults; ORG-003: column types and defaults; ORG-012: row; ORG-021: column types; REL-001: defaults; CAT-002: row; ORD-001: defaults; DLV-001: row; ORD-004: amount rule |
| C-02 | FND-011, PER-003, PER-009, PER-010, PER-014, AUTH-010, AUTH-011, AUTH-024, AUTH-025, AUTH-029, AUTH-032, PRIV-002, PRIV-004, REL-023 | FND-011: migration preflight; PER-003: phone rules; PER-009: valid Person fixtures; PER-009: isolated enum failures; PER-010: key rules; PER-010: anonymized without key; PER-014: not E.164; AUTH-010: guest completed; AUTH-011: recycled; AUTH-024: refusals; AUTH-025: change; AUTH-029: registered number; AUTH-032: idle holder released; PRIV-002: anonymize; PRIV-004: photo removed; REL-023: contest |
| C-03 | FND-011, PER-003, PER-007, PER-009, AUTH-010, AUTH-020, AUTH-023, AUTH-025, AUTH-034, PRIV-002 | FND-011: migration preflight; FND-011: atomic email change; FND-011: whitespace boundaries; FND-011: fixture boundaries; PER-003: completeness; PER-003: email dates; PER-007: email reset; PER-009: valid Person fixtures; PER-009: isolated enum failures; AUTH-010: new person; AUTH-020: reset; AUTH-023: confirm; AUTH-025: after taken number; AUTH-034: session opened; PRIV-002: anonymize |
| C-40 | AUTH-038 | AUTH-038: other case |
| C-04 | ADM-001, FIN-011, FIN-014, CAT-002, ORD-001, DLV-001, ORD-004, REL-003, CAT-008, CAT-010, CAT-029, REL-012, REL-014, ADM-003, FIN-001 | ADM-001: insert rules; FIN-011: insert rules; FIN-014: insert rules; CAT-002: author and keys; ORD-001: enums and keys; DLV-001: keys and author; ORD-004: price gap; REL-003: author and key; CAT-008: create; CAT-010: copy; CAT-029: refusals; REL-012: set; REL-014: required and keys; ADM-003: insert rules; FIN-001: keys and author |
| C-41 | FND-014, ORG-020, ORG-028, ORG-035, ORG-044, BIL-007, ORG-045, BIL-013, BIL-033, SYNC-037, SYNC-041 | FND-014: plan limits; ORG-020: own code; ORG-020: plan rules; ORG-020: unique code; ORG-028: free plan; ORG-035: write alone; ORG-035: impossible plan; ORG-044: found; BIL-007: shop name; ORG-045: who; BIL-013: free; BIL-033: nothing running; SYNC-037: team; SYNC-041: read-only tables |
| C-05 | ORG-003, ORG-004, ORG-007, ORG-008, ORG-011, ORG-015, ORG-022, ORG-043 | ORG-003: table rules; ORG-003: one owner; ORG-003: number released; ORG-004: create; ORG-007: invite guest; ORG-008: accept; ORG-011: toggle; ORG-015: transfer; ORG-022: one owner; ORG-043: registered person |
| C-42 | ORG-022, ORG-030, ORG-035, ORG-045, BIL-019, BIL-029, BIL-016 | ORG-022: paused rows; ORG-022: owner stays active; ORG-030: limit table; ORG-035: pause; ORG-035: resume; ORG-035: no change; ORG-045: who; BIL-019: who stays; BIL-029: swap; BIL-016: running |
| C-43 | ORG-021, ORG-024, ORG-037, ORG-042 | ORG-021: row rules; ORG-021: uniqueness; ORG-024: other number; ORG-024: refusals; ORG-037: downgrade; ORG-042: email; ORG-042: refusals |
| C-44 | ORG-024, ORG-025, ORG-027, ORG-029, ORG-042 | ORG-024: own number; ORG-025: right code; ORG-027: no edit; ORG-029: finds nothing; ORG-042: own email |
| C-06 | REL-002, REL-006, REL-007, REL-010, REL-011, REL-020, REL-025, SYNC-011 | REL-002: parties; REL-006: counter; REL-007: new customer; REL-010: counter label; REL-011: add; REL-020: person invites; REL-025: refusals; SYNC-011: new customer |
| C-07 | REL-002, REL-007, REL-020, REL-021, REL-024, REL-025 | REL-002: pair rule; REL-002: two counters; REL-007: existing; REL-020: refusals; REL-021: existing relationship; REL-024: existing; REL-025: merge |
| C-08 | REL-002, REL-020, REL-021 | REL-002: state rules; REL-020: person invites; REL-021: accept |
| C-09 | REL-002, REL-015, REL-017, REL-019 | REL-002: state rules; REL-015: end; REL-015: reopen; REL-017: end and reopen; REL-019: end and reopen |
| C-10 | REL-004, REL-006, REL-007, REL-011, REL-012, REL-020 | REL-004: default; REL-004: rules; REL-004: journal; REL-006: counter; REL-007: new customer; REL-011: add; REL-012: set; REL-020: person invites |
| C-11 | CAT-015, CAT-002, CAT-008, CAT-009, CAT-010, CAT-029, CAT-030, CAT-039, SYNC-034, CAT-043 | CAT-015: uniqueness; CAT-002: uniqueness; CAT-002: foreign product; CAT-008: create; CAT-009: remove; CAT-010: copy; CAT-029: set; CAT-029: replace; CAT-029: copy; CAT-030: list; CAT-039: entered twice; SYNC-034: two phones; CAT-043: rules |
| C-12 | REL-014, REL-023, REL-024, REL-027, REL-031 | REL-014: contestation rule; REL-023: contest; REL-024: correct; REL-027: index dropped; REL-031: contested correction |
| C-57 | REL-027, REL-029, REL-030, REL-031, SYNC-044 | REL-027: column; REL-027: counter; REL-029: take back; REL-030: hidden list; REL-031: contested correction; SYNC-044: pull |
| C-45 | CAT-012, CAT-013, CAT-026, CAT-036, CAT-040 | CAT-012: crafted write; CAT-013: copy; CAT-026: delete variant; CAT-026: last variant; CAT-036: last variant; CAT-040: product and variant |
| C-46 | CAT-014, CAT-033, CAT-038, CAT-020, CAT-024, CAT-025, BIL-020, BIL-030, SYNC-026, SYNC-031, SYNC-035, SYNC-041 | CAT-014: new-style row; CAT-033: server fields; CAT-038: count; CAT-038: limit; CAT-020: on sale; CAT-024: back on sale; CAT-025: limit; BIL-020: most ordered; BIL-030: sticks; SYNC-026: left out; SYNC-031: server fields; SYNC-035: beyond the plan; SYNC-041: dropped fields; SYNC-041: stored values stay |
| C-47 | CAT-018, CAT-016, CAT-034, CAT-035, CAT-022, CAT-024, CAT-025, CAT-037, CAT-031, SYNC-032 | CAT-018: name and unit; CAT-018: merged; CAT-016: comparison; CAT-016: database twin; CAT-034: twin; CAT-035: merged; CAT-022: refusals; CAT-024: refusals; CAT-025: refusals; CAT-037: merged; CAT-037: place taken; CAT-031: existing product; SYNC-032: twice |
| C-48 | ORD-030, CAT-026, CAT-036, CAT-037, SYNC-029, SYNC-033 | ORD-030: cited; ORD-030: any state; CAT-026: used variant; CAT-026: past use; CAT-036: sold; CAT-036: whole product; CAT-037: restored; SYNC-029: deleted; SYNC-033: sold meanwhile; SYNC-033: whole product |
| C-13 | CAT-001, CAT-012, CAT-034, CAT-004, CAT-005, CAT-022, CAT-024, CAT-025, CAT-011 | CAT-001: price rules; CAT-001: price date; CAT-012: value rules; CAT-012: price date; CAT-034: edited; CAT-004: create; CAT-004: limits; CAT-005: price change; CAT-022: created; CAT-024: refusals; CAT-025: change fields; CAT-025: price change; CAT-011: copy |
| C-49 | PER-010, PER-012, PER-013, CAT-012, CAT-014, CAT-032, CAT-044, ORG-020, ORG-038, IMG-002, IMG-003, IMG-004, IMG-005, IMG-006, IMG-008, IMG-010, CAT-045, SYNC-038, SYNC-041 | PER-010: one file one person; PER-012: photo not writable; PER-013: set replace clear; PER-013: guest; CAT-012: value rules; CAT-014: photo limit; CAT-032: product keys; CAT-044: product; ORG-020: unique logo key; ORG-038: shared file; IMG-002: cited; IMG-003: good photo; IMG-004: add and replace; IMG-005: add and replace; IMG-006: source removed; IMG-008: add and replace; IMG-010: add, replace, remove; CAT-045: new product; SYNC-038: logo; SYNC-041: dropped fields; SYNC-041: stored values stay |
| C-50 | CAT-046, IMG-002, IMG-004, IMG-005, IMG-007, IMG-009, IMG-012 | CAT-046: released; IMG-002: delete; IMG-004: add and replace; IMG-004: remove; IMG-005: add and replace; IMG-005: remove; IMG-007: old uncited; IMG-007: recent and cited; IMG-009: remove; IMG-012: released |
| C-14 | ORD-003, ORD-009, ORD-010, ORD-013 | ORD-003: creation states; ORD-009: first order; ORD-010: organization order; ORD-013: delivery cost |
| C-15 | ORD-005, ORD-026, CAT-003, CAT-019, ORD-027, ORD-009, ORD-013, ORD-032, ORD-034 | ORD-005: product rule; ORD-005: minimum quantity; ORD-026: refused lines; ORD-026: minimum; CAT-003: active product; CAT-019: active variant; CAT-019: refused; ORD-027: minimum; ORD-027: unavailable; ORD-009: refusals; ORD-013: refusals; ORD-032: rules; ORD-034: rules |
| C-16 | ORD-002, ORD-008, ORD-012, ORD-016, ORD-017 | ORD-002: cancellation columns; ORD-008: cancellation fields; ORD-012: refuse; ORD-016: cancel; ORD-017: person cancels |
| C-51 | ORD-022, ORD-023 | ORD-022: checks; ORD-023: accept |
| C-18 | ORD-002, ORD-008, ORD-014 | ORD-002: steps; ORD-002: frozen; ORD-008: steps; ORD-014: edit fields |
| C-19 | ORD-002, ORD-006, ORD-007 | ORD-002: delivery columns; ORD-006: inconsistent; ORD-006: delivered quantities; ORD-007: total |
| C-20 | ORD-004, ORD-005, ORD-027, ORD-028, ORD-011 | ORD-004: amount rule; ORD-004: price gap; ORD-004: customer orders; ORD-005: customer order prices; ORD-027: prices and label; ORD-028: requests; ORD-011: lower price |
| C-21 | DLV-002, DLV-004, DLV-005, DLV-006 | DLV-002: state rules; DLV-002: one in progress; DLV-002: membership; DLV-004: assign; DLV-005: simultaneous; DLV-006: fail |
| C-22 | DLV-010 | DLV-010: cancel |
| C-23 | FIN-001, FIN-004, FIN-005, FIN-006, FIN-007, FIN-010 | FIN-001: balance effect; FIN-001: amount and mode; FIN-004: record; FIN-005: refund; FIN-006: credit note; FIN-007: record; FIN-010: supplier reads |
| C-24 | FIN-002 | FIN-002: sale rules |
| C-25 | FIN-002, FIN-009 | FIN-002: reversal rules; FIN-009: reverse |
| C-26 | DLV-009 | DLV-009: payment match |
| C-27 | FIN-011, FIN-014, FIN-012, FIN-013, FIN-015, FIN-016, FIN-017 | FIN-011: insert rules; FIN-014: insert rules; FIN-012: record; FIN-013: cancel; FIN-015: record; FIN-016: cancel; FIN-017: automatic |
| C-28 | ADM-003, ADM-011, ADM-013 | ADM-003: insert rules; ADM-011: report person; ADM-013: refusals |
| C-29 | ADM-001, ADM-002, ADM-006, ADM-007, ADM-009, ADM-010, ADM-016, ADM-017, SYNC-002, SYNC-022 | ADM-001: insert rules; ADM-002: insert rules; ADM-006: sign in; ADM-007: refusals; ADM-009: appoint; ADM-010: remove; ADM-016: reserved; ADM-017: moderator; SYNC-002: journal link; SYNC-022: replay |
| C-30 | NTF-001, NTF-002 | NTF-001: guest recipient; NTF-001: pair rule; NTF-002: invalid input; NTF-002: database checks |
| C-52 | BIL-002, BIL-032, BIL-011, BIL-027, BIL-028, BIL-031, BIL-037, BIL-039 | BIL-002: wrong rows; BIL-032: overlap; BIL-011: at once; BIL-027: upgrade; BIL-028: runs out; BIL-031: close; BIL-037: nothing running; BIL-039: selection |
| C-53 | BIL-001, BIL-009, BIL-014, BIL-015, BIL-021, BIL-022, BIL-024, BIL-038 | BIL-001: moves; BIL-009: starts; BIL-014: activation; BIL-015: waiting; BIL-021: selection; BIL-022: clean day; BIL-024: recorded; BIL-038: active |
| C-54 | BIL-003, BIL-012, BIL-017, BIL-038, BIL-025 | BIL-003: wrong rows; BIL-012: receipt; BIL-017: list; BIL-038: active; BIL-025: refund |
| C-55 | BIL-004, BIL-018, BIL-029, BIL-030, BIL-023 | BIL-004: wrong rows; BIL-018: stored; BIL-029: swap; BIL-030: swap; BIL-023: gift |
| C-32 | PER-004, AUTH-025, REL-003, REL-014, ADM-002, SYNC-002 | PER-004: immutable; AUTH-025: journal immutable; REL-003: immutable; REL-014: immutable; ADM-002: immutable; SYNC-002: immutable |
| C-56 | IMG-001, IMG-006, IMG-011, CAT-045 | IMG-001: first copy; IMG-001: copy of copy; IMG-006: first copy; IMG-006: copy of copy; IMG-011: take; CAT-045: registry |
| C-33 | AUTH-001, AUTH-002, AUTH-003, AUTH-013, AUTH-014, AUTH-015, AUTH-019, AUTH-022, AUTH-023, AUTH-024, AUTH-033, AUTH-036, ORG-023, ORG-041, ORG-025, ORG-026, ADM-007, ADM-008 | AUTH-001: limits; AUTH-002: foreign number; AUTH-003: attempts; AUTH-013: sms code; AUTH-014: email channel; AUTH-015: email sign-in; AUTH-019: sms; AUTH-022: code sent; AUTH-023: bad code; AUTH-024: code sent; AUTH-033: registered holder; AUTH-036: email code refused; ORG-023: id and purpose; ORG-023: known contact; ORG-041: one contact; ORG-025: other contact; ORG-026: limit; ADM-007: register; ADM-008: nothing happens |
| C-34 | AUTH-007, AUTH-008, AUTH-016, SYNC-008 | AUTH-007: token rules; AUTH-008: revoke; AUTH-016: reuse; SYNC-008: full pull |
| C-35 | FND-002, PER-002, PER-004, NTF-001, ORG-001, CAT-001, CAT-012, CAT-013, CAT-014, CAT-015, CAT-018, CAT-021, CAT-032, CAT-033, ORG-003, ORG-021, ORG-027, REL-001, CAT-002, ORD-001, DLV-001, ORD-004, ORD-025, REL-003, REL-014, REL-025, SYNC-002, SYNC-003, ORG-032, ORG-043, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-024, SYNC-027, SYNC-036, SYNC-042 | FND-002: server time; PER-002: defaults and trigger; PER-004: insert and read; NTF-001: defaults; ORG-001: server time; CAT-001: defaults; CAT-012: defaults; CAT-013: dates; CAT-014: new-style row; CAT-014: touch; CAT-015: copy; CAT-018: deleted frees; CAT-021: insert; CAT-032: variant keys; CAT-033: created; ORG-003: column types and defaults; ORG-021: defaults; ORG-021: deleted frees; ORG-027: delete; ORG-027: place free; REL-001: defaults; CAT-002: row; ORD-001: defaults; DLV-001: row; ORD-004: amount rule; ORD-025: copy; REL-003: add and read; REL-014: add and read; REL-025: merge; SYNC-002: add and read; SYNC-003: first pull; ORG-032: column gone; ORG-043: objects gone; SYNC-004: seller; SYNC-005: seller; SYNC-006: lines; SYNC-007: customer; SYNC-024: deletion; SYNC-027: deleted price; SYNC-036: pending again; SYNC-042: new order; SYNC-042: pending again |
| C-36 | CAT-033, CAT-035, CAT-036, CAT-037, CAT-039, SYNC-009, SYNC-011, SYNC-013, SYNC-015, SYNC-018 | CAT-033: nothing written; CAT-035: repeat; CAT-036: other answers; CAT-037: broken chain; CAT-039: nothing written; SYNC-009: unknown table; SYNC-011: duplicate merged; SYNC-013: crossed; SYNC-015: repeat; SYNC-018: set aside |
| C-37 | ORG-006, FIN-003, FIN-018 | ORG-006: add and subtract; ORG-006: parallel; FIN-003: cache effects; FIN-018: clean |
| C-38 | ACC-007, FIN-004 | ACC-007: first runs; ACC-007: repeat replays; FIN-004: retry |
| C-39 | FND-002, PER-004, IMG-001, BIL-003, REL-003, REL-014, ADM-002, FIN-001, SYNC-002, BIL-004 | FND-002: immutable pattern; PER-004: immutable; IMG-001: insert only; BIL-003: immutable; REL-003: immutable; REL-014: immutable; ADM-002: immutable; FIN-001: immutable; SYNC-002: immutable; BIL-004: immutable |
| C-58 | ORD-035, ORD-039, ORD-044, SYNC-046 | ORD-035: link rules; ORD-035: supplier order; ORD-039: replace; ORD-044: replace; SYNC-046: delivery wins |
| C-59 | AUTH-039, AUTH-041 | AUTH-039: uniqueness; AUTH-041: crossed |
| C-60 | ORD-036, DLV-018, ORD-037, SYNC-049 | ORD-036: pickup rule; DLV-018: rest mode; ORD-037: place modes; ORD-037: other routes; ORD-037: address on pickup; SYNC-049: create |
| C-61 | ORD-045 | ORD-045: rule |
| C-62 | ORD-042 | ORD-042: frozen |
| CM-01 | PRIV-002 | PRIV-002: anonymize |
| CM-02 | PRIV-001, PRIV-002 | PRIV-001: nothing blocks; PRIV-002: refusals |
| CM-03 | PER-005, AUTH-011, ORG-004, ORG-008, ORG-009, ORG-010, ORG-015, ORG-016, ORG-035, REL-023, REL-024, ORG-036, SYNC-008, SYNC-019 | PER-005: scope version; AUTH-011: recycled; ORG-004: scope version; ORG-008: accept; ORG-009: change; ORG-010: revoke; ORG-015: counters and notice; ORG-016: team and subscription; ORG-035: pause; ORG-035: resume; REL-023: notices; REL-024: correct; ORG-036: role; ORG-036: revoke; SYNC-008: rights changed; SYNC-019: powers refused |
| CM-04 | AUTH-011, AUTH-015, AUTH-025, AUTH-032, ADM-017 | AUTH-011: recycled; AUTH-015: email sign-in; AUTH-025: change; AUTH-032: idle holder released; ADM-017: release |
| CM-05 | AUTH-005, AUTH-010, AUTH-012, AUTH-013, AUTH-020, AUTH-021, AUTH-028, AUTH-030, AUTH-034 | AUTH-005: rules; AUTH-005: hash and verify; AUTH-010: new person; AUTH-012: environment; AUTH-013: lock; AUTH-020: reset; AUTH-021: change; AUTH-028: right password; AUTH-030: weak password keeps the code; AUTH-034: session opened |
| CM-06 | AUTH-002, AUTH-003 | AUTH-002: issue; AUTH-003: single use; AUTH-003: expiry |
| CM-07 | AUTH-002, AUTH-004, AUTH-009, AUTH-019, AUTH-022, AUTH-024, AUTH-029, AUTH-031, AUTH-033, AUTH-037 | AUTH-002: limits; AUTH-004: caps; AUTH-009: limits; AUTH-019: limits; AUTH-022: limits; AUTH-024: limits; AUTH-029: unknown number; AUTH-031: limits; AUTH-033: registered holder; AUTH-037: holder warned |
| CM-08 | AUTH-006, AUTH-008, AUTH-014, AUTH-016 | AUTH-006: payload; AUTH-008: issue; AUTH-014: sign in; AUTH-016: rotation |
| CM-09 | ORG-003, ORG-009, ORG-010, ORG-015 | ORG-003: one owner; ORG-003: swap; ORG-009: refusals; ORG-010: immediate; ORG-015: transfer |
| CM-10 | ORG-016, ORG-017, ORD-018, ORG-034 | ORG-016: close; ORG-017: reopen; ORD-018: pending refused; ORG-034: close hooks; ORG-034: paused members |
| CM-11 | CAT-003, CAT-007, CAT-017, CAT-028, ORD-027 | CAT-003: reference price; CAT-007: own price; CAT-017: reference price; CAT-017: own price; CAT-028: my price; ORD-027: prices and label |
| CM-12 | ACC-003, ORD-002, ORD-008, DLV-005, DLV-006, ORD-011, ORD-012, SYNC-013 | ACC-003: steps; ORD-002: steps; ORD-008: steps; DLV-005: unassigned; DLV-006: fail; ORD-011: accept; ORD-012: refuse; SYNC-013: departure |
| CM-13 | DLV-007, DLV-009 | DLV-007: paid in full; DLV-009: counter sale |
| CM-14 | FND-003, ORD-004, ORD-007 | FND-003: rounding; ORD-004: amount rule; ORD-007: line amount |
| CM-15 | DLV-007, DLV-017, SYNC-017 | DLV-007: credit rule; DLV-017: credit rule; SYNC-017: credit exceeded |
| CM-16 | ORD-005, ORD-011, ORD-038, SYNC-012, ORD-039 | ORD-005: customer order prices; ORD-011: lower price; ORD-038: place; SYNC-012: price gap; ORD-039: replace |
| CM-17 | FIN-003, FIN-012, FIN-015, FIN-018 | FIN-003: cache effects; FIN-012: record; FIN-015: record; FIN-018: held drift |
| CM-18 | FIN-017 | FIN-017: automatic |
| CM-19 | REL-005, REL-008, REL-009, REL-010, REL-016, REL-017, REL-018, REL-022 | REL-005: supplier view; REL-005: customer view; REL-008: list; REL-009: open; REL-010: edit; REL-016: list; REL-017: set label; REL-018: list; REL-022: views |
| CM-20 | PER-005, PER-006, PER-011, REL-005, REL-026 | PER-005: public view; PER-006: indistinguishable; PER-011: view with photo; REL-005: supplier view; REL-026: registered supplier |
| CM-21 | FIN-008 | FIN-008: return |
| CM-22 | DLV-008, DLV-012, SYNC-014 | DLV-008: partial and later; DLV-012: abandoned; SYNC-014: partial later |
| CM-23 | SYNC-013 | SYNC-013: crossed |
| CM-24 | REL-023, REL-024, REL-028, REL-029, REL-030, REL-031 | REL-023: refusals; REL-024: same customer; REL-028: contest; REL-029: take back; REL-030: supplier mark; REL-031: same number |
| CM-25 | REL-021 | REL-021: accept |
| CM-26 | ORG-018, ORG-029 | ORG-018: found; ORG-029: verified contact |
| CM-27 | SYNC-010, SYNC-012, SYNC-014, SYNC-015, SYNC-028, SYNC-029, SYNC-030, SYNC-044 | SYNC-010: computed ignored; SYNC-012: server amounts; SYNC-014: delivered offline; SYNC-015: payment; SYNC-028: false reference; SYNC-029: by variant; SYNC-030: computed removed; SYNC-044: push ignored |
| CM-28 | SYNC-009, SYNC-010, SYNC-016, SYNC-018 | SYNC-009: archived first; SYNC-010: honest lines; SYNC-016: old price; SYNC-018: refusal reported |
| CM-29 | SYNC-019, SYNC-039 | SYNC-019: demoted manager; SYNC-039: late sales |
| CM-30 | SYNC-003, SYNC-004, SYNC-006, SYNC-007, SYNC-025 | SYNC-003: amount held; SYNC-004: driver; SYNC-006: seller; SYNC-007: seller ledger; SYNC-025: names only |
| CM-31 | SYNC-009, SYNC-016, SYNC-017 | SYNC-009: version and time; SYNC-016: dates; SYNC-017: restricted mode |
| CM-32 | SYNC-022 | SYNC-022: replay |
| CM-33 | ADM-013, ADM-014 | ADM-013: dismiss; ADM-013: suspend person; ADM-014: person cycle |
| CM-34 | ADM-008 | ADM-008: recovery |
| CM-35 | SYNC-002, PRIV-003 | SYNC-002: immutable; PRIV-003: retention periods |
| CM-36 | ORG-037 | ORG-037: downgrade |
| CM-37 | ORG-033 | ORG-033: notice sent |
| CM-38 | DLV-013, SYNC-040 | DLV-013: hidden; DLV-013: roles; DLV-013: ended; SYNC-040: assigned elsewhere |
| CM-39 | FIN-021 | FIN-021: handover statuses; FIN-021: expense statuses |
| CM-40 | ADM-018, ADM-019, ADM-020 | ADM-018: fixed text; ADM-019: two codes; ADM-020: restore |
| CM-41 | ADM-017 | ADM-017: release |
| CM-42 | CAT-021, SYNC-024, SYNC-026 | CAT-021: insert; CAT-021: update; SYNC-024: price change; SYNC-026: back on sale |
| CM-43 | PRIV-004 | PRIV-004: photo removed |
| CM-44 | PRIV-005 | PRIV-005: retention |

## Design anchors
| anchor | stories |
|---|---|
| a1-modifier-remplacer-une-commande-en/contraintes-de-base-de-donnees-complete | ORD-035 |
| a1-modifier-remplacer-une-commande-en/etapes-complete-a-2 | ORD-038 |
| a1-modifier-remplacer-une-commande-en/gestes-hors-ligne-arrives-apres-le | SYNC-045, SYNC-046 |
| a1-modifier-remplacer-une-commande-en/le-geste | ORD-039, ORD-044 |
| a1-modifier-remplacer-une-commande-en/le-lien-et-la-suppression-champ-ajoute | ORD-035, ORD-039, SYNC-045 |
| a1-modifier-remplacer-une-commande-en/le-total-vu-par-le-client | ORD-038 |
| a1-modifier-remplacer-une-commande-en/notification-complete-8-1 | NTF-005 |
| a2-reconnaitre-un-telephone-android | AUTH-041 |
| a2-reconnaitre-un-telephone-android/a-l-ouverture-d-une-session | AUTH-041 |
| a2-reconnaitre-un-telephone-android/ce-que-le-serveur-garde-champ-ajoute-a | AUTH-039, AUTH-040, PRIV-006 |
| a2-reconnaitre-un-telephone-android/contraintes-de-base-de-donnees-complete | AUTH-039 |
| a2-reconnaitre-un-telephone-android/fiches-existantes | AUTH-041 |
| a2-reconnaitre-un-telephone-android/le-champ-envoye | AUTH-041 |
| a2-reconnaitre-un-telephone-android/le-principe | AUTH-040 |
| a2-reconnaitre-un-telephone-android/sessions-ouvertes-precise-1-1-et-10-3 | AUTH-042 |
| a3-plafond-de-credit-deja-depasse/ce-que-recoit-le-livreur-precise-9-6 | REL-032 |
| a3-plafond-de-credit-deja-depasse/exemples-montants-en-xaf | DLV-017 |
| a3-plafond-de-credit-deja-depasse/la-regle | DLV-017 |
| a3-plafond-de-credit-deja-depasse/le-controle-complete-4-1-commande | DLV-017 |
| a4-livraison-ou-retrait-reception-mode | DLV-018 |
| a4-livraison-ou-retrait-reception-mode/champ-ajoute-a-order | ORD-036, ORD-037, SYNC-049 |
| a4-livraison-ou-retrait-reception-mode/contraintes-de-base-de-donnees-complete | ORD-036, SYNC-049 |
| a5-nom-public-du-client-chez-le | SYNC-047, REL-033 |
| a6-nom-public-du-fournisseur-chez-le | SYNC-047, REL-033 |
| a7-blocage-apres-5-erreurs-de-mot-de | AUTH-043, AUTH-044 |
| a8-le-recu-ne-change-plus-point-9 | DLV-019 |
| a8-le-recu-ne-change-plus-point-9/apres-la-suppression-d-un-compte | ORD-042 |
| a8-le-recu-ne-change-plus-point-9/champs-figes-champs-ajoutes-a-order | ORD-040, DLV-019, ORD-041, SYNC-048 |
| a8-le-recu-ne-change-plus-point-9/contraintes-de-base-de-donnees-complete | ORD-042, ORD-043, ORD-045 |
| a8-le-recu-ne-change-plus-point-9/mise-en-service | ORD-042 |
| acces-et-securite/connexion-verrouillage-et-telephone | AUTH-013, AUTH-017, AUTH-018, AUTH-028, ADM-006 |
| acces-et-securite/device | AUTH-007, AUTH-008, AUTH-014, AUTH-018, SYNC-008 |
| acces-et-securite/la-base-de-donnees-dernier-rempart | FND-002, PRIV-003 |
| acces-et-securite/la-couche-d-acces-et-la-table-des-regles | ACC-001, ACC-006, ACC-007 |
| acces-et-securite/otpchallenge | AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-022, AUTH-027, AUTH-033, AUTH-036, ORG-023, ORG-041, ADM-018, ORG-024, ORG-025, ORG-042, ADM-007 |
| acces-et-securite/refreshtoken | AUTH-006, AUTH-007, AUTH-008, AUTH-016, AUTH-017 |
| annexe-la-table-des-regles/controles-a-l-arrivee | SYNC-016 |
| annexe-la-table-des-regles/etapes-d-une-commande | ACC-003, ORD-008 |
| annexe-la-table-des-regles/extrait-du-fichier | ACC-001, ACC-008, ORG-040, BIL-006 |
| annexe-la-table-des-regles/qui-et-ou | ACC-002, ACC-003, ACC-004, ACC-005, ACC-008, ORG-040, SYNC-010, SYNC-044 |
| catalogue/product | CAT-001, CAT-013, CAT-014, CAT-021, CAT-032, CAT-033, CAT-044, IMG-008, IMG-009, CAT-038, ORD-005, CAT-003, CAT-004, CAT-005, CAT-006, CAT-007, CAT-020, CAT-022, CAT-023, CAT-024, CAT-026, CAT-027, CAT-028, CAT-036, CAT-037, CAT-029, CAT-030, CAT-039, CAT-011, CAT-031, CAT-040, DLV-016, ORD-031, BIL-020, SYNC-005, SYNC-026, SYNC-030, SYNC-031, SYNC-035, SYNC-043, CAT-041 |
| catalogue/productvariant | CAT-012, CAT-013, CAT-018, CAT-016, CAT-021, CAT-032, CAT-034, CAT-035, CAT-044, CAT-046, IMG-010, CAT-038, ORD-030, CAT-017, CAT-019, CAT-022, CAT-024, CAT-025, CAT-026, CAT-027, CAT-028, CAT-036, CAT-037, CAT-031, CAT-040, CAT-042, SYNC-024, SYNC-025, SYNC-029, SYNC-032, SYNC-033, SYNC-041, SYNC-043 |
| commandes-et-livraisons/delivery | DLV-001, DLV-002, DLV-003, DLV-004, DLV-005, DLV-006, DLV-013, DLV-010, DLV-015, SYNC-013 |
| commandes-et-livraisons/order | ORD-001, ORD-002, ORD-006, ORD-007, ORD-008, ORD-022, ORD-026, ORD-027, ORD-009, ORD-010, ORD-011, ORD-015, ORD-017, ORD-023, ORD-013, ORD-014, ORD-019, ORD-020, ORD-021, SYNC-012 |
| commandes-et-livraisons/order/autres-regles | ORD-003, ORD-005, DLV-009 |
| commandes-et-livraisons/order/clore-une-commande-commande-livree | DLV-007, SYNC-014 |
| commandes-et-livraisons/order/le-reste-d-une-livraison-partielle | DLV-008, DLV-012 |
| commandes-et-livraisons/order/refus-et-annulation | ORD-012, ORD-016, ORD-017, ORD-023 |
| commandes-et-livraisons/orderline | FND-003, ORD-004, ORD-007, ORD-024, ORD-025, ORD-029, ORD-030, ORD-027, DLV-014, ORD-028, ORD-011, ORD-013, ORD-014, DLV-016, ORD-031, ORD-032, DLV-008, ORD-033, ORD-034 |
| contraintes-a-poser-au-niveau-base-de | FND-001, FND-002, FND-005, FND-011, PER-002, PER-003, PER-008, PER-009, PER-010, ACC-007, NTF-001, AUTH-001, AUTH-007, AUTH-038, IMG-001, ORG-001, CAT-001, CAT-012, CAT-014, CAT-015, CAT-018, ORG-003, ADM-001, FIN-011, FIN-014, ORG-020, BIL-001, BIL-003, ORG-021, ORG-022, REL-001, REL-002, CAT-002, ORD-001, DLV-001, ORD-002, ORD-003, DLV-002, ORD-004, ORD-006, ORD-022, ORD-024, ORD-025, ORD-026, REL-004, ADM-002, ADM-003, ADM-016, FIN-001, FIN-002, ORD-032, SYNC-002, ORG-032, ORG-043, BIL-002, BIL-004, BIL-032, CAT-041, CAT-043, ORD-034 |
| donnees-personnelles-et-conservation/cadre-juridique-le-cameroun | FND-007, PRIV-001 |
| donnees-personnelles-et-conservation/durees-de-conservation | IMG-007, PRIV-002, PRIV-004, PRIV-003, PRIV-005 |
| finances/expense | FIN-011, FIN-012, FIN-013, FIN-019, FIN-020 |
| finances/handover | FIN-014, ORG-006, ORG-019, FIN-003, FIN-015, FIN-016, FIN-017, FIN-018, DLV-011, FIN-021, FIN-022, SYNC-007 |
| finances/ledgerentry | ACC-004, FIN-001, FIN-002, FIN-003, FIN-004, FIN-005, FIN-006, FIN-009, FIN-010, FIN-018, FIN-020, SYNC-015 |
| finances/ledgerentry/reprise-de-cahier | FIN-007 |
| finances/ledgerentry/retour-rembourse | FIN-008 |
| finances/subscription | BIL-010, ORG-012, ORG-013, ORG-014, BIL-005, BIL-002, BIL-006, BIL-032, BIL-011, BIL-013, BIL-018, BIL-019, BIL-020, BIL-027, BIL-028, BIL-029, BIL-030, BIL-031, BIL-016, BIL-026, BIL-036, BIL-037, BIL-023, BIL-039 |
| finances/subscription/plans-on-paie-pour-son-equipe | FND-014, BIL-007, BIL-009, BIL-014, BIL-033, BIL-016, BIL-034, BIL-035 |
| finances/subscription/prix-et-forfaits | FND-014 |
| finances/subscriptionevent | BIL-004 |
| finances/subscriptionpayment | BIL-008, BIL-001, BIL-009, PRIV-005, BIL-014, BIL-015, BIL-021, BIL-022, BIL-024, BIL-038, BIL-025 |
| finances/subscriptionreceipt | BIL-003, BIL-012, BIL-015, BIL-017, BIL-038, BIL-025 |
| gouvernance-de-la-plateforme/adminaction | ADM-002, ADM-009, ADM-010, ADM-013, ADM-014, ADM-015, ADM-016, ADM-017, ADM-019, SYNC-022 |
| gouvernance-de-la-plateforme/administrator | ADM-001, ADM-004, ADM-005, ADM-006, ADM-007, ADM-008, ADM-009, ADM-010 |
| identite-et-organisation/collaboration | ACC-005, ORG-003, ORG-004, ORG-005, ORG-006, ORG-007, ORG-008, ORG-009, ORG-010, ORG-011, ORG-015, ORG-019, ORG-022, ORG-030, ORG-035, ORG-033, ORG-031, FIN-017, FIN-021, ORG-043, ORG-036, SYNC-039 |
| identite-et-organisation/organization | FND-014, ORG-001, ORG-004, ORG-005, ORG-016, ORG-017, ORG-018, ORG-020, ORG-028, ORG-030, ORG-035, ORG-038, IMG-005, ORG-029, ORG-044, BIL-007, ORG-045, ORD-018, REL-006, ORG-039, ORG-032, ORG-034, BIL-013, SYNC-037 |
| identite-et-organisation/organizationcontact | ORG-021, ORG-041, ORG-024, ORG-025, ORG-026, ORG-027, ORG-033, ORG-037, ORG-029, ORG-031, ORG-042, SYNC-036, SYNC-042 |
| identite-et-organisation/person | FND-004, FND-011, PER-001, PER-002, PER-003, PER-005, PER-006, PER-007, PER-008, PER-009, PER-010, PER-011, PER-012, PER-013, PER-014, AUTH-005, AUTH-006, AUTH-009, AUTH-010, AUTH-011, AUTH-012, AUTH-013, AUTH-014, AUTH-015, AUTH-019, AUTH-020, AUTH-021, AUTH-022, AUTH-023, AUTH-024, AUTH-025, AUTH-026, AUTH-028, AUTH-029, AUTH-030, AUTH-031, AUTH-032, AUTH-033, AUTH-034, AUTH-036, AUTH-035, AUTH-037, AUTH-038, IMG-004, ORG-037, REL-005, ADM-017, ADM-019, ADM-020, PRIV-001, PRIV-002, PRIV-004, REL-022, SYNC-038 |
| identite-et-organisation/phonenumberchangelog | PER-004, AUTH-025, ADM-020 |
| images/ajouter-a-mon-catalogue | IMG-006, CAT-045 |
| images/ajouter-remplacer-retirer-une-photo | CAT-046, IMG-003, IMG-004, IMG-005, IMG-007, IMG-008, IMG-009, IMG-010, IMG-011, IMG-012 |
| images/imagecopy | IMG-001, IMG-006, IMG-011, CAT-045 |
| images/stockage | FND-013, PER-011, PER-013, CAT-032, CAT-044, ORG-038, IMG-002, IMG-003 |
| legende | FND-003, FND-004, FND-005 |
| moderation/report | ADM-003, ADM-011, ADM-012, ADM-013, ADM-014 |
| notes-de-conception | FND-000, FND-006, FND-009, FND-010, FND-011 |
| notifications/notification | NTF-001, NTF-002, NTF-003, NTF-004, ORG-002 |
| relations-commerciales/creditlimitchange | REL-003, REL-012, REL-013 |
| relations-commerciales/customerprice | CAT-015, CAT-002, CAT-003, CAT-007, CAT-017, CAT-008, CAT-009, CAT-010, CAT-029, CAT-030, CAT-042, SYNC-027, SYNC-034, CAT-043 |
| relations-commerciales/customerrelationship | ACC-002, ORG-018, REL-001, REL-002, REL-004, REL-005, REL-007, REL-008, REL-009, REL-010, REL-016, REL-017, REL-025, REL-027, REL-030 |
| relations-commerciales/customerrelationship/cloisonnement | SYNC-004 |
| relations-commerciales/customerrelationship/comptoirs | REL-006, REL-011, DLV-009 |
| relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme | REL-007, ORD-009, REL-022, REL-026, SYNC-011 |
| relations-commerciales/customerrelationship/fin-de-relation | REL-015, REL-017, REL-019 |
| relations-commerciales/customerrelationship/invitation-d-un-fournisseur-par-un | REL-020, REL-021, REL-026 |
| relations-commerciales/customerrelationship/organisation-cliente | ORD-010, REL-018 |
| relations-commerciales/customerrelationship/plafond-de-credit-une-seule-regle | DLV-003, REL-012, DLV-007 |
| relations-commerciales/customerrelationshipreassignment | REL-014, REL-024, REL-027 |
| relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et | REL-023, REL-028, REL-029, REL-030 |
| relations-commerciales/customerrelationshipreassignment/correction-par-le-fournisseur | REL-024, REL-031 |
| synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne | CAT-039, FIN-019, DLV-011, DLV-012, SYNC-009, SYNC-010, SYNC-012, SYNC-013, SYNC-014, SYNC-015, SYNC-016, SYNC-017, SYNC-018, SYNC-019, SYNC-020, SYNC-021, SYNC-028, SYNC-029, SYNC-030, SYNC-031, SYNC-032, SYNC-033, SYNC-034, SYNC-035, SYNC-039, SYNC-041 |
| synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone | CAT-033, CAT-034, ORG-028, ORG-027, REL-025, SYNC-001, SYNC-003, ORG-039, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-011, SYNC-024, SYNC-025, SYNC-026, SYNC-027, SYNC-036, SYNC-037, SYNC-038, SYNC-040, SYNC-042 |
| synchronisation-hors-ligne/fraicheur-synchronisation-automatique | SYNC-017 |
| synchronisation-hors-ligne/principes-la-synchronisation-classique | FND-008, SYNC-001, SYNC-003 |
| synchronisation-hors-ligne/syncarchive | SYNC-002, SYNC-009, SYNC-022, SYNC-023 |

## ASVS 5.0.0
| requirement | stories |
|---|---|
| v5.0.0-1.2.4 | CAT-006 |
| v5.0.0-2.2.1 | FND-003, FND-004, FND-005, FND-008, FND-009, FND-014, PER-014, NTF-002, AUTH-030, AUTH-039, BIL-008, BIL-010, CAT-014, CAT-018, CAT-016, CAT-033, CAT-034, BIL-009, ORD-004, ORD-007, CAT-004, CAT-022, ORD-027, DLV-014, ORD-009, ORD-038, CAT-039, CAT-040, CAT-042, DLV-016, ORD-031, ORD-032, DLV-007, DLV-008, DLV-009, SYNC-003, BIL-018, BIL-027, BIL-015, BIL-033, BIL-017, BIL-034, SYNC-009, SYNC-012, SYNC-014, SYNC-029, ORD-033, SYNC-031, SYNC-032, SYNC-034, SYNC-043, CAT-041, CAT-043, ORD-034, ORD-035, ORD-036, ORD-037, ORD-040, ORD-042, ORD-043, ORD-045, SYNC-049 |
| v5.0.0-2.2.3 | FND-011, PER-003, PER-008, PER-009, PER-010, PER-013, NTF-001, AUTH-038, ORG-001, CAT-001, CAT-012, CAT-013, CAT-015, CAT-032, ORG-002, ORG-003, ADM-001, FIN-011, FIN-014, ORG-012, ORG-020, BIL-001, BIL-003, BIL-012, ORG-021, ORG-022, ORG-023, ORG-038, BIL-009, REL-001, REL-002, CAT-002, ORD-001, DLV-001, ORD-002, ORD-003, DLV-002, ORD-004, ORD-005, ORD-006, ORD-022, ORD-024, ORD-025, ORD-026, REL-004, CAT-003, CAT-017, CAT-019, ADM-003, FIN-002, BIL-002, BIL-004, BIL-032, BIL-038 |
| v5.0.0-2.3.1 | ACC-003, ORD-002, ORD-003, DLV-002, ORD-008, DLV-004, DLV-005, DLV-006, CAT-003, ORD-011, ORD-012, ORD-016, ORD-017, ORD-023, ORD-038, ORD-014, REL-015, REL-019, DLV-017, SYNC-013, SYNC-016, SYNC-017, SYNC-028, DLV-018, DLV-019, SYNC-046 |
| v5.0.0-2.3.2 | CAT-038 |
| v5.0.0-2.3.3 | ACC-007, AUTH-025, CAT-021, CAT-044, CAT-046, ORG-004, ORG-006, ORG-015, ORG-016, BIL-012, ORG-030, IMG-011, IMG-012, ORD-006, ORD-018, REL-006, CAT-020, CAT-026, CAT-036, CAT-037, DLV-014, REL-007, ORD-009, ORD-010, CAT-010, ORD-013, REL-012, ADM-009, ADM-013, FIN-002, CAT-045, PRIV-004, REL-021, REL-023, REL-024, REL-025, FIN-003, FIN-004, DLV-007, DLV-008, DLV-009, DLV-010, FIN-005, FIN-008, FIN-009, FIN-012, FIN-013, FIN-015, FIN-017, FIN-018, FIN-021, REL-027, REL-028, REL-029, REL-031, ORG-034, BIL-011, BIL-013, BIL-019, BIL-020, BIL-027, BIL-014, BIL-021, BIL-028, BIL-029, BIL-030, BIL-031, BIL-026, BIL-036, BIL-037, BIL-023, BIL-024, BIL-038, BIL-025, BIL-039, SYNC-009, SYNC-011, SYNC-012, SYNC-014, SYNC-015, SYNC-022, SYNC-033, SYNC-035 |
| v5.0.0-2.3.4 | ACC-007, AUTH-003, ORG-006, ORD-008, DLV-005, REL-025, FIN-003, DLV-007, SYNC-013, SYNC-015 |
| v5.0.0-2.4.1 | PER-006, AUTH-002, AUTH-004, AUTH-009, AUTH-012, AUTH-019, AUTH-022, AUTH-024, AUTH-028, AUTH-029, AUTH-031, AUTH-033, AUTH-037, ORG-007, ORG-018, ORG-026, ORG-029, BIL-007, BIL-009, ADM-011, REL-020, BIL-015, BIL-033, SYNC-011 |
| v5.0.0-5.2.1 | IMG-003 |
| v5.0.0-5.2.2 | IMG-003 |
| v5.0.0-5.2.6 | IMG-003 |
| v5.0.0-5.3.2 | FND-013, IMG-002, IMG-006 |
| v5.0.0-6.2.1 | AUTH-005, AUTH-010, AUTH-020, AUTH-030 |
| v5.0.0-6.2.2 | AUTH-021 |
| v5.0.0-6.2.3 | AUTH-021, PRIV-002 |
| v5.0.0-6.2.4 | AUTH-005, AUTH-010 |
| v5.0.0-6.2.5 | AUTH-005 |
| v5.0.0-6.2.8 | AUTH-005 |
| v5.0.0-6.2.9 | AUTH-005 |
| v5.0.0-6.3.1 | AUTH-012, AUTH-013, AUTH-028, AUTH-043, AUTH-044, ADM-006 |
| v5.0.0-6.3.2 | ADM-005 |
| v5.0.0-6.3.3 | AUTH-013, AUTH-036, ADM-001, ADM-004, ADM-006, ADM-008 |
| v5.0.0-6.3.8 | AUTH-009, AUTH-013, AUTH-015, AUTH-019, AUTH-031 |
| v5.0.0-6.4.3 | AUTH-011, AUTH-015, AUTH-019, AUTH-020, AUTH-032, AUTH-033, AUTH-034, AUTH-036, AUTH-035, ADM-007 |
| v5.0.0-6.4.4 | ADM-008, ADM-019, ADM-020 |
| v5.0.0-6.4.6 | ADM-019 |
| v5.0.0-6.5.1 | AUTH-001, AUTH-003, AUTH-013, AUTH-014, AUTH-015, AUTH-022, AUTH-023, AUTH-024, AUTH-025, AUTH-027, ADM-004, ADM-007 |
| v5.0.0-6.5.3 | AUTH-001, AUTH-003 |
| v5.0.0-6.5.4 | AUTH-002 |
| v5.0.0-6.6.1 | AUTH-002, AUTH-009, AUTH-024, AUTH-029 |
| v5.0.0-6.6.2 | ADM-018, ADM-020 |
| v5.0.0-6.6.3 | AUTH-003, ORG-041, ORG-025, ORG-026 |
| v5.0.0-7.2.1 | ADM-006 |
| v5.0.0-7.2.2 | AUTH-007, AUTH-008, AUTH-016 |
| v5.0.0-7.2.4 | AUTH-008, AUTH-010, AUTH-014, AUTH-041 |
| v5.0.0-7.4.1 | AUTH-007, AUTH-016, AUTH-017, AUTH-041, ADM-020 |
| v5.0.0-7.4.2 | AUTH-008, ORG-010, ADM-013, ADM-014, PRIV-002, SYNC-008 |
| v5.0.0-7.4.3 | AUTH-018, AUTH-020, AUTH-021, AUTH-034 |
| v5.0.0-7.4.5 | AUTH-018 |
| v5.0.0-7.5.2 | AUTH-042 |
| v5.0.0-8.2.1 | PER-006, PER-008, ACC-001, ACC-002, ACC-003, ACC-004, ACC-005, ACC-006, ACC-008, BIL-008, ORG-003, ORG-004, ORG-005, ORG-007, ORG-009, ORG-010, ORG-013, ORG-014, ORG-015, ORG-016, ORG-017, ORG-018, ORG-019, ORG-028, ORG-030, ORG-035, IMG-005, IMG-008, IMG-009, IMG-010, IMG-011, ORG-040, ORG-024, ORG-025, ORG-027, ORG-033, ORG-037, ORG-031, ORG-042, ORG-044, ORG-045, DLV-004, DLV-005, DLV-006, CAT-004, CAT-005, CAT-022, CAT-023, CAT-024, CAT-025, CAT-026, CAT-027, REL-007, ORD-010, ORD-011, ORD-012, ORD-015, ORD-016, CAT-008, CAT-009, CAT-010, CAT-029, CAT-030, ORD-013, ORD-014, REL-010, REL-011, REL-012, ADM-009, ADM-010, ADM-011, ADM-012, ADM-013, ADM-014, ADM-015, ADM-016, ADM-017, ADM-019, REL-015, CAT-011, CAT-031, REL-018, REL-019, REL-020, REL-021, REL-024, FIN-004, DLV-007, DLV-009, FIN-005, FIN-006, FIN-007, FIN-008, FIN-009, FIN-012, FIN-013, FIN-015, FIN-016, FIN-019, DLV-011, FIN-020, REL-031, ORG-034, BIL-005, BIL-006, BIL-018, BIL-014, BIL-029, BIL-030, BIL-016, BIL-017, BIL-034, BIL-023, BIL-024, BIL-025, ORG-036, SYNC-010, SYNC-011, SYNC-012, SYNC-013, SYNC-014, SYNC-015, SYNC-018, SYNC-019, SYNC-021, SYNC-022, SYNC-023, SYNC-029, SYNC-030, SYNC-031, SYNC-032, SYNC-033, SYNC-034, SYNC-039, ORD-044 |
| v5.0.0-8.2.2 | NTF-003, NTF-004, NTF-005, AUTH-011, AUTH-017, AUTH-018, AUTH-029, AUTH-032, CAT-015, CAT-032, CAT-033, CAT-034, CAT-035, CAT-044, ORG-005, ORG-008, ORG-011, IMG-004, IMG-005, IMG-008, IMG-009, IMG-010, IMG-011, CAT-038, REL-002, CAT-002, ORD-005, ORD-026, ORD-029, ORD-030, REL-005, DLV-003, DLV-006, DLV-013, CAT-005, CAT-006, CAT-007, CAT-017, CAT-019, CAT-020, CAT-023, CAT-024, CAT-025, CAT-026, CAT-027, CAT-028, CAT-036, CAT-037, ORD-027, ORD-009, ORD-017, REL-008, REL-009, CAT-008, CAT-009, CAT-010, CAT-029, CAT-030, CAT-039, ORD-019, ORD-020, ORD-021, REL-013, REL-016, CAT-011, CAT-031, CAT-045, ORD-032, PRIV-001, REL-017, REL-018, REL-021, REL-022, REL-023, REL-024, FIN-009, FIN-010, FIN-016, DLV-015, FIN-021, REL-028, REL-029, REL-030, SYNC-001, SYNC-003, BIL-013, BIL-019, BIL-020, BIL-028, BIL-031, BIL-016, BIL-017, BIL-025, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-010, SYNC-020, SYNC-024, SYNC-025, SYNC-026, SYNC-027, SYNC-028, SYNC-030, SYNC-036, SYNC-037, SYNC-038, SYNC-039, SYNC-040, SYNC-042, CAT-043, ORD-039, ORD-044, SYNC-045, SYNC-046 |
| v5.0.0-8.2.3 | PER-005, PER-007, PER-011, ACC-002, ACC-004, ORG-009, ORG-019, ORD-007, REL-005, DLV-003, CAT-007, REL-010, REL-017, FIN-010, FIN-019, DLV-011, DLV-012, REL-026, SYNC-004, SYNC-006, SYNC-007, SYNC-010 |
| v5.0.0-8.3.1 | FND-002, PER-004, ACC-001, FIN-011, FIN-014, IMG-006, ORG-027, REL-003, DLV-013, CAT-028, REL-014, ADM-002, FIN-001, SYNC-001, SYNC-002, SYNC-040, SYNC-041 |
| v5.0.0-8.4.1 | ORG-005, REL-005, REL-008, ORD-019 |
| v5.0.0-9.1.1 | AUTH-006 |
| v5.0.0-9.1.2 | AUTH-006 |
| v5.0.0-9.2.1 | AUTH-006, AUTH-016 |
| v5.0.0-9.2.2 | AUTH-006, ADM-006 |
| v5.0.0-11.2.1 | AUTH-040 |
| v5.0.0-11.3.2 | ADM-004 |
| v5.0.0-11.4.2 | PER-002, PER-003, AUTH-002, AUTH-005, AUTH-026 |
| v5.0.0-11.5.1 | FND-014 |
| v5.0.0-13.2.4 | FND-013 |
| v5.0.0-13.3.1 | AUTH-040 |
| v5.0.0-13.3.2 | FND-002, ADM-005, PRIV-003 |
| v5.0.0-13.4.2 | FND-000, FND-011 |
| v5.0.0-14.2.4 | FND-001, FND-010, FND-011, PER-002, PER-009, PRIV-001, PRIV-002, PRIV-004, PRIV-006, PRIV-003, PRIV-005, SYNC-023 |
| v5.0.0-15.2.1 | FND-000, AUTH-026 |
| v5.0.0-15.2.2 | FND-008, FND-009 |
| v5.0.0-15.2.3 | PER-001 |
| v5.0.0-15.3.1 | FND-012, PER-005, PER-006, PER-007, PER-011, PER-012, NTF-003, AUTH-018, ORG-005, ORG-008, ORG-018, ORG-019, ORG-028, ORG-029, ORG-031, BIL-007, ORD-007, REL-005, DLV-003, CAT-006, CAT-007, ORD-028, ORD-023, REL-008, REL-009, CAT-009, ORD-019, ORD-020, ORD-021, ADM-012, REL-016, REL-018, REL-022, FIN-010, FIN-019, DLV-011, FIN-020, REL-026, REL-030, REL-032, SYNC-003, ORG-039, ORG-032, ORG-043, BIL-015, BIL-033, BIL-016, ORG-036, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-020, SYNC-021, SYNC-023, SYNC-024, SYNC-025, SYNC-026, SYNC-027, SYNC-036, SYNC-037, SYNC-038, SYNC-042, ORD-041, SYNC-047, REL-033, SYNC-048 |
| v5.0.0-15.3.3 | PER-007, PER-012, PER-013, NTF-004, CAT-032, CAT-033, CAT-034, CAT-035, ORG-004, ORG-007, ORG-009, ORG-011, ORG-013, ORG-028, ORG-035, ORG-038, IMG-002, IMG-004, IMG-005, IMG-008, IMG-010, ORG-040, ORG-024, ORG-042, BIL-009, CAT-004, CAT-005, CAT-022, CAT-023, CAT-024, CAT-025, CAT-036, ORD-028, REL-007, ORD-009, ORD-011, ORD-015, CAT-008, CAT-029, CAT-039, ORD-013, ORD-014, REL-010, REL-011, ADM-011, CAT-011, CAT-031, REL-017, REL-020, FIN-004, DLV-008, FIN-005, FIN-006, FIN-007, FIN-012, FIN-015, REL-027, REL-029, REL-031, BIL-005, BIL-006, BIL-018, BIL-029, BIL-030, BIL-023, BIL-024, SYNC-010, SYNC-030, SYNC-031, SYNC-032, SYNC-034, SYNC-035, SYNC-041, ORD-037, ORD-039, DLV-019, SYNC-044, SYNC-047, SYNC-048 |
| v5.0.0-16.2.5 | FND-007, FND-012, PER-014, NTF-002, AUTH-041, ADM-018, ORG-033, ORG-037 |
| v5.0.0-16.3.1 | AUTH-010, AUTH-011, AUTH-013, AUTH-014, AUTH-016, AUTH-020, AUTH-023, AUTH-025, AUTH-028, AUTH-031, AUTH-032, AUTH-034, AUTH-037, IMG-001, ORG-015, ORG-016, IMG-007, REL-012, ADM-002, ADM-008, ADM-009, ADM-010, ADM-013, ADM-014, ADM-016, ADM-017, PRIV-002, REL-023, FIN-016, FIN-017, REL-028, SYNC-002, BIL-019, BIL-020, BIL-014, BIL-034, BIL-035, SYNC-009, SYNC-019, SYNC-022 |
| v5.0.0-16.3.2 | ACC-006, FIN-022, SYNC-018 |
| v5.0.0-16.3.3 | PER-004, AUTH-004, IMG-012, REL-003, REL-004, REL-013, REL-014, ADM-015, FIN-018, PRIV-003, BIL-022, SYNC-016, SYNC-017, SYNC-018 |
| v5.0.0-16.5.1 | FND-006, FND-012 |
| v5.0.0-16.5.3 | BIL-021, BIL-022, BIL-026, BIL-039 |
