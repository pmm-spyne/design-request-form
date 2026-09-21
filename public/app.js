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
  function banner(kind, html) {
    $("#banner").innerHTML = '<div class="banner ' + kind + '">' + html + "</div>";
  }
  function clearBanner() {
    $("#banner").innerHTML = "";
  }

  async function api(path, opts) {
    var res = await fetch(path, opts);
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  function renderRequest() {
    $("#pageTitle").textContent = "Submit a design request";
    $("#pageSub").textContent = "Tell us what you need — the design team takes it from here";

    var html = '<form class="panel form-wide" id="reqForm" novalidate>';
    html +=
      '<div class="panel-hd"><h2>What do you need designed?</h2>' +
      "<p>Share enough context so the team can start without chasing you for details.</p></div>";
    html += '<div class="panel-bd">';

    html +=
      '<label class="f">Who is asking <span class="req">*</span>' +
      '<input name="requesterName" autocomplete="name" required placeholder="e.g. Nidhi Singh"></label>';

    html +=
      '<label class="f">Email <span class="req">*</span>' +
      '<input name="requesterEmail" type="email" autocomplete="email" required placeholder="you@spyne.ai"></label>';

    html +=
      '<label class="f">Slack User ID <span class="hint">optional</span>' +
      '<input name="requesterSlackId" placeholder="e.g. U012ABCDEF" autocomplete="off"></label>';

    html +=
      '<label class="f">Team <span class="req">*</span><select name="team" required><option value="">Select…</option>';
    TEAMS.forEach(function (t) {
      html += "<option>" + esc(t) + "</option>";
    });
    html += "</select></label>";

    html +=
      '<label class="f">Project <span class="req">*</span>' +
      '<input name="projectName" required placeholder="e.g. LinkedIn carousel — Studio AI launch"></label>';

    html +=
      '<label class="f">Work type <span class="req">*</span><select name="workType" required><option value="">Select…</option>';
    WORK_TYPES.forEach(function (w) {
      html += '<option value="' + w.id + '">' + esc(w.label) + "</option>";
    });
    html += "</select></label>";

    html +=
      '<label class="f span2">Brief / requirements <span class="req">*</span>' +
      '<textarea name="brief" required placeholder="Audience, message, must-include elements, success criteria…"></textarea></label>';

    html +=
      '<label class="f">Needed by <span class="req">*</span>' +
      '<input type="date" name="neededBy" required></label>';

    html +=
      '<label class="f">Where it will be used <span class="req">*</span>' +
      '<select name="whereUsed" required><option value="">Select…</option>';
    WHERE_USED.forEach(function (w) {
      html += "<option>" + esc(w) + "</option>";
    });
    html += "</select></label>";

    html +=
      '<label class="f span2">Reference links <span class="hint">optional — one per line</span>' +
      '<textarea name="referenceLinks" placeholder="https://…"></textarea></label>';

    html +=
      '<div class="form-actions span2"><button class="btn primary" type="submit" id="submitBtn">Submit request</button>' +
      '<span class="note" id="formNote">The design team will be notified automatically.</span></div>';
    html += "</div></form>";

    var el = $("#view-request");
    el.hidden = false;
    el.innerHTML = html;
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
    var email = form.requesterEmail.value.trim();
    var slackId = form.requesterSlackId.value.trim();
    if (!email) {
      banner("err", "Email is required so you can see this request in Marketing Central.");
      return;
    }

    var btn = $("#submitBtn");
    var note = $("#formNote");
    btn.disabled = true;
    note.textContent = "Submitting…";

    var payload = {
      requesterName: form.requesterName.value.trim(),
      team: form.team.value,
      projectName: form.projectName.value.trim(),
      workType: form.workType.value,
      brief: form.brief.value.trim(),
      neededBy: form.neededBy.value,
      whereUsed: form.whereUsed.value,
      referenceLinks: form.referenceLinks.value.trim(),
      requesterEmail: email,
      requesterSlackId: slackId,
    };

    try {
      var result = await api("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showConfirm(result);
    } catch (err) {
      banner("err", esc(err.message));
      note.textContent = "Please fix and try again.";
      btn.disabled = false;
    }
  }

  function showConfirm(result) {
    var req = result.request;
    var slack = result.slack || {};

    $("#pageTitle").textContent = "Request submitted";
    $("#pageSub").textContent = "You’re all set";
    $("#view-request").hidden = true;
    var el = $("#view-confirm");
    el.hidden = false;

    var slackNote = slack.sent
      ? '<div class="banner ok">The design team has been notified.</div>'
      : '<div class="banner ok">Your request was saved. The design team will pick it up shortly.</div>';

    var title = String(req.projectName || "").trim() || "Design request";
    var titleHtml = /^https?:\/\//i.test(title)
      ? '<a href="' + esc(title) + '" target="_blank" rel="noopener">' + esc(title) + "</a>"
      : esc(title);

    el.innerHTML =
      '<div class="panel confirm"><div class="panel-bd">' +
      '<div class="pill ok">Submitted</div>' +
      '<span class="id">' +
      esc(req.id) +
      "</span>" +
      '<h2 style="margin:0">' +
      titleHtml +
      "</h2>" +
      '<p class="note">Same ID for every revision. Open Design in Marketing Central to follow it.</p>' +
      slackNote +
      '<div style="margin-top:8px"><button class="btn primary" type="button" id="goNew">Submit another request</button></div>' +
      "</div></div>";

    $("#goNew").onclick = function () {
      renderRequest();
    };
  }

  function renderCheck() {
    var el = $("#view-check");
    if (!el) return;
    el.hidden = false;
    el.innerHTML =
      '<form class="panel" id="checkForm">' +
      '<div class="panel-hd"><h2>Check your request</h2>' +
      "<p>Enter the request ID. Older requests need only that. If the form had an email or Slack ID, enter it too.</p></div>" +
      '<div class="panel-bd">' +
      '<label class="f">Request ID<input name="requestId" placeholder="DSN-0012" required></label>' +
      '<label class="f">Email or Slack User ID <span class="hint">only if the request has one</span><input name="contact" placeholder="you@spyne.ai or U012…"></label>' +
      '<div class="form-actions"><button class="btn primary" type="submit">Check status</button></div>' +
      '<div id="checkResult"></div>' +
      "</div></form>";
    $("#checkForm").onsubmit = onCheck;
  }

  async function onCheck(e) {
    e.preventDefault();
    var form = e.target;
    var box = $("#checkResult");
    box.innerHTML = "";
    try {
      var data = await api("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: form.requestId.value.trim(),
          contact: form.contact.value.trim(),
        }),
      });
      var r = data.request || {};
      var html = '<div class="banner ok"><b>' + esc(r.id) + "</b>";
      if (r.projectName) html += "<br>" + esc(r.projectName);
      html += "<br>● " + esc(r.statusLabel || r.status || "");
      if (r.expectedDate) html += "<br>Expected delivery " + esc(r.expectedDate);
      html += "<br>" + esc(r.message || "");
      if (r.feedback) html += "<br><br>" + esc(r.feedback);
      if (r.draftLink) {
        html += '<br><a href="' + esc(r.draftLink) + '" target="_blank" rel="noopener">View latest version</a>';
      }
      if (r.finalLink) {
        html += '<br><a href="' + esc(r.finalLink) + '" target="_blank" rel="noopener">Open final design</a>';
      }
      html += "</div>";
      box.innerHTML = html;
    } catch (err) {
      box.innerHTML = '<div class="banner err">' + esc(err.message) + "</div>";
    }
  }

  renderRequest();
})();
