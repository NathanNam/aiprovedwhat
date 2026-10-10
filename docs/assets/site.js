// Click-to-load YouTube player.
// Nothing loads from YouTube until a visitor presses play or picks a chapter.
// Without JavaScript, the poster and chapter links simply open the video on YouTube.
(function () {
  var player = document.querySelector(".player[data-youtube]");
  if (!player) return;
  var id = player.getAttribute("data-youtube");
  var title = player.getAttribute("data-title") || "Episode video";

  function play(start) {
    var src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) +
      "?autoplay=1&rel=0&start=" + Math.max(0, Math.floor(start || 0));
    var frame = player.querySelector("iframe");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = title;
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      player.innerHTML = "";
      player.appendChild(frame);
    }
    frame.src = src;
  }

  var poster = player.querySelector("a");
  if (poster) {
    poster.addEventListener("click", function (e) {
      e.preventDefault();
      play(0);
      var f = player.querySelector("iframe");
      if (f) f.focus();
    });
  }

  document.querySelectorAll("a[data-t]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      play(parseInt(a.getAttribute("data-t"), 10));
      var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      player.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    });
  });
})();
