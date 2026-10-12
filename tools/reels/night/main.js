// Link's night run: a small window of its own (the moon icon beside Link's on the Desktop).
//
//   electron tools/reels/night                 the window
//   electron tools/reels/night --do=<what>     what a Discord command asked for, without the window:
//                                              night, set, status, continue, retry, stop; the choices given with
//                                              the command follow as a query (night?hours=3&shootersOnly=true)
//
// It starts and stops the night run, shows how it stands, and watches over it. The run itself is
// driver.js in this folder, started here as a program of its own (Link's Electron run as plain Node).
// While a night runs this program stays, also when its window is closed (the icon opens the window
// again), because it is the one that watches:
//   - every 25 minutes it takes a picture of this window and posts it in Discord's #night, with how
//     far the night is;
//   - what the run reports (events.jsonl) is posted at once, trouble first of all;
//   - when the run's program is gone, gives up, or Link itself closes, the night is "interrupted":
//     Link is opened again (its bot has to be there to hear /continue and /retry), what happened is
//     posted, and the night waits to be carried on (Continue, /continue) or started again (/retry).
// Posts go straight to Discord with the bot's token from Link's own discord.json, so that they
// arrive when Link is down too. The token is read here and never reaches the page.
// The run drives Link through its window's test port, which Link opens only when it is started with
// LINK_DEBUG_PORT. So the night run opens Link itself; a Link that is open already has to be closed first.
// Everything the night keeps is in %USERPROFILE%\.link\night: plan.json (when it began, when it ends,
// the options, how it stands), status.json and events.jsonl (the run's), options.json (the window's
// choices), and a file "stop" that asks the run to end.
// Electron is Link's own (tools/reels/shell/node_modules): this folder holds only this window and the run.
const { app, BrowserWindow, Menu, ipcMain, shell, powerMonitor } = require("electron");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DiscordBot } = require("../shell/discord");
const { CHOICES, options, setOptions, buttons, panel, estimate } = require("./panel");   // the choices and the Discord buttons, shared with Link's window

const REELS = path.resolve(__dirname, "..");
const ROOT = path.resolve(REELS, "..", "..");
const DATA = path.join(os.homedir(), ".link", "night");
const STATUS = path.join(DATA, "status.json"), STOP = path.join(DATA, "stop"), PLAN = path.join(DATA, "plan.json");
const EVENTS = path.join(DATA, "events.jsonl"), LINK_CLOSED = path.join(DATA, "link-closed.json");
const LINK = "http://127.0.0.1:8765/api/status";   // Link's server answers here for as long as Link is open
const SLEEP_WAIT = 90000;   // ms between "the PC goes to sleep" and doing it, in which it can be called off
const DISCORD_FILE = path.join(os.homedir(), ".link", "discord.json");
const PORT = 9333;          // the test port Link's pages answer on
const SEG = 30;             // minutes a stretch records before its streams are stopped and made into tapes
const PICTURE_EVERY = 25 * 60000;
const SIZE = { width: 380, height: 462 };
// An installed Link carries its own Python; a copy run from the project uses the PC's.
const OWN = path.join(ROOT, "runtime", "python");
const pythonw = () => (fs.existsSync(path.join(OWN, "pythonw.exe")) ? path.join(OWN, "pythonw.exe") : "pythonw");
const DO = (argv) => { const hit = argv.find((a) => a.startsWith("--do=")); return hit ? hit.slice(5) : ""; };

app.setPath("userData", path.join(DATA, "window"));   // beside Link's own settings, not under AppData
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");   // the window's opening sound plays before anything is pressed
let win = null, starting = false, cameras = new Set();
let read = 0, misses = 0, lastPicture = 0, spawned = 0, ticking = false, posts = Promise.resolve();
let linkGone = 0, sleeping = false, power = null;   // looks in a row without Link; the PC is being put to sleep; Windows' own sleep timer

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const writeJson = (file, data) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file + ".part", JSON.stringify(data, null, 1)); fs.renameSync(file + ".part", file); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
const answers = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

const plan = () => readJson(PLAN);
const setPlan = (change) => { const p = { ...(plan() || {}), ...change }; writeJson(PLAN, p); return p; };

// ---------------------------------------------------------------- Link

async function linkTarget() {   // Link's dashboard, reachable through the test port
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(1500) })).json();
    return targets.find((t) => t.type === "page" && /127\.0\.0\.1:8765\/?$/.test(t.url)) || null;
  } catch { return null; }
}

// Run something in Link's page; what it returns comes back, or null when Link is not there.
async function inLink(expression) {
  const target = await linkTarget();
  if (!target) return null;
  return new Promise((done) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const end = (value) => { clearTimeout(timer); try { ws.close(); } catch { /* closed already */ } done(value); };
    const timer = setTimeout(() => end(null), 60000);
    ws.onerror = () => end(null);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) end(d.result && d.result.result ? d.result.result.value : null); };
  });
}

// Link open with its test port: opened here when it is not. Returns "" or why not.
async function ensureLink() {
  if (await linkTarget()) return "";
  const env = { ...process.env, LINK_DEBUG_PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  if (await answers("http://127.0.0.1:8765/api/status")) {
    // Link is open the ordinary way, without its test port: it is asked to close as its own close button
    // would (a second copy of Link's window hands that on and ends), and is then opened again below.
    const plain = { ...env };
    delete plain.LINK_DEBUG_PORT;
    spawn(process.execPath, [path.join(REELS, "shell"), "--close-for-night"], { cwd: ROOT, env: plain, detached: true, stdio: "ignore", windowsHide: true }).unref();
    let gone = false;
    for (let i = 0; i < 45 && !gone; i++) { await sleep(1000); gone = !(await answers("http://127.0.0.1:8765/api/status")); }
    if (!gone) return "Link did not close: it is still working on something, or asks whether to close. Close Link yourself, then start the night.";
    await sleep(2500);   // its launcher ends with it
  }
  spawn(pythonw(), [path.join(REELS, "link.pyw")], { cwd: ROOT, env, detached: true, stdio: "ignore", windowsHide: true }).unref();
  let there = false;
  for (let i = 0; i < 60 && !there; i++) { await sleep(1000); there = !!(await linkTarget()); }
  if (!there) return "Link did not open. Start it from its own icon to see why, close it, and try again.";
  await sleep(12000);   // Link's start-up screen, and the dashboard loading behind it
  return "";
}

// ---------------------------------------------------------------- Discord

// A picture of this window as it is now, drawn off screen so that it is there when the window is closed too.
async function picture() {
  const cam = new BrowserWindow({ ...SIZE, show: false, frame: false, backgroundColor: "#0e2433",
    webPreferences: { offscreen: true, preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  cameras.add(cam.webContents);
  try {
    await cam.loadFile(path.join(__dirname, "index.html"), { query: { camera: "1" } });   // "camera": the picture is taken in silence
    await sleep(1800);   // the page asks how it stands and draws it
    const image = await cam.webContents.capturePage();
    const file = path.join(DATA, "link-night.png");
    fs.writeFileSync(file, image.toPNG());
    return file;
  } catch { return null; } finally {
    cameras.delete(cam.webContents);
    if (!cam.isDestroyed()) cam.destroy();
  }
}

// What is posted is a card (a Discord embed): a bar in its kind's colour, a title, a line or two, named
// fields, the picture of the window inside it when there is one, and under it how far the night is.
const COLOURS = { start: 0x4ade80, running: 0x4ade80, stretch: 0x9fd8c8, info: 0x9fd8c8, settings: 0x9fd8c8, end: 0xf2c744, trouble: 0xf59e0b, interrupted: 0xff5d5d };
const meter = (part) => "▰".repeat(Math.round(part * 14)) + "▱".repeat(14 - Math.round(part * 14));
function footer() {   // ▰▰▰▱▱▱ 32% · 3 h 24 min left · ends 20:18
  const p = plan();
  if (!p || !p.end) return undefined;
  const part = progress(), left = Math.max(0, Math.round((p.end - Date.now()) / 60000));
  const how = p.state === "running" ? `${left >= 60 ? `${Math.floor(left / 60)} h ` : ""}${left % 60} min left · ends ${clock(p.end)}` : p.state === "interrupted" ? `interrupted · was to end ${clock(p.end)}` : `${p.state} ${clock(p.stoppedAt || Date.now())}`;
  return { text: `${meter(part)} ${Math.round(part * 100)}% · ${how}` };
}

// A card in #night (in the alerts channel while there is no #night), one after another. `always`:
// an answer to a Discord command is given also when updates are switched off.
function post(card, { withPicture = false, always = false } = {}) {
  posts = posts.then(async () => {
    if (!always && !options().discord) return;
    const cfg = readJson(DISCORD_FILE) || {};
    const channel = (cfg.channels || {}).night || (cfg.channels || {}).alerts;
    if (!cfg.token || !channel) return;
    const file = withPicture ? await picture() : null;
    const embed = { color: COLOURS[card.kind] ?? COLOURS.info, title: String(card.title || "Link Night").slice(0, 250), description: String(card.text || "").slice(0, 3500) || undefined,
      fields: (card.fields || []).filter((f) => f && f.value).slice(0, 10).map((f) => ({ name: String(f.name).slice(0, 250), value: String(f.value).slice(0, 1020), inline: !!f.inline })),
      footer: footer(), timestamp: new Date().toISOString(), ...(file ? { image: { url: `attachment://${path.basename(file)}` } } : {}) };
    // under the card, the buttons that fit it (panel.js); under the remote, all of them
    const body = card.kind === "remote" ? panel() : { embeds: [embed], components: buttons(card.kind) };
    await new DiscordBot(cfg.token).api("POST", `/channels/${channel}/messages`, { ...body, allowed_mentions: { parse: [] } }, card.kind === "remote" ? undefined : file || undefined);
  }).catch((e) => { try { fs.appendFileSync(path.join(DATA, "night.log"), `${new Date().toTimeString().slice(0, 8)} Discord: ${e.message}\n`); } catch { /* nothing to write to */ } });
  return posts;
}

// How the night stands, as a card's fields: what it does now, what it records, what it has so far.
function standing() {
  const s = readJson(STATUS) || {}, n = s.now || {};
  const doing = s.phase === "recording" && n.minute ? `Stretch ${s.segment} · minute ${n.minute} of ${n.of}` : s.phase === "processing" ? `Stretch ${s.segment} · making tapes${n.processing ? ` (${n.processing.replace(" tapes", "")})` : ""}`
    : s.phase ? `${s.segment ? `Stretch ${s.segment} · ` : ""}${s.phase}` : "";
  const streams = (n.recording || []).map((r) => `**${r.name}** · ${r.minutes} min${r.chat != null ? ` · chat ${r.chat}/min` : ""}`).join("\n");
  return [{ name: "Now", value: doing, inline: true },
    { name: "So far", value: s.tapes ? `${s.tapes.length} tape${s.tapes.length === 1 ? "" : "s"} · ${Number(s.hours_collected || 0).toFixed(1)} h · ${s.candidates || 0} moments` : "", inline: true },
    { name: "Recording", value: streams },
    { name: "Checks", value: s.steps ? ((s.failed || []).length ? `⚠ ${s.failed.length} of ${s.steps} failed` : `✅ All ${s.steps} passed`) : "", inline: true },
    { name: "Free room", value: s.free_gb ? `${s.free_gb} GB` : "", inline: true }];
}

// ---------------------------------------------------------------- the night

const running = () => { const s = readJson(STATUS), p = plan(); return !!p && p.state === "running" && !!s && s.state === "running" && alive(s.pid); };
const busy = () => starting || sleeping || (plan() || {}).state === "running" || !!(plan() || {}).sleepAt;
function progress() {   // how far the night is, 0 to 1: by the clock while it runs, where it stopped afterwards
  const p = plan(), s = readJson(STATUS);
  if (!p || !p.started || !p.end) return 0;
  const at = p.state === "running" ? Date.now() : p.state === "finished" ? p.end : (p.stoppedAt || (s && s.beat) || Date.now());
  return Math.min(1, Math.max(0, (at - p.started) / (p.end - p.started)));
}

function state() {
  const p = plan(), live = running();
  return { run: readJson(STATUS), plan: p, options: options(), running: live, starting, stopping: live && fs.existsSync(STOP),
    interrupted: !!p && p.state === "interrupted", progress: progress(), power, room: estimate(live || starting ? (p || {}).hours || options().hours : options().hours, live || starting ? ((p || {}).options || {}).streams || options().streams : options().streams),
    sleepIn: p && p.sleepAt ? Math.max(0, Math.round((p.sleepAt - Date.now()) / 1000)) : 0, sleeping };
}

function launch() {   // the run, as a program of its own; it reads plan.json
  fs.rmSync(STOP, { force: true });
  fs.rmSync(STATUS, { force: true });
  fs.writeFileSync(EVENTS, "");
  read = 0; misses = 0; lastPicture = Date.now(); spawned = Date.now();
  spawn(process.execPath, [path.join(__dirname, "driver.js"), String((plan() || {}).hours || 5), String(SEG)],
    { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

// A new night of so many hours. Returns {ok} or {ok: false, error}.
async function start(hours) {
  if (busy()) return { ok: true };
  hours = Math.min(12, Math.max(1, Math.round(Number(hours) || options().hours || 5)));
  starting = true;
  try {
    const why = await ensureLink();
    if (why) return { ok: false, error: why };
    const o = options();
    writeJson(PLAN, { state: "running", started: Date.now(), end: Date.now() + hours * 3600000, hours, autos: 0, why: "", sleepAt: 0,
      options: { relayChat: !!o.relayChat, shootersOnly: !!o.shootersOnly, streams: o.streams, prefer: o.prefer } });
    launch();
    for (let i = 0; i < 20 && !running(); i++) await sleep(500);
    if (running()) return { ok: true };
    setPlan({ state: "interrupted", why: "the night run did not start", stoppedAt: Date.now() });
    return { ok: false, error: "The night run did not start. Its lines are in night.log in the .link folder." };
  } finally {
    starting = false;
  }
}

// Carry on an interrupted night until the time it was to end.
async function carryOn() {
  const p = plan();
  if (busy()) return { ok: true };
  if (!p || p.state !== "interrupted") return { ok: false, error: "No night was interrupted. Start one instead." };
  if (p.end - Date.now() < 22 * 60000) return { ok: false, error: `That night was to end at ${clock(p.end)}: there is no time left to carry on. Start it again instead.` };
  starting = true;
  try {
    const why = await ensureLink();
    if (why) return { ok: false, error: why };
    setPlan({ state: "running", why: "" });
    launch();
    for (let i = 0; i < 20 && !running(); i++) await sleep(500);
    if (running()) return { ok: true };
    setPlan({ state: "interrupted", why: "the night run did not start", stoppedAt: Date.now() });
    return { ok: false, error: "The night run did not start. Its lines are in night.log in the .link folder." };
  } finally {
    starting = false;
  }
}

function stop() {   // asked, not killed: what records now is saved and made into tapes first
  if (running()) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STOP, ""); return true; }
  return false;
}

// The night was interrupted: say so at once, save what Link still records, open Link again if it is
// gone (its bot hears /continue and /retry), and wait to be told, or carry on if that is ticked.
async function interrupted(why, linkGone) {
  const s = readJson(STATUS), p = setPlan({ state: "interrupted", why, stoppedAt: Date.now() });
  if (s && s.pid && alive(s.pid)) { try { process.kill(s.pid); } catch { /* gone already */ } }
  let reopened = "";
  if (linkGone) reopened = (await ensureLink()) ? " Link could not be opened again." : " Link was opened again; a recording that was cut off is finished there.";
  else await inLink("(async () => { for (const c of (state.shell || {}).channels || []) if (c.recording) await shell.stopChannel(c.id); return true; })()");   // saved, not left running unwatched
  const left = p.end - Date.now() >= 22 * 60000;
  const auto = options().autoContinue && left && (p.autos || 0) < 3 && !(linkGone && reopened.includes("not"));
  post({ kind: "interrupted", title: "😱 Oh no, Link Night was interrupted", text: `${why[0].toUpperCase()}${why.slice(1)}.${reopened}`, fields: [
    { name: "What now", value: auto ? "It carries on by itself in a moment." : `${left ? `\`/continue\` carries on until **${clock(p.end)}**\n` : ""}\`/retry\` starts the ${p.hours} hours again` },
    ...standing().filter((f) => f.name === "So far")] }, { withPicture: true });
  if (auto) {
    setPlan({ autos: (p.autos || 0) + 1 });
    await sleep(15000);
    const done = await carryOn();
    if (!done.ok) post({ kind: "trouble", title: "⚠ Link Night could not carry on by itself", text: done.error });
  }
}

// What the run reported since the last look, posted in order; trouble is marked.
function tellEvents() {
  let bytes;
  try { bytes = fs.readFileSync(EVENTS); } catch { return; }
  if (bytes.length < read) read = 0;   // a new night began the file again
  const whole = bytes.lastIndexOf(10);   // up to the last full line; `read` counts bytes
  if (whole < read) return;
  const fresh = bytes.subarray(read, whole).toString("utf8");
  read = whole + 1;
  for (const line of fresh.split("\n").filter(Boolean)) {
    try {   // the night's last card carries the picture of the window as it ended
      const e = JSON.parse(line);
      post({ ...e, title: e.kind === "trouble" ? `⚠ ${e.title}` : e.title }, { withPicture: e.kind === "end" });
    } catch { /* half a line */ }
  }
}

// Windows' own sleep timer, for the window to say: after how many seconds without use this PC goes to
// sleep (0: never), on mains or on battery, whichever it runs on now. powercfg's words are in the
// user's language, so only its two numbers are read: the last two, mains first.
function readPower() {
  execFile("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"], { windowsHide: true, timeout: 15000 }, (error, out) => {
    const found = String(out || "").match(/0x[0-9a-f]{8}/gi) || [];
    if (error || found.length < 2) return;
    const [mains, battery] = found.slice(-2).map((h) => parseInt(h, 16));
    let onBattery = false;
    try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* not known: mains */ }
    power = { seconds: onBattery ? battery : mains, onBattery };
  });
}

// Is Link closed on purpose (its own close button), as Link's window notes when it goes? Not when the
// night run itself asked it to close, and not a note from long ago.
function closedOnPurpose() {
  const note = readJson(LINK_CLOSED);
  return !!note && !note.forNight && Date.now() - note.at < 3 * 60000;
}

// Link Night goes when Link goes: its window closes and the program ends, once what is to be posted is posted.
function leave() {
  if (win) win.close();
  posts.then(() => app.quit());
}

function stayAwake() {   // the sleep that was announced is called off
  const due = !!(plan() || {}).sleepAt && !sleeping;
  if (due) setPlan({ sleepAt: 0 });
  return due;
}

// The night is done and "Sleep PC when done" is ticked: wait until Link has nothing left to do, close
// it the way its own close button does, and put the PC to sleep. If Link will not close, the PC stays on.
async function goToSleep() {
  sleeping = true;
  setPlan({ sleepAt: 0 });
  try {
    for (let i = 0; i < 120; i++) {   // up to 20 minutes for a tape still being made, or a recording still being saved
      const left = await inLink("(state.status.job.running ? 1 : 0) + state.ingestQueue.length + ((state.shell || {}).channels || []).filter((c) => c.recording || c.saving).length");
      if (left === 0 || left === null) break;
      await sleep(10000);
    }
    if (await answers(LINK)) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE; delete env.LINK_DEBUG_PORT;
      spawn(process.execPath, [path.join(REELS, "shell"), "--close-for-night"], { cwd: ROOT, env, detached: true, stdio: "ignore", windowsHide: true }).unref();
      let gone = false;
      for (let i = 0; i < 60 && !gone; i++) { await sleep(1000); gone = !(await answers(LINK)); }
      if (!gone) { sleeping = false; post({ kind: "trouble", title: "⚠ The PC stays awake", text: "Link did not close (it is still working on something, or asks whether to close), so the PC was not put to sleep." }); return; }
      await sleep(3000);
    }
    await post({ kind: "info", title: "💤 Night is putting the PC to sleep", text: "Link is closed. The PC goes to sleep now. Good night." });
    try { fs.appendFileSync(path.join(DATA, "night.log"), `${new Date().toTimeString().slice(0, 8)} the PC is put to sleep${process.env.LINK_NIGHT_NO_SLEEP ? " (not really: LINK_NIGHT_NO_SLEEP is set)" : ""}\n`); } catch { /* nothing to write to */ }
    // LINK_NIGHT_NO_SLEEP is for tests: everything but the sleep itself
    if (!process.env.LINK_NIGHT_NO_SLEEP) spawn("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    leave();
  } catch (e) {
    sleeping = false;   // something went wrong on the way: the PC stays on, and Link Night stays to be looked at
  }
}

async function tick() {
  if (ticking || starting || sleeping) return;
  ticking = true;
  try {
    const up = await answers(LINK);
    linkGone = up ? 0 : linkGone + 1;
    const p = plan();
    if (!p || p.state !== "running") {
      if (p && p.sleepAt && Date.now() >= p.sleepAt) return void goToSleep();
      if (linkGone >= 2 && !starting) return leave();   // Link is closed: Link Night closes too
      return;
    }
    tellEvents();
    const s = readJson(STATUS);
    if (!up && closedOnPurpose()) {   // Link was closed while a night ran: that ends the night, and Link Night goes with Link
      if (s && s.pid && alive(s.pid)) { try { process.kill(s.pid); } catch { /* gone already */ } }
      setPlan({ state: "stopped", why: "Link was closed", stoppedAt: Date.now(), sleepAt: 0 });
      post({ kind: "end", title: "🌙 Link Night ended: Link was closed", text: "Closing Link ends the night. What was being recorded was saved; Link makes those tapes the next time it opens.",
        fields: standing().filter((f) => f.name === "So far") });
      return leave();
    }
    if (s && s.state === "finished") {
      if (s.outcome === "gave-up") return await interrupted(`it gave up: ${s.why || "see the report"}`, false);
      setPlan({ state: s.outcome === "stopped" ? "stopped" : "finished", stoppedAt: Date.now() });
      // The night ran its hours and its tapes are made: with "Sleep PC when done" ticked, Link is closed and the PC put
      // to sleep, after a wait in which that can be called off. Not after Stop: whoever pressed it is at the PC.
      if (s.outcome !== "stopped" && options().sleepAfter) {
        setPlan({ sleepAt: Date.now() + SLEEP_WAIT });
        post({ kind: "sleep", title: "✅ Night is done working · the PC will go to sleep soon", text: `Its tapes are made. In ${SLEEP_WAIT / 1000} seconds Link is closed and the PC is put to sleep. **Stay awake** calls that off.`, fields: standing().filter((f) => f.name === "So far") });
      }
      return;
    }
    if ((!s || !alive(s.pid)) && Date.now() - spawned > 30000) return await interrupted("the night run's program ended unexpectedly", !(await linkTarget()));
    if (await linkTarget()) misses = 0;
    else if (++misses >= 3) return await interrupted("Link closed or crashed", true);
    if (Date.now() - lastPicture >= PICTURE_EVERY) {
      lastPicture = Date.now();
      post({ kind: "running", title: "🌙 Link Night is still running…", text: `Progress bar at **${Math.round(progress() * 100)}%**`, fields: standing() }, { withPicture: true });
    }
  } finally {
    ticking = false;
    if (!win && !busy() && !cameras.size) posts.then(() => { if (!win && !busy()) app.quit(); });   // nothing left to watch
  }
}

// What a Discord command asked for; the answer goes to #night.
async function command(what) {
  const [name, query = ""] = what.split("?");
  const given = Object.fromEntries(new URLSearchParams(query));
  const say = (title, text = "", { kind = "info", fields = [], withPicture = false } = {}) => post({ kind, title, text, fields }, { always: true, withPicture });
  // The choices given with the command are kept, as if ticked in the window. Hours given to /retry are for that night only.
  const change = {};
  for (const key of CHOICES) if (given[key] === "true" || given[key] === "false") change[key] = given[key] === "true";
  if (Number(given.hours) && name !== "retry") change.hours = Number(given.hours);
  if (Number(given.streams)) change.streams = Number(given.streams);
  const changed = Object.keys(change).length > 0;
  if (changed) setOptions(change);
  const o = options();
  const kept = busy() && changed ? "The night that runs keeps the hours, shooters and chat it began with; the rest applies at once." : "";
  const remote = () => post({ kind: "remote" }, { always: true });   // how it stands, the settings, and a button for everything
  if (name === "set") return remote();
  if (name === "status") return busy() ? say("🌙 Link Night is running…", `Progress bar at **${Math.round(progress() * 100)}%**`, { kind: "running", fields: standing(), withPicture: true }) : remote();
  if (name === "night") {
    if (busy()) return say("🌙 Link Night is running…", `Progress bar at **${Math.round(progress() * 100)}%**${kept ? `\n${kept}` : ""}`, { kind: "running", fields: standing(), withPicture: true });
    const done = await start(o.hours);
    return done.ok ? say("🌙 Link Night is starting", `**${o.hours} hours**, until **${clock((plan() || {}).end)}**. The streams follow in a moment.`, { kind: "info" }) : say("⚠ Link Night could not start", done.error, { kind: "trouble" });
  }
  if (name === "continue") {
    if (busy()) return say("🌙 Link Night is running already", "", { kind: "running", fields: standing(), withPicture: true });
    const done = await carryOn();
    return done.ok ? say("🌙 Link Night carries on", `Collecting until **${clock((plan() || {}).end)}**, the time the night was to end. The streams follow in a moment.`) : say("⚠ Link Night could not carry on", done.error, { kind: "trouble" });
  }
  if (name === "retry") {
    if (busy()) return say("🌙 Link Night is running already", "`/nightstop` ends it first.", { kind: "running", fields: standing(), withPicture: true });
    const done = await start(Number(given.hours) || (plan() || {}).hours || 0);
    return done.ok ? say("🌙 Link Night starts again", `${(plan() || {}).hours} hours, until **${clock((plan() || {}).end)}**. The streams follow in a moment.`) : say("⚠ Link Night could not start again", done.error, { kind: "trouble" });
  }
  if (name === "awake") return stayAwake() ? say("☕ The PC stays awake", "Link stays open too.") : say("The PC was not about to sleep");
  if (name === "stop") return stop() ? say("🌙 Link Night is stopping", "What records now is saved and made into tapes first; that takes a few minutes.", { fields: standing() }) : remote();
}

// ---------------------------------------------------------------- the window

function open() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({
    ...SIZE, resizable: false, maximizable: false, fullscreenable: false, frame: false,
    backgroundColor: "#0e2433", title: "Link Night", icon: path.join(REELS, "ui", "static", "link_night.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.show();   // said outright: a program that a Discord command started without a window would keep its first one hidden
  win.focus();  // so that Enter (start the night) goes to this window
  app.focus({ steal: true });
  win.on("closed", () => { win = null; if (!busy()) posts.then(() => { if (!win && !busy()) app.quit(); }); });
}

const fromWindow = (e) => !!win && e.sender === win.webContents;
const fromOurs = (e) => fromWindow(e) || cameras.has(e.sender);   // the window, or the picture of it
ipcMain.handle("night:state", (e) => (fromOurs(e) ? state() : null));
ipcMain.handle("night:start", (e, hours) => (fromWindow(e) ? start(hours) : null));
ipcMain.handle("night:continue", (e) => (fromWindow(e) ? carryOn() : null));
ipcMain.handle("night:stop", (e) => { if (!fromWindow(e)) return null; stop(); return state(); });
ipcMain.handle("night:awake", (e) => { if (!fromWindow(e)) return null; stayAwake(); return state(); });
ipcMain.handle("night:options", (e, change) => {   // the window's choices, kept; a night that runs keeps the ones it began with
  return fromWindow(e) ? setOptions(change) : null;
});
ipcMain.handle("night:report", (e) => {   // the newest run's report, opened with whatever opens .md files on this PC
  if (!fromWindow(e)) return null;
  const s = readJson(STATUS);
  if (!s || !s.report || path.dirname(s.report) !== path.join(ROOT, "videos", "walkthroughs") || !fs.existsSync(s.report)) return { ok: false, error: "There is no report yet." };
  shell.openPath(s.report);
  return { ok: true };
});
ipcMain.on("night:close", (e) => { if (fromWindow(e) && win) win.close(); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => { const what = DO(argv); if (what) command(what); else open(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    fs.mkdirSync(DATA, { recursive: true });
    try { read = fs.statSync(EVENTS).size; } catch { read = 0; }   // what a night that still runs has said already is not said again
    lastPicture = Date.now(); spawned = 0;
    readPower();
    setInterval(readPower, 60000);
    const what = DO(process.argv);
    if (what) command(what).then(() => posts).then(() => { if (!win && !busy()) app.quit(); });
    // Link Night is opened from Link, and is not there without it: with Link closed it does not open
    else answers(LINK).then((up) => (up || busy() ? open() : app.quit()));
    setInterval(tick, 5000);
  });
  app.on("window-all-closed", () => { /* the program stays while a night runs; tick() ends it when there is nothing left to watch */ });
}
