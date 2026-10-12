// Makes the Chrome Web Store's screenshots (1280x800, five) into store/screenshots. Run: node store/shots.js [folder]
// The panel in them is the extension's own, running in a browser with a throwaway profile; what it is
// told about the stream is made up ("yourchannel", an abstract picture), so no real streamer is shown.
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const EXT = path.join(__dirname, "..", "extension"), OUT = process.argv[2] || path.join(__dirname, "screenshots");
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const PORT = 9563, wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

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

const WHO = { channel: "yourchannel", site: "kick", viewers: 10700, video: true, title: "", theatre: false, view: { w: 1280, h: 720, dpr: 1 } };
const OPTIONS = { streamOnly: true, clean: true, autoMarks: true, theatre: true, rewind: 60, ghost: false };
const SKINS = { using: "classic", list: [{ id: "classic", name: "Classic" }, { id: "midnight", name: "Midnight" }, { id: "sakura", name: "Sakura" }, { id: "hallow", name: "Halloween" }] };
const RECENT = [
  { at: 3, id: 3, channel: "yourchannel", site: "kick", name: "yourchannel 2026-10-08 15-07-12.mp4", seconds: 1284, marks: 4, size: 9.1e8,
    points: [{ t: 62, note: "clutch 1v3" }, { t: 418, note: "", auto: true }, { t: 731, note: "funny fail" }, { t: 1190, note: "final circle win" }] },
  { at: 2, id: 2, channel: "yourchannel", site: "kick", name: "yourchannel 2026-10-08 14-31-40.mp4", seconds: 60, marks: 1, size: 4.2e7, rewound: true, points: [{ t: 41, note: "what a shot" }] },
  { at: 1, id: 1, channel: "otherchannel", site: "twitch", name: "otherchannel 2026-10-07 21-12-05.mp4", seconds: 1800, marks: 0, size: 1.3e9, points: [] },
];
const SCENES = [
  { file: "1-record", width: 292, tint: "#ff5d5d", kick: "Record", head: "Record the stream in your tab", sub: "Kick and Twitch, in Chrome, Edge and Brave. Mark a highlight the moment it happens.",
    points: ["Picture and sound, cut out of the page", "One mp4, up to 30 minutes", "Nothing is uploaded"],
    state: { cap: { state: "recording", channel: "yourchannel", site: "kick", tabId: 1, armed: false }, who: WHO, here: true, last: null, options: OPTIONS, recent: RECENT, skins: SKINS,
      stats: { seconds: 16, left: 1784, held: 0, reach: 180, marks: 3, autos: 1, perMin: 142, chat: true } } },
  { file: "2-marks", width: 560, tint: "#f2c744", kick: "For your editor", head: "Your marks come with the recording", sub: "Every highlight with its time and your note, ready for the edit.",
    points: ["Copy them as a list for any editor", "Or a marker file for DaVinci Resolve", "Chat speeding up is marked by itself"],
    state: { cap: null, stats: null, who: WHO, here: false, last: null, options: OPTIONS, recent: RECENT, skins: SKINS },
    then: `more.click(); await new Promise(r => setTimeout(r, 700)); d.querySelector(".fold-recent").open = true; d.querySelector(".fold-recent").dispatchEvent(new Event("toggle")); await new Promise(r => setTimeout(r, 300)); d.querySelector(".stars").click();` },
  { file: "3-rewind", width: 292, tint: "#7fd6c2", kick: "Rewind", head: "Save a moment after it happened", sub: "Switch the rewind on and Link keeps the last minutes while you watch.",
    points: ["Keeps the last 3 minutes", "Save the last 30 seconds, 1, 2 or 3 minutes", "Or start a recording from back then"],
    state: { cap: { state: "armed", channel: "yourchannel", site: "kick", tabId: 1, armed: true }, who: WHO, here: true, last: null, options: OPTIONS, recent: RECENT, skins: SKINS,
      stats: { seconds: 0, left: 1800, held: 152, reach: 180, marks: 1, autos: 0, perMin: 96, chat: true } } },
  { file: "4-free", width: 560, tint: "#f2c744", kick: "Open source", head: "Free and open source", sub: "No key, no account, no limit. Every recording and every skin is included.",
    points: ["Record as often as you like", "Four skins for the panel", "The code is public on GitHub"],
    state: { cap: null, stats: null, who: WHO, here: false, last: null, options: OPTIONS, recent: [], skins: SKINS },
    then: `more.click(); await new Promise(r => setTimeout(r, 700)); d.querySelector(".fold-skins").open = true; d.querySelector(".fold-skins").dispatchEvent(new Event("toggle"));` },
  { file: "5-shortcuts", width: 292, tint: "#b9b4e0", kick: "Shortcuts", head: "Hands on the keyboard", sub: "Four shortcuts do everything while you watch. Change them in the browser if you like.",
    points: [["Alt+Shift+K", "Open the panel"], ["Alt+Shift+L", "Record, or stop and save"], ["Alt+Shift+M", "Mark a highlight"], ["Alt+Shift+J", "Save the last minute"]],
    state: { cap: { state: "recording", channel: "yourchannel", site: "twitch", tabId: 1, armed: true }, who: { ...WHO, site: "twitch" }, here: true, last: null, options: OPTIONS, recent: RECENT, skins: SKINS,
      stats: { seconds: 754, left: 1046, held: 180, reach: 180, marks: 5, autos: 2, perMin: 96, chat: true } } },
];

// The page of a screenshot: Link's own look (the announcement cards'), the words on the left, and the real
// panel on the right, enlarged so it can be read at the size the store shows it.
const stage = (scene, n) => { const wide = scene.width > 300, scale = wide ? 1.22 : 2; return `
<style>
  @font-face { font-family: "VT323"; src: url("fonts/vt323-latin.woff2") format("woff2"); }
  @font-face { font-family: "Nunito Sans"; font-weight: 400 800; src: url("fonts/nunito-sans-latin.woff2") format("woff2"); }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; position: relative; font-family: "Nunito Sans", sans-serif;
    background: radial-gradient(ellipse at 76% 50%, ${scene.tint}26 0, transparent 46%), radial-gradient(ellipse at 0% 100%, #3a1c2c 0, transparent 45%), radial-gradient(ellipse at 20% 0%, #1c1740 0, #0b0e14 62%); }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#ffffff0d 1px, transparent 1px); background-size: 16px 16px; }
  .edge { position: absolute; inset: 18px; border: 2px solid #2f5f63; border-top-style: dotted; }
  .words { position: absolute; left: 72px; top: 0; width: ${wide ? 440 : 520}px; height: 800px; display: flex; flex-direction: column; justify-content: center; }
  .kick { display: flex; align-items: center; gap: 14px; font: 30px/1 "VT323", monospace; letter-spacing: 5px; color: ${scene.tint}; text-transform: uppercase; }
  .kick i { font-style: normal; color: #5d6aa0; }
  h1 { margin-top: 22px; font: 800 ${wide ? 52 : 58}px/1.06 "Nunito Sans", sans-serif; color: #f6efdc; text-wrap: balance; }
  p { margin-top: 20px; font: 400 26px/1.4 "Nunito Sans", sans-serif; color: #c9c5ea; }
  ul { margin-top: 30px; list-style: none; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  li { display: flex; align-items: center; gap: 14px; font: 600 23px/1.2 "Nunito Sans", sans-serif; color: #f6efdc; }
  li::before { content: ""; width: 12px; height: 12px; background: ${scene.tint}; flex: none; }
  li kbd { font: 24px/1 "VT323", monospace; letter-spacing: 2px; color: #0b0e14; background: ${scene.tint}; padding: 6px 10px; min-width: 170px; text-align: center; }
  .hold { position: absolute; left: ${wide ? 530 : 620}px; top: 0; width: ${wide ? 690 : 600}px; height: 760px; display: flex; align-items: center; justify-content: center; }
  .size { position: relative; }
  iframe { position: absolute; left: 0; top: 0; border: 0; transform: scale(${scale}); transform-origin: 0 0; box-shadow: 0 22px 60px rgba(0, 0, 0, .7); }
  .foot { position: absolute; left: 72px; right: 72px; bottom: 44px; display: flex; justify-content: space-between; font: 24px/1 "VT323", monospace; letter-spacing: 5px; color: #5d6aa0; text-transform: uppercase; }
</style>
<div class="dots"></div><div class="edge"></div>
<div class="words"><span class="kick">${scene.kick}<i>0${n} / 0${SCENES.length}</i></span><h1>${scene.head}</h1><p>${scene.sub}</p>
  <ul>${scene.points.map((x) => `<li>${Array.isArray(x) ? `<kbd>${x[0]}</kbd>${x[1]}` : x}</li>`).join("")}</ul></div>
<div class="hold"><div class="size" id="size" data-scale="${scale}"><iframe id="panel" src="popup.html?tab=1" style="width:${scene.width}px;height:60px"></iframe></div></div>
<div class="foot"><span>Link Lite Recorder</span><span>linkturbo.app</span></div>`; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-store-"));
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
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const scene of SCENES) {
      await w.run(`state = async () => (${JSON.stringify(scene.state)})`);   // what the panel is told is going on
      await p.send("Page.navigate", { url: `chrome-extension://${id}/manifest.json` });
      await wait(500);
      await p.run(`document.documentElement.innerHTML = ${JSON.stringify("<body>" + stage(scene, SCENES.indexOf(scene) + 1) + "</body>")}; addEventListener("message", (e) => { if (e.data && e.data.linkLite && e.data.height) document.getElementById("panel").style.height = e.data.height + "px"; }); 1`);
      await wait(1800);
      await p.run(`(async () => { const d = document.getElementById("panel").contentDocument, more = d.getElementById("drawer"); ${scene.then || ""} await new Promise(r => setTimeout(r, 900)); d.getElementById("season").setAttribute("hidden", ""); for (const n of [...d.getElementById("more").childNodes]) if (n.nodeType === 3 && n.textContent.trim() === "undefined") n.remove(); const f = document.getElementById("panel"), z = document.getElementById("size"), k = Number(z.dataset.scale); f.style.height = d.body.offsetHeight + "px"; z.style.width = f.offsetWidth * k + "px"; z.style.height = d.body.offsetHeight * k + "px"; })()`);
      await wait(700);
      const m = await p.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(OUT, scene.file + ".png"), Buffer.from(m.result.data, "base64"));
      console.log(scene.file);
    }
    p.close(); w.close();
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
