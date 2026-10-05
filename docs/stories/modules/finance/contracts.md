# Contracts: finance

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### Ledger (`src/modules/finance/ledger.service.ts`, created by FIN-003)
- `appendLedgerEntry(tx, input: LedgerInput): Promise<LedgerEntry>`: inserts one entry, adds its `balance_effect` to the relationship balance, then adds the cash effect to the recorder's amount held (PAYMENT +amount, REFUND -amount; reversals opposite)
- `reverseLedgerEntry(tx, entryId: string, input: { id: string; recordedById: string; note?: string }): Promise<LedgerEntry>`
- Used by: `delivery`, `sync`
### HeldMoney (`src/modules/finance/held-money.ts`, created by FIN-012)
- `recordExpenseInTx(tx, input): Promise<Expense> and recordHandoverInTx(tx, input): Promise<Handover>`: insert and adjust `amount_held`
- Used by: `organization`, `sync`

## Consumes
- delivery: findAbandonedRests (docs/stories/modules/delivery/contracts.md)
- relationship: addToBalance, visibleRelationsWhere (docs/stories/modules/relationship/contracts.md)
- organization: loadActor, addAmountHeld, assertOrganizationActive (docs/stories/modules/organization/contracts.md)
- access: requireAbility, idempotent (docs/stories/modules/access/contracts.md)
