# Flow Feasibility — Phase 2 Stage A

Phase 2 rule: **VERIFY FIRST, AUTOMATE SECOND.** Stage B (Flow automation) must not begin until Stage A passes **on the intended VPS**.

The lab lives in `src/flow-lab/`. Run it with `npm run flow-lab`, or from Settings → Flow Feasibility Lab (admin only). It is isolated from production, and it:
- never signs in, never types into Google pages and never submits prompts;
- **never consumes credits**;
- uses a temporary 0700 profile under `PRIVATE_STORAGE_ROOT/browser-profiles/_lab/`, deleted afterwards;
- proves each mechanic against a local `127.0.0.1` test page.

The only contact with Google is one unauthenticated page load of Flow, and only with explicit consent (`--check-flow-navigation`).

Status vocabulary: **VERIFIED** (tested, with evidence), **NOT VERIFIED**, **BLOCKED**, **REQUIRES MANUAL TEST**.

## Results

| Check | Build container (root, headless) | Build container (headed via Xvfb) | Build container (non-root) | **Intended VPS** |
|---|---|---|---|---|
| Chrome/Chromium executable | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED — lab not yet run on VPS |
| Non-root execution (sandbox on) | BLOCKED (ran as root) | BLOCKED (ran as root) | VERIFIED | NOT VERIFIED |
| Display for headed browser | BLOCKED | VERIFIED | BLOCKED | NOT VERIFIED |
| Private profile/download dirs (0700) | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Browser start-up, isolated profile | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Page navigation + DOM read | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Download into private dir (non-zero, no symlink) | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Timeout handling | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Clean close + restart | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Profile persistence (cookie survives restart) | VERIFIED | VERIFIED | VERIFIED | NOT VERIFIED |
| Flow page loads (not signed in) | BLOCKED¹ | NOT VERIFIED (not run) | NOT VERIFIED (not run) | NOT VERIFIED |
| Manual Google login | REQUIRES MANUAL TEST | — | — | REQUIRES MANUAL TEST |
| Google session persistence | REQUIRES MANUAL TEST | — | — | REQUIRES MANUAL TEST |
| Flow usable when signed in | REQUIRES MANUAL TEST | — | — | REQUIRES MANUAL TEST |
| Image / image-to-video workflow | REQUIRES MANUAL TEST (credits) | — | — | REQUIRES MANUAL TEST (credits) |
| Flow result download, selectors, error behaviour | REQUIRES MANUAL TEST | — | — | REQUIRES MANUAL TEST |

¹ The build container's outbound network policy blocked the connection (`ERR_TUNNEL_CONNECTION_FAILED`). This says nothing about Google or the VPS.

The build container is Ubuntu 24.04 x86_64 with Chromium 141. These results prove that the **browser-worker mechanics** work, and that the proposed display approach (Xvfb) and non-root execution work on that platform. They are **not** VPS results.

**Stage A status: NOT PASSED** — the lab has not yet been run on the VPS, and a display is required for manual login.

## Running Stage A on the VPS

From the app checkout, as the user that will run the app, with `.env` pointing `PRIVATE_STORAGE_ROOT` at the private runtime:

```bash
npm run flow-lab                              # safe mechanics, no Google contact
npm run flow-lab -- --check-flow-navigation   # + one unauthenticated Flow page load (consent)
```

Exit code 0 means `Stage A: READY FOR MANUAL LOGIN`, and 2 means not passed; blocking items are listed. The report is saved privately at `PRIVATE_STORAGE_ROOT/flow-lab/latest-report.json` (never in Git).

## RISK APPROVAL REQUIRED — display for manual Google login

- **Required component:** a display that a visible Chromium window can use, plus a way for you to see and type into it. Optionally, a dedicated non-root OS user for the browser worker.
- **Reason:** Google sign-in (email, password, MFA, CAPTCHA, verification) must be done **by you**, in a normal visible browser, in the dedicated profile. Headless browsers are frequently refused by Google sign-in, and ASK Studio must never handle the password.
- **Proposed isolated solution (lightweight, no desktop environment):**
  1. Install only the packages `xvfb` and `x11vnc` (Ubuntu). No desktop environment, no window manager, no config changes to existing services.
  2. When a login is needed, start `Xvfb :99 -nolisten tcp` and `x11vnc -display :99 -localhost -rfbauth <private-runtime>/config/vnc.pass -once`, **as the app user**, only for the duration of the login.
  3. Chromium opens the dedicated profile on `:99`. From your PC you run `ssh -L 5999:127.0.0.1:5900 <vps>` and connect a VNC viewer to `127.0.0.1:5999`, then sign in with Google yourself.
  4. Close the browser. Xvfb and x11vnc stop. Nothing stays running.
  5. Recommended: create a dedicated non-root user (e.g. `aavs`) to own the app and the private runtime, so Chromium runs with its sandbox enabled.
- **Server components affected:** two new apt packages; optionally one new OS user. Existing services, the reverse proxy, the firewall, SSH configuration and ports are **not touched**. VNC listens on localhost only and is reached through your existing SSH access.
- **Security implications:** anyone with shell access as the app user could view the virtual display while it runs; VNC uses a password stored in the private runtime and is never exposed publicly; the Google profile (cookies) lives in `PRIVATE_STORAGE_ROOT/browser-profiles/<tenant>/<profile>/` with mode 0700.
- **Rollback:** `sudo apt remove xvfb x11vnc`, then `sudo userdel -r aavs` if created, then delete the profile directory.
- **Alternatives:**
  - (a) SSH X11 forwarding (`ssh -X`). Needs `xauth` on the server and an X server on your PC; slower, but no VNC.
  - (b) Headless Chromium with DevTools remote screencast over an SSH tunnel. Nothing to install, but Google may refuse sign-in in headless mode.
  - (c) Keep Flow on your own PC and import images/videos into the studio (External workflow, already working).

**Nothing in this section has been done on the VPS. It waits for your approval.**

## Rules for the future Flow adapter (Stage B, after Stage A passes)

- A separate browser-worker process, using the CDP launcher in `src/browser/cdp.js`. A Flow failure never takes down the app.
- One profile per Flow account at `browser-profiles/<tenant-id>/<profile-id>/` (opaque ids only, 0700, never in Git). **No Google passwords stored.**
- CAPTCHA/MFA/verification → **PAUSE** for the user. Never bypass.
- The account can't continue → pause the queue; you select another account; resume. **No automatic rotation.**
- Every credit-consuming action needs explicit approval. The first real test is ONE scene only.
