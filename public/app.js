(function () {
  "use strict";

  var TEAMS = [
    "Marketing",
    "PMM",
    "Growth / Demand Gen",
    "Product",
    "Sales",
    "Customer Success",
    "Founder's office",
    "People / Brand",
    "Other",
  ];

  var WORK_TYPES = [
    { id: "social", label: "Social / carousel" },
    { id: "video", label: "Video / short-form" },
    { id: "web", label: "Web / landing" },
    { id: "pmm", label: "PMM / sales collateral" },
    { id: "events", label: "Events" },
    { id: "3d", label: "3D / backgrounds" },
    { id: "other", label: "Other" },
  ];

  var WHERE_USED = [
    "LinkedIn / social",
    "Website / landing page",
    "Email",
    "Paid ads",
    "Sales / CS collateral",
    "Event / booth",
    "In-product",
    "Internal",
    "Other",
  ];

  var PRIORITY = {
    p0: { label: "Critical", cls: "p0" },
    p1: { label: "High", cls: "p1" },
    p2: { label: "Normal", cls: "p2" },
  };

  var state = {
    view: "request",
    requests: [],
    search: "",
    selectedId: null,
    lastSubmitted: null,
    health: null,
  };

  function $(s, r) {
    return (r || document).querySelector(s);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function todayISO() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso.length > 10 ? iso : iso + "T00:00:00");
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtWhen(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  function workLabel(id) {
    var w = WORK_TYPES.find(function (x) {
      return x.id === id;
    });
    return w ? w.label : id || "—";
  }
  function banner(kind, html) {
    $("#banner").innerHTML = '<div class="banner ' + kind + '">' + html + "</div>";
  }
  function clearBanner() {
    $("#banner").innerHTML = "";
  }

  function params() {
    return new URLSearchParams(location.search);
  }
  function setUrl(view, id) {
    var q = new URLSearchParams();
    q.set("view", view);
    if (id) q.set("id", id);
    history.replaceState(null, "", "?" + q.toString());
  }

  /* ---------- API ---------- */
  async function api(path, opts) {
    var res = await fetch(path, opts);
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  async function loadHealth() {
    try {
      var h = await api("/api/health");
      state.health = h;
      var el = $("#healthChip");
      if (h.slackConfigured) {
        el.className = "health ok";
        el.textContent = "API live · Slack connected";
      } else {
        el.className = "health warn";
        el.textContent = "API live · Slack webhook not set";
      }
    } catch (e) {
      $("#healthChip").className = "health warn";
      $("#healthChip").textContent = "API unreachable — run npm start";
    }
  }

  async function loadRequests() {
    var data = await api("/api/requests");
    state.requests = data.requests || [];
  }

  /* ---------- Request form ---------- */
  function renderRequest() {
    $("#pageTitle").textContent = "Submit a design request";
    $("#pageSub").textContent = "Anyone at Spyne · short Slack ping to the design channel · full details for Agrim";
    $("#topActions").innerHTML = "";

    var html = '<div class="req-layout"><form class="panel" id="reqForm" novalidate>';
    html +=
      '<div class="panel-hd"><h2>Raise a design request</h2>' +
      "<p>Fill everything Agrim needs. Slack only gets name, team, project, needed-by, and where it will be used.</p></div>";
    html += '<div class="panel-bd">';

    html += '<fieldset><legend>Who is asking</legend><div class="row">';
    html +=
      '<label class="f">Your name <span class="req">*</span><input name="requesterName" autocomplete="name" required placeholder="e.g. Nidhi Singh"></label>';
    html +=
      '<label class="f">Work email <span class="req">*</span><input name="requesterEmail" type="email" autocomplete="email" required placeholder="you@spyne.ai"></label>';
    html += "</div>";
    html += '<label class="f">Team <span class="req">*</span><select name="team" required><option value="">Select…</option>';
    TEAMS.forEach(function (t) {
      html += "<option>" + esc(t) + "</option>";
    });
    html += "</select></label></fieldset>";

    html += '<fieldset><legend>Project</legend>';
    html +=
      '<label class="f">Project name <span class="req">*</span> <span class="hint">shown in Slack</span>' +
      '<input name="projectName" required placeholder="e.g. LinkedIn carousel — Studio AI launch"></label>';
    html +=
      '<label class="f">Work type <span class="req">*</span><select name="workType" required><option value="">Select…</option>';
    WORK_TYPES.forEach(function (w) {
      html += '<option value="' + w.id + '">' + esc(w.label) + "</option>";
    });
    html += "</select></label>";
    html +=
      '<label class="f">Brief / requirements <span class="req">*</span> <span class="hint">full detail for Agrim — not posted to Slack</span>' +
      '<textarea name="brief" required placeholder="Audience, message, must-include elements, references, success criteria…"></textarea></label>';
    html += "</fieldset>";

    html += '<fieldset><legend>Timing &amp; placement</legend><div class="row">';
    html +=
      '<label class="f">Needed by <span class="req">*</span><input type="date" name="neededBy" required></label>';
    html += '<label class="f">Priority<div class="seg" role="radiogroup">';
    html +=
      '<input type="radio" name="priority" id="pr2" value="p2" checked><label for="pr2">Normal</label>';
    html +=
      '<input type="radio" name="priority" id="pr1" value="p1"><label for="pr1">High</label>';
    html +=
      '<input type="radio" name="priority" id="pr0" value="p0"><label for="pr0">Critical</label>';
    html += "</div></label></div>";
    html +=
      '<label class="f">Where it will be used <span class="req">*</span> <span class="hint">shown in Slack</span>' +
      '<select name="whereUsed" required><option value="">Select…</option>';
    WHERE_USED.forEach(function (w) {
      html += "<option>" + esc(w) + "</option>";
    });
    html += "</select></label>";
    html +=
      '<label class="f">Format &amp; size <span class="hint">dimensions, duration, file type</span>' +
      '<input name="formatSpecs" placeholder="e.g. 1080×1080, 5 slides, PDF"></label>';
    html +=
      '<label class="f">Reference links <span class="hint">one per line — dashboard only</span>' +
      '<textarea name="referenceLinks" placeholder="https://…"></textarea></label>';
    html += "</fieldset>";

    html +=
      '<div class="form-actions"><button class="btn primary" type="submit" id="submitBtn">Submit request</button>' +
      '<span class="note" id="formNote">Saves to the desk and posts a short summary to Slack.</span></div>';
    html += "</div></form>";

    html += '<aside class="panel"><div class="panel-hd"><h2>What Slack will show</h2>' +
      '<p>Channel gets only these fields — not the full brief.</p></div><div class="panel-bd">';
    html +=
      '<div class="slack-card"><div class="ttl">#design-requests</div>' +
      "<ul>" +
      "<li><b>Name</b> — your name</li>" +
      "<li><b>Team</b> — which team</li>" +
      "<li><b>Project</b> — project name</li>" +
      "<li><b>Needed by</b> — required date</li>" +
      "<li><b>Where used</b> — channel / placement</li>" +
      "</ul></div>";
    html +=
      '<div class="info-box"><b>On the Manager dashboard</b>' +
      "Agrim sees everything you enter: email, brief, work type, priority, format, and reference links.</div>";
    html +=
      '<div class="info-box"><b>To go live</b><ol>' +
      "<li>Create the Slack channel + Incoming Webhook</li>" +
      "<li>Put the webhook URL in <code>.env</code> as <code>SLACK_WEBHOOK_URL</code></li>" +
      "<li>Push this repo to GitHub and deploy (Railway)</li>" +
      "</ol></div>";
    html += "</div></aside></div>";

    var el = $("#view-request");
    el.hidden = false;
    el.innerHTML = html;
    $("#view-manager").hidden = true;
    $("#view-confirm").hidden = true;

    var form = $("#reqForm");
    form.elements.neededBy.value = todayISO();
    form.onsubmit = onSubmit;
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearBanner();
    var form = e.target;
    if (!form.reportValidity()) return;

    var btn = $("#submitBtn");
    var note = $("#formNote");
    btn.disabled = true;
    note.textContent = "Submitting…";

    var payload = {
      requesterName: form.requesterName.value.trim(),
      requesterEmail: form.requesterEmail.value.trim(),
      team: form.team.value,
      projectName: form.projectName.value.trim(),
      workType: form.workType.value,
      brief: form.brief.value.trim(),
      priority: (form.priority && form.priority.value) || "p2",
      neededBy: form.neededBy.value,
      whereUsed: form.whereUsed.value,
      formatSpecs: form.formatSpecs.value.trim(),
      referenceLinks: form.referenceLinks.value.trim(),
    };

    try {
      var result = await api("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.lastSubmitted = result;
      await loadRequests();
      showConfirm(result);
    } catch (err) {
      banner("err", esc(err.message));
      note.textContent = "Fix and try again.";
      btn.disabled = false;
    }
  }

  function showConfirm(result) {
    var req = result.request;
    var slack = result.slack || {};
    state.view = "confirm";
    syncNav();
    setUrl("manager", req.id);

    $("#pageTitle").textContent = "Request submitted";
    $("#pageSub").textContent = slack.sent
      ? "Slack notification sent to the design channel"
      : "Saved on the dashboard — Slack not sent yet";
    $("#topActions").innerHTML = "";

    $("#view-request").hidden = true;
    $("#view-manager").hidden = true;
    var el = $("#view-confirm");
    el.hidden = false;

    var slackMsg = slack.sent
      ? '<div class="banner ok" style="text-align:left">Slack notified with the short summary (name, team, project, date, where used).</div>'
      : '<div class="banner warn" style="text-align:left">Request <b>saved</b> on the Manager dashboard. Slack was not sent yet' +
        (slack.reason || req.slackError
          ? " (" + esc(slack.reason || req.slackError) + ")"
          : "") +
        ". Add your Incoming Webhook URL to <code>.env</code> as <code>SLACK_WEBHOOK_URL</code>, restart the server, and submit a test.</div>";

    el.innerHTML =
      '<div class="panel confirm"><div class="panel-bd">' +
      '<div class="pill ok">Submitted</div>' +
      '<span class="id">' +
      esc(req.id) +
      "</span>" +
      "<h2 style=\"margin:0 0 6px\">" +
      esc(req.projectName) +
      "</h2>" +
      '<p class="note">Full details are on the Manager dashboard. Share this ID if you need to follow up.</p>' +
      slackMsg +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;flex-wrap:wrap">' +
      '<button class="btn primary" type="button" id="goMgr">Open Manager dashboard</button>' +
      '<button class="btn" type="button" id="goNew">Submit another</button>' +
      "</div></div></div>";

    $("#goMgr").onclick = function () {
      state.selectedId = req.id;
      setView("manager");
    };
    $("#goNew").onclick = function () {
      setView("request");
    };
  }

  /* ---------- Manager dashboard ---------- */
  function filteredRequests() {
    var q = state.search.trim().toLowerCase();
    if (!q) return state.requests.slice();
    return state.requests.filter(function (r) {
      var blob = [
        r.id,
        r.projectName,
        r.requesterName,
        r.requesterEmail,
        r.team,
        r.brief,
        r.whereUsed,
        r.workType,
      ]
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) > -1;
    });
  }

  function renderManager() {
    $("#pageTitle").textContent = "Manager dashboard";
    $("#pageSub").textContent = "Agrim · every field from every submission";
    $("#topActions").innerHTML =
      '<button class="btn sm" type="button" id="refreshBtn">Refresh</button>';

    $("#view-request").hidden = true;
    $("#view-confirm").hidden = true;
    var el = $("#view-manager");
    el.hidden = false;

    var list = filteredRequests();
    var total = state.requests.length;
    var fresh = state.requests.filter(function (r) {
      return r.status === "new";
    }).length;
    var slackOk = state.requests.filter(function (r) {
      return r.slackNotifiedAt;
    }).length;
    var slackFail = state.requests.filter(function (r) {
      return r.slackError && !r.slackNotifiedAt;
    }).length;

    var html = '<div class="kpis">';
    html += '<div class="kpi"><div class="n">' + total + '</div><div class="lb">Total requests</div></div>';
    html += '<div class="kpi"><div class="n">' + fresh + '</div><div class="lb">New / unassigned</div></div>';
    html += '<div class="kpi"><div class="n">' + slackOk + '</div><div class="lb">Slack sent</div></div>';
    html += '<div class="kpi"><div class="n">' + slackFail + '</div><div class="lb">Slack failed</div></div>';
    html += "</div>";

    html += '<div class="mgr-toolbar">';
    html +=
      '<input type="search" id="searchIn" placeholder="Search name, team, project, brief…" value="' +
      esc(state.search) +
      '">';
    html += '<span class="note">' + list.length + " shown</span>";
    html += "</div>";

    if (!state.requests.length) {
      html +=
        '<div class="panel"><div class="empty"><h3>No requests yet</h3>' +
        "<p>Submit one from the form — it will appear here with every field, and Slack will get the short summary.</p>" +
        '<button class="btn primary" type="button" id="emptyGoReq">Submit a request</button></div></div>';
      el.innerHTML = html;
      $("#emptyGoReq").onclick = function () {
        setView("request");
      };
      $("#refreshBtn").onclick = refreshManager;
      return;
    }

    html += '<div class="table-wrap"><table class="req"><thead><tr>';
    html +=
      "<th>ID</th><th>Project</th><th>Requester</th><th>Team</th><th>Needed by</th><th>Priority</th><th>Slack</th><th>Submitted</th>";
    html += "</tr></thead><tbody>";

    if (!list.length) {
      html +=
        '<tr><td colspan="8"><div class="empty"><h3>No matches</h3><p>Try a different search.</p></div></td></tr>';
    } else {
      list.forEach(function (r) {
        var p = PRIORITY[r.priority] || PRIORITY.p2;
        var active = state.selectedId === r.id ? " active" : "";
        html += '<tr class="' + active + '" data-id="' + esc(r.id) + '">';
        html += '<td class="mono">' + esc(r.id) + "</td>";
        html +=
          '<td class="title"><span class="t">' +
          esc(r.projectName) +
          '</span><span class="c">' +
          esc(workLabel(r.workType)) +
          " · " +
          esc(r.whereUsed || "—") +
          "</span></td>";
        html +=
          "<td><b>" +
          esc(r.requesterName) +
          '</b><div class="mono" style="margin-top:2px">' +
          esc(r.requesterEmail) +
          "</div></td>";
        html += "<td>" + esc(r.team) + "</td>";
        html += "<td>" + esc(fmtDate(r.neededBy)) + "</td>";
        html += '<td><span class="pill ' + p.cls + '">' + esc(p.label) + "</span></td>";
        html +=
          "<td>" +
          (r.slackNotifiedAt
            ? '<span class="pill ok">Sent</span>'
            : '<span class="pill p1">Missed</span>') +
          "</td>";
        html += "<td>" + esc(fmtWhen(r.createdAt)) + "</td>";
        html += "</tr>";
      });
    }
    html += "</tbody></table></div>";

    el.innerHTML = html;
    $("#refreshBtn").onclick = refreshManager;
    $("#searchIn").oninput = function () {
      state.search = this.value;
      renderManager();
      if (state.selectedId) openDrawer(state.selectedId);
    };
    el.querySelectorAll("tbody tr[data-id]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        openDrawer(tr.getAttribute("data-id"));
      });
    });

    if (state.selectedId) {
      var still = state.requests.some(function (r) {
        return r.id === state.selectedId;
      });
      if (still) openDrawer(state.selectedId);
    }
  }

  async function refreshManager() {
    try {
      await loadRequests();
      renderManager();
      banner("ok", "Dashboard refreshed.");
      setTimeout(clearBanner, 2000);
    } catch (e) {
      banner("err", esc(e.message));
    }
  }

  function openDrawer(id) {
    var r = state.requests.find(function (x) {
      return x.id === id;
    });
    if (!r) return;
    state.selectedId = id;
    setUrl("manager", id);

    var p = PRIORITY[r.priority] || PRIORITY.p2;
    var host = $("#drawerHost");
    var slackHtml = r.slackNotifiedAt
      ? '<div class="slack-flag ok">Slack notified at ' + esc(fmtWhen(r.slackNotifiedAt)) + "</div>"
      : '<div class="slack-flag err">Slack not sent' +
        (r.slackError ? ": " + esc(r.slackError) : "") +
        "</div>";

    host.innerHTML =
      '<div class="scrim" id="scrim"></div><div class="drawer" role="dialog" aria-modal="true">' +
      '<div class="drawer-hd"><div><div class="mono">' +
      esc(r.id) +
      '</div><h2>' +
      esc(r.projectName) +
      '</h2></div><button class="btn sm ghost" type="button" id="closeDrawer">Close</button></div>' +
      '<div class="drawer-bd">' +
      slackHtml +
      '<dl class="kv">' +
      "<dt>Status</dt><dd><span class=\"pill new\">" +
      esc(r.status || "new") +
      "</span></dd>" +
      "<dt>Requester</dt><dd><b>" +
      esc(r.requesterName) +
      "</b></dd>" +
      "<dt>Email</dt><dd><a href=\"mailto:" +
      esc(r.requesterEmail) +
      '">' +
      esc(r.requesterEmail) +
      "</a></dd>" +
      "<dt>Team</dt><dd>" +
      esc(r.team) +
      "</dd>" +
      "<dt>Work type</dt><dd>" +
      esc(workLabel(r.workType)) +
      "</dd>" +
      "<dt>Priority</dt><dd><span class=\"pill " +
      p.cls +
      '">' +
      esc(p.label) +
      "</span></dd>" +
      "<dt>Needed by</dt><dd>" +
      esc(fmtDate(r.neededBy)) +
      "</dd>" +
      "<dt>Where used</dt><dd>" +
      esc(r.whereUsed || "—") +
      "</dd>" +
      "<dt>Format / size</dt><dd>" +
      esc(r.formatSpecs || "—") +
      "</dd>" +
      "<dt>Submitted</dt><dd>" +
      esc(fmtWhen(r.createdAt)) +
      "</dd>" +
      "</dl>" +
      '<div><div class="note" style="margin-bottom:6px">Brief / requirements</div><div class="brief">' +
      esc(r.brief) +
      "</div></div>" +
      (r.referenceLinks
        ? '<div><div class="note" style="margin-bottom:6px">Reference links</div><div class="brief">' +
          esc(r.referenceLinks) +
          "</div></div>"
        : "") +
      '<div class="info-box"><b>Slack summary (what the channel saw)</b>' +
      "Name · Team · Project · Needed by · Where used — not the brief or email.</div>" +
      "</div></div>";

    $("#scrim").onclick = closeDrawer;
    $("#closeDrawer").onclick = closeDrawer;

    // highlight row if table is visible
    document.querySelectorAll("#view-manager tr[data-id]").forEach(function (tr) {
      tr.classList.toggle("active", tr.getAttribute("data-id") === id);
    });
  }

  function closeDrawer() {
    $("#drawerHost").innerHTML = "";
    state.selectedId = null;
    setUrl(state.view === "confirm" ? "manager" : state.view);
    document.querySelectorAll("#view-manager tr[data-id]").forEach(function (tr) {
      tr.classList.remove("active");
    });
  }

  /* ---------- Nav ---------- */
  function syncNav() {
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      if (b.dataset.view === state.view || (state.view === "confirm" && b.dataset.view === "request")) {
        if (state.view === "confirm" && b.dataset.view === "request") b.removeAttribute("aria-current");
        else if (b.dataset.view === state.view) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      } else {
        b.removeAttribute("aria-current");
      }
    });
    if (state.view === "manager") $("#navManager").setAttribute("aria-current", "true");
    if (state.view === "request") $("#navRequest").setAttribute("aria-current", "true");
  }

  function setView(view) {
    state.view = view;
    if (view !== "manager") closeDrawer();
    syncNav();
    setUrl(view, view === "manager" ? state.selectedId : null);
    if (view === "request") renderRequest();
    else if (view === "manager") renderManager();
  }

  async function boot() {
    var q = params();
    var view = q.get("view") || "request";
    if (view !== "manager" && view !== "request") view = "request";
    state.selectedId = q.get("id");

    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        setView(b.dataset.view);
      });
    });

    await loadHealth();
    try {
      await loadRequests();
    } catch (e) {
      banner("warn", "Could not load saved requests yet. Start the server with <code>npm start</code>.");
    }

    if (view === "manager") setView("manager");
    else setView("request");
  }

  boot();
})();
