"use strict";
// Link Lite Recorder's window: the panel on a stream's page (content.js shows this page in a frame there),
// and the popup under the toolbar button everywhere else. It says what the tab is and what is going on,
// and holds the things to do: record, switch the rewind on, save the last minute, mark a highlight and
// write a few words with it, stop and save. It only asks background.js; it keeps nothing itself.
//
// The middle is drawn again whenever something to show changed (twice a second at most). The note's
// field and the folded lists are kept apart from that, or typing and opening them would be undone.
const $ = (id) => document.getElementById(id);
const ask = (message) => chrome.runtime.sendMessage(message).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node[k] = v;
  }
  node.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return node;
}

const SITE = { kick: "KICK", twitch: "TWITCH" };
// The full program's name, as it is written everywhere: "Link" and then TURBO in small red pixel type.
const linkTurbo = () => el("span", { class: "link-turbo" }, el("b", {}, "Link"), " ", el("span", { class: "turbo" }, "TURBO"));
// The invitation to Link's Discord server, e.g. "https://discord.gg/…". Empty: the locked part says to join
// but has no button, since there is nowhere to send people yet.
const DISCORD_INVITE = "https://discord.gg/N3jdn6WPJd";   // the "Link" community server; this invitation does not expire
const LENGTHS = [[30, "30 seconds"], [60, "minute"], [120, "2 minutes"], [180, "3 minutes"]];
const clock = (seconds) => { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const megabytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
const lengthName = (seconds) => (LENGTHS.find(([n]) => n === seconds) || [0, `${seconds} seconds`])[1];

const embedded = window.top !== window;   // shown as the panel on the stream's page, not under the toolbar button
let tabId = null, busy = "", trouble = "", shortcuts = {}, drawn = "", drawnMore = "";
const unfolded = { skins: false, streams: false, options: false, recent: false };   // which folded parts are open
// ---- skins: the panel in other colours. Every one is free; the one in use is the browser's (background.js).
let skinOn = "classic", sentLook = "";
try { skinOn = localStorage.getItem("link-skin") || "classic"; } catch (e) { /* no storage here: it is put on with the first answer */ }
document.documentElement.dataset.skin = skinOn;   // at once, so the panel does not open in Classic and then change
function wearSkin(skins) {
  if (skins && skins.using !== skinOn) { skinOn = skins.using; try { localStorage.setItem("link-skin", skinOn); } catch (e) { /* as above */ } }
  const worn = skinOn;
  if (document.documentElement.dataset.skin !== worn) document.documentElement.dataset.skin = worn;
  flowSkin(worn);
  // the box around this page (its grip, its edge) is the stream page's: it is told the colours
  const css = getComputedStyle(document.documentElement), c = (name) => css.getPropertyValue(name).trim();
  const look = { bar: c("--bar-b"), grip: c("--bar-a"), dot: c("--slate"), ink: c("--ink") };
  if (embedded && JSON.stringify(look) !== sentLook) { sentLook = JSON.stringify(look); parent.postMessage({ linkLite: true, look }, "*"); }
}
// A skin's background: marbling that drifts, in the skin's colours. It is worked out on a picture a
// quarter of the panel's size (a few thousand points), twelve times a second, so it costs next to nothing
// beside a recording; it stands still while the panel is out of sight, and for whoever asked their
// computer for less movement it is one still picture.
const flow = { canvas: $("flow"), ctx: null, timer: 0, t: Math.random() * 100, lo: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], skin: "" };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const blend = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
function flowFrame() {
  const c = flow.canvas, w = Math.max(8, Math.ceil(document.body.clientWidth / 4)), h = Math.max(8, Math.ceil(document.body.clientHeight / 4));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; flow.ctx = null; }
  const ctx = (flow.ctx = flow.ctx || c.getContext("2d")), img = ctx.createImageData(w, h), d = img.data, t = flow.t, k = 3.2 / 73;   // the same grain at any size of panel
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      // the place is pushed about by slow waves, each finer than the last: that folds straight bands into marbling
      let px = x * k, py = y * k;
      for (let n = 1; n <= 3; n++) {
        px += (0.7 / n) * Math.sin(n * 1.7 * py + t * 0.31 + n);
        py += (0.7 / n) * Math.cos(n * 1.3 * px + t * 0.23 + n * 1.7);
      }
      const v = 0.5 + 0.5 * Math.sin(1.5 * px + 1.2 * py), s = v * v * (3 - 2 * v);
      const a = s < 0.5 ? flow.lo : flow.mid, b = s < 0.5 ? flow.mid : flow.hi, m = s < 0.5 ? s * 2 : s * 2 - 1;
      d[i] = a[0] + (b[0] - a[0]) * m; d[i + 1] = a[1] + (b[1] - a[1]) * m; d[i + 2] = a[2] + (b[2] - a[2]) * m; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function flowSkin(worn) {
  const css = getComputedStyle(document.documentElement), c = (name) => css.getPropertyValue(name).trim();
  const on = Number(c("--flow")) > 0;
  if (worn === flow.skin && on === !flow.canvas.hidden) return;
  flow.skin = worn;
  flow.canvas.hidden = !on;
  clearInterval(flow.timer);
  flow.timer = 0;
  if (!on) return;
  // from nearly black, through the skin's own dark, to a little of its edge colour: never bright
  flow.lo = blend(rgb(c("--ink")), rgb(c("--bar-b")), 0.4);
  flow.mid = rgb(c("--bar-a"));
  flow.hi = blend(rgb(c("--bar-a")), rgb(c("--slate")), 0.3);
  flowFrame();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  flow.timer = setInterval(() => { if (document.hidden) return; flow.t += 0.08; flowFrame(); }, 80);
}
let noteFor = -1, noteDone = -1;                  // the mark the note field is for, and the last one answered

async function act(what, message) {
  busy = what;
  trouble = "";
  draw(await ask({ type: "link:state", tabId }));
  const res = await ask(message);
  busy = "";
  if (res && res.ok === false) trouble = res.error || "That did not work.";
  refresh();
}
const setOption = async (options) => { await ask({ type: "link:options", options }); refresh(); };

const whoRow = (c) => el("div", { class: "who" }, el("span", { class: `site ${c.site}` }, SITE[c.site] || ""), el("b", { title: c.title || "" }, c.channel));
const cell = (value, label, title, red) => el("div", { title }, el("div", { class: "value" + (red ? " red" : "") }, value), el("div", { class: "label" }, label));
const chatCell = (st) => cell(st.chat ? String(st.perMin) : "–", "chat / min",
  st.chat ? "Messages a minute in the stream's chat. Only the count is kept." : "The chat is not on the page, so its speed cannot be counted. Open the chat beside the stream.");
const marksCell = (st) => cell(`★ ${st.marks}`, "marked", st.autos ? `${st.autos} of them marked by itself, when the chat sped up` : "Highlights marked");

// What is wrong with the picture or the sound right now, said while the tab is captured.
const warnings = (st) => [
  st.ad && el("p", { class: "help warn" }, "Twitch is playing an ad, and it is in the picture. Link takes no moments from it."),
  st.inPicture && el("p", { class: "help warn" }, embedded ? "The stream fills the window, so this panel is in the picture. Close it with ✕ (the shortcuts still mark, save and stop), or leave theatre mode." : "Link's panel on the page is in the picture. Close it."),
  st.muted && el("p", { class: "help warn" }, "The stream is muted on its page, so there is no sound. Turn its volume up."),
  st.hidden && el("p", { class: "help warn" }, "Part of the stream is out of view on its page, and that part is black. Scroll the stream back into view."),
];

function savedPanel(last) {
  return el("div", { class: "panel" },
    el("div", { class: "pix", style: last.error ? "color: var(--red-soft)" : "color: var(--green)" }, last.error ? "✕ Not saved" : last.rewound ? "✓ Saved from the rewind" : "✓ Saved"),
    last.error ? el("p", { class: "help bad" }, last.error)
      : [el("p", { class: "help" }, el("b", {}, last.name), ` · ${clock(last.seconds)}${last.size ? ` · ${megabytes(last.size)}` : ""}${last.marks ? ` · ★ ${last.marks}` : ""}`),
         el("p", { class: "help" }, "It is in your Downloads folder, in ", el("b", {}, "Link"), ": one file, to open in your editing program. Its marks are under Recordings, in Link's panel on the stream's page."),
         /\.webm$/.test(last.name) && el("p", { class: "help warn" }, "This browser could only make a .webm file, which Link does not take yet.")],
    last.note && el("p", { class: "help warn" }, last.note),
    el("div", { class: "row" },
      !last.error && last.id != null && el("button", { class: "small", onclick: () => ask({ type: "link:reveal", id: last.id }) }, "Show in folder"),
      el("button", { class: "small", onclick: async () => { await ask({ type: "link:forget" }); refresh(); } }, "OK")));
}

// ---- the bar: the same things as the popup, laid out in a row for the panel under a stream
let openMarks = null, copied = null;   // the recording whose marks are shown, and the one whose list was just copied
// A time in a recording, as an editor reads it: 0:42, or 1:02:07 past the hour.
const stamp = (t) => { const s = Math.max(0, Math.floor(t)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : clock(s); };
const markName = (p) => p.note || (p.auto ? "chat sped up" : "marked");
// To the clipboard. The panel is a frame on somebody else's page, where the newer way may be refused;
// the old way (select and copy) works there.
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return; } catch (e) { /* the old way, below */ }
  const box = el("textarea", { value: text, style: "position:fixed;opacity:0" });
  document.body.append(box);
  box.select();
  document.execCommand("copy");
  box.remove();
}
let deleting = null, deletingTimer = 0;   // the recording whose ✕ was pressed once, and when that is forgotten again
let goingAt = null;   // the saved recording whose message is on its way out
let drawerOpen = false, ghostOn = false;   // the panel always opens as the capsule; "More" shows its folded parts, each shut
const chip = (value, label, title, red) => el("span", { class: "chip" + (red ? " red" : ""), title: title || "" }, value, label && el("small", {}, label));
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en"));
// One chip that shows two things in turn, four seconds each. The bar is drawn again every second, so the
// turn is kept by the clock, not by when the chip was made.
const SWAP = 8000;
const swapChip = (first, second, title) => el("span", { class: "chip swap", title, style: `--at: -${Date.now() % SWAP}ms` },
  el("span", {}, first[0], el("small", {}, first[1])), el("span", {}, second[0], el("small", {}, second[1])));

function drawBar(s) {
  const { cap, stats, last, who, options, here, recent } = s;
  const st = stats || null;
  const sig = JSON.stringify([cap && [cap.state, cap.channel, cap.armed, !!cap.theatred && Date.now() - cap.theatred < 7000], st && [Math.floor(st.seconds), Math.floor(st.held), st.marks, st.autos, st.perMin, st.chat, st.ad, st.hidden, st.muted, st.inPicture], last, who, options, here, busy, trouble]);
  if (sig !== drawn) {
    drawn = sig;
    const row = [], second = [];
    // how busy the stream is: the chat's speed and how many are watching, in turn
    const watching = here && who && who.viewers != null ? who.viewers : null;
    const chatChip = (x) => {
      const chat = [x.chat ? String(x.perMin) : "–", "chat / min"];
      const title = `${x.chat ? "Messages a minute in the stream's chat. Only the count is kept." : "The chat is not on the page, so its speed cannot be counted. Open the chat beside the stream."}${watching != null ? ` ${watching.toLocaleString("en")} are watching.` : ""}`;
      return watching != null ? swapChip(chat, [compact(watching), "watching"], title) : chip(chat[0], chat[1], title);
    };
    const marksChip = (x) => chip(`★ ${x.marks}`, "", x.autos ? `${x.marks} highlights marked, ${x.autos} of them by itself when the chat sped up` : "Highlights marked");
    // said for a few seconds when a recording switched the site to theatre mode, then gone by itself
    if (cap && cap.state === "recording" && cap.theatred && Date.now() - cap.theatred < 7000) {
      second.push(el("span", { class: "good" }, "⤢ Theatre mode is on, so the recording is sharper. The page goes back when you stop."));
    }
    if (cap && cap.state === "recording" && st) {
      row.push(el("span", { class: "state red" }, el("i", { class: "dot" }), "Rec"), whoRow(cap),
        chip(clock(st.seconds), "", `Link Lite records up to 30 minutes. ${clock(st.left)} left.${cap.armed ? " The rewind stays on when you stop." : ""}`, true), marksChip(st), chatChip(st),
        el("button", { disabled: !!busy, title: "Mark a highlight", onclick: () => act("mark", { type: "link:mark" }) }, "★ Mark"),
        el("button", { class: "rec", disabled: !!busy, title: "Stop and save the recording", onclick: () => act("stop", { type: "link:stop" }) }, ...(busy === "stop" ? ["Saving…"] : [el("i", { class: "sq" }), "Stop"])),
        !here && el("button", { class: "small", onclick: () => ask({ type: "link:show" }) }, "Show the stream's tab"));
      second.push(warnings(st));
    } else if (cap && cap.state === "armed" && st) {
      const length = options.rewind;
      row.push(el("span", { class: "state" }, "⟲ Rewind"), whoRow(cap),
        chip(clock(st.held), `of ${clock(st.reach)}`, "How much of the stream Link holds right now. Older than that is let go. It uses some of the PC's power for as long as it is on."), marksChip(st), chatChip(st),
        el("button", { class: "primary", disabled: !!busy || st.held < 5, title: "Makes a file of what you just saw. The rewind goes on.", onclick: () => act("save", { type: "link:save", seconds: length }) },
          busy === "save" ? "Saving…" : "⟲ Save last"),
        el("select", { title: "How far back Save and Record reach", onchange: (e) => setOption({ rewind: Number(e.target.value) }) },
          LENGTHS.map(([n, name]) => el("option", { value: n, selected: n === length }, name))),
        el("button", { disabled: !!busy, title: "Mark a highlight", onclick: () => act("mark", { type: "link:mark" }) }, "★ Mark"),
        el("button", { class: "rec", disabled: !!busy, title: `The recording begins with the last ${lengthName(length)}, then goes on until you stop it.`, onclick: () => act("record", { type: "link:record", tabId: cap.tabId }) },
          busy === "record" ? "Starting…" : "● Record"),
        el("button", { class: "small quiet", disabled: !!busy, title: "Switch the rewind off", onclick: () => act("disarm", { type: "link:disarm" }) }, "Off"));
      second.push(warnings(st));
    } else if (cap) {
      row.push(el("span", { class: "state" }, cap.state === "saving" ? "Saving the recording…" : "Starting…"), whoRow(cap));
    } else if (who && who.channel) {
      const small = options.streamOnly && who.view && who.view.h * who.view.dpr < 700;
      row.push(whoRow(who), who.viewers != null && chip(compact(who.viewers), "watching", `${who.viewers.toLocaleString("en")} are watching`),
        el("button", { class: "primary", disabled: !!busy || !!who.gate, onclick: () => act("record", { type: "link:record", tabId }) }, busy === "record" ? "Starting…" : "● Record"),
        el("button", { disabled: !!busy || !!who.gate, title: "Link keeps the last 3 minutes while you watch, so you can save a moment after it happened. It uses some of the PC's power for as long as it is on.", onclick: () => act("arm", { type: "link:arm", tabId }) },
          busy === "arm" ? "Starting…" : "⟲ Rewind on"),
        // how big the recording will be; small: it says how to make it sharper, and on Twitch a press switches to theatre mode
        small && el(who.theatre ? "button" : "span", { class: who.theatre ? "small" : "chip dim", title: `The recording is as sharp as the stream is big on the page: ${Math.round(who.view.w * who.view.dpr)}×${Math.round(who.view.h * who.view.dpr)} now. ${who.theatre ? "Press for theatre mode, which makes it sharper; do it before you start." : "A bigger window or the site's theatre mode makes it sharper."}`,
          onclick: who.theatre ? async () => { await ask({ type: "link:theatre", tabId }); setTimeout(refresh, 700); } : null }, who.theatre ? "⤢ Theatre" : `${Math.round(who.view.h * who.view.dpr)}p`));
      if (who.gate) second.push(el("span", { class: "warn" }, "Twitch is asking before it shows this stream. Press Start Watching on the page first: until then there is no stream to record."));
      else if (!who.video) second.push(el("span", { class: "warn" }, "No stream is playing on this page yet."));
    } else {
      row.push(el("span", { class: "state" }, "No stream in this tab"), el("span", { class: "help" }, "Open a channel on kick.com or twitch.tv."));
    }
    if (last && (last.name || last.error)) {
      // "Saved" is said for two seconds and goes by itself (the recording is in "Recordings" from then on).
      // What went wrong, or a warning with the file, stays until it is answered.
      const passing = !last.error && !last.note;
      if (passing && goingAt !== last.at) { goingAt = last.at; setTimeout(async () => { await ask({ type: "link:forget" }); refresh(); }, 2000); }
      second.unshift(el("span", { class: last.error ? "bad" : "good" }, last.error ? `✕ Not saved: ${last.error}` : `${last.rewound ? "✓ Saved from the rewind" : "✓ Saved"}: `, !last.error && el("b", {}, last.name),
          !last.error && ` · ${clock(last.seconds)}${last.size ? ` · ${megabytes(last.size)}` : ""}${last.marks ? ` · ★ ${last.marks}` : ""} · in Downloads/Link`, last.note && ` · ${last.note}`),
        !last.error && last.id != null && el("button", { class: "small", onclick: () => ask({ type: "link:reveal", id: last.id }) }, "Show in folder"),
        !passing && el("button", { class: "small", onclick: async () => { await ask({ type: "link:forget" }); refresh(); } }, "OK"));
    }
    if (trouble) second.push(el("span", { class: "bad" }, trouble));
    $("main").replaceChildren(...row.flat(Infinity).filter(Boolean));
    $("line2").replaceChildren(...second.flat(Infinity).filter(Boolean));
  }
  note(cap, st);
  sound(cap, st, options);
  wearSkin(s.skins);
  more(options, recent || [], s.skins);
  $("more").hidden = !drawerOpen;
  ghostOn = !!options.ghost;
  $("ghost").classList.toggle("on", ghostOn);
  parent.postMessage({ linkLite: true, height: document.body.offsetHeight, ghost: ghostOn, wide: drawerOpen }, "*");   // the frame is made as tall as this, faint or not, and roomy while "More" is open
}

function draw(s) {
  if (!s) return;
  if (embedded) return drawBar(s);
  const { cap, stats, last, who, options, here, recent } = s;
  const st = stats || null;
  // drawn again only when something to show changed, so a button is not replaced under the pointer
  const sig = JSON.stringify([cap && [cap.state, cap.channel, cap.armed], st && [Math.floor(st.seconds), Math.floor(st.held), st.marks, st.autos, st.perMin, st.chat, st.ad, st.hidden, st.muted, st.inPicture], last, who, options, here, busy, trouble]);
  if (sig !== drawn) {
    drawn = sig;
    const parts = [];
    if (last && (last.name || last.error)) parts.push(savedPanel(last));
    if (cap && cap.state === "recording" && st) {
      parts.push(el("div", { class: "panel" },
        el("div", { class: "pix", style: "color: var(--red-soft)" }, "● Recording"),
        whoRow(cap),
        el("div", { class: "readout" }, cell(clock(st.seconds), "time", "", true), marksCell(st), chatCell(st)),
        el("div", { class: "row" },
          el("button", { disabled: !!busy, onclick: () => act("mark", { type: "link:mark" }) }, "★ Mark highlight"),
          el("button", { class: "rec", disabled: !!busy, onclick: () => act("stop", { type: "link:stop" }) }, ...(busy === "stop" ? ["Saving…"] : [el("i", { class: "sq" }), "Stop and save"]))),
        warnings(st),
        !st.chat && st.seconds > 8 && el("p", { class: "help" }, "Chat speed is not being counted: the chat is not open on the stream's page."),
        el("p", { class: "help" }, `Link Lite records up to 30 minutes. ${clock(st.left)} left.${cap.armed ? " The rewind stays on when you stop." : ""}`),
        !here && el("button", { onclick: () => ask({ type: "link:show" }) }, "Show the stream's tab")));
    } else if (cap && cap.state === "armed" && st) {
      const length = options.rewind, can = Math.min(length, Math.floor(st.held));
      parts.push(el("div", { class: "panel" },
        el("div", { class: "pix" }, "⟲ Rewind on"),
        whoRow(cap),
        el("div", { class: "readout" }, cell(clock(st.held), `of ${clock(st.reach)} kept`, "How much of the stream Link holds right now. Older than that is let go."), marksCell(st), chatCell(st)),
        el("div", { class: "row" },
          el("button", { class: "primary", disabled: !!busy || st.held < 5, title: "Makes a file of what you just saw. The rewind goes on.", onclick: () => act("save", { type: "link:save", seconds: length }) },
            busy === "save" ? "Saving…" : `⟲ Save the last ${lengthName(length)}`),
          el("select", { title: "How far back Save and Record reach", onchange: (e) => setOption({ rewind: Number(e.target.value) }) },
            LENGTHS.map(([n, name]) => el("option", { value: n, selected: n === length }, name)))),
        st.held < length && el("p", { class: "help" }, `So far ${clock(can)} is kept; it fills up as you watch.`),
        el("div", { class: "row" },
          el("button", { disabled: !!busy, onclick: () => act("mark", { type: "link:mark" }) }, "★ Mark"),
          el("button", { class: "rec", disabled: !!busy, title: `The recording begins with the last ${lengthName(length)}, then goes on until you stop it.`, onclick: () => act("record", { type: "link:record", tabId: cap.tabId }) },
            busy === "record" ? "Starting…" : "● Record from here")),
        warnings(st),
        el("p", { class: "help" }, "Link keeps the last 3 minutes while you watch. It uses some of the PC's power for as long as it is on."),
        el("div", { class: "row" },
          !here && el("button", { class: "small", onclick: () => ask({ type: "link:show" }) }, "Show the stream's tab"),
          el("button", { class: "small quiet", disabled: !!busy, onclick: () => act("disarm", { type: "link:disarm" }) }, "Switch the rewind off"))));
    } else if (cap) {
      parts.push(el("div", { class: "panel" }, el("div", { class: "pix" }, cap.state === "saving" ? "Saving the recording…" : "Starting…"), whoRow(cap)));
    } else if (who && who.channel) {
      const small = options.streamOnly && who.view && who.view.h * who.view.dpr < 700;
      parts.push(el("div", { class: "panel" },
        whoRow(who),
        el("button", { class: "primary", disabled: !!busy || !!who.gate, onclick: () => act("record", { type: "link:record", tabId }) }, busy === "record" ? "Starting…" : "● Record this stream"),
        el("button", { disabled: !!busy || !!who.gate, title: "Link keeps the last 3 minutes while you watch, so you can save a moment after it happened.", onclick: () => act("arm", { type: "link:arm", tabId }) },
          busy === "arm" ? "Starting…" : "⟲ Switch the rewind on"),
        el("p", { class: "help" }, "With the rewind on you can save a moment after it happened."),
        who.gate && el("p", { class: "help warn" }, "Twitch is asking before it shows this stream. Press Start Watching on the page first: until then there is no stream to record."),
        !who.gate && !who.video && el("p", { class: "help warn" }, "No stream is playing on this page yet."),
        small && el("p", { class: "help" }, `The recording is as sharp as the stream is big on the page: ${Math.round(who.view.w * who.view.dpr)}×${Math.round(who.view.h * who.view.dpr)} now. `,
          who.theatre ? "Theatre mode makes it sharper; switch to it before you start." : "A bigger window or the site's theatre mode makes it sharper."),
        small && who.theatre && el("button", { class: "small", onclick: async () => { await ask({ type: "link:theatre", tabId }); setTimeout(refresh, 700); } }, "⤢ Theatre mode")));
    } else {
      parts.push(el("div", { class: "panel" },
        el("div", { class: "pix" }, "No stream in this tab"),
        el("p", { class: "help" }, "Open a channel on ", el("b", {}, "kick.com"), " or ", el("b", {}, "twitch.tv"), ", then press this button again.")));
    }
    if (trouble) parts.push(el("p", { class: "help bad" }, trouble));
    $("main").replaceChildren(...parts.flat(Infinity).filter(Boolean));
  }
  note(cap, st);
  sound(cap, st, options);
  wearSkin(s.skins);
  more(options, recent || [], s.skins);
  if (embedded) parent.postMessage({ linkLite: true, height: document.body.offsetHeight }, "*");   // the frame is made as tall as this
}

// ---- the sound bar: how loud the stream is heard while its tab is captured (it records, or the rewind is
// on). The site's own volume is no use then: Link keeps it at full, since the recording is as loud as the
// page plays. This turns down only what comes out of the speakers. It is there only while the tab is
// captured, and is kept apart from the rest, which is drawn again every second.
let earAt = 1, earKept = 1, earMoved = 0;   // the level shown, the last one that was not a mute, and when it was last moved here
function paintSound() {
  const pct = Math.round(earAt * 100);
  $("vol").value = pct;
  $("vol").style.setProperty("--v", `${pct}%`);
  $("sound").classList.toggle("off", earAt === 0);
  $("vol").title = `You hear the stream at ${pct}%. The recording stays at full volume.`;
  $("mute").title = earAt === 0 ? "You hear nothing; the recording has its sound. Press to hear it again." : "Mute what you hear. The recording keeps its sound.";
}
function sound(cap, st, options) {
  const on = !!(cap && st && st.ear != null && (cap.state === "recording" || cap.state === "armed"));
  $("sound").hidden = !on;
  if (!on) return;
  if (options && options.volume >= 0.05 && earAt > 0) earKept = options.volume;
  if (Date.now() - earMoved < 1500) return;   // being moved: what the recorder says is a moment old
  if (st.ear !== earAt) { earAt = st.ear; if (earAt > 0) earKept = earAt; }
  paintSound();
}
function hear(level, keep) {
  earAt = Math.max(0, Math.min(1, level));
  earMoved = Date.now();
  if (earAt > 0) earKept = earAt;
  paintSound();
  ask({ type: "link:volume", level: earAt, keep });
}
$("vol").oninput = (e) => hear(Number(e.target.value) / 100, true);
$("mute").onclick = () => hear(earAt > 0 ? 0 : earKept || 1, false);
$("sound").addEventListener("wheel", (e) => { e.preventDefault(); hear(earAt + (e.deltaY < 0 ? 0.05 : -0.05), true); }, { passive: false });

// The field for a few words with the highlight just marked. It comes with each new mark and goes when
// it is answered, or by itself after a while; what is being typed is never drawn over.
function note(cap, st) {
  const mark = cap && st && st.lastMark;
  const row = $("note-row");
  if (!mark || mark.index === noteDone || (mark.index !== noteFor && mark.ago > 20)) { if (mark && mark.ago > 20) noteDone = mark.index; row.hidden = true; return; }
  if (mark.index !== noteFor) {
    noteFor = mark.index;
    $("note").value = mark.note || "";
    $("note-label").textContent = mark.auto ? "★ Marked by itself: the chat sped up" : "★ Marked. What was it?";
  }
  if (mark.ago > 45 && document.activeElement !== $("note") && !$("note").value) { noteDone = mark.index; row.hidden = true; return; }
  row.hidden = false;
}
$("note-row").onsubmit = async (event) => {
  event.preventDefault();
  await ask({ type: "link:note", index: noteFor, text: $("note").value.trim() });
  noteDone = noteFor;
  $("note-row").hidden = true;
};

// The choices and the recordings made lately: folded away under the rest.
function more(options, recent, skins) {
  const sig = JSON.stringify([options, recent, shortcuts, deleting, openMarks, copied, skins]);
  if (sig === drawnMore) return;
  drawnMore = sig;
  const fold = (key, title, ...inside) => el("details", { class: `fold-${key}${key === "streams" ? " locked" : ""}`, title: key === "streams" ? "Not in Link Lite. It comes with Link TURBO, the full program." : "", open: unfolded[key], ontoggle: (e) => { unfolded[key] = e.target.open; if (embedded) parent.postMessage({ linkLite: true, height: document.body.offsetHeight }, "*"); } },
    el("summary", {}, title), el("div", { class: "inside" }, inside));
  const tick = (key, text) => el("label", { class: "check" }, el("input", { type: "checkbox", checked: !!options[key], onchange: (e) => setOption({ [key]: e.target.checked }) }), el("span", {}, text));
  const key = (name, what) => shortcuts[name] && [el("kbd", {}, shortcuts[name]), ` ${what}  `];
  $("more").replaceChildren(
    // The skins: every one is free. A press puts one on.
    skins && fold("skins", `Skins · ${(skins.list.find((k) => k.id === skins.using) || {}).name || "Classic"}`,
      el("div", { class: "skins" }, skins.list.map((k) => el("button", { class: `skin${k.id === skins.using ? " on" : ""}`,
        title: k.id === skins.using ? "The skin in use" : "Put this skin on", onclick: () => setOption({ skin: k.id }) },
        el("i"), el("span", {}, k.name), el("small", {}, k.id === skins.using ? "in use" : "free")))
        .map((b, i) => { b.dataset.skin = skins.list[i].id; return b; }))),
    // Shown, not offered: Link Lite takes one stream. Several side by side is the full Link's.
    fold("streams", "🔒 More streams at once",
      [2, 3].map((n) => el("input", { type: "text", disabled: true, placeholder: `Stream ${n}: kick.com/channel or twitch.tv/channel` })),
      el("p", { class: "help" }, "Up to 3 streams recorded side by side, each with its own sound, come with ", linkTurbo(), ", the full program. Join Link's Discord for the news."),
      DISCORD_INVITE && el("button", { class: "small discord", onclick: () => chrome.tabs.create({ url: DISCORD_INVITE }) }, "Join the Discord")),
    fold("options", "Choices",
      tick("streamOnly", "Record only the stream's picture, without the chat and the site around it. Keep the stream in view while it records."),
      tick("clean", "Clean picture: while it records, the player's buttons, the site's banners and the mouse pointer are kept out of the picture."),
      tick("autoMarks", "Mark by itself when the chat suddenly speeds up."),
      tick("theatre", "Theatre mode while it records: the stream fills the window, so the recording is sharper. The page goes back when you stop."),
      Object.keys(shortcuts).length ? el("p", { class: "help" }, "Shortcuts: ", key("_execute_action", "panel"), key("toggle-record", "record / stop"), key("mark", "mark"), key("save-last", "save the last minute")) : null,
      embedded && el("p", { class: "help" }, "Nothing is uploaded. Record only streams you have the right to use.")),
    recent.length ? fold("recent", `Recordings · ${recent.length}`,
      recent.map((r) => [el("div", { class: "made", title: `${r.name}\n${new Date(r.at).toLocaleString()}` },
        el("span", { class: "what" }, el("b", {}, r.channel || ""), ` · ${clock(r.seconds)}${r.marks && !(r.points && r.points.length) ? ` · ★ ${r.marks}` : ""}${r.rewound ? " · rewind" : ""}`),
        // the marks of a recording, to read and to take to an editing program
        r.points && r.points.length ? el("button", { class: "small quiet stars" + (openMarks === r.at ? " on" : ""), title: "The moments marked in this recording", onclick: () => { openMarks = openMarks === r.at ? null : r.at; refresh(); } }, `★ ${r.points.length} ${openMarks === r.at ? "▴" : "▾"}`) : null,
        r.id != null && el("button", { class: "small", onclick: () => ask({ type: "link:reveal", id: r.id }) }, "Show"),
        // ✕ deletes the recording's file from the computer, for good. It asks once: the second press does it.
        deleting === r.at
          ? el("button", { class: "small del sure", title: "Deletes the file from this computer. It cannot be brought back.", onclick: async () => { deleting = null; await ask({ type: "link:delete", at: r.at, id: r.id }); refresh(); } }, "Delete?")
          : el("button", { class: "small quiet del", title: "Delete this recording from the computer", ariaLabel: "Delete this recording", onclick: () => { deleting = r.at; clearTimeout(deletingTimer); deletingTimer = setTimeout(() => { deleting = null; refresh(); }, 3000); refresh(); } }, "✕")),
        openMarks === r.at && r.points && r.points.length ? el("div", { class: "marks" },
          r.points.map((p) => el("div", { class: "mark" + (p.auto ? " auto" : "") }, el("b", {}, stamp(p.t)), el("span", {}, markName(p)))),
          el("div", { class: "row" },
            el("button", { class: "small", title: "Copies the times and notes as text, for any editing program",
              onclick: async () => { await copy([r.name, ...r.points.map((p) => `${stamp(p.t)}  ${markName(p)}`)].join("\n")); copied = r.at; refresh(); setTimeout(() => { copied = null; refresh(); }, 1500); } }, copied === r.at ? "✓ Copied" : "Copy list"),
            el("button", { class: "small", title: "Saves a marker file beside the video. In DaVinci Resolve: right-click the timeline in the media pool, Timelines > Import > Timeline Markers from EDL.",
              onclick: async () => { const res = await ask({ type: "link:markers", at: r.at }); if (res && res.ok && res.id != null) ask({ type: "link:reveal", id: res.id }); } }, "Markers for Resolve"))) : null])) : "");
}

const refresh = async () => draw(await ask({ type: "link:state", tabId }));

// Halloween: the jack-o'-lantern in the header, from the first of October to the second of November.
const halloween = (d = new Date()) => d.getMonth() === 9 || (d.getMonth() === 10 && d.getDate() <= 2);
$("season").toggleAttribute("hidden", !halloween());

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = Number(new URLSearchParams(location.search).get("tab")) || (tab ? tab.id : null);   // ?tab= : the popup opened as a page of its own, for testing
  if (embedded) {
    const mine = await chrome.tabs.getCurrent();   // the tab this panel is on, whichever tab is in front
    if (mine) tabId = mine.id;
    document.documentElement.classList.add("embedded");
    $("close").hidden = false;
    $("close").onclick = () => parent.postMessage({ linkLite: true, close: true }, "*");
    $("tools").hidden = false;
    // whenever what is shown changes its height (and when the frame changes its width), the frame is told at once
    new ResizeObserver(() => parent.postMessage({ linkLite: true, height: document.body.offsetHeight }, "*")).observe(document.body);
    $("tools").append($("close"));   // at the end of the bar, after its buttons
    $("ghost").onclick = () => setOption({ ghost: !ghostOn });
    $("drawer").onclick = () => { drawerOpen = !drawerOpen; $("drawer").textContent = drawerOpen ? "Less ▴" : "More ▾"; refresh(); };
  }
  for (const c of await chrome.commands.getAll()) if (c.shortcut) shortcuts[c.name] = c.shortcut;
  await refresh();
  setInterval(refresh, 500);
})();
