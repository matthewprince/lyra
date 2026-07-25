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
// audio-reactive wash: brightens with the track's energy curve (opacity-only,
// written per-frame by pulse() - deliberately NO transition on it)
".lyra-bg-energy{position:absolute;inset:0;pointer-events:none;" +
"background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,.17) 0%,transparent 62%);opacity:0;}" +
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
      var energyEl = document.createElement("div");
      energyEl.className = "lyra-bg-energy";
      var scrim = document.createElement("div");
      scrim.className = "lyra-bg-scrim";
      var curGroup = null, curLayers = null, token = 0, destroyed = false;

      // audio-reactive state (fed by setAnalysis, driven by pulse per frame)
      var anBars = null, anEnergy = null, anStep = 250, barIdx = 0, lastPos = -1;
      var wScale = -1, wWash = -1, wLay = -1;

      function show(art) {
        if (destroyed) return;
        var grp = document.createElement("div");
        grp.className = "lyra-bg-grp";
        var la = makeLayer(art.canvas, "lyra-bg-a");
        var lb = makeLayer(art.canvas, "lyra-bg-b");
        grp.appendChild(la);
        grp.appendChild(lb);
        holder.appendChild(grp);
        holder.appendChild(energyEl); // stays above whichever groups exist
        holder.appendChild(scrim);
        var old = curGroup;
        curGroup = grp;
        curLayers = [{ el: la, base: 0.85 }, { el: lb, base: 0.6 }];
        wLay = -1; wScale = -1;
        // double rAF or the transition never starts and the cover hard-cuts
        requestAnimationFrame(function () { requestAnimationFrame(function () { grp.classList.add("lyra-bg-in"); }); });
        if (old) setTimeout(function () { old.remove(); }, 1300);
      }

      function energyAt(pos) {
        if (!anEnergy || !anEnergy.length) return 0.5;
        var x = pos / anStep;
        var i = Math.floor(x);
        if (i < 0) return anEnergy[0] / 100;
        if (i >= anEnergy.length - 1) return anEnergy[anEnergy.length - 1] / 100;
        var f = x - i;
        return (anEnergy[i] * (1 - f) + anEnergy[i + 1] * f) / 100;
      }

      function pulse(pos) {
        if (destroyed || !anBars) return;
        if (pos < lastPos - 400) barIdx = 0; // seek back: rescan
        lastPos = pos;
        while (barIdx + 1 < anBars.length && anBars[barIdx + 1][0] <= pos) barIdx++;
        var bar = anBars[barIdx];
        var env = 0;
        if (bar && pos >= bar[0]) {
          var bp = (pos - bar[0]) / Math.max(1, bar[1]);
          if (bp < 1) { var r = 1 - bp; env = r * r * (bar[2] || 0.5); } // thump at the bar line, decay across it
        }
        var e = energyAt(pos);
        // group breath: bar thump scaled by how loud the song is right now
        var sc = Math.round((1 + 0.034 * env * (0.35 + 0.65 * e)) * 500) / 500;
        if (sc !== wScale && curGroup) { wScale = sc; curGroup.style.scale = sc === 1 ? "" : String(sc); }
        // energy wash + layer brightness follow the loudness curve
        var wash = Math.round(e * e * 0.5 * 50) / 50; // quadratic: quiet stays dark
        if (wash !== wWash) { wWash = wash; energyEl.style.opacity = wash <= 0 ? "" : String(wash); }
        var lm = Math.round((0.62 + 0.38 * e) * 50) / 50;
        if (lm !== wLay && curLayers) {
          wLay = lm;
          for (var i = 0; i < curLayers.length; i++)
            curLayers[i].el.style.opacity = (curLayers[i].base * lm).toFixed(3);
        }
      }

      return {
        setAnalysis: function (a) {
          anBars = (a && (a.bars && a.bars.length ? a.bars : a.beats)) || null;
          anEnergy = (a && a.energy && a.energy.values) || null;
          anStep = (a && a.energy && a.energy.stepMs) || 250;
          barIdx = 0; lastPos = -1; wScale = -1; wWash = -1; wLay = -1;
          if (!anBars && curGroup) { curGroup.style.scale = ""; energyEl.style.opacity = ""; }
        },
        pulse: pulse,
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
