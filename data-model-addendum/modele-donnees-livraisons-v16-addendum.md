# Addendum au modèle de données v16

Complète `modele-donnees-livraisons-v16.md` sans le modifier. Pour les points qu'il traite, l'addendum l'emporte sur le modèle ; chaque section cite les passages qu'elle remplace ou précise.

Source : demandes du front (`front_end/docs/backend-requests/recapitulatif.md`), décidées une à une avec l'utilisateur à partir du 2026-11-11. Le point 9 vient de l'utilisateur.

## Décisions

| Demande | Décision | Modèle |
|---|---|---|
| 1. Création d'une commande personnelle (Q-014) | La route existe (`POST /api/v1/orders`, ORD-009) ; seule sa description OpenAPI manque, à ajouter | Inchangé |
| 2. Modifier un achat en une seule opération | Remplacement d'un seul geste ; l'ancienne version est supprimée pour les téléphones et gardée sur le serveur | A1 |
| 3. Reconnaître un téléphone Android (ANDROID_ID) | Une empreinte de l'ANDROID_ID ferme la session laissée ouverte par le même téléphone ; elle n'authentifie rien ; l'alerte part à chaque connexion | A2 |
| 4. Plafond de crédit déjà dépassé et vente entièrement payée | Une vente payée en entier passe toujours ; seule la part non payée de la nouvelle vente compte ; le livreur ne reçoit jamais un crédit disponible négatif | A3 |
| 5. Mode de réception `reception_mode` | Champ explicite `DELIVERY` / `PICKUP`, choisi à la création, jamais déduit de l'adresse ; vide pour les anciennes commandes | A4 |
| 6. Nom public du client `customer_public_name` | Calculé par le serveur et envoyé à l'équipe du fournisseur ; le nom que le fournisseur a donné au client reste prioritaire | A5 |
| 7. Nom public du fournisseur `supplier_public_name` | Calculé par le serveur et envoyé au particulier qui achète ; le nom que le client a donné au fournisseur reste prioritaire | A6 |
| 8. Délai de verrouillage du login (`Retry-After`) | Blocage fixe d'1 minute après 5 erreurs ; chaque refus donne le temps restant dans `Retry-After` ; un essai pendant le blocage ne le prolonge pas | A7 |
| 9. Reçu identique à chaque génération, sans le nom privé | Le serveur fige à la livraison le nom du commerce, le nom public du client, le montant payé et la dette juste après ; le reçu n'utilise que des valeurs figées et ne change plus, même après la suppression d'un compte | A8 |

## A1. « Modifier » : remplacer une commande en attente (demande 2)

Remplace : 4.1, « Commande passée par le client », point 3 ; 4.1, « Refus et annulation », la mention « (« Modifier » en est une) ».
Précise : 4.1 (champs), 4.2 (prix vus par le client), 8.1, 9.2, annexe A.2, contraintes à poser au niveau base de données.

### Le geste

Tant que sa commande est en attente (`PENDING`), le client la remplace d'un seul geste, en ligne, que l'application présente comme « Modifier » : l'ancienne version est annulée et la nouvelle créée dans la même transaction, ou rien ne change. Le geste est ouvert aux personnes qui peuvent commander pour ce client (4.1, point 5). Une fois la commande acceptée, « Modifier » n'est plus proposé : le client l'annule puis recommande, en deux gestes, et l'annulation reste visible.

- **Nouvelle version** : une commande passée par le client, construite comme à l'envoi (4.1, point 1 ; 4.2) : même relation, `PENDING`, lignes, adresse, date souhaitée et note envoyées, prix du jour. Seule la note du fournisseur (`supplier_note`) est reprise de l'ancienne version.
- **Ancienne version** : passe `CANCELLED` (`cancelled_by_party = CUSTOMER`, `cancelled_by_id`, `cancelled_at`), reçoit `replaced_by_order_id` et est marquée supprimée (`deleted_at`). Ses lignes ne changent pas.
- **Refus, sans rien appliquer** : ancienne version introuvable pour l'appelant ; plus en attente (acceptée, refusée ou annulée entre-temps) ; nouvelle version invalide (règle des lignes, quantité minimale, relation ou commerce inactif) ; total changé (ci-dessous).
- **Identifiant** : la nouvelle commande porte un identifiant créé par le téléphone, qui identifie aussi le geste. Un rejeu rend la même réponse tant que la clé de rejeu est gardée (30 jours) ; au-delà, l'existence de la nouvelle commande prouve que le geste a réussi.
- **Réponse** : la nouvelle commande, vue client, et l'identifiant de la version remplacée.

### Le total vu par le client

Le geste porte le total que le client a vu (`expected_total`). Ce champ ne fixe aucun prix et n'est jamais enregistré : le serveur recalcule tout, et si son total diffère, il refuse sans rien appliquer et renvoie le nouveau total. Le client le voit, puis valide par un nouveau geste, avec un nouvel identifiant. Un prix changé n'annule donc jamais l'ancienne version à l'insu du client. L'envoi d'une commande (4.1, point 1) accepte le même champ, facultatif, avec le même contrôle.

### Le lien et la suppression

| Champ | Type | Description |
|---|---|---|
| replaced_by_order_id | FK → Order, nullable | Sur une version remplacée par « Modifier » : sa remplaçante. Posé avec la suppression, ne change plus. Même principe que `merged_into_id` (2.1) : la version supprimée ne sert plus qu'à rediriger |

- La version remplacée disparaît partout dans l'application, des deux côtés : listes, compteurs, détail, recherche. La synchronisation retire des téléphones la commande et chacune de ses lignes. Aucune version précédente n'est affichée.
- Sur le serveur, elle reste entière, lignes comprises, et se conserve comme toute commande (11.2).
- Une notification qui vise une version remplacée mène à la version courante, en suivant les liens.
- « Reprendre une commande » (4.1) reste sans lien : seul « Modifier » en crée un.
- Retour possible à l'affichage des versions précédentes : retirer leur marque de suppression, en les retrouvant par le lien. Aucune donnée n'est perdue.

### Notification (complète 8.1)

L'équipe du fournisseur qui reçoit `order.placed` reçoit une seule notification, `order.replaced` (« Mme Ngono a modifié sa commande »), qui vise la nouvelle version, à la place de celles de l'annulation et de la nouvelle commande.

### Gestes hors ligne arrivés après le remplacement (complète 9.2)

Un téléphone du fournisseur resté hors ligne a pu agir sur l'ancienne version. À l'arrivée :

- **Une livraison l'emporte**, comme sur toute annulation (A.2) : la version est rétablie (plus supprimée, lien gardé), livrée, et ses écritures naissent normalement ; la version courante n'est pas touchée. Les deux portent un signalement pour le fournisseur : « Livrée alors que le client l'avait modifiée : vérifiez la nouvelle version ».
- **Tout autre changement** (acceptation, baisse de prix, départ, refus, note) est sans effet. Le téléphone reçoit la suppression, et le fournisseur en est averti par un signalement sur la version courante.

### Étapes (complète A.2)

| Étape | De | Vers | Rôle minimum | Où |
|---|---|---|---|---|
| Modifier | `PENDING` | `CANCELLED` et supprimée, plus une nouvelle commande `PENDING` | Le client | En ligne pour tous |

### Contraintes de base de données (complète « Contraintes à poser au niveau base de données »)

- `replaced_by_order_id` : unique parmi les valeurs renseignées ; jamais l'identifiant de la commande elle-même ; renseigné seulement sur une commande passée par le client ; la remplaçante est sur la même relation.

## A2. Reconnaître un téléphone Android dans « Mes appareils » (demande 3)

Précise : 1.1 (« Connexion »), 10.3, 10.4 (motifs de révocation), contraintes à poser au niveau base de données. La règle de 1.1 reste entière : le serveur ne reconnaît jamais un téléphone pour l'authentifier.

### Le principe

Chaque connexion demande toujours le mot de passe et le code SMS, et ouvre une nouvelle session avec de nouveaux jetons (10.3). Un téléphone Android annonce en plus son identifiant Android, qui survit à la réinstallation et à l'effacement des données de l'application. Le serveur s'en sert pour une seule chose : fermer la session que le même téléphone avait laissée ouverte, pour que « Mes appareils » ne montre qu'une entrée par téléphone. Cet identifiant n'est pas secret : il ne dispense ni du code ni de l'alerte de nouvelle connexion, et ne rouvre jamais une session fermée.

### Le champ envoyé

- `device.android_id`, facultatif, dans les trois gestes qui ouvrent une session : inscription, validation de la connexion, confirmation de la réinitialisation du mot de passe.
- Forme : de 1 à 16 caractères hexadécimaux en minuscules, celle que donne Android. Le serveur refuse toute autre forme (400) ; un téléphone qui ne lit pas un identifiant de cette forme ne l'envoie pas.
- Absent (iPhone, ancienne version de l'application) : tout se passe comme avant.

### Ce que le serveur garde (complète 10.3)

| Champ | Type | Description |
|---|---|---|
| android_id_hash | string, nullable | Empreinte de l'identifiant Android, calculée avec une clé secrète du serveur et l'identifiant de la personne : elle dit seulement si deux connexions de la même personne viennent du même téléphone, et ne permet pas de relier deux comptes. L'identifiant lui-même n'est jamais gardé, renvoyé ni journalisé. Effacée, comme `push_token`, à la suppression du compte |

### À l'ouverture d'une session

- Dans la même transaction, toute session non fermée de la même personne qui porte la même empreinte, expirée ou non, est fermée : `Device.revoked_at` est posé et son jeton en cours est révoqué avec le nouveau motif `REPLACED` (complète 10.4 : « `REPLACED` quand une nouvelle connexion sur le même téléphone remplace cette session »).
- Si deux connexions du même téléphone se croisent, une seule aboutit ; l'autre est refusée (409) sans rien appliquer et peut être refaite.
- Changer la clé du serveur ne casse rien : les sessions ouvertes avant le changement ne sont simplement plus reconnues.

### Sessions ouvertes (précise 1.1 et 10.3)

- Une session est ouverte si elle n'est pas fermée et si son jeton de renouvellement en cours n'a pas expiré. « Mes appareils » ne montre que celles-là.
- L'alerte de nouvelle connexion (1.1) part à chaque connexion, même sur un téléphone reconnu, vers les autres sessions ouvertes de la personne, jamais vers la session que cette connexion ferme. Son texte ne change pas.

### Fiches existantes

Sans empreinte, elles ne sont jamais fusionnées : elles quittent « Mes appareils » à leur expiration (au plus 90 jours) ou à leur déconnexion. La première connexion d'un téléphone qui envoie son identifiant ne ferme donc aucune ancienne session.

### Contraintes de base de données (complète « Contraintes à poser au niveau base de données »)

- Au plus une session non fermée par personne et par empreinte.

## A3. Plafond de crédit déjà dépassé (demande 4)

Précise : 2.1, « Plafond de crédit : une seule règle » (première phrase et point « Hors ligne ») ; 4.1, « Commande livrée » ; 9.2 (écarts regroupés) ; 9.6 (ce que reçoit le livreur).

### La règle

Le plafond limite la part non payée d'une nouvelle vente ou livraison, pas la dette déjà là. Le crédit encore disponible est le plafond moins le solde avant l'opération, jamais moins de zéro ; un plafond absent est illimité. Le minimum à encaisser est le total livré moins ce crédit disponible, jamais moins de zéro.

- Plafond atteint ou dépassé : la vente ou la livraison reste possible dès qu'elle est payée en entier. L'ancien dépassement ne la bloque pas et n'oblige à aucun remboursement : la vente et son paiement laissent la dette inchangée.
- Un paiement partiel n'est possible que si le crédit disponible couvre la part non payée.
- Sous le plafond, rien ne change : l'exemple de 2.1 (plafond 50 000, solde 40 000, commande 30 000) demande toujours 20 000.
- Le vendeur peut toujours encaisser plus que la commande pour réduire l'arriéré (2.1) ; rien ne l'y oblige.

### Le contrôle (complète 4.1, « Commande livrée », et 9.2)

Le contrôle prend ensemble le total livré, calculé par le serveur, et les paiements du même geste ; il ne juge jamais la vente seule avant son paiement.

- En ligne : un encaissement sous le minimum est refusé sans rien écrire, et la réponse donne le minimum.
- À la synchronisation : la livraison est toujours gardée ; seule la part de cette opération qui dépasse le crédit disponible est signalée (« plafond dépassé de … »), sans y ajouter l'ancien dépassement. Une vente payée en entier n'est jamais signalée du seul fait d'une dette antérieure.
- Les signalements déjà émis restent tels quels.

### Exemples (montants en XAF)

| Solde avant | Plafond | Total livré | Encaissé | Minimum | En ligne | Synchronisation |
|---|---|---|---|---|---|---|
| 120 000 | 100 000 | 10 000 | 10 000 | 10 000 | accepté, solde final 120 000 | gardée, sans signalement |
| 120 000 | 100 000 | 10 000 | 9 999 | 10 000 | refusé, rien n'est écrit | gardée, dépassement de 1 |
| 100 000 | 100 000 | 10 000 | 10 000 | 10 000 | accepté, solde final 100 000 | gardée, sans signalement |
| 90 000 | 100 000 | 30 000 | 20 000 | 20 000 | accepté, solde final 100 000 | gardée, sans signalement |
| 5 000 | 0 | 10 000 | 10 000 | 10 000 | accepté, solde final 5 000 | gardée, sans signalement |
| −20 000 | 0 | 30 000 | 10 000 | 10 000 | accepté, solde final 0 | gardée, sans signalement |
| 120 000 | illimité | 10 000 | 0 | 0 | accepté, solde final 130 000 | gardée, sans signalement |

### Ce que reçoit le livreur (précise 9.6)

Le crédit disponible envoyé au téléphone du livreur, à la place du solde et du plafond, ne descend jamais sous zéro. Un nombre négatif lui révélerait le dépassement, et même la dette entière d'un client sans crédit (plafond 0). La vérification hors ligne reste la même : à zéro, le client paie tout.

## A4. Livraison ou retrait : `reception_mode` (demande 5)

Précise : 4.1 (champs de `Order`, « Reprendre une commande », commande du reste), A1, synchronisation des commandes. Le mode n'est plus déduit de l'adresse (4.1, `delivery_address_applied`).

| Champ | Type | Description |
|---|---|---|
| reception_mode | enum `[DELIVERY / PICKUP]`, nullable | Choisi à la création : à livrer, ou le client vient chercher. Jamais déduit de l'adresse. Vide pour les commandes antérieures (« non renseigné ») et pour une vente où le client repart aussitôt avec la marchandise (« Il repart avec ») |

- **Création** : envoyé par le client (panier) comme par le fournisseur (« À livrer » → `DELIVERY`, « Il vient chercher » → `PICKUP`). Facultatif à l'envoi, pour les anciennes versions de l'application : absent, il reste vide.
- **Retrait** : une commande `PICKUP` n'a pas d'adresse. Le serveur n'y applique pas l'adresse habituelle de la relation, et refuse une adresse envoyée avec `PICKUP` (400).
- **Modification** : avec l'adresse, par les mêmes gestes et les mêmes personnes. Passer à `PICKUP` efface l'adresse ; passer à `DELIVERY` sans adresse envoyée applique l'adresse habituelle, comme à la création.
- **Copies** : « Reprendre une commande » copie le mode (c'est « la livraison ou le retrait » de 4.1) ; la commande du reste (« À livrer plus tard ») reprend celui de la première ; la nouvelle version d'un « Modifier » (A1) porte le mode envoyé.
- **Visibilité** : champ partagé, vu des deux côtés, dans la synchronisation, le détail et l'historique.
- **Portée** : il informe seulement ; les règles de départ, d'affectation au livreur et de livraison ne changent pas.
- **Anciennes commandes** : restent vides ; aucune reprise à partir de l'adresse.

### Contraintes de base de données (complète « Contraintes à poser au niveau base de données »)

- Une commande `PICKUP` n'a pas d'adresse.

## A5. Nom public du client chez le fournisseur : `customer_public_name` (demande 6)

Précise : 2.1 (la fiche du client vue par le fournisseur), 9.6 (ce que reçoit chaque téléphone), synchronisation des relations.

Une relation relie un fournisseur et son client ; chaque côté a besoin du nom de l'autre. Ce champ donne à l'équipe du fournisseur le nom du client ; A6 donne au client celui du fournisseur.

- **Champ envoyé** : `customer_public_name` (string, nullable), sur chaque relation envoyée à l'équipe du fournisseur (`OWNER`, `MANAGER`, `SELLER`, `DRIVER`), parmi celles qu'elle voit déjà. Jamais envoyé au client lui-même.
- **Calculé par le serveur à chaque envoi**, pas enregistré sur `CustomerRelationship` : pour une entreprise cliente (`customer_organization_id`), le nom de l'organisation ; pour un particulier (`customer_person_id`), son nom public (`Person.full_name`). Vide sans nom public : personne pas encore inscrite, compte anonymisé.
- **Jamais rempli à partir de `customer_label`**. À l'affichage, le nom donné par le fournisseur (`customer_label`) passe d'abord s'il n'est pas vide, puis le nom public, sinon « Client sans nom ».
- **Rien de nouveau n'est révélé** : le fournisseur voit déjà ce nom (2.1 : « M. Kamga » et « Kamga Services »), que l'API et la vue du livreur donnent déjà.
- **Lecture seule** : seul le client change son nom, depuis son compte ; un téléphone ne peut jamais l'écrire.
- **Mises à jour** : quand le nom public d'un client change ou est effacé (renommage, anonymisation), toutes ses relations sont marquées changées, pour que la synchronisation suivante les renvoie avec le nouveau nom, ou vide après un effacement, même si rien d'autre n'a changé.
- **Mise en service** : toutes les relations sont marquées changées une fois, pour que les téléphones reçoivent les noms des clients existants.

## A6. Nom public du fournisseur chez le client : `supplier_public_name` (demande 7)

Précise : 2.1 (la fiche du fournisseur vue par le client), 9.6 (ce que reçoit chaque téléphone), synchronisation des relations.

Miroir de A5 : ce champ donne au client le nom de son fournisseur.

- **Champ envoyé** : `supplier_public_name` (string, nullable), sur chaque relation envoyée au particulier qui achète (la vue client, `customer_person_id`). Jamais envoyé à l'équipe du fournisseur.
- **Calculé par le serveur à chaque envoi**, pas enregistré sur `CustomerRelationship` : le nom de l'organisation fournisseur (`supplier_organization_id`) ; pour une invitation pas encore acceptée (`supplier_person_id`), le nom public de la personne invitée (`Person.full_name`). Vide sans nom public : personne invitée pas encore inscrite, compte anonymisé.
- **Jamais rempli à partir de `supplier_label`**. À l'affichage, le nom donné par le client (`supplier_label`) passe d'abord s'il n'est pas vide, puis le nom public, sinon « Fournisseur sans nom ».
- **Seul le nom passe** : jamais les champs privés du fournisseur (`customer_label`, `supplier_notes`). Rien de nouveau n'est révélé : l'API donne déjà ce nom au client.
- **Lecture seule** : seul le fournisseur change son nom ; un téléphone ne peut jamais l'écrire.
- **Mises à jour** : quand le nom du fournisseur change ou est effacé (renommage de l'organisation, anonymisation de la personne invitée), toutes ses relations sont marquées changées, pour que la synchronisation suivante les renvoie avec le nouveau nom, ou vide après un effacement. L'acceptation d'une invitation change déjà la relation : elle repart avec le nom de l'organisation.
- **Entreprise cliente** : elle ne reçoit pas ses relations de fournisseur par la synchronisation ; son gérant les voit en ligne (`GET /api/v1/organizations/{organizationId}/suppliers`), où l'API donne déjà leur nom. Ce champ ne change rien pour elle et n'élargit aucune vue.
- **Mise en service** : comme A5, toutes les relations sont marquées changées une fois ; une seule fois suffit si A5 et A6 sont mis en service ensemble.

## A7. Blocage après 5 erreurs de mot de passe (demande 8)

Précise : 1.1, « Essais limités » (« attendre quelques minutes »). Tranche la question Q-005 des stories.

- **Durée** : après 5 erreurs de suite, le mot de passe est refusé pendant **1 minute**, durée fixe qui ne s'allonge jamais. Une seule durée pour tous les blocages de mot de passe : connexion, changement de mot de passe, suppression du compte, connexion et réinstallation de l'authentificateur des administrateurs. Elle reste un réglage du serveur (`LOGIN_LOCK_MINUTES`, 1 par défaut) : on peut l'allonger sans changer le code si des abus apparaissent.
- **Temps restant** : chaque refus `LOGIN_LOCKED` (429) porte l'en-tête `Retry-After`, en secondes entières arrondies au-dessus : le temps avant qu'un essai soit de nouveau accepté. L'application affiche ce décompte et ne suppose aucune durée.
- **Règles inchangées, à tester** :
  - pendant le blocage, même le bon mot de passe est refusé ;
  - un essai refusé pendant le blocage ne le prolonge pas : le temps restant annoncé continue de baisser ;
  - à la fin du blocage, le bon mot de passe est accepté et remet le compteur à zéro ;
  - « Mot de passe oublié » (code SMS) reste possible pendant le blocage, et le lève.
- **Choix assumé** : une attente courte pour le titulaire. La protection principale reste le code SMS demandé à chaque connexion (1.1) ; le blocage ne fait que ralentir la recherche d'un mot de passe.
- **Contrat du front** : il indique 30 minutes ; il doit lire `Retry-After` au lieu d'une durée fixe.

## A8. Le reçu ne change plus (point 9)

Remplace : 4.1, « Le reçu », le calcul de la dette « le solde actuel, moins l'effet des écritures postérieures ».
Précise : 4.1 (champs de `Order`), 9.6 (livreur), 11.2 (suppression du compte), contraintes à poser au niveau base de données.

**Principe** : un reçu est émis une fois et ne change plus. Une copie faite plus tard, sur n'importe quel téléphone et des deux côtés, est identique. Une erreur se corrige par une nouvelle opération (paiement, remboursement, avoir, annulation d'écriture), jamais en retouchant le reçu.

### Champs figés (complète 4.1)

| Champ | Type | Description |
|---|---|---|
| supplier_name_applied | string, nullable | Nom du commerce fournisseur au moment où le serveur enregistre la livraison |
| customer_name_applied | string, nullable | Nom public du client à ce moment : nom de l'organisation cliente, ou nom public de la personne (`Person.full_name`). Jamais `customer_label`. Vide sans nom public |
| collected_applied | bigint, nullable | Montant payé à la livraison : les paiements enregistrés avec la vente de cette livraison |
| balance_after_applied | bigint, nullable | Dette du client juste après la livraison : le solde de la relation calculé par le serveur dans la transaction qui enregistre la vente et le paiement |

- **Écrits par le serveur seul**, une fois, dans la transaction qui fait passer la commande à `DELIVERED` (en ligne ou à la synchronisation, vente directe comprise), à partir de ses propres données. Jamais acceptés d'un téléphone.
- **Le reçu n'utilise que des valeurs figées** : ces quatre champs et ceux qui l'étaient déjà (`label_applied`, quantités livrées, `unit_price_applied`, `delivery_cost`, `delivery_address_applied`, `delivered_at`). Il ne lit jamais une valeur courante : nom actuel, solde actuel, paiements enregistrés ensuite. Le reste à payer sur la commande se déduit du total et de `collected_applied`. Ce qu'on ajouterait un jour au reçu (téléphone ou logo du commerce) sera figé de la même façon.
- **Jamais le nom privé** : aucun reçu, affiché ou partagé, ne porte `customer_label`. Sans nom public, aucun nom de client n'est imprimé.
- **Provisoire avant la synchronisation** : une livraison enregistrée hors ligne donne un reçu calculé par le téléphone et marqué « provisoire », comme son total. Dès que le serveur a enregistré la livraison, le reçu est définitif.
- **Livreur** : `balance_after_applied` ne lui est jamais envoyé (9.6) ; son reçu n'a pas de ligne de dette.
- **Synchronisation** : les quatre champs partent avec la commande vers ceux qui la voient, en lecture seule, exclus du push et protégés par le serveur en cas de conflit.

### Après la suppression d'un compte (précise 11.2)

Le reçu reste tel quel, nom du client compris : c'est une pièce comptable (droit OHADA), gardée comme toute donnée commerciale, au moins 10 ans et tant que le compte du fournisseur existe (11.2), comme le numéro de celui qui paie un abonnement (11.1). Le nom figé ne sert qu'au reçu : jamais aux listes, à la recherche ou au profil. Rien n'est supprimé automatiquement au bout de 10 ans : c'est un minimum, pas une échéance. À faire valider par le juriste avec les durées de conservation (point 3 de la liste du modèle), avec cette question : au-delà de 10 ans, faut-il effacer des reçus le nom d'une personne qui a supprimé son compte ?

### Mise en service

Les commandes déjà livrées reçoivent leurs quatre champs une fois, d'après l'historique du serveur :
- les noms tels qu'ils sont ce jour-là (vide pour une personne déjà anonymisée) ;
- les paiements enregistrés avec la vente ;
- la dette après la livraison, en rejouant les écritures de la relation dans l'ordre où le serveur les a enregistrées.

### Contraintes de base de données (complète « Contraintes à poser au niveau base de données »)

- `supplier_name_applied`, `collected_applied` et `balance_after_applied` sont renseignés ⟺ la commande est livrée ; `customer_name_applied` peut rester vide. Posée après la reprise des commandes déjà livrées.
- Une fois remplis, la base refuse toute modification de ces quatre champs.

### Côté front

Le reçu lit ces champs. La règle du « nom public courant » sur le reçu (décision front §15) est remplacée.
