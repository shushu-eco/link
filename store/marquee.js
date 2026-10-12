// Makes the Chrome Web Store's marquee promo tile (1400x560, a PNG without transparency) as store/marquee-tile-1400x560.png.
// Run: node store/marquee.js   The panel in it is the extension's own, told a made-up stream ("yourchannel"), as in shots.js.
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const EXT = path.join(__dirname, "..", "extension"), OUT = path.join(__dirname, "marquee-tile-1400x560.png");
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const PORT = 9564, wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

const STATE = { cap: { state: "recording", channel: "yourchannel", site: "twitch", tabId: 1, armed: false }, here: true, last: null, recent: [],
  who: { channel: "yourchannel", site: "twitch", viewers: 10700, video: true, title: "", theatre: false, view: { w: 1280, h: 720, dpr: 1 } },
  options: { streamOnly: true, clean: true, autoMarks: true, theatre: true, rewind: 60, ghost: false },
  skins: { using: "classic", list: [{ id: "classic", name: "Classic" }, { id: "midnight", name: "Midnight" }, { id: "sakura", name: "Sakura" }, { id: "hallow", name: "Halloween" }] },
  stats: { seconds: 16, left: 1784, held: 0, reach: 180, marks: 1, autos: 0, perMin: 142, chat: true } };
const SCALE = 1.08;
const STAGE = `
<style>
  @font-face { font-family: "VT323"; src: url("fonts/vt323-latin.woff2") format("woff2"); }
  @font-face { font-family: "Nunito Sans"; font-weight: 400 800; src: url("fonts/nunito-sans-latin.woff2") format("woff2"); }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1400px; height: 560px; overflow: hidden; position: relative; font-family: "Nunito Sans", sans-serif;
    background: radial-gradient(ellipse at 78% 50%, #7fd6c21f 0, transparent 46%), radial-gradient(ellipse at 0% 100%, #3a1c2c 0, transparent 45%), radial-gradient(ellipse at 20% 0%, #1c1740 0, #0b0e14 62%); }
  .edge { position: absolute; inset: 18px; border: 2px solid #2f5f63; border-top-style: dotted; }
  .words { position: absolute; left: 76px; top: 0; width: 600px; height: 560px; display: flex; flex-direction: column; justify-content: center; }
  .kick { font: 24px/1 "VT323", monospace; letter-spacing: 5px; color: #7fd6c2; text-transform: uppercase; }
  .name { margin-top: 26px; display: flex; align-items: center; gap: 28px; }
  .name img { width: 112px; height: 112px; }
  .name b { display: block; font: 400 132px/.78 "VT323", monospace; letter-spacing: 10px; color: #ff5d5d; text-shadow: 4px 4px 0 #090c1e; }
  .name i { display: block; margin-top: 14px; font: 400 34px/1 "VT323", monospace; font-style: normal; letter-spacing: 16px; color: #b9b4e0; }
  p { margin-top: 28px; font: 600 31px/1.3 "Nunito Sans", sans-serif; color: #f6efdc; }
  ul { margin-top: 28px; list-style: none; padding: 0; display: flex; gap: 12px; }
  li { font: 23px/1 "VT323", monospace; letter-spacing: 4px; text-transform: uppercase; padding: 11px 14px; background: #0a0d1f; border: 2px solid #2a2f5a; }
  .hold { position: absolute; left: 700px; top: 0; width: 650px; height: 560px; display: flex; align-items: center; justify-content: center; }
  .size { position: relative; transform: rotate(2.5deg); box-shadow: 0 22px 60px rgba(0, 0, 0, .7); }
  iframe { position: absolute; left: 0; top: 0; border: 0; transform: scale(${SCALE}); transform-origin: 0 0; }
</style>
<div class="edge"></div>
<div class="words"><span class="kick">Browser extension · Kick and Twitch</span>
  <div class="name"><img src="icons/128.png" alt=""><span><b>LINK</b><i>LITE</i></span></div>
  <p>Record a Kick or Twitch stream in your tab, with your highlights marked.</p>
  <ul><li style="color:#f2c744">Record</li><li style="color:#7fd6c2">Mark</li><li style="color:#7fd6c2">Rewind</li><li style="color:#7fd6c2">One file</li><li style="color:#3ddc84">Free</li></ul></div>
<div class="hold"><div class="size" id="size"><iframe id="panel" src="popup.html?tab=1" style="width:560px;height:60px"></iframe></div></div>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-marquee-"));
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
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 560, deviceScaleFactor: 1, mobile: false });
    await w.run(`state = async () => (${JSON.stringify(STATE)})`);   // what the panel is told is going on
    await p.send("Page.navigate", { url: `chrome-extension://${id}/manifest.json` });
    await wait(500);
    await p.run(`document.documentElement.innerHTML = ${JSON.stringify("<body>" + STAGE + "</body>")}; 1`);
    await wait(1800);
    // More, with the skins open: the panel as wide as it gets, and what is new in it
    await p.run(`(async () => { const d = document.getElementById("panel").contentDocument; d.getElementById("drawer").click(); await new Promise(r => setTimeout(r, 700)); const f = d.querySelector(".fold-skins"); f.open = true; f.dispatchEvent(new Event("toggle")); await new Promise(r => setTimeout(r, 900)); d.getElementById("season").setAttribute("hidden", ""); const fr = document.getElementById("panel"), z = document.getElementById("size"); fr.style.height = d.body.offsetHeight + "px"; z.style.width = fr.offsetWidth * ${SCALE} + "px"; z.style.height = d.body.offsetHeight * ${SCALE} + "px"; })()`);
    await wait(700);
    const m = await p.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(OUT, Buffer.from(m.result.data, "base64"));
    // the store takes no transparency: the picture is written again as plain RGB
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", OUT, "-pix_fmt", "rgb24", OUT + ".rgb.png"]);
    if (fs.existsSync(OUT + ".rgb.png")) fs.renameSync(OUT + ".rgb.png", OUT);
    console.log(path.basename(OUT));
    p.close(); w.close();
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
