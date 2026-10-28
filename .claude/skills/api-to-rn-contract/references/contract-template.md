# Template FRONTEND_CONTRACT.md — règles de remplissage

Le squelette (après le marqueur `TEMPLATE:START`) est copié tel quel par `diff_sources.py init` : ne jamais le recopier à la main.
Ne charger que les règles de la section traitée : `grep -A12 '^### §4' "$S/references/contract-template.md"`.

**Règles communes**
- 1 fait = 1 ligne de tableau ; 1re colonne = clé stable et unique (entité, `MÉTHODE /chemin`, code, ID) : c'est l'ancre des éditions ciblées.
- Inconnu ou ambigu → `[À CONFIRMER] Qn` dans la cellule + ligne `Qn` au §11. Jamais de valeur plausible inventée.
- Valeur issue d'un standard et non des sources → suffixe `(reco)`. Source non évidente → courte : `spec`, `mig 0042`, `US-12`, `ADR-3`.
- Rien de recopié de la spec (payload, exemple, description) : nom du schéma + ce que le front en fait.
- Supprimer les lignes pré-remplies sans objet (code HTTP jamais renvoyé…) ; section sans contenu → une ligne « Aucun ».

### §1 Meta
- Version : `info.version` ; base URLs : `servers` (sinon config de déploiement, sinon Q) ; versioning : préfixe `/v1`, en-tête ou media type.
- Formats : dates (RFC 3339 UTC ? epoch ms ?), montants (entier en centimes ou décimal en chaîne, jamais float), pagination, langue des messages.
- Dépréciation : en-têtes `Deprecation` (RFC 9745) / `Sunset` (RFC 8594) ; version minimale d'app / force update → sinon Q.
- Sources : `fichier@commit7 (date)` par source principale (têtes git affichées par `scan`).

### §2 Auth & session
- Flux : app native = Authorization Code + PKCE S256 via navigateur système (RFC 8252/7636) ; ROPC, implicit ou WebView → ⚠️ (RFC 9700).
- Durées access/refresh, rotation et détection de réutilisation du refresh, révocation (RFC 7009) / logout serveur.
- Expiration hors-ligne : lecture locale conservée, écritures en file, refresh au retour réseau ; refresh refusé → re-login sans purger les changements non poussés.
- Changement d'utilisateur : pousser, puis purger la base locale (`unsafeResetDatabase`) et le Keychain.
- §2.1 : 1 ligne par rôle/permission → actions visibles ou masquées. L'UI masque, le serveur décide (OWASP API1/API5).

### §3 Modèle de données client
- Une sous-section `### <Entité> → \`<table>\`` par entité stockée localement ; entité online-only → §5 seulement.
- 1re ligne : `Source : <schéma|migration> · Sync : pull | push | pull+push | cache · Index : <colonnes>`.
- Tableau : `| Champ (API → colonne) | Type | Décorateur | Opt. | Validation locale |` ; mapping des types : `standards.md` rubrique WatermelonDB.
- Validation locale = contraintes spec/DTO (requis, min/max, longueur, pattern, enum) vérifiables hors-ligne ; le reste reste serveur.
- Exclure writeOnly (mots de passe), secrets, champs internes ; signaler PII/sensible (SQLite non chiffré par défaut, MASVS-STORAGE).
- Ligne `Relations :` (`belongs_to x (x_id)` · `has_many y (z_id)`) ; FK = colonne `*_id` indexée.
- Colonne/table ajoutée → migration WMDB (`schemaMigrations`, version +1) ; renommage/suppression/type changé → ⛔ + Q.

### §4 Sync offline-first
- Remplir chaque clé ; viser le protocole WMDB natif (pull `{changes, timestamp}`, push `{changes, lastPulledAt}` ; règles : `standards.md` rubrique WatermelonDB).
- Pas d'endpoint de sync (CRUD seul) → Q « format de sync » ; décrire l'adaptation retenue (pull via `updated_since` + tombstones, push = rejeu CRUD idempotent).
- §4.1 : 1 ligne par table synchronisée, parents avant enfants (ordre des FK) ; Sens = pull | push | pull+push.
- Conflits : stratégie + gagnant par champ si mixte. Suppressions : soft-delete/tombstones + rétention (≥ durée hors-ligne max).
- Volume : taille de la 1re sync ; pull WMDB non paginé → périmètre filtré, turbo login (`unsafeTurbo`) ou lots.
- Déclencheurs : démarrage, retour au premier plan, retour réseau, après écriture locale (debounce), pull-to-refresh, push silencieuse.

### §5 Endpoints
- 1 ligne par endpoint utilisé par l'app (sync et auth compris). Omettre admin, interne (`x-internal`, `/admin`, `/internal`), santé, métriques, webhooks serveur.
- Auth : schéma ou `—` ; Entité : table WMDB ou `—` ; 🌐 = réseau requis (non couvert par la sync) ; Idem. = oui pour GET/PUT/DELETE (RFC 9110) ou avec `Idempotency-Key`.
- Erreurs utiles : seulement les codes que l'écran traite spécifiquement (le reste suit §6). `dep` dans le digest → mention ⛔ à venir.

### §6 Erreurs & retry
- Format réel (Problem Details RFC 9457 ou autre) ; clé de mapping UX = `type` ou code stable, jamais le texte.
- Ajuster les lignes pré-remplies aux codes réellement renvoyés ; ajouter les codes métier qui exigent un message UX dédié.
- Retry seulement si idempotent ou avec `Idempotency-Key` ; jamais de retry auto sur 4xx sauf 401 (après refresh), 408, 409 (après pull), 429.

### §7 Règles métier côté UI
- Depuis les critères d'acceptation : 1 règle = 1 ligne, ID `R<n>`, Source = `US-<id>` (permet de retirer les règles d'une story supprimée).
- Hors-ligne : ✓ si vérifiable localement, `serveur` sinon (afficher « en attente de validation »).
- §7.1 : transitions autorisées, rôle, condition. Tout calcul à répliquer hors-ligne (totaux, taxes, remises) avec sa règle d'arrondi.

### §8 Temps réel & notifications
- Canal (FCM/APNs, WebSocket, SSE), événement, champs utiles du payload, action client.
- (reco) Événement = signal → lancer `synchronize()` ; pas d'écriture directe en base locale ; notification data-only pour la sync silencieuse.
- Auth du canal (pas de token en query string), reconnexion avec backoff, enregistrement/désinscription du token push.

### §9 Uploads & fichiers
- Mécanisme (multipart, URL pré-signée, reprenable type tus), taille max, formats MIME, compression/redimensionnement client.
- (reco) File hors-ligne : copie dans le sandbox de l'app + enregistrement local en attente ; envoi au retour réseau puis liaison par ID.

### §10 UX & ergonomie
- §10.1 : parcours critiques déduits des stories, étapes minimales, faisable 📴 ?, optimistic UI (oui si le serveur rejette rarement).
- §10.2 : garder les lignes pré-remplies pertinentes ; compléter « Conflit » selon la stratégie du §4.
- (reco) Jamais de spinner bloquant sur données locales ; actions 📴 jamais désactivées hors-ligne ; erreurs de champ inline.

### §11 Questions ouvertes
- `Qn` incrémental, jamais réutilisé ; Options = choix proposés ; § = sections impactées ; Statut = `[À CONFIRMER]`.
- Réponse obtenue → appliquer dans les sections, supprimer la ligne, écrire `Qn résolue : <choix>` dans le changelog.

### §12 Changelog
- Jamais édité à la main : `diff_sources.py commit --touched 3,5 --log "…"` ajoute `| date | §3,§5 | changements | sources · repo@commit |`.
- 1 ligne par mise à jour ; changements séparés par « ; », breaking préfixés ⛔, décisions `Qn résolue : <choix>`.

<!-- TEMPLATE:START -->
# FRONTEND_CONTRACT — …

> Contrat front de l'app React Native offline-first (WatermelonDB) : uniquement ce qui touche l'UI, le modèle local ou la sync. Maintenu par le skill `api-to-rn-contract` (mise à jour incrémentale : ne pas régénérer).
> Légende : `[À CONFIRMER]` décision en attente (§11) · ⛔ breaking · 🌐 réseau requis · 📴 faisable hors-ligne · (reco) recommandation issue d'un standard.

## 1. Meta
| Clé | Valeur |
|---|---|
| Version API | … |
| Base URL dev | … |
| Base URL staging | … |
| Base URL prod | … |
| Versioning | … |
| Formats | … |
| Dépréciation / version min. app | … |
| Sources | … |

## 2. Auth & session
| Clé | Valeur |
|---|---|
| Flux | … |
| Endpoints auth | … |
| Access token | … |
| Refresh token | … |
| Révocation / logout | … |
| Stockage client | Keychain (iOS) / Keystore (Android) via lib sécurisée ; jamais AsyncStorage ni WatermelonDB (reco) |
| Envoi | `Authorization: Bearer <access_token>` |
| Expiration hors-ligne | … |
| Changement d'utilisateur | … |

### 2.1 Rôles → UI
| Rôle / permission | Peut | Masqué / désactivé |
|---|---|---|

## 3. Modèle de données client
Conventions (reco) : tables et colonnes snake_case ; `id` string implicite ; dates → `number` epoch ms + `@date` ; objet/liste non normalisé → `string` + `@json` ; FK → `<x>_id` indexée + `@relation`. Version du schéma WMDB : …

## 4. Sync offline-first
| Clé | Valeur |
|---|---|
| Pull | … |
| Push | … |
| Horodatage | … |
| IDs | … |
| Conflits | … |
| Suppressions | … |
| Volume / 1re sync | … |
| Idempotence | … |
| Concurrence (ETag / If-Match) | … |
| Limites / quotas | … |
| Rétention hors-ligne | … |
| Périmètre | … |
| Migrations de schéma | … |
| Déclencheurs | … |

### 4.1 Tables synchronisées (ordre de dépendance)
| # | Table | Sens | Filtre de périmètre | Conflit | Volume |
|---|---|---|---|---|---|

## 5. Endpoints
| Méthode | Chemin | Auth | Entité | Écran / usage | 🌐 | Idem. | Erreurs utiles |
|---|---|---|---|---|---|---|---|

## 6. Erreurs & retry
Format : … · clé de mapping UX : … · actions par défaut (reco RFC 9110/6585/9457), à ajuster aux codes réellement renvoyés.
| Code | Cas | Message UX | Action client |
|---|---|---|---|
| réseau absent | hors-ligne, timeout | aucun (bannière discrète) | mettre en file, sync au retour réseau |
| 400 | requête invalide | « Une erreur est survenue » | pas de retry ; journaliser |
| 401 | access token expiré/invalide | aucun | 1 refresh puis rejouer ; échec → login (garder les changements locaux) |
| 403 | droit insuffisant | « Action non autorisée » | pas de retry ; masquer l'action |
| 404 | ressource absente | « Élément introuvable » | retirer de l'écran ; la sync tranchera |
| 409 | conflit | aucun (auto) ou « Modifié ailleurs » | pull puis nouveau push ; sinon recharger et fusionner |
| 412 | version périmée (If-Match) | « Modifié entre-temps » | recharger, fusionner, rejouer avec le nouvel ETag |
| 413 | charge trop lourde | « Fichier trop volumineux » | réduire ou découper le lot |
| 422 | validation | erreurs sous les champs | mapper `errors[].pointer` → champ ; pas de retry |
| 429 | quota dépassé | aucun (sauf action manuelle) | attendre `Retry-After`, puis backoff |
| 5xx | erreur serveur | « Service indisponible » si action bloquante | backoff exponentiel + jitter (1 s → 60 s, 5 essais) si idempotent |

## 7. Règles métier côté UI
| ID | Règle | Entité / champ | Hors-ligne | Source |
|---|---|---|---|---|

### 7.1 États & transitions
| Entité | De → Vers | Qui | Condition | 📴 |
|---|---|---|---|---|

## 8. Temps réel & notifications
| Canal | Événement | Payload utile | Action client |
|---|---|---|---|

## 9. Uploads & fichiers
| Clé | Valeur |
|---|---|
| Mécanisme | … |
| Taille max | … |
| Formats | … |
| Reprenable | … |
| File hors-ligne | … |

## 10. UX & ergonomie
### 10.1 Parcours critiques
| Parcours | Étapes (min) | 📴 | Optimistic UI |
|---|---|---|---|

### 10.2 États à afficher
| État | Déclencheur | Affichage |
|---|---|---|
| Hors-ligne | NetInfo `isConnected = false` | bannière discrète ; actions 📴 actives |
| Changements en attente | `hasUnsyncedChanges()` / `_status` ≠ `synced` | badge sur l'élément + compteur global |
| Sync en cours | `synchronize()` actif | indicateur non bloquant |
| Échec de sync | pull/push en échec après retries | bannière + « Réessayer » |
| Conflit | … | … |
| Dernière sync | horodatage local | « Synchronisé il y a N min » |

## 11. Questions ouvertes
| ID | Question | Options | § | Statut |
|---|---|---|---|---|

## 12. Changelog
| Date | § | Changement | Source |
|---|---|---|---|
