/* AI Proved What? — Connections map.
   Draws results, OpenAI papers, cited works and their authors from
   data/connections.json (built by tools/site/connections.py) on one canvas.
   Node rows: [kind, x, y, label, ...]; kind 0 result [.., subject, slug],
   1 paper [.., subject, url], 2 work [.., year, link, citedBy], 3 author.
   Links are flat triples [a, b, type]: 0 result-paper, 1 paper-work,
   2 paper cites another OpenAI paper, 3 work-author, 4 our own relation
   between results (data.relations). data.meta[num] carries each result's
   page, episode, record, revisions and earlier versions; Specials sit on
   their own arc (subject index data.specials_subject). */
(function () {
  "use strict";
  var canvas = document.getElementById("cx-map");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var tip = document.getElementById("cx-tip");
  var panel = document.getElementById("cx-panel");
  var q = document.getElementById("cx-q");
  var hits = document.getElementById("cx-hits");
  var minIn = document.getElementById("cx-min"), minOut = document.getElementById("cx-min-out");
  var showW = document.getElementById("cx-l2"), showA = document.getElementById("cx-l3"), showE = document.getElementById("cx-le");
  var showS = document.getElementById("cx-sp"), showSel = document.getElementById("cx-show");

  var C = { paper: "#ece9e1", soft: "#cdcac2", dim: "#9aa0aa", blue: "#58c4dd", gold: "#ffd84d", red: "#fc6255", green: "#83c167", bg: "#0a0d12" };
  var meta = {}, rels = [], spSubj = null, special, numOf, match = null, labs = {};
  // Tints for results outside OpenAI's catalogue, by lab.
  var LAB = { openai: "#fc6255", axiom: "#c58af9", psi: "#f4a261", anthropic: "#e8a0bf" };
  function labOf(i) { var m = meta[numOf[i]]; return m && m.lab ? m.lab : "openai"; }
  var KIND = ["Result", "Paper", "Cited work", "Author"];
  var N, kind, X, Y, nodes, subjects, subjColor = [], links, adj, wMaxCite, visible;
  var view = { s: 1, ox: 0, oy: 0 }, W = 0, H = 0, dpr = 1, fitS = 1;
  var sel = -1, hl = null, hlEdges = null, hover = -1, minCite = 1, frame = 0;
  var grid = new Map(), CELL = 0.01;
  var narrow = false, coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  function subjectColour(i) {
    if (i === spSubj) return C.red;
    var n = subjects.length, h = ((i * 7) % n) * 360 / n;
    return "hsl(" + h.toFixed(0) + ",72%,64%)";
  }
  function fold(s) {
    return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function fmt(n) { return n.toLocaleString("en-US"); }

  fetch("../data/connections.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(init).catch(function () {
    panel.innerHTML = '<p class="meta">The map data did not load. Reload the page to try again.</p>';
  });

  function init(data) {
    nodes = data.nodes; subjects = data.subjects; links = data.links;
    meta = data.meta || {}; rels = data.relations || []; labs = data.labs || {};
    spSubj = data.specials_subject === undefined ? null : data.specials_subject;
    N = nodes.length;
    kind = new Uint8Array(N); X = new Float32Array(N); Y = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      kind[i] = nodes[i][0]; X[i] = nodes[i][1]; Y[i] = -nodes[i][2];
      var key = Math.floor(X[i] / CELL) * 100003 + Math.floor(Y[i] / CELL);
      var b = grid.get(key); if (b) b.push(i); else grid.set(key, [i]);
    }
    for (var s = 0; s < subjects.length; s++) subjColor.push(subjectColour(s));
    if (spSubj !== null) subjColor[spSubj] = C.red;
    adj = []; for (i = 0; i < N; i++) adj.push([]);
    for (var e = 0; e < links.length; e += 3) { adj[links[e]].push(e); adj[links[e + 1]].push(e); }
    // Special results and their papers; each result's number, for the record filter.
    special = new Uint8Array(N); numOf = new Array(N);
    for (i = 0; i < N; i++) if (kind[i] === 0) {
      numOf[i] = nodes[i][3].split(".")[0];
      if (spSubj !== null && nodes[i][4] === spSubj) {
        special[i] = 1;
        adj[i].forEach(function (e) { if (links[e + 2] === 0) special[links[e] === i ? links[e + 1] : links[e]] = 1; });
      }
    }
    wMaxCite = new Uint16Array(N);
    for (i = 0; i < N; i++) if (kind[i] === 2) wMaxCite[i] = nodes[i][6];
    for (e = 0; e < links.length; e += 3) if (links[e + 2] === 3) {
      var w = links[e], a = links[e + 1];
      if (wMaxCite[w] > wMaxCite[a]) wMaxCite[a] = wMaxCite[w];
    }
    visible = new Uint8Array(N);
    var counts = subjects.map(function () { return 0; });
    var nSp = 0;
    for (i = 0; i < N; i++) if (kind[i] === 0) { if (special[i]) nSp++; else counts[nodes[i][4]]++; }
    document.querySelector(".cx-stage").insertAdjacentHTML("afterend", '<ul class="cx-subjects" aria-label="Subject colours">' +
      subjects.map(function (s, k) { return '<li><span class="cx-sw" style="background:' + subjColor[k] + '"></span>' + esc(s) + " (" + counts[k] + ")</li>"; }).join("") +
      "</ul>" + (nSp ? '<ul class="cx-labs" aria-label="Beyond OpenAI’s catalogue, by lab">' + spLegend() + "</ul>" : ""));
    document.querySelector(".cx-stage").insertAdjacentHTML("beforeend", '<button type="button" class="cx-reset">Reset view</button>');
    document.querySelector(".cx-reset").addEventListener("click", function () { clearSel(); tip.hidden = true; reset(); });
    if (coarse) document.querySelector(".cx-hint").textContent = "Pinch to zoom, drag to move, tap a dot to see its connections. Double-tap to reset.";
    applyFilters();
    topList();
    resize();
    window.addEventListener("resize", resize);
    function fromHash() {
      if (!/^#(\d{3}|[A-Z]{1,3}\d\d)$/.test(location.hash)) return;
      var want = location.hash.slice(1) + ".";
      for (var j = 0; j < N; j++) if (kind[j] === 0 && nodes[j][3].indexOf(want) === 0) { select(j, true); break; }
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
  }

  function spLegend() {
    var n = {};
    for (var i = 0; i < N; i++) if (kind[i] === 0 && special[i]) { var l = labOf(i); n[l] = (n[l] || 0) + 1; }
    return Object.keys(n).map(function (l) {
      var name = l === "openai" ? "OpenAI, outside its catalogue" : (labs[l] || l);
      return '<li><span class="cx-sw" style="background:' + (LAB[l] || C.red) + ';outline:1px dashed ' + C.red + ';outline-offset:2px"></span>Beyond OpenAI: ' + esc(name) + " (" + n[l] + ")</li>";
    }).join("");
  }
  function applyFilters() {
    minCite = +minIn.value; minOut.textContent = minCite;
    for (var i = 0; i < N; i++) {
      var k = kind[i];
      visible[i] = k < 2 ? (special[i] && !showS.checked ? 0 : 1) : k === 2 ? (showW.checked && nodes[i][6] >= minCite ? 1 : 0) : (showA.checked && wMaxCite[i] >= minCite ? 1 : 0);
    }
    recordFilter();
    draw();
  }
  // "Show": keep results matching a record filter bright, with their papers, the works
  // those papers cite and the authors of those works; dim everything else.
  function wants(i) {
    var m = meta[numOf[i]] || {}, f = showSel.value;
    if (f === "lean") return m.lean === "main" || m.lean === "partial";
    if (f === "review") return !!m.review;
    if (f === "special") return !!m.special;
    if (f === "revised") return !!m.rev;
    if (f === "coming") return !m.ep;
    return true;
  }
  function recordFilter() {
    if (!showSel.value) { match = null; return; }
    match = new Uint8Array(N);
    for (var i = 0; i < N; i++) if (kind[i] === 0 && wants(i)) {
      match[i] = 1;
      nb(i, 0).forEach(function (p) {
        match[p[0]] = 1;
        nb(p[0], 1).forEach(function (w) { match[w[0]] = 1; nb(w[0], 3).forEach(function (a) { match[a[0]] = 1; }); });
      });
    }
  }
  [minIn, showW, showA, showE, showS, showSel].forEach(function (el) { el.addEventListener("input", applyFilters); el.addEventListener("change", applyFilters); });

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    narrow = W < 640;
    fitS = narrow ? Math.min(W, H) * 0.47 : Math.min(W * 0.62, H * 0.86) / 2;
    if (!view.set) reset(); else draw();
  }
  function reset() { view = { s: fitS, ox: W / 2, oy: H / 2, set: true }; draw(); }
  function sx(i) { return X[i] * view.s + view.ox; }
  function sy(i) { return Y[i] * view.s + view.oy; }

  function draw() {
    if (frame) return;
    frame = requestAnimationFrame(paint);
  }
  function radius(i) {
    var z = Math.min(3, Math.sqrt(view.s / fitS)) * Math.max(0.55, Math.min(1, fitS / 380)), k = kind[i];
    if (k === 0) return 4.2 * Math.max(1, z * 0.8);
    if (k === 1) return 2.3 * z;
    if (k === 2) return (1.05 + 0.55 * Math.sqrt(Math.min(nodes[i][6], 40) - 1)) * z;
    return 0.95 * z;
  }
  function colour(i) {
    var k = kind[i];
    return k === 0 ? (special[i] ? (LAB[labOf(i)] || C.red) : subjColor[nodes[i][4]]) : k === 1 ? C.paper : k === 2 ? C.blue : C.red;
  }

  function paint() {
    frame = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var dimAll = hl !== null, filt = match && !dimAll;
    specialsArc();
    // lines
    if (showE.checked) {
      var styles = ["rgba(236,233,225,0.45)", "rgba(88,196,221,0.05)", "rgba(255,216,77,0.55)", "rgba(252,98,85,0.045)", "rgba(131,193,103,0.85)"];
      if (dimAll || filt) styles = ["rgba(236,233,225,0.12)", "rgba(88,196,221,0.015)", "rgba(255,216,77,0.12)", "rgba(252,98,85,0.012)", "rgba(131,193,103,0.25)"];
      for (var pass = 0; pass < (filt ? 2 : 1); pass++) {
        if (pass === 1) styles = ["rgba(236,233,225,0.55)", "rgba(88,196,221,0.12)", "rgba(255,216,77,0.7)", "rgba(252,98,85,0.08)", "rgba(131,193,103,0.9)"];
        for (var t = 0; t < 5; t++) {
          ctx.beginPath();
          for (var e = 0; e < links.length; e += 3) {
            if (links[e + 2] !== t) continue;
            var a = links[e], b = links[e + 1];
            if (!visible[a] || !visible[b]) continue;
            if (pass === 1 && !(match[a] && match[b])) continue;
            ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b));
          }
          ctx.setLineDash(t === 4 ? [5, 4] : []);
          ctx.strokeStyle = styles[t]; ctx.lineWidth = t === 4 ? 1.6 : t === 2 ? 0.8 : 0.6; ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
    if (dimAll) {
      var hs = ["rgba(236,233,225,0.8)", "rgba(88,196,221,0.45)", "rgba(255,216,77,0.9)", "rgba(252,98,85,0.35)", "rgba(131,193,103,1)"];
      for (t = 0; t < 5; t++) {
        ctx.beginPath();
        hlEdges.forEach(function (e) {
          if (links[e + 2] !== t) return;
          var a = links[e], b = links[e + 1];
          if (!visible[a] || !visible[b]) return;
          ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b));
        });
        ctx.setLineDash(t === 4 ? [5, 4] : []);
        ctx.strokeStyle = hs[t]; ctx.lineWidth = t === 4 ? 2 : t === 2 ? 1.4 : 0.9; ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // dots, back to front: authors, works, papers, results
    var order = [3, 2, 1, 0];
    for (var o = 0; o < 4; o++) {
      var k = order[o];
      var base = dimAll ? (k < 2 ? 0.35 : 0.18) : (k === 3 ? 0.55 : k === 2 ? 0.7 : 1);
      ctx.globalAlpha = base;
      for (var i = 0; i < N; i++) {
        if (kind[i] !== k || !visible[i]) continue;
        if (filt) ctx.globalAlpha = match[i] ? base : base * 0.12;
        var x = sx(i), y = sy(i);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        var r = radius(i);
        ctx.fillStyle = colour(i);
        if (r < 1.6) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        else { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
    if (dimAll) {
      hl.forEach(function (i) {
        if (!visible[i]) return;
        var r = radius(i) * 1.25;
        ctx.fillStyle = colour(i); ctx.beginPath(); ctx.arc(sx(i), sy(i), Math.max(r, 1.6), 0, 6.2832); ctx.fill();
      });
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(sel), sy(sel), radius(sel) * 1.25 + 4, 0, 6.2832); ctx.stroke();
    }
    if (hover >= 0) {
      ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(hover), sy(hover), radius(hover) + 3, 0, 6.2832); ctx.stroke();
    }
    labels();
  }

  // The Specials arc: a dashed red outline just outside the special results.
  function specialsArc() {
    if (spSubj === null || !showS.checked) return;
    var a0 = null, a1 = null;
    for (var i = 0; i < N; i++) if (kind[i] === 0 && special[i]) {
      var a = Math.atan2(Y[i], X[i]);
      if (a0 === null || a < a0) a0 = a;
      if (a1 === null || a > a1) a1 = a;
    }
    if (a0 === null) return;
    var pad = 0.06, r1 = 1.025 * view.s, r0 = 0.9 * view.s, b0 = a0 - pad, b1 = a1 + pad;
    ctx.save();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(view.ox, view.oy, r1, b0, b1);
    ctx.lineTo(view.ox + Math.cos(b1) * r0, view.oy + Math.sin(b1) * r0);
    ctx.arc(view.ox, view.oy, r0, b1, b0, true);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  function labels() {
    ctx.font = "12px 'STIX Two Text', 'Times New Roman', serif";
    ctx.textBaseline = "middle";
    // subject names around the outside
    var zoomed = view.s / fitS;
    var mids = {};
    if (narrow && zoomed < 1.6) mids = null;
    for (var i = 0; i < N; i++) if (kind[i] === 0 && mids) {
      var s = nodes[i][4], m = mids[s] || (mids[s] = { x: 0, y: 0, n: 0 });
      m.x += X[i]; m.y += Y[i]; m.n++;
    }
    ctx.fillStyle = C.soft;
    if (mids) Object.keys(mids).forEach(function (s) {
      var m = mids[s], ang = Math.atan2(m.y / m.n, m.x / m.n), r = 1.05;
      var x = Math.cos(ang) * r * view.s + view.ox, y = Math.sin(ang) * r * view.s + view.oy;
      if (x < 0 || y < 0 || x > W || y > H) return;
      ctx.fillStyle = subjColor[s];
      ctx.textAlign = Math.cos(ang) > 0.25 ? "left" : Math.cos(ang) < -0.25 ? "right" : "center";
      if (+s === spSubj) {
        if (!showS.checked) return;
        x = Math.cos(ang) * 1.13 * view.s + view.ox; y = Math.sin(ang) * 1.13 * view.s + view.oy;
        ctx.fillText("Beyond OpenAI (" + m.n + ")", x, y); return;
      }
      ctx.fillText(subjects[s] + " (" + m.n + ")", x, y);
    });
    // result numbers once zoomed in, or for the highlighted results
    ctx.fillStyle = C.paper; ctx.textAlign = "center";
    for (i = 0; i < N; i++) {
      if (kind[i] !== 0) continue;
      if (!(zoomed > 2.4 || (hl && hl.has(i)))) continue;
      var ang2 = Math.atan2(Y[i], X[i]), x2 = sx(i) + Math.cos(ang2) * 12, y2 = sy(i) + Math.sin(ang2) * 12;
      if (x2 < 0 || y2 < 0 || x2 > W || y2 > H) continue;
      ctx.fillText(numOf[i], x2, y2);
    }
  }

  // ---------- hit testing and pointer handling
  function nearest(px, py) {
    var wx = (px - view.ox) / view.s, wy = (py - view.oy) / view.s, rad = (coarse ? 16 : 9) / view.s;
    var best = -1, bd = Infinity, c = Math.ceil(rad / CELL);
    var gx = Math.floor(wx / CELL), gy = Math.floor(wy / CELL);
    for (var dx = -c; dx <= c; dx++) for (var dy = -c; dy <= c; dy++) {
      var b = grid.get((gx + dx) * 100003 + (gy + dy));
      if (!b) continue;
      for (var j = 0; j < b.length; j++) {
        var i = b[j];
        if (!visible[i]) continue;
        var d = (X[i] - wx) * (X[i] - wx) + (Y[i] - wy) * (Y[i] - wy);
        var pr = (radius(i) + 5) / view.s;
        d -= kind[i] < 2 ? pr * pr * 0.5 : 0;
        if (d < bd && d < rad * rad) { bd = d; best = i; }
      }
    }
    return best;
  }
  var pointers = new Map(), down = null, pinch = null, lastTap = null;
  canvas.addEventListener("pointerdown", function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (pointers.size === 1) down = { x: ev.offsetX, y: ev.offsetY, ox: view.ox, oy: view.oy, moved: false };
    if (pointers.size === 2) {
      var p = Array.from(pointers.values());
      pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s: view.s, ox: view.ox, oy: view.oy, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
      down = null;
    }
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (pinch && pointers.size === 2) {
      var p = Array.from(pointers.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      zoomTo(pinch.s * d / pinch.d, pinch.cx, pinch.cy, pinch);
      return;
    }
    if (down) {
      var dx = ev.offsetX - down.x, dy = ev.offsetY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { down.moved = true; canvas.classList.add("dragging"); }
      if (down.moved) { view.ox = down.ox + dx; view.oy = down.oy + dy; tip.hidden = true; draw(); return; }
    }
    if (ev.pointerType === "mouse") {
      var h = nearest(ev.offsetX, ev.offsetY);
      if (h !== hover) { hover = h; draw(); }
      if (h >= 0) showTip(h, ev.offsetX, ev.offsetY); else tip.hidden = true;
    }
  });
  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    canvas.classList.remove("dragging");
    if (pointers.size < 2) pinch = null;
    if (down && !down.moved && ev.type === "pointerup" && ev.pointerType !== "mouse") {
      var now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.abs(ev.offsetX - lastTap.x) + Math.abs(ev.offsetY - lastTap.y) < 30) {
        lastTap = null; down = null; clearSel(); tip.hidden = true; reset(); return;
      }
      lastTap = { t: now, x: ev.offsetX, y: ev.offsetY };
    }
    if (down && !down.moved && ev.type === "pointerup") {
      var h = nearest(ev.offsetX, ev.offsetY);
      if (h >= 0) { select(h, false); if (ev.pointerType !== "mouse") showTip(h, ev.offsetX, ev.offsetY, true); }
      else { clearSel(); tip.hidden = true; }
    }
    if (pointers.size === 0) down = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", function () { if (hover >= 0) { hover = -1; draw(); } tip.hidden = true; });
  canvas.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    zoomTo(view.s * Math.exp(-ev.deltaY * 0.0015), ev.offsetX, ev.offsetY, view);
  }, { passive: false });
  canvas.addEventListener("dblclick", function () { clearSel(); reset(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { clearSel(); hits.hidden = true; } });
  function zoomTo(s, cx, cy, from) {
    s = Math.max(fitS * 0.6, Math.min(fitS * 60, s));
    var wx = (cx - from.ox) / from.s, wy = (cy - from.oy) / from.s;
    view.ox = cx - wx * s; view.oy = cy - wy * s; view.s = s;
    draw();
  }
  function showTip(i, x, y, tapped) {
    var t = nodes[i][3];
    if (t.length > 150) t = t.slice(0, 147) + "…";
    var extra = kind[i] === 2 ? (nodes[i][4] ? " (" + nodes[i][4] + ")" : "") + " · cited by " + nodes[i][6] + " paper" + (nodes[i][6] > 1 ? "s" : "") : kind[i] === 0 ? " · " + (special[i] ? "Beyond OpenAI: " + ((meta[numOf[i]] || {}).lab_label || "") : subjects[nodes[i][4]]) : "";
    tip.textContent = KIND[kind[i]] + ": " + t + extra + (tapped ? " · details below the map" : "");
    tip.hidden = false;
    var left = Math.min(x + 14, W - tip.offsetWidth - 8), top = y + 14;
    if (top + tip.offsetHeight > H - 4) top = y - tip.offsetHeight - 10;
    tip.style.left = Math.max(4, left) + "px"; tip.style.top = Math.max(4, top) + "px";
  }

  // ---------- selection
  function nb(i, type) {
    var out = [];
    adj[i].forEach(function (e) { if (links[e + 2] === type) out.push([links[e] === i ? links[e + 1] : links[e], e]); });
    return out;
  }
  function collect(i) {
    var nodesSet = new Set([i]), edges = new Set();
    function addAll(list) { list.forEach(function (p) { nodesSet.add(p[0]); edges.add(p[1]); }); return list.map(function (p) { return p[0]; }); }
    var k = kind[i], R = [], P = [], Wk = [], A = [];
    if (k === 0) { R = [i]; P = addAll(nb(i, 0)); }
    if (k === 1) { P = [i]; R = addAll(nb(i, 0)); }
    if (k === 2) { Wk = [i]; P = addAll(nb(i, 1)); P.forEach(function (p) { R = R.concat(addAll(nb(p, 0))); }); A = addAll(nb(i, 3)); }
    if (k === 3) {
      A = [i]; Wk = addAll(nb(i, 3));
      Wk.forEach(function (w) { addAll(nb(w, 1)).forEach(function (p) { P.push(p); R = R.concat(addAll(nb(p, 0))); }); });
    }
    if (k <= 1) {
      P.forEach(function (p) {
        Wk = Wk.concat(addAll(nb(p, 1)));
        nb(p, 2).forEach(function (q) { nodesSet.add(q[0]); edges.add(q[1]); addAll(nb(q[0], 0)); });
      });
      Wk.forEach(function (w) { addAll(nb(w, 3)); });
    }
    return { set: nodesSet, edges: edges, R: R, P: P, W: Wk, A: A };
  }
  function clearSel() { sel = -1; hl = null; hlEdges = null; draw(); }
  function select(i, centre) {
    var c = collect(i);
    sel = i; hl = c.set; hlEdges = c.edges;
    if (centre) {
      if (kind[i] === 0) { view.s = fitS; view.ox = W / 2; view.oy = H / 2; }
      else {
        var s = Math.max(view.s, fitS * 2.2);
        view.s = s; view.ox = W / 2 - X[i] * s; view.oy = H / 2 - Y[i] * s;
      }
    }
    if (kind[i] >= 2 && !visible[i]) { minIn.value = 1; showW.checked = true; showA.checked = true; applyFilters(); }
    draw();
    describe(i, c);
    var tag = kind[i] === 0 ? "#" + numOf[i] : "";
    if (history.replaceState && location.hash !== tag) history.replaceState(null, "", tag || location.pathname);
  }
  function go(i, text) {
    return '<button type="button" class="cx-go" data-i="' + i + '">' + esc(text) + "</button>";
  }
  function uniq(a) { return Array.from(new Set(a)); }
  function workItem(w) {
    var n = nodes[w], ext = n[5] ? ' <a class="cx-ext" href="' + esc(n[5]) + '" rel="noopener">' + (n[5].indexOf("arxiv.org") > 0 ? "arXiv" : "DOI") + "</a>" : "";
    return "<li>" + go(w, n[3]) + (n[4] ? " (" + n[4] + ")" : "") + ext +
      ' <span class="meta">cited by ' + n[6] + (n[6] > 1 ? " OpenAI papers" : " OpenAI paper") + "</span></li>";
  }
  function citedLists(works) {
    // works: this result's or paper's cited works. Lists every work, then every author of those works.
    works = uniq(works).sort(function (a, b) { return nodes[b][6] - nodes[a][6] || (nodes[a][4] || 9999) - (nodes[b][4] || 9999); });
    var count = new Map();
    works.forEach(function (w) { nb(w, 3).forEach(function (a) { count.set(a[0], (count.get(a[0]) || 0) + 1); }); });
    var authors = Array.from(count.entries()).sort(function (a, b) {
      return b[1] - a[1] || (nodes[a[0]][3].split(". ").pop() < nodes[b[0]][3].split(". ").pop() ? -1 : 1);
    });
    var h = '<details class="cx-list"><summary>Cited works (' + works.length + ")</summary>" +
      '<p class="meta">Most widely cited across the release first. Click a title to see who else cites it.</p><ol>' + works.map(workItem).join("") + "</ol></details>";
    h += '<details class="cx-list"><summary>Authors of those works (' + authors.length + ")</summary>" +
      '<p class="meta">Most works in this list first; the number in brackets counts them.</p><p class="cx-authors">' +
      authors.map(function (a) { return go(a[0], nodes[a[0]][3]) + (a[1] > 1 ? ' <span class="meta">(' + a[1] + ")</span>" : ""); }).join(", ") + "</p></details>";
    return h;
  }
  function relHtml(i) {
    var out = rels.filter(function (r) { return r.a === i || r.b === i; }).map(function (r) {
      var other = r.a === i ? r.b : r.a;
      var REV = { "implies": "implied by", "implies part of": "partly implied by", "relies on": "relied on by", "cites": "cited by", "builds on": "built on by" };
      var verb = r.a === i ? r.type : (REV[r.type] || r.type);
      var cites = (r.cites || []).map(function (u, k) { return '<a class="cx-ext" href="' + esc(u) + '" rel="noopener">source line' + (r.cites.length > 1 ? " " + (k + 1) : "") + "</a>"; }).join(" ");
      return "<li>" + esc(verb.charAt(0).toUpperCase() + verb.slice(1)) + " " + go(other, nodes[other][3]) +
        (r.label ? '<br><span class="meta">' + esc(r.label) + "</span>" : "") + '<br><span class="meta">' + esc(r.note) + "</span>" + (cites ? " " + cites : "") + "</li>";
    });
    return out.length ? '<div class="cx-rel"><h3>Linked results</h3><p class="meta">Our own reading of the papers, not the labs’ data.</p><ul>' + out.join("") + "</ul></div>" : "";
  }
  function recordHtml(i, m) {
    var h = '<p class="meta">';
    h += m.ep ? '<a href="../' + esc(m.page) + '">Episode</a>' : '<a href="../' + esc(m.page) + '">Episode coming</a>';
    h += m.lean === "main" ? " · Lean proof of the main theorem" : m.lean === "partial" ? " · Lean proof of part of the claim" : "";
    if (m.lean_by && m.lean !== "none") h += ", by " + esc(m.lean_by) + " (not OpenAI)";
    if (m.review) h += " · Under expert review: " + esc(m.review);
    h += "</p>";
    (m.rev || []).forEach(function (r) {
      var txt = r.kind === "extended" ? "Revised " + r.date + (r.short ? ": " + r.short : "") + (r.new_episode ? ". A new episode is coming." : ".")
        : r.kind === "implied-by" ? "Note " + r.date + ": by our reading, result " + r.by + "’s extension implies " + (r.partial ? "part of this claim." : "this claim.")
        : "Record updated " + r.date + (r.short ? ": " + r.short : "") + ".";
      h += '<div class="cx-note"><p>' + esc(txt) + "</p>";
      if (r.kind === "extended" && m.diff) {
        var d = m.diff;
        h += '<p class="meta">References: ' + d.before + " works before, " + d.after + " now (" + d.added.length + " added, " + d.dropped.length + " dropped since the previous build).</p>";
        if (d.added.length) h += '<details class="cx-list"><summary>Works added (' + d.added.length + ")</summary><ul>" + d.added.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></details>";
        if (d.dropped.length) h += '<details class="cx-list"><summary>Works dropped (' + d.dropped.length + ")</summary><ul>" + d.dropped.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></details>";
      }
      h += "</div>";
    });
    (m.links || []).forEach(function (l) { h += '<p class="meta"><a class="cx-ext" href="' + esc(l.url) + '" rel="noopener">' + esc(l.label) + "</a> (the lab’s own page; not imported here)</p>"; });
    if (m.versions) h += '<p class="meta">Earlier versions of the episode: ' + m.versions.map(function (v) { return '<a href="' + esc(v[1]) + '">' + esc(v[0]) + "</a>"; }).join(", ") + " (Unlisted on YouTube)</p>";
    return h + relHtml(i);
  }
  function describe(i, c) {
    var k = kind[i], n = nodes[i], h = "";
    if (k === 0) {
      var works = uniq(c.W), authors = new Set();
      works.forEach(function (w) { nb(w, 3).forEach(function (p) { authors.add(p[0]); }); });
      var share = new Map();
      works.forEach(function (w) {
        var rs = new Set();
        nb(w, 1).forEach(function (p) { nb(p[0], 0).forEach(function (r) { if (r[0] !== i) rs.add(r[0]); }); });
        rs.forEach(function (r) { share.set(r, (share.get(r) || 0) + 1); });
      });
      var near = Array.from(share.entries()).filter(function (a) { return a[1] >= 2; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
      var m = meta[numOf[i]] || {};
      h += '<h2><a href="../' + esc(m.page || "episodes/" + n[5] + "/") + '">' + esc(n[3]) + "</a></h2>";
      h += '<p class="meta"><span class="cx-sw" style="background:' + colour(i) + '"></span>' + esc(special[i] ? "Beyond OpenAI’s catalogue: " + (m.lab_label || "") + (m.draft ? " (draft, preview only)" : "") : subjects[n[4]]) + (c.P.length ? " · " + c.P.length + " paper" + (c.P.length > 1 ? "s" : "") : "") + (special[i] && !works.length ? "" : " · cites " + fmt(works.length) + " works by about " + fmt(authors.size) + " authors") + "</p>";
      h += recordHtml(i, m);
      if (c.P.length) h += "<h3>Papers</h3><ul>" + c.P.map(function (p) { return "<li>" + go(p, nodes[p][3]) + "</li>"; }).join("") + "</ul>";
      if (special[i] && !works.length) {
        h += '<p class="meta">' + esc(m.refs_note || "Its papers are public only as PDFs, so their reference lists are not on the map yet.") + "</p>";
        h += '<p class="meta"><button type="button" class="cx-go" data-clear="1">Clear selection</button></p>';
        panel.innerHTML = h; return;
      }
      if (!near.length) h += '<h3>Results that cite the same works</h3><p class="meta">No other result shares two or more of its references.</p>';
      if (near.length) h += "<h3>Results that cite the most of the same works</h3><ul>" + near.map(function (r) { return "<li>" + go(r[0], nodes[r[0]][3]) + ' <span class="meta">' + r[1] + " shared</span></li>"; }).join("") + "</ul>";
      h += citedLists(works);
    } else if (k === 1) {
      var outO = nb(i, 2).filter(function (p) { return links[p[1]] === i; }), inO = nb(i, 2).filter(function (p) { return links[p[1] + 1] === i; });
      h += '<h2><a href="' + esc(n[5]) + '">' + esc(n[3]) + "</a></h2>";
      h += '<p class="meta">Paper in result ' + go(c.R[0], nodes[c.R[0]][3]) + " · " + fmt(uniq(c.W).length) + " cited works</p>";
      if (outO.length) h += "<h3>Cites these OpenAI papers</h3><ul>" + outO.map(function (p) { return "<li>" + go(p[0], nodes[p[0]][3]) + "</li>"; }).join("") + "</ul>";
      if (inO.length) h += "<h3>Cited by these OpenAI papers</h3><ul>" + inO.map(function (p) { return "<li>" + go(p[0], nodes[p[0]][3]) + "</li>"; }).join("") + "</ul>";
      h += citedLists(nb(i, 1).map(function (p) { return p[0]; }));
    } else if (k === 2) {
      var rs = uniq(c.R);
      h += "<h2>" + (n[5] ? '<a href="' + esc(n[5]) + '">' + esc(n[3]) + "</a>" : esc(n[3])) + "</h2>";
      h += '<p class="meta">' + (n[4] ? n[4] + " · " : "") + "cited by " + n[6] + " OpenAI paper" + (n[6] > 1 ? "s" : "") + " in " + rs.length + " result" + (rs.length > 1 ? "s" : "") + "</p>";
      if (c.A.length) h += "<h3>Authors</h3><p>" + c.A.map(function (a) { return go(a, nodes[a][3]); }).join(", ") + "</p>";
      h += "<h3>Results that cite it</h3><ul>" + rs.sort(function (a, b) { return nodes[a][3] < nodes[b][3] ? -1 : 1; }).map(function (r) { return "<li>" + go(r, nodes[r][3]) + "</li>"; }).join("") + "</ul>";
    } else {
      var ws = uniq(c.W).sort(function (a, b) { return nodes[b][6] - nodes[a][6]; }), rs2 = uniq(c.R);
      h += "<h2>" + esc(n[3]) + "</h2>";
      h += '<p class="meta">' + ws.length + " cited work" + (ws.length > 1 ? "s" : "") + " · cited in " + rs2.length + " result" + (rs2.length > 1 ? "s" : "") + " · names are matched with OpenAlex where possible, so a few people may still share or split a dot</p>";
      h += "<h3>Cited works</h3><ul>" + ws.slice(0, 25).map(function (w) { return "<li>" + go(w, nodes[w][3]) + ' <span class="meta">' + (nodes[w][4] || "") + "</span></li>"; }).join("") + (ws.length > 25 ? '<li class="meta">and ' + (ws.length - 25) + " more</li>" : "") + "</ul>";
      h += "<h3>Results that cite them</h3><ul>" + rs2.sort(function (a, b) { return nodes[a][3] < nodes[b][3] ? -1 : 1; }).map(function (r) { return "<li>" + go(r, nodes[r][3]) + "</li>"; }).join("") + "</ul>";
    }
    h += '<p class="meta"><button type="button" class="cx-go" data-clear="1">Clear selection</button></p>';
    panel.innerHTML = h;
  }
  panel.addEventListener("click", function (ev) {
    var b = ev.target.closest("button.cx-go");
    if (!b) return;
    if (b.dataset.clear) { clearSel(); panel.innerHTML = '<p class="meta">Click a dot or search to see how one result, paper, work or author connects to the rest.</p>'; return; }
    select(+b.dataset.i, true);
    canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  // ---------- search
  var folded = null;
  q.addEventListener("input", function () {
    var t = fold(q.value.trim());
    if (t.length < 2) { hits.hidden = true; return; }
    if (!folded) folded = nodes.map(function (n) { return fold(n[3]); });
    var found = [];
    for (var i = 0; i < N && found.length < 400; i++) if (folded[i].indexOf(t) >= 0) found.push(i);
    found.sort(function (a, b) {
      return kind[a] - kind[b] || (kind[a] === 2 ? nodes[b][6] - nodes[a][6] : 0) || (folded[a].indexOf(t) - folded[b].indexOf(t));
    });
    found = found.slice(0, 30);
    hits.innerHTML = found.length ? found.map(function (i) {
      var lab = nodes[i][3]; if (lab.length > 120) lab = lab.slice(0, 117) + "…";
      return '<li><button type="button" data-i="' + i + '"><span class="kind">' + KIND[kind[i]] + "</span><span>" + esc(lab) + "</span></button></li>";
    }).join("") : '<li class="meta" style="padding:0.3rem 0.8rem">No matches</li>';
    hits.hidden = false;
  });
  hits.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-i]");
    if (!b) return;
    hits.hidden = true;
    select(+b.dataset.i, true);
  });

  function topList() {
    var ws = [];
    for (var i = 0; i < N; i++) if (kind[i] === 2 && nodes[i][6] >= 2) ws.push(i);
    ws.sort(function (a, b) { return nodes[b][6] - nodes[a][6]; });
    var ol = document.getElementById("cx-top");
    ol.innerHTML = ws.slice(0, 15).map(function (w) {
      return "<li>" + go(w, nodes[w][3]) + (nodes[w][4] ? " (" + nodes[w][4] + ")" : "") + ' <span class="cnt">cited by ' + nodes[w][6] + " papers</span></li>";
    }).join("");
    ol.insertAdjacentHTML("beforebegin", '<h3 class="cx-top-h">Most widely cited works</h3>');
    // Authors ranked by how many OpenAI papers cite at least one of their works.
    var au = [];
    for (i = 0; i < N; i++) {
      if (kind[i] !== 3) continue;
      var ps = new Set(), rs = new Set();
      nb(i, 3).forEach(function (w) { nb(w[0], 1).forEach(function (p) { ps.add(p[0]); nb(p[0], 0).forEach(function (r) { rs.add(r[0]); }); }); });
      au.push([i, ps.size, rs.size]);
    }
    au.sort(function (a, b) { return b[1] - a[1] || b[2] - a[2]; });
    ol.insertAdjacentHTML("afterend", '<h3 class="cx-top-h">Most widely cited authors</h3><ol id="cx-top-a" class="cx-top">' +
      au.slice(0, 15).map(function (a) {
        return "<li>" + go(a[0], nodes[a[0]][3]) + ' <span class="cnt">cited by ' + a[1] + " papers in " + a[2] + " results</span></li>";
      }).join("") + '</ol><p class="meta">An author counts once per OpenAI paper that cites any of their works.</p>');
    [ol, document.getElementById("cx-top-a")].forEach(function (list) {
      list.addEventListener("click", function (ev) {
        var b = ev.target.closest("button.cx-go");
        if (b) { select(+b.dataset.i, true); canvas.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      });
    });
  }
})();
