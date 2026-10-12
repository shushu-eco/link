// Link Lite has no limit and no key, and every skin is everybody's. Checked in the extension's own background
// script and in its panel, in a browser nobody sees with a throwaway profile. Run: node store/freetest.js
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const EXT = path.join(__dirname, "..", "extension");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const PORT = 9577, wait = (ms) => new Promise((r) => setTimeout(r, ms));
function attach(url) {
  const ws = new WebSocket(url), waiting = new Map();
  let id = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (expression) => {
    const m = await send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception.description || m.result.exceptionDetails.text);
    return m.result.result.value;
  };
  return new Promise((r) => (ws.onopen = () => r({ send, run, close: () => ws.close() })));
}
const targets = () => fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
let pass = 0, all = 0;
const check = (name, ok, detail) => { all++; if (ok) pass++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`); };
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "link-free-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "about:blank"], { stdio: "ignore" });
  try {
    let w;
    for (let i = 0; i < 60 && !w; i++) {
      await wait(400);
      for (const t of (await targets().catch(() => [])).filter((t) => t.type === "service_worker")) { const c = await attach(t.webSocketDebuggerUrl); const ok = await c.run("typeof SKINS !== \"undefined\" && chrome.runtime.getManifest().name === \"Link Lite Recorder\"").catch(() => false); if (ok) { w = c; break; } c.close(); }
    }
    const manifest = await w.run("chrome.runtime.getManifest()");
    check("version 0.5.0", manifest.version === "0.5.0", manifest.version);
    check("it may talk to the two stream sites only", manifest.host_permissions.every((h) => /kick\.com|twitch\.tv/.test(h)), manifest.host_permissions);
    check("nothing of the licence is left in the background script", await w.run(`["gate", "shop", "activate", "removeKey", "recheck", "licenceState", "trialUsed", "SHOP", "TRIAL"].every((n) => { try { eval(n); return false; } catch (e) { return true; } })`));
    let s = await w.run("skinState()");
    check("a new install wears Classic, and there are four skins, each one everybody's", s.using === "classic" && s.list.length === 4 && !("price" in s) && s.list.every((k) => !("buy" in k)), s);
    for (const id of ["midnight", "sakura", "hallow", "classic"]) {
      await w.run(`setOptions({ skin: "${id}" })`);
      check(`${id} is put on, with no key`, (await w.run("skinState()")).using === id);
    }
    await w.run(`setOptions({ skin: "midnight" })`);
    await w.run(`setOptions({ skin: "gold" })`);
    check("a skin there is not is not kept", (await w.run("skinState()")).using === "midnight" && (await w.run("options()")).skin === "midnight");
    // what an earlier version left behind
    await w.run(`(async () => { await chrome.storage.local.set({ licence: { key: "k", instance: "i", checked: 1 }, trial: 3, skins: { sakura: { key: "s" } }, rewindCounted: 5 }); await chrome.storage.sync.set({ trial: 3 }); forgetLicence(); await new Promise((r) => setTimeout(r, 500)); return 1; })()`);
    const left = await w.run(`(async () => ({ ...(await chrome.storage.local.get(["licence", "trial", "skins", "rewindCounted"])), sync: (await chrome.storage.sync.get("trial")).trial }))()`);
    check("the old count and the keys are taken out of the browser's storage", Object.keys(left).filter((k) => left[k] !== undefined).length === 0, left);
    check("the skin in use is kept through that", (await w.run("skinState()")).using === "midnight");
    const st = await w.run(`state(null)`);
    check("the panel is told the skins and nothing of a licence", st.skins && st.skins.list.length === 4 && !("licence" in st), Object.keys(st));
    // the panel itself, opened as a page of its own
    const id = await w.run("chrome.runtime.id");
    await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${id}/popup.html`, { method: "PUT" });
    let p;
    for (let i = 0; i < 30 && !p; i++) { await wait(300); const t = (await targets()).find((t) => t.type === "page" && t.url.includes("/popup.html")); if (t) p = await attach(t.webSocketDebuggerUrl); }
    await wait(2500);
    const seen = await p.run(`({ skin: document.documentElement.dataset.skin, skins: [...document.querySelectorAll(".fold-skins button.skin")].map((b) => b.textContent), folds: [...document.querySelectorAll("#more > details")].map((d) => d.className), text: document.body.textContent })`);
    check("the panel wears the skin in use", seen.skin === "midnight", seen.skin);
    check("its skins fold lists four, each free or in use", seen.skins.length === 4 && seen.skins.every((t) => /free$|in use$/.test(t)), seen.skins);
    check("there is no licence fold", !seen.folds.some((c) => /licence/.test(c)), seen.folds);
    check("the panel asks for nothing: no key, no limit", !/licen[cs]e|\bkey\b|trial|EUR|\bbuy\b|on sale/i.test(seen.text), (seen.text.match(/.{0,30}(licen[cs]e|\bkey\b|trial|EUR|\bbuy\b|on sale).{0,30}/i) || [])[0]);
    await p.run(`document.querySelector('.fold-skins button.skin[data-skin="sakura"]').click()`);
    await wait(1200);
    check("a press on a skin in the panel puts it on", (await p.run("document.documentElement.dataset.skin")) === "sakura" && (await w.run("skinState()")).using === "sakura");
    console.log(`\n${pass} of ${all} passed`);
    p.close(); w.close();
  } finally { chrome.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
