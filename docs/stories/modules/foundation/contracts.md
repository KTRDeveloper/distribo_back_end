# Contracts: foundation

What this module provides to other modules, and what it consumes from them. A contract changes only through a story of this module; a new interface ships with its first usage.

## Provides
### MoneyKernel (`src/shared/money.ts`, created by FND-003)
- `parseQuantity(text: string): bigint`: quantity in thousandths, at most 3 decimals, throws RangeError otherwise
- `lineAmount(quantityMilli: bigint, unitPrice: bigint): bigint`: nearest franc, 0.5 rounds up, integers only
- Used by: `order`, `finance`, `delivery`, `sync`
### PhoneKernel (`src/shared/phone.ts`, created by FND-004)
- `normalizeE164(input: string): string | null`: E.164 of a valid mobile number, default region CM
- `isCameroonMobile(e164: string): boolean`
- `phoneNumberSchema`: Zod string that normalizes to E.164 or fails
- Used by: `person`, `auth`, `organization`, `relationship`
### IdKernel (`src/shared/ids.ts`, created by FND-005)
- `newId(): string`: UUIDv7
- `uuidV7Schema`: Zod string accepting only UUIDv7
- `expectColumnType(table, column, dataType) in tests/helpers/db-schema.ts`
- Used by: `every module`
### HttpError (`src/lib/http-error.ts`, created by FND-006)
- `httpError(status: number, code: string, message: string): Error`: carries statusCode and code
- Used by: `every module`
### DatabaseRoles (`prisma/migrations`, created by FND-002)
- `role distribo_app: SELECT, INSERT, UPDATE, DELETE by default on new tables; immutable tables REVOKE UPDATE, DELETE, TRUNCATE`
- `function set_server_updated_at() for a BEFORE INSERT OR UPDATE trigger on every synchronized table`
- `getAppRolePrisma() in tests/helpers/app-role.ts: a Prisma client that runs as distribo_app`
- Used by: `person`, `relationship`, `finance`, `sync`, `admin`

## Consumes
- Nothing.
