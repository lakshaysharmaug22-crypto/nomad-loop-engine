# ADR 0004: Storage and job queue behind ports, with zero-setup defaults

Status: accepted

## Context

The API must be trivial to run locally (clone, install, start) and still be deployable as a service that survives restarts and scales workers. Requiring Postgres and Redis for a first run is a barrier; building only for local use leaves obvious production gaps.

## Decision

Define two ports in `apps/api`:

- `RunStore`: runs, their ordered events, sweeps. Implemented by `FileRunStore` (run folders on disk, which the engine writes anyway) and `PgRunStore` (Postgres with ordered migrations under an advisory lock).
- `JobQueue`: enqueue, cancel, depth, bounded-concurrency processing. Implemented by `InProcessQueue` and `BullMqQueue` (Redis).

`DATABASE_URL` and `REDIS_URL` select the production adapters. Both pairs pass one shared contract test suite (`apps/api/test/adapters.test.ts`), which CI runs against real Postgres and Redis service containers.

Jobs carry their own input, so any worker on the same Redis can execute them. Artifacts (screenshots, thumbnails, generated tests) stay on disk in both modes; only metadata and events move to Postgres.

## Consequences

- `npm run dev` works with nothing else installed. Production mode is a configuration change, not a code change.
- Stop requests are held in the worker's memory. With several API instances, a stop reaches only the instance running that job; a Redis-backed stop flag would fix this.
- Artifacts on local disk mean multiple instances need a shared volume or object storage. The artifact path is isolated behind one method, so moving to S3-compatible storage is contained.
