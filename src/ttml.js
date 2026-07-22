// Lyra parsers - TTML / lyrics-JSON / LRC in, one internal model out.
// All times in MILLISECONDS (upstream JSON is seconds, converted here).
//
// model = { timing:'word'|'line'|'none', duration, songwriters:[],
//   lines:[{ kind:'line', start, end, text, align:'start'|'end' (duet side),
//     agent, songPart, key,
//     words:[{start,end,text,syllables:[{start,end,text}]}],  // word timing only
//     background:[{start,end,words:[...]}] }] }                // x-bg vocals
//
// Real TTML files can't agree on namespace prefixes (ttm:, itunes:, amll:, none),
// so everything matches by localName. Never getAttribute a qualified name here.
(function (global) {
  "use strict";
  var Lyra = global.Lyra = global.Lyra || {};

  // clock values: "h:mm:ss.fff" / "m:ss.fff" / "ss.fff" / "12.5s" / "500ms" / bare seconds.
  // real apple files MIX formats in one document, don't assume.
  function parseClock(str) {
    if (str == null) return null;
    var s = String(str).trim();
    if (!s) return null;
    var m = s.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/); // TTML offset-time with metric
    if (m) {
      var v = parseFloat(m[1]);
      return m[2] === "h" ? v * 3600000 : m[2] === "m" ? v * 60000 : m[2] === "s" ? v * 1000 : v;
    }
    var parts = s.split(":");
    if (parts.length > 3) return null;
    var ms = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parseFloat(parts[i]);
      if (isNaN(p)) return null;
      ms = ms * 60 + p * 1000; // accumulate: each colon shifts previous into the next-larger unit
    }
    return ms;
  }

  // attr by localName, whatever the prefix
  function attr(el, local) {
    if (!el || !el.attributes) return null;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.localName === local || a.name === local) return a.value;
    }
    return null;
  }
  function localName(el) { return (el.localName || el.nodeName || "").toLowerCase().replace(/^.*:/, ""); }
  function elementsByLocal(rootEl, local) {
    var out = [], all = rootEl.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) if (localName(all[i]) === local) out.push(all[i]);
    return out;
  }
  function normText(s) { return (s || "").replace(/\s+/g, " ").trim(); }

  // walk a <p> (or x-bg span) into syllables + trailing-space flags. whitespace
  // TEXT NODES between spans = word boundaries; adjacent spans = one word.
  // newline whitespace is usually just pretty-printer indent, NOT a boundary,
  // unless the whole doc has no plain spaces at all (nlBoundary).
  function collectSyllables(container, sink, nlBoundary) {
    var kids = container.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) { // text
        if (/\S/.test(n.nodeValue)) {
          // loose untimed text - keep it, times get inferred later
          if (/^\s/.test(n.nodeValue) && sink.syls.length) sink.syls[sink.syls.length - 1].space = true;
          sink.syls.push({ start: null, end: null, text: normText(n.nodeValue), space: /\s$/.test(n.nodeValue) });
        } else if (/\s/.test(n.nodeValue) && sink.syls.length) {
          if (nlBoundary || !/[\n\r]/.test(n.nodeValue)) sink.syls[sink.syls.length - 1].space = true;
        }
        continue;
      }
      if (n.nodeType !== 1) continue;
      var ln = localName(n);
      if (ln === "br") { if (sink.syls.length) sink.syls[sink.syls.length - 1].space = true; continue; }
      if (ln !== "span") continue;
      var role = attr(n, "role") || "";
      if (/x-bg/.test(role)) { sink.bg.push(n); continue; }                    // background vocal group, handled by caller
      if (/x-translation|x-transliteration|x-roman/.test(role)) continue;      // not rendered (v1)
      var b = parseClock(attr(n, "begin")), e = parseClock(attr(n, "end"));
      if (b == null && elementsByLocal(n, "span").length) { collectSyllables(n, sink, nlBoundary); continue; } // formatting wrapper (prefix-agnostic)
      var txt = n.textContent || "";
      if (!normText(txt) && b == null) continue;
      sink.syls.push({ start: b, end: e, text: txt.replace(/\s+/g, " ").replace(/^ | $/g, ""), space: /\s$/.test(txt) });
      if (/^\s/.test(txt) && sink.syls.length > 1) sink.syls[sink.syls.length - 2].space = true;
    }
  }

  // syllables -> words; missing times inherit from neighbours
  function toWords(syls) {
    // repair untimed syllables: inherit from previous/next timed neighbour
    var last = 0;
    for (var i = 0; i < syls.length; i++) {
      var s = syls[i];
      if (s.start == null) s.start = last;
      if (s.end == null) {
        var nxt = null;
        for (var j = i + 1; j < syls.length; j++) if (syls[j].start != null) { nxt = syls[j].start; break; }
        s.end = nxt != null ? nxt : s.start;
      }
      if (s.end < s.start) s.end = s.start;
      last = s.end;
    }
    var words = [], cur = null;
    for (var k = 0; k < syls.length; k++) {
      var sy = syls[k];
      if (!sy.text) { if (cur && sy.space) { words.push(cur); cur = null; } continue; }
      if (!cur) cur = { start: sy.start, end: sy.end, text: "", syllables: [] };
      cur.syllables.push({ start: sy.start, end: sy.end, text: sy.text });
      cur.text += sy.text;
      cur.end = Math.max(cur.end, sy.end);
      if (sy.space) { words.push(cur); cur = null; }
    }
    if (cur) words.push(cur);
    return words;
  }
  function wordsSpan(words) {
    if (!words.length) return null;
    var s = Infinity, e = 0;
    for (var i = 0; i < words.length; i++) { s = Math.min(s, words[i].start); e = Math.max(e, words[i].end); }
    return { start: s, end: e };
  }
  function wordsText(words) { return words.map(function (w) { return w.text; }).join(" "); }

  // ---------------------------------------------------------------------------
  Lyra.parseTTML = function (source) {
    var xml = String(source || "").replace(/^﻿/, "");
    var doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      // one repair pass for stray & etc, then give up
      doc = new DOMParser().parseFromString(xml.replace(/&(?!#?\w+;)/g, "&amp;"), "text/xml");
      if (doc.getElementsByTagName("parsererror").length) return null;
    }
    var tt = doc.documentElement;
    if (!tt || localName(tt) !== "tt") return null;

    var timingAttr = (attr(tt, "timing") || "").toLowerCase();
    var body = elementsByLocal(tt, "body")[0];
    if (!body) return null;

    // duets: any agent that isn't the first declared one goes right-aligned
    var agents = [];
    var head = elementsByLocal(tt, "head")[0];
    if (head) {
      var ags = elementsByLocal(head, "agent");
      for (var a = 0; a < ags.length; a++) {
        var id = attr(ags[a], "id");
        if (id) agents.push(id);
      }
    }
    var primaryAgent = agents.length ? agents[0] : null;

    var songwriters = [];
    if (head) {
      var sws = elementsByLocal(head, "songwriter");
      for (var w = 0; w < sws.length; w++) { var t = normText(sws[w].textContent); if (t) songwriters.push(t); }
    }

    var lines = [];
    var ps = elementsByLocal(body, "p");
    // newline rule is decided once per document
    var spaceNodes = 0, nlNodes = 0;
    for (var sc = 0; sc < ps.length; sc++) {
      var tw = ps[sc].childNodes;
      for (var tn = 0; tn < tw.length; tn++) {
        var nd = tw[tn];
        if (nd.nodeType !== 3 || /\S/.test(nd.nodeValue)) continue;
        if (/[\n\r]/.test(nd.nodeValue)) nlNodes++; else spaceNodes++;
      }
      // edge-spaces inside span text count as separator evidence too, or a
      // pretty-printed internal-space file shatters every multi-syllable word
      var sps = elementsByLocal(ps[sc], "span");
      for (var se = 0; se < sps.length; se++) {
        if (/^\s|\s$/.test(sps[se].textContent || "")) spaceNodes++;
      }
    }
    var nlBoundary = spaceNodes === 0 && nlNodes > 0;
    var sawSyllables = false;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var pBegin = parseClock(attr(p, "begin")), pEnd = parseClock(attr(p, "end"));
      var agent = attr(p, "agent");
      var songPart = attr(p, "songPart");
      if (!songPart && p.parentNode && p.parentNode.nodeType === 1) songPart = attr(p.parentNode, "songPart");

      var sink = { syls: [], bg: [] };
      collectSyllables(p, sink, nlBoundary);
      var words = toWords(sink.syls);
      var timed = words.length && words.some(function (wd) { return wd.syllables.some(function (s2) { return s2.end > s2.start; }); });

      var line = {
        kind: "line",
        start: pBegin != null ? pBegin : 0,
        end: pEnd != null ? pEnd : 0,
        text: "",
        align: agent && primaryAgent && agent !== primaryAgent ? "end" : "start",
        agent: agent || null,
        songPart: songPart || null,
        key: attr(p, "key"),
        words: [],
        background: [],
      };

      if (timed && timingAttr !== "line") {
        sawSyllables = true;
        line.words = words;
        line.text = wordsText(words);
        var span = wordsSpan(words);
        if (pBegin == null) line.start = span.start;
        if (pEnd == null || pEnd < span.end) line.end = Math.max(pEnd || 0, span.end);
      } else {
        // NOT p.textContent - that re-includes x-bg/x-translation text
        line.text = wordsText(words);
        if (pEnd == null && pBegin != null) line.end = pBegin; // repaired below from the next line
      }

      // background vocal groups (x-bg spans found while walking)
      for (var g = 0; g < sink.bg.length; g++) {
        var bsink = { syls: [], bg: [] };
        collectSyllables(sink.bg[g], bsink, nlBoundary);
        // the x-bg wrapper can carry the timing itself - seed the edges from it
        // or untimed bg vocals collapse to 0/0
        var bb = parseClock(attr(sink.bg[g], "begin")), be = parseClock(attr(sink.bg[g], "end"));
        if (bsink.syls.length) {
          var bs0 = bsink.syls[0], bsN = bsink.syls[bsink.syls.length - 1];
          if (bs0.start == null) bs0.start = bb != null ? bb : (pBegin || 0);
          if (bsN.end == null) bsN.end = be != null ? be : pEnd;
        }
        var bwords = toWords(bsink.syls);
        if (!bwords.length) continue;
        var bspan = wordsSpan(bwords);
        line.background.push({ start: bspan.start, end: bspan.end, words: bwords });
        line.end = Math.max(line.end, bspan.end);
      }

      lines.push(line);
    }

    // missing line ends run to the next line's start (+5s for the last)
    for (var r = 0; r < lines.length; r++) {
      if (lines[r].end <= lines[r].start) {
        lines[r].end = r + 1 < lines.length ? Math.max(lines[r].start, lines[r + 1].start) : lines[r].start + 5000;
      }
    }

    var duration = parseClock(attr(body, "dur")) || (lines.length ? lines[lines.length - 1].end : 0);
    var timing = sawSyllables ? "word" : (lines.some(function (l) { return l.start || l.end; }) ? "line" : "none");
    if (timingAttr === "none") timing = "none";
    return { timing: timing, duration: duration, songwriters: songwriters, lines: lines };
  };

  // Adapter for the Qobuzify API / v1 internal format (times in SECONDS):
  //   { Type:"Syllable"|"Line", Content:[ {Lead:{StartTime,EndTime,Syllables:[{Text,StartTime,EndTime,IsPartOfWord}]},
  //     Background?:[{Syllables:[...]}], OppositeAligned?:bool} | {Text,StartTime,EndTime} ] }
  // Also accepts the full /v2/track envelope: {ok, lyrics:{data}, songwriters:{names}}.
  Lyra.fromLyricsJSON = function (ly, songwriters) {
    if (ly && ly.lyrics && ly.lyrics.data) {
      return Lyra.fromLyricsJSON(ly.lyrics.data,
        (ly.songwriters && ly.songwriters.names) || songwriters);
    }
    if (ly && ly.data && ly.data.Content) return Lyra.fromLyricsJSON(ly.data, songwriters);
    if (!ly || !ly.Content || !ly.Content.length) return null;
    var syllable = ly.Type === "Syllable";
    function grpSyls(syls, fallbackEnd) { // IsPartOfWord=true joins the NEXT syllable (v1 semantics)
      var out = [];
      for (var i = 0; i < (syls || []).length; i++) {
        var s = syls[i];
        var end = s.EndTime;
        if (end == null) { // some responses omit it - run to the next syllable
          var nxt = syls[i + 1];
          end = nxt && nxt.StartTime != null ? nxt.StartTime : (fallbackEnd != null ? fallbackEnd : s.StartTime);
        }
        out.push({
          start: (s.StartTime || 0) * 1000, end: (end || 0) * 1000,
          text: (s.Text || "").replace(/\s+/g, " ").replace(/^ | $/g, ""),
          space: !s.IsPartOfWord,
        });
      }
      return toWords(out);
    }
    var lines = [];
    for (var i = 0; i < ly.Content.length; i++) {
      var it = ly.Content[i];
      if (!it) continue; // tolerate glitched/partial responses
      var L = it.Lead;
      var line = {
        kind: "line", start: 0, end: 0, text: "",
        align: it.OppositeAligned ? "end" : "start",
        agent: null, songPart: null, key: null, words: [], background: [],
      };
      if (syllable && L && L.Syllables) {
        line.words = grpSyls(L.Syllables, L.EndTime);
        line.text = wordsText(line.words);
        line.start = (L.StartTime || 0) * 1000;
        line.end = (L.EndTime || 0) * 1000;
        var sp = wordsSpan(line.words);
        if (sp) { if (!line.start) line.start = sp.start; line.end = Math.max(line.end, sp.end); }
        for (var b = 0; b < (it.Background || []).length; b++) {
          var bgw = grpSyls(it.Background[b] && it.Background[b].Syllables, it.Background[b] && it.Background[b].EndTime);
          if (!bgw.length) continue;
          var bsp = wordsSpan(bgw);
          line.background.push({ start: bsp.start, end: bsp.end, words: bgw });
          line.end = Math.max(line.end, bsp.end);
        }
      } else {
        line.text = normText(it.Text || (L && L.Text) || "");
        line.start = ((it.StartTime != null ? it.StartTime : L && L.StartTime) || 0) * 1000;
        line.end = ((it.EndTime != null ? it.EndTime : L && L.EndTime) || 0) * 1000;
      }
      lines.push(line);
    }
    // Line-type docs from LRC upstreams often have no EndTime; without this
    // repair every gap looks huge and interlude dots spawn everywhere
    for (var r2 = 0; r2 < lines.length; r2++) {
      if (lines[r2].end <= lines[r2].start) {
        lines[r2].end = r2 + 1 < lines.length ? Math.max(lines[r2].start, lines[r2 + 1].start) : lines[r2].start + 5000;
      }
    }
    return {
      timing: syllable ? "word" : "line",
      duration: lines.length ? lines[lines.length - 1].end : 0,
      songwriters: songwriters || [], lines: lines,
    };
  };

  // LRC + enhanced LRC (<mm:ss.xx> word stamps)
  Lyra.fromLRC = function (text) {
    var rows = String(text || "").split(/\r?\n/), lines = [], anyWords = false;
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i].match(/^\s*((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/);
      if (!m) continue;
      var stamps = m[1].match(/\[(\d+):(\d+(?:\.\d+)?)\]/g).map(function (st) {
        var p = st.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
        return (parseInt(p[1], 10) * 60 + parseFloat(p[2])) * 1000;
      });
      var bodyTxt = m[2];
      var words = [];
      var lead = normText(bodyTxt.split(/<\d+:\d+(?:\.\d+)?>/)[0]);
      var wm, wre = /<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g;
      while ((wm = wre.exec(bodyTxt))) {
        var ws = (parseInt(wm[1], 10) * 60 + parseFloat(wm[2])) * 1000;
        var wt = normText(wm[3]);
        if (!wt) continue;
        words.push({ start: ws, end: 0, text: wt, syllables: [{ start: ws, end: 0, text: wt }] });
      }
      for (var s = 0; s < stamps.length; s++) {
        var off = stamps[s] - stamps[0]; // repeat stamps shift word times too
        var lw = words.map(function (wd) { return { start: wd.start + off, end: 0, text: wd.text, syllables: [{ start: wd.start + off, end: 0, text: wd.text }] }; });
        if (lead && lw.length) lw.unshift({ start: stamps[s], end: 0, text: lead, syllables: [{ start: stamps[s], end: 0, text: lead }] });
        lines.push({
          kind: "line", start: stamps[s], end: 0, text: normText(bodyTxt.replace(/<\d+:\d+(?:\.\d+)?>/g, " ")),
          align: "start", agent: null, songPart: null, key: null, words: lw, background: [],
        });
        if (lw.length) anyWords = true;
      }
    }
    lines.sort(function (a, b) { return a.start - b.start; });
    for (var r = 0; r < lines.length; r++) {
      var nx = r + 1 < lines.length ? lines[r + 1].start : lines[r].start + 5000;
      lines[r].end = Math.max(lines[r].start, nx);
      var lws = lines[r].words;
      for (var w = 0; w < lws.length; w++) {
        var we = w + 1 < lws.length ? lws[w + 1].start : lines[r].end;
        lws[w].end = lws[w].syllables[0].end = Math.max(lws[w].start, we);
      }
    }
    if (!lines.length) return null;
    return { timing: anyWords ? "word" : "line", duration: lines[lines.length - 1].end, songwriters: [], lines: lines };
  };

  // sniff the format
  Lyra.parse = function (input) {
    if (input == null) return null;
    if (typeof input === "object") return Lyra.fromLyricsJSON(input);
    var s = String(input).replace(/^﻿/, "").trim();
    if (s[0] === "<") return Lyra.parseTTML(s);
    if (s[0] === "{") { try { return Lyra.fromLyricsJSON(JSON.parse(s)); } catch (e) { return null; } }
    return Lyra.fromLRC(s);
  };
})(typeof window !== "undefined" ? window : globalThis);
