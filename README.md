# Jet Bank — AI Pilot Tester

A small PIN-protected web app for testing chat widgets. It is set up for the
**Genesys AI pilot**: the Genesys web messenger ("AI Pilot Test" deployment) is
loaded by default, and testers can log bad answers in a feedback form.

- **Test page** (`/`) — the active embed, a test guide, and the feedback form.
- **Feedback export** (`/api/feedback.csv`) — every report as CSV (opens in Excel).
- **Hidden settings** (`/settings`) — add/edit/delete embed snippets. Not linked from anywhere.
- **PIN lock** — everything is locked until the PIN (`APP_PIN`) is entered.

## How the AI pilot is wired

```
Tester ─▶ this page ─▶ Genesys web messenger (deployment "AI Pilot Test")
                         └─▶ Architect flow "AI Pilot - Test"
                               └─▶ Bot Connector "Jet Pilot" ─▶ Laconics (ahk.al)
                               └─▶ handover / failure ─▶ ACD queue
```

The messenger only loads on domains allowed in **Genesys Admin → Messenger
Deployments → AI Pilot Test → Restrict domain access**. After deploying, add
this app's domain there, or the chat launcher will not appear.

## Render modes

| Mode | Use when the embed is… |
|------|------------------------|
| `inline` | A snippet that must run on the real page — **use this for Genesys**. |
| `sandbox` | Any other HTML/JS snippet, rendered in an isolated iframe. |
| `iframe-url` | Just a URL to load inside an `<iframe>`. |
| `script-url` | Just a URL to load as an external `<script src>`. |

## Run locally

```bash
npm install
APP_PIN=123456 npm start
# open http://localhost:3000
```

The Genesys chat will only show on localhost if `localhost` is an allowed domain on the deployment.

## Deploy on Coolify

1. **New Resource → Application → from this Git repo**, build pack **Dockerfile**.
2. Exposed **port**: `3000`.
3. **Environment variables**:
   - `APP_PIN` — **required**. If it is missing, a random PIN is generated and printed in the logs.
   - `GENESYS_DEPLOYMENT_ID`, `GENESYS_ENV` — optional, to point at a different messenger deployment.
4. **Persistent storage** — mount a volume at `/app/data` so embeds and feedback survive redeploys.
5. Deploy, then add the app's domain to the Genesys deployment (see above).

Data files on the volume: `config.json` (embeds) and `feedback.jsonl` (tester reports).
