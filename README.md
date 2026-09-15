# Spyne Design Desk

Request form → automatic Slack ping → Manager dashboard with full details.

## What this does

1. **Submit request** — anyone fills the form.
2. **Slack** — channel gets a short message only:
   - Name
   - Team
   - Project name
   - Needed by
   - Where it will be used
3. **Manager dashboard** — Agrim sees every field (email, brief, work type, priority, format, links, etc.).

## Setup (local)

```bash
npm install
cp .env.example .env
# edit .env → paste SLACK_WEBHOOK_URL
npm start
```

Open http://localhost:3000

### Slack Incoming Webhook

1. Create a channel (e.g. `#design-requests`).
2. In Slack: channel → Integrations → **Add an app** → **Incoming Webhooks** (or [api.slack.com/apps](https://api.slack.com/apps) → Incoming Webhooks → Add to channel).
3. Copy the webhook URL into `.env`:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APP_URL=http://localhost:3000
```

Without the webhook, submissions still save; Slack is skipped and the Manager dashboard shows a “Missed” flag.

## GitHub + Railway

1. Create an empty GitHub repo.
2. Push this project:

```bash
git init
git add .
git commit -m "Design Desk: form, Slack notify, manager dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

3. On Railway: New Project → Deploy from GitHub → select this repo.
4. Add variables:
   - `SLACK_WEBHOOK_URL` = your webhook
   - `APP_URL` = your Railway public URL (e.g. `https://….up.railway.app`)
5. Deploy. Share the public URL as the request form link.

**Note:** File storage (`data/requests.json`) is fine for early testing. For production on Railway, switch to Postgres so data survives redeploys — we can add that next.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Status + whether Slack is configured |
| GET | `/api/requests` | All requests (manager) |
| GET | `/api/requests/:id` | One request |
| POST | `/api/requests` | Submit form (saves + Slack) |

## What you need to provide

- Slack channel name + **Incoming Webhook URL**
- GitHub repo (you create it; then push this code)
- Later: Railway project (or we wire it) + `APP_URL`
