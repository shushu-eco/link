// Makes the three Link Night films of the site: node site/films/make.js [1 2 3]
// The page filmed is Link's own Night window (tools/reels/night/index.html, with its styles and its script),
// set on a small stage (film.css) and told a made-up night (film.js). A browser nobody sees, with a profile
// of its own, draws it a frame at a time, so the films come out the same every time.
//   site/clips/night-N.mp4 and .jpg   what the site shows (build.js copies site/clips)
//   site/films/out/night-N.gif        the same as a GIF, 800 x 450, for a README
const { spawn, spawnSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const HERE = __dirname, ROOT = path.join(HERE, "..", ".."), NIGHT = path.join(ROOT, "tools", "reels", "night");
const CLIPS = path.join(HERE, "..", "clips"), OUT = path.join(HERE, "out"), WORK = path.join(OUT, "work");
const EXE = ["C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const FPS = 10, SCALE = 2, PORT = 9477;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");

// The page: the window's own, with the stage round it. Its rule that nothing but Link's own files is loaded stays.
function page() {
  let html = fs.readFileSync(path.join(NIGHT, "index.html"), "utf8");
  const swap = (from, to) => { if (!html.includes(from)) throw new Error("The Night window's page has changed: " + from); html = html.replace(from, to); };
  swap('href="../ui/static/fonts/fonts.css"', `href="${fileUrl(path.join(ROOT, "tools", "reels", "ui", "static", "fonts", "fonts.css"))}"`);
  swap('href="../ui/static/style.css"', `href="${fileUrl(path.join(ROOT, "tools", "reels", "ui", "static", "style.css"))}"`);
  swap("</head>", `<link rel="stylesheet" href="${fileUrl(path.join(HERE, "film.css"))}">\n</head>`);
  swap("<body>", `<body><div id="stage"><div id="stars"></div><div id="glow"></div><div id="chrome"><i></i><i></i><i></i><span>LINK NIGHT</span></div><div id="win">`);
  swap('<script src="night.js"></script>', `</div><div id="side"><div id="cap"></div><div id="clock"></div><div id="when"></div>`
    + `<div id="tiles">${[1, 2, 3].map((n) => `<div class="tile"><u></u><b>CH-${n}</b><em></em></div>`).join("")}</div></div>`
    + `<div id="ring"></div><svg id="cur" viewBox="0 0 18 24"><path d="M1 1v19l5-4.6 3.4 7.6 3-1.4-3.4-7.4H16z" fill="#fff" stroke="#090c1e" stroke-width="1.6" stroke-linejoin="round"/></svg><div id="dark"></div></div>`
    + `<script src="${fileUrl(path.join(HERE, "film.js"))}"></script><script src="${fileUrl(path.join(NIGHT, "night.js"))}"></script>`);
  fs.mkdirSync(WORK, { recursive: true });
  const file = path.join(WORK, "night-film.html");
  fs.writeFileSync(file, html);
  return file;
}

(async () => {
  if (!EXE) throw new Error("No Brave, Chrome or Edge found to film with.");
  const which = process.argv.slice(2).map(Number).filter(Boolean), clips = which.length ? which : [1, 2, 3];
  const file = page(), profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-film-"));
  const child = spawn(EXE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--mute-audio", "--hide-scrollbars", "--window-size=800,450", "about:blank"], { stdio: "ignore" });
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
    await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 450, deviceScaleFactor: SCALE, mobile: false });
    for (const n of clips) {
      const frames = path.join(WORK, `night-${n}`);
      fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
      await send("Page.navigate", { url: `${fileUrl(file)}?camera&clip=${n}` });
      for (let i = 0; i < 50 && !(await run("!!(window.film && window.look && document.fonts.status === 'loaded')").catch(() => false)); i++) await sleep(200);
      await run("document.fonts.ready.then(() => true)");
      const length = await run("window.film.length"), count = Math.round(length * FPS);
      for (let f = 0; f < count; f++) {
        await run(`window.film.set(${f / FPS})`);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(path.join(frames, `${String(f).padStart(4, "0")}.png`), Buffer.from(shot.result.data, "base64"));
      }
      fs.mkdirSync(CLIPS, { recursive: true });
      const ffmpeg = (...args) => { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]); if (r.status) throw new Error(String(r.stderr)); };
      const from = ["-framerate", String(FPS), "-i", path.join(frames, "%04d.png")];
      ffmpeg(...from, "-vf", "scale=1280:720:flags=lanczos", "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryslow", "-crf", "23", "-an", path.join(CLIPS, `night-${n}.mp4`));
      ffmpeg("-i", path.join(frames, `${String(Math.round(count * 0.72)).padStart(4, "0")}.png`), "-vf", "scale=800:450:flags=lanczos", "-q:v", "4", path.join(CLIPS, `night-${n}.jpg`));
      ffmpeg(...from, "-vf", "scale=800:450:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", path.join(OUT, `night-${n}.gif`));
      console.log(`night-${n}: ${count} frames, mp4 ${(fs.statSync(path.join(CLIPS, `night-${n}.mp4`)).size / 1024).toFixed(0)} KB, gif ${(fs.statSync(path.join(OUT, `night-${n}.gif`)).size / 1024).toFixed(0)} KB`);
    }
    ws.close();
  } finally {
    child.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
