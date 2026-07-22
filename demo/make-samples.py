#!/usr/bin/env python3
# Generates the demo TTML samples with consistent, gap-free syllable timing.
# Lyrics are ORIGINAL (written for this demo) so the samples are freely shippable.
import html

def fmt(t):
    m = int(t // 60)
    s = t - m * 60
    return f"{m}:{s:06.3f}"

# line spec: (start, end, agent, words, bg)
#   words: list of word entries; a word is a string (monosyllable) or list of syllable strings
#   bg: optional (start, end, words) background-vocal group
V1, V2 = "v1", "v2"
L = []
def line(start, end, words, agent=V1, bg=None, part=None):
    L.append((start, end, agent, words, bg, part))

# --- "Northern Light" (original demo lyrics) --------------------------------
line(12.0, 15.2, ["I", "was", ["chas", "ing"], ["sat", "el", "lites"]], part="Verse")
line(15.6, 18.8, ["through", "the", "static", "of", "the", "town"])
line(19.2, 22.6, ["every", "signal", "out", "of", "reach"])
line(23.0, 26.4, ["kept", "on", ["fall", "ing"], "down"])

line(27.4, 30.6, ["then", "a", ["fre", "quen", "cy"], "I", "knew"], part="Verse")
line(31.0, 34.2, ["cut", "the", "silence", "like", "a", "flame"])
line(34.6, 38.0, ["every", ["con", "stel", "la", "tion"], "turned"])
line(38.4, 41.6, ["and", "called", "me", "by", "my", "name"])

line(42.5, 46.0, ["you're", "my", ["north", "ern"], "light"], part="Chorus",
     bg=(44.6, 46.8, ["(my", ["north", "ern"], "light)"]))
line(46.8, 50.2, ["burning", "through", "the", ["gra", "vi", "ty"]])
line(51.0, 54.4, ["when", "the", "dark", "comes", "down"], bg=(53.0, 55.4, ["(comes", ["fall", "ing"], "down)"]))
line(55.0, 58.2, ["you", "find", "me"])

# instrumental 58.2 -> 64.8 (interlude dots)
line(64.8, 68.0, ["tell", "me", "how", "the", ["or", "bit"], "bends"], V1, part="Verse")
line(68.4, 71.6, ["I", "can", "hear", "you", "in", "the", "waves"], V2)
line(72.0, 75.2, ["past", "the", "edge", "of", "every", "map"], V1)
line(74.8, 78.6, ["where", "the", ["ho", "ri", "zon"], "misbehaves"], V2)  # overlaps the v1 line

line(80.0, 84.0, ["hold", "the", "signal"], V2, part="Bridge")
line(84.6, 88.6, ["hold", "it", ["stea", "dy"]], V2)
line(89.2, 95.0, ["we'll", "be", "home", ["soo", "oon"]], V2)  # long-held final syllable

line(96.0, 99.5, ["you're", "my", ["north", "ern"], "light"], part="Chorus",
     bg=(98.1, 100.3, ["(my", ["north", "ern"], "light)"]))
line(100.3, 103.7, ["burning", "through", "the", ["gra", "vi", "ty"]])
line(104.5, 107.9, ["when", "the", "dark", "comes", "down"], bg=(106.5, 108.9, ["(comes", ["fall", "ing"], "down)"]))
line(108.5, 111.7, ["you", "find", "me"])

line(113.0, 117.5, ["shining", "till", "the", "morning", "comes"], part="Outro")

def syllabize(words, start, end):
    """Distribute [start,end] over syllables proportionally to character count."""
    syls = []  # (text, part_of_word_continues)
    for w in words:
        if isinstance(w, str):
            syls.append([w, False])
        else:
            for i, s in enumerate(w):
                syls.append([s, i < len(w) - 1])
    total = sum(len(s[0]) for s in syls)
    out, t = [], start
    for i, (txt, cont) in enumerate(syls):
        dur = (end - start) * len(txt) / total
        e = end if i == len(syls) - 1 else t + dur
        out.append((txt, t, e, cont))
        t = e
    return out

def spans(words, start, end):
    parts = []
    for txt, b, e, cont in syllabize(words, start, end):
        parts.append(f'<span begin="{fmt(b)}" end="{fmt(e)}">{html.escape(txt)}</span>')
        if not cont:
            parts.append(" ")
    if parts and parts[-1] == " ":
        parts.pop()
    return "".join(parts)

body = []
key = 0
cur_div = None
for start, end, agent, words, bg, part in L:
    if part is not None:
        if cur_div is not None:
            body.append("  </div>")
        cur_div = part
        body.append(f'  <div itunes:songPart="{part}">')
    key += 1
    inner = spans(words, start, end)
    if bg:
        bs, be, bw = bg
        inner += f'<span ttm:role="x-bg">{spans(bw, bs, be)}</span>'
    body.append(f'   <p begin="{fmt(start)}" end="{fmt(end)}" itunes:key="L{key}" ttm:agent="{agent}">{inner}</p>')
body.append("  </div>")

word_ttml = f'''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="en">
 <head>
  <metadata>
   <ttm:agent type="person" xml:id="v1"/>
   <ttm:agent type="person" xml:id="v2"/>
   <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <songwriters>
     <songwriter>Lyra Demo</songwriter>
    </songwriters>
   </iTunesMetadata>
  </metadata>
 </head>
 <body dur="{fmt(120.0)}">
{chr(10).join(body)}
 </body>
</tt>
'''

line_lines = [
    (8.0, "City hum and headlight rain"),
    (12.0, "Every window tells a story"),
    (16.0, "I keep walking through the frame"),
    (20.0, "Chasing something transitory"),
    (26.0, "Slow down, slow down"),
    (30.0, "The night is long enough for us"),
    (34.0, "Slow down, slow down"),
    (38.0, "Nobody's keeping score of us"),
    (44.0, "Let the moment come to rest"),
    (48.0, "Let the music do the rest"),
]
lp = []
for i, (t, txt) in enumerate(line_lines):
    e = line_lines[i + 1][0] - 0.3 if i + 1 < len(line_lines) else t + 4.0
    lp.append(f'  <p begin="{fmt(t)}" end="{fmt(e)}" itunes:key="L{i+1}">{html.escape(txt)}</p>')

line_ttml = f'''<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Line" xml:lang="en">
 <head><metadata/></head>
 <body dur="0:52.000">
{chr(10).join(lp)}
 </body>
</tt>
'''

import pathlib
here = pathlib.Path(__file__).parent
(here / "sample-word.ttml").write_text(word_ttml)
(here / "sample-line.ttml").write_text(line_ttml)
print("wrote", here / "sample-word.ttml", len(word_ttml), "bytes")
print("wrote", here / "sample-line.ttml", len(line_ttml), "bytes")
