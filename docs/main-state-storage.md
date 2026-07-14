# Main AppState storage and cloud sync

## Storage layers

The main planner state uses three deliberately separate durability layers.

1. `localStorage` is the synchronous emergency cache used during iOS `pagehide` and staged migration.
2. Account-scoped IndexedDB is the primary device repository. Subjects, materials, tasks, sessions, history, availability, day plans, and fixed events are stored in separate object stores and written transactionally.
3. Cloudflare D1 stores immutable chunked generations. A generation is invisible until every chunk has been uploaded, verified, and the per-user head has moved atomically.

The legacy `user_data.app_state` row remains readable only while an account has no chunked head. Once a chunked generation is committed, legacy GET/PUT returns HTTP 426 so an older client cannot roll the account back.

## D1 deployment order

Apply the database migration before deploying a client that expects `/api/data/v2`:

```bash
npm run d1:migrate
```

For a fresh local or remote database created from `schema/schema.sql`, also apply `schema/main-state-chunks.sql`. The provided schema scripts do both:

```bash
npm run d1:schema:local
npm run d1:schema
```

A deployment where the Pages Function exists but the new tables do not returns `503` with `MAIN_STATE_SCHEMA_MISSING`. The client may use the legacy endpoint only for this explicit migration gap or when `/api/data/v2` does not exist. A general `503` never falls back to legacy writes.

## Generation protocol

1. The client encodes AppState into deterministic sections and JSON-array chunks.
2. `begin` creates or resumes a staging generation using a unique mutation ID and the expected cloud version.
3. `putChunk` verifies the manifest hash, UTF-8 byte length, section, and chunk index. Repeating an identical request is idempotent.
4. `commit` reloads every chunk from D1, verifies all hashes and counts, reconstructs AppState, runs server-side referential validation, rechecks the optimistic-lock base, and atomically advances `main_state_heads`.
5. Readers can access chunks only through the currently committed head.

Limits:

- One chunk: 384 KiB
- One HTTP request: 1 MiB
- One generation: 64 MiB
- Upload concurrency from the client: 4

A single entity larger than one chunk is rejected instead of being split into an invalid partial object.

## Failure and recovery behavior

- A network interruption leaves a staging generation that can be resumed with the same mutation ID.
- A missing chunk prevents commit and leaves the previous head visible.
- Two devices may upload from the same base, but only the first valid commit advances the head; the other receives HTTP 409.
- Replaying a committed mutation succeeds only while that generation is still the current head. It returns 409 after a later head replaces it.
- The current generation and two previous committed generations are retained for recovery.
- Staging generations older than seven days are removed after a successful commit.
- Cloud responses use `Cache-Control: no-store`.

## Required verification before merge or deployment

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration:browser
npm run test:integration:api
npm run test:e2e
npm run build
```

`test:integration:api` starts real local Cloudflare Pages Functions and D1. Its main-state fixture exceeds the former 5 MiB blob limit and covers resumable upload, idempotency, hash rejection, legacy migration, and concurrent optimistic locking.
