# Voting System — Live Demo

A secure, anonymous electronic voting platform, originally built for a real
~600-voter student association election. **This repo is a public,
fictional-data demo** of that system — same codebase, same features, no
real students or votes.

**Try it live:** _[add your deployed demo URL here]_
**Admin dashboard:** _[same URL]/admin_ — login `admin` / _(see below)_

## What this demonstrates

- **Anonymous voting** — ballots are stored with no link back to who cast
  them (no matric number column on the ballots table at all).
- **OTP-based auth** — 6-digit one-time codes, rate-limited, single-use.
- **7-position ballot** with a "Vote of Confidence" (50%+) threshold rule,
  including unopposed races.
- **Runoff elections** — when no candidate clears 50%, the EC can open a
  runoff between the top 2 candidates for just the affected positions,
  without touching the original round's results.
- **Full admin control center** — live tally, turnout, election open/close,
  runoff open/close, a manual "publish results" gate (so results never leak
  before an official announcement), EC member management, an audit log, and
  a pre-election voter-registration integrity checker.
- **Public results page** with per-ballot receipt verification (proves your
  vote was counted, without revealing who you voted for).

## Demo mode

This deployment runs with `DEMO_MODE=true` on the backend, which changes a
few things from the real system:

- Logging in with any ID auto-creates a fresh demo voter — click **New ID**
  on the login page to get one instantly, no signup needed.
- Your one-time code is shown on screen instead of emailed (no real inbox
  needed).
- An admin-only reset endpoint periodically wipes votes back to a clean
  slate for the next visitor.

See `DEMO_SETUP.md` in the original project for exactly how this mode was
added on top of the real system.

## Stack

React 19 + TypeScript + Tailwind CSS · Python 3.12 + FastAPI · PostgreSQL ·
deployed on Vercel + Render + Supabase (all free tier for this demo).

---

_Built by [Buluma Enosi] — [https://bulumaenosi-portifolio.vercel.app/]._
