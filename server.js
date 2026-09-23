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
const SLACK_BOT_TOKEN = (process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT || "").trim();
const SLACK_SIGNING_SECRET = (process.env.SLACK_SIGNING_SECRET || "").trim();
const APP_URL = (
  process.env.APP_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "https://web-production-e4f0f.up.railway.app")
).replace(/\/$/, "");
const FORM_URL = APP_URL;
const MC_BOARD_URL = (
  process.env.MC_DESIGN_BOARD_URL ||
  "https://marketing-central-dashboard-production.up.railway.app/design"
).replace(/\/$/, "");

/** Designer / manager Slack user IDs for personal DMs (one shared bot). */
const DESIGNER_SLACK = {
  farooq: "U055Q3E4FAR",
  anuj: "U0368ST42LR",
  afnan: "U044AD1SNRW",
  sourav: "U0986L62JB0",
  karan: "U051NLQMU4Q",
  dhruv: "U04MZ04UXM2",
  mrigendra: "U0A616H54CC",
  mrigender: "U0A616H54CC",
  agrim: (process.env.SLACK_MANAGER_ID || "").trim() || "",
};

let _managerSlackIdCached = "";
let _managerSlackIdAt = 0;
async function managerSlackId() {
  // Same as requesters: resolve Slack user from work email. Memoize ~10 min.
  const now = Date.now();
  if (_managerSlackIdCached && now - _managerSlackIdAt < 10 * 60 * 1000) {
    return _managerSlackIdCached;
  }
  const byEmail = await lookupSlackIdByEmail("agrim@spyne.ai");
  _managerSlackIdCached = byEmail || DESIGNER_SLACK.agrim || "";
  _managerSlackIdAt = now;
  return _managerSlackIdCached;
}
// Marketing Central Postgres ingest (same DB as Programs / rest of MC)
const MC_INGEST_URL = (
  process.env.MC_DESIGN_INGEST_URL ||
  "https://marketing-central-dashboard-production.up.railway.app/api/design/ingest"
).replace(/\/$/, "");
const MC_INGEST_SECRET = (process.env.MC_DESIGN_INGEST_SECRET || "").trim();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
// Long-cache hashed-ish assets; form HTML itself is small. Redeploy busts via new files.
app.use(
  express.static(path.join(__dirname, "public"), {
    // Railway always has a public domain; local stays uncached for iteration.
    maxAge: process.env.RAILWAY_PUBLIC_DOMAIN ? "7d" : 0,
    etag: true,
  })
);

async function slackApi(method, body) {
  if (!SLACK_BOT_TOKEN) return { ok: false, error: "no_bot_token" };
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body || {}),
  });
  return res.json().catch(() => ({ ok: false, error: "bad_json" }));
}

async function dmSlackUser(slackUserId, text, blocks) {
  const uid = String(slackUserId || "").trim();
  if (!uid || !SLACK_BOT_TOKEN) return { sent: false, reason: "no_dm_target" };
  const open = await slackApi("conversations.open", { users: uid });
  if (!open.ok || !open.channel || !open.channel.id) {
    return { sent: false, reason: open.error || "open_failed" };
  }
  const payload = { channel: open.channel.id, text: text || "" };
  if (blocks) payload.blocks = blocks;
  const posted = await slackApi("chat.postMessage", payload);
  return posted.ok
    ? { sent: true }
    : { sent: false, reason: posted.error || "post_failed" };
}

async function lookupSlackIdByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !SLACK_BOT_TOKEN) return "";
  const res = await fetch(
    `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(e)}`,
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
  );
  const data = await res.json().catch(() => ({}));
  return data.ok && data.user && data.user.id ? String(data.user.id) : "";
}

function designerSlackIds(req) {
  const ids = new Set();
  for (const a of req.assignees || []) {
    const u = String(a.username || a.id || "")
      .trim()
      .toLowerCase();
    if (DESIGNER_SLACK[u]) ids.add(DESIGNER_SLACK[u]);
    if (a.slackId) ids.add(String(a.slackId).trim());
  }
  for (const u of req.assigneeUsernames || []) {
    const key = String(u || "")
      .trim()
      .toLowerCase();
    if (DESIGNER_SLACK[key]) ids.add(DESIGNER_SLACK[key]);
  }
  return [...ids].filter(Boolean);
}

async function resolveRequesterSlackId(req) {
  if (req.requesterSlackId) return String(req.requesterSlackId).trim();
  if (req.requester_slack_id) return String(req.requester_slack_id).trim();
  return lookupSlackIdByEmail(req.requesterEmail || req.requester_email || "");
}

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
  const urgent = req.urgent || String(req.priority || "").toLowerCase() === "p0";
  const text =
    `*New design request* · \`${req.id}\`${urgent ? " · *URGENT*" : ""}\n` +
    `• *Who:* ${req.requesterName}\n` +
    `• *Team:* ${req.team}\n` +
    `• *Project:* ${req.projectName}\n` +
    `• *Needed by:* ${fmtDate(req.neededBy)}\n` +
    `• *Where used:* ${req.whereUsed || "—"}\n` +
    `• *Submit a request:* ${FORM_URL}`;

  return {
    text: `${urgent ? "URGENT " : ""}New design request: ${req.projectName} (${req.id})`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${urgent ? "URGENT · " : ""}New design request — ${req.id}`.slice(0, 150),
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Who is asking*\n${req.requesterName}` },
          { type: "mrkdwn", text: `*Team*\n${req.team}` },
          { type: "mrkdwn", text: `*Project*\n${req.projectName}` },
          { type: "mrkdwn", text: `*Needed by*\n${fmtDate(req.neededBy)}` },
          { type: "mrkdwn", text: `*Priority*\n${urgent ? "*Urgent*" : "Normal"}` },
          { type: "mrkdwn", text: `*Work type*\n${req.workType || "—"}` },
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
      `Status: Assigned\n` +
      `<${MC_BOARD_URL}|Open Design board>`;
  } else if (kind === "started" || kind === "in_progress") {
    header = `${id} — In Progress`;
    body = `*${title}*\nDesigner started work.\nStatus: In Progress`;
  } else if (kind === "ready") {
    header = `${id} — Sent for Review`;
    const link = current.submissionLink || req.latestLink || "";
    body =
      `*${title}*\n` +
      `Your design is ready for review.\n` +
      (link ? `Design: ${link}\n` : "") +
      `Reply with Approve or Need Changes on the board / My requests.\n` +
      `<${FORM_URL}/?view=mine|Open My requests>`;
  } else if (kind === "changes") {
    header = `${id} — Changes Requested`;
    body =
      `*${title}*\n` +
      `Feedback: ${current.feedbackText || "—"}\n` +
      `Status: Changes Requested\n` +
      `<${MC_BOARD_URL}|Open Design board>`;
  } else if (kind === "approved") {
    header = `${id} — Approved`;
    body = `*${title}*\nRequester approved this version. Final delivery is next.`;
  } else if (kind === "updated") {
    header = `${id} — Request updated`;
    body = `*${title}*\nRequester updated the brief / dates.\n<${MC_BOARD_URL}|Open Design board>`;
  } else if (kind === "complete" || kind === "done") {
    header = `${id} — Completed`;
    body = `*${title}*\nFinal design delivered.`;
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

async function notifyLifecycle(kind, request) {
  const payload = buildLifecyclePayload(kind, request || {});
  let channelSent = false;
  let channelReason = "";
  if (SLACK_WEBHOOK_URL) {
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    channelSent = slackRes.ok;
    if (!slackRes.ok) {
      channelReason = (await slackRes.text().catch(() => "")).slice(0, 200);
    }
  } else {
    channelReason = "SLACK_WEBHOOK_URL not set";
  }

  const dms = [];
  const requesterId = await resolveRequesterSlackId(request || {});
  const designerIds = designerSlackIds(request || {});
  const managerId = await managerSlackId();

  // Who gets a personal DM for each lifecycle event
  const dmTargets = new Set();
  // Manager (Agrim) gets every key update so the board stays in sync for him.
  if (managerId && ["assigned", "ready", "changes", "approved", "started", "in_progress", "updated", "complete", "done", "new", "submitted"].includes(kind)) {
    dmTargets.add(managerId);
  }
  if (kind === "assigned") {
    if (requesterId) dmTargets.add(requesterId);
    designerIds.forEach((id) => dmTargets.add(id));
  } else if (kind === "ready") {
    if (requesterId) dmTargets.add(requesterId);
  } else if (kind === "changes") {
    designerIds.forEach((id) => dmTargets.add(id));
  } else if (kind === "approved" || kind === "started" || kind === "in_progress") {
    if (requesterId) dmTargets.add(requesterId);
  } else if (kind === "updated") {
    designerIds.forEach((id) => dmTargets.add(id));
  } else if (kind === "complete" || kind === "done") {
    if (requesterId) dmTargets.add(requesterId);
    designerIds.forEach((id) => dmTargets.add(id));
  } else if (kind === "new" || kind === "submitted") {
    if (requesterId) dmTargets.add(requesterId);
  }

  for (const uid of dmTargets) {
    dms.push(await dmSlackUser(uid, payload.text, payload.blocks));
  }

  return {
    sent: channelSent || dms.some((d) => d.sent),
    channelSent,
    channelReason,
    dms,
  };
}

app.post("/api/slack/lifecycle", async (req, res) => {
  try {
    const kind = String((req.body || {}).kind || "");
    const request = (req.body || {}).request || {};
    const result = await notifyLifecycle(kind, request);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(502).json({ ok: false, sent: false, reason: err.message || String(err) });
  }
});

function option(text, value) {
  return {
    text: { type: "plain_text", text: String(text).slice(0, 75) },
    value: String(value),
  };
}

/** Marketing requesters for Slack /design modal (name + email dropdowns). */
const MARKETING_REQUESTERS = [
  { name: "Komal", email: "komal.gusain@spyne.ai" },
  { name: "Aastha", email: "astha.bhardwaj@spyne.ai" },
  { name: "Aman", email: "aman.bhardwaj@spyne.ai" },
  { name: "Apoorv", email: "apoorv.bhatnagar1@spyne.ai" },
  { name: "Amandeep", email: "amandeep.singh@spyne.ai" },
  { name: "Riya", email: "riya.narang@spyne.ai" },
  { name: "Anurag", email: "anurag.kumar@spyne.ai" },
  { name: "Vrinda", email: "vrinda.sharma@spyne.ai" },
  { name: "Agrim", email: "agrim@spyne.ai" },
];

function buildDesignRequestModal(profile = {}) {
  const profileEmail = String(profile.email || "").trim().toLowerCase();
  const matched = MARKETING_REQUESTERS.find((p) => p.email === profileEmail);

  const nameSelect = {
    type: "static_select",
    action_id: "value",
    placeholder: { type: "plain_text", text: "Pick your name" },
    options: MARKETING_REQUESTERS.map((p) => option(p.name, p.name)),
  };
  const emailSelect = {
    type: "static_select",
    action_id: "value",
    placeholder: { type: "plain_text", text: "Pick your email" },
    options: MARKETING_REQUESTERS.map((p) => option(p.email, p.email)),
  };
  if (matched) {
    nameSelect.initial_option = option(matched.name, matched.name);
    emailSelect.initial_option = option(matched.email, matched.email);
  }

  return {
    type: "modal",
    callback_id: "design_request_modal",
    title: { type: "plain_text", text: "Design request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "requester_name",
        label: { type: "plain_text", text: "Your name" },
        element: nameSelect,
      },
      {
        type: "input",
        block_id: "requester_email",
        label: { type: "plain_text", text: "Your email" },
        element: emailSelect,
      },
      {
        type: "input",
        block_id: "project_name",
        label: { type: "plain_text", text: "Project name" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "e.g. LinkedIn carousel — launch" },
        },
      },
      {
        type: "input",
        block_id: "team",
        label: { type: "plain_text", text: "Team" },
        element: {
          type: "static_select",
          action_id: "value",
          options: [
            option("Marketing", "Marketing"),
            option("PMM", "PMM"),
            option("Growth / Demand Gen", "Growth / Demand Gen"),
            option("Product", "Product"),
            option("Sales", "Sales"),
            option("Customer Success", "Customer Success"),
            option("Founder's office", "Founder's office"),
            option("People / Brand", "People / Brand"),
            option("Other", "Other"),
          ],
        },
      },
      {
        type: "input",
        block_id: "work_type",
        label: { type: "plain_text", text: "Work type" },
        element: {
          type: "static_select",
          action_id: "value",
          options: [
            option("Social / carousel", "social"),
            option("Video / short-form", "video"),
            option("Web / landing", "web"),
            option("PMM / sales collateral", "pmm"),
            option("Events", "events"),
            option("3D / backgrounds", "3d"),
            option("Other", "other"),
          ],
        },
      },
      {
        type: "input",
        block_id: "where_used",
        label: { type: "plain_text", text: "Where it will be used" },
        element: {
          type: "static_select",
          action_id: "value",
          options: [
            option("LinkedIn / social", "LinkedIn / social"),
            option("Website / landing page", "Website / landing page"),
            option("Email", "Email"),
            option("Paid ads", "Paid ads"),
            option("Sales / CS collateral", "Sales / CS collateral"),
            option("Event / booth", "Event / booth"),
            option("In-product", "In-product"),
            option("Internal", "Internal"),
            option("Other", "Other"),
          ],
        },
      },
      {
        type: "input",
        block_id: "brief",
        label: { type: "plain_text", text: "Brief / requirements" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: { type: "plain_text", text: "What do you need?" },
        },
      },
      {
        type: "input",
        block_id: "needed_by",
        label: { type: "plain_text", text: "Needed by" },
        element: { type: "datepicker", action_id: "value" },
      },
      {
        type: "input",
        block_id: "reference_links",
        optional: true,
        label: { type: "plain_text", text: "Reference links" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Figma / Drive / Notion (optional)" },
        },
      },
      {
        type: "input",
        block_id: "urgent",
        optional: true,
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "checkboxes",
          action_id: "value",
          options: [option("Urgent", "urgent")],
        },
      },
    ],
  };
}

function modalVal(values, blockId) {
  const block = values && values[blockId];
  if (!block || !block.value) return "";
  const el = block.value;
  if (el.selected_option) return String(el.selected_option.value || "");
  if (el.selected_date) return String(el.selected_date || "");
  if (Array.isArray(el.selected_options)) {
    return el.selected_options.map((o) => o.value).join(",");
  }
  return String(el.value || "").trim();
}

async function slackUserProfile(userId) {
  const data = await slackApi("users.info", { user: userId });
  if (!data.ok || !data.user) return { name: "", email: "", slackId: userId || "" };
  const p = data.user.profile || {};
  return {
    name: String(p.real_name || data.user.real_name || data.user.name || "").trim(),
    email: String(p.email || "").trim().toLowerCase(),
    slackId: String(userId || "").trim(),
  };
}

async function createDesignRequest(body) {
  const errors = validateBody(body);
  if (errors.length) {
    const err = new Error(errors.join(". "));
    err.status = 400;
    throw err;
  }
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
    priority: body.urgent || String(body.priority || "").toLowerCase() === "p0" ? "p0" : "p2",
    urgent: Boolean(body.urgent) || String(body.priority || "").toLowerCase() === "p0",
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
        urgent: record.urgent,
        priority: record.priority,
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
    const reqSlack = record.requesterSlackId || (await resolveRequesterSlackId(record));
    if (reqSlack) {
      await dmSlackUser(
        reqSlack,
        `We received your design request ${record.id}: ${record.projectName}`,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*Request received* · \`${record.id}\`\n` +
                `*${record.projectName}*\n` +
                `Track it in Marketing Central → Design, or <${FORM_URL}/?view=mine|My requests>.`,
            },
          },
        ]
      );
    }
    const mgrId = await managerSlackId();
    if (mgrId) {
      await dmSlackUser(
        mgrId,
        `New design request ${record.id}: ${record.projectName}`,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*New request* · \`${record.id}\`\n` +
                `*${record.projectName}*\n` +
                `From: ${record.requesterName} (${record.requesterEmail || "—"})\n` +
                `Team: ${record.team || "—"}\n` +
                `<${MC_BOARD_URL}|Open Design board> to assign.`,
            },
          },
        ]
      );
    }
  } catch (err) {
    record.slackError = (record.slackError ? record.slackError + " · " : "") + (err.message || String(err));
    slack = { sent: false, reason: record.slackError };
  }
  return { record, slack, storage };
}

/** Slash command: /design → open in-Slack modal form. */
app.post("/api/slack/commands", async (req, res) => {
  try {
    const command = String((req.body || {}).command || "").trim();
    const text = String((req.body || {}).text || "").trim();
    const triggerId = String((req.body || {}).trigger_id || "").trim();

    if (text && text.toLowerCase() === "mine") {
      return res.status(200).json({
        response_type: "ephemeral",
        text: `My requests: ${FORM_URL}/?view=mine`,
        blocks: [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open My requests", emoji: true },
                url: `${FORM_URL}/?view=mine`,
                style: "primary",
              },
            ],
          },
        ],
      });
    }

    const isDesignCmd =
      !command ||
      command === "/design" ||
      command === "/designrequest" ||
      command === "/internal_design_request" ||
      /design/i.test(command);

    if (isDesignCmd) {
      if (!SLACK_BOT_TOKEN) {
        return res.status(200).json({
          response_type: "ephemeral",
          text: `Bot token missing. Open the form: ${FORM_URL}/?view=request`,
        });
      }
      if (!triggerId) {
        return res.status(200).json({
          response_type: "ephemeral",
          text: `Could not open the form. Try again, or use ${FORM_URL}/?view=request`,
        });
      }
      // Ack Slack immediately, then open modal (must use trigger_id within ~3s).
      res.status(200).send();
      const userId = String((req.body || {}).user_id || "").trim();
      const profile = userId ? await slackUserProfile(userId) : {};
      const opened = await slackApi("views.open", {
        trigger_id: triggerId,
        view: buildDesignRequestModal(profile),
      });
      if (!opened.ok) {
        console.error("views.open failed", opened.error || opened);
      }
      return;
    }
    return res.status(200).json({
      response_type: "ephemeral",
      text: `Unknown command. Try /design`,
    });
  } catch (err) {
    if (!res.headersSent) {
      return res.status(200).json({
        response_type: "ephemeral",
        text: err.message || "Could not handle that command",
      });
    }
  }
});

/** Slack interactivity: modal submit (and future buttons). */
app.post("/api/slack/interactions", async (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    if (payload && payload.payload && typeof payload.payload === "string") {
      payload = JSON.parse(payload.payload);
    }

    if (payload.type === "view_submission" && payload.view && payload.view.callback_id === "design_request_modal") {
      const values = (payload.view.state && payload.view.state.values) || {};
      const userId = payload.user && payload.user.id;
      const profile = await slackUserProfile(userId);
      const nameFromForm = modalVal(values, "requester_name");
      const emailFromForm = modalVal(values, "requester_email").toLowerCase();
      const body = {
        requesterName: nameFromForm || profile.name || "Slack user",
        requesterEmail: emailFromForm || profile.email,
        requesterSlackId: profile.slackId || userId || "",
        projectName: modalVal(values, "project_name"),
        team: modalVal(values, "team"),
        workType: modalVal(values, "work_type") || "other",
        whereUsed: modalVal(values, "where_used"),
        brief: modalVal(values, "brief"),
        neededBy: modalVal(values, "needed_by"),
        referenceLinks: modalVal(values, "reference_links"),
        urgent: String(modalVal(values, "urgent") || "").includes("urgent"),
      };
      if (!String(body.requesterName || "").trim()) {
        return res.status(200).json({
          response_action: "errors",
          errors: { requester_name: "Pick your name from the list." },
        });
      }
      if (!body.requesterEmail || !body.requesterEmail.includes("@")) {
        return res.status(200).json({
          response_action: "errors",
          errors: { requester_email: "Pick your email from the list." },
        });
      }
      const errors = validateBody(body);
      if (errors.length) {
        return res.status(200).json({
          response_action: "errors",
          errors: { project_name: errors[0] },
        });
      }
      // Close modal immediately; create request in background.
      res.status(200).json({ response_action: "clear" });
      createDesignRequest(body)
        .then(({ record }) => {
          console.log("Slack modal created", record.id);
        })
        .catch((err) => console.error("Slack modal create failed", err.message || err));
      return;
    }

    return res.status(200).send();
  } catch (err) {
    console.error("slack interactions", err);
    if (!res.headersSent) return res.status(200).send();
  }
});

app.post("/api/mine", async (req, res) => {
  const email = String((req.body || {}).email || "").trim();
  const month = String((req.body || {}).month || "").trim();
  const mineUrl = MC_INGEST_URL.replace(/\/ingest\/?$/, "/mine");
  try {
    const mcRes = await fetch(mineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, month }),
    });
    const data = await mcRes.json().catch(() => ({}));
    return res.status(mcRes.status).json(data.detail ? { error: data.detail } : data);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Could not load your requests" });
  }
});

app.post("/api/respond", async (req, res) => {
  const body = req.body || {};
  const respondUrl = MC_INGEST_URL.replace(/\/ingest\/?$/, "/respond");
  try {
    const mcRes = await fetch(respondUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(body.email || "").trim(),
        requestId: String(body.requestId || "").trim(),
        action: String(body.action || "response").trim(),
        text: String(body.text || "").trim(),
      }),
    });
    const data = await mcRes.json().catch(() => ({}));
    return res.status(mcRes.status).json(data.detail ? { error: data.detail } : data);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Could not send that response" });
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
  if (!email) errors.push("Email is required");
  return errors;
}

app.get("/api/directory", async (_req, res) => {
  // Same marketing roster as Slack /design modal (name + email dropdowns).
  return res.json({ people: MARKETING_REQUESTERS });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    slackConfigured: Boolean(SLACK_WEBHOOK_URL),
    slackBotConfigured: Boolean(SLACK_BOT_TOKEN),
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
  try {
    const { record, slack, storage } = await createDesignRequest(body);
    res.status(201).json({
      ok: true,
      request: record,
      slack,
      storage,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status === 400) return res.status(400).json({ error: err.message });
    return res.status(500).json({ error: err.message || String(err) });
  }
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
      ? "Slack webhook: configured (group channel)"
      : "Slack webhook: NOT set — submissions still save; add SLACK_WEBHOOK_URL to .env"
  );
  console.log(
    SLACK_BOT_TOKEN
      ? "Slack bot token: set (personal DMs + /design)"
      : "Slack bot token: NOT set — add SLACK_BOT_TOKEN for DMs and /design"
  );
});
