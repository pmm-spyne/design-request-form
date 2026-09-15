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
      '<label class="f">Brief / requirements <span class="req">*</span>' +
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
      '<label class="f">Reference links <span class="hint">optional — one per line</span>' +
      '<textarea name="referenceLinks" placeholder="https://…"></textarea></label>';

    html +=
      '<div class="form-actions"><button class="btn primary" type="submit" id="submitBtn">Submit request</button>' +
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

    el.innerHTML =
      '<div class="panel confirm"><div class="panel-bd">' +
      '<div class="pill ok">Submitted</div>' +
      '<span class="id">' +
      esc(req.id) +
      "</span>" +
      '<h2 style="margin:0 0 6px">' +
      esc(req.projectName) +
      "</h2>" +
      '<p class="note">Save this ID if you need to follow up with the design team.</p>' +
      slackNote +
      '<div style="margin-top:18px"><button class="btn primary" type="button" id="goNew">Submit another request</button></div>' +
      "</div></div>";

    $("#goNew").onclick = function () {
      renderRequest();
    };
  }

  renderRequest();
})();
