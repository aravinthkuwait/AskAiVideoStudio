# Roadmap

## Phase 0 — VPS safety & feasibility ✅
Read-only discovery, isolated workspace, public/private separation.

## Phase 1 — Secure production foundation ✅
Auth, multi-tenant data model, projects, Master Script importer, Scene Manager, Character/Asset libraries, multi-source images with approval protection, background jobs with pause/resume/retry/recovery, Flow Feasibility Lab, diagnostics, storage dashboard, backups, secret scanning, tests.

## Phase 2 — Google Flow image → video (in progress)

**Stage A (feasibility):** lab built and verified in the build container; **pending on the VPS** and on approval of the display solution (see FLOW_FEASIBILITY.md).
**Stage B (automation):** not started — gated on Stage A.

Original plan:
1. Run the Flow Lab on the target VPS. Set up a display for headed login and a non-root browser user.
2. Manual login and persistence validation (no credits).
3. Browser-worker process plus the `GOOGLE_FLOW` ImageProvider adapter with CAPTCHA/MFA pause.
4. Flow Accounts UI (add, sign in, select, SWITCH & RESUME), with explicit credit confirmation.
5. One approved credit-consuming test, then a gated rollout.

## Phase 3 — Image-to-video
VideoProvider adapter, using the approved image as input, video candidates and video approval.

## Phase 4 — Editor
Multi-track, non-destructive timeline, keyframes, transitions and text effects with presets.

## Phase 5 — Audio & subtitles
Voice/narration/BGM/SFX tracks, auto-ducking, subtitle tracks and styles.

## Phase 6 — Brand Kit, Thumbnail Studio, Export
FFmpeg MP4 H.264 renderer worker, presets, thumbnails (JPG/PNG).

## Later
Customer onboarding, FREE/PRO/BUSINESS editions, a mobile app reusing the REST API.
