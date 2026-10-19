# Model: catalog

Current design slice for the entities this module owns. Identifiers are verbatim from the design; stories cite the constraint IDs below. Every constraint is enforced in the database and in the validation layer.

## Product
Design: `catalogue/product`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| organization_id | FK → Organization | Product:fk, C-45 |
| name | string |  |
| description | text, nullable |  |
| category | string, nullable |  |
| image_keys | string[] | C-49 |
| paused_at | datetime, nullable | C-46 |
| created_at | datetime |  |

- `Product:required`: NOT NULL: `organization_id`, `name`, `unit`, `price`, `price_updated_at`, `status`, `created_at`
- `Product:fk`: references organization_id → Organization
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-46`: `Product.paused_at` is written by the server only; the products on sale (not deleted, not paused, with at least one ACTIVE variant) number at most `Organization.max_products`, checked by the phone and by the online routes; what arrives in excess through synchronization is paused, never refused.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the variant price), else the variant price.

## ProductVariant
Design: `catalogue/productvariant`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| product_id | FK → Product | ProductVariant:fk, C-47, CM-42 |
| organization_id | FK → Organization | ProductVariant:fk, C-45 |
| name | string, nullable |  |
| unit | string |  |
| price | bigint | C-13 |
| price_updated_at | datetime | C-13 |
| min_order_quantity | decimal (3 décimales), nullable | C-13, C-15 |
| image_keys | string[] | C-49 |
| status | enum [ACTIVE / INACTIVE] | ProductVariant.status:enum |
| created_at | datetime |  |
| merged_into_id | FK → ProductVariant, nullable | ProductVariant:fk, C-47 |

- `ProductVariant:required`: NOT NULL: `product_id`, `organization_id`, `unit`, `price`, `price_updated_at`, `image_keys`, `status`, `created_at`
- `ProductVariant.status:enum`: one of ACTIVE, INACTIVE
- `ProductVariant:fk`: references product_id → Product; organization_id → Organization; merged_into_id → ProductVariant
- `C-45`: A product that is not deleted has at least one variant that is not deleted; `ProductVariant.organization_id` equals `Product.organization_id`.
- `C-47`: Two variants of one product that are not deleted never share both the same simplified name and the same simplified unit (capitals and extra spaces ignored, an empty name counts as empty text); `merged_into_id` set implies the variant is deleted.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.
- `C-13`: `ProductVariant.price` > 0; `min_order_quantity` > 0 when set; `price_updated_at` is set by the server on every price change.
- `C-49`: `Product.image_keys` and `ProductVariant.image_keys` hold at most 5 keys (CHECK) with a GIN index; a key is cited by one record only, across all tables; the image keys, `Organization.logo_key` and `Person.avatar_key` are written by the server only.
- `C-15`: Every order line is for an ACTIVE variant of the relationship's supplier, of a product that is not paused; on a customer-placed order the quantity is at least the variant's `min_order_quantity` when sent.
- `CM-42`: Every insert or update of a `ProductVariant` also sets `server_updated_at` of its product to the database time, so that a product and its variants always travel together to the phones.

## CustomerPrice
Design: `relations-commerciales/customerprice`

| field | type | constraints |
|---|---|---|
| id | PK |  |
| customer_relationship_id | FK → CustomerRelationship | CustomerPrice:fk, C-11 |
| product_variant_id | FK → ProductVariant | CustomerPrice:fk, C-11 |
| price | bigint | CM-11 |
| set_by_id | FK → Person | CustomerPrice:fk |
| set_at | datetime |  |

- `CustomerPrice:required`: NOT NULL: `customer_relationship_id`, `product_id`, `price`, `set_by_id`, `set_at`
- `CustomerPrice:fk`: references customer_relationship_id → CustomerRelationship; product_id → Product; set_by_id → Person
- `C-11`: `CustomerPrice` is unique per (relationship, variant) among rows not deleted; the variant belongs to the supplier of the relationship.
- `C-48`: A variant cited by an order line or a negotiated price is never deleted, only taken off sale (`INACTIVE`); a deletion received for a cited variant becomes a withdrawal from sale, and a line received for a deleted variant restores it, off sale.
- `CM-11`: Reference price of a line = negotiated price when one exists (even higher than the variant price), else the variant price.
