# Golden example

Validated ground truth for the format and the level of detail. Read once, before writing the first module YAML.

- `design-excerpt.md`: the part of eval design (a) the story uses (French prose, English identifiers).
- `project.yaml`: the project document for design (a); it renders CONVENTIONS.md, README.md and GLOSSARY.md.
- `catalog.yaml`: the module document, with story CAT-002 (the other stories are omitted).
- `CAT-002-seller-creates-a-product.md`: what render_stories.py produced from `catalog.yaml`.

What to imitate:
- the renderer inlines fields (`fields:`) and constraints (`constraints:`) into Context, so the YAML never restates them;
- constraint rules from a French design get their English text once, in the owning module's `constraints:` map;
- boundaries in one Scenario Outline (the limit, just inside, just outside), not one scenario per value;
- abuse cases for horizontal and vertical access, plus the module threats this story exposes (mass assignment, no token);
- every AC, AB and constraint covered by a test row; security rows cite their WSTG test;
- the pattern file and read_first come from dependencies (AUTH-005 created `logout.routes.ts` and the requireAuth contract);
- nothing the design does not state: no priority, no extra field, no extra role.
