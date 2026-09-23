# Flow Feasibility Lab

The lab is **isolated** from the production pipeline (`src/flow-lab/`, Settings → Flow Feasibility Lab, or `npm run flow-lab`). Its safe checks never sign in, never open a Flow project, never submit prompts and **never consume Google credits**. Production Flow automation is hard-disabled in Phase 1 (`flowAutomationEnabled: false`, and the provider reports itself unavailable).

Status vocabulary: **VERIFIED** (actually tested here), **NOT VERIFIED**, **BLOCKED**, **REQUIRES MANUAL TEST**.

## Results in the Phase 1 build/test environment

These are from an ephemeral Linux x86_64 build container, not the target VPS. **Re-run `npm run flow-lab` on the VPS.** Results there may differ.

| Item | Status | Notes |
|---|---|---|
| Chromium/Chrome available | VERIFIED | A pre-installed Chromium was detected (read-only use) |
| Headless launch | VERIFIED | Rendered `about:blank` in a temporary isolated profile, deleted afterwards |
| Isolated profile directory | VERIFIED | Under `PRIVATE_STORAGE_ROOT/browser-profiles/` |
| Headed browser / interactive login | BLOCKED | No display server. Needs a remote desktop/VNC session or a local machine |
| Chromium sandbox | NOT VERIFIED | Environment ran as root (`--no-sandbox` required). Run the browser worker as a non-root user |
| Google Flow host reachability | NOT VERIFIED | Optional, and only on explicit request |
| Interactive Google login (no stored password) | REQUIRES MANUAL TEST | |
| Authentication persistence across restarts | REQUIRES MANUAL TEST | |
| Google Flow access | REQUIRES MANUAL TEST | |
| Image generation workflow | REQUIRES MANUAL TEST | **May consume credits. Needs explicit approval first** |
| Image-to-video workflow | REQUIRES MANUAL TEST | **May consume credits. Needs explicit approval first** |
| Download | REQUIRES MANUAL TEST | |
| Session persistence (days) | REQUIRES MANUAL TEST | |
| Timeout behaviour | REQUIRES MANUAL TEST | |
| Error behaviour (quota, policy, CAPTCHA/MFA pause) | REQUIRES MANUAL TEST | |
| UI selector stability | REQUIRES MANUAL TEST | |

Nothing above is claimed as working unless it is marked VERIFIED.

## Rules for the future Flow adapter

- Runs in a separate browser-worker process. A Flow failure must never take down the app.
- One isolated profile per account in private storage. **Never** stores Google passwords, and never commits profiles, cookies or screenshots of private account data.
- Login is Google's normal interactive flow. On CAPTCHA/MFA/verification: **PAUSE** and let the user complete it. Never bypass.
- If the current account cannot continue: pause and show **CURRENT FLOW ACCOUNT CANNOT CONTINUE**. The user selects another signed-in account and presses **SWITCH & RESUME**. No automatic rotation to bypass limits.
- Any action that may consume credits requires explicit confirmation (`confirmCredits`, already enforced by the job API for credit-consuming providers).

## Suggested manual validation sequence (Phase 2, with your approval)

1. Run the lab on the VPS. Provide a display (VNC/remote desktop) for the browser worker, running as a non-root user.
2. Sign in manually once in an isolated profile, then restart and check persistence.
3. Open Flow **without generating** and record the selectors.
4. Only after explicit approval: run one image generation and one image-to-video generation, then verify download.
