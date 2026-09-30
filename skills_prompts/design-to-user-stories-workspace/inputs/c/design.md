# Conception — Réservation de salles de réunion

## Légende
- Noms d'entités, champs et énumérations en anglais ; descriptions en français.
- Un champ sans la mention `nullable` est obligatoire.

## 1. Contexte
Les membres d'un espace de coworking réservent des salles de réunion. Un gestionnaire valide les réservations des grandes salles.

Rôles : `MEMBER` (réserve des salles), `ADMIN` (crée et désactive les comptes des membres).

## 2. Modèle

### 2.1 `Member`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| email | string, nullable | Adresse de connexion |
| password_hash | string | Hash Argon2id |
| full_name | string | 1 à 100 caractères |
| role | enum `[MEMBER / ADMIN]` | |
| team_id | FK → Team, nullable | Équipe du membre |
| created_at | datetime | |

### 2.2 `Room`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| name | string, **unique** | |
| capacity | int | Nombre de places |
| floor |  | Étage |

### 2.3 `Booking`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| member_id | FK → Member | Le membre, pris dans la session |
| room_id | FK → Room | |
| starts_at | datetime | |
| ends_at | datetime | |
| status | enum `[PENDING / CONFIRMED / CANCELLED]` | |
| created_at | datetime | |

## 3. Parcours
- **Connexion** : e-mail et mot de passe ; jeton d'accès JWT valable 1 heure, sans jeton de renouvellement.
- **Comptes** (`ADMIN`) : crée le compte d'un membre (e-mail, nom, mot de passe initial) ; désactive un compte, qui ne peut alors plus se connecter.
- **Réserver** (membre) : choisit une salle, un début et une fin. Une réservation peut durer jusqu'à une journée entière. Si la salle a plus de 10 places, la réservation reste `PENDING` jusqu'à sa validation par un gestionnaire ; sinon elle naît `CONFIRMED`.
- **Valider ou refuser** (gestionnaire) : passe une réservation `PENDING` en `CONFIRMED`, ou en `REJECTED` avec un motif.
- **Annuler** (membre) : annule une de ses réservations à venir.
- Chaque réservation confirmée génère une facture envoyée au membre.

## 4. Contraintes à poser au niveau base de données
| Contrainte | Portée |
|---|---|
| `Member.email` obligatoire et unique | Connexion |
| `Booking` : une réservation dure au plus 4 heures ; `ends_at > starts_at` | |
| Deux réservations `CONFIRMED` d'une même salle ne se chevauchent jamais | |
| `Room.capacity` entre 1 et 50 | |
