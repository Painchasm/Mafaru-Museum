/* The Mafaru Museum
   The whole page is built from the files in /data.
   Add and edit memories in Pages CMS, not in this file. */

(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var WING_ORDER = ["street", "cafe", "seaside", "alley"];
  // Old category names from the first version still work.
  var ALIAS = { permanent: "cafe", temporary: "seaside", restricted: "alley" };

  var state = { exhibits: [], settings: {}, unlocked: false, view: [], cur: -1 };
  var problems = [];

  /* ---------- Helpers ---------- */

  // Pages CMS writes paths like "/images/pic.png". On a GitHub project site
  // (user.github.io/repo/) a leading slash points at the wrong place, so make it relative.
  function imgUrl(p) {
    if (!p) return "";
    p = String(p).trim();
    if (/^(https?:|data:)/i.test(p)) return p;
    p = p.replace(/^\.?\/+/, "");
    return p.split("/").map(function (seg) {
      var s = seg;
      try { s = decodeURIComponent(seg); } catch (e) {}
      return encodeURIComponent(s);
    }).join("/");
  }

  function placeholder(text) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450"><rect width="600" height="450" fill="#e9e2cf"/>' +
      '<text x="300" y="215" font-size="26" text-anchor="middle" fill="#6b5f48" font-family="sans-serif">' + esc(text) + '</text>' +
      '<text x="300" y="255" font-size="18" text-anchor="middle" fill="#8a7e66" font-family="sans-serif">Check the picture path in Pages CMS</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function wingOf(e) {
    var w = String(e.wing || "").toLowerCase().trim();
    if (ALIAS[w]) return ALIAS[w];
    return WING_ORDER.indexOf(w) > -1 ? w : "street";
  }

  function stamp(e) {
    if (e.date) {
      var m = String(e.date).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return "'" + m[1].slice(2) + " " + m[2] + " " + m[3];
    }
    if (e.year) return "'" + String(e.year).slice(-2);
    return "";
  }

  function asList(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    return [];
  }

  async function load(name) {
    var res;
    try {
      res = await fetch("data/" + name + ".json?v=" + Date.now());
    } catch (e) {
      if (location.protocol === "file:") {
        problems.push("You opened index.html straight from your computer, so the browser blocks the data files. View the GitHub Pages link instead, or run a local server.");
      } else {
        problems.push("Could not reach data/" + name + ".json (" + e.message + ").");
      }
      return null;
    }
    if (!res.ok) {
      problems.push("Could not find data/" + name + ".json (error " + res.status + "). Check that the data folder sits next to index.html in your GitHub repo and the file is named exactly " + name + ".json.");
      return null;
    }
    try {
      return await res.json();
    } catch (e) {
      problems.push("data/" + name + ".json is not valid JSON (" + e.message + "). Open it on GitHub and look for a missing comma or quote, or re-save it from Pages CMS.");
      return null;
    }
  }

  /* ---------- Cards ---------- */

  function picture(e) {
    var src = e.image ? imgUrl(e.image) : placeholder("No picture yet");
    return '<img loading="lazy" src="' + esc(src) + '" alt="' + esc(e.title || "Memory") + '" data-path="' + esc(e.image || "") + '">';
  }

  function badge(e) { return e.featured ? '<span class="badge">Highlight</span>' : ""; }

  function polaroid(e, mode, style) {
    return '<figure class="polaroid" data-k="' + e._k + '" style="' + (style || "") + '">' +
      '<button type="button" class="pol-btn" aria-label="Open ' + esc(e.title) + '">' +
      (mode === "hang" ? '<span class="peg" aria-hidden="true"></span>' : '<span class="tape" aria-hidden="true"></span>') +
      badge(e) +
      '<span class="pol-img">' + picture(e) + '</span>' +
      '<span class="pol-cap">' + esc(e.title) + '</span>' +
      '</button></figure>';
  }

  function filmFrame(e, n) {
    var num = String(n).padStart(2, "0") + "A";
    return '<figure class="f35" data-k="' + e._k + '">' +
      '<button type="button" class="f35-btn" aria-label="Open ' + esc(e.title) + '">' +
      '<span class="edge">MAFARU 400 &gt; ' + num + '</span>' +
      '<span class="f35-img">' + picture(e) + '<span class="stamp">' + esc(stamp(e)) + '</span></span>' +
      '</button>' +
      '<figcaption><strong>' + esc(e.title) + '</strong>' + (e.place ? '<span class="where">' + esc(e.place) + '</span>' : "") + '</figcaption>' +
      '</figure>';
  }

  function printCard(e) {
    return '<figure class="print" data-k="' + e._k + '">' +
      '<button type="button" class="print-btn" aria-label="Open ' + esc(e.title) + '">' + badge(e) + picture(e) + '</button>' +
      '<figcaption><strong>' + esc(e.title) + '</strong>' + (e.place ? '<span class="where">' + esc(e.place) + '</span>' : "") + '</figcaption>' +
      '</figure>';
  }

  /* ---------- Rendering ---------- */

  function by(w) { return state.exhibits.filter(function (e) { return e.wing === w; }); }

  function fill(sel, html, empty) {
    $(sel).innerHTML = html || '<p class="empty">' + esc(empty) + '</p>';
  }

  var ROT = [-4, 3, -2, 4, -3];

  function renderHero() {
    var pool = state.exhibits.filter(function (e) { return e.wing !== "alley"; });
    var pick = pool.filter(function (e) { return e.featured; })
      .concat(pool.filter(function (e) { return !e.featured; })).slice(0, 5);
    var n = pick.length;
    var row = $("#showcase");
    if (!n) {
      row.innerHTML = '<p class="empty light">Your first memories will hang here. Add one in Pages CMS.</p>';
      return;
    }
    // The wire sags in the middle, so hang each polaroid at the wire's height.
    row.innerHTML = pick.map(function (e, i) {
      var p = (0.06 + (i + 0.5) / n) / 1.12;
      var drop = Math.round(112 * p * (1 - p));
      return polaroid(e, "hang", "--drop:" + drop + "px;--rot:" + ROT[i % ROT.length] + "deg;--i:" + i);
    }).join("");
  }

  function renderWalls() {
    fill("#strip", by("street").map(function (e, i) { return filmFrame(e, i + 1); }).join(""),
      "No snapshots on the street yet. Add a memory in Pages CMS and set it to street.");
    fill("#cafeWall", by("cafe").map(function (e) { return polaroid(e, "tape"); }).join(""),
      "The cafe is empty. Add a memory in Pages CMS and set it to cafe.");
    fill("#seaWall", by("seaside").map(printCard).join(""),
      "No big prints yet. Add a memory in Pages CMS and set it to seaside.");
    if (state.unlocked) {
      fill("#alleyWall", by("alley").map(printCard).join(""),
        "The alley is quiet. Add a memory in Pages CMS and set it to alley.");
    }
  }

  function renderPeople(list) {
    fill("#passports", list.map(function (p) {
      return '<article class="passport">' +
        '<div class="pp-photo"><img loading="lazy" src="' + esc(p.image ? imgUrl(p.image) : placeholder("No photo")) + '" alt="Portrait of ' + esc(p.name) + '" data-path="' + esc(p.image || "") + '"></div>' +
        '<div class="pp-text"><h3>' + esc(p.name) + '</h3><p class="role">' + esc(p.title) + '</p><p>' + esc(p.contribution) + '</p></div>' +
        '</article>';
    }).join(""), "No travelers yet. Add yourselves in Pages CMS under Travelers.");
  }

  function renderQuotes(list) {
    fill("#postcardWall", list.map(function (q) {
      return '<blockquote class="postcard"><div class="pc-text"><p>' + esc(q.text) + '</p>' +
        '<footer>' + esc(q.author) + (q.year ? ", " + esc(q.year) : "") + '</footer></div>' +
        '<div class="pc-stamp" aria-hidden="true"><span></span></div></blockquote>';
    }).join(""), "No postcards yet. Add a quote in Pages CMS.");
  }

  function renderSettings(s, people) {
    var name = s.museumName || "The Mafaru Museum";
    document.title = name;
    $("#museumName").textContent = name;
    $("#navName").textContent = name;
    $("#tagline").textContent = s.tagline || "";
    $("#est").textContent = s.established ? "Since " + s.established : "";
    $("#banner").textContent = s.currentExhibition || "";
    $("#ticket").hidden = !s.currentExhibition;
    $("#footName").textContent = name + (s.established ? ", since " + s.established : "");
    $("#donors").textContent = people.length ? "Travel companions: " + people.map(function (p) { return p.name; }).join(", ") + "." : "";
  }

  /* ---------- Viewfinder modal ---------- */

  var lastFocus = null;
  var WING_NAMES = { street: "The Street", cafe: "Hall of Fame Cafe", seaside: "Seaside Viewpoint", alley: "Night Alley" };

  function visibleList() {
    var out = [];
    WING_ORDER.forEach(function (w) { if (w !== "alley" || state.unlocked) out = out.concat(by(w)); });
    return out;
  }

  function openMemory(k) {
    state.view = visibleList();
    state.cur = state.view.findIndex(function (e) { return e._k === k; });
    if (state.cur < 0) { state.view = [state.exhibits[k]]; state.cur = 0; }
    lastFocus = document.activeElement;
    showMemory();
    $("#modal").hidden = false;
    document.body.classList.add("noscroll");
    $("#modalClose").focus();
  }

  function showMemory() {
    var e = state.view[state.cur];
    var img = $("#mImg");
    img.dataset.failed = "";
    img.src = e.image ? imgUrl(e.image) : placeholder("No picture yet");
    img.dataset.path = e.image || "";
    img.alt = e.title || "";
    $("#mTitle").textContent = e.title || "Untitled";
    $("#mWhere").textContent = [e.place, WING_NAMES[e.wing]].filter(Boolean).join("  /  ");
    $("#mLore").textContent = e.lore || "No story written down yet. Someone should fix that.";
    $("#mNote").textContent = e.placard || "";
    $("#mStamp").textContent = stamp(e);
    $("#mCount").textContent = String(state.cur + 1).padStart(2, "0") + " / " + String(state.view.length).padStart(2, "0");
    $("#modalNext").hidden = state.view.length < 2;
  }

  function step(d) {
    if (state.view.length < 2) return;
    state.cur = (state.cur + d + state.view.length) % state.view.length;
    showMemory();
  }

  function closeMemory() {
    $("#modal").hidden = true;
    document.body.classList.remove("noscroll");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- Night alley ---------- */

  function unlock() {
    state.unlocked = true;
    $("#gate").hidden = true;
    $("#alleyWall").hidden = false;
    renderWalls();
    try { sessionStorage.setItem("mafaru-unlocked", "1"); } catch (e) {}
  }

  function setupLock() {
    try { if (sessionStorage.getItem("mafaru-unlocked") === "1") unlock(); } catch (e) {}
    $("#lockForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var typed = $("#pw").value.trim().toLowerCase();
      var real = String(state.settings.restrictedPassword || "").trim().toLowerCase();
      if (real && typed === real) {
        unlock();
      } else {
        $("#lockMsg").textContent = "The gate stays shut. " + (state.settings.restrictedHint || "");
        $("#pw").select();
      }
    });
  }

  /* ---------- Station cat ---------- */

  var catTimer = null;
  function catSays(text) {
    var b = $("#catBubble");
    b.textContent = text;
    b.hidden = false;
    clearTimeout(catTimer);
    catTimer = setTimeout(function () { b.hidden = true; }, 4500);
  }
  function catLines() {
    var l = state.settings.guardLines;
    return (l && l.length) ? l : ["Mrrp."];
  }
  function setupCat() {
    $("#cat").addEventListener("click", function () {
      var l = catLines();
      catSays(l[Math.floor(Math.random() * l.length)]);
    });
    setTimeout(function () { catSays(catLines()[0]); }, 3500);
  }

  /* ---------- Events ---------- */

  function setupEvents() {
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".pol-btn, .f35-btn, .print-btn");
      if (btn) {
        var fig = btn.closest("[data-k]");
        if (fig) openMemory(Number(fig.dataset.k));
      }
    });
    $("#modalClose").addEventListener("click", closeMemory);
    $("#modalBack").addEventListener("click", closeMemory);
    $("#modalNext").addEventListener("click", function () { step(1); });
    document.addEventListener("keydown", function (ev) {
      if ($("#modal").hidden) return;
      if (ev.key === "Escape") closeMemory();
      if (ev.key === "ArrowRight") step(1);
      if (ev.key === "ArrowLeft") step(-1);
    });
    $("#randomBtn").addEventListener("click", function () {
      var pool = visibleList();
      if (!pool.length) return;
      openMemory(pool[Math.floor(Math.random() * pool.length)]._k);
    });
    $("#noticeClose").addEventListener("click", function () { $("#notice").hidden = true; });

    // If a picture cannot be found, show which path failed instead of a blank box.
    document.addEventListener("error", function (ev) {
      var t = ev.target;
      if (t && t.tagName === "IMG" && !t.dataset.failed) {
        t.dataset.failed = "1";
        t.src = placeholder("Can't find " + (t.dataset.path || "a picture"));
      }
    }, true);
  }

  function showProblems() {
    if (!problems.length) return;
    $("#noticeBody").innerHTML = problems.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    $("#notice").hidden = false;
  }

  /* ---------- Start ---------- */

  async function init() {
    setupEvents();
    var results = await Promise.all([load("settings"), load("exhibits"), load("portraits"), load("quotes")]);
    var settings = results[0], ex = results[1], por = results[2], quo = results[3];

    state.settings = (settings && typeof settings === "object") ? settings : {};
    state.exhibits = asList(ex, "exhibits")
      .filter(function (e) { return e && typeof e === "object"; })
      .map(function (e, i) { var c = Object.assign({}, e); c._k = i; c.wing = wingOf(e); return c; });
    var people = asList(por, "portraits").filter(function (p) { return p && typeof p === "object"; });

    try {
      renderSettings(state.settings, people);
      renderHero();
      renderWalls();
      renderPeople(people);
      renderQuotes(asList(quo, "quotes").filter(function (q) { return q && typeof q === "object"; }));
      setupLock();
      setupCat();
    } catch (err) {
      console.error(err);
      problems.push("Something in your data looked unexpected (" + err.message + "). Re-save the latest change in Pages CMS or undo it on GitHub.");
    }
    showProblems();
  }

  init();
})();
