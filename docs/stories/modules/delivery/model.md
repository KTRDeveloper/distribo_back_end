# Model: delivery

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Delivery
Design: `commandes-et-livraisons/delivery`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| order_id | FK → Order | Delivery:fk, C-21, CM-23 |
| assigned_to_id | FK → Person | Delivery:fk, C-04, C-21, CM-38 |
| departed_at | datetime, nullable |  |
| arrived_at | datetime, nullable | C-21 |
| failed_at | datetime, nullable | C-21 |
| failure_reason | string, nullable | C-21 |
| sync_issue | string, nullable |  |

- `Delivery:required`: NOT NULL: `order_id`, `assigned_to_id`
- `Delivery:fk`: references order_id → Order; assigned_to_id → Person
- `C-04`: Author columns (`*_by_id`, `assigned_to_id`, `reporter_id`, `person_id` of an administrator, `to_person_id`) refer to a registered person; `resolved_by_id` and `administrator_id` refer to an Administrator.
- `C-21`: A delivery's `assigned_to_id` is an ACTIVE collaborator of the supplier, driver or above; `arrived_at` and `failed_at` are never both set; `failure_reason` is set if and only if `failed_at` is set; at most one delivery in progress (neither arrived nor failed) per order.
- `C-22`: A delivery not yet departed is removed when its order is cancelled or delivered without it; with crossed departures the server keeps the first and stores the other closed.
- `CM-23`: Crossed departures: the server keeps the first delivery and stores the other closed with sync_issue 'Livraison déjà prise par <name>'; if the second one delivered, the delivery wins and the other is closed.
- `CM-38`: The pool of orders to take lists the confirmed orders with a delivery address; a driver does not see there an order assigned to another driver, and sees it again when that assignment ends (failed attempt or removal); managers, owners and sellers see every order of the pool.
