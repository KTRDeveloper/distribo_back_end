import unittest

from helpers import FIXTURES

from common import read_text
import designparse as dp


def analyze(name, previous=None):
    return dp.analyze(read_text(FIXTURES / name), previous)


class SectionsTest(unittest.TestCase):
    def setUp(self):
        self.a = analyze("design_small.md")
        self.anchors = [s.anchor for s in self.a.sections]

    def test_anchors_are_heading_paths_without_numbers(self):
        self.assertEqual(self.anchors, ["_doc", "legende", "comptes", "comptes/account", "catalogue", "PRD",
                                        "catalogue/notes", "catalogue/notes-2", "contraintes"])

    def test_headings_inside_code_fences_are_ignored(self):
        self.assertNotIn("not-a-heading", " ".join(self.anchors))
        self.assertNotIn("fake", [f.name for e in self.a.model.entities.values() for f in e.fields])

    def test_ranges(self):
        s = {x.anchor: x for x in self.a.sections}
        self.assertEqual((s["comptes"].start, s["comptes"].own_end), (10, 11))
        self.assertEqual(s["comptes"].end, 19)
        self.assertEqual(s["_doc"].end, len(self.a.lines))

    def test_explicit_ids_win_and_children_follow_them(self):
        text = "# T\n## Orders {#ORD}\n### Payment\n#### Constraints\n## Other\n<!-- id: OTH -->\ntext\n"
        a = dp.analyze(text)
        self.assertEqual([s.anchor for s in a.sections], ["_doc", "ORD", "ORD/payment", "ORD/payment/constraints", "OTH"])

    def test_duplicate_explicit_ids_are_suffixed_with_a_warning(self):
        a = dp.analyze("## A {#X}\n## B {#X}\n")
        self.assertEqual([s.anchor for s in a.sections], ["X", "X-2"])
        self.assertTrue(any("duplicated" in w for w in a.warnings))

    def test_setext_headings_and_several_h1(self):
        a = dp.analyze("Title\n=====\n\ntext\n\nPart\n----\nmore\n# Second\n")
        self.assertEqual([s.anchor for s in a.sections], ["title", "title/part", "second"])

    def test_formatting_edit_keeps_section_hash_and_word_edit_changes_it(self):
        base = "# D\n## A\nLe prix est **positif**.\n## B\nx\n"
        wrapped = "# D\n## A\nLe prix\nest positif.\n## B\nx\n"
        changed = "# D\n## A\nLe prix est nul.\n## B\nx\n"
        h = lambda t: {s.anchor: s.hash for s in dp.analyze(t).sections}["a"]
        self.assertEqual(h(base), h(wrapped))
        self.assertNotEqual(h(base), h(changed))


class TablesTest(unittest.TestCase):
    def test_classification(self):
        self.assertEqual(dp.classify_table(["Champ", "Type", "Description"])["kind"], "fields")
        self.assertEqual(dp.classify_table(["Field", "Type", "Constraints", "Description"])["constraints"], 2)
        self.assertEqual(dp.classify_table(["Contrainte", "Portée"]), {"kind": "rules", "id": None, "rule": 0})
        self.assertEqual(dp.classify_table(["ID", "Rule"])["id"], 0)
        self.assertIsNone(dp.classify_table(["Rôle", "Périmètre"]))

    def test_split_row_keeps_escaped_pipes(self):
        self.assertEqual(dp.split_row("| a \\| b | c |"), ["a | b", "c"])


class TypeTest(unittest.TestCase):
    def test_inline_type_cells(self):
        t = dp.parse_type("enum `[FR / EN]`, nullable")
        self.assertEqual((t["base"], t["enum"], t["nullable"]), ("enum", ["FR", "EN"], True))
        t = dp.parse_type("FK → Person, nullable")
        self.assertEqual((t["fk"], t["nullable"]), ("Person", True))
        t = dp.parse_type("string, nullable, **unique**")
        self.assertTrue(t["unique"])
        self.assertTrue(dp.parse_type("bigint, **calculé par la base**")["generated"])
        t = dp.parse_type("FK, nullable, polymorphe")
        self.assertEqual((t["fk"], t["polymorphic"]), ("", True))
        self.assertEqual(dp.parse_type("decimal (3 décimales)")["base"], "decimal (3 décimales)")

    def test_constraints_column(self):
        t = dp.parse_type("integer", "required, > 0, default 1")
        self.assertEqual((t["nullable"], t["checks"], t["default"]), (False, ["> 0"], "1"))


class ModelTest(unittest.TestCase):
    def test_inline_format(self):
        a = analyze("design_small.md")
        self.assertEqual(list(a.model.entities), ["Account", "Product"])
        self.assertEqual(a.model.entities["Product"].anchor, "PRD")
        self.assertEqual((a.model.format, a.model.nullability), ("inline", "not-null-default"))
        self.assertEqual([c.id for c in a.constraints],
                         ["Account:required", "Account.email:unique", "Account.role:enum",
                          "Product:required", "Product:fk", "C-01", "C-02"])
        req = next(c for c in a.constraints if c.id == "Product:required")
        self.assertEqual(req.refs, ["Product.owner_id", "Product.name", "Product.price"])
        self.assertEqual(a.warnings, [])

    def test_constraints_column_format(self):
        a = analyze("design_column.md")
        self.assertEqual((a.model.format, a.model.nullability), ("constraints-column", "nullable-default"))
        ids = [c.id for c in a.constraints]
        self.assertIn("Customer.email:check", ids)
        self.assertIn("Invoice.total:check", ids)
        self.assertNotIn("Customer.nickname", " ".join(c.refs[0] for c in a.constraints))
        bullets = [c for c in a.constraints if c.kind == "rule"]
        self.assertEqual([c.refs for c in bullets], [["Invoice.paid_at", "Invoice.total"], ["Customer"]])

    def test_gaps_become_warnings(self):
        a = analyze("design_gaps.md")
        text = "\n".join(a.warnings)
        for needle in ("Booking.ends_at has no type", "enum Booking.status lists no values",
                       "references Salle", "nullability is never stated"):
            self.assertIn(needle, text)

    def test_entity_from_parent_heading(self):
        a = dp.analyze("## `Order`\n### Fields\n| Field | Type |\n|---|---|\n| id | uuid |\n")
        self.assertEqual(list(a.model.entities), ["Order"])


class ConstraintIdsTest(unittest.TestCase):
    def test_rule_ids_are_reused_and_new_rules_get_the_next_number(self):
        first = analyze("design_small.md")
        md = dp.render_constraints_md(first.constraints, "docs/design.md", None)
        edited = read_text(FIXTURES / "design_small.md").replace(
            "| `Product.price > 0` |", "| `Product.note` : 500 caractères au plus | |\n| `Product.price > 0` |")
        second = dp.analyze(edited, md)
        rules = {c.rule: c.id for c in second.constraints if c.kind == "rule"}
        self.assertEqual(rules["`Product.price > 0`"], "C-01")
        self.assertEqual(rules["`Product.note` : 500 caractères au plus"], "C-03")

    def test_resolve_refs(self):
        a = analyze("design_small.md")
        ents = a.model.entities
        self.assertEqual(dp.resolve_refs("`Product.price > 0`", ents), ["Product.price"])
        self.assertEqual(dp.resolve_refs("`Product` : `owner_id` et `note`", ents), ["Product.owner_id", "Product.note"])
        self.assertEqual(dp.resolve_refs("Identifiants en `uuid`", ents), ["*"])
        self.assertEqual(dp.resolve_refs("Chaque Account est unique", ents), ["Account"])


class ConstraintsMdTest(unittest.TestCase):
    def test_round_trip_and_manual_block(self):
        a = analyze("design_small.md")
        manual = "## Manual\n\n| ID | Entity.field(s) | rule |\n|---|---|---|\n| CM-01 | Product.name | trimmed (design line 30) |\n"
        md = dp.render_constraints_md(a.constraints, "docs/design.md", manual)
        rows = dp.parse_constraints_md(md)
        self.assertEqual(rows[-1], {"id": "CM-01", "refs": ["Product.name"], "rule": "trimmed (design line 30)",
                                    "section": "manual"})
        self.assertEqual(len(rows), len(a.constraints) + 1)
        self.assertEqual(dp.manual_block_of(md), manual)


if __name__ == "__main__":
    unittest.main()
