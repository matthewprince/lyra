// Lyra background - ambient drifting album art.
// Cover gets crushed to a tiny canvas once (the downsample basically is the
// blur), then two big layers drift on pure CSS transform animations. Nothing
// repaints per frame. Cover changes crossfade two stacked groups. Always dark.
(function (global) {
  "use strict";
  var Lyra = global.Lyra = global.Lyra || {};

  var CSS = "" +
".lyra-bg{position:absolute;inset:0;overflow:hidden;z-index:0;background:#0b0b0f;}" +
".lyra-bg~.lyra-viewport{z-index:1;}" +
".lyra-bg-grp{position:absolute;inset:0;opacity:0;transition:opacity 1.1s ease;}" +
".lyra-bg-grp.lyra-bg-in{opacity:1;}" +
".lyra-bg-layer{position:absolute;left:50%;top:50%;margin:-80vmax 0 0 -80vmax;width:160vmax;height:160vmax;" +
"border-radius:38%;filter:blur(56px) saturate(1.6);will-change:transform;}" +
".lyra-bg-a{animation:lyra-bg-a 80s linear infinite;opacity:.85;}" +
".lyra-bg-b{animation:lyra-bg-b 100s linear infinite;opacity:.6;}" +
"@keyframes lyra-bg-a{from{transform:rotate(0deg) translate(6vmax,0) scale(1);}50%{transform:rotate(180deg) translate(6vmax,0) scale(1.18);}to{transform:rotate(360deg) translate(6vmax,0) scale(1);}}" +
"@keyframes lyra-bg-b{from{transform:rotate(360deg) translate(-8vmax,2vmax) scale(1.25);}50%{transform:rotate(180deg) translate(-8vmax,2vmax) scale(1.05);}to{transform:rotate(0deg) translate(-8vmax,2vmax) scale(1.25);}}" +
".lyra-bg-scrim{position:absolute;inset:0;" +
"background:radial-gradient(ellipse at 50% 40%,rgba(0,0,0,.28) 0%,rgba(0,0,0,.66) 100%),rgba(8,8,12,.38);}" +
"@media (prefers-reduced-motion:reduce){.lyra-bg-layer{animation:none!important;}}";

  function injectCSS() {
    if (document.getElementById("lyra-bg-css")) return;
    var s = document.createElement("style");
    s.id = "lyra-bg-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // crush the art to a tiny canvas; also grabs an average colour
  function crush(img, size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var x = c.getContext("2d");
    x.drawImage(img, 0, 0, size, size);
    var avg = [40, 40, 60];
    try {
      var d = x.getImageData(0, 0, size, size).data, r = 0, g = 0, b = 0, n = d.length / 4;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    } catch (e) {} // tainted canvas - fine, layers still render
    return { canvas: c, avg: avg };
  }

  function fallbackArt(accent) {
    var c = document.createElement("canvas");
    c.width = c.height = 48;
    var x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, 48, 48);
    g.addColorStop(0, accent || "#2a2440");
    g.addColorStop(0.55, "#16324a");
    g.addColorStop(1, "#101018");
    x.fillStyle = g;
    x.fillRect(0, 0, 48, 48);
    return { canvas: c, avg: [30, 36, 56] };
  }

  function makeLayer(srcCanvas, cls) {
    var c = document.createElement("canvas");
    c.width = c.height = 96;
    c.className = "lyra-bg-layer " + cls;
    var x = c.getContext("2d");
    x.imageSmoothingEnabled = true;
    x.drawImage(srcCanvas, 0, 0, 96, 96);
    return c;
  }

  Lyra.Background = {
    attach: function (rootEl) {
      injectCSS();
      var holder = document.createElement("div");
      holder.className = "lyra-bg";
      rootEl.insertBefore(holder, rootEl.firstChild);
      var scrim = document.createElement("div");
      scrim.className = "lyra-bg-scrim";
      var curGroup = null, token = 0, destroyed = false;

      function show(art) {
        if (destroyed) return;
        var grp = document.createElement("div");
        grp.className = "lyra-bg-grp";
        grp.appendChild(makeLayer(art.canvas, "lyra-bg-a"));
        grp.appendChild(makeLayer(art.canvas, "lyra-bg-b"));
        holder.appendChild(grp);
        holder.appendChild(scrim);
        var old = curGroup;
        curGroup = grp;
        // double rAF or the transition never starts and the cover hard-cuts
        requestAnimationFrame(function () { requestAnimationFrame(function () { grp.classList.add("lyra-bg-in"); }); });
        if (old) setTimeout(function () { old.remove(); }, 1300);
      }

      return {
        setCover: function (url, accent) {
          var my = ++token;
          if (!url) { show(fallbackArt(accent)); return; }
          var img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = function () { if (my === token) show(crush(img, 24)); };
          img.onerror = function () {
            if (my !== token) return;
            // retry without CORS - tainted is fine, only avg sampling suffers
            var img2 = new Image();
            img2.onload = function () { if (my === token) show(crush(img2, 24)); };
            img2.onerror = function () { if (my === token) show(fallbackArt(accent)); };
            img2.src = url;
          };
          img.src = url;
        },
        destroy: function () { destroyed = true; holder.remove(); },
      };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
