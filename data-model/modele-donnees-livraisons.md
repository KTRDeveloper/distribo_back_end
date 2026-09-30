# Modèle de données — Application SaaS de gestion de livraisons

## Légende
- **PK** : clé primaire
- **FK** : clé étrangère
- Les énumérations sont indiquées entre crochets `[VALEUR_A / VALEUR_B]`
- Noms d'entités, propriétés et énumérations en **anglais** (convention technique du code) ; descriptions en français.

> **Note de version** — La section 1 a été refondue : l'ancienne entité `User` est scindée en `Person` (la personne physique) et `Account` (les identifiants de connexion), et `Customer` devient une pure relation entre une `Person` et une `Organization`. La numérotation des sous-sections a été remise à plat (suppression des suffixes `bis`/`quater`). Les conséquences de cette refonte sont reportées dans l'ensemble du document.

---

## 1. Identité et organisation

### 1.1 `Person`
Personne physique connue de la plateforme, **indépendamment de sa capacité à se connecter**. Racine de toute identité : toutes les relations du modèle qui désignent un individu référencent `Person.id`.

Une `Person` existe dès qu'une organisation saisit une fiche client, même si la personne ne s'est jamais inscrite. L'inscription ultérieure n'ajoute qu'un `Account` au-dessus de la `Person` existante (voir 1.2).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| full_name | string, nullable | Nom canonique, **saisi par la personne elle-même à la création de son `Account`** et modifiable par elle seule. Reste vide tant que la personne est un invité : une organisation n'écrit jamais dans `Person`. **Donnée publique** — identité affichable de la personne inscrite sur la plateforme |
| phone_number | string, **unique globalement** | Identifiant naturel de la personne, et canal SMS. Non modifiable par une organisation (voir 1.5) |
| phone_verified_at | datetime, nullable | Renseigné uniquement après vérification OTP (inscription, ou changement de numéro par le titulaire). Vide = numéro simplement saisi par une organisation, donc non fiable |
| email | string, nullable | **Privé** — jamais exposé à une organisation |
| preferred_language | enum `[FR / EN]`, nullable | Privé. Détectée automatiquement, modifiable par le titulaire |
| created_at | datetime | |
| status | enum `[ACTIVE / SUSPENDED / ANONYMIZED]` | Modifié par un administrateur/modérateur ; `ANONYMIZED` si le titulaire a supprimé son compte |
| anonymized_at | datetime, nullable | Date de la demande de suppression. La suppression est bloquée tant qu'une `Debt` liée à cette `person_id` a le statut `OUTSTANDING` |

*Règle de réutilisation (structurante) : lorsqu'une organisation crée une fiche client, le système recherche d'abord une `Person` portant ce `phone_number`. Si elle existe, elle est **réutilisée** ; seule la relation `Customer` est créée. Sinon, une nouvelle `Person` est créée. Une organisation peut donc se rattacher silencieusement à une `Person` créée par une autre organisation — c'est le prix assumé de l'absence de toute fusion d'identités dans le modèle.*

*Limite assumée : `full_name` étant public, une organisation qui saisit un numéro déduit de l'apparition d'un nom que la personne est inscrite. Il n'est donc pas possible de masquer totalement l'existence d'un compte. Ce résidu d'oracle se traite par limitation de débit sur la création de fiches (une organisation légitime en saisit peu), et non par une règle structurelle — le nom étant de toute façon destiné à être affiché.*

*Cloisonnement : une `Person` étant globale, la confidentialité repose sur `Customer` — une organisation ne voit d'une `Person` que son nom public, son numéro, ce que porte sa propre relation (`display_label`, adresse, préférences) et son propre historique transactionnel.*

*Une `Person` invitée ne contient par construction **aucune donnée saisie par une organisation** hormis son numéro : `full_name`, `email` et `preferred_language` restent vides jusqu'à la création d'un `Account`. Une organisation ne peut donc jamais lire, via une `Person` partagée, une information renseignée par une autre organisation. Corollaire utile : aucune écriture concurrente n'est possible sur `Person`, deux organisations ne pouvant se disputer un champ qu'aucune des deux n'alimente.*

*Reste à protéger au niveau de la couche d'accès : la **topologie des relations** (le fait qu'une personne soit cliente d'une autre organisation — c'est précisément ce que la section 6 vise à contrôler) et les champs privés (`email`, `preferred_language`). Aucune requête ne doit exposer l'un ni les autres.*

*Nom affiché : une organisation affiche `Customer.display_label` s'il est renseigné, sinon `Person.full_name`. Le libellé local reste une surcharge — il couvre les invités, qui n'ont pas de `full_name`, et les cas où l'organisation connaît la personne sous un autre nom.*

### 1.2 `Account`
Identifiants de connexion, adossés à une `Person`. Une `Person` sans `Account` est un **invité** (ex-« client fantôme ») : elle ne peut par construction pas se connecter, l'absence de ligne remplaçant toute règle applicative de blocage.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person, **unique** | Un `Account` au maximum par personne |
| password_hash | string | |
| created_at | datetime | Date d'inscription. Tient lieu de date de rattachement lorsque la `Person` préexistait (ex-`claimed_at`). C'est également à ce moment que `Person.full_name` est renseigné, par la personne elle-même |
| last_login_at | datetime, nullable | |

*Logique d'inscription : la personne saisit son numéro, le système envoie un OTP. Après vérification (`Person.phone_verified_at` renseigné), deux cas — soit aucune `Person` n'existe pour ce numéro et elle est créée, soit une `Person` invitée existe et l'utilisateur en est informé (organisation(s) concernée(s), et notamment toute `Debt` `OUTSTANDING` qu'il s'apprête à reprendre) puis confirme explicitement avant création de l'`Account`.*

*En cas de refus (numéro recyclé, fiche erronée), une nouvelle `Person` est créée pour l'inscrit et l'ancienne est marquée non revendicable — son historique reste attaché à elle, ce qui est le comportement voulu : les commandes appartiennent à l'organisation qui les a saisies. Le `phone_number` de l'ancienne `Person` doit alors être libéré (préfixé/neutralisé) pour respecter l'unicité globale.*

*Aucune réécriture de clé étrangère n'intervient à l'inscription : les `Order`, `Debt`, `Payment`, `Rating` et `CustomerChannelRelation` visaient déjà cette `Person` et continuent de la viser.*

### 1.3 `PhoneNumberChangeLog`
Journal de sécurité des changements de numéro de téléphone d'une `Person`. Le changement n'a aucun impact sur l'historique : toutes les relations du modèle référencent `Person.id`, jamais `phone_number` directement.

**Portée élargie** : le numéro étant désormais porté par une `Person` globale, un changement se répercute simultanément sur toutes les organisations en relation avec elle (canal SMS, rapprochements futurs). Le changement est réservé au titulaire d'un `Account` et exige une vérification OTP du nouveau numéro.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | |
| old_phone_number | string | |
| new_phone_number | string | |
| verified_at | datetime | Confirmation par SMS envoyé au nouveau numéro ; met à jour `Person.phone_verified_at` |
| changed_at | datetime | |

### 1.4 `Customer`
**Relation** entre une `Person` et une `Organization` — et non une identité. Une ligne par couple (personne, organisation) : une même personne cliente de trois organisations a trois `Customer`, portant chacun ses propres coordonnées de livraison et son propre libellé.

Sert de « client » au sens de la relation commerciale ; l'émetteur d'une `Order` reste la `Person` (voir 4.1).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person, **non nullable** | |
| organization_id | FK → Organization | L'entreprise ou le sous-traitant avec qui cette relation existe |
| display_label | string, nullable | Nom tel que **cette** organisation connaît la personne (ex: "Papa Diop" là où le compte indique "Mamadou Diop"). Surcharge locale : l'organisation affiche ce libellé s'il est renseigné, sinon `Person.full_name`. Indispensable pour les invités, qui n'ont pas de `full_name` |
| delivery_address | string, nullable | Propre à cette relation (peut différer d'une organisation à l'autre) |
| preferences | text/JSON, nullable | |
| created_at | datetime | |

*Contrainte d'unicité : unique par (`person_id`, `organization_id`).*

*La distinction « client enregistré / client fantôme » n'existe plus au niveau de la relation : elle se lit sur la `Person` (présence ou absence d'un `Account`), et n'a aucune incidence sur la structure de `Customer`.*

### 1.5 `CustomerPersonReassignment`
Journal des réaffectations d'une relation client vers une autre `Person` — typiquement la correction d'un numéro saisi par erreur après que des commandes ou des dettes ont été créées.

La correction s'opère en **repointant `Customer.person_id`**, jamais en modifiant `Person.phone_number` (interdit aux organisations) et jamais en réécrivant des clés étrangères.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_id | FK → Customer | |
| previous_person_id | FK → Person | |
| new_person_id | FK → Person | |
| reassigned_by_id | FK → Account | Collaborateur ayant effectué la correction |
| reason | text, nullable | Libellé libre, sans catégorisation prédéfinie (même logique que `StockMovement.note`) |
| reassigned_at | datetime | |

*Politique v1 : la réaffectation est **autorisée librement**, sans condition. L'historique transactionnel suit la relation, donc les `Debt` en cours changent de personne — d'où l'exigence de traçabilité. Des conditions pourront être ajoutées en v2 (blocage si une `Debt` est `OUTSTANDING`, ou obligation que la `Person` cible ait `phone_verified_at` vide) sous forme de `CHECK` ou de règle applicative, sans modification des données existantes.*

### 1.6 `Organization`
Entité générique représentant soit une **entreprise** (entrepreneur), soit un **sous-traitant** — les deux partagent la même structure sous-jacente (stock propre, collaborateurs propres).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| type | enum `[BUSINESS / CONTRACTOR]` | |
| name | string | |
| owner_account_id | FK → Account | Le créateur, détenteur du poste "Propriétaire" implicite. Nécessairement un compte : une `Person` invitée ne peut pas posséder d'organisation |
| phone_numbers | text/JSON, nullable | Un ou plusieurs numéros de contact. **Donnée publique**. Contrairement à `Person.phone_number` : pas de vérification OTP, pas d'unicité globale — coordonnée de contact, pas un mécanisme d'authentification |
| description | text, nullable | **Donnée publique** — fiche de présentation de l'organisation |
| email | string, nullable | Contact public/semi-public (support, demandes). À la différence de `Person.email`, qui est privé |
| created_at | datetime | |

*Note : un même `Account` peut posséder plusieurs `Organization` distinctes (plusieurs entreprises et/ou identités de sous-traitant), sans limite. Chacune reste totalement indépendante des autres — stock, clients, finances propres — aucune contrainte d'unicité n'est posée sur `owner_account_id`.*

### 1.7 `Permission`
Catalogue fermé, défini et géré par la plateforme (super-administrateur).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| code | string, unique | ex: `MANAGE_STOCK`, `VIEW_FINANCES` |
| display_name | string | |
| domain | enum `[SALES / STOCK / FINANCE / DELIVERY / HR_ACCESS / CONTRACTORS]` | |

### 1.8 `Position`
Composé librement par une Organization (entreprise ou sous-traitant) à partir du catalogue de permissions.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | |
| name | string | ex: "Manager", "Comptable" |
| is_owner_position | boolean | Vrai pour le poste implicite, non modifiable/non supprimable |

### 1.9 `PositionPermission` (table de liaison)
| Champ | Type |
|---|---|
| position_id | FK → Position |
| permission_id | FK → Permission |

### 1.10 `Collaboration`
Lie un compte à un poste au sein d'une organisation.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| account_id | FK → Account | Un invité (`Person` sans `Account`) ne peut pas être collaborateur — contrainte obtenue par construction |
| position_id | FK → Position | |
| organization_id | FK → Organization | Dénormalisé pour requêtes rapides |
| status | enum `[INVITED / ACTIVE / REVOKED]` | |
| invited_at | datetime | |
| accepted_at | datetime, nullable | |

---

## 2. Catalogue et stock

### 2.1 `Product`
Concept générique regroupant les variantes (voir `ProductVariant`) — porte uniquement le nom/description commun.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| business_organization_id | FK → Organization | Toujours une Organization de type BUSINESS |
| name | string | |
| description | text | |

### 2.2 `ProductVariant`
Unité de gestion concrète d'un produit : combine une **gamme** (qualité/variante, ex: "Standard", "Premium") et une **unité de mesure** (ex: "kg", "carton", "litre", "boîte"). Chaque variante a son propre stock et ses propres prix, totalement indépendants des autres variantes du même produit — **aucune conversion** n'est faite entre unités.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| product_id | FK → Product | |
| range_name | string | ex: "Standard", "Premium" |
| unit | string | ex: "kg", "carton", "litre", "boîte" |
| catalog_price | decimal | Prix de référence public, propre à cette variante |
| default_wholesale_price | decimal, nullable | Prix de gros par défaut, propre à cette variante (surchargeable via `ProductWholesalePrice`, voir 3.3) |
| status | enum `[ACTIVE / INACTIVE]` | `INACTIVE` = suppression logique (retiré du catalogue) : invisible aux nouvelles commandes, mais conservée pour préserver l'intégrité des commandes/stocks historiques. Réactivable à tout moment sans validation supplémentaire |

### 2.3 `Stock`
Existe à deux niveaux : chez l'entreprise, et chez chaque sous-traitant (pour les variantes qu'il gère). Suivi indépendamment **par variante** (une gamme/unité peut être en rupture pendant qu'une autre du même produit est disponible).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | Entreprise OU sous-traitant |
| product_variant_id | FK → ProductVariant | |
| quantity_available | decimal | |
| alert_threshold | decimal | Déclenche une alerte de réapprovisionnement |

### 2.4 `StockMovement`
Journal des entrées/sorties (traçabilité).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| stock_id | FK → Stock | |
| type | enum `[IN / OUT]` | |
| quantity | decimal | |
| source_order_id | FK, nullable | Commande à l'origine du mouvement ; vide pour un ajustement manuel |
| recorded_by_id | FK → Account | Collaborateur ayant enregistré le mouvement (saisie automatique liée à une commande, ou ajustement manuel) |
| note | text, nullable | Libellé libre, pertinent surtout pour un ajustement manuel (`source_order_id` vide) : ex. casse, perte, correction d'inventaire |
| date | datetime | |

---

## 3. Partenariats et relations commerciales

> **Note de version** — Le prix de revente a été retiré de `PartnershipAgreement` : il ne peut être fixé qu'au niveau du produit/de la variante, jamais comme valeur unique pour toute une relation couvrant des produits hétérogènes. L'autorisation d'un sous-traitant à opérer sur un produit donné est désormais portée par une entité dédiée, `PartnershipProduct` (3.2), avec un statut et une terminaison **indépendants par produit** — un sous-traitant peut cesser un produit sans que la relation dans son ensemble se termine. `ProductWholesalePrice` (désormais 3.3) référence cette nouvelle entité plutôt que l'accord directement.

### 3.1 `PartnershipAgreement`
Relation contractuelle-cadre entre une entreprise et un sous-traitant. **Toujours un contrat de revente** : le sous-traitant achète la marchandise à l'entreprise (via une commande groupée), la détient dans son propre `Stock`, puis la revend à ses clients. Ne porte que ce qui est réellement invariant à l'échelle de la relation entière — ni prix (dépend du produit/de la variante, voir 3.2 et 3.3), ni autorisation par produit (voir 3.2).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| business_id | FK → Organization | |
| contractor_id | FK → Organization | |
| payment_terms | enum `[BEFORE_DELIVERY / AFTER_COLLECTION]` | |
| status | enum `[REQUESTED / ACTIVE / REFUSED / TERMINATED]` | REQUESTED tant que l'acceptation mutuelle n'est pas faite |
| initiator_id | FK → Organization | Qui a lancé la demande (entreprise ou sous-traitant) |
| initiator_note | string, nullable | Note laissée par `initiator_id` lors de la demande |
| recipient_note | string, nullable | Note laissée par l'autre partie (ex. motif de refus, commentaire à l'acceptation) |
| created_at | datetime | |
| refused_at | datetime, nullable | |
| terminated_at | datetime, nullable | |

*Terminaison : `status = TERMINATED` met fin à la relation dans son ensemble et **résilie en cascade** toute ligne `PartnershipProduct` encore `ACTIVE` (voir 3.2). L'inverse n'est pas vrai : un sous-traitant peut cesser de vendre un produit particulier (résiliation au niveau de 3.2 uniquement) sans que l'accord-cadre se termine.*

*`REFUSED` est un état terminal distinct de `TERMINATED` : un accord refusé n'a jamais été actif, donc aucun `PartnershipProduct` ne peut exister dessous.*

### 3.2 `PartnershipProduct`
Portée d'un produit précis au sein d'un accord : déclare qu'un sous-traitant est autorisé à commander/stocker/revendre **ce produit**, avec un statut et une terminaison propres — indépendants des autres produits couverts par le même accord.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| agreement_id | FK → PartnershipAgreement | |
| product_id | FK → Product | Le produit autorisé, au niveau générique (même granularité que `CustomerChannelRelation`, pas la variante) |
| status | enum `[REQUESTED / ACTIVE / REFUSED / TERMINATED]` | Indépendant du statut des autres produits de la même relation |
| initiator_id | FK → Organization | Qui a demandé l'association de ce produit — doit être `agreement.business_id` ou `agreement.contractor_id` |
| initiator_note | string, nullable | Note laissée par `initiator_id` lors de la demande |
| recipient_note | string, nullable | Note laissée par l'autre partie (ex. motif de refus, commentaire à l'acceptation) |
| added_at | datetime | |
| refused_at | datetime, nullable | |
| terminated_at | datetime, nullable | |
| termination_stock_cleared | boolean | Vrai quand le stock du sous-traitant **pour ce produit** est écoulé/retourné |

*Contrainte d'unicité : unique par (`agreement_id`, `product_id`).*

*C'est cette ligne, et non `PartnershipAgreement`, qui autorise effectivement un sous-traitant à opérer sur un produit donné — voir la contrainte de cohérence avec `CustomerChannelRelation` en 3.4.*

*`REFUSED` est un état terminal distinct de `TERMINATED` : un produit refusé n'a jamais été actif, donc pas de stock possible — `termination_stock_cleared` est sans objet dans ce cas.*

*Politique v1 (sur le modèle de `CustomerPersonReassignment`, voir 1.5) : la contrainte d'unicité (`agreement_id`, `product_id`) est conservée telle quelle. Redemander un produit `REFUSED` réutilise la même ligne (repasse à `REQUESTED`), ce qui écrase la note de refus précédente. Une séparation en journal dédié (comme `ChannelChangeRequest`, voir 3.5) pourrait être introduite en v2 si l'historique des refus successifs devient nécessaire.*

### 3.3 `ProductWholesalePrice`
Prix de gros négocié, par variante de produit, pour un produit autorisé d'un accord — surcharge le `default_wholesale_price` de la `ProductVariant`.

| Champ | Type |
|---|---|
| id | PK |
| partnership_product_id | FK → PartnershipProduct |
| product_variant_id | FK → ProductVariant |
| wholesale_price | decimal |

*Cohérence : la variante référencée doit appartenir au même produit que `PartnershipProduct.product_id`.*

### 3.4 `CustomerChannelRelation`
Modélise la règle d'exclusivité (personne, entreprise, produit) : un seul canal actif à la fois.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | La personne physique, qu'elle dispose ou non d'un `Account` |
| business_id | FK → Organization | |
| product_id | FK → Product | |
| channel_type | enum `[DIRECT / CONTRACTOR]` | |
| contractor_id | FK → Organization, nullable | Renseigné si channel_type = CONTRACTOR |
| status | enum `[ACTIVE / SUSPENDED]` | SUSPENDED après une rupture de partenariat |
| started_at | datetime | |

*Contrainte d'unicité : **index unique partiel** sur (`person_id`, `business_id`, `product_id`) où `status = ACTIVE`. Posée au niveau base de données, pas seulement applicatif.*

*Cette contrainte est désormais réellement applicable : `Person` étant unique par personne physique et globale à la plateforme, les deux canaux concurrents d'un même client pointent nécessairement vers la même ligne. C'était l'objectif principal de la refonte de la section 1 — dans le modèle précédent, où l'identité client était scopée par organisation, la même personne existait en deux lignes distinctes et la contrainte ne bloquait rien.*

*Le fait qu'une personne soit invitée (sans `Account`) ne l'exempte pas de la règle : deux organisations saisissant le même numéro se rattachent à la même `Person`, donc l'exclusivité s'applique. Le seul cas résiduel de contournement est celui d'un numéro erroné ou absent au moment de la saisie.*

*Cohérence avec le partenariat : si `channel_type = CONTRACTOR`, le couple (`contractor_id`, `product_id`) doit correspondre à une ligne `PartnershipProduct` au statut `ACTIVE` (via l'accord entre ce sous-traitant et `business_id`) — un client ne peut pas être routé vers un sous-traitant qui n'est pas autorisé à vendre ce produit.*

### 3.5 `ChannelChangeRequest`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| current_relation_id | FK → CustomerChannelRelation | |
| new_channel_type | enum `[DIRECT / CONTRACTOR]` | |
| new_contractor_id | FK, nullable | |
| status | enum `[PENDING / ACCEPTED / IN_RETENTION / FREE]` | |
| requested_at | datetime | |
| retention_end_at | datetime, nullable | Calculée si refus |

---

## 4. Commandes et livraisons

### 4.1 `Order`
Entité **unique et récursive** : une commande est une transaction entre un émetteur et un destinataire, quel que soit leur type. Il n'existe pas de distinction structurelle entre une "commande individuelle" et une "commande groupée" — ce n'est qu'une interprétation selon qui sont les parties prenantes :
- **Client → Sous-traitant** ou **Client → Entreprise** (canal direct) : ce qu'on appelait auparavant "commande individuelle".
- **Sous-traitant → Entreprise** : ce qu'on appelait auparavant "commande groupée".

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| issuer_type | enum `[PERSON / ORGANIZATION]` | Discriminant léger : une personne (avec ou sans `Account`), ou un sous-traitant passant une commande groupée |
| issuer_id | FK → Person ou Organization | Celui qui passe commande, selon `issuer_type` |
| recipient_id | FK → Organization | Celui qui la reçoit (un sous-traitant, ou une entreprise) |
| channel_relation_id | FK → CustomerChannelRelation, nullable | Renseigné uniquement si l'émetteur est une personne (`issuer_type = PERSON`) |
| total_amount | decimal | |
| delivery_cost | decimal | 0 si absorbé |
| status | enum `[PENDING / PENDING_STOCK / CONFIRMED / IN_DELIVERY / PARTIALLY_DELIVERED / DELIVERED / FAILED / CANCELLED]` | `PARTIALLY_DELIVERED` : le destinataire (souvent l'entrepreneur, en cas de rupture de stock) a choisi de livrer une partie seulement plutôt que de mettre toute la commande en attente |
| created_at | datetime | |
| desired_delivery_date | date, nullable | Date à laquelle l'émetteur souhaite être livré |
| desired_slot_start | time, nullable | Début du créneau horaire souhaité. Exige `desired_delivery_date` |
| desired_slot_end | time, nullable | Fin du créneau. Exige `desired_slot_start`, et doit lui être postérieure |
| cancellation_deadline | datetime, nullable | Calculée, avant passage "en cours de livraison" |
| cancellation_fee | decimal, nullable | |
| entry_mode | enum `[SELF_SERVICE / ASSISTED]` | SELF_SERVICE si le client (ou le sous-traitant émetteur) a lui-même saisi la commande ; ASSISTED si saisie par un tiers pour son compte |
| entered_by_id | FK → Account, nullable | Le collaborateur ayant effectivement saisi la commande. Renseigné uniquement si `entry_mode = ASSISTED` ; permet la traçabilité et sert de base à un futur mécanisme de validation/contestation en cas d'abus |
| parent_order_id | FK → Order, nullable | Renseigné si cette commande a été créée automatiquement comme reliquat d'une livraison partielle d'une commande précédente |
| issuer_note | string, nullable | Note laissée par l'émetteur (souhait particulier, contexte) |
| recipient_note | string, nullable | Note laissée par le destinataire (ex. motif d'un `FAILED`/`CANCELLED`, remarque) |

*Créneau souhaité : ces trois champs expriment un **souhait, jamais un engagement**. Aucune confirmation ni refus par le destinataire, aucun calcul de retard, aucune alerte de dépassement — le modèle ne comporte rien pour traiter un créneau non tenu. Trois combinaisons valides seulement : rien du tout (vente au comptoir, ou client sans préférence), une date seule, ou une date accompagnée des deux bornes horaires. Une heure sans date, ou une borne sans l'autre, est interdite.*

*Note : une commande émise par une personne implique nécessairement l'existence d'un `Customer` pour le couple (`issuer_id`, `recipient_id` ou `business_id` du canal) — c'est cette relation qui porte l'adresse de livraison et le libellé affiché. L'émetteur reste la `Person` afin que l'historique survive à une réaffectation de relation (voir 1.5).*

*Note sur `entry_mode`/`entered_by_id` : dans un premier temps, une commande `ASSISTED` est traitée exactement comme une commande `SELF_SERVICE` (mêmes statuts, notifications, dettes) — aucune confirmation du client n'est requise au lancement. Ces champs posent seulement la traçabilité nécessaire pour, en v2, permettre au client de distinguer ses propres commandes de celles saisies en son nom, et pour introduire un éventuel mécanisme de validation/contestation si des abus sont constatés.*

*Note : le caractère "réactif" ou "anticipé" d'une commande sous-traitant→entreprise n'est pas un champ stocké — c'est une simple donnée de contexte au moment de la création (présence ou non de commandes clients en amont), qui n'a pas besoin d'être conservée comme attribut permanent de l'entité.*

### 4.2 `OrderLine`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| product_variant_id | FK → ProductVariant | |
| quantity | decimal | Quantité commandée, dans l'unité propre à la variante |
| delivered_quantity | decimal, nullable | Quantité effectivement livrée si différente de `quantity` (livraison partielle) ; null tant qu'aucune livraison n'a eu lieu |
| unit_price_applied | decimal | Prix catalogue, prix de gros, ou prix + marge selon le contexte de la commande |

### 4.3 `OrderLineChange`
Journal des modifications de lignes tant que la commande est modifiable (statut `PENDING`/`PENDING_STOCK`). Permet de reconstituer l'historique en cas de désaccord sur le contenu initial d'une commande.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| changed_by_id | FK → Account | Doit correspondre à l'émetteur de la commande (ou un collaborateur agissant pour son compte) |
| change_type | enum `[LINE_ADDED / LINE_REMOVED / QUANTITY_UPDATED]` | |
| product_variant_id | FK → ProductVariant | |
| previous_quantity | decimal, nullable | |
| new_quantity | decimal, nullable | |
| changed_at | datetime | |

### 4.4 `Delivery`
Trace le transport physique, rattachée directement à une commande (plus de lien polymorphe nécessaire). Porte également l'**assignation au livreur** et la **consigne d'encaissement**.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| assigned_to_id | FK → Account, nullable | Le livreur en charge. **Vide = livraison disponible dans le pool** de l'organisation, où tout livreur peut la prendre |
| amount_to_collect | decimal | Montant que le livreur doit réclamer au client, **figé au départ** à partir de l'état de la dette. `0` si la commande est déjà réglée. Volontairement non recalculé : c'est ce qui permet de constater un écart |
| amount_collected | decimal, nullable | Montant effectivement reçu, saisi par le livreur au moment où il marque la livraison. Pré-rempli avec `amount_to_collect`, corrigeable, `0` si le client n'a pas payé. Aucune contrainte d'égalité avec la consigne |
| departure_lat | decimal, nullable | |
| departure_lng | decimal, nullable | |
| departed_at | datetime, nullable | |
| arrival_lat | decimal, nullable | |
| arrival_lng | decimal, nullable | |
| arrived_at | datetime, nullable | Renseigné quand le livreur marque la livraison comme faite — tient lieu de statut, aucune énumération supplémentaire n'est nécessaire |

*États dérivés, sans champ de statut : `assigned_to_id IS NULL` → dans le pool ; renseigné avec `arrived_at` vide → assignée, en cours ; `arrived_at` renseigné → livrée.*

*Prise dans le pool : l'opération doit être un **update conditionnel atomique** sur `assigned_to_id IS NULL`. Zéro ligne modifiée signifie qu'un autre livreur a été plus rapide. Sans cette précaution, deux livreurs peuvent se voir attribuer la même course.*

*Effet de la confirmation : lorsque `amount_collected > 0`, un `Payment` en `MANUAL_CASH` est créé avec `recorded_by_id` = le livreur, et **`Payment.order_id` obligatoirement renseigné** avec la commande livrée. Cette imputation explicite n'est pas facultative : sans elle, l'allocation FIFO affecterait la somme à la dette la plus ancienne du client, qui verrait s'éteindre un arriéré alors qu'il vient de payer la livraison qu'il a sous les yeux. Le reliquat éventuel reste en `Debt` au nom du client. `amount_collected = 0` ne crée aucun `Payment`.*

*Clôture de la commande : marquer `arrived_at` fait passer `Order.status` à `DELIVERED` **automatiquement**, sans validation du destinataire — sans quoi une livraison faite resterait ouverte jusqu'à ce qu'un collaborateur au bureau y pense. C'est le seul cas où un livreur modifie l'état d'une commande, et l'action est indissociable de la confirmation de livraison : il ne dispose d'aucun moyen de changer un statut par ailleurs. En cas de livraison partielle décidée sur place, le destinataire applique la règle habituelle (`PARTIALLY_DELIVERED` et reliquat en `PENDING_STOCK`), le livreur n'ayant pas ce pouvoir.*

*Écart consigne/constat : la comparaison de `amount_to_collect` et `amount_collected` donne directement les impayés du jour (attendu non perçu), les règlements partiels, et les encaissements imprévus (perçu alors que rien n'était attendu). C'est le garde-fou contre un encaissement non déclaré.*

*Périmètre du livreur : il voit ses livraisons assignées et le pool de son organisation, prend une course, et marque la livraison en saisissant le montant reçu. Il ne peut ni rembourser, ni modifier une commande, ni ajuster le stock. Le `Payment` qu'il produit n'est accessible que par ce chemin — il ne dispose d'aucun écran de paiement — ce qui restreint son pouvoir d'écriture financière plus sûrement qu'une permission dédiée.*

---

## 5. Finances

### 5.1 `Payment`
Un paiement est enregistré au niveau de la relation payeur-créancier, pas obligatoirement au niveau d'une commande précise — il peut être **global** (ex: un règlement qui ne précise pas quelle(s) commande(s) il couvre) et être alloué à une ou plusieurs `Debt` ultérieurement via `DebtSettlement`.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order, nullable | Renseigné uniquement si le payeur précise explicitement à quelle commande ce paiement correspond. **Toujours renseigné pour un encaissement en tournée** (voir 4.4), l'imputation étant alors sans ambiguïté |
| payer_type | enum `[PERSON / ORGANIZATION]` | |
| payer_id | FK → Person ou Organization | |
| creditor_id | FK → Organization | |
| amount | decimal | |
| amount_allocated | decimal | Compteur cumulé du montant déjà affecté à une ou plusieurs `Debt` via `DebtSettlement`. Contrainte `CHECK amount_allocated <= amount` : garantit qu'on ne peut jamais allouer plus que ce qui a été effectivement payé. `amount - amount_allocated` = crédit disponible, non encore utilisé (ex: paiement d'avance) |
| mode | enum `[MOBILE_MONEY / MANUAL_CASH]` | |
| transaction_reference | string, nullable | Si Mobile Money |
| recorded_by_id | FK → Account | Collaborateur ayant enregistré le paiement, ou ayant effectué une correction manuelle ultérieure. Pour un encaissement en tournée, c'est le **livreur** — ce champ détermine alors qui détient physiquement l'argent |
| remitted_at | datetime, nullable | Renseigné quand l'argent liquide est **remis à l'organisation** (versement en caisse). Vide = somme encore détenue par celui qui l'a encaissée. Sans objet pour un paiement `MOBILE_MONEY`, qui arrive directement |
| note | text, nullable | Libellé libre, sans catégorisation prédéfinie. Obligatoire en pratique lors d'une correction manuelle (remboursement convenu, saisie erronée) pour justifier l'écart |
| date | datetime | |

*Encours d'un livreur : somme des `Payment` en `MANUAL_CASH` dont `recorded_by_id` est ce livreur et `remitted_at` est vide. C'est le montant qu'il doit verser en fin de tournée. La remise se saisit en une action groupée par le caissier — un livreur ne renseigne jamais `remitted_at` lui-même. Une remise partielle laisse simplement les paiements non couverts en attente, l'écart restant visible comme encours résiduel.*

### 5.2 `Debt`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | Commande à l'origine du reliquat |
| debtor_type | enum `[PERSON / ORGANIZATION]` | |
| debtor_id | FK → Person ou Organization | |
| creditor_id | FK → Organization | |
| amount_due | decimal | |
| amount_settled | decimal | Compteur cumulé du montant déjà réglé via un ou plusieurs `DebtSettlement`. Contrainte `CHECK amount_settled <= amount_due` : garantit qu'on ne peut jamais régler plus que ce qui est dû |
| created_at | datetime | |
| recorded_by_id | FK → Account, nullable | Vide si la dette a été générée automatiquement par le système ; renseigné dès qu'un collaborateur modifie `amount_due` manuellement |
| note | text, nullable | Libellé libre justifiant une modification manuelle de `amount_due` (retour de marchandise, remise accordée, correction) |
| status | enum `[OUTSTANDING / SETTLED]` | Dérivé : `SETTLED` dès que `amount_settled = amount_due`. **La transition inverse est autorisée** — une réduction de `amount_settled` (contrepassation d'allocation) ou une hausse de `amount_due` fait repasser la dette en `OUTSTANDING` |

*Note : une dette est toujours rattachée à un couple (débiteur, créancier). Une organisation ne voit donc jamais les dettes contractées par la même `Person` auprès d'un autre créancier — ce cloisonnement est ce qui rend financièrement acceptable la réutilisation globale des `Person` décrite en 1.1.*

*Modification manuelle : `amount_due` peut être réduit (retour, remise) ou augmenté, sous réserve du `CHECK amount_settled <= amount_due`. Réduire une dette déjà partiellement réglée en dessous du montant encaissé exige donc de contrepasser d'abord les allocations concernées (voir 5.3), ce qui libère le crédit correspondant sur le `Payment`.*

### 5.3 `DebtSettlement`
Alloue tout ou partie d'un `Payment` à une `Debt` précise. Un même `Payment` peut couvrir plusieurs `Debt` (s'il excède le montant de la première), et une même `Debt` peut être réglée par plusieurs `Payment` successifs.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| debt_id | FK → Debt | |
| payment_id | FK → Payment | |
| amount_allocated | decimal | Négatif s'il s'agit d'une contrepassation |
| allocation_mode | enum `[AUTOMATIC / MANUAL]` | `AUTOMATIC` : allocation par défaut à la dette la plus ancienne (FIFO) dès qu'un paiement disponible existe. `MANUAL` : réaffectation délibérée par le créancier. Cette distinction permet de savoir quelles lignes peuvent être librement réajustées par le système sans écraser une décision humaine |
| reverses_settlement_id | FK → DebtSettlement, nullable | Renseigné sur une ligne de contrepassation, pointant l'allocation qu'elle annule |
| recorded_by_id | FK → Account, nullable | Vide si allocation automatique ; renseigné pour toute allocation ou contrepassation manuelle |
| note | text, nullable | Libellé libre, pertinent surtout pour une contrepassation |
| date | datetime | |

*Logique d'allocation : à la création d'une nouvelle `Debt`, le système recherche automatiquement des `Payment` du même `payer_id`/`creditor_id` disposant d'un solde non alloué (`amount - amount_allocated > 0`), et les alloue par ordre d'ancienneté (FIFO) jusqu'à épuisement du solde ou couverture complète de la dette. Le créancier peut ensuite modifier ces allocations manuellement.*

*Immutabilité : une ligne `DebtSettlement` n'est **jamais supprimée ni modifiée**. Annuler une allocation consiste à insérer une ligne de sens opposé (`amount_allocated` négatif, `reverses_settlement_id` renseigné, `allocation_mode = MANUAL`). Les compteurs `Debt.amount_settled` et `Payment.amount_allocated` restent la somme algébrique des lignes, et la trace de l'opération initiale subsiste.*

*Vigilance : après une contrepassation, le crédit redevenu disponible sur le `Payment` est susceptible d'être réabsorbé par l'allocation automatique FIFO s'il existe d'autres dettes ouvertes du même couple payeur/créancier. Toute correction manuelle doit donc produire des lignes en `allocation_mode = MANUAL`, que le système ne réajuste pas.*

### 5.4 `Refund`
Flux financier **sortant** d'une organisation vers une personne ou une autre organisation : remboursement d'un retour de marchandise, d'un trop-perçu ou d'une commande annulée après paiement.

Entité distincte de `Payment`, et non un paiement de signe inverse : un remboursement est un événement de nature différente (rare, motivé, appelé à recevoir une validation en v2) et ne participe pas à la mécanique d'allocation FIFO. Cette séparation garantit qu'aucun `Payment` ne peut jamais être négatif, et rend les remboursements auditables par simple lecture de table.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order, nullable | Commande à l'origine du remboursement, si identifiable |
| beneficiary_type | enum `[PERSON / ORGANIZATION]` | |
| beneficiary_id | FK → Person ou Organization | Celui qui reçoit les fonds |
| organization_id | FK → Organization | Celle qui décaisse |
| amount | decimal | Toujours positif — le sens du flux est porté par l'entité elle-même |
| mode | enum `[MOBILE_MONEY / MANUAL_CASH]` | |
| transaction_reference | string, nullable | Si Mobile Money |
| related_debt_id | FK → Debt, nullable | Rattachement **contextuel uniquement** : aucune contrepassation automatique n'est déclenchée |
| recorded_by_id | FK → Account | Collaborateur ayant enregistré le décaissement |
| note | text, nullable | Motif du remboursement, libellé libre |
| date | datetime | |

*Indépendance vis-à-vis des dettes (v1) : enregistrer un `Refund` n'ajuste ni `Debt` ni `DebtSettlement`. Si l'opération implique aussi d'annuler une dette ou de contrepasser une allocation, ces actions restent manuelles et distinctes (voir 5.2 et 5.3). Cette indépendance évite qu'une seule saisie produise des effets financiers en cascade difficiles à auditer.*

*Trésorerie nette d'une organisation sur une période : `Σ Payment.amount` (en tant que `creditor_id`) − `Σ Refund.amount` (en tant que `organization_id`). Les remboursements n'apparaissent jamais dans `OperatingCost`, qui reste réservé aux charges d'exploitation liées aux livraisons.*

### 5.5 `DebtCeiling`
Configuré par le créancier.

| Champ | Type |
|---|---|
| id | PK |
| creditor_id | FK → Organization |
| debtor_type | enum `[PERSON / ORGANIZATION]` |
| max_amount | decimal |

### 5.6 `Receipt`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| generated_by_id | FK → Account | |
| generated_at | datetime | |
| file_url | string | PDF |

### 5.7 `Subscription`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| business_id | FK → Organization | |
| plan | string | |
| status | enum `[ACTIVE / EXPIRED / SUSPENDED]` | |
| starts_at | datetime | |
| ends_at | datetime | |

### 5.8 `OperatingCostCategory`
Catalogue des catégories de charges opérationnelles liées aux livraisons — une liste prédéfinie par la plateforme, extensible par chaque organisation avec ses propres catégories.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| name | string | ex: "Chargement", "Déchargement", "Dispatching", "Carburant" |
| organization_id | FK → Organization, nullable | Null si catégorie prédéfinie par la plateforme ; renseigné si catégorie personnalisée créée par une organisation |

### 5.9 `OperatingCost`
Charge globale d'exploitation liée aux livraisons, enregistrée au niveau de l'organisation — non rattachée automatiquement à une commande précise, saisie ponctuellement (pas de récurrence automatique).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | |
| category_id | FK → OperatingCostCategory | |
| amount | decimal | |
| description | text, nullable | |
| recorded_by_id | FK → Account | Collaborateur ayant saisi la charge |
| date | datetime | |

### 5.10 `OperatingCostOrderLink`
Rattachement optionnel d'une charge globale à un ensemble de commandes/livraisons concernées, à titre de contexte et de traçabilité uniquement — **aucune répartition automatique** du montant entre les commandes liées.

| Champ | Type |
|---|---|
| operating_cost_id | FK → OperatingCost |
| order_id | FK → Order |

---

## 6. Partage d'informations

### 6.1 `InfoSharingRule`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| contractor_id | FK → Organization | |
| business_id | FK → Organization | |
| default_rule | enum `[SHARE / DO_NOT_SHARE]` | |
| updated_at | datetime | |

### 6.2 `CustomerSharingException`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| rule_id | FK → InfoSharingRule | |
| customer_id | FK → Customer | Vise la **relation** (et non la `Person`) : le partage porte sur ce que le sous-traitant connaît de ce client dans le cadre de son propre périmètre |
| share | boolean | |

*Logique d'accès : à chaque consultation, vérifier d'abord une `CustomerSharingException`, sinon appliquer `default_rule`. Pas de cache persistant côté entreprise (révocation immédiate et rétroactive).*

---

## 7. Réputation et modération

### 7.1 `Rating`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | Auteur de l'évaluation |
| contractor_id | FK → Organization | |
| order_id | FK → Order | |
| score | integer | ex: 1 à 5 |
| comment | text, nullable | |
| date | datetime | |
| publicly_visible | boolean | Vrai par défaut |

*Contrainte : `CHECK` exigeant `Person.phone_verified_at IS NOT NULL`. Sans elle, une organisation pourrait créer des fiches invitées et s'auto-évaluer.*

### 7.2 `Report`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| reporter_id | FK → Account | |
| target_type | enum `[PERSON / ORGANIZATION]` | |
| target_id | FK, polymorphe | |
| reason | string | |
| description | text | |
| status | enum `[PENDING / RESOLVED]` | |
| resolved_by_id | FK → Administrator, nullable | |
| decision | enum `[DISMISSED / SUSPENSION]`, nullable | |
| reported_at | datetime | |
| resolved_at | datetime, nullable | |

---

## 8. Gouvernance de la plateforme

### 8.1 `Administrator`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| account_id | FK → Account | |
| role | enum `[SUPER_ADMIN / MODERATOR]` | |
| appointed_at | datetime | |

---

## 9. Notifications

### 9.1 `Notification`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| recipient_id | FK → Person | Vise la personne et non le compte : permet de notifier par SMS un invité sans `Account`. Le canal `IN_APP` n'est utilisable que si un `Account` existe |
| organization_id | FK → Organization, nullable | Contexte de la notification (quelle organisation est concernée) — `recipient_id` reste toujours une `Person`, utile quand celle-ci collabore avec plusieurs organisations |
| channel | enum `[IN_APP / SMS]` | |
| content | text | |
| source_event | string | ex: "order.status_changed" |
| related_entity_type | string, nullable | ex: "Order", "PartnershipProduct", "PartnershipAgreement" |
| related_entity_id | FK, nullable, polymorphe | L'entité précise ayant déclenché la notification (référence directe, sur le modèle de `Report.target_type`/`target_id`, voir 7.2) |
| read_status | enum `[UNREAD / READ]` | |
| date | datetime | |

*`related_entity_type` et `related_entity_id` sont renseignés ensemble ou ni l'un ni l'autre. `source_event` reste la catégorisation du texte de la notification (et sert à sa traduction) ; `related_entity_type`/`related_entity_id` servent au lien direct vers l'entité concernée — les deux sont complémentaires.*

---

## 10. Synchronisation offline (support technique)

### 10.1 `PendingAction`
File locale rejouée à la reconnexion.

| Champ | Type | Description |
|---|---|---|
| id | PK (généré localement, UUID) | |
| account_id | FK → Account | |
| action_type | string | ex: "create_order", "record_payment" |
| payload | JSON | Données de l'action |
| sync_status | enum `[PENDING / SYNCED / CONFLICT]` | |
| created_locally_at | datetime | |
| synced_at | datetime, nullable | |

*Le `id` est un UUID généré par le client avant tout contact avec le serveur : il est la **clé d'idempotence** de l'action (voir 10.2). Il doit rester stable entre les tentatives — un rejeu ne régénère jamais un nouvel identifiant.*

### 10.2 `ProcessedAction`
Registre **côté serveur** des actions déjà rejouées avec succès. Garantit qu'une action de la file locale ne produit jamais deux fois son effet, quel que soit le nombre de tentatives.

Le cas visé n'est pas la concurrence mais l'interruption : le client envoie une action, le serveur la traite, la réponse se perd (réseau coupé, application fermée). Le client, n'ayant pas reçu d'accusé, rejoue — et sans ce registre, crée une seconde `Order` avec sa `Debt` et son `StockMovement`.

| Champ | Type | Description |
|---|---|---|
| account_id | PK composite, FK → Account | |
| pending_action_id | PK composite, UUID | Reprend `PendingAction.id` tel que généré par le client |
| action_type | string | Recopié pour l'audit |
| entity_type | string | Entité produite, ex: "Order", "Payment" |
| entity_id | FK, polymorphe | Identifiant serveur de l'entité produite |
| processed_at | datetime | |

*Protocole de rejeu : le serveur tente d'insérer la ligne `ProcessedAction` **dans la même transaction** que l'action elle-même. En cas de violation de la clé primaire, l'action a déjà été traitée : la transaction est abandonnée et le serveur renvoie l'`entity_id` déjà enregistré, exactement comme si le traitement venait d'avoir lieu. Le client passe alors en `SYNCED` sans effet de bord.*

*La clé est composite avec `account_id` afin qu'un UUID observé ou deviné ne permette pas de sonder les actions d'un autre compte, ni d'en usurper le résultat.*

*Distinction avec `CONFLICT` : l'idempotence traite le **rejeu de la même action**. Un `sync_status = CONFLICT` traite une action devenue **inapplicable** entre sa saisie hors ligne et son rejeu (variante passée `INACTIVE`, dette déjà soldée, commande déjà annulée). Les deux mécanismes sont indépendants.*

*Purge : les lignes peuvent être supprimées passé un délai de rétention largement supérieur à la durée maximale d'une déconnexion (ex: 90 jours), la file locale n'ayant plus de raison de contenir des actions plus anciennes.*

---

## Schéma relationnel simplifié (vue d'ensemble)

```
Person ──┬── Account (0 ou 1 ; absent = invité)
          ├── Customer (une par organisation avec qui elle interagit)
          ├── CustomerChannelRelation
          ├── Order (en tant qu'issuer)
          ├── Payment / Debt (en tant que payer/debtor)
          ├── Rating
          ├── Notification
          └── PhoneNumberChangeLog

Account ──┬── Organization (owner)
           ├── Collaboration ── Position ── Organization
           ├── Administrator
           ├── Report (en tant que reporter)
           ├── Delivery (en tant que livreur assigné)
           └── *_by_id (entered_by, recorded_by, generated_by, changed_by, reassigned_by)

Customer (person_id + organization_id) ──┬── CustomerSharingException
                                           └── CustomerPersonReassignment

Organization ──┬── Stock ── ProductVariant ── Product
                ├── PartnershipAgreement (business ↔ contractor) ── PartnershipProduct ── Product
                │                                                    └── ProductWholesalePrice ── ProductVariant
                ├── Order (en tant qu'issuer ou recipient)
                ├── Customer (relations qu'elle gère)
                ├── InfoSharingRule
                ├── OperatingCost ── OperatingCostOrderLink ── Order
                ├── Notification (contexte optionnel)
                └── Subscription (si type BUSINESS)

Order (issuer → recipient, récursif) ──┬── OrderLine ── ProductVariant
                                         ├── Delivery
                                         ├── Payment ── DebtSettlement ── Debt
                                         ├── Debt (si paiement partiel)
                                         ├── Refund (flux sortant, optionnel)
                                         └── Receipt
```

---

## Contraintes à poser au niveau base de données

Récapitulatif des contraintes qui ne doivent pas rester applicatives :

| Contrainte | Portée |
|---|---|
| `Person.phone_number` unique | Globale — fondement de la réutilisation sans fusion |
| `Account.person_id` unique | Un compte au maximum par personne |
| `Customer` unique (`person_id`, `organization_id`) | Une relation par couple |
| `CustomerChannelRelation` unique partiel (`person_id`, `business_id`, `product_id`) où `status = ACTIVE` | Règle d'exclusivité |
| `PartnershipProduct` unique (`agreement_id`, `product_id`) | Un produit autorisé une seule fois par accord |
| `CustomerChannelRelation.contractor_id` (si `channel_type = CONTRACTOR`) doit correspondre à un `PartnershipProduct.status = ACTIVE` pour ce `product_id` | Un client ne peut être routé que vers un sous-traitant réellement autorisé sur ce produit |
| `PartnershipAgreement.refused_at` renseigné ⟺ `status = REFUSED` ; `terminated_at` renseigné ⟺ `status = TERMINATED` | Cohérence des dates de sortie avec le statut |
| `PartnershipProduct.initiator_id` ∈ (`agreement.business_id`, `agreement.contractor_id`) | L'initiateur d'une demande de produit doit être une des deux parties de l'accord |
| `PartnershipProduct.refused_at` renseigné ⟺ `status = REFUSED` ; `terminated_at`/`termination_stock_cleared` pertinents uniquement pour `status = TERMINATED` | Cohérence des dates de sortie avec le statut |
| `Notification.related_entity_type` et `related_entity_id` renseignés ensemble ou ni l'un ni l'autre | Cohérence de la référence polymorphe |
| `Rating` : `CHECK Person.phone_verified_at IS NOT NULL` | Anti auto-évaluation |
| `Payment.amount_allocated <= amount` | Cohérence financière |
| `Debt.amount_settled <= amount_due` | Cohérence financière |
| `DebtSettlement` : aucune suppression ni modification (contrepassation uniquement) | Auditabilité des écritures |
| `DebtSettlement.reverses_settlement_id` : renseigné si et seulement si `amount_allocated < 0` | Cohérence des contrepassations |
| `Payment.amount > 0` et `Refund.amount > 0` | Le sens du flux est porté par l'entité, jamais par le signe |
| `ProcessedAction` PK composite (`account_id`, `pending_action_id`) | Idempotence du rejeu offline — insérée dans la même transaction que l'action |
| Prise dans le pool : update conditionnel sur `Delivery.assigned_to_id IS NULL` | Empêche deux livreurs de prendre la même course |
| `Payment.order_id` obligatoire si le paiement naît d'une confirmation de livraison | Évite que l'allocation FIFO impute la somme à une dette antérieure |
| Créneau souhaité : les bornes horaires exigent une date, vont par paire, et `end > start` | Cohérence de `desired_delivery_date` / `desired_slot_start` / `desired_slot_end` |

*Les FK vers `Account` (collaboration, administration, `*_by_id`) portent implicitement la garantie qu'un invité ne peut pas agir : l'absence de ligne `Account` suffit, aucune règle applicative n'est nécessaire.*

---

## Notes de conception pour l'implémentation progressive

Ce modèle est conçu comme une **référence complète et stable**. Il n'implique pas que toutes les tables soient peuplées ou toutes les actions possibles dès le lancement — le séquencement des phases (à définir séparément) déterminera quelles parties du modèle sont activées à quel moment, sans nécessiter de refonte structurelle.

Points de vigilance structurants identifiés pendant la conception :

- **Séparation `Person` / `Account`** : `Person` répond à la question « qui est cette personne », `Account` à « peut-elle se connecter ». Le « client fantôme » n'est plus une entité ni un champ : c'est une `Person` sans `Account`. La barrière d'authentification n'est plus une règle à respecter mais l'absence d'une ligne, ce qui la rend impossible à contourner par oubli.
- **Réutilisation globale des `Person`** : une seule `Person` par numéro de téléphone, sur toute la plateforme. Quand une organisation saisit une fiche client, le système réutilise la `Person` existante si le numéro est connu, et n'en crée une que sinon. **Conséquence assumée** : une organisation peut se rattacher silencieusement à une `Person` créée par une autre. C'est le prix explicitement accepté de l'absence totale de fusion d'identités — aucune réécriture de clé étrangère n'existe nulle part dans le modèle.
- **Inscription d'un invité** : simple création d'un `Account` au-dessus de la `Person` existante, après OTP et confirmation explicite (l'utilisateur étant informé des organisations concernées et de toute `Debt` `OUTSTANDING` qu'il reprend). Aucune donnée n'est déplacée. En cas de refus, une `Person` neuve est créée et l'ancienne est neutralisée pour ne plus être proposée.
- **Correction d'erreur de saisie (`CustomerPersonReassignment`)** : une organisation ne peut jamais modifier `Person.phone_number` (donnée partagée) ; elle repointe `Customer.person_id`. L'historique suivant la relation, les dettes en cours changent de personne — d'où le journal obligatoire. Libre en v1, conditionnable en v2 sans migration.
- **Exclusivité enfin applicable** : c'est le gain principal de la refonte. Dans le modèle précédent, l'identité client étant scopée par organisation, la même personne existait en deux lignes et la contrainte d'unicité ne bloquait rien. Elle porte désormais sur `person_id` et s'impose en base.
- **Anonymisation** : une seule ligne à traiter (`Person`), sans copie de nom ou de téléphone ailleurs. `Customer.display_label` est un libellé propre à l'organisation, à purger également. Suppression bloquée tant qu'une `Debt` reste `OUTSTANDING`, et traitée par anonymisation plutôt que suppression physique, pour préserver l'intégrité de l'historique des autres parties.
- **Cloisonnement inter-organisations** : il n'est plus structurel (table `Person` globale) mais relationnel — il repose sur le passage systématique par `Customer` en lecture. Le périmètre à protéger est toutefois réduit : `full_name` est une donnée publique, une `Person` invitée ne porte aucune donnée saisie par une organisation hormis son numéro, et le reste vit dans `Customer`. Restent à protéger la topologie des relations (savoir qu'une personne est cliente ailleurs, objet de la section 6) et les champs privés `email` / `preferred_language`. À traiter par une contrainte exécutable — RLS, vue par défaut ou couche d'accès obligatoire — posée **avant le premier endpoint**, une telle règle étant pénible à rétrofitter.
- `Order` est une entité **unique et récursive** : elle représente aussi bien une commande client→sous-traitant/entreprise qu'une commande sous-traitant→entreprise, selon le type de `issuer_id`/`recipient_id`. `Delivery`, `Payment`, `Debt` et `Receipt` pointent tous directement vers `order_id`, sans lien polymorphe à gérer.
- `issuer_id` peut référencer soit une `Person`, soit une `Organization` — modélisé via un discriminant léger (`issuer_type`) plutôt que deux colonnes séparées, pour rester simple. Même logique pour `Payment.payer_type` et `Debt.debtor_type`, désormais uniformisés sur `[PERSON / ORGANIZATION]`.
- Le module de synchronisation offline (`PendingAction`) est le plus complexe techniquement — sa gestion des conflits mérite une conception dédiée au moment de son implémentation. L'**idempotence** du rejeu est en revanche traitée dès maintenant (`ProcessedAction`, 10.2) : c'est un défaut de conception du rejeu et non un cas limite, puisqu'une réponse perdue suffit à créer une commande en double avec sa dette et son mouvement de stock.
- **Poste de livreur : aucune structure dédiée** — le livreur est un `Account` en `Collaboration` sur un `Position` composé par l'organisation à partir du domaine de permissions `DELIVERY`. Aucune entité, aucun rôle en dur, aucune notion de tournée. Sa fonction tient dans trois actions : consulter ses livraisons et le pool, prendre une course, marquer la livraison en saisissant le montant reçu — ce dernier geste faisant passer `Order.status` à `DELIVERED` automatiquement. Le garde-fou financier n'est pas une permission séparée mais le **chemin d'accès** : le seul `Payment` qu'un livreur peut produire naît de la confirmation d'une livraison qui lui est assignée, dans la limite du montant dû. Un livreur externe (non collaborateur) n'est pas couvert par ce modèle.
- **Chaîne de l'argent liquide** : trois points de contrôle, aucun entité nouvelle. La **consigne** (`Delivery.amount_to_collect`, figée au départ), le **constat** (`Delivery.amount_collected`, saisi par le livreur), la **remise** (`Payment.remitted_at`, saisi par le caissier). L'écart consigne/constat révèle les impayés et les encaissements imprévus ; l'absence de `remitted_at` révèle l'argent non versé. Sans le premier écart, un encaissement pourrait n'être jamais déclaré ; sans le second, une somme déclarée pourrait ne jamais rentrer en caisse.
- **Créneau de livraison souhaité (`desired_delivery_date`, `desired_slot_start`, `desired_slot_end`)** : un souhait sans contrepartie. Aucune confirmation par le destinataire, aucun refus, aucun calcul de retard, aucune alerte. La date est le pivot — un créneau horaire ne peut exister sans elle, et les deux bornes vont toujours ensemble. Ce statut de simple souhait est à tenir : dès qu'un créneau devient un engagement affiché au client, il faut de quoi traiter son dépassement (motif, alerte, escalade), et le modèle n'en a rien. L'évolution naturelle, si le besoin apparaît, est un créneau confirmé en regard, renseigné par le destinataire à la confirmation de la commande.
- **Partenariat en revente uniquement** : le champ `mode [RELAY / RESALE]` a été supprimé. Le modèle était de fait exclusivement en revente — `Stock` existe chez le sous-traitant, `ProductVariant.default_wholesale_price` et `ProductWholesalePrice` fixent un prix d'achat, `PartnershipProduct.termination_stock_cleared` attend l'écoulement de son stock pour le produit concerné, et la commande groupée sous-traitant→entreprise est un acte d'achat. Aucune structure n'accompagnait le mode relais, qui n'était donc qu'une valeur d'énumération orpheline annonçant une capacité inexistante. Le mode contractuel étant connu des deux parties et redemandable à tout moment, rien ne se perd à ne pas le stocker (contrairement à `entry_mode`, qui capture un fait irrécupérable a posteriori). Réintroduire un mode relais supposerait trois ajouts : un taux de commission sur l'accord, un marqueur de consignation sur `Stock` (marchandise détenue mais non possédée), et un flux financier où le sous-traitant encaisse pour le compte de l'entreprise plutôt que pour lui-même.
- **Partenariat scopé par produit (`PartnershipProduct`)** : `PartnershipAgreement` ne porte plus de prix — un decimal unique n'a pas de sens dès qu'une relation couvre plusieurs produits à échelles de prix différentes. `PartnershipProduct` déclare, produit par produit, ce qu'un sous-traitant est autorisé à commander/stocker/revendre, avec un statut et une terminaison indépendants du reste de la relation : un sous-traitant peut cesser un produit sans rompre l'accord-cadre, tandis que résilier l'accord-cadre résilie en cascade tous les produits encore actifs. Cette portée referme aussi un trou du modèle précédent : rien n'empêchait `CustomerChannelRelation` de router un client vers un sous-traitant pour un produit que celui-ci n'avait jamais négocié spécifiquement (voir la contrainte de cohérence ajoutée en 3.4).
- **Négociation par produit (`PartnershipProduct.status`) et par accord (`PartnershipAgreement.status`)** : les deux entités partagent désormais le même cycle `[REQUESTED / ACTIVE / REFUSED / TERMINATED]`, avec `initiator_id`/`initiator_note`/`recipient_note` de part et d'autre. `REFUSED` est volontairement distinct de `TERMINATED` : un refus intervient avant toute activité (aucun stock, aucune commande possible), une terminaison intervient après. Politique v1 : redemander un produit refusé réutilise la même ligne `PartnershipProduct` (unique par `agreement_id`/`product_id`), ce qui écrase la note de refus précédente — un journal séparé, sur le modèle de `ChannelChangeRequest`, pourrait être introduit en v2 si l'historique des refus successifs devient nécessaire.
- **Absence volontaire de réservation de stock** : `Stock.quantity_available` reflète la marchandise physiquement présente, jamais ce qui est promis. Aucune quantité n'est immobilisée par une commande confirmée. Ce choix est cohérent avec `PENDING_STOCK` et `PARTIALLY_DELIVERED`, qui font de la couverture insuffisante un cas nominal absorbé par la livraison partielle et le reliquat, plutôt qu'un incident à prévenir. Il évite trois décisions structurantes sans réponse évidente (moment de la réservation, blocage ou non en cas de dépassement, expiration) et un compteur dénormalisé susceptible de dériver. Si le besoin d'y voir plus clair apparaît, la quantité engagée se calcule à la volée comme somme des `OrderLine` des commandes `CONFIRMED` non encore livrées — une requête d'affichage, sans champ ni contrainte supplémentaires.
- **Saisie assistée (`entry_mode` / `entered_by_id`)** : une organisation peut saisir une commande au nom d'une personne déjà enregistrée (ex: commande passée par téléphone). Aucun blocage ni confirmation n'est requis pour l'instant — la commande est immédiatement valide et apparaît dans l'historique du client comme les autres. Ces deux champs posent uniquement les bases d'une future distinction visuelle côté client, et d'un éventuel mécanisme de validation en cas d'abus signalés.
- **Retour/échange après livraison** : aucun statut ni workflow dédié dans le modèle — traité hors application, avec un ajustement manuel par l'organisation. Quatre cas, tous couverts par l'existant : *retour en stock* → `StockMovement` de type `IN` sans `source_order_id` ; *annulation d'une dette encore due* → réduction de `Debt.amount_due` ; *remboursement en avoir* → contrepassation du `DebtSettlement`, le crédit libéré sur le `Payment` étant consommé lors du prochain achat ; *remboursement en espèces ou Mobile Money* → `Refund` (voir 5.4), entité dédiée au flux sortant.
- **Remboursement (`Refund`)** : modélisé comme une entité distincte plutôt que comme un `Payment` de signe négatif ou porteur d'une direction. Trois raisons : aucun `Payment` ne peut ainsi jamais être négatif (les contraintes `CHECK` et la logique FIFO restent arithmétiquement simples) ; les remboursements, rares et exceptionnels, restent visibles par simple lecture de table au lieu d'être noyés parmi les encaissements ; et l'entité séparée offre une place naturelle à un futur workflow d'approbation. En v1, un `Refund` n'ajuste automatiquement ni `Debt` ni `DebtSettlement` — `related_debt_id` n'est qu'un rattachement contextuel, l'ajustement de la dette restant une action manuelle distincte.
- **Traçabilité des corrections financières** : `Payment` et `Debt` portent `recorded_by_id` et `note`, et `DebtSettlement` est immuable (contrepassation par ligne opposée plutôt que suppression). Le « traitement hors application » des retours reste ainsi entièrement reconstituable a posteriori — condition indispensable pour arbitrer un litige, et garde-fou contre la dissimulation d'un encaissement non reversé.
- **Modification de commande (`OrderLineChange`)** : autorisée uniquement tant que `Order.status` est `PENDING`/`PENDING_STOCK`, par l'émetteur. Le journal permet de reconstituer le contenu initial en cas de désaccord.
- **Livraison partielle (`OrderLine.delivered_quantity`, `Order.parent_order_id`)** : le destinataire d'une commande (souvent l'entrepreneur en cas de rupture de stock) peut livrer partiellement ; le reliquat génère automatiquement une nouvelle `Order` en `PENDING_STOCK`, liée à l'originale via `parent_order_id`.
- **Changement de téléphone (`PhoneNumberChangeLog`)** : sans impact sur l'historique (tout référence `Person.id`), mais désormais de portée globale — le numéro étant partagé par toutes les relations de la personne, le changement se répercute partout. Réservé au titulaire d'un `Account`, avec vérification OTP.
- **Organisations multiples par compte** : un `Account` peut posséder un nombre illimité d'`Organization`, totalement indépendantes les unes des autres (pas de vue consolidée). Aucune contrainte d'unicité sur `owner_account_id`.
- **Suppression logique de variante (`ProductVariant.status`)** : une variante retirée du catalogue passe en `INACTIVE` plutôt que d'être supprimée physiquement, pour ne pas casser les `OrderLine`, `Stock` et `ProductWholesalePrice` historiques qui la référencent. Réactivation immédiate, sans validation particulière.
- **Collaborateur également client de son entreprise** : aucune restriction, aucune distinction, aucun garde-fou de conflit d'intérêt (y compris pour valider ses propres commandes). Une même `Person` peut simultanément disposer d'un `Account` en `Collaboration` avec une `Organization` et apparaître comme `issuer` de ses propres `Order` auprès de cette même organisation.
- **Vente directe immédiate** : une entreprise ou un sous-traitant peut créer une `Order` qui saute directement au statut `DELIVERED`, sans passer par le cycle habituel — cas d'une vente au comptoir. Le client est identifié a minima par une `Person` (numéro, éventuellement nom) et un `Customer` créé dans la foulée, et une `CustomerChannelRelation` de type `DIRECT` est créée systématiquement, même pour un achat unique, afin de rester cohérent avec la règle d'exclusivité si ce client revient plus tard.
- **`ProductVariant` (fusion gamme + unité)** : `Product` ne porte que le nom/description générique ; toute la substance de gestion (stock, prix catalogue, prix de gros par défaut) est portée par `ProductVariant`. Chaque variante a un stock et des prix totalement indépendants — **aucune conversion** entre unités ou gammes. En revanche, `CustomerChannelRelation` continue de référencer `Product` au niveau global : la règle d'exclusivité s'applique au produit dans son ensemble, quelle que soit la variante achetée.
- **Coûts opérationnels globaux (`OperatingCost`)** : les charges variables liées aux livraisons ne sont pas rattachées à une commande précise comme `Order.delivery_cost` — elles sont enregistrées comme charges globales de l'organisation, avec une catégorie et un rattachement *optionnel* à un ensemble de commandes via `OperatingCostOrderLink`, à titre de contexte uniquement. Aucune répartition automatique.
- **Ajustement manuel de stock (`StockMovement.recorded_by_id` / `note`)** : un mouvement sans `source_order_id` est un ajustement manuel (casse, perte, correction d'inventaire). Un simple libellé libre suffit. Toute personne disposant de la permission du domaine `STOCK` peut l'effectuer sans validation hiérarchique — seule la traçabilité de l'auteur est exigée.
- **Paiement global et allocation (`Payment.order_id` nullable, `DebtSettlement`)** : un paiement est enregistré au niveau de la relation payeur/créancier, puis alloué a posteriori à une ou plusieurs `Debt` (FIFO par défaut, réajustable manuellement). Un paiement d'avance est simplement un `Payment` dont le solde non alloué reste disponible. La cohérence est garantie par des contraintes `CHECK` sur des compteurs cumulés plutôt que par un recalcul applicatif.
