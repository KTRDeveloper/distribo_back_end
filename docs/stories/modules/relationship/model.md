# Model: relationship

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## CustomerRelationship
Design: `relations-commerciales/customerrelationship`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| supplier_organization_id | FK → Organization, nullable | CustomerRelationship:fk, C-07, CM-25 |
| supplier_person_id | FK → Person, nullable | CustomerRelationship:fk, C-08, CM-25 |
| customer_person_id | FK → Person, nullable | CustomerRelationship:fk, C-06 |
| customer_organization_id | FK → Organization, nullable | CustomerRelationship:fk, C-07 |
| customer_phone_number | string, nullable | C-06 |
| customer_label | string, nullable | C-06, CM-19 |
| supplier_label | string, nullable | CM-19 |
| delivery_address | string, nullable |  |
| credit_limit | bigint, nullable | C-10, CM-15 |
| credit_limit_set_by_id | FK → Person, nullable | CustomerRelationship:fk, C-10 |
| credit_limit_set_at | datetime, nullable | C-10 |
| balance | bigint | C-37, CM-15 |
| status | enum [PENDING / ACTIVE / ENDED] | CustomerRelationship.status:enum, C-08, C-09, CM-25 |
| ended_by_party | enum [CUSTOMER / SUPPLIER], nullable | CustomerRelationship.ended_by_party:enum, C-09 |
| contested_at | datetime, nullable | C-57, CM-24 |
| supplier_notes | text, nullable | CM-19 |
| created_by_id | FK → Person | CustomerRelationship:fk |
| created_at | datetime |  |
| merged_into_id | FK → CustomerRelationship, nullable | CustomerRelationship:fk, C-07 |

- `CustomerRelationship:required`: NOT NULL: `balance`, `status`, `created_by_id`, `created_at`
- `CustomerRelationship.status:enum`: one of PENDING, ACTIVE, ENDED
- `CustomerRelationship.ended_by_party:enum`: one of CUSTOMER, SUPPLIER
- `CustomerRelationship:fk`: references supplier_organization_id → Organization; supplier_person_id → Person; customer_person_id → Person; customer_organization_id → Organization; credit_limit_set_by_id → Person; created_by_id → Person; merged_into_id → CustomerRelationship
- `C-06`: A relationship has exactly one supplier (organization or person); at most one customer (person or organization), none only for a counter, and then `customer_label` is required; `customer_phone_number` is empty once `customer_person_id` is set.
- `C-07`: At most one live relationship per (supplier, customer) pair, ignoring deleted and merged rows (partial unique indexes per column combination); `supplier_organization_id` differs from `customer_organization_id`; `merged_into_id` set means the row is deleted.
- `C-08`: `status` is PENDING if and only if `supplier_person_id` is set.
- `C-09`: `ended_by_party` is set if and only if `status` is ENDED; only that party may reopen the relationship.
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.
- `C-57`: `contested_at` is set and cleared by the customer alone, through an online route; a supplier correction clears it and must target another number; it is always empty for a counter.
- `C-37`: `CustomerRelationship.balance` and `Collaboration.amount_held` are updated by adding the effect of each operation inside its transaction, always relationship first then collaboration; a nightly check compares each total with the sum of its entries.
- `CM-15`: At delivery, the unpaid part must not bring the balance above credit_limit (null limit = no limit); example: limit 50 000, balance 40 000, order 30 000 requires collecting at least 20 000 (design lines 290-299)
- `CM-19`: `customer_label` and `supplier_notes` are never sent to the customer; `supplier_label` is never sent to the supplier; each party writes only its own fields.
- `CM-24`: Contestation only sets `contested_at`, with no journal row and no change of customer; the customer then sees the record only among their hidden records, the supplier sees a contested number and is notified; only the customer clears it ('this is me'); the supplier can only correct to another number; a contested invitation is declined.
- `CM-25`: Supplier invitation: acceptance replaces `supplier_person_id` by `supplier_organization_id` and sets ACTIVE, on behalf of an organization the person manages; refused, cancelled, contested or released-number invitations are deleted.

## CustomerRelationshipReassignment
Design: `relations-commerciales/customerrelationshipreassignment`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | CustomerRelationshipReassignment:fk |
| previous_person_id | FK → Person | CustomerRelationshipReassignment:fk, C-12 |
| new_person_id | FK → Person | CustomerRelationshipReassignment:fk, C-12 |
| reassigned_by_id | FK → Person | CustomerRelationshipReassignment:fk |
| reason | text, nullable |  |
| reassigned_at | datetime |  |

- `CustomerRelationshipReassignment:required`: NOT NULL: `customer_relationship_id`, `previous_person_id`, `new_person_id`, `reassigned_by_id`, `reassigned_at`
- `CustomerRelationshipReassignment:fk`: references customer_relationship_id → CustomerRelationship; previous_person_id → Person; new_person_id → Person; reassigned_by_id → Person
- `C-12`: A reassignment has previous and new person set; the new person has no relationship with the same supplier; the journal is never modified.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.

## CreditLimitChange
Design: `relations-commerciales/creditlimitchange`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | CreditLimitChange:fk |
| previous_limit | bigint, nullable |  |
| new_limit | bigint, nullable |  |
| set_by_id | FK → Person | CreditLimitChange:fk |
| set_at | datetime |  |

- `CreditLimitChange:required`: NOT NULL: `customer_relationship_id`, `set_by_id`, `set_at`
- `CreditLimitChange:fk`: references customer_relationship_id → CustomerRelationship; set_by_id → Person
- `C-10`: `credit_limit` is 0 at creation and always 0 for a counter; `credit_limit_set_by_id` and `credit_limit_set_at` are set together; every change adds one `CreditLimitChange` row in the same transaction.
- `C-39`: The application account has only INSERT and SELECT on the immutable tables.
