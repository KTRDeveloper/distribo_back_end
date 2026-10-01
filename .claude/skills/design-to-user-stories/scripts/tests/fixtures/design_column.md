# Shop design

## Data model

### Customer
| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK | |
| email | string | required, unique, max 254 | Login |
| nickname | string | | Public name |
| tier | enum [FREE / PRO] | required, default FREE | |

### Invoice
| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK | |
| customer_id | uuid | FK -> Customer, required | |
| total | integer | required, > 0 | cents |
| paid_at | timestamp | | |

### Constraints
- An invoice total never changes after `paid_at` is set (`Invoice.total`).
- Customer email is stored lowercase.
