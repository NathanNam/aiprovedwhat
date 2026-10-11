// Search, filter and sort the list of all results on /episodes/.
// The full list is in the HTML, so the page works without JavaScript;
// this script only shows the filter bar and hides or reorders rows.
// Filters are mirrored in the address (?q=…&subject=…&episode=1&lean=1&sort=newest|papers)
// so a filtered view can be bookmarked or shared.
(function () {
  var form = document.getElementById("filters");
  var list = document.getElementById("results");
  if (!form || !list) return;

  var q = document.getElementById("f-q");
  var subject = document.getElementById("f-subject");
  var sort = document.getElementById("f-sort");
  var hasEpisode = document.getElementById("f-episode");
  var hasLean = document.getElementById("f-lean");
  var count = document.getElementById("count");
  var empty = document.getElementById("empty");
  var rows = Array.prototype.slice.call(list.children);
  var total = rows.length;

  function fold(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.toLowerCase().trim();
  }

  function byNumber(a, b) {
    return a.getAttribute("data-num") < b.getAttribute("data-num") ? -1 : 1;
  }

  function byNewestEpisode(a, b) {
    var ea = parseInt(a.getAttribute("data-ep") || "0", 10);
    var eb = parseInt(b.getAttribute("data-ep") || "0", 10);
    if (ea !== eb) return eb - ea;
    return byNumber(a, b);
  }

  function byPapers(a, b) {
    var pa = parseInt(a.getAttribute("data-papers") || "1", 10);
    var pb = parseInt(b.getAttribute("data-papers") || "1", 10);
    if (pa !== pb) return pb - pa;
    return byNumber(a, b);
  }

  var SORTS = { num: byNumber, newest: byNewestEpisode, papers: byPapers };
  var SORT_LABEL = { num: ", by number.", newest: ", newest episode first.", papers: ", most papers first." };

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    q.value = p.get("q") || "";
    var s = p.get("subject") || "";
    subject.value = subject.querySelector('option[value="' + s.replace(/"/g, "") + '"]') ? s : "";
    var s2 = p.get("sort");
    sort.value = SORTS.hasOwnProperty(s2) ? s2 : "num";
    hasEpisode.checked = p.get("episode") === "1";
    hasLean.checked = p.get("lean") === "1";
  }

  function writeUrl() {
    var p = new URLSearchParams();
    if (q.value.trim()) p.set("q", q.value.trim());
    if (subject.value) p.set("subject", subject.value);
    if (hasEpisode.checked) p.set("episode", "1");
    if (hasLean.checked) p.set("lean", "1");
    if (sort.value !== "num") p.set("sort", sort.value);
    var search = p.toString();
    var url = window.location.pathname + (search ? "?" + search : "") + window.location.hash;
    try { window.history.replaceState(null, "", url); } catch (e) { /* file:// or sandboxed */ }
  }

  function apply() {
    var terms = fold(q.value).split(/\s+/).filter(Boolean);
    var subj = subject.value;
    var shown = 0;
    rows.forEach(function (li) {
      var hay = li.getAttribute("data-search");
      var ok = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      if (ok && subj) ok = li.getAttribute("data-subject") === subj;
      if (ok && hasEpisode.checked) ok = li.hasAttribute("data-ep");
      if (ok && hasLean.checked) ok = li.getAttribute("data-lean") !== "none";
      li.hidden = !ok;
      if (ok) shown += 1;
    });

    var ordered = rows.slice().sort(SORTS[sort.value] || byNumber);
    var frag = document.createDocumentFragment();
    ordered.forEach(function (li) { frag.appendChild(li); });
    list.appendChild(frag);

    count.textContent = "Showing " + shown + " of " + total + (SORT_LABEL[sort.value] || SORT_LABEL.num);
    empty.hidden = shown !== 0;
    writeUrl();
  }

  form.hidden = false;
  readUrl();
  apply();

  var timer = null;
  q.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  });
  [subject, sort, hasEpisode, hasLean].forEach(function (el) {
    el.addEventListener("change", apply);
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); apply(); });
  form.addEventListener("reset", function () { setTimeout(apply, 0); });
})();
