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

  var peopleList = [];

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

  function checkedValues(form, name) {
    return Array.prototype.map
      .call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (el) {
        return el.value;
      })
      .filter(Boolean);
  }

  function setNav(which) {
    var req = $("#navRequest");
    var mine = $("#navMine");
    if (req) req.setAttribute("aria-current", which === "request" ? "true" : "false");
    if (mine) mine.setAttribute("aria-current", which === "mine" ? "true" : "false");
  }

  async function loadPeople() {
    try {
      var data = await api("/api/directory");
      peopleList = data.people || [];
    } catch (err) {
      peopleList = [];
    }
  }

  function multiField(label, name, options, useId) {
    var html = '<div class="f span2 multi-field"><span>' + label + ' <span class="req">*</span></span>';
    html += '<div class="seg">';
    options.forEach(function (opt, i) {
      var value = useId ? opt.id : opt;
      var text = useId ? opt.label : opt;
      var id = name + "-" + i;
      html +=
        '<input type="checkbox" name="' +
        name +
        '" id="' +
        id +
        '" value="' +
        esc(value) +
        '">' +
        '<label for="' +
        id +
        '">' +
        esc(text) +
        "</label>";
    });
    html += "</div></div>";
    return html;
  }

  function renderRequest() {
    setNav("request");
    var mine = $("#view-mine");
    if (mine) mine.hidden = true;
    $("#pageTitle").textContent = "Submit a design request";
    $("#pageSub").textContent = "Tell us what you need — the design team takes it from here";

    var html = '<form class="panel form-wide" id="reqForm" novalidate>';
    html +=
      '<div class="panel-hd"><h2>What do you need designed?</h2>' +
      "<p>Share enough context so the team can start without chasing you for details.</p></div>";
    html += '<div class="panel-bd">';

    html +=
      '<label class="f span2">Who is asking <span class="req">*</span>' +
      '<select name="person" id="personPick" required><option value="">Select name…</option>';
    peopleList.forEach(function (p) {
      html +=
        '<option value="' +
        esc(p.email) +
        '" data-name="' +
        esc(p.name) +
        '">' +
        esc(p.name) +
        " · " +
        esc(p.email) +
        "</option>";
    });
    html += "</select></label>";
    html += '<input type="hidden" name="requesterName" value="">';
    html += '<input type="hidden" name="requesterEmail" value="">';

    if (!peopleList.length) {
      html +=
        '<label class="f">Name <span class="req">*</span>' +
        '<input name="requesterNameFallback" autocomplete="name" placeholder="e.g. Nidhi Singh"></label>';
      html +=
        '<label class="f">Email <span class="req">*</span>' +
        '<input name="requesterEmailFallback" type="email" autocomplete="email" placeholder="you@spyne.ai"></label>';
    }

    html +=
      '<label class="f span2 urgent-box"><input type="checkbox" name="urgent" value="1">' +
      "<div><b>Urgent</b><span>Shows as Urgent on the design board for manager and designers.</span></div></label>";

    html += multiField("Team", "team", TEAMS, false);
    html +=
      '<label class="f span2">Project <span class="req">*</span>' +
      '<input name="projectName" required placeholder="e.g. LinkedIn carousel — Studio AI launch"></label>';
    html += multiField("Work type", "workType", WORK_TYPES, true);
    html +=
      '<label class="f span2">Brief / requirements <span class="req">*</span>' +
      '<textarea name="brief" required placeholder="Audience, message, must-include elements, success criteria…"></textarea></label>';
    html +=
      '<label class="f">Needed by <span class="req">*</span>' +
      '<input type="date" name="neededBy" required></label>';
    html += multiField("Where it will be used", "whereUsed", WHERE_USED, false);
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
    var pick = $("#personPick");
    if (pick) {
      pick.onchange = function () {
        var opt = pick.options[pick.selectedIndex];
        form.requesterEmail.value = pick.value || "";
        form.requesterName.value = opt ? opt.getAttribute("data-name") || "" : "";
      };
    }
    form.onsubmit = onSubmit;
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearBanner();
    var form = e.target;
    var name = (form.requesterName && form.requesterName.value.trim()) || "";
    var email = (form.requesterEmail && form.requesterEmail.value.trim()) || "";
    if (!name && form.requesterNameFallback) name = form.requesterNameFallback.value.trim();
    if (!email && form.requesterEmailFallback) email = form.requesterEmailFallback.value.trim();
    if (!name || !email) {
      banner("err", "Select who is asking (name and email).");
      return;
    }
    var teams = checkedValues(form, "team");
    var workTypes = checkedValues(form, "workType");
    var whereUsed = checkedValues(form, "whereUsed");
    if (!teams.length) {
      banner("err", "Select at least one team.");
      return;
    }
    if (!workTypes.length) {
      banner("err", "Select at least one work type.");
      return;
    }
    if (!whereUsed.length) {
      banner("err", "Select at least one place it will be used.");
      return;
    }
    if (!form.reportValidity()) return;

    var btn = $("#submitBtn");
    var note = $("#formNote");
    btn.disabled = true;
    note.textContent = "Submitting…";

    var payload = {
      requesterName: name,
      requesterEmail: email,
      requesterSlackId: "",
      team: teams.join(", "),
      projectName: form.projectName.value.trim(),
      workType: workTypes.join(", "),
      brief: form.brief.value.trim(),
      neededBy: form.neededBy.value,
      whereUsed: whereUsed.join(", "),
      referenceLinks: form.referenceLinks.value.trim(),
      urgent: !!(form.urgent && form.urgent.checked),
      priority: form.urgent && form.urgent.checked ? "p0" : "p2",
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
      (req.priority === "p0" || req.urgent ? '<div class="pill p0">Urgent</div>' : "") +
      '<span class="id">' +
      esc(req.id) +
      "</span>" +
      '<h2 style="margin:0">' +
      titleHtml +
      "</h2>" +
      '<p class="note">Marketing teammates follow this in Marketing Central. Everyone else opens My requests on this page with the same email.</p>' +
      slackNote +
      '<div style="margin-top:8px"><button class="btn primary" type="button" id="goNew">Submit another request</button></div>' +
      "</div></div>";

    $("#goNew").onclick = function () {
      renderRequest();
    };
  }

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function renderMine() {
    setNav("mine");
    $("#pageTitle").textContent = "My requests";
    $("#pageSub").textContent = "This month by default — open work carries into later months";
    $("#view-request").hidden = true;
    $("#view-confirm").hidden = true;
    var el = $("#view-mine");
    el.hidden = false;
    var saved = "";
    var savedMonth = currentMonth();
    try {
      saved = sessionStorage.getItem("designRequesterEmail") || "";
    } catch (e) {
      saved = "";
    }
    try {
      savedMonth = sessionStorage.getItem("designRequesterMonth") || currentMonth();
    } catch (e2) {}
    el.innerHTML =
      '<form class="panel" id="mineForm">' +
      '<div class="panel-hd"><h2>See your requests</h2>' +
      "<p>Use the email from the form. Expected delivery is the date the design manager set.</p></div>" +
      '<div class="panel-bd">' +
      '<label class="f">Email<input name="email" type="email" required placeholder="you@spyne.ai" value="' +
      esc(saved) +
      '"></label>' +
      '<label class="f">Month<input name="month" type="month" required value="' +
      esc(savedMonth) +
      '"></label>' +
      '<div class="form-actions"><button class="btn primary" type="submit">Show my requests</button></div>' +
      '<div id="mineResult"></div>' +
      "</div></form>";
    $("#mineForm").onsubmit = onMine;
    if (saved) onMine({ preventDefault: function () {}, target: $("#mineForm") });
  }

  async function onMine(e) {
    e.preventDefault();
    var form = e.target;
    var email = form.email.value.trim();
    var month = (form.month && form.month.value) || currentMonth();
    var box = $("#mineResult");
    box.innerHTML = "";
    try {
      sessionStorage.setItem("designRequesterEmail", email);
      sessionStorage.setItem("designRequesterMonth", month);
    } catch (err) {}
    try {
      var data = await api("/api/mine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, month: month }),
      });
      var rows = data.requests || [];
      if (!rows.length) {
        box.innerHTML = '<div class="banner">No requests for that email in this month.</div>';
        return;
      }
      var html =
        '<table class="mine-table"><thead><tr><th>Request</th><th>Designer</th><th>Status</th><th>Requested</th><th>Expected delivery</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += "<tr><td><b>" + esc(r.id) + "</b><div>" + esc(r.projectName || "") + "</div></td>";
        html += "<td>" + esc((r.designers || []).join(", ") || "Not assigned yet") + "</td>";
        html +=
          "<td>" +
          esc(r.statusLabel || "") +
          (r.isUrgent || r.priority === "p0" ? " · Urgent" : "") +
          "</td>";
        html += "<td>" + esc(r.requestedAt || "—") + "</td>";
        html += "<td>" + esc(r.expectedDate || "—") + "</td></tr>";
        html += '<tr><td colspan="5">';
        if (r.latestLink) {
          html +=
            '<p><a href="' +
            esc(r.latestLink) +
            '" target="_blank" rel="noopener">Open design</a></p>';
        }
        (r.messages || []).forEach(function (m) {
          html += "<p><b>" + esc(m.who || "") + "</b><br>" + esc(m.text || "");
          if (m.link) {
            html +=
              '<br><a href="' +
              esc(m.link) +
              '" target="_blank" rel="noopener">Open design link</a>';
          }
          html += "</p>";
        });
        if (r.canRespond) {
          html +=
            '<label class="f">Your response<textarea data-response="' +
            esc(r.id) +
            '" placeholder="Write your response. The designer sees this as feedback."></textarea></label>';
          html += '<div class="form-actions">';
          html +=
            '<button class="btn" type="button" data-send="' +
            esc(r.id) +
            '">Send response</button>';
          html +=
            '<button class="btn primary" type="button" data-approve="' +
            esc(r.id) +
            '">Approve</button>';
          html += "</div>";
        }
        html += '<p class="note">' + esc(r.message || "") + "</p></td></tr>";
      });
      html += "</tbody></table>";
      box.innerHTML = html;
      box.querySelectorAll("[data-send], [data-approve]").forEach(function (btn) {
        btn.onclick = function () {
          sendResponse(email, btn);
        };
      });
    } catch (err) {
      box.innerHTML = '<div class="banner err">' + esc(err.message) + "</div>";
    }
  }

  async function sendResponse(email, btn) {
    var id = btn.getAttribute("data-send") || btn.getAttribute("data-approve");
    var field = document.querySelector('[data-response="' + id + '"]');
    var text = field ? field.value.trim() : "";
    var approve = btn.hasAttribute("data-approve");
    if (!approve && !text) {
      banner("err", "Write a response first.");
      return;
    }
    btn.disabled = true;
    try {
      await api("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          requestId: id,
          action: approve ? "approve" : "response",
          text: text,
        }),
      });
      banner(
        "ok",
        approve
          ? "Approved. The designer will send the final delivery."
          : "Response sent to the designer."
      );
      var form = $("#mineForm");
      if (form) onMine({ preventDefault: function () {}, target: form });
    } catch (err) {
      banner("err", err.message);
      btn.disabled = false;
    }
  }

  var navRequest = $("#navRequest");
  var navMine = $("#navMine");
  if (navRequest)
    navRequest.onclick = function () {
      renderRequest();
    };
  if (navMine)
    navMine.onclick = function () {
      renderMine();
    };

  loadPeople().then(function () {
    renderRequest();
  });
})();
