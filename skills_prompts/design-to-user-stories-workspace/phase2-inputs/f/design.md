# Conception — Commandes en ligne pour boutiques

## Légende
- Noms d'entités, champs et énumérations en anglais ; descriptions en français.
- Champs en `snake_case`. Un champ sans la mention `nullable` est obligatoire.
- Identifiants : UUIDv7. Montants : entiers en francs CFA (XAF), sans centimes. Dates : `timestamptz` en UTC.
- Pile technique imposée : Node.js 22, TypeScript, Express 5, PostgreSQL 16, Prisma 7 ; fichiers dans un stockage objet compatible S3.

## 1. Contexte et rôles
Une boutique vend des produits à des clients inscrits. Le client commande puis paie par Mobile Money (MTN, Orange) via un agrégateur de paiement tiers : API REST appelée par le serveur, confirmation par webhook signé. La boutique téléverse les photos de ses produits.

Rôles d'une personne dans une boutique (`Membership.role`) :

| Rôle | Droits |
|---|---|
| `OWNER` | Tout : membres, produits, photos, commandes. Exactement un par boutique |
| `MANAGER` | Produits et photos ; commandes : consulter, marquer livrée, annuler |
| `STAFF` | Commandes : consulter, marquer livrée |

Une personne inscrite qui n'a pas de rôle dans une boutique y est **cliente** : elle voit les produits `ACTIVE` des boutiques `ACTIVE`, commande et paie. Un visiteur non connecté peut seulement s'inscrire et se connecter.

Priorités v1 : commande et paiement, priorité haute ; photos des produits, priorité moyenne.

## 2. Personnes et authentification

### 2.1 `Person`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| email | string, **unique** | Adresse de connexion, en minuscules. Privée |
| password_hash | string | Hash Argon2id |
| full_name | string | 1 à 100 caractères |
| phone_number | string, nullable | Format E.164 (ex. `+237677123456`). Privé |
| status | enum `[ACTIVE / SUSPENDED]` | |
| created_at | datetime | |

### 2.2 `RefreshToken`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | |
| token_hash | string, **unique** | SHA-256 du jeton ; jamais le jeton lui-même |
| expires_at | datetime | 30 jours après l'émission |
| revoked_at | datetime, nullable | |
| created_at | datetime | |

### 2.3 Parcours
- **Inscription** (visiteur) : e-mail, mot de passe (8 à 64 caractères, sans règle de composition, refusé s'il est courant), nom complet. Le compte naît `ACTIVE`.
- **Connexion** (visiteur) : e-mail et mot de passe ; jeton d'accès JWT de 15 minutes et jeton de renouvellement de 30 jours. 5 échecs en 15 minutes bloquent l'e-mail 15 minutes. Un compte `SUSPENDED` ne se connecte pas. Le message d'erreur ne révèle jamais si l'e-mail existe.
- **Renouvellement** : jeton à usage unique, remplacé à chaque utilisation ; la réutilisation d'un jeton révoqué révoque tous les jetons de la personne.
- **Déconnexion** (personne connectée) : révoque le jeton de renouvellement présenté.

## 3. Boutiques et membres

### 3.1 `Shop`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| name | string | 1 à 60 caractères |
| slug | string, **unique** | Identifiant public, `^[a-z0-9-]{3,40}$` |
| status | enum `[ACTIVE / SUSPENDED / CLOSED]` | `SUSPENDED` : décidé hors application, en base |
| created_at | datetime | |

### 3.2 `Membership`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| shop_id | FK → Shop | |
| person_id | FK → Person | |
| role | enum `[OWNER / MANAGER / STAFF]` | |
| created_at | datetime | |

### 3.3 Parcours
- **Créer une boutique** (personne connectée) : nom et slug ; la personne en devient `OWNER`.
- **Ajouter un membre** (`OWNER`) : par l'e-mail d'une personne déjà inscrite, avec le rôle `MANAGER` ou `STAFF`. Changer son rôle entre `MANAGER` et `STAFF`, ou le retirer.
- L'`OWNER` ne peut ni se retirer ni changer son propre rôle. Le transfert de propriété n'existe pas en v1.
- **Fermer la boutique** (`OWNER`) : statut `CLOSED` ; ses produits ne sont plus visibles et aucune commande ne peut plus y être passée.

## 4. Catalogue et photos

### 4.1 `Product`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| shop_id | FK → Shop | |
| name | string | 1 à 120 caractères |
| description | text, nullable | 2 000 caractères au plus |
| price | bigint | Prix en XAF |
| status | enum `[DRAFT / ACTIVE / ARCHIVED]` | |
| created_at | datetime | |
| updated_at | datetime | |

### 4.2 `ProductImage`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| product_id | FK → Product | |
| storage_key | string, **unique** | Clé générée par le serveur dans le stockage objet ; jamais le nom du fichier envoyé |
| content_type | enum `[image/jpeg / image/png / image/webp]` | Déterminé par le contenu du fichier, pas par son extension |
| size_bytes | int | Taille du fichier |
| position | int | Ordre d'affichage |
| uploaded_by_id | FK → Person | |
| created_at | datetime | |

### 4.3 Parcours
- **Gérer les produits** (`OWNER`, `MANAGER`) : créer (naît `DRAFT`), modifier nom, description et prix, publier (`DRAFT` → `ACTIVE`), archiver (`ACTIVE` → `ARCHIVED`).
- **Parcourir le catalogue** (client) : produits `ACTIVE` d'une boutique `ACTIVE`, par slug de boutique, 20 par page.
- **Téléverser une photo** (`OWNER`, `MANAGER`) : JPEG, PNG ou WebP, 5 Mo au plus, 5 photos au plus par produit. Le type est vérifié sur le contenu (signature du fichier). Le fichier est stocké sous une clé générée par le serveur.
- **Voir les photos** : un client reçoit, pour les produits `ACTIVE`, des URL signées valables 10 minutes ; les membres de la boutique, pour tous ses produits.
- **Supprimer une photo** (`OWNER`, `MANAGER`) : supprime l'objet stocké puis la ligne.

## 5. Commandes

### 5.1 `Order`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| shop_id | FK → Shop | |
| customer_id | FK → Person | Le client, pris dans la session |
| status | enum `[PENDING_PAYMENT / PAID / DELIVERED / CANCELLED]` | |
| total_amount | bigint | Calculé par le serveur |
| cancelled_reason | string, nullable | |
| created_at | datetime | |
| updated_at | datetime | |

### 5.2 `OrderLine`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| product_id | FK → Product | |
| quantity | int | |
| unit_price | bigint | Prix du produit copié par le serveur au moment de la commande |
| line_total | bigint | |

### 5.3 Parcours
- **Commander** (client) : lignes de produits `ACTIVE` d'une même boutique `ACTIVE` ; le serveur copie les prix et calcule les totaux ; la commande naît `PENDING_PAYMENT`.
- **Mes commandes** (client) : ses commandes, de la plus récente à la plus ancienne.
- **Commandes de la boutique** (membres) : toutes les commandes de la boutique, filtrables par statut.
- **Annuler** : le client annule sa commande `PENDING_PAYMENT` ; un `OWNER` ou un `MANAGER` annule une commande `PENDING_PAYMENT` de sa boutique avec un motif. Une commande `PAID` ne s'annule pas en v1.
- **Marquer livrée** (membres) : `PAID` → `DELIVERED`.

## 6. Paiement

### 6.1 `Payment`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| provider_reference | string, nullable, **unique** | Référence renvoyée par l'agrégateur |
| amount | bigint | Montant demandé à l'agrégateur |
| phone_number | string | Numéro Mobile Money payeur, E.164, `+237` seulement |
| status | enum `[INITIATED / SUCCEEDED / FAILED / EXPIRED]` | |
| created_at | datetime | |
| updated_at | datetime | |

### 6.2 `PaymentEvent`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| payment_id | FK → Payment, nullable | Vide si la référence est inconnue |
| provider_event_id | string, **unique** | Identifiant de l'événement chez l'agrégateur |
| event_type | string | |
| signature_valid | boolean | |
| payload_sha256 | string | Empreinte du corps reçu ; le corps n'est pas conservé |
| received_at | datetime | |

### 6.3 Parcours
- **Payer** (client) : pour sa commande `PENDING_PAYMENT`, avec un numéro Mobile Money. Le serveur appelle l'agrégateur avec le montant de la commande, jamais un montant venu du client, et crée un `Payment` `INITIATED`. Au plus 10 initiations de paiement par client et par heure.
- **Webhook de l'agrégateur** : signature HMAC-SHA256 du corps brut, avec un secret partagé, dans l'en-tête `X-Signature`. Le serveur vérifie la signature, ignore un `provider_event_id` déjà reçu, et enregistre chaque événement dans `PaymentEvent`. Un paiement réussi passe le `Payment` en `SUCCEEDED` et la commande en `PAID`, dans une même transaction. Un montant différent de celui de la commande passe le paiement en `FAILED` et journalise un événement de sécurité.
- **Expiration** : un paiement `INITIATED` depuis plus de 15 minutes passe en `EXPIRED` (tâche périodique) ; le client peut alors payer à nouveau.
- La clé API de l'agrégateur, le secret du webhook et les identifiants du stockage objet viennent des variables d'environnement.

## 7. Contraintes à poser au niveau base de données
| Contrainte | Portée |
|---|---|
| `Person.email` unique, en minuscules ; `Person.full_name` : 1 à 100 caractères ; `Person.phone_number` au format E.164 s'il est renseigné | |
| `Shop.slug` unique et conforme à `^[a-z0-9-]{3,40}$` ; `Shop.name` : 1 à 60 caractères | |
| `Membership` unique (`shop_id`, `person_id`) ; exactement un `OWNER` par boutique (index unique partiel sur `shop_id` où `role = OWNER`) | Une seule propriétaire |
| `Product.price > 0` ; `Product.name` : 1 à 120 caractères ; `Product.description` : 2 000 caractères au plus | |
| `ProductImage` : `size_bytes` entre 1 et 5 242 880 ; `position` entre 1 et 5 ; unique (`product_id`, `position`) | 5 photos de 5 Mo au plus |
| `Order.total_amount` > 0 et égal à la somme des `OrderLine.line_total`, calculé par le serveur | |
| `Order` : `cancelled_reason` renseigné ⟺ `status = CANCELLED` et annulation par un membre | Motif des annulations par la boutique |
| `Order` : transitions permises seulement : `PENDING_PAYMENT` → `PAID` (webhook) ou `CANCELLED` ; `PAID` → `DELIVERED` | |
| `OrderLine` : `quantity` entre 1 et 99 ; `line_total = quantity × unit_price` ; produit `ACTIVE` de la boutique de la commande au moment de la commande | |
| `Payment.amount = Order.total_amount` ; au plus un paiement `INITIATED` ou `SUCCEEDED` par commande (index unique partiel) | Pas de double paiement |
| `Payment.phone_number` au format E.164 et commençant par `+237` | |
| `PaymentEvent.provider_event_id` unique ; aucune modification ni suppression de `PaymentEvent` | Journal fidèle, webhooks idempotents |

## 8. Exigences non fonctionnelles
- API JSON sur HTTPS, préfixe `/api/v1`.
- Journaliser les paiements et les webhooks rejetés, sans secret, sans numéro de téléphone complet.
- Aucune donnée de carte bancaire n'est traitée.
