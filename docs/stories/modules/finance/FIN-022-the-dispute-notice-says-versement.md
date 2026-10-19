---
id: FIN-022
title: The dispute notice says versement
module: finance
kind: change
rev: 1
amends: [FIN-016]
size: XS
risk: low
depends_on: [FIN-016]
read_first: [src/modules/finance/finance.service.ts]
design_refs: [finances/handover]
constraints: []
asvs: [v5.0.0-16.3.2]
---

# FIN-022 — The dispute notice says versement

## Story
As an owner, I want the notice of a disputed amount to use the word versement so that "remise" keeps meaning a price reduction.

## Context
- Exists: `HANDOVER_DISPUTED_CONTENT.FR` in `finance.service.ts` reads "<name> conteste le montant de <amount> noté pour sa remise d'argent." The design (v16) reserves "remise" for price reductions and calls the money brought to the owner a "versement".
- Change: the French text becomes "<name> conteste le montant de <amount> noté pour son versement." The English text and the received notice (`HANDOVER_CONTENT`) stay as they are.
- The sentence keeps the accents of the existing text; the name and the amount keep their places.

## Acceptance criteria
```gherkin
Scenario: AC-1 The owner reads the new wording
  Given an owner whose language is French
  When a remitter disputes a handover of 5000
  Then the owner's notification reads "<name> conteste le montant de 5000 noté pour son versement."
  And the English text is unchanged
```

## Abuse cases
None: no protected resource or action.

## Implementation
- Create: `tests/integration/finance/dispute-wording.test.ts`
- Modify: `src/modules/finance/finance.service.ts`
- Pattern: `tests/integration/organization/amount-held.test.ts`
- Dependencies: none added

## Security
- v5.0.0-16.3.2: the notice names the remitter and the amount only, no other personal data.

## Tests
| name | level | covers | input → expected |
|---|---|---|---|
| wording | integration | AC-1 | French owner, disputed handover → exact French text; English owner → unchanged text |

Command: `npx vitest run tests/integration/finance`

### Tests to update
| existing test | reason | new expectation |
|---|---|---|
| tests/integration/finance/handover-cancel-dispute.test.ts | checks the amount and the name inside the notice, not the old French wording | unchanged |

## Out of scope
- Any other text that mentions money handed over: no other server text uses the old word.
