# Modèle de données — Application SaaS de gestion de livraisons

## Légende
- **PK** : clé primaire
- **FK** : clé étrangère
- Les énumérations sont indiquées entre crochets `[VALEUR_A / VALEUR_B]`
- Noms d'entités, propriétés et énumérations en **anglais** (convention technique du code) ; descriptions en français.
- Les champs sont notés en `snake_case`, comme dans la base ; le schéma Prisma peut les exposer en `camelCase`.
- **Identifiants** : UUIDv7 (norme RFC 9562), générés sur le téléphone au moment où l'enregistrement naît, stockés en `uuid`.
- **Montants** : entiers, en francs CFA (XAF, sans centimes), stockés en `bigint`. **Quantités** : décimales, 3 chiffres après la virgule au plus.
- **Dates** : horodatages stockés en UTC (`timestamptz`) ; les journées et « le soir » s'entendent dans le fuseau Africa/Douala.
- **Numéros de téléphone** : format international E.164 (ex. `+237677123456`), normalisés à la saisie.
- **Constantes de la plateforme** (un seul pays en v1, le Cameroun) : devise XAF, fuseau Africa/Douala, indicatif +237 par défaut, langues français et anglais.

> **Note de version — v10 : points non critiques** — La v10 traite, décision par décision, les points que la revue de la v9 avait mis de côté ; toutes ses décisions sont appliquées ici. Elle change peu de chose à ce que voit l'utilisateur. Le modèle passe de 23 à 24 entités.
>
> **Connexion et comptes** — Toute saisie du mot de passe demande aussi un code : le serveur n'a jamais à reconnaître un téléphone « déjà connu », et l'usage `NEW_DEVICE` devient `LOGIN`. Le nouveau titulaire d'un numéro recyclé répond « Ce numéro est nouveau pour moi » et reçoit un compte neuf ; l'ancien titulaire garde son compte, perd le numéro et se reconnecte par son email vérifié. Un propriétaire transfère ou ferme ses commerces avant de supprimer son compte.
>
> **Synchronisation** — Un doublon ne bloque jamais un téléphone. Un refus déclenche une resynchronisation complète et une notification à l'auteur. Soldes et argent détenu se mettent à jour par ajout, l'un après l'autre, avec un contrôle de nuit. Un geste en ligne envoyé deux fois ne compte qu'une fois.
>
> **Relations** — Une relation ne se conteste qu'une fois. Seule la partie qui l'a close peut la rouvrir. Le rattachement disparaît : une entreprise a sa propre relation, et une dette ne change jamais de débiteur par ce biais.
>
> **Contrôle interne** — Sur sa propre fiche client, un collaborateur n'est qu'un client. Celui qui remet de l'argent est prévenu du montant noté. Le reste abandonné d'une livraison partielle rejoint les écarts. L'argent du propriétaire est compté comme celui de tous, et remis automatiquement au commerce lors d'un transfert de propriété.
>
> **Données transmises** — D'une personne, une organisation ne reçoit que son nom public, son numéro et le fait qu'elle soit inscrite ou non. Le livreur ne reçoit que le crédit disponible de ses clients. Les recherches par numéro sont limitées.
>
> **Commerce et administration** — Un commerce peut être fermé par son propriétaire. Un journal des plafonds garde chaque changement pendant 10 ans. Le rejeu des envois est réservé aux super-administrateurs et journalisé ; la double authentification des administrateurs a une adresse email de secours.
>
> **Nettoyage** — Annexe complétée ; appartenance au commerce exigée pour qui paie une dépense, remet de l'argent ou livre ; règle des auteurs précisée pour les actions d'administration.
>
> **Entités et champs** — Ajoutée : `CreditLimitChange`. Champs ajoutés : `CustomerRelationship.ended_by_party`, `Administrator.recovery_email`, `AdminAction.sync_archive_id`. Champ retiré : `CustomerRelationshipReassignment.new_organization_id`. Valeurs nouvelles : `CLOSED` pour `Organization.status` ; `REPLAY_SYNC` et `RECOVER_2FA` pour `AdminAction.action` ; `LOGIN` (anciennement `NEW_DEVICE`) et `TOTP_RECOVERY` pour `OtpChallenge.purpose`.

> **Versions précédentes**
> - *Sécurité ciblée (v9)* — revue des seuls points critiques de la v8 : l'email vérifié devient la clé de secours du compte (risque accepté : la puce permet encore de réinitialiser le mot de passe) ; le serveur fixe le montant de la vente ; la règle des 3 jours n'est qu'un contrôle sur le serveur ; équipe, propriété et abonnement demandent le réseau, même au propriétaire ; le premier envoi après un changement de droits est jugé avec les droits actuels ; les gestes qui font perdre de l'argent sans que personne ne réclame rejoignent les écarts du propriétaire. Le modèle reste à 23 entités.
> - *Solidité (v8)* — revue complète de la v7 : montants entiers en francs CFA, quantités à 3 décimales et arrondi unique partagé ; identifiants UUIDv7 créés sur le téléphone ; numéros E.164 ; le Cameroun comme pays unique. La vente entre dans le compte (`SALE`) et le solde devient la somme des effets des écritures, calculés par la base ; plus de statut « payé » ; rattachement seulement sans dette ; alerte de dette par SMS reportée. Le Mobile Money reçu par un collaborateur compte dans son argent détenu, tenu par le serveur ; `CashHandover` devient `Handover`. Le serveur juge chaque ligne reçue, avec une table des règles évaluée par CASL ; mode restreint après 3 jours, resynchronisation complète à chaque changement de droits. Mot de passe sans règles de composition, code SMS sur un nouveau téléphone, déverrouillage par le verrou du téléphone, `Device`, Play Integrity, deux comptes PostgreSQL, `AdminAction`, aucune dépendance à un hébergeur. Loi camerounaise n° 2024/017. Le modèle passe de 21 à 23 entités.
> - *Simplification (v7)* — plus d'annuaire ni de géographie : le numéro de téléphone est la seule clé ; une relation naît active pour tout client ; commande client minimale ; un seul prix par article et des prix négociés ; « Commande livrée », seule façon de clore une commande ; `LedgerEntry` immuable, `Expense` et `CashHandover` ; `Account` fusionne dans `Person`, authentification dans Express ; un seul SMS, l'alerte de dette ; synchronisation classique de WatermelonDB, avec `SyncArchive`. Le modèle passe de 25 à 21 entités.
> - *Catalogue propre, sans stock (v6)* — `Stock` et `StockMovement` disparaissent, avec le déconditionnement, les ajustements et les alertes ; `Product` et `ProductVariant` fusionnent en un seul niveau, l'article ; `Offer` disparaît, un article acheté se copie d'un geste, sans lien conservé ; une commande saisie par le fournisseur naît confirmée ; « Remis au client » clôt une commande sans livraison ; `FAILED` disparaît, une tentative ratée ramenant la commande en `CONFIRMED` ; `Collaboration` vise une `Person`, et la propriété devient transférable ; le crédit s'accorde au moment où le plafond bloque. Le modèle passe de 31 à 25 entités.
> - *Clients, fournisseurs et solde* — `CustomerRelationship` remplace `Customer`, `Partnership` et `PartnershipVariantPrice` : il n'existe plus que des clients et des fournisseurs, deux lectures d'une même relation qui porte un solde courant ; `Debt` et `DebtSettlement` disparaissent, `Payment` et `Refund` fusionnent dans `LedgerEntry`, immuable ; prix de référence figé à côté du prix appliqué et prix convenus par client ; fournisseur invité par son numéro ; quatre rôles fixes ; vente au comptoir sur la relation « Client de passage ».
> - *Géographie, adresses et prix* — référentiel géographique hiérarchique (`Location`), zones desservies indicatives (`OrganizationServiceArea`), carnet d'adresses (`OrganizationAddress`) et adresse de livraison figée dans la commande ; prix déplacés de `ProductVariant` vers `Offer` ; déconditionnement et reconditionnement de variantes ; champ `Product.brand`.
> - *Simplification* — fusion de `PartnershipAgreement` et `PartnershipProduct` en `Partnership` ; deux colonnes nullables au lieu des discriminants `PERSON / ORGANIZATION` ; permissions en tableau de codes sur `Position` ; plafonds d'endettement portés par `Customer` et `Partnership` ; allocation manuelle assistée au lieu de FIFO ; suppression de `OperatingCostOrderLink` et `Order.entry_mode` ; six statuts de commande au lieu de huit.
> - *Organisations sans type* — une organisation est fournisseur ou revendeur selon le partenariat, et peut être les deux ; produits partagés entre fournisseur et revendeurs, dont l'origine reste confidentielle vis-à-vis des clients grâce à `Offer` ; pas d'exclusivité client ; pas de partage d'informations entre organisations.

---

## 1. Identité et organisation

### 1.1 `Person`
Personne physique connue de la plateforme, **inscrite ou non**. Racine de toute identité : toutes les relations du modèle qui désignent un individu, y compris l'auteur de chaque action, référencent `Person.id` — sauf les actions d'administration, dont l'auteur est un `Administrator` (`Report.resolved_by_id`, `AdminAction.administrator_id`), lui-même lié à sa `Person` : ces références garantissent que l'auteur est bien un administrateur.

Une `Person` existe dès qu'un numéro est saisi — client ajouté par un fournisseur, fournisseur invité par un client, collaborateur invité (voir 1.4 et 2.1) —, même si la personne ne s'est jamais inscrite. Une personne non inscrite est un **invité** : elle ne peut pas se connecter, donc ne peut rien faire dans l'application. L'inscription complète la `Person` existante au lieu d'en créer une nouvelle.

Une `Person` est **toujours créée par le serveur**, jamais par un téléphone : hors ligne, le téléphone inscrit le numéro saisi sur la relation (`CustomerRelationship.customer_phone_number`), et le serveur retrouve ou crée la personne à la synchronisation (voir 2.1 et 9.6). Deux fiches ne peuvent donc jamais exister pour un même numéro.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| full_name | string, nullable | Nom canonique, **saisi par la personne elle-même à son inscription** et modifiable par elle seule. Vide tant que la personne est invitée : une organisation n'écrit jamais dans `Person`. **Donnée publique** |
| phone_number | string, nullable, **unique** | **Numéro actif**, au format international E.164 (ex. `+237677123456`), normalisé à la saisie sur le téléphone comme sur le serveur : identifiant naturel de la personne, et canal des codes de vérification. Non modifiable par une organisation (voir 2.3). Vide uniquement quand le numéro a été libéré |
| released_phone_number | string, nullable | **Numéro libéré** : celui d'une personne « fantôme » née d'une contestation (voir 2.3), d'un compte supprimé, ou d'un inscrit dont le numéro a été repris par son nouveau titulaire (voir plus bas). Conservé pour l'historique des organisations |
| phone_verified_at | datetime, nullable | Date de vérification du numéro actif par un code SMS : renseignée à l'inscription, mise à jour à chaque changement de numéro. **Vide = numéro seulement saisi par un commerçant, donc non vérifié**, ou numéro libéré |
| email | string, nullable | **Privé** — jamais exposé à une organisation. Facultatif, mais l'application invite à l'ajouter : c'est la clé de secours du compte si la puce est perdue ou volée (voir plus bas). Enregistré dès sa saisie |
| email_verified_at | datetime, nullable | Renseigné quand la personne confirme le code reçu à cette adresse ; remis à vide si l'email change. Seul un email vérifié sert de secours quand la puce est inaccessible : il reçoit alors le code de réinitialisation du mot de passe comme le code « nouveau téléphone » (voir 10.2) |
| password_hash | string, nullable | Hash du mot de passe choisi à l'inscription, calculé avec un algorithme lent conçu pour les mots de passe (Argon2id). Vérifié par le serveur à la connexion. Règles du mot de passe : voir plus bas |
| registered_at | datetime, nullable | Date d'inscription. **Vide = invité** |
| preferred_language | enum `[FR / EN]`, nullable | Privé. Détectée automatiquement, modifiable par la personne |
| created_at | datetime | |
| status | enum `[ACTIVE / SUSPENDED / ANONYMIZED]` | `SUSPENDED` : décidé par un administrateur ou un modérateur (voir 6.1 et 7.2). `ANONYMIZED` : la personne a supprimé son compte ; les données qu'elle avait saisies (`full_name`, `email`, `email_verified_at`, `preferred_language`, `password_hash`) sont effacées, et son numéro est libéré |
| anonymized_at | datetime, nullable | La suppression est bloquée tant que la personne a un solde positif dans une relation où elle est cliente (voir 2.1), ou qu'elle est propriétaire d'un commerce ni transféré ni fermé (voir plus bas) |
| scope_version | int | **Compteur de droits**, incrémenté par le serveur à chaque changement de ce que la personne peut voir ou faire : collaboration ajoutée ou révoquée, rôle changé, relation corrigée ou contestée. Un téléphone qui connaît une valeur plus ancienne se resynchronise entièrement (voir 9.6) |

*Une personne a toujours **exactement un numéro**, actif ou libéré (`CHECK`). Libérer un numéro, c'est le déplacer de `phone_number` vers `released_phone_number`, et vider `phone_verified_at` : la recherche à la saisie, l'envoi de SMS et l'inscription ne lisent que le numéro actif, et ignorent donc par construction une personne au numéro libéré.*

*Suppression du compte : un propriétaire ne peut supprimer son compte qu'après avoir transféré la propriété ou fermé chacun de ses commerces (voir 1.3) ; l'application le lui dit : « Transférez ou fermez d'abord Boutique Fotso ». Sans cela, le commerce garderait un propriétaire incapable de se connecter, et personne ne pourrait plus gérer l'équipe, l'abonnement ou le transfert. La suppression révoque aussi les collaborations de la personne ; l'argent qu'elle détient encore reste visible du propriétaire, avec son ancien numéro : « Ancien collaborateur (+237 6 77…) : 5 000 ».*

*Une seule fiche par personne : la v6 séparait `Person` (qui est cette personne) et `Account` (ses identifiants de connexion), si bien que les actions visaient `Account` tandis que relations, collaborations et notifications visaient `Person`. `Account` a fusionné dans `Person` : une personne inscrite est une `Person` dont `registered_at` est renseigné.*

*Depuis quand un numéro est vérifié : `phone_verified_at` le dit directement. Il vaut la date de l'inscription ou celle du dernier changement de numéro, que `PhoneNumberChangeLog` permet aussi de retrouver. Il est tenu à jour par le serveur seul, aux deux seuls moments où il change. Une personne inscrite a un numéro vérifié, sauf si ce numéro a été repris par son nouveau titulaire (voir plus bas) ; l'email, lui, peut être saisi avant d'être confirmé, d'où `email_verified_at`.*

*Nom de l'entité : `Person` et non `User`, car la plupart des lignes ne sont pas des utilisateurs (clients jamais inscrits, invités, personnes fantômes). Dans le code, « user » désigne la personne connectée, celle qu'identifie le jeton (`req.user` dans Express).*

*Garantie qu'un invité n'agit pas : le serveur prend toujours l'auteur d'une action dans la session authentifiée, jamais dans la requête ; une contrainte vérifie en outre que toute colonne d'auteur (`*_by_id`, `Delivery.assigned_to_id`…) désigne une personne inscrite.*

**Parcours — inscription**
1. La personne saisit son numéro ; un code lui est envoyé par SMS (`OtpChallenge`, usage `REGISTRATION`, voir 10.2), qu'elle saisit. C'est la preuve que le numéro est bien le sien, sans laquelle n'importe qui pourrait s'approprier les fournisseurs et le solde attachés à un numéro.
2. Si aucune `Person` n'a ce numéro pour numéro actif, elle est créée. Si c'est le numéro d'un inscrit, l'application demande d'abord « Est-ce votre compte ? » (voir « Parcours — numéro recyclé »). Sinon, l'application lui montre tout ce qui est attaché à ce numéro : ses fournisseurs (relations où elle est cliente, avec achats et solde), les invitations à rejoindre une équipe, les invitations à devenir fournisseur. Elle accepte ou conteste chaque ligne (« Ce n'est pas moi », voir 2.3).
3. Elle saisit son nom et choisit son mot de passe (voir les règles plus bas) ; `registered_at` et `phone_verified_at` sont renseignés, et son téléphone est enregistré comme premier appareil (`Device`, voir 10.3).
4. L'application l'invite ensuite à ajouter un email : « Votre email vous permettra de récupérer votre compte si vous perdez votre téléphone. » L'étape est facultative et se passe d'un geste (« Plus tard ») ; tant qu'aucun email n'est vérifié, un rappel discret reste visible dans son profil. L'email est enregistré aussitôt, et `email_verified_at` est renseigné quand elle confirme le code reçu à cette adresse (usage `EMAIL_VERIFICATION`).

*Aucune réécriture de clé étrangère n'intervient à l'inscription : les relations, invitations et collaborations en attente visaient déjà cette `Person`.*

**Parcours — connexion et secours**
- **Connexion** : numéro et mot de passe, puis un code reçu par SMS (`OtpChallenge`, usage `LOGIN`, voir 10.2), à chaque saisie du mot de passe — sur un nouveau téléphone comme sur le sien, après 90 jours sans connexion ou une déconnexion. Il faut ainsi à la fois le mot de passe et la puce : un mot de passe deviné ou aperçu ne suffit jamais à ouvrir le compte. Le serveur n'a donc jamais à reconnaître un téléphone « déjà connu », ce qui l'obligerait à se fier à un identifiant annoncé par le téléphone, qui n'a rien de secret. Si la puce est inaccessible — perdue, volée ou pas encore remplacée —, le code part vers l'email vérifié, qui tient lieu de seconde preuve. Le serveur enregistre le téléphone (`Device`, voir 10.3) et délivre un jeton d'accès (JWT, valable 15 minutes) et un jeton de renouvellement (valable 90 jours, renouvelé à chaque utilisation, voir 10.4). Les autres téléphones connectés de la personne reçoivent une notification : « Nouvelle connexion sur Tecno Spark 20. Ce n'était pas vous ? Déconnectez-le. »
- **Ensuite** : la session reste ouverte sur le téléphone, et l'utilisateur ne ressaisit pas son mot de passe. Après 15 minutes d'inactivité, l'application se déverrouille avec le verrou du téléphone lui-même : schéma, code, empreinte ou visage (voir 10.5). L'application fonctionne sans réseau ; au retour du réseau, le jeton de renouvellement prolonge la session sans rien demander. S'il a expiré ou a été révoqué, l'utilisateur ressaisit son mot de passe, avec un code, comme à toute connexion.
- **Mot de passe oublié** : un code reçu par SMS permet d'en choisir un nouveau (usage `PASSWORD_RESET`). Si la puce est inaccessible, le code est envoyé par email, à condition que l'email soit vérifié. Changer ou réinitialiser son mot de passe déconnecte les autres appareils. Après un vol, c'est ainsi qu'on reprend la main : on fait bloquer la puce chez l'opérateur, on récupère son compte par l'email vérifié sur un nouveau téléphone, et la réinitialisation déconnecte le téléphone volé. Si son numéro a été repris par un nouveau titulaire (voir « Parcours — numéro recyclé »), la personne s'identifie par son email vérifié à la place du numéro.
- **Changement de numéro** : un code est envoyé au nouveau numéro (usage `PHONE_CHANGE`). À sa confirmation, dans une même transaction, le numéro change, `phone_verified_at` est mis à jour et une ligne s'ajoute à `PhoneNumberChangeLog`. Si l'ancienne puce est inaccessible, la personne se connecte d'abord grâce au secours par email.
- **Risque accepté en v1** : qui détient la puce — échange de SIM frauduleux, puce volée — peut encore réinitialiser le mot de passe par SMS et ouvrir le compte. Une protection est reportée en v2 (voir « Reporté en v2 ») ; d'ici là, l'email vérifié permet au titulaire de reprendre la main, et le blocage de la puce chez l'opérateur met fin à l'échange.

**Parcours — numéro recyclé**
Quand l'opérateur réattribue le numéro d'un inscrit, le nouveau titulaire ne doit ni reprendre le compte de l'ancien, ni recevoir ses relations.
1. Avant une inscription ou une réinitialisation sur un numéro déjà inscrit, l'application montre le compte concerné, nom masqué : « Béatrice N… — est-ce votre compte ? ». Oui : le parcours habituel continue.
2. Non (« Ce numéro est nouveau pour moi ») : après le code SMS, le serveur crée une nouvelle `Person` avec ce numéro. L'ancien titulaire garde son compte et son historique, mais son numéro passe en numéro libéré, et il n'est plus contact public d'aucun commerce.
3. L'ancien titulaire est prévenu sur ses téléphones et par email : « Votre numéro +237 6 77… est maintenant utilisé par quelqu'un d'autre. Ajoutez votre nouveau numéro. » Il se reconnecte grâce à son email vérifié, puis ajoute son nouveau numéro (usage `PHONE_CHANGE`).
4. Les commerçants qui ajoutent désormais ce numéro l'attachent au nouveau titulaire.

*Aucun risque nouveau : celui qui détient la puce peut déjà réinitialiser le mot de passe (voir plus haut). Sans email vérifié ni téléphone encore connecté, l'ancien titulaire ne peut plus se connecter ; il crée un nouveau compte avec son nouveau numéro.*

**Règles du mot de passe** (conformes à l'esprit du NIST SP 800-63B, révision 4)
- **Au moins 8 caractères**, jusqu'à 64 ; espaces et phrases acceptés. Une phrase comme « le riz aime la pluie » se retient mieux qu'un mot compliqué, et résiste mieux.
- **Aucune règle de composition** (majuscule, chiffre, symbole imposés) : elles poussent vers des mots de passe prévisibles.
- **Refus des mots de passe courants ou déjà fuités**, comparés à une liste de blocage (« 12345678 », « motdepasse »…).
- **Essais limités** : après 5 échecs, il faut attendre quelques minutes avant de réessayer. Un code étant demandé à chaque connexion, un mot de passe deviné ne suffit de toute façon jamais.
- Un minimum de 8 caractères empêche au passage de reprendre tel quel un code Mobile Money de 4 ou 5 chiffres. Le compte n'utilise ni code chiffré court ni schéma, faciles à réutiliser ou à observer ; le schéma sert seulement au déverrouillage local, protégé par le téléphone.

*Règle de réutilisation (structurante) : quand un numéro est saisi — client ajouté, fournisseur ou collaborateur invité —, il est d'abord normalisé au format E.164 (bibliothèque libphonenumber, indicatif +237 par défaut, seuls les numéros mobiles valides étant acceptés) ; sans cette normalisation, « 6 77 12 34 56 » et « +237 677 12 34 56 » deviendraient deux personnes. Le système recherche ensuite la `Person` dont c'est le numéro actif. Si elle existe, elle est **réutilisée** ; seule la relation, ou la `Collaboration`, est créée. Une organisation peut donc se rattacher silencieusement à une `Person` créée par une autre — c'est le prix assumé de l'absence de toute fusion d'identités dans le modèle.*

*Limite assumée : `full_name` étant public, un fournisseur qui ajoute un client voit apparaître le nom d'un inscrit. C'est un garde-fou contre les erreurs de saisie, et un petit effet d'oracle. Comme le nom s'affiche avant la création de la fiche, c'est la recherche elle-même qui est limitée : toute recherche par numéro, pour un client comme pour un fournisseur, compte dans une limite par personne (par exemple 60 par heure), et l'équipe est prévenue quand un compte bute souvent dessus, comme pour les codes SMS. Dans l'autre sens, la recherche d'un fournisseur par son numéro ne révèle que des organisations : on ne peut rien apprendre sur un particulier (voir 2.1).*

*Cloisonnement : une `Person` étant globale, la confidentialité repose sur `CustomerRelationship` — une organisation ne voit d'une `Person` que son nom public, son numéro, le fait qu'elle soit inscrite ou non, ce que porte sa propre relation et son propre historique transactionnel.*

*Une `Person` invitée ne contient par construction **aucune donnée saisie par une organisation** hormis son numéro : les noms que les organisations lui donnent vivent dans leurs relations (`customer_label`, `supplier_label`). Aucune écriture concurrente n'est donc possible sur `Person`.*

*Liste fermée : d'une personne, une organisation ne reçoit que son nom public, son numéro et le fait qu'elle soit inscrite ou non. Tout le reste est privé par défaut, dates de création, d'inscription et de vérification comprises : elles diraient depuis quand un numéro est connu de la plateforme, donc qu'un autre commerce l'a saisi avant. La couche d'accès protège ainsi la **topologie des relations**, le fait qu'une personne soit cliente d'une autre organisation (voir 10.1). Limite acceptée : l'identifiant d'une `Person`, un UUIDv7 comme tous les identifiants, contient la date de sa création ; il laisse donc deviner quand le numéro est apparu sur la plateforme, mais ni qui l'a saisi, ni aucun montant.*

### 1.2 `PhoneNumberChangeLog`
Journal des changements de numéro d'une `Person`. Sans impact sur l'historique : toutes les relations référencent `Person.id`, jamais `phone_number`. Conservé : il retrace chaque changement, utile en cas de litige ou d'usurpation, et permet de retrouver depuis quand un numéro est vérifié. Réservé à une personne inscrite, avec vérification par SMS du nouveau numéro (voir 1.1). Journal immuable : on ne fait qu'y ajouter des lignes, et la base elle-même refuse toute modification (voir 10.6). Numéros au format E.164.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | |
| old_phone_number | string | |
| new_phone_number | string | |
| verified_at | datetime | Confirmation par SMS au nouveau numéro ; recopiée dans `Person.phone_verified_at`, dans la même transaction |
| changed_at | datetime | |

### 1.3 `Organization`
Entité générique représentant toute structure commerciale inscrite. Une organisation **n'a pas de type** : elle peut vendre ses propres produits, revendre ce qu'elle achète à d'autres organisations, ou les deux. Ses rôles de **fournisseur** et de **client** sont portés par chaque `CustomerRelationship` (voir 2.1).

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| name | string | **Donnée publique** |
| description | text, nullable | **Donnée publique**. Une organisation qui veut indiquer où elle livre l'écrit ici |
| email | string, nullable | Contact public. À la différence de `Person.email`, qui est privé |
| status | enum `[ACTIVE / SUSPENDED / CLOSED]` | `SUSPENDED` : décidé **uniquement par un administrateur ou un modérateur** (voir 6.1 et 7.2). `CLOSED` : commerce fermé par son propriétaire, qui peut le rouvrir (voir plus bas). Distinct de l'abonnement (voir 5.4) : une suspension bloque l'organisation, un impayé ne la bloque jamais |
| created_at | datetime | |

*Numéros publics : ce sont ceux des collaborateurs qui acceptent de représenter l'organisation (`Collaboration.is_public_contact`, voir 1.4), par défaut le propriétaire. Ils sont vérifiés par construction, puisque tout collaborateur actif est inscrit. Sans cette vérification, n'importe qui pourrait créer une organisation sous le numéro d'un autre, se faire trouver à sa place et se faire payer par ses clients. `Organization.phone_numbers`, liste libre non vérifiée, a disparu.*

*Clients et fournisseurs ne sont pas des attributs mais des lectures : les clients d'une organisation sont les relations où elle est `supplier_organization_id`, ses fournisseurs celles où elle est `customer_organization_id`.*

*Une même personne peut posséder plusieurs `Organization`, totalement indépendantes. Une activité hybride ne nécessite pas deux organisations.*

*Fermer le commerce : le propriétaire le fait en ligne. Plus de nouvelle commande ni de nouveau client, et le commerce n'est plus trouvable par son numéro ; les commandes en attente sont refusées avec le motif « Commerce fermé » ; l'équipe est révoquée et l'abonnement s'arrête. Les relations, les soldes et l'historique restent visibles des clients, et les paiements restent possibles. Le propriétaire peut rouvrir son commerce.*

*Ni pays, ni devise, ni fuseau en colonne : la v1 ne sert qu'un pays, le Cameroun, si bien que ce sont des constantes de la plateforme (XAF, Africa/Douala, +237). Si d'autres pays venaient, deux colonnes `country` et `currency`, valant par défaut `CM` et `XAF`, suffiraient, sans rien changer aux montants existants.*

*Création : un nom suffit. L'organisation reçoit automatiquement la `Collaboration` `OWNER` de son créateur — seule trace de la propriété, contact public par défaut (voir 1.4) — et un premier comptoir « Client de passage » (voir 2.1).*

*Pas d'annuaire en v1 : une organisation ouverte se trouve par l'un de ses numéros publics (voir 2.1), dans la limite des recherches par numéro (voir 1.1). Un annuaire des organisations, avec leurs zones desservies, pourra revenir en v2 par simple ajout, aucune entité conservée n'en dépendant (voir « Reporté en v2 »).*

### 1.4 `Collaboration`
Lie une personne à une organisation, avec un **rôle fixe**. Les rôles sont emboîtés : chacun inclut les permissions de celui qui le précède dans le tableau ci-dessous. La correspondance entre rôle et permissions vit dans la **table des règles** (voir 10.1 et l'annexe), partagée par l'application et le serveur et évaluée par la bibliothèque CASL ; aucune permission n'est stockée en base.

| Rôle | Périmètre |
|---|---|
| `DRIVER` (livreur) | Les commandes à livrer et ses livraisons ; départ en livraison, « Commande livrée » avec encaissement, livraison ratée (voir 4.3). N'accorde jamais de crédit (voir 2.1) |
| `SELLER` (vendeur) | En plus : ventes, ajout et invitation de clients (au plafond de 0), « Commande livrée » au comptoir ou en boutique (voir 4.1) ; encaissements ; consultation des soldes ; écarts de prix ponctuels, toujours visibles (voir 4.2). N'accorde jamais de crédit |
| `MANAGER` (gérant) | En plus : catalogue et prix négociés ; plafonds de crédit, y compris au moment d'une vente (voir 2.1) ; argent rendu, avoirs, reprises de cahier, annulations d'écritures (voir 5.1) ; dépenses, réception des remises d'argent et leur annulation (voir 5.2 et 5.3) ; corrections de numéro (voir 2.3) ; commandes et invitations de fournisseurs au nom de l'organisation cliente ; acceptation, au nom de l'organisation, des invitations reçues comme fournisseur. **Hors ligne, un gérant travaille comme un vendeur : ses pouvoirs de gérant demandent le réseau**, pour que le serveur vérifie son rôle au moment même (voir 10.1). Jamais sur sa propre fiche client, ni sur celle d'une organisation cliente qu'il gère : là, ces gestes reviennent au propriétaire (voir 10.1) |
| `OWNER` (propriétaire) | En plus : équipe, abonnement et transfert de la propriété, qui demandent toujours le réseau (voir 10.1). Pour tout le reste, seul rôle jamais limité hors ligne : il ne peut être ni rétrogradé ni révoqué, et porte lui-même le risque |

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | Le collaborateur, désigné par son numéro, **inscrit ou non** (voir 1.1) |
| organization_id | FK → Organization | |
| role | enum `[OWNER / MANAGER / SELLER / DRIVER]` | Voir tableau ci-dessus |
| status | enum `[INVITED / ACTIVE / REVOKED]` | `INVITED` jusqu'à l'acceptation, qui suppose une personne inscrite |
| is_public_contact | boolean | Le numéro du collaborateur est publié comme contact de l'organisation : quiconque le connaît peut la trouver (voir 2.1). Activé avec l'accord du collaborateur, car un numéro publié rend l'organisation visible de tous ceux qui l'ont enregistré, famille comprise. Vrai par défaut pour le `OWNER` |
| invited_at | datetime | |
| accepted_at | datetime, nullable | |
| amount_held | bigint | **Argent détenu** par le collaborateur : espèces et Mobile Money reçus sur son propre numéro, pas encore remis. **Cache tenu par le serveur** : chaque encaissement, argent rendu, dépense ou remise y ajoute son effet, et un contrôle de nuit le compare à la somme de toutes ces opérations (voir 5.1 et 5.3). Visible de la personne elle-même et du propriétaire. Tenu aussi pour le `OWNER`, mais jamais présenté : ce qu'il détient est l'argent du commerce |

*Contraintes : unique par (`person_id`, `organization_id`) ; `status = ACTIVE` ⇒ la `Person` est inscrite ; exactement une `Collaboration` `OWNER` active par organisation — c'est la **seule** trace de la propriété : `Organization` ne porte pas de colonne propriétaire ; `is_public_contact` n'est vrai que pour une collaboration active, dont la personne a un numéro actif.*

*Ordre des rôles : du moins au plus de droits — livreur, vendeur, gérant, propriétaire. Une fonction unique, `atLeast(role, minimum)`, fait toutes les comparaisons et refuse tout rôle inconnu : une erreur retombe toujours du côté du refus (voir 10.1).*

*Invitation par numéro, en ligne : le `OWNER` ajoute un collaborateur avec un numéro et un rôle. Le système retrouve ou crée la `Person` de ce numéro (voir 1.1) et crée la `Collaboration` en `INVITED`. Le `OWNER` envoie l'invitation depuis son propre téléphone : WhatsApp ou SMS s'ouvre sur la conversation du collaborateur, avec un message prêt et le lien de téléchargement de l'application. À son inscription, ou depuis l'application s'il est déjà inscrit, le collaborateur accepte ou conteste l'invitation. Tant qu'il n'est pas inscrit, il ne peut rien faire.*

*Transfert de propriété, en ligne : le `OWNER` désigne un collaborateur actif, qui devient `OWNER` tandis que lui-même devient `MANAGER`, dans la même transaction ; le nouveau propriétaire en est notifié. Au même moment, le serveur enregistre une remise de l'ancien propriétaire à lui-même, du montant de son argent détenu : ce qu'il a encaissé comme propriétaire est « remis au commerce », et il repart de zéro comme gérant (voir 5.3). La vente du commerce ou une succession se font ainsi sans recréer l'organisation : clients, soldes, catalogue et historique sont conservés. Ce que l'ancien propriétaire aurait encore saisi hors ligne sur un autre téléphone est jugé avec ses nouveaux droits de gérant : ses ventes et encaissements passent, le reste est refusé et signalé au nouveau propriétaire (voir 9.2).*

*Révocation, en ligne : elle prend effet au moment même, si bien que le propriétaire ne croit jamais écarté quelqu'un qui ne l'est pas encore. Le collaborateur révoqué perd aussitôt l'accès aux données de l'organisation. Ses ventes, livraisons et encaissements faits hors ligne avant de l'apprendre sont acceptés à la synchronisation suivante et signalés au propriétaire, le reste est refusé ; puis le téléphone efface les données de l'organisation (resynchronisation complète, voir 9.2 et 9.6). L'argent qu'il détient encore reste visible : « Paul (parti) : 5 000 ».*

*Rôles fixes plutôt que postes composés : un commerçant ne raisonne pas en permissions. L'emboîtement permet à un vendeur de livrer sans double rôle. Si des rôles sur mesure deviennent nécessaires, ils pourront revenir sans toucher au reste du modèle.*

---

## 2. Relations commerciales

### 2.1 `CustomerRelationship`
Relation commerciale entre un **fournisseur** et un **client**. C'est la seule notion de contrepartie du modèle : pour l'utilisateur final, il n'existe que des clients et des fournisseurs, qui sont les deux lectures de cette entité.
- **Mes clients** : les relations où l'organisation est `supplier_organization_id`.
- **Mes fournisseurs** : celles où elle est `customer_organization_id` — ou, pour un particulier inscrit, celles où il est `customer_person_id`.

Chaque relation porte le **compte** entre le client et le fournisseur : ce que le client doit, son solde. Commandes, livraisons et écritures s'y rattachent : une même commande est une vente pour le fournisseur et un achat pour le client.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| supplier_organization_id | FK → Organization, nullable | Le fournisseur, cas général |
| supplier_person_id | FK → Person, nullable | Le fournisseur invité par un client, tant qu'il n'a pas accepté. En v1, réservé aux invitations (`PENDING`) |
| customer_person_id | FK → Person, nullable | Le client, s'il s'agit d'une personne, inscrite ou non |
| customer_organization_id | FK → Organization, nullable | Le client, s'il s'agit d'une organisation |
| customer_phone_number | string, nullable | Numéro saisi, au format E.164, pour un client ajouté hors ligne, en attendant que le serveur retrouve ou crée la personne (voir 9.6). Vidé dès que `customer_person_id` est renseigné : le téléphone ne crée jamais de `Person` |
| customer_label | string, nullable | Nom sous lequel le fournisseur connaît le client (ex : « Maman Ngono » là où le compte indique « Béatrice Ngono », « Restaurant Chez Kamga » pour une entreprise non inscrite), prérempli depuis le contact choisi. Pour un comptoir, son nom (« Comptoir usine »). Affiché s'il est renseigné, sinon le nom public. **Visible du seul fournisseur** |
| supplier_label | string, nullable | Nom sous lequel le client connaît le fournisseur. Indispensable pour un fournisseur invité, qui n'a pas encore de nom. **Visible du seul client** |
| delivery_address | string, nullable | Adresse de livraison par défaut, recopiée dans la commande (voir 4.1) |
| credit_limit | bigint, nullable | Plafond du solde. **0 à la création**, relevé uniquement par un `OWNER`, ou par un `MANAGER` en ligne (voir plus bas) ; vide = sans plafond. Toujours 0 pour un comptoir |
| credit_limit_set_by_id | FK → Person, nullable | Qui a fixé le plafond actuel. Accorder du crédit est la décision la plus risquée de l'application : le propriétaire voit toujours qui l'a prise |
| credit_limit_set_at | datetime, nullable | Quand. Renseigné avec `credit_limit_set_by_id`, à l'heure du serveur. L'historique complet est gardé par le journal des plafonds (voir 2.4) |
| balance | bigint | Solde : ce que le client doit au fournisseur, négatif en cas d'avance. **Cache tenu par le serveur** : chaque écriture y ajoute son effet, et un contrôle de nuit vérifie qu'il égale la somme des effets des écritures de la relation (voir 5.1) |
| status | enum `[PENDING / ACTIVE / ENDED]` | `PENDING` : invitation d'un fournisseur par un client, en attente d'acceptation — seul cas d'attente. `ENDED` : relation close (voir plus bas) |
| ended_by_party | enum `[CUSTOMER / SUPPLIER]`, nullable | Partie qui a clos la relation : seule elle peut la rouvrir (voir plus bas). Renseigné ⟺ `status = ENDED` |
| supplier_notes | text, nullable | Notes du fournisseur sur ce client (anciennement `preferences`). **Visible du seul fournisseur** |
| created_by_id | FK → Person | Personne qui a fait naître la relation : le vendeur qui a ajouté le client, le client qui a commandé pour la première fois ou invité un fournisseur. Alimente « Mon activité » (voir 9.5) |
| created_at | datetime | |
| merged_into_id | FK → CustomerRelationship, nullable | Renseigné quand cette fiche, créée hors ligne en double, a été réunie à une autre fiche du même fournisseur pour le même numéro : elle est alors supprimée, et ne sert plus qu'à rediriger ce qui arriverait encore à son nom (voir 9.6) |

*Contraintes : exactement un fournisseur renseigné ; au plus un client, aucun uniquement pour un comptoir ; au plus une relation vivante par couple (fournisseur, client), les fiches supprimées ou réunies ne comptant pas ; `supplier_organization_id <> customer_organization_id` ; `status = PENDING` ⟺ fournisseur désigné par une `Person` (v1) ; `ended_by_party` renseigné ⟺ `status = ENDED`. `price_tier` et `requested_by_id` ont disparu. Détail en fin de document.*

#### Entrée en relation : le numéro comme seule clé

*Une relation naît **active** pour tout client, particulier ou organisation, avec un plafond à 0 et les prix des articles : rien de ce qu'elle permet n'engage une partie sans son propre geste. Elle naît de trois façons :*
1. *le fournisseur ajoute ou invite un client par son numéro ;*
2. *un client commande pour la première fois chez une organisation trouvée par son numéro ; l'acceptation de cette commande vaut accord du fournisseur (voir 4.1) ;*
3. *un client invite un numéro qui n'est pas celui d'une organisation : la relation attend alors l'acceptation du fournisseur (`PENDING`). C'est le seul cas d'attente.*

*Il n'existe plus de demande ni d'acceptation entre organisations : elle se justifiait en v6 parce qu'une relation entre organisations engageait des prix de gros ; le prix ne dépendant plus du type de client (voir 3.1), cette protection n'a plus d'objet. Ni lien, ni QR, ni lecture du répertoire : pour choisir un contact, l'application ouvre le sélecteur du système, qui ne lui donne accès qu'au contact choisi.*

**Parcours — ajouter un client** (côté fournisseur ; un vendeur peut le faire)
1. Depuis la liste des clients, ou au fil d'une vente, le vendeur tape le numéro du client ou le choisit dans ses contacts. Seul ce contact est lu, et son nom préremplit `customer_label`. L'adresse de livraison est facultative.
2. Si ce client existe déjà chez le fournisseur, l'application ouvre sa fiche au lieu d'en créer une seconde.
3. Si le numéro appartient à un inscrit, son nom public s'affiche : c'est le garde-fou contre une erreur de saisie (voir 1.1).
4. Le vendeur valide. Le serveur retrouve ou crée la `Person` de ce numéro, et la relation naît active, au plafond de 0 et aux prix des articles. Le fournisseur peut vendre immédiatement, que le client s'inscrive ou non. Un client inscrit est notifié, dans l'application, qu'un fournisseur l'a ajouté.

- Sans réseau, tout se fait sur le téléphone : la fiche porte le numéro saisi (`customer_phone_number`), et le serveur retrouve ou crée la personne à la synchronisation ; son nom public n'apparaît qu'alors. Si deux téléphones ont ajouté le même client sans réseau, le serveur réunit les deux fiches dès leur arrivée : « Mme Ngono ajoutée deux fois : fiches réunies » (voir 9.6).
- Seul l'ajout d'un client se fait hors ligne. Inviter un collaborateur ou un fournisseur demande le réseau, tout comme l'envoi de l'invitation.
- Pour une entreprise non inscrite, le fournisseur saisit le numéro de son responsable (voir « Organisation cliente »).

**Parcours — inviter un client** (facultatif)
1. Juste après l'ajout, ou plus tard depuis la fiche du client, « Inviter » ouvre WhatsApp ou les SMS sur la conversation du client, avec un message prêt et le lien de téléchargement de l'application, par exemple : « Boutique Fotso vous invite à suivre vos achats et votre solde sur [l'application] ». Le vendeur n'a qu'à envoyer, depuis son propre téléphone : c'est gratuit pour la plateforme, et plus crédible, le client reconnaissant son commerçant.
2. Le bouton n'apparaît pas pour un client déjà inscrit. Le fournisseur voit lesquels de ses clients utilisent l'application, ce que leur nom public révèle déjà.
3. C'est la seule invitation : en v1, la plateforme n'envoie aucun SMS aux clients (voir 8.1). Un client qui installe l'application y reçoit gratuitement, en notification, tout ce qui touche à son compte.

**Ce que voit le client**
- Déjà inscrit, il trouve le nouveau fournisseur dans sa liste, avec une notification, et peut mettre fin à la relation s'il n'en veut pas.
- S'il s'inscrit plus tard avec ce numéro, il retrouve ses fournisseurs, ses achats et son solde, accepte ou conteste chaque relation (voir 1.1 et 2.3), puis peut commander. S'il gère une organisation, celle-ci devient cliente à part, en commandant en son nom ; sa relation personnelle reste la sienne (voir plus bas).

**Parcours — ajouter un fournisseur** (côté client inscrit ; au nom d'une organisation, un `MANAGER` ou le `OWNER`)
1. Le client tape un numéro ou le choisit dans ses contacts.
2. Si ce numéro est un numéro public d'organisation (voir 1.3), il la voit — plusieurs, si la personne en représente plusieurs —, ouvre son catalogue et commande. Sa première commande crée la relation.
3. Sinon, l'application lui propose d'inviter ce numéro comme fournisseur. Un numéro qui n'est pas celui d'une organisation mène toujours à l'invitation, qu'il appartienne ou non à un inscrit : on ne peut rien apprendre sur les particuliers.

*Découverte et invitation ne font qu'un geste, miroir de « Ajouter un client ». Il suffit : la plupart des clients n'ont rien à découvrir, leurs fournisseurs les ayant déjà ajoutés ou invités ; la découverte ne sert qu'au client qui va vers un fournisseur qui ne l'a pas encore ajouté, et dont il connaît le numéro.*

#### Invitation d'un fournisseur par un client

*Tout client inscrit, particulier ou organisation, peut inviter un fournisseur par son numéro, en ligne. Le système retrouve ou crée la `Person` de ce numéro et crée une relation `PENDING` dont le fournisseur est cette `Person`, avec le nom saisi dans `supplier_label`. Le client envoie l'invitation depuis son propre téléphone (message prêt et lien de téléchargement), comme pour un client. L'invitation étant enregistrée sur le serveur, elle attend le fournisseur même s'il installe l'application sans passer par le lien.*

*Acceptation : quand le fournisseur s'inscrit, ou depuis l'application s'il l'est déjà, il retrouve toutes les invitations reçues et les accepte d'un geste, au nom d'une organisation qu'il gère (« 4 de vos clients vous attendent ») : `supplier_person_id` cède la place à `supplier_organization_id` et la relation passe `ACTIVE`. Une invitation ne portant rien en v1, cette reprise n'est pas journalisée. Si le numéro invité est celui d'un vendeur plutôt que du patron, il ne peut accepter qu'au nom d'une organisation qu'il gère ; le client invitera le bon numéro, ou la boutique l'ajoutera elle-même.*

*Une invitation refusée, annulée par le client, contestée, ou visant un numéro libéré est simplement supprimée ; si la relation existe déjà au moment d'accepter, l'invitation disparaît. En v1, aucune commande ni écriture n'est possible tant que le fournisseur est une `Person`. La limitation de débit sur les invitations (voir 1.1) prévient les abus.*

#### Organisation cliente

*Une organisation devient cliente en commandant ou en invitant un fournisseur en son nom (par un `MANAGER` ou le `OWNER`). Elle a sa propre relation : celle que le fournisseur avait ouverte au numéro de son patron reste celle du patron, avec son historique et son solde, et il peut continuer d'y acheter à titre personnel. Une dette ne change donc jamais de débiteur. Le fournisseur voit deux fiches, « M. Kamga » et « Kamga Services » : il peut renommer la première, ou la clore une fois soldée.*

*Le rattachement a disparu (v10). Il permettait de déplacer une relation personnelle vers l'organisation de la personne, historique compris, à condition qu'elle ne doive rien : sans cette règle, M. Kamga, qui doit 200 000, aurait pu créer « Kamga Services » en une minute, y rattacher sa dette, puis abandonner l'entreprise. Mais une vente faite hors ligne avant le rattachement et arrivée après pouvait encore transférer une dette sur une entreprise vide. Sans rattachement, le problème disparaît, avec un geste et une règle en moins.*

*Entreprise non inscrite : elle s'enregistre comme un particulier, par un numéro, avec son nom dans `customer_label`. Dans le modèle, « entreprise » ne désigne qu'une organisation inscrite.*

*Une entreprise cliente n'est pas forcément revendeuse : un restaurant ou un bureau est un client comme un autre. Si elle revend, elle le fait avec ses propres articles (voir 3.1).*

#### Comptoirs

*Chaque organisation reçoit à sa création un premier comptoir « Client de passage » : une relation sans client, au plafond fixé à 0, qui porte les ventes anonymes, payées sur-le-champ, sans cas particulier dans `Order`. Elle peut en créer d'autres, nommés dans `customer_label` (« Comptoir usine », « Dépôt Bafoussam »), chacun avec ses prix négociés (voir 2.2) : un vendeur qui vend lui-même en plusieurs lieux y applique des prix différents, et les ventes au comptoir se lisent par lieu.*

#### Plafond de crédit : une seule règle

*Partout où la marchandise est livrée — comptoir, boutique, livraison —, la part non payée ne peut pas porter le solde au-delà de `credit_limit`. La règle s'applique dans la fenêtre « Commande livrée » (voir 4.1), et reste invisible tant qu'elle ne bloque pas.*
- *La fenêtre ne montre que le montant perçu, prérempli avec le total : le vendeur valide, sans voir ni plafond, ni solde, ni minimum.*
- *S'il encaisse moins et que le client a du crédit disponible, la vente passe, avec une seule ligne de confirmation : « 10 000 mis sur le compte de Mme Ngono ».*
- *Si le crédit ne suffit pas, un seul message : « Crédit insuffisant : encaissez au moins 20 000 ». Un `OWNER` voit en plus un bouton « Accorder le crédit », qui relève le plafond, depuis la vente ou à distance ; un `MANAGER` le voit aussi, mais seulement en ligne, car ce pouvoir de gérant est vérifié par le serveur au moment même (voir 10.1). Le vendeur, lui, encaisse ou appelle son gérant ; le livreur peut en plus déclarer la livraison ratée. Un vendeur ou un livreur n'accorde jamais de crédit.*
- *Chaque plafond porte son auteur et sa date (`credit_limit_set_by_id`, `credit_limit_set_at`). Quand un gérant relève un plafond, le propriétaire en est notifié : « Jean a relevé le plafond de Mme Ngono à 500 000 ». Chaque changement, hausse ou baisse, s'inscrit aussi au journal des plafonds (voir 2.4).*
- *Hors ligne, c'est le téléphone qui vérifie, avec le solde qu'il connaît. À la synchronisation, le serveur n'annule jamais une livraison qui a eu lieu : si le plafond se révèle dépassé, parce qu'un autre téléphone n'était pas à jour, l'écart est signalé au propriétaire parmi les écarts regroupés (voir 9.2).*
- *Après 3 jours sans synchronisation, le téléphone d'un collaborateur ne permet plus aucun crédit : ventes et livraisons doivent être payées en entier (mode restreint, voir 9.3).*
- *Réclamer un arriéré revient simplement à encaisser plus que le montant de la commande. La consigne de livraison de la v6 (`Delivery.amount_to_collect`) a disparu.*

*Exemple : plafond de 50 000, solde actuel de 40 000, commande de 30 000 — il faut encaisser au moins 20 000.*

*Le crédit s'accorde, il ne se présume pas : ni un inconnu qui commande, ni un employé qui ajoute un client ne peuvent ouvrir un crédit.*

#### Fin de relation

*Chaque partie peut mettre fin à la relation (`ENDED`) : le fournisseur bloque un client, le client — particulier compris — quitte un fournisseur. L'historique et le solde restent, les paiements restent possibles, mais aucune nouvelle commande ne l'est. Le client conserve son catalogue, qui lui appartient. Seule la partie qui l'a close peut la rouvrir (`ended_by_party`) : l'autre voit « Relation close par Boutique Fotso » et ne peut ni commander, ni vendre. Sans cette règle, un client bloqué rouvrirait la relation en commandant, et un fournisseur quitté la rouvrirait en ressaisissant le numéro. Il n'existe qu'une ligne par couple.*

#### Chaînes de revente

*Si C achète à B ce que B achète à A, les relations A → B et B → C sont indépendantes. A n'a pas à connaître C, et la fin de A → B n'affecte pas B → C. Les articles de B lui appartiennent : rien ne les relie à ceux de A.*

#### Cloisonnement

*Une organisation voit une relation, et tout ce qui s'y rattache (commandes, livraisons, écritures, prix négociés), **si et seulement si elle en est le fournisseur ou le client**. Un particulier inscrit voit les relations où il est `customer_person_id`, et les invitations où il est `supplier_person_id`. Ce prédicat unique est appliqué par la couche d'accès d'Express, avant le premier endpoint, et à chaque ligne reçue par la synchronisation (voir 9.2 et 10.1) ; des vues PostgreSQL pourront le renforcer en v2. La ligne est partagée, mais pas tous ses champs : l'API ne transmet ni `customer_label` ni `supplier_notes` au client, ni `supplier_label` au fournisseur ; et chaque partie ne peut écrire que ses propres champs (voir 9.2).*

#### Évolution prévue (v2) : suivre ce qui est dû à un fournisseur non inscrit

*Il suffira de lever la contrainte qui réserve `supplier_person_id` aux relations `PENDING`. Un achat auprès d'un tel fournisseur sera une commande saisie par le client et livrée d'emblée, dont les lignes portent sur ses propres articles, faute de catalogue fournisseur — seule exception prévue à la règle des lignes (voir 4.1). La protection s'inversera : c'est le client qui saisit, donc le fournisseur devra être prévenu de chaque achat et de chaque paiement enregistrés à son nom. Étendu aux particuliers, ce suivi leur donnerait un carnet de dettes personnel. À l'inscription du fournisseur, la relation sera reprise comme en v1, historique compris. S'il s'inscrit sous un autre numéro et ajoute lui-même ce client, le client se verra demander s'il s'agit du même fournisseur, et la relation existante sera reprise au lieu d'en créer une seconde.*

### 2.2 `CustomerPrice`
Prix **négocié** avec un client pour un article précis. Remplace, pour ce client, le prix de l'article.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_relationship_id | FK → CustomerRelationship | Un client, particulier ou organisation, ou un comptoir |
| product_id | FK → Product | Article du fournisseur |
| price | bigint | En francs CFA |
| set_by_id | FK → Person | `OWNER`, ou `MANAGER` en ligne (voir 10.1) |
| set_at | datetime | Heure du serveur. Sert aussi à reconnaître une vente faite hors ligne à l'ancien prix négocié (voir 9.2) |

*Contraintes : unique par (`customer_relationship_id`, `product_id`) parmi les lignes non supprimées ; l'article appartient au fournisseur de la relation. Si un même prix négocié est saisi deux fois, par deux téléphones, le dernier arrivé l'emporte (voir 9.6).*

*Le prix négocié **l'emporte toujours**, qu'il soit plus bas ou plus haut que le prix de l'article. Le prix dépend de l'endroit où l'article est vendu — un prix rendu dans une ville éloignée n'est pas un prix à l'usine —, et le prix négocié avec chaque client en rend compte naturellement. Le transport peut aussi être facturé à part, dans les frais de livraison (voir 4.1).*

*Prix de référence d'une ligne de commande : le prix négocié s'il existe, sinon le prix de l'article. Il est figé sur la ligne (voir 4.2) ; pour une vente saisie hors ligne, c'est le prix que le vendeur avait sous les yeux, et le serveur signale tout écart avec le prix du moment (voir 9.2).*

*Visible du client : un prix négocié est une information partagée, pas un réglage interne. Le client ne voit que ses propres prix négociés. Un client inscrit est notifié dans l'application de chaque modification ; aucun SMS n'est envoyé, et un client sans application découvre le nouveau prix à son prochain achat (voir 8.1).*

*Trois gestes rendent les prix négociés faciles à tenir :*
- *quand un `OWNER` ou un `MANAGER` accorde un prix différent pendant une vente, l'application propose de le retenir pour ce client. C'est un choix explicite, jamais une mémoire implicite du dernier prix appliqué, qui transformerait un geste ponctuel en prix habituel ;*
- *copier les prix négociés d'un client vers un autre, par exemple d'une même ville ;*
- *quand le prix d'un article change, l'application signale les prix négociés à revoir. Sinon, ils resteraient à l'ancien niveau et, après une hausse, rogneraient la marge sans qu'on le voie.*

### 2.3 `CustomerRelationshipReassignment`
Journal des changements de client d'une relation. Deux cas, tous deux du côté client :
- **correction** d'un numéro saisi par erreur : le fournisseur repointe la relation vers la bonne personne ;
- **contestation** : la personne qui détient le numéro déclare « Ce n'est pas moi », et la relation passe à une personne fantôme ;

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_relationship_id | FK → CustomerRelationship | |
| previous_person_id | FK → Person | Le client d'avant, toujours une personne |
| new_person_id | FK → Person | Le bon client (correction) ou une personne fantôme (contestation) |
| reassigned_by_id | FK → Person | `OWNER` ou `MANAGER` du fournisseur pour une correction ; le détenteur du numéro pour une contestation |
| reason | text, nullable | Libellé libre |
| reassigned_at | datetime | |

*Journal immuable : on ne fait qu'y ajouter des lignes, et la base elle-même refuse toute modification (voir 10.6).*

*Contraintes : `new_person_id` renseigné ; interdit de réaffecter vers une personne qui a déjà une relation avec le même fournisseur — ce serait une fusion de deux historiques, que le modèle ne pratique jamais ; une seule contestation par relation et par personne (voir plus bas). `party`, `previous_organization_id` et, avec le rattachement, `new_organization_id` ont disparu : la partie réaffectée est toujours le client, et le client, d'avant comme d'après, toujours une personne. La reprise d'une invitation de fournisseur n'est pas journalisée, puisqu'une invitation ne porte rien en v1.*

*L'historique suit la relation : commandes, livraisons, écritures et solde pointent vers elle, si bien qu'une réaffectation ne modifie qu'une ligne, sans aucune réécriture de clé étrangère ailleurs. Une organisation ne modifie jamais `Person.phone_number` : elle repointe la relation. Le journal est obligatoire, car les sommes dues peuvent changer de débiteur.*

#### « Ce n'est pas moi » : erreurs de saisie et numéros recyclés

*Avec des clients ajoutés par numéro, deux situations sont fréquentes : l'erreur de saisie, et le numéro recyclé par l'opérateur, dont le nouveau titulaire hérite des relations de l'ancien. Si l'ancien titulaire était inscrit, le nouveau suit le parcours « numéro recyclé » (voir 1.1).*
- *À l'inscription, la personne voit tout ce qui est attaché à son numéro et accepte ou conteste chaque ligne (voir 1.1). Plus tard, elle peut aussi contester une nouvelle relation qui apparaît.*
- *Une relation contestée passe à une personne « fantôme », créée pour l'occasion, qui garde ce numéro comme numéro libéré : introuvable, elle ne reçoit rien. Le titulaire ne voit plus la relation, et le fournisseur est averti qu'un numéro est à corriger.*
- *Une seule contestation par relation. Si le fournisseur, sûr de son client, ramène la relation sur le même numéro, il le confirme (« C'est bien ce client »), avec un motif inscrit au journal. La relation revient, marquée « contestée » pour les deux parties — une marque lue dans le journal, sans champ. Le client ne peut plus la contester : il peut seulement y mettre fin ou signaler le commerce. Sans cette règle, contestation et correction tourneraient en boucle, et un client endetté ferait disparaître sa dette de son écran d'un geste. Limite : si le fournisseur insiste à tort, la dette reste affichée chez un innocent, marquée « contestée ».*
- *Une invitation contestée, d'équipe ou de fournisseur, est simplement refusée.*
- *Sans application, celui dont le numéro a été saisi par erreur ne reçoit rien : la plateforme n'envoie aucun SMS aux clients en v1. L'erreur se découvre quand le commerçant appelle ce numéro pour réclamer son dû ; il corrige alors le numéro. S'il installe l'application, le détenteur du numéro peut aussi contester lui-même.*

*Ce mécanisme remplace le refus global de la v6, qui obligeait le nouvel inscrit à tout accepter ou tout refuser : s'il reconnaissait deux fournisseurs sur trois, il ne pouvait pas écarter le troisième, et s'il acceptait, la dette d'un inconnu apparaissait à son nom.*

#### Correction par le fournisseur

*Un `OWNER`, ou un `MANAGER` en ligne, repointe la relation vers le bon numéro ; l'historique et le solde suivent. Ramener une relation contestée sur le même numéro demande la confirmation « C'est bien ce client » (voir plus haut). Si ce client a déjà une relation chez lui, la fusion reste interdite : l'ancienne relation est close et ne sert plus qu'à solder.*

### 2.4 `CreditLimitChange`
Journal des plafonds : une ligne à chaque changement de `CustomerRelationship.credit_limit`, hausse ou baisse, quel qu'en soit l'auteur. Accorder du crédit est la décision la plus risquée de l'application : son historique ne peut pas dépendre de notifications, qui changent d'état et s'effacent après 24 mois.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_relationship_id | FK → CustomerRelationship | |
| previous_limit | bigint, nullable | Plafond d'avant ; vide = sans plafond |
| new_limit | bigint, nullable | Nouveau plafond ; vide = sans plafond |
| set_by_id | FK → Person | `OWNER`, ou `MANAGER` en ligne |
| set_at | datetime | Heure du serveur |

*Journal immuable, conservé 10 ans comme les autres données commerciales (voir 11.2) : la base elle-même refuse toute modification (voir 10.6). La ligne s'écrit dans la même transaction que le changement de plafond. La fiche du client garde le plafond actuel, avec son auteur et sa date (`credit_limit_set_by_id`, `credit_limit_set_at`), et affiche l'historique si on l'ouvre. Le propriétaire reste prévenu quand un gérant relève un plafond (voir 2.1).*

---

## 3. Catalogue

### 3.1 `Product`
**Article** vendu par une organisation : c'est l'unique niveau du catalogue, sans gamme ni variante. Chaque organisation possède ses propres articles et ne vend que ceux-là. Deux conditionnements d'une même marchandise sont deux articles, chacun avec son unité et son prix : « Riz parfumé — sac 25 kg » et « Riz parfumé — sac 50 kg ».

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | L'organisation qui vend l'article, seule à pouvoir le modifier (par son `OWNER`, ou un `MANAGER` en ligne) |
| name | string | Nom présenté aux clients |
| unit | string | Unité de vente, dans laquelle s'expriment les quantités (3 décimales au plus), ex : « sac 25 kg », « kg », « carton de 24 », « pièce » |
| price | bigint | **Prix de l'article**, en francs CFA, valable par défaut pour tous les clients, particuliers comme organisations. Chacun y met le prix qu'il pratique par défaut : son prix de détail pour une boutique, son prix de gros pour un grossiste |
| price_updated_at | datetime | Date du dernier changement de prix, à l'heure du serveur. Permet de reconnaître une vente faite hors ligne à l'ancien prix, sans l'accuser d'être une remise (voir 9.2) |
| min_order_quantity | decimal (3 décimales), nullable | Quantité minimale par commande, fixée par le fournisseur (voir plus bas) |
| description | text, nullable | Facultative |
| category | string, nullable | Famille, en texte libre facultatif (ex : « Boissons »), pour regrouper l'affichage du catalogue |
| status | enum `[ACTIVE / INACTIVE]` | `INACTIVE` = retiré de la vente : ne peut plus être commandé. Les commandes passées restent intactes, leurs lignes figeant libellé et prix (voir 4.2) |
| created_at | datetime | |

*Un seul prix par article, et plus de palier : le prix ne dépend pas du type de client, il se négocie avec chacun (voir 2.2). Le gros et le détail sont d'ailleurs souvent deux articles, le sac et le kilo.*

*Catalogue et prix sont des pouvoirs de gérant : un `MANAGER` ne les modifie qu'en ligne ; le propriétaire, lui, peut le faire hors ligne (voir 10.1).*

*Le prix de l'article est une **valeur de référence**, jamais une obligation : `OrderLine.unit_price_applied` peut s'en écarter dans les conditions de 4.2, l'écart restant toujours visible. Un achat en quantité se traite à la main : écart ponctuel quand le fournisseur saisit la vente, baisse de prix quand il accepte la commande d'un client.*

*Quantité minimale : elle s'impose aux commandes passées par les clients — l'application empêche de commander moins, et le serveur le vérifie à l'envoi — et figure dans le catalogue. Le fournisseur, qui la fixe, reste libre quand il saisit lui-même une vente, et une livraison partielle peut descendre en dessous.*

*Ce que voit un client : du catalogue d'un fournisseur, il ne reçoit que ses propres prix — son prix négocié s'il existe, sinon le prix de l'article — et les quantités minimales, jamais les prix négociés des autres. Quiconque trouve une organisation par son numéro voit ses articles et leurs prix, comme s'il entrait dans la boutique.*

*Catalogue propre : rien n'est partagé entre organisations. Un revendeur peut copier dans son catalogue, d'un geste (« Ajouter à mon catalogue »), un article qu'il achète : nom, unité, description et famille sont repris, et il fixe son propre prix. Aucun lien n'est conservé : la copie lui appartient, et il la renomme ou la complète librement — par exemple avec un article « canette » à côté du « pack de 24 » qu'il achète. S'il achète la même marchandise à deux fournisseurs, il n'a qu'un article à vendre : le sien.*

*Le prix appartient au vendeur : dans une chaîne A → B → C, C se voit proposer le prix de **B**, et la marge de B est préservée.*

*Confidentialité de l'approvisionnement : un client ne voit que les articles de son fournisseur, et rien ne relie l'article d'un revendeur à celui de son propre fournisseur. La chaîne d'approvisionnement ne peut pas se lire dans les données.*

*Pas de gestion de stock en v1 : les quantités disponibles ne sont pas suivies, et un article se commande sans vérification de disponibilité. Un manque se découvre à la préparation et se règle par un refus motivé, une remarque d'attente (`supplier_note`) ou une livraison partielle (voir 4.1). Les quantités vendues et achetées restent traçables par article et par période, sur les lignes des commandes livrées (voir 4.2).*

---

## 4. Commandes et livraisons

### 4.1 `Order`
Transaction entre un fournisseur et un client, **rattachée à leur relation** : une vente pour le fournisseur, un achat pour le client. Vente à un particulier et achat entre organisations ne se distinguent pas structurellement.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_relationship_id | FK → CustomerRelationship | Fournisseur et client se lisent sur la relation |
| placed_by_party | enum `[CUSTOMER / SUPPLIER]` | Partie qui a créé la commande : passée par le client, ou saisie par le fournisseur. Détermine qui confirme et quelles règles de prix s'appliquent (voir 4.2). Explicite, car un collaborateur du fournisseur peut aussi être son client |
| entered_by_id | FK → Person | Personne qui a créé la commande |
| delivery_address_applied | string, nullable | **Adresse de livraison figée à la création**, choisie parmi l'adresse par défaut de la relation et celles de ses commandes précédentes, ou saisie. Une commande à livrer a une adresse ; une commande que le client vient chercher, ou une vente au comptoir, n'en a pas (voir 4.3) |
| total_amount | bigint | Somme des montants des lignes (`OrderLine.amount`), plus `delivery_cost` ; recalculée sur les quantités livrées à la livraison, puis figée |
| delivery_cost | bigint | 0 si absorbé. Peut porter le transport, plutôt que de l'inclure dans un prix négocié |
| status | enum `[PENDING / CONFIRMED / IN_DELIVERY / DELIVERED / CANCELLED]` | Voir plus bas |
| delivered_at | datetime, nullable | Moment où la commande a été livrée (« Commande livrée »). Sert de date de vente dans les rapports |
| delivered_by_id | FK → Person, nullable | Qui a livré : vendeur au comptoir ou en boutique, propriétaire, livreur. Renseigné même sans paiement |
| created_at | datetime | |
| desired_delivery_date | date, nullable | Date de livraison souhaitée par le client. Une préférence d'heure va dans `customer_note` |
| cancelled_by_party | enum `[CUSTOMER / SUPPLIER]`, nullable | Partie qui a annulé ou refusé |
| cancelled_by_id | FK → Person, nullable | Personne qui a annulé ou refusé |
| cancelled_at | datetime, nullable | Moment de l'annulation ou du refus |
| cancellation_reason | string, nullable | Motif du refus ou de l'annulation ; obligatoire quand c'est le fournisseur qui refuse ou annule |
| parent_order_id | FK → Order, nullable | Commande d'origine, quand celle-ci en est le reste (voir plus bas) |
| customer_note | string, nullable | Note du client : souhait particulier, heure préférée, prix demandé |
| supplier_note | string, nullable | Remarque du fournisseur, modifiable pendant toute la vie de la commande, même livrée, ex : « en attente du réapprovisionnement » |
| sync_issue | string, nullable | Problème détecté par le serveur à la synchronisation, avec son message (voir 9.2). Vide quand tout va bien |

*Statuts : cinq valeurs. `PENDING` ne désigne qu'une commande passée par le client qui attend la réponse du fournisseur. L'attente de réapprovisionnement n'est pas un statut : la commande garde le sien, et la remarque va dans `supplier_note`. Une tentative de livraison ratée n'en est pas un non plus : la commande revient en `CONFIRMED`, prête à repartir (voir 4.3). Une livraison partielle clôt la commande en `DELIVERED` pour ce qui a été livré ; le reste peut devenir une nouvelle commande (voir plus bas).*

*Étapes permises : en attente → confirmée → en livraison → livrée ; une commande confirmée peut aussi être livrée directement, au comptoir ou en boutique ; une annulation n'est possible qu'avant le départ ; une livraison ratée ramène la commande à « confirmée ». Le statut ne se fusionne jamais champ par champ : le serveur n'applique un changement que s'il est permis depuis l'état actuel, et la livraison l'emporte toujours, même sur une annulation, puisque la marchandise est partie (voir 9.2 et l'annexe).*

**Commande passée par le client**
1. *Le client la prépare, même hors ligne, puis l'envoie en ligne. Le serveur recalcule les prix ; si un prix a changé entre-temps, le client voit le nouveau total avant de valider. La quantité minimale de chaque article est vérifiée à l'envoi (voir 3.1).*
2. *La commande arrive en `PENDING` et ne se modifie plus. Le fournisseur l'accepte (`CONFIRMED`), en baissant au besoin un prix — c'est là que se conclut une négociation —, ou la refuse avec un motif : c'est ainsi qu'il écarte une commande suspecte. L'acceptation fige les prix.*
3. *Pour changer sa commande, le client annule et recommande d'un geste, que l'application présente comme « Modifier ».*
4. *Le client ne saisit jamais de prix, mais peut en demander un dans sa note.*
5. *Au nom d'une organisation, seuls un `MANAGER` ou le `OWNER` commandent, puisque cela engage sa dette.*
6. *La première commande d'un client chez une organisation trouvée par son numéro crée la relation ; son acceptation vaut accord du fournisseur (voir 2.1).*

**Commande saisie par le fournisseur** — *elle n'attend personne : elle naît `CONFIRMED` et reste modifiable par lui jusqu'à son départ en livraison ou sa livraison. Un écart de prix accordé reste visible, avec son auteur (voir 4.2). Une commande livrée est figée : seule la note du fournisseur reste modifiable.*

#### Clore une commande : « Commande livrée »

*Une seule façon de clore une commande, quel que soit l'endroit et la personne : le bouton « Commande livrée », au comptoir, en boutique ou chez le client, par un vendeur, le propriétaire ou un livreur. Le libellé dit clairement que c'est la commande qui est livrée, et non de l'argent qui est remis — « remise » désigne déjà la remise d'argent au propriétaire (voir 5.3), et une réduction de prix dans le commerce ; il reprend aussi le statut final de la commande. Au comptoir, où la commande est créée et livrée d'un seul geste, le dernier bouton dit simplement « Valider la vente ».*

*Le bouton ouvre une seule fenêtre, « Commande livrée à Mme Ngono » ; aucune autre fenêtre ne s'ouvre par-dessus. Elle contient :*
- **Montant perçu**, prérempli avec le total ;
- **Espèces** ou **Mobile Money**, espèces par défaut ;
- un lien **Modifier les quantités**, replié par défaut, pour une livraison partielle : si une quantité baisse, la question « Et le reste ? » apparaît dans la même fenêtre ;
- **Valider**.

*Dans le cas courant — tout est livré et payé en espèces —, deux touches suffisent : « Commande livrée », puis « Valider ». Le reste n'apparaît que s'il sert : les messages du plafond (« 10 000 mis sur le compte de Mme Ngono », ou « Crédit insuffisant : encaissez au moins 20 000 », avec « Accorder le crédit » pour un propriétaire ou un gérant, voir 2.1), et, pour un livreur, « Livraison ratée » (voir 4.3).*

*Pourquoi une confirmation plutôt qu'un bouton seul : une touche unique enregistrerait un paiement complet que le client n'a peut-être pas fait. Le client paraîtrait réglé, et le livreur détiendrait de l'argent qu'il n'a jamais reçu.*

*Effet : la commande passe `DELIVERED`, avec `delivered_at`, `delivered_by_id` et les quantités livrées (`OrderLine.delivered_quantity`) ; aucun mouvement de marchandise n'est enregistré. Deux écritures naissent dans le compte, dans le même geste (voir 5.1) : la vente (`SALE`, du montant de la commande, fixé par le serveur : voir plus bas) et, si le montant perçu n'est pas nul, le paiement (`PAYMENT`), l'une et l'autre avec `order_id` renseigné. Le paiement est enregistré au nom de celui qui l'a reçu, qui détient alors l'argent, en espèces ou en Mobile Money sur son propre numéro (voir 5.3). Un montant perçu de 0 ne crée que la vente : c'est le cas d'un client à crédit, dont la commande est bien livrée.*

*Montant de la vente : c'est le serveur qui le fixe. À réception, il reprend le total de la commande (`Order.total_amount`), qu'il calcule lui-même sur les quantités livrées, et ignore le montant envoyé par le téléphone. Sans cela, rien n'obligerait la vente à égaler la commande : un téléphone trafiqué déclarerait une vente de 3 000 pour une commande de 30 000, et l'argent encaissé en trop disparaîtrait sans que le solde du client, resté juste, alerte personne ; une simple différence d'arrondi entre deux versions de l'application créerait aussi une dette fictive. Une écriture ne se modifiant jamais, mieux vaut qu'elle naisse juste. Le téléphone affiche entre-temps son propre calcul, fait par la même fonction partagée.*

*Ce que la commande affiche ensuite : un fait qui ne change jamais, « Perçu à la livraison : 24 000 sur 30 000 ». Ce qui reste dû se lit sur le solde du client, comme dans un cahier de crédit. Il n'y a pas de statut « payée / impayée » calculé : il exigerait tout l'historique, alors que le téléphone n'en garde que 90 jours, et serait faux justement pour les clients endettés depuis longtemps.*

*Mode restreint : après 3 jours sans synchronisation, le téléphone d'un collaborateur ne permet plus que de livrer les commandes déjà parties avec lui, payées en entier, et d'encaisser (voir 9.3).*

*Exemple : Paul livre Mme Ngono, qui ne prend que 8 sacs de riz sur 10. Il touche « Commande livrée », ouvre « Modifier les quantités », met 8, choisit « À livrer plus tard » pour le reste, laisse le montant perçu à 24 000 en espèces et valide.*

#### Le reste d'une livraison partielle

- *« **À livrer plus tard** » crée aussitôt la commande du reste, liée à la première (`parent_order_id`), confirmée d'office et aux prix de la commande d'origine : le client n'a rien à revalider, et ne peut pas payer plus cher.*
- *« **Abandonner le reste** » clôt la commande sur ce qui a été livré. Fait par un autre que le propriétaire, il rejoint les écarts du propriétaire, avec les quantités et leur valeur : « Paul : 2 sacs de riz non livrés, reste abandonné (6 000) ». Sans gestion de stock, c'est le seul moyen de vérifier que la marchandise est revenue (voir 9.2).*

#### Refus et annulation

- *Le **refus** ne concerne qu'une commande passée par le client dans l'application, que le fournisseur n'a pas encore acceptée : il dit non au lieu de dire oui. Exemple : Mme Ngono commande 10 sacs de riz, M. Fotso n'en a plus et refuse, avec le motif « rupture de stock ».*
- *L'**annulation** abandonne une commande existante avant qu'elle parte : par le client, à tout moment avant le départ (« Modifier » en est une) ; par le fournisseur, après l'avoir acceptée ou saisie, quand il s'aperçoit qu'il ne pourra pas livrer.*
- *Les deux aboutissent à `CANCELLED`. `cancelled_by_party` et `cancelled_by_id` disent qui, `cancelled_at` quand, `cancellation_reason` pourquoi — obligatoire quand c'est le fournisseur.*
- *`supplier_note` reste une remarque distincte : les deux coexistent sans s'écraser. Exemple : M. Fotso accepte la commande de Mme Ngono et note « en attente du réapprovisionnement, prévu lundi » ; lundi, il annule avec le motif « article plus disponible chez notre fournisseur ». Les deux restent visibles.*
- *Le client annule sans frais tant que la commande n'est pas partie ; les frais d'annulation sont reportés en v2.*

#### Autres règles

*Règle des lignes, unique quel que soit le client : chaque ligne porte sur un article `ACTIVE` du fournisseur. Aucune commande sur une relation `PENDING` ou `ENDED`, ni chez un commerce suspendu ou fermé.*

*Comptoirs : une vente au comptoir est une commande sur un comptoir (voir 2.1), créée et livrée dans le même geste (« Valider la vente »), payée intégralement, le comptoir n'admettant aucun crédit.*

*Plafond : la règle unique de 2.1 s'applique à toute livraison — comptoir, boutique, livraison par un livreur.*

*Date souhaitée : un **souhait, jamais un engagement**. Aucune confirmation ni refus, aucun calcul de retard, aucune alerte. Les bornes horaires de la v6 ont disparu ; une préférence d'heure (« après 14 h ») va dans la note du client.*

*Transparence : le client voit, pour chaque commande, si elle a été passée par lui ou saisie par le fournisseur, et chaque écart entre prix de référence et prix appliqué (voir 4.2).*

#### Le reçu

*Le reçu n'est pas stocké : c'est un affichage de la commande, généré par le téléphone à la demande, même hors ligne, puisqu'une commande livrée ne change plus. Il montre le commerçant, le client, la date, les articles et leurs quantités, les prix avec leurs écarts, le total, le montant perçu et la dette du client après cette commande (le solde actuel, moins l'effet des écritures postérieures). Un client inscrit le voit dans l'application ; pour un client sans application, le commerçant le partage depuis son téléphone, par WhatsApp ou SMS, sous forme d'image, sans coût pour la plateforme. Après une livraison à crédit, l'application propose de l'envoyer : c'est, pour un client sans application, la trace de ce qu'il a reçu et payé. `Receipt` a disparu : on ne perd que la trace de qui a produit un reçu et quand, sans intérêt pour un document qu'on peut refaire à l'identique. Une facture, avec numéro et mentions légales, pourra venir en v2.*

### 4.2 `OrderLine`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| product_id | FK → Product | Article du fournisseur |
| label_applied | string | Nom et unité de l'article au moment de la commande, figés : l'historique reste exact si le fournisseur renomme ou retire l'article |
| quantity | decimal (3 décimales) | Quantité commandée, dans l'unité de l'article |
| delivered_quantity | decimal (3 décimales), nullable | Quantité effectivement livrée, **toujours renseignée** au passage en `DELIVERED` (par défaut égale à `quantity`) ; vide avant |
| reference_price | bigint | **Prix de référence, figé** : prix négocié s'il existe, sinon prix de l'article (voir 2.2). Sur une commande passée par le client, calculé par le serveur à l'envoi. Sur une vente saisie hors ligne, c'est le prix que le vendeur avait sous les yeux ; le serveur le compare au prix du moment et signale tout écart (voir plus bas) |
| unit_price_applied | bigint | **Prix réellement appliqué**, figé quand la commande cesse d'être modifiable (voir 4.1) |
| amount | bigint | **Montant de la ligne**, en francs : quantité (livrée, une fois la commande livrée) × prix appliqué, arrondi au franc le plus proche, 0,5 vers le haut. Calculé une seule fois, par une fonction partagée entre l'application et le serveur, puis figé |
| price_set_by_id | FK → Person, nullable | Qui a accordé l'écart : renseigné quand le prix appliqué diffère du prix de référence |
| price_set_at | datetime, nullable | Quand l'écart a été accordé ; renseigné avec `price_set_by_id`. Date l'écart dans « Mon activité » (voir 9.5) |

*Montant et arrondi : 2,5 kg à 333 F font 832,5 F. Si le téléphone et le serveur arrondissaient différemment, un franc d'écart créerait une dette fictive. D'où une seule fonction d'arrondi, écrite en TypeScript et partagée par l'application et le serveur, qui calcule en nombres entiers (quantité en millièmes × prix, puis division arrondie), sans jamais passer par un nombre à virgule flottante. Le montant est ensuite figé sur la ligne : l'historique ne change pas si la règle d'arrondi évolue un jour.*

*Règles de prix : on ne peut pas interdire à un fournisseur de fixer ses prix — c'est son droit —, mais on l'empêche de changer un prix à l'insu du client ou après son accord, et tout écart reste visible.*

- *Le client ne saisit jamais de prix. Sur une commande passée par le client, `unit_price_applied` est égal au prix de référence calculé par le serveur à l'envoi. L'envoi se faisant en ligne, un prix changé entre-temps est présenté au client avant qu'il valide.*
- *Sur une commande passée par le client, le fournisseur peut baisser un prix en l'acceptant, jamais l'augmenter. Pour vendre plus cher, il corrige son prix et refuse la commande avec un motif ; le client recommande en un geste.*
- *Sur une commande qu'il saisit lui-même, le fournisseur fixe `unit_price_applied`. Un collaborateur peut consentir un écart ponctuel, car le marchandage fait partie du métier, mais l'écart avec `reference_price` reste visible : du client sur la commande et le reçu ; du propriétaire, qui voit qui l'a accordé et quand (`price_set_by_id`, `price_set_at`), et le retrouve dans ses écarts, regroupé par personne (voir 9.2).*
- *Les prix se figent quand la commande cesse d'être modifiable : à l'acceptation pour une commande passée par le client, au départ ou à la livraison pour une commande saisie par le fournisseur. Après, une correction ne passe plus que par un avoir (voir 5.1).*

*Prix changé pendant qu'un vendeur est hors ligne : lundi à 8 h, Jean passe le sac de riz de 3 000 à 3 200 ; un vendeur hors ligne depuis dimanche vend encore à 3 000, le seul prix qu'il connaît. Le serveur garde le prix que le vendeur avait sous les yeux comme prix de référence, et ne compte pas la vente comme une remise accordée par lui. Il la signale au propriétaire avec la date du changement : « vendu 3 000 ; prix passé à 3 200 lundi à 8 h » (`Product.price_updated_at`, ou `CustomerPrice.set_at` pour un prix négocié). Un téléphone trafiqué pour masquer une remise serait signalé de la même façon, et la date ancienne le trahirait. Les écarts sont regroupés par cause (voir 9.2).*

*`OrderLineChange` a disparu depuis la v7 : une commande passée par le client ne change plus après l'envoi, sauf une baisse de prix à l'acceptation, et sur une commande saisie par le fournisseur, le client ne voit que le résultat final, avec les écarts visibles. Seul reste utile de savoir qui a accordé un écart, et quand.*

*Toute hausse du solde d'un client inscrit lui est signalée dans l'application. Un client sans application n'est plus prévenu par SMS en v1 (voir 8.1) : il garde le reçu que le commerçant lui envoie, et le propriétaire voit chaque soir les livraisons non soldées de chaque livreur (voir 9.2).*

*Traçabilité des quantités : sans gestion de stock, les quantités vendues par une organisation se lisent sur les lignes des commandes livrées dont elle est le fournisseur — ventes au comptoir comprises —, et ses quantités achetées sur celles dont elle est la cliente, par article et par période (`Order.delivered_at`). Ce sont des lectures, sans table dédiée.*

### 4.3 `Delivery`
Trace le transport de la marchandise par un livreur, une ligne par tentative. **Ne concerne que ceux qui livrent** : une commande livrée au comptoir ou en boutique n'en a aucune, et le marchand sans livreur ne voit jamais rien de tout cela.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| order_id | FK → Order | |
| assigned_to_id | FK → Person | Le livreur : assigné par un gérant, ou qui a pris la commande en partant avec ; un collaborateur actif du fournisseur, livreur ou plus |
| departed_at | datetime, nullable | Départ du livreur avec la marchandise ; fait passer la commande en `IN_DELIVERY` |
| arrived_at | datetime, nullable | Renseigné par « Commande livrée » : la livraison est faite |
| failed_at | datetime, nullable | Tentative ratée : la commande revient en `CONFIRMED` |
| failure_reason | string, nullable | Motif de l'échec (client absent, adresse introuvable, crédit insuffisant…). Chaque tentative garde le sien |
| sync_issue | string, nullable | Problème détecté à la synchronisation, ex : « Livraison déjà prise par Paul » (voir 9.2) |

*Naissance : une livraison ne naît qu'au départ du livreur, ou quand un gérant l'assigne. Les commandes à livrer sont les commandes confirmées qui ont une adresse de livraison ; elles sont visibles de tous les livreurs de l'organisation. Un livreur en prend une en partant avec : prendre et partir sont un seul geste, qui fonctionne hors ligne. Après 3 jours sans synchronisation, un livreur ne peut plus partir avec une nouvelle commande, mais peut toujours livrer celles déjà parties avec lui (mode restreint, voir 9.3).*

*Départs croisés : hors ligne, deux livreurs ne peuvent pas partir avec la même marchandise. Si deux départs se croisent quand même dans les données, le serveur garde le premier, et l'autre livraison porte le signalement « Livraison déjà prise par … » : elle est enregistrée close, ce qui respecte la règle d'une seule livraison en cours par commande. Si c'est elle qui a livré, la livraison l'emporte, et c'est l'autre qui est close (voir 9.2).*

*Rien ne traîne : une livraison assignée mais pas encore partie est supprimée si la commande est annulée ou livrée en boutique.*

*États dérivés, sans champ de statut : assignée ou partie, avec `arrived_at` et `failed_at` vides → en cours ; `arrived_at` renseigné → livrée ; `failed_at` renseigné → tentative ratée. Au plus une livraison en cours par commande.*

*Livrer : le livreur touche « Commande livrée » (voir 4.1). `arrived_at` est renseigné, et le paiement créé porte son nom : il détient cet argent, en espèces ou sur son propre compte Mobile Money, jusqu'à sa remise (voir 5.3). Le montant perçu n'est pas stocké sur la livraison : c'est le paiement lui-même.*

*Échec : « Livraison ratée », avec un motif, renseigne `failed_at` et `failure_reason` ; la commande revient dans les commandes à livrer. Chaque tentative garde ainsi sa trace : qui, quand, pourquoi.*

*Périmètre du livreur (`DRIVER`) : il voit les commandes à livrer et ses livraisons, part avec une commande, touche « Commande livrée » en saisissant le montant perçu, ou signale une livraison ratée. Il ne peut ni rembourser, ni modifier une commande, ni accorder de crédit. Le départ, la livraison et l'échec sont les seuls cas où il modifie l'état d'une commande.*

*Disparus depuis la v6 : la consigne (`amount_to_collect`), le montant encaissé (`amount_collected`), qui doublait l'écriture de paiement, le pool comme notion à part, avec sa prise « atomique » impossible hors ligne, et les coordonnées GPS (reportées en v2).*

---

## 5. Finances

*Vocabulaire : deux notions distinctes, et aucune n'est une « caisse ».*
- *Le **compte**, entre un client et un fournisseur : ce que le client doit (voir 2.1 et 5.1). Il répond à la question « qui doit combien à qui ? ».*
- *L'**argent détenu**, à l'intérieur d'une organisation : qui a en main l'argent encaissé, en espèces ou en Mobile Money reçu sur son propre numéro (voir 5.3). Il répond à la question « qui a l'argent ? », et ne concerne que les organisations où quelqu'un d'autre que le propriétaire encaisse.*

*Exemple : Mme Ngono doit 30 000 à la Boutique Fotso. Paul, le livreur, lui livre sa commande et reçoit 30 000 en espèces. Côté compte, Mme Ngono ne doit plus rien : l'argent est entré dans l'entreprise au moment où elle a payé, Paul encaissant au nom de la Boutique Fotso — sinon Mme Ngono resterait débitrice tant que Paul n'a pas remis l'argent. Côté argent détenu, les 30 000 sont dans la poche de Paul ; quand il les remet, c'est une remise (`Handover`), affaire interne à la Boutique Fotso, que Mme Ngono ne voit jamais.*

*Tous les montants sont des entiers, en francs CFA : le FCFA n'a pas de centimes, et un nombre à virgule, sur le téléphone, produirait des erreurs d'arrondi.*

### 5.1 `LedgerEntry`
Écriture sur une relation : **tout ce qui fait varier le solde**, y compris la vente elle-même, inscrite par « Commande livrée ». Le compte d'une relation est ainsi une seule liste, comme un cahier de crédit :

```
12/09  Vente 10 sacs de riz   +30 000
12/09  Paiement espèces       −20 000
       Solde                   10 000
```

Le solde d'une relation est ce que le client doit au fournisseur : **la somme des effets de ses écritures**.

```
solde = Σ balance_effect
```

Positif, le client doit ; négatif, il dispose d'une avance. Le résultat est mis en cache dans `CustomerRelationship.balance`, tenu par le serveur : chaque écriture y ajoute son effet (voir plus bas). Le solde ne dépend que de lignes qui ne changent jamais : une commande modifiée par erreur ne peut plus toucher à une dette.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| customer_relationship_id | FK → CustomerRelationship | |
| order_id | FK → Order, nullable | Commande concernée. **Obligatoire pour la vente et le paiement nés de « Commande livrée »** (voir 4.1). Informatif pour le reste : n'intervient pas dans le calcul du solde |
| kind | enum `[SALE / PAYMENT / REFUND / CREDIT_NOTE / OPENING_BALANCE]` | `SALE` : vente livrée, née de « Commande livrée », du montant de la commande fixé par le serveur — une seule par commande. `PAYMENT` : le client paie le fournisseur. `REFUND` : le fournisseur rend de l'argent au client. `CREDIT_NOTE` : avoir, réduction de ce que doit le client sans mouvement d'argent (retour accepté, écart de réception, remise, abandon de créance, avance reprise d'un cahier). `OPENING_BALANCE` : dette reprise d'un cahier de crédit papier |
| amount | bigint | Toujours positif : le sens est porté par le type, jamais par le signe. Pour une vente, fixé par le serveur : le total de la commande, quel que soit le montant envoyé par le téléphone (voir 4.1) |
| balance_effect | bigint, **calculé par la base** | Effet sur le solde : `+amount` pour `SALE`, `OPENING_BALANCE` et `REFUND` ; `−amount` pour `PAYMENT` et `CREDIT_NOTE` ; l'inverse pour une annulation. Colonne générée par PostgreSQL à partir du type : personne ne peut se tromper de sens. Sur le téléphone, la même règle est appliquée par une fonction partagée |
| mode | enum `[CASH / MOBILE_MONEY]`, nullable | Pour `PAYMENT` et `REFUND` uniquement. `CASH` remplace `MANUAL_CASH` |
| transaction_reference | string, nullable | Référence de la transaction, si Mobile Money |
| reverses_entry_id | FK → LedgerEntry, nullable | Annulation : pointe l'écriture annulée (voir plus bas) |
| recorded_by_id | FK → Person | Collaborateur du fournisseur ayant enregistré l'écriture. Pour un encaissement, c'est aussi celui qui détient l'argent, en espèces ou en Mobile Money sur son propre numéro (voir 5.3) |
| note | text, nullable | Libellé libre ; motif attendu pour un avoir, une reprise de cahier ou une annulation |
| occurred_at | datetime | Moment de l'opération (anciennement `date`). Pour une écriture saisie hors ligne, il vient du téléphone, dont l'heure est contrôlée à chaque synchronisation (voir 9.2) |

*Seul le fournisseur écrit dans le compte (v1) : ventes livrées, paiements reçus, argent rendu, avoirs, dettes reprises du cahier. Le client voit tout. Si le client pouvait aussi noter un paiement, le même argent serait compté deux fois.*

*Le livreur écrit les deux seules écritures nées de « Commande livrée », sur une livraison qui lui est assignée : la vente et le paiement. Il ne peut ni rendre de l'argent, ni accorder un avoir, ni annuler une écriture. Il ne voit pas le compte du client : son téléphone n'en reçoit que le crédit disponible (voir 9.6).*

*Pas de statut « payée / impayée » : un encaissement réduit le solde de la relation, pas une dette précise. Chaque commande affiche un fait, « Perçu à la livraison : 24 000 sur 30 000 », et ce qui reste dû se lit sur le solde (voir 4.1). Un statut calculé exigerait tout l'historique, que le téléphone ne garde que 90 jours.*

*Immutabilité : une écriture n'est **jamais modifiée ni supprimée**, et la base elle-même le garantit : le compte applicatif ne peut qu'ajouter et lire des lignes dans cette table (voir 10.6). Toute erreur se corrige de la même façon : « Annuler », pouvoir de gérant (en ligne pour un `MANAGER`), crée l'écriture inverse — du même type et du même montant, pointant l'écriture annulée par `reverses_entry_id` —, qui compte en sens inverse dans le solde comme dans l'argent détenu. Une écriture ne peut être annulée qu'une fois, et une annulation ne s'annule pas.*

*Hors ligne : un solde est une somme, l'ordre des écritures n'y change rien. Deux encaissements saisis hors ligne sur deux appareils ne peuvent donc pas se contredire.*

*Écritures simultanées : deux téléphones peuvent envoyer au même moment une écriture pour le même client. Le serveur ne refait donc pas la somme de tout l'historique : dans la transaction qui enregistre l'écriture, il ajoute son effet au solde (`UPDATE … SET balance = balance + effet`). PostgreSQL verrouille cette ligne jusqu'à la fin de la transaction : la seconde mise à jour attend, puis part du total à jour. Exemple : Paul encaisse 20 000 de Mme Ngono pendant que Jean lui vend pour 5 000 ; partant de 45 000, le solde passe à 25 000 puis à 30 000, jamais à un total qui oublierait l'une des deux opérations. Quand une opération touche deux caches — le solde du client et l'argent détenu du collaborateur —, ils sont toujours mis à jour dans le même ordre, client puis collaborateur, pour que deux transactions ne s'attendent jamais l'une l'autre. Chaque nuit, un contrôle compare chaque total à la somme de ses écritures, et prévient l'équipe en cas d'écart.*

#### Reprise de cahier

*Avant l'application, beaucoup de commerçants notent dans un cahier ce que chaque client leur doit. La reprise de cahier consiste à recopier ces dettes dans l'application, pour que le solde de chaque client démarre au bon montant. Exemple : M. Fotso s'inscrit ; son cahier indique que Mme Ngono lui doit 45 000 ; il l'ajoute comme cliente, puis saisit une reprise de 45 000 (`OPENING_BALANCE`) ; le solde de Mme Ngono démarre à 45 000, et elle en est prévenue si elle a l'application.*
- *La reprise est un pouvoir de gérant : le `OWNER` la fait à tout moment, un `MANAGER` en ligne. Elle peut faire naître la relation.*
- *Elle n'est pas limitée à une par client : une reprise fausse s'annule puis se ressaisit, un oubli s'ajoute. Si M. Fotso tape 54 000 au lieu de 45 000, il annule la reprise et ressaisit le bon montant.*
- *Une avance notée dans le cahier (le commerçant devait de l'argent au client) s'enregistre comme un avoir.*

#### Retour remboursé

*Un seul geste, qui enregistre ensemble un avoir (la marchandise rendue) et l'argent rendu (`REFUND`), du même montant : le solde du client ne bouge pas. Exemple : Mme Ngono rapporte un article de 10 000 déjà payé et reprend son argent ; sans l'avoir, l'argent rendu ferait monter son solde de 10 000 à tort. Un comptoir peut ainsi rembourser un client de passage. Une simple réduction, sans argent rendu, reste un avoir seul. Avoirs et argent rendu sont des pouvoirs de gérant (en ligne pour un `MANAGER`). Fait par un autre que le propriétaire, un retour remboursé rejoint ses écarts (voir 9.2) : le solde du client ne bougeant pas, personne d'autre ne s'en apercevrait.*

*Retour ou échange après livraison, sans workflow dédié : réduction de ce que doit le client → avoir ; remboursement en argent → « Retour remboursé ». La marchandise reprise n'est pas suivie, faute de stock en v1.*

*Une correction à la hausse de ce que doit un client passe par une commande ou par une reprise de cahier : les seules écritures qui font monter le solde sont la vente, la reprise de cahier, l'argent rendu seul et l'annulation d'un encaissement ou d'un avoir.*

*Signalement : toute hausse du solde est signalée au client inscrit, dans l'application. Un client sans application n'est plus prévenu par SMS en v1 (voir 8.1). Le reçu que l'application propose d'envoyer après une livraison à crédit, et la revue du soir du propriétaire, qui voit les livraisons non soldées de chaque livreur (voir 9.2), prennent le relais ; si la cliente a payé par Mobile Money, sa preuve de paiement tranche tout litige.*

*Plafond : `credit_limit` s'applique au solde, par la règle unique de 2.1.*

*Trésorerie d'une organisation : entrées = `PAYMENT` où elle est fournisseur et `REFUND` où elle est cliente ; sorties = `PAYMENT` où elle est cliente, `REFUND` où elle est fournisseur, et ses dépenses (voir 5.2). `SALE`, `CREDIT_NOTE` et `OPENING_BALANCE` ne sont pas des mouvements d'argent.*

*Dettes réciproques : deux organisations qui se vendent mutuellement ont deux relations, donc deux soldes indépendants. **Pas de compensation en v1**.*

*Cloisonnement : une organisation ne voit jamais le solde d'une même `Person` auprès d'un autre fournisseur — ce qui rend financièrement acceptable la réutilisation globale des `Person`.*

### 5.2 `Expense`
**Dépense** : de l'argent qui quitte l'entreprise, quelle qu'en soit la nature ; la catégorie est un simple texte, comme celle d'un article.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | |
| paid_by_id | FK → Person | Qui l'a payée, avec l'argent qu'il détenait (voir 5.3) ; un collaborateur du commerce, actif ou parti |
| amount | bigint | Toujours positif |
| category | string, nullable | Texte libre facultatif (ex : « Carburant », « Chargement », « Frais Mobile Money ») |
| description | text, nullable | |
| recorded_by_id | FK → Person | `OWNER`, ou `MANAGER` en ligne |
| occurred_at | datetime | Moment de la dépense (anciennement `date`) |
| cancelled_at | datetime, nullable | Annulation d'une dépense saisie par erreur |
| cancelled_by_id | FK → Person, nullable | `OWNER`, ou `MANAGER` en ligne, qui l'a annulée |

*Jamais modifiée. Une erreur (5 000 au lieu de 50 000) se corrige avec « Annuler », réservé au propriétaire et au gérant : la ligne reste visible, barrée, et ne compte plus ; on ressaisit ensuite le bon montant. Le compte client garde, lui, son mécanisme d'écriture inverse, puisque le client le voit (voir 5.1).*

*Une dépense notée ou annulée par un autre que le propriétaire rejoint ses écarts (voir 9.2) : elle baisse l'argent détenu de celui qui l'a payée, sans que personne d'autre ait de raison de la contester.*

*Les frais d'un transfert ou d'un retrait Mobile Money, quand un collaborateur reverse l'argent au propriétaire, se notent comme une dépense : sinon, ils apparaîtraient comme un manque dans son argent détenu.*

*Le marchand qui encaisse lui-même peut simplement noter ses dépenses, s'il le souhaite.*

### 5.3 `Handover`
**Remise d'argent** : de l'argent — espèces ou Mobile Money — qui passe d'une personne à une autre à l'intérieur d'une organisation, en général d'un livreur ou d'un vendeur vers le propriétaire. Ce n'est ni une entrée ni une sortie pour l'entreprise, puisque l'argent y est entré quand le client a payé : c'est une sortie pour celui qui remet, une entrée pour celui qui reçoit. Anciennement `CashHandover` : le nom change, puisque la remise couvre aussi le Mobile Money.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | |
| from_person_id | FK → Person | Celui qui remet l'argent : livreur, vendeur ou gérant, collaborateur du commerce, actif ou parti |
| to_person_id | FK → Person | Celui qui le reçoit, `OWNER` ou `MANAGER`, et qui confirme la réception en saisissant la remise (en ligne pour un `MANAGER`) |
| amount | bigint | Toujours positif |
| occurred_at | datetime | Moment de la remise (anciennement `date`) |
| cancelled_at | datetime, nullable | Annulation d'une remise saisie par erreur |
| cancelled_by_id | FK → Person, nullable | `OWNER`, ou `MANAGER` en ligne, qui l'a annulée |

*Jamais modifiée ; une erreur se corrige avec « Annuler », comme une dépense. Un livreur ne saisit jamais sa propre remise : c'est celui qui reçoit l'argent qui la saisit, et il est ainsi tracé. L'annulation d'une remise par un autre que le propriétaire rejoint ses écarts (voir 9.2).*

*Celui qui remet est prévenu : à chaque remise enregistrée à son nom, il reçoit « Jean a noté avoir reçu 50 000 de vous. Il vous reste 5 000 à remettre. » Un bouton « Ce n'est pas le bon montant » avertit aussitôt le propriétaire. Sans cela, celui qui reçoit pourrait noter moins que reçu et garder la différence, et c'est celui qui remet qui paraîtrait en faute. Chacun voit son propre argent détenu.*

*Mobile Money : le client paie celui qui le sert, sur le numéro personnel de ce dernier. Le livreur vérifie ainsi que l'argent est arrivé avant de remettre la marchandise, et le client garde une preuve de paiement. Cet argent est chez le livreur, exactement comme des espèces dans sa poche : il compte donc dans son argent détenu, jusqu'à ce qu'il le reverse au propriétaire et que celui-ci confirme la remise. Deux précautions : vérifier son solde dans l'application de l'opérateur ou par code USSD, jamais sur un simple SMS, qui s'imite facilement ; noter comme dépense les frais d'un transfert ou d'un retrait (voir 5.2).*

*Argent détenu par une personne dans une organisation : tout ce qu'elle a encaissé — `PAYMENT` qu'elle a enregistrés, en espèces ou en Mobile Money —, moins l'argent qu'elle a rendu, ses dépenses et ses remises, plus ce qu'on lui a remis ; une écriture annulée compte en sens inverse, une dépense ou une remise annulée ne compte plus. Ce montant est **tenu par le serveur** dans `Collaboration.amount_held` : chaque opération y ajoute son effet, et le contrôle de nuit le compare à la somme de tout l'historique (voir 5.1) ; le téléphone, qui ne garde que 90 jours, y ajoute seulement ses propres opérations pas encore envoyées. Sans cela, un écart de juin disparaîtrait de l'écran en septembre. Les paiements faits par l'organisation à ses propres fournisseurs, enregistrés par ces derniers, comptent dans sa trésorerie, pas dans l'argent détenu d'une personne.*

*Exemple : Paul a encaissé 30 000 en espèces et 30 000 en Mobile Money sur son numéro, et payé 5 000 d'essence. Le soir, M. Fotso ouvre « Argent détenu » et voit « Paul : 60 000, dont 30 000 en Mobile Money ». Il note la dépense de 5 000, compte les espèces, vérifie le transfert Mobile Money reçu de Paul, puis confirme la remise de 55 000 : Paul ne détient plus rien. S'il n'avait remis que 50 000, les 5 000 manquants resteraient à son nom, visibles, même des mois plus tard, et même s'il quitte l'entreprise : « Paul (parti) : 5 000 ».*

*Le propriétaire détient l'argent de l'organisation : il n'a rien à remettre. Son argent détenu est compté comme celui de tout le monde, mais ne lui est jamais présenté. Au transfert de propriété, le serveur enregistre une remise de l'ancien propriétaire à lui-même, du montant qu'il détient : ce qu'il a encaissé comme propriétaire est « remis au commerce », et il repart de zéro comme gérant. Exemple : M. Fotso détient 3 450 000 au moment de vendre sa boutique à Mme Abena ; la remise automatique le ramène à 0, et le contrôle de nuit reste une simple somme, sans date à consulter. Le marchand qui encaisse lui-même ne voit jamais d'écran de remise. Les encaissements ne sont jamais modifiés après coup : on sait qui a reçu l'argent, une remise peut être partielle, et rien n'apparaît à tort comme non versé.*

### 5.4 `Subscription`
Ouvert à **toute organisation**, quel que soit son rôle dans ses relations. Conservée : elle garde l'historique des souscriptions.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| organization_id | FK → Organization | |
| plan | string | |
| status | enum `[ACTIVE / EXPIRED]` | Purement lié à la facturation. La suspension de modération est portée par `Organization.status` |
| starts_at / ends_at | datetime | |

*Unicité : **index unique partiel** sur `organization_id` où `status = ACTIVE`. Les lignes expirées restent comme historique des souscriptions.*

*Non-paiement : dégradation, jamais blocage. Une organisation sans abonnement payant actif retombe sur un **plan gratuit** aux fonctions limitées, mais reste joignable par ses clients et fournisseurs. Notifications et codes de vérification fonctionnent quel que soit le plan. La fermeture du commerce par son propriétaire arrête l'abonnement (voir 1.3).*

---

## 6. Modération

### 6.1 `Report`
Conservé : même sans annuaire public, des abus restent possibles.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| reporter_id | FK → Person | Personne inscrite |
| target_person_id | FK → Person, nullable | La cible, s'il s'agit d'une personne |
| target_organization_id | FK → Organization, nullable | La cible, s'il s'agit d'une organisation |
| reason | string | |
| description | text | |
| status | enum `[PENDING / RESOLVED]` | |
| resolved_by_id | FK → Administrator, nullable | |
| decision | enum `[DISMISSED / SUSPENSION]`, nullable | |
| reported_at / resolved_at | datetime | |

*Cible : exactement une des deux colonnes est renseignée (`CHECK`).*

*Une décision `SUSPENSION` passe `Person.status` ou `Organization.status` à `SUSPENDED`, et révoque les sessions de la personne suspendue (voir 10.4). La suspension d'une organisation est la seule situation où ses clients et fournisseurs en subissent les effets — contrairement à l'expiration d'un abonnement (voir 5.4).*

*Chaque décision est aussi inscrite au journal des actions d'administration (`AdminAction`, voir 7.2), tout comme une suspension décidée hors signalement ou la levée d'une suspension.*

---

## 7. Gouvernance de la plateforme

### 7.1 `Administrator`
Désigne les membres de l'équipe de la plateforme qui traitent les signalements et suspendent un compte. C'est le compte le plus puissant de la plateforme, puisqu'il peut bloquer n'importe quel commerce : il est protégé en conséquence.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | Personne inscrite |
| role | enum `[SUPER_ADMIN / MODERATOR]` | |
| totp_secret | string | Secret de la **double authentification**, chiffré. Obligatoire : un administrateur ne peut pas agir sans elle |
| recovery_email | string, nullable | Adresse email de secours de la double authentification, **différente de `Person.email`**, enregistrée seulement une fois vérifiée par un code. Facultative, conseillée |
| appointed_at | datetime | |
| removed_at | datetime, nullable | Fin des fonctions. La ligne reste, pour que le journal garde son auteur |

*Double authentification : en plus du mot de passe, un code à 6 chiffres qui change toutes les 30 secondes, produit par une application d'authentification (norme TOTP). Elle est gratuite et ne passe pas par SMS.*

*Perte des codes : l'application d'authentification calcule les codes à partir d'une clé installée une seule fois. Réinstallée, elle ne les retrouve que si elle sauvegardait ses clés dans un compte — option de certaines applications, liée à un compte Google ou Microsoft, qui doit alors avoir sa propre double authentification ; l'activation le conseille. Sinon, un code envoyé à l'adresse de secours (usage `TOTP_RECOVERY`) permet d'installer une nouvelle clé, et rien d'autre. Chaque usage est inscrit au journal (`RECOVER_2FA`) et signalé sur les téléphones de l'administrateur comme aux autres super-administrateurs : « Ce n'était pas vous ? Bloquer ». Jamais par l'email du compte : il permet déjà de réinitialiser le mot de passe et de recevoir le code de connexion (voir 1.1), et ouvrirait à lui seul le compte le plus puissant de la plateforme.*

*Espace séparé : l'administration se fait dans un espace web dédié, jamais dans l'application mobile, avec des sessions courtes.*

*Le référentiel géographique et les catégories de charges prédéfinies ayant disparu, la plateforme ne maintient pas de données de référence en v1.*

### 7.2 `AdminAction`
Journal des actions d'administration : qui a fait quoi, sur qui, pourquoi et quand.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| administrator_id | FK → Administrator | Auteur de l'action |
| action | enum `[SUSPEND / REACTIVATE / DISMISS_REPORT / APPOINT_ADMIN / REMOVE_ADMIN / REPLAY_SYNC / RECOVER_2FA]` | Nature de l'action. `REPLAY_SYNC` : rejeu d'un envoi archivé (voir 9.4). `RECOVER_2FA` : double authentification réinstallée grâce à l'adresse de secours (voir 7.1) |
| target_person_id | FK → Person, nullable | La cible, s'il s'agit d'une personne |
| target_organization_id | FK → Organization, nullable | La cible, s'il s'agit d'une organisation |
| report_id | FK → Report, nullable | Le signalement à l'origine de l'action, s'il y en a un |
| sync_archive_id | FK → SyncArchive, nullable | L'envoi rejoué, pour `REPLAY_SYNC` |
| reason | text | Motif, obligatoire |
| occurred_at | datetime | Heure du serveur |

*Contraintes : exactement une cible renseignée — pour un rejeu, l'auteur de l'envoi ; `sync_archive_id` renseigné ⟺ `action = REPLAY_SYNC` ; journal immuable : on ne fait qu'y ajouter des lignes, et la base elle-même refuse toute modification (voir 10.6).*

*Toute suspension et toute levée y figurent, avec ou sans signalement : les commerçants ont la garantie qu'une suspension est toujours tracée et justifiée.*

---

## 8. Notifications

### 8.1 `Notification`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| recipient_id | FK → Person | Personne inscrite : en v1, une notification ne part jamais par SMS |
| organization_id | FK → Organization, nullable | Contexte de la notification |
| content | text | |
| source_event | string | ex : "order.placed", "order.status_changed", "customer.added", "supplier.invited", "relationship.contested", "credit_limit.raised", "credit_limit.exceeded", "device.new_login", "sync.anomalies", "sync.returned", "sync.refused", "handover.recorded", "handover.disputed", "phone.taken_over" |
| related_entity_type | string, nullable | ex : "Order", "CustomerRelationship", "LedgerEntry" |
| related_entity_id | FK, nullable, polymorphe | L'entité précise ayant déclenché la notification |
| read_status | enum `[UNREAD / READ]` | |
| pushed_at | datetime, nullable | Envoi en notification push vers les appareils de la personne (voir 10.3) ; vide si aucun appareil n'a de jeton |
| created_at | datetime | Anciennement `date` |

*Plus de colonne `channel` : en v1, chaque notification s'affiche dans l'application et part en push, gratuitement, grâce aux jetons des appareils (Firebase Cloud Messaging).*

*C'est la **seule référence polymorphe** du modèle, et elle le reste volontairement : une notification peut viser une commande, une relation, une écriture ou une livraison, et la liste s'allonge à chaque nouvelle source. Ailleurs, où les cibles possibles se limitent à deux, le couple de colonnes typées est préféré. `related_entity_type` et `related_entity_id` sont renseignés ensemble ou ni l'un ni l'autre.*

*Une personne inscrite reçoit tout dans l'application, gratuitement et instantanément : nouvelle commande pour le fournisseur, commande acceptée, refusée ou livrée, prix négocié modifié, hausse du solde, relation contestée, connexion sur un nouveau téléphone ; et, pour le propriétaire, plafond relevé par un gérant, plafond dépassé, écarts regroupés, de synchronisation et d'argent (voir 9.2). Une notification adressée à un client reprend les libellés figés de ses commandes (`OrderLine.label_applied`).*

*Historique des plafonds : il est gardé par le journal des plafonds (voir 2.4). Les notifications `credit_limit.raised` ne font que prévenir le propriétaire des hausses décidées par un gérant.*

#### Plus de SMS de notification en v1

*La v7 envoyait chaque soir une alerte de dette aux clients sans application. Elle est retirée de la v1 pour son coût, et reportée en v2 avec sa règle corrigée : comparer la dette au solde de la veille au soir, et non au montant de la dernière alerte, qui laissait passer une dette fictive après un remboursement complet.*

*Ce qui protège désormais un client sans application : le reçu que l'application propose d'envoyer par WhatsApp après une livraison à crédit (voir 4.1), la revue du soir du propriétaire, qui voit les livraisons non soldées de chaque livreur (voir 9.2), et, s'il a payé par Mobile Money, sa propre preuve de paiement. Le plus sûr reste d'installer l'application, où les notifications sont gratuites.*

*Plus aucun autre SMS : ni récapitulatif de livraison, ni SMS par écriture, ni changement de prix, ni message de bienvenue, ni invitation — les invitations partent du téléphone de celui qui invite (voir 1.4 et 2.1). Seuls restent les codes de vérification, que la personne demande elle-même (voir 10.2). Le retrait de l'alerte écarte au passage la question des messages envoyés à des personnes qui n'ont rien demandé.*

---

## 9. Synchronisation hors ligne

### 9.1 Principes : la synchronisation classique de WatermelonDB
Le modèle s'appuie sur le fonctionnement standard de WatermelonDB, sans mécanique parallèle.

- **Tout se fait sur le téléphone.** L'application lit et écrit dans sa base locale, avec ou sans réseau. Chaque enregistrement porte un état caché : synchronisé, créé, modifié ou supprimé. Les modifications d'un même geste sont écrites en un seul lot : on ne voit jamais un paiement sans la livraison qui va avec.
- **Les identifiants sont créés sur le téléphone**, au moment où l'enregistrement naît : des UUIDv7, grâce au générateur d'identifiants que WatermelonDB permet de fournir. Le serveur les garde tels quels, et PostgreSQL les valide (colonnes `uuid`). Rien n'est à renommer après coup.
- **La synchronisation se fait en deux temps** :
  - **Réception** : le téléphone demande ce qui a changé depuis sa dernière synchronisation, et applique la réponse du serveur (voir 9.6).
  - **Envoi** : il transmet tous les enregistrements créés ou modifiés localement. Le serveur les juge un par un (voir 9.2), puis applique ce qu'il accepte en une seule transaction.
- **Un même envoi répété ne crée pas de double** : le serveur reconnaît chaque enregistrement à son identifiant. La même règle protège les gestes en ligne (voir 10.1).
- **Quand une donnée a été modifiée des deux côtés**, on suit le protocole standard de WatermelonDB : si un enregistrement a changé sur le serveur depuis la dernière réception du téléphone, le serveur refuse l'envoi ; le téléphone récupère la version à jour, y réapplique ses propres changements champ par champ, puis renvoie. Tout est automatique. Exemple : Jean corrige l'adresse de Mme Ngono pendant qu'un vendeur hors ligne modifie son nom ; les deux changements sont gardés, au lieu que la version périmée du vendeur efface la correction de Jean. Le statut d'une commande fait exception : il ne se fusionne jamais (voir 9.2).
- **Ce qui ne passe pas par la synchronisation** : les commandes passées par les clients, et les pouvoirs de gérant d'un `MANAGER` (crédit, prix, avoirs, argent rendu, annulations, reprises de cahier, dépenses, remises, catalogue, corrections), qui empruntent une route en ligne, pour que le serveur vérifie le rôle au moment même (voir 10.1). Tout comme les invitations, et, même pour le propriétaire, l'équipe, le transfert de propriété et l'abonnement : un changement de droits prend effet au moment où il est fait.

### 9.2 Ce que le serveur fait de chaque ligne reçue
**Le serveur juge chaque ligne**, en la comparant à sa propre version, avec les règles de la table des règles (voir 10.1 et l'annexe) :
1. **Périmètre** : la ligne doit appartenir au périmètre de son auteur (le prédicat de cloisonnement, voir 2.1). Un vendeur de la Boutique Fotso ne peut rien écrire chez une autre boutique, même en connaissant l'identifiant d'une de ses lignes.
2. **Droits, champ par champ** : chaque champ modifié doit être permis au rôle de l'auteur. La relation entre la boutique et Mme Ngono est une ligne partagée, présente aussi sur le téléphone de Mme Ngono ; si quelqu'un renvoyait cette ligne avec un plafond de 1 000 000, la modification serait refusée, car seul le fournisseur fixe le plafond.
3. **Champs calculés** : solde, argent détenu, effets des écritures, totaux, montants de ligne, montant des ventes, prix de référence d'une commande client — jamais repris du téléphone. Ils sont ignorés à la réception et recalculés par le serveur.
4. **Étapes** : un changement de statut n'est appliqué que s'il est permis depuis l'état actuel. La livraison l'emporte toujours, même sur une annulation, puisque la marchandise est partie ; une commande livrée est figée, sauf la note du fournisseur (voir 4.1).
5. **Contrôles** : prix du moment, plafond, article encore en vente, date cohérente, opération faite au-delà de 3 jours sans synchronisation. Ils ne bloquent rien : ils produisent des écarts, signalés (voir plus bas).

*Ces deux premières règles répondent aux failles classées 1re et 3e par l'OWASP pour les API : agir sur une ligne, ou sur un champ, qui n'est pas le sien.*

**Trois réponses distinctes**
1. **Problème métier** — la ligne est enregistrée, et le problème signalé sur l'enregistrement concerné (`sync_issue` sur la commande ou la livraison). Exemples :
   - « Article retiré de la vente depuis la saisie » ;
   - « Livraison déjà prise par Paul » ;
   - « Annulation impossible : commande livrée par Paul à 10 h 30 ».
2. **Conflit** — l'envoi est refusé le temps que le téléphone récupère la version à jour, puis renvoie (voir 9.1). Refus transitoire et automatique, invisible pour l'utilisateur.
3. **Envoi interdit** — hors périmètre ou champ réservé : la modification est refusée et consignée. Une application honnête n'en produit jamais, sauf dans le premier envoi après un changement de droits (voir plus bas), où le refus est aussi signalé au propriétaire. Le téléphone doit l'apprendre : WatermelonDB marque toute ligne envoyée comme synchronisée, et sans cela il afficherait sans fin une opération que le serveur n'a pas. Tout refus, comme toute ligne mise de côté (voir plus bas), déclenche donc une resynchronisation complète de ce téléphone (voir 9.6), et son auteur reçoit une notification : « Vente à Mme Ngono, 15 000 : non enregistrée. Motif : … ».

**Un doublon ne bloque jamais un envoi.** *Le serveur applique chaque envoi en une seule transaction. Si une ligne créée hors ligne heurtait une règle « un seul » de la base, tout l'envoi échouerait et se réessaierait sans fin : le téléphone resterait bloqué, et plus rien de ce qu'il fait n'arriverait au serveur. Chaque doublon possible a donc sa conduite écrite :*
- *livraison en double (départs croisés) : la seconde est enregistrée close, avec « Livraison déjà prise par Paul » ; si c'est elle qui a livré, la livraison l'emporte et c'est l'autre qui est close (voir 4.3) ;*
- *prix négocié saisi sur deux téléphones : le dernier arrivé remplace le premier (voir 9.6) ;*
- *client ajouté deux fois : les fiches sont réunies (voir 9.6).*

*Filet de sécurité : une ligne qu'aucune règle ne sait écrire est mise de côté et signalée, et le reste de l'envoi passe. Le lot complet reste dans l'archive des synchronisations (voir 9.4), d'où un super-administrateur peut le rejouer une fois la cause corrigée.*

**Premier envoi après un changement de droits.** *Un collaborateur révoqué ou rétrogradé pendant qu'il était hors ligne continue de travailler avec ses anciens droits tant que son téléphone l'ignore. Le serveur le reconnaît à l'ancien compteur de droits que le téléphone envoie encore (`Device.scope_version_seen`, plus ancien que `Person.scope_version`). Ce premier envoi est jugé avec les **droits actuels** :*
- *les opérations de vendeur — ventes, livraisons, encaissements — sont toujours acceptées, même si les droits actuels ne les permettent plus, puis signalées au propriétaire : ce sont des faits réels, et refuser un encaissement pousserait à garder l'argent sans trace ;*
- *toute autre opération que les droits actuels ne permettent pas est refusée, et signalée au propriétaire.*

*Le serveur n'a besoin ni d'un historique des rôles, ni d'une date venant du téléphone : il ne juge qu'avec ce qu'il sait au moment même. Le téléphone se resynchronise ensuite entièrement (voir 9.6), ce qui en retire ce qui a été refusé. Les pouvoirs de gérant d'un `MANAGER` passant par une route en ligne, le cas ne concerne en pratique que les ventes et encaissements d'un collaborateur, et les gestes qu'un ancien propriétaire aurait saisis hors ligne avant un transfert de propriété.*

*Exemples : mardi, Jean, gérant, travaille hors ligne et saisit 5 ventes. Mercredi matin, M. Fotso le fait passer vendeur. Mercredi soir, le téléphone de Jean se synchronise : les 5 ventes, permises à un vendeur, sont acceptées normalement, puis le téléphone repart en vendeur. Autre cas : M. Fotso vend sa boutique à Mme Abena et devient gérant ; son second téléphone, resté sans réseau, contient 3 ventes et un avoir de 50 000 saisis la veille. Les ventes passent ; l'avoir est refusé, et Mme Abena en est prévenue.*

**Prix changé pendant qu'un vendeur est hors ligne.** *Le serveur garde le prix que le vendeur avait sous les yeux, ne compte pas la vente comme une remise, et la signale avec la date du changement de prix (voir 4.2).*

**Contrôle par exception.** *Le propriétaire ne vérifie pas tout : un contrôle trop lourd finit ignoré. Une vente au bon prix et dans le plafond est correcte, quel que soit le moment où elle a été faite ; il est inutile de la lui montrer. Le serveur, qui a vérifié chaque opération, ne lui présente que les écarts, **regroupés par cause, avec leur montant**. Exemple : Paul revient après 6 jours avec 120 opérations ; 112 sont correctes et n'apparaissent pas ; les 8 autres tiennent en deux lignes :*
- *« 7 sacs de riz vendus à l'ancien prix (3 000 au lieu de 3 200) : écart de 1 400 » ;*
- *« Mme Ngono : plafond dépassé de 15 000 ».*

*Une longue absence ne donne qu'une ligne d'information, sans rien à vérifier : « Paul s'est resynchronisé après 6 jours ». Chaque soir, le propriétaire voit aussi les livraisons non soldées de chaque livreur : en cas de doute, un appel au client suffit. Ce sont des lectures des données, sans table dédiée.*

**L'argent qui sort sans que personne ne réclame.** *Certains gestes font perdre de l'argent au commerce sans qu'aucun client ne se plaigne. Un « Retour remboursé » ne change pas le solde du client, qui n'a donc rien à réclamer, mais baisse l'argent détenu par celui qui l'a saisi ; une dépense notée à son propre nom fait de même ; un écart de prix encaissé au prix plein laisse la différence dans une poche. Quand ils sont faits par un autre que le propriétaire, ces gestes rejoignent donc ses écarts, regroupés par personne avec leur montant : argent rendu, dépenses, avoirs, annulations d'écritures, de dépenses ou de remises, et écarts de prix accordés. Le reste d'une livraison partielle abandonné par un autre que le propriétaire y figure aussi, avec ses quantités et leur valeur : sans stock, c'est la marchandise qui sort sans que personne ne réclame. Exemple :*
- *« Jean : 2 retours remboursés, 1 dépense · 62 000 » ;*
- *« Paul : 12 remises de prix · 6 500 » ;*
- *« Paul : 2 sacs de riz non livrés, reste abandonné (6 000) ».*

*Le propriétaire n'a rien d'autre à faire que regarder : un geste justifié ne demande aucune action, un geste douteux se règle par un appel. Ce sont, là encore, des lectures des données, sans table dédiée. La notification envoyée quand un gérant relève un plafond reste inchangée (voir 2.1).*

**La liste « À résoudre »** rassemble, pour chaque utilisateur, les commandes et livraisons signalées qui le concernent, chacune avec son message. Il les corrige comme d'habitude : il retire l'article, ou annule la commande ; le signalement disparaît alors. Rien n'est jamais effacé par un conflit : ce que l'utilisateur a fait reste visible jusqu'à sa correction, et « Mon activité » reste toujours accessible (voir 9.5). Les signalements sont gardés sur le serveur, avec les opérations acceptées : une resynchronisation complète ne les perd pas.

*La sécurité ne dépend d'aucune date venant du téléphone : le serveur juge le contenu de chaque ligne au moment où elle arrive, contre les données du moment.*

### 9.3 Fraîcheur : synchronisation automatique et mode restreint
**Synchronisation automatique.** L'application se synchronise sans que personne n'y pense : à l'ouverture, après chaque opération si le réseau est là, au retour du réseau, et en arrière-plan toutes les 15 minutes environ sur Android. Seuls les changements circulent : quelques kilo-octets, presque rien en données. En pratique, un téléphone reste rarement plus de quelques heures sans synchronisation.

**Indicateurs.** Un indicateur affiche « À jour » ou « Pas synchronisé depuis 2 jours ». Le propriétaire voit la dernière synchronisation de chaque collaborateur, notée par le serveur à son heure (`Device.last_synced_at`, voir 10.3) : « Paul : synchronisé il y a 3 jours » ; il peut l'appeler.

**Mode restreint.** Au-delà de **3 jours sans synchronisation**, le téléphone d'un collaborateur ne sert plus qu'à terminer ce qui est en cours : **livrer les commandes déjà parties avec lui, payées en entier, et encaisser**. Il ne peut plus rien commencer — vente, commande, départ, crédit — avant de s'être synchronisé ; une connexion, même brève, lui rend tout. Exemple : Paul part lundi en tournée avec 8 commandes, sans réseau ; jeudi, il peut encore livrer ces 8 commandes et encaisser, mais ni vendre au bord de la route, ni faire crédit.
- *On garde l'encaissement : refuser de noter un paiement pousserait le collaborateur à garder l'argent sans trace, le pire des cas.*
- *Le propriétaire n'est jamais bloqué : c'est son risque. Le commerçant qui travaille seul n'est donc jamais concerné.*
- *Le délai se mesure sur le téléphone, depuis l'heure du serveur lors de la dernière synchronisation. Ce blocage n'est qu'un garde-fou pour les utilisateurs honnêtes : un téléphone trafiqué pourrait le contourner, mais tout ce qu'il enverrait serait jugé à son arrivée (voir 9.2), et une longue absence serait visible du propriétaire.*
- *Sur le serveur, la règle n'est qu'un contrôle, jamais un refus : l'heure d'une opération vient du téléphone, et le serveur ne peut pas savoir si elle a été faite avant ou après les 3 jours. Il accepte donc tout, et une opération datée de plus de 3 jours après la dernière synchronisation de son téléphone rejoint les écarts signalés au propriétaire (voir 9.2). Refuser au moment de l'envoi reviendrait à rejeter les ventes que Paul a faites honnêtement le premier jour, parce qu'il n'est revenu qu'au sixième.*

**Deux contrôles à chaque synchronisation.** Le téléphone envoie sa version et son heure.
- **Version** : sous une version minimale fixée par la plateforme, le serveur refuse la synchronisation, et l'application affiche « Mettez à jour l'application », avec un bouton vers la boutique d'applications. Rien n'est perdu : les opérations en attente restent sur le téléphone et partent après la mise à jour. Une application jamais mise à jour enverrait sinon des données avec les règles d'il y a six mois.
- **Heure** : si l'heure du téléphone s'écarte de plus de 5 minutes de celle du serveur, l'application demande d'activer l'heure automatique. Les dates des ventes et des paiements viennent du téléphone : après une batterie vide, un téléphone qui affiche le 1er janvier 2024 ferait tomber les livraisons du jour dans les rapports de 2024. Les opérations aux dates incohérentes, par exemple dans le futur, rejoignent les écarts signalés au propriétaire. Le serveur garde de toute façon l'heure de réception de chaque lot (voir 9.4).

### 9.4 `SyncArchive`
Archive, côté serveur, de chaque lot reçu d'un téléphone, tel quel.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | Auteur de l'envoi |
| device_id | FK → Device | Téléphone d'où vient le lot (voir 10.3) |
| received_at | datetime | Réception par le serveur, à son heure |
| changes | JSON | Le lot complet, tel que WatermelonDB l'a envoyé : enregistrements créés, modifiés et supprimés, table par table |

*Une ligne par synchronisation reçue, jamais modifiée : la base elle-même refuse toute modification (voir 10.6). Il suffit d'une ligne de code dans le point d'envoi du serveur, et de rien dans les gestes : aucun dispositif artificiel à maintenir. Conservation : 90 jours, la même durée que l'historique gardé sur les téléphones (voir 11).*

*Rejouer au besoin : seul un super-administrateur peut rejouer un lot archivé, avec un motif obligatoire ; le rejeu est inscrit au journal d'administration (`REPLAY_SYNC`, avec le lot concerné, voir 7.2). Le lot passe par le même chemin que les envois de tous les jours, et il est jugé comme s'il venait de son auteur, avec ses droits actuels (voir 9.2), jamais avec ceux de l'administrateur. L'auteur et le propriétaire du commerce sont prévenus : « Des opérations envoyées le 12/09 depuis votre téléphone ont été réintégrées par l'équipe de la plateforme. » C'est ainsi que se réintègrent les lignes mises de côté par le filet de sécurité (voir 9.2). Ce chemin servant en permanence, il ne peut pas se dérégler en silence.*

### 9.5 « Mon activité »
Un utilisateur retrouve les gestes qu'il a faits sur une période de son choix — par exemple, après une journée de travail hors ligne, les clients qu'il a enregistrés, les livraisons effectuées, les commandes annulées ou livrées, avec leurs quantités et leurs montants.

L'écran se construit par une série de requêtes WatermelonDB, une par type de geste. Chacune cherche les enregistrements dont l'utilisateur est l'auteur de ce geste, sur la période choisie. **Un enregistrement n'apparaît donc que si l'utilisateur y a lui-même fait quelque chose.**

| Geste | Où chercher | Auteur | Date |
|---|---|---|---|
| Client ajouté, fournisseur invité | `CustomerRelationship` | `created_by_id` | `created_at` |
| Plafond fixé ou changé | `CreditLimitChange` | `set_by_id` | `set_at` |
| Commande saisie | `Order` | `entered_by_id` | `created_at` |
| Commande livrée | `Order` | `delivered_by_id` | `delivered_at` |
| Commande annulée ou refusée | `Order` | `cancelled_by_id` | `cancelled_at` |
| Départ en livraison, livraison ratée | `Delivery` | `assigned_to_id` | `departed_at`, `failed_at` |
| Encaissement, argent rendu, avoir, reprise de cahier, annulation d'écriture | `LedgerEntry` | `recorded_by_id` | `occurred_at` |
| Écart de prix accordé | `OrderLine` | `price_set_by_id` | `price_set_at` |
| Prix négocié | `CustomerPrice` | `set_by_id` | `set_at` |
| Dépense | `Expense` | `recorded_by_id` | `occurred_at` |
| Remise reçue | `Handover` | `to_person_id` | `occurred_at` |
| Dépense ou remise annulée | `Expense`, `Handover` | `cancelled_by_id` | `cancelled_at` |
| Correction, contestation | `CustomerRelationshipReassignment` | `reassigned_by_id` | `reassigned_at` |

**Exemples de lignes**
- « Client ajouté : Mme Ngono »
- « Commande saisie pour Restaurant Chez Kamga · 3 articles · 45 000 »
- « Départ en livraison : commande de Mme Ngono »
- « Commande livrée à Mme Ngono · 8 sacs sur 10 · 24 000 perçus en espèces »
- « Livraison ratée chez M. Kamga · client absent »
- « Commande annulée : M. Kamga · motif : article plus disponible »
- « Paiement reçu de M. Kamga · 15 000 en Mobile Money »
- « Écart de prix accordé : Riz 25 kg à 14 500 au lieu de 15 000 »
- « Prix négocié : Mme Ngono · Huile 5 L à 6 000 »
- « Plafond fixé : Mme Ngono · 100 000 »
- « Dépense : carburant · 5 000 »
- « Remise reçue de Paul · 55 000 »

**Comment l'écran se construit**
- Le téléphone lance ces requêtes, réunit les résultats et les trie par heure. Chaque geste devient une ligne.
- Un même enregistrement peut donner plusieurs lignes, si l'utilisateur y a fait plusieurs gestes : il a saisi la commande le matin et l'a livrée l'après-midi.
- Toucher une ligne ouvre l'enregistrement. Deux mentions peuvent s'y ajouter : « pas encore envoyé », que WatermelonDB connaît pour chaque enregistrement, et « à vérifier », qui vient de `sync_issue`.
- Les colonnes d'auteur et de date sont indexées, pour que les requêtes restent rapides.

**Ce qui n'y figure pas**, faute d'auteur enregistré : les changements du catalogue et de l'équipe. Ils restent visibles sur leurs propres écrans ; pour les faire entrer dans « Mon activité », il suffirait d'ajouter à chacun un auteur et une date.

**Limites acceptées** : « Mon activité » montre l'état actuel de ce que l'utilisateur a fait — si un gérant a corrigé sa commande ensuite, il voit la commande corrigée. Et les états intermédiaires d'une journée hors ligne ne sont pas gardés, le lot d'envoi ne transmettant que le dernier état de chaque enregistrement.

### 9.6 Ce que reçoit et garde chaque téléphone
**Deux colonnes techniques sur chaque table synchronisée**, non répétées dans les tableaux ci-dessus :
- `server_updated_at` : fixée par le serveur à chaque changement — l'heure des téléphones n'est pas fiable. C'est elle qui permet de répondre à « qu'est-ce qui a changé depuis ma dernière synchronisation ? » ;
- `deleted_at` : marque un enregistrement supprimé, qu'on garde pour que les téléphones l'apprennent. Toutes les contraintes d'unicité ignorent les lignes supprimées : sinon, un prix négocié supprimé ne pourrait jamais être ressaisi.

**Chaque téléphone ne reçoit que ce que son utilisateur a le droit de voir** (voir 10.1) :
- propriétaire, gérant et vendeur : les données de leur organisation ;
- livreur : les commandes à livrer, ses livraisons et les clients concernés. Pour vérifier le plafond hors ligne, son téléphone ne reçoit, pour chaque client, que le crédit disponible (plafond moins solde) : le serveur l'envoie à la place du solde et du plafond, si bien que la vérification reste la même. Tout ce qui arrive sur un téléphone se lit dans sa base : un livreur qui connaîtrait la dette d'une cliente pourrait l'appeler pour se la faire payer sur son propre numéro ;
- particulier : ses fournisseurs, ses commandes, son compte et ses propres prix.

**Le téléphone garde l'essentiel, pas tout l'historique** : tous les clients, le catalogue, les commandes en cours, et les 90 derniers jours du reste. Au-delà, l'historique se consulte en ligne. Tout ce qui dépend de tout l'historique est donc calculé par le serveur : le solde de chaque relation (`CustomerRelationship.balance`) et l'argent détenu de chaque collaborateur (`Collaboration.amount_held`). Hors ligne, le téléphone y ajoute seulement ses propres opérations pas encore envoyées, si bien qu'après une vente à crédit, le solde affiché est déjà à jour.

**Quand les droits changent, le téléphone repart de zéro.** Quand les droits d'une personne changent — collaboration ajoutée ou révoquée, rôle changé, relation corrigée ou contestée —, ses données, elles, ne changent pas : la synchronisation ordinaire, qui ne transmet que ce qui a changé, ne verrait rien passer. Un collaborateur révoqué garderait des données, et un vendeur promu ne recevrait jamais les fiches anciennes. D'où une règle unique : le serveur incrémente le compteur de droits de la personne (`Person.scope_version`), et tout téléphone qui connaît une valeur plus ancienne se resynchronise entièrement. Le même chemin sert après un refus (voir 9.2).
1. Le téléphone envoie d'abord ses opérations en attente. **Il n'efface rien avant que le serveur ait tout reçu** : si l'envoi échoue (réseau coupé, application trop ancienne), la resynchronisation attend.
2. Il efface ses données, puis retélécharge tout ce à quoi il a droit, comme à la première installation.

*On ne peut ainsi oublier aucune table, et ce chemin est celui de chaque installation, donc testé en permanence. Pour l'utilisateur, un message « Mise à jour de vos données… » s'affiche quelques instants, rarement. Les signalements « À résoudre » réapparaissent à l'identique, puisqu'ils sont gardés sur le serveur ; ceux qui portent sur des données que la personne ne voit plus restent chez le propriétaire, qui voit déjà tous les écarts (voir 9.2).*

**Un client ajouté hors ligne ne crée jamais de doublon.**
- *Le téléphone ne crée jamais de `Person` : il inscrit le numéro saisi sur la fiche client (`CustomerRelationship.customer_phone_number`), et le serveur retrouve ou crée la personne (voir 1.1).*
- *Si la boutique a déjà une fiche pour ce numéro — parce que deux téléphones ont ajouté la même cliente sans réseau —, le serveur réunit les deux dès leur arrivée : les ventes et paiements de la fiche en double sont enregistrés sur la première, qui garde ses réglages, sans réécrire aucune écriture déjà enregistrée. La fiche en double disparaît, avec un renvoi vers la fiche restante (`merged_into_id`), qui redirige ce qui arriverait encore à son nom. Une ligne d'information s'affiche : « Mme Ngono ajoutée deux fois : fiches réunies ».*
- *Ce n'est pas la fusion de deux identités, que le modèle interdit (voir 2.3) : les deux fiches désignent le même numéro chez le même fournisseur, et l'une n'aurait jamais dû exister.*
- *Un prix négocié saisi deux fois : le dernier arrivé remplace le premier, sans jamais bloquer l'envoi (voir 9.2).*

---

## 10. Accès et sécurité

### 10.1 La couche d'accès et la table des règles
Toute lecture et toute écriture passe par une couche unique d'Express — routes en ligne comme lignes reçues par la synchronisation —, qui applique la règle de cloisonnement (voir 2.1) et décide de ce que reçoit chaque téléphone (voir 9.6). Aucune route n'interroge la base directement.

**La table des règles.** Toutes les règles d'accès tiennent dans un seul fichier, rangé dans un paquet TypeScript partagé par l'application et le serveur. Chaque ligne est une règle, avec quatre questions (voir l'annexe) :
1. **Qui** : le rôle minimum pour une opération ou un champ ; les champs calculés sont marqués « serveur ».
2. **Où** : toujours ; jusqu'à 3 jours sans synchronisation, limite appliquée par le téléphone et seulement contrôlée par le serveur ; en ligne seulement ; ou réseau obligatoire, même pour le propriétaire.
3. **Étapes** : pour chaque statut, les statuts suivants permis, ce qui l'emporte et ce qui est figé.
4. **Contrôles** : les vérifications faites à l'arrivée, qui produisent des écarts.

Changer une règle revient à changer une ligne : le bouton disparaît du téléphone, et le serveur refuse l'opération, sans autre code.

**Le moteur : CASL.** La table est évaluée par CASL (`@casl/ability`, version 7, avec `createMongoAbility`), bibliothèque d'autorisation éprouvée, qui fonctionne à l'identique dans l'application et sur le serveur. Notre propre code se réduit à choisir les lignes qui s'appliquent au rôle et à la situation ; CASL fait le reste. Tout ce qui n'est pas écrit dans la table est refusé : CASL refuse par défaut. Restent dans notre code, écrits une seule fois pour toutes les tables : la règle « la livraison l'emporte », les contrôles, la resynchronisation complète, la réunion des doublons, et les contrôles de version et d'heure.

**Ordre des rôles.** Du moins au plus de droits : livreur, vendeur, gérant, propriétaire. Une fonction unique, `atLeast(role, minimum)`, fait toutes les comparaisons et refuse explicitement tout rôle inconnu : une erreur retombe toujours du côté du refus.

**Le serveur seul décide.** Sur le téléphone, les règles ne servent qu'à afficher ou masquer les boutons ; un téléphone trafiqué pourrait les ignorer, mais le serveur juge chaque ligne reçue (voir 9.2) et chaque route en ligne.

**Hors ligne, un gérant travaille comme un vendeur.** Ses pouvoirs de gérant — accorder du crédit, changer un prix ou le catalogue, faire un avoir, rendre de l'argent, annuler une écriture, reprendre un cahier, noter une dépense, confirmer une remise, corriger un numéro — empruntent une route en ligne : le serveur vérifie son rôle à cet instant, et chacune reçoit l'heure du serveur, impossible à falsifier. Une rétrogradation prend donc effet immédiatement pour tout cela. Le propriétaire, qui ne peut être ni rétrogradé ni révoqué, garde tous ses pouvoirs hors ligne, sauf l'équipe, le transfert de propriété et l'abonnement : ces gestes changent les droits des autres, et doivent prendre effet au moment où ils sont faits, non quand son téléphone se synchronise. Sans réseau, leur bouton affiche « Connexion nécessaire ».

**Personne n'est juge sur sa propre fiche.** Sur une relation dont il est le client — lui-même, ou une organisation cliente dont il est collaborateur —, un collaborateur n'a que les droits d'un client : plafond, prix négocié, avoir, argent rendu, annulation et reprise de cahier y sont réservés au propriétaire. Exemple : Jean, gérant, achète aussi pour sa famille ; il ne peut ni se fixer un prix négocié, ni relever son propre plafond. C'est une vérification du serveur, sans champ.

**Un geste en ligne ne compte qu'une fois.** Chaque geste en ligne porte l'identifiant créé par le téléphone au moment du geste, comme tout enregistrement du modèle. Si le serveur reçoit deux fois le même identifiant — sa réponse s'est perdue sur un réseau faible, et le téléphone réessaie —, il ne refait rien et renvoie le résultat de la première fois. Sans cela, un « Retour remboursé » de 10 000 réessayé après une réponse perdue sortirait 20 000.

**Tests.** Une table de tests couvre chaque combinaison de rôle, de situation et d'opération, avec le résultat attendu, y compris les refus et le rôle inconnu ; elle s'exécute à chaque modification. D'autres tests vérifient qu'une personne n'obtient jamais les données d'une autre organisation.

*Ces choix suivent les recommandations de l'OWASP, dont le contrôle d'accès défaillant est le risque n° 1 : contrôle côté serveur, refus par défaut, mécanisme unique réutilisé partout. Des vues PostgreSQL — lignes filtrées selon la personne connectée, colonnes privées masquées — pourront renforcer le cloisonnement en v2.*

### 10.2 `OtpChallenge`
Code de vérification envoyé par SMS ou par email.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person, nullable | La personne concernée ; vide pour l'inscription d'un numéro inconnu |
| target | string | Le numéro (E.164) ou l'email qui reçoit le code : au changement de numéro, c'est le nouveau numéro |
| purpose | enum `[REGISTRATION / LOGIN / PASSWORD_RESET / PHONE_CHANGE / EMAIL_VERIFICATION / TOTP_RECOVERY]` | Usage du code |
| channel | enum `[SMS / EMAIL]` | `SMS` par défaut. `EMAIL` vers l'email vérifié de la personne, pour `PASSWORD_RESET` et `LOGIN` quand la puce est inaccessible, et pour `EMAIL_VERIFICATION` ; vers l'adresse de secours d'un administrateur pour `TOTP_RECOVERY` |
| code_hash | string | Le code, jamais stocké en clair |
| expires_at | datetime | 10 minutes après l'envoi |
| attempts | int | Essais faits, 5 au plus |
| consumed_at | datetime, nullable | Utilisation du code ; un code ne sert qu'une fois |
| created_at | datetime | |

*Usages : `REGISTRATION` à l'inscription ; `LOGIN` à chaque saisie du mot de passe (anciennement `NEW_DEVICE`, quand seule la première connexion sur un téléphone le demandait), par SMS ou, si la puce est inaccessible, par email vérifié ; `PASSWORD_RESET` pour un mot de passe oublié, par SMS ou, si la puce est inaccessible, par email vérifié ; `PHONE_CHANGE` vers le nouveau numéro ; `EMAIL_VERIFICATION` pour confirmer un email, qui renseigne alors `Person.email_verified_at` (voir 1.1), ou l'adresse de secours d'un administrateur ; `TOTP_RECOVERY` pour réinstaller la double authentification d'un administrateur (voir 7.1). L'email vérifié est ainsi la seule voie sans la puce ; un code envoyé par email suit les mêmes limites d'envoi et d'essais qu'un SMS.*

*Index sur (`target`, `purpose`, `created_at`) : il permet de retrouver le code en cours et de limiter les envois. Les SMS partent par l'API d'un fournisseur local.*

**Protection contre la fraude aux SMS.** Des robots demandent des codes en masse, souvent vers des numéros surtaxés à l'étranger, et la plateforme paie chaque SMS : 10 000 demandes en une nuit, ce sont 10 000 SMS facturés.
- **Numéros camerounais seulement** : les SMS ne partent que vers les mobiles +237 ; la fraude vers l'étranger devient impossible.
- **Limites d'envoi** : 3 codes par heure et par numéro, une minute d'attente avant « Renvoyer le code », et des plafonds par téléphone et par adresse IP.
- **Plafond quotidien global**, avec une alerte à l'équipe s'il est atteint.
- **Play Integrity** sur chaque demande de code (voir 10.5).

### 10.3 `Device`
Un téléphone sur lequel une personne s'est connectée : **un téléphone, une session**. Chaque connexion ouvre une nouvelle fiche, puisque le serveur ne cherche pas à reconnaître un téléphone déjà connu (voir 1.1) ; « Mes appareils » ne montre que les sessions ouvertes.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | |
| platform | enum `[ANDROID / IOS]` | |
| model | string, nullable | Nom de l'appareil, affiché dans « Mes appareils » (ex : « Tecno Spark 20 ») |
| push_token | string, nullable | Jeton de notification push (Firebase Cloud Messaging, gratuit) : sans lui, une notification ne serait vue qu'en ouvrant l'application |
| app_version | string | Version de l'application, contrôlée à chaque synchronisation (voir 9.3) |
| last_synced_at | datetime, nullable | Dernière synchronisation, **à l'heure du serveur**. Alimente l'indicateur du propriétaire et le repérage des longues absences (voir 9.2 et 9.3) |
| scope_version_seen | int | Dernier compteur de droits connu du téléphone ; plus ancien que `Person.scope_version`, il déclenche la resynchronisation complète (voir 9.6) |
| integrity_verdict | string, nullable | Dernier verdict Play Integrity observé (voir 10.5) |
| created_at | datetime | Connexion qui a ouvert cette session |
| revoked_at | datetime, nullable | Déconnexion de ce téléphone, seul ou avec tous les autres |

*Ce que la fiche apporte :*
- *des **notifications instantanées et gratuites** — nouvelle commande, commande acceptée, crédit accordé —, seul canal instantané depuis le retrait des SMS de notification ;*
- *l'**alerte de nouvelle connexion** envoyée aux autres téléphones de la personne (voir 1.1) ;*
- *un écran **« Mes appareils »**, pour déconnecter un seul téléphone ;*
- *la **dernière synchronisation** de chaque collaborateur, pour le propriétaire : « Paul : synchronisé il y a 3 jours ».*

### 10.4 `RefreshToken`
Jeton de renouvellement d'une session.

| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | |
| device_id | FK → Device | Le téléphone de la session ; remplace `family_id` : tous les jetons d'une même connexion partagent ce téléphone |
| token_hash | string, **unique** | Le jeton, jamais stocké en clair |
| expires_at | datetime | 90 jours, prolongés à chaque utilisation |
| created_at | datetime | |
| rotated_at | datetime, nullable | Le jeton a servi et a été remplacé par un nouveau, pour le même téléphone |
| revoked_at | datetime, nullable | |
| revoked_reason | enum `[LOGOUT / DEVICE_REMOVED / LOGOUT_ALL / REUSE_DETECTED / PASSWORD_RESET / ACCOUNT_SUSPENDED]`, nullable | Motif de la révocation |

*Le jeton d'accès (JWT) vaut 15 minutes et n'est pas stocké. À chaque renouvellement, le jeton utilisé est marqué `rotated_at`, et un nouveau jeton, pour le même téléphone, le remplace. Si un jeton déjà utilisé réapparaît (`REUSE_DETECTED`), seule la session de ce téléphone est révoquée, pas tous les appareils. Sur le téléphone, les jetons sont gardés dans le coffre sécurisé du système (Keystore sur Android, Keychain sur iPhone).*

*Motifs : `LOGOUT` pour une déconnexion ; `DEVICE_REMOVED` pour un téléphone déconnecté depuis « Mes appareils » ; `LOGOUT_ALL` pour « Déconnecter tous mes appareils » ; `PASSWORD_RESET` quand le mot de passe change ou est réinitialisé ; `ACCOUNT_SUSPENDED` quand la personne est suspendue (`Person.status`, voir 6.1).*

### 10.5 Connexion, verrouillage et téléphone perdu
- **Connexion** : mot de passe et code (`LOGIN`), par SMS ou, si la puce est inaccessible, sur l'email vérifié, à chaque saisie du mot de passe ; puis alerte aux autres téléphones connectés (voir 1.1).
- **Verrouillage** : après **15 minutes d'inactivité**, l'application se déverrouille avec ce qui déverrouille déjà le téléphone — schéma, code, empreinte ou visage —, par la fenêtre du système : rien de nouveau à retenir. Android et iOS le permettent nativement (en React Native, par exemple avec expo-local-authentication). Tant qu'on s'en sert, aucun verrou : une vente au comptoir n'est jamais ralentie. Sur un téléphone sans aucun verrou, l'application demande le mot de passe du compte, et invite à activer un verrou, plus pratique. Limite assumée : le verrou de l'application vaut celui du téléphone ; un proche qui connaît le schéma pourra l'ouvrir. Contre la perte ou le vol, le vrai risque, c'est suffisant.
- **Hors ligne** : le travail continue ; le téléphone d'un collaborateur passe en mode restreint après 3 jours sans synchronisation (voir 9.3). Après 90 jours sans connexion, il faut ressaisir son mot de passe, avec un code ; les données pas encore envoyées restent sur le téléphone et partent ensuite.
- **Téléphone perdu** : depuis un autre téléphone, « Mes appareils » permet de déconnecter celui-là, ou tous. Le téléphone perdu est refusé à sa prochaine connexion, et efface alors ses données ; d'ici là, le verrouillage le protège. Sans autre téléphone, le titulaire se connecte sur un nouveau téléphone — avec sa puce remplacée par l'opérateur, ou son email vérifié —, puis déconnecte le téléphone perdu depuis « Mes appareils ».
- **Collaborateur révoqué** : son téléphone efface les données de l'organisation à la synchronisation suivante, après avoir envoyé ce qui était en attente (voir 9.6).

**Play Integrity.** Google Play Integrity fournit au serveur un verdict sur l'intégrité de l'application et de l'appareil : il permet de savoir si une demande vient de notre application authentique ou d'une copie modifiée, qui contournerait les garde-fous du téléphone. Les demandes de verdict sont plafonnées par défaut à 10 000 par jour pour l'ensemble des installations : on les réserve aux moments clés — connexion d'un nouveau téléphone, demande de code SMS, opération sensible en ligne. Comme Google le conseille, on observe d'abord les verdicts sans rien bloquer, pour mesurer l'effet ; puis on refuse les demandes venant d'une application modifiée. Les téléphones sans services Google, comme certains Huawei, sont signalés, jamais bloqués. Sur iPhone, l'équivalent est App Attest d'Apple.

### 10.6 La base de données, dernier rempart
**Jamais exposée.** Quel que soit l'hébergeur, seule l'application Express joint la base, par une connexion chiffrée. Il n'y a ni accès public, ni API générée automatiquement ; si un hébergeur en fournit une d'office, on la désactive au déploiement — c'est un point de la liste de mise en production, pas une règle du modèle.

**Deux comptes PostgreSQL.**
- **Un compte de migration**, propriétaire des tables, qui les crée et ne sert qu'aux mises à jour et à la maintenance (dont la purge des données expirées, voir 11).
- **Un compte applicatif**, pour Express, limité au strict nécessaire. Sur les tables immuables — `LedgerEntry`, `SyncArchive`, `PhoneNumberChangeLog`, `CustomerRelationshipReassignment`, `CreditLimitChange`, `AdminAction` —, il peut seulement ajouter et lire des lignes : PostgreSQL refuse lui-même toute modification ou suppression. Il ne peut ni supprimer ni modifier une table.

*Exemple : si un bug tentait de transformer le paiement de 30 000 de Mme Ngono en 3 000, PostgreSQL répondrait « permission refusée ». Même en cas de faille dans le code, un compte ne peut pas être réécrit.*

**Aucune dépendance à un hébergeur.** Le modèle n'utilise que du PostgreSQL standard, et l'authentification est faite dans Express : la base peut être hébergée où l'on veut, sans rien changer — sous réserve des règles camerounaises sur l'hébergement des données (voir 11.1).

---

## 11. Données personnelles et conservation

### 11.1 Cadre juridique : le Cameroun
La loi n° 2024/017 du 23 décembre 2024 relative à la protection des données à caractère personnel est entrée en vigueur le 23 juin 2026, à l'issue d'un délai de grâce de 18 mois. Elle remplace, pour ce modèle, les références de la v7 au Sénégal et à la Côte d'Ivoire.

**Quatre points à faire valider par un juriste camerounais avant le lancement :**
1. **Hébergement** : la loi encadre strictement le transfert hors du territoire des données des citoyens camerounais, y compris leur hébergement sur des serveurs à l'étranger. Le modèle ne dépend d'aucun hébergeur (voir 10.6) : on peut héberger au Cameroun, ou à l'étranger avec les garanties exigées.
2. **Consentement** : la loi exige un consentement explicite, libre et éclairé. Pour les utilisateurs inscrits, il se recueille à l'inscription. Reste le cas des clients ajoutés par un commerçant sans avoir l'application : leur numéro et leur dette sont enregistrés sans qu'ils en soient informés, surtout depuis le retrait de l'alerte SMS. La base légale de ce traitement est à confirmer.
3. **Durées de conservation** : celles de 11.2.
4. **Formalités** à accomplir auprès de l'autorité de protection prévue par la loi.

*Messages : la plateforme n'envoie plus que les codes de vérification, demandés par la personne elle-même. La question des messages non sollicités ne se pose plus.*

*Droit comptable : l'Acte uniforme OHADA relatif au droit comptable impose de conserver livres comptables et pièces justificatives pendant dix ans. Les données commerciales tenues par l'application en relèvent pour les commerçants.*

### 11.2 Durées de conservation
Une loi sur les données personnelles impose de ne garder chaque donnée que le temps nécessaire.

| Données | Durée | Raison |
|---|---|---|
| Données commerciales et journaux : relations, commandes et lignes, livraisons, écritures, dépenses, remises, prix négociés, réaffectations, changements de plafond, changements de numéro, actions d'administration, signalements | Au moins 10 ans, et tant que le compte existe | Droit comptable OHADA |
| Notifications | 24 mois | Utiles le temps d'être lues ; l'historique des plafonds a son propre journal (voir 2.4) |
| Archives de synchronisation (`SyncArchive`) | 90 jours | Même durée que l'historique gardé sur les téléphones |
| Codes de vérification, jetons expirés ou révoqués | 30 jours | Utiles seulement contre les abus récents |

*Une personne qui supprime son compte est anonymisée, comme en v7 (voir 1.1) : ses données personnelles sont effacées, et l'historique commercial des organisations reste, sans elle.*

*La purge des données expirées est faite chaque jour par le compte de migration, le compte applicatif ne pouvant rien supprimer dans les tables immuables (voir 10.6).*

---

## Schéma relationnel simplifié (vue d'ensemble)

```
Person (inscrite ou non ; registered_at vide = invité ; scope_version)
   ├── Collaboration (rôle fixe : OWNER / MANAGER / SELLER / DRIVER ; contact public éventuel ; argent détenu)
   ├── CustomerRelationship (cliente : customer_person_id ; fournisseur invité : supplier_person_id)
   ├── PhoneNumberChangeLog
   ├── Device ── RefreshToken (un téléphone, une session)
   ├── OtpChallenge (codes de vérification)
   ├── Notification
   ├── SyncArchive (lots reçus)
   ├── Administrator ── AdminAction (journal des actions d'administration)
   ├── Report (en tant que reporter)
   ├── Delivery (en tant que livreur)
   ├── Expense (paid_by) · Handover (from / to)
   └── *_by_id (created_by, entered_by, delivered_by, cancelled_by, recorded_by,
                price_set_by, set_by, credit_limit_set_by, reassigned_by)

Organization ──┬── Collaboration (dont une seule OWNER : la propriété)
                ├── CustomerRelationship (fournisseur : ses clients et ses comptoirs ; client : ses fournisseurs)
                ├── Product (ses articles : unité, prix, quantité minimale)
                ├── Expense · Handover (argent détenu)
                ├── Notification (contexte optionnel)
                └── Subscription (historique des souscriptions)

CustomerRelationship (fournisseur → client, compte et solde) ──┬── CustomerPrice ── Product
                                                                ├── CustomerRelationshipReassignment
                                                                ├── CreditLimitChange (journal des plafonds)
                                                                ├── LedgerEntry (ventes, paiements, argent rendu, avoirs, reprises de cahier)
                                                                └── Order ──┬── OrderLine ── Product
                                                                            ├── Delivery (0 à n : une par tentative, aucune sans livreur)
                                                                            ├── Order (reste d'une livraison partielle, parent_order_id)
                                                                            └── LedgerEntry.order_id (vente et paiement nés de la livraison)
```

---

## Contraintes à poser au niveau base de données

| Contrainte | Portée |
|---|---|
| Identifiants en `uuid` (UUIDv7) ; montants en `bigint` ; quantités en `numeric(12,3)` ; horodatages en `timestamptz` | Des fondations sans ambiguïté, validées par la base |
| `Person.phone_number` unique — contrainte ordinaire, PostgreSQL ignorant les valeurs nulles — et au format E.164 (`CHECK` sur `^\+[1-9][0-9]{7,14}$`) ; exactement un de `phone_number` / `released_phone_number` renseigné ; `status = ANONYMIZED` ⇒ `phone_number` vide | Fondement de la réutilisation sans fusion ; une personne a toujours un numéro, actif ou libéré |
| `Person` : `registered_at` renseigné et `status ≠ ANONYMIZED` ⇒ `full_name` et `password_hash` renseignés, et `phone_verified_at` renseigné si `phone_number` l'est ; `phone_number` vide ⇒ `phone_verified_at` vide ; `email` vide ⇒ `email_verified_at` vide | Une personne inscrite est complète, sauf une fois anonymisée ; un inscrit peut perdre son numéro au profit de son nouveau titulaire ; les dates de vérification sont cohérentes |
| Colonnes d'auteur (`*_by_id`, `Delivery.assigned_to_id`, `Report.reporter_id`, `Administrator.person_id`, `Handover.to_person_id`) : la personne est inscrite ; `Report.resolved_by_id` et `AdminAction.administrator_id` désignent un `Administrator` | Un invité ne peut pas agir ; une action d'administration a toujours un administrateur pour auteur |
| `Collaboration` unique (`person_id`, `organization_id`) ; `status = ACTIVE` ⇒ la `Person` est inscrite ; exactement une `OWNER` active par organisation ; `is_public_contact` ⇒ `status = ACTIVE` et numéro actif | Rôles fixes ; seule trace de la propriété ; numéros publics vérifiés |
| `CustomerRelationship` : exactement un fournisseur ; au plus un client, aucun uniquement pour un comptoir, dont `customer_label` est alors obligatoire ; `customer_phone_number` vide dès que `customer_person_id` est renseigné | Contreparties sans ambiguïté ; comptoirs nommés ; la personne toujours résolue par le serveur |
| `CustomerRelationship` : au plus une relation vivante par couple (index uniques partiels par combinaison de colonnes, lignes supprimées ou réunies exclues) ; `merged_into_id` renseigné ⇒ ligne supprimée ; `supplier_organization_id <> customer_organization_id` | Pas de doublon, pas de relation d'une organisation avec elle-même |
| `CustomerRelationship` : `status = PENDING` ⟺ `supplier_person_id` renseigné (v1) | Seule l'invitation d'un fournisseur attend ; aucune transaction avec un fournisseur non inscrit |
| `CustomerRelationship.ended_by_party` renseigné ⟺ `status = ENDED` ; seule cette partie rouvre la relation | Un blocage ne se lève pas par la personne bloquée |
| `CustomerRelationship.credit_limit` : 0 à la création ; toujours 0 pour un comptoir ; `credit_limit_set_by_id` et `credit_limit_set_at` renseignés ensemble ; chaque changement ajoute une ligne à `CreditLimitChange`, dans la même transaction | Le crédit s'accorde, il ne se présume pas ; chaque plafond a un auteur, et tout l'historique est gardé |
| `CustomerPrice` unique (`customer_relationship_id`, `product_id`) parmi les lignes non supprimées ; article du fournisseur de la relation | Cohérence du prix négocié |
| `CustomerRelationshipReassignment` : `previous_person_id` et `new_person_id` renseignés ; aucune relation existante entre la nouvelle personne et le même fournisseur ; une seule contestation par relation et par personne ; aucune modification ni suppression | Traçabilité sans fusion ; pas de contestation en boucle |
| `Product.price > 0` ; `min_order_quantity > 0` s'il est renseigné ; `price_updated_at` fixé par le serveur à chaque changement de prix | Un article se vend à un prix ; les ventes à l'ancien prix se reconnaissent |
| `Order` : relation `ACTIVE` à la création, dont le fournisseur est une organisation active — ni suspendue, ni fermée (v1) | Pas de commande hors d'une relation vivante, ni chez un commerce fermé |
| `Order` : chaque ligne porte sur un article `ACTIVE` du fournisseur de la relation ; sur une commande passée par le client, `quantity ≥ min_order_quantity` à l'envoi | Règle unique des lignes ; quantité minimale |
| `Order` : `cancelled_by_party`, `cancelled_by_id` et `cancelled_at` renseignés ⟺ `status = CANCELLED` ; `cancellation_reason` renseigné seulement si `CANCELLED`, et obligatoire quand `cancelled_by_party = SUPPLIER` | Qui a annulé ou refusé, quand et pourquoi |
| `Order` : `status = PENDING` ⇒ `placed_by_party = CUSTOMER` | Une commande saisie par le fournisseur naît confirmée |
| `Order` : changements de statut limités aux étapes permises ; la livraison l'emporte ; commande livrée ou annulée figée, sauf `supplier_note` (appliqué par le serveur, voir 9.2 et l'annexe) | Le statut suit ce qui s'est réellement passé |
| `Order` : `delivered_at` et `delivered_by_id` renseignés ⟺ `status = DELIVERED` ; chaque ligne porte alors `delivered_quantity` ; `total_amount` = Σ `OrderLine.amount` + `delivery_cost` | Dates, auteurs, quantités et montants de vente fiables |
| `OrderLine` : `amount` = quantité × prix appliqué, arrondi au franc (0,5 vers le haut), recalculé par le serveur ; sur une commande passée par le client, `unit_price_applied = reference_price` à l'envoi, puis jamais au-dessus ; `price_set_by_id` et `price_set_at` renseignés ⟺ `unit_price_applied ≠ reference_price` | Un seul arrondi ; le fournisseur ne peut que baisser ; tout écart a un auteur et une date |
| `Delivery` : `assigned_to_id` collaborateur actif du fournisseur, livreur ou plus ; `arrived_at` et `failed_at` jamais renseignés ensemble ; `failure_reason` renseigné ⟺ `failed_at` renseigné ; au plus une livraison en cours par commande (index unique partiel sur `order_id` où les deux sont vides) | Une tentative à la fois, chaque échec motivé |
| `Delivery` : une livraison pas encore partie est supprimée si sa commande est annulée ou livrée sans elle ; en cas de départs croisés, le serveur garde le premier et enregistre l'autre close | Rien ne traîne ; une seule livraison par départ |
| `LedgerEntry.amount > 0` ; `balance_effect` colonne générée à partir de `kind`, `amount` et `reverses_entry_id` ; `mode` renseigné ⟺ `kind` ∈ (`PAYMENT`, `REFUND`) | Le sens est porté par le type ; personne ne peut se tromper de signe |
| `LedgerEntry` : `kind = SALE` ⇒ `order_id` renseigné, `amount` = `Order.total_amount` (fixé par le serveur), au plus une vente non annulée par commande ; `order_id` obligatoire pour le paiement né de « Commande livrée » | Une vente par commande livrée, du montant exact de la commande ; imputation sans ambiguïté |
| `LedgerEntry` : aucune modification ni suppression ; `reverses_entry_id` unique, même relation, même type, même montant, pointant une écriture qui n'est pas elle-même une annulation | Immutabilité, annulation |
| Vente sur un comptoir : encaissement intégral | Aucun crédit anonyme |
| `Expense.amount > 0`, `paid_by_id` collaborateur du commerce, actif ou parti ; `Handover.amount > 0`, `from_person_id` collaborateur du commerce, actif ou parti, `from_person_id <> to_person_id` sauf la remise automatique de l'ancien propriétaire à lui-même au transfert de propriété, `to_person_id` `OWNER` ou `MANAGER` actif de l'organisation ; aucune modification, sinon l'annulation : `cancelled_at` et `cancelled_by_id` renseignés ensemble, une seule fois | Argent détenu traçable |
| `Report` : exactement une cible renseignée | Deux colonnes nullables plutôt qu'un discriminant |
| `Administrator.totp_secret` obligatoire ; `recovery_email` différente de `Person.email` ; `AdminAction` : exactement une cible renseignée, `reason` obligatoire, `sync_archive_id` renseigné ⟺ `action = REPLAY_SYNC` (réservé à un `SUPER_ADMIN`), aucune modification ni suppression | Administration protégée et tracée |
| `Notification` : destinataire inscrit ; `related_entity_type` et `related_entity_id` renseignés ensemble ou ni l'un ni l'autre | Cohérence de la seule référence polymorphe |
| `Subscription` unique partiel sur `organization_id` où `status = ACTIVE` | Un seul abonnement actif par organisation |
| `SyncArchive`, `PhoneNumberChangeLog` : aucune modification ni suppression, hors purge après la durée de conservation | Archives et journaux fidèles |
| `OtpChallenge` : `attempts ≤ 5` ; un code consommé ou expiré ne sert plus ; SMS seulement vers les numéros +237 ; `channel = EMAIL` ⇒ `target` est l'email de la personne, ou l'adresse de secours d'un administrateur, déjà vérifiés sauf pour `EMAIL_VERIFICATION` | Codes à usage unique, non devinables par essais ; pas de fraude vers l'étranger ; secours par email seulement vers une adresse confirmée |
| `Device` : `last_synced_at` et `scope_version_seen` fixés par le serveur ; `RefreshToken.token_hash` unique ; `revoked_reason` renseigné ⟺ `revoked_at` renseigné | Sessions par téléphone, révocables et traçables |
| Tables synchronisées : `server_updated_at` fixée par le serveur à chaque changement ; suppression par `deleted_at` ; toutes les contraintes d'unicité ignorent les lignes supprimées | Synchronisation WatermelonDB fiable ; une ligne supprimée ne bloque jamais sa recréation |
| Synchronisation : aucune contrainte d'unicité ne fait échouer un envoi ; chaque doublon possible a sa conduite écrite, et une ligne qu'aucune règle ne sait écrire est mise de côté (voir 9.2) | Un téléphone n'est jamais bloqué |
| Caches `CustomerRelationship.balance` et `Collaboration.amount_held` : mis à jour par ajout de l'effet de chaque opération, dans sa transaction ; deux caches toujours dans l'ordre client puis collaborateur ; contrôle de nuit contre la somme des effets | Aucun total faussé par deux envois simultanés |
| Routes en ligne : chaque geste porte l'identifiant créé par le téléphone ; un identifiant déjà reçu ne refait rien | Un geste ne compte qu'une fois |
| Tables immuables (`LedgerEntry`, `SyncArchive`, `PhoneNumberChangeLog`, `CustomerRelationshipReassignment`, `CreditLimitChange`, `AdminAction`) : le compte applicatif n'a que les droits `INSERT` et `SELECT` | L'immuabilité garantie par la base elle-même |

*Mise en œuvre : index uniques partiels, `CHECK`, colonnes générées, vérifications inter-tables et droits des comptes ne sont pas tous exprimables dans le schéma Prisma. Ils sont écrits dans une migration SQL dédiée, versionnée à côté du schéma, et posés par le compte de migration ; le compte applicatif n'a que les droits nécessaires (voir 10.6). Côté WatermelonDB, ces contraintes n'existent pas localement : c'est le serveur qui les applique à réception (voir 9.2). Soldes, argent détenu, effets des écritures, totaux, montants de ligne et montant des ventes sont toujours calculés par le serveur ; seuls le prix de référence d'une vente saisie hors ligne et les dates des opérations viennent du téléphone, et sont contrôlés à leur arrivée.*

---

## Notes de conception

- **Deux éléments pour l'utilisateur : ses clients et ses fournisseurs** : une seule entité, `CustomerRelationship`, lue des deux côtés, qui porte le compte et son solde. Commandes et écritures pointent vers la relation.
- **Organisations sans type** : une organisation est fournisseur ou cliente selon la relation, et peut être les deux. Une activité hybride tient dans une seule organisation, avec un seul catalogue et un seul abonnement.
- **Acheter n'implique pas de revendre** : un restaurant ou un bureau est un client comme un autre. Le catalogue d'une organisation ne contient que ses propres articles ; un revendeur copie d'un geste ce qu'il achète, et les chaînes de revente fonctionnent sans règle particulière.
- **Le numéro comme seule clé** : on ajoute un client par son numéro, on trouve un fournisseur par le sien ; découverte et invitation ne font qu'un geste. Ni annuaire, ni lien, ni QR, ni lecture du répertoire. Chaque numéro est normalisé au format E.164 : sans cela, un même client deviendrait plusieurs personnes. Les recherches par numéro sont limitées, pour que personne ne collecte en masse les noms des inscrits ou les numéros des commerces ; un numéro recyclé donne un compte neuf à son nouveau titulaire.
- **Une relation active d'emblée, pour tout client** : plafond à 0 et prix des articles, si bien que rien n'engage une partie sans son propre geste. Seule l'invitation d'un fournisseur attend son acceptation.
- **Invitations dans les deux sens, depuis le téléphone de celui qui invite** : gratuites pour la plateforme et plus crédibles, le destinataire reconnaissant l'expéditeur. L'invitation reste enregistrée sur le serveur et attend son destinataire.
- **Des numéros publics vérifiés** : ceux de collaborateurs qui acceptent de représenter l'organisation, le propriétaire par défaut. Personne ne peut se faire trouver sous le numéro d'un autre.
- **Le crédit s'accorde, il ne se présume pas** : plafond à 0 à la création ; une seule règle partout où la marchandise est livrée, invisible tant qu'elle ne bloque pas ; seuls le propriétaire et le gérant — en ligne — accordent du crédit, y compris au moment d'une vente ; chaque plafond a un auteur, chaque changement s'inscrit au journal des plafonds, et le propriétaire est prévenu quand un gérant l'accorde. Hors ligne, le téléphone vérifie ; le serveur n'annule jamais une livraison, il signale l'écart au propriétaire.
- **Les prix appartiennent au vendeur et se négocient** : un prix par article, valable pour tous ; un prix négocié par article et par client, qui l'emporte toujours, plus bas ou plus haut, car le prix dépend du lieu. Dans une chaîne A → B → C, C se voit proposer le prix de B.
- **Des prix qui ne changent pas à l'insu du client** : le client ne saisit jamais de prix ; sur ses commandes, le fournisseur ne peut que baisser ; les prix se figent quand la commande cesse d'être modifiable ; le prix de référence est figé à côté du prix appliqué, l'écart reste visible des deux côtés, avec son auteur et sa date. Une vente faite hors ligne à l'ancien prix n'est pas comptée comme une remise : elle est signalée, avec la date du changement.
- **Montants en entiers, un seul arrondi** : le franc CFA n'a pas de centimes ; les montants sont des entiers, et le montant de chaque ligne est arrondi une seule fois, par une fonction partagée entre l'application et le serveur, puis figé. Un franc d'écart entre téléphone et serveur ne peut pas créer de dette fictive.
- **Une commande client minimale** : préparée hors ligne, envoyée en ligne, jamais modifiée ensuite ; acceptée ou refusée telle quelle, la négociation se concluant par une baisse de prix à l'acceptation.
- **Une seule façon de clore une commande : « Commande livrée »** : au comptoir, en boutique ou chez le client, par un vendeur, le propriétaire ou un livreur. Une fenêtre unique, deux touches dans le cas courant ; la vente, au montant fixé par le serveur, et le montant perçu entrent dans le compte, et le reste d'une livraison partielle se règle dans la même fenêtre.
- **Le statut suit la réalité** : il ne se fusionne jamais champ par champ ; seules les étapes permises s'appliquent, la livraison l'emporte toujours, et une commande livrée est figée, sauf la note du fournisseur.
- **La livraison, pour ceux qui livrent** : `Delivery` ne naît qu'au départ du livreur ou à son assignation, fonctionne hors ligne, garde le motif de chaque échec, et ne double pas le paiement.
- **Un solde plutôt que des dettes** : le modèle de l'ardoise, celui des carnets de crédit numériques. Le compte est une seule liste d'écritures immuables, ventes comprises, et le solde en est la simple somme. Aucune allocation à saisir, une avance est un solde négatif, et chaque commande affiche ce qui a été perçu à sa livraison, sans statut « payé » calculé. Un solde étant une somme, les écritures hors ligne ne peuvent pas se contredire.
- **Écritures immuables, sans exception, garanties par la base** : une erreur se corrige par annulation — une écriture inverse —, jamais par modification. Le sens d'une écriture est porté par son type, et son effet sur le solde est calculé par la base. Seul le fournisseur écrit dans le compte.
- **Compte et argent détenu** : le compte dit qui doit combien à qui ; l'argent détenu dit qui a l'argent en main dans une organisation, espèces et Mobile Money reçu sur son propre numéro, tenu par le serveur par ajout, et vérifié chaque nuit sur tout l'historique ; celui du propriétaire, compté mais jamais présenté, est remis automatiquement au commerce lors d'un transfert de propriété. Deux entités nommées pour ce qu'elles sont : `Expense`, de l'argent qui quitte l'entreprise, et `Handover`, de l'argent qui change de mains à l'intérieur. Le mot « caisse » n'est pas employé.
- **Rien ne sort sans que le propriétaire le voie** : les gestes qui font perdre de l'argent sans qu'aucun client ne réclame — argent rendu, dépenses, avoirs, annulations, écarts de prix — rejoignent ses écarts quand un autre que lui les fait, regroupés par personne avec leur montant, tout comme le reste abandonné d'une livraison partielle. Celui qui remet de l'argent est prévenu du montant noté par celui qui reçoit. Le contrôle reste par exception : un regard, et un appel en cas de doute.
- **Plus de SMS de notification** : notifications push gratuites pour les inscrits ; la plateforme n'envoie plus que les codes de vérification, demandés par la personne. L'alerte de dette des clients sans application est reportée en v2.
- **Le reçu, un affichage** : généré à la demande à partir de la commande, jamais stocké, partagé depuis le téléphone du commerçant, et proposé après chaque livraison à crédit.
- **Deux colonnes nullables plutôt qu'un discriminant** : partout où une référence ne peut viser que deux entités (personne ou organisation), le modèle utilise deux clés étrangères nullables avec un `CHECK` — dans `CustomerRelationship`, `Report` et `AdminAction`. Seule `Notification` conserve une référence libre, ses cibles étant ouvertes.
- **Rôles fixes, règles en table** : quatre rôles emboîtés, classés du moins au plus de droits, du livreur au propriétaire. Les permissions tiennent dans une table de règles, partagée par l'application et le serveur et évaluée par CASL ; tout ce qui n'y est pas écrit est refusé. Un commerçant ne raisonne pas en permissions.
- **Hors ligne, un gérant travaille comme un vendeur** : ses pouvoirs de gérant passent par une route en ligne, si bien qu'une rétrogradation prend effet immédiatement. Le propriétaire, qui ne peut être ni rétrogradé ni révoqué, garde tous ses pouvoirs hors ligne, sauf l'équipe, le transfert de propriété et l'abonnement, qui demandent toujours le réseau.
- **Adresses figées dans la commande** : l'adresse retenue est recopiée dans `Order.delivery_address_applied`. Même logique que `label_applied`, `reference_price`, `unit_price_applied` et `amount` : une commande passée ne change jamais rétroactivement.
- **Une seule fiche par personne** : `Person` répond à « qui est cette personne », et `registered_at` à « peut-elle se connecter ». `phone_verified_at` et `email_verified_at` disent explicitement ce qui est vérifié. Une personne est toujours créée par le serveur, jamais par un téléphone.
- **Une authentification simple et solide, sans dépendance** : mot de passe d'au moins 8 caractères, sans règles de composition, avec un code à chaque saisie du mot de passe, par SMS ou email vérifié, et une alerte aux autres téléphones connectés ; un email vérifié comme secours quand la puce est perdue, que l'application invite à ajouter ; déverrouillage par le verrou du téléphone après 15 minutes d'inactivité ; une fiche et une session par téléphone ; Play Integrity aux moments clés. Le tout dans Express et en PostgreSQL standard.
- **La base comme dernier rempart** : jamais exposée ; deux comptes PostgreSQL, le compte applicatif ne pouvant qu'ajouter et lire dans les tables immuables. Même une faille dans le code ne peut pas réécrire un compte.
- **Aucune dépendance à un hébergeur** : la base s'héberge où l'on veut, sous réserve des règles camerounaises sur l'hébergement des données.
- **Réutilisation globale des `Person`** : une seule `Person` par numéro actif, qu'il s'agisse d'un client ajouté, d'un fournisseur ou d'un collaborateur invité. Conséquence assumée : une organisation peut se rattacher silencieusement à une `Person` créée par une autre. C'est le prix de l'absence totale de fusion d'identités.
- **« Ce n'est pas moi »** : contestation relation par relation, à l'inscription ou plus tard ; la relation contestée passe à une personne fantôme au numéro libéré, et le fournisseur corrige. Couvre les erreurs de saisie et les numéros recyclés.
- **L'historique suit la relation (`CustomerRelationshipReassignment`)** : correction ou contestation ne modifient qu'une ligne, journalisée, sans aucune réécriture de clé étrangère ailleurs ; une relation ne se conteste qu'une fois. Le rattachement a disparu : une entreprise a sa propre relation, et une dette ne change jamais de débiteur par ce biais.
- **Équipe invitée par numéro, propriété transférable** : `Collaboration` vise une `Person`, si bien qu'un livreur s'ajoute par son numéro avant même de s'inscrire ; seule une personne inscrite peut agir. La propriété n'est portée que par la collaboration `OWNER` et se transfère sans recréer l'organisation.
- **Pas d'exclusivité client** : aucune règle n'empêche un client d'acheter le même produit à plusieurs fournisseurs. La protection porte sur l'information, dans les deux sens : un fournisseur ne voit pas les clients de ses clients, et un client ne voit pas le fournisseur de son fournisseur.
- **Cloisonnement inter-organisations** : relationnel et **absolu**, réduit à un prédicat, appliqué par une couche d'accès unique dans Express, à chaque route et à chaque ligne reçue. Les champs propres à une partie ne sont jamais transmis à l'autre, chaque partie n'écrit que ses propres champs, et un client ne reçoit du catalogue que ses propres prix. D'une personne, une organisation ne reçoit que son nom public, son numéro et le fait qu'elle soit inscrite ou non ; un livreur ne reçoit de ses clients que leur crédit disponible. Des vues PostgreSQL pourront le renforcer en v2.
- **Catalogue propre, un seul niveau** : chaque organisation possède ses articles (`Product`), qui portent unité, prix, quantité minimale et statut ; il n'existe ni gamme, ni variante, ni offre.
- **Pas de gestion de stock en v1** : ni quantités disponibles, ni mouvements, ni inventaire. Les quantités vendues et achetées se lisent sur les lignes des commandes livrées : un module de stock pourra revenir sans perte d'historique.
- **Cinq statuts de commande** : `PENDING` ne désigne que la commande d'un client en attente de réponse ; une commande saisie par le fournisseur naît `CONFIRMED` ; une livraison ratée ramène la commande en `CONFIRMED` ; une livraison partielle clôt la commande, et le reste peut devenir une nouvelle commande liée.
- **Livreur** : une personne en `Collaboration` avec le rôle `DRIVER`, inscrite. Le garde-fou financier n'est pas une permission mais le **chemin d'accès** : les seules écritures qu'un livreur peut produire sont la vente et le paiement nés de « Commande livrée » sur une livraison qui lui est assignée ; il n'accorde jamais de crédit, et ne saisit jamais sa propre remise.
- **Comptoirs** : les ventes anonymes vont sur des relations sans client, payées sur-le-champ ; une organisation peut en avoir plusieurs, chacun avec ses prix.
- **Retour ou échange après livraison** : aucun workflow dédié. Réduction de ce que doit le client → avoir ; remboursement en argent → « Retour remboursé », en un geste.
- **Abonnement et modération** : un abonnement par organisation, avec son historique. Un impayé fait retomber sur un plan gratuit, jamais sur un blocage ; seule une suspension décidée par un administrateur bloque une organisation, et elle est toujours tracée. Le propriétaire peut fermer son commerce : plus de nouvelle commande ni de nouveau client, l'historique reste.
- **Collaborateur également client** : sur sa propre fiche client, un collaborateur n'est qu'un client ; les gestes de gérant sur cette fiche reviennent au propriétaire, y compris quand il gère l'organisation cliente. `placed_by_party` et `cancelled_by_party` enregistrent la casquette sous laquelle il agit.
- **Synchronisation classique, jugée ligne par ligne** : WatermelonDB tel qu'il est conçu. Le serveur juge chaque ligne — périmètre, champs par rôle, étapes, contrôles — ; il enregistre et signale les problèmes métier, suit le protocole standard pour les conflits et refuse les envois interdits. Le propriétaire ne voit que les écarts, regroupés. Synchronisation automatique ; mode restreint après 3 jours pour les collaborateurs, appliqué par le téléphone et seulement contrôlé par le serveur ; premier envoi après un changement de droits jugé avec les droits actuels, les opérations de vendeur étant toujours acceptées et signalées ; resynchronisation complète à chaque changement de droits ou après un refus ; un doublon ne bloque jamais un envoi, et un geste en ligne envoyé deux fois ne compte qu'une fois. Chaque lot reçu est archivé, et un super-administrateur peut le rejouer, avec une trace, par le chemin de tous les jours.
- **Un client ajouté hors ligne ne crée jamais de doublon** : le téléphone inscrit le numéro, le serveur retrouve la personne et réunit les fiches créées en double par deux téléphones.
- **« Mon activité » tirée des données** : de simples requêtes par auteur et par date, sans journal à maintenir ; un enregistrement n'y apparaît que si l'utilisateur y a fait un geste.
- **Géographie reportée, réintroductible par simple ajout** : aucune entité conservée n'en dépend, et aucune règle de la v8 ne compte sur l'absence d'annuaire pour se protéger des inconnus — plafond à 0, acceptation de la première commande et limitation de débit restent en place.

---

## Reporté en v2

- **Protection contre l'échange de SIM** : après une réinitialisation par SMS, quelques jours pendant lesquels les téléphones connectés depuis n'auraient que les droits d'un vendeur, les autres téléphones pouvant bloquer l'intrus. En v1, risque accepté : l'email vérifié permet au titulaire de reprendre la main (voir 1.1).
- **Reconnaissance d'un téléphone déjà connu**, par une clé secrète gardée dans son coffre sécurisé, pour épargner le code de connexion sur son propre téléphone, si le coût des SMS devient sensible.
- **Alerte de dette par SMS** pour les clients sans application, avec sa règle corrigée : comparer au solde de la veille au soir, et non au montant de la dernière alerte. Elle pourrait être incluse dans un abonnement payant.
- **Annuaire des organisations et zones desservies** : retirés de la v1 (`Location`, `OrganizationServiceArea`, `Person.location_id`). Réintroduction par simple ajout, avec deux options : un référentiel géographique hiérarchique, alimenté par la plateforme pour chaque pays, ou — plus simple — un point GPS et un rayon de livraison déclarés par l'organisation.
- **Plusieurs pays** : deux colonnes `country` et `currency` sur `Organization`, valant par défaut `CM` et `XAF`.
- **Liste automatique des commerces présents dans le répertoire du téléphone**, à la manière de WhatsApp : suppose de comparer le répertoire sans qu'il quitte le téléphone ; les numéros publics vérifiés, qu'elle exige, sont déjà en place.
- **Vues de cloisonnement** : des vues PostgreSQL qui ne montrent que les lignes visibles par la personne connectée, et masquent les colonnes privées, en renfort de la couche d'accès.
- **Statut « payée / impayée » par commande**, calculé et stocké par le serveur, qui a tout l'historique, si le « perçu à la livraison » ne suffit pas.
- **Facture** : un document numéroté, avec les mentions légales, si des clients professionnels la demandent.
- **Position GPS à la livraison**.
- **Grille de prix partagée par plusieurs clients**, si les prix négociés client par client s'avèrent trop lourds pour les vendeurs à nombreux revendeurs.
- **Auteur et date pour le catalogue et l'équipe**, pour les faire entrer dans « Mon activité ».
- **Rôles sur mesure**, si les quatre rôles fixes ne suffisent plus : la table des règles, évaluée par CASL, les accueillera sans toucher au reste du modèle.
- **Annuaire des produits et marque** (`listed_in_directory`, `brand`).
- **Carnet d'adresses** (`OrganizationAddress`) : en v1, l'adresse par défaut de la relation et les adresses de ses commandes précédentes suffisent.
- **Frais d'annulation** (`Order.cancellation_deadline`, `Order.cancellation_fee`) : en v1, le client annule sans frais tant que sa commande n'est pas partie.
- **Évaluations** (`Rating`) : une évaluation par commande livrée, réservée à l'acheteur inscrit.
- **Suivi de ce qui est dû à un fournisseur non inscrit** : voir l'évolution prévue en 2.1 ; étendu aux particuliers, un carnet de dettes personnel.

---

## Annexe — La table des règles

Toutes les règles d'accès tiennent dans un seul fichier, partagé par l'application et le serveur (voir 10.1). Cette annexe en donne le contenu métier ; le fichier lui-même en est la traduction directe.

### A.1 Qui et où
Rôle minimum (les rôles sont emboîtés) et disponibilité : **toujours** ; **3 jours** = jusqu'à 3 jours sans synchronisation (voir 9.3), limite appliquée par le téléphone et seulement contrôlée par le serveur (voir A.3) ; **en ligne** = route directe, vérifiée par le serveur au moment même ; **réseau obligatoire** = en ligne pour tous, propriétaire compris. Le propriétaire n'est limité par la colonne « Où » que pour ce qui demande toujours le réseau : invitations, équipe, transfert de propriété, abonnement, fermeture du commerce, commandes passées à un fournisseur.

| Opération | Rôle minimum | Où |
|---|---|---|
| Livrer une commande partie avec soi, encaisser à la livraison, déclarer une livraison ratée | Livreur | Toujours |
| Partir en livraison | Livreur | 3 jours |
| Encaisser un paiement hors livraison | Vendeur | Toujours |
| Vendre, saisir une commande, livrer en boutique, valider une vente au comptoir | Vendeur | 3 jours |
| Ajouter un client, faire crédit dans la limite du plafond, accorder un écart de prix ponctuel | Vendeur | 3 jours |
| Accepter, refuser ou annuler une commande | Vendeur | 3 jours |
| Accorder du crédit (relever un plafond) | Gérant | En ligne |
| Modifier le catalogue, les prix, les prix négociés | Gérant | En ligne |
| Faire un avoir, rendre de l'argent, « Retour remboursé » | Gérant | En ligne |
| Annuler une écriture, reprendre un cahier | Gérant | En ligne |
| Noter une dépense, confirmer une remise, les annuler | Gérant | En ligne |
| Corriger un numéro de client | Gérant | En ligne |
| Assigner une livraison à un livreur | Gérant | En ligne |
| Commander ou inviter un fournisseur au nom de l'organisation | Gérant | Réseau obligatoire |
| Inviter un collaborateur, gérer l'équipe (révoquer, changer un rôle) et l'abonnement, transférer la propriété | Propriétaire | Réseau obligatoire |
| Fermer ou rouvrir le commerce | Propriétaire | Réseau obligatoire |

*Le client a ses propres lignes : commander et annuler sa commande avant le départ (en ligne), nommer son fournisseur (`supplier_label`), mettre fin à la relation et la rouvrir s'il l'a close, contester une relation (une seule fois).*

*Champs « serveur », jamais repris du téléphone : `balance`, `amount_held`, `balance_effect`, `total_amount`, `OrderLine.amount`, le montant d'une vente (`LedgerEntry.amount` pour `SALE`), le prix de référence d'une commande client, `price_updated_at`, `credit_limit_set_at`, `ended_by_party`, `last_synced_at`, `scope_version`, `server_updated_at`.*

*Premier envoi après un changement de droits : il est jugé avec les droits actuels. Les opérations de vendeur sont toujours acceptées et signalées au propriétaire ; toute autre opération que les droits actuels ne permettent pas est refusée et signalée (voir 9.2).*

*Sa propre fiche : sur une relation dont il est le client, ou dont le client est une organisation qu'il gère, un collaborateur n'a que les lignes du client ; les gestes de gérant y reviennent au propriétaire (voir 10.1).*

### A.2 Étapes d'une commande

| Étape | De | Vers | Rôle minimum | Où |
|---|---|---|---|---|
| Commander | — | `PENDING` | Le client | Réseau obligatoire |
| Saisir une commande | — | `CONFIRMED` | Vendeur | 3 jours |
| Valider une vente au comptoir | — | `DELIVERED` | Vendeur | 3 jours |
| Accepter | `PENDING` | `CONFIRMED` | Vendeur | 3 jours |
| Refuser | `PENDING` | `CANCELLED` | Vendeur | 3 jours |
| Partir | `CONFIRMED` | `IN_DELIVERY` | Livreur | 3 jours |
| Livrer | `IN_DELIVERY` | `DELIVERED` | Livreur | Toujours |
| Livraison ratée | `IN_DELIVERY` | `CONFIRMED` | Livreur | Toujours |
| Livrer en boutique | `CONFIRMED` | `DELIVERED` | Vendeur | 3 jours |
| Annuler | `PENDING`, `CONFIRMED` | `CANCELLED` | Vendeur (ou le client) | 3 jours |

*La livraison l'emporte toujours, même sur une annulation arrivée avant elle. Une commande `DELIVERED` ou `CANCELLED` est figée, sauf `supplier_note`.*

### A.3 Contrôles à l'arrivée
Ils ne bloquent rien : ils produisent des écarts, regroupés par cause ou par personne pour le propriétaire (voir 9.2).
- **Prix du moment** : prix de référence différent du prix actuel → « vendu à l'ancien prix », avec la date du changement.
- **Plafond** : solde porté au-delà de `credit_limit` par des téléphones pas à jour.
- **Article en vente** : article retiré depuis la saisie.
- **Date cohérente** : date d'opération dans le futur, ou incohérente avec la synchronisation.
- **Mode restreint** : opération datée de plus de 3 jours après la dernière synchronisation de son téléphone → écart signalé ; sur le serveur, la règle des 3 jours n'est jamais un refus (voir 9.3).
- **Longue absence** : retour après plus de 3 jours sans synchronisation → une ligne d'information.
- **Gestes d'argent** : argent rendu, dépense, avoir, annulation ou écart de prix, faits par un autre que le propriétaire → regroupés par personne, avec leur montant.
- **Reste abandonné** : reste d'une livraison partielle abandonné par un autre que le propriétaire → quantités et valeur, regroupées par personne.

### A.4 Extrait du fichier
```ts
import { createMongoAbility } from '@casl/ability';

// Une ligne = une règle CASL, plus nos colonnes « who » (rôle minimum) et « where »
export const RULES = [
  { who: 'SELLER',  where: 'DAYS_3', action: 'create', subject: 'CustomerRelationship' },
  { who: 'SELLER',  where: 'DAYS_3', action: 'update', subject: 'CustomerRelationship', fields: ['customer_label'] },
  { who: 'MANAGER', where: 'ONLINE', action: 'update', subject: 'CustomerRelationship', fields: ['credit_limit'] },
  { who: 'DRIVER',  where: 'ALWAYS', action: 'create', subject: 'LedgerEntry', conditions: { kind: { $in: ['SALE', 'PAYMENT'] } } },
  { who: 'MANAGER', where: 'ONLINE', action: 'create', subject: 'LedgerEntry', conditions: { kind: { $in: ['CREDIT_NOTE', 'REFUND'] } } },
  { who: 'DRIVER',  where: 'DAYS_3', action: 'depart',  subject: 'Order', conditions: { status: 'CONFIRMED' } },
  { who: 'DRIVER',  where: 'ALWAYS', action: 'deliver', subject: 'Order', conditions: { status: 'IN_DELIVERY' } },
  { who: 'SELLER',  where: 'DAYS_3', action: 'cancel',  subject: 'Order', conditions: { status: { $in: ['PENDING', 'CONFIRMED'] } } },
  { who: 'OWNER',   where: 'NETWORK', action: 'manage', subject: 'Collaboration' },  // équipe et transfert de propriété
  { who: 'OWNER',   where: 'NETWORK', action: 'manage', subject: 'Subscription' },
  // … une ligne par règle ; l'ordre compte : une ligne plus bas l'emporte
];

const ROLES = ['DRIVER', 'SELLER', 'MANAGER', 'OWNER']; // du moins au plus de droits

export function atLeast(role, min) {
  const r = ROLES.indexOf(role);
  return r !== -1 && r >= ROLES.indexOf(min);           // rôle inconnu → refusé
}

// ctx : { onServer, online, daysSinceSync }
// - onServer : vrai quand le serveur juge ; « 3 jours » n'y filtre rien, ce n'est qu'un contrôle (voir A.3)
// - online : vrai pour une route en ligne ; toujours faux pour ce qui arrive par la synchronisation
// - daysSinceSync : mesuré par le téléphone, depuis l'heure du serveur lors de la dernière synchronisation
export function abilityFor(role, ctx) {
  const owner = role === 'OWNER';
  const ok = {
    ALWAYS: true,
    DAYS_3: owner || ctx.onServer || ctx.daysSinceSync < 3,
    ONLINE: owner || ctx.online,
    NETWORK: ctx.online,  // réseau obligatoire, même pour le propriétaire
  };
  return createMongoAbility(
    RULES.filter((r) => atLeast(role, r.who) && ok[r.where])  // notre seul code
         .map(({ who, where, ...rule }) => rule),             // CASL fait le reste
  );
}
```

*Sur le serveur, tout ce qui arrive par la synchronisation est jugé « hors ligne » : les lignes « en ligne » n'y valent que pour le propriétaire, les lignes « réseau obligatoire » pour personne, et « 3 jours » n'y filtre rien (voir A.3). Les opérations « en ligne » passent par leurs routes directes. Une table de tests couvre chaque ligne, les refus et le rôle inconnu (voir 10.1).*

---

*Aucun point relevé n'est en attente de décision à ce stade. Restent les validations juridiques listées en 11.1, à obtenir avant le lancement.*
