"use strict";
// Records the browser panel, and mixes its sound. main.js answers the capture request with the
// panel's page, so no picker appears; the encoded pieces go back to main.js, which writes the file.
//
// The sound does not go to the file as it comes. It passes through a small mixer here (Web Audio):
//   the page's sound -> its volume --+
//   the microphone   -> its volume --+--> (limiter) --> the recording, and the level meter
// so the mixer in Link's window (see "the sound" in main.js) can set how loud a stream is in its
// recording, add the user's voice, and show levels, while the recording runs. The page's own volume
// and what the user hears are not touched. The mixer plays nothing itself: it only feeds the
// recording. If it cannot start, the page's sound is recorded as it comes, as before.
//
// While nothing records, the same mixer can listen to the page's sound alone (the "tap") so the meter
// moves before Record is pressed. The microphone is opened only while a recording uses it.
//
// Hearing it: switching a page's own sound on in the loudspeakers makes Chromium reopen its output,
// and whatever is recording it gets about a second of silence. So main.js keeps a page silent itself
// for as long as it records, and this page plays it to the loudspeakers instead (the "ear": the
// page's sound as it comes, without the recording's volume or the microphone). Whether the user hears
// a recording stream is then a volume here, which the recording never notices.
const TYPES = ["video/x-matroska;codecs=avc1,opus", "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"];
const PAGE_SOUND = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const QUIET = -60;                    // decibels at which a volume counts as off
let recorder = null, stream = null;   // the recording: the page's picture and sound
let mixed = false;                    // whether the recording's sound goes through the mixer
let tap = null;                       // the page's sound alone, for the meter while nothing records
let sent = Promise.resolve();         // pieces are sent in the order they were made
let cfg = { gain: 0, limiter: false, mono: false, mic: null, meter: false, tap: false, heard: false };
let g = null;                         // the mixer, built when first needed
let micKey = "", micNote = "";        // which microphone is open (device and options), and what went wrong
let ear = null;                       // the user's loudspeakers, while the recording's page is kept silent itself
let chain = Promise.resolve();        // changes to the tap and the microphone happen one at a time
let meterTimer = null;

const amp = (db) => (db <= QUIET ? 0 : 10 ** (db / 20));
const toDb = (a) => (a > 0 ? Math.max(-100, 20 * Math.log10(a)) : -100);

function mixer() {
  if (g) return g;
  // The mixer keeps time by the PC's sound output, although it plays nothing there (see `hush` below).
  // An engine with no output at all ({ sinkId: none }) keeps time by a timer instead, and Windows
  // slows the timers of a program whose window is minimised or fully covered: the mixer then made
  // only two thirds of the sound, and the recording had holes for as long as Link was out of sight.
  // Only a PC without any sound output gets that engine.
  let ctx, driven = true;
  try { ctx = new AudioContext({ latencyHint: "interactive" }); }
  catch (e) { ctx = new AudioContext({ latencyHint: "interactive", sinkId: { type: "none" } }); driven = false; }
  const page = ctx.createGain(), mic = ctx.createGain(), sum = ctx.createGain(), out = ctx.createGain();
  // The limiter, in two steps. A compressor: nothing below -6 dB is changed, what is above is held
  // back 20 to 1. It adds make-up gain of its own ((1 / gain at full level) ^ 0.6); `trim` takes that
  // back. It needs a moment to react, so fast peaks get past it; behind it a soft clipper rounds
  // those off: unchanged up to 0.63 of full scale (-4 dB), then bending over so that nothing, however
  // loud it came in, goes above 0.8 (-2 dB). The 2 dB left under full scale are for the file's sound
  // format, which overshoots a little on dense sound. (The shaper only knows -1 to 1, so it works at
  // half level.)
  const limit = ctx.createDynamicsCompressor(), trim = ctx.createGain(), soft = ctx.createWaveShaper();
  limit.threshold.value = -6; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.12;
  trim.gain.value = (10 ** ((-6 + 6 / 20) / 20)) ** 0.6 * 0.5;
  const curve = new Float32Array(8193);
  for (let i = 0; i < curve.length; i++) {
    const u = (i / (curve.length - 1)) * 2 - 1, a = Math.abs(u);
    curve[i] = Math.sign(u) * (a <= 0.315 ? 2 * a : 0.63 + 0.17 * (1 - (1 - (a - 0.315) / 0.685) ** (2 * 0.685 / 0.17)));
  }
  soft.curve = curve;
  soft.oversample = "4x";
  // The meter looks at the left and the right side separately and shows the louder one.
  const sides = ctx.createChannelSplitter(2), meter = [ctx.createAnalyser(), ctx.createAnalyser()], micMeter = ctx.createAnalyser();
  meter[0].fftSize = meter[1].fftSize = micMeter.fftSize = 4096;
  const dest = ctx.createMediaStreamDestination();
  page.connect(sum); mic.connect(sum); mic.connect(micMeter);
  limit.connect(trim); trim.connect(soft); soft.connect(out);
  out.connect(dest); out.connect(sides);
  sides.connect(meter[0], 0); sides.connect(meter[1], 1);
  // To the output goes silence only: what the user hears is the ear's business, not the mixer's.
  if (driven) { const hush = ctx.createGain(); hush.gain.value = 0; out.connect(hush); hush.connect(ctx.destination); }
  g = { ctx, page, mic, sum, out, limit, meter, micMeter, dest, src: null, micSrc: null, micStream: null, limited: null };
  apply();
  return g;
}

// The settings as they are now: the volumes glide (no click), mono folds both sides into one.
function apply() {
  if (!g) return;
  const now = g.ctx.currentTime;
  g.page.gain.setTargetAtTime(amp(cfg.gain), now, 0.015);
  g.mic.gain.setTargetAtTime(cfg.mic ? amp(cfg.mic.gain) : 0, now, 0.015);
  g.sum.channelCountMode = cfg.mono ? "explicit" : "max";
  g.sum.channelCount = cfg.mono ? 1 : 2;
  // The limiter is in when asked for, and by itself whenever the sound could go over the top:
  // a volume above 0 dB, or the microphone added to the stream.
  const limited = !!cfg.limiter || cfg.gain > 0 || !!cfg.mic;
  if (g.limited !== limited) {
    g.sum.disconnect();
    g.sum.connect(limited ? g.limit : g.out);
    g.limited = limited;
  }
}

async function running() {
  try {
    mixer();
    if (g.ctx.state !== "running") await Promise.race([g.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
    return g.ctx.state === "running";
  } catch (e) {
    return false;
  }
}

// Which sound the mixer's page input hears: the recording's, the tap's, or none.
function listenTo(source) {
  if (!g) return;
  if (g.src) g.src.disconnect();
  const track = source && source.getAudioTracks()[0];
  g.src = track ? g.ctx.createMediaStreamSource(new MediaStream([track])) : null;
  if (g.src) g.src.connect(g.page);
}

const stopTracks = (s) => { if (s) s.getTracks().forEach((t) => t.stop()); };

// The ear exists while a recording runs through the mixer; its volume is whether the user hears it.
function listen() {
  const track = stream && mixed ? stream.getAudioTracks()[0] : null;
  if (track && !ear) {
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" });   // the loudspeakers Windows uses
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(gain).connect(ctx.destination);
      ear = { ctx, gain };
    } catch (e) {
      ear = null;
    }
  } else if (!track && ear) {
    ear.ctx.close().catch(() => {});
    ear = null;
  }
  if (ear) ear.gain.gain.setTargetAtTime(cfg.heard ? 1 : 0, ear.ctx.currentTime, 0.02);
  return !!ear && ear.ctx.state === "running";
}
const report = () => window.rec.engine({ mixed: !!stream && mixed, raw: !!stream && !mixed, mic: g && g.micSrc ? "on" : micNote });

// The tap follows what is asked: on while the meters are watched and nothing records.
function setTap() {
  chain = chain.then(async () => {
    const want = cfg.tap && !stream;
    if (want && !tap) {
      if (!(await running())) return;
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: PAGE_SOUND });
      s.getVideoTracks().forEach((t) => t.stop());   // only its sound is wanted
      if (stream || !cfg.tap) return stopTracks(s);  // a recording began, or the meters closed, meanwhile
      tap = s;
      listenTo(tap);
    } else if (!want && tap) {
      stopTracks(tap);
      tap = null;
      if (!stream) listenTo(null);
    }
  }).catch(() => {});
  return chain;
}

// The microphone: open while this recording is to have it, with the options asked for.
function setMic() {
  chain = chain.then(async () => {
    const m = cfg.mic && stream && mixed ? cfg.mic : null;
    const key = m ? JSON.stringify([m.device, !!m.noise, !!m.echo, !!m.auto]) : "";
    if (cfg.mic && stream && !mixed) micNote = "The mixer is off for this recording, so the microphone is not in it.";
    else if (!cfg.mic) micNote = "";
    if (key !== micKey) {
      micKey = key;
      if (g && g.micSrc) g.micSrc.disconnect();
      if (g) { stopTracks(g.micStream); g.micSrc = g.micStream = null; }
      if (m) {
        try {
          g.micStream = await navigator.mediaDevices.getUserMedia({ audio: {
            deviceId: m.device ? { exact: m.device } : undefined, noiseSuppression: !!m.noise, echoCancellation: !!m.echo, autoGainControl: !!m.auto } });
          g.micSrc = g.ctx.createMediaStreamSource(g.micStream);
          g.micSrc.connect(g.mic);
          micNote = "";
        } catch (e) {
          micNote = e.name === "NotFoundError" || e.name === "OverconstrainedError" ? "That microphone is not connected." : `The microphone could not be opened (${e.name}).`;
        }
      }
    }
    report();
  }).catch(() => {});
  return chain;
}

// The meter: the loudest and the average level of what goes to the recording, 12 times a second.
const scope = new Float32Array(4096);
function levelOf(node) {
  node.getFloatTimeDomainData(scope);
  let peak = 0, squares = 0;
  for (let i = 0; i < scope.length; i++) {
    const a = Math.abs(scope[i]);
    if (a > peak) peak = a;
    squares += scope[i] * scope[i];
  }
  return [Math.round(toDb(peak) * 10) / 10, Math.round(toDb(Math.sqrt(squares / scope.length)) * 10) / 10];
}
function measure() {
  if (!g || g.ctx.state !== "running" || !(tap || (stream && mixed))) return window.rec.level(null);
  const [l, r] = [levelOf(g.meter[0]), levelOf(g.meter[1])];
  const peak = Math.max(l[0], r[0]), rms = Math.max(l[1], r[1]);
  window.rec.level({ peak, rms, mic: g.micSrc ? levelOf(g.micMeter)[0] : null });
}
function setMeter() {
  if (cfg.meter && !meterTimer) meterTimer = setInterval(measure, 80);
  if (!cfg.meter && meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
}

window.rec.onAudio((next) => {
  cfg = { ...cfg, ...next };
  apply();
  listen();
  setMic();
  setTap();
  setMeter();
});

function release() {
  stopTracks(stream);
  stream = recorder = null;
  mixed = false;
  listen();   // the ear closes: main.js lets the page play by itself again
  listenTo(null);
  setMic();   // closes the microphone
  setTap();   // the meter goes on listening if it is watched
}

window.rec.onStart(async ({ width, height, videoBits, audioBits, audio }) => {
  try {
    if (audio) cfg = { ...cfg, ...audio };
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: width, max: width }, height: { ideal: height, max: height }, frameRate: { ideal: 30, max: 30 } },
      audio: PAGE_SOUND,
    });
    const video = stream.getVideoTracks()[0];
    // One size for the whole file, whatever happens to the panel while it is recorded.
    await video.applyConstraints({ width: { min: width, max: width }, height: { min: height, max: height }, frameRate: { max: 30 } }).catch(() => {});
    let sound = stream.getAudioTracks()[0] || null;
    mixed = await running();
    if (mixed) {
      await chain;                       // a tap being opened or closed finishes first
      stopTracks(tap);
      tap = null;
      listenTo(stream);
      apply();
      sound = g.dest.stream.getAudioTracks()[0];
      // The page's sound takes a moment to come through the mixer. Started at once, the file had
      // picture from the first instant and sound only a third to half a second later.
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    recorder = new MediaRecorder(new MediaStream(sound ? [video, sound] : [video]),
      { mimeType: TYPES.find((t) => MediaRecorder.isTypeSupported(t)), videoBitsPerSecond: videoBits, audioBitsPerSecond: audioBits });
    recorder.ondataavailable = (event) => {
      if (event.data.size) sent = sent.then(async () => window.rec.chunk(await event.data.arrayBuffer()));
    };
    recorder.onerror = (event) => window.rec.failed(`The recorder stopped: ${event.error ? event.error.message : "unknown error"}`);
    recorder.onstop = () => sent.then(() => { release(); window.rec.stopped(); });
    video.onended = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };  // the page went away
    recorder.start(1000);
    setMic();
    const size = video.getSettings();
    // `ear`: whether this page plays the stream to the user, so main.js can keep the stream's own page silent
    window.rec.started({ width: size.width, height: size.height, audio: !!sound, mixed, ear: mixed && listen(),
      lag: ear ? Math.round(((ear.ctx.baseLatency || 0) + (ear.ctx.outputLatency || 0)) * 1000) : null });
  } catch (e) {
    release();
    window.rec.failed(`The capture could not start (${e.name}: ${e.message}).`);
  }
});

window.rec.onStop(() => {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else window.rec.stopped();
});
