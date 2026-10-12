// A test of Link's window: a private copy of Link (its own folder, its own home, its own ports) is started with
// one sample tape, and a script does what a user does and checks what the window shows after each step.
// It never touches the user's own Link: not its window, its library, what it learned, or its Discord.
//
//   python tools/reels/test/make_copy.py <folder> [SRC-id]      a private copy of Link in <folder>, with one tape of the library as its sample
//   node tools/reels/test/window_test.js <folder> <out folder> [quick] [SRC-id]
//
// quick: without analysing the tape again as a shooter (that part takes about three minutes and expects a
// Valorant recording). The result is said line by line, kept as <out>/results.json, with pictures of the
// window beside it. A second Link window is on screen while it runs, with its sound off.
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const [T, OUT, HOW, GIVEN] = process.argv.slice(2);
const SAMPLE = GIVEN || (/^SRC-/.test(HOW || "") ? HOW : "SRC-003");
const PORT = 8799, DEBUG = 9333, URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, USERPROFILE: path.join(T, "home"), HOME: path.join(T, "home"), LINK_HOME: path.join(T, "home"), LINK_DEBUG_PORT: String(DEBUG) };
delete env.ELECTRON_RUN_AS_NODE;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail !== "" ? "  [" + (typeof detail === "string" ? detail : JSON.stringify(detail)) + "]" : ""}`); };

(async () => {
  const server = spawn("python", [path.join(T, "tools/reels/ui/server.py"), "--port", String(PORT)], { cwd: T, env, stdio: "ignore", windowsHide: true });
  const shell = spawn(path.join(T, "tools/reels/shell/node_modules/electron/dist/electron.exe"), [path.join(T, "tools/reels/shell"), `--link-url=${URL}`, "--mute-audio"], { cwd: T, env, stdio: "ignore" });
  let ws, id = 0; const waiting = new Map();
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (waiting.delete(i)) r({ timedOut: true }); }, 30000); });
  const run = async (expression) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.timedOut) return { error: "no answer" };
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }); if (s.result && s.result.data) fs.writeFileSync(path.join(OUT, name + ".jpg"), Buffer.from(s.result.data, "base64")); };
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse("mouseMoved", x, y, { buttons: 0 }); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); };
  const rect = (sel, n = 0) => run(`const e = document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };`);
  const videoNow = () => run(`const v = [...document.querySelectorAll("video")].filter((x) => x.isConnected && x.src); return { n: v.length, playing: v.filter((x) => !x.paused && !x.ended).length, t: v[0] ? v[0].currentTime : null, volume: v[0] ? v[0].volume : null, src: v[0] ? new URL(v[0].src).pathname : null, ready: v[0] ? v[0].readyState : 0 };`);
  let failed = null;
  try {
    // ---- up
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(500); up = await fetch(`${URL}/api/sources`).then((r) => r.ok).catch(() => false); }
    check("the private copy's server answers", up);
    let target = null;
    for (let i = 0; i < 60 && !target; i++) { await sleep(500); target = (await fetch(`http://127.0.0.1:${DEBUG}/json`).then((r) => r.json()).catch(() => [])).find((t) => t.type === "page" && t.url.startsWith(URL)); }
    check("its window is open", !!target);
    if (!target) throw new Error("no window to test");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    await send("Page.enable");
    await sleep(9000);   // the self-check at start-up passes
    const about = await fetch(`${URL}/api/sources`).then((r) => r.json());
    check("it sees the sample tape and only that", about.length === 1 && about[0].id === SAMPLE, about.map((s) => s.id));
    await run(`await select("${SAMPLE}"); return 1;`);
    await sleep(2500);

    // ---- the candidates, and one player
    const rows = await run(`return document.querySelectorAll(".cand-list .cand-row").length;`);
    check("the candidate list appears", rows > 5, rows);
    await shot("1-candidates");
    let r = await rect(".cand-list .cand-row", 1);
    await click(r.x + 60, r.cy); await sleep(2500);
    let v = await videoNow();
    check("choosing a candidate plays it by itself", v.n === 1 && v.playing === 1, v);
    check("the player shows the recording itself, not a cut-out", v.src === `/tape/${SAMPLE}`, v.src);
    check("it starts at half loudness", Math.abs((v.volume ?? 0) - 0.5) < 0.01, v.volume);
    const cand2 = await run(`const d = state.detail, c = d.candidates.find((k) => k.rank === state.open); return { rank: state.open, in: c.in, out: c.out };`);
    check("it starts at the candidate's own beginning", v.t != null && v.t >= cand2.in - 1 && v.t <= cand2.out, { video: v.t, candidate: cand2 });
    r = await rect(".cand-list .cand-row", 2);
    await click(r.x + 60, r.cy); await sleep(2500);
    v = await videoNow();
    check("choosing another leaves one player, playing", v.n === 1 && v.playing === 1, v);
    const live = await run(`return [...voices].filter((x) => !x.paused).length;`);
    check("no put-away player is still sounding", live === 1, live);

    // ---- the timeline: the readout, the knob, a click
    const when = await run(`const w = document.querySelector(".timeline .top .when"); const box = document.querySelector(".timeline .block.free"); return { top: w && !w.hidden ? w.textContent : null, onBlock: box ? box.textContent.trim() : null };`);
    check("the stretch's times are in the bar above the timeline", /\d:\d\d\.\d – \d+:\d\d\.\d · [\d.]+ s/.test(when.top || ""), when.top);
    check("nothing is written on the gold block", when.onBlock === "", when.onBlock);
    const track = await rect(".timeline .track"), knob = await rect(".playhead .knob");
    check("the play line has its knob", !!knob && knob.w > 0, knob);
    const before = (await videoNow()).t;
    const toX = track.x + track.w * 0.9;
    await mouse("mouseMoved", knob.cx, knob.cy - 3, { buttons: 0 }); await mouse("mousePressed", knob.cx, knob.cy - 3);
    for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", knob.cx + ((toX - knob.cx) * i) / 8, knob.cy - 3); await sleep(60); }
    const mid = await run(`return { scrubbing: !!state.scrubbing, counter: document.getElementById("tape-counter").textContent };`);
    await mouse("mouseReleased", toX, knob.cy - 3); await sleep(1200);
    v = await videoNow();
    const want = await run(`const vw = viewOf(state.detail); return vw.from + 0.9 * (vw.to - vw.from);`);
    check("dragging the knob takes the picture with it, anywhere in the recording", Math.abs(v.t - want) < 3 && Math.abs(v.t - before) > 5, { from: before, to: v.t, wanted: want, during: mid });
    check("it plays on from there when let go", v.playing === 1, v);
    // a place on the timeline where no candidate's block lies, and one inside a dismissed candidate's block
    const places = await run(`const d = state.detail, vw = viewOf(d), all = candidates(d); let free = null; for (let f = 0.05; f < 0.95 && free == null; f += 0.01) { const t = vw.from + f * (vw.to - vw.from); if (!all.some((c) => t >= c.in - 2 && t <= c.out + 2)) free = f; } const gone = all.find((c) => c.dismissed); return { free, gone: gone ? ((gone.in + gone.out) / 2 - vw.from) / (vw.to - vw.from) : null };`);
    await click(track.x + track.w * places.free, track.y + 10); await sleep(1200);
    v = await videoNow();
    const want2 = await run(`const vw = viewOf(state.detail); return vw.from + ${places.free} * (vw.to - vw.from);`);
    const screens = await run(`return document.querySelectorAll(".tv video").length;`);
    check("a click on the timeline moves the play line there", Math.abs(v.t - want2) < 3, { video: v.t, wanted: want2 });
    check("and no second screen opens", screens === 1 && v.n === 1, screens);
    if (places.gone != null) {
      const open = await run(`return state.open;`);
      await click(track.x + track.w * places.gone, track.y + 10); await sleep(1200);
      v = await videoNow();
      const now = await run(`return state.open;`);
      check("a click on a dismissed candidate's block moves the play line too, and keeps the player", v.n === 1 && now === open, { video: v.t, open, now });
    }
    await shot("2-playing-after-drag");

    // ---- the list on the left folded away: nothing moves, the video goes on
    const headBefore = await rect(".tape-head");
    r = await rect("#side-toggle"); await click(r.cx, r.cy); await sleep(900);
    const headAfter = await rect(".tape-head"), sw = await rect(".tape-switch");
    check("folding the left list does not push the page down", Math.abs(headAfter.y - headBefore.y) < 1, { before: headBefore.y, after: headAfter.y });
    check("the button for other tapes is beside the tape's name", !!sw && sw.w > 0, sw);
    if (sw && sw.w > 0) {
      await click(sw.cx, sw.cy); await sleep(500);
      const menu = await run(`const m = document.querySelector(".tape-menu"); return { shown: m && !m.hidden, head: document.querySelector(".tape-head").getBoundingClientRect().y };`);
      v = await videoNow();
      check("its list opens over the page and moves nothing", menu.shown && Math.abs(menu.head - headBefore.y) < 1, menu);
      check("the video goes on playing meanwhile", v.n === 1 && v.playing === 1, v);
      await shot("3-tape-menu");
      await click(track.x + 200, track.y + track.h + 300); await sleep(400);
      check("it shuts when something else is clicked", await run(`return document.querySelector(".tape-menu").hidden;`));
    }
    r = await rect("#side-toggle"); await click(r.cx, r.cy); await sleep(900);

    // ---- the PC's load at the foot of the left list
    await sleep(4500);
    const perf = await run(`const p = document.querySelector("aside > .perf"); if (!p) return null; const r = p.getBoundingClientRect(), a = document.querySelector("aside").getBoundingClientRect(); return { text: p.innerText.replace(/\\s+/g, " "), lit: [...p.querySelectorAll(".lit")].map((x) => x.textContent.length), atFoot: Math.round(a.bottom - r.bottom) };`);
    check("the PC's load is shown at the foot of the left list", perf && /CPU .*\d+%.*GPU/.test(perf.text) && perf.atFoot < 40, perf);

    // ---- a reel is made
    await run(`for (const v of document.querySelectorAll("video")) v.pause(); return 1;`);
    const reelsBefore = await fetch(`${URL}/api/sources/${SAMPLE}`).then((x) => x.json()).then((d) => (d.edl ? d.edl.reels.length : 0)).catch(() => -1);
    const made = await run(`const b = [...document.querySelectorAll("#cand-open button")].find((x) => /^Make reel$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true;`);
    await sleep(3500);
    const tab = await run(`return { tab: state.tab, reels: reelsNow().length };`);
    check("Make reel makes a reel and shows it", made && tab.reels === 1 && tab.tab === "reels", { made, ...tab, reelsBefore });
    await shot("4-reel");
    await run(`switchTab("candidates"); return 1;`); await sleep(800);

    // ---- the kind of content: the chooser, the question when a recording stops
    const kinds = await run(`const p = document.querySelector(".content-pick"); return p ? { now: p.value, options: [...p.options].map((o) => o.textContent) } : null;`);
    check("the kind of content can be chosen under the tape's name", kinds && kinds.options.length === 8 && kinds.now === "general", kinds);
    const asked = await run(`keepQueue.push({ file: "C:/nothing/2026-10-10 12-00-00.mp4", name: "2026-10-10 12-00-00.mp4", seconds: 75, marks: 0, what: "testchannel" }); askKeep(); await new Promise((r) => setTimeout(r, 400)); const s = document.querySelector("#keep-form select"); return s ? { open: document.getElementById("keep-dialog").open, value: s.value, options: [...s.options].map((o) => o.textContent) } : null;`);
    check("a stopped recording is asked its kind, \"Link decides\" first", asked && asked.open && asked.options[0] === "Link decides" && asked.options.length === 9, asked);
    await shot("5-keep-dialog");
    await run(`const b = [...document.querySelectorAll("#keep-form button")].find((x) => /Discard/.test(x.textContent)); document.getElementById("keep-dialog").close(); keepOpen = null; return 1;`);

    // ---- analysed again as a shooter
    if (HOW !== "quick") {
      const started = await run(`const p = document.querySelector(".content-pick"); p.value = "shooter:valorant"; p.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 1500)); return (await api("/api/status")).job;`);
      check("choosing Shooter · Valorant starts the analysis again", started && started.running && started.kind === "analyze", started && { kind: started.kind, running: started.running });
      await sleep(4000); await shot("6-analysing");
      let job = started;
      for (let i = 0; i < 150 && job && job.running; i++) { await sleep(3000); job = await fetch(`${URL}/api/status`).then((x) => x.json()).then((s) => s.job).catch(() => job); }
      check("it finishes without an error", job && !job.running && job.returncode === 0, job && { returncode: job.returncode, last: (job.log || "").trim().split("\n").slice(-1)[0] });
      await sleep(5000);
      const after = await run(`const d = state.detail; return { content: d.content, game: d.game, fights: d.candidates.filter((c) => c.fight).length, first: d.candidates.find((c) => c.rank === 1), picker: (document.querySelector(".content-pick") || {}).value };`);
      check("the tape is a shooter now, with fights among its candidates", after.content === "shooter" && after.game === "valorant" && after.fights >= 5 && after.picker === "shooter:valorant", { ...after, first: after.first && [after.first.in, after.first.out, after.first.kills] });
      r = await rect(".cand-list .cand-row", 0);
      await run(`state.sort = "rank"; renderMain(); return 1;`); await sleep(500);
      r = await rect(".cand-list .cand-row", 0); await click(r.x + 60, r.cy); await sleep(2500);
      const tag = await run(`const t = document.querySelector("#cand-open .tag.fight"); return t ? t.textContent : null;`);
      check("a candidate cut by a fight says so", /^FIGHT ×\d/.test(tag || ""), tag);
      await shot("7-shooter");
      const kept = await run(`return reelsNow().length;`);
      check("the reel made before is still there", kept === 1, kept);
    }
  } catch (e) { failed = e; console.error("STOPPED:", e.stack || e.message); }
  try { if (ws) await run(`for (const v of document.querySelectorAll("video")) v.pause(); return 1;`); } catch (e) {}
  try { shell.kill(); } catch (e) {}
  await sleep(1500);
  try { server.kill(); } catch (e) {}
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length} of ${results.length} checks passed${failed ? " (the test stopped early)" : ""}`);
  process.exit(bad.length || failed ? 1 : 0);
})();
