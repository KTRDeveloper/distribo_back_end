"""Build the phase-2 eval designs from fixture-b's design (design-base.md)."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
base = (HERE / "design-base.md").read_text(encoding="utf-8")


def sub(text, old, new, count=1):
    assert text.count(old) >= 1, old
    return text.replace(old, new, count)


def formatting_and_typo(t):
    # re-wrap a paragraph, change bullet style, emphasis and table alignment
    t = sub(t, "via un agrégateur de paiement tiers : API REST appelée par le serveur, ",
            "via un agrégateur de paiement tiers :\nAPI REST appelée par le serveur, ")
    t = sub(t, "- **Inscription** (visiteur)", "* **Inscription** (visiteur)")
    t = sub(t, "- **Connexion** (visiteur)", "* **Connexion** (visiteur)")
    t = sub(t, "Priorités v1 : commande", "**Priorités v1** : commande")
    t = sub(t, "| Champ | Type | Description |\n|---|---|---|\n| id | PK | |\n| shop_id | FK → Shop | |\n| name | string | 1 à 120",
            "| Champ | Type        | Description |\n|:------|:------------|:------------|\n| id    | PK          |             |\n| shop_id | FK → Shop | |\n| name | string | 1 à 120")
    t = sub(t, "- API JSON sur HTTPS, préfixe `/api/v1`.", "- API JSON sur HTTPS,\n  préfixe `/api/v1`.")
    # spelling fix (1990 rectified spelling), no meaning change
    t = sub(t, "Le compte naît `ACTIVE`.", "Le compte nait `ACTIVE`.")
    return t


def tightened(t):
    t = sub(t, "| name | string | 1 à 80 caractères |", "| name | string | 1 à 60 caractères |")
    t = sub(t, "`Shop.name` : 1 à 80 caractères", "`Shop.name` : 1 à 60 caractères")
    return t


FAVORITE = """### 4.4 `Favorite`
| Champ | Type | Description |
|---|---|---|
| id | PK | |
| person_id | FK → Person | Le client, pris dans la session |
| product_id | FK → Product | |
| created_at | datetime | |

- **Favoris** (client) : ajouter à ses favoris un produit `ACTIVE` d'une boutique `ACTIVE`, l'en retirer, lister ses favoris (20 par page, du plus récent au plus ancien). Un client ne voit que ses propres favoris.

## 5. Commandes
"""


def new_entity(t):
    t = sub(t, "## 5. Commandes\n", FAVORITE)
    t = sub(t, "| `PaymentEvent.provider_event_id` unique ; aucune modification ni suppression de `PaymentEvent` | Journal fidèle, webhooks idempotents |\n",
            "| `PaymentEvent.provider_event_id` unique ; aucune modification ni suppression de `PaymentEvent` | Journal fidèle, webhooks idempotents |\n"
            "| `Favorite` unique (`person_id`, `product_id`) ; au plus 200 favoris par client | |\n")
    return t


def renamed(t):
    return sub(t, "### 5.3 Parcours\n", "### 5.3 Parcours de commande\n")


designs = {
    "e": formatting_and_typo(base),
    "f": tightened(base),
    "g": new_entity(base),
    "h": renamed(base),
    "j": new_entity(tightened(base)),
}
for name, text in designs.items():
    out = HERE / name / "design.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(name, len(text.splitlines()), "lines")
