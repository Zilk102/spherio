# Project audit

Audit date: 2026-10-19. Scope: whole repository (server, client, shared, deploy scripts, git history).
Method: manual code review, `npm audit`, secret scan of the working tree and all 13 commits, production build, live run of the game with a scripted browser.

## Summary

Sphere3D is a working, nicely structured multiplayer game: the monorepo split (`shared` / `server` / `client`) is sound, the netcode idea (authoritative server, shared kinematic step, client prediction) is right, and everything builds and plays. The weak spots are the usual ones for an AI-generated pet project: **no tests, no CI, in-memory state, thin API hardening, giant files**.

## Fixed during this audit

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | `verifyToken` accepted an **unsigned base64 "legacy" guest token**, so anyone could forge a guest identity by sending `base64({"sub":"<any userId>"})` | High | Removed the fallback. Only signed JWTs are accepted. |
| 2 | **Refresh tokens were accepted as access tokens** (30-day lifetime instead of 2 hours) | High | `verifyToken` now requires `typ === "access"`. |
| 3 | `POST /api/leaderboard/submit` was **unauthenticated**: anyone could post any score for any user | High | Endpoint removed. The server already submits scores itself at match end; the client never called it. |
| 4 | JWT secret silently fell back to a hardcoded default | Medium | Server now refuses to start with `NODE_ENV=production` and a default or empty `JWT_SECRET`. |
| 5 | No rate limiting on `/api/auth/*` (password brute force, bcrypt CPU DoS, SMTP spam through register and resend) | Medium | In-memory per-IP limiter, 20 requests per minute, plus `trust proxy` so the IP is the real client behind nginx. |
| 6 | Production VPS IP hardcoded as a default in 5 deploy scripts | Low | The host now comes from `SPHERIO_HOST` and has no default. |
| 7 | A compiled `.pyc` file was tracked in git | Low | Untracked, `__pycache__/` and `*.pyc` added to `.gitignore`. |
| 8 | A critical dependency advisory | High | `npm audit fix` (non-breaking). Critical count went to 0. |

Verified live after the changes: access token returns 200, refresh token and forged token return 401, the removed endpoint returns 404, the 20th+ auth request in a minute returns 429, and a match still starts and plays.

## Secrets and history

- No credentials, private keys or tokens found in the working tree or in any of the 13 commits. `.env`, `deploy/keys/`, `deploy/secrets/.env.production`, `mail.local` and `CREDENTIALS.txt` are git-ignored and were never committed.
- The old server IP appears in git history (scripts and `deploy/`). The server is being shut down, so this is harmless, but if you ever reuse the VPS, rotate or firewall it.
- `docker-compose.yml` ships a development Postgres password (`spherio`) and publishes Postgres and Redis ports to the host. Fine for local use, never expose it publicly.

## Open issues (not fixed)

### Security and correctness
- **Guest accounts and their coins and stats are kept in process memory** (`Map`s in `auth.ts` and `stats.ts`), and so is the in-memory leaderboard fallback when `REDIS_URL` is not set. Restarting the server wipes them, and the guest map grows without bound (a trivial memory-exhaustion vector via `POST /api/auth/guest`). Needs a TTL or Redis. Registered users and friends are stored in Postgres.
- **Remaining `npm audit` findings (13)**, mostly transitive through `colyseus@0.15` (`nanoid`, `uuid`, `elliptic`) and `nodemailer`. The proper fix is upgrading Colyseus and Nodemailer, a breaking change that needs testing.
- No security headers (`helmet`), no request body size or schema validation on the REST API (the code relies on TypeScript casts of `req.body`). The roadmap mentions zod, which was never added.
- Email verification and password rules are minimal (6-character minimum, no breach or strength check). No password reset flow.
- Chat filter is a three-word blocklist (`spam`, `cheat`, `hack`). It is a placeholder, not moderation.
- Anti-cheat covers input rate and speed clamping. It does not defend against a modified client abusing legitimate inputs (for example perfect-aim bots).

### Engineering quality
- **No automated tests.** The only check is `scripts/smoke-test.mjs`, which needs a running Docker stack. The shared kinematic step, split and eat logic are good candidates for unit tests.
- **No CI** (no `.github/workflows`).
- **Very large files**: `ArenaRoom.ts` (about 1000 lines), `menu.ts` (about 960), `Game.ts` (about 435 with heavy responsibilities). They would benefit from splitting.
- **Client bundle is 5.2 MB** (1.2 MB gzipped) because Babylon.js is imported broadly. Importing from `@babylonjs/core` sub-paths and code-splitting would cut it a lot.
- Docs have drifted: `docs/ARCHITECTURE.md` and `ROADMAP.md` still describe phases 1 and 2 and say things like "friends are in-memory" (they are now in Postgres). Several roadmap items are done but unchecked.
- The UI and docs are Russian-only; there is no localization layer (it is on the roadmap).
- Deploy tooling is Windows and Paramiko specific, with a root SSH user and a passwordless deploy key. Acceptable for a hobby VPS, not a model for production.

### Strengths worth keeping
- Shared deterministic movement code between client and server.
- Server-side input validation and rate limiting for the game loop.
- Passwords hashed with bcrypt, verification tokens stored only as SHA-256 hashes, parameterised SQL everywhere (no injection found), HTML-escaped email templates.
- Clean room abstraction: private lobbies reuse the public arena logic.
- Thoughtful polish: reconnection, skid marks, 3D skin preview, mobile controls, how-to-play overlay.

## Suggested next steps if the project is ever revived
1. Add Vitest unit tests for `shared/` and the eat/split resolvers, and a GitHub Actions workflow (build + tests).
2. Add TTLs or Redis storage for guests and their stats.
3. Upgrade Colyseus and Nodemailer, re-run `npm audit`.
4. Add `helmet`, zod request validation, and a real password-reset flow.
5. Split the three large files and trim the Babylon bundle.
