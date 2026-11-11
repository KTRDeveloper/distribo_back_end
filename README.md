# Distribo — Back End

REST API for Distribo, built with TypeScript, Express 5, Prisma (PostgreSQL), Redis and BullMQ.
It provides phone/OTP-based registration, access/refresh token authentication, user profiles,
background jobs and encrypted remote configuration.

## Requirements

- Node.js **22** or later, npm **10** or later
- Docker (recommended, to run PostgreSQL and Redis locally) — or your own PostgreSQL 16 and Redis 7

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL and Redis

```bash
docker-compose -f docker/docker-compose.yml up -d
```

This starts PostgreSQL on port **5435** (database `distribo_db`) and Redis on port **6380**.

### 3. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`. When using the Docker services above, set:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/distribo_db
REDIS_URL=redis://localhost:6380
```

Also replace every placeholder secret (`JWT_SECRET`, `ANDROID_ID_HASH_KEY`, `CONFIG_ENCRYPTION_KEY`, `TEXTBEE_API_KEY`,
`SMTP_*`). `CONFIG_ENCRYPTION_KEY` can be generated with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Never commit `.env`.

### 4. Apply database migrations

```bash
npm run db:migrate:dev
```

### 5. Run the app

```bash
npm run dev
```

This starts, side by side, the API server, the task worker and the OTP delivery worker. The API
listens on `http://localhost:3000` (configurable with `PORT`).

## API Overview

| Base path | Purpose |
|---|---|
| `/api/v1/health`, `/api/v1/health/ready`, `/api/v1/health/live` | Health, readiness and liveness checks |
| `/api/v1/metrics` | Prometheus metrics |
| `/api/v1/auth` | Registration with OTP (`/register`, `/register/verify`, `/register/resend`), `/login`, password reset, email verification, `/refresh`, `/logout`, `/logout-all` |
| `/api/v1/users` | Current user profile (`GET`/`PATCH /me`) |
| `/api/v1/tasks` | Background task creation and status |
| `/api/v1/remote-config` | Encrypted remote configuration with change history |

### Interactive documentation

Outside production, browse and try every endpoint at [`/api/v1/docs`](http://localhost:3000/api/v1/docs)
(Swagger UI), backed by the live OpenAPI document at `/api/v1/docs/openapi.json`. A standalone, versioned
copy of the same document lives in [`openapi/openapi.json`](./openapi/openapi.json) — see
[`openapi/README.md`](./openapi/README.md) for how to regenerate it after changing an endpoint.
A Postman collection is also available in [`postman_collection.json`](./postman_collection.json).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | API server + workers with hot reload |
| `npm run build` / `npm start` | Build to `dist/` and run the compiled server |
| `npm run worker` / `npm run otp-worker` | Run the compiled workers |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:coverage` | Tests with coverage report |
| `npm run test:integration` | Integration tests against a disposable Docker PostgreSQL |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run typecheck` | TypeScript type check |
| `npm run db:studio` | Open Prisma Studio |
| `npm run openapi:generate` | Regenerate `openapi/openapi.json` |

See [`tests/README.md`](./tests/README.md) for details on the test setup.

## Project Structure

```text
src/
  modules/        Feature modules (auth, user, tasks, remote-config, health, api-docs)
  lib/            Shared services (db, redis, queues, jwt, otp, sms, email, logging, metrics)
  middleware/     Auth, request id, logging, error handling
  workers/        BullMQ workers (tasks, OTP delivery)
  config/         Environment validation
prisma/           Schema and migrations
data-model/       Source-of-truth data model documentation
openapi/          Generated OpenAPI specification
docker/           Local and test Docker Compose files
tests/            Unit and integration tests
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](./LICENSE).
