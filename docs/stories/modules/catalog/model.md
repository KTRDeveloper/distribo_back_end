# Model: catalog

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Product
Design: `catalogue/product`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Product:fk |
| name | string |  |
| unit | string |  |
| price | bigint | C-13, CM-11 |
| price_updated_at | datetime | C-13 |
| min_order_quantity | decimal (3 décimales), nullable | C-13, C-15 |
| description | text, nullable |  |
| category | string, nullable |  |
| status | enum [ACTIVE / INACTIVE] | Product.status:enum |
| created_at | datetime |  |

- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `Product.status:enum`: one of ACTIVE, INACTIVE
- `Product:fk`: references organization_id → Organization
- `C-13`: `Product.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-15`: Every order line is for an ACTIVE product of the relationship's supplier; on a customer-placed order the quantity is at least `min_order_quantity` when sent.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price.

## CustomerPrice
Design: `relations-commerciales/customerprice`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | CustomerPrice:fk, C-11 |
| product_id | FK → Product | CustomerPrice:fk, C-11 |
| price | bigint | CM-11 |
| set_by_id | FK → Person | CustomerPrice:fk |
| set_at | datetime |  |

- `CustomerPrice:required`: NOT NULL: `customer_relationship_id`, `product_id`, `price`, `set_by_id`, `set_at`
- `CustomerPrice:fk`: references customer_relationship_id → CustomerRelationship; product_id → Product; set_by_id → Person
- `C-11`: `CustomerPrice` is unique per (relationship, product) among rows not deleted; the product belongs to the supplier of the relationship.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price.
