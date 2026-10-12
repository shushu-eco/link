// The night run: Link collects material with nobody there. Started by the Night window (main.js in this folder),
// run by Link's own Electron as plain Node, and it goes on when that window is closed.
//
//   electron (ELECTRON_RUN_AS_NODE=1) driver.js <hours> <minutes per stretch>
//
// The Night window writes plan.json before it starts this: when the night began and when it is to end (a run that
// carries on an interrupted night ends when that night was to end), and the options ticked in the window.
//
// It drives Link through its own window (Chromium's debugging port, which Link opens when it is started with
// LINK_DEBUG_PORT=9333): record up to three live game streams on Kick side by side for a stretch, stop them,
// answer "Keep this recording?" with Save, let Link make them tapes, check each recording and tape, and begin
// again until the hours are up. Nothing is marked, dismissed or made into a reel: those are the user's answers,
// and learning needs them to be real.
// It writes %USERPROFILE%\.link\night\status.json every minute (the Night window shows it), its lines to
// night.log there, and the report where the walkthroughs are: videos/walkthroughs/<date>_<time>.md, and .json
// when it is done. A file "stop" in that folder ends the run after what records now is saved and made into tapes.
// What the user is to hear of goes to events.jsonl there, a line each: a card {"at", "kind", "title", "text",
// "fields": [{"name", "value", "inline"}]}. The Night window reads them and posts each in Discord as a card of
// its kind's colour: "start", "stretch", "info", "end", and "trouble", which is anything that interrupts a recording.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync, spawn } = require("child_process");
const { estimateSaid, addUsage } = require("./panel");   // how much room a night takes, by what nights have measured

const REELS_CODE = path.resolve(__dirname, "..");
const ROOT = path.resolve(REELS_CODE, "..", "..");
const VIDEOS = path.join(os.homedir(), "Videos");   // where Link's recorder saves (RECORDINGS in ui/server.py)
const REELS = path.join(ROOT, "videos", "reels");
const OUT = path.join(ROOT, "videos", "walkthroughs");
const DATA = path.join(os.homedir(), ".link", "night");
const STATUS = path.join(DATA, "status.json"), STOP = path.join(DATA, "stop"), EVENTS = path.join(DATA, "events.jsonl");
let PLAN = {};
try { PLAN = JSON.parse(fs.readFileSync(path.join(DATA, "plan.json"), "utf8")) || {}; } catch { /* run by hand: the hours given */ }
// relayChat: the streams' chat goes to Discord #chat during the night; shootersOnly: all three streams are shooters
// streams: how many are recorded side by side; prefer: games that are taken first when they are live
const OPT = { relayChat: false, shootersOnly: false, streams: 3, prefer: [], ...(PLAN.options || {}) };
const STREAMS = Math.min(3, Math.max(1, Number(OPT.streams) || 3));
const PREFER = (OPT.prefer || []).map((x) => String(x).toLowerCase());
const HOURS = Number(process.argv[2] || 5), SEG = Number(process.argv[3] || 30);
const FIRST = Number(process.argv[4] || 0);
const MIN_FREE_GB = 25;
// An installed Link carries its own Python and ffmpeg; a copy run from the project uses the PC's.
const PYTHON = fs.existsSync(path.join(ROOT, "runtime", "python", "python.exe")) ? path.join(ROOT, "runtime", "python", "python.exe") : "python";
if (fs.existsSync(path.join(ROOT, "runtime", "ffmpeg", "bin"))) process.env.PATH = `${path.join(ROOT, "runtime", "ffmpeg", "bin")}${path.delimiter}${process.env.PATH || ""}`;
// Tried only when Kick's own list of live games cannot be read (no Kick app connected in Settings > Accounts).
const NAMES = {
  kick: ["eslcs", "valorant", "seadetx", "tyra", "sosio", "clapperz", "sliggy", "heaton", "itsnav", "peanut", "catahlyst", "coxcs", "1xsb", "xqc", "approvalsonly"],
};
fs.mkdirSync(DATA, { recursive: true });
fs.rmSync(STOP, { force: true });
const stopAsked = () => fs.existsSync(STOP);
const started = Date.now(), END = Number(PLAN.end) > started ? Number(PLAN.end) : started + HOURS * 3600000;
const BEGAN = Number(PLAN.started) || started;   // when the night began, which is earlier than `started` for a run that carries one on
let outcome = "done", why = "", relayWas = null;
const usage = { mb: 0, seconds: 0 };   // what this night's recordings came to, for the next night's estimate
const steps = [], findings = [], measured = {}, pageErrors = [], collected = [];
const used = {}, away = {};
let phase = "starting", segment = 0, now = {}, failures = 0;

const stamp = () => new Date().toTimeString().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text) => { try { fs.appendFileSync(path.join(DATA, "night.log"), `${stamp()} ${text}\n`); } catch {} };
function step(name, ok, saw = "") {
  steps.push({ step: name, ok: !!ok, saw: typeof saw === "string" ? saw : JSON.stringify(saw), minute: +((Date.now() - started) / 60000).toFixed(1) });
  say(`${ok ? "PASS" : "FAIL"}  ${name}${saw ? "   [" + (typeof saw === "string" ? saw : JSON.stringify(saw)).slice(0, 300) + "]" : ""}`);
  save();
}
const freeGb = () => { const s = fs.statfsSync(VIDEOS); return +(s.bavail * s.bsize / 2 ** 30).toFixed(1); };

function status(state = "running") {
  const failed = steps.filter((s) => !s.ok);
  const doc = { state, outcome, why, pid: process.pid, beat: Date.now(), began: BEGAN, end: END, at: stamp(), phase, segment, minutes: +((Date.now() - started) / 60000).toFixed(1), ends: new Date(END).toTimeString().slice(0, 5),
    stopping: stopAsked(), report: reportBase() + ".md",
    now, tapes: collected.map((t) => t.id), hours_collected: +(collected.reduce((a, t) => a + (t.seconds || 0), 0) / 3600).toFixed(2),
    candidates: collected.reduce((a, t) => a + (t.candidates || 0), 0), free_gb: freeGb(),
    steps: steps.length, failed: failed.map((s) => `${s.minute} ${s.step}: ${s.saw.slice(0, 160)}`).slice(-8), findings: findings.slice(-8) };
  fs.writeFileSync(STATUS + ".part", JSON.stringify(doc, null, 1));
  fs.renameSync(STATUS + ".part", STATUS);
}

function reportBase() {   // named by the day and time the run began, as the walkthroughs are
  const d = new Date(started), two = (n) => String(n).padStart(2, "0");
  return path.join(OUT, `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}`);
}

function save(done = false) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = reportBase();
  const minutes = +((Date.now() - started) / 60000).toFixed(1);
  // "tapes" is empty on purpose: learning leaves a walkthrough's tapes out, and these are to be learned from once the user has gone through them
  const doc = { at: started / 1000, kind: "night", minutes, finished: done, tapes: [], collected: collected.map((t) => t.id), steps, findings, measured, page_errors: pageErrors.slice(0, 30) };
  if (done) fs.writeFileSync(base + ".json", JSON.stringify(doc, null, 1));
  const failed = steps.filter((s) => !s.ok);
  fs.writeFileSync(base + ".md", [
    `# Link night run, ${new Date(started).toLocaleString("en-GB")}`, "",
    `${steps.length - failed.length} of ${steps.length} steps passed in ${minutes} minutes${done ? "" : " (still running)"}. ` +
    `${collected.length} tapes collected, ${(collected.reduce((a, t) => a + (t.seconds || 0), 0) / 3600).toFixed(1)} hours, ${collected.reduce((a, t) => a + (t.candidates || 0), 0)} candidates. ` +
    "Nothing was marked, dismissed or made into a reel: the tapes wait for the user's answers.", "",
    "## Tapes", "", "| tape | from | minutes | mode | candidates | sound | file |", "|---|---|---|---|---|---|---|",
    ...collected.map((t) => `| ${t.id} | ${t.from || ""} | ${((t.seconds || 0) / 60).toFixed(0)} | ${t.mode || ""} | ${t.candidates ?? ""} | ${t.mean_db ?? ""} dB | ${t.file || ""} |`), "",
    "## Findings", "", ...(findings.length ? findings.map((f) => `- ${f}`) : ["- none"]), "",
    "## Measured", "", ...Object.entries(measured).map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`), "",
    "## Steps", "", "| min | result | step | what was seen |", "|---|---|---|---|",
    ...steps.map((s) => `| ${s.minute} | ${s.ok ? "pass" : "**FAIL**"} | ${s.step} | ${String(s.saw).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 300)} |`), "",
    "## Errors the page reported", "", ...(pageErrors.length ? pageErrors.slice(0, 30).map((e) => `- ${e}`) : ["- none"]), "",
  ].join("\n"));
  status(done ? "finished" : "running");
  return base;
}

// ---------------------------------------------------------------- talking to Link's page
let ws = null, seq = 0;
const waiting = new Map();
const send = (method, params, limit = 60000) => new Promise((done, fail) => {
  if (!ws || ws.readyState !== 1) return fail(new Error("Link's window is not connected"));
  const id = ++seq;
  const t = setTimeout(() => { waiting.delete(id); fail(new Error(`Link's window did not answer (${method})`)); }, limit);
  waiting.set(id, (d) => { clearTimeout(t); done(d); });
  ws.send(JSON.stringify({ id, method, params }));
});
async function connect() {
  const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  const page = targets.find((t) => t.type === "page" && /127\.0\.0\.1:8765\/?$/.test(t.url));
  if (!page) throw new Error("Link's page is not there");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("Link's window refused the connection")); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") pageErrors.push(`${stamp()} ${(d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text}`.slice(0, 300));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/ERR_|favicon/.test(d.params.entry.text)) pageErrors.push(`${stamp()} ${d.params.entry.text}`.slice(0, 300));
  };
  await send("Runtime.enable"); await send("Log.enable");
}
// Run a function in the page with one argument; what it returns (or throws) comes back.
async function page(fn, arg, timeout = 120000) {
  if (!ws || ws.readyState !== 1) await connect();
  const res = await send("Runtime.evaluate", { expression: `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`, awaitPromise: true, returnByValue: true, timeout }, timeout + 15000);
  if (res.result.exceptionDetails) throw new Error(((res.result.exceptionDetails.exception || {}).description || res.result.exceptionDetails.text || "page error").slice(0, 400));
  return res.result.result.value;
}
const api = async (route, body) => (await fetch("http://127.0.0.1:8765" + route, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).json();
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };

// ---------------------------------------------------------------- looking at files
function probe(file) {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8", windowsHide: true }));
  const v = out.streams.find((s) => s.codec_type === "video") || {}, a = out.streams.find((s) => s.codec_type === "audio");
  return { width: v.width, height: v.height, seconds: +Number(out.format.duration).toFixed(1), audio: !!a, mb: +(out.format.size / 1e6).toFixed(1) };
}
function loudness(file, from) {   // mean volume in dB of two minutes from `from`: about -91 is digital silence
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(from), "-t", "120", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(res.stderr || "");
  return m ? Number(m[1]) : null;
}
const tapeIds = () => fs.readdirSync(REELS).filter((d) => /^SRC-\d+$/.test(d));

// ---------------------------------------------------------------- the page's side of each step
const P = {
  setup: async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    showStudio(true, "stream"); await wait(800);
    shell.mute(true); await wait(1500);
    return { muted: state.shell.muted, auto: state.status.auto, cut: state.status.cut, open: (state.shell.channels || []).length, version: (state.about || {}).version || "" };
  },
  openStream: async ({ site, names }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const notes = [];
    showStudio(true, "stream"); await wait(400);
    if (state.shell.open) { await shell.minimise(); await wait(1500); }   // the big screen is made free for the next stream
    for (const name of names) {
      const r = await shell.open(`${site === "kick" ? "kick.com" : "twitch.tv"}/${name}`, "stream");
      if (r && r.ok === false) { notes.push(`${name}: ${r.error}`); continue; }
      let live = false;
      for (let i = 0; i < 26 && !live; i++) {
        await wait(1000);
        const s = state.shell || {};
        live = !!s.open && s.volume != null && (site === "kick" ? s.stage === "live" || (s.stage == null && s.fills !== null) : s.stage === "live");
        if (s.stage === "offline") break;
      }
      if (live) {
        const rec = await shell.record(); await wait(2500);
        if (!state.shell.recording) {   // live, but the capture did not start: closed again, so that it holds no place, and the next is tried
          notes.push(`${name}: ${(rec && rec.error) || "the recording did not start"}`);
          await shell.close(); await wait(1500);
          continue;
        }
        return { name, notes, recording: !!state.shell.recording, error: rec && rec.ok === false ? rec.error : "", stage: state.shell.stage, size: state.shell.size, kickSays: state.shell.stream };
      }
      notes.push(`${name} not live (${(state.shell || {}).stage})`);
      await shell.close(); await wait(1500);
    }
    return { name: null, notes };
  },
  // How it stands, and "Keep this recording?" answered with Save under the name Link offers, as someone pressing Enter would.
  pulse: async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const kept = [];
    for (let i = 0; i < 8 && (keepOpen || keepQueue.length); i++) {
      const box = document.getElementById("keep-dialog");
      if (box.open) { kept.push((box.querySelector("input") || {}).value || ""); document.getElementById("keep-form").requestSubmit(); }
      await wait(1500);
    }
    const chans = (state.shell || {}).channels || [];
    return { recording: chans.filter((c) => c.recording).map((c) => ({ name: c.name, minutes: +((Date.now() - c.recording.since) / 60000).toFixed(1), chat: c.chat ? c.chat.perMin : null, size: `${c.recording.width}x${c.recording.height}` })),
      open: chans.length, muted: state.shell.muted, kept, job: state.status.job.running ? state.status.job.kind : "", queue: state.ingestQueue.length,
      notAnswering: document.getElementById("slots").innerText.includes("NOT ANSWERING"), saved: (state.shell.saved || []).map((s) => ({ file: s.file, seconds: Math.round(s.seconds), error: s.error, what: s.what })) };
  },
  stopAll: async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const chans = () => (state.shell || {}).channels || [];
    for (const c of chans().filter((k) => k.recording)) await shell.stopChannel(c.id);
    for (let i = 0; i < 120 && chans().some((c) => c.recording || c.saving); i++) await wait(500);
    await wait(1500);
    const dialog = document.querySelector("dialog[open]");
    return { asked: dialog ? dialog.id + ": " + dialog.innerText.replace(/\s+/g, " ").slice(0, 140) : "", stillBusy: chans().some((c) => c.recording || c.saving) };
  },
  stopOne: async (name) => {   // one recording, by its stream's name; it is saved, and "Keep?" is answered at the next look
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const find = () => ((state.shell || {}).channels || []).find((c) => String(c.name).toLowerCase() === name);
    const c = find();
    if (!c || !c.recording) return false;
    await shell.stopChannel(c.id);
    for (let i = 0; i < 60 && find() && (find().recording || find().saving); i++) await wait(500);
    return true;
  },
  // Its Discord channel (made if there is none), and the chat relay switched for the night; an older Link has neither.
  night: async ({ relay }) => {
    if (!shell.night) return { old: true };
    const channel = await shell.night("channel").catch((e) => ({ ok: false, error: e.message }));
    const was = await shell.night("relay", relay).catch(() => null);
    return { channel, was: was ? was.was : null };
  },
  closeChannels: async (unmute) => {
    for (const c of (state.shell || {}).channels || []) if (!c.recording) shell.closeChannel(c.id);
    await new Promise((r) => setTimeout(r, 1500));
    if (unmute) shell.mute(false);
    return { open: ((state.shell || {}).channels || []).length };
  },
};

// ---------------------------------------------------------------- one stretch
const order = (site, skip) => NAMES[site].filter((n) => !skip.includes(n)).sort((a, b) => ((used[a] || 0) + 3 * (away[a] || 0)) - ((used[b] || 0) + 3 * (away[b] || 0))).slice(0, 10);

// What the user is to hear of, as a card: a title, a line or two, and named fields. The Night window posts these in Discord (#night).
function emit(kind, title, text = "", fields = []) {
  say(`${kind}: ${title}${text ? ` | ${text}` : ""}`);
  try { fs.appendFileSync(EVENTS, JSON.stringify({ at: Date.now(), kind, title, text, fields: fields.filter((f) => f && f.value) }) + "\n"); } catch { /* the run goes on without it */ }
}
const trouble = (title, text) => emit("trouble", title, text);
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const hoursOf = (tapes) => (tapes.reduce((a, t) => a + (t.seconds || 0), 0) / 3600).toFixed(1);
const momentsOf = (tapes) => tapes.reduce((a, t) => a + (t.candidates || 0), 0);
const sofar = () => `**${count(collected.length, "tape")}** · **${hoursOf(collected)} h** · **${count(momentsOf(collected), "moment")}**`;
const streamLine = (g) => `**${g.name}** · ${g.category || "?"}${g.viewers ? ` · ${Number(g.viewers).toLocaleString("en")} watching` : ""}`;
function checksLine() {   // how the checks stand, with the newest that failed
  const bad = steps.filter((x) => !x.ok);
  return bad.length ? `⚠ ${bad.length} of ${steps.length} failed\n${bad.slice(-3).map((x) => `• ${x.step}`).join("\n")}`.slice(0, 1000) : `✅ All ${steps.length} passed`;
}

function liveNow() {   // kick_live.py: {"shooters": [...], "games": [...]} from Kick's API, or null
  try {
    return JSON.parse(execFileSync(PYTHON, [path.join(__dirname, "kick_live.py")], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, windowsHide: true, timeout: 180000 }));
  } catch (e) { say(`Kick's list: ${e.message.slice(0, 200)}`); return null; }
}
function choose(list, got) {
  const taken = got.map((g) => g.name), games = got.map((g) => g.category);
  return list.filter((s) => !taken.includes(s.slug) && s.viewers >= 20)
    .map((s, i) => ({ s, key: 1000 * (used[s.slug] || 0) + 300 * (away[s.slug] || 0) + (games.includes(s.category) ? 500 : 0) + (s.language === "en" ? 0 : 200) + i }))
    .map((x) => ({ ...x, key: x.key - (PREFER.includes(String(x.s.category).toLowerCase()) ? 450 : 0) }))   // a preferred game goes first, unless that channel was recorded already
    .sort((a, b) => a.key - b.key).slice(0, 8).map((x) => x.s.slug);
}

// One more stream opened and recording: {name, category, ...} added to `got`, or null when none of that kind is live.
async function openOne(live, got, kind) {
  const lists = live ? [kind, kind === "games" ? "shooters" : "games"].filter((k) => !(OPT.shootersOnly && k === "games")).map((k) => choose(live[k] || [], got))
    : [order("kick", got.map((g) => g.name))];
  for (const names of lists.filter((l) => l.length)) {
    const r = await page(P.openStream, { site: "kick", names }, 400000).catch((e) => ({ name: null, notes: [e.message] }));
    for (const n of r.notes || []) {
      const who = n.split(/[ :]/)[0]; away[who] = (away[who] || 0) + 1;
      if (!/not live/.test(n)) trouble(`${who} could not be recorded`, `**${who}** was live, but Link could not record it: ${n.slice(who.length + 2).replace(/\.+$/, "")}. Another stream is tried.`);
    }
    if (r.name && r.recording) {
      const about = ((live && [...live.shooters, ...live.games]) || []).find((s) => s.slug === r.name) || {};
      const one = { name: r.name, site: "kick", size: r.size, category: (r.kickSays && r.kickSays.category) || about.category || "", viewers: about.viewers };
      got.push(one);
      used[r.name] = (used[r.name] || 0) + 1; away[r.name] = 0;
      return one;
    }
    if (r.name) { findings.push(`Stretch ${segment}: ${r.name} was live but did not record: ${r.error || "no reason given"}`); trouble(`${r.name} could not be recorded`, `**${r.name}** was live, but Link could not record it: ${r.error || "no reason given"}. Another stream is tried.`); }
  }
  return null;
}

// Which of these Kick channels are not live any more, by Kick's own word; none when Kick cannot be asked.
function wentOffline(names) {
  try {
    const said = JSON.parse(execFileSync(PYTHON, [path.join(REELS_CODE, "kick_api.py"), ...names], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, windowsHide: true, timeout: 60000 }));
    return names.filter((n) => said[n] && said[n].live === false);
  } catch { return []; }
}

async function stretch(minutes) {
  segment++;
  const videosBefore = new Set(fs.readdirSync(VIDEOS)), tapesBefore = new Set(tapeIds());
  phase = "opening streams"; status();
  const before = await page(P.setup);
  if (!before.muted) step(`stretch ${segment}: the sound is off for the user`, false, before);
  // Games on Kick (no ads there): two shooters and one other game, who is live now by Kick's own list, most watched first,
  // a channel not recorded yet before one that was, and three different games when there are that many.
  const listed = liveNow(), live = listed && (listed.shooters.length || listed.games.length) ? listed : null, got = [];
  if (!live) findings.push(`Stretch ${segment}: Kick's list of live games could not be read; channels from the fixed list were tried instead.`);
  // all shooters, or (with two or more streams) the last one another popular game
  const kinds = Array.from({ length: STREAMS }, (_, i) => (!OPT.shootersOnly && STREAMS > 1 && i === STREAMS - 1 ? "games" : "shooters"));
  for (const kind of kinds) await openOne(live, got, kind);
  step(`stretch ${segment}: ${got.length} of ${STREAMS} streams open and record`, got.length >= Math.min(2, STREAMS), got.length ? got.map((g) => `${g.name} (${g.category || "?"}${g.viewers ? ", " + g.viewers + " watching" : ""}) ${g.size ? g.size.width + "x" + g.size.height : ""}`).join(", ") : "no stream was live");
  if (!got.length) { await page(P.closeChannels, false).catch(() => {}); trouble("No stream could be opened", `No game stream on Kick could be opened for stretch ${segment}. Link Night tries again in five minutes.`); return false; }
  if (got.length < STREAMS) trouble(`Only ${got.length} of ${STREAMS} streams opened`, `Stretch ${segment} records ${got.map((g) => `**${g.name}**`).join(" and ")} only; no other game stream could be opened. The night goes on with ${got.length === 1 ? "that one" : "those"}.`);
  if (segment === 1) emit("start", `🌙 Link Night ${BEGAN < started - 60000 ? "carries on" : "started"}`, `Collecting until **${new Date(END).toTimeString().slice(0, 5)}**, in stretches of ${SEG} minutes.`,
    [{ name: "Recording now", value: got.map(streamLine).join("\n") },
     { name: "Collects", value: `${STREAMS} stream${STREAMS === 1 ? "" : "s"} at a time: ${OPT.shootersOnly || STREAMS === 1 ? "shooters only" : "shooters and one other game"}${PREFER.length ? `, ${OPT.prefer.join(", ")} first` : ""}`, inline: true },
     { name: "Live chat to #chat", value: OPT.relayChat ? "On" : "Off", inline: true },
     { name: "Room it takes", value: estimateSaid(Math.max(1, Math.round((END - started) / 360000) / 10), STREAMS) }]);

  // while they record: a look every minute
  phase = "recording"; const recStart = Date.now(); let quiet = 0;
  let expected = got.map((g) => g.name.toLowerCase());   // the streams that are to be recording
  const stalled = new Set();
  // A stream that went away is replaced while the stretch has ten minutes or more to go.
  const replace = async (minute) => {
    if (minutes - minute < 10 || stopAsked()) return;
    const one = await openOne(live, got, "shooters").catch(() => null);
    if (one) { expected.push(one.name.toLowerCase()); emit("info", "▶ Another stream takes its place", `${streamLine(one)} is recorded for the rest of stretch ${segment}.`); }
    else trouble("No stream to take its place", "No other game stream could be opened; the stretch goes on with one stream fewer.");
  };
  for (let minute = 1; minute <= minutes; minute++) {
    await sleep(Math.max(0, recStart + minute * 60000 - Date.now()));
    const w = await page(P.pulse).catch((e) => ({ error: e.message }));
    if (w.error) {
      quiet++; say(`minute ${minute}: ${w.error}`);
      if (quiet === 2) trouble("Link's window is not answering", `It has been quiet for two minutes (stretch ${segment}, minute ${minute}). The recordings may still be running.`);
      if (quiet >= 4) throw new Error(`Link's window did not answer for ${quiet} minutes while recording`);
      status(); continue;
    }
    quiet = 0;
    now = { stretch: segment, minute, of: minutes, recording: w.recording, muted: w.muted, job: w.job };
    const going = w.recording.map((r) => String(r.name).toLowerCase());
    // a recording that ended by itself
    for (const name of expected.filter((n) => !going.includes(n))) {
      expected = expected.filter((n) => n !== name);
      step(`stretch ${segment}, minute ${minute}: every recording still runs`, false, `the recording of ${name} stopped by itself`);
      trouble(`The recording of ${name} stopped by itself`, `Stretch ${segment}, minute ${minute}. What it had is kept and becomes a tape.`);
      await replace(minute);
    }
    // a stream that ended: Kick says the channel is not live any more
    if (minute % 3 === 0 && minute < minutes) {
      for (const name of wentOffline(expected)) {
        expected = expected.filter((n) => n !== name);
        trouble(`${name} went offline`, `Stretch ${segment}, minute ${minute}. Its recording is stopped and kept; it becomes a tape.`);
        await page(P.stopOne, name, 90000).catch(() => {});
        await replace(minute);
      }
    }
    // a recording whose file does not grow: the recorder has stalled
    try {
      for (const f of fs.readdirSync(VIDEOS).filter((x) => x.endsWith(".part.webm") && !videosBefore.has(x))) {
        const age = (Date.now() - fs.statSync(path.join(VIDEOS, f)).mtimeMs) / 1000;
        if (age > 120 && !stalled.has(f)) { stalled.add(f); step(`stretch ${segment}, minute ${minute}: every recording's file grows`, false, `${f} has not grown for ${Math.round(age)} s`); trouble("A recording seems to have paused", `Its file (\`${f}\`) has not grown for ${Math.round(age)} seconds (stretch ${segment}, minute ${minute}).`); }
      }
    } catch { /* the folder could not be read this minute */ }
    if (!w.muted || w.notAnswering) step(`stretch ${segment}, minute ${minute}: the sound stays off and Link answers`, false, { muted: w.muted, notAnswering: w.notAnswering });
    if (w.notAnswering) trouble("Link's server is not answering", "Recordings go on, but tapes cannot be made until it is back.");
    status();
    if (!w.recording.length || stopAsked()) break;
  }

  // stop, keep, and let Link make the tapes
  phase = "stopping"; status();
  const stopped = await page(P.stopAll, null, 180000);
  const kept = [];
  for (let i = 0; i < 6; i++) { const w = await page(P.pulse); kept.push(...w.kept); if (!w.kept.length && i) break; }
  const last = await page(P.pulse);
  const files = fs.readdirSync(VIDEOS).filter((f) => !videosBefore.has(f) && /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mp4$/.test(f)).map((f) => path.join(VIDEOS, f));
  step(`stretch ${segment}: the recordings are stopped and saved`, files.length === got.length && !stopped.stillBusy, files.map((f) => path.basename(f)).join(", "));
  step(`stretch ${segment}: Link asks whether to keep each recording, and Save names it`, kept.length >= files.length && kept.every(Boolean), kept.join(" / ") || `nothing was asked (${stopped.asked})`);
  await page(P.closeChannels, false).catch(() => {});

  const checked = {};
  for (const f of files) {
    try {
      const p = probe(f), told = (last.saved.find((s) => s.file === f) || {}).seconds;
      p.mean_db = loudness(f, Math.max(0, p.seconds / 2 - 60));
      p.told = told;
      const whole = p.audio && p.mean_db !== null && p.mean_db > -60 && (stopAsked() || p.seconds > minutes * 60 * 0.9) && (told == null || Math.abs(p.seconds - told) <= Math.max(5, told * 0.02));
      step(`stretch ${segment}: ${path.basename(f)} has its picture, its whole length and its sound`, whole, p);
      checked[f.toLowerCase()] = p;
      usage.mb += p.mb || 0; usage.seconds += p.seconds || 0;
    } catch (e) { step(`stretch ${segment}: ${path.basename(f)} can be read`, false, e.message); }
  }

  phase = "processing"; status();
  // Link makes no tape of a recording under 30 seconds (a run stopped right after it began leaves such ones)
  const due = files.filter((f) => ((checked[f.toLowerCase()] || {}).seconds ?? 99) >= 30).length;
  const own = new Set(files.map((f) => f.toLowerCase()));
  const t0 = Date.now(); let fresh = [], st = null;
  while (due && Date.now() - t0 < 50 * 60000) {
    await sleep(10000);
    st = await page(P.pulse).catch(() => null);
    fresh = tapeIds().filter((t) => {
      const ing = readJson(path.join(REELS, t, "ingest.json")) || {};
      return !tapesBefore.has(t) && ing.state !== "processing" && own.has(String(ing.original || "").toLowerCase()) && fs.existsSync(path.join(REELS, t, "analysis.json"));
    });
    now = { stretch: segment, processing: `${fresh.length} of ${due} tapes`, job: st && st.job };
    status();
    if (st && fresh.length >= due && !st.job && !st.queue) break;
  }
  const took = +((Date.now() - t0) / 60000).toFixed(1);
  if (due) step(`stretch ${segment}: Link makes the ${due} recordings into tapes by itself`, fresh.length === due && st && !st.job, `${fresh.sort().join(", ")} in ${took} min`);
  measured[`stretch ${segment}`] = { streams: got.map((g) => `${g.name} (${g.category || "?"})`), recorded_min: +((Date.now() - recStart) / 60000 - took).toFixed(1), processing_min: took, free_gb: freeGb() };
  for (const id of fresh.sort()) {
    const a = readJson(path.join(REELS, id, "analysis.json")) || {}, ing = readJson(path.join(REELS, id, "ingest.json")) || {}, label = readJson(path.join(REELS, id, "label.json")) || {};
    const p = checked[String(ing.original || "").toLowerCase()] || {};
    const tape = { id, from: label.name || ing.chat || "", seconds: (a.info || {}).duration || p.seconds || 0, mode: a.mode, candidates: (a.candidates || []).length,
      transcript: fs.existsSync(path.join(REELS, id, "transcript.json")), audio: fs.existsSync(path.join(REELS, id, "audio.json")), mean_db: p.mean_db, file: path.basename(String(ing.original || "")) };
    collected.push(tape);
    step(`${id}: a tape with candidates, a name, what was said and the sound's signs`, tape.candidates > 0 && !!label.name && tape.transcript, `${tape.from}, ${(tape.seconds / 60).toFixed(0)} min, ${tape.mode} mode, ${tape.candidates} candidates, transcript ${tape.transcript ? "yes" : "no"}, audio.json ${tape.audio ? "yes" : "no"}`);
  }
  now = {};
  const bad = steps.filter((s) => !s.ok);
  const made = collected.filter((t) => fresh.includes(t.id));
  const gameOf = (t) => (got.find((g) => String(t.from).toLowerCase().startsWith(g.name.toLowerCase())) || {}).category || "";
  emit("stretch", `🎞 Stretch ${segment} done`, made.length ? `${count(made.length, "new tape")} from ${count(got.length, "stream")}.` : "No tape came of this stretch.", [
    { name: "New tapes", value: made.map((t) => `\`${t.id}\` **${String(t.from).split(" · ")[0]}**${gameOf(t) ? ` · ${gameOf(t)}` : ""} · ${Math.round((t.seconds || 0) / 60)} min · ${count(t.candidates || 0, "moment")}`).join("\n").slice(0, 1000) },
    { name: "So far tonight", value: sofar() },
    { name: "Checks", value: checksLine(), inline: true },
    { name: "Free room", value: `${freeGb()} GB`, inline: true }]);
  for (const t of collected.slice(-fresh.length || collected.length).filter((t) => t.mean_db != null && t.mean_db <= -60)) trouble(`${t.id} seems to have no sound`, `The tape of **${String(t.from).split(" · ")[0]}** measures ${t.mean_db} dB in its middle: the stream was silent, or had ended.`);
  return true;
}

// ---------------------------------------------------------------- the night
// The PC is kept from going to sleep and the screen from switching off for as long as this runs (it ends with this script).
const awake = spawn(PYTHON, ["-c", "import ctypes,sys\nctypes.windll.kernel32.SetThreadExecutionState(0x80000003)\nsys.stdin.read()"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });

const beat = setInterval(() => { try { status(); } catch { /* next time */ } }, 20000);   // the Night window sees that the run is alive

(async () => {
  status();
  await connect();
  const asked = await page(P.night, { relay: !!OPT.relayChat }).catch((e) => ({ error: e.message }));
  relayWas = asked && typeof asked.was === "boolean" ? asked.was : null;
  if (asked && asked.channel && asked.channel.ok === false) say(`#night: ${asked.channel.error}`);
  say(`a night of ${HOURS} hours in stretches of ${SEG} minutes; ${freeGb()} GB free`);
  // whatever an earlier run left: what still records is saved (and kept), what is only open is closed
  await page(P.stopAll, null, 180000).catch(() => {});
  for (let i = 0; i < 3; i++) await page(P.pulse).catch(() => {});
  await page(P.closeChannels, false).catch(() => {});
  let empty = 0;
  for (;;) {
    // the first stretch is short, so that stopping, keeping and processing are seen to work before the long ones
    const left = (END - Date.now()) / 60000, minutes = Math.min(segment === 0 && FIRST ? FIRST : SEG, Math.floor(left - 14));
    if (minutes < 8) break;
    if (stopAsked()) { outcome = "stopped"; findings.push("Stopped before the hours were up."); break; }
    if (freeGb() < MIN_FREE_GB) { outcome = "gave-up"; why = `only ${freeGb()} GB are free on the drive`; findings.push(`Stopped early: ${why}.`); break; }
    try {
      const ok = await stretch(minutes);
      failures = 0;
      if (!ok) { if (++empty >= 6) { outcome = "gave-up"; why = "no game stream was live six times in a row"; findings.push(`Stopped early: ${why}.`); break; } phase = "waiting for a live stream"; status(); for (let i = 0; i < 30 && !stopAsked(); i++) await sleep(10000); } else empty = 0;
    } catch (e) {
      step(`stretch ${segment} ran to its end`, false, e.message);
      trouble(`Stretch ${segment} was cut short`, `${e.message}. What still records is saved, and the next stretch begins.`);
      if (++failures >= 3) { outcome = "gave-up"; why = "three stretches in a row could not be finished"; findings.push(`Stopped early: ${why}.`); break; }
      await sleep(20000);
      await connect().catch(() => {});
      await page(P.stopAll, null, 180000).catch(() => {});   // whatever still records is saved, not lost
      for (let i = 0; i < 4; i++) await page(P.pulse).catch(() => {});
      await page(P.closeChannels, false).catch(() => {});
    }
  }
  await finish();
})().catch(async (e) => { outcome = "gave-up"; why = e.message; step("the night ran to its end", false, e.message); await finish(); });

async function finish() {
  phase = "finishing";
  clearInterval(beat);
  if (usage.seconds >= 1800) addUsage(usage.mb, usage.seconds);   // half an hour of recording or more: worth going by
  await page(P.closeChannels, true).catch(() => {});
  if (relayWas !== null && relayWas !== !!OPT.relayChat) await page(P.night, { relay: relayWas }).catch(() => {});   // the chat relay as the user had it
  if (pageErrors.length) findings.push(`The page reported ${pageErrors.length} error${pageErrors.length === 1 ? "" : "s"} during the night.`);
  measured.total = { tapes: collected.length, hours: +(collected.reduce((a, t) => a + (t.seconds || 0), 0) / 3600).toFixed(2), candidates: collected.reduce((a, t) => a + (t.candidates || 0), 0), free_gb: freeGb() };
  save();
  const learned = await api("/api/learn", {}).catch((e) => ({ error: e.message }));
  step("learning ran again and still counts the night's tapes as the user's to answer", !learned.error && !(learned.walkthrough || {}).tapes?.length, learned.error || learned.why);
  const failed = steps.filter((s) => !s.ok);
  if (outcome !== "gave-up") emit("end", `☀️ Link Night ${outcome === "stopped" ? "was stopped" : "finished"}`,
    `${outcome === "stopped" ? "Stopped" : "Done"} after **${((Date.now() - started) / 3600000).toFixed(1)} h**. Nothing was marked or made into a reel: the tapes wait for you in Sources.`, [
      { name: "Collected", value: sofar() },
      { name: "Tapes", value: collected.length ? collected.map((t) => `\`${t.id}\``).join(" ").slice(0, 1000) : "" },
      { name: "Checks", value: checksLine(), inline: true },
      { name: "Free room", value: `${freeGb()} GB`, inline: true },
      { name: "Findings", value: findings.slice(0, 4).map((f) => `• ${f}`).join("\n").slice(0, 1000) }]);
  const base = save(true);
  say(`${steps.filter((s) => s.ok).length} of ${steps.length} steps passed in ${((Date.now() - started) / 60000).toFixed(1)} minutes; document: ${base}.md`);
  awake.kill();
  fs.rmSync(STOP, { force: true });
  if (ws) ws.close();
  process.exit(0);
}
