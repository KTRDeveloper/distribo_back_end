# Golden example: design excerpt

From eval design (a), `docs/design.md`. The skill read the whole design; this is the part CAT-002 uses. Anchors: `catalogue/product` (3.1), `catalogue/parcours` (3.2).

## 3. Catalogue

### 3.1 `Product`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| owner_id | FK → Account | Le vendeur propriétaire, pris dans la session |
| name | string | 1 à 120 caractères |
| description | text, nullable | 2 000 caractères au plus |
| price | bigint | Prix en XAF |
| status | enum `[ACTIVE / ARCHIVED / REMOVED]` | `REMOVED` : retiré par un administrateur |
| removed_reason | string, nullable | Motif du retrait |
| created_at | datetime | |
| updated_at | datetime | |

### 3.2 Parcours
- **Créer un produit** (vendeur) : nom, description, prix. Le produit naît `ACTIVE`.
- **Lister ses produits** (vendeur) : ses produits `ACTIVE` et `ARCHIVED`, 20 par page, du plus récent au plus ancien.
- **Modifier un produit** (vendeur) : nom, description, prix, sur ses propres produits `ACTIVE` ou `ARCHIVED`.
- **Archiver / réactiver** (vendeur) : passe un de ses produits de `ACTIVE` à `ARCHIVED` et inversement.
- **Consulter tous les produits** (administrateur) : tous les produits, tous statuts confondus, 50 par page.
- **Retirer un produit** (administrateur) : passe le produit en `REMOVED` avec un motif ; le vendeur ne peut plus le modifier ni le réactiver.

## 4. Contraintes à poser au niveau base de données (extrait)
| Contrainte | Portée |
|---|---|
| `Product.name` : 1 à 120 caractères ; `Product.description` : 2 000 caractères au plus | |
| `Product.price > 0` | Un produit se vend à un prix |
| `Product` : `removed_reason` renseigné ⟺ `status = REMOVED` | Tout retrait est motivé |
| `Product` : un vendeur n'a jamais deux produits non retirés du même nom (index unique partiel sur `owner_id`, `name` où `status ≠ REMOVED`) | Pas de doublon dans un catalogue |
