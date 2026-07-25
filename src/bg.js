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
// with analysis, layer motion is JS-integrated (velocity rides the music) and
// the keyframe drift gets out of the way
".lyra-bg-live .lyra-bg-layer{animation:none;}" +
// palette flow blobs: big soft colour fields from the cover's dominant colours,
// orbiting independently - this is what makes the field ORGANIC instead of two
// copies of the same texture spinning
".lyra-bg-blob{position:absolute;left:50%;top:50%;width:95vmax;height:95vmax;margin:-47.5vmax 0 0 -47.5vmax;" +
"border-radius:50%;pointer-events:none;will-change:transform;}" +
"@keyframes lyra-bg-a{from{transform:rotate(0deg) translate(6vmax,0) scale(1);}50%{transform:rotate(180deg) translate(6vmax,0) scale(1.18);}to{transform:rotate(360deg) translate(6vmax,0) scale(1);}}" +
"@keyframes lyra-bg-b{from{transform:rotate(360deg) translate(-8vmax,2vmax) scale(1.25);}50%{transform:rotate(180deg) translate(-8vmax,2vmax) scale(1.05);}to{transform:rotate(0deg) translate(-8vmax,2vmax) scale(1.25);}}" +
".lyra-bg-scrim{position:absolute;inset:0;" +
"background:radial-gradient(ellipse at 50% 40%,rgba(0,0,0,.28) 0%,rgba(0,0,0,.66) 100%),rgba(8,8,12,.38);}" +
// audio-reactive wash: brightens with the track's energy curve (opacity-only,
// written per-frame by pulse() - deliberately NO transition on it)
".lyra-bg-energy{position:absolute;inset:0;pointer-events:none;" +
"background:radial-gradient(ellipse at 50% 42%,rgba(255,255,255,.27) 0%,transparent 68%);opacity:0;}" +
"@media (prefers-reduced-motion:reduce){.lyra-bg-layer{animation:none!important;}}";

  function injectCSS() {
    if (document.getElementById("lyra-bg-css")) return;
    var s = document.createElement("style");
    s.id = "lyra-bg-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // crush the art to a tiny canvas; also grabs an average colour + a small
  // palette of saturated/bright pixels for the flow blobs
  function crush(img, size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var x = c.getContext("2d");
    x.drawImage(img, 0, 0, size, size);
    var avg = [40, 40, 60], pal = [];
    try {
      var d = x.getImageData(0, 0, size, size).data, r = 0, g = 0, b = 0, n = d.length / 4;
      var scored = [];
      for (var i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        scored.push([mx - mn + mx * 0.4, d[i], d[i + 1], d[i + 2]]); // favour saturated + bright
      }
      avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      scored.sort(function (p, q) { return q[0] - p[0]; });
      // greedy pick with a minimum colour distance so the blobs actually differ
      for (var s2 = 0; s2 < scored.length && pal.length < 4; s2++) {
        var cand = scored[s2], ok = true;
        for (var p2 = 0; p2 < pal.length; p2++) {
          var dd = Math.abs(cand[1] - pal[p2][0]) + Math.abs(cand[2] - pal[p2][1]) + Math.abs(cand[3] - pal[p2][2]);
          if (dd < 110) { ok = false; break; }
        }
        if (ok) pal.push([cand[1], cand[2], cand[3]]);
      }
    } catch (e) {} // tainted canvas - fine, layers still render
    return { canvas: c, avg: avg, palette: pal };
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

      // audio-reactive state. the driver is the SEGMENT loudness envelope - the
      // real per-hit levels (start -> max at the actual attack offset -> next
      // segment). synthetic beat-timestamp flashes strobed; levels pump.
      var anSegs = null, anBeats = null, beatIdx = 0, anEnergy = null, anStep = 250;
      var segIdx = 0, lastPos = -1, disp = 0, punch = 0, breathe = 0, dbLow = -30, dbHigh = -8;
      var riseGate = 4, riseFull = 15; // per-track (p35/p90 of attack rises)
      // track character (server /v2/analysis "character" block, characterVer 1):
      // beatW: 0 = breathe with the envelope (All Too Well), 1 = knock on the grid
      // (goosebumps). atkScale: how hard hits should land (SICKO MODE 13.5dB -> 1.5x)
      var beatW = 0.75, atkScale = 1;
      var wScale = -1, wWash = -1, wLay = -1;

      function levelAt(pos) {
        // piecewise loudness in dB from columnar segments
        // [startMs, durMs, conf, loudStart, loudMax, attackOffsetMs]
        if (pos < lastPos - 400) segIdx = 0; // seek back: rescan
        while (segIdx + 1 < anSegs.length && anSegs[segIdx + 1][0] <= pos) segIdx++;
        var s = anSegs[segIdx];
        if (!s || pos < s[0]) return dbLow;
        var t = pos - s[0], atk = Math.max(1, s[5] || 1), db;
        if (t <= atk) db = s[3] + (s[4] - s[3]) * (t / atk);
        else {
          var nl = segIdx + 1 < anSegs.length ? anSegs[segIdx + 1][3] : s[3];
          var rel = Math.max(1, s[1] - atk);
          db = s[4] + (nl - s[4]) * Math.min(1, (t - atk) / rel);
        }
        return db;
      }

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
        // per-layer orbit params for the live (JS-driven) motion: counter-rotating,
        // different radii/scales so the composition genuinely evolves
        curLayers = [
          { el: la, base: 0.85, ang: 0, dir: 1, vel: 13, orb: 6, sc: 1.12, _t: "" },
          { el: lb, base: 0.6, ang: 140, dir: -1, vel: 18, orb: 8, sc: 1.28, _t: "" },
        ];
        // palette blobs ride between the layers and the wash
        var pal = art.palette || [];
        for (var bi = 0; bi < pal.length; bi++) {
          var col = pal[bi];
          var blob = document.createElement("div");
          blob.className = "lyra-bg-blob";
          blob.style.background = "radial-gradient(circle at 50% 50%, rgba(" + col[0] + "," + col[1] + "," + col[2] + ",.5) 0%, rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0) 62%)";
          grp.appendChild(blob);
          curLayers.push({
            el: blob, base: 0, blob: true,
            ang: 90 * bi + 30, dir: bi % 2 ? -1 : 1,
            vel: 20 + 9 * bi, orb: 10 + 5 * (bi % 3), sc: 0.9 + 0.25 * (bi % 2), _t: "",
          });
        }
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
        if (destroyed || (!anSegs && !anEnergy)) return; // degrade: energy-only data still animates
        var dtL = lastPos < 0 ? 0 : Math.max(0, Math.min(100, pos - lastPos));
        var sc = 1;
        if (anSegs) {
          // level meter (slow body of the sound)
          var L = (levelAt(pos) - dbLow) / Math.max(1, dbHigh - dbLow);
          L = L < 0 ? 0 : L > 1 ? 1 : L;
          disp += (L - disp) * Math.min(1, (dtL || 16) / (L > disp ? 28 : 220));
          // onset strength from the current segment's attack rise (bonus channel)
          var s = anSegs[segIdx], onset = 0;
          if (s && pos >= s[0]) {
            var rise = s[4] - s[3];
            if (rise > riseGate && pos <= s[0] + Math.max(60, (s[5] || 0) + 90)) {
              onset = Math.min(1, (rise - riseGate) / Math.max(2, riseFull - riseGate));
            }
          }
          // the thump is BEAT-GRID locked (the stable thing you feel), sized by
          // the level meter, boosted when a real onset coincides. attack-rise
          // alone missed trap: 808s glide, they don't spike broadband loudness.
          var target = 0;
          if (anBeats) {
            if (pos < lastPos - 400) beatIdx = 0;
            while (beatIdx + 1 < anBeats.length && anBeats[beatIdx + 1][0] <= pos) beatIdx++;
            var b = anBeats[beatIdx];
            if (b && pos >= b[0]) {
              var bp = (pos - b[0]) / Math.max(1, b[1]);
              if (bp < 1) {
                var br = 1 - bp;
                target = br * Math.sqrt(br) * (0.22 + 0.78 * disp) * (1 + 0.6 * onset);
                // loudness caps the thump so quiet can't slam - but a strong grid
                // (beatW) buys headroom: woozy-but-locked tracks still knock
                var cap = Math.min(1, 0.3 + 0.7 * disp + 0.25 * beatW);
                if (target > cap) target = cap;
              }
            }
          } else target = onset * (0.35 + 0.65 * L); // no grid: fall back to onsets
          // punch stays STRONG wherever a grid exists - a linear fade made mid
          // tracks (90210) half-hearted, which read as "mid". concave curve:
          // full-ish knock above the gate, zero below it.
          var punchW = beatW <= 0.08 ? 0 : 0.45 + 0.55 * beatW;
          punch += (target * punchW - punch) * Math.min(1, (dtL || 16) / (target * punchW > punch ? 18 : 150));
          // slow breathing channel for envelope-led tracks (~700ms follow of the meter)
          breathe += (disp - breathe) * Math.min(1, (dtL || 16) / 700);
          // the pump crossfades on track character: grid tracks knock (punch,
          // scaled by how hard this track's hits land), envelope tracks swell
          sc = Math.round((1 + 0.22 * atkScale * Math.pow(punch, 1.3) + (0.05 + 0.1 * (1 - beatW)) * breathe * breathe) * 500) / 500;
        }
        lastPos = pos;
        if (sc !== wScale && curGroup) { wScale = sc; curGroup.style.scale = sc === 1 ? "" : String(sc); }
        // live flow: layer orbits integrate a velocity that rides the music.
        // energy sets cruising speed, hits kick it. calibrated against the
        // reference video: the field should visibly reorganize every ~10-15s
        // in loud sections, and freeze when the music stops.
        if (curLayers && dtL > 0) {
          holder.classList.add("lyra-bg-live");
          var e2 = energyAt(pos);
          var flow = 0.25 + 0.95 * e2 + 2.2 * Math.pow(punch, 1.3) + (0.8 + 0.9 * (1 - beatW)) * disp * disp; // idle .. ~3.5x on hits; envelope tracks flow harder instead of knocking
          for (var li = 0; li < curLayers.length; li++) {
            var Ly = curLayers[li];
            Ly.ang += Ly.vel * Ly.dir * flow * (dtL / 1000);
            var aq = Math.round(Ly.ang * 10) / 10;
            // blobs also thump in SIZE on punches - the per-hit body the pump alone lacked
            var scEff = Ly.blob ? Math.round(Ly.sc * (1 + 0.14 * punch) * 200) / 200 : Ly.sc;
            var t = "rotate(" + aq + "deg) translate(" + Ly.orb + "vmax,0) scale(" + scEff + ")";
            if (t !== Ly._t) { Ly._t = t; Ly.el.style.transform = t; }
          }
        }
        // luminance strictly follows the SLOW energy curve (no per-hit light)
        var e = energyAt(pos);
        var wash = Math.round(Math.min(0.5, e * (0.12 + 0.35 * e)) * 50) / 50;
        if (wash !== wWash) { wWash = wash; energyEl.style.opacity = wash <= 0 ? "" : String(wash); }
        var lm = Math.round(Math.min(1, 0.58 + 0.42 * e) * 50) / 50;
        if (lm !== wLay && curLayers) {
          wLay = lm;
          for (var i = 0; i < curLayers.length; i++) {
            var CL = curLayers[i];
            CL.el.style.opacity = CL.blob ? String(lm) : (CL.base * lm).toFixed(3);
          }
        }
      }

      return {
        setAnalysis: function (a) {
          anSegs = (a && a.segments && a.segments.length && a.segments) || null;
          anBeats = (a && a.beats && a.beats.length && a.beats) || null;
          anEnergy = (a && a.energy && a.energy.values) || null;
          anStep = (a && a.energy && a.energy.stepMs) || 250;
          segIdx = 0; beatIdx = 0; lastPos = -1; disp = 0; punch = 0; wScale = -1; wWash = -1; wLay = -1;
          if (anSegs) {
            // normalize per-track: p15..p92 of the segment peaks define the meter range
            var peaks = anSegs.map(function (s) { return s[4]; }).sort(function (x, y) { return x - y; });
            dbLow = peaks[Math.floor(peaks.length * 0.15)];
            dbHigh = Math.max(dbLow + 6, peaks[Math.floor(peaks.length * 0.92)]);
            // and the punch gate: p35..p90 of attack rises, so only THIS track's
            // proper hits thump (trap is wall-to-wall onsets, ballads are sparse)
            var rises = anSegs.map(function (s) { return s[4] - s[3]; }).sort(function (x, y) { return x - y; });
            riseGate = Math.max(3, rises[Math.floor(rises.length * 0.35)]);
            riseFull = Math.max(riseGate + 4, rises[Math.floor(rises.length * 0.9)]);
          }
          var ch = a && a.character;
          if (ch && (typeof ch.beatSalienceDb === "number" || typeof ch.beatSalience === "number")) {
            // dB axis (characterVer 2) separates better than the ratio: 0.4dB
            // (All Too Well) .. 4.2dB (goosebumps). fall back to the ratio map
            // for ver-1 cached payloads.
            beatW = typeof ch.beatSalienceDb === "number"
              ? Math.max(0, Math.min(1, (ch.beatSalienceDb - 0.3) / 1.8))
              : Math.max(0, Math.min(1, (ch.beatSalience - 1.05) / 0.37));
            atkScale = Math.max(0.6, Math.min(1.5, (ch.attackDepth || 9) / 9));
          } else { beatW = 0.75; atkScale = 1; }
          breathe = 0;
          if (!anSegs && !anEnergy && curGroup) { curGroup.style.scale = ""; energyEl.style.opacity = ""; }
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
