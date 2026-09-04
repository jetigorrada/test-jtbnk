# Jet Bank — Embed Tester

A tiny PIN-protected web app for testing different chatbox embed codes.

- **Main test page** (`/`) — shows the selected embed and lets you switch between saved ones.
- **Hidden settings** (`/settings`) — add/edit/delete embed snippets. Not linked from anywhere.
- **PIN lock** — everything is locked until the correct PIN is entered. Default PIN: **1211**.

## Render modes (works with all embed styles)

When saving an embed you pick how it should be rendered:

| Mode | Use when the embed is… |
|------|------------------------|
| `sandbox` | Any HTML/JS snippet — rendered in an isolated iframe (safest default). |
| `inline` | A snippet that must attach to the real page body (`document.body...`). |
| `iframe-url` | Just a URL to load inside an `<iframe>`. |
| `script-url` | Just a URL to load as an external `<script src>`. |

A ready-to-paste sample widget is in [`examples/jetbank-chatbot.html`](examples/jetbank-chatbot.html).

## Run locally

```bash
npm install
npm start
# open http://localhost:3000  (PIN: 1211)
```

## Deploy on Coolify

1. Push this repo to GitHub (or your Git provider).
2. In Coolify: **New Resource → Application → from your Git repo**.
3. Build pack: **Dockerfile** (auto-detected — a `Dockerfile` is included).
4. Set the exposed **Port** to `3000`.
5. **Environment variables** (optional):
   - `APP_PIN` — override the default PIN (`1211`).
   - `PORT` — defaults to `3000`.
6. **Persistent storage** — add a volume so saved embeds survive redeploys:
   - Mount path: `/app/data`
7. Deploy. Open the app URL, enter the PIN, then go to `/settings` to add embeds.

> Saved embeds are stored in `/app/data/config.json`. Without a mounted volume they reset on every redeploy.
