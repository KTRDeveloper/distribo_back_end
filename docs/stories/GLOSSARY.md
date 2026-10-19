# Glossary

One English term per domain concept. Stories use these terms; identifiers stay verbatim from the design.

| term | design term(s) | meaning |
|---|---|---|
| amount held | `amount_held`, argent détenu | money a collaborator holds and has not handed over yet |
| balance | `balance`, solde | what the customer owes the supplier; sum of ledger entry effects; negative means an advance |
| counter | comptoir | a relationship with no customer, used for anonymous sales paid in full |
| credit note | `CREDIT_NOTE`, avoir | ledger entry that reduces what the customer owes, without money moving |
| customer | `customer_person_id`, `customer_organization_id`, client | the buying side of a `CustomerRelationship` |
| delivered order | 'Commande livrée' | the single gesture that closes an order, records the sale and the collected payment |
| device | `Device`, téléphone, session | one login on one phone; one device, one session |
| driver | `DRIVER`, livreur | collaborator who delivers orders and collects payment on delivery |
| grace period | `grace_ends_at`, grâce | the 7 days after the end of the last period during which the plan still applies, shown as 'Forfait expiré' |
| guest | invité, `registered_at` empty | a `Person` who never registered; cannot log in and can do nothing |
| handover | `Handover`, versement | money passing from one collaborator to the owner or a manager |
| image key | `logo_key`, `avatar_key`, `image_keys`, clé d'image | key of a stored photo, built by the server and never sent by a client |
| ledger entry | `LedgerEntry`, écriture | immutable line that changes a relationship's balance |
| manager | `MANAGER`, gérant | collaborator with pricing, credit, refund and correction powers, mostly online only |
| moderator | `MODERATOR`, modérateur | platform administrator who handles reports and suspensions |
| organization | `Organization`, organisation, commerce | a business with a team, a catalog, customers and suppliers |
| organization contact | `OrganizationContact`, contact public | a phone number (at most 3) or an email address of a business, published only once verified |
| owner | `OWNER`, propriétaire | the one active collaborator who owns an organization |
| paused | `PAUSED`, `paused_at`, en pause | a collaborator or product held back above the plan limit; nothing is deleted |
| payment code | `payment_code`, code du commerce | 8 random characters without look-alikes that a payer types on the payment website to name the business |
| person | `Person`, personne | a natural person known to the platform, registered or not; root of every identity |
| plan | `plan`, plan, formule | the plan that applies to a business, grace included (FREE, ESSENTIAL, PRO or ENTERPRISE) |
| receipt | `SubscriptionReceipt`, reçu | immutable numbered receipt, or credit note, of a subscription payment |
| reference price | `reference_price`, prix de référence | negotiated price if any, else the variant price, frozen on the order line |
| relationship | `CustomerRelationship`, relation | the account between one supplier and one customer; carries the balance |
| scope version | `scope_version`, compteur de droits | counter that forces a phone to resynchronize fully when rights change |
| seller | `SELLER`, vendeur | collaborator who sells, adds customers and collects payments |
| subscription | `Subscription`, forfait | one prepaid period of a plan (1, 3, 6 or 12 months), SCHEDULED, ACTIVE or ENDED |
| super-admin | `SUPER_ADMIN`, super-administrateur | platform administrator who can also replay synchronization batches and appoint administrators |
| supplier | `supplier_organization_id`, fournisseur | the selling side of a `CustomerRelationship` |
| sync | synchronisation | WatermelonDB pull and push between a phone and the server |
| variant | `ProductVariant`, variante | one way to sell a product, with its own unit, price, minimum order quantity, status and photos; a product always has at least one |
| visitor | non-signed-in person who registers or logs in | uses only registration, login and password reset |
