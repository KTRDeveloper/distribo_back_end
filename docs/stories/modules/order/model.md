# Model: order

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Order
Design: `commandes-et-livraisons/order`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | Order:fk |
| placed_by_party | enum [CUSTOMER / SUPPLIER] | Order.placed_by_party:enum, C-17 |
| entered_by_id | FK → Person | Order:fk |
| delivery_address_applied | string, nullable |  |
| total_amount | bigint | C-19, C-24, CM-13 |
| delivery_cost | bigint | C-19 |
| status | enum [PENDING / CONFIRMED / IN_DELIVERY / DELIVERED / CANCELLED] | Order.status:enum, C-16, C-17, C-19, CM-12 |
| delivered_at | datetime, nullable | C-19 |
| delivered_by_id | FK → Person, nullable | Order:fk, C-19 |
| created_at | datetime |  |
| desired_delivery_date | date, nullable |  |
| cancelled_by_party | enum [CUSTOMER / SUPPLIER], nullable | Order.cancelled_by_party:enum, C-16 |
| cancelled_by_id | FK → Person, nullable | Order:fk, C-16 |
| cancelled_at | datetime, nullable | C-16 |
| cancellation_reason | string, nullable | C-16 |
| parent_order_id | FK → Order, nullable | Order:fk, CM-22 |
| customer_note | string, nullable |  |
| supplier_note | string, nullable | C-18 |
| sync_issue | string, nullable |  |

- `Order:required`: NOT NULL: `customer_relationship_id`, `placed_by_party`, `entered_by_id`, `total_amount`, `delivery_cost`, `status`, `created_at`
- `Order.placed_by_party:enum`: one of CUSTOMER, SUPPLIER
- `Order.status:enum`: one of PENDING, CONFIRMED, IN_DELIVERY, DELIVERED, CANCELLED
- `Order.cancelled_by_party:enum`: one of CUSTOMER, SUPPLIER
- `Order:fk`: references customer_relationship_id → CustomerRelationship; entered_by_id → Person; delivered_by_id → Person; cancelled_by_id → Person; parent_order_id → Order
- `C-14`: An order is created only on an ACTIVE relationship whose supplier is an ACTIVE organization (not suspended, not closed).
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `C-16`: `cancelled_by_party`, `cancelled_by_id` and `cancelled_at` are set if and only if `status` is CANCELLED; `cancellation_reason` only when CANCELLED and required when the supplier cancelled.
- `C-17`: `status` PENDING requires `placed_by_party` CUSTOMER.
- `C-18`: Status changes follow the permitted steps; delivery wins; a delivered or cancelled order is frozen except `supplier_note`.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.
- `C-24`: A SALE ledger entry has `order_id` set and `amount` equal to `Order.total_amount` (server-fixed), and there is at most one non-reversed sale per order; the payment born of 'Commande livrée' also carries `order_id`.
- `CM-12`: Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note.
- `CM-13`: The amount of a sale is always Order.total_amount computed by the server on delivered quantities; the amount sent by the phone is ignored.
- `CM-22`: Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices, linked by parent_order_id; 'abandon' closes the order on what was delivered; abandon by a non-owner joins the owner's exceptions (design lines 503-504)

## OrderLine
Design: `commandes-et-livraisons/orderline`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| order_id | FK → Order | OrderLine:fk |
| product_id | FK → Product | OrderLine:fk |
| label_applied | string |  |
| quantity | decimal (3 décimales) | C-15 |
| delivered_quantity | decimal (3 décimales), nullable | C-19, CM-22 |
| reference_price | bigint | C-20, CM-11, CM-16 |
| unit_price_applied | bigint | C-20, CM-16 |
| amount | bigint | C-19, C-20, CM-14 |
| price_set_by_id | FK → Person, nullable | OrderLine:fk, C-20 |
| price_set_at | datetime, nullable | C-20 |

- `OrderLine:required`: NOT NULL: `order_id`, `product_id`, `label_applied`, `quantity`, `reference_price`, `unit_price_applied`, `amount`
- `OrderLine:fk`: references order_id → Order; product_id → Product; price_set_by_id → Person
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `C-19`: `delivered_at` and `delivered_by_id` are set if and only if `status` is DELIVERED; every line then has `delivered_quantity`; `total_amount` equals the sum of line amounts plus `delivery_cost`.
- `C-20`: Line `amount` is quantity times applied price rounded to the franc, half up; on a customer-placed order `unit_price_applied` equals `reference_price` when sent and is never raised afterward; `price_set_by_id` and `price_set_at` are set if and only if `unit_price_applied` differs from `reference_price`.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price.
- `CM-14`: Line amount = quantity in thousandths times applied price, divided by 1000, rounded to the nearest franc with 0.5 rounded up, integer arithmetic only; 2.5 x 333 gives 833.
- `CM-16`: Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order).
- `CM-22`: Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices, linked by parent_order_id; 'abandon' closes the order on what was delivered; abandon by a non-owner joins the owner's exceptions (design lines 503-504)
