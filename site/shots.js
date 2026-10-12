// Photographs every page of the site at a phone's width, whole page top to bottom, into site/mobile-shots.
// Run: node site/shots.js [address] [width] [folder]     (default: https://linkturbo.app at 390, into site/mobile-shots)
// Motion is held still, so two runs of the same pages can be compared.
// Needs a Chromium; set CHROME to its path if the one Playwright installed is not there.
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const SITE = (process.argv[2] || "https://linkturbo.app").replace(/\/$/, ""), WIDTH = Number(process.argv[3]) || 390;
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const PAGES = ["", "turbo", "how-it-works", "open-source", "support", "changelog", "privacy", "terms", "copyright", "404"];
const OUT = process.argv[4] ? path.resolve(process.argv[4]) : path.join(__dirname, "mobile-shots"), PORT = 9557;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-shots-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  try {
    let tab;
    for (let i = 0; i < 40 && !tab; i++) {
      await wait(250);
      tab = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).then(l => l.find(t => t.type === "page")).catch(() => null);
    }
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => (ws.onopen = r));
    let id = 0;
    const waiting = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m.result || {}); waiting.delete(m.id); } };
    const send = (method, params = {}) => new Promise(r => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    const size = height => send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: WIDTH > 820 ? 1 : 2, mobile: WIDTH <= 820 });

    await send("Page.enable");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    for (const page of PAGES) {
      await size(844);
      await send("Page.navigate", { url: `${SITE}/${page === "404" ? "no-such-page" : page}` });
      await wait(1800);
      const { result } = await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => document.documentElement.scrollHeight)", awaitPromise: true });
      await size(result.value); // the whole page as one screen, so the fixed background covers all of it
      await wait(400);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, (page || "home") + ".png");
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log(path.basename(file), WIDTH + "x" + result.value);
    }
    ws.close();
  } finally {
    chrome.kill();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
