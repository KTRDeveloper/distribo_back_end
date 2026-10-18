# Project Profile

Facts about the existing back end, each with its evidence. The design is `data-model/modele-donnees-livraisons-v16.md`. Scanner noise ignored: the 25 Python files and `django-migrations` come from `skills_prompts/`, not from the application.

## Stack
- Node.js >=22.0.0 (`package.json:8`)
- TypeScript ^5.9.0, strict, ES2022, NodeNext modules (`tsconfig.json:9`, `package.json:105`)
- Express ^5.1.0 (`package.json:66`)
- PostgreSQL 16 for tests (`docker/docker-compose.test.yml:3`)
- Prisma ^7.0.0 with `@prisma/adapter-pg`, generator `prisma-client-js` (`prisma/schema.prisma:5`, `package.json:59`)
- Zod ^3.23.8 (`package.json:79`)
- Pino ^10.1.0 and pino-http (`package.json:73`)
- Redis via ioredis, BullMQ workers for tasks and OTP delivery (`package.json:69`, `src/workers/otp-delivery-worker.ts:1`)
- bcrypt ^6.0.0 for passwords, jsonwebtoken ^9.0.2 (`package.json:61`, `package.json:70`)
- SMS through `@textbee/sdk`, email through nodemailer (`package.json:60`, `package.json:71`)

## Architecture
- Modular monolith: `src/modules/<name>/` with `<name>.routes.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`, `.schemas.ts`, `.types.ts`, `.openapi.ts` (`src/modules/user/user.routes.ts:1`)
- Routes mounted under `/api/v1` in `src/app.ts` (`src/app.ts:120`), each router registered on `v1Router`
- Controllers are plain objects that parse the body with Zod, call the service, and send JSON (`src/modules/auth/auth.controller.ts:21`)
- Repositories are the only place that call `prisma` (`src/modules/auth/auth.repository.ts:43`)
- Prisma client singleton (`src/lib/db.ts:1`)
- Shared helpers live in `src/lib/` (jwt, otp, refresh-token, rate-limit, crypto, config-service, queue)
- ESM imports use the `.js` suffix (`src/modules/auth/auth.routes.ts:2`)

## Code standards
- ESLint 9 with `@typescript-eslint` recommended plus type-checked rules; `no-explicit-any` is an error (`.eslintrc.json:23`)
- `no-floating-promises` and `no-misused-promises` are errors (`.eslintrc.json:24`)
- Prettier: single quotes, semicolons, width 100, trailing commas es5 (`.prettierrc:4`)
- Commit messages follow conventional commits (scanner, git log)

## Error handling
- Errors are `Object.assign(new Error(msg), { statusCode, code })`; no error class (`src/modules/user/user.service.ts:16`)
- One global error middleware maps ZodError to 400 `VALIDATION_ERROR`, errors with `statusCode` to that status, the rest to 500 (`src/middleware/error-handler.ts:21`)
- Response shape `{ error: { message, code, requestId } }` (`src/middleware/error-handler.ts:6`)
- Async handlers use `.catch(next)` in routes (`src/modules/auth/auth.routes.ts:11`)

## Logging
- Pino JSON logger, pretty transport in development only (`src/lib/logger.ts:8`)
- Request id middleware and request logger (`src/middleware/request-id.ts:1`, `src/middleware/request-logger.ts:1`)

## Validation
- Zod schemas per module, parsed in the controller (`src/modules/auth/auth.schemas.ts:1`)

## Configuration
- Env vars validated by a Zod schema at startup (`src/config/env.ts:8`)
- `.env` is ignored by git and not tracked; `.env.example` lists the variables (`.gitignore:10`, `.env.example:1`)

## Secrets
- JWT_SECRET, CONFIG_ENCRYPTION_KEY, TEXTBEE_API_KEY, SMTP credentials come from env (`.env.example:1`)
- Sensitive remote-config values are encrypted with `src/lib/crypto.ts` (`src/lib/crypto.ts:1`)

## Data layer
- Prisma migrations in `prisma/migrations/` (9 folders, raw SQL edited by hand where needed)
- Schema at `prisma/schema.prisma` holds Task, OTP, RefreshToken, SystemConfig and an older delivery model: Person, Account, Organization, Customer, Stock, Partnership, Payment, Debt and others (`prisma/schema.prisma:226`, `prisma/schema.prisma:251`, `prisma/schema.prisma:361`)
- Only the auth, user, tasks and remote-config modules read or write the database; the delivery tables have no endpoint yet (grep of `src/modules`)

## Auth and roles
- Phone number plus password sign-in, OTP only at registration and password reset, 5-minute OTP (`src/modules/auth/auth.service.ts:38`)
- bcrypt with 12 rounds, 30-minute lock after 5 failures (`src/modules/auth/auth.service.ts:34`)
- Access JWT verified by signature only; refresh tokens per account, hashed (`src/middleware/auth.ts:14`)
- `req.user.id` is the Account id, not a Person id (`src/middleware/auth.ts:35`)
- No Device model, no roles enforced anywhere yet

## Tests
- Framework: Vitest ^4.0.0 with Supertest (`package.json:106`, `vitest.config.ts:1`)
- Layout: `tests/unit/`, `tests/integration/`, `tests/helpers/`, `tests/fixtures/` (`tests/README.md:1`)
- Commands: `npm test`, `npm run test:integration`, `npm run test:coverage` (`package.json:16`)
- Integration tests use a real PostgreSQL on port 5434 and mock Redis (`tests/setup.ts:3`)
- Files run one at a time because they share the database (`vitest.config.ts:13`)
- Coverage thresholds: 80 lines, 75 functions, 70 branches (`vitest.config.ts:26`)
- Baseline: not recorded, tests were not run (no approval given during discovery)

## CI and security
- No CI: there is no `.github/` or other pipeline folder
- No SAST, no secret scanning, no dependency audit in any pipeline
- Helmet, CORS allowlist and a global in-memory rate limiter are enabled (`src/app.ts:56`)
- Docker image build exists (`Dockerfile:1`)

## Key dependencies
- express: ^5.1.0, @prisma/client: ^7.0.0, zod: ^3.23.8, pino: ^10.1.0, bcrypt: ^6.0.0, jsonwebtoken: ^9.0.2
- ioredis: ^5.8.0, bullmq: ^5.63.0, helmet: ^8.1.0, express-rate-limit: ^8.2.0, vitest: ^4.0.0

## Pattern files
- Route: `src/modules/user/user.routes.ts`
- Controller: `src/modules/auth/auth.controller.ts`
- Service: `src/modules/user/user.service.ts`
- Repository: `src/modules/auth/auth.repository.ts`
- Schemas: `src/modules/auth/auth.schemas.ts`
- Model: `prisma/schema.prisma`
- Migration: `prisma/migrations/20260914130000_add_refresh_tokens/migration.sql`
- Unit test: `tests/unit/crypto.test.ts`
- Integration test: `tests/integration/user.test.ts`

## Gap analysis
- Entities (24 in the design): 0 conforming. 1 close: PhoneNumberChangeLog (fields match, no immutability). 13 divergent: Person (split from Account, no `registered_at`, `password_hash`, `scope_version`, `released_phone_number`), Organization (has `type`, `ownerAccountId`), Collaboration, Product (variants, stock), Order, OrderLine, Delivery, Subscription, Report, Administrator, Notification (channel column), OtpChallenge and RefreshToken (keyed on Account, no Device). 10 missing: CustomerRelationship, CustomerPrice, CustomerRelationshipReassignment, CreditLimitChange, LedgerEntry, Expense, Handover, AdminAction, SyncArchive, Device.
- Old tables the design removes: Account, Customer, CustomerPersonReassignment, Permission, Position, PositionPermission, ProductVariant, Stock, StockMovement, Partnership*, ProductWholesalePrice, CustomerChannelRelation, ChannelChangeRequest, OrderLineChange, Payment, Debt, DebtSettlement, Refund, DebtCeiling, Receipt, OperatingCost*, InfoSharingRule, CustomerSharingException, Rating, EmailVerificationRequest, ProcessedAction.
- Features: registration and OTP resend, password reset, email verification, refresh rotation, logout and logout-all exist but diverge (no OTP at login, no Device, bcrypt, composition rules, per-account tokens). Missing: everything else in the design (organizations, relations, catalog, orders, ledger, sync, admin, notifications).
- Untouched by the design: Task, TaskResult, SystemConfig, ConfigHistory, remote-config, tasks, api-docs, health, metrics.

## Known issues
- **Insecure pattern**: Prisma logs every query to stdout, which prints personal data such as phone numbers (`src/lib/db.ts:24`). Remediation: log only errors and warnings.
- **Weak limit**: request bodies accept 10 MB of JSON for every route (`src/app.ts:80`). Remediation: a small default limit, larger only where a route needs it.
- **Rate limiter**: the global limiter uses an in-memory store, so limits reset on restart and are not shared across instances (`src/app.ts:56`). Remediation: Redis store.
- **Missing pipeline**: no CI, SAST, secret scan or dependency audit. Remediation: FND-000.
- **Design conflict**: the password schema requires upper case, lower case and a digit, which the design forbids (`src/modules/auth/auth.schemas.ts:16`). Remediation: replace with the design's rules.

## Overrides
<!-- User edits below this line. These win over any deduction. -->
