/**
 * Spyne Design Desk — API
 * POST   /api/requests      → save full payload + Slack (short summary)
 * GET    /api/requests      → list (Marketing Central Design board pulls this)
 * GET    /api/requests/:id
 * PATCH  /api/requests/:id  → assign / update status (called by Marketing Central)
 * GET    /api/health
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
const APP_URL = (
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "https://web-production-e4f0f.up.railway.app")
).replace(/\/$/, "");
const FORM_URL = APP_URL;
// Marketing Central Postgres ingest (same DB as Programs / rest of MC)
const MC_INGEST_URL = (
  process.env.MC_DESIGN_INGEST_URL ||
  "https://marketing-central-dashboard-production.up.railway.app/api/design/ingest"
).replace(/\/$/, "");
const MC_INGEST_SECRET = (process.env.MC_DESIGN_INGEST_SECRET || "").trim();

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

/** Short Slack message — key fields + form link */
function buildSlackPayload(req) {
  const text =
    `*New design request* · \`${req.id}\`\n` +
    `• *Who:* ${req.requesterName}\n` +
    `• *Team:* ${req.team}\n` +
    `• *Project:* ${req.projectName}\n` +
    `• *Needed by:* ${fmtDate(req.neededBy)}\n` +
    `• *Where used:* ${req.whereUsed || "—"}\n` +
    `• *Submit a request:* ${FORM_URL}`;

  return {
    text: `New design request: ${req.projectName} (${req.id})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `New design request — ${req.id}`.slice(0, 150), emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Who is asking*\n${req.requesterName}` },
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
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📝 <${FORM_URL}|Open design request form>`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `\`${req.id}\` · form: ${FORM_URL}` }],
      },
    ],
  };
}

function buildFormPinPayload() {
  return {
    text: `Design request form: ${FORM_URL}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Design request form", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `Need creative work? Submit here — the design team gets notified automatically.\n\n` +
            `👉 <${FORM_URL}|${FORM_URL}>`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Please *pin this message* so the form link stays at the top of the channel.",
          },
        ],
      },
    ],
  };
}

function buildDoneSlackPayload(req) {
  const link = req.completionLink || "";
  const text =
    `*Design task done* · \`${req.id}\`\n` +
    `• *Title:* ${req.projectName}\n` +
    `• *Who asked:* ${req.requesterName}\n` +
    `• *Team:* ${req.team}\n` +
    `• *Link:* ${link}`;

  return {
    text: `Done: ${req.projectName} (${req.id})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Completed — ${req.id}`.slice(0, 150), emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Title*\n${req.projectName}` },
          { type: "mrkdwn", text: `*Who asked*\n${req.requesterName}` },
          { type: "mrkdwn", text: `*Team*\n${req.team}` },
          {
            type: "mrkdwn",
            text: `*Completed by*\n${req.completedBy || "designer"}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Delivery link*\n${link ? `<${link}|${link}>` : "—"}`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `\`${req.id}\`` }],
      },
    ],
  };
}

function isValidDeliveryLink(url) {
  const s = String(url || "").trim();
  return /^https?:\/\/\S+/i.test(s);
}

async function notifySlackDone(request) {
  if (!SLACK_WEBHOOK_URL) {
    return { sent: false, reason: "SLACK_WEBHOOK_URL not set" };
  }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildDoneSlackPayload(request)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack ${res.status}: ${body.slice(0, 200)}`);
  }
  return { sent: true };
}

function buildLifecyclePayload(kind, req) {
  const id = req.id || "DSN";
  const title = req.projectName || "Design request";
  const people = (req.assignees || [])
    .map((a) => a.name || a.username)
    .filter(Boolean)
    .join(", ");
  const expected = fmtDate(req.expectedDate);
  const current = req.currentIteration || {};
  let header = `${id}`;
  let body = `*${title}*`;
  if (kind === "assigned") {
    header = `${id} — Assigned`;
    body =
      `*${title}*\n` +
      `Assigned to: ${people || "—"}\n` +
      `Expected delivery: ${expected}\n` +
      `Status: Assigned`;
  } else if (kind === "ready") {
    header = `${id} — Ready for feedback`;
    const link = current.submissionLink || "";
    body =
      `*${title}*\n` +
      `Your design is ready for feedback.\n` +
      (link ? `Draft: ${link}\n` : "") +
      `Status: Awaiting Feedback`;
  } else if (kind === "changes") {
    header = `${id} — Changes requested`;
    body =
      `*${title}*\n` +
      `Feedback: ${current.feedbackText || "—"}\n` +
      `Status: Changes Requested`;
  }
  return {
    text: `${header} · ${title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: String(header).slice(0, 150), emoji: true },
      },
      { type: "section", text: { type: "mrkdwn", text: body } },
    ],
  };
}

app.post("/api/slack/lifecycle", async (req, res) => {
  try {
    if (!SLACK_WEBHOOK_URL) {
      return res.json({ ok: true, sent: false, reason: "SLACK_WEBHOOK_URL not set" });
    }
    const kind = String((req.body || {}).kind || "");
    const request = (req.body || {}).request || {};
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLifecyclePayload(kind, request)),
    });
    if (!slackRes.ok) {
      const text = await slackRes.text().catch(() => "");
      return res.status(502).json({ ok: false, sent: false, reason: text.slice(0, 200) });
    }
    return res.json({ ok: true, sent: true });
  } catch (err) {
    return res.status(502).json({ ok: false, sent: false, reason: err.message || String(err) });
  }
});

app.post("/api/track", async (req, res) => {
  const body = req.body || {};
  const contact = String(body.contact || "").trim();
  const email = contact.includes("@") ? contact : String(body.email || "").trim();
  const slackUserId = contact.includes("@")
    ? String(body.slackUserId || "").trim()
    : contact || String(body.slackUserId || "").trim();
  const trackUrl = MC_INGEST_URL.replace(/\/ingest\/?$/, "/track");
  try {
    const mcRes = await fetch(trackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: String(body.requestId || body.id || "").trim(),
        email,
        slackUserId,
      }),
    });
    const data = await mcRes.json().catch(() => ({}));
    return res.status(mcRes.status).json(data.detail ? { error: data.detail } : data);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Could not check that request" });
  }
});

async function notifySlack(request) {
  if (!SLACK_WEBHOOK_URL) {
    return { sent: false, reason: "SLACK_WEBHOOK_URL not set" };
  }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackPayload(request)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack ${res.status}: ${body.slice(0, 200)}`);
  }
  return { sent: true };
}

async function postFormLinkToSlack() {
  if (!SLACK_WEBHOOK_URL) {
    return { sent: false, reason: "SLACK_WEBHOOK_URL not set" };
  }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFormPinPayload()),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack ${res.status}: ${body.slice(0, 200)}`);
  }
  return { sent: true, formUrl: FORM_URL };
}

function validateBody(body) {
  const errors = [];
  const required = [
    ["requesterName", "Who is asking"],
    ["team", "Team"],
    ["projectName", "Project"],
    ["workType", "Work type"],
    ["brief", "Brief / requirements"],
    ["neededBy", "Needed by"],
    ["whereUsed", "Where it will be used"],
  ];
  for (const [key, label] of required) {
    if (!body[key] || !String(body[key]).trim()) errors.push(`${label} is required`);
  }
  const email = String(body.requesterEmail || "").trim();
  const slackId = String(body.requesterSlackId || body.slackUserId || "").trim();
  if (!email && !slackId) errors.push("Email or Slack User ID is required");
  return errors;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    slackConfigured: Boolean(SLACK_WEBHOOK_URL),
    formUrl: FORM_URL,
    time: new Date().toISOString(),
  });
});

/** Post the form link into the Slack channel (for pinning). */
app.post("/api/slack/post-form-link", async (_req, res) => {
  try {
    const result = await postFormLinkToSlack();
    if (!result.sent) return res.status(503).json(result);
    res.json({
      ok: true,
      ...result,
      tip: "In Slack: hover the message → ⋮ More actions → Pin to channel",
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || String(err) });
  }
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

app.patch("/api/requests/:id", async (req, res) => {
  const list = readRequests();
  const idx = list.findIndex((r) => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Request not found" });

  const body = req.body || {};
  const row = { ...list[idx] };
  const now = new Date().toISOString();

  const ROSTER_NAMES = {
    afnan: "Afnan Khan",
    karan: "Karan Singh",
    sourav: "Sourav Jagga",
    dhruv: "Dhruv",
    anuj: "Anuj Sanadhya",
    farooq: "Farooq Saifi",
    mrigendra: "Mrigendra",
    mrigender: "Mrigendra",
  };

  function normUser(u) {
    const v = String(u || "").trim().toLowerCase();
    return v === "mrigender" ? "mrigendra" : v;
  }

  if (Array.isArray(body.assigneeUsernames)) {
    const usernames = body.assigneeUsernames.map(normUser).filter(Boolean);
    row.assignees = usernames.map((u) => ({
      id: u,
      username: u,
      name: ROSTER_NAMES[u] || u,
      part: "Contribution",
      status: "assigned",
    }));
    row.assignee = usernames.length === 1 ? usernames[0] : null;
    row.assigneeUsername = row.assignee;
    row.status = usernames.length ? "assigned" : "unassigned";
  } else if (body.assigneeUsername !== undefined) {
    const u = normUser(body.assigneeUsername);
    if (!u) {
      row.assignees = [];
      row.assignee = null;
      row.assigneeUsername = "";
      row.status = "unassigned";
    } else {
      row.assignees = [
        {
          id: u,
          username: u,
          name: ROSTER_NAMES[u] || u,
          part: "Full task",
          status: "assigned",
        },
      ];
      row.assignee = u;
      row.assigneeUsername = u;
      row.status = "assigned";
    }
  }

  if (body.expectedDate !== undefined) row.expectedDate = body.expectedDate || "";

  function partDone(a) {
    const s = String((a && a.status) || "").toLowerCase();
    return s === "complete" || s === "delivered" || s === "done";
  }

  function ensureAssignees() {
    if (!Array.isArray(row.assignees)) row.assignees = [];
    return row.assignees;
  }

  function allPartsComplete() {
    const parts = ensureAssignees();
    return parts.length > 0 && parts.every(partDone);
  }

  // Designer marks their own portion complete (no Slack yet)
  if (body.completeOwnPart) {
    const who = normUser(body.completedBy || body.updatedBy || "");
    if (!who) {
      return res.status(400).json({ error: "completedBy is required" });
    }
    const parts = ensureAssignees();
    const mine = parts.find((a) => normUser(a.username || a.id) === who);
    if (!mine) {
      return res.status(403).json({ error: "You are not assigned to this task" });
    }
    mine.status = "complete";
    mine.completedAt = now;
    row.lastPartCompletedBy = who;
    row.updatedAt = now;
    row.updatedBy = who;

    if (allPartsComplete()) {
      // Ready for final share — not fully "complete" until Slack/link sent
      row.status = "ready_to_share";
    } else if (row.status === "new" || row.status === "unassigned") {
      row.status = "in_progress";
    } else if (row.status !== "ready_to_share" && row.status !== "complete") {
      row.status = "in_progress";
    }

    list[idx] = row;
    writeRequests(list);
    return res.json({
      ok: true,
      request: row,
      allPartsComplete: allPartsComplete(),
      canSendFinal: allPartsComplete() && !row.completionSlackAt,
    });
  }

  // Final share: only when every collaborator completed their part
  if (body.sendToSlack || body.sendFinal) {
    if (!allPartsComplete()) {
      return res.status(400).json({
        error: "All collaborators must complete their part before sharing",
      });
    }
    const link = String(body.completionLink || body.deliveryLink || "").trim();
    if (!link || !isValidDeliveryLink(link)) {
      return res.status(400).json({
        error: "Attach a Drive or Figma link (https://…) to send to Slack",
      });
    }
    row.completionLink = link;
    row.completedAt = now;
    row.completedBy = String(body.updatedBy || body.completedBy || row.lastPartCompletedBy || "").trim();
    row.status = "complete";
    try {
      const slack = await notifySlackDone(row);
      if (slack.sent) row.completionSlackAt = now;
      else row.completionSlackError = slack.reason;
    } catch (err) {
      row.completionSlackError = err.message || String(err);
    }
    row.updatedAt = now;
    row.updatedBy = body.updatedBy || "";
    list[idx] = row;
    writeRequests(list);
    return res.json({ ok: true, request: row, slackSent: Boolean(row.completionSlackAt) });
  }

  // Legacy: status=complete without per-part — treat as completeOwnPart for solo, or require all parts
  const nextStatus = body.status ? String(body.status) : "";
  if (nextStatus === "complete" || nextStatus === "delivered" || nextStatus === "done") {
    const who = normUser(body.updatedBy || body.completedBy || "");
    const parts = ensureAssignees();
    if (parts.length && who) {
      const mine = parts.find((a) => normUser(a.username || a.id) === who);
      if (mine && !partDone(mine)) {
        mine.status = "complete";
        mine.completedAt = now;
        row.lastPartCompletedBy = who;
      }
    }
    if (parts.length && !allPartsComplete()) {
      row.status = "in_progress";
      row.updatedAt = now;
      list[idx] = row;
      writeRequests(list);
      return res.json({
        ok: true,
        request: row,
        allPartsComplete: false,
        message: "Your part is complete. Waiting for remaining collaborators.",
      });
    }
    // All done — stash link if provided but don't force Slack unless sendToSlack
    if (body.completionLink) {
      row.completionLink = String(body.completionLink).trim();
    }
    row.status = "ready_to_share";
    row.updatedAt = now;
    list[idx] = row;
    writeRequests(list);
    return res.json({
      ok: true,
      request: row,
      allPartsComplete: true,
      canSendFinal: !row.completionSlackAt,
    });
  } else if (body.status) {
    row.status = String(body.status);
  }

  if (body.completionLink !== undefined) {
    row.completionLink = String(body.completionLink || "").trim();
  }

  row.updatedAt = now;
  row.updatedBy = body.updatedBy || "";

  list[idx] = row;
  writeRequests(list);
  res.json({ ok: true, request: row });
});

app.post("/api/slack/task-done", async (req, res) => {
  try {
    const result = await notifySlackDone(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, sent: false, reason: err.message || String(err) });
  }
});

app.post("/api/requests", async (req, res) => {
  const body = req.body || {};
  const errors = validateBody(body);
  if (errors.length) return res.status(400).json({ error: errors.join(". ") });

  const now = new Date().toISOString();
  let record = {
    id: "",
    status: "new",
    createdAt: now,
    updatedAt: now,
    requesterName: String(body.requesterName).trim(),
    team: String(body.team).trim(),
    projectName: String(body.projectName).trim(),
    workType: String(body.workType || "other").trim(),
    brief: String(body.brief).trim(),
    neededBy: String(body.neededBy).trim(),
    whereUsed: String(body.whereUsed).trim(),
    referenceLinks: String(body.referenceLinks || "").trim(),
    requesterEmail: String(body.requesterEmail || "").trim(),
    requesterSlackId: String(body.requesterSlackId || "").trim(),
    priority: "p2",
    formatSpecs: String(body.formatSpecs || "").trim(),
    assignee: null,
    assigneeUsername: "",
    assignees: [],
    expectedDate: null,
    completionLink: "",
    completedAt: null,
    completedBy: "",
    completionSlackAt: null,
    slackNotifiedAt: null,
    slackError: null,
  };

  let storage = "local";
  // Primary: Marketing Central Postgres (same DB as the dashboard)
  try {
    const headers = { "Content-Type": "application/json" };
    if (MC_INGEST_SECRET) headers["X-Design-Ingest-Secret"] = MC_INGEST_SECRET;
    const mcRes = await fetch(MC_INGEST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requesterName: record.requesterName,
        team: record.team,
        projectName: record.projectName,
        workType: record.workType,
        brief: record.brief,
        neededBy: record.neededBy,
        whereUsed: record.whereUsed,
        referenceLinks: record.referenceLinks,
        requesterEmail: record.requesterEmail,
        requesterSlackId: record.requesterSlackId,
        formatSpecs: record.formatSpecs,
      }),
    });
    const mcData = await mcRes.json().catch(() => ({}));
    if (!mcRes.ok) {
      throw new Error(mcData.detail || mcData.error || `MC ingest ${mcRes.status}`);
    }
    if (mcData.request) {
      record = { ...record, ...mcData.request };
      storage = "postgres";
    }
  } catch (err) {
    // Fallback: local JSON so form never hard-fails if MC is briefly down
    const list = readRequests();
    record.id = nextId(list);
    record.slackError = `MC ingest failed (${err.message || err}); saved locally`;
    list.push(record);
    writeRequests(list);
    storage = "local-fallback";
  }

  let slack;
  try {
    slack = await notifySlack(record);
    if (slack.sent) record.slackNotifiedAt = now;
    else record.slackError = (record.slackError ? record.slackError + " · " : "") + (slack.reason || "");
  } catch (err) {
    record.slackError = (record.slackError ? record.slackError + " · " : "") + (err.message || String(err));
    slack = { sent: false, reason: record.slackError };
  }

  res.status(201).json({
    ok: true,
    request: record,
    slack,
    storage,
  });
});

// SPA-ish: manager deep links
app.get(["/", "/manager", "/request"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Design Desk running on http://localhost:${PORT}`);
  console.log(`MC ingest: ${MC_INGEST_URL}`);
  console.log(
    SLACK_WEBHOOK_URL
      ? "Slack webhook: configured"
      : "Slack webhook: NOT set — submissions still save; add SLACK_WEBHOOK_URL to .env"
  );
});
