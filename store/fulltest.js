// The whole extension tried on a real stream, in Brave with a profile of its own (nothing of the user's is
// touched): the panel, Record / Mark / Stop pressed in the panel itself, the file and what is inside it,
// the rewind, the marks for an editor, recording on with no limit and no key,
// delete.
// usage: node store/fulltest.js <start url> <port> <full|sound|ear> <out dir>
//   full   everything, with the sound muted
//   sound  a short recording with the sound on, to measure that the file has sound
//   ear    the panel's sound bar: what is heard is turned down and muted, and the file keeps its sound (the sound is on)
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const [url, port, mode, outDir] = process.argv.slice(2);
const EXE = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const EXT = path.join(__dirname, "..", "extension");
const ID = "klganbopdlalelnnljifoabgkcibhfld";   // the id an unpacked extension gets from this folder's path
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });
const dl = path.join(outDir, "downloads"), profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-full-"));
const report = { mode, url, checks: [], facts: {} };
const save = () => fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
const check = (area, name, ok, detail) => { report.checks.push({ area, name, ok: !!ok, detail: detail === undefined ? "" : detail }); console.log(`${ok ? "ok  " : "FAIL"} [${area}] ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`); save(); };
const fact = (k, v) => { report.facts[k] = v; save(); };

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,channels,sample_rate", "-of", "json", file], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout); const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
    return { seconds: Number(j.format.duration), video: v && `${v.codec_name} ${v.width}x${v.height} ${v.avg_frame_rate}`, audio: a && `${a.codec_name} ${a.channels}ch ${a.sample_rate}`, w: v && v.width, h: v && v.height }; } catch (e) { return { error: (r.stderr || String(e)).slice(0, 200) }; }
}
const loudness = (file) => { const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" }); const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr || ""); return m ? Number(m[1]) : null; };
// The steps between frames longer than a tenth of a second: how even the picture is.
function steps(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], { encoding: "utf8", maxBuffer: 1 << 26 });
  const t = r.stdout.split(/\s+/).map(Number).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  let long = 0, worst = 0; for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; if (d > 0.1) long++; if (d > worst) worst = d; }
  return { frames: t.length, longSteps: long, worst: Number(worst.toFixed(2)) };
}
// What the recording carries inside itself (offscreen.js, tag()).
// How bright the picture is, second by second: a picture that never changes is not a stream.
function brightness(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", "fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const y = [...(r.stderr || "").matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return y.length ? { min: Math.round(Math.min(...y)), max: Math.round(Math.max(...y)), changes: Number((Math.max(...y) - Math.min(...y)).toFixed(1)) } : null;
}
function inside(file) {
  const b = fs.readFileSync(file), at = b.lastIndexOf(Buffer.from("uuidLinkLiteRecord01"));
  if (at < 4) return null;
  try { return JSON.parse(b.subarray(at + 20, at - 4 + b.readUInt32BE(at - 4)).toString("utf8")); } catch (e) { return { error: String(e) }; }
}

(async () => {
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true }); fs.mkdirSync(dl, { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "Preferences"), JSON.stringify({ download: { prompt_for_download: false, default_directory: dl, directory_upgrade: true } }));
  const child = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, `--allowlisted-extension-id=${ID}`,
    "--no-first-run", "--no-default-browser-check", ...(mode === "sound" || mode === "ear" ? [] : ["--mute-audio"]), "--autoplay-policy=no-user-gesture-required", "--window-size=1500,950", "--window-position=40,40", url], { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 60 && !ver; i++) { await sleep(500); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  fact("browser", ver.Browser);
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const send = (method, params = {}, sessionId, wait = 60000) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); setTimeout(() => { if (waiting.delete(i)) r({ timedOut: true }); }, wait); });
  const targets = async () => ((await send("Target.getTargets")).result || {}).targetInfos || [];
  const attach = async (t) => (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).result.sessionId;
  const run = async (s, expression, wait) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s, wait);
    if (r.timedOut) return { error: "no answer in time" };
    return r.result && r.result.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const worker = async () => { for (let i = 0; i < 30; i++) { for (const w of (await targets()).filter((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${ID}`))) return attach(w); await sleep(500); } throw new Error("the extension's background script is not running"); };
  let w, ps, f;
  const W = (x, wait) => run(w, `(async () => { const v = await (${x}); return v === undefined ? null : v; })()`, wait);
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 72 }, ps); if (s.result && s.result.data) fs.writeFileSync(path.join(outDir, name + ".jpg"), Buffer.from(s.result.data, "base64")); };
  const TAB = `(await chrome.tabs.query({ url: STREAM_PAGES })).find((t) => t.active)`;
  const who = () => W(`(async () => { const t = ${TAB}; return t ? toTab(t.id, { type: "link:who" }) : null; })()`);
  const files = () => fs.readdirSync(dl, { recursive: true }).map(String).filter((x) => /\.(mp4|webm|mkv|edl)$/.test(x) && !/\.crdownload$/.test(x));
  const videos = () => files().filter((x) => !/\.edl$/.test(x));
  const waitVideos = async (n, secs = 60) => { for (let i = 0; i < secs; i++) { if (videos().length >= n && !fs.readdirSync(dl, { recursive: true }).some((x) => /crdownload$/.test(String(x)))) return true; await sleep(1000); } return false; };
  // the panel: its frame is a page of its own to the browser
  const frame = async () => { for (let i = 0; i < 20; i++) { const t = (await targets()).find((t) => t.type === "iframe" && t.url.includes("popup.html")); if (t) return attach(t); await sleep(400); } return null; };
  const F = (x) => run(f, `(async () => { const v = await (${x}); return v === undefined ? null : v; })()`);
  const press = (re, where = "document") => F(`(() => { const b = [...${where}.querySelectorAll("button")].find((b) => ${re}.test(b.textContent) && !b.disabled); if (b) b.click(); return !!b; })()`);
  const panelText = () => F(`document.body.innerText.replace(/\\s+/g, " ")`);
  const frameWidth = () => run(ps, `(() => { const i = document.querySelector('iframe[title="Link Lite Recorder"]'); return i ? Math.round(i.getBoundingClientRect().width) : 0; })()`);
  const drawer = async (open) => { const is = await F(`!document.getElementById("more").hidden`); if (is !== open) { await F(`document.getElementById("drawer").click()`); await sleep(900); } };
  const fold = (key) => F(`(() => { const d = document.querySelector(".fold-${key}"); if (!d) return false; if (!d.open) { d.open = true; d.dispatchEvent(new Event("toggle")); } return true; })()`);

  try {
    await sleep(6000);
    const page = (await targets()).find((t) => t.type === "page" && /twitch\.tv|kick\.com/.test(t.url));
    ps = await attach(page); await send("Page.enable", {}, ps);
    w = await worker();
    await run(w, `self.__errors = []; self.addEventListener("unhandledrejection", (e) => self.__errors.push(String(e.reason))); self.addEventListener("error", (e) => self.__errors.push(String(e.message)))`);

    // ---- a live channel: the one asked for, or the first of the site's own listing that plays
    const playing = async () => { for (let i = 0; i < 14; i++) { await sleep(2000); const x = await who(); if (x && x.channel && x.video && x.view) return x; if (x && x.error) w = await worker(); } return null; };
    let on = await playing();
    if (!on) {
      const home = /kick\.com/.test(url) ? "https://kick.com/browse" : "https://www.twitch.tv/directory/all";
      await send("Page.navigate", { url: home }, ps); await sleep(9000);
      const links = await run(ps, `[...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => /^\\/[A-Za-z0-9_]{3,25}$/.test(h)))].slice(0, 40)`);
      for (const h of (Array.isArray(links) ? links : []).slice(0, 12)) { await send("Page.navigate", { url: new URL(h, home).href }, ps); on = await playing(); if (on) break; }
    }
    if (!on) throw new Error("no live channel that plays was found");
    // Twitch asks before some streams ("intended for certain audiences"): answered, as a viewer would
    let gate = false;
    const asks = () => run(ps, `[...document.querySelectorAll("button")].some((b) => /^Start Watching$/i.test(b.textContent.trim()))`);
    for (let i = 0; i < 6 && !gate; i++) { gate = await asks(); if (!gate) await sleep(1500); }
    if (gate) {
      const seen = await who();
      check("question", "Link sees Twitch's question before the stream", seen && seen.gate === true, seen && { gate: seen.gate });
      const tried = await W(`(async () => record(${TAB}))()`);
      check("question", "and refuses to record it, saying what to do", tried && tried.ok === false && /Start Watching/.test(tried.error), tried);
      await W(`(async () => { const t = ${TAB}; return toTab(t.id, { type: "link:panel" }); })()`); await sleep(1500);
      const pf = await frame();
      const words = pf ? await run(pf, `document.body.innerText.replace(/\\s+/g, " ")`) : "";
      const off = pf ? await run(pf, `[...document.querySelectorAll("button")].filter((b) => /Record|Rewind on/.test(b.textContent)).every((b) => b.disabled)`) : null;
      check("question", "the panel says so, with Record and Rewind switched off", /Twitch is asking before it shows this stream/.test(words) && off === true, { words: words.slice(0, 160), off });
      await shot("twitch-0-question");
      await W(`(async () => { const t = ${TAB}; return toTab(t.id, { type: "link:panel" }); })()`); await sleep(600);   // shut again: the test opens it itself below
      await run(ps, `(() => { const b = [...document.querySelectorAll("button")].find((b) => /^Start Watching$/i.test(b.textContent.trim())); if (b) b.click(); })()`);
      await sleep(6000);
      const after = await who();
      check("question", "answered: Link sees the stream", after && after.gate === false && after.video, after && { gate: after.gate, video: after.video });
    }
    fact("the site asked before showing the stream", !!gate);
    if (gate) await sleep(6000);
    fact("the player", await run(ps, `(() => { const v = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0]; return v ? { paused: v.paused, ready: v.readyState, w: v.videoWidth, h: v.videoHeight, gate: /intended for certain audiences/i.test(document.body.innerText) } : null; })()`));
    const moving = async () => { const t = () => run(ps, `(() => { const v = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0]; return v ? v.currentTime : -1; })()`); const a = await t(); await sleep(2000); return (await t()) - a > 1; };
    fact("the player's clock moved in 2 s (not a check: the sites swap their video element)", await moving());
    const site = on.site;
    fact("stream", { site, view: on.view && `${Math.round(on.view.w)}x${Math.round(on.view.h)} @${on.view.dpr}`, viewers: on.viewers, canTheatre: on.theatre, hasTitle: !!on.title, hasCategory: !!on.category });
    await sleep(3000);

    // ---- start-up
    fact("version", await W("chrome.runtime.getManifest().version"));
    for (let i = 0; i < 10 && (on.viewers == null || !on.title); i++) { await sleep(1000); on = (await who()) || on; }   // the site shows these a moment after the picture
    check("start", "the stream's page is recognised: channel, picture, title, viewers", on.channel && on.video && on.viewers != null && !!on.title, { viewers: on.viewers, title: !!on.title });

    // ---- the panel
    await W(`(async () => { const t = ${TAB}; return toTab(t.id, { type: "link:panel" }); })()`);
    await sleep(1500);
    f = await frame();
    check("panel", "the toolbar button opens the panel on the page", !!f);
    check("panel", "it opens as the capsule, 292 wide", (await frameWidth()) === 292, await frameWidth());
    await shot(`${site}-1-capsule`);
    await drawer(true);
    check("panel", "More widens it to 560", (await frameWidth()) === 560, await frameWidth());
    const folds = await F(`[...document.querySelectorAll("#more > details")].map((d) => d.querySelector("summary").textContent.trim())`);
    check("panel", "its folds: Skins, More streams, Choices, and none for a licence", Array.isArray(folds) && !/licence/i.test(folds.join(" ")) && /^Skins · Classic/i.test(folds[0] || "") && folds.length === 3, folds);
    const sizes = []; for (let i = 0; i < 8; i++) { sizes.push(await F(`[document.documentElement.scrollHeight, innerHeight, document.body.offsetHeight]`)); await sleep(350); }
    fact("the frame after More: [content, frame, body] every 350 ms", sizes);
    check("panel", "it never shows a scrollbar", await F(`document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1`), await F(`[document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]`));
    await shot(`${site}-2-more`);
    await drawer(false);
    check("panel", "Less brings the capsule back", (await frameWidth()) === 292);

    if (mode === "theatre") {   // what the page says about its theatre button, and what pressing it through Link does
      const labels = () => run(ps, `[...document.querySelectorAll("button[aria-label], button[title]")].map((b) => b.getAttribute("aria-label") || b.title).filter((l) => /theat|cine|mode|modo/i.test(l))`);
      await sleep(8000);
      fact("page", await run(ps, `({ url: location.href, canTheatre: null, buttons: [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).slice(0, 40), videos: document.querySelectorAll("video").length })`));
      fact("who now", await who());
      const classes = () => run(ps, `[...new Set([...document.querySelectorAll("[class*='theat' i]")].flatMap((e) => [...e.classList].filter((c) => /theat/i.test(c))))].slice(0, 12)`);
      const key = () => run(ps, `(() => { for (const t of [document, document.body, document.querySelector("video")]) for (const type of ["keydown", "keyup"]) t.dispatchEvent(new KeyboardEvent(type, { key: "t", code: "KeyT", keyCode: 84, which: 84, altKey: true, bubbles: true, cancelable: true })); return 1; })()`);
      fact("classes at first", await classes());
      await key(); await sleep(2500);
      fact("after a made-up Alt+T", { view: (await who()).view.w, classes: await classes() });
      await key(); await sleep(2000);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 300 }, ps); await sleep(300);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 320 }, ps); await sleep(1200);
      fact("with a real mouse over the player", await run(ps, `[...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).filter((l) => /theat|full|mute|pause|settings/i.test(l))`));
      fact("labels before", await labels());
      fact("press on", await W(`(async () => { const t = ${TAB}; return toTab(t.id, { type: "link:theatre", on: true }); })()`));
      await sleep(2500);
      fact("labels after", await labels()); fact("view after", (await who()).view);
      fact("classes in theatre", await classes());
      fact("press off", await W(`(async () => { const t = ${TAB}; return toTab(t.id, { type: "link:theatre", on: false }); })()`));
      await sleep(2000); fact("labels at the end", await labels()); fact("view at the end", (await who()).view);
      console.log(JSON.stringify(report.facts, null, 1));
    } else if (mode === "ear") {   // the sound bar: it turns down what is heard, and nothing of what is recorded
      const bar = () => F(`(() => { const s = document.getElementById("sound"), r = s.getBoundingClientRect(); return { shown: !s.hidden, off: s.classList.contains("off"), value: Number(document.getElementById("vol").value), high: Math.round(r.height), body: document.body.offsetHeight }; })()`);
      const before = await bar();
      check("ear", "no sound bar before a recording", before && before.shown === false, before);
      check("record", "Record, pressed in the panel, starts", await press("/Record/") && (await sleep(6000), (await W("getCap()")) || {}).state === "recording");
      const rec = (await targets()).find((t) => t.url.includes("offscreen.html"));
      const o = rec ? await attach(rec) : null;
      check("ear", "the recorder page is there", !!o);
      // what goes to the speakers, measured behind the volume: its loudness over a second and a half
      await run(o, `(() => { const a = cap.ear.createAnalyser(); a.fftSize = 2048; cap.gain.connect(a); self.__heard = async () => { const b = new Float32Array(a.fftSize); let sum = 0, n = 0; for (let i = 0; i < 30; i++) { a.getFloatTimeDomainData(b); for (const x of b) { sum += x * x; n++; } await new Promise((r) => setTimeout(r, 50)); } return Math.sqrt(sum / n); }; return 1; })()`);
      const heard = () => run(o, `self.__heard()`);
      const shown = await bar(), full = await heard(), st0 = await W(`toRecorder({ type: "stats" })`);
      check("ear", "the sound bar comes with the recording, at full", shown && shown.shown && shown.value === 100 && st0 && st0.ear === 1, { shown, ear: st0 && st0.ear });
      const room = await F(`(() => { const s = document.getElementById("sound"), withIt = document.body.offsetHeight; s.hidden = true; const without = document.body.offsetHeight; s.hidden = false; return { withIt, without, wide: document.body.offsetWidth }; })()`);
      check("ear", "it takes no room: the panel is as tall with it as without it", room && room.withIt === room.without, room);
      check("ear", "the stream is heard", full > 0.0005, full);
      await shot(`${site}-ear-1-full`);
      await F(`(() => { const v = document.getElementById("vol"); v.value = 30; v.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(1200);
      const low = await heard(), st1 = await W(`toRecorder({ type: "stats" })`), kept = (await W("options()")).volume;
      check("ear", "moved to 30%: it is heard much quieter", low < full * 0.35 && low > 0, { full, low, ratio: full ? Number((low / full).toFixed(3)) : null });
      check("ear", "the level is the recorder's and is kept for next time", st1 && Math.abs(st1.ear - 0.3) < 0.01 && Math.abs(kept - 0.3) < 0.01, { ear: st1 && st1.ear, kept });
      await shot(`${site}-ear-2-low`);
      await F(`document.getElementById("mute").click()`); await sleep(1200);
      const none = await heard(), muted = await bar();
      check("ear", "the speaker mutes it: nothing is heard, and the bar says so", none < 1e-5 && muted.off && muted.value === 0, { none, muted });
      check("ear", "a mute is not kept for next time", Math.abs((await W("options()")).volume - 0.3) < 0.01, (await W("options()")).volume);
      await shot(`${site}-ear-3-muted`);
      await sleep(9000);   // recorded while nothing is heard
      await F(`document.getElementById("mute").click()`); await sleep(1200);
      const back = await bar(), again = await heard();
      check("ear", "pressed again: back at 30%", back.value === 30 && !back.off && again > 1e-5, { back, again });
      const page = await run(ps, `(() => { const v = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth - a.clientWidth)[0]; return v ? { muted: v.muted, volume: v.volume } : null; })()`);
      check("ear", "the stream's own volume is left at full, as the recording needs", page && !page.muted && page.volume === 1, page);
      await press("/Stop/"); await waitVideos(1);
      const file = path.join(dl, videos()[0] || "none"), p = probe(file), vol = loudness(file);
      fact("ear recording", { file: path.basename(file), ...p, meanVolumeDb: vol });
      check("ear", "the file has its sound, though most of it was recorded muted or turned down", !!p.audio && vol != null && vol > -45, { audio: p.audio, meanVolumeDb: vol });
      await sleep(2500);
      const after = await bar();
      check("ear", "the bar goes when the recording ends", after && after.shown === false, after);
      check("ear", "nothing went wrong in the background script", (await run(w, "self.__errors")).length === 0, await run(w, "self.__errors"));
    } else if (mode === "sound" || mode === "short") {
      check("record", "Record, pressed in the panel, starts", await press("/Record/") && (await sleep(5000), (await W("getCap()")) || {}).state === "recording");
      const cap = await W("getCap()");
      check("theatre", `theatre mode is switched on for the recording (${site})`, !!(cap && cap.theatred), { canTheatre: on.theatre, theatred: cap && cap.theatred });
      await sleep(4000); await press("/Mark/"); await sleep(6000);
      const st = await W(`toRecorder({ type: "stats" })`);
      check("chat", "chat is counted while it records", st && st.chat === true, st && { chat: st.chat, perMin: st.perMin });
      await press("/Stop/"); await waitVideos(1);
      const file = path.join(dl, videos()[0] || "none");
      const p = probe(file), vol = loudness(file);
      fact("sound recording", { file: path.basename(file), ...p, meanVolumeDb: vol });
      const br = brightness(file); fact("sound recording brightness", br);
      check("file", "the picture is the moving stream, not black and not a still", br && br.max > 20 && br.changes > 0.5, br);
      check("file", "the picture is bigger than the page showed it before theatre mode", p.h > on.view.h * on.view.dpr + 40, { file: `${p.w}x${p.h}`, pageBefore: `${Math.round(on.view.w)}x${Math.round(on.view.h)}` });
      const ins = inside(file);
      check("file", "the mark, the chat's speed and whose stream it is are inside the file", ins && ins.markers.length === 1 && ins.stream && ins.stream.channel === on.channel && ins.chat && ins.chat.rate.length > 5, ins && { markers: ins.markers, stream: ins.stream });
      check("sound", "the recording has a sound track", !!p.audio, p);
      if (mode === "sound") check("sound", "and it is not silent", vol != null && vol > -60, vol);
      await sleep(2500);
      const after = await who();
      check("theatre", "the page goes back when the recording ends", !!after && Math.abs(after.view.w - on.view.w) < 30, { before: on.view, after: after && after.view });
      check("free", "nothing is written into the site's own storage", (await run(ps, `localStorage.getItem("link-lite")`)) === null);
    } else {
      // ---- a recording, made with the panel's own buttons
      const before = await who();
      check("record", "Record, pressed in the panel, starts", await press("/Record/") && (await sleep(5000), (await W("getCap()")) || {}).state === "recording", await W("getCap()"));
      const cap = await W("getCap()");
      check("theatre", `theatre mode is switched on for the recording (${site})`, !!(cap && cap.theatred), { canTheatre: on.theatre });
      check("theatre", "and the panel says so", /Theatre mode is on/.test(await panelText()), (await panelText()).slice(0, 200));
      check("record", "the title of the stream was read", !!(cap && cap.title), cap && { title: (cap.title || "").slice(0, 40) });
      await sleep(3000);
      check("mark", "Mark, pressed in the panel, marks", await press("/Mark/") && (await sleep(1200), ((await W(`toRecorder({ type: "stats" })`)) || {}).marks === 1));
      check("mark", "the note's field comes with the mark", await F(`!document.getElementById("note-row").hidden`));
      await F(`(() => { const i = document.getElementById("note"); i.value = "test note"; i.form.requestSubmit(); })()`);
      await sleep(7000);
      const st = await W(`toRecorder({ type: "stats" })`);
      check("record", "the clock runs and says what is left of 30 minutes", st && st.seconds > 8 && st.left > 1700, st && { seconds: st.seconds, left: st.left });
      check("chat", "chat is counted while it records", st && st.chat === true, st && { chat: st.chat, perMin: st.perMin });
      check("panel", "the panel keeps off the stream's picture", st && !st.inPicture, st && st.inPicture);
      await shot(`${site}-3-recording`);
      await drawer(true); await shot(`${site}-4-recording-wide`);
      const rows = await F(`(() => { const m = document.getElementById("main"); const tops = [...m.children].map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)).sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1] > 14); return { rows: tops.length, items: [...m.children].map((c) => c.innerText.replace(/\\s+/g, " ").slice(0, 14)) }; })()`);
      check("panel", "while recording, the wide panel's controls are on one row", rows && rows.rows === 1, rows);
      await drawer(false);
      check("record", "Stop, pressed in the panel, saves", await press("/Stop/") && await waitVideos(1), videos());
      await sleep(600);
      const said = await panelText();
      check("free", "the saved message says nothing of a limit", /Saved/.test(said) && !/trial/i.test(said), said.slice(0, 260));
      const one = videos()[0] || "";
      check("file", "one file, in Downloads/Link, named after the channel and the time", /^Link[\\/]/.test(one) && new RegExp(`^${on.channel} \\d{4}-\\d\\d-\\d\\d \\d\\d-\\d\\d-\\d\\d\\.mp4$`, "i").test(path.basename(one)) && files().length === 1, files());
      const p1 = probe(path.join(dl, one)), in1 = inside(path.join(dl, one)), ev = steps(path.join(dl, one));
      fact("recording 1", { file: path.basename(one), ...p1, bytes: fs.statSync(path.join(dl, one)).size, evenness: ev });
      check("file", "it plays: picture and sound, about as long as it ran", p1.video && p1.audio && p1.seconds > 10 && p1.seconds < 30, p1);
      check("file", "the picture is the stream alone, and bigger than the page showed it before theatre mode", p1.h > before.view.h * before.view.dpr + 40, { file: `${p1.w}x${p1.h}`, pageBefore: `${Math.round(before.view.w)}x${Math.round(before.view.h)}` });
      check("file", "the mark, its note, the chat's speed and whose stream it is are inside the file", in1 && in1.markers.length === 1 && in1.notes[0] && in1.notes[0].note === "test note" && in1.stream && in1.stream.channel === on.channel && in1.chat && in1.chat.rate.length > 5, in1 && { markers: in1.markers, notes: in1.notes, stream: in1.stream, chat: in1.chat && in1.chat.rate.length });
      check("file", "the picture is even (few long steps between frames)", ev.longSteps <= ev.frames * 0.02, ev);
      const br = brightness(path.join(dl, one)); fact("recording 1 brightness", br);
      check("file", "the picture is the moving stream, not black and not a still", br && br.max > 20 && br.changes > 0.5, br);
      const ing = spawnSync("python", ["-c", "import sys; sys.path.insert(0, r'" + path.join(__dirname, "..", "tools", "reels") + "'); import ingest, pathlib; d = ingest.inside(pathlib.Path(sys.argv[1])); print(len(d.get('markers', [])), d.get('stream', {}).get('channel'))", path.join(dl, one)], { encoding: "utf8" });
      check("file", "Link (the desktop program) reads what is inside it", ing.stdout.trim() === `1 ${on.channel}`, (ing.stdout + ing.stderr).slice(0, 200));
      await sleep(2500);
      const after = await who();
      check("theatre", "the page goes back when the recording ends", !!after && Math.abs(after.view.w - before.view.w) < 30, { before: before.view, after: after && after.view });

      // ---- the marks, for an editor
      await drawer(true);
      check("marks", "Recordings lists it", await fold("recent") && /Recordings · 1/.test(await F(`document.querySelector(".fold-recent summary").textContent`)));
      await F(`document.querySelector(".stars").click()`); await sleep(500);
      const marksText = await F(`document.querySelector(".marks") ? document.querySelector(".marks").innerText.replace(/\\s+/g, " ") : ""`);
      check("marks", "its star shows the mark with its time and note", /0:0\d test note/.test(marksText), marksText);
      await press("/Copy list/"); await sleep(400);
      check("marks", "Copy list answers", /Copied/.test(await F(`document.querySelector(".marks").innerText`)));
      await press("/Markers for Resolve/"); await sleep(2500);
      const edl = files().find((x) => /\.markers\.edl$/.test(x));
      const edlText = edl ? fs.readFileSync(path.join(dl, edl), "utf8") : "";
      check("marks", "Markers for Resolve saves an .edl beside the video, with the note", !!edl && /test note/.test(edlText) && /ResolveColorBlue/.test(edlText) && /^TITLE:/m.test(edlText), edl || files());
      await shot(`${site}-5-marks`);
      await drawer(false);

      // ---- the rewind
      await W(`setOptions({ rewind: 30 })`);
      check("rewind", "Rewind on, pressed in the panel, starts keeping", await press("/Rewind on/") && (await sleep(4000), (await W("getCap()")) || {}).state === "armed");
      await sleep(36000);
      const rs = await W(`toRecorder({ type: "stats" })`);
      check("rewind", "it holds what was just seen", rs && rs.held >= 30, rs && { held: rs.held, reach: rs.reach });
      await shot(`${site}-6-rewind`);
      check("rewind", "Save last makes a file, and the rewind goes on", await press("/Save last/") && await waitVideos(2) && ((await W("getCap()")) || {}).state === "armed");
      const two = videos().find((x) => x !== one) || "", p2 = probe(path.join(dl, two));
      await sleep(4000);
      check("rewind", "Save last again makes another file", await press("/Save last/") && await waitVideos(3));
      const twoB = videos().find((x) => x !== one && x !== two) || "";
      fact("recording 2 (rewind save)", { file: path.basename(two), ...p2 });
      check("rewind", "the file is the last 30 seconds", p2.seconds > 26 && p2.seconds < 34 && !!p2.audio, p2);
      await sleep(5000);
      check("rewind", "Record from the rewind starts a recording that begins back there", await press("/● Record/") && (await sleep(8000), (await W("getCap()")) || {}).state === "recording");
      await press("/Stop/"); await waitVideos(4);
      const three = videos().find((x) => x !== one && x !== two && x !== twoB) || "", p3 = probe(path.join(dl, three));
      fact("recording 3 (from the rewind)", { file: path.basename(three), ...p3 });
      check("rewind", "that recording is longer than it ran: it has the 30 seconds before", p3.seconds > 30, p3);
      check("rewind", "the rewind stays on after it", ((await W("getCap()")) || {}).state === "armed");

      // ---- no limit: after three recordings, where 0.4.3 stopped, this one goes on
      const more = await F(`chrome.runtime.sendMessage({ type: "link:save", seconds: 30 })`);
      check("free", "a fourth file is saved from the rewind like the others", more && more.ok !== false && await waitVideos(5), more);
      await press("/^Off$/"); await sleep(1500);
      const freeText = await panelText();
      check("free", "the panel offers Record, and asks for nothing", /● Record/.test(freeText) && !/trial|key|EUR|buy/i.test(freeText), freeText.slice(0, 200));
      await shot(`${site}-7-free`);
      check("free", "Record records again", await press("/● Record/") && (await sleep(7000), (await W("getCap()")) || {}).state === "recording");
      await press("/Stop/"); await waitVideos(6);
      check("free", "six files made, none refused", videos().length === 6, videos());

      // ---- delete
      await drawer(true); await fold("recent"); await sleep(500);
      const count = await F(`document.querySelectorAll(".fold-recent .made").length`);
      await F(`[...document.querySelectorAll(".fold-recent .made .del")].pop().click()`); await sleep(500);
      await F(`document.querySelector(".fold-recent .del.sure").click()`); await sleep(2500);
      check("delete", "x pressed twice deletes the recording's file from the computer and from the list", (await F(`document.querySelectorAll(".fold-recent .made").length`)) === count - 1 && !fs.existsSync(path.join(dl, one)), { before: count, left: videos() });

      await drawer(false);

      // ---- the choices, and the popup elsewhere
      const opts = await W(`setOptions({ autoMarks: false }).then(() => options())`);
      check("choices", "a choice is kept", opts && opts.autoMarks === false);
      await W(`setOptions({ autoMarks: true })`);
      const keys = await W(`chrome.commands.getAll().then((c) => c.map((x) => x.name + "=" + x.shortcut))`);
      fact("shortcuts", keys);
      check("shortcuts", "the four shortcuts are set", Array.isArray(keys) && keys.filter((k) => /=(Alt\+Shift|Shift\+Alt)\+[KLMJ]$/.test(k)).length === 4, keys);
      await F(`document.getElementById("close").click()`); await sleep(800);
      check("panel", "x closes the panel", (await frameWidth()) === 0);
    }
    fact("errors in the background script", await W("self.__errors"));
    check("start", "no errors in the background script during the run", ((await W("self.__errors")) || []).length === 0, await W("self.__errors"));
  } catch (e) { check("run", "the test ran to its end", false, String((e && e.stack) || e).slice(0, 600)); }
  report.done = true; save();
  const bad = report.checks.filter((c) => !c.ok).length;
  console.log(`\n${report.checks.length - bad} of ${report.checks.length} passed`);
  await send("Browser.close", {}, undefined, 5000).catch(() => {});
  await sleep(1000); child.kill();
  process.exit(0);
})();
