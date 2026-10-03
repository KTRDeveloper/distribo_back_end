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
| Organization.status:enum | ORG-001, ORG-016, ORG-017 | ORG-001: required and enum; ORG-016: close; ORG-017: reopen |
| Collaboration:required | ORG-003 | ORG-003: table rules |
| Collaboration.role:enum | ORG-003, ORG-005, ORG-007, ORG-009 | ORG-003: table rules; ORG-005: details; ORG-007: refusals; ORG-009: change |
| Collaboration.status:enum | ORG-003, ORG-007, ORG-010 | ORG-003: table rules; ORG-007: re-invite; ORG-010: revoke |
| Collaboration:fk | ORG-003 | ORG-003: table rules |
| CustomerRelationship:required | REL-001 | REL-001: required |
| CustomerRelationship.status:enum | REL-001 | REL-001: enums and keys |
| CustomerRelationship.ended_by_party:enum | REL-001 | REL-001: enums and keys |
| CustomerRelationship:fk | REL-001 | REL-001: enums and keys |
| CustomerPrice:required | CAT-002 | CAT-002: author and keys |
| CustomerPrice:fk | CAT-002 | CAT-002: author and keys |
| CustomerRelationshipReassignment:required | REL-014 | REL-014: required and keys |
| CustomerRelationshipReassignment:fk | REL-014 | REL-014: required and keys |
| CreditLimitChange:required | REL-003 | REL-003: add and read |
| CreditLimitChange:fk | REL-003 | REL-003: author and key |
| Product:required | CAT-001, CAT-004, CAT-011 | CAT-001: required and key; CAT-004: create; CAT-011: copy |
| Product.status:enum | CAT-001, CAT-005, CAT-006 | CAT-001: price rules; CAT-005: retire and restore; CAT-006: filters |
| Product:fk | CAT-001 | CAT-001: required and key |
| Order:required | ORD-001 | ORD-001: required |
| Order.placed_by_party:enum | ORD-001 | ORD-001: enums and keys |
| Order.status:enum | ORD-001 | ORD-001: enums and keys |
| Order.cancelled_by_party:enum | ORD-001 | ORD-001: enums and keys |
| Order:fk | ORD-001 | ORD-001: enums and keys |
| OrderLine:required | ORD-004 | ORD-004: keys and required |
| OrderLine:fk | ORD-004 | ORD-004: keys and required |
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
| Subscription:required | ORG-012 | ORG-012: required enum key |
| Subscription.status:enum | ORG-012, ORG-014 | ORG-012: required enum key; ORG-014: end |
| Subscription:fk | ORG-012 | ORG-012: required enum key |
| Report:required | ADM-003 | ADM-003: insert rules |
| Report.status:enum | ADM-003 | ADM-003: insert rules |
| Report.decision:enum | ADM-003 | ADM-003: insert rules |
| Report:fk | ADM-003 | ADM-003: defaults and keys |
| Administrator:required | ADM-001 | ADM-001: insert rules |
| Administrator.role:enum | ADM-001 | ADM-001: insert rules |
| Administrator:fk | ADM-001 | ADM-001: person key |
| AdminAction:required | ADM-002 | ADM-002: insert rules |
| AdminAction.action:enum | ADM-002 | ADM-002: insert rules |
| AdminAction:fk | ADM-002 | ADM-002: insert rules |
| Notification:required | NTF-001, NTF-002 | NTF-001: defaults; NTF-002: store |
| Notification.read_status:enum | NTF-001, NTF-004 | NTF-001: enum and fk; NTF-004: mark one |
| Notification:fk | ORG-002 | ORG-002: unknown organization; ORG-002: recipient key |
| SyncArchive:required | SYNC-002 | SYNC-002: required and keys |
| SyncArchive:fk | SYNC-002 | SYNC-002: required and keys |
| OtpChallenge:required | AUTH-001 | AUTH-001: defaults |
| OtpChallenge.purpose:enum | AUTH-001 | AUTH-001: enums and fk |
| OtpChallenge.channel:enum | AUTH-001 | AUTH-001: enums and fk |
| OtpChallenge:fk | AUTH-001 | AUTH-001: enums and fk |
| Device:required | AUTH-007 | AUTH-007: device defaults |
| Device.platform:enum | AUTH-007 | AUTH-007: enums and keys |
| Device:fk | AUTH-007 | AUTH-007: enums and keys |
| RefreshToken:required | AUTH-007 | AUTH-007: token rules |
| RefreshToken.token_hash:unique | AUTH-007 | AUTH-007: token rules |
| RefreshToken.revoked_reason:enum | AUTH-007 | AUTH-007: enums and keys |
| RefreshToken:fk | AUTH-007 | AUTH-007: enums and keys |
| C-01 | FND-005, FND-011, PER-002, NTF-001, AUTH-001, AUTH-007, ORG-001, ORG-003, ORG-012, REL-001, CAT-001, CAT-002, ORD-001, ORD-004, DLV-001 | FND-005: column helper; FND-011: fixture boundaries; PER-002: table shape; NTF-001: defaults; AUTH-001: defaults; AUTH-007: device defaults; ORG-001: defaults; ORG-003: column types and defaults; ORG-012: row; REL-001: defaults; CAT-001: defaults; CAT-002: row; ORD-001: defaults; ORD-004: amount rule; DLV-001: row |
| C-02 | FND-011, PER-003, PER-009, AUTH-010, AUTH-011, AUTH-024, AUTH-025, REL-023, PRIV-002 | FND-011: migration preflight; PER-003: phone rules; PER-009: valid Person fixtures; PER-009: isolated enum failures; AUTH-010: guest completed; AUTH-011: recycled; AUTH-024: refusals; AUTH-025: change; REL-023: contest; PRIV-002: anonymize |
| C-03 | FND-011, PER-003, PER-007, PER-009, AUTH-010, AUTH-020, AUTH-023, AUTH-025, PRIV-002 | FND-011: migration preflight; FND-011: atomic email change; FND-011: whitespace boundaries; FND-011: fixture boundaries; PER-003: completeness; PER-003: email dates; PER-007: email reset; PER-009: valid Person fixtures; PER-009: isolated enum failures; AUTH-010: new person; AUTH-020: reset; AUTH-023: confirm; AUTH-025: after taken number; PRIV-002: anonymize |
| C-04 | REL-003, REL-012, REL-014, ADM-001, ADM-003, CAT-002, CAT-008, CAT-010, ORD-001, ORD-004, FIN-001, FIN-011, FIN-014, DLV-001 | REL-003: author and key; REL-012: set; REL-014: required and keys; ADM-001: insert rules; ADM-003: insert rules; CAT-002: author and keys; CAT-008: create; CAT-010: copy; ORD-001: enums and keys; ORD-004: price gap; FIN-001: keys and author; FIN-011: insert rules; FIN-014: insert rules; DLV-001: keys and author |
| C-05 | ORG-003, ORG-004, ORG-007, ORG-008, ORG-011, ORG-015 | ORG-003: table rules; ORG-003: one owner; ORG-003: number released; ORG-004: create; ORG-007: invite guest; ORG-008: accept; ORG-011: toggle; ORG-015: transfer |
| C-06 | REL-002, REL-006, REL-007, REL-010, REL-011, REL-020, REL-025, SYNC-011 | REL-002: parties; REL-006: counter; REL-007: new customer; REL-010: counter label; REL-011: add; REL-020: person invites; REL-025: refusals; SYNC-011: new customer |
| C-07 | REL-002, REL-007, REL-020, REL-021, REL-024, REL-025 | REL-002: pair rule; REL-002: two counters; REL-007: existing; REL-020: refusals; REL-021: existing relationship; REL-024: existing; REL-025: merge |
| C-08 | REL-002, REL-020, REL-021 | REL-002: state rules; REL-020: person invites; REL-021: accept |
| C-09 | REL-002, REL-015, REL-017, REL-019 | REL-002: state rules; REL-015: end; REL-015: reopen; REL-017: end and reopen; REL-019: end and reopen |
| C-10 | REL-004, REL-006, REL-007, REL-011, REL-012, REL-020 | REL-004: default; REL-004: rules; REL-004: journal; REL-006: counter; REL-007: new customer; REL-011: add; REL-012: set; REL-020: person invites |
| C-11 | CAT-002, CAT-008, CAT-009, CAT-010 | CAT-002: uniqueness; CAT-002: foreign product; CAT-008: create; CAT-009: remove; CAT-010: copy |
| C-12 | REL-014, REL-023, REL-024 | REL-014: contestation rule; REL-023: contest; REL-024: correct |
| C-13 | CAT-001, CAT-004, CAT-005, CAT-011 | CAT-001: price rules; CAT-001: price date; CAT-004: create; CAT-004: limits; CAT-005: price change; CAT-011: copy |
| C-14 | ORD-003, ORD-009, ORD-010, ORD-013 | ORD-003: creation states; ORD-009: first order; ORD-010: organization order; ORD-013: delivery cost |
| C-15 | CAT-003, ORD-005, ORD-009, ORD-013 | CAT-003: active product; ORD-005: product rule; ORD-005: minimum quantity; ORD-009: refusals; ORD-013: refusals |
| C-16 | ORD-002, ORD-008, ORD-012, ORD-016, ORD-017 | ORD-002: cancellation columns; ORD-008: cancellation fields; ORD-012: refuse; ORD-016: cancel; ORD-017: person cancels |
| C-17 | ORD-002, ORD-009, ORD-010, ORD-013 | ORD-002: pending is customer's; ORD-009: prices and totals; ORD-010: same rules; ORD-013: reference price |
| C-18 | ORD-002, ORD-008, ORD-014 | ORD-002: steps; ORD-002: frozen; ORD-008: steps; ORD-014: edit fields |
| C-19 | ORD-002, ORD-006, ORD-007 | ORD-002: delivery columns; ORD-006: inconsistent; ORD-006: delivered quantities; ORD-007: total |
| C-20 | ORD-004, ORD-005, ORD-011 | ORD-004: amount rule; ORD-004: price gap; ORD-004: customer orders; ORD-005: customer order prices; ORD-011: lower price |
| C-21 | DLV-002, DLV-004, DLV-005, DLV-006 | DLV-002: state rules; DLV-002: one in progress; DLV-002: membership; DLV-004: assign; DLV-005: simultaneous; DLV-006: fail |
| C-22 | DLV-010 | DLV-010: cancel |
| C-23 | FIN-001, FIN-004, FIN-005, FIN-006, FIN-007, FIN-010 | FIN-001: balance effect; FIN-001: amount and mode; FIN-004: record; FIN-005: refund; FIN-006: credit note; FIN-007: record; FIN-010: supplier reads |
| C-24 | FIN-002 | FIN-002: sale rules |
| C-25 | FIN-002, FIN-009 | FIN-002: reversal rules; FIN-009: reverse |
| C-26 | DLV-009 | DLV-009: payment match |
| C-27 | FIN-011, FIN-012, FIN-013, FIN-014, FIN-015, FIN-016, FIN-017 | FIN-011: insert rules; FIN-012: record; FIN-013: cancel; FIN-014: insert rules; FIN-015: record; FIN-016: cancel; FIN-017: automatic |
| C-28 | ADM-003, ADM-011, ADM-013 | ADM-003: insert rules; ADM-011: report person; ADM-013: refusals |
| C-29 | ADM-001, ADM-002, ADM-006, ADM-007, ADM-009, ADM-010, SYNC-002, SYNC-022 | ADM-001: insert rules; ADM-002: insert rules; ADM-006: sign in; ADM-007: refusals; ADM-009: appoint; ADM-010: remove; SYNC-002: journal link; SYNC-022: replay |
| C-30 | NTF-001, NTF-002 | NTF-001: guest recipient; NTF-001: pair rule; NTF-002: invalid input; NTF-002: database checks |
| C-31 | ORG-012, ORG-013 | ORG-012: one active; ORG-013: second active |
| C-32 | PER-004, AUTH-025, REL-003, REL-014, ADM-002, SYNC-002 | PER-004: immutable; AUTH-025: journal immutable; REL-003: immutable; REL-014: immutable; ADM-002: immutable; SYNC-002: immutable |
| C-33 | AUTH-001, AUTH-002, AUTH-003, AUTH-013, AUTH-014, AUTH-015, AUTH-019, AUTH-022, AUTH-023, AUTH-024, ADM-007, ADM-008 | AUTH-001: limits; AUTH-002: foreign number; AUTH-003: attempts; AUTH-013: sms code; AUTH-014: email channel; AUTH-015: email sign-in; AUTH-019: sms; AUTH-022: code sent; AUTH-023: bad code; AUTH-024: code sent; ADM-007: register; ADM-008: nothing happens |
| C-34 | AUTH-007, AUTH-008, AUTH-016, SYNC-008 | AUTH-007: token rules; AUTH-008: revoke; AUTH-016: reuse; SYNC-008: full pull |
| C-35 | FND-002, PER-002, PER-004, NTF-001, ORG-001, ORG-003, REL-001, REL-003, REL-014, REL-025, CAT-001, CAT-002, ORD-001, ORD-004, DLV-001, SYNC-002, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007 | FND-002: server time; PER-002: defaults and trigger; PER-004: insert and read; NTF-001: defaults; ORG-001: server time; ORG-003: column types and defaults; REL-001: defaults; REL-003: add and read; REL-014: add and read; REL-025: merge; CAT-001: defaults; CAT-002: row; ORD-001: defaults; ORD-004: amount rule; DLV-001: row; SYNC-002: add and read; SYNC-003: first pull; SYNC-004: seller; SYNC-005: seller; SYNC-006: lines; SYNC-007: customer |
| C-36 | SYNC-009, SYNC-011, SYNC-013, SYNC-015, SYNC-018 | SYNC-009: unknown table; SYNC-011: duplicate merged; SYNC-013: crossed; SYNC-015: repeat; SYNC-018: set aside |
| C-37 | ORG-006, FIN-003, FIN-018 | ORG-006: add and subtract; ORG-006: parallel; FIN-003: cache effects; FIN-018: clean |
| C-38 | ACC-007, FIN-004 | ACC-007: first runs; ACC-007: repeat replays; FIN-004: retry |
| C-39 | FND-002, PER-004, REL-003, REL-014, ADM-002, FIN-001, SYNC-002 | FND-002: immutable pattern; PER-004: immutable; REL-003: immutable; REL-014: immutable; ADM-002: immutable; FIN-001: immutable; SYNC-002: immutable |
| CM-01 | PRIV-002 | PRIV-002: anonymize |
| CM-02 | PRIV-001, PRIV-002 | PRIV-001: nothing blocks; PRIV-002: refusals |
| CM-03 | PER-005, AUTH-011, ORG-004, ORG-008, ORG-009, ORG-010, ORG-015, ORG-016, REL-023, REL-024, SYNC-008, SYNC-019 | PER-005: scope version; AUTH-011: recycled; ORG-004: scope version; ORG-008: accept; ORG-009: change; ORG-010: revoke; ORG-015: counters and notice; ORG-016: team and subscription; REL-023: notices; REL-024: correct; SYNC-008: rights changed; SYNC-019: powers refused |
| CM-04 | AUTH-011, AUTH-015, AUTH-025 | AUTH-011: recycled; AUTH-015: email sign-in; AUTH-025: change |
| CM-05 | AUTH-005, AUTH-010, AUTH-012, AUTH-013, AUTH-020, AUTH-021 | AUTH-005: rules; AUTH-005: hash and verify; AUTH-010: new person; AUTH-012: environment; AUTH-013: lock; AUTH-020: reset; AUTH-021: change |
| CM-06 | AUTH-002, AUTH-003 | AUTH-002: issue; AUTH-003: single use; AUTH-003: expiry |
| CM-07 | AUTH-002, AUTH-004, AUTH-009, AUTH-019, AUTH-022, AUTH-024 | AUTH-002: limits; AUTH-004: caps; AUTH-009: limits; AUTH-019: limits; AUTH-022: limits; AUTH-024: limits |
| CM-08 | AUTH-006, AUTH-008, AUTH-014, AUTH-016 | AUTH-006: payload; AUTH-008: issue; AUTH-014: sign in; AUTH-016: rotation |
| CM-09 | ORG-003, ORG-009, ORG-010, ORG-015 | ORG-003: one owner; ORG-003: swap; ORG-009: refusals; ORG-010: immediate; ORG-015: transfer |
| CM-10 | ORG-016, ORG-017, ORD-018 | ORG-016: close; ORG-017: reopen; ORD-018: pending refused |
| CM-11 | CAT-003, CAT-007 | CAT-003: reference price; CAT-007: own price |
| CM-12 | ACC-003, ORD-002, ORD-008, ORD-011, ORD-012, DLV-005, DLV-006, SYNC-013 | ACC-003: steps; ORD-002: steps; ORD-008: steps; ORD-011: accept; ORD-012: refuse; DLV-005: unassigned; DLV-006: fail; SYNC-013: departure |
| CM-13 | DLV-007, DLV-009 | DLV-007: paid in full; DLV-009: counter sale |
| CM-14 | FND-003, ORD-004, ORD-007 | FND-003: rounding; ORD-004: amount rule; ORD-007: line amount |
| CM-15 | DLV-007, SYNC-017 | DLV-007: credit rule; SYNC-017: credit exceeded |
| CM-16 | ORD-005, ORD-011, SYNC-012 | ORD-005: customer order prices; ORD-011: lower price; SYNC-012: price gap |
| CM-17 | FIN-003, FIN-012, FIN-015, FIN-018 | FIN-003: cache effects; FIN-012: record; FIN-015: record; FIN-018: held drift |
| CM-18 | FIN-017 | FIN-017: automatic |
| CM-19 | REL-005, REL-008, REL-009, REL-010, REL-016, REL-017, REL-018, REL-022 | REL-005: supplier view; REL-005: customer view; REL-008: list; REL-009: open; REL-010: edit; REL-016: list; REL-017: set label; REL-018: list; REL-022: views |
| CM-20 | PER-005, PER-006, REL-005 | PER-005: public view; PER-006: indistinguishable; REL-005: supplier view |
| CM-21 | FIN-008 | FIN-008: return |
| CM-22 | DLV-008, DLV-012, SYNC-014 | DLV-008: partial and later; DLV-012: abandoned; SYNC-014: partial later |
| CM-23 | SYNC-013 | SYNC-013: crossed |
| CM-24 | REL-023, REL-024 | REL-023: refusals; REL-024: same customer |
| CM-25 | REL-021 | REL-021: accept |
| CM-26 | ORG-018 | ORG-018: found |
| CM-27 | SYNC-010, SYNC-012, SYNC-014, SYNC-015 | SYNC-010: computed ignored; SYNC-012: server amounts; SYNC-014: delivered offline; SYNC-015: payment |
| CM-28 | SYNC-009, SYNC-010, SYNC-016, SYNC-018 | SYNC-009: archived first; SYNC-010: honest lines; SYNC-016: old price; SYNC-018: refusal reported |
| CM-29 | SYNC-019 | SYNC-019: demoted manager |
| CM-30 | SYNC-003, SYNC-004, SYNC-006, SYNC-007 | SYNC-003: amount held; SYNC-004: driver; SYNC-006: seller; SYNC-007: seller ledger |
| CM-31 | SYNC-009, SYNC-016, SYNC-017 | SYNC-009: version and time; SYNC-016: dates; SYNC-017: restricted mode |
| CM-32 | SYNC-022 | SYNC-022: replay |
| CM-33 | ADM-013, ADM-014 | ADM-013: dismiss; ADM-013: suspend person; ADM-014: person cycle |
| CM-34 | ADM-008 | ADM-008: recovery |
| CM-35 | SYNC-002, PRIV-003 | SYNC-002: immutable; PRIV-003: retention periods |

## Design anchors
| anchor | stories |
|---|---|
| acces-et-securite/connexion-verrouillage-et-telephone | AUTH-013, AUTH-017, AUTH-018, ADM-006 |
| acces-et-securite/device | AUTH-007, AUTH-008, AUTH-014, AUTH-018, SYNC-008 |
| acces-et-securite/la-base-de-donnees-dernier-rempart | FND-002, PRIV-003 |
| acces-et-securite/la-couche-d-acces-et-la-table-des-regles | ACC-001, ACC-006, ACC-007 |
| acces-et-securite/otpchallenge | AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-022, ADM-007 |
| acces-et-securite/refreshtoken | AUTH-006, AUTH-007, AUTH-008, AUTH-016, AUTH-017 |
| annexe-la-table-des-regles/controles-a-l-arrivee | SYNC-016 |
| annexe-la-table-des-regles/etapes-d-une-commande | ACC-003, ORD-008 |
| annexe-la-table-des-regles/extrait-du-fichier | ACC-001 |
| annexe-la-table-des-regles/qui-et-ou | ACC-002, ACC-003, ACC-004, ACC-005, SYNC-010 |
| catalogue/product | CAT-001, CAT-003, CAT-004, CAT-005, CAT-006, CAT-007, CAT-011, ORD-005, SYNC-005 |
| commandes-et-livraisons/delivery | DLV-001, DLV-002, DLV-003, DLV-004, DLV-005, DLV-006, DLV-010, SYNC-013 |
| commandes-et-livraisons/order | ORD-001, ORD-002, ORD-006, ORD-007, ORD-008, ORD-009, ORD-010, ORD-011, ORD-013, ORD-014, ORD-015, ORD-017, ORD-019, ORD-020, ORD-021, SYNC-012 |
| commandes-et-livraisons/order/autres-regles | ORD-003, ORD-005, DLV-009 |
| commandes-et-livraisons/order/clore-une-commande-commande-livree | DLV-007, SYNC-014 |
| commandes-et-livraisons/order/le-reste-d-une-livraison-partielle | DLV-008, DLV-012 |
| commandes-et-livraisons/order/refus-et-annulation | ORD-012, ORD-016, ORD-017 |
| commandes-et-livraisons/orderline | FND-003, ORD-004, ORD-007, ORD-011, ORD-013, ORD-014, DLV-008 |
| contraintes-a-poser-au-niveau-base-de | FND-001, FND-002, FND-005, FND-011, PER-002, PER-003, PER-008, PER-009, ACC-007, NTF-001, AUTH-001, AUTH-007, ORG-001, ORG-003, REL-001, REL-002, REL-004, ADM-001, ADM-002, ADM-003, CAT-001, CAT-002, ORD-001, ORD-002, ORD-003, ORD-004, ORD-006, FIN-001, FIN-002, FIN-011, FIN-014, DLV-001, DLV-002, SYNC-002 |
| donnees-personnelles-et-conservation/cadre-juridique-le-cameroun | FND-007, PRIV-001 |
| donnees-personnelles-et-conservation/durees-de-conservation | PRIV-002, PRIV-003 |
| finances/expense | FIN-011, FIN-012, FIN-013, FIN-019, FIN-020 |
| finances/handover | ORG-006, ORG-019, FIN-003, FIN-014, FIN-015, FIN-016, FIN-017, FIN-018, DLV-011, SYNC-007 |
| finances/ledgerentry | ACC-004, FIN-001, FIN-002, FIN-003, FIN-004, FIN-005, FIN-006, FIN-009, FIN-010, FIN-018, FIN-020, SYNC-015 |
| finances/ledgerentry/reprise-de-cahier | FIN-007 |
| finances/ledgerentry/retour-rembourse | FIN-008 |
| finances/subscription | ORG-012, ORG-013, ORG-014 |
| gouvernance-de-la-plateforme/adminaction | ADM-002, ADM-009, ADM-010, ADM-013, ADM-014, ADM-015, SYNC-022 |
| gouvernance-de-la-plateforme/administrator | ADM-001, ADM-004, ADM-005, ADM-006, ADM-007, ADM-008, ADM-009, ADM-010 |
| identite-et-organisation/collaboration | ACC-005, ORG-003, ORG-004, ORG-005, ORG-006, ORG-007, ORG-008, ORG-009, ORG-010, ORG-011, ORG-015, ORG-019, FIN-017 |
| identite-et-organisation/organization | ORG-001, ORG-004, ORG-005, ORG-016, ORG-017, ORG-018, REL-006, ORD-018 |
| identite-et-organisation/person | FND-004, FND-011, PER-001, PER-002, PER-003, PER-005, PER-006, PER-007, PER-008, PER-009, AUTH-005, AUTH-006, AUTH-009, AUTH-010, AUTH-011, AUTH-012, AUTH-013, AUTH-014, AUTH-015, AUTH-019, AUTH-020, AUTH-021, AUTH-022, AUTH-023, AUTH-024, AUTH-025, AUTH-026, REL-005, REL-022, PRIV-001, PRIV-002 |
| identite-et-organisation/phonenumberchangelog | PER-004, AUTH-025 |
| legende | FND-003, FND-004, FND-005 |
| moderation/report | ADM-003, ADM-011, ADM-012, ADM-013, ADM-014 |
| notes-de-conception | FND-000, FND-006, FND-009, FND-010, FND-011 |
| notifications/notification | NTF-001, NTF-002, NTF-003, NTF-004, ORG-002 |
| relations-commerciales/creditlimitchange | REL-003, REL-012, REL-013 |
| relations-commerciales/customerprice | CAT-002, CAT-003, CAT-007, CAT-008, CAT-009, CAT-010 |
| relations-commerciales/customerrelationship | ACC-002, ORG-018, REL-001, REL-002, REL-004, REL-005, REL-007, REL-008, REL-009, REL-010, REL-016, REL-017, REL-025 |
| relations-commerciales/customerrelationship/cloisonnement | SYNC-004 |
| relations-commerciales/customerrelationship/comptoirs | REL-006, REL-011, DLV-009 |
| relations-commerciales/customerrelationship/entree-en-relation-le-numero-comme | REL-007, REL-022, ORD-009, SYNC-011 |
| relations-commerciales/customerrelationship/fin-de-relation | REL-015, REL-017, REL-019 |
| relations-commerciales/customerrelationship/invitation-d-un-fournisseur-par-un | REL-020, REL-021 |
| relations-commerciales/customerrelationship/organisation-cliente | REL-018, ORD-010 |
| relations-commerciales/customerrelationship/plafond-de-credit-une-seule-regle | REL-012, DLV-003, DLV-007 |
| relations-commerciales/customerrelationshipreassignment | REL-014, REL-024 |
| relations-commerciales/customerrelationshipreassignment/ce-n-est-pas-moi-erreurs-de-saisie-et | REL-023 |
| relations-commerciales/customerrelationshipreassignment/correction-par-le-fournisseur | REL-024 |
| synchronisation-hors-ligne/ce-que-le-serveur-fait-de-chaque-ligne | FIN-019, DLV-011, DLV-012, SYNC-009, SYNC-010, SYNC-012, SYNC-013, SYNC-014, SYNC-015, SYNC-016, SYNC-017, SYNC-018, SYNC-019, SYNC-020, SYNC-021 |
| synchronisation-hors-ligne/ce-que-recoit-et-garde-chaque-telephone | REL-025, SYNC-001, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-011 |
| synchronisation-hors-ligne/fraicheur-synchronisation-automatique | SYNC-017 |
| synchronisation-hors-ligne/principes-la-synchronisation-classique | FND-008, SYNC-001, SYNC-003 |
| synchronisation-hors-ligne/syncarchive | SYNC-002, SYNC-009, SYNC-022, SYNC-023 |

## ASVS 5.0.0
| requirement | stories |
|---|---|
| v5.0.0-1.2.4 | CAT-006 |
| v5.0.0-2.2.1 | FND-003, FND-004, FND-005, FND-008, FND-009, NTF-002, CAT-004, ORD-004, ORD-007, ORD-009, DLV-007, DLV-008, DLV-009, SYNC-003, SYNC-009, SYNC-012, SYNC-014 |
| v5.0.0-2.2.3 | FND-011, PER-003, PER-008, PER-009, NTF-001, ORG-001, ORG-002, ORG-003, ORG-012, REL-001, REL-002, REL-004, ADM-001, ADM-003, CAT-001, CAT-002, CAT-003, ORD-001, ORD-002, ORD-003, ORD-004, ORD-005, ORD-006, FIN-002, FIN-011, FIN-014, DLV-001, DLV-002 |
| v5.0.0-2.3.1 | ACC-003, REL-015, REL-019, CAT-003, ORD-002, ORD-003, ORD-008, ORD-011, ORD-012, ORD-014, ORD-016, ORD-017, DLV-002, DLV-004, DLV-005, DLV-006, SYNC-013, SYNC-016, SYNC-017 |
| v5.0.0-2.3.3 | ACC-007, AUTH-025, ORG-004, ORG-006, ORG-015, ORG-016, REL-006, REL-007, REL-012, REL-021, REL-023, REL-024, REL-025, ADM-009, ADM-013, CAT-010, ORD-006, ORD-009, ORD-010, ORD-013, ORD-018, FIN-002, FIN-003, FIN-004, FIN-005, FIN-008, FIN-009, FIN-012, FIN-013, FIN-015, FIN-017, FIN-018, DLV-007, DLV-008, DLV-009, DLV-010, SYNC-009, SYNC-011, SYNC-012, SYNC-014, SYNC-015, SYNC-022 |
| v5.0.0-2.3.4 | ACC-007, AUTH-003, ORG-006, REL-025, ORD-008, FIN-003, DLV-005, DLV-007, SYNC-013, SYNC-015 |
| v5.0.0-2.4.1 | PER-006, AUTH-002, AUTH-004, AUTH-009, AUTH-012, AUTH-019, AUTH-022, AUTH-024, ORG-007, ORG-018, REL-020, ADM-011, SYNC-011 |
| v5.0.0-6.2.1 | AUTH-005, AUTH-010, AUTH-020 |
| v5.0.0-6.2.2 | AUTH-021 |
| v5.0.0-6.2.3 | AUTH-021, PRIV-002 |
| v5.0.0-6.2.4 | AUTH-005, AUTH-010 |
| v5.0.0-6.2.5 | AUTH-005 |
| v5.0.0-6.2.8 | AUTH-005 |
| v5.0.0-6.2.9 | AUTH-005 |
| v5.0.0-6.3.1 | AUTH-012, AUTH-013, ADM-006 |
| v5.0.0-6.3.2 | ADM-005 |
| v5.0.0-6.3.3 | AUTH-013, ADM-001, ADM-004, ADM-006, ADM-008 |
| v5.0.0-6.3.8 | AUTH-009, AUTH-013, AUTH-015, AUTH-019 |
| v5.0.0-6.4.3 | AUTH-011, AUTH-015, AUTH-019, AUTH-020, ADM-007 |
| v5.0.0-6.4.4 | ADM-008 |
| v5.0.0-6.5.1 | AUTH-001, AUTH-003, AUTH-013, AUTH-014, AUTH-015, AUTH-022, AUTH-023, AUTH-024, AUTH-025, ADM-004, ADM-007 |
| v5.0.0-6.5.3 | AUTH-001, AUTH-003 |
| v5.0.0-6.5.4 | AUTH-002 |
| v5.0.0-6.6.1 | AUTH-002, AUTH-009, AUTH-024 |
| v5.0.0-6.6.3 | AUTH-003 |
| v5.0.0-7.2.1 | ADM-006 |
| v5.0.0-7.2.2 | AUTH-007, AUTH-008, AUTH-016 |
| v5.0.0-7.2.4 | AUTH-008, AUTH-010, AUTH-014 |
| v5.0.0-7.4.1 | AUTH-007, AUTH-016, AUTH-017 |
| v5.0.0-7.4.2 | AUTH-008, ORG-010, ADM-013, ADM-014, SYNC-008, PRIV-002 |
| v5.0.0-7.4.3 | AUTH-018, AUTH-020, AUTH-021 |
| v5.0.0-7.4.5 | AUTH-018 |
| v5.0.0-8.2.1 | PER-006, PER-008, ACC-001, ACC-002, ACC-003, ACC-004, ACC-005, ACC-006, ORG-003, ORG-004, ORG-005, ORG-007, ORG-009, ORG-010, ORG-013, ORG-014, ORG-015, ORG-016, ORG-017, ORG-018, ORG-019, REL-007, REL-010, REL-011, REL-012, REL-015, REL-018, REL-019, REL-020, REL-021, REL-024, ADM-009, ADM-010, ADM-011, ADM-012, ADM-013, ADM-014, ADM-015, CAT-004, CAT-005, CAT-008, CAT-009, CAT-010, CAT-011, ORD-010, ORD-011, ORD-012, ORD-013, ORD-014, ORD-015, ORD-016, FIN-004, FIN-005, FIN-006, FIN-007, FIN-008, FIN-009, FIN-012, FIN-013, FIN-015, FIN-016, FIN-019, FIN-020, DLV-004, DLV-005, DLV-006, DLV-007, DLV-009, DLV-011, SYNC-010, SYNC-011, SYNC-012, SYNC-013, SYNC-014, SYNC-015, SYNC-018, SYNC-019, SYNC-021, SYNC-022, SYNC-023 |
| v5.0.0-8.2.2 | NTF-003, NTF-004, AUTH-011, AUTH-017, AUTH-018, ORG-005, ORG-008, ORG-011, REL-002, REL-005, REL-008, REL-009, REL-013, REL-016, REL-017, REL-018, REL-021, REL-022, REL-023, REL-024, CAT-002, CAT-005, CAT-006, CAT-007, CAT-008, CAT-009, CAT-010, CAT-011, ORD-005, ORD-009, ORD-017, ORD-019, ORD-020, ORD-021, FIN-009, FIN-010, FIN-016, DLV-003, DLV-006, SYNC-001, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-008, SYNC-010, SYNC-020, PRIV-001 |
| v5.0.0-8.2.3 | PER-005, PER-007, ACC-002, ACC-004, ORG-009, ORG-019, REL-005, REL-010, REL-017, CAT-007, ORD-007, FIN-010, FIN-019, DLV-003, DLV-011, DLV-012, SYNC-004, SYNC-006, SYNC-007, SYNC-010 |
| v5.0.0-8.3.1 | FND-002, PER-004, ACC-001, REL-003, REL-014, ADM-002, FIN-001, FIN-011, FIN-014, SYNC-001, SYNC-002 |
| v5.0.0-8.4.1 | ORG-005, REL-005, REL-008, ORD-019 |
| v5.0.0-9.1.1 | AUTH-006 |
| v5.0.0-9.1.2 | AUTH-006 |
| v5.0.0-9.2.1 | AUTH-006, AUTH-016 |
| v5.0.0-9.2.2 | AUTH-006, ADM-006 |
| v5.0.0-11.3.2 | ADM-004 |
| v5.0.0-11.4.2 | PER-002, PER-003, AUTH-002, AUTH-005, AUTH-026 |
| v5.0.0-13.3.2 | FND-002, ADM-005, PRIV-003 |
| v5.0.0-13.4.2 | FND-000, FND-011 |
| v5.0.0-14.2.4 | FND-001, FND-010, FND-011, PER-002, PER-009, SYNC-023, PRIV-001, PRIV-002, PRIV-003 |
| v5.0.0-15.2.1 | FND-000, AUTH-026 |
| v5.0.0-15.2.2 | FND-008, FND-009 |
| v5.0.0-15.2.3 | PER-001 |
| v5.0.0-15.3.1 | FND-012, PER-005, PER-006, PER-007, NTF-003, AUTH-018, ORG-005, ORG-008, ORG-018, ORG-019, REL-005, REL-008, REL-009, REL-016, REL-018, REL-022, ADM-012, CAT-006, CAT-007, CAT-009, ORD-007, ORD-019, ORD-020, ORD-021, FIN-010, FIN-019, FIN-020, DLV-003, DLV-011, SYNC-003, SYNC-004, SYNC-005, SYNC-006, SYNC-007, SYNC-020, SYNC-021, SYNC-023 |
| v5.0.0-15.3.3 | PER-007, NTF-004, ORG-004, ORG-007, ORG-009, ORG-011, ORG-013, REL-007, REL-010, REL-011, REL-017, REL-020, ADM-011, CAT-004, CAT-005, CAT-008, CAT-011, ORD-009, ORD-011, ORD-013, ORD-014, ORD-015, FIN-004, FIN-005, FIN-006, FIN-007, FIN-012, FIN-015, DLV-008, SYNC-010 |
| v5.0.0-16.2.5 | FND-007, FND-012, NTF-002 |
| v5.0.0-16.3.1 | AUTH-010, AUTH-011, AUTH-013, AUTH-014, AUTH-016, AUTH-020, AUTH-023, AUTH-025, ORG-015, ORG-016, REL-012, REL-023, ADM-002, ADM-008, ADM-009, ADM-010, ADM-013, ADM-014, FIN-016, FIN-017, SYNC-002, SYNC-009, SYNC-019, SYNC-022, PRIV-002 |
| v5.0.0-16.3.2 | ACC-006, SYNC-018 |
| v5.0.0-16.3.3 | PER-004, AUTH-004, REL-003, REL-004, REL-013, REL-014, ADM-015, FIN-018, SYNC-016, SYNC-017, SYNC-018, PRIV-003 |
| v5.0.0-16.5.1 | FND-006, FND-012 |
