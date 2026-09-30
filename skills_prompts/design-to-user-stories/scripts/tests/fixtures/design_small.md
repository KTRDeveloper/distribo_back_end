# Boutique — conception

Texte d'introduction.

## Légende
Les champs sans `nullable` sont obligatoires.

Rôles : `SELLER` gère ses produits ; `ADMIN` modère.

## 1. Comptes

### 1.1 `Account`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| email | string, **unique** | Adresse de connexion |
| role | enum `[SELLER / ADMIN]` | |
| created_at | datetime | |

## 2. Catalogue

### 2.1 `Product`
<!-- id: PRD -->
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| owner_id | FK → Account | |
| name | string | 1 à 120 caractères |
| price | bigint | |
| note | text, nullable | |

### Notes
Le vendeur crée ses produits.

### Notes
Seul le propriétaire modifie un produit.

```text
## Not a heading
| Champ | Type |
|---|---|
| fake | string |
```

## 3. Contraintes
| Contrainte | Portée |
|---|---|
| `Product.price > 0` | Un prix positif |
| `Product.name` : 1 à 120 caractères | |
