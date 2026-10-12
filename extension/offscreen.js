"use strict";
// The recorder: a page nobody sees, made by background.js when the stream's tab is first captured and
// closed when the capture is over and its files have been saved. It takes the tab's picture and sound,
// encodes them once, and does two things with what comes out:
//
//   rewind     the last few minutes are kept in memory (the "ring"), so a moment can be saved after it
//              happened: "save" makes a file of the last N seconds, and a recording started while the
//              rewind is on begins N seconds back
//   recording  from when Record is pressed until Stop, written piece by piece into the extension's own
//              private storage (half an hour of stream is over a gigabyte, too much for memory)
//
// One encoder serves both. Chrome's recorder gives an mp4 as a stream of pieces: a head that describes
// the tracks, then one "fragment" a second, each stamped with the time it starts at. A file that begins
// later than the encoder did is the head and the fragments from there on, with their times moved back
// so that the file starts at zero; it has to begin at a fragment whose first picture is a whole one (a
// key frame, asked for every two seconds). That is what lastOf() and rebase() do; the boxes they read
// are named as the mp4 format names them (moov, trak, mdhd, moof, traf, tfhd, tfdt, trun).
//
// Beside the picture it keeps what content.js reports each second (chat messages, an ad playing) and
// the highlights marked, by the user or by itself when the chat suddenly speeds up.
//
// A tab that is being captured goes silent for the user, so its sound is played back from here.
//
// The capture is the whole tab: the site's menus and the chat with the stream. With "record only the
// stream" each frame is cut down to where content.js says the stream's picture is (it says so every
// second, so the cut follows when the player is resized) and drawn at one steady size, which is what
// goes into the file. The page itself is not touched.
const MAX_SECONDS = 30 * 60;   // Link Lite records up to half an hour; Link itself has no such end
const RING_SECONDS = 180;      // how far back the rewind reaches
const KEY_EVERY = 2000;        // milliseconds between key frames: how exactly a cut can be placed
const VIDEO_BITS = 6e6;        // as Link's own recorder: at most about 45 MB a minute
const AUDIO_BITS = 160e3;
// mp4 first: Link takes mp4 and mkv, and only an mp4 can be cut (the rewind). The others are for a Chrome that cannot make one.
const TYPES = [
  ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"], ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"], ["video/mp4", "mp4"],
  ["video/x-matroska;codecs=avc1,opus", "mkv"], ["video/webm;codecs=h264,opus", "webm"], ["video/webm;codecs=vp9,opus", "webm"], ["video/webm", "webm"],
];
// A highlight is marked by itself when the chat, over five seconds, is this many times its usual speed
// (and at least this many messages), a few seconds before the chat reacted; then not again for a while.
const SPIKE = { times: 3, least: 8, window: 5, usual: 90, back: 6, rest: 45, most: 12 };

let cap = null;            // the capture that runs
const kept = new Map();    // address of a finished file -> its name in storage (or null: it is in memory)
const blobs = new Map();   // address of a finished file -> the file itself, for tag()
let files = 0;

// ---------------------------------------------------------------- reading the mp4

const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const kind = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
// The boxes inside the bytes from `from` to `to`: [type, where its content starts, where it ends].
function* boxes(b, from, to) {
  for (let at = from; at + 8 <= to;) {
    let size = u32(b, at), head = 8;
    if (size === 1) { size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12); head = 16; }
    if (size < head || at + size > to) return;
    yield [kind(b, at + 4), at + head, at + size];
    at += size;
  }
}
const inside = (b, from, to, type) => { for (const box of boxes(b, from, to)) if (box[0] === type) return box; return null; };

// From the head: each track's number of time units a second, and which one is the picture.
function tracksOf(head) {
  const tracks = {}, moov = inside(head, 0, head.length, "moov");
  if (!moov) return tracks;
  for (const [type, a, z] of boxes(head, moov[1], moov[2])) {
    if (type !== "trak") continue;
    const tkhd = inside(head, a, z, "tkhd"), mdia = inside(head, a, z, "mdia");
    if (!tkhd || !mdia) continue;
    const id = u32(head, tkhd[1] + (head[tkhd[1]] === 1 ? 20 : 12));
    const mdhd = inside(head, mdia[1], mdia[2], "mdhd"), hdlr = inside(head, mdia[1], mdia[2], "hdlr");
    if (!mdhd) continue;
    tracks[id] = { scale: u32(head, mdhd[1] + (head[mdhd[1]] === 1 ? 20 : 12)), video: !!hdlr && kind(head, hdlr[1] + 8) === "vide" };
  }
  return tracks;
}

// A fragment's times: for each track where its time stamp is, when it starts and ends (seconds), and
// whether its first picture is a key frame.
function readFragment(b, tracks) {
  const out = { stamps: [], t: null, end: null, key: true };
  const moof = inside(b, 0, b.length, "moof");
  if (!moof) return out;
  for (const [type, a, z] of boxes(b, moof[1], moof[2])) {
    if (type !== "traf") continue;
    const tfhd = inside(b, a, z, "tfhd"), tfdt = inside(b, a, z, "tfdt");
    if (!tfhd || !tfdt) continue;
    const id = u32(b, tfhd[1] + 4), track = tracks[id];
    if (!track) continue;
    const wide = b[tfdt[1]] === 1, at = tfdt[1] + 4;
    const time = wide ? u32(b, at) * 2 ** 32 + u32(b, at + 4) : u32(b, at);
    out.stamps.push({ at, wide, time, scale: track.scale });
    const seconds = time / track.scale;
    if (out.t === null || seconds < out.t) out.t = seconds;
    // what the track's header says for every sample that does not say otherwise: its length and its flags
    const hf = u32(b, tfhd[1]) & 0xffffff;
    let flags = null, each = 0, p = tfhd[1] + 8;
    if (hf & 0x1) p += 8;
    if (hf & 0x2) p += 4;
    if (hf & 0x8) { each = u32(b, p); p += 4; }
    if (hf & 0x10) p += 4;
    if (hf & 0x20) flags = u32(b, p);
    // how long the fragment is: its samples' lengths added up
    let length = 0;
    for (const [runType, ra, rz] of boxes(b, a, z)) {
      if (runType !== "trun") continue;
      const rf = u32(b, ra) & 0xffffff, count = u32(b, ra + 4);
      if (!(rf & 0x100)) { length += count * each; continue; }
      const step = 4 * (1 + !!(rf & 0x200) + !!(rf & 0x400) + !!(rf & 0x800));
      for (let i = 0, q = ra + 8 + (rf & 0x1 ? 4 : 0) + (rf & 0x4 ? 4 : 0); i < count && q + 4 <= rz; i++, q += step) length += u32(b, q);
    }
    const ends = (time + length) / track.scale;
    if (out.end === null || ends > out.end) out.end = ends;
    if (!track.video) continue;
    // the first picture's flags: said for it alone, or for each picture, or once for all of them
    const trun = inside(b, a, z, "trun");
    if (trun) {
      const tf = u32(b, trun[1]) & 0xffffff;
      let q = trun[1] + 8;
      if (tf & 0x1) q += 4;
      if (tf & 0x4) flags = u32(b, q);
      else if (tf & 0x400) { if (tf & 0x100) q += 4; if (tf & 0x200) q += 4; flags = u32(b, q); }
    }
    if (flags !== null) out.key = !(flags & 0x10000);
  }
  return out;
}

// A copy of a fragment whose times are `base` seconds earlier, so that a file may begin with it.
function rebase(fragment, base) {
  if (!base) return fragment.bytes;
  const copy = fragment.bytes.slice();
  for (const s of fragment.stamps) {
    const time = Math.max(0, s.time - Math.round(base * s.scale));
    if (s.wide) { const hi = Math.floor(time / 2 ** 32), lo = time >>> 0; copy.set([hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255], s.at); }
    else copy.set([time >>> 24, (time >>> 16) & 255, (time >>> 8) & 255, time & 255], s.at);
  }
  return copy;
}

// What the encoder hands over, cut into its boxes: the head first, then fragment after fragment.
function take(mine, bytes) {
  const all = new Uint8Array(mine.pend.length + bytes.length);
  all.set(mine.pend);
  all.set(bytes, mine.pend.length);
  let at = 0;
  while (at + 8 <= all.length) {
    let size = u32(all, at);
    if (size === 1) { if (at + 16 > all.length) break; size = u32(all, at + 8) * 2 ** 32 + u32(all, at + 12); }
    if (size < 8 || at + size > all.length) break;
    const type = kind(all, at + 4), box = all.slice(at, at + size);
    at += size;
    if (type === "moof") mine.moof = box;
    else if (type === "mdat" && mine.moof) {
      const whole = new Uint8Array(mine.moof.length + box.length);
      whole.set(mine.moof);
      whole.set(box, mine.moof.length);
      mine.moof = null;
      fragment(mine, whole);
    } else if (!mine.headDone) mine.headParts.push(box);
  }
  mine.pend = all.slice(at);
}

function fragment(mine, bytes) {
  if (!mine.headDone) {
    mine.headDone = true;
    mine.head = new Uint8Array(mine.headParts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of mine.headParts) { mine.head.set(p, at); at += p.length; }
    mine.headParts = [];
    mine.tracks = tracksOf(mine.head);
  }
  const read = readFragment(bytes, mine.tracks);
  const t = read.t === null ? mine.videoEnd : read.t;
  const f = { bytes, stamps: read.stamps, key: read.key, t, end: read.end === null || read.end <= t ? t + 1 : read.end };
  // the clock: where the video's own time has got to, and when that was
  mine.videoEnd = Math.max(mine.videoEnd, f.end);
  mine.videoAt = Date.now();
  mine.behind = Math.min(mine.behind, (mine.videoAt - mine.since) / 1000 - mine.videoEnd);   // the soonest a fragment has come after its own end
  mine.ring.push(f);
  while (mine.ring.length > 2 && mine.ring[0].t < mine.videoEnd - RING_SECONDS - 4) mine.ring.shift();
  if (mine.file) fileTake(mine, f);
}

// The fragments a file that begins `seconds` back from now is made of: from a key frame on.
function lastOf(mine, seconds) {
  const ring = mine.ring;
  if (!ring.length) return [];
  const from = mine.videoEnd - seconds;
  let i = ring.findIndex((f) => f.key && f.t >= from - 0.05);
  if (i < 0) i = ring.findIndex((f) => f.key);
  return i < 0 ? [] : ring.slice(i);
}

// ---------------------------------------------------------------- the recording's file

function fileTake(mine, f) {
  const file = mine.file;
  if (file.base === null) {
    if (!f.key) return;        // a file begins at a key frame
    file.base = f.t;
    file.write(mine.head);
  }
  file.write(rebase(f, file.base));
}

async function openFile(mine) {
  const root = await navigator.storage.getDirectory();
  const name = `recording-${++files}.${mine.ext}`;
  const handle = await root.getFileHandle(name, { create: true });
  const out = await handle.createWritable();
  const file = { name, handle, out, base: null, opened: now(mine), written: Promise.resolve(), failed: "" };   // base: where in the video's time the file begins, once its first fragment is in
  file.write = (bytes) => { file.written = file.written.then(() => out.write(bytes)).catch((e) => { file.failed = file.failed || e.message; }); };
  return file;
}

// ---------------------------------------------------------------- capture

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// The picture the file gets: the stream cut out of the tab's frames. `view` is where it is, as content.js measures it.
function cutOut(track, view) {
  const shrink = Math.min(1, 1920 / (view.w * view.dpr), 1080 / (view.h * view.dpr));   // at most 1080p, never enlarged
  const W = even(view.w * view.dpr * shrink), H = even(view.h * view.dpr * shrink);
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d", { alpha: false });
  const made = new MediaStreamTrackGenerator({ kind: "video" });
  const state = { view, track: made, width: W, height: H };
  const cut = new TransformStream({
    transform(frame, controller) {
      const v = state.view, fw = frame.displayWidth, fh = frame.displayHeight;
      // the frame is the tab's page scaled to fit it, in the middle
      const k = Math.min(fw / v.vw, fh / v.vh), ox = (fw - v.vw * k) / 2, oy = (fh - v.vh * k) / 2;
      const sx = ox + v.x * k, sy = oy + v.y * k, sw = v.w * k, sh = v.h * k;
      const fit = Math.min(W / sw, H / sh), dx = (W - sw * fit) / 2, dy = (H - sh * fit) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, sw * fit, sh * fit);
      ctx.clip();
      ctx.setTransform(fit, 0, 0, fit, dx - sx * fit, dy - sy * fit);
      ctx.drawImage(frame, 0, 0, fw, fh);
      ctx.restore();
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration || undefined });
      frame.close();
      controller.enqueue(out);
    },
  });
  new MediaStreamTrackProcessor({ track }).readable.pipeThrough(cut).pipeTo(made.writable).catch(() => {});
  return state;
}

async function emptyStore() {
  const root = await navigator.storage.getDirectory();
  const held = new Set([...kept.values()].filter(Boolean));
  for await (const name of root.keys()) if (!held.has(name)) await root.removeEntry(name).catch(() => {});
}

// Starts taking the tab's picture and sound. `record`: a recording starts with it; otherwise only the rewind runs.
async function start({ streamId, meta, view, screen, record, autoMarks, volume: level }) {
  if (cap) return { ok: false, error: "The tab is being captured already." };
  await emptyStore();
  const from = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
  // the tab as it is on screen, pixel for pixel (up to 4K), so that nothing is enlarged or squeezed on the way
  const full = screen ? { maxWidth: Math.min(3840, even(screen.vw * screen.dpr)), maxHeight: Math.min(2160, even(screen.vh * screen.dpr)) } : { maxWidth: 1920, maxHeight: 1080 };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: from },
    video: { mandatory: { ...from, ...full, maxFrameRate: 30 } },
  });
  const video = stream.getVideoTracks()[0];
  let crop = null;
  if (view && typeof MediaStreamTrackProcessor === "function" && typeof MediaStreamTrackGenerator === "function") {
    try { crop = cutOut(video, view); } catch (e) { crop = null; }   // it is recorded whole instead
  }
  // the user goes on hearing the stream, as loud as they chose in the panel; the recording itself is not
  // turned down with it (it takes the tab's sound as it comes)
  let ear = null, gain = null;
  const vol = heardAt(level);
  try {
    ear = new AudioContext();
    gain = ear.createGain();
    gain.gain.value = vol * vol;
    ear.createMediaStreamSource(stream).connect(gain).connect(ear.destination);
  } catch (e) { /* no sound output: it is recorded all the same */ }
  const type = TYPES.find(([mime]) => MediaRecorder.isTypeSupported(mime));
  if (!type) { stream.getTracks().forEach((t) => t.stop()); return { ok: false, error: "This browser cannot encode a recording." }; }
  const filed = crop ? new MediaStream([crop.track, ...stream.getAudioTracks()]) : stream;
  const recorder = new MediaRecorder(filed, { mimeType: type[0], videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS, videoKeyFrameIntervalDuration: KEY_EVERY });
  const mine = cap = {
    recorder, stream, crop, ear, gain, vol, ext: type[1], cuts: type[1] === "mp4", since: Date.now(), meta: meta || {}, autoMarks: autoMarks !== false,
    pend: new Uint8Array(0), moof: null, headParts: [], headDone: false, head: null, tracks: {}, ring: [], taken: Promise.resolve(),
    file: null, armed: !record, ending: null, timer: null, over: false, videoEnd: 0, videoAt: 0, behind: Infinity,
    marks: [], rate: [], adAt: [], chatSeen: false, lastAuto: -1e9, hidden: false, muted: false, inPicture: false,
  };
  if (record) mine.file = await openFile(mine);
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    mine.taken = mine.taken.then(async () => {
      const bytes = new Uint8Array(await event.data.arrayBuffer());
      if (mine.cuts) take(mine, bytes);
      else if (mine.file) { mine.file.base = 0; mine.file.write(bytes); }   // not an mp4: written as it comes, and there is no rewind
    }).catch(() => {});
  };
  recorder.onerror = () => endBySelf("The recorder stopped by itself.");
  video.onended = () => endBySelf("The stream's tab was closed, so the recording ended there.");
  recorder.start(1000);
  if (record) lengthLimit(mine);
  const size = crop || video.getSettings();
  return { ok: true, since: mine.since, width: size.width, height: size.height, cut: !!crop, rewind: mine.cuts };
}

// How loud the user hears the stream while its tab is captured: 0 to 1 on the panel's slider, squared on
// its way to the speakers, which is nearer to how loudness is heard. Nothing given: full, as it always was.
const heardAt = (level) => (level == null || !Number.isFinite(Number(level)) ? 1 : Math.max(0, Math.min(1, Number(level))));
function volume({ level }) {
  if (!cap || cap.over || !cap.gain) return { ok: false };
  cap.vol = heardAt(level);
  cap.gain.gain.setTargetAtTime(cap.vol * cap.vol, cap.ear.currentTime, 0.02);
  return { ok: true, level: cap.vol };
}

function lengthLimit(mine) {
  clearTimeout(mine.timer);
  mine.timer = setTimeout(() => endBySelf("Link Lite records up to 30 minutes at a time. The recording was saved at that point.", true), MAX_SECONDS * 1000);
}

// The clock everything here goes by: seconds of the video's own time, which is what a file is cut by.
// The video's time starts a few seconds after the capture does, and fragments come two seconds apart and
// late; so the time is the PC's clock since the capture began, less how far the video runs behind it,
// which is learnt from the fragment that came soonest after its own end.
const now = (mine) => Math.max(0, (Date.now() - mine.since) / 1000 - (Number.isFinite(mine.behind) ? mine.behind - 0.2 : 0));

// The rewind is on and Record was pressed: the recording begins `back` seconds ago.
async function record({ back }) {
  if (!cap || cap.over) return { ok: false, error: "The tab is not being captured." };
  if (cap.file) return { ok: false, error: "A recording is running already." };
  const mine = cap;
  await mine.taken;
  const file = await openFile(mine);
  const begin = mine.cuts ? lastOf(mine, Math.max(0, Number(back) || 0) + 1) : [];
  mine.file = file;
  for (const f of begin) fileTake(mine, f);
  lengthLimit(mine);
  return { ok: true, back: file.base === null ? 0 : Math.max(0, now(mine) - file.base) };
}

// What was noted between two moments of the capture, as the files beside a recording hold it.
function notedIn(mine, a, b) {
  const within = mine.marks.filter((m) => m.t >= a && m.t <= b);
  const auto = within.filter((m) => m.auto).sort((x, y) => y.score - x.score).slice(0, SPIKE.most);
  const marks = within.filter((m) => !m.auto || auto.includes(m)).sort((x, y) => x.t - y.t);
  const at = (t) => Math.round((t - a) * 10) / 10;
  const rate = [];
  for (let s = Math.floor(a); s < Math.ceil(b); s++) rate.push(mine.rate[s] || 0);
  const ads = [];
  for (const t of mine.adAt) {
    if (t < a - 2 || t > b + 2) continue;
    const x = Math.max(0, t - 2 - a), y = Math.min(b - a, t + 2 - a);
    if (ads.length && x <= ads[ads.length - 1][1]) ads[ads.length - 1][1] = Math.round(y);
    else if (y > x) ads.push([Math.round(x), Math.round(y)]);
  }
  return {
    marks: marks.map((m) => at(m.t)),
    notes: marks.filter((m) => m.note || m.auto).map((m) => ({ t: at(m.t), note: m.note || "", ...(m.auto ? { auto: true } : {}) })),
    chat: mine.chatSeen && mine.meta.channel ? { channel: mine.meta.channel, site: mine.meta.site, rate } : null,
    ads, category: mine.meta.category || "",
  };
}

// Ends the recording's file and says what was recorded. The capture goes on if the rewind is on.
function stop() {
  if (!cap || !cap.file) return Promise.resolve({ ok: false, error: "Nothing is being recorded." });
  const mine = cap;
  if (mine.ending) return mine.ending;
  clearTimeout(mine.timer);
  mine.ending = (async () => {
    const goesOn = mine.armed && !mine.over;
    if (!goesOn) await endCapture(mine);
    else { try { mine.recorder.requestData(); } catch (e) { /* it comes with the next piece */ } await new Promise((r) => setTimeout(r, 250)); }
    await mine.taken;
    const file = mine.file, end = mine.videoAt ? mine.videoEnd : now(mine);
    mine.file = null;
    mine.ending = null;
    try {
      await file.written;
      await file.out.close();
      const made = await file.handle.getFile();
      if (!made.size || file.base === null) throw new Error(file.failed || "nothing was recorded");
      const url = URL.createObjectURL(made);
      kept.set(url, file.name);
      blobs.set(url, made);
      const seconds = Math.max(0, end - file.base);
      return { ok: true, url, ext: mine.ext, size: made.size, seconds, wall: Date.now() - seconds * 1000, capture: goesOn, ...notedIn(mine, file.base, end) };
    } catch (e) {
      return { ok: false, error: `The recording could not be saved (${e.message}).`, capture: goesOn };
    }
  })();
  return mine.ending;
}

// A file of the last `seconds`, out of the rewind's memory. The capture goes on.
async function save({ seconds }) {
  if (!cap || cap.over) return { ok: false, error: "The rewind is not on." };
  if (!cap.cuts) return { ok: false, error: "This browser's recordings cannot be cut, so there is no rewind." };
  const mine = cap;
  try { mine.recorder.requestData(); } catch (e) { /* the last second is then missing */ }
  await new Promise((r) => setTimeout(r, 250));
  await mine.taken;
  const parts = lastOf(mine, Math.max(5, Number(seconds) || 60));
  if (!parts.length || !mine.head) return { ok: false, error: "Nothing has been kept yet. Give it a few seconds." };
  const base = parts[0].t, end = mine.videoEnd;
  const made = new Blob([mine.head, ...parts.map((f) => rebase(f, base))], { type: "video/mp4" });
  const url = URL.createObjectURL(made);
  kept.set(url, null);
  blobs.set(url, made);
  return { ok: true, url, ext: "mp4", size: made.size, seconds: Math.max(0, end - base), wall: Date.now() - Math.max(0, end - base) * 1000, capture: true, rewound: true, ...notedIn(mine, base, end) };
}

// Stops taking the tab: the encoder gives its last piece, and the tab's sound is the tab's own again.
function endCapture(mine) {
  if (mine.over) return Promise.resolve();
  mine.over = true;
  clearTimeout(mine.timer);
  return new Promise((resolve) => {
    const done = () => {
      mine.stream.getTracks().forEach((t) => t.stop());
      if (mine.crop) mine.crop.track.stop();
      if (mine.ear) mine.ear.close().catch(() => {});
      if (cap === mine) cap = null;
      resolve();
    };
    if (mine.recorder.state === "inactive") done();
    else { mine.recorder.onstop = () => setTimeout(done, 50); mine.recorder.stop(); }
  });
}

async function end() {
  if (!cap) return { ok: true };
  const mine = cap;
  mine.armed = false;
  if (mine.file) return stop();
  await endCapture(mine);
  return { ok: true };
}

// Not asked for by the user: background.js is told, and saves what there is.
// `only`: only the recording ends (it reached its length); the rewind, if on, goes on.
async function endBySelf(note, only) {
  if (!cap) return;
  const mine = cap;
  if (!only) mine.armed = false;   // the tab has gone: nothing is left to rewind
  const result = mine.file ? await stop() : (await endCapture(mine), null);
  chrome.runtime.sendMessage({ type: "link:ended", result, note, capture: !!(result && result.capture) }).catch(() => {});
}

function mark({ note, auto, score, back }) {
  if (!cap || cap.over) return { ok: false, error: "The tab is not being captured." };
  // Kept by the PC's clock and turned into the video's time when it is asked for: how far the video runs
  // behind is known better the longer the capture runs, and a mark made in its first seconds gains from that.
  const mine = cap;
  const m = { w: (Date.now() - mine.since) / 1000 - (back || 0), note: String(note || "").slice(0, 80), auto: !!auto, score: score || 0,
              get t() { return Math.max(0, Math.round((this.w - (Number.isFinite(mine.behind) ? mine.behind - 0.2 : 0)) * 10) / 10); } };
  cap.marks.push(m);
  return { ok: true, index: cap.marks.length - 1, marks: inScope(cap).length };
}
// The marks that would be in a file made now: the recording's, or what the rewind still holds.
function inScope(mine) {
  const from = mine.file && mine.file.base !== null ? mine.file.base : mine.ring.length ? mine.ring[0].t : now(mine);
  return mine.marks.filter((m) => m.t >= from);
}

function tick({ n, ad, seen, view, muted, panel, over }) {
  if (!cap || cap.over) return { ok: false };
  const mine = cap, at = Math.max(0, Math.floor(now(mine)));
  if (view && mine.crop) mine.crop.view = view;   // the player moved or changed size: the cut follows
  mine.hidden = !!mine.crop && (!view || view.seen < 0.97);
  mine.muted = !!muted;
  mine.inPicture = mine.crop ? !!over : !!panel;   // cut to the stream: only when it lies over it; whole tab: whenever it is open
  if (seen) {
    mine.chatSeen = true;
    mine.rate[at] = (mine.rate[at] || 0) + (Number(n) || 0);
    if (mine.autoMarks) spike(mine, at);
  }
  if (ad && mine.adAt[mine.adAt.length - 1] !== at) mine.adAt.push(at);
  return { ok: true };
}

// The chat has sped up: the moment the viewers are reacting to is marked.
function spike(mine, at) {
  if (at < SPIKE.window + 20 || at - mine.lastAuto < SPIKE.rest) return;
  let recent = 0, before = 0, counted = 0;
  for (let s = at - SPIKE.window + 1; s <= at; s++) recent += mine.rate[s] || 0;
  for (let s = Math.max(0, at - SPIKE.window - SPIKE.usual); s <= at - SPIKE.window; s++) { before += mine.rate[s] || 0; counted++; }
  const usual = counted ? (before / counted) * SPIKE.window : 0;
  if (recent < SPIKE.least || recent < usual * SPIKE.times) return;
  mine.lastAuto = at;
  mark({ auto: true, score: usual ? recent / usual : recent, back: SPIKE.back, note: "" });
}

function stats() {
  if (!cap) return null;
  const mine = cap, t = now(mine), at = Math.floor(t);
  let said = 0;
  const span = Math.min(60, at);
  for (let i = at - span; i < at; i++) said += mine.rate[i] || 0;
  const scope = inScope(mine), last = mine.marks.length ? mine.marks[mine.marks.length - 1] : null;
  const recorded = mine.file ? Math.max(0, t - (mine.file.base === null ? mine.file.opened : mine.file.base)) : 0;
  return {
    recording: !!mine.file, armed: mine.armed, seconds: recorded, left: Math.max(0, MAX_SECONDS - recorded),
    held: mine.ring.length ? Math.min(RING_SECONDS, mine.videoEnd - mine.ring[0].t) : 0, reach: RING_SECONDS, rewind: mine.cuts,
    marks: scope.length, autos: scope.filter((m) => m.auto).length,
    lastMark: last && scope.includes(last) ? { index: mine.marks.length - 1, ago: Math.max(0, t - last.t), note: last.note, auto: last.auto } : null,
    chat: mine.chatSeen, perMin: span ? Math.round(said * 60 / span) : 0, ad: mine.adAt.length > 0 && at - mine.adAt[mine.adAt.length - 1] <= 2,
    cut: !!mine.crop, hidden: mine.hidden, muted: mine.muted, inPicture: !!mine.inPicture,
    ear: mine.gain ? mine.vol : null,   // how loud it is heard; null: this browser gave no sound output
  };
}

// What belongs to a recording (its marks and their notes, the chat's speed, the ads, whose stream it is)
// is written into the mp4 itself, so that a recording is one file. It goes at the file's end as a box of
// its own: a "uuid" box, which the format keeps for such things. A player passes over a box it does not
// know; Link (tools/reels/ingest.py) looks for this one by its sixteen letters.
const TAG = "LinkLiteRecord01";
function tag({ url, data }) {
  const made = blobs.get(url);
  if (!made) return { ok: false };
  const body = new TextEncoder().encode(JSON.stringify(data));
  const head = new Uint8Array(24);
  new DataView(head.buffer).setUint32(0, head.length + body.length);
  head.set(new TextEncoder().encode("uuid" + TAG), 4);
  const whole = new Blob([made, head, body], { type: "video/mp4" });
  const next = URL.createObjectURL(whole);
  kept.set(next, kept.get(url));
  blobs.set(next, whole);
  kept.delete(url);
  blobs.delete(url);
  URL.revokeObjectURL(url);
  return { ok: true, url: next, size: whole.size };
}

// A saved file has been copied to Downloads (or could not be): it is let go of here.
async function discard({ url }) {
  for (const [address, name] of [...kept]) {
    if (url && address !== url) continue;
    URL.revokeObjectURL(address);
    kept.delete(address);
    blobs.delete(address);
    if (name) await (await navigator.storage.getDirectory()).removeEntry(name).catch(() => {});
  }
  return { ok: true, idle: !cap && !kept.size };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!message || message.target !== "offscreen") return;
  const run = async () => {
    if (message.type === "start") return start(message);
    if (message.type === "record") return record(message);
    if (message.type === "stop") return stop();
    if (message.type === "save") return save(message);
    if (message.type === "end") return end();
    if (message.type === "tick") return tick(message);
    if (message.type === "stats") return stats();
    if (message.type === "mark") return mark(message);
    if (message.type === "note") { if (cap && cap.marks[message.index]) cap.marks[message.index].note = String(message.text || "").slice(0, 80); return { ok: true }; }
    if (message.type === "armed") { if (cap) cap.armed = !!message.on; return { ok: true }; }
    if (message.type === "options") { if (cap && "autoMarks" in message) cap.autoMarks = !!message.autoMarks; return { ok: true }; }
    if (message.type === "volume") return volume(message);
    if (message.type === "tag") return tag(message);
    if (message.type === "discard") return discard(message);
    return null;
  };
  run().then(reply, (e) => reply({ ok: false, error: `${e.name || "Error"}: ${e.message}` }));
  return true;
});
