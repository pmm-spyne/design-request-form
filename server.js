/**
 * Spyne Design Desk — API
 * POST /api/requests  → save full payload + Slack (short summary)
 * GET  /api/requests  → manager dashboard data
 * GET  /api/requests/:id
 * GET  /api/health
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "requests.json");
const RAW_SLACK = (process.env.SLACK_WEBHOOK_URL || "").trim();
const SLACK_WEBHOOK_URL =
  RAW_SLACK && !/XXX|YYY|ZZZ|your.webhook|example/i.test(RAW_SLACK) ? RAW_SLACK : "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readRequests() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeRequests(list) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
}

function nextId(list) {
  const nums = list.map((r) => {
    const m = String(r.id || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return "DSN-" + String(n).padStart(4, "0");
}

function priorityLabel(p) {
  return { p0: "Critical", p1: "High", p2: "Normal" }[p] || "Normal";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Short Slack message — only the 5 key fields */
function buildSlackPayload(req) {
  const dashboardLink = APP_URL
    ? `\n<${APP_URL}/?view=manager&id=${encodeURIComponent(req.id)}|Open in Manager dashboard>`
    : "";

  const text =
    `*New design request* · \`${req.id}\`\n` +
    `• *Name:* ${req.requesterName}\n` +
    `• *Team:* ${req.team}\n` +
    `• *Project:* ${req.projectName}\n` +
    `• *Needed by:* ${fmtDate(req.neededBy)}${req.priority && req.priority !== "p2" ? ` (${priorityLabel(req.priority)})` : ""}\n` +
    `• *Where it will be used:* ${req.whereUsed || "—"}` +
    dashboardLink;

  return {
    text: `New design request: ${req.projectName} (${req.id})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New design request", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Name*\n${req.requesterName}` },
          { type: "mrkdwn", text: `*Team*\n${req.team}` },
          { type: "mrkdwn", text: `*Project*\n${req.projectName}` },
          { type: "mrkdwn", text: `*Needed by*\n${fmtDate(req.neededBy)}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Where it will be used*\n${req.whereUsed || "—"}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `\`${req.id}\`${req.priority && req.priority !== "p2" ? ` · ${priorityLabel(req.priority)}` : ""}${APP_URL ? ` · <${APP_URL}/?view=manager&id=${encodeURIComponent(req.id)}|Open dashboard>` : ""}`,
          },
        ],
      },
    ],
  };
}

async function notifySlack(request) {
  if (!SLACK_WEBHOOK_URL) {
    return { sent: false, reason: "SLACK_WEBHOOK_URL not set" };
  }
  const payload = buildSlackPayload(request);
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack ${res.status}: ${body.slice(0, 200)}`);
  }
  return { sent: true };
}

function validateBody(body) {
  const errors = [];
  const required = [
    ["requesterName", "Your name"],
    ["requesterEmail", "Work email"],
    ["team", "Team"],
    ["projectName", "Project name"],
    ["brief", "Brief / requirements"],
    ["neededBy", "Needed by"],
    ["whereUsed", "Where it will be used"],
  ];
  for (const [key, label] of required) {
    if (!body[key] || !String(body[key]).trim()) errors.push(`${label} is required`);
  }
  const email = String(body.requesterEmail || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Work email looks invalid");
  }
  return errors;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    slackConfigured: Boolean(SLACK_WEBHOOK_URL),
    time: new Date().toISOString(),
  });
});

app.get("/api/requests", (_req, res) => {
  const list = readRequests().sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
  res.json({ requests: list });
});

app.get("/api/requests/:id", (req, res) => {
  const found = readRequests().find((r) => r.id === req.params.id);
  if (!found) return res.status(404).json({ error: "Request not found" });
  res.json({ request: found });
});

app.post("/api/requests", async (req, res) => {
  const body = req.body || {};
  const errors = validateBody(body);
  if (errors.length) return res.status(400).json({ error: errors.join(". ") });

  const list = readRequests();
  const now = new Date().toISOString();
  const record = {
    id: nextId(list),
    status: "new",
    createdAt: now,
    updatedAt: now,
    // Full form — everything Agrim sees on the dashboard
    requesterName: String(body.requesterName).trim(),
    requesterEmail: String(body.requesterEmail).trim(),
    team: String(body.team).trim(),
    projectName: String(body.projectName).trim(),
    workType: String(body.workType || "other").trim(),
    brief: String(body.brief).trim(),
    priority: ["p0", "p1", "p2"].includes(body.priority) ? body.priority : "p2",
    neededBy: String(body.neededBy).trim(),
    whereUsed: String(body.whereUsed).trim(),
    formatSpecs: String(body.formatSpecs || "").trim(),
    referenceLinks: String(body.referenceLinks || "").trim(),
    // Assignment fields (filled later by manager)
    assignee: null,
    expectedDate: null,
    slackNotifiedAt: null,
    slackError: null,
  };

  let slack;
  try {
    slack = await notifySlack(record);
    if (slack.sent) record.slackNotifiedAt = now;
    else record.slackError = slack.reason;
  } catch (err) {
    record.slackError = err.message || String(err);
    slack = { sent: false, reason: record.slackError };
  }

  list.push(record);
  writeRequests(list);

  res.status(201).json({
    ok: true,
    request: record,
    slack,
  });
});

// SPA-ish: manager deep links
app.get(["/", "/manager", "/request"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Design Desk running on http://localhost:${PORT}`);
  console.log(
    SLACK_WEBHOOK_URL
      ? "Slack webhook: configured"
      : "Slack webhook: NOT set — submissions still save; add SLACK_WEBHOOK_URL to .env"
  );
});
