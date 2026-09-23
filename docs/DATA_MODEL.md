# Data model

SQLite. Migrations live in `migrations/` and are applied automatically at startup (`schema_migrations`). IDs are immutable UUIDv4, and all timestamps are ISO-8601 UTC. Every tenant-owned row carries `tenant_id`.

## Core (Phase 1, `001_core.sql`)

| Table | Purpose / key fields |
|---|---|
| `tenants` | Customer/studio. `plan` ∈ FREE, PRO, BUSINESS, INTERNAL (billing not implemented) |
| `users` | `tenant_id`, email (unique, case-insensitive), scrypt `password_hash`, `role` ∈ owner/admin/member |
| `sessions` | `token_hash` (SHA-256 of the cookie), `csrf_token`, expiry |
| `projects` | title, description, `aspect_ratio` (default 16:9), `scene_duration_sec` (default 10), `status` ACTIVE/ARCHIVED (soft archive), thumbnail, owner, tenant, timestamps |
| `scenes` | position, `scene_code` (SCENE_ID) and every Master Script field, `extra_json` (unknown fields preserved), `image_source` (FLOW default), `image_status`, `video_status`, `approved_candidate_id`, soft `deleted_at` |
| `media` | Immutable file record: `storage_key` (server-generated), mime, bytes, sha256, dimensions, `original_filename` (display only), source |
| `image_candidates` | Scene ↔ media with `source` (FLOW, EXTERNAL, UPLOAD, FOLDER, ASSET, SIMULATED) and `status` (CANDIDATE, APPROVED, REJECTED). A partial unique index allows **one approved image per scene**. `job_id` is unique (idempotency) |
| `characters`, `character_images`, `project_characters` | Reusable characters (name, role, description, appearance, costume, continuity, voice notes, reference images) linked to many projects |
| `library_assets`, `project_assets` | Reusable assets (VEHICLE, LOCATION, PROP, LOGO, REFERENCE) with a preview image |
| `generation_runs` | Groups the jobs of one "Generate" action. State ACTIVE/PAUSED/COMPLETED/CANCELLED |
| `jobs` | owner, tenant, project, scene, run, `sequence`, type, provider, state, progress, `retry_count`, `idempotency_key`, `checkpoint_json`, safe `error_summary`, heartbeat and timestamps. A partial unique index allows only one open job per key |
| `provider_accounts` | Future Flow accounts: label, `profile_key`, status, `is_selected`. **No passwords, cookies or tokens** |
| `audit_log` | Action, target and redacted metadata |

## Prepared for future phases (`002_future_modules.sql`)

- `timelines`, `timeline_tracks` (VIDEO, AUDIO, TEXT, OVERLAY, LOGO, SUBTITLE, EFFECT; audio roles VIDEO_AUDIO, VOICE, NARRATION, BGM, SFX, AMBIENT; mute, solo, lock, volume, ducking settings)
- `timeline_clips`: non-destructive trims (`source_in_ms`/`source_out_ms`), speed, reverse, freeze frame, per-clip volume, fades, transform (crop, position, scale, rotation, flip, zoom/pan, opacity), text and effects
- `keyframes` (position, scale, rotation, opacity, blur, volume) and `transitions` (fade, cross dissolve, blur, zoom, slide, swipe, push, flash, glitch, camera shake, film burn; adjustable duration)
- `effect_presets` ("save as preset" for text effects, video effects, transitions and styles), `subtitles`
- `brand_kits` (channel name, logo, watermark position/opacity, intro/outro, subscribe animation, fonts, styles)
- `thumbnail_designs` (1280×720, background from best frame / external / character image, layers, templates)
- `exports` (1080p/720p/custom, 16:9 / 9:16 / 1:1, MP4 H.264)
