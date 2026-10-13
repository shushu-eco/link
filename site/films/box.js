// Makes the home page's small Night window as a film: node site/films/box.js
// The page filmed is box.html beside this file, drawn a frame at a time by a browser nobody sees, so the film
// comes out the same every time.
//   site/clips/night-box.gif   696 x 324, shown at half that size (build.js copies site/clips)
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const HERE = __dirname, CLIPS = path.join(HERE, "..", "clips"), WORK = path.join(HERE, "out", "work", "night-box");
const EXE = ["C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const FPS = 10, PORT = 9481, W = 348, H = 162;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");

(async () => {
  if (!EXE) throw new Error("No Brave, Chrome or Edge found to film with.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-film-"));
  const child = spawn(EXE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--mute-audio", "--hide-scrollbars", "--allow-file-access-from-files", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
  try {
    let tabs;
    for (let i = 0; i < 60 && !tabs; i++) { await sleep(300); tabs = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null); }
    const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const waiting = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const run = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
    fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
    await send("Page.navigate", { url: fileUrl(path.join(HERE, "box.html")) });
    for (let i = 0; i < 50 && !(await run("!!window.film && document.fonts.status === 'loaded'").catch(() => false)); i++) await sleep(200);
    await run("document.fonts.ready.then(() => true)");
    const count = Math.round((await run("window.film.length")) * FPS);
    for (let f = 0; f < count; f++) {
      await run(`window.film.set(${f / FPS})`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(WORK, `${String(f).padStart(4, "0")}.png`), Buffer.from(shot.result.data, "base64"));
    }
    const out = path.join(CLIPS, "night-box.gif");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(WORK, "%04d.png"), "-vf", "split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle", out]);
    if (r.status) throw new Error(String(r.stderr));
    console.log(`night-box: ${count} frames, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
    ws.close();
  } finally {
    child.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
