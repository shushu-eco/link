// Makes the moving demonstration at the top of the README: store/screenshots/demo.gif (800x450, about 17 s).
// Run: node store/readme-demo.js
// The panel in it is the extension's own, in a browser nobody sees with a throwaway profile. The stream page
// around it is drawn here and belongs to nobody: an abstract moving picture, a made-up channel
// ("yourchannel") and a made-up chat. The panel is told what is going on, as in shots.js; nothing is recorded.
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const EXT = path.join(__dirname, "..", "extension"), OUT = path.join(__dirname, "screenshots", "demo.gif");
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const PORT = 9565, W = 800, H = 450, FPS = 10, wait = (ms) => new Promise((r) => setTimeout(r, ms));

function attach(url) {
  const ws = new WebSocket(url), waiting = new Map();
  let id = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (expression) => {
    const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception.description || m.result.exceptionDetails.text);
    return m.result.result.value;
  };
  return new Promise((r) => (ws.onopen = () => r({ send, run, close: () => ws.close() })));
}
const targets = () => fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());

const FILE = "yourchannel 2026-10-12 15-07-12.mp4";
const WHO = { channel: "yourchannel", site: "twitch", viewers: 10742, video: true, title: "", theatre: false, view: { w: 1280, h: 720, dpr: 1 } };
const BASE = { cap: null, stats: null, who: WHO, here: false, last: null, recent: [],
  options: { streamOnly: true, clean: true, autoMarks: true, theatre: false, rewind: 60, ghost: false },
  skins: { using: "classic", list: [{ id: "classic", name: "Classic" }, { id: "midnight", name: "Midnight" }, { id: "sakura", name: "Sakura" }, { id: "hallow", name: "Halloween" }] } };
const SCALE = 1.3;

const STAGE = `
<style>
  @font-face { font-family: "VT323"; src: url("fonts/vt323-latin.woff2") format("woff2"); }
  @font-face { font-family: "Nunito Sans"; font-weight: 400 800; src: url("fonts/nunito-sans-latin.woff2") format("woff2"); }
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: #0b0e14; font-family: "Nunito Sans", sans-serif; }
  .bar { position: absolute; left: 0; top: 0; right: 0; height: 34px; background: #14161c; border-bottom: 1px solid #262a35; display: flex; align-items: center; gap: 10px; padding: 0 14px; color: #8d93a8; font: 600 12px "Nunito Sans"; }
  .bar i { width: 9px; height: 9px; border-radius: 50%; background: #2c3140; }
  .bar span { margin-left: 8px; background: #0b0e14; border: 1px solid #262a35; border-radius: 12px; padding: 3px 14px; }
  .video { position: absolute; left: 0; top: 34px; width: 580px; height: 326px; overflow: hidden; background: #101826; }
  .video b { position: absolute; border-radius: 50%; filter: blur(34px); opacity: .85; }
  .video b:nth-child(1) { width: 300px; height: 300px; background: #1f6f8f; left: -40px; top: -60px; animation: a 7s ease-in-out infinite alternate; }
  .video b:nth-child(2) { width: 260px; height: 260px; background: #8a2f5a; left: 300px; top: 120px; animation: b 5s ease-in-out infinite alternate; }
  .video b:nth-child(3) { width: 200px; height: 200px; background: #d9a52a; left: 180px; top: 40px; opacity: .45; animation: c 6s ease-in-out infinite alternate; }
  @keyframes a { to { transform: translate(190px, 120px) scale(1.2); } }
  @keyframes b { to { transform: translate(-220px, -110px) scale(.8); } }
  @keyframes c { to { transform: translate(120px, 150px) scale(1.4); } }
  .live { position: absolute; right: 12px; bottom: 12px; font: 16px/1 "VT323"; letter-spacing: 2px; color: #fff; background: #c8282e; padding: 4px 8px; }
  .who { position: absolute; left: 0; top: 360px; width: 580px; height: 90px; background: #0e1118; border-top: 1px solid #262a35; padding: 12px 16px; color: #e9e6f5; font: 700 15px "Nunito Sans"; }
  .who small { display: block; margin-top: 3px; font: 400 12px "Nunito Sans"; color: #8d93a8; }
  .chat { position: absolute; right: 0; top: 34px; width: 220px; bottom: 0; background: #12141b; border-left: 1px solid #262a35; display: flex; flex-direction: column; }
  .chat h4 { flex: none; height: 30px; display: flex; align-items: center; justify-content: center; font: 16px "VT323"; letter-spacing: 3px; color: #8d93a8; border-bottom: 1px solid #262a35; }
  .rows { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 12px 10px; overflow: hidden; font: 400 12px/1.35 "Nunito Sans"; color: #d7d4e6; }
  .rows p { padding: 3px 0; } .rows p b { font-weight: 700; }
  .size { position: absolute; left: 14px; top: 190px; box-shadow: 0 14px 40px rgba(0, 0, 0, .75); transition: top .25s; }
  iframe { position: absolute; left: 0; top: 0; border: 0; transform: scale(${SCALE}); transform-origin: 0 0; }
  .say { position: absolute; left: 0; width: 580px; top: 50px; display: flex; justify-content: center; pointer-events: none; }
  .say span { font: 22px/1 "VT323"; letter-spacing: 2px; color: #0b0e14; background: #f2c744; padding: 8px 14px; box-shadow: 0 0 0 2px #0b0e14, 0 0 0 4px #f2c744; opacity: 0; transition: opacity .25s; }
  .say span.on { opacity: 1; }
  .cursor { position: absolute; left: 520px; top: 150px; width: 22px; height: 22px; z-index: 9; transition: left .6s cubic-bezier(.3, .7, .3, 1), top .6s cubic-bezier(.3, .7, .3, 1); pointer-events: none; }
  .cursor::after { content: ""; position: absolute; left: -9px; top: -9px; width: 30px; height: 30px; border-radius: 50%; border: 3px solid #fff; opacity: 0; transform: scale(.3); }
  .cursor.click::after { animation: click .45s ease-out; }
  @keyframes click { 0% { opacity: .9; transform: scale(.3); } 100% { opacity: 0; transform: scale(1.3); } }
  .file { position: absolute; left: 150px; top: 96px; width: 300px; background: #101a2c; border: 2px solid #3f6f7a; box-shadow: 0 0 0 2px #090c1e, 0 16px 40px rgba(0, 0, 0, .7); padding: 14px 16px; display: flex; gap: 14px; align-items: center; opacity: 0; transform: translateY(18px); transition: opacity .4s, transform .4s; }
  .file.on { opacity: 1; transform: none; }
  .file i { flex: none; width: 46px; height: 56px; background: linear-gradient(#ffe27a, #d9a52a); display: flex; align-items: flex-end; justify-content: center; font: 16px/1.6 "VT323"; font-style: normal; color: #0b0e14; letter-spacing: 1px; clip-path: polygon(0 0, 70% 0, 100% 22%, 100% 100%, 0 100%); }
  .file div { min-width: 0; } .file u { display: block; text-decoration: none; font: 16px/1 "VT323"; letter-spacing: 2px; color: #7fd6c2; }
  .file strong { display: block; margin-top: 5px; font: 700 14px/1.25 "Nunito Sans"; color: #f6efdc; overflow-wrap: anywhere; }
  .file em { display: block; margin-top: 4px; font: 400 12px "Nunito Sans"; font-style: normal; color: #c9c5ea; }
</style>
<div class="bar"><i></i><i></i><i></i><span>twitch.tv/yourchannel</span></div>
<div class="video"><b></b><b></b><b></b><span class="live">LIVE</span></div>
<div class="who">yourchannel<small>Ranked · road to the top · 10,742 watching</small></div>
<div class="chat"><h4>STREAM CHAT</h4><div class="rows" id="rows"></div></div>
<div class="size" id="size"><iframe id="panel" src="popup.html?tab=1" style="width:292px;height:60px"></iframe></div>
<div class="file" id="file"><i>MP4</i><div><u>DOWNLOADS / LINK</u><strong>${FILE}</strong><em>0:08 · ★ 1 mark inside, with its note</em></div></div>
<div class="say"><span id="say"></span></div>
<svg class="cursor" id="cursor" viewBox="0 0 22 22"><path d="M2 1l0 17 5-4 3 7 3-1.5-3-6.5 7 0z" fill="#fff" stroke="#0b0e14" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

// What the page can do, called by name from here as the film goes on.
const HELPERS = `
  addEventListener("message", (e) => { if (e.data && e.data.linkLite && e.data.height) fit(); });
  const panel = () => document.getElementById("panel"), doc = () => panel().contentDocument;
  window.fit = () => { const f = panel(), z = document.getElementById("size"), h = doc().body.offsetHeight; f.style.height = h + "px"; z.style.width = f.offsetWidth * ${SCALE} + "px"; z.style.height = h * ${SCALE} + "px"; z.style.top = (${H} - 14 - h * ${SCALE}) + "px"; };
  // the panel asks what is going on twice a second by itself: wait for that, then fit the frame to it
  window.redraw = async () => { await new Promise((r) => setTimeout(r, 560)); fit(); };
  setInterval(() => { const x = doc() && doc().getElementById("season"); if (x) x.setAttribute("hidden", ""); }, 100);
  window.say = (text) => { const s = document.getElementById("say"); s.classList.remove("on"); setTimeout(() => { s.textContent = text; s.classList.add("on"); }, 180); };
  window.point = (what) => { const b = [...doc().querySelectorAll("button")].find((x) => new RegExp(what).test(x.textContent)); if (!b) return false; const r = b.getBoundingClientRect(), z = document.getElementById("size").getBoundingClientRect(), c = document.getElementById("cursor"); c.style.left = (z.left + (r.left + r.width / 2) * ${SCALE} - 3) + "px"; c.style.top = (z.top + (r.top + r.height / 2) * ${SCALE} - 2) + "px"; return true; };
  window.click = () => { const c = document.getElementById("cursor"); c.classList.remove("click"); void c.offsetWidth; c.classList.add("click"); };
  window.type = async (text) => { const i = doc().getElementById("note"); i.focus(); for (const ch of text) { i.value += ch; await new Promise((r) => setTimeout(r, 95)); } };
  window.keep = () => doc().getElementById("note-row").requestSubmit();
  const names = ["viewer_one", "night_owl", "pixelfan", "quiet_kate", "blue_lemon", "gg_marta", "oak_and_ash", "demo_dan", "lurker42"], colours = ["#ff7f50", "#9acd32", "#4db4e0", "#ff69b4", "#00c7ac", "#daa520", "#b48cff"];
  const calm = ["hello chat", "gl this round", "that rotate was clean", "first time here", "what rank is this", "nice", "lets go"], loud = ["WHAT", "NO WAY", "CLUTCH", "1v3 ???", "CLIP IT", "OMG", "HOW", "insane", "CLIP THAT"];
  window.fast = false;
  (function row() { const rows = document.getElementById("rows"), p = document.createElement("p"), n = Math.floor(Math.random() * names.length), list = window.fast ? loud : calm;
    p.innerHTML = "<b style='color:" + colours[n % colours.length] + "'>" + names[n] + "</b>: " + list[Math.floor(Math.random() * list.length)]; rows.append(p); while (rows.children.length > 16) rows.firstChild.remove();
    setTimeout(row, window.fast ? 110 : 520); })();
  1`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-readme-demo-")), frames = fs.mkdtempSync(path.join(os.tmpdir(), "link-readme-frames-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "about:blank"], { stdio: "ignore" });
  try {
    let sw, w;
    for (let i = 0; i < 60 && !w; i++) {
      await wait(400);
      for (const t of (await targets().catch(() => [])).filter((t) => t.type === "service_worker")) {
        const c = await attach(t.webSocketDebuggerUrl);
        const name = await c.run(`typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().name : ""`).catch(() => "");
        if (name === "Link Lite Recorder") { sw = t; w = c; break; }
        c.close();
      }
    }
    if (!w) throw new Error("the extension's worker did not start");
    const id = new URL(sw.url).host;
    const p = await attach((await targets()).find((t) => t.type === "page").webSocketDebuggerUrl);
    await p.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    // what the panel is told: kept in the worker, with the recording's clock and the mark's age running by themselves
    const tell = (change) => w.run(`(() => { Object.assign(self.__s, ${JSON.stringify(change)}); if (self.__s.cap && self.__s.cap.state === "recording" && !self.__t0) self.__t0 = Date.now(); if (self.__s.stats && self.__s.stats.lastMark && !self.__m0) self.__m0 = Date.now(); return 1; })()`);
    await w.run(`self.__s = ${JSON.stringify(BASE)}; self.__t0 = 0; self.__m0 = 0; state = async () => { const s = self.__s; if (s.cap && s.cap.state === "recording" && s.stats) { s.stats.seconds = (Date.now() - self.__t0) / 1000; s.stats.left = 1800 - s.stats.seconds; if (s.stats.lastMark) s.stats.lastMark.ago = (Date.now() - self.__m0) / 1000; } return s; }; 1`);
    await p.send("Page.navigate", { url: `chrome-extension://${id}/manifest.json` });
    await wait(500);
    await p.run(`document.documentElement.innerHTML = ${JSON.stringify("<body>" + STAGE + "</body>")}; ${HELPERS}`);
    await wait(2000);
    await p.run("redraw()");
    await wait(600);

    // ---- the film: frames are taken all the while, each with the time it was taken at
    const shots = [];
    let filming = true;
    const camera = (async () => { while (filming) { const at = Date.now(); const m = await p.send("Page.captureScreenshot", { format: "png" }); const file = path.join(frames, `f${String(shots.length).padStart(4, "0")}.png`); fs.writeFileSync(file, Buffer.from(m.result.data, "base64")); shots.push({ file, at }); const spare = 1000 / FPS - (Date.now() - at); if (spare > 0) await wait(spare); } })();
    const stats = (more) => ({ seconds: 0, left: 1800, held: 0, reach: 180, marks: 0, autos: 0, perMin: 96, chat: true, ...more });
    const press = async (button) => { await p.run(`point(${JSON.stringify(button)})`); await wait(800); await p.run("click()"); await wait(180); };

    await p.run(`say("A live stream in your tab")`);
    await wait(1200);
    await press("Record");
    await tell({ cap: { state: "recording", channel: "yourchannel", site: "twitch", tabId: 1, armed: false }, here: true, stats: stats({}) });
    await p.run("redraw()"); await p.run(`say("● Record: the stream, cut out of the page")`);
    await wait(1700);
    await p.run("window.fast = true"); await tell({ stats: stats({ perMin: 412 }) }); await p.run("redraw()");
    await wait(600);
    await press("Mark");
    await tell({ stats: stats({ perMin: 438, marks: 1, lastMark: { index: 0, ago: 0, note: "" } }) });
    await p.run("redraw()"); await p.run(`say("★ Mark the moment, in a few words")`);
    await wait(500);
    await p.run(`type("clutch 1v3")`);
    await wait(500);
    await p.run("keep()"); await p.run("window.fast = false"); await wait(300); await p.run("redraw()");
    await wait(700);
    await press("Stop");
    const last = { at: Date.now(), id: 1, channel: "yourchannel", site: "twitch", name: FILE, seconds: 8, marks: 1, size: 1.4e7, points: [{ t: 5, note: "clutch 1v3" }] };
    await tell({ cap: null, stats: null, here: false, last, recent: [last] });
    await p.run("redraw()"); await p.run(`say("■ Stop: one mp4, your marks inside")`);
    await wait(700);
    await p.run(`document.getElementById("file").classList.add("on"); document.getElementById("cursor").style.opacity = 0`);
    await wait(1600);
    await tell({ last: null }); await p.run("redraw()");
    await wait(1500);
    filming = false; await camera;

    // ---- the frames, each shown for as long as it was on, made into one GIF with a palette of its own
    const list = shots.map((s, i) => `file '${s.file.replace(/\\/g, "/")}'\nduration ${(((shots[i + 1] || { at: s.at + 1000 / FPS }).at - s.at) / 1000).toFixed(3)}`).join("\n") + `\nfile '${shots[shots.length - 1].file.replace(/\\/g, "/")}'\n`;
    const listFile = path.join(frames, "frames.txt"); fs.writeFileSync(listFile, list);
    const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=${FPS},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, "-loop", "0", OUT], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("ffmpeg: " + r.stderr);
    console.log(`${path.basename(OUT)}: ${shots.length} frames, ${((shots[shots.length - 1].at - shots[0].at) / 1000).toFixed(1)} s, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB`);
    // three stills of it, to look at
    for (const [n, i] of [["a", Math.floor(shots.length * 0.3)], ["b", Math.floor(shots.length * 0.55)], ["c", shots.length - 6]]) fs.copyFileSync(shots[i].file, path.join(os.tmpdir(), `link-readme-demo-${n}.png`));
    p.close(); w.close();
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
