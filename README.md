# ASK AI Video Studio

An AI-assisted video-production studio. You write a story as a scene-by-scene Master Script, generate or import images for each scene, approve them, and (in later phases) turn them into videos, edit and export.

**Status: Phase 1 — secure foundation.** Projects, the Master Script importer, the Scene Manager, the Character/Asset libraries, multi-source images with approval, the background job queue with pause/resume/retry and crash recovery, and an isolated Flow Feasibility Lab all work today. Google Flow automation is **not enabled** yet. Modules that are not built yet show **COMING SOON** in the UI.

## Quick start

Requirements: Node.js ≥ 22.5. There are **no npm runtime dependencies**, so no `npm install` is needed.

```bash
git clone <this repository> app && cd app
cp .env.example .env                      # then edit: PRIVATE_STORAGE_ROOT, APP_SECRET
npm run setup-hooks                       # enables the pre-commit secret scan
npm run create-user -- --email you@your-domain.example --name "Your Name"
npm start                                 # http://127.0.0.1:4310
```

`PRIVATE_STORAGE_ROOT` must be an absolute path **outside** the checkout, e.g. `/private/runtime/path`. The app refuses to start if it overlaps the source tree, or if it points at an existing non-empty directory that the app did not create.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start the web app (+ embedded worker) |
| `npm run worker` | Standalone worker (`WORKER_MODE=external`) |
| `npm test` | Full test suite (fake data only; no secrets needed) |
| `npm run secret-scan` | Scan all tracked files for secrets / private data |
| `npm run backup` | App-owned backup into `PRIVATE_STORAGE_ROOT/backups` |
| `npm run flow-lab` | Safe Flow feasibility checks (no login, no credits) |
| `npm run create-user` | Create a studio + owner account |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Data model](docs/DATA_MODEL.md)
- [Flow feasibility](docs/FLOW_FEASIBILITY.md)
- [Roadmap](docs/ROADMAP.md)
- [Changelog](docs/CHANGELOG.md)

## Public repository rule

This repository may be public. It contains only source code, synthetic assets, sanitized docs, migrations and tests with fake data. **All** runtime data lives in `PRIVATE_STORAGE_ROOT` and never enters Git: databases, media, logs, backups, browser profiles and sessions.
