# Standards — checklist condensée

Ne charger qu'une rubrique : `grep -n '^## ' standards.md` puis `sed -n '<début>,<fin>p'`.
Chaque puce = point à vérifier dans les sources, ou recommandation à noter `(reco)` quand les sources sont muettes.

## OpenAPI 3.1 / Swagger 2.0
- Lire via `spec_digest.py` : `servers`, `securitySchemes` + `security`, `paths`, `components.schemas` (Swagger : `host`/`basePath`, `securityDefinitions`, `definitions`).
- Nullabilité : 3.0 `nullable: true` ; 3.1 `type: [T, "null"]` ou `oneOf` avec `null`. `readOnly` → jamais envoyé par l'app ; `writeOnly` → jamais stocké.
- `deprecated: true` → ⛔ à venir ; `x-internal` ou tags admin/internal → hors contrat.
- Spec absente : demander l'export plutôt que lire le code — FastAPI `/openapi.json`, NestJS `/api-json`, springdoc `/v3/api-docs`, Swashbuckle `/swagger/v1/swagger.json`, drf-spectacular `/api/schema/`.

## RFC 9110 — Sémantique HTTP
- Sûres : GET, HEAD, OPTIONS ; idempotentes : + PUT, DELETE. POST/PATCH non idempotents → `Idempotency-Key` pour rejouer sans doublon.
- 201 + `Location` ; 202 = traitement asynchrone (état « en cours » côté UI) ; 204 sans corps ; 304 via `If-None-Match`.
- Requêtes conditionnelles : `ETag` + `If-Match` sur PUT/PATCH/DELETE → 412 si version périmée (428 si précondition exigée, RFC 6585).
- 401 + `WWW-Authenticate` ; 403 authentifié mais interdit ; 409 conflit d'état ; 410 supprimé définitivement ; 413 contenu trop grand ; 415 media type ; 422 validation ; 429/503 + `Retry-After` (secondes ou date HTTP).

## RFC 9457 — Problem Details
- `Content-Type: application/problem+json` ; membres `type` (URI = identifiant stable), `title`, `status`, `detail`, `instance`, + extensions.
- Mapping UX sur `type` (ou code d'extension), jamais sur `title`/`detail` (texte libre).
- Erreurs de champ : extension `errors[] {detail, pointer}` (JSON Pointer, RFC 6901) → message sous le champ concerné.

## OAuth 2 pour app native — RFC 6749, 7636, 8252, 9700, 7009, 6750
- Authorization Code + PKCE `S256` ; navigateur système (ASWebAuthenticationSession / Custom Tabs), jamais de WebView embarquée (RFC 8252).
- Redirection : lien universel / app link (https revendiqué) ou schéma privé en nom de domaine inversé.
- RFC 9700 (BCP sécurité) : ni implicit ni ROPC (mot de passe envoyé à l'API) ; refresh token d'un client public = rotation avec détection de réutilisation, ou lié à l'émetteur.
- RFC 6750 : `Authorization: Bearer`, jamais de token en query string. RFC 7009 : révoquer le refresh au logout.
- Libs RN (reco) : `react-native-app-auth` (AppAuth) ou `expo-auth-session`.

## RFC 8725 — JWT
- Côté app, access token opaque : lire `exp` au plus pour un refresh anticipé ; aucune décision de sécurité sur les claims.
- Payload JWT lisible par tous : signaler s'il transporte des données sensibles.

## RFC 6585 — 428, 429, 431, 511
- 429 + `Retry-After` : respecter le délai, puis backoff exponentiel avec jitter ; ce n'est pas un échec définitif.
- En-têtes de quota éventuels (`RateLimit`, `RateLimit-Policy`, draft IETF httpapi) → les documenter s'ils sont exposés.

## Idempotency-Key (draft IETF httpapi-idempotency-key-header-07)
- Clé UUID générée côté client par opération logique, persistée avec l'action en file, réutilisée à chaque retry.
- Serveur : clé requise absente → 400 ; même clé avec un autre payload → 422 ; requête originale encore en cours → 409.
- Durée de conservation des clés côté serveur ≥ fenêtre de retry hors-ligne, sinon Q.

## OWASP MASVS v2
- STORAGE : tokens et secrets en Keychain/Keystore ; WatermelonDB (SQLite) non chiffré par défaut → minimiser les PII locales ; purge au logout.
- AUTH : l'autorisation est serveur ; biométrie = déverrouillage local d'un secret du Keystore, pas une authentification.
- NETWORK : TLS uniquement ; pinning à évaluer (coût de rotation des certificats).
- PLATFORM : valider deep links et payloads de notification ; aucune donnée sensible dans le texte des notifications.
- PRIVACY : minimisation, consentement, suppression de compte si exigée.

## OWASP API Security Top 10 (2023)
- API1 BOLA : le pull ne renvoie que le périmètre autorisé ; un ID n'est jamais une preuve d'accès.
- API2 auth : expirations, rotation, rate limit sur login/OTP. API3 BOPLA : l'app n'envoie pas les champs `readOnly` ; le serveur filtre (mass assignment).
- API4 ressources : pagination, tailles max, 413/429. API5 BFLA : rôles côté UI = confort, contrôle côté serveur.
- API6 flux sensibles (OTP, paiement) → online-only. API9 inventaire : versions et dépréciations documentées.

## WatermelonDB
### Types et décorateurs
| API (JSON Schema) | Colonne WMDB | Modèle |
|---|---|---|
| string, uuid, email, enum, date `YYYY-MM-DD` | `string` | `@field` ou `@text` (trim) |
| integer, number | `number` | `@field` |
| boolean | `boolean` | `@field` |
| date-time | `number` (epoch ms) | `@date` |
| montant décimal | `number` en centimes ou `string` | `@field` (jamais float pour l'argent) |
| objet / tableau non normalisé | `string` | `@json('col', sanitizer)` |
| FK `x_id` | `string`, `isIndexed: true` | `@relation('xs', 'x_id')` ou `@immutableRelation` |
| relation inverse | — | `@children('ys')` + `static associations` |
| champ maîtrisé par le serveur | type ci-dessus | `@readonly` |
| nullable / facultatif | `isOptional: true` | — |
- `id` : string implicite, jamais déclaré ; réservés : `id`, `_status`, `_changed` ; `created_at`/`updated_at` (`number`) remplis automatiquement.
- Index : FK et colonnes de filtre/tri des listes, pas plus.
- Migrations : `schemaMigrations` (`createTable`, `addColumns`) + version du schéma ; suppression/renommage → vérifier le support de la version WMDB et l'impact sync → ⛔ + Q.
### Protocole de sync (docs officielles « Sync › Backend / Frontend »)
- Pull(`lastPulledAt`, `schemaVersion`, `migration`) → `{ changes: { <table>: { created: [], updated: [], deleted: [ids] } }, timestamp }`.
- `lastPulledAt` nul → tous les enregistrements accessibles ; sinon tous les changements depuis, sans ID dupliqué ; `timestamp` serveur cohérent : aucun changement perdu entre deux pulls.
- Enregistrements bruts : noms de colonnes WMDB, valeurs string/number/boolean ; jamais `_status`/`_changed` ; colonnes inconnues ignorées par l'app.
- Push(`changes`, `lastPulledAt`) : transactionnel (tout ou rien) ; créé mais déjà existant → mise à jour ; mis à jour mais inexistant → créé, sauf si supprimé (erreur) ; suppression d'un inexistant → ignorée.
- Conflit : enregistrement modifié côté serveur après `lastPulledAt` → le push DOIT échouer ; l'app re-pull (fusion) puis re-push.
- Fusion par défaut au pull : colonnes modifiées localement conservées, le reste vient du serveur (`conflictResolver` pour personnaliser).
- Serveur : `last_modified` (ms, monotone) par table ; suppressions tracées (soft-delete ou table de tombstones) ; droit révoqué → `deleted`, droit accordé → `created` (descendants inclus).
- IDs : caractères sûrs (défaut `[a-zA-Z0-9]{16}`, `-_.` admis) ; (reco) UUID générés côté client via `setGenerator` pour créer hors-ligne sans remapping.
- App : une seule `synchronize()` à la fois, avec retry ; `migrationsEnabledAtVersion` pour les migrations ; `sendCreatedAsUpdated` si le serveur ne distingue pas créé/modifié ; `unsafeTurbo` = 1re sync seulement (JSI) ; `experimentalStrategy: 'replacement'` = resynchronisation complète (droits modifiés, état incohérent) qui préserve les changements locaux non poussés.
- Volume : pull non paginé nativement → réduire le périmètre, turbo login, ou `_unsafeBatchPerCollection` (perd la transactionnalité).

## React Native (docs officielles)
- Sécurité : AsyncStorage non chiffré → secrets via `react-native-keychain` / `expo-secure-store` ; aucune clé d'API secrète dans le bundle.
- Réseau : `@react-native-community/netinfo` pour l'état de connexion ; `AppState` pour synchroniser au retour au premier plan.
- Arrière-plan : exécution limitée (iOS) → ne pas promettre de sync en tâche de fond ; notification silencieuse = déclencheur opportuniste.
- Push : FCM / APNs (ex. `@react-native-firebase/messaging`) ; enregistrer et révoquer le token auprès du backend.
- Fichiers : sandbox de l'app (`expo-file-system` / `react-native-fs`) pour la file d'upload hors-ligne.
- Listes : données WMDB observées (`withObservables`) dans des listes virtualisées (FlatList / FlashList).
