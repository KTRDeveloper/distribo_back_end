---
name: api-to-rn-contract
description: Génère et maintient FRONTEND_CONTRACT.md, le contrat front d'une app mobile React Native offline-first (WatermelonDB), à partir des artefacts d'une API backend (OpenAPI/Swagger, AsyncAPI, GraphQL SDL, Postman, ADR, schémas DB/migrations, code source, user stories). Mise à jour incrémentale économe en tokens (diff hash/git, delta sémantique des specs, édition ciblée des seules sections impactées) et questions à choix multiples sur les décisions manquantes. À utiliser dès que l'utilisateur parle de « contrat front », « API → React Native », « mise à jour doc front », « sync WatermelonDB », veut documenter un backend pour l'app mobile, répercuter un changement d'API côté mobile ou dériver le modèle local et la stratégie offline-first depuis le backend, même sans nommer le fichier. EN triggers - frontend contract, API to React Native, WatermelonDB sync.
compatibility: Python 3.8+ (stdlib) ; PyYAML ou yq pour les specs YAML ; git optionnel (listing et diffs).
---

# api-to-rn-contract

Produit et tient à jour **un seul** fichier, `FRONTEND_CONTRACT.md` : ce dont l'app React Native offline-first (WatermelonDB) a besoin, et rien d'autre. Critère d'inclusion : l'information change l'UI, le modèle local ou la sync. Infra, implémentation serveur, tables internes non exposées, logique invisible du client : exclues.

`$S` = dossier de ce skill (indiqué au chargement). Scripts : Python 3, stdlib.

## Principes
- **Tokens d'abord.** Le contrat est relancé à chaque évolution du backend : seule la lecture évitée est gratuite. Jamais de dossier entier ni de gros fichier dans le contexte ; scripts, `grep`, `sed -n`, arrêt dès que l'info suffit. Le scan écarte déjà tests, node_modules, builds, lockfiles, assets, IaC/CI.
- **Couches de vérité**, dans l'ordre et seulement si besoin : **a** specs formelles (OpenAPI, AsyncAPI, SDL, Postman, ADR) → **b** schémas DB/migrations, DTO/modèles → **c** routes/contrôleurs, auth, gestion d'erreurs → **d** user stories (titres + critères d'acceptation). b–d comblent un trou de a ou révèlent une contradiction.
- **Ne jamais deviner** une décision structurante ni une info manquante : la demander (étape 5) ; en attendant, `[À CONFIRMER] Qn` au §11, sans bloquer le reste.
- **Édition chirurgicale** : lire seulement la plage de lignes touchée, remplacer les lignes concernées (Edit / `str_replace`). Jamais de régénération : elle coûte cher et écrase les décisions déjà validées.
- **Contrat dense** : tableaux, 1 ligne par fait, ni prose ni exemples. Ne pas recopier la spec : citer le schéma, noter seulement la transformation front (mapping WMDB, validation locale, usage écran).
- **Standards** (OpenAPI 3.1, RFC 9110/9457/6585, OAuth natif RFC 6749/7636/8252, JWT RFC 8725, OWASP MASVS & API Top 10, docs WatermelonDB et React Native) : `references/standards.md`, une rubrique à la fois, seulement quand les sources sont muettes ou ambiguës.

## Workflow

### 1. Configuration (premier lancement seulement)
Chercher l'état : `find . -maxdepth 3 -name .contract-state.json -not -path '*/node_modules/*'`. Absent → demander en une fois les chemins d'entrée (repo backend, dossier de conception, stories) et l'emplacement du contrat (défaut `./FRONTEND_CONTRACT.md`), puis :
```bash
python3 "$S/scripts/diff_sources.py" init --out <contrat.md> --inputs <repo|dossier|fichier>… [--stories <dossier>…] [--ignore '<glob>'…]
```
Crée `.contract-state.json` à côté du contrat, `.contract-cache/` et le squelette du contrat (copié du template sans le lire). Changer les entrées plus tard : `init --force …` (historique conservé).

### 2. Diff des sources
```bash
python3 "$S/scripts/diff_sources.py" scan [--state <dossier du contrat>]
```
- `STATUS unchanged` → répondre exactement « Contrat à jour. » et s'arrêter.
- `STATUS no-impact` (seuls des fichiers `x` non lus ont bougé) → `commit`, puis « Contrat à jour. ».
- Sinon : `+` ajouté / `~` modifié / `-` supprimé, avec couche, type et sections (§) alimentées, puis `SPEC` = delta sémantique des specs (endpoints, champs, sécurité ajoutés `+` ou retirés `-`). Ne traiter que ces éléments.

### 3. Extraction ciblée (a → d, uniquement les fichiers listés)
- Spec : le delta `SPEC` suffit en général. Premier passage : la commande `spec_digest.py … | grep …` donnée par le scan (meta, sécurité, endpoints/canaux), puis `| grep -E '^(S|F) <Schéma>[ .]'` par entité utile. Jamais le YAML/JSON brut.
- Autre fichier modifié : `python3 "$S/scripts/diff_sources.py" diff <fichier>` (diff git depuis le dernier passage) au lieu du fichier entier.
- Fichier nouveau ou sans base : `grep`/`sed -n` ciblés, recettes par stack dans `references/extraction.md` (une rubrique).
- Fichier supprimé : `grep -nE '<entité>|<US-id>' <contrat>` → retirer ce qu'il alimentait, ou ⛔ si l'app en dépend.
- Premier passage : couche a d'abord ; b/c seulement pour les sections encore vides (souvent §2, §4, §6) ; d pour §7 et §10.
- Contradiction entre couches → question (étape 5), jamais d'arbitrage silencieux.

### 4. Mise à jour des sections impactées
1. `grep -n '^##' <contrat>` → bornes des sections ; lire uniquement la plage utile (offset/limit ou `view_range`).
2. Règles de la section : `grep -A12 '^### §<n>' "$S/references/contract-template.md"`.
3. Éditer les seules lignes concernées. Ancre = 1re colonne unique (entité, `MÉTHODE /chemin`, code, ID) ; pour insérer une ligne, ancrer sur l'en-tête du tableau.
4. Breaking (champ, endpoint ou valeur d'enum supprimés/renommés, type restreint, auth durcie, protocole de sync modifié) → ⛔ dans la ligne + question à l'étape 5.

### 5. Questions à l'utilisateur
Salves de **3 questions maximum**, courtes, à choix multiples, option recommandée en premier (outil AskUserQuestion si disponible, sinon liste A/B/C), les plus structurantes d'abord. Bloquante = sans réponse, une section resterait fausse ou vide ; les autres vont directement au §11 `[À CONFIRMER]`. Réponse obtenue → appliquer, supprimer la ligne du §11, noter `Qn résolue` au changelog.

| Sujet (si non documenté) | Options (reco en premier) |
|---|---|
| Spec absente | exporter l'OpenAPI (`/openapi.json`, `/api-json`, `/v3/api-docs`) · lire le code |
| Format de sync | endpoints pull/push WMDB dédiés · adapter les CRUD (`updated_since` + tombstones, push rejoué) · cache lecture seule |
| Conflits | fusion par champ WMDB + rejet du push si modifié après `lastPulledAt` · LWW horodaté serveur · serveur gagne |
| IDs | UUID générés côté client (`setGenerator`) · ID WMDB 16 caractères · ID serveur + remapping (déconseillé) |
| Suppressions | soft-delete + tombstones · table des suppressions · suppression physique (casse le pull incrémental) |
| Rétention hors-ligne | N jours max sans sync · illimitée · purge à la déconnexion |
| Périmètre de sync | données de l'utilisateur/équipe · fenêtre glissante de N jours · tout |
| Contradiction | la spec fait foi · le code fait foi · les stories font foi |
| Breaking change | migration WMDB + version min. d'app · nouvelle version d'API · annuler côté backend |

### 6. Clôture
1. Une seule commande, après toutes les éditions :
   `python3 "$S/scripts/diff_sources.py" commit --touched 3,5 --log "<changements ; ⛔ breaking ; Qn résolue>" [--map <fichier>=3,4 …]`
   → ajoute la ligne datée au changelog (§12, sources et commit git remplis) et enregistre sha1, date, couche et sections de chaque source (`--map` corrige les sections proposées). Sans commit, le prochain scan reproposera les mêmes fichiers.
2. Réponse au chat, 5 lignes max : sections modifiées · breaking · questions ouvertes (IDs) · sources traitées. Rien d'autre.

## Ressources
| Fichier | Usage |
|---|---|
| `references/contract-template.md` | règles d'une section (`grep -A12 '^### §n'`) ; squelette copié par `init` |
| `references/extraction.md` | recettes grep par couche et par stack, pour un fichier sans spec ni diff |
| `references/standards.md` | point normé non tranché par les sources ; mapping des types WatermelonDB |
| `scripts/diff_sources.py` | `init` · `scan [--list <couche>]` · `diff <fichier>` · `commit [--touched --log] [--map]` |
| `scripts/spec_digest.py` | digest 1 fait/ligne OpenAPI/Swagger, AsyncAPI, Postman, GraphQL (`--desc` : descriptions) |
