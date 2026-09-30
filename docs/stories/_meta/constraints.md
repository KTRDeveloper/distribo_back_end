# Constraints

One line per constraint, from `data-model/modele-donnees-livraisons-v10.md`. Extracted rows are rebuilt by extract_model.py; the Manual section is never touched by scripts.

## Extracted

| ID | Entity.field(s) | rule |
|---|---|---|
| Person:required | Person.created_at, Person.status, Person.scope_version | NOT NULL |
| Person.phone_number:unique | Person.phone_number | unique |
| Person.preferred_language:enum | Person.preferred_language | one of FR, EN |
| Person.status:enum | Person.status | one of ACTIVE, SUSPENDED, ANONYMIZED |
| PhoneNumberChangeLog:required | PhoneNumberChangeLog.person_id, PhoneNumberChangeLog.old_phone_number, PhoneNumberChangeLog.new_phone_number, PhoneNumberChangeLog.verified_at, PhoneNumberChangeLog.changed_at | NOT NULL |
| PhoneNumberChangeLog:fk | PhoneNumberChangeLog.person_id | references person_id → Person |
| Organization:required | Organization.name, Organization.status, Organization.created_at | NOT NULL |
| Organization.status:enum | Organization.status | one of ACTIVE, SUSPENDED, CLOSED |
| Collaboration:required | Collaboration.person_id, Collaboration.organization_id, Collaboration.role, Collaboration.status, Collaboration.is_public_contact, Collaboration.invited_at, Collaboration.amount_held | NOT NULL |
| Collaboration.role:enum | Collaboration.role | one of OWNER, MANAGER, SELLER, DRIVER |
| Collaboration.status:enum | Collaboration.status | one of INVITED, ACTIVE, REVOKED |
| Collaboration:fk | Collaboration.person_id, Collaboration.organization_id | references person_id → Person; organization_id → Organization |
| CustomerRelationship:required | CustomerRelationship.balance, CustomerRelationship.status, CustomerRelationship.created_by_id, CustomerRelationship.created_at | NOT NULL |
| CustomerRelationship.status:enum | CustomerRelationship.status | one of PENDING, ACTIVE, ENDED |
| CustomerRelationship.ended_by_party:enum | CustomerRelationship.ended_by_party | one of CUSTOMER, SUPPLIER |
| CustomerRelationship:fk | CustomerRelationship.supplier_organization_id, CustomerRelationship.supplier_person_id, CustomerRelationship.customer_person_id, CustomerRelationship.customer_organization_id, CustomerRelationship.credit_limit_set_by_id, CustomerRelationship.created_by_id, CustomerRelationship.merged_into_id | references supplier_organization_id → Organization; supplier_person_id → Person; customer_person_id → Person; customer_organization_id → Organization; credit_limit_set_by_id → Person; created_by_id → Person; merged_into_id → CustomerRelationship |
| CustomerPrice:required | CustomerPrice.customer_relationship_id, CustomerPrice.product_id, CustomerPrice.price, CustomerPrice.set_by_id, CustomerPrice.set_at | NOT NULL |
| CustomerPrice:fk | CustomerPrice.customer_relationship_id, CustomerPrice.product_id, CustomerPrice.set_by_id | references customer_relationship_id → CustomerRelationship; product_id → Product; set_by_id → Person |
| CustomerRelationshipReassignment:required | CustomerRelationshipReassignment.customer_relationship_id, CustomerRelationshipReassignment.previous_person_id, CustomerRelationshipReassignment.new_person_id, CustomerRelationshipReassignment.reassigned_by_id, CustomerRelationshipReassignment.reassigned_at | NOT NULL |
| CustomerRelationshipReassignment:fk | CustomerRelationshipReassignment.customer_relationship_id, CustomerRelationshipReassignment.previous_person_id, CustomerRelationshipReassignment.new_person_id, CustomerRelationshipReassignment.reassigned_by_id | references customer_relationship_id → CustomerRelationship; previous_person_id → Person; new_person_id → Person; reassigned_by_id → Person |
| CreditLimitChange:required | CreditLimitChange.customer_relationship_id, CreditLimitChange.set_by_id, CreditLimitChange.set_at | NOT NULL |
| CreditLimitChange:fk | CreditLimitChange.customer_relationship_id, CreditLimitChange.set_by_id | references customer_relationship_id → CustomerRelationship; set_by_id → Person |
| Product:required | Product.organization_id, Product.name, Product.unit, Product.price, Product.price_updated_at, Product.status, Product.created_at | NOT NULL |
| Product.status:enum | Product.status | one of ACTIVE, INACTIVE |
| Product:fk | Product.organization_id | references organization_id → Organization |
| Order:required | Order.customer_relationship_id, Order.placed_by_party, Order.entered_by_id, Order.total_amount, Order.delivery_cost, Order.status, Order.created_at | NOT NULL |
| Order.placed_by_party:enum | Order.placed_by_party | one of CUSTOMER, SUPPLIER |
| Order.status:enum | Order.status | one of PENDING, CONFIRMED, IN_DELIVERY, DELIVERED, CANCELLED |
| Order.cancelled_by_party:enum | Order.cancelled_by_party | one of CUSTOMER, SUPPLIER |
| Order:fk | Order.customer_relationship_id, Order.entered_by_id, Order.delivered_by_id, Order.cancelled_by_id, Order.parent_order_id | references customer_relationship_id → CustomerRelationship; entered_by_id → Person; delivered_by_id → Person; cancelled_by_id → Person; parent_order_id → Order |
| OrderLine:required | OrderLine.order_id, OrderLine.product_id, OrderLine.label_applied, OrderLine.quantity, OrderLine.reference_price, OrderLine.unit_price_applied, OrderLine.amount | NOT NULL |
| OrderLine:fk | OrderLine.order_id, OrderLine.product_id, OrderLine.price_set_by_id | references order_id → Order; product_id → Product; price_set_by_id → Person |
| Delivery:required | Delivery.order_id, Delivery.assigned_to_id | NOT NULL |
| Delivery:fk | Delivery.order_id, Delivery.assigned_to_id | references order_id → Order; assigned_to_id → Person |
| LedgerEntry:required | LedgerEntry.customer_relationship_id, LedgerEntry.kind, LedgerEntry.amount, LedgerEntry.recorded_by_id, LedgerEntry.occurred_at | NOT NULL |
| LedgerEntry.kind:enum | LedgerEntry.kind | one of SALE, PAYMENT, REFUND, CREDIT_NOTE, OPENING_BALANCE |
| LedgerEntry.mode:enum | LedgerEntry.mode | one of CASH, MOBILE_MONEY |
| LedgerEntry:fk | LedgerEntry.customer_relationship_id, LedgerEntry.order_id, LedgerEntry.reverses_entry_id, LedgerEntry.recorded_by_id | references customer_relationship_id → CustomerRelationship; order_id → Order; reverses_entry_id → LedgerEntry; recorded_by_id → Person |
| LedgerEntry.balance_effect:generated | LedgerEntry.balance_effect | computed by the database; never written by the application |
| Expense:required | Expense.organization_id, Expense.paid_by_id, Expense.amount, Expense.recorded_by_id, Expense.occurred_at | NOT NULL |
| Expense:fk | Expense.organization_id, Expense.paid_by_id, Expense.recorded_by_id, Expense.cancelled_by_id | references organization_id → Organization; paid_by_id → Person; recorded_by_id → Person; cancelled_by_id → Person |
| Handover:required | Handover.organization_id, Handover.from_person_id, Handover.to_person_id, Handover.amount, Handover.occurred_at | NOT NULL |
| Handover:fk | Handover.organization_id, Handover.from_person_id, Handover.to_person_id, Handover.cancelled_by_id | references organization_id → Organization; from_person_id → Person; to_person_id → Person; cancelled_by_id → Person |
| Subscription:required | Subscription.organization_id, Subscription.plan, Subscription.status | NOT NULL |
| Subscription.status:enum | Subscription.status | one of ACTIVE, EXPIRED |
| Subscription:fk | Subscription.organization_id | references organization_id → Organization |
| Report:required | Report.reporter_id, Report.reason, Report.description, Report.status | NOT NULL |
| Report.status:enum | Report.status | one of PENDING, RESOLVED |
| Report.decision:enum | Report.decision | one of DISMISSED, SUSPENSION |
| Report:fk | Report.reporter_id, Report.target_person_id, Report.target_organization_id, Report.resolved_by_id | references reporter_id → Person; target_person_id → Person; target_organization_id → Organization; resolved_by_id → Administrator |
| Administrator:required | Administrator.person_id, Administrator.role, Administrator.totp_secret, Administrator.appointed_at | NOT NULL |
| Administrator.role:enum | Administrator.role | one of SUPER_ADMIN, MODERATOR |
| Administrator:fk | Administrator.person_id | references person_id → Person |
| AdminAction:required | AdminAction.administrator_id, AdminAction.action, AdminAction.reason, AdminAction.occurred_at | NOT NULL |
| AdminAction.action:enum | AdminAction.action | one of SUSPEND, REACTIVATE, DISMISS_REPORT, APPOINT_ADMIN, REMOVE_ADMIN, REPLAY_SYNC, RECOVER_2FA |
| AdminAction:fk | AdminAction.administrator_id, AdminAction.target_person_id, AdminAction.target_organization_id, AdminAction.report_id, AdminAction.sync_archive_id | references administrator_id → Administrator; target_person_id → Person; target_organization_id → Organization; report_id → Report; sync_archive_id → SyncArchive |
| Notification:required | Notification.recipient_id, Notification.content, Notification.source_event, Notification.read_status, Notification.created_at | NOT NULL |
| Notification.read_status:enum | Notification.read_status | one of UNREAD, READ |
| Notification:fk | Notification.recipient_id, Notification.organization_id | references recipient_id → Person; organization_id → Organization |
| SyncArchive:required | SyncArchive.person_id, SyncArchive.device_id, SyncArchive.received_at, SyncArchive.changes | NOT NULL |
| SyncArchive:fk | SyncArchive.person_id, SyncArchive.device_id | references person_id → Person; device_id → Device |
| OtpChallenge:required | OtpChallenge.target, OtpChallenge.purpose, OtpChallenge.channel, OtpChallenge.code_hash, OtpChallenge.expires_at, OtpChallenge.attempts, OtpChallenge.created_at | NOT NULL |
| OtpChallenge.purpose:enum | OtpChallenge.purpose | one of REGISTRATION, LOGIN, PASSWORD_RESET, PHONE_CHANGE, EMAIL_VERIFICATION, TOTP_RECOVERY |
| OtpChallenge.channel:enum | OtpChallenge.channel | one of SMS, EMAIL |
| OtpChallenge:fk | OtpChallenge.person_id | references person_id → Person |
| Device:required | Device.person_id, Device.platform, Device.app_version, Device.scope_version_seen, Device.created_at | NOT NULL |
| Device.platform:enum | Device.platform | one of ANDROID, IOS |
| Device:fk | Device.person_id | references person_id → Person |
| RefreshToken:required | RefreshToken.person_id, RefreshToken.device_id, RefreshToken.token_hash, RefreshToken.expires_at, RefreshToken.created_at | NOT NULL |
| RefreshToken.token_hash:unique | RefreshToken.token_hash | unique |
| RefreshToken.revoked_reason:enum | RefreshToken.revoked_reason | one of LOGOUT, DEVICE_REMOVED, LOGOUT_ALL, REUSE_DETECTED, PASSWORD_RESET, ACCOUNT_SUSPENDED |
| RefreshToken:fk | RefreshToken.person_id, RefreshToken.device_id | references person_id → Person; device_id → Device |
| C-01 | * | Identifiants en `uuid` (UUIDv7) ; montants en `bigint` ; quantités en `numeric(12,3)` ; horodatages en `timestamptz` |
| C-02 | Person.phone_number, Person.released_phone_number, Person.status | `Person.phone_number` unique — contrainte ordinaire, PostgreSQL ignorant les valeurs nulles — et au format E.164 (`CHECK` sur `^\+[1-9][0-9]{7,14}$`) ; exactement un de `phone_number` / `released_phone_number` renseigné ; `status = ANONYMIZED` ⇒ `phone_number` vide |
| C-03 | Person.registered_at, Person.status, Person.full_name, Person.password_hash, Person.phone_verified_at, Person.phone_number, Person.email, Person.email_verified_at | `Person` : `registered_at` renseigné et `status ≠ ANONYMIZED` ⇒ `full_name` et `password_hash` renseignés, et `phone_verified_at` renseigné si `phone_number` l'est ; `phone_number` vide ⇒ `phone_verified_at` vide ; `email` vide ⇒ `email_verified_at` vide |
| C-04 | Delivery.assigned_to_id, Report.reporter_id, Administrator.person_id, Handover.to_person_id, Report.resolved_by_id, AdminAction.administrator_id | Colonnes d'auteur (`*_by_id`, `Delivery.assigned_to_id`, `Report.reporter_id`, `Administrator.person_id`, `Handover.to_person_id`) : la personne est inscrite ; `Report.resolved_by_id` et `AdminAction.administrator_id` désignent un `Administrator` |
| C-05 | Collaboration.person_id, Collaboration.organization_id, Collaboration.status, Collaboration.is_public_contact, Person.status | `Collaboration` unique (`person_id`, `organization_id`) ; `status = ACTIVE` ⇒ la `Person` est inscrite ; exactement une `OWNER` active par organisation ; `is_public_contact` ⇒ `status = ACTIVE` et numéro actif |
| C-06 | CustomerRelationship.customer_label, CustomerRelationship.customer_phone_number, CustomerRelationship.customer_person_id | `CustomerRelationship` : exactement un fournisseur ; au plus un client, aucun uniquement pour un comptoir, dont `customer_label` est alors obligatoire ; `customer_phone_number` vide dès que `customer_person_id` est renseigné |
| C-07 | CustomerRelationship.merged_into_id, CustomerRelationship.supplier_organization_id, CustomerRelationship.customer_organization_id | `CustomerRelationship` : au plus une relation vivante par couple (index uniques partiels par combinaison de colonnes, lignes supprimées ou réunies exclues) ; `merged_into_id` renseigné ⇒ ligne supprimée ; `supplier_organization_id <> customer_organization_id` |
| C-08 | CustomerRelationship.status, CustomerRelationship.supplier_person_id | `CustomerRelationship` : `status = PENDING` ⟺ `supplier_person_id` renseigné (v1) |
| C-09 | CustomerRelationship.ended_by_party, CustomerRelationship.status | `CustomerRelationship.ended_by_party` renseigné ⟺ `status = ENDED` ; seule cette partie rouvre la relation |
| C-10 | CustomerRelationship.credit_limit, CustomerRelationship.credit_limit_set_by_id, CustomerRelationship.credit_limit_set_at, CreditLimitChange | `CustomerRelationship.credit_limit` : 0 à la création ; toujours 0 pour un comptoir ; `credit_limit_set_by_id` et `credit_limit_set_at` renseignés ensemble ; chaque changement ajoute une ligne à `CreditLimitChange`, dans la même transaction |
| C-11 | CustomerPrice.customer_relationship_id, CustomerPrice.product_id | `CustomerPrice` unique (`customer_relationship_id`, `product_id`) parmi les lignes non supprimées ; article du fournisseur de la relation |
| C-12 | CustomerRelationshipReassignment.previous_person_id, CustomerRelationshipReassignment.new_person_id | `CustomerRelationshipReassignment` : `previous_person_id` et `new_person_id` renseignés ; aucune relation existante entre la nouvelle personne et le même fournisseur ; une seule contestation par relation et par personne ; aucune modification ni suppression |
| C-13 | Product.price, Product.min_order_quantity, Product.price_updated_at | `Product.price > 0` ; `min_order_quantity > 0` s'il est renseigné ; `price_updated_at` fixé par le serveur à chaque changement de prix |
| C-14 | Order | `Order` : relation `ACTIVE` à la création, dont le fournisseur est une organisation active — ni suspendue, ni fermée (v1) |
| C-15 | OrderLine.quantity, Product.min_order_quantity, Order | `Order` : chaque ligne porte sur un article `ACTIVE` du fournisseur de la relation ; sur une commande passée par le client, `quantity ≥ min_order_quantity` à l'envoi |
| C-16 | Order.cancelled_by_party, Order.cancelled_by_id, Order.cancelled_at, Order.status, Order.cancellation_reason | `Order` : `cancelled_by_party`, `cancelled_by_id` et `cancelled_at` renseignés ⟺ `status = CANCELLED` ; `cancellation_reason` renseigné seulement si `CANCELLED`, et obligatoire quand `cancelled_by_party = SUPPLIER` |
| C-17 | Order.status, Order.placed_by_party | `Order` : `status = PENDING` ⇒ `placed_by_party = CUSTOMER` |
| C-18 | Order.supplier_note | `Order` : changements de statut limités aux étapes permises ; la livraison l'emporte ; commande livrée ou annulée figée, sauf `supplier_note` (appliqué par le serveur, voir 9.2 et l'annexe) |
| C-19 | Order.delivered_at, Order.delivered_by_id, Order.status, OrderLine.delivered_quantity, Order.total_amount, OrderLine.amount, Order.delivery_cost | `Order` : `delivered_at` et `delivered_by_id` renseignés ⟺ `status = DELIVERED` ; chaque ligne porte alors `delivered_quantity` ; `total_amount` = Σ `OrderLine.amount` + `delivery_cost` |
| C-20 | OrderLine.amount, OrderLine.unit_price_applied, OrderLine.reference_price, OrderLine.price_set_by_id, OrderLine.price_set_at | `OrderLine` : `amount` = quantité × prix appliqué, arrondi au franc (0,5 vers le haut), recalculé par le serveur ; sur une commande passée par le client, `unit_price_applied = reference_price` à l'envoi, puis jamais au-dessus ; `price_set_by_id` et `price_set_at` renseignés ⟺ `unit_price_applied ≠ reference_price` |
| C-21 | Delivery.assigned_to_id, Delivery.arrived_at, Delivery.failed_at, Delivery.failure_reason, Delivery.order_id | `Delivery` : `assigned_to_id` collaborateur actif du fournisseur, livreur ou plus ; `arrived_at` et `failed_at` jamais renseignés ensemble ; `failure_reason` renseigné ⟺ `failed_at` renseigné ; au plus une livraison en cours par commande (index unique partiel sur `order_id` où les deux sont vides) |
| C-22 | Delivery | `Delivery` : une livraison pas encore partie est supprimée si sa commande est annulée ou livrée sans elle ; en cas de départs croisés, le serveur garde le premier et enregistre l'autre close |
| C-23 | LedgerEntry.amount, LedgerEntry.balance_effect, LedgerEntry.kind, LedgerEntry.reverses_entry_id, LedgerEntry.mode | `LedgerEntry.amount > 0` ; `balance_effect` colonne générée à partir de `kind`, `amount` et `reverses_entry_id` ; `mode` renseigné ⟺ `kind` ∈ (`PAYMENT`, `REFUND`) |
| C-24 | LedgerEntry.kind, LedgerEntry.order_id, LedgerEntry.amount, Order.total_amount | `LedgerEntry` : `kind = SALE` ⇒ `order_id` renseigné, `amount` = `Order.total_amount` (fixé par le serveur), au plus une vente non annulée par commande ; `order_id` obligatoire pour le paiement né de « Commande livrée » |
| C-25 | LedgerEntry.reverses_entry_id | `LedgerEntry` : aucune modification ni suppression ; `reverses_entry_id` unique, même relation, même type, même montant, pointant une écriture qui n'est pas elle-même une annulation |
| C-26 | * | Vente sur un comptoir : encaissement intégral |
| C-27 | Expense.amount, Expense.paid_by_id, Handover.amount, Handover.from_person_id, Handover.to_person_id, Handover.cancelled_at, Handover.cancelled_by_id | `Expense.amount > 0`, `paid_by_id` collaborateur du commerce, actif ou parti ; `Handover.amount > 0`, `from_person_id` collaborateur du commerce, actif ou parti, `from_person_id <> to_person_id` sauf la remise automatique de l'ancien propriétaire à lui-même au transfert de propriété, `to_person_id` `OWNER` ou `MANAGER` actif de l'organisation ; aucune modification, sinon l'annulation : `cancelled_at` et `cancelled_by_id` renseignés ensemble, une seule fois |
| C-28 | Report | `Report` : exactement une cible renseignée |
| C-29 | Administrator.totp_secret, Administrator.recovery_email, Person.email, AdminAction.reason, AdminAction.sync_archive_id, AdminAction.action | `Administrator.totp_secret` obligatoire ; `recovery_email` différente de `Person.email` ; `AdminAction` : exactement une cible renseignée, `reason` obligatoire, `sync_archive_id` renseigné ⟺ `action = REPLAY_SYNC` (réservé à un `SUPER_ADMIN`), aucune modification ni suppression |
| C-30 | Notification.related_entity_type, Notification.related_entity_id | `Notification` : destinataire inscrit ; `related_entity_type` et `related_entity_id` renseignés ensemble ou ni l'un ni l'autre |
| C-31 | Subscription.organization_id, Subscription.status | `Subscription` unique partiel sur `organization_id` où `status = ACTIVE` |
| C-32 | SyncArchive, PhoneNumberChangeLog | `SyncArchive`, `PhoneNumberChangeLog` : aucune modification ni suppression, hors purge après la durée de conservation |
| C-33 | OtpChallenge.attempts, OtpChallenge.channel, OtpChallenge.target | `OtpChallenge` : `attempts ≤ 5` ; un code consommé ou expiré ne sert plus ; SMS seulement vers les numéros +237 ; `channel = EMAIL` ⇒ `target` est l'email de la personne, ou l'adresse de secours d'un administrateur, déjà vérifiés sauf pour `EMAIL_VERIFICATION` |
| C-34 | Device.last_synced_at, Device.scope_version_seen, RefreshToken.token_hash, RefreshToken.revoked_reason, RefreshToken.revoked_at | `Device` : `last_synced_at` et `scope_version_seen` fixés par le serveur ; `RefreshToken.token_hash` unique ; `revoked_reason` renseigné ⟺ `revoked_at` renseigné |
| C-35 | * | Tables synchronisées : `server_updated_at` fixée par le serveur à chaque changement ; suppression par `deleted_at` ; toutes les contraintes d'unicité ignorent les lignes supprimées |
| C-36 | * | Synchronisation : aucune contrainte d'unicité ne fait échouer un envoi ; chaque doublon possible a sa conduite écrite, et une ligne qu'aucune règle ne sait écrire est mise de côté (voir 9.2) |
| C-37 | CustomerRelationship.balance, Collaboration.amount_held | Caches `CustomerRelationship.balance` et `Collaboration.amount_held` : mis à jour par ajout de l'effet de chaque opération, dans sa transaction ; deux caches toujours dans l'ordre client puis collaborateur ; contrôle de nuit contre la somme des effets |
| C-38 | * | Routes en ligne : chaque geste porte l'identifiant créé par le téléphone ; un identifiant déjà reçu ne refait rien |
| C-39 | LedgerEntry, SyncArchive, PhoneNumberChangeLog, CustomerRelationshipReassignment, CreditLimitChange, AdminAction | Tables immuables (`LedgerEntry`, `SyncArchive`, `PhoneNumberChangeLog`, `CustomerRelationshipReassignment`, `CreditLimitChange`, `AdminAction`) : le compte applicatif n'a que les droits `INSERT` et `SELECT` |

## Manual

Constraints stated only in prose, added by the skill: `CM-nn | Entity.field(s) | rule (design line N)`.

| ID | Entity.field(s) | rule |
|---|---|---|
| CM-01 | Person.full_name, Person.email, Person.email_verified_at, Person.preferred_language, Person.password_hash, Person.phone_number, Person.released_phone_number | Anonymization erases full_name, email, email_verified_at, preferred_language and password_hash, releases the number (moves it to released_phone_number), sets status ANONYMIZED and anonymized_at (design lines 67, 68) |
| CM-02 | Person.anonymized_at | Account deletion is refused while the person has a positive balance on a relation where they are the customer, or owns an organization that is neither transferred nor closed (design lines 68, 73) |
| CM-03 | Person.scope_version, Device.scope_version_seen | Person.scope_version is incremented by the server on every rights change: collaboration added or revoked, role changed, relation corrected or contested (design line 69) |
| CM-04 | Person.phone_number, Person.released_phone_number, Person.phone_verified_at | Releasing a number moves it from phone_number to released_phone_number and clears phone_verified_at; lookups, SMS and registration read only the active number (design line 71) |
| CM-05 | Person.password_hash | Password: 8 to 64 characters, spaces allowed, no composition rules, refused when on the common or leaked password blocklist; hashed with Argon2id; 5 failed attempts force a wait (design lines 63, 108-111) |
| CM-06 | OtpChallenge.expires_at, OtpChallenge.consumed_at | A code expires 10 minutes after sending and works once (design lines 1051-1053) |
| CM-07 | OtpChallenge.target, OtpChallenge.channel | Sending limits: 3 codes per hour per number, 1 minute before a resend, caps per device and per IP address, a global daily cap that alerts the team; SMS only to +237 mobiles (design lines 1061-1063) |
| CM-08 | RefreshToken.expires_at, RefreshToken.rotated_at, RefreshToken.revoked_at, RefreshToken.device_id | Access token (JWT) lives 15 minutes and is not stored; refresh token lives 90 days, extended at each use, replaced at each use; a reused token revokes only its own device session (REUSE_DETECTED) (design lines 92, 1098-1104) |
| CM-09 | Collaboration.role, Collaboration.status | The OWNER can be neither demoted nor revoked; ownership transfer makes the chosen active collaborator OWNER and the former owner MANAGER in one transaction; a revocation takes effect immediately (design lines 170, 190, 192) |
| CM-10 | Organization.status | CLOSED (by the owner, reopenable): no new order or customer, not findable by number, pending orders refused with reason 'Commerce fermé', team revoked, subscription stopped; relations, balances and history stay visible and payments stay possible (design line 154) |
| CM-11 | CustomerPrice.price, Product.price, OrderLine.reference_price | Reference price of a line = negotiated price when one exists (even higher than the product price), else the product price (design lines 333, 335) |
| CM-12 | Order.status | Allowed transitions only: PENDING to CONFIRMED or CANCELLED; CONFIRMED to IN_DELIVERY, DELIVERED or CANCELLED; IN_DELIVERY to DELIVERED or CONFIRMED (failed attempt); DELIVERED wins over CANCELLED; DELIVERED and CANCELLED are frozen except supplier_note (design lines 463-465, annex A.2) |
| CM-13 | LedgerEntry.amount, Order.total_amount | The amount of a sale is always Order.total_amount computed by the server on delivered quantities; the amount sent by the phone is ignored (design line 493) |
| CM-14 | OrderLine.amount | Line amount = quantity in thousandths times applied price, divided by 1000, rounded to the nearest franc with 0.5 rounded up, integer arithmetic only; 2.5 x 333 gives 833 (design lines 541, 545) |
| CM-15 | CustomerRelationship.credit_limit, CustomerRelationship.balance | At delivery, the unpaid part must not bring the balance above credit_limit (null limit = no limit); example: limit 50 000, balance 40 000, order 30 000 requires collecting at least 20 000 (design lines 290-299) |
| CM-16 | OrderLine.unit_price_applied, OrderLine.reference_price | Customer-placed order: unit_price_applied equals the server-computed reference price at sending; the supplier may only lower it, at acceptance; prices freeze at acceptance (customer order) or at departure or delivery (supplier order) (design lines 549-552) |
| CM-17 | Collaboration.amount_held | amount_held = payments recorded minus refunds made, expenses paid and handovers given, plus handovers received; a reversed entry counts the other way; a cancelled expense or handover no longer counts; the owner's amount is tracked but never presented (design lines 717, 721) |
| CM-18 | Handover.amount, Collaboration.amount_held | At ownership transfer the server records a handover from the former owner to themselves for their amount_held, so it restarts at 0 (design lines 190, 721) |
| CM-19 | CustomerRelationship.customer_label, CustomerRelationship.supplier_notes, CustomerRelationship.supplier_label | customer_label and supplier_notes are never sent to the customer; supplier_label is never sent to the supplier; each party writes only its own fields (design line 313) |
| CM-20 | Person.full_name, Person.phone_number, Person.registered_at | An organization receives from a Person only the public name, the number and whether they are registered; everything else is private (design lines 25, 122) |
| CM-21 | LedgerEntry.kind | A returned-and-refunded gesture records a CREDIT_NOTE and a REFUND of the same amount in one transaction (design line 657) |
| CM-22 | OrderLine.delivered_quantity, Order.parent_order_id | Partial delivery: 'later' creates a CONFIRMED order for the remainder at the original order's prices, linked by parent_order_id; 'abandon' closes the order on what was delivered; abandon by a non-owner joins the owner's exceptions (design lines 503-504) |
| CM-23 | Delivery.order_id | Crossed departures: the server keeps the first delivery and stores the other closed with sync_issue 'Livraison déjà prise par <name>'; if the second one delivered, the delivery wins and the other is closed (design line 578) |
| CM-24 | CustomerRelationshipReassignment.new_person_id | Contestation moves the relation to a ghost Person holding the number as released number; the supplier confirms 'C'est bien ce client' with a reason to bring it back to the same number, after which the customer can no longer contest; an invitation that is contested is deleted (design lines 369-371) |
| CM-25 | CustomerRelationship.supplier_person_id, CustomerRelationship.supplier_organization_id, CustomerRelationship.status | Supplier invitation: acceptance replaces supplier_person_id by supplier_organization_id and sets ACTIVE, on behalf of an organization the person manages; refused, cancelled, contested or released-number invitations are deleted (design lines 270-272) |
| CM-26 | Person.phone_number, Organization.status, Collaboration.is_public_contact | Finding an organization by number returns only ACTIVE organizations whose public-contact collaborators hold that active number; a number that is not a public organization number leads to an invitation for every person, registered or not (design lines 148, 154, 262) |
| CM-27 | * | Sync: computed fields (balance, amount_held, balance_effect, totals, line amounts, sale amount, customer-order reference price, price_updated_at, credit_limit_set_at, ended_by_party, last_synced_at, scope_version, server_updated_at) are ignored on receipt and recomputed (design lines 862, annex A.1) |
| CM-28 | * | Sync outcomes: a business problem is stored with sync_issue; a conflict is refused until the phone pulls and resends; a forbidden send is refused, recorded, and triggers a full resync plus a notification to its author; a line no rule can write is set aside while the rest passes (design lines 869-881) |
| CM-29 | Device.scope_version_seen, Person.scope_version | First send after a rights change (scope_version_seen older than scope_version): judged with current rights; seller operations (sales, deliveries, collections) are always accepted and reported to the owner, any other forbidden operation is refused and reported (design lines 883-887) |
| CM-30 | * | Sync pull returns only what the user may see; a driver receives, per customer, only the available credit (limit minus balance) instead of balance and limit; the phone keeps all customers, the catalog, open orders and the last 90 days of the rest (design lines 990-995) |
| CM-31 | Device.app_version, Device.last_synced_at | The server refuses a sync from an app version below the platform minimum; a phone clock more than 5 minutes off makes the app ask for automatic time; operations dated in the future or more than 3 days after the phone's last sync are reported to the owner, never refused (design lines 919-923) |
| CM-32 | SyncArchive.changes, AdminAction.sync_archive_id | Only a SUPER_ADMIN replays an archived batch, with a mandatory reason, logged as REPLAY_SYNC; it is judged as if sent by its author with their current rights, never the administrator's; the author and the owner are notified (design lines 936-938) |
| CM-33 | Report.decision, Person.status, Organization.status | A SUSPENSION decision sets the target's status to SUSPENDED and revokes the sessions of a suspended person (reason ACCOUNT_SUSPENDED); every decision, and every suspension or reactivation, is logged in AdminAction (design lines 760-762, 806) |
| CM-34 | Administrator.recovery_email, OtpChallenge.purpose | A TOTP_RECOVERY code sent to the recovery email only allows installing a new TOTP key; each use is logged as RECOVER_2FA and notified to the administrator's phones and to the other super administrators (design lines 783, 1049) |
| CM-35 | * | Retention: commercial data and journals at least 10 years; notifications 24 months; SyncArchive 90 days; expired or revoked verification codes and tokens 30 days; the daily purge runs under the migration account (design lines 1150-1157) |
