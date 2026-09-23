# Architecture

```
Desktop browser ─┐
Mobile browser  ─┤  HTTPS (reverse proxy, recommended)
                 ▼
        ASK AI VIDEO STUDIO (Node.js, single process by default)
        ├── Frontend        public/ — vanilla ES modules, no build step, strict CSP
        ├── Secure backend  src/app.js, src/api/ — JSON REST, cookie session + CSRF
        ├── Services        src/services/ — tenant-scoped domain logic
        ├── Project DB      SQLite (node:sqlite, WAL) in PRIVATE_STORAGE_ROOT/database
        ├── Media storage   PRIVATE_STORAGE_ROOT/media/<tenant>/<project>/<uuid>.<ext>
        ├── Job queue       jobs + generation_runs tables (persistent, checkpointed)
        ├── Worker          src/jobs/worker.js — embedded or `npm run worker`
        ├── Providers       src/providers/ — ImageProvider / VideoProvider / VoiceProvider adapters
        ├── Browser worker  (future) Google Flow adapter in its own process
        └── Render worker   (future) FFmpeg export
```

## Principles

- **Zero runtime dependencies.** Node built-ins only (`node:sqlite`, `crypto.scrypt`, `node:test`). This keeps supply-chain risk and weight minimal.
- **Public code / private data separation.** Every private path derives from `PRIVATE_STORAGE_ROOT`, which is validated at startup (it must not overlap the source tree, and the app never adopts foreign directories).
- **Loose coupling to Google Flow.** Project logic depends only on provider interfaces (`src/providers/types.js`). If a provider fails, the rest of the app stays operational. Flow will be one adapter, running in a separate browser-worker process.
- **Nothing long-running in a request.** Generation is enqueued as jobs, and the UI polls lightweight status endpoints.
- **Non-destructive media.** Media rows are immutable. Candidates, approvals and (future) timeline clips reference them and never modify originals.

## Request pipeline

Security headers → route match → session lookup (hashed token) → same-origin check + CSRF header on state changes → per-session rate limit → handler (tenant context from the session only) → JSON response. Errors are centralised: `AppError`s carry a safe public message, and anything else becomes a generic 500 with a reference id. Details go only to the private log.

## Job system

States: `QUEUED → PREPARING → GENERATING → DOWNLOADING → COMPLETED`, plus `FAILED`, `PAUSED`, `SKIPPED`, `CANCELLED` and `INTERRUPTED`. Transitions are validated (`src/jobs/states.js`) and applied with compare-and-set SQL, so a user's Pause is never overwritten by the worker.

- One job at a time (bounded), a 10-minute hard timeout per job, a heartbeat and a checkpoint at every step.
- The final step is a single transaction (media + candidate + COMPLETED), and at most one candidate exists per job, so retries are idempotent.
- **Recovery:** on worker start, jobs left in an active state become `INTERRUPTED`. The run then offers **"Resume from scene N"**. Completed jobs are never re-run, and a completed prompt+provider is never regenerated automatically.
- No automatic retries. Retry is always an explicit user action, which prevents accidental paid-credit usage.

## Frontend

A small SPA (~100 KB total, no framework). Views load lazily per route, images are lazy-loaded with `loading="lazy"` via an authenticated media endpoint (thumbnails when FFmpeg is available), and polling runs only while work is active and the tab is visible. All DOM text is set via `textContent` (no `innerHTML`), which enforces XSS safety together with the CSP.

Responsive layouts: a sidebar studio layout on desktop. On mobile (≤ 860px) there's a top bar, a slide-in menu, a bottom navigation, stacked scene cards and up/down reorder buttons.
