# Changelog

## 0.1.0 — Phase 1 foundation

- Secure Node.js backend with zero runtime dependencies (node:sqlite, scrypt, node:test)
- Multi-tenant schema with migrations, including the future editor/audio/brand/thumbnail/export model
- Auth (hashed session tokens, CSRF, rate limits), strict CSP, audit log, redacted rotating logs
- Projects: create, open, rename, duplicate, archive/restore
- Master Script importer (text + JSON): validation, preview, correction, confirmed import, unknown fields preserved
- Scene Manager: edit, preview, duplicate, drag-and-drop/up-down reorder, approve, reject, retry, skip
- Character Library and Asset Library with reference images and project links
- Image sources per scene (Flow default, external/ChatGPT, upload, folder, asset), filename→scene mapping preview, multiple candidates, protected approval
- Background jobs: runs, pause/resume, failure/retry, skip/cancel, checkpoints, restart recovery ("Resume from scene N")
- Simulated provider (no credits). Google Flow adapter present but disabled
- Flow Feasibility Lab (safe checks only), admin diagnostics, storage dashboard, app-owned backup script
- Secret/private-data scanner, pre-commit hook, CI workflow
- Responsive dark cinematic UI (desktop + mobile), COMING SOON placeholders for future modules
