/* The Mafaru Museum
   The whole page is built from your data files (settings, exhibits, portraits, quotes, groups).
   Add and edit memories in Pages CMS, not in this file. */

(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function norm(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/\s+/g, " ").trim();
  }
  function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "memory"; }
  function isObj(o) { return o && typeof o === "object"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  var WING_ORDER = ["street", "cafe", "seaside", "billboard"];
  // Older category names still work.
  var ALIAS = { permanent: "cafe", temporary: "seaside", restricted: "billboard", alley: "billboard", gallery: "billboard" };
  var WING_NAMES = { street: "The Street", cafe: "Hall of Fame Cafe", seaside: "Seaside Viewpoint", billboard: "The Billboard" };
  var FOLDER_COLORS = [["#d9b878", "#b98f4c"], ["#9fc7a6", "#6fa07a"], ["#e8a08a", "#c4694f"], ["#98bfe0", "#6b97c2"], ["#c3add9", "#9a82bb"], ["#e6c86f", "#c9a23c"]];

  var state = {
    exhibits: [], groups: [], tags: [], groupsMeta: [], settings: {},
    view: [], cur: -1, results: [], qWing: "", sheetItems: [], area: "top"
  };
  var problems = [];

  /* ---------- Helpers ---------- */

  // Pages CMS writes paths like "/images/pic.png". On a GitHub project site a leading slash
  // points at the wrong place, so make every path relative.
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

  function sortKey(e) {
    if (e.date) { var m = String(e.date).match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; }
    return e.year ? String(e.year) + "-00-00" : "0000-00-00";
  }

  function asList(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    return [];
  }

  function toTags(v) {
    var a = Array.isArray(v) ? v : (typeof v === "string" ? v.split(",") : []);
    var seen = {}, out = [];
    a.forEach(function (t) {
      t = String(t == null ? "" : t).trim();
      var k = norm(t);
      if (t && !seen[k]) { seen[k] = 1; out.push(t); }
    });
    return out;
  }

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

  // Looks in data/ first, then next to index.html, so either layout works.
  async function load(name, optional) {
    var urls = ["data/" + name + ".json", name + ".json"];
    var res = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        res = await fetch(urls[i] + "?v=" + Date.now());
      } catch (e) {
        if (!optional) {
          if (location.protocol === "file:") {
            problems.push("You opened index.html straight from your computer, so the browser blocks the data files. View the GitHub Pages link instead.");
          } else {
            problems.push("Could not reach " + urls[i] + " (" + e.message + ").");
          }
        }
        return null;
      }
      if (res.ok) break;
    }
    if (!res || !res.ok) {
      if (!optional) problems.push("Could not find " + name + ".json. Upload it to your GitHub repo next to index.html (same place as app.js).");
      return null;
    }
    try {
      return await res.json();
    } catch (e) {
      problems.push(name + ".json is not valid JSON (" + e.message + "). Open it on GitHub and look for a missing comma or quote, or re-save it from Pages CMS.");
      return null;
    }
  }

  /* ---------- Data preparation ---------- */

  function prepare(list) {
    var ids = {};
    return list.filter(isObj).map(function (e, i) {
      var c = Object.assign({}, e);
      c._k = i;
      c.wing = wingOf(e);
      c.title = String(c.title || "Untitled");
      c.group = String(c.group || "").trim();
      c.tags = toTags(c.tags);
      var base = slug(c.title), id = base, n = 2;
      while (ids[id]) { id = base + "-" + n++; }
      ids[id] = 1; c._id = id;
      c._f = {
        title: norm(c.title), place: norm(c.place), group: norm(c.group), tags: norm(c.tags.join(" ")),
        rest: norm([c.placard, c.lore, WING_NAMES[c.wing], stamp(c), c.year].join(" "))
      };
      return c;
    });
  }

  function buildCollections() {
    var gmap = {}, tmap = {}, meta = {};
    state.groupsMeta.forEach(function (g) { if (isObj(g) && g.name) meta[norm(g.name)] = g; });
    state.exhibits.forEach(function (e) {
      if (e.group) {
        var k = norm(e.group);
        (gmap[k] = gmap[k] || { key: k, name: e.group, items: [] }).items.push(e);
      }
      e.tags.forEach(function (t) {
        var kk = norm(t);
        (tmap[kk] = tmap[kk] || { key: kk, name: t, items: [] }).items.push(e);
      });
    });
    Object.keys(meta).forEach(function (k) { if (!gmap[k]) gmap[k] = { key: k, name: meta[k].name, items: [] }; });
    state.groups = Object.keys(gmap).map(function (k) {
      var g = gmap[k], m = meta[k];
      if (m) { g.name = m.name || g.name; g.desc = m.description || ""; g.cover = m.cover || ""; }
      return g;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    state.tags = Object.keys(tmap).map(function (k) { return tmap[k]; })
      .sort(function (a, b) { return b.items.length - a.items.length || a.name.localeCompare(b.name); });
  }

  function find(kind, key) {
    var arr = kind === "tag" ? state.tags : state.groups;
    for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i];
    return null;
  }

  function by(w) { return state.exhibits.filter(function (e) { return e.wing === w; }); }
  function visibleList() {
    var out = [];
    WING_ORDER.forEach(function (w) { out = out.concat(by(w)); });
    return out;
  }

  /* ---------- Card builders ---------- */

  function picture(e) {
    var src = e.image ? imgUrl(e.image) : placeholder("No picture yet");
    return '<img loading="lazy" decoding="async" src="' + esc(src) + '" alt="' + esc(e.title) + '" data-path="' + esc(e.image || "") + '">';
  }
  function badge(e) { return e.featured ? '<span class="badge">Highlight</span>' : ""; }

  function polaroid(e, mode, style) {
    return '<figure class="polaroid reveal" data-k="' + e._k + '" style="' + (style || "") + '">' +
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
      '<span class="edge"><span>MAFARU 400</span><span>&#9654; ' + num + '</span></span>' +
      '<span class="f35-img">' + picture(e) + '<span class="stamp">' + esc(stamp(e)) + '</span></span>' +
      '</button>' +
      '<figcaption><strong>' + esc(e.title) + '</strong>' + (e.place ? '<span class="where">' + esc(e.place) + '</span>' : "") + '</figcaption>' +
      '</figure>';
  }

  function printCard(e) {
    return '<figure class="print reveal" data-k="' + e._k + '">' +
      '<button type="button" class="print-btn" aria-label="Open ' + esc(e.title) + '">' + badge(e) + picture(e) + '</button>' +
      '<figcaption><strong>' + esc(e.title) + '</strong>' + (e.place ? '<span class="where">' + esc(e.place) + '</span>' : "") + '</figcaption>' +
      '</figure>';
  }

  /* ---------- Rendering ---------- */

  function fill(sel, html, empty) {
    $(sel).innerHTML = html || '<p class="empty">' + esc(empty) + '</p>';
  }

  var ROT = [-4, 3, -2, 4, -3];

  function renderHero() {
    var pool = state.exhibits.slice();
    var pick = pool.filter(function (e) { return e.featured; })
      .concat(pool.filter(function (e) { return !e.featured; })).slice(0, 5);
    var n = pick.length, row = $("#showcase");
    if (!n) {
      row.innerHTML = '<p class="empty light">Your first memories will hang here. Add one in Pages CMS.</p>';
      return;
    }
    // The wire sags in the middle, so each polaroid hangs at the wire's height.
    row.innerHTML = pick.map(function (e, i) {
      var p = (0.06 + (i + 0.5) / n) / 1.12;
      var drop = Math.round(112 * p * (1 - p));
      return polaroid(e, "hang", "--drop:" + drop + "px;--rot:" + ROT[i % ROT.length] + "deg;--i:" + i)
        .replace(' reveal"', '"');
    }).join("");
  }

  function renderWalls() {
    fill("#strip", by("street").map(function (e, i) { return filmFrame(e, i + 1); }).join(""),
      "No snapshots on the street yet. Add a memory in Pages CMS and set it to street.");
    fill("#cafeWall", by("cafe").map(function (e) { return polaroid(e, "tape"); }).join(""),
      "The cafe is empty. Add a memory in Pages CMS and set it to cafe.");
    fill("#seaWall", by("seaside").map(printCard).join(""),
      "No big prints yet. Add a memory in Pages CMS and set it to seaside.");
  }

  function renderPeople(list) {
    var est = state.settings.established ? String(state.settings.established) : "";
    fill("#passports", list.map(function (p, i) {
      return '<article class="passport reveal">' +
        '<div class="pp-photo"><img loading="lazy" src="' + esc(p.image ? imgUrl(p.image) : placeholder("No photo")) + '" alt="Portrait of ' + esc(p.name) + '" data-path="' + esc(p.image || "") + '"></div>' +
        '<div class="pp-text"><h3>' + esc(p.name) + '</h3><p class="role">' + esc(p.title) + '</p><p>' + esc(p.contribution) + '</p></div>' +
        '<span class="visa" aria-hidden="true">ADMIT ONE' + (est ? "<br>" + esc(est) : "") + '</span>' +
        '</article>';
    }).join(""), "No travelers yet. Add yourselves in Pages CMS under Travelers.");
  }

  function renderQuotes(list) {
    fill("#postcardWall", list.map(function (q) {
      return '<blockquote class="postcard reveal"><div class="pc-text"><p>' + esc(q.text) + '</p>' +
        '<footer>' + esc(q.author) + (q.year ? ", " + esc(q.year) : "") + '</footer></div>' +
        '<div class="pc-side" aria-hidden="true"><div class="pc-stamp"><span></span></div><div class="pc-mark"></div></div></blockquote>';
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
    $("#stats").textContent = state.exhibits.length
      ? plural(state.exhibits.length, "memory", "memories") + "  /  " + plural(state.groups.length, "album", "albums") + "  /  " + plural(state.tags.length, "tag", "tags")
      : "";
  }

  /* ---------- Albums and tags ---------- */

  function coverOf(g) {
    if (g.cover) return g.cover;
    for (var i = 0; i < g.items.length; i++) if (g.items[i].image) return g.items[i].image;
    return "";
  }

  function folderCard(g) {
    var c = FOLDER_COLORS[hash(g.key) % FOLDER_COLORS.length];
    var pics = g.items.filter(function (e) { return e.image; }).slice(0, 3);
    var ph = pics.map(function (e) {
      return '<span class="ph"><img loading="lazy" src="' + esc(imgUrl(e.image)) + '" alt="" data-path="' + esc(e.image) + '"></span>';
    }).join("");
    if (!ph && g.cover) ph = '<span class="ph"><img loading="lazy" src="' + esc(imgUrl(g.cover)) + '" alt="" data-path="' + esc(g.cover) + '"></span>';
    return '<button type="button" class="folder reveal" data-kind="group" data-key="' + esc(g.key) + '" style="--fc:' + c[0] + ';--fc2:' + c[1] + '" aria-label="Open album ' + esc(g.name) + '">' +
      '<span class="f-back"></span><span class="f-photos">' + ph + '</span>' +
      '<span class="f-front"><span class="f-label"><strong>' + esc(g.name) + '</strong><em>' + plural(g.items.length, "memory", "memories") + '</em></span></span>' +
      '</button>';
  }

  function renderAlbums() {
    fill("#folders", state.groups.map(folderCard).join(""),
      "No albums yet. In Pages CMS, type an album name (like a person's name) in the Album field of a memory.");
    $("#tagcloud").innerHTML = state.tags.length
      ? state.tags.map(function (t) {
          return '<button type="button" class="chip big" data-kind="tag" data-key="' + esc(t.key) + '">' + esc(t.name) + ' <b>' + t.items.length + '</b></button>';
        }).join("")
      : '<p class="empty">No tags yet. Add tags to a memory in Pages CMS.</p>';
  }

  function setTab(t) {
    var g = t === "groups";
    $("#folders").hidden = !g; $("#tagcloud").hidden = g;
    $("#tabGroups").classList.toggle("on", g); $("#tabTags").classList.toggle("on", !g);
    $("#tabGroups").setAttribute("aria-selected", String(g)); $("#tabTags").setAttribute("aria-selected", String(!g));
  }

  function openSheet(kind, key) {
    var col = find(kind, key);
    if (!col) return;
    var items = col.items.slice().sort(function (a, b) { return sortKey(b).localeCompare(sortKey(a)); });
    state.sheetItems = items;
    $("#sKind").textContent = kind === "tag" ? "Tag" : "Album";
    $("#sTitle").textContent = col.name;
    $("#sDesc").textContent = col.desc || "";
    $("#sDesc").hidden = !col.desc;
    $("#sCount").textContent = plural(items.length, "memory", "memories");
    $("#sGrid").innerHTML = items.length
      ? items.map(function (e) { return polaroid(e, "tape").replace(' reveal"', '"'); }).join("")
      : '<p class="empty">Nothing in here yet. Give a memory this album name in Pages CMS.</p>';
    $("#sheet").hidden = false;
    document.body.classList.add("noscroll");
    $("#sheetClose").focus();
  }
  function closeSheet() {
    $("#sheet").hidden = true;
    if ($("#modal").hidden && $("#search").hidden) document.body.classList.remove("noscroll");
  }

  /* ---------- Viewfinder ---------- */

  var lastFocus = null, copyTimer = null;

  function openMemory(k, list) {
    var pool = (list && list.length) ? list : visibleList();
    var idx = pool.findIndex(function (e) { return e._k === k; });
    if (idx < 0) { pool = [state.exhibits[k]]; idx = 0; }
    if (!pool[idx]) return;
    state.view = pool; state.cur = idx;
    lastFocus = document.activeElement;
    showMemory();
    $("#modal").hidden = false;
    document.body.classList.add("noscroll");
    var f = $("#flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
    Snd.shutter();
    $("#modalClose").focus();
  }

  function showMemory() {
    var e = state.view[state.cur];
    var img = $("#mImg");
    img.dataset.failed = "";
    img.src = e.image ? imgUrl(e.image) : placeholder("No picture yet");
    img.dataset.path = e.image || "";
    img.alt = e.title;
    setZoom(false);
    $("#mTitle").textContent = e.title;
    $("#mWhere").textContent = [e.place, WING_NAMES[e.wing]].filter(Boolean).join("  /  ");
    var chips = "";
    if (e.group) chips += '<button type="button" class="chip" data-kind="group" data-key="' + esc(norm(e.group)) + '">Album: ' + esc(e.group) + '</button>';
    e.tags.forEach(function (t) { chips += '<button type="button" class="chip" data-kind="tag" data-key="' + esc(norm(t)) + '">' + esc(t) + '</button>'; });
    $("#mChips").innerHTML = chips;
    $("#mLore").textContent = e.lore || "No story written down yet. Someone should fix that.";
    $("#mNote").textContent = e.placard || "";
    $("#mStamp").textContent = stamp(e);
    $("#mCount").textContent = String(state.cur + 1).padStart(2, "0") + " / " + String(state.view.length).padStart(2, "0");
    var multi = state.view.length > 1;
    $("#mPrev").hidden = !multi; $("#mNext").hidden = !multi;
    $("#mCopy").textContent = "Copy link";
    try { history.replaceState(null, "", location.pathname + location.search + "#memory=" + encodeURIComponent(e._id)); } catch (x) {}
  }

  function step(d) {
    if (state.view.length < 2) return;
    state.cur = (state.cur + d + state.view.length) % state.view.length;
    showMemory();
  }

  function setZoom(on) {
    $("#finderFrame").classList.toggle("zoomed", on);
    $("#mZoom").textContent = on ? "Fit to screen" : "Zoom in";
    $("#finderScroll").scrollTop = 0; $("#finderScroll").scrollLeft = 0;
  }

  function closeMemory() {
    $("#modal").hidden = true;
    if ($("#sheet").hidden && $("#search").hidden) document.body.classList.remove("noscroll");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (x) {}
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function copyLink() {
    var e = state.view[state.cur]; if (!e) return;
    var url = location.href.split("#")[0] + "#memory=" + encodeURIComponent(e._id);
    function done() {
      $("#mCopy").textContent = "Link copied";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { $("#mCopy").textContent = "Copy link"; }, 1800);
    }
    function fallback() {
      var t = document.createElement("textarea");
      t.value = url; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (x) { window.prompt("Copy this link:", url); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
    else fallback();
  }

  /* ---------- Search ---------- */

  function hl(text, tokens) {
    text = String(text == null ? "" : text);
    tokens = tokens.filter(Boolean);
    if (!tokens.length) return esc(text);
    var re = new RegExp("(" + tokens.map(rx).join("|") + ")", "gi");
    return text.split(re).map(function (p, i) { return i % 2 ? "<mark>" + esc(p) + "</mark>" : esc(p); }).join("");
  }

  function snippet(e, tokens) {
    var lore = String(e.lore || e.placard || "");
    if (!lore) return "";
    var low = lore.toLowerCase(), at = -1;
    for (var i = 0; i < tokens.length && at < 0; i++) at = low.indexOf(tokens[i]);
    var start = Math.max(0, at - 36);
    var s = lore.slice(start, start + 130);
    return (start > 0 ? "..." : "") + s + (start + 130 < lore.length ? "..." : "");
  }

  function openSearch(prefill) {
    $("#search").hidden = false;
    document.body.classList.add("noscroll");
    if (typeof prefill === "string") $("#q").value = prefill;
    buildFilters();
    runSearch();
    $("#q").focus();
  }
  function closeSearch() {
    $("#search").hidden = true;
    if ($("#modal").hidden && $("#sheet").hidden) document.body.classList.remove("noscroll");
  }

  function buildFilters() {
    var html = '<button type="button" class="fchip' + (state.qWing ? "" : " on") + '" data-w="">All <b>' + state.exhibits.length + '</b></button>';
    WING_ORDER.forEach(function (w) {
      html += '<button type="button" class="fchip' + (state.qWing === w ? " on" : "") + '" data-w="' + w + '">' + esc(WING_NAMES[w]) + ' <b>' + by(w).length + '</b></button>';
    });
    $("#qFilters").innerHTML = html;
  }

  function runSearch() {
    var raw = $("#q").value;
    var tokens = norm(raw).split(" ").filter(Boolean);
    var list = state.exhibits.filter(function (e) {
      if (state.qWing && e.wing !== state.qWing) return false;
      return tokens.every(function (t) {
        var f = e._f;
        return f.title.indexOf(t) > -1 || f.place.indexOf(t) > -1 || f.group.indexOf(t) > -1 || f.tags.indexOf(t) > -1 || f.rest.indexOf(t) > -1;
      });
    });
    if (tokens.length) {
      list = list.map(function (e, i) {
        var s = 0;
        tokens.forEach(function (t) {
          var f = e._f;
          if (f.title.indexOf(t) > -1) s += 6 + (f.title.indexOf(t) === 0 ? 2 : 0);
          if (f.group.indexOf(t) > -1) s += 4;
          if (f.tags.indexOf(t) > -1) s += 4;
          if (f.place.indexOf(t) > -1) s += 3;
          if (f.rest.indexOf(t) > -1) s += 1;
        });
        return { e: e, s: s, i: i };
      }).sort(function (a, b) { return b.s - a.s || a.i - b.i; }).map(function (x) { return x.e; });
    }
    state.results = list;
    var shown = list.slice(0, 60);
    $("#qCount").textContent = !state.exhibits.length ? "There are no memories to search yet."
      : tokens.length ? (list.length ? plural(list.length, "result", "results") : "No memories match that.")
      : "All " + plural(list.length, "memory", "memories") + ", newest additions last";
    var rawTokens = raw.trim().split(/\s+/).filter(Boolean);
    $("#qResults").innerHTML = shown.map(function (e) {
      var meta = [e.place, e.group ? "Album: " + e.group : "", WING_NAMES[e.wing], stamp(e)].filter(Boolean).join("  /  ");
      var snip = tokens.length ? snippet(e, tokens) : "";
      return '<button type="button" class="res" data-k="' + e._k + '">' +
        '<span class="res-img"><img loading="lazy" src="' + esc(e.image ? imgUrl(e.image) : placeholder("No picture")) + '" alt="" data-path="' + esc(e.image || "") + '"></span>' +
        '<span class="res-text"><strong>' + hl(e.title, rawTokens) + '</strong>' +
        '<span class="res-meta">' + hl(meta, rawTokens) + '</span>' +
        (snip ? '<span class="res-snip">' + hl(snip, rawTokens) + '</span>' : "") + '</span></button>';
    }).join("");
    // Quick ideas when nothing is typed or nothing matches
    var q = "";
    if (!tokens.length || !list.length) {
      if (state.groups.length) q += '<p class="qk-title">Albums</p><div class="qk-row">' + state.groups.slice(0, 10).map(function (g) { return '<button type="button" class="qchip" data-q="' + esc(g.name) + '">' + esc(g.name) + '</button>'; }).join("") + '</div>';
      if (state.tags.length) q += '<p class="qk-title">Popular tags</p><div class="qk-row">' + state.tags.slice(0, 14).map(function (t) { return '<button type="button" class="qchip" data-q="' + esc(t.name) + '">' + esc(t.name) + '</button>'; }).join("") + '</div>';
    }
    $("#qQuick").innerHTML = q;
  }

  /* ---------- Billboard ---------- */

  var bb = { items: [], i: 0, timer: null, paused: false, hover: false, inView: false };

  function renderBillboard() {
    bb.items = by("billboard");
    bb.i = 0;
    var thumbs = $("#bbThumbs"), info = $("#bbInfo"), screen = $("#bbScreen");
    $("#bb").classList.toggle("empty-bb", !bb.items.length);
    $("#bbPrev").hidden = $("#bbNext").hidden = bb.items.length < 2;
    if (!bb.items.length) {
      screen.innerHTML = '<div class="bb-empty"><p>The billboard is dark for now.</p><p>Add a memory in Pages CMS and set it to billboard to light it up.</p></div>';
      info.innerHTML = ""; thumbs.innerHTML = "";
      return;
    }
    thumbs.innerHTML = bb.items.map(function (e, i) {
      return '<button type="button" class="bb-thumb" data-i="' + i + '" aria-label="Show ' + esc(e.title) + '">' + picture(e) + '</button>';
    }).join("");
    showSlide(0, true);
  }

  function showSlide(i, instant) {
    if (!bb.items.length) return;
    bb.i = (i + bb.items.length) % bb.items.length;
    var e = bb.items[bb.i], src = e.image ? imgUrl(e.image) : placeholder("No picture yet");
    var screen = $("#bbScreen");
    screen.innerHTML = '<div class="bb-slide' + (instant || reduceMotion ? " still" : "") + '">' +
      '<img class="bb-bg" src="' + esc(src) + '" alt="" aria-hidden="true">' +
      '<img class="bb-fg" src="' + esc(src) + '" alt="' + esc(e.title) + '" data-path="' + esc(e.image || "") + '"></div>';
    $("#bbInfo").innerHTML = '<div class="bb-plaque"><strong>' + esc(e.title) + '</strong>' +
      (e.place ? '<span class="where">' + esc(e.place) + '</span>' : "") +
      '<span class="bb-count">' + (bb.i + 1) + ' / ' + bb.items.length + '</span></div>' +
      '<div class="bb-actions"><button type="button" class="btn small" id="bbOpen">Open this photo</button>' +
      (bb.items.length > 1 && !reduceMotion ? '<button type="button" class="btn small ghost" id="bbPause" aria-pressed="' + bb.paused + '">' + (bb.paused ? "Play slideshow" : "Pause slideshow") + '</button>' : "") +
      '</div>';
    $$("#bbThumbs .bb-thumb").forEach(function (t, n) { t.classList.toggle("on", n === bb.i); });
    var on = $("#bbThumbs .bb-thumb.on");
    if (on && on.scrollIntoView && !instant) { try { $("#bbThumbs").scrollTo({ left: on.offsetLeft - 80, behavior: "smooth" }); } catch (x) {} }
  }

  function bbSchedule() {
    clearInterval(bb.timer);
    bb.timer = null;
    if (reduceMotion || bb.items.length < 2 || bb.paused || bb.hover || !bb.inView) return;
    bb.timer = setInterval(function () { showSlide(bb.i + 1); }, 6500);
  }

  /* ---------- Ambient sound (made in the browser, no audio files needed) ---------- */

  var Snd = (function () {
    var ctx = null, master = null, sfx = null, g = {}, on = false, vol = 0.5, scene = "top", clinkTimer = null;
    var MIX = {
      top: { sea: 1, street: 0.12 }, street: { sea: 0.12, street: 1 }, cafe: { street: 0.08, cafe: 1 },
      seaside: { sea: 1 }, travelers: { sea: 0.35, street: 0.2 }, postcards: { sea: 0.25, street: 0.2, cafe: 0.15 },
      billboard: { sea: 0.3, street: 0.5 }, albums: { sea: 0.1, street: 0.2, cafe: 0.5 }
    };
    var LABEL = { top: "sea breeze", street: "street hum", cafe: "cafe murmur", seaside: "sea breeze", travelers: "soft ambience", postcards: "soft ambience", billboard: "evening street", albums: "quiet cafe" };

    function mkNoise(kind) {
      var len = Math.floor(ctx.sampleRate * 5), fade = Math.floor(ctx.sampleRate * 0.4);
      var ext = new Float32Array(len + fade), last = 0, i;
      for (i = 0; i < ext.length; i++) {
        var w = Math.random() * 2 - 1;
        if (kind === "brown") { last = (last + 0.02 * w) / 1.02; ext[i] = last * 3.5; } else ext[i] = w * 0.8;
      }
      var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (i = 0; i < len; i++) d[i] = ext[i];
      for (i = 0; i < fade; i++) d[i] = ext[i] * (i / fade) + ext[len + i] * (1 - i / fade);
      return buf;
    }
    function src(buf) { var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; }
    function filt(type, f, q) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; }
    function gain(v) { var n = ctx.createGain(); n.gain.value = v; return n; }
    function lfo(freq, depth, target) {
      var o = ctx.createOscillator(); o.frequency.value = freq;
      var d = gain(depth); o.connect(d); d.connect(target); o.start();
    }

    function build() {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = gain(0); master.connect(ctx.destination);
      sfx = gain(vol * 0.7); sfx.connect(ctx.destination);
      var brown = mkNoise("brown"), white = mkNoise("white");

      g.sea = gain(0); g.sea.connect(master);
      var swell = gain(0.55);
      var s1 = src(brown), f1 = filt("lowpass", 800); s1.connect(f1); f1.connect(swell); swell.connect(g.sea);
      lfo(0.10, 0.4, swell.gain);
      var foam = gain(0.1), s2 = src(white), f2 = filt("bandpass", 3200, 0.4); s2.connect(f2); f2.connect(foam); foam.connect(g.sea);
      lfo(0.13, 0.08, foam.gain);

      g.street = gain(0); g.street.connect(master);
      var rum = gain(0.9), s3 = src(brown), f3 = filt("lowpass", 380); s3.connect(f3); f3.connect(rum); rum.connect(g.street);
      lfo(0.05, 0.25, rum.gain);
      var hiss = gain(0.05), s4 = src(white), f4 = filt("bandpass", 1500, 0.6); s4.connect(f4); f4.connect(hiss); hiss.connect(g.street);
      lfo(0.17, 0.03, hiss.gain);

      g.cafe = gain(0); g.cafe.connect(master);
      var mur = gain(0.5), s5 = src(white), f5 = filt("bandpass", 700, 0.7), f6 = filt("lowpass", 2200);
      s5.connect(f5); f5.connect(f6); f6.connect(mur); mur.connect(g.cafe);
      lfo(0.37, 0.2, mur.gain); lfo(0.81, 0.12, mur.gain);
      var room = gain(0.35), s6 = src(brown), f7 = filt("lowpass", 220); s6.connect(f7); f7.connect(room); room.connect(g.cafe);
      return true;
    }

    function applyScene() {
      if (!ctx) return;
      var m = MIX[scene] || MIX.top, t = ctx.currentTime;
      ["sea", "street", "cafe"].forEach(function (k) { g[k].gain.setTargetAtTime(m[k] || 0, t, 0.9); });
    }

    function clink() {
      if (!on || !ctx) return;
      var t = ctx.currentTime, f = 2200 + Math.random() * 1800;
      [1, 2.76].forEach(function (m, i) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * m;
        var e = gain(0); e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(i ? 0.02 : 0.05, t + 0.004);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(e); e.connect(g.cafe); o.start(t); o.stop(t + 0.4);
      });
    }
    function scheduleClink() {
      clearTimeout(clinkTimer);
      if (!on) return;
      clinkTimer = setTimeout(function () {
        if ((MIX[scene] || {}).cafe > 0.4) clink();
        scheduleClink();
      }, 3000 + Math.random() * 5000);
    }

    return {
      isOn: function () { return on; },
      label: function () { return LABEL[scene] || "soft ambience"; },
      setOn: function (v) {
        on = !!v;
        if (on) {
          if (!ctx && !build()) { on = false; return false; }
          ctx.resume();
          applyScene();
          master.gain.setTargetAtTime(vol * 0.45, ctx.currentTime, 0.4);
          scheduleClink();
        } else if (ctx) {
          master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
          clearTimeout(clinkTimer);
          setTimeout(function () { if (!on && ctx) ctx.suspend(); }, 800);
        }
        return on;
      },
      setVol: function (v) {
        vol = v;
        if (ctx && on) master.gain.setTargetAtTime(vol * 0.45, ctx.currentTime, 0.1);
        if (sfx) sfx.gain.value = vol * 0.7;
      },
      setScene: function (a) { scene = a; applyScene(); },
      shutter: function () {
        if (!on || !ctx) return;
        var t = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.08);
        var b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        var s = ctx.createBufferSource(); s.buffer = b;
        var f = filt("bandpass", 2600, 0.8), e = gain(0.6);
        e.gain.setValueAtTime(0.6, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        s.connect(f); f.connect(e); e.connect(sfx); s.start(t);
        var o = ctx.createOscillator(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
        var oe = gain(0.3); oe.gain.setValueAtTime(0.3, t); oe.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        o.connect(oe); oe.connect(sfx); o.start(t); o.stop(t + 0.1);
      }
    };
  })();

  /* ---------- Photo filters and dock ---------- */

  var THEMES = ["day", "sepia", "bw", "night"];

  function setTheme(t) {
    if (THEMES.indexOf(t) < 0) t = "day";
    document.documentElement.setAttribute("data-theme", t);
    store.set("mafaru-theme", t);
    $$(".look").forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.theme === t)); });
    Cat.set(t === "night" ? "sleepy" : (Cat.moods[state.area] || "happy"));
  }

  function buildStars() {
    var h = "";
    for (var i = 0; i < 46; i++) {
      var s = (Math.random() * 2.2 + 0.8).toFixed(1);
      h += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;top:' + (Math.random() * 100).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;animation-delay:' + (Math.random() * 4).toFixed(1) + 's"></i>';
    }
    $("#nightsky").innerHTML = h;
  }

  function setupPetals() {
    if (reduceMotion) return;
    var h = "";
    for (var i = 0; i < 14; i++) {
      h += '<i class="petal" style="left:' + (Math.random() * 100).toFixed(1) + '%;width:' + (8 + Math.random() * 7).toFixed(0) + 'px;height:' + (8 + Math.random() * 7).toFixed(0) + 'px;animation-duration:' + (14 + Math.random() * 12).toFixed(1) + 's;animation-delay:-' + (Math.random() * 24).toFixed(1) + 's;--dx:' + (40 + Math.random() * 120).toFixed(0) + 'px"></i>';
    }
    $("#petals").innerHTML = h;
  }

  function togglePop(which) {
    var map = { look: ["#popLook", "#lookBtn"], sound: ["#popSound", "#soundBtn"] };
    Object.keys(map).forEach(function (k) {
      var p = $(map[k][0]), b = $(map[k][1]);
      var open = k === which && p.hidden;
      p.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
    });
  }

  function soundUi() {
    var on = Snd.isOn();
    $("#soundSwitch").setAttribute("aria-checked", String(on));
    $("#soundState").textContent = on ? "On" : "Off";
    $("#soundBtn").classList.toggle("live", on);
    $("#soundNow").textContent = on ? "Now playing: " + Snd.label() + ". It changes as you scroll." : "Turn it on for sea, street and cafe sounds that change as you scroll.";
  }

  /* ---------- Station cat ---------- */

  function catSvg(mood) {
    var ink = "#23303a", extra = "";
    var eyes = '<circle cx="24" cy="36" r="2.7" fill="' + ink + '"/><circle cx="40" cy="36" r="2.7" fill="' + ink + '"/><circle cx="25" cy="35" r=".9" fill="#fff"/><circle cx="41" cy="35" r=".9" fill="#fff"/>';
    var mouth = '<path d="M27 47 Q32 51 37 47" stroke="' + ink + '" stroke-width="1.7" fill="none" stroke-linecap="round"/>';
    if (mood === "sleepy") {
      eyes = '<path d="M20.5 37 q3.5 3.5 7 0 M36.5 37 q3.5 3.5 7 0" stroke="' + ink + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
      extra = '<text x="47" y="15" font-size="10" fill="#6b8299" font-family="sans-serif" font-weight="700">z</text><text x="54" y="8" font-size="7" fill="#6b8299" font-family="sans-serif" font-weight="700">z</text>';
      mouth = '<path d="M29 47.5 Q32 49 35 47.5" stroke="' + ink + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    } else if (mood === "wide") {
      eyes = '<circle cx="24" cy="36" r="3.8" fill="' + ink + '"/><circle cx="40" cy="36" r="3.8" fill="' + ink + '"/><circle cx="25.4" cy="34.6" r="1.3" fill="#fff"/><circle cx="41.4" cy="34.6" r="1.3" fill="#fff"/>';
      mouth = '<ellipse cx="32" cy="47.5" rx="2" ry="2.4" fill="' + ink + '"/>';
    } else if (mood === "proud") {
      eyes = '<path d="M20.5 38 q3.5 -5 7 0 M36.5 38 q3.5 -5 7 0" stroke="' + ink + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
      extra = '<path d="M53 10 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6Z" fill="#f2c15a"/>';
    } else if (mood === "love") {
      var h = function (x) { return '<path d="M' + x + ' 40 C' + (x - 5) + ' 36.5 ' + (x - 4.5) + ' 32.5 ' + (x - 1.7) + ' 32.5 C' + (x - 0.4) + ' 32.5 ' + x + ' 33.3 ' + x + ' 34 C' + x + ' 33.3 ' + (x + 0.4) + ' 32.5 ' + (x + 1.7) + ' 32.5 C' + (x + 4.5) + ' 32.5 ' + (x + 5) + ' 36.5 ' + x + ' 40Z" fill="#d9472b"/>'; };
      eyes = h(24) + h(40);
    } else if (mood === "curious") {
      eyes = '<circle cx="24" cy="36" r="3" fill="' + ink + '"/><circle cx="40" cy="36" r="3" fill="' + ink + '"/><circle cx="25.2" cy="35" r="1" fill="#fff"/><circle cx="41.2" cy="35" r="1" fill="#fff"/><path d="M19 30 q5 -3 9 0" stroke="#cf8744" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    }
    return '<svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c58a"/><stop offset="1" stop-color="#e8a35c"/></linearGradient></defs>' +
      '<path d="M10 30 L13 8 L29 19Z M54 30 L51 8 L35 19Z" fill="#e8a35c"/><path d="M14 24 L15.2 13 L24 19Z M50 24 L48.8 13 L40 19Z" fill="#f4b9b0"/>' +
      '<circle cx="32" cy="37" r="22" fill="url(#cg)"/><path d="M26 17 v5 M32 15 v6 M38 17 v5" stroke="#cf8744" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="19" cy="43" r="3.6" fill="#f2a9a0" opacity=".55"/><circle cx="45" cy="43" r="3.6" fill="#f2a9a0" opacity=".55"/>' +
      eyes + '<path d="M30 42 l2 2.2 l2 -2.2Z" fill="#c8553d"/>' + mouth +
      '<path d="M9 41 H19 M9 47 L19 45 M55 41 H45 M55 47 L45 45" stroke="' + ink + '" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>' + extra + '</svg>';
  }

  var Cat = {
    moods: { top: "happy", street: "curious", cafe: "sleepy", seaside: "wide", travelers: "happy", postcards: "happy", billboard: "proud", albums: "curious" },
    lines: {
      top: ["Mrrp. Welcome aboard.", "The polaroids swing because I walked past. Probably.", "Tap a photo to peek inside."],
      street: ["Fresh film! Scroll sideways.", "Every frame has a date stamp. I checked.", "Mind the crosswalk."],
      cafe: ["The Hall of Fame smells like coffee.", "I sit here when nobody is looking.", "Legends only past this point."],
      seaside: ["Salty air. Excellent.", "Big prints, big memories.", "I saw a fish. It saw me."],
      travelers: ["These are the humans in charge.", "Ask them about the detours."],
      postcards: ["Somebody said these out loud.", "I would send one, but no thumbs."],
      billboard: ["The big screen shows our best photos.", "Press pause if you want to stare at one."],
      albums: ["Folders! I like folders. I sit in them.", "Looking for someone? Try search.", "Try tapping a tag."]
    },
    pets: parseInt(store.get("mafaru-pets"), 10) || 0, seen: {}, last: 0, timer: null, mood: "happy",
    petLines: ["Purr...", "Prrrr.", "Mrrp!", "Right behind the ears.", "Okay, one more.", "That is the spot."],
    milestones: { 5: "5 pets. We are acquaintances now.", 10: "10 pets. We are friends.", 25: "25 pets. I would follow you home.", 50: "50 pets. I am yours.", 100: "100 pets. Legend." },
    set: function (m) { Cat.mood = m; $("#catFace").innerHTML = catSvg(m); },
    say: function (t, ms) {
      var b = $("#catBubble"); b.textContent = t; b.hidden = false;
      clearTimeout(Cat.timer); Cat.timer = setTimeout(function () { b.hidden = true; }, ms || 4800);
      Cat.last = Date.now();
    },
    area: function (a) {
      var night = document.documentElement.getAttribute("data-theme") === "night";
      Cat.set(night ? "sleepy" : (Cat.moods[a] || "happy"));
      if (!Cat.seen[a] && Date.now() - Cat.last > 6000 && Cat.lines[a] && !$("#cat").hidden) {
        Cat.seen[a] = 1;
        var arr = Cat.lines[a].slice();
        var extra = state.settings.guardLines;
        if (Array.isArray(extra) && extra.length && Math.random() < 0.3) arr = extra;
        Cat.say(arr[Math.floor(Math.random() * arr.length)]);
      }
    },
    pet: function () {
      Cat.pets++; store.set("mafaru-pets", String(Cat.pets));
      var btn = $("#catBtn"); btn.classList.remove("petted"); void btn.offsetWidth; btn.classList.add("petted");
      Cat.set("love");
      var hearts = $("#hearts"), el = document.createElement("i");
      el.style.left = (20 + Math.random() * 60) + "%";
      hearts.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
      var line = Cat.milestones[Cat.pets] || Cat.petLines[Math.floor(Math.random() * Cat.petLines.length)];
      Cat.say(line, 2800);
      clearTimeout(Cat.petTimer);
      Cat.petTimer = setTimeout(function () { Cat.area(state.area); }, 1800);
    }
  };

  /* ---------- Where am I on the page ---------- */

  var AREAS = ["top", "street", "cafe", "seaside", "travelers", "postcards", "billboard", "albums"];
  var ticking = false;

  function currentArea() {
    var mid = window.innerHeight * 0.42;
    for (var i = 0; i < AREAS.length; i++) {
      var el = document.getElementById(AREAS[i]);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) return AREAS[i];
    }
    return null;
  }

  function setArea(a) {
    state.area = a;
    $$("#nav a").forEach(function (l) {
      var on = l.dataset.s === a;
      l.classList.toggle("on", on);
      if (on) l.setAttribute("aria-current", "true"); else l.removeAttribute("aria-current");
    });
    var act = $("#nav a.on");
    if (act && act.scrollIntoView && window.innerWidth < 900) { try { $("#nav").scrollTo({ left: act.offsetLeft - 40, behavior: "smooth" }); } catch (x) {} }
    Snd.setScene(a);
    if (Snd.isOn()) soundUi();
    Cat.area(a);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var a = currentArea();
      if (a && a !== state.area) setArea(a);
    });
  }

  /* ---------- Reveal on scroll ---------- */

  var revealIO = null;
  function observeReveal(root) {
    var els = $$(".reveal", root);
    if (!("IntersectionObserver" in window)) { els.forEach(function (el) { el.classList.add("in"); }); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("in"); revealIO.unobserve(en.target); }
        });
      }, { threshold: 0.1, rootMargin: "0px 0px -5% 0px" });
    }
    els.forEach(function (el, i) {
      el.style.transitionDelay = (i % 6) * 0.06 + "s";
      if (!el.classList.contains("in")) revealIO.observe(el);
    });
  }

  /* ---------- Events ---------- */

  function typing(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  function swipe(el, onLeft, onRight) {
    var x0 = null;
    el.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener("touchend", function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) { if (dx < 0) onLeft(); else onRight(); }
    });
  }

  function setupEvents() {
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var btn = t.closest(".pol-btn, .f35-btn, .print-btn");
      if (btn) {
        var fig = btn.closest("[data-k]");
        if (fig) openMemory(Number(fig.dataset.k), btn.closest("#sGrid") ? state.sheetItems : null);
        return;
      }
      var res = t.closest(".res");
      if (res) { openMemory(Number(res.dataset.k), state.results); return; }
      var col = t.closest("[data-kind][data-key]");
      if (col) {
        if (col.closest("#mChips")) closeMemory();
        openSheet(col.dataset.kind, col.dataset.key);
        return;
      }
      var qc = t.closest(".qchip");
      if (qc) { $("#q").value = qc.dataset.q; runSearch(); $("#q").focus(); return; }
      var fc = t.closest(".fchip");
      if (fc) { state.qWing = fc.dataset.w; buildFilters(); runSearch(); return; }
      var th = t.closest(".bb-thumb");
      if (th) { showSlide(Number(th.dataset.i)); bbSchedule(); return; }
      if (t.closest("#bbOpen")) { openMemory(bb.items[bb.i]._k, bb.items); return; }
      if (t.closest("#bbPause")) { bb.paused = !bb.paused; showSlide(bb.i, true); bbSchedule(); return; }
      var look = t.closest(".look");
      if (look) { setTheme(look.dataset.theme); return; }
      if (!t.closest("#dock")) togglePop(null);
    });

    $("#tabGroups").addEventListener("click", function () { setTab("groups"); });
    $("#tabTags").addEventListener("click", function () { setTab("tags"); });

    $("#modalClose").addEventListener("click", closeMemory);
    $("#modalBack").addEventListener("click", closeMemory);
    $("#mNext").addEventListener("click", function () { step(1); });
    $("#mPrev").addEventListener("click", function () { step(-1); });
    $("#mZoom").addEventListener("click", function () { setZoom(!$("#finderFrame").classList.contains("zoomed")); });
    $("#mImg").addEventListener("click", function () { setZoom(!$("#finderFrame").classList.contains("zoomed")); });
    $("#mCopy").addEventListener("click", copyLink);
    swipe($("#finderFrame"), function () { if (!$("#finderFrame").classList.contains("zoomed")) step(1); }, function () { if (!$("#finderFrame").classList.contains("zoomed")) step(-1); });

    $("#sheetClose").addEventListener("click", closeSheet);
    $("#sheetBack").addEventListener("click", closeSheet);

    $("#searchBtn").addEventListener("click", function () { openSearch(); });
    $("#heroSearch").addEventListener("click", function () { openSearch(); });
    $("#searchClose").addEventListener("click", closeSearch);
    $("#searchBack").addEventListener("click", closeSearch);
    $("#q").addEventListener("input", runSearch);
    $("#q").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && state.results.length) openMemory(state.results[0]._k, state.results);
    });

    $("#randomBtn").addEventListener("click", function () {
      var pool = visibleList();
      if (pool.length) openMemory(pool[Math.floor(Math.random() * pool.length)]._k);
    });

    $("#bbPrev").addEventListener("click", function () { showSlide(bb.i - 1); bbSchedule(); });
    $("#bbNext").addEventListener("click", function () { showSlide(bb.i + 1); bbSchedule(); });
    swipe($("#bbScreen"), function () { showSlide(bb.i + 1); bbSchedule(); }, function () { showSlide(bb.i - 1); bbSchedule(); });
    $("#bbScreen").addEventListener("click", function () { if (bb.items.length) openMemory(bb.items[bb.i]._k, bb.items); });
    var bbEl = $("#bb");
    bbEl.addEventListener("mouseenter", function () { bb.hover = true; bbSchedule(); });
    bbEl.addEventListener("mouseleave", function () { bb.hover = false; bbSchedule(); });
    bbEl.addEventListener("focusin", function () { bb.hover = true; bbSchedule(); });
    bbEl.addEventListener("focusout", function () { bb.hover = false; bbSchedule(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { bb.inView = en[0].isIntersecting; bbSchedule(); }, { threshold: 0.25 }).observe(bbEl);
    } else { bb.inView = true; }

    $("#lookBtn").addEventListener("click", function () { togglePop("look"); });
    $("#soundBtn").addEventListener("click", function () { togglePop("sound"); });
    $("#soundSwitch").addEventListener("click", function () { Snd.setOn(!Snd.isOn()); soundUi(); });
    $("#vol").addEventListener("input", function () { Snd.setVol(Number(this.value) / 100); store.set("mafaru-vol", this.value); });
    var sv = store.get("mafaru-vol"); if (sv != null && sv !== "") { $("#vol").value = sv; Snd.setVol(Number(sv) / 100); }

    $("#catBtn").addEventListener("click", Cat.pet);
    $("#catToggle").addEventListener("change", function () {
      $("#cat").hidden = !this.checked;
      store.set("mafaru-cat", this.checked ? "on" : "off");
    });
    if (store.get("mafaru-cat") === "off") { $("#cat").hidden = true; $("#catToggle").checked = false; }

    $("#noticeClose").addEventListener("click", function () { $("#notice").hidden = true; });

    document.addEventListener("keydown", function (ev) {
      var modalOpen = !$("#modal").hidden;
      if (ev.key === "Escape") {
        if (modalOpen) closeMemory();
        else if (!$("#search").hidden) closeSearch();
        else if (!$("#sheet").hidden) closeSheet();
        else togglePop(null);
        return;
      }
      if (modalOpen) {
        if (ev.key === "ArrowRight") step(1);
        if (ev.key === "ArrowLeft") step(-1);
        return;
      }
      if ((ev.key === "/" && !typing(ev.target)) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k")) {
        ev.preventDefault(); openSearch(); return;
      }
      if (bbEl.contains(document.activeElement) && !typing(ev.target)) {
        if (ev.key === "ArrowRight") { showSlide(bb.i + 1); bbSchedule(); }
        if (ev.key === "ArrowLeft") { showSlide(bb.i - 1); bbSchedule(); }
      }
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

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

  function openFromHash() {
    var m = location.hash.match(/^#memory=(.+)$/);
    if (!m) return;
    var id; try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; }
    var e = state.exhibits.filter(function (x) { return x._id === id; })[0];
    if (e) openMemory(e._k);
  }

  /* ---------- Start ---------- */

  async function init() {
    document.documentElement.classList.add("js");
    buildStars();
    setupPetals();
    Cat.set("happy");
    setupEvents();
    setTheme(store.get("mafaru-theme") || "day");
    soundUi();

    var r = await Promise.all([load("settings"), load("exhibits"), load("portraits"), load("quotes"), load("groups", true)]);
    state.settings = isObj(r[0]) ? r[0] : {};
    state.groupsMeta = asList(r[4], "groups");
    state.exhibits = prepare(asList(r[1], "exhibits"));
    var people = asList(r[2], "portraits").filter(isObj);
    var quotes = asList(r[3], "quotes").filter(isObj);

    try {
      buildCollections();
      renderSettings(state.settings, people);
      renderHero();
      renderWalls();
      renderBillboard();
      renderAlbums();
      renderPeople(people);
      renderQuotes(quotes);
      setTab("groups");
      observeReveal(document);
    } catch (err) {
      console.error(err);
      problems.push("Something in your data looked unexpected (" + err.message + "). Re-save the latest change in Pages CMS or undo it on GitHub.");
    }
    showProblems();
    onScroll();
    openFromHash();
  }

  init();
})();
