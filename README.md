# Lyra

Apple Music-style karaoke lyrics for the web. Word-by-word gradient sweep, glow,
springy cascade scroll, depth blur, interlude dots, duets, background vocals, and
a drifting album-art background. Plain JS, zero dependencies, one global (`Lyra`).

Written from scratch to replace the AGPL renderer bundle I was stuck with in
qobuzify-lyrics. Clean-room - none of that code was read, everything here comes
from public TTML docs and staring at how the real players behave.

## Usage

```html
<script src="dist/lyra.js"></script>
```

```js
var r = Lyra.create({
  mount: document.getElementById("lyrics"),     // any positioned container
  getPos: function () { return player.positionMs; },
  isPlaying: function () { return player.playing; },
  onSeek: function (ms) { player.seekTo(ms); },
  onClose: function () { ... },                 // optional, adds an X button
  onRefetch: function () { ... },               // optional, adds a "Wrong lyrics?" pill.
                                                // Do your re-fetch + r.load(newLyrics), then
                                                // resolve with a short message to toast (or null)
});
r.load(ttmlString);     // or LRC, or a Qobuzify /v2/track response - it sniffs
r.setCover(artUrl);
r.start();
```

`r.stats()` gives you frame timings and style-write counts if you want receipts.
Settings and every motion knob live in `DEFAULTS` at the top of `src/engine.js`,
all documented inline.

Input formats: Apple-style syllable TTML (Word/Line/None timing, `ttm:agent`
duets, `x-bg` background vocals, songwriters, all the clock formats real files
use, tolerant of pretty-printed whitespace), the Qobuzify lyrics API JSON, and
LRC / enhanced LRC.

## Performance notes

The reason this exists instead of using an off-the-shelf renderer: no stutter,
ever, including alt-tab. The short version of how:

- DOM is built once per track and never rebuilt. No virtual list.
- One rAF loop with zero layout reads. Geometry is measured in a single batched
  pass on build / resize / font load.
- Only compositor properties animate (translate / scale / opacity). Blur levels
  step instead of transitioning - blur transitions run on the main thread.
- The gradient sweep repaints exactly one small syllable span per frame, driven
  by a registered `@property` var.
- Word emphasis is a per-frame envelope, not CSS transitions, so dense tracks
  with zero gap between words stay smooth. Scale growth is capped in absolute
  pixels so long words can't shove into their neighbours.
- Scroll is a spring on the container transform (never scrollTop), tempo-adaptive
  so ballads feel weighty and fast tracks feel snappy. The cascade is lines
  replaying the container's motion history with a per-line delay.
- Seeks and tab-visibility returns snap with transitions disabled for two frames.
  No catch-up storm when you come back to the window.
- Paused and settled costs zero style writes per second.

## Electron

If lyrics should keep animating while the window is fully hidden, create the
BrowserWindow with `webPreferences: { backgroundThrottling: false }`. Otherwise
rAF stops when hidden and Lyra resyncs with a clean snap on return, which is
honestly the better default.

On teardown call `r.destroy()`, not just `stop()` - destroy releases the rAF
loop, a document-level visibilitychange listener, the ResizeObserver, the
background layers and the DOM. After destroy the instance is dead for good.

## Demo / tests

```
python3 -m http.server 8317
# http://localhost:8317/demo/           two bundled TTML samples + live API fetch
# http://localhost:8317/demo/test.html  parser test suite
```

The bundled sample lyrics are original (written for the demo), so they're safe
to ship. `demo/make-samples.py` regenerates them.

## Build

`./build.sh` - concatenates `src/*.js` into `dist/lyra.js`. No transpiler.
Needs Chromium 104+ / any current Electron (`translate`/`scale` properties,
`@property`).
