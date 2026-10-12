const $ = (id) => document.getElementById(id);
// the link fields and where they wait out of sight (see drawMain); held here because they are not always on the page to be found
const linkBar = $("opener"), linkHome = $("opener-home");

// draft: the edit list with the changes made in the page that are not saved yet (null when clean).
// base: the version of reels.json the draft is built on; force: overwrite a newer version on the next save.
const state = {
  status: null, sources: [], id: null, detail: null, draft: null, base: null, force: false,
  tab: "candidates", sort: "rank", filter: "all", open: null, autoplay: null, cut: null,
  stretch: { at: null, in: null, out: null }, reel: null, capSel: null, pickerOpen: false,
  // the Sources screen: shown or not, its look ("day" or "grid"), the chosen folder (null: the recent tapes, in no folder yet), filter, order, search
  library: false, libView: "day", libFolder: null, libFilter: "all", libSort: "new", libSearch: "",
  jobWasRunning: false, jobHidden: false, showLog: false, lastJob: null, jobExpect: 0, sig: {},
  // studio: the player screen is shown; kind: which one, the Studio ("stream") or URL ("video")
  shell: null, studio: false, kind: "stream",
  // The sidebar's folders (videos/reels/folders.json), the tapes ticked with Ctrl/Shift, the folder being
  // named, and what is being dragged.
  lib: { folders: [], tapes: {}, favorites: [] }, picked: new Set(), pickAnchor: null, tapeOrder: [],
  renaming: null, freshFolder: null, drag: null, sourcesStale: false, naming: null,
  // recordings already handled (by their time), and the ones waiting to be processed
  savedSeen: new Set(), ingestQueue: [],
  analytics: false, insta: null, instaBusy: false, instaError: "", instaSort: { key: "posted", down: true }, period: "28",
  // the Analytics screen's other side, YouTube; ytWait: Google's sign-in page is open and the page is waiting for it
  platform: "instagram", yt: null, ytBusy: false, ytError: "", ytSort: { key: "posted", down: true }, ytWait: null,
  // settings: the section of the Settings screen that is open, or null; about and spotify: what its sections show
  settings: null, about: null, spotify: null, kick: null, storage: null, learned: null, learning: false,
  // the Reels tab's player: null, or the platform whose own screen is drawn over the reel ("instagram" or "youtube")
  look: null,
};
// Link's window (tools/reels/shell) gives the page a browser panel and a recorder to drive. In an
// ordinary browser this is null: the tapes and reels work, opening and recording a video do not.
const shell = window.linkShell || null;
const PLATFORMS = ["YouTube Shorts", "TikTok"];
const JOBS = {
  ingest: ["Processing the recording", "Recording processed"],
  render: ["Rendering reels", "Reels rendered"],
  preview: ["Rendering a preview", "Preview ready"],
  analyze: ["Analysing the recording again", "Recording analysed"],
};
const PROBLEM_NAMES = { black: "Black picture", silent: "No sound", ad: "An ad" };

// ---------------------------------------------------------------- small helpers

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k.startsWith("data-")) node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return node;
}

// replaceChildren, minus the null and false entries that conditional pieces leave behind.
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

function svg(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstChild;
}

const px = (box, rects) => `<svg viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
const r = (x, y, w, h, fill = "currentColor") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const HOLE = "#0a0d1f";
const ICONS = {
  rec: px(11, r(4, 2, 3, 1) + r(3, 3, 5, 1) + r(2, 4, 7, 3) + r(3, 7, 5, 1) + r(4, 8, 3, 1)),
  screen: px(11, r(1, 2, 9, 6) + r(2, 3, 7, 4, HOLE) + r(4, 8, 3, 1) + r(3, 9, 5, 1)),
  candidates: px(9, r(0, 1, 9, 7, "#9fd8c8") + [2, 4, 6].map((y) => r(1, y, 1, 1, HOLE) + r(7, y, 1, 1, HOLE)).join("") + r(3, 3, 3, 3, HOLE)),
  reels: px(9, r(2, 0, 5, 9, "#f2c744") + r(3, 1, 3, 2, HOLE) + r(3, 6, 3, 2, HOLE) + r(4, 4, 1, 1, HOLE)),
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="13" width="4" height="4" fill="currentColor"/><rect x="10" y="6" width="4" height="4" fill="currentColor"/><rect x="17" y="11" width="4" height="4" fill="currentColor"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.9 8.9 0 1 0 11.1 11.1z"/><path d="M17.2 3.2l.75 1.85 1.85.75-1.85.75-.75 1.85-.75-1.85-1.85-.75 1.85-.75z"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8.6" stroke-width="2.6" stroke-dasharray="3.4 3.354" stroke-dashoffset="1.7"/><circle cx="12" cy="12" r="6.2" stroke-width="2"/><circle cx="12" cy="12" r="2.3" stroke-width="2"/></svg>`,
  screenLine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 5.4A17 17 0 0 0 15.4 4l-.5 1a15.6 15.6 0 0 0-5.8 0L8.6 4a17 17 0 0 0-4.2 1.4C1.7 9.4 1 13.3 1.3 17.2a17 17 0 0 0 5.2 2.6l1.1-1.7a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3a11 11 0 0 1-1.7.8l1.1 1.7a17 17 0 0 0 5.2-2.6c.4-4.5-.7-8.4-3.1-11.8zM8.6 14.8c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm6.8 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 18.5a2.5 2.5 0 1 1-2-2.45V5.5l11-2.5v12.5a2.5 2.5 0 1 1-2-2.45V7.1L9 8.7z"/></svg>`,
  folderPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M3 6h6l2 3h10v10H3z"/><path d="M12 12v5M9.5 14.5h5"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`,
  tape: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><path d="M10 11h4M7 19l1.5-3h7l1.5 3"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="6" width="4" height="15" rx="1"/><rect x="17" y="2" width="4" height="19" rx="1"/></svg>`,
  kick: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h6v5h2V6h2V3h6v6h-2v2h-2v2h2v2h2v6h-6v-3h-2v-2h-2v5H4z"/></svg>`,
  spotify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.5 9.6c3.2-.9 6.4-.6 9.2 1M8.2 12.8c2.5-.6 4.8-.4 6.9.8M9 15.7c1.7-.4 3.2-.2 4.6.6"/></svg>`,
  key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4.2"/><path d="M11 12l8.5-8.5M16 6.5l3 3M13.5 9l2.2 2.2"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  finals: px(9, r(4, 0, 1, 9, "#3ddc84") + r(0, 4, 9, 1, "#3ddc84") + r(3, 3, 3, 3, "#3ddc84") + r(2, 2, 1, 1, "#3ddc84") + r(6, 2, 1, 1, "#3ddc84") + r(2, 6, 1, 1, "#3ddc84") + r(6, 6, 1, 1, "#3ddc84")),
};

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || res.statusText), { conflict: data.conflict });
  return data;
}

let toastTimer;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = (bad ? "✕ " : "✓ ") + text;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 7000 : 3000);
}

// Link's start-up self-check: when the window opens, the shell tries each part it needs and says how
// each one came up (runCheck in main.js). The card shows it briefly — all-clear flashes by, anything
// to look at stays until the user clicks it away. An item is green when ok, amber when it only bears
// watching (warn), red when it is a problem. Held behind the start-up screen until that clears.
let selfCheckShown = 0, selfCheckTimer, selfCheckPending = null;
function showSelfCheck(res) {
  if (!res || !res.items || !res.items.length || res.at === selfCheckShown) return;
  if (document.documentElement.classList.contains("booting")) { selfCheckPending = res; return; }
  selfCheckPending = null;
  selfCheckShown = res.at;
  const bad = res.items.filter((i) => !i.ok && !i.warn).length;
  const warn = res.items.filter((i) => i.warn).length;
  const mark = (i) => (i.warn ? "!" : i.ok ? "✓" : "✕");
  const cls = (i) => (i.warn ? "warn" : i.ok ? "ok" : "bad");
  const box = $("selfcheck");
  put(box,
    el("div", { class: "sc-head" }, svg(ICONS.link), "Self-check",
      el("span", { class: "sc-all " + (bad ? "bad" : warn ? "warn" : "ok") },
        bad ? `${bad} problem${bad > 1 ? "s" : ""}` : warn ? "ready, with notes" : "all ready")),
    el("ul", {}, ...res.items.map((i) => el("li", { class: cls(i) },
      el("span", { class: "mark" }, mark(i)),
      el("span", { class: "name" }, i.label),
      el("span", { class: "note" }, i.note || "")))),
    bad + warn > 0 && el("div", { class: "sc-hint", onclick: dismissSelfCheck }, "click to dismiss"));
  box.hidden = false;
  box.classList.remove("leaving");
  box.onclick = dismissSelfCheck;
  clearTimeout(selfCheckTimer);
  if (!bad && !warn) selfCheckTimer = setTimeout(dismissSelfCheck, 4200);   // good news does not linger
}
function dismissSelfCheck() {
  const box = $("selfcheck");
  if (box.hidden) return;
  clearTimeout(selfCheckTimer);
  box.classList.add("leaving");
  setTimeout(() => { box.hidden = true; box.classList.remove("leaving"); }, 300);
}

// A removal needs a second click within four seconds instead of a browser dialog.
function twoStep(button, warning, action) {
  const disarm = () => {
    clearTimeout(button.armTimer);
    delete button.dataset.armed;
    button.innerHTML = button.dataset.label;
    button.classList.remove("confirm");
  };
  if (button.dataset.armed) {
    disarm();
    return action();
  }
  button.dataset.armed = "1";
  button.dataset.label = button.innerHTML;
  button.textContent = warning;
  button.classList.add("confirm");
  button.armTimer = setTimeout(disarm, 4000);
}

const pad = (n) => String(n).padStart(2, "0");
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;   // "1 candidate", "2 candidates"
// 3:22 for labels, 3:22.5 for fields, 0:03:22 for the tape counter.
const clock = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}` : Math.floor(s / 60)) + ":" + pad(Math.floor(s) % 60);
function tc(s) {
  const tenths = Math.round(s * 10);
  return `${clock(Math.floor(tenths / 10))}.${tenths % 10}`;
}
const counter = (s) => `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}`;
const span = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

// "3:22", "3:22.5", "1:02:03" or plain seconds. NaN if it is none of those.
function parseTime(text) {
  const parts = String(text).trim().split(":");
  if (!String(text).trim() || parts.some((p) => p === "" || Number.isNaN(Number(p)))) return NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const edlNow = () => state.draft || (state.detail && state.detail.edl);
const reelsNow = () => (edlNow() ? edlNow().reels : []);
const zoomOf = (edl, reel) => (reel.style && reel.style.zoom) ?? (edl.style && edl.style.zoom) ?? 1;
const platformsOf = (reel) => (reel.platforms ? Object.keys(reel.platforms) : reel.post_caption != null ? [] : PLATFORMS);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

function sourceTitle(s, long = false) {
  if (s.name) return s.name;   // an uploaded video is called what its file is called
  if (s.started) {
    const d = new Date(s.started.replace(" ", "T"));
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return long ? `Recording of ${d.getDate()} ${d.toLocaleString("en", { month: "long" })}, ${time}`
                : `${d.getDate()} ${d.toLocaleString("en", { month: "short" })} ${d.getFullYear()} · ${time}`;   // in a list of tapes the date and time are the name
  }
  const name = s.file.replace(/^SRC-\d+_/, "").replace(/\.[^.]+$/, "").replace(/_/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------- editing the reels in the page

// Every change to a reel goes through here: the draft is the single source of what the form shows.
function edit(change) {
  if (!state.detail || !state.detail.edl) return;
  if (!state.draft) state.draft = structuredClone(state.detail.edl);
  change(state.draft);
  if (same(state.draft, state.detail.edl)) state.draft = null;
  markDirty();
}

function markDirty() {
  document.body.classList.toggle("dirty", !!state.draft);
  renderDialogue();
}

// A reel made from a candidate starts with a placeholder file name; name it after its title until it is rendered.
function prepared(edl) {
  const out = structuredClone(edl);
  for (const reel of out.reels) {
    if (!state.detail.finals[reel.id] && /^moment_\d+$/.test(reel.slug) && slugify(reel.title || "")) reel.slug = slugify(reel.title);
  }
  return out;
}

function rebase(version) {
  state.base = version;
  state.force = false;
  $("banner").hidden = true;
}

async function putEdl(edl) {
  try {
    const res = await api(`/api/sources/${state.id}/reels`, "PUT", { edl, base: state.base, force: state.force });
    state.detail.edl = edl;
    state.detail.version = res.version;
    state.draft = null;
    rebase(res.version);
    markDirty();
    return res;
  } catch (e) {
    if (e.conflict) $("banner").hidden = false;
    throw e;
  }
}

async function saveAnd(then) {
  try {
    const { posts } = await putEdl(prepared(edlNow()));
    if (then) return await then();
    await refreshSources();
    toast(posts.length ? `Saved. Post file rewritten for ${posts.join(", ")}` : "Saved");
  } catch (e) {
    toast(e.message, true);
  }
}

// reels.json can be rewritten while the page is open, for example by Claude Code. Without unsaved
// edits the page just reloads it; with them the user chooses which version wins.
async function checkVersion() {
  if (!state.id || !state.detail || state.force) return;
  const { version } = await api(`/api/sources/${state.id}/version`);
  if (version === state.base) return;
  if (state.draft) return void ($("banner").hidden = false);
  await refreshSources();
  toast("The reels were changed outside this page; reloaded");
}

// ---------------------------------------------------------------- HUD

function slot(icon, label, mode) {
  return el("div", { class: `slot ${mode}`, title: label }, el("div", { class: "frame" }, svg(ICONS[icon])), el("span", { class: "label" }, label));
}

function renderHud() {
  const { job, auto } = state.status;
  const sh = state.shell || {};
  const recording = !!sh.recording;

  const sig = JSON.stringify([!!sh.open, recording]);
  if (sig !== state.sig.slots) {
    state.sig.slots = sig;
    put($("slots"), slot("screen", sh.open ? "VIDEO" : "NO VIDEO", sh.open ? "on" : ""), slot("rec", recording ? "REC" : "IDLE", recording ? "on red" : ""));
  }

  const info = jobInfo(job);
  const d = state.detail;
  const mid = JSON.stringify(job.running ? [info.title, info.right, info.pct] : [d && d.id, d && d.candidates.length, reelsNow().length, d && Object.keys(d.finals).length]);
  if (mid !== state.sig.mid) {
    state.sig.mid = mid;
    put($("hud-mid"), ...(job.running
      ? [el("div", { class: "hud-job" }, el("div", { class: "head" }, el("span", {}, info.title.toUpperCase()), el("b", {}, info.right)),
          el("div", { class: "meter" + (info.pct == null ? " busy" : "") }, el("i", { style: `width:${info.pct ?? 35}%` })))]
      : d ? [["candidates", d.candidates.length], ["reels", reelsNow().length], ["finals", Object.keys(d.finals).length]].map(([icon, n]) =>
          el("div", { class: "counter", title: icon[0].toUpperCase() + icon.slice(1) }, svg(ICONS[icon]), String(n))) : []));
  }

  tickRecording();
  $("btn-file").disabled = job.running;
  $("auto").checked = auto;
}

// The length of the running recording, counted from the moment it started. When the page tells how
// long its video is, that comes after it, as on a player: 3:22 / 10:23.
function tickRecording() {
  const sh = state.shell || {};
  const taping = sh.recording;
  const seconds = taping ? Math.max(0, (Date.now() - taping.since) / 1000) : 0;
  const text = sh.length ? `${clock(seconds)} / ${clock(sh.length)}` : counter(seconds);
  if ($("studio-time")) $("studio-time").textContent = text;
  tickPills();
}

// Paste a link, one click: the page opens in the Studio. Recording stays a click of its own.
async function openLink(event) {
  event.preventDefault();
  // The Studio has a Kick field and a Twitch field: Run takes the one being typed in, or the one that is filled.
  const streaming = state.studio && state.kind === "stream";
  const fields = streaming ? [$("open-url"), $("open-twitch")] : [$("open-url")];
  const field = fields.find((f) => f === document.activeElement && f.value.trim()) || fields.find((f) => f.id === state.linkField && f.value.trim())
    || fields.find((f) => f.value.trim()) || fields[0];
  let url = field.value.trim();
  // In those two a channel's name is enough: "xqc" is kick.com/xqc in one and twitch.tv/xqc in the other.
  if (streaming && /^[a-z0-9_-]{2,40}$/i.test(url)) url = `${field.id === "open-twitch" ? "twitch.tv" : "kick.com"}/${url}`;
  if (!shell) return toast("Videos open and record in Link's own window. Start Link from its Desktop icon.", true);
  if (!/^(https?:\/\/)?[^\s/:]+\.\S+$/i.test(url)) {
    field.classList.add("bad");
    return toast(streaming ? "Paste a channel's link, for example kick.com/channel or twitch.tv/channel" : "Paste the full link of the video, for example https://www.youtube.com/watch?v=…", true);
  }
  const res = await shell.open(url, state.studio && state.kind === "stream" ? "stream" : "video");
  if (!res.ok) return toast(res.error, true);
  if (res.kind === "stream") field.value = "";   // the stream runs; the bar is clean for the next one's link
  showStudio(true, res.kind);
}

// The other way in: a video file the user already has. It becomes a tape the way a recording does.
async function uploadVideo() {
  if (!shell) return toast("Uploading a video works in Link's own window. Start Link from its Desktop icon.", true);
  const file = await shell.pick();
  if (file) startJob({ kind: "ingest", files: [file] });
}

// The recordings in the Videos folder that are not tapes yet. The folder can hold ones the user never
// meant to make tapes of (a call, an old test), so with more than one they choose; the newest is ticked.
async function processRecordings() {
  let list;
  try {
    list = await api("/api/recordings");
  } catch (e) {
    return toast(e.message, true);
  }
  if (!list.length) return toast("Every recording in your Videos folder is a tape already");
  if (list.length === 1) return startJob({ kind: "ingest", files: [list[0].file], recording: true });
  const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
  const when = (name) => {
    const [, y, mo, d, h, mi] = name.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})/) || [];
    return y ? `${+d} ${new Date(y, mo - 1).toLocaleString("en", { month: "short" })} ${y} · ${h}:${mi}` : name;
  };
  put($("rec-list"), list.map((r, i) =>
    el("label", { class: "check rec-pick" }, el("input", { type: "checkbox", checked: i === 0, value: r.file }),
      el("span", {}, when(r.name)), el("span", { class: "dim" }, mb(r.size)))));
  $("rec-dialog").showModal();
  placePlayer();
}

function processTicked(event) {
  event.preventDefault();
  const files = [...$("rec-list").querySelectorAll("input:checked")].map((box) => box.value);
  if (!files.length) return toast("Tick at least one recording", true);
  $("rec-dialog").close();
  startJob({ kind: "ingest", files, recording: true });
}

// ---------------------------------------------------------------- studio

// The player screen: the Studio for live streams, URL for one video. The window puts on screen the
// channel that side showed last.
function showStudio(on, kind = state.kind) {
  state.studio = on;
  state.kind = kind;
  if (on && shell && shell.view) shell.view(kind);
  renderPills();
  state.analytics = state.library = false;
  state.settings = null;
  state.pickerOpen = false;
  renderAll();
}

// The window reports every change of the browser panel and the recorder.
function onShell(next) {
  const before = state.shell;
  state.shell = next;
  if (!before) {   // Link (or the page) just opened: the Studio first
    state.studio = true;
    state.kind = "stream";
    state.analytics = false;
    if (shell.view) shell.view("stream");
  }
  // Every recording saved since the page loaded, each once, even when several streams stop close together.
  for (const s of [...(next.saved || [])].reverse()) {
    if (state.savedSeen.has(s.at)) continue;
    state.savedSeen.add(s.at);
    if (before) recordingSaved(s);
  }
  renderPills();
  renderMonitors();
  $("btn-studio").hidden = !next.open;
  $("btn-studio").textContent = next.kind === "video" ? "URL" : "Studio";
  $("btn-audio").classList.toggle("on", !!next.audioOpen);
  if (mixer) mixer.update(next.audio);
  // the Discord widget: lit while open, a dot when the crew sent a link it has not shown yet
  const dsc = next.discord || {};
  $("btn-discord").classList.toggle("on", !!dsc.open);
  $("btn-discord").querySelector(".dot-new").hidden = !(dsc.unseen > 0);
  renderSources();
  if (state.studio || state.settings) renderMain();
  if (state.status) renderHud();
}

function recordingSaved(last) {
  if (last.error) return toast(last.error, true);
  // A recording that Link found again after a cut-off, or saved as it closed, is kept without asking: nobody chose to stop it.
  if (last.recovered || last.closing) return keepRecording(last, "");
  keepQueue.push(last);
  askKeep();
}

// The recording is kept (it is on the disk already): say so, and process it when Auto-process is on.
// This recording only: others in the Videos folder are the user's to choose (Process recording).
// Link processes one at a time, so a recording saved while another is processed waits its turn.
function keepRecording(last, name) {
  if (last.seconds < 30) return toast(`Saved${name ? ` as "${name}"` : ""}, but shorter than 30 seconds, so it is not processed`);
  toast(last.recovered ? `Recovered a recording that was cut off: ${last.name}` : `Recording saved: ${name || last.name}`);
  if (state.status && state.status.auto) {
    state.ingestQueue.push(last.file);
    nextIngest();
  }
}

// When a recording stops Link asks at once: keep it, and under which name? The file is saved
// already, so nothing is lost while the question is open; Save keeps it (and it is processed),
// Discard puts it in the Recycle Bin. Several recordings that stop together are asked about one
// after another. A question nobody answers for two minutes counts as Save, so that a recording
// made while the user is away is still processed. Esc is Save too: a recording is never thrown
// away by accident.
const keepQueue = [];
let keepOpen = null;
function askKeep() {
  if (keepOpen || !keepQueue.length) return;
  const last = keepOpen = keepQueue.shift();
  const [, y, mo, dd, h, mi] = last.name.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})/) || [];
  const when = y ? `${+dd} ${new Date(y, mo - 1).toLocaleString("en", { month: "short" })}, ${h}:${mi}` : "";
  const name = el("input", { type: "text", maxLength: 80, spellcheck: false, value: last.what ? `${last.what}${when ? ` · ${when}` : ""}` : "",
    placeholder: when ? `Recording of ${when}` : "Name this recording" });
  const drop = el("button", { class: "btn ghost", type: "button" }, "Discard");
  // What kind of video it is: Link finds its moments by it. "Link decides" goes by the stream's category
  // or a kill feed it knows; the choice made last time is offered again.
  const kind = el("select", { title: "Link finds the moments by what kind of video this is. It can be changed later, under the tape's name." },
    el("option", { value: "auto" }, "Link decides"), CONTENTS.map((k) => el("option", { value: k.key }, k.label)));
  try { kind.value = localStorage.getItem("link-kind") || "auto"; } catch { /* then Link decides */ }
  if (!kind.value) kind.value = "auto";
  const trouble = el("p", { class: "help warn", hidden: true });
  const box = $("keep-dialog");
  let answered = false;
  const done = async (how) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    try {
      if (how === "discard") {
        await api("/api/recordings", "POST", { action: "discard", file: last.file });
        toast("Recording thrown away. It is in the Recycle Bin.");
      } else {
        const called = name.value.trim();
        if (called) await api("/api/recordings", "POST", { action: "name", file: last.file, name: called });
        const k = CONTENTS.find((x) => x.key === kind.value);
        try { localStorage.setItem("link-kind", kind.value); } catch { /* not kept for next time */ }
        await api("/api/recordings", "POST", { action: "content", file: last.file, content: k ? k.content : "auto", game: k && k.game ? k.game : null }).catch(() => {});
        keepRecording(last, called);
      }
    } catch (e) {   // it could not be thrown away (it is a tape already, say): it is kept, and the user is told why
      if (how !== "discard") keepRecording(last, "");
      toast(e.message, true);
    }
    keepOpen = null;
    if (box.open) box.close();
    refreshSources().catch(() => {});
    askKeep();
  };
  drop.onclick = () => twoStep(drop, "Click again to throw this recording away", () => done("discard"));
  put($("keep-form"),
    el("h2", {}, "Keep this recording?"),
    el("p", { class: "help" }, `${last.what || "The recording"} · ${Math.floor(last.seconds / 60)}:${String(Math.round(last.seconds % 60)).padStart(2, "0")}${last.marks ? ` · ★ ${last.marks} marked` : ""}${keepQueue.length ? ` · ${keepQueue.length} more to answer` : ""}`
      + (last.seconds < 30 ? ". Shorter than 30 seconds: it is kept, but not made into a tape." : ". It is saved already; Save keeps it" + (state.status && state.status.auto ? " and Link makes it a tape." : "."))),
    el("label", { class: "field" }, el("span", {}, "Name"), name),
    el("label", { class: "field" }, el("span", {}, "Kind"), kind), trouble,
    el("div", { class: "row" }, el("button", { class: "btn primary", type: "submit" }, "Save"), drop));
  $("keep-form").onsubmit = (event) => { event.preventDefault(); done("save"); };
  // Esc. Not the dialog's "close": that arrives a moment after the answer to the recording before,
  // when this question is already up, and would answer this one unasked.
  box.oncancel = (event) => { event.preventDefault(); done("save"); };
  const timer = setTimeout(() => done("save"), 120000);
  box.showModal();
  placePlayer();
  name.select();
}

function nextIngest() {
  if (state.status && state.status.job.running) return;
  if (state.ingestQueue.length) return startJob({ kind: "ingest", files: [state.ingestQueue.shift()], recording: true });
  // a render that was cut off waits for the videos that were (see resumeUnfinished)
  const render = state.cutRender;
  state.cutRender = null;
  if (render) startJob({ kind: "render", source: render.source, only: render.only });
}

// What was cut off because Link was closed while it worked (as it is when the window is closed on a
// recording), and found by the server when it started: videos half processed, a render half done.
// Link finishes those when it opens, and says so. A video that failed again and again is only named.
async function resumeUnfinished() {
  const cut = await api("/api/unfinished").catch(() => null);   // what is not finished now stays for Process recording or an upload
  if (!cut) return;
  const files = cut.videos || [], said = [];
  if (files.length) said.push(`Finishing ${files.length === 1 ? files[0].split(/[\\/]/).pop() : many(files.length, "video")}: Link was closed before ${files.length === 1 ? "it was" : "they were"} processed`);
  if (cut.render) said.push(`Finishing the render of ${many(cut.render.only.length, "reel")} of ${cut.render.source}: Link was closed before it was done`);
  if ((cut.stuck || []).length) said.push(`${cut.stuck.map((t) => t.name).join(", ")} could not be processed, and Link will not try again by itself. Upload the file to try once more; the reason is in the log (Settings > About).`);
  if (!said.length) return;
  toast(said.join(" · "), !files.length && !cut.render);
  state.ingestQueue.push(...files);
  state.cutRender = cut.render;
  nextIngest();
}

// ---------------------------------------------------------------- channels: streams recorded side by side

// A stream that records and is not on the screen becomes a pill in the strip under the top bar, on every
// screen: its name, how long it has recorded, its marks, and buttons to show it, mark it or stop
// it. A Kick stream's pill glows green and a Twitch stream's purple. Only the stream on screen plays
// to the speakers; each recording takes its own stream's sound only.
// The rule: whatever records can be seen, wherever the user is. On the big screen it is seen
// there; in the Studio the minimised streams are on its monitors; everything else gets a pill,
// also the stream that is on the Studio's big screen while the user is on another screen.
function renderPills() {
  const box = $("pills");
  const studio = state.studio && state.kind === "stream";
  const seen = (c) => (c.current && state.studio && (c.kind || "stream") === state.kind) || (studio && (c.kind || "stream") === "stream");
  // One that does not record gets a pill only while minimised on the side being looked at: the
  // sidebar already says that the other side's page is open.
  const list = ((state.shell || {}).channels || []).filter((c) => !seen(c)
    && (c.recording || c.starting || c.saving || (!c.current && (c.kind || "stream") === state.kind)));
  // In the Studio and URL the strip opens and shuts at once: the video panel lies over the page and
  // would be out of place for as long as a slide lasts.
  box.classList.toggle("snap", !!state.studio);
  box.hidden = !list.length;
  const site = (c) => (c.chat ? (c.chat.site === "twitch" ? "twitch" : "kick") : "");
  const sig = JSON.stringify(list.map((c) => [c.id, c.name, !!c.recording, c.recording && c.recording.marks, c.saving, c.starting, site(c)]));
  if (sig === state.sig.pills) return tickPills();
  state.sig.pills = sig;
  put(box, list.map((c) => el("div", { class: "pill" + (c.recording ? " rec" : "") + (c.saving ? " saving" : "") + (site(c) ? ` ${site(c)}` : ""), "data-id": c.id,
      title: c.recording ? "Recording. Click to put it on screen." : "Click to put it back on screen.",
      onclick: () => { shell.show(c.id); showStudio(true, c.kind); } },
    el("i", { class: "dot" }),
    el("span", { class: "name" }, c.name),
    el("span", { class: "time" }, ""),
    c.recording && c.recording.marks ? el("span", { class: "marks" }, `★${c.recording.marks}`) : null,
    c.recording && el("button", { class: "mini", title: "Mark this moment of it as a highlight",
      onclick: (e) => { e.stopPropagation(); shell.mark(c.id); } }, "★"),
    c.recording && el("button", { class: "mini stop", title: "Stop and save this recording",
      onclick: async (e) => { e.stopPropagation(); const r = await shell.stopChannel(c.id); if (r && !r.ok) toast(r.error, true); } }, "■"),
    !c.recording && !c.saving && el("button", { class: "mini", title: "Close this stream",
      onclick: (e) => { e.stopPropagation(); shell.closeChannel(c.id); } }, "×"),
    c.saving && el("span", { class: "time" }, "SAVING"))));
  tickPills();
}

// ---------------------------------------------------------------- monitors: the Studio's minimised streams

// In the Studio a minimised stream waits on a small monitor in a column beside the big screen: its
// live picture (captured the way the recorder captures it, picture only) under a fighting-game
// health bar, Tekken 3 style (see tickMonitors). One monitor per stream, up to three; the column
// shows once a stream is minimised. It takes the room the big screen leaves at its sides, so in a
// wide window the big screen (and what it records) keeps its size. Clicking a monitor puts its
// stream on the big screen; a free one empties the big screen for another link.
const monitorsBox = el("div", { class: "monitors", id: "monitors", hidden: true });
const previews = new Map();   // channel id -> promise of its live picture
let previewQueue = Promise.resolve();   // one capture request at a time: each is matched to its channel
const fightAt = new Map();    // when each monitor's bar first filled in, so a redraw does not play it again
const peakChat = new Map();   // channel id -> the busiest its chat has been: the bar's full length

function previewOf(id) {
  if (!previews.has(id)) {
    const p = previewQueue = previewQueue.catch(() => {}).then(async () => {
      if (!(await shell.preview(id))) throw new Error("The stream is gone.");
      return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 24 } }, audio: false });
    });
    p.then((stream) => stream.getVideoTracks()[0].addEventListener("ended", () => { if (previews.get(id) === p) previews.delete(id); }),
      () => { if (previews.get(id) === p) previews.delete(id); });
    previews.set(id, p);
  }
  return previews.get(id);
}

// Stops the live pictures nobody looks at (the stream went to the big screen, closed, or the Studio is not shown).
function dropPreviews(keep = new Set()) {
  for (const [id, p] of previews) {
    if (keep.has(id)) continue;
    previews.delete(id);
    p.then((stream) => stream.getTracks().forEach((t) => t.stop()), () => {});
  }
}

function renderMonitors() {
  const s = state.shell || {};
  const list = (s.channels || []).filter((c) => c.kind !== "video");
  const show = !!shell && state.studio && state.kind === "stream" && list.some((c) => !c.current);
  dropPreviews(new Set(show ? list.filter((c) => !c.current && c.open).map((c) => c.id) : []));
  monitorsBox.hidden = !show;
  if (!show) return;
  // Each stream keeps its place (CH-1, CH-2, CH-3) while it is open, even when one before it closes;
  // Link's window gives it, and the mixer shows the same number.
  const slots = Array.from({ length: s.maxChannels || 3 }, (_, i) => list.find((c) => c.slot === i) || null);
  const sig = JSON.stringify(slots.map((c) => c && [c.id, c.current, c.name, !!c.recording, c.saving, c.starting, !!c.chat]));
  if (sig !== state.sig.monitors || !monitorsBox.childElementCount) {
    state.sig.monitors = sig;
    put(monitorsBox, slots.map((c, i) => monitor(c, i)));
  }
  tickMonitors();
}

function monitor(c, i) {
  const ch = `CH-${i + 1}`;
  if (!c) return el("div", { class: "monitor free", title: "Empties the big screen for another stream's link", onclick: freeMonitor },
    el("div", { class: "free-text" }, el("b", {}, `${ch} // FREE`), el("span", {}, "+ NEW STREAM")));
  const key = `${c.id}:${c.recording ? 1 : 0}`;   // the bar fills in again, as at the start of a round, when a recording starts
  const fresh = !fightAt.has(key);
  if (fresh) fightAt.set(key, performance.now());
  const video = el("video", { muted: true, autoplay: true, playsInline: true });
  if (!c.current && c.open) previewOf(c.id).then((stream) => {
    if (!video.isConnected && !monitorsBox.contains(video)) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, () => {});
  const stop = (e) => e.stopPropagation();
  return el("div", { class: "monitor" + (c.recording ? " rec" : "") + (c.current ? " main" : ""), "data-id": c.id, "data-ch": ch, "data-key": key,
      title: c.current ? "On the big screen" : "Put it on the big screen",
      onclick: () => { if (!c.current) shell.show(c.id); } },
    el("div", { class: "pic" }, c.current ? null : video,   // the one on the big screen: its readout says ON MAIN
      !c.current && el("div", { class: "keys" },
        c.recording && el("button", { title: "Mark this moment of it as a highlight", onclick: (e) => { stop(e); shell.mark(c.id); } }, "★"),
        c.recording && el("button", { title: "Stop and save this recording", onclick: async (e) => { stop(e); const r = await shell.stopChannel(c.id); if (r && !r.ok) toast(r.error, true); } }, "■"),
        !c.recording && !c.saving && el("button", { title: "Close this stream", onclick: (e) => { stop(e); shell.closeChannel(c.id); } }, "✕"))),
    el("div", { class: "fight" + (fresh && !calm.matches ? " intro" : "") },
      el("div", { class: "top" }, el("b", { class: "stage" }, ch), el("span", { class: "rec-tag" }), el("b", { class: "time" })),
      el("div", { class: "life" }, el("i", { class: "trail" }), el("i", { class: "fill" })),
      el("div", { class: "bottom" }, el("b", { class: "name" }, c.name.toUpperCase()), el("span", { class: "rounds" }))));
}

async function freeMonitor() {
  const s = state.shell || {};
  if (s.open && s.kind !== "video") {
    const r = await shell.minimise();
    if (r && !r.ok) return toast(r.error, true);
  }
  for (const f of [$("open-url"), $("open-twitch")]) {
    f.value = "";
    f.classList.remove("bad");
  }
  $("open-url").focus();
  toast("Paste the next stream's link above");
}

// The health bars, as in Tekken 3. A Kick or Twitch stream's bar is its chat: full at the busiest it has been,
// so it shows how lively the stream is now. Another stream's bar is the page's volume. When it drops,
// the lost part stays red a moment and then drains away, as a hit does. Above it, the channel in
// green and the recording's time in yellow (minutes'seconds"hundredths); under it, the stream's name
// in red and a round light for each highlight marked.
const calm = matchMedia("(prefers-reduced-motion: reduce)");   // then the bars just are where they are
const two = (n) => String(Math.floor(n)).padStart(2, "0");
const fightClock = (s) => `${two(s / 60)}'${two(s % 60)}"${two((s * 100) % 100)}`;

function tickMonitors() {
  if (monitorsBox.hidden) return;
  const chans = new Map(((state.shell || {}).channels || []).map((c) => [String(c.id), c]));
  const say = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  for (const mon of monitorsBox.querySelectorAll(".monitor[data-id]")) {
    const c = chans.get(mon.dataset.id);
    if (!c) continue;
    const r = c.recording;
    let level, about;
    if (c.chat) {
      const now = c.chat.ok ? c.chat.perMin : 0;
      const peak = Math.max(peakChat.get(c.id) || 30, now);
      peakChat.set(c.id, peak);
      level = now / peak;
      about = `Chat: ${now} messages a minute (a full bar is ${peak}, the busiest so far)`;
    } else {
      level = c.volume == null ? 1 : c.volume;
      about = c.volume == null ? "No video playing yet" : `The page's volume: ${Math.round(c.volume * 100)}%`;
    }
    const width = `${(Math.max(0, Math.min(1, level)) * 100).toFixed(1)}%`;
    for (const bar of mon.querySelectorAll(".life i")) if (bar.style.width !== width) bar.style.width = width;
    const life = mon.querySelector(".life");
    if (life.title !== about) life.title = about;
    say(mon.querySelector(".time"), r ? fightClock(Math.max(0, (Date.now() - r.since) / 1000)) : c.saving ? "SAVING" : c.current ? "ON MAIN" : "READY");
    say(mon.querySelector(".rec-tag"), r ? "● REC" : "");
    // the round lights: two, more as highlights are marked (up to five, then a count)
    const marks = r ? r.marks : 0;
    const rounds = mon.querySelector(".rounds");
    if (rounds.dataset.n !== String(marks)) {
      rounds.dataset.n = String(marks);
      rounds.title = marks ? `${many(marks, "highlight")} marked` : "Highlights marked light up here";
      const lights = Math.max(2, Math.min(5, marks));
      put(rounds, Array.from({ length: lights }, (_, i) => el("i", { class: i < marks ? "on" : "" })),
        marks > 5 ? el("b", {}, `+${marks - 5}`) : null);
    }
  }
}

function tickPills() {
  for (const c of (state.shell || {}).channels || []) {   // every pill there is; the stream on the Studio's big screen has one too, away from the Studio
    const t = document.querySelector(`#pills .pill[data-id="${c.id}"] .time`);
    if (t && c.recording) t.textContent = counter(Math.max(0, (Date.now() - c.recording.since) / 1000));
  }
}

// What would spoil a recording made now, or null. Record warns once; a second press records anyway.
function recordingSnag(s) {
  if (s.fills === false) return "The video does not fill the panel yet, so the page around it would be recorded too. Press F in the player first.";
  if (s.subtitles) return "The video's own subtitles are on and would be recorded. Press C in the player to turn them off.";
  return null;
}

async function toggleRecording() {
  const s = state.shell || {};
  if (!s.recording && recordingSnag(s) && !(state.recordAnyway > Date.now())) {
    state.recordAnyway = Date.now() + 6000;
    return toast(`${recordingSnag(s)} Or press Record again to record as it is.`, true);
  }
  state.recordAnyway = 0;
  const res = s.recording ? await shell.stop() : await shell.record();
  if (res && !res.ok) toast(res.error, true);
}

async function markMoment() {
  const res = await shell.mark();
  toast(res.ok ? `Highlight ${res.marks} marked` : res.error, !res.ok);
}

function renderStudio() {
  const s = state.shell || {};
  const taping = s.recording;
  const nav = (label, action, enabled, title) => el("button", { class: "btn small", title, disabled: !enabled, onclick: () => shell.nav(action) }, label);
  // The recording is exactly as loud as the page plays, so a turned-down player comes first.
  const quiet = s.open && s.volume != null && s.volume < 0.5 && !s.saving;
  const snag = s.open && !s.saving && recordingSnag(s);
  const size = s.size ? `${s.size.width}×${s.size.height}` : "";
  const url = state.kind === "video";
  // room for another stream beside this one (see renderPills); URL's video does not count
  const room = !url && (s.channels || []).filter((c) => c.kind !== "video").length < (s.maxChannels || 1);
  // A Kick or Twitch channel: its bare player already fills the panel, and its chat speed is counted (see main.js).
  const site = s.chat && s.chat.site === "twitch" ? "Twitch" : "Kick";
  const kick = s.open && s.chat;
  // Twitch's player says what it is doing (s.stage, see TWITCH_TIDY in main.js); with Kick, no picture and nothing
  // playing after a while means offline. (A stream opened while Link is minimised plays, but its picture has no size yet.)
  // With a Kick app connected (Settings > Accounts) Kick's own API says it instead (s.stage, see kickSays in main.js).
  const sure = site === "Twitch" || !!s.stage;
  const offline = kick && (sure ? s.stage === "offline" : s.fills === null && s.volume === null && Date.now() - s.chat.since > 10000);
  const ad = kick && s.stage === "ad";
  const starting = kick && s.stage === "starting" && !taping;
  const hint = !s.open ? ""   // an empty bar says nothing, in the Studio and in URL: the link fields are right above it
    : s.saving ? "Saving the recording…"
    : offline ? `⚠ No stream is playing: ${s.chat.channel} ${sure ? "is" : "seems to be"} offline.`
    : ad ? (taping ? "⚠ Twitch is playing an ad, and it is in the recording. No candidates are taken from it."
      : "⚠ Twitch is playing an ad. Wait until it ends, then press Record: Twitch puts its ads into the stream itself, so they cannot be blocked.")
    : starting ? "Twitch is starting the stream…"
    : quiet ? `⚠ The video's own volume is ${s.volume ? `at ${Math.round(s.volume * 100)}%: the recording will be quiet` : "muted: the recording will have no sound"}.`
    : snag ? `⚠ ${snag}`
    : taping ? `Recording ${taping.width}×${taping.height}.${s.muted ? " The sound is off for you, but it is recorded." : ""} Keep the mouse off the video, or its controls are recorded.${room ? " Paste another link to record a second stream; this one keeps going on a monitor above." : ""}`
    : s.muted ? `The sound is off for you. A recording still gets it. It records at ${size}.`
    : kick ? `${site} stream: it fills the panel already. Press Record; the chat's speed is noted with it. It records at ${size}.`
    : `Fill the screen with the video's own full-screen button (F on YouTube), then press Record. It records at ${size}; a bigger Link window records sharper.`;
  const warn = quiet || !!snag || offline || ad;
  const ads = s.ads || {};
  const chatNow = kick ? (s.chat.ok ? `CHAT ${s.chat.perMin}/MIN` : "CHAT …") : "";
  const sig = JSON.stringify([url, s.open, s.title || s.url, s.loading, s.canGoBack, s.canGoForward, taping && [taping.marks, taping.width], s.busy, s.saving, hint, ads, s.muted, chatNow, room]);
  if (sig !== state.sig.studio || !$("player-slot")) {
    state.sig.studio = sig;
    // The link fields sit in the heading, between the name and the buttons. Drawing the screen again
    // moves them into the new heading; whoever is typing in one keeps their place in it.
    const bar = linkBar, typing = bar.contains(document.activeElement) ? document.activeElement : null;
    const caret = typing && typing.setSelectionRange ? [typing.selectionStart, typing.selectionEnd] : null;
    drawMain(
      el("div", { class: "head-row" },
        el("div", { class: "studio-name" }, el("h1", { class: url ? "" : "studio-red" }, url ? "URL" : "Studio"), el("div", { class: "sub clip" }, s.open ? s.title || s.url : "NO VIDEO OPEN")),
        bar,
        el("div", { class: "row" },
          // Ads would be recorded with the video. Off is for a site that refuses to play with a blocker.
          el("label", { class: "check" + (ads.error ? " warn" : ""), title: ads.error || "Keeps ads out of the video and the recording. Changing it reloads the page." },
            el("input", { type: "checkbox", checked: !!ads.on, onchange: (e) => shell.ads(e.target.checked) }), ads.error ? "Block ads (not loaded)" : "Block ads"),
          nav("◀", "back", s.canGoBack, "Back"), nav("▶", "forward", s.canGoForward, "Forward"),
          nav(s.loading ? "…" : "⟳", "reload", s.open, "Reload the page"),
          s.open && !url && el("button", { class: "btn small", title: "Puts it on a small monitor above (it keeps playing, and recording if it is) and empties the big screen for another stream",
            onclick: async () => { const r = await shell.minimise(); if (r && !r.ok) toast(r.error, true); } }, "⤓ Minimise"),
          el("button", { class: "btn small ghost", disabled: !s.open || !!taping || s.busy, onclick: () => shell.close() }, "Close video"))),
      el("div", { class: "studio-stage", id: "studio-stage" },
        el("div", { class: "tv" + (taping ? " taping" : ""), id: "studio-tv" },
          el("div", { class: "player-slot", id: "player-slot" }, s.open ? null : el("div", { class: "empty" }, "NO TAPE"))),
        url ? null : monitorsBox),
      el("div", { class: "studio-bar" },
        el("button", { class: "btn big rec" + (taping ? " on" : ""), disabled: !s.open || s.busy, onclick: toggleRecording },
          el("span", { class: "glyph" }, taping ? "■" : "●"), taping ? "Stop recording" : "Record"),
        el("span", { class: "tape big" + (taping ? " rec-time" : ""), id: "studio-time", title: "Length of this recording / length of the video" }, "0:00:00"),
        el("button", { class: "btn big", disabled: !taping, onclick: markMoment, title: "Marks this moment; it becomes a candidate when the recording is processed" },
          taping && taping.marks ? `★ Mark highlight · ${taping.marks}` : "★ Mark highlight"),
        // Silence for the user only, so they can do other things while a video is captured.
        el("button", { class: "btn big" + (s.muted ? " sound-off" : ""), disabled: !s.open, onclick: () => shell.mute(!s.muted),
                       title: "Switches the video's sound off for you. The recording keeps its sound." }, s.muted ? "🔇 Sound off" : "🔊 Sound on"),
        kick && el("span", { class: "chat-meter" + (site === "Twitch" ? " twitch" : "") + (s.chat.ok ? "" : " waiting"), title: `How many messages ${s.chat.channel}'s chat gets a minute. Only the count is kept with a recording, never what was written.` }, chatNow),
        hint && el("span", { class: "help" + (warn ? " warn" : ""), title: hint }, hint),
        quiet && el("button", { class: "btn small amber", style: "align-self:center", onclick: () => shell.loud() }, "Set it to 100%")));
    if (typing) {
      typing.focus();
      if (caret) typing.setSelectionRange(...caret);
    }
  }
  renderMonitors();
  tickRecording();
  placePlayer();
  renderDialogue();
}

// The browser panel is a layer of the window above the page, not part of it. Keep it exactly over
// its slot (the largest 16:9 that fits the stage), and take it away whenever the page must cover it.
function placePlayer() {
  if (!shell) return;
  const stage = $("studio-stage"), tv = $("studio-tv"), slot = $("player-slot");
  let rect = null;
  if (state.studio && slot) {
    const box = stage.getBoundingClientRect(), frame = tv.offsetWidth - slot.offsetWidth;
    // The monitors' column beside it, when it shows: as wide as the room the big screen leaves free
    // (up to 300 px), and no narrower than 200 px, which the big screen then gives up.
    let side = 0;
    if (stage.contains(monitorsBox) && !monitorsBox.hidden) {
      const spare = box.width - frame - (box.height - frame) * 16 / 9 - 14;
      const column = Math.round(Math.min(300, Math.max(200, spare)));
      monitorsBox.style.width = `${column}px`;
      side = column + 14;
    }
    const width = Math.floor(Math.max(320, Math.min(box.width - frame - side, (box.height - frame) * 16 / 9)));
    slot.style.width = `${width}px`;
    slot.style.height = `${Math.round(width * 9 / 16)}px`;
    monitorsBox.style.height = `${Math.round(width * 9 / 16) + frame}px`;   // as tall as the big screen
    const covered = document.documentElement.classList.contains("booting") || document.querySelector("dialog[open]");
    if (state.shell && state.shell.open && !covered) {
      const r = slot.getBoundingClientRect();
      rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
  }
  const key = JSON.stringify(rect);
  if (key !== state.sig.slot) shell.bounds(rect);
  state.sig.slot = key;
}

// The list of tapes can be folded away; Link always starts with it shown. The tape picker above the
// page takes over while it is hidden.
function setSidebar(hidden) {
  document.body.classList.toggle("side-hidden", hidden);
  $("side-toggle").title = hidden ? "Show the list of tapes" : "Hide the list of tapes";
}

// ---------------------------------------------------------------- Instagram

// The user's Instagram page opens in the Studio like a video does; they stay signed in there.
// `file` is a finished reel about to be posted: its path goes to the clipboard, ready to paste
// into the file window that Instagram's "Create" opens.
async function openInstagram(file) {
  if (!shell) return toast("Instagram opens in Link's own window. Start Link from its Desktop icon.", true);
  if (!state.status.instagram) return askInstagram(file);
  if (((state.shell || {}).channels || []).some((c) => c.kind === "video" && c.recording)) return toast("The video in URL is recording. Stop it first: Instagram would take its place.", true);
  if (file) await shell.copy(file.path);
  const res = await shell.open(`https://www.instagram.com/${state.status.instagram}/`, "video");
  if (!res.ok) return toast(res.error, true);
  showStudio(true, "video");
  toast(file ? "The reel's file path is copied. In Instagram press Create, then paste it in the file window." : `Opened @${state.status.instagram}`);
}

function askInstagram(file) {
  state.instaFile = file || null;
  $("insta-name").value = state.status.instagram ? `@${state.status.instagram}` : "";
  $("insta-name").classList.remove("bad");
  $("insta-dialog").showModal();
  placePlayer();
}

async function saveInstagram(event) {
  event.preventDefault();
  if (!$("insta-name").value.trim()) return $("insta-name").classList.add("bad");
  try {
    state.status.instagram = (await api("/api/settings", "POST", { instagram: $("insta-name").value })).instagram;
  } catch (e) {
    $("insta-name").classList.add("bad");
    return toast(e.message, true);
  }
  $("insta-dialog").close();
  openInstagram(state.instaFile);
}

// One dialog for the short questions: a title, what is asked, and a button that does it. `ok` does
// the work; what it throws is shown in the dialog, which then stays open.
function askBox(title, kids, okLabel, ok) {
  const trouble = el("p", { class: "help warn", hidden: true });
  const go = el("button", { class: "btn primary", type: "submit" }, okLabel);
  const form = $("ask-form");
  put(form, el("h2", {}, title), kids, trouble,
    el("div", { class: "row" }, go, el("button", { class: "btn ghost", type: "button", onclick: () => $("ask-dialog").close() }, "Cancel")));
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (go.disabled) return;
    go.disabled = true;
    trouble.hidden = true;
    try {
      await ok();
      $("ask-dialog").close();
    } catch (e) {
      trouble.textContent = `✕ ${e.message}`;
      trouble.hidden = false;
    }
    go.disabled = false;
  };
  $("ask-dialog").showModal();
  placePlayer();
}

// ---------------------------------------------------------------- posting from Link

// A rendered reel goes up from the Finals tab: to YouTube as a Short, or onto the Instagram page.
// Both go through the server (POST /api/publish), which sends the file it rendered, and both ask
// first, showing exactly what will be posted. When it worked the platform's row is ticked.
async function publish(d, body, where) {
  const made = await api("/api/publish", "POST", { source: d.id, ...body });
  if (state.detail && state.detail.id === d.id) state.detail.ui = made.ui;
  d.ui = made.ui;
  renderMain();
  renderDialogue();
  toast(`Posted on ${where}${made.link ? `: ${made.link}` : ""}`);
  return made;
}

async function uploadToYoutube(d, x, title, text) {
  if (!state.yt) state.yt = await api("/api/youtube").catch(() => null);
  const yt = state.yt;
  if (!yt || !yt.connected) {
    toast("Connect your YouTube channel first");
    return showAnalytics(true, "youtube");
  }
  if (!yt.can_upload) {
    return askBox("Allow uploads to YouTube", el("p", { class: "help" }, "Your sign-in was made for reading the numbers only. Sign in once more: Google's page opens in your browser and now also asks to manage your YouTube videos. Tick that, then press Upload again."),
      "Sign in again", async () => { connectYoutube(); });
  }
  const name = el("input", { type: "text", value: title || x.title || "", maxLength: 100, spellcheck: false });
  const words = el("textarea", { rows: 6, value: text || "" });
  const privacy = el("select", {}, [["private", "Private (only you)"], ["unlisted", "Unlisted (anyone with the link)"], ["public", "Public"]].map(([v, label]) => el("option", { value: v }, label)));
  askBox("Upload to YouTube", [
    el("p", { class: "help" }, `${d.finals[x.id].file} goes up as a Short on ${yt.data && yt.data.account ? yt.data.account.name : "your channel"}.`),
    el("label", { class: "field" }, el("span", {}, "Title"), name),
    el("label", { class: "field" }, el("span", {}, "Description"), words),
    el("label", { class: "field" }, el("span", {}, "Who can see it"), privacy),
    el("p", { class: "help" }, "Google keeps uploads from a project it has not audited private, whatever is chosen here; Link says so if that happens, and you make it public in YouTube Studio. An upload takes 1600 of your project's 10,000 daily units.")],
  "Upload", async () => {
    const made = await publish(d, { platform: "youtube", reel: x.id, title: name.value, text: words.value, privacy: privacy.value }, "YouTube");
    if (made.privacy && made.privacy !== privacy.value) toast(`Uploaded, but YouTube made it ${made.privacy}. Change that in YouTube Studio.`);
  });
}

async function postOnInstagram(d, x) {
  const file = d.finals[x.id];
  if (!state.insta) state.insta = await api("/api/instagram").catch(() => null);
  if (state.insta && state.insta.connected && state.insta.can_publish == null)
    state.insta = await api("/api/instagram", "POST", { action: "check" }).catch(() => state.insta);
  // a key that may not post (or none at all): the reel's path is copied and the page opens, as before
  if (!state.insta || !state.insta.can_publish) return openInstagram(file);
  const platforms = Object.values(x.platforms || {});
  const words = el("textarea", { rows: 7, value: x.post_caption || ((platforms.find((p) => p.description) || {}).description || "").replace(/#shorts\b/gi, "#reels") });   // a reel without a caption of its own starts from its Shorts text
  const page = state.insta.data && state.insta.data.account ? `@${state.insta.data.account.username}` : "your page";
  askBox("Post on Instagram", [
    el("p", { class: "help" }, `${file.file} is posted as a reel on ${page}, for everyone to see, as soon as Instagram has taken it in. That takes up to a minute.`),
    el("label", { class: "field" }, el("span", {}, "Caption"), words),
    el("p", { class: "help" }, "It goes through Instagram's official API with your own access key. To add music or a cover, post it by hand instead: press Cancel, then hold Shift and press Post on Instagram.")],
  "Post now", async () => { await publish(d, { platform: "instagram", reel: x.id, text: words.value }, "Instagram"); });
}

// ---------------------------------------------------------------- Kick

// Kick's official API says whether a channel is live and what its stream is called (tools/reels/kick_api.py).
// It needs an app of the user's own on Kick; its Client ID and secret are pasted here once.
function askKick() {
  const id = el("input", { type: "text", placeholder: "Client ID", autocomplete: "off", spellcheck: false });
  const secret = el("input", { type: "password", placeholder: "Client secret", autocomplete: "off", spellcheck: false });
  askBox("Connect Kick", [
    el("p", { class: "help" }, "On kick.com open Settings › Developer and create an app (Kick asks for two-step sign-in first). Any name will do, and http://127.0.0.1:8765 as its redirect address. Copy its Client ID and Client Secret here. They stay on this PC, and Link can only read what anyone can see on Kick."),
    el("label", { class: "field" }, el("span", {}, "Client ID"), id),
    el("label", { class: "field" }, el("span", {}, "Client secret"), secret)],
  "Connect", async () => {
    if (!id.value.trim() || !secret.value.trim()) throw new Error("Paste both the Client ID and the secret.");
    state.kick = await api("/api/kick", "POST", { action: "connect", id: id.value, secret: secret.value });
    toast("Kick is connected");
    state.sig.settings = "";
    renderMain();
  });
}

// ---------------------------------------------------------------- analytics

// Two sides, the same layout: your reels on Instagram and your Shorts on YouTube. The numbers come from
// each one's official API through the server (tools/reels/instagram_api.py and youtube_api.py).
// A number that has not been reported is null and shows as a dash, never as 0.
const STALE = 15 * 60;   // seconds after which opening the screen reads the numbers again
const SIDES = { instagram: "Instagram", youtube: "YouTube" };   // the Analytics screen's two sides

function showAnalytics(on, platform) {
  if (platform) setPlatform(platform, false);
  state.analytics = on;
  state.settings = null;
  state.studio = state.library = false;
  state.pickerOpen = false;
  renderAll();
  if (on) loadAnalytics();
}

function setPlatform(platform, show = true) {
  const was = state.platform;
  state.platform = platform in SIDES ? platform : "instagram";
  // which way the new side comes in from: YouTube from the right, Instagram from the left (played once, by renderAnalytics)
  if (show && was && was !== state.platform) state.sideSwap = { from: state.platform === "youtube" ? "right" : "left", at: performance.now() };
  try { localStorage.setItem("link.analytics", state.platform); } catch (e) { /* not remembered, nothing worse */ }
  if (!show) return;
  renderMain();
  loadAnalytics();
}

async function loadAnalytics() {
  if (state.platform === "youtube") return loadYoutube();
  try {
    state.insta = await api("/api/instagram");
  } catch (e) {
    state.instaError = e.message;
  }
  const data = state.insta && state.insta.data;
  if (state.insta && state.insta.connected && (!data || Date.now() / 1000 - data.fetched > STALE)) return askInstagramApi({ action: "refresh" });
  if (state.analytics) renderMain();
  renderSources();
}

async function askInstagramApi(body) {
  if (state.instaBusy) return;
  state.instaBusy = true;
  state.instaError = "";
  if (state.analytics) renderMain();
  try {
    const res = await fetch("/api/instagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const answer = await res.json();
    state.insta = { connected: answer.connected, data: answer.data };
    if (!res.ok) state.instaError = answer.error || res.statusText;
  } catch (e) {
    state.instaError = e.message;
  }
  state.instaBusy = false;
  if (state.analytics) renderMain();
  renderSources();
}

async function loadYoutube() {
  try {
    state.yt = await api("/api/youtube");
  } catch (e) {
    state.ytError = e.message;
  }
  const data = state.yt && state.yt.data;
  if (state.yt && state.yt.connected && (!data || Date.now() / 1000 - data.fetched > STALE)) return askYoutube({ action: "refresh" });
  if (state.analytics) renderMain();
  renderSources();
}

// Returns whether the server did what was asked.
async function askYoutube(body) {
  if (state.ytBusy) return false;
  state.ytBusy = true;
  state.ytError = "";
  if (state.analytics) renderMain();
  let ok = false;
  try {
    const res = await fetch("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const answer = await res.json();
    if ("connected" in answer) state.yt = answer;
    ok = res.ok;
    if (!res.ok) state.ytError = answer.error || res.statusText;
  } catch (e) {
    state.ytError = e.message;
  }
  state.ytBusy = false;
  if (state.analytics) renderMain();
  renderSources();
  return ok;
}

// Connect opens Google's sign-in page in the browser; the page waits here until the server has the
// sign-in (or three minutes have gone by), then reads the numbers.
async function connectYoutube() {
  if (!(await askYoutube({ action: "connect" }))) return;
  const mine = state.ytWait = Date.now();
  if (state.analytics) renderMain();
  while (state.ytWait === mine && Date.now() - mine < 180000) {
    await new Promise((r) => setTimeout(r, 2000));
    if (state.ytWait !== mine) return;
    const now = await api("/api/youtube").catch(() => null);
    if (now && now.connected) {
      state.yt = now;
      state.ytWait = null;
      return askYoutube({ action: "refresh" });
    }
    if (now && now.trouble) {   // the sign-in came back with a no: say why instead of waiting on
      state.ytWait = null;
      state.ytError = now.trouble;
      return state.analytics && renderMain();
    }
  }
  if (state.ytWait === mine) {
    state.ytWait = null;
    if (state.analytics) renderMain();
  }
}

const compact = (n) => (n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en"));
const exact = (n, who = "Instagram") => (n == null ? `${who} has not reported this yet` : n.toLocaleString("en"));
const sumOf = (posts, key) => (posts.some((p) => p[key] != null) ? posts.reduce((n, p) => n + (p[key] || 0), 0) : null);
const REACTIONS = ["likes", "comments", "shares", "saves"];
// Likes, comments, shares and saves (a Short has no saves); Instagram's own total when it gives one.
const interactionsOf = (p) => p.interactions ?? (REACTIONS.some((k) => p[k] != null) ? REACTIONS.reduce((n, k) => n + (p[k] || 0), 0) : null);
const rateOf = (interactions, views) => (interactions != null && views ? 100 * interactions / views : null);
const percent = (r) => (r == null ? "–" : `${r.toFixed(r < 10 ? 1 : 0)}%`);
function ago(seconds) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}

function analyticsSetup() {
  const key = el("input", { type: "password", placeholder: "Paste the access key here", autocomplete: "off", spellcheck: false });
  const connect = (event) => {
    event.preventDefault();
    if (key.value.trim()) askInstagramApi({ action: "connect", token: key.value });
  };
  return el("div", { class: "panel setup" },
    el("h2", {}, "Connect your Instagram page"),
    el("p", { class: "help" }, "The numbers come from Instagram's official API. It needs a one-time set-up that only you can do, because it uses your accounts:"),
    el("ol", {},
      el("li", {}, "In the Instagram phone app, switch the page to a professional account (Creator). A professional account is always public."),
      el("li", {}, "On developers.facebook.com, log in, create an app of the type Business and add Instagram to it."),
      el("li", {}, "In the app's dashboard open Instagram › API setup with Instagram login, press Generate token next to your page and copy the key."),
      el("li", {}, "Paste the key below. It stays on this PC, and Link renews it by itself."),
      el("li", {}, "To post reels from Link as well, the key needs the permission instagram_business_content_publish: add it to the app before you press Generate token. Without it Link only reads the numbers.")),
    el("form", { class: "row", onsubmit: connect }, key,
      el("button", { class: "btn primary", type: "submit", disabled: state.instaBusy }, state.instaBusy ? "Checking…" : "Connect")),
    state.instaError && el("p", { class: "help warn" }, `✕ ${state.instaError}`));
}

// YouTube's side is set up in two steps: the user's own OAuth client (its ID and secret), then signing
// in on Google's page.
function youtubeSetup() {
  const yt = state.yt, redirect = yt.redirect || "http://127.0.0.1:8765/youtube/callback";
  const trouble = state.ytError && el("p", { class: "help warn" }, `✕ ${state.ytError}`);
  if (yt.client) {
    const forget = el("button", { class: "btn small ghost", type: "button", disabled: state.ytBusy }, "Use another client");
    forget.onclick = () => twoStep(forget, "Click again to forget the Client ID and secret", () => { state.ytWait = null; askYoutube({ action: "forget" }); });
    return el("div", { class: "panel setup" },
      el("h2", {}, "Sign in to YouTube"),
      el("p", { class: "help" }, state.ytWait
        ? "Google's sign-in page is open in your browser. Sign in with the Google account your channel belongs to and allow every permission it asks for (managing your videos is what lets Link upload a Short); this screen carries on by itself."
        : "Your OAuth client is saved. Press Connect: Google's own sign-in page opens in your browser. Google will say the app is not verified, because it is your own: choose Advanced, then go on to it."),
      el("div", { class: "row" },
        el("button", { class: "btn primary", disabled: state.ytBusy || !!state.ytWait, onclick: connectYoutube }, state.ytWait ? "Waiting for Google…" : "Connect to YouTube"),
        state.ytWait && el("button", { class: "btn ghost", onclick: () => { state.ytWait = null; renderMain(); } }, "Cancel"),
        forget),
      trouble);
  }
  const id = el("input", { type: "text", placeholder: "Client ID (ends in .apps.googleusercontent.com)", autocomplete: "off", spellcheck: false });
  const secret = el("input", { type: "password", placeholder: "Client secret", autocomplete: "off", spellcheck: false });
  const keep = (event) => {
    event.preventDefault();
    if (id.value.trim() && secret.value.trim()) askYoutube({ action: "client", id: id.value, secret: secret.value });
  };
  return el("div", { class: "panel setup" },
    el("h2", {}, "Connect your YouTube channel"),
    el("p", { class: "help" }, "YouTube Studio's numbers come from Google's official APIs. They need a one-time set-up that only you can do, because it uses your Google account:"),
    el("ol", {},
      el("li", {}, "On console.cloud.google.com, make a project (any name)."),
      el("li", {}, "Under APIs & Services › Library, enable YouTube Data API v3 and YouTube Analytics API."),
      el("li", {}, "Under OAuth consent screen, choose External and fill in the app name and your e-mail. Then press Publish app, so the sign-in does not end after 7 days (no review is needed for your own use)."),
      el("li", {}, "Under Credentials › Create credentials › OAuth client ID, choose Web application and add this under Authorised redirect URIs, exactly: ",
        el("code", { class: "set-path", style: "direction:ltr" }, redirect), " ",
        el("button", { class: "btn small ghost", type: "button", onclick: async () => { if (shell ? await shell.copy(redirect) : (await navigator.clipboard.writeText(redirect), true)) toast("Copied"); } }, "Copy")),
      el("li", {}, "Copy the client's ID and secret below. They stay on this PC.")),
    el("form", { class: "setup-fields", onsubmit: keep }, id, secret,
      el("button", { class: "btn primary", type: "submit", disabled: state.ytBusy }, state.ytBusy ? "Saving…" : "Save")),
    trouble);
}

// ---- one post in depth: a row of the table, clicked

const postMore = new Map();   // what the server read about a post, kept five minutes
const lasted = (seconds) => (seconds == null ? "–" : seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.round(seconds % 3600 / 60)} min` : seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds * 10) / 10} s`);
const per100 = (n, views) => (n == null || !views ? "–" : (100 * n / views).toFixed(100 * n / views < 10 ? 1 : 0));
let regions = null;
const countryName = (code) => { try { regions = regions || new Intl.DisplayNames(["en"], { type: "region" }); return regions.of(code) || code; } catch (e) { return code; } };

// Bars side by side, one per name: where the views came from, which countries.
function shareBars(rows, total) {
  const most = Math.max(1, ...rows.map((r) => r.views));
  return el("div", { class: "pm-bars" }, rows.map((r) => el("div", { class: "pm-bar" },
    el("span", { class: "clip" }, r.name), el("i", {}, el("b", { style: `width:${Math.max(2, Math.round(100 * r.views / most))}%` })),
    el("em", {}, compact(r.views)), el("em", { class: "dim" }, total ? `${Math.round(100 * r.views / total)}%` : ""))));
}

// What the server reads about this one post when its window opens.
function postExtras(p, side, d) {
  if (!d) return el("p", { class: "pm-note" }, `Reading more from ${side}…`);
  if (d.error) return el("p", { class: "pm-note bad" }, d.error);
  const part = (title, ...kids) => el("section", {}, el("h3", { class: "kicker" }, title), kids);
  const fact = (label, value, hint) => (value == null || value === "" ? null : el("div", { class: "pm-fact", title: hint || "" }, el("span", {}, label), el("b", {}, value)));
  const out = [];
  if (side === "YouTube") {
    const t = d.totals;
    if (d.days && d.days.length) {
      const most = Math.max(1, ...d.days.map((x) => x.views));
      out.push(part("Views day by day", el("div", { class: "pm-days" }, d.days.slice(-45).map((x) =>
        el("i", { title: `${new Date(x.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${x.views.toLocaleString("en")} views, ${x.minutes} min watched`, style: `height:${Math.max(3, Math.round(100 * x.views / most))}%` }))),
        el("div", { class: "pm-axis" }, el("span", {}, new Date(d.days[0].day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })),
          el("span", {}, `best day ${most.toLocaleString("en")} views`), el("span", {}, new Date(d.days[d.days.length - 1].day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })))));
    }
    if (d.sources && d.sources.length) out.push(part("Where the views came from", shareBars(d.sources, d.sources.reduce((n, r) => n + r.views, 0))));
    if (d.countries && d.countries.length) out.push(part("Top countries", shareBars(d.countries.map((c) => ({ name: countryName(c.code), views: c.views })), t ? t.views : 0)));
    out.push(part("More from YouTube", el("div", { class: "pm-facts" },
      t && fact("Watched in total", lasted(t.estimatedMinutesWatched * 60)),
      t && fact("Subscribers gained", String(t.subscribersGained), "From people who watched this Short"),
      t && fact("Subscribers lost", String(t.subscribersLost)),
      t && fact("Dislikes", String(t.dislikes), "Only you see this number"),
      fact("Visibility", d.privacy && d.privacy[0].toUpperCase() + d.privacy.slice(1)),
      fact("Quality", d.definition && d.definition.toUpperCase()),
      fact("Made for kids", d.made_for_kids == null ? null : d.made_for_kids ? "Yes" : "No"),
      fact("Language", d.language)),
      !t && el("p", { class: "pm-note" }, "YouTube has no analytics for this Short yet; they come a day or two after it is posted.")));
    if (d.description) out.push(part("Description", el("p", { class: "pm-text" }, d.description)));
    if (d.tags && d.tags.length) out.push(part("Tags", el("p", { class: "pm-text" }, d.tags.join(" · "))));
  } else {
    out.push(part("More from Instagram", el("div", { class: "pm-facts" },
      fact("Watched in total", d.total_watch_seconds == null ? null : lasted(d.total_watch_seconds), "Every play of this reel added up"),
      fact("Plays per viewer", p.views && p.reach ? (p.views / p.reach).toFixed(2) : null, "Views divided by the accounts reached: above 1 means people watched it again"),
      fact("Follows from it", d.follows == null ? null : String(d.follows)),
      fact("Profile visits from it", d.profile_visits == null ? null : String(d.profile_visits)),
      fact("Also in the feed", d.in_feed == null ? null : d.in_feed ? "Yes" : "No, Reels tab only"),
      fact("Comments", d.comments_on == null ? null : d.comments_on ? "Open" : "Turned off"))));
    if (d.comments && d.comments.length) out.push(part("Newest comments", el("div", { class: "pm-said" }, d.comments.map((c) =>
      el("p", {}, el("b", {}, c.who || "someone"), " ", c.text, c.likes ? el("em", {}, ` · ❤ ${c.likes}`) : null)))));
    else if (p.comments) out.push(part("Comments", el("p", { class: "pm-note" }, "Instagram gave no comment texts for this access key (it needs the permission to manage comments). The count above is right.")));
  }
  return out;
}

function showPost(p, side, posts) {
  const key = `${side.toLowerCase()}/${p.id}`, reel = side === "Instagram" ? "reel" : "Short";
  const when = new Date(p.posted), known = !Number.isNaN(when.getTime());
  const days = known ? (Date.now() - when) / 86400000 : null;
  const reacted = interactionsOf(p);
  const byViews = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0));
  const all = posts.reduce((n, x) => n + (x.views || 0), 0);
  const tile = (label, value, title) => el("div", { class: "kpi", title: title || "" }, el("div", { class: "value" }, value), el("div", { class: "label" }, label));
  const fact = (label, value, hint) => el("div", { class: "pm-fact", title: hint || "" }, el("span", {}, label), el("b", {}, value));
  const box = el("dialog", { class: "post-modal" });
  const close = () => { box.close(); box.remove(); };
  const more = el("div", { class: "pm-more" }, postExtras(p, side, null));
  const copy = el("button", { class: "btn small ghost" }, "Copy link");
  copy.onclick = async () => { const ok = shell && shell.copy ? await shell.copy(p.link) : await navigator.clipboard.writeText(p.link).then(() => true, () => false); toast(ok ? "Link copied" : "Could not copy the link", !ok); };
  put(box, el("div", { class: "pm" },
    el("header", {},
      el("span", { class: "pix" }, `${side.toUpperCase()} ${reel.toUpperCase()}${p.length ? ` · ${p.length} S` : ""} · #${byViews.indexOf(p) + 1} OF ${posts.length} BY VIEWS`),
      el("button", { class: "pm-x", title: "Close (Esc)", onclick: close }, "×")),
    el("div", { class: "pm-body" },
      el("aside", {},
        p.thumbnail ? el("img", { src: p.thumbnail, alt: "", referrerPolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null,
        p.link && el("button", { class: "btn small", onclick: () => { close(); shell ? shell.open(p.link, "video").then((r) => (r.ok ? showStudio(true, "video") : toast(r.error, true))) : window.open(p.link); } }, `Open on ${side}`),
        p.link && copy),
      el("div", { class: "pm-main" },
        el("h2", {}, p.caption.split("\n")[0] || "(no caption)"),
        el("p", { class: "pm-when" }, known ? [el("b", {}, "Uploaded "), `${when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
          el("span", {}, ` · ${days < 1 ? `${Math.max(1, Math.round(days * 24))} h ago` : `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`}`)] : "Upload date unknown"),
        el("div", { class: "kpis" },
          tile("Views", compact(p.views), exact(p.views, side)),
          side === "Instagram" ? tile("Reach", compact(p.reach), "Different accounts that saw it") : null,
          tile("Likes", compact(p.likes)), tile("Comments", compact(p.comments)), tile("Shares", compact(p.shares)),
          side === "Instagram" ? tile("Saves", compact(p.saves)) : tile("New subs", compact(p.subscribers), "Subscribers gained from this Short"),
          tile("Avg watch", p.watch_seconds == null ? "–" : `${p.watch_seconds} s`, "How long one play lasts on average"),
          p.watched_percent != null ? tile("Watched", `${Math.round(p.watched_percent)}%`, "Average part of the Short that is watched; over 100% means it is replayed") : null,
          tile("Engagement", percent(rateOf(reacted, p.views)), "Likes, comments, shares and saves per 100 views")),
        el("section", {}, el("h3", { class: "kicker" }, "What the numbers say"), el("div", { class: "pm-facts" },
          fact(days != null && days < 2 ? "Views per hour" : "Views per day", !known || p.views == null ? "–" : compact(Math.round(p.views / Math.max(1, days < 2 ? days * 24 : days))), "Since it was uploaded"),
          fact(`Share of your ${reel}s' views`, all && p.views != null ? `${Math.round(100 * p.views / all)}%` : "–", `Of the ${all.toLocaleString("en")} views on all ${posts.length}`),
          fact("Likes per 100 views", per100(p.likes, p.views)),
          fact("Comments per 100 views", per100(p.comments, p.views)),
          fact("Shares per 100 views", per100(p.shares, p.views)),
          side === "Instagram" ? fact("Saves per 100 views", per100(p.saves, p.views)) : null,
          p.length && p.watch_seconds != null && p.watched_percent == null ? fact("Watched of its length", `${Math.round(100 * p.watch_seconds / p.length)}%`, `${p.watch_seconds} s of ${p.length} s`) : null)),
        more,
        side === "Instagram" && (p.caption.includes("\n") || p.caption.length > 80) ? el("section", {}, el("h3", { class: "kicker" }, "Caption"), el("p", { class: "pm-text" }, p.caption)) : null))));
  box.onclick = (e) => { if (e.target === box) close(); };   // a click on the dark around it closes it
  box.addEventListener("close", () => box.remove());
  document.body.append(box);
  box.showModal();
  box.querySelector(".pm-x").focus({ preventScroll: true });
  box.querySelector(".pm-body").scrollTop = 0;
  const kept = postMore.get(key);
  const fill = (d) => { if (box.isConnected) put(more, postExtras(p, side, d)); };
  if (kept && Date.now() - kept.at < 300000) return fill(kept.d);
  api(`/api/post/${key}`).then((d) => { postMore.set(key, { at: Date.now(), d }); fill(d); }, (e) => fill({ error: e.message }));
}

// One row per post. `columns` are [key, label, title to sort by, how to show the number]; the first
// two columns (the picture and the text) and the last (Open) are always there.
function statsTable(posts, { who, thing, sort, onSort, columns, rateTitle }) {
  const value = (p) => ({ rate: rateOf(interactionsOf(p), p.views), posted: Date.parse(p.posted) || 0 }[sort.key] ?? p[sort.key]);
  const rows = [...posts].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    return (x == null) - (y == null) || (sort.down ? y - x : x - y);   // posts without the number go last either way
  });
  const most = Math.max(1, ...posts.map((p) => p.views || 0));
  const head = (key, label, title) => el("th", { class: "num" + (sort.key === key ? " sorted" : ""), title: title || `Sort by ${label.toLowerCase()}`,
    onclick: () => onSort({ key, down: sort.key === key ? !sort.down : true }) }, label, sort.key === key ? (sort.down ? " ▾" : " ▴") : "");
  return el("table", { class: "stats" },
    el("thead", {}, el("tr", {}, el("th", {}), el("th", { class: "text" }, thing),
      head("posted", "Posted"), head("views", "Views"), columns.map(([key, label, title]) => head(key, label, title)),
      head("rate", "Engagement", `Sort by engagement: ${rateTitle.toLowerCase()}`), el("th", {}))),
    el("tbody", {}, rows.map((p) => {
      const when = new Date(p.posted), known = !Number.isNaN(when.getTime());
      return el("tr", { title: `Click for this ${thing.toLowerCase()} in depth`, onclick: () => showPost(p, who, posts) },
        el("td", { class: "thumb" }, p.thumbnail ? el("img", { src: p.thumbnail, alt: "", loading: "lazy", referrerPolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null),
        el("td", { class: "text", title: p.caption }, el("div", { class: "clip" }, p.caption.split("\n")[0] || "(no caption)")),
        el("td", { class: "num", title: known ? when.toLocaleString("en-GB") : "" }, known ? `${when.getDate()} ${when.toLocaleString("en", { month: "short" })}` : "–"),
        el("td", { class: "num views", title: exact(p.views, who) }, compact(p.views), el("i", { style: `width:${Math.round(100 * (p.views || 0) / most)}%` })),
        columns.map(([key, , title, show]) => el("td", { class: "num", title: show ? title : exact(p[key], who) }, show ? show(p[key]) : compact(p[key]))),
        el("td", { class: "num", title: rateTitle }, percent(rateOf(interactionsOf(p), p.views))),
        el("td", {}, p.link && el("button", { class: "btn small ghost", title: `Open this ${thing.toLowerCase()} on ${who}`,
          onclick: (e) => { e.stopPropagation(); shell ? shell.open(p.link, "video").then((r) => (r.ok ? showStudio(true, "video") : toast(r.error, true))) : window.open(p.link); } }, "Open")));
    })));
}

const kpi = (who) => (label, n, title, text) => el("div", { class: "kpi", title: title || exact(n, who) }, el("div", { class: "value" }, text ?? compact(n)), el("div", { class: "label" }, label));

// The stretch of time the whole-account numbers cover, chosen beside their heading; one choice for both
// platforms, kept for the next time. Choosing reads the numbers again from the platform shown.
const PERIODS = [["7", "Last 7 days"], ["28", "Last 28 days"], ["all", "All time"]];
try { const kept = localStorage.getItem("link.period"); if (PERIODS.some(([key]) => key === kept)) state.period = kept; } catch (e) { /* the 28 days, as before */ }
const periodPick = (refresh) => el("select", { class: "kicker-pick", title: "The stretch of time these numbers cover. Choosing one reads them again.",
    onchange: (e) => { state.period = e.target.value; try { localStorage.setItem("link.period", state.period); } catch (err) { /* chosen again next time */ } renderMain(); refresh(); } },
  PERIODS.map(([key, label]) => el("option", { value: key, selected: key === state.period }, label)));
function instagramParts() {
  const insta = state.insta, data = insta && insta.data, tile = kpi("Instagram");
  if (!insta) return [emptyState("Analytics", state.instaError || "Loading…")];
  if (!insta.connected) return [analyticsSetup()];
  const parts = [];
  if (state.instaError) parts.push(el("div", { class: "notice" }, el("div", { class: "pix" }, "⚠ THE NUMBERS COULD NOT BE READ"), el("div", {}, state.instaError)));
  if (!data) return [...parts, emptyState(state.instaBusy ? "Reading your numbers from Instagram…" : "No numbers yet", state.instaBusy ? "" : "Press Refresh to read them.")];
  const posts = data.posts, views = sumOf(posts, "views");
  // The whole account over the stretch chosen beside the heading: 7 days, 28 days or since the first post.
  // Numbers read before Link offered the choice hold only the 28 days; Refresh reads the others.
  const periods = data.periods || { 28: data.last_28_days || {} }, recent = periods[state.period];
  const had = Object.values(periods).some((p) => Object.keys(p).length), approx = (recent && recent.approx) || [];
  const overMonths = "Added up month by month, so somebody who saw you in two months is counted twice. The true number is lower.";
  const pickPeriod = periodPick(() => askInstagramApi({ action: "refresh" }));
  const interactions = posts.some((p) => interactionsOf(p) != null) ? posts.reduce((n, p) => n + (interactionsOf(p) || 0), 0) : null;
  const rateTitle = "Likes, comments, shares and saves per 100 views";
  parts.push(
    el("div", { class: "kicker" }, "All posts"),
    el("div", { class: "kpis" },
      tile("Followers", data.account.followers), tile("Posts", data.account.posts ?? posts.length), tile("Views", views),
      tile("Likes", sumOf(posts, "likes")), tile("Comments", sumOf(posts, "comments")), tile("Shares", sumOf(posts, "shares")),
      tile("Saves", sumOf(posts, "saves")), tile("Engagement", null, `${rateTitle}, over all posts`, percent(rateOf(interactions, views)))),
    had ? [el("div", { class: "kicker with-pick" }, "Whole account ·", pickPeriod),
      recent && Object.keys(recent).length
        ? el("div", { class: "kpis" },
            tile(approx.includes("reach") ? "Reach ≈" : "Reach", recent.reach, approx.includes("reach") ? overMonths : "Different accounts that saw your content"), tile("Views", recent.views),
            tile(approx.includes("accounts_engaged") ? "Accounts engaged ≈" : "Accounts engaged", recent.accounts_engaged, approx.includes("accounts_engaged") ? overMonths : null),
            tile("Interactions", recent.total_interactions))
        : el("p", { class: "help" }, state.instaBusy ? "Reading these from Instagram…" : "Instagram gave no numbers for this stretch.")] : null,
    posts.length ? [el("div", { class: "kicker" }, `Every post · ${posts.length}`),
        statsTable(posts, { who: "Instagram", thing: "Reel", sort: state.instaSort, onSort: (s) => { state.instaSort = s; renderMain(); }, rateTitle,
          columns: [["reach", "Reach", "Sort by reach: the number of different accounts that saw it"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"],
                    ["watch_seconds", "Avg watch", "Average time people watched", (v) => (v == null ? "–" : `${v} s`)]] })]
      : el("div", { class: "empty-state analytics-none" }, el("div", { class: "tv tall" }, "NO REEL"), el("h2", {}, "Nothing posted yet"),
          el("p", {}, "The page is connected and Instagram reports no posts. Render a reel, press Post on Instagram in its Finals tab, and its numbers appear here.")),
    el("p", { class: "help" }, "Instagram's figures can be up to 48 hours behind, and a dash means Instagram has not reported that number yet."));
  return parts;
}

function youtubeParts() {
  const yt = state.yt, data = yt && yt.data, tile = kpi("YouTube");
  if (!yt) return [emptyState("Analytics", state.ytError || "Loading…")];
  if (!yt.connected) return [youtubeSetup()];
  const parts = [];
  if (state.ytError) parts.push(el("div", { class: "notice" }, el("div", { class: "pix" }, "⚠ THE NUMBERS COULD NOT BE READ"), el("div", {}, state.ytError)));
  if (!data) return [...parts, emptyState(state.ytBusy ? "Reading your numbers from YouTube…" : "No numbers yet", state.ytBusy ? "" : "Press Refresh to read them.")];
  if (data.note) parts.push(el("div", { class: "notice" }, el("div", {}, data.note)));
  const posts = data.posts, views = sumOf(posts, "views");
  // numbers read before Link offered the choice hold only the 28 days; choosing reads the others
  const periods = data.periods || { 28: data.last_28_days || {} }, recent = periods[state.period] || {};
  const had = Object.values(periods).some((p) => Object.keys(p).length);
  const interactions = posts.some((p) => interactionsOf(p) != null) ? posts.reduce((n, p) => n + (interactionsOf(p) || 0), 0) : null;
  // how much of a Short people watch, on average over all views
  const seen = posts.filter((p) => p.watched_percent != null && p.views);
  const watched = seen.length ? seen.reduce((n, p) => n + p.watched_percent * p.views, 0) / seen.reduce((n, p) => n + p.views, 0) : null;
  const rateTitle = "Likes, comments and shares per 100 views";
  const hours = recent.estimatedMinutesWatched == null ? null : Math.round(recent.estimatedMinutesWatched / 6) / 10;
  parts.push(
    el("div", { class: "kicker" }, "All Shorts"),
    el("div", { class: "kpis" },
      tile("Subscribers", data.account.followers, data.account.followers == null ? "The channel hides its subscriber count" : null), tile("Shorts", posts.length), tile("Views", views),
      tile("Likes", sumOf(posts, "likes")), tile("Comments", sumOf(posts, "comments")), tile("Shares", sumOf(posts, "shares")),
      tile("Watched", null, "How much of a Short people watch, on average over all views", percent(watched)),
      tile("Engagement", null, `${rateTitle}, over all Shorts`, percent(rateOf(interactions, views)))),
    had ? [el("div", { class: "kicker with-pick" }, `${data.last_28_days_shorts_only ? "Shorts" : "Whole channel"} ·`, periodPick(() => askYoutube({ action: "refresh" }))),
      Object.keys(recent).length
        ? el("div", { class: "kpis" }, tile("Views", recent.views), tile("Watch time", null, "Hours watched", hours == null ? "–" : `${hours.toLocaleString("en")} h`),
            tile("Likes", recent.likes), tile("Comments", recent.comments), tile("Shares", recent.shares), tile("New subscribers", recent.subscribersGained))
        : el("p", { class: "help" }, state.ytBusy ? "Reading these from YouTube…" : "YouTube gave no numbers for this stretch.")] : null,
    posts.length ? [el("div", { class: "kicker" }, `Every Short · ${posts.length}`),
        statsTable(posts, { who: "YouTube", thing: "Short", sort: state.ytSort, onSort: (s) => { state.ytSort = s; renderMain(); }, rateTitle,
          columns: [["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["subscribers", "Subs", "Sort by the subscribers it brought"],
                    ["watch_seconds", "Avg watch", "Average time people watched", (v) => (v == null ? "–" : `${v} s`)],
                    ["watched_percent", "Watched", "How much of it people watched, on average (over 100% means they watched it again)", (v) => percent(v)]] })]
      : el("div", { class: "empty-state analytics-none" }, el("div", { class: "tv tall" }, "NO SHORT"), el("h2", {}, "No Shorts yet"),
          el("p", {}, "The channel is connected and YouTube lists no Shorts on it. Upload a rendered reel as a Short and its numbers appear here.")),
    el("p", { class: "help" }, "Views, likes and comments are up to the minute. Shares, watch time and subscribers come from YouTube's analytics, which are a day or two behind; a dash means YouTube has not reported that number yet. YouTube gives no reach and no saves for a Short."));
  return parts;
}

// The parts of a side just switched to slide in from that side, one a moment after the other.
function sideIn(parts) {
  // The side is drawn again when its numbers arrive, often a moment after the switch: the slide then
  // carries on from where it was instead of being cut off.
  const swap = state.sideSwap, gone = swap ? performance.now() - swap.at : 0;
  if (swap && gone > 300) state.sideSwap = null;
  const list = [parts].flat(Infinity).filter((k) => k != null && k !== false);
  if (state.sideSwap) list.forEach((part, i) => {
    if (!(part instanceof Element)) return;
    part.classList.add("side-in", swap.from);
    part.style.animationDelay = `${Math.round(Math.min(i, 5) * 22 - gone)}ms`;
    part.addEventListener("animationend", () => { part.classList.remove("side-in", swap.from); part.style.animationDelay = ""; }, { once: true });
  });
  return list;
}

function renderAnalytics() {
  const youtube = state.platform === "youtube";
  const side = youtube ? state.yt : state.insta, data = side && side.data, busy = youtube ? state.ytBusy : state.instaBusy;
  const ask = youtube ? askYoutube : askInstagramApi;
  const leave = el("button", { class: "btn small ghost", disabled: busy }, "Disconnect");
  leave.onclick = () => twoStep(leave, youtube ? "Click again to forget the sign-in" : "Click again to forget the access key", () => ask({ action: "disconnect" }));
  // The chosen side's tab carries its channel's own picture; the arrow stays if there is none (or it does not load).
  const face = (key) => {
    const account = ((key === "youtube" ? state.yt : state.insta) || {}).data;
    const arrow = el("span", { class: "cur" }, "▶");
    if (state.platform !== key || !account || !account.account.picture) return arrow;
    const pic = el("img", { class: "tab-pic" + (state.sideSwap && performance.now() - state.sideSwap.at < 40 ? " pop" : ""), src: account.account.picture, alt: "", referrerPolicy: "no-referrer" });
    pic.onerror = () => pic.replaceWith(arrow);
    return pic;
  };
  drawMain(
    el("div", { class: "head-row" },
      // the two sides to choose from on the left, with their buttons; the screen's name and whose numbers these are on the right
      el("div", { class: "tabs" }, Object.entries(SIDES).map(([key, label]) =>
        el("div", { class: "tab" + (state.platform === key ? " active" : ""), title: key === "youtube" ? "Your Shorts on YouTube" : "Your reels on Instagram",
          onpointerdown: (e) => { if (e.button === 0 && state.platform !== key) setPlatform(key); } }, face(key), label))),
      side && side.connected ? el("div", { class: "row" },
        el("button", { class: "btn small", disabled: busy, onclick: () => ask({ action: "refresh" }) }, busy ? "Reading…" : "⟳ Refresh"), leave) : null,
      el("div", { style: "min-width:0;flex:1;text-align:right" }, el("h1", {}, "Analytics"),
        el("div", { class: "sub clip" }, data ? `${youtube ? "" : "@"}${data.account.username} · UPDATED ${ago(data.fetched).toUpperCase()}` : SIDES[state.platform].toUpperCase()))),
    el("div", { class: "head-rule" }),
    sideIn(youtube ? youtubeParts() : instagramParts()));
  renderDialogue();
}

// ---------------------------------------------------------------- jobs

async function startJob(body) {
  try {
    await api("/api/jobs", "POST", body);
    state.lastJob = body;
    state.jobExpect = body.kind === "render" ? (body.only ? body.only.length : reelsNow().length) : 0;
    state.jobHidden = false;
    state.showLog = false;
    await refreshStatus();
  } catch (e) {
    toast(e.message, true);
  }
}

// What Link says it is up to while a job runs, for fun: a few lines for each stage, a new one every
// few seconds. It stands in front of the plain sentence (the step, the count), which stays.
const MUSING = {
  reading: ["Link is linking…", "Blowing the dust off the tape…", "Pressing START…", "Rewinding…", "Threading the tape…", "Warming up the tubes…"],
  finding: ["Link is thinking…", "Hunting for the good parts…", "Fast-forwarding through the boring bits…", "Listening for the loud noises…", "Counting the chat's exclamation marks…",
    "Looking for the play of the game…", "Connecting the dots…", "Squinting at every frame…", "Following the hype…"],
  listening: ["Link is listening…", "Eavesdropping on the stream…", "Writing down who said what…", "Turning shouting into subtitles…", "Taking notes…", "Lip-reading, almost…"],
  render: ["Link is cutting…", "Sharpening the scissors…", "Going vertical…", "Burning in the captions…", "Polishing the pixels…", "Turning it up to minus fourteen…", "Rolling the credits…"],
  preview: ["Link is sketching…", "A quick look, coming up…", "Rough cut on the way…"],
};
const MUSE_EVERY = 4000;   // ms a line stays
function musing(stage, since) {   // the line to show now: the stage's lines in turn, by how long the job has run
  const lines = MUSING[stage] || [];
  return lines.length ? lines[Math.floor(Math.max(0, Date.now() - since * 1000) / MUSE_EVERY) % lines.length] : "";
}
setInterval(() => { if (state.status && state.status.job.running) renderJob(); }, 1000);   // so the line changes between two looks at the job

// The line as it is drawn. When it has just changed, the old line rolls up and out and the new one
// rolls in from below (style.css, "fun-out" and "fun-in"). The job box is drawn anew whenever its
// numbers change, which can be in the middle of a roll: the roll then carries on from where it was.
const ROLL = 450;   // ms a roll takes; the same as in style.css
const rolling = { now: "", before: "", at: 0 };
function funLine(fun) {
  if (!fun) { rolling.now = ""; return null; }
  if (fun !== rolling.now) Object.assign(rolling, { before: rolling.now, now: fun, at: Date.now() });
  const gone = Date.now() - rolling.at;
  if (!rolling.before || gone >= ROLL) return el("b", { class: "fun" }, el("span", {}, fun));
  const delay = `animation-delay:-${gone}ms`;
  return el("b", { class: "fun roll" }, el("span", { class: "old", style: delay }, rolling.before), el("span", { class: "new", style: delay }, fun));
}

// Turn a job's raw output into a title, a rough progress and one plain sentence.
function jobInfo(job) {
  const lines = job.log.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  const [running, done] = job.file && !job.recording ? ["Processing the video", "Video processed"] : JOBS[job.kind] || [job.kind, job.kind];
  const elapsed = job.started ? Math.max(0, (job.running ? Date.now() / 1000 : job.ended || Date.now() / 1000) - job.started) : 0;
  let pct = null, text = "", stage = job.kind === "render" ? "render" : "preview";
  if (job.kind === "ingest" || job.kind === "analyze") {
    const isFound = (l) => /^#\s*\d+\s+[\d.]+ -/.test(l), isHeard = (l) => /^#\s*\d+\s+\d+ phrases/.test(l);
    // ingest.py says "SRC-004: linked <file> -> ... (33 min, 0 markers)" as it starts on each video
    // ("resumed" for one whose processing was cut off earlier).
    const starts = lines.filter((l) => /^SRC-\d+: (linked|copied|resumed) /.test(l));
    const now = lines.slice(lines.findLastIndex((l) => /^SRC-\d+: (linked|copied|resumed) /.test(l)));   // the video being worked on
    const found = now.filter(isFound).length, heard = now.filter(isHeard).length;
    const minutes = +((starts.length && starts[starts.length - 1].match(/\((\d+) min, \d+ markers\)$/)) || [])[1] || 0;
    const tape = job.count > 1 ? `Video ${Math.max(1, starts.length)} of ${job.count} · ` : "";
    if (!starts.length) [pct, text] = [8, `Step 1 of 3 · Reading ${job.file || "the recording"}${job.count > 1 ? ` and ${job.count - 1} more` : ""}`];
    // Analysis takes about 4.4 minutes per hour of video; a long one would look stuck without a word.
    else if (!found) [pct, text] = [35, `${tape}Step 2 of 3 · Finding the moments${minutes >= 15 ? ` (about ${Math.round(minutes * 4.4 / 60)} min for ${span(minutes * 60)} of video)` : ""}`];
    else [pct, text] = [70 + 30 * (heard / found), `${tape}Step 3 of 3 · Listening to what was said (${Math.min(heard + 1, found)} of ${found})`];
    stage = !starts.length ? "reading" : !found ? "finding" : "listening";
    if (!job.running) {
      const all = lines.filter(isFound).length;
      text = all ? `${many(all, "candidate")} found.` : lines.find((l) => /^Skipped|^No new|^Already a tape/.test(l))
        || (starts.length ? "No moments stood out. Click its timeline to make a reel from any stretch." : last);
      if (/^No new recordings/.test(text)) text = "There is no new recording to process.";
    }
  } else if (job.kind === "render") {
    const made = lines.filter((l) => /^(ok|BAD) /.test(l)).length;
    pct = state.jobExpect ? 100 * made / state.jobExpect : null;
    text = state.jobExpect ? `Rendered ${made} of ${state.jobExpect}.` : `Rendered ${made}.`;
  } else {
    text = job.running ? "Rendering the reel exactly as it is in the form." : last;
  }
  const failed = !job.running && job.returncode !== 0;
  return {
    title: job.running ? running : failed ? `${running} did not finish` : done,
    right: job.running ? (pct == null ? clock(elapsed) : `${Math.round(pct)}%`) : "",
    pct: job.running ? pct : 100, text: failed ? last || "It stopped without saying why." : text,
    fun: job.running ? musing(stage, job.started || 0) : "",
    state: job.running ? "running" : failed ? "failed" : "done",
  };
}

function renderJob() {
  const job = state.status.job;
  const box = $("job");
  if (!job.kind || state.jobHidden) return void (box.hidden = true);
  const info = jobInfo(job);
  const sig = JSON.stringify([job.kind, info.state, info.pct, info.text, info.fun, state.showLog, state.showLog && job.log.length]);
  if (sig === state.sig.job && !box.hidden) return;
  state.sig.job = sig;
  box.hidden = false;
  box.className = `panel job ${info.state}`;
  const link = (label, action) => el("a", { onclick: action }, label);
  const hide = link("Hide", () => { state.jobHidden = true; renderJob(); });
  const details = link(state.showLog ? "Hide details" : "Show details", () => { state.showLog = !state.showLog; renderJob(); });
  put(box,
    el("div", { class: "top" },
      el("span", { class: "title" }, (info.state === "done" ? "✓ " : info.state === "failed" ? "✕ " : "") + info.title),
      info.state === "running" ? el("span", { class: "right" }, info.right) : hide),
    el("div", { class: "meter" + (info.state === "failed" ? " failed" : info.pct == null ? " busy" : "") },
      el("i", { style: `width:${info.state === "failed" ? 40 : info.pct ?? 35}%` })),
    el("div", { class: "bottom" }, el("span", { class: "text" }, funLine(info.fun), info.text),
      el("div", { class: "row" }, details,
        info.state === "failed" && state.lastJob && el("button", { class: "btn small", onclick: () => startJob(state.lastJob) }, "Try again"),
        info.state === "done" && job.kind === "ingest" && /candidates? found/.test(info.text) &&
          el("button", { class: "btn primary small", onclick: () => { state.tab = "candidates"; state.jobHidden = true; renderMain(); renderJob(); } }, "Review candidates"))),
    state.showLog ? el("pre", {}, job.log || "Nothing yet.") : null);
  const pre = box.querySelector("pre");
  if (pre) pre.scrollTop = pre.scrollHeight;
  // A job that went well hides itself after a few seconds so it does not cover the page; one that
  // failed stays until it is read. The mouse resting on it, or its details being open, keeps it.
  clearTimeout(state.jobFade);
  if (info.state === "done") {
    const which = job.started;
    const fade = () => {
      if (state.status.job.started !== which || state.status.job.running) return;
      if (state.showLog || box.matches(":hover")) return void (state.jobFade = setTimeout(fade, 2000));
      state.jobHidden = true;
      renderJob();
    };
    state.jobFade = setTimeout(fade, 6000);
  }
}

// ---------------------------------------------------------------- sources

// A tape in the picker above a tape's page (shown while the sidebar is hidden).
function sourceCard(s) {
  return el("div", { class: "source", "data-id": s.id, onclick: () => { state.pickerOpen = false; select(s.id); } },
    el("span", { class: "cursor" }, "▶"),
    el("div", { class: "top" }, el("span", { class: "title", title: s.file }, sourceTitle(s)), el("span", { class: "id" }, s.id)),
    el("div", { class: "meta" }, `${span(s.duration)} · ${many(s.candidates, "candidate")} · ${s.rendered}/${many(s.reels, "reel")}`),
    s.marked ? el("div", { class: "tag gold" }, `★ ${s.marked} MARKED`) : null);
}

// The link fields (index.html, #opener) belong to the Studio and URL, which draw them in their
// heading. Every screen is drawn through drawMain: when the screen drawn has no place for the fields
// they go back to where they wait out of sight, instead of being thrown away with the old screen.
// (The Sources screen is drawn from several places, not only renderMain; thrown away once, the
// fields were gone for good and every later drawing failed on them.)
function drawMain(...kids) {
  put($("main"), ...kids);
  if (!linkBar.isConnected) linkHome.append(linkBar);
}

// The pills' strip slides open and shut and moves the page under it: the Studio's video panel, which
// is laid over the page by the window, follows when the slide is done.
$("pills").addEventListener("transitionend", (e) => { if (e.target === $("pills")) placePlayer(); });

// For a thing that should act when the main mouse button goes down on it.
const press = (act) => (e) => { if (e.button === 0) act(e); };

// ---- how hard the PC is working: two thin readouts at the foot of the list on the left, the processor and
// the graphics card, asked of the server every two seconds while the list is in sight. Each is a row of
// dots: as many as are in use are lit, the rest are dim.
const PERF_DOTS = 15;   // cells, two dots each: a cell is about seven percent
const PERF_DOT = "⠒";   // a braille cell with two small dots side by side: the fine dots the readout had before
const perfRow = (label, title) => {
  const lit = el("i", { class: "lit" }), rest = el("i", {}, PERF_DOT.repeat(PERF_DOTS)), value = el("b", {}, "–");
  return { lit, rest, value, nodes: [el("span", { title }, label), el("span", { class: "dots", ariaHidden: "true" }, lit, rest), value] };
};
const perfCpu = perfRow("CPU", "How busy this PC's processor is"), perfGpu = perfRow("GPU", "How busy this PC's graphics card is");
const perfBox = el("div", { class: "perf", ariaLabel: "This PC's load" }, perfCpu.nodes, perfGpu.nodes);
function showPerf(row, percent, title) {
  const known = typeof percent === "number";
  row.value.textContent = known ? `${percent}%` : "–";
  const on = known ? Math.min(PERF_DOTS, Math.max(percent > 0 ? 1 : 0, Math.round((percent / 100) * PERF_DOTS))) : 0;   // any use at all lights one
  row.lit.textContent = PERF_DOT.repeat(on);
  row.rest.textContent = PERF_DOT.repeat(PERF_DOTS - on);
  row.lit.classList.toggle("high", known && percent >= 85);
  row.value.classList.toggle("high", known && percent >= 85);
  if (title) row.nodes[0].title = title;
}
async function tickPerf() {
  if (document.hidden || !perfBox.isConnected || document.body.classList.contains("side-hidden")) return;
  try {
    const p = await api("/api/performance");
    showPerf(perfCpu, p.cpu);
    showPerf(perfGpu, p.gpu ? p.gpu.use : null, p.gpu ? `${p.gpu.name} · its memory is ${p.gpu.memory}% full` : "No graphics card that reports its load was found");
  } catch { /* the server is away for a moment: the readouts keep what they showed */ }
}
setInterval(tickPerf, 2000);

function renderSources(force = false) {
  // Redrawn on every change in the Studio: not while a folder is being named or something is being
  // dragged, which a redraw would cut short. It catches up when they end.
  if (!force && (state.renaming || state.drag)) {
    state.sourcesStale = true;
    return;
  }
  state.sourcesStale = false;
  const n = state.sources.length;
  const open = ((state.shell || {}).channels || []).filter((c) => c.open);
  const streamsOn = open.filter((c) => c.kind !== "video"), videoOn = open.find((c) => c.kind === "video");
  const todo = state.sources.filter((s) => s.reels > s.rendered).length;
  put($("sources"),
    // Where a video plays and is recorded, the page's numbers, and the tapes. Each opens the moment
    // it is pressed (press), not when the button comes up again: that wait is what made it feel slow.
    el("nav", { class: "side-nav", style: `--caret-phase:-${Math.round(performance.now() % 1060)}ms` },
      shell && el("div", { class: "nav-item studio" + (state.studio && state.kind === "stream" ? " active" : ""), onpointerdown: press(() => showStudio(true, "stream")) },
        // On hover a glowing copy of the word wipes across it, led by a thin bar.
        svg(ICONS.screenLine), el("span", { class: "label slide-glow" }, "Studio", el("span", { class: "glow", ariaHidden: "true" }, "Studio")),
        streamsOn.some((c) => c.recording) ? el("span", { class: "tag red" }, "● REC") : el("span", { class: "note" }, streamsOn.length ? "OPEN" : ""),
        el("div", { class: "meta clip" }, streamsOn.length ? streamsOn.map((c) => c.name).join(" · ") : "Record up to 3 live streams")),
      // One video from a link (YouTube, say), for a quick reel.
      shell && el("div", { class: "nav-item url" + (state.studio && state.kind === "video" ? " active" : ""), onpointerdown: press(() => showStudio(true, "video")) },
        svg(ICONS.link), el("span", { class: "label slide-glow" }, "URL", el("span", { class: "glow", ariaHidden: "true" }, "URL")),
        videoOn && videoOn.recording ? el("span", { class: "tag red" }, "● REC") : el("span", { class: "note" }, videoOn ? "OPEN" : ""),
        el("div", { class: "meta clip" }, videoOn ? videoOn.name : "A YouTube video, made into reels")),
      // The sidebar is redrawn often; the bars' slow glow picks up where it was instead of starting over.
      el("div", { class: "nav-item analytics" + (state.analytics ? " active" : ""), onpointerdown: press(() => showAnalytics(true)),
        style: `--bars-phase:-${Math.round(performance.now() % 6000)}ms` },
        svg(ICONS.chart), el("span", { class: "label slide-glow" }, "Analytics", el("span", { class: "glow", ariaHidden: "true" }, "Analytics")), el("span", { class: "note" }, ""),
        el("div", { class: "meta clip" }, [state.insta && state.insta.data && `@${state.insta.data.account.username} · ${many(state.insta.data.posts.length, "post")}`,
          state.yt && state.yt.data && `${many(state.yt.data.posts.length, "Short")}`].filter(Boolean).join(" · ") || "Your reels and Shorts")),
      // The tapes have a screen of their own; the item is the chosen one there, and stays lit while a
      // tape is on the page.
      el("div", { class: "nav-item sources" + (state.library ? " active" : state.studio || state.analytics || state.settings ? "" : " chosen"), onpointerdown: press(() => showSources()) },
        svg(ICONS.tape), el("span", { class: "label slide-glow" }, "Sources", el("span", { class: "glow", ariaHidden: "true" }, "Sources")), el("span", { class: "note" }, ""),
        el("div", { class: "meta clip" }, many(n, "tape") + (todo ? ` · ${todo} to render` : "")))),
    // In Settings the sections are listed here, under the screens.
    state.settings && [el("div", { class: "kicker side-kicker" }, "Settings"), settingsNav()]);
  if (state.library) renderLibrary();
  $("sources").append(perfBox);   // the PC's two readouts stay at the foot of the list, whatever is drawn above them
}

// The sections of Settings as a list. It is in the sidebar; with the sidebar folded away (or on a
// narrow window, which has none) the Settings screen shows it beside the section instead.
function settingsNav() {
  return el("nav", { class: "settings-nav" }, SETTINGS.map(([key, label]) =>
    el("button", { class: "settings-tab" + (key === state.settings ? " active" : ""), type: "button", onpointerdown: press(() => showSettings(key)) }, label)));
}

// ---------------------------------------------------------------- folders

// The tapes can be grouped in folders, kept in videos/reels/folders.json. A folder only groups: a tape's
// own files never move, and deleting a folder puts what was in it one level up.
const FOLDER_COLORS = { red: "#ff5d5d", amber: "#ffb020", gold: "#f2c744", green: "#3ddc84", teal: "#9fd8c8", blue: "#6aa8ff", purple: "#b58cff" };
const libFolder = (id) => state.lib.folders.find((f) => f.id === id);
const folderOf = (tape) => state.lib.tapes[tape] || null;
const byName = (a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
const subFolders = (lib, parent) => lib.folders.filter((f) => f.parent === parent).sort(byName);
const tapesIn = (lib, fid) => state.sources.filter((s) => (lib.tapes[s.id] || null) === fid);
const tapeCount = (lib, fid) => tapesIn(lib, fid).length + subFolders(lib, fid).reduce((n, f) => n + tapeCount(lib, f.id), 0);
const cloneLib = () => JSON.parse(JSON.stringify(state.lib));
const nameTaken = (lib, parent, name, except) => lib.folders.some((f) => f.parent === parent && f.id !== except && f.name.toLowerCase() === name.toLowerCase());

// Whether folder `id` is `ancestor` or somewhere inside it.
function insideOf(lib, id, ancestor) {
  for (let at = id, steps = 0; at && steps <= lib.folders.length; at = (lib.folders.find((f) => f.id === at) || {}).parent, steps++)
    if (at === ancestor) return true;
  return false;
}

function freeName(lib, parent, name, except) {
  let out = name;
  for (let i = 2; nameTaken(lib, parent, out, except); i++) out = `${name} ${i}`;
  return out;
}

// Saves the new grouping; the sidebar shows it straight away and goes back if the save fails.
// Saves go one after another, in the order they were made, and only the newest one's answer is shown,
// so two quick clicks can never leave an older state on screen or on disk.
let libSaves = Promise.resolve(), libSeq = 0;
function saveLib(next, done) {
  const before = state.lib, seq = ++libSeq;
  state.lib = next;
  renderSources();
  libSaves = libSaves.then(async () => {
    try {
      const saved = await api("/api/folders", "PUT", next);
      if (seq === libSeq) state.lib = saved;
      if (done) toast(done);
    } catch (e) {
      if (seq === libSeq) state.lib = before;
      toast(e.message, true);
    }
    if (seq === libSeq) renderSources();
  });
  return libSaves;
}

function newFolder(parent) {
  const lib = cloneLib();
  const id = "F" + (Math.max(0, ...lib.folders.map((f) => +f.id.slice(1) || 0)) + 1);
  lib.folders.push({ id, name: freeName(lib, parent, "New folder"), parent, color: null, open: true });
  if (parent) lib.folders.find((f) => f.id === parent).open = true;
  state.lib = lib;   // saved once it is named
  state.freshFolder = id;
  startRename(id);
}

function startRename(id) {
  state.renaming = id;
  renderSources(true);
}

// keep: Enter or clicking away; otherwise Escape. Escape on a folder just made removes it again.
function endRename(id, value, keep) {
  if (state.renaming !== id) return;
  state.renaming = null;
  const fresh = state.freshFolder === id;
  state.freshFolder = null;
  const drop = () => { state.lib = { ...state.lib, folders: state.lib.folders.filter((f) => f.id !== id) }; };
  const f = libFolder(id), name = value.trim().slice(0, 60);
  if (!f || !keep || !name) {
    if (fresh) drop();
    return renderSources();
  }
  if (nameTaken(state.lib, f.parent, name, id)) {
    toast(`There is already a folder called "${name}" there`, true);
    if (fresh) drop();
    return renderSources();
  }
  if (!fresh && name === f.name) return renderSources();
  const lib = cloneLib();
  lib.folders.find((x) => x.id === id).name = name;
  if (fresh) drop();   // if the save fails, the unsaved folder goes too
  saveLib(lib, fresh ? `Folder "${name}" made` : null);
}

function setFolderColor(id, color) {
  const lib = cloneLib();
  lib.folders.find((x) => x.id === id).color = color;
  saveLib(lib);
}

function moveTapes(ids, fid) {
  const lib = cloneLib();
  for (const id of ids) fid ? (lib.tapes[id] = fid) : delete lib.tapes[id];
  if (fid) lib.folders.find((f) => f.id === fid).open = true;
  state.picked.clear();
  saveLib(lib, `${ids.length === 1 ? "Tape" : `${ids.length} tapes`} moved to ${fid ? `"${libFolder(fid).name}"` : "the top"}`);
}

function moveFolder(id, parent) {
  const f = libFolder(id);
  if (!f || f.parent === parent) return;
  if (parent && insideOf(state.lib, parent, id)) return toast("A folder cannot go inside itself", true);
  if (nameTaken(state.lib, parent, f.name, id)) return toast(`There is already a folder called "${f.name}" there`, true);
  const lib = cloneLib();
  lib.folders.find((x) => x.id === id).parent = parent;
  if (parent) lib.folders.find((x) => x.id === parent).open = true;
  saveLib(lib, `Folder moved to ${parent ? `"${libFolder(parent).name}"` : "the top"}`);
}

// Nothing in it is deleted: its tapes and folders move up one level.
function deleteFolder(id) {
  const f = libFolder(id);
  if (!f) return;
  const lib = cloneLib();
  lib.folders = lib.folders.filter((x) => x.id !== id);
  for (const sub of lib.folders.filter((x) => x.parent === id)) {
    sub.parent = f.parent;
    sub.name = freeName(lib, f.parent, sub.name, sub.id);
  }
  for (const [tape, fid] of Object.entries(lib.tapes)) if (fid === id) f.parent ? (lib.tapes[tape] = f.parent) : delete lib.tapes[tape];
  saveLib(lib, `Folder "${f.name}" deleted; what was in it moved up`);
}

function setFavorite(ids, on) {
  const lib = cloneLib();
  lib.favorites = on ? [...new Set([...lib.favorites, ...ids])] : lib.favorites.filter((t) => !ids.includes(t));
  saveLib(lib, on ? "Added to favorites" : "Removed from favorites");
}

// Ctrl+click ticks or unticks a tape; Shift+click ticks every tape from the last one to this one.
function pickTape(id, e) {
  const order = state.tapeOrder, anchor = state.pickAnchor || state.id;
  if (e.shiftKey && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    order.slice(a, b + 1).forEach((t) => state.picked.add(t));
  } else {
    state.picked.has(id) ? state.picked.delete(id) : state.picked.add(id);
    state.pickAnchor = id;
  }
  renderSources();
}

// -------- dragging: a tape (or the ticked ones) or a folder, onto a folder, Favorites or the Sources heading

function startDrag(e, drag) {
  e.stopPropagation();
  closeMenu();
  state.drag = drag;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(drag.tapes ? "application/x-link-tapes" : "application/x-link-folder", JSON.stringify(drag));
  const sel = drag.tapes ? drag.tapes.map((t) => `#main .lib-tape[data-id="${t}"]`) : [`#main [data-folder="${drag.folder}"]`];
  requestAnimationFrame(() => document.querySelectorAll(sel.join(",")).forEach((n) => n.classList.add("dragging")));
}

function endDrag() {
  if (!state.drag) return;
  state.drag = null;
  document.querySelectorAll("#main .dragging, #main .drop, #sources .drop").forEach((n) => n.classList.remove("dragging", "drop"));
  if (state.sourcesStale) renderSources();
}

// target: a folder id, null for the top level, "fav" for Favorites.
function canDrop(target) {
  const drag = state.drag;
  if (!drag) return false;
  if (drag.folder) return target !== "fav" && (target === null || !insideOf(state.lib, target, drag.folder));
  return true;
}

function dropTarget(node, target) {
  node.addEventListener("dragover", (e) => {
    if (!canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    node.classList.add("drop");
  });
  node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("drop"); });
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = state.drag, ok = canDrop(target);
    endDrag();
    if (!drag || !ok) return;
    if (drag.folder) moveFolder(drag.folder, target);
    else if (target === "fav") setFavorite(drag.tapes, true);
    else moveTapes(drag.tapes, target);
  });
  return node;
}

// -------- the right-click menu

// One menu on the page, kept over the sidebar: the Studio's browser panel is drawn above the page
// and would hide any part of it that reached over the Studio.
function openMenu(x, y, items) {
  const menu = $("ctx");
  put(menu, items.filter(Boolean).map(menuItem));
  menu.hidden = false;
  const side = $("sources").getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, (state.library ? innerWidth : side.right) - menu.offsetWidth - 6)) + "px";
  menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 6)) + "px";
}

function menuAt(node, items) {
  const r = node.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, items);
}

function closeMenu() {
  const menu = $("ctx");
  if (menu && !menu.hidden) menu.hidden = true;
}

// An item is "-" (a line), {title}, {colors: folder id} or {label, run, keep, confirm}.
function menuItem(item) {
  if (item === "-") return el("div", { class: "sep" });
  if (item.title) return el("div", { class: "ctx-title" }, item.title);
  if (item.colors) {
    const f = libFolder(item.colors);
    return el("div", { class: "dots" }, [null, ...Object.keys(FOLDER_COLORS)].map((c) =>
      el("button", { type: "button", class: "dot" + ((f && f.color || null) === c ? " on" : ""), "data-color": c || "", title: c ? c[0].toUpperCase() + c.slice(1) : "No colour",
        onclick: () => { closeMenu(); setFolderColor(item.colors, c); } })));
  }
  return el("button", { type: "button", class: item.confirm ? "danger" : "",
    onclick: (e) => {
      if (item.confirm) return twoStep(e.currentTarget, item.confirm, () => { closeMenu(); item.run(); });
      if (!item.keep) closeMenu();
      item.run();
    } }, item.label);
}

// "Move to": the top level and every folder, indented as in the sidebar. `skip` leaves out a folder
// and everything in it, so a folder is never offered a place inside itself.
function moveTargets(run, skip) {
  const items = [{ title: "Move to" }, { label: "⌂ Top level", run: () => run(null) }];
  const walk = (parent, depth) => subFolders(state.lib, parent).forEach((f) => {
    if (f.id === skip) return;
    items.push({ label: "\u00a0".repeat(depth * 3) + "▸ " + f.name, run: () => run(f.id) });
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  if (items.length === 2) items.push({ title: "No folders yet" });
  return items;
}

function tapeMenu(e, s) {
  e.preventDefault();
  const ids = state.picked.has(s.id) ? [...state.picked] : [s.id];
  const fav = ids.every((t) => state.lib.favorites.includes(t));
  openMenu(e.clientX, e.clientY, [
    { title: ids.length > 1 ? `${ids.length} tapes` : sourceTitle(s) },
    { label: fav ? "☆ Remove from favorites" : "★ Add to favorites", run: () => setFavorite(ids, !fav) },
    ids.length === 1 && { label: "Rename", run: () => nameTape(s.id) },
    { label: "Move to…", keep: true, run: () => openMenu(e.clientX, e.clientY, moveTargets((fid) => moveTapes(ids, fid))) },
    ids.some(folderOf) && { label: "Back to recent tapes", run: () => moveTapes(ids, null) },
    "-",
    { label: ids.length > 1 ? `Delete ${ids.length} tapes` : "Delete tape", confirm: "Press again: to the Recycle Bin", run: () => deleteTapes(ids, false) },
    ids.some((t) => (state.sources.find((x) => x.id === t) || {}).recording)
      && { label: ids.length > 1 ? "Delete tapes and their recordings" : "Delete tape and its recording", confirm: "Press again: both to the Recycle Bin", run: () => deleteTapes(ids, true) },
  ]);
}

// A tape's folder and its copy of the video go to Windows' Recycle Bin (with `recording`, the
// recording in the Videos folder too). The reels already finished from it stay in Finals.
async function deleteTapes(ids, recording) {
  let gone = 0;
  for (const id of ids) {
    try {
      await api(`/api/sources/${id}/delete`, "POST", { recording });
      gone++;
    } catch (e) {
      toast(e.message, true);
      break;
    }
  }
  state.picked.clear();
  if (ids.includes(state.id)) Object.assign(state, { id: null, detail: null, draft: null, open: null, reel: null });
  await refreshSources();
  renderAll();
  if (gone) toast(`${gone === 1 ? "Tape" : `${gone} tapes`} moved to the Recycle Bin${recording ? ", with the recording" : ""}`);
}

function folderMenu(e, f) {
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [
    { title: f.name },
    { label: "Rename", run: () => startRename(f.id) },
    { label: "New folder inside", run: () => newFolder(f.id) },
    { colors: f.id },
    "-",
    { label: "Move to…", keep: true, run: () => openMenu(e.clientX, e.clientY, moveTargets((p) => moveFolder(f.id, p), f.id)) },
    f.parent && { label: "Move to top level", run: () => moveFolder(f.id, null) },
    "-",
    { label: "Delete folder", confirm: "Press again: its tapes move up", run: () => deleteFolder(f.id) },
  ]);
}

async function select(id) {
  if (id !== state.id) Object.assign(state, { draft: null, open: null, cut: null, reel: null, capSel: null, stretch: { at: null, in: null, out: null } });
  state.studio = state.analytics = state.library = false;
  state.settings = null;
  state.id = id;
  state.detail = await api(`/api/sources/${id}`);
  if (!state.draft) rebase(state.detail.version);
  renderAll();
}

// ---- a tape's own name

// The pencil after a tape's name (or Rename in its menu) turns the name into a field: Enter or a click
// elsewhere keeps it, Escape leaves it as it was, an empty name goes back to the date.
function tapeNameField(s) {
  let done = false;
  const end = async (keep, value) => {
    if (done) return;
    done = true;
    state.naming = null;
    const name = value.trim();
    if (keep && name !== (s.name || "")) {
      try {
        await api(`/api/sources/${s.id}/name`, "POST", { name });
        await refreshSources();
        return toast(name ? "Renamed" : "Back to its date");
      } catch (e) {
        toast(e.message, true);
      }
    }
    renderAll();
  };
  return el("input", { class: "tape-name", value: s.name || "", placeholder: sourceTitle({ ...s, name: null }), maxLength: 80, spellcheck: false,
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") end(true, e.target.value); if (e.key === "Escape") end(false, ""); },
    onblur: (e) => end(true, e.target.value) });
}

function nameTape(id) {
  state.naming = id;
  renderAll();
  const field = document.querySelector("#main input.tape-name");
  if (field) { field.focus(); field.select(); }
}

const pencil = (s) => el("button", { class: "pencil", type: "button", title: "Rename this tape", onclick: (e) => { e.stopPropagation(); nameTape(s.id); } }, svg(ICONS.pencil));

// ---------------------------------------------------------------- the Sources screen

// Every tape and folder, in the main area. Two looks, switched with "Change grid": the list by day
// (the usual one) and a shelf of cards. Both show the same tapes: the chosen folder's (with the
// folders inside it), narrowed by the search and the filter, in the chosen order.
const LIB_SORTS = { new: "Newest", long: "Longest", cand: "Most candidates" };
const todoOf = (s) => (s.reels || 0) - (s.rendered || 0);
const folderPath = (id) => { const out = []; for (let f = libFolder(id); f; f = libFolder(f.parent)) out.unshift(f); return out; };
// With no folder chosen the screen shows the recent tapes: the ones not filed in a folder yet. A tape
// moved into a folder is found there from then on. A search or a filter looks through every tape.
const libWide = () => state.libFolder == null && (state.libSearch.trim() !== "" || state.libFilter !== "all");
const inChosen = (s) => {
  const at = folderOf(s.id), want = state.libFolder;
  return want == null ? !at || libWide() : !!at && insideOf(state.lib, at, want);
};

function showSources() {
  state.library = true;
  state.studio = state.analytics = false;
  state.settings = null;
  state.pickerOpen = false;
  if (state.libFolder && !libFolder(state.libFolder)) state.libFolder = null;
  renderAll();
}

function setLib(change) {
  Object.assign(state, change);
  try { localStorage.setItem("link.sourcesView", state.libView); } catch (e) { /* not remembered, nothing worse */ }
  renderLibrary();
}

function libTapes() {
  const q = state.libSearch.trim().toLowerCase();
  const list = state.sources.filter((s) => inChosen(s)
    && (state.libFilter !== "fav" || state.lib.favorites.includes(s.id)) && (state.libFilter !== "todo" || todoOf(s) > 0)
    && (!q || [sourceTitle(s), s.id, s.file, ...folderPath(folderOf(s.id)).map((f) => f.name)].join(" ").toLowerCase().includes(q)));
  const by = { new: (s) => s.started || s.made || "", long: (s) => s.duration || 0, cand: (s) => s.candidates || 0 }[state.libSort];
  return list.sort((a, b) => (by(b) > by(a) ? 1 : by(b) < by(a) ? -1 : b.id.localeCompare(a.id)));
}

// What is left to do on a tape, in a word and a colour.
function tapeState(s, brief = false) {
  if (!s.reels) return { cls: "none", text: "NO REELS YET" };
  return todoOf(s) > 0 ? { cls: "todo", text: `${s.rendered}/${s.reels}${brief ? "" : " REELS"} · ${todoOf(s)} TO RENDER` } : { cls: "done", text: `${s.rendered}/${s.reels} REELS · DONE` };
}

// A folder's name, or the field it is being named in.
function folderName(f) {
  if (state.renaming !== f.id) return el("span", { class: "fname", title: f.name }, f.name);
  return el("input", { class: "rename", value: f.name, maxLength: 60, spellcheck: false, onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => {
      if (e.key === "Enter") endRename(f.id, e.target.value, true);
      if (e.key === "Escape") endRename(f.id, e.target.value, false);
    },
    onblur: (e) => endRename(f.id, e.target.value, true) });
}

// What a tape does in either look: a click opens it, Ctrl or Shift ticks it, it can be dragged onto
// a folder, and a right-click has the rest.
function tapeHandle(node, s) {
  node.draggable = true;
  node.onclick = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return pickTape(s.id, e);
    state.picked.clear();
    state.library = false;
    select(s.id);
  };
  node.addEventListener("dragstart", (e) => startDrag(e, { tapes: state.picked.has(s.id) ? [...state.picked] : [s.id] }));
  node.addEventListener("contextmenu", (e) => tapeMenu(e, s));
  return node;
}

const tapeStar = (s) => {
  const on = state.lib.favorites.includes(s.id);
  return el("button", { class: "lib-star" + (on ? " on" : ""), type: "button", title: on ? "Remove from favorites" : "Add to favorites",
    onclick: (e) => { e.stopPropagation(); setFavorite([s.id], !on); } }, "★");
};
const tapeMore = (s) => el("button", { class: "lib-more", type: "button", title: "Favorite, move to a folder…",
  onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); tapeMenu({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 4 }, s); } }, "⋯");
const tapeKind = (s) => el("span", { class: s.mode === "stream" ? "k-stream" : "k-video" }, s.mode === "stream" ? "STREAM" : "VIDEO");
const tapeFolder = (s) => { const f = libFolder(folderOf(s.id)); return f ? el("span", { class: "k-folder", "data-color": f.color || "" }, f.name.toUpperCase()) : null; };
// Eight frames of the whole tape, made by the server the first time it is asked for.
const tapeStrip = (s, cls) => el("div", { class: cls, style: `--strip:url(/strip/${s.id}.jpg)` }, el("i", {}), cls === "lib-shot" ? el("i", {}) : null);

function tapeRow(s) {
  const st = tapeState(s), time = (s.started || s.made || "").slice(11, 16);
  return tapeHandle(el("div", { class: `lib-row lib-tape ${st.cls}` + (state.picked.has(s.id) ? " picked" : ""), "data-id": s.id, title: s.file },
    tapeStar(s),
    el("div", { class: "who" }, state.naming === s.id ? tapeNameField(s) : el("div", { class: "name" }, el("span", { class: "clip" }, sourceTitle(s)), pencil(s)),
      el("div", { class: "facts clip" }, el("b", {}, s.id), time ? ` · ${time} · ` : " · ", tapeKind(s), ` · ${span(s.duration).toUpperCase()} · ${s.candidates} CAND`,
        s.marked ? ` · ${s.marked}★` : "", tapeFolder(s) ? [" · ", tapeFolder(s)] : null)),
    tapeStrip(s, "lib-strip"),
    el("div", { class: "state" }, el("i", {}), st.text),
    el("div", { class: "acts" }, tapeMore(s), el("button", { class: "btn small ghost", type: "button" }, "Open"))), s);
}

function tapeCard(s) {
  const st = tapeState(s, true);
  return tapeHandle(el("div", { class: `lib-card lib-tape ${st.cls}` + (state.picked.has(s.id) ? " picked" : ""), "data-id": s.id, title: s.file },
    tapeStrip(s, "lib-shot"),
    tapeFolder(s) && folderOf(s.id) !== state.libFolder ? el("div", { class: "where" }, tapeFolder(s)) : null,
    el("div", { class: "label" }, el("span", {}, s.id), el("span", {}, tapeKind(s), ` · ${span(s.duration).toUpperCase()}`)),
    el("div", { class: "name" }, state.naming === s.id ? tapeNameField(s) : [el("span", { class: "clip" }, sourceTitle(s)), pencil(s)], tapeStar(s), tapeMore(s)),
    el("div", { class: "facts" }, el("span", {}, el("b", {}, String(s.candidates)), " CAND"), el("span", {}, el("b", {}, String(s.marked || 0)), " ★"), el("span", { class: "state" }, st.text)),
    el("div", { class: "bar" }, el("i", { style: `width:${s.reels ? Math.round(100 * s.rendered / s.reels) : 0}%` }))), s);
}

// A folder as a card in the grid: a click goes into it.
function folderCard(f) {
  const lib = state.lib, tapes = state.sources.filter((s) => folderOf(s.id) && insideOf(lib, folderOf(s.id), f.id));
  const subs = subFolders(lib, f.id).length, todo = tapes.filter((s) => todoOf(s) > 0).length;
  const card = el("div", { class: "lib-folder", "data-folder": f.id, "data-color": f.color || "", draggable: state.renaming !== f.id,
    onclick: () => { if (state.renaming !== f.id) setLib({ libFolder: f.id }); }, oncontextmenu: (e) => folderMenu(e, f) },
    el("div", { class: "tab" }),
    el("div", { class: "in" }, svg(ICONS.tape), el("div", { class: "txt" }, folderName(f),
      el("div", { class: "n" }, many(tapes.length, "tape").toUpperCase() + (subs ? ` · ${many(subs, "folder").toUpperCase()}` : ""))),
      todo ? el("span", { class: "todo" }, `${todo} TO RENDER`) : null, el("span", { class: "go" }, "▸")));
  card.addEventListener("dragstart", (e) => startDrag(e, { folder: f.id }));
  return dropTarget(card, f.id);
}

// The folders as a row of chips above the list; the ones inside another follow it, marked ↳.
function folderChips() {
  const lib = state.lib, chips = [];
  const count = (f) => state.sources.filter((s) => folderOf(s.id) && insideOf(lib, folderOf(s.id), f.id));
  const walk = (parent, depth) => subFolders(lib, parent).forEach((f) => {
    const tapes = count(f), todo = tapes.some((s) => todoOf(s) > 0);
    const chip = el("span", { class: "chip" + (state.libFolder === f.id ? " on" : "") + (depth ? " sub" : ""), "data-folder": f.id, "data-color": f.color || "", draggable: state.renaming !== f.id,
      title: "Click to show only this folder. Right-click to rename, colour or delete it. Drop tapes on it to file them.",
      onclick: () => { if (state.renaming !== f.id) setLib({ libFolder: state.libFolder === f.id ? null : f.id }); }, oncontextmenu: (e) => folderMenu(e, f) },
      depth ? "↳ " : null, folderName(f), el("em", { class: todo ? "todo" : "" }, String(tapes.length)));
    chip.addEventListener("dragstart", (e) => startDrag(e, { folder: f.id }));
    chips.push(dropTarget(chip, f.id));
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  return el("div", { class: "lib-chips" }, el("span", { class: "lead" }, "FOLDER"),
    dropTarget(el("span", { class: "chip" + (state.libFolder == null ? " on" : ""), title: "The tapes not filed in a folder yet. Drop a tape or folder here to take it out of its folder.", onclick: () => setLib({ libFolder: null }) },
      "RECENT ", el("em", {}, String(state.sources.filter((s) => !folderOf(s.id)).length))), null),
    chips,
    el("button", { class: "chip new", type: "button", title: "New folder", onclick: () => newFolder(null) }, "+ NEW"));
}

// The tapes under day headings: TODAY, YESTERDAY, then the date.
function byDay(tapes) {
  const days = new Map();
  tapes.forEach((s) => { const day = (s.started || s.made || "").slice(0, 10) || "?"; days.set(day, [...(days.get(day) || []), s]); });
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = iso(new Date()), yesterday = iso(new Date(Date.now() - 86400000));
  return [...days].map(([day, list]) => {
    const d = new Date(day + "T12:00"), known = !Number.isNaN(d.getTime());
    const long = known ? `${d.getDate()} ${d.toLocaleString("en", { month: "long" })}${d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`}`.toUpperCase() : "NO DATE";
    const todo = list.filter((s) => s.reels && todoOf(s) > 0).length, none = list.filter((s) => !s.reels).length;
    return [el("div", { class: "lib-day" },
      el("b", {}, day === today ? "TODAY" : day === yesterday ? "YESTERDAY" : long),
      el("span", {}, `${day === today || day === yesterday ? `${long} · ` : ""}${many(list.length, "tape").toUpperCase()}`), el("i", {}),
      el("em", { class: todo ? "todo" : none ? "none" : "done" }, todo ? `${todo} TO RENDER` : none ? `${none} WITHOUT REELS` : "ALL DONE")),
      list.map(tapeRow)];
  });
}

function renderLibrary() {
  if (!state.library) return;
  const lib = state.lib, grid = state.libView === "grid", all = state.sources;
  const tapes = libTapes(), todo = all.filter((s) => todoOf(s) > 0).length;
  state.tapeOrder = tapes.map((s) => s.id);   // for Shift+click
  const search = document.querySelector("#main .lib-search input"), typing = search && document.activeElement === search ? [search.selectionStart, search.selectionEnd] : null;
  const here = state.libFolder ? folderPath(state.libFolder) : [];
  const days = new Set(all.map((s) => (s.started || s.made || "").slice(0, 10))).size;
  const seg = (key, label, extra) => el("button", { type: "button", class: state.libFilter === key ? "on" : "", onclick: () => setLib({ libFilter: key }) }, label, extra);
  const narrowed = state.libSearch.trim() || state.libFilter !== "all";
  const subs = grid ? subFolders(lib, state.libFolder) : [];
  const crumb = (label, target, last) => el("span", { class: "crumb" + (last ? " last" : ""), onclick: () => setLib({ libFolder: target }) }, label);
  drawMain(
    el("div", { class: "head-row" },
      el("div", { style: "min-width:0;flex:1" }, el("h1", {}, "Sources"),
        el("div", { class: "sub clip" }, grid
          ? [dropTarget(crumb(libWide() ? "EVERY TAPE" : "RECENT TAPES", null, state.libFolder == null), null), here.map((f, i) => [" ▸ ", dropTarget(crumb(f.name.toUpperCase(), f.id, i === here.length - 1), f.id)]),
             ` · ${many(tapes.length, "tape").toUpperCase()}`]
          : [`${many(all.length, "tape").toUpperCase()} · ${many(days, "day").toUpperCase()}`, todo ? [" · ", el("span", { class: "amber" }, `${todo} NEED${todo === 1 ? "S" : ""} RENDERING`)] : null])),
      // In the corner: the look (list or grid) and, in gold, a new folder.
      el("div", { class: "lib-corner" },
        el("button", { class: "btn lib-sq lib-view", type: "button", ariaLabel: "Change grid", title: grid ? "Change grid: back to the list by day" : "Change grid: show the tapes as a shelf of cards", onclick: () => setLib({ libView: grid ? "day" : "grid" }) },
          el("span", { class: "ico " + (grid ? "rows" : "cells") }, el("i", {}), el("i", {}), el("i", {}), el("i", {}))),
        el("button", { class: "btn lib-sq lib-new", type: "button", ariaLabel: "New folder", title: "New folder", onclick: () => newFolder(grid && here.length ? state.libFolder : null) }, svg(ICONS.folderPlus)))),
    el("div", { class: "head-rule" }),
    el("div", { class: "lib-tools" },
      el("label", { class: "lib-search" }, svg(ICONS.search || ICONS.link), el("input", { type: "search", placeholder: "Search tapes, ids, folders", value: state.libSearch, spellcheck: false,
        oninput: (e) => setLib({ libSearch: e.target.value }) })),
      el("div", { class: "lib-seg" }, seg("all", "ALL"), seg("fav", "★ FAVOURITES"), seg("todo", "HAS UNRENDERED ", todo ? el("em", {}, String(todo)) : null)),
      el("span", { style: "flex:1" }),
      el("button", { class: "lib-sort", type: "button", onclick: (e) => menuAt(e.currentTarget, [{ title: "Sort by" }, ...Object.entries(LIB_SORTS).map(([key, label]) =>
        ({ label: (state.libSort === key ? "● " : "○ ") + label, run: () => setLib({ libSort: key }) }))]) }, "SORT ", el("b", {}, `${LIB_SORTS[state.libSort].toUpperCase()} ▾`))),
    grid ? null : folderChips(),
    state.picked.size ? el("div", { class: "sel-bar" },
      el("span", { class: "n" }, `${state.picked.size} selected`),
      el("button", { class: "btn small", type: "button", onclick: (e) => menuAt(e.currentTarget, moveTargets((fid) => moveTapes([...state.picked], fid))) }, "Move to…"),
      el("button", { class: "btn ghost small", type: "button", onclick: () => { state.picked.clear(); renderLibrary(); } }, "Clear")) : null,
    subs.length ? [el("div", { class: "kicker" }, `Folders — ${subs.length}`), el("div", { class: "lib-folders" }, subs.map(folderCard))] : null,
    !all.length ? emptyState("No tapes yet", "Record a stream in the Studio or a video in URL, then press Process recording. Each recording becomes a tape here.", el("div", { class: "tv tall" }, "NO TAPE"))
      : !tapes.length ? el("div", { class: "lib-none" }, narrowed ? "No tape matches. " : state.libFolder ? "This folder is empty. Drag tapes onto it. " : "Every tape is filed in a folder. New recordings show up here. ",
          narrowed ? el("button", { class: "btn small ghost", type: "button", onclick: () => setLib({ libSearch: "", libFilter: "all" }) }, "Clear the filters") : null)
      : grid ? [el("div", { class: "kicker" }, `${state.libFolder ? "Tapes" : libWide() ? "Every tape" : "Recent tapes"} — ${tapes.length}`), el("div", { class: "lib-grid" }, tapes.map(tapeCard))]
      : state.libSort === "new" ? byDay(tapes) : [el("div", { class: "lib-day" }, el("b", {}, LIB_SORTS[state.libSort].toUpperCase() + " FIRST"), el("span", {}, many(tapes.length, "tape").toUpperCase()), el("i", {})), tapes.map(tapeRow)]);
  $("main").classList.add("lib");
  const input = document.querySelector("#main input.rename");
  if (state.renaming && input) { input.focus(); input.select(); }
  else if (typing) { const again = document.querySelector("#main .lib-search input"); again.focus(); again.setSelectionRange(...typing); }
  renderDialogue();
}

// ---------------------------------------------------------------- main frame

function renderAll() {
  state.sig = {};
  markDirty();
  renderPills();   // which streams need a pill depends on the screen being shown
  renderSources();
  renderMain();
  if (state.status) renderHud();
  $("btn-settings").classList.toggle("on", !!state.settings);
}

function emptyState(title, text, extra) {
  return el("div", { class: "empty-state" }, extra, el("h2", {}, title), text && el("p", {}, text));
}

// ---------------------------------------------------------------- settings

// The gear at the end of the top bar opens Link's settings: the sections in a list on the left, the
// chosen one beside it. Each thing here is kept by the part of Link it belongs to: the server
// (processing, the Instagram page), Link's window (recording, the ad blocker) and the mixer (sound).
// The sections of the Settings screen, in the order of its list.
const SETTINGS = [["general", "General"], ["accounts", "Accounts"], ["audio", "Audio"], ["recording", "Recording"], ["storage", "Storage"], ["learning", "Learning"], ["about", "About"]];
// Settings > Storage: each part of Link on the drive's bar, in its own colour, and the folder Link's window may open for it.
const STORE = {
  recordings: { color: "#ff5d5d", open: "recordings", what: "What you recorded, in your Videos folder. A tape's video is the same file, counted once." },
  tapes: { color: "#f2c744", open: "tapes", what: "What Link knows about each tape, and the video of a tape whose recording is gone." },
  finals: { color: "#3ddc84", open: "finals", what: "The reels you rendered, ready to post." },
  working: { color: "#4da6ff", open: "tapes", what: "Clips, strips and previews Link made to show things quickly. It makes them again when needed." },
  data: { color: "#b58cff", open: "data", what: "Sign-ins, settings, the log, and the built-in browser's cache." },
  program: { color: "#9fd8c8", what: "The speech model, the window, and the rest of the program." },
};
const settingsMixer = el("div", { class: "settings-mixer" });
let mixer = null;   // the mixer drawn in Settings > Audio, while that section shows

function showSettings(section) {
  state.settings = SETTINGS.some(([key]) => key === section) ? section : state.settings || "general";
  state.studio = state.analytics = state.library = false;
  state.pickerOpen = false;
  renderAll();
  if (!state.about) loadAbout();
  if (state.settings === "accounts") loadAccounts();
  if (state.settings === "storage") loadStorage();
  if (state.settings === "learning") loadLearned();
}

// What Link learned about which moments become reels (tools/reels/learn.py). It learns again by
// itself when the library has new answers: a reel made, a candidate dismissed.
async function loadLearned(again = false) {
  let known = await api("/api/learned").catch((e) => ({ error: e.message }));
  if (!known.error && (again || known.due) && !state.learning) {
    state.learning = true;
    if (state.settings === "learning") { state.sig.settings = ""; renderMain(); }
    known = await api("/api/learn", "POST", {}).catch((e) => ({ ...known, error: e.message }));
    state.learning = false;
    // The open tape's candidates get their new picks, without leaving the screen the user is on
    // (select() would open the tape, and so throw the user out of Settings).
    if (state.detail) {
      const fresh = await api(`/api/sources/${state.detail.id}`).catch(() => null);
      if (fresh && state.detail && fresh.id === state.detail.id && !state.draft) state.detail = fresh;
    }
  }
  state.learned = known;
  if (state.settings === "learning") { state.sig.settings = ""; renderMain(); }
}

function learningSection(row) {
  const k = state.learned;
  if (!k) return el("div", { class: "panel set-panel" }, row("Learning", el("span", {}, "Looking…")));
  const pct = (v) => `${Math.round(100 * v)}%`;
  const meter = (label, v, cls) => el("div", { class: "learn-meter" }, el("span", {}, label), el("i", {}, el("b", { class: cls, style: `width:${Math.round(100 * v)}%` })), el("em", {}, pct(v)));
  const when = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const again = el("button", { class: "btn small", disabled: !!state.learning, onclick: () => loadLearned(true) }, state.learning ? "Learning…" : "Learn again now");
  return [
    el("div", { class: "notice" + (k.trusted ? " good" : "") },
      el("div", { class: "pix" }, k.error ? "LEARNING FAILED" : k.trusted ? "LINK USES WHAT IT LEARNED" : "LINK IS STILL LEARNING"),
      el("div", {}, k.error || k.why || "Nothing learned yet.")),
    el("div", { class: "panel set-panel" },
      row("What it learns from", [el("span", {}, `${k.reels || 0} reels on ${k.tapes || 0} tapes · ${k.examples || 0} moments with an answer`), again],
        "Two things: where to cut, from how you trim a reel's In and Out; and which moments to offer first, from the candidates you make reels of, mark or dismiss (Del in Candidates). It goes by sound, movement, chat and the shape of the moment, not by the picture and not by the words."),
      row("How a reel is cut", el("select", { onchange: async (e) => { state.status = { ...state.status, ...(await api("/api/settings", "POST", { cut: e.target.value })) }; toast("New reels are cut that way from now on"); } },
          [["tight", "Tight: only the moment, from where it builds to where it dies down"], ["balanced", "Balanced: the candidate's stretch (as before)"], ["airy", "Airy: 4 s more before and 2 s more after, room to breathe"]]
            .map(([v, label]) => el("option", { value: v, selected: ((state.status || {}).cut || "balanced") === v }, label))),
        "For a reel made from a candidate. In every style each end is put on a scene cut if one is within a second, else in a pause of the sound, so nothing is chopped mid-sound. You can still move In and Out by hand."),
      k.input && row("What Link has to go on", el("span", {}, [`${k.input.reels} reels`, `${k.input.trimmed} trimmed by hand`, `${k.input.watched} candidates watched`, `${k.input.dismissed} dismissed`,
          `${k.input.removed} reels removed`, `${k.input.posted} posted`].join(" · ")),
        "Link notes these as you work, without being told: what you watch and pass over, what you trim, what you throw out, what you post. The more there is, the surer what it learns."),
      k.walkthrough && row("Last walkthrough", el("div", { class: "learn-signs" },
          el("div", { class: k.walkthrough.failed.length ? "no" : "yes" }, el("b", {}, k.walkthrough.failed.length ? "−" : "+"),
            `${k.walkthrough.passed} of ${k.walkthrough.steps} steps passed${k.walkthrough.at ? ` · ${new Date(k.walkthrough.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${k.walkthrough.minutes ? ` · ${k.walkthrough.minutes} min` : ""}`),
          k.walkthrough.failed.map((f) => el("div", { class: "no" }, el("b", {}, "−"), `${f.step}: ${f.saw}`)),
          k.walkthrough.findings.map((f) => el("div", {}, f))),
        `A test run of Link from recording to rendered reel, written down in videos/walkthroughs. Link reads it by itself: the ${k.walkthrough.tapes.length} tapes it made (${k.walkthrough.tapes.join(", ")}) are left out of what Link learns from, since their reels and trims were a test's and not yours.`),
      k.cutting && row("Cutting", el("div", { class: "learn-signs" }, k.cutting.says.map((s) => el("div", {}, s))),
        `Where a reel starts and ends. ${k.cutting.moved} of ${k.cutting.reels} reels had their cut moved by hand; the rest were kept as Link cut them. When you keep moving cuts the same way, Link cuts that way itself.`),
      k.check && row("Finding: the check", el("div", { class: "learn-meters" },
          meter("Learned order", k.check.learned.found, "new"), meter("Old order", k.check.old.found, "old")),
        `Each tape is left out in turn and Link, taught on the others, ranks its candidates. This is how many of that tape's reels were among the first 5. The learned order is used only when it does at least as well as the old one.`),
      (k.signs || []).length ? row("Finding: what it sees in your reels", el("div", { class: "learn-signs" },
          k.signs.map((s) => el("div", { class: s.weight > 0 ? "yes" : "no" }, el("b", {}, s.weight > 0 ? "+" : "−"), s.says))),
        "The signs that count most, strongest first. None of them is what was said: loudness, movement, chat speed, the shape of the moment, and the sound itself.") : null,
      (k.history || []).length > 1 ? row("Over time", el("div", { class: "learn-history" },
          k.history.slice(-6).reverse().map((h) => el("div", {}, el("span", {}, when(h.at)), el("span", {}, `${h.reels} reels`), el("span", {}, `found ${pct(h.found)} (old ${pct(h.found_old)})`), el("span", { class: h.trusted ? "set-good" : "" }, h.trusted ? "used" : "not used")))),
        "Every time Link learned, and how the check went. More reels and more dismissals make it surer.") : null),
  ];
}

// How much room Link takes (tools/reels/storage.py). Measured again each time the section is opened;
// the server keeps a measurement for a minute. The hours of recording left go by the picture quality chosen.
async function loadStorage() {
  const mbit = ((state.shell || {}).quality || {}).video || 6;
  state.storage = await api(`/api/storage?mbit=${mbit}`).catch((e) => ({ error: e.message }));
  storageDot();
  if (state.settings === "storage") renderMain();
  return state.storage;
}

// The gear wears a red dot while room is running out, so it is seen from every screen.
function storageDot() {
  let dot = $("btn-settings").querySelector(".dot-new");
  if (!dot) $("btn-settings").append(dot = el("i", { class: "dot-new", hidden: true }));
  dot.hidden = !(state.storage && state.storage.level === "warn");
}

function storageSection(row) {
  const st = state.storage;
  if (!st || st.error) return el("div", { class: "panel set-panel" }, row("Storage", el("span", {}, st ? st.error : "Measuring…")));
  const d = st.drive, other = Math.max(0, d.total_bytes - d.free_bytes - st.link_bytes);
  const seg = (bytes, color, title, cls = "") => bytes > 0 && el("i", { class: cls, style: `flex:${bytes} 1 0;background:${color}`, title });
  const open = (key) => shell && shell.reveal && key && el("button", { class: "btn small ghost", onclick: async () => { if (!(await shell.reveal(key))) toast("That could not be opened", true); } }, "Open folder");
  return [
    st.level !== "fine" && el("div", { class: "notice" + (st.level === "warn" ? " bad" : "") },
      el("div", { class: "pix" }, st.level === "warn" ? "⚠ ROOM IS RUNNING OUT" : "LINK IS GETTING LARGE"),
      st.reasons.map((r) => el("div", {}, r))),
    el("div", { class: "panel set-panel" },
      el("div", { class: "store-top" },
        el("b", {}, `Link uses ${st.link}`),
        el("span", {}, `Drive ${d.name} ${d.free} free of ${d.total}`),
        el("span", {}, `Room for about ${st.hours >= 10 ? Math.round(st.hours) : st.hours} hours of recording`),
        // what the daily notes say (storage.py, trend): how fast it grows, and when the drive would be full
        el("span", {}, !st.trend ? `Link notes its size once a day; after ${st.tracked_days > 1 ? "a few more" : "a few"} days it says how fast it grows`
          : `${st.trend.growing ? `Link grows about ${st.trend.link_a_day} a day` : "Link is not growing"} · ${st.trend.filling
            ? `the drive fills by ${st.trend.free_a_day} a day${st.trend.days_left ? `, full in about ${st.trend.days_left} days` : ""}` : "the drive is not filling"} (last ${st.trend.over} days)`)),
      // the whole drive: Link's parts in colour, then everything else on it, then what is free
      el("div", { class: "store-bar" },
        st.parts.map((p) => seg(p.bytes, STORE[p.key].color, `${p.name}: ${p.size}`, "mine")),
        seg(other, "#3a4460", `Everything else on drive ${d.name}`),
        seg(d.free_bytes, "transparent", `Free: ${d.free}`)),
      el("div", { class: "store-key" }, el("span", {}, el("i", { style: "background:#3a4460" }), `Everything else on ${d.name}`), el("span", {}, el("i", { class: "free" }), `Free ${d.free}`)),
      // Link is a sliver of a big drive, so its parts are shown again against each other
      el("div", { class: "store-key plain" }, `Link's ${st.link}, part by part`),
      el("div", { class: "store-bar thin" }, st.parts.map((p) => seg(p.bytes, STORE[p.key].color, `${p.name}: ${p.size}`, "mine"))),
      st.parts.map((p) => el("div", { class: "set-row" }, el("span", { class: "store-dot", style: `background:${STORE[p.key].color}` }),
        el("div", { class: "set-label" }, p.name, el("div", { class: "help" }, STORE[p.key].what)),
        el("div", { class: "set-control" }, el("b", { class: "store-size" }, p.size), open(STORE[p.key].open)))),
      st.largest_tapes.length ? row("Heaviest tapes", el("span", {}, st.largest_tapes.map((t) => `${t.id} ${t.size}`).join(" · ")),
        "A tape with its recording. Delete one in Sources and both go to the Recycle Bin.") : null),
  ];
}

async function loadAbout() {
  try {
    state.about = { ...(await api("/api/about")), ...((shell && shell.about && (await shell.about())) || {}) };
    if (state.about.updated) toast(`Link updated itself to rwa-${state.about.updated}`);   // an installed Link does that when it starts (update.py)
  } catch (e) {
    state.about = { error: e.message, paths: {} };
  }
  if (state.settings) renderMain();
}

async function loadAccounts() {
  const [insta, spotify, youtube, kick] = await Promise.all(["instagram", "spotify", "youtube", "kick"].map((what) => api(`/api/${what}`).catch(() => null)));
  state.kick = kick;
  if (insta) state.insta = insta;
  if (youtube) state.yt = youtube;
  state.spotify = spotify;
  if (state.settings === "accounts") renderMain();
}

// Settings > Audio draws the mixer with its level meters; away from it the meters stop.
function watchMixer() {
  const on = !!(shell && shell.audio) && state.settings === "audio";
  if (on === !!mixer) return;
  if (on) {
    mixer = LinkMixer.mount(settingsMixer, shell.audio, { wide: true });
    mixer.update((state.shell || {}).audio);
  } else {
    mixer.destroy();
    mixer = null;
  }
  shell.audio.watch(on);
}

function renderSettings() {
  const sec = state.settings, s = state.shell || {}, st = state.status || {}, about = state.about || { paths: {} };
  // what each section shows; the page is drawn again only when that changes
  const seen = { general: [st.auto, s.ads, about.paths], recording: [s.quality, s.size, s.audio && s.audio.bits],
                 audio: [!!shell], accounts: [st.instagram, state.insta && state.insta.connected, state.yt && [state.yt.client, state.yt.connected], s.discord, state.spotify, state.kick], storage: [state.storage], learning: [state.learned, state.learning], about: [about] }[sec];
  const sig = JSON.stringify([sec, seen]);
  if (sig === state.sig.settings && $("settings-screen")) return;
  state.sig.settings = sig;
  // `icon`: one of ICONS, drawn before the row's name (the accounts have one each)
  const row = (label, control, help, icon) => el("div", { class: "set-row" }, icon && el("span", { class: "set-ico" }, svg(ICONS[icon])),
    el("div", { class: "set-label" }, label, help && el("div", { class: "help" }, help)), el("div", { class: "set-control" }, control));
  const tick = (on, change) => el("label", { class: "check" }, el("input", { type: "checkbox", checked: !!on, onchange: (e) => change(e.target.checked) }), on ? "On" : "Off");
  const folder = (key) => [el("code", { class: "set-path" }, about.paths[key] || "…"),
    shell && shell.reveal && el("button", { class: "btn small ghost", onclick: async () => { if (!(await shell.reveal(key))) toast("That could not be opened", true); } }, key === "log" ? "Open" : "Open folder")];
  const title = SETTINGS.find(([key]) => key === sec)[1];
  const body = {
    general: () => el("div", { class: "panel set-panel" },
      row("Process a recording as soon as it is saved", tick(st.auto, async (on) => { await api("/api/settings", "POST", { auto: on }); await refreshStatus(); renderMain(); }),
        "Off: a recording waits in your Videos folder until you press Process recording."),
      shell && row("Block ads in the Studio and URL", tick(s.ads && s.ads.on, (on) => shell.ads(on)),
        (s.ads && s.ads.error) || "An ad that plays is recorded with the video. Changing this reloads the pages that are open."),
      row("Recordings are saved in", folder("recordings"), "Each recording is a file named by its date and time."),
      shell && shell.nightOpen && row("Link Night", el("button", { class: "btn big insta square", title: "Open Link Night", "aria-label": "Open Link Night",
          onclick: async () => { if (!(await shell.nightOpen())) toast("Link Night could not be opened", true); } }, svg(ICONS.moon)),
        "Collects game streams into tapes while you are away, and reports in Discord's #night. Starting a night restarts Link, so that Link Night can work it.")),
    recording: () => el("div", { class: "panel set-panel" },
      shell && s.quality && row("Picture quality", el("select", { onchange: (e) => shell.quality(Number(e.target.value)) },
          s.quality.choices.map((m) => el("option", { value: m, selected: m === s.quality.video }, `${m} Mbit/s · about ${Math.round(m * 7.5)} MB a minute${m === 6 ? " (standard)" : ""}`))),
        "How much data a recording's picture gets. More is sharper in fast scenes and makes bigger files. It applies from the next recording."),
      row("Sound quality", [el("span", {}, s.audio ? `${s.audio.bits} kbit/s` : "160 kbit/s"), el("button", { class: "btn small ghost", onclick: () => showSettings("audio") }, "Change in Audio")]),
      row("Recording size", el("span", {}, s.size ? `${s.size.width}×${s.size.height} right now` : "Open a stream or a video to see it"),
        "A recording is as big as the big screen is when it starts. Hiding the sidebar or enlarging Link's window makes it sharper."),
      row("At the same time", el("span", {}, `${s.maxChannels || 3} live streams in the Studio and one video in URL`), "Each recording has only its own picture and sound.")),
    audio: () => (shell && shell.audio ? [
      el("p", { class: "help" }, "One row for each open stream, the URL video, the microphone and the music player. The slider is how loud it is in its recording; the speaker is whether you hear it. The Audio button in the top bar shows the same rows in a small window that stays above the Studio."),
      settingsMixer]
      : el("div", { class: "notice" }, el("div", { class: "pix" }, "THE MIXER WORKS IN LINK'S OWN WINDOW"), el("div", {}, "Start Link from its Desktop icon."))),
    accounts: () => el("div", { class: "panel set-panel" },
      row("Instagram page", [el("span", {}, st.instagram ? `@${st.instagram}` : "Not set"), el("button", { class: "btn small ghost", onclick: () => askInstagram() }, st.instagram ? "Change" : "Set")],
        "The page the Instagram button opens, and where Post on Instagram goes.", "instagram"),
      row("Instagram numbers", [el("span", { class: state.insta && state.insta.connected ? "set-good" : "" }, !state.insta ? "…" : state.insta.connected ? "Connected" : "Not connected"),
          el("button", { class: "btn small ghost", onclick: () => showAnalytics(true, "instagram") }, "Open Analytics")],
        "Analytics reads your reels' views and likes with an access key of your own.", "chart"),
      row("YouTube numbers", [el("span", { class: state.yt && state.yt.connected ? "set-good" : "" }, !state.yt ? "…" : state.yt.connected ? "Connected" : state.yt.client ? "Not signed in" : "Not set up"),
          el("button", { class: "btn small ghost", onclick: () => showAnalytics(true, "youtube") }, "Open Analytics")],
        "Analytics reads your Shorts' views, likes and watch time with an OAuth client of your own.", "youtube"),
      row("Kick", [el("span", { class: state.kick && state.kick.connected ? "set-good" : "" }, !state.kick ? "…" : state.kick.connected ? "Connected" : "Not connected"),
          state.kick && state.kick.connected
            ? (() => { const b = el("button", { class: "btn small ghost" }, "Disconnect"); b.onclick = () => twoStep(b, "Click again to forget the Kick app's ID and secret", async () => { state.kick = await api("/api/kick", "POST", { action: "disconnect" }); renderMain(); }); return b; })()
            : el("button", { class: "btn small ghost", onclick: askKick }, "Connect")],
        "Kick's own API says whether a channel is live, and gives the stream's name and game to the texts. Without it Link goes by the picture.", "kick"),
      shell && row("Discord bot", [el("span", { class: s.discord && s.discord.state === "online" ? "set-good" : "" }, s.discord ? { online: "Online", connecting: "Connecting", error: "Error", off: "Not connected" }[s.discord.state] || s.discord.state : "…"),
          el("button", { class: "btn small ghost", onclick: () => shell.discord(true) }, "Open the widget")],
        "Your own bot: links from your crew, /clip, and what it posts.", "discord"),
      shell && row("Spotify", [el("span", { class: state.spotify && state.spotify.connected ? "set-good" : "" }, !state.spotify ? "…" : state.spotify.connected ? "Connected" : state.spotify.client_id ? "Not signed in" : "Not set up"),
          el("button", { class: "btn small ghost", onclick: () => shell.music(true) }, "Open the player")],
        "The music player presses Spotify's buttons; the music itself is never recorded.", "spotify"),
      row("Where the keys are", folder("data"), "Sign-ins and keys stay in this folder on this PC, never in Link's own folder.", "key")),
    storage: () => storageSection(row),
    learning: () => learningSection(row),
    about: () => [
      el("div", { class: "panel set-panel" },
        row("Link 2000", el("span", {}, about.version ? `Version ${about.version}` : about.error || "…")),
        about.electron && row("Built on", el("span", {}, `Electron ${about.electron} · Chromium ${about.chromium}`)),
        shell && shell.selfCheck && row("Self-check", el("button", { class: "btn small ghost",
            onclick: async (e) => { const b = e.target; b.disabled = true; try { showSelfCheck(await shell.selfCheck()); } catch (err) { toast("The self-check could not run", true); } b.disabled = false; } }, "Run self-check"),
          "Tries each part Link needs — the dashboard, ffmpeg, the recording folder, the internet — and shows how each one is. It also runs once by itself each time Link opens.")),
      el("div", { class: "kicker" }, "Where things are kept"),
      el("div", { class: "panel set-panel" },
        row("Recordings", folder("recordings")), row("Tapes", folder("tapes")), row("Finished reels", folder("finals")),
        row("Post texts", folder("posts")), row("Settings, keys and sign-ins", folder("data")), row("The log of every job", folder("log"))),
      el("p", { class: "help" }, CREDIT.map((line) => line.replace(/^\* /, "")).join(" "))],
  }[sec]();
  drawMain(
    el("div", { class: "head-row" }, el("div", {}, el("h1", {}, "Settings"), el("div", { class: "sub" }, title.toUpperCase()))),
    el("div", { class: "head-rule" }),
    el("div", { class: "settings-screen", id: "settings-screen" },
      settingsNav(),
      el("div", { class: "settings-body" }, body)));
  renderDialogue();
}

function renderMain() {
  const d = state.detail;
  // The link fields are in the heading of the Studio and URL (renderStudio). In the Studio they are
  // two, one for a Kick channel and one for a Twitch channel.
  const streaming = state.studio && state.kind === "stream";
  $("link-label").textContent = streaming ? "KICK LINK" : "VIDEO LINK";
  $("open-url").placeholder = streaming ? "kick.com/channel"
    : state.studio ? "Paste a YouTube link (or any video link)" : "Paste the link of the video you want to record";
  // In the Studio the bar does one thing: Run puts the stream on the big screen. Opening a video and
  // uploading one belong to URL (and the screens outside the Studio, where a link opens in URL).
  $("opener").classList.toggle("stream-mode", streaming);
  $("main").classList.toggle("lib", !!state.library);
  $("main").classList.remove("cands");
  watchMixer();
  $("btn-open").textContent = streaming ? "Run" : "Open video";
  $("btn-open").title = streaming ? "Puts the stream on the big screen. It does not start recording."
    : "Opens the link in URL, inside Link. It does not start recording.";
  $("opener-help").textContent = streaming ? "Paste a Kick or Twitch link and press Run." : "Open a link and record it, or upload a video you already have.";
  if (shell && state.studio) return renderStudio();
  renderMonitors();  // no monitors away from the Studio: their live pictures stop
  placePlayer();  // leaving the Studio takes the browser panel off the page
  if (state.analytics) return renderAnalytics();
  if (state.settings) return renderSettings();
  if (state.library) return renderLibrary();
  if (!d) {
    drawMain( emptyState("No tapes yet", "Open URL in the list on the left, paste a video link there, press Open video and record it. Or press Upload video there and choose a video you already have. Link then finds the candidate moments and shows them here.",
      el("div", { class: "tv tall" }, "NO TAPE")));
    return renderDialogue();
  }
  const current = state.sources.find((s) => s.id === d.id) || { id: d.id, file: d.file, started: d.started };
  const tabs = [["candidates", "Candidates", candidates(d).filter((c) => !c.dismissed).length],
                ["reels", "Reels", reelsNow().length], ["finals", "Finals", Object.keys(d.finals).length]];
  $("main").classList.toggle("cands", state.tab === "candidates");
  const kept = [".cand-list", ".cand-focus"].map((sel) => (document.querySelector(sel) || {}).scrollTop || 0);
  // With the list on the left folded away, the other tapes are reached from a small button beside this
  // tape's name. Its list lies over the page: it takes no room, so nothing under it moves, and opening it
  // does not draw the page again (a video may be playing).
  const others = state.sources.filter((s) => s.id !== d.id);
  const menu = el("div", { class: "tape-menu", hidden: !state.pickerOpen }, others.length ? others.map((s) => sourceCard(s)) : el("span", { class: "help" }, "This is the only tape."));
  const switcher = el("button", { class: "tape-switch", type: "button", title: "Go to another tape" });
  const showMenu = (open) => {
    state.pickerOpen = open;
    menu.hidden = !open;
    switcher.textContent = `${state.sources.length} TAPES ${open ? "▴" : "▾"}`;
    switcher.classList.toggle("on", open);
  };
  switcher.onclick = (e) => { e.stopPropagation(); showMenu(menu.hidden); };
  menu.addEventListener("click", () => { state.pickerOpen = false; }, true);   // a tape was chosen: its page opens without the list
  showMenu(!!state.pickerOpen);
  clearMenu = () => { if (!menu.hidden) showMenu(false); };
  drawMain(
    el("div", { class: "head-row tape-head" },
      el("div", { class: "tabs" }, tabs.map(([key, label, n], i) =>
        el("div", { class: "tab" + (state.tab === key ? " active" : ""), title: `${label} (key ${i + 1})`,
          onpointerdown: (e) => { if (e.button === 0) switchTab(key); } },
          el("span", { class: "cur" }, "▶"), label, el("span", { class: "n" }, String(n)),
          key === "reels" && el("span", { class: "dot dirty-only", title: "Unsaved changes" })))),
      el("div", { class: "tape-name" }, el("div", { class: "title-line" }, switcher, problemBadge(d), state.naming === d.id ? tapeNameField(current) : [el("h1", {}, sourceTitle(current, true)), current.id && state.sources.includes(current) ? pencil(current) : null]),
        menu,
        el("div", { class: "sub" }, el("b", {}, d.id), el("span", {}, counter(d.info.duration)), el("span", {}, `${d.info.width}×${d.info.height}`), el("span", {}, `${d.mode.toUpperCase()} MODE`), contentPicker(d), el("span", { class: "file", title: d.file }, d.file)))),
    el("div", { class: "head-rule" }),
    ...{ candidates: candidatesTab, reels: reelsTab, finals: finalsTab }[state.tab](d));
  [".cand-list", ".cand-focus"].forEach((sel, i) => { const node = document.querySelector(sel); if (node) node.scrollTop = sel === ".cand-focus" && node.dataset.rank !== String(state.candShown) ? 0 : kept[i]; });
  state.candShown = state.open;
  renderDialogue();
}

// A tab changes the moment it is pressed (not when the button comes up again), and its page rises in
// quickly; keys 1, 2 and 3 do the same while nothing is being typed. The page is redrawn often, so the
// rise is only played on the redraw the switch itself makes.
const TABS = ["candidates", "reels", "finals"];
let tabRise;
function switchTab(key) {
  if (state.tab === key || !state.detail || state.studio || state.analytics || state.settings) return;
  state.tab = key;
  renderMain();
  const main = $("main");
  main.classList.remove("tab-rise");
  void main.offsetWidth;   // start the rise again even when tabs are switched quickly one after another
  main.classList.add("tab-rise");
  clearTimeout(tabRise);
  tabRise = setTimeout(() => main.classList.remove("tab-rise"), 200);
}

// The dialogue box says what to do next, in one sentence.
function renderDialogue() {
  const d = state.detail;
  let parts = null, next = false;
  const em = (text) => el("em", {}, text);
  // The Studio says what to do next in its own bar; the room goes to the screen.
  if ((shell && state.studio) || state.analytics || state.settings) parts = null;
  else if (!d) parts = ["No tapes yet. Open ", em("URL"), " on the left: paste a video link and press ", em("Open video"), ", or press ", em("Upload video"), "."];
  else if (state.tab === "candidates") {
    const s = state.stretch, c = state.cut;
    const shown = candidates(d).filter((x) => !x.dismissed);
    if (s.in != null && s.out != null && s.out > s.in) [parts, next] = [[`In and Out are set: ${(s.out - s.in).toFixed(1)} seconds from ${clock(s.in)}. Press `, em("Make reel"), " to add it."], true];
    else if (c) parts = ["This reel will run from your own In and Out. Press ", em("Make reel"), " when it looks right."];
    else if (!shown.length) parts = ["No moments stood out in this recording. Click the timeline to pick a stretch yourself."];
    else [parts, next] = [[`${many(shown.length, "moment")} found. Click one to open it, press `, em("Make reel"), " on any you like, or ask the assistant to run Link."], true];
  } else if (state.tab === "reels") {
    const todo = reelsNow().filter((x) => !d.finals[x.id]);
    if (!reelsNow().length) parts = [`${many(d.candidates.length, "moment")} ${d.candidates.length === 1 ? "is" : "are"} waiting in `, em("Candidates"), "."];
    else if (state.draft) [parts, next] = [["You have unsaved changes. ", em("Preview"), " shows them without saving; ", em("Save changes"), " keeps them."], true];
    else if (todo.length) [parts, next] = [[`${todo[0].id} is not rendered yet. Preview it, then press `, em("Render this reel"), "."], true];
    else parts = ["Every reel here is rendered. The files and the post text are in ", em("Finals"), "."];
  } else {
    const [done, all, unwritten] = postCount(d);
    if (!Object.keys(d.finals).length) parts = ["Nothing is rendered yet. Render a reel in ", em("Reels"), " and it shows up here."];
    else if (unwritten) [parts, next] = [[`${many(all - done, "post")} left to upload. ${unwritten === all - done ? (unwritten === 1 ? "It has" : "They have") : `${unwritten} of them have`} no text yet: write it in `, em("Reels"), " › Post text, or post with your own words and tick the platform."], true];
    else if (done < all) [parts, next] = [[`${many(all - done, "post")} left to upload. Copy the text, upload the file, then tick the platform.`], true];
    else parts = ["Every post is done. Nice work."];
  }
  const box = $("dialogue");
  if (!parts) return void (box.hidden = true);
  put($("dialogue-text"), ...parts);
  $("dialogue-more").className = "more" + (next ? " blink" : "");
  $("dialogue-more").style.visibility = next ? "visible" : "hidden";
  // A sentence shows once, for three seconds, and then slides away; seen again (redrawn, or back on the
  // same tab) it stays away. Each new sentence gets its own three seconds.
  const key = $("dialogue-text").textContent;
  if (key === dialogue.key) return void (box.hidden = dialogue.gone);
  if (dialogue.seen.has(key)) {
    Object.assign(dialogue, { key, gone: true });
    clearTimeout(dialogue.timer);
    box.classList.remove("leaving");
    return void (box.hidden = true);
  }
  dialogue.seen.add(key);
  Object.assign(dialogue, { key, gone: false });
  clearTimeout(dialogue.timer);
  box.classList.remove("leaving");
  box.hidden = false;
  dialogue.timer = setTimeout(() => {
    box.classList.add("leaving");
    dialogue.timer = setTimeout(() => {
      dialogue.gone = true;
      box.hidden = true;
      box.classList.remove("leaving");
    }, 320);
  }, 3000);
}
const dialogue = { key: "", gone: false, timer: null, seen: new Set() };

// The list of other tapes (renderMain) shuts when anything else is clicked.
let clearMenu = () => {};
document.addEventListener("click", (e) => { if (!e.target.closest(".tape-menu")) clearMenu(); });

function lightbox(src) {
  $("lightbox").querySelector("img").src = src;
  $("lightbox").showModal();
}

// ---------------------------------------------------------------- players

// One voice at a time. A player that the page has put away (another candidate was opened, the list was
// drawn again) used to go on playing where nobody could see it: its sound mixed with the next one's and
// there was nothing to pause or mute. So every player with sound is known here. One that starts playing
// pauses the others; one that is no longer on the page is stopped for good and lets go of its video.
// They all start at the loudness the user last chose, half at first.
const voices = new Set();
const HEARD = "link-heard";
function heardAt() {
  const v = parseFloat(localStorage.getItem(HEARD));
  return v >= 0 && v <= 1 ? v : 0.5;
}
function still(video) {
  voices.delete(video);
  if (state.seek && state.seek.video === video) state.seek = null;   // the timeline's knob has nothing to move
  try { video.pause(); video.removeAttribute("src"); video.load(); } catch { /* it is going anyway */ }
}
function voice(video) {
  video.volume = heardAt();
  voices.add(video);
  video.addEventListener("volumechange", () => { if (video.isConnected && voices.has(video)) localStorage.setItem(HEARD, String(video.muted ? 0 : video.volume)); });
  video.addEventListener("play", () => {
    if (!video.isConnected) return still(video);
    for (const v of [...voices]) if (v !== video) v.isConnected ? v.pause() : still(v);
  });
  return video;
}
setInterval(() => { for (const v of [...voices]) if (!v.isConnected) still(v); }, 300);

// A TV showing one stretch of the source. onTime gets the source time while it plays.
function sourcePlayer(d, from, to, { startAt, onTime } = {}) {
  const start = Math.max(0, Math.floor(from)), end = Math.min(Math.ceil(to), Math.floor(d.info.duration));
  // When the window can play the recording as it is (d.plays), the player shows the recording itself: it
  // opens at once, and the play line can be taken anywhere in it. It plays the stretch asked for and stops
  // at its end, until the user goes somewhere else. Otherwise it shows a preview cut from the recording.
  const whole = !!d.plays, base = whole ? 0 : start;   // base: the recording's time at the video's own zero
  let bounded = whole;
  const video = voice(el("video", { src: whole ? `/tape/${d.id}` : `/clip/${d.id}/${start}_${end}.mp4`, controls: true, preload: whole ? "metadata" : "auto" }));
  const mode = el("span", { class: "osd left" }, "▶▶ PREPARING…"), time = el("span", { class: "osd right" }, counter(startAt ?? start));
  const tv = el("div", { class: "tv wide loading" }, video, mode, time);
  const now = () => Math.round((base + video.currentTime) * 10) / 10;
  const tick = () => {
    if (bounded && !video.paused && base + video.currentTime >= end) { bounded = false; video.pause(); }   // the stretch is over; Play goes on from here
    time.textContent = counter(now());
    mode.textContent = video.paused ? "■ STOP" : "▶ PLAY";
    if (!state.scrubbing) setPlayhead(now());   // while the knob is dragged the line is where the pointer is
    if (onTime) onTime(now());
  };
  video.addEventListener("loadeddata", () => {
    if (!video.isConnected) return still(video);
    // what the timeline's knob moves: this preview, over the stretch of the recording it covers
    const length = Number.isFinite(video.duration) ? video.duration : whole ? d.info.duration : end - start;
    state.seek = { video, from: base, to: base + length,
      go: (t) => { if (t < start || t > end) bounded = false; video.currentTime = Math.min(Math.max(0, t - base), Math.max(0, length - 0.05)); },
      playing: () => !video.paused, pause: () => video.pause(), play: () => video.play().catch(() => {}) };
    tv.classList.remove("loading");
    if (whole || startAt != null) video.currentTime = Math.max(0, (startAt ?? start) - base);
    video.play().catch(() => {});
    tick();
  });
  for (const ev of ["timeupdate", "seeked", "pause", "play"]) video.addEventListener(ev, tick);
  // gone elsewhere with the player's own bar: it no longer stops at the stretch's end
  video.addEventListener("seeking", () => { const t = base + video.currentTime; if (t < start - 0.5 || t > end + 0.5) bounded = false; });
  // How long this stretch was watched is noted for learning (learn.py): a candidate that was looked
  // at and passed over says more than one that never was. Only the seconds are kept.
  let playedFrom = null;
  const watched = () => {
    const secs = playedFrom == null ? 0 : (performance.now() - playedFrom) / 1000;
    playedFrom = null;
    if (secs >= 1) api(`/api/sources/${d.id}/ui`, "POST", { seen: { in: from, out: to, seconds: Math.round(secs * 10) / 10 } }).catch(() => {});
  };
  video.addEventListener("playing", () => { if (playedFrom == null) playedFrom = performance.now(); });
  for (const ev of ["pause", "ended", "emptied"]) video.addEventListener(ev, watched);
  video.addEventListener("error", () => { tv.classList.remove("loading"); mode.textContent = "NO PICTURE"; });
  return { tv, now };
}

function setPlayhead(t) {
  const head = $("playhead"), box = $("tape-counter");
  state.playAt = t;
  if (!head || !state.detail) return;
  const v = viewOf(state.detail);
  head.hidden = t == null || t < v.from || t > v.to;
  if (t == null) return;
  head.style.left = `${((t - v.from) / (v.to - v.from)) * 100}%`;
  box.textContent = `▶ PLAY  ${counter(t)}`;
}

// ---------------------------------------------------------------- candidates

// The part of a phrase said between a and b. The recogniser sometimes hears a long stretch as one phrase
// that starts before the moment or runs past it; its words are spread evenly over its time and the words
// whose middle falls inside are kept. The same rule as phrase_part in server.py.
function phrasePart(p, a, b) {
  if (a <= p.t && p.end <= b) return p;
  const words = p.text.split(/\s+/).filter(Boolean);
  if (!words.length || p.end <= a || p.t >= b) return null;
  const step = Math.max(p.end - p.t, 0.1) / words.length;
  const keep = words.map((_, i) => i).filter((i) => a <= p.t + step * (i + 0.5) && p.t + step * (i + 0.5) < b);
  if (!keep.length) return null;
  return { t: p.t + step * keep[0], end: Math.min(p.t + step * (keep[keep.length - 1] + 1), p.end), text: words.slice(keep[0], keep[keep.length - 1] + 1).join(" ") };
}

function candidates(d) {
  const reels = reelsNow();
  const heard = Object.fromEntries(((d.transcript || {}).candidates || []).map((c) => [c.rank, c.phrases]));
  return d.candidates.map((c) => {
    const key = `${c.in}-${c.out}`;
    const phrases = (heard[c.rank] || []).map((p) => phrasePart(p, c.in - 1, c.out)).filter(Boolean);
    return { ...c, key, phrases, dismissed: d.ui.dismissed.includes(key), used: reels.find((x) => x.in < c.out && x.out > c.in) };
  });
}

async function makeReel(from) {
  try {
    if (state.draft) await putEdl(prepared(state.draft));
    const { edl, cut } = await api(`/api/sources/${state.id}/reels`, "POST", from);
    if (cut && cut.length) toast(`Cut: ${cut.join("; ")}`);   // what Link did to the candidate's stretch (learn.py, place)
    const before = new Set(reelsNow().map((x) => x.id));
    Object.assign(state, { tab: "reels", cut: null, capSel: null, stretch: { at: null, in: null, out: null } });
    state.reel = (edl.reels.find((x) => !before.has(x.id)) || {}).id || null;
    await refreshSources();
    toast("Reel added. Give it a title and a hook");
  } catch (e) {
    if (e.conflict) $("banner").hidden = false;
    toast(e.message, true);
  }
}

async function setUi(body) {
  try {
    state.detail.ui = await api(`/api/sources/${state.id}/ui`, "POST", body);
  } catch (e) {
    toast(e.message, true);
  }
}

// The stretch of the recording the timeline shows: the whole of it until the user zooms in.
const VIEW_LEAST = 10;   // seconds: as far in as the timeline zooms
function viewOf(d) {
  if (!state.view || state.view.id !== d.id) state.view = { id: d.id, from: 0, to: d.info.duration };
  return state.view;
}
function setView(d, from, to) {
  const total = d.info.duration, span = Math.min(total, Math.max(Math.min(total, VIEW_LEAST), to - from));
  from = Math.min(Math.max(0, from), total - span);
  state.view = { id: d.id, from, to: from + span };
  if (state.drawTimeline) state.drawTimeline();
}

// The recording as a line of its score over time, with the candidates as blocks on it.
// It behaves freely: the wheel zooms in and out around the pointer (Shift and the wheel, or a sideways
// wheel, moves along the recording; so does the bar under it once zoomed in), and the stretch given as
// `select` can be changed on it: its two ends are dragged to where the reel is to start and to end,
// its middle moves it whole. `select` is {range() -> {in, out}, commit(in, out), what}; without it the
// timeline only shows. `blocks`: whether a candidate's block can be clicked to open it.
const SELECT_LEAST = 2;   // seconds: as short as a stretch can be dragged
function timeline(d, list, { select = null, blocks = true, onClick = null, compact = false } = {}) {
  const total = d.info.duration, round = (t) => Math.round(t * 10) / 10;
  const s = d.timeline.score, lo = Math.min(...s), hi = Math.max(...s);
  const c = d.timeline.chat, cHi = c ? Math.max(...c) : 0;
  const track = el("div", { class: "track", title: select ? "" : "Click to play the recording from here" });
  const axis = el("div", { class: "axis" });
  // The play line, with a knob under it to drag it by (the line itself lets the pointer through, so it
  // is never in the way of the stretch's grips).
  const knob = el("i", { class: "knob", title: "Drag to move through the preview" });
  const head = el("div", { class: "playhead", id: "playhead", hidden: true }, knob);
  // The stretch's own times, said in the bar above the timeline: written on the stretch they covered it.
  const when = el("span", { class: "when", hidden: !select, title: select ? `Where ${select.what} starts and ends, and how long it is` : "" });
  const thumb = el("i", { class: "thumb" }), overview = el("div", { class: "overview", title: "The whole recording; the light part is what the timeline shows. Drag it to move along." }, thumb);
  const zoomSaid = el("span", { class: "zoom-said" });
  let cur = select ? { ...select.range() } : null, dragging = false;

  // A line of the samples that fall in view, in the 1000 by 96 box the track is drawn in.
  const line = (values, y) => {
    const v = viewOf(d), n = values.length, span = v.to - v.from, step = total / Math.max(1, n - 1);
    const first = Math.max(0, Math.floor(v.from / step) - 1), last = Math.min(n - 1, Math.ceil(v.to / step) + 1);
    let path = "";
    for (let i = first; i <= last; i++) path += `${i === first ? "M" : "L"}${(((i * step - v.from) / span) * 1000).toFixed(1)} ${y(values[i]).toFixed(1)} `;
    return path;
  };

  function draw() {
    const v = viewOf(d), span = v.to - v.from, pct = (t) => `${((t - v.from) / span) * 100}%`, wide = (len) => `${(len / span) * 100}%`;
    const inView = (a, b) => b > v.from && a < v.to;
    const chatPath = cHi > 0 ? line(c, (x) => 94 - (x / cHi) * 70) : "";
    let box = null;
    if (select) {
      // the stretch that can be changed: gold, with an orange grip at each end (its times are in the bar above)
      box = el("div", { class: "block chosen free", title: `Drag an end to where ${select.what} starts or ends; drag the middle to move it` },
        el("i", { class: "grip l" }), el("i", { class: "grip r" }));
      const place = () => {
        box.style.left = pct(cur.in); box.style.width = wide(cur.out - cur.in);
        when.textContent = `${tc(cur.in)} – ${tc(cur.out)} · ${(cur.out - cur.in).toFixed(1)} s`;
      };
      place();
      box.onclick = (e) => e.stopPropagation();
      box.onpointerdown = (e) => {
        if (e.button) return;
        e.preventDefault(); e.stopPropagation();
        const how = e.target.classList.contains("grip") ? (e.target.classList.contains("l") ? "in" : "out") : "move";
        const width = track.getBoundingClientRect().width, was = { x: e.clientX, in: cur.in, out: cur.out };
        let moved = false;
        box.setPointerCapture(e.pointerId);
        box.classList.add("dragging");
        dragging = true;
        box.onpointermove = (ev) => {
          const by = ((ev.clientX - was.x) / width) * span;
          if (Math.abs(ev.clientX - was.x) > 2) moved = true;
          if (how === "in") cur.in = round(Math.min(Math.max(0, was.in + by), cur.out - SELECT_LEAST));
          else if (how === "out") cur.out = round(Math.max(Math.min(total, was.out + by), cur.in + SELECT_LEAST));
          else { const len = was.out - was.in, at = Math.min(Math.max(0, was.in + by), total - len); cur.in = round(at); cur.out = round(at + len); }
          place();
        };
        box.onpointerup = box.onpointercancel = (ev) => {
          box.onpointermove = box.onpointerup = box.onpointercancel = null;
          box.classList.remove("dragging");
          dragging = false;
          if (moved) select.commit(cur.in, cur.out);
          else if (ev.type === "pointerup" && how === "move") jumpTo(timeAt(ev));   // a plain click on the stretch: the play line goes there
        };
      };
    }
    put(track,
      chatPath && svg(`<svg class="chat-line" viewBox="0 0 1000 96" preserveAspectRatio="none"><path d="${chatPath}" fill="none" stroke="#53fc18" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity=".55"/></svg>`),
      svg(`<svg viewBox="0 0 1000 96" preserveAspectRatio="none"><path d="${line(s, (x) => 90 - ((x - lo) / (hi - lo || 1)) * 84)}" fill="none" stroke="#9fd8c8" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity=".9"/></svg>`),
      list.filter((k) => inView(k.in, k.out) && !(select && blocks && k.rank === state.open)).map((k) => el("div", {
        class: "block" + (k.marked ? " marked" : "") + (k.dismissed ? " dismissed" : "") + (k.rank === state.open && blocks ? " chosen" : "") + (blocks ? "" : " still"), "data-rank": k.rank,
        style: `left:${pct(k.in)};width:${wide(k.out - k.in)}`, title: `#${k.rank} · ${clock(k.in)} – ${clock(k.out)}`,
        // A click on a candidate's block opens it. One that was dismissed is not in the list any more, so a click on
        // its block is a click on the timeline: the play line goes there (opening it showed nothing and stopped the player).
        ...(blocks ? { onmouseenter: () => light(k.rank, true), onmouseleave: () => light(k.rank, false),
          onclick: (e) => { e.stopPropagation(); if (k.dismissed && state.filter !== "dismissed") { if (onClick) onClick(Math.floor(timeAt(e))); } else openCandidate(k.rank); } } : {}),
      })),
      d.problems.filter((x) => inView(x.in, x.out)).map((x) => el("div", { class: "problem", style: `left:${pct(x.in)};width:${wide(x.out - x.in)}` })),
      // One bar, the second (or the only one), is the "loose" lamp that flickers now and then.
      reelsNow().map((x, i, all) => inView(x.in, x.out) && el("div", { class: "reel-bar" + (i === Math.min(1, all.length - 1) ? " loose" : ""), style: `left:${pct(x.in)};width:${wide(x.out - x.in)}` })),
      d.markers.filter((m) => inView(m, m)).map((m) => el("div", { class: "marker", style: `left:${pct(m)}` })),
      box, head);
    put(axis, [0, 1, 2, 3, 4, 5, 6].map((i) => el("span", {}, (span < 90 ? tc : clock)(v.from + (span * i) / 6))));
    overview.hidden = span >= total - 0.01;
    thumb.style.left = `${(v.from / total) * 100}%`;
    thumb.style.width = `${(span / total) * 100}%`;
    zoomSaid.textContent = span >= total - 0.01 ? "WHOLE RECORDING" : `${clock(v.from)} – ${clock(v.to)} · ×${(total / span).toFixed(1)}`;
    if (state.playAt != null) setPlayhead(state.playAt);
  }
  state.drawTimeline = () => { if (track.isConnected && !dragging) { if (select) cur = { ...select.range() }; draw(); } };

  const timeAt = (e) => { const r = track.getBoundingClientRect(), v = viewOf(d); return v.from + ((e.clientX - r.left) / r.width) * (v.to - v.from); };
  const zoomBy = (k, at) => { const v = viewOf(d); at = at ?? (cur ? (cur.in + cur.out) / 2 : (v.from + v.to) / 2); setView(d, at - (at - v.from) * k, at + (v.to - at) * k); };
  // Dragging the knob goes through the preview that is open (state.seek, from sourcePlayer): the picture
  // follows at once, as do the line and the counter. It stops at the preview's two ends. A video that was
  // playing plays on from where the knob is let go.
  knob.onclick = (e) => e.stopPropagation();
  knob.onpointerdown = (e) => {
    const k = state.seek;
    if (e.button || !k) return;
    e.preventDefault(); e.stopPropagation();
    const was = k.playing();
    let want = null, frame = 0;
    k.pause();
    knob.setPointerCapture(e.pointerId);
    head.classList.add("dragging");
    dragging = true;
    state.scrubbing = true;
    knob.onpointermove = (ev) => {
      want = Math.round(Math.min(Math.max(timeAt(ev), k.from), k.to) * 10) / 10;
      setPlayhead(want);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; k.go(want); });
    };
    knob.onpointerup = knob.onpointercancel = () => {
      knob.onpointermove = knob.onpointerup = knob.onpointercancel = null;
      head.classList.remove("dragging");
      dragging = false;
      state.scrubbing = false;
      if (want != null) k.go(want);
      if (was) k.play();
    };
  };
  // The wheel zooms around the pointer; with Shift, or sideways, it moves along the recording.
  track.addEventListener("wheel", (e) => {
    e.preventDefault();
    const v = viewOf(d), span = v.to - v.from;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const by = ((e.deltaX || e.deltaY) / track.getBoundingClientRect().width) * span; setView(d, v.from + by, v.to + by); }
    else zoomBy(e.deltaY < 0 ? 1 / 1.3 : 1.3, timeAt(e));
  }, { passive: false });
  track.addEventListener("click", (e) => { if (onClick) onClick(Math.floor(timeAt(e))); });
  // The bar under the timeline: the part in view, dragged along the whole recording (a click elsewhere on it jumps there).
  overview.onpointerdown = (e) => {
    if (e.button) return;
    e.preventDefault();
    const r = overview.getBoundingClientRect(), v = viewOf(d), span = v.to - v.from;
    let grab = ((e.clientX - r.left) / r.width) * total - v.from;
    if (e.target !== thumb) { grab = span / 2; setView(d, ((e.clientX - r.left) / r.width) * total - grab, 0 + ((e.clientX - r.left) / r.width) * total - grab + span); }
    overview.setPointerCapture(e.pointerId);
    overview.onpointermove = (ev) => { const at = ((ev.clientX - r.left) / r.width) * total - grab; setView(d, at, at + span); };
    overview.onpointerup = overview.onpointercancel = () => { overview.onpointermove = overview.onpointerup = overview.onpointercancel = null; };
  };
  const zoomButton = (label, title, act) => el("button", { type: "button", title, onclick: act }, label);
  const swatch = (style) => el("i", { style });
  draw();
  // The frame's neon is four corner pieces laid over its border, so they sit outside the screen, which
  // clips what is inside it.
  return el("div", { class: "neon-frame", style: `--neon-phase:-${Math.round(performance.now())}ms` }, el("div", { class: "tv timeline" + (compact ? " compact" : "") },
    el("div", { class: "top" },
      el("div", { class: "legend" }, zoomSaid,
        el("span", {}, swatch("background:rgba(159,216,200,.35);border:1px solid #9fd8c8"), "CANDIDATE"),
        el("span", {}, swatch("background:rgba(242,199,68,.45);border:1px solid #f2c744"), "YOU MARKED"),
        el("span", {}, swatch("background:#3ddc84;height:3px;vertical-align:3px"), "ALREADY A REEL"),
        d.problems.length ? el("span", {}, swatch("background:#ff5d5d"), "PROBLEM") : null,
        cHi > 0 ? el("span", { class: "chat-key", title: "How fast the stream's chat went (messages per second; only the count was kept)" }, swatch("background:#53fc18;height:2px;vertical-align:4px;opacity:.7"), "CHAT") : null),
      when,
      el("div", { class: "zoom", title: "The mouse wheel zooms too; Shift and the wheel moves along the recording" },
        zoomButton("−", "Zoom out", () => zoomBy(1.6)), zoomButton("+", "Zoom in", () => zoomBy(1 / 1.6)),
        select && zoomButton("◎", `Zoom to ${select.what}`, () => { const len = cur.out - cur.in, room = Math.max(len, 15); setView(d, cur.in - room, cur.out + room); }),
        zoomButton("FIT", "Show the whole recording", () => setView(d, 0, total))),
      el("div", { class: "counter-box", id: "tape-counter" }, `■ STOP  ${counter(0)}`)),
    track, axis, overview),
    ["tl", "tr", "br", "bl"].map((k) => el("i", { class: `corner ${k}`, ariaHidden: "true" })));
}

function light(rank, on) {
  for (const node of document.querySelectorAll(`[data-rank="${rank}"]`)) node.classList.toggle("lit", on);
}

// A candidate that is chosen plays at once: going through the list is watching it.
function openCandidate(rank, play = true) {
  // The player of "Make a reel from any stretch" is closed with it: there is one screen at a time.
  Object.assign(state, { open: rank, autoplay: play ? rank : null, cut: null, stretch: { at: null, in: null, out: null } });
  renderMain();
  const row = document.querySelector(".cand-list .cand-row.chosen");
  if (row) row.scrollIntoView({ block: "nearest" });
}

// A click on the timeline inside the preview that is open goes there in that preview (no second screen).
// Says whether it did.
function jumpTo(t) {
  const k = state.seek;
  if (!k || t < k.from || t > k.to) return false;
  k.go(t);
  setPlayhead(Math.round(t * 10) / 10);
  return true;
}

function showStretch(at) {
  if (Number.isNaN(at) || at < 0 || at >= state.detail.info.duration) return toast("That time is not inside the recording", true);
  state.stretch = { at, in: null, out: null };
  renderMain();
}

function stretchPanel(d) {
  const s = state.stretch;
  const go = el("input", { class: "tc", placeholder: "m:ss", value: s.at != null ? clock(s.at) : "" });
  const inF = el("input", { class: "tc", placeholder: "–:––.–", value: s.in != null ? tc(s.in) : "" });
  const outF = el("input", { class: "tc", placeholder: "–:––.–", value: s.out != null ? tc(s.out) : "" });
  const make = el("button", { class: "btn primary" }, "Make reel");
  const sync = () => {
    for (const [field, key] of [[inF, "in"], [outF, "out"]]) {
      const v = parseTime(field.value);
      s[key] = Number.isNaN(v) ? null : v;
      field.classList.toggle("bad", field.value.trim() !== "" && Number.isNaN(v));
    }
    make.disabled = !(s.in != null && s.out != null && s.out > s.in);
    renderDialogue();
  };
  inF.onchange = outF.onchange = sync;
  go.addEventListener("keydown", (e) => e.key === "Enter" && showStretch(parseTime(go.value)));
  make.onclick = () => makeReel({ in: s.in, out: s.out });
  let player = null;
  if (s.at != null) {
    const p = sourcePlayer(d, s.at - 10, s.at + 110, { startAt: s.at });
    const set = (field) => () => { field.value = tc(p.now()); sync(); };
    player = el("div", { class: "player" }, p.tv, el("div", { class: "row" },
      el("button", { class: "btn", onclick: set(inF) }, "Set In here"), el("button", { class: "btn", onclick: set(outF) }, "Set Out here"),
      el("button", { class: "btn ghost", onclick: () => { state.stretch = { at: null, in: null, out: null }; setPlayhead(null); renderMain(); } }, "Close"),
      el("span", { class: "help" }, "Two minutes from the point you chose. Pause where the reel should start and end.")));
  }
  const panel = el("div", { class: "card stretch" },
    el("div", { class: "bar" }, el("b", {}, "Make a reel from any stretch"),
      el("span", { class: "help" }, "Click the recording above, or type a time, then set In and Out in the player."),
      go, el("button", { class: "btn", onclick: () => showStretch(parseTime(go.value)) }, "Show"), el("span", { class: "rule" }),
      el("span", { class: "kicker" }, "In"), inF, el("span", { class: "kicker" }, "Out"), outF, make),
    player);
  sync();
  return panel;
}

// What kind of content a tape is. Link finds its moments by what that kind shows: a shooter's kill feed
// is watched as well as its sound and movement, and a moment in a fight is cut by the fight. Choosing
// another kind finds the tape's candidates anew (its reels stay).
const CONTENTS = [
  { key: "general", label: "General", content: "general" },
  { key: "shooter:valorant", label: "Shooter · Valorant", content: "shooter", game: "valorant" },
  { key: "shooter:cs2", label: "Shooter · CS2", content: "shooter", game: "cs2" },
  { key: "shooter", label: "Shooter · other game", content: "shooter" },
  { key: "talk", label: "Podcast · interview", content: "talk" },
  { key: "chatting", label: "Just chatting · reaction", content: "chatting" },
  { key: "horror", label: "Horror", content: "horror" },
  { key: "sports", label: "Sports · fighting · racing", content: "sports" },
];
const contentKey = (content, game) => (CONTENTS.find((k) => k.content === content && (k.game || null) === (game || null)) || CONTENTS[0]).key;
function contentPicker(d) {
  const now = contentKey(d.content, d.game);
  const pick = el("select", { class: "content-pick", title: "What this recording is. Link looks for its moments by it. Choosing another finds the candidates again; reels you made stay." },
    CONTENTS.map((k) => el("option", { value: k.key, selected: k.key === now }, k.label.toUpperCase())));
  pick.onchange = async () => {
    const k = CONTENTS.find((x) => x.key === pick.value);
    if (state.status && state.status.job.running) { pick.value = now; return toast("Link is busy. Choose again when it is done.", true); }
    // No question is asked first: nothing is lost by it (the reels stay), and choosing the old kind again undoes it.
    toast(`Finding this recording's moments again as ${k.label}. It takes a few minutes; your reels stay.`);
    startJob({ kind: "analyze", source: d.id, content: k.content, ...(k.game ? { game: k.game } : {}) });
  };
  return el("span", { class: "content" }, pick);
}

function scoreBar(c, top) {
  return el("div", { class: "score" }, el("div", { class: "bar" }, el("i", { style: `width:${Math.min(100, (c.score / Math.max(2, top)) * 100)}%` })), c.score.toFixed(2));
}

// The chosen candidate, in the column that stays put beside the list: the player, its numbers, what
// to do with it and what is said in it. `order` is the list as shown, for previous and next.
// The stretch the reel of a candidate will be made of: the candidate's own, or what the user made of it
// (on the timeline, or with Set In / Set Out in the player).
const cutOf = (c) => (state.cut && state.cut.rank === c.rank ? state.cut : c);
// Say that stretch where the chosen candidate is shown, without drawing the page again (a video may be playing).
function showCut(c) {
  const k = cutOf(c), range = $("cand-range"), len = $("cand-len"), reset = $("cut-reset"), note = $("cut-note");
  if (range) { range.textContent = `${clock(k.in)} – ${clock(k.out)}`; range.title = `${k.in} – ${k.out} s`; range.classList.toggle("changed", k !== c); }
  if (len) len.textContent = `${Math.round(k.out - k.in)} S`;
  if (reset) reset.hidden = k === c;
  if (note && k !== c) note.textContent = `The reel will run ${tc(k.in)} – ${tc(k.out)}.`;
}

// The previews of the candidates that come after the chosen one (then the ones before it) are made
// ahead by the server, so the next one is there when it is opened. Asked once for each place in the list.
function warmAfter(d, order, at) {
  if (d.plays) return;   // the recording itself is played: there are no previews to make
  const key = `${d.id}:${order[at]}:${order.length}`;
  if (state.warmed === key) return;
  state.warmed = key;
  const byRank = new Map(d.candidates.map((k) => [k.rank, k]));
  const last = Math.floor(d.info.duration);
  const clips = [...order.slice(at), ...order.slice(0, at).reverse()].map((r) => byRank.get(r)).filter(Boolean)
    .map((k) => [Math.max(0, Math.floor(k.in - 5)), Math.min(Math.ceil(k.out + 5), last)]);
  api(`/api/sources/${d.id}/warm`, "POST", { clips }).catch(() => {});
}

function candFocus(d, c, top, order) {
  const slot = el("div", { class: "screen" });
  const cutNote = el("span", { class: "help", id: "cut-note" }, "Playing the candidate; In and Out move the reel you make.");
  const play = () => {
    const k = cutOf(c);
    const p = sourcePlayer(d, k.in - 5, k.out + 5, { startAt: k.in });
    const set = (which) => () => {
      const next = { rank: c.rank, in: cutOf(c).in, out: cutOf(c).out, [which]: Math.round(p.now() * 10) / 10 };
      if (next.out - next.in < SELECT_LEAST) return toast("In has to come before Out", true);
      state.cut = next;
      showCut(c);
      if (state.drawTimeline) state.drawTimeline();
      renderDialogue();
    };
    put(slot, p.tv, el("div", { class: "row" },
      el("button", { class: "btn small", onclick: set("in") }, "Set In here"), el("button", { class: "btn small", onclick: set("out") }, "Set Out here")), cutNote);
  };
  slot.append(el("div", { class: "tv wide" }, el("div", { class: "empty", style: "cursor:pointer", onclick: play }, "▶ PLAY")));
  const at = order.indexOf(c.rank);
  const step = (by) => { if (order[at + by] != null) openCandidate(order[at + by]); };
  const make = () => {
    const k = state.cut && state.cut.rank === c.rank ? state.cut : null;
    makeReel(k ? { in: k.in, out: k.out } : { rank: c.rank });
  };
  // Thrown out, the next one takes its place, so going through the list never jumps back to the top.
  const dismiss = async () => { await setUi({ dismiss: c.key, on: !c.dismissed }); state.open = order[at + 1] ?? order[at - 1] ?? null; state.autoplay = state.open; renderMain(); };
  const toggle = () => { const v = slot.querySelector("video"); if (!v) return play(); v.paused ? v.play().catch(() => {}) : v.pause(); };
  state.candActs = { step, toggle, dismiss, make: c.used ? null : make };   // what the keys do (candKey)
  const key = (keys, what) => el("span", {}, keys.map((k) => el("kbd", {}, k)), what);
  const card = el("div", { class: "panel cand-focus", id: "cand-open", "data-rank": c.rank },
    slot,
    el("div", { class: "headline" },
      el("span", { class: "rank big" }, `#${c.rank}`),
      el("span", { class: "range big", id: "cand-range" }),
      el("span", { class: "len", id: "cand-len", style: "font-size:17px" }),
      el("span", { class: "spacer" }),
      el("span", { class: "pix", style: "font-size:15px;color:var(--teal)" }, "SCORE"), scoreBar(c, top)),
    el("div", { class: "badges" },
      c.marked && el("span", { class: "tag gold" }, "★ YOU MARKED THIS"),
      c.chat >= 1.5 && el("span", { class: "tag chat", title: "The stream's chat ran this much faster than its average here" }, `CHAT ×${c.chat}`),
      c.turn && el("span", { class: "tag chat", title: "The talk turns to something else here" }, "NEW TOPIC"),
      c.fight && el("span", { class: "tag fight", title: "Cut by a fight in the kill feed: from before its first kill to after its last. The number is the most kill rows on screen at once." }, `FIGHT ×${c.kills || 1}`),
      c.used ? el("span", { class: "tag green" }, `▶ ${c.used.id}`) : el("span", { class: "tag plain" }, c.dismissed ? "DISMISSED" : "NOT YET USED"),
      el("button", { class: "btn small ghost", id: "cut-reset", hidden: true, title: "Back to the stretch Link found", onclick: () => { state.cut = null; renderMain(); } }, "↺ As found"),
      el("span", { class: "spacer" }), el("span", { class: "count" }, `${at + 1} OF ${order.length}`)),
    el("div", { class: "acts" },
      el("button", { class: "btn step", title: "Previous (↑ or ←)", disabled: at <= 0, onclick: () => step(-1) }, "‹"),
      el("button", { class: "btn step", title: "Next (↓ or →)", disabled: at >= order.length - 1, onclick: () => step(1) }, "›"),
      el("button", { class: "btn ghost", onclick: dismiss }, c.dismissed ? "Restore" : "Dismiss"),
      el("button", { class: "btn play", onclick: play }, "▶ Play"),
      !c.used && el("button", { class: "btn primary", onclick: make }, "Make reel")),
    el("div", { class: "keys" }, key(["←", "→"], "prev / next"), key(["SPACE"], "play"), c.used ? null : key(["ENTER"], "make reel"), key(["DEL"], c.dismissed ? "restore" : "dismiss")),
    el("div", { class: "said" }, el("span", { class: "kicker" }, "Said"),
      c.phrases.length ? c.phrases.map((p) => el("div", { class: "line" }, el("i", {}, clock(p.t)), el("span", {}, p.text)))
        : el("span", { class: "said-line none" }, "Nothing was said here")),
    c.sheet && el("div", { class: "frames" }, el("span", { class: "kicker" }, "Every frame"),
      el("img", { class: "sheet", src: `/files/reels/${d.id}/${c.sheet}`, alt: `Frames of candidate ${c.rank}`, title: "Click to see them large", onclick: () => lightbox(`/files/reels/${d.id}/${c.sheet}`) })));
  if (state.autoplay === c.rank) { state.autoplay = null; play(); }
  warmAfter(d, order, at);
  // the stretch is said once the card is on the page (its fields are found by their ids)
  queueMicrotask(() => showCut(c));
  return card;
}

// The keys of the Candidates list: arrows step, Space plays or pauses, Enter makes the reel, Delete
// dismisses. Not while a button or the video itself has the key (they act on it themselves).
function candKey(e) {
  const acts = state.candActs;
  if (!acts || !state.detail || state.tab !== "candidates" || state.studio || state.analytics || state.settings || state.library || !$("cand-open")) return false;
  const own = e.target.closest && e.target.closest("button, video, a");
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (step && !(own && own.tagName === "VIDEO")) acts.step(step);
  else if (e.key === " " && !own) acts.toggle();
  else if (e.key === "Enter" && !own && acts.make) acts.make();
  else if (e.key === "Delete") acts.dismiss();
  else return false;
  return true;
}

// ---------------------------------------------------------------- problems with a recording

// What is wrong with a recording, each as a short heading and a sentence.
function problemNotes(d) {
  const notes = d.problems.map((p) => ({
    head: `${PROBLEM_NAMES[p.kind] || p.kind} · ${clock(p.in)} – ${clock(p.out)}`,
    text: `${PROBLEM_NAMES[p.kind] || p.kind} from ${clock(p.in)} to ${clock(p.out)} (${p.out - p.in} s). No candidates were taken there.`,
    more: `${p.out - p.in} seconds; no candidates were taken there.` }));
  if (d.level && d.level.quiet) notes.push({ head: "Recorded very quietly",
    text: `The whole recording is very quiet: its loudest moments reach ${d.level.peak_lufs} LUFS, and about -20 is normal. Reels are boosted when rendered. Next time, turn the video's own volume up before recording; the Studio warns when it is low.`,
    more: `Its loudest moments reach ${d.level.peak_lufs} LUFS; about −20 is normal. Reels are boosted when rendered. Next time turn the video's own volume up before recording; the Studio warns when it is low.` });
  return notes;
}

// The box is shown in full in Candidates the first time a tape is opened. After three seconds, or at the
// user's first press on the page, it is sucked into the triangle badge beside the tape's title, which
// then glows; it stays folded for that tape from then on, and the text comes back on hovering the badge.
function problemsSeen() {
  try { return new Set(JSON.parse(localStorage.getItem("link.problemsSeen") || "[]")); } catch (e) { return new Set(); }
}

let problemsTimer = null, problemsFor = null;
function watchProblems(id) {
  if (problemsFor === id) return;   // the page is redrawn often; the eight seconds count from the first time
  problemsFor = id;
  clearTimeout(problemsTimer);
  problemsTimer = setTimeout(() => foldProblems(id), 3000);
}

// Whether the full box shows: in Candidates, for a tape with problems whose box has not folded yet.
const problemsOpen = (d) => state.tab === "candidates" && problemNotes(d).length > 0 && !problemsSeen().has(d.id);

function foldProblems(id) {
  clearTimeout(problemsTimer);
  const seen = problemsSeen();
  if (seen.has(id)) return;
  seen.add(id);
  try { localStorage.setItem("link.problemsSeen", JSON.stringify([...seen])); } catch (e) { /* folds again next time */ }
  const box = $("problems-box"), slot = $("problems-slot"), badge = document.querySelector(".problem-badge");
  if (!box || !slot || !badge || state.id !== id || matchMedia("(prefers-reduced-motion: reduce)").matches) return renderMain();
  // Sucked in: the box speeds up, squashes and shrinks into the triangle while the room it took closes.
  const a = box.getBoundingClientRect(), b = badge.getBoundingClientRect();
  const dx = b.left + b.width / 2 - a.left, dy = b.top + b.height / 2 - a.top;
  const sucked = box.animate([
    { transform: "none", opacity: 1, filter: "blur(0)", borderRadius: "0px" },
    { offset: .55, transform: `translate(${dx * .35}px, ${dy * .5}px) scale(.55, .3)`, opacity: .95, borderRadius: "14px" },
    { transform: `translate(${dx}px, ${dy}px) scale(.02, .015)`, opacity: .2, filter: "blur(1.5px)", borderRadius: "50%" },
  ], { duration: 360, easing: "cubic-bezier(.62, 0, .86, .32)", fill: "forwards" });
  box.style.transformOrigin = "0 0";
  box.style.pointerEvents = "none";
  slot.animate([{ height: `${slot.offsetHeight}px` }, { height: "0px", marginBottom: "-14px" }], { duration: 360, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "forwards" });
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    state.badgePop = true;
    renderMain();
  };
  sucked.onfinish = settle;
  setTimeout(settle, 700);   // a hidden window does not animate; the page still settles
}

function problemBadge(d) {
  const notes = problemNotes(d);
  if (!notes.length) return null;
  const pop = state.badgePop, waiting = problemsOpen(d);   // while the box shows, the badge waits unlit for it
  state.badgePop = false;
  const triangle = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22.5 21h-21z" fill="currentColor" opacity=".18"/><path d="M12 3 22.5 21h-21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.25" fill="currentColor"/></svg>`;
  // The card opens under the badge, moved left when it would run past the page's edge; its pointer stays on the badge.
  const fit = (e) => {
    const badge = e.currentTarget, card = badge.querySelector(".pop-card"), main = $("main").getBoundingClientRect();
    const over = badge.getBoundingClientRect().left - 4 + card.offsetWidth - (main.right - 16);
    const shift = Math.max(0, over);
    card.style.left = `${-4 - shift}px`;
    card.style.setProperty("--arrow", `${14 + shift}px`);
  };
  return el("div", { class: "problem-badge" + (pop ? " pop" : "") + (waiting ? " waiting" : ""), tabIndex: 0, onmouseenter: fit, onfocus: fit, ariaLabel: `${notes.length} problem${notes.length === 1 ? "" : "s"} in this recording`,
      style: `--glow-phase:-${Math.round(performance.now() % 2600)}ms` },
    svg(triangle),
    el("div", { class: "pop-card", role: "tooltip" },
      el("div", { class: "pop-head" }, svg(triangle), `Problems in this recording · ${notes.length}`),
      el("ul", {}, notes.map((n) => el("li", {}, el("b", {}, n.head), el("span", {}, n.more))))));
}

function candidatesTab(d) {
  const all = candidates(d);
  const counts = {
    all: all.filter((c) => !c.dismissed).length, marked: all.filter((c) => c.marked && !c.dismissed).length,
    used: all.filter((c) => c.used).length, free: all.filter((c) => !c.used && !c.dismissed).length, dismissed: all.filter((c) => c.dismissed).length,
  };
  const keep = { all: (c) => !c.dismissed, marked: (c) => c.marked && !c.dismissed, used: (c) => c.used, free: (c) => !c.used && !c.dismissed, dismissed: (c) => c.dismissed };
  const order = { rank: (a, b) => a.rank - b.rank, time: (a, b) => a.in - b.in, length: (a, b) => (b.out - b.in) - (a.out - a.in),
                  pick: (a, b) => (b.pick || 0) - (a.pick || 0) || a.rank - b.rank };
  // "Pick" is the order Link learned from the reels that were made (learn.py); it is there once that is trusted
  const learnt = all.some((c) => c.pick != null);
  if (state.sort === "pick" && !learnt) state.sort = "rank";
  if (state.filter === "dismissed" && !counts.dismissed) state.filter = "all";
  const list = all.filter(keep[state.filter]).sort(order[state.sort]);
  const top = Math.max(...all.map((c) => c.score), 0);
  if (!list.some((c) => c.rank === state.open)) state.open = list.length ? list[0].rank : null;
  const chosen = list.find((c) => c.rank === state.open);
  if (!chosen) state.candActs = null;
  const chip = (key, label) => el("span", { class: "chip" + (state.filter === key ? " on" : ""), onclick: () => { state.filter = key; renderMain(); } }, `${label} ${counts[key]}`);
  const notes = problemNotes(d), open = problemsOpen(d);
  if (open) watchProblems(d.id);
  const stretch = state.stretchOpen || state.stretch.at != null;   // the bar for a moment Link did not find: folded away until asked for
  return [
    open ? el("div", { class: "notice-slot", id: "problems-slot" }, el("div", { class: "notice", id: "problems-box" }, el("div", { class: "pix" }, "⚠ PROBLEMS IN THIS RECORDING"),
      el("ul", {}, notes.map((n) => el("li", {}, n.text))))) : null,
    timeline(d, all, {
      onClick: (t) => (jumpTo(t) ? null : showStretch(t)),
      // a candidate that is a reel already is changed in Reels, on its reel
      select: chosen && !chosen.used ? {
        what: "the reel",
        range: () => (state.cut && state.cut.rank === chosen.rank ? { in: state.cut.in, out: state.cut.out } : { in: chosen.in, out: chosen.out }),
        commit: (a, b) => { state.cut = { rank: chosen.rank, in: a, out: b }; showCut(chosen); renderDialogue(); },
      } : null,
    }),
    el("div", { class: "controls" },
      el("span", { class: "kicker" }, `Candidates by ${state.sort}`),
      el("div", { class: "seg" }, [...(learnt ? ["pick"] : []), "rank", "time", "length"].map((key) =>
        el("span", { class: state.sort === key ? "on" : "", onclick: () => { state.sort = key; renderMain(); } }, key[0].toUpperCase() + key.slice(1)))),
      el("div", { class: "chips" }, chip("all", "All"), chip("marked", "★ Marked"), chip("used", "Already reels"), chip("free", "Not yet used"),
        counts.dismissed ? chip("dismissed", "Dismissed") : null),
      el("span", { class: "spacer" }),
      el("button", { class: "btn small ghost" + (stretch ? " on" : ""), type: "button", title: "For a moment Link did not find itself: click the recording above or type a time",
        onclick: () => { state.stretchOpen = !stretch; if (stretch) { state.stretch = { at: null, in: null, out: null }; setPlayhead(null); } renderMain(); } }, `Make a reel from any stretch ${stretch ? "▴" : "▾"}`)),
    stretch ? stretchPanel(d) : null,
    list.length ? el("div", { class: "cand-split" },
      candFocus(d, chosen, top, list.map((c) => c.rank)),
      el("div", { class: "cand-list" }, list.map((c) =>
        el("div", {
          class: "cand-row" + (c.rank === state.open ? " chosen" : "") + (c.marked ? " marked" : "") + (c.used ? " used" : "") + (c.dismissed ? " dismissed" : ""), "data-rank": c.rank,
          onclick: () => { if (c.rank !== state.open) openCandidate(c.rank); }, onmouseenter: () => light(c.rank, true), onmouseleave: () => light(c.rank, false),
        },
          el("span", { class: "rank" }, `#${c.rank}`),
          c.sheet ? el("img", { class: "shots", src: `/strip/${d.id}/${c.sheet}`, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(el("span", { class: "shots" })) }) : el("span", { class: "shots" }),
          // its numbers and badges on one line, what is said under them
          el("div", { class: "mid" },
            el("div", { class: "facts" }, el("span", { class: "range", title: `${c.in} – ${c.out} s` }, `${clock(c.in)} – ${clock(c.out)}`), el("span", { class: "len" }, `${Math.round(c.out - c.in)} S`),
              scoreBar(c, top), c.marked && el("span", { class: "tag gold" }, "★ MARKED"),
              c.pick != null && el("span", { class: "tag pick", title: "How much this looks like the moments you made reels of (Settings > Learning)" }, `PICK ${Math.round(100 * c.pick)}`),
              c.chat >= 1.5 && el("span", { class: "tag chat", title: "The stream's chat ran this much faster than its average here" }, `CHAT ×${c.chat}`),
              c.used && el("span", { class: "tag green" }, `▶ ${c.used.id}`)),
            el("div", { class: "said-line" + (c.phrases.length ? "" : " none") }, c.phrases.length ? c.phrases.map((p) => p.text).join(" ") : "Nothing was said here")),
          el("span", { class: "acts" },
            el("button", { class: "btn ghost small", onclick: (e) => { e.stopPropagation(); openCandidate(c.rank, true); } }, "Play"),
            !c.used && el("button", { class: "btn small", onclick: (e) => { e.stopPropagation(); makeReel({ rank: c.rank }); } }, "Make reel"))))))
      : emptyState(all.length ? "Nothing here" : "No candidates", all.length ? "No candidate matches this filter." : "Link found no moments in this recording. Use \"Make a reel from any stretch\" above to pick one yourself."),
  ];
}

// ---------------------------------------------------------------- reels

const hookLines = (hook) => { const [a = "", ...rest] = (hook || "").split("\\N"); return [a, rest.join("\\N")]; };
const capTime = (c) => tc(c.t) + (c.end != null ? `–${tc(c.end)}` : "");

function captionsBox(reel) {
  const box = el("div", { id: "caps", style: "display:flex;flex-direction:column;gap:6px" });
  const dur = reel.out - reel.in;
  const caps = () => reelsNow().find((x) => x.id === reel.id).captions || [];
  const change = (fn) => edit((e) => { const x = e.reels.find((y) => y.id === reel.id); x.captions = x.captions || []; fn(x.captions); });
  let dragged = 0;
  const draw = () => {
    const list = caps();
    const lane = el("div", { class: "lane", title: "Click to add a caption here" });
    list.forEach((c, i) => {
      const mark = el("div", { class: "mark" + (state.capSel === i ? " sel" : ""), style: `left:${Math.min(100, (c.t / dur) * 100)}%;top:${i % 2 ? 18 : 0}px` },
        el("span", { class: "word" }, c.text.split(" ").slice(0, 2).join(" ") || "…"),
        el("span", { class: "stem", style: `height:${i % 2 ? 10 : 28}px` }), el("span", { class: "foot" }));
      mark.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        mark.setPointerCapture(e.pointerId);
        state.capSel = i;
        const move = (ev) => {
          const box2 = lane.getBoundingClientRect();
          const t = Math.round(Math.min(dur, Math.max(0, ((ev.clientX - box2.left) / box2.width) * dur)) * 10) / 10;
          change((cs) => { cs[i].t = t; if (cs[i].end != null && cs[i].end <= t) delete cs[i].end; });
          mark.style.left = `${(t / dur) * 100}%`;
          const field = box.querySelector(`[data-cap-time="${i}"]`);
          if (field) field.value = capTime(caps()[i]);
        };
        const up = () => {
          dragged = Date.now();
          mark.removeEventListener("pointermove", move);
          change((cs) => cs.sort((a, b) => a.t - b.t));
          state.capSel = null;
          draw();
        };
        mark.addEventListener("pointermove", move);
        mark.addEventListener("pointerup", up, { once: true });
      });
      mark.addEventListener("click", (e) => e.stopPropagation());
      lane.append(mark);
    });
    lane.append(el("div", { class: "head", id: "cap-head", hidden: true }));
    lane.addEventListener("click", (e) => {
      if (Date.now() - dragged < 400) return;
      const box2 = lane.getBoundingClientRect();
      const t = Math.round(Math.min(dur, Math.max(0, ((e.clientX - box2.left) / box2.width) * dur)) * 10) / 10;
      change((cs) => { cs.push({ t, text: "" }); cs.sort((a, b) => a.t - b.t); });
      state.capSel = caps().findIndex((c) => c.t === t && c.text === "");
      draw();
      const field = box.querySelector(`[data-cap-text="${state.capSel}"]`);
      if (field) field.focus();
    });
    put(box, 
      el("div", { class: "label-row" }, el("span", { class: "kicker", style: "font-size:15px" }, `Captions · ${list.length}`),
        el("span", { class: "help", style: "font-size:12.5px" }, "Drag a marker to move it. Click the strip to add one. Words that match the voice follow it.")),
      el("div", { class: "strip" }, lane, el("div", { class: "axis" }, [0, 1, 2, 3, 4].map((k) => el("span", {}, clock((dur * k) / 4))))),
      el("div", { class: "cap-rows" }, list.map((c, i) => {
        const time = el("input", { class: "tc", value: capTime(c), "data-cap-time": i, title: "Seconds from the start of the reel. Add an end like 0:02.0–0:05.0 if you want one." });
        time.onchange = () => {
          const [a, b] = time.value.split(/[–-]/).map((p) => parseTime(p));
          const bad = Number.isNaN(a) || a < 0 || a > dur || (time.value.match(/[–-]/) && (Number.isNaN(b) || b <= a));
          time.classList.toggle("bad", !!bad);
          if (bad) return;
          change((cs) => { cs[i].t = a; if (b != null && !Number.isNaN(b)) cs[i].end = b; else delete cs[i].end; cs.sort((x, y) => x.t - y.t); });
          draw();
        };
        const text = el("input", { value: c.text, placeholder: "What appears on screen", "data-cap-text": i });
        text.oninput = () => {
          change((cs) => { cs[i].text = text.value; });
          const word = box.querySelectorAll(".mark .word")[i];
          if (word) word.textContent = text.value.split(" ").slice(0, 2).join(" ") || "…";
        };
        text.onfocus = () => { state.capSel = i; box.querySelectorAll(".mark").forEach((m, k) => m.classList.toggle("sel", k === i)); };
        return el("div", { class: "cap-row" + (state.capSel === i ? " sel" : "") }, time, text,
          el("button", { class: "x", title: "Remove this caption", onclick: () => { change((cs) => cs.splice(i, 1)); state.capSel = null; draw(); } }, "×"));
      })),
      el("div", {}, el("button", { class: "btn small ghost", onclick: () => {
        const last = list.length ? list[list.length - 1].t : 0;
        const t = Math.round(Math.min(dur - 0.5, last + 2) * 10) / 10;
        change((cs) => { cs.push({ t: Math.max(0, t), text: "" }); cs.sort((a, b) => a.t - b.t); });
        state.capSel = caps().length - 1;
        draw();
      } }, "+ Add caption")));
  };
  draw();
  return box;
}

function postBox(reel) {
  const names = platformsOf(reel);
  const get = (p) => (reel.platforms || {})[p] || {};
  const written = names.filter((p) => get(p).title && get(p).description).length + (reel.post_caption ? 1 : 0);
  const total = names.length + (reel.post_caption != null ? 1 : 0);
  const peek = names.filter((p) => get(p).title).map((p) => `${p}: “${get(p).title}”`).join(" · ") || reel.post_caption || "Nothing written yet: the title and description you paste when uploading.";
  const count = el("span", { class: "count" + (written < total ? " todo" : "") }, `${written} / ${total} WRITTEN`);
  const set = (p, key, value) => edit((e) => {
    const x = e.reels.find((y) => y.id === reel.id);
    x.platforms = { ...(x.platforms || {}), [p]: { title: "", description: "", ...((x.platforms || {})[p] || {}), [key]: value } };
  });
  return el("details", { class: "post" },
    el("summary", {}, el("span", { class: "cur" }, "▶"), el("b", {}, "Post text"), el("span", { class: "peek" }, peek), count),
    el("div", { class: "fields" },
      names.map((p) => {
        const title = el("input", { value: get(p).title || "" }), text = el("textarea", { rows: 4, value: get(p).description || "" });
        title.oninput = () => set(p, "title", title.value);
        text.oninput = () => set(p, "description", text.value);
        return el("div", {}, el("h4", {}, p), el("label", { class: "field" }, el("span", {}, "Title"), title), el("label", { class: "field" }, el("span", {}, "Description"), text));
      }),
      reel.post_caption != null && (() => {
        const text = el("textarea", { rows: 4, value: reel.post_caption });
        text.oninput = () => edit((e) => { e.reels.find((y) => y.id === reel.id).post_caption = text.value; });
        return el("div", {}, el("h4", {}, "Caption"), el("label", { class: "field" }, el("span", {}, "Text"), text));
      })()));
}

// Captions are timed from the reel's start. When In moves they move the other way, so each stays on the
// words it belongs to; one that now ends before the start is dropped, one cut by it starts at 0.
function setEdge(x, key, v) {
  const shift = key === "in" ? v - x.in : 0;
  x[key] = v;
  if (!shift || !x.captions) return;
  const r = (n) => Math.round(n * 10) / 10;
  x.captions = x.captions.map((c) => ({ ...c, t: r(c.t - shift), ...(c.end != null ? { end: r(c.end - shift) } : {}) }))
    .filter((c) => (c.end != null ? c.end : c.t + 0.5) > 0)
    .map((c) => (c.t < 0 ? { ...c, t: 0 } : c));
}

function editor(d, reel) {
  const edl = edlNow(), saved = d.edl.reels.find((x) => x.id === reel.id);
  const set = (fn) => edit((e) => fn(e.reels.find((x) => x.id === reel.id), e));
  const range = el("span", { class: "range", style: "font-size:24px" }), len = el("span", { class: "len", style: "font-size:17px" });
  const label = () => {
    const now = reelsNow().find((x) => x.id === reel.id);
    range.textContent = `${tc(now.in)} – ${tc(now.out)}`;
    len.textContent = `${Math.round(now.out - now.in)} S`;
  };
  label();
  const timeField = (key) => {
    const field = el("input", { class: "tc" + (saved && saved[key] !== reel[key] ? " changed" : ""), value: tc(reel[key]), title: "m:ss.s, or plain seconds" });
    field.onchange = () => {
      const v = parseTime(field.value), now = reelsNow().find((x) => x.id === reel.id);
      const other = key === "in" ? now.out : now.in;
      const bad = Number.isNaN(v) || v < 0 || v > d.info.duration || (key === "in" ? v >= other : v <= other);
      field.classList.toggle("bad", bad);
      if (bad) return;
      set((x) => setEdge(x, key, Math.round(v * 100) / 100));
      renderMain();  // the strip, the labels and the other reels' bars all depend on In and Out
    };
    return field;
  };
  const zoomLabel = el("span", {}, `Zoom · ${zoomOf(edl, reel)}×`);
  const zoom = el("input", { type: "range", min: "1", max: "3", step: "0.05", value: zoomOf(edl, reel), title: "1 shows the whole frame; higher enlarges the footage and crops its sides" });
  zoom.oninput = () => {
    const z = Number(zoom.value);
    zoomLabel.textContent = `Zoom · ${z}×`;
    set((x, e) => {
      if (z === ((e.style && e.style.zoom) ?? 1) && !(saved && saved.style && saved.style.zoom != null)) { if (x.style) { delete x.style.zoom; if (!Object.keys(x.style).length) delete x.style; } }
      else x.style = { ...(x.style || {}), zoom: z };
    });
  };
  const title = el("input", { value: reel.title || "", placeholder: "What happens in this reel" });
  title.oninput = () => {
    set((x) => { x.title = title.value; });
    const listed = document.querySelector(".rack .reel-item.active .title");   // the reel list beside the editor
    if (listed) {
      listed.textContent = title.value || "No title yet";
      listed.classList.toggle("none", !title.value);
    }
  };
  const [h1, h2] = hookLines(reel.hook);
  const hookA = el("input", { value: h1, placeholder: "FIRST LINE" }), hookB = el("input", { value: h2, placeholder: "SECOND LINE", title: "Optional" });
  hookA.oninput = hookB.oninput = () => set((x) => { x.hook = [hookA.value, hookB.value].filter((l) => l.trim()).join("\\N"); });
  const source = el("div", {});
  const playSource = () => {
    const now = reelsNow().find((x) => x.id === reel.id);
    const p = sourcePlayer(d, now.in - 5, now.out + 5, { startAt: now.in });
    const pick = (key) => () => { set((x) => setEdge(x, key, Math.round(p.now() * 100) / 100)); renderMain(); };
    put(source, el("div", { class: "stretch", style: "padding:0" }, el("div", { class: "player" }, p.tv,
      el("div", { class: "row" }, el("button", { class: "btn", onclick: pick("in") }, "Set In here"), el("button", { class: "btn", onclick: pick("out") }, "Set Out here"),
        el("span", { class: "help" }, "Five seconds either side of the reel.")))));
  };
  const remove = el("button", { class: "btn ghost" }, "Remove");
  remove.onclick = () => twoStep(remove, "Click again to remove", async () => {
    try {
      const next = prepared(edlNow());
      next.reels = next.reels.filter((x) => x.id !== reel.id);
      await putEdl(next);
      state.reel = null;
      await refreshSources();
      toast(`${reel.id} removed. Rendered files are kept`);
    } catch (e) {
      toast(e.message, true);
    }
  });
  return el("div", { class: "panel editor" },
    el("div", { class: "headline" },
      el("span", { class: "tape big" }, reel.id), range, len,
      d.finals[reel.id] ? el("span", { class: "tag green" }, "● RENDERED") : el("span", { class: "tag outline" }, "○ NOT RENDERED"),
      el("span", { class: "tag amber dirty-only" }, "● UNSAVED"),
      el("span", { class: "spacer" }), remove,
      el("button", { class: "btn", onclick: () => startJob({ kind: "preview", source: d.id, only: [reel.id], edl: prepared(edlNow()) }) }, "Preview"),
      el("button", { class: "btn primary", onclick: () => saveAnd(() => startJob({ kind: "render", source: d.id, only: [reel.id] })) }, "Render this reel")),
    el("div", { class: "grid" },
      el("label", { class: "field" }, el("span", {}, "In"), timeField("in")),
      el("label", { class: "field" }, el("span", {}, "Out"), timeField("out")),
      el("label", { class: "field" }, zoomLabel, zoom),
      el("button", { class: "btn", onclick: playSource, style: "margin-bottom:2px" }, "▶ Play source ±5 s")),
    source,
    el("label", { class: "field" }, el("span", {}, "Title"), title),
    el("div", { class: "field" },
      el("div", { class: "label-row" }, el("span", { class: "kicker", style: "font-size:15px" }, "Hook on screen · two lines"), el("span", { class: "help", style: "font-size:12.5px" }, "Shown in capitals at the top of the video")),
      el("div", { class: "two", style: "margin-top:4px" }, hookA, hookB)),
    captionsBox(reel),
    postBox(reel));
}

// ---------------------------------------------------------------- how a reel looks on a platform

// Over the Reels tab's player Link can draw what Instagram or YouTube put on top of a reel: the
// page's name, the caption or title, and the column of buttons. It is drawn, not fetched, so it
// shows where the hook and captions end up under each app's own things; the numbers a platform
// would show are left out. The sizes are in hundredths of the player's width (cqw), a phone being
// about 390 points wide.
const LOOK_ICONS = {
  heart: `<path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z"/>`,
  bubble: `<path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.3-4.2a8.5 8.5 0 1 1 15.7-4.5z"/>`,
  plane: `<path d="M21 3 10.2 13.8M21 3l-6.8 18-4-7.2L3 9.8z"/>`,
  repost: `<path d="M7 7h9a3 3 0 0 1 3 3v3M17 17H8a3 3 0 0 1-3-3v-3M16 4l3 3-3 3M8 20l-3-3 3-3"/>`,
  dots: `<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>`,
  dotsUp: `<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>`,
  camera: `<path d="M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v10.5h-17z"/><circle cx="12" cy="13.5" r="3.4"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>`,
  thumb: `<path d="M7.5 10.5v9.5H4v-9.5zM7.5 10.5l4-7.5c1.7 0 2.6 1.3 2.3 2.9l-.7 3.6h5.2c1.3 0 2.1 1.2 1.8 2.4l-1.5 6.2c-.3 1.1-1.2 1.9-2.4 1.9H7.5"/>`,
  share: `<path d="M13.5 5v4.2C7.5 9.8 4.2 13.5 3.5 19c2.6-3.3 5.7-4.8 10-4.8V18.5l7-6.8z"/>`,
  remix: `<path d="M13 3 6 13h5l-1 8 8-11h-5z"/>`,
  note: `<path d="M9 18.5V6l10-2v12.5"/><circle cx="6.8" cy="18.5" r="2.3"/><circle cx="16.8" cy="16.5" r="2.3"/>`,
};
const lookIcon = (name, flip) => svg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${flip ? ' style="transform:scaleY(-1)"' : ""}>${LOOK_ICONS[name]}</svg>`);

function lookOver(reel, look) {
  const account = ((look === "instagram" ? state.insta : state.yt) || {}).data;
  const who = (account && account.account) || {};
  const face = who.picture ? el("img", { class: "face", src: who.picture, alt: "", referrerPolicy: "no-referrer", onerror: (e) => e.target.replaceWith(el("span", { class: "face" })) }) : el("span", { class: "face" });
  const texts = reel.platforms || {};
  const act = (icon, label, flip) => el("div", { class: "act" }, lookIcon(icon, flip), label != null && el("span", {}, label));
  if (look === "instagram") {
    const name = who.username || (state.status || {}).instagram || "yourpage";
    const caption = reel.post_caption || ((Object.values(texts).find((p) => p.description) || {}).description || "").replace(/#shorts\b/gi, "#reels") || reel.title || "";
    return el("div", { class: "look instagram" },
      el("div", { class: "look-top" }, el("b", {}, "Reels"), lookIcon("camera")),
      el("div", { class: "look-side" }, act("heart"), act("bubble"), act("repost"), act("plane"), act("dots"), el("span", { class: "sound" })),
      el("div", { class: "look-foot" },
        el("div", { class: "who" }, face, el("b", {}, name), el("span", { class: "follow" }, "Follow")),
        caption && el("div", { class: "text one" }, caption.split("\n").find((line) => line.trim()) || ""),
        el("div", { class: "audio" }, lookIcon("note"), `${name} · Original audio`)));
  }
  const handle = who.username || "yourchannel";
  const title = (texts["YouTube Shorts"] || {}).title || reel.title || "";
  return el("div", { class: "look youtube" },
    el("div", { class: "look-top" }, el("span", {}), el("span", { class: "tools" }, lookIcon("search"), lookIcon("dotsUp"))),
    el("div", { class: "look-side" }, act("thumb", "Like"), act("thumb", "Dislike", true), act("bubble", "0"), act("share", "Share"), act("remix", "Remix"), el("span", { class: "sound" })),
    el("div", { class: "look-foot" },
      el("div", { class: "who" }, face, el("b", {}, `@${handle}`), el("span", { class: "follow" }, "Subscribe")),
      title && el("div", { class: "text two" }, title)),
    el("div", { class: "look-bar" }));
}

// The two small buttons above the player, and the layer they fill. A press on the lit one takes the look away again.
// While a look is shown the player's own controls are hidden (they would lie under it): a click on the picture plays and pauses.
function lookSwitch(reel, tv, video) {
  const layer = el("div", { class: "look-layer" });
  const names = { instagram: "Instagram", youtube: "YouTube" };
  const buttons = Object.keys(names).map((key) => el("button", { class: "btn small look-btn", type: "button", "data-look": key,
    title: `How this reel looks on ${names[key]}: its own buttons and text drawn over the picture`, onclick: () => show(state.look === key ? null : key) }, svg(ICONS[key])));
  const show = async (look) => {
    state.look = look;
    for (const b of buttons) b.classList.toggle("on", b.dataset.look === look);
    if (video) video.controls = !look;
    put(layer, look && lookOver(reel, look));
    // the page's name and picture come with the numbers; without them a stand-in name is drawn
    const key = look === "instagram" ? "insta" : "yt";
    if (look && !state[key]) {
      state[key] = await api(`/api/${look}`).catch(() => null);
      if (state[key] && state.look === look && layer.isConnected) put(layer, lookOver(reel, look));
    }
  };
  if (video) video.addEventListener("click", () => { if (state.look) video.paused ? video.play() : video.pause(); });
  tv.append(layer);
  show(state.look);
  return el("span", { class: "look-switch" }, buttons);
}

function reelsTab(d) {
  const reels = reelsNow();
  if (!reels.length) {
    return [el("div", { class: "empty-state" }, el("h2", {}, "No reels yet"),
      el("div", { class: "steps" },
        el("div", { class: "card" }, el("span", { class: "n" }, "1"), "Open ", el("strong", {}, "Candidates"), " and press ", el("strong", {}, "Make reel"), " on a moment you like."),
        el("div", { class: "card" }, el("span", { class: "n" }, "2"), "Or ask the assistant to ", el("strong", {}, "“run Link”"), "; it picks moments and writes hooks and captions.")))];
  }
  if (!reels.some((x) => x.id === state.reel)) state.reel = reels[0].id;
  const reel = reels.find((x) => x.id === state.reel);
  const fin = d.finals[reel.id], pv = d.previews[reel.id];
  const pvTime = pv ? Number(pv.split("?v=")[1]) : 0;
  const shown = pv && (!fin || pvTime >= fin.v) ? { src: `/files/reels/${d.id}/preview/${pv}`, label: "Preview", note: ["Showing your last ", el("strong", {}, "Preview"), ". It is not saved or rendered yet."] }
    : fin ? { src: `/files/finals/${fin.file}?v=${fin.v}`, label: "Rendered reel", note: ["Showing the rendered reel. Press ", el("strong", {}, "Preview"), " to see your edits (a few seconds, does not save)."] } : null;
  const video = shown && voice(el("video", { src: shown.src, controls: true, preload: "metadata" }));
  if (video) video.addEventListener("timeupdate", () => {
    const head = $("cap-head");
    if (!head || !video.duration) return;
    head.hidden = false;
    head.style.left = `${(video.currentTime / video.duration) * 100}%`;
  });
  const tv = el("div", { class: "tv tall" }, video || el("div", { class: "empty" }, "NO TAPE", el("br"), "Press Preview"));
  return [
    timeline(d, candidates(d), {
      blocks: false, compact: true,
      select: {
        what: reel.id,
        range: () => { const now = reelsNow().find((x) => x.id === reel.id) || reel; return { in: now.in, out: now.out }; },
        // In moves the captions the other way, as typing a new In does (setEdge)
        commit: (a, b) => { edit((e) => { const x = e.reels.find((y) => y.id === reel.id); setEdge(x, "in", a); x.out = b; }); renderMain(); },
      },
    }),
    el("div", { class: "reels" },
      el("div", { class: "rack" }, el("span", { class: "kicker" }, `Reels · ${reels.length}`),
        reels.map((x) => el("div", { class: "reel-item" + (x.id === reel.id ? " active" : ""), onclick: () => { state.reel = x.id; state.capSel = null; renderMain(); } },
          el("span", { class: "cursor" }, "▶"),
          el("div", { class: "top" }, el("span", { class: "tape" }, x.id), el("span", { class: "status" + (d.finals[x.id] ? " done" : "") }, d.finals[x.id] ? "● RENDERED" : "○ NOT RENDERED")),
          el("div", { class: "title" + (x.title ? "" : " none") }, x.title || "No title yet"),
          el("div", { class: "when" }, `${clock(x.in)} – ${clock(x.out)} · ${Math.round(x.out - x.in)} s`))),
        el("div", { class: "hint" }, "Add a reel from the ", el("strong", {}, "Candidates"), " tab, or ask the assistant to run Link.")),
      editor(d, reel),
      el("div", { class: "tv-col" },
        el("div", { class: "top" }, el("span", { class: "kicker" }, shown ? shown.label : "No picture yet"), lookSwitch(reel, tv, video), el("span", { class: "pix dim", style: "font-size:16px" }, "1080×1920")),
        tv,
        el("div", { class: "help", style: "font-size:12.5px" }, shown ? shown.note : "Press Preview to see this reel with its hook and captions."))),
    el("div", { class: "savebar" },
      el("span", { class: "unsaved dirty-only" }, "UNSAVED CHANGES"),
      el("span", { class: "help spacer" }, "Rendering saves first. Preview never saves."),
      el("button", { class: "btn big", onclick: () => saveAnd() }, "Save changes"),
      el("button", { class: "btn primary big", onclick: () => saveAnd(() => startJob({ kind: "render", source: d.id })) }, `Save and render all · ${reels.length}`)),
  ];
}

// ---------------------------------------------------------------- finals

// [posts ticked, posts there are] over the rendered reels of a source.
// Where a rendered reel is to be posted: its platforms (YouTube Shorts and TikTok unless it names its
// own) and its caption post. A platform counts whether or not its text is written yet.
const postRows = (x) => [...platformsOf(x), ...(x.post_caption != null ? ["Caption"] : [])];
const postText = (x, name) => (name === "Caption" ? { title: null, text: x.post_caption || "" }
  : { title: ((x.platforms || {})[name] || {}).title || "", text: ((x.platforms || {})[name] || {}).description || "" });

// [posted, to post, still without text]
function postCount(d) {
  const reels = (d.edl ? d.edl.reels : []).filter((x) => d.finals[x.id]);
  let done = 0, all = 0, unwritten = 0;
  for (const x of reels) for (const p of postRows(x)) {
    all++;
    if ((d.ui.posted[x.id] || []).includes(p)) done++;
    else if (!postText(x, p).text) unwritten++;
  }
  return [done, all, unwritten];
}

function finalsTab(d) {
  const reels = (d.edl ? d.edl.reels : []).filter((x) => d.finals[x.id]);
  if (!reels.length) {
    const drafted = reelsNow().length;
    return [emptyState("Nothing rendered yet", drafted ? `${drafted} reel${drafted === 1 ? " is" : "s are"} drafted. Press Render this reel in Reels, or Save and render all.`
      : "Make a reel in Candidates, then render it in Reels.", el("div", { class: "tv tall" }, "NO TAPE"))];
  }
  const done = el("span", { class: "pix", style: "font-size:16px;color:var(--green)" });
  const count = () => { const [a, b] = postCount(d); done.textContent = `${a} OF ${b} POSTS DONE`; };
  count();
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(`Copied ${what}`));
  const row = (x, name, title, text) => {
    const tick = el("button", { class: "tick" + ((d.ui.posted[x.id] || []).includes(name) ? " on" : ""), title: "Tick when this is posted" });
    tick.textContent = tick.classList.contains("on") ? "✓" : "";
    tick.onclick = async () => {
      await setUi({ posted: { reel: x.id, platform: name }, on: !tick.classList.contains("on") });
      const on = (state.detail.ui.posted[x.id] || []).includes(name);
      tick.classList.toggle("on", on);
      tick.textContent = on ? "✓" : "";
      d.ui = state.detail.ui;
      count();
      renderDialogue();
    };
    return el("div", { class: "post-row" }, tick, el("span", { class: "name" }, name),
      title || text ? [
        title != null && el("button", { class: "btn small", disabled: !title, onclick: () => copy(title, `the ${name} title for ${x.id}`) }, "Copy title"),
        el("button", { class: "btn small", disabled: !text, onclick: () => copy(text, `the ${name} text for ${x.id}`) }, "Copy text")]
        : el("span", { class: "help" }, "No text written yet"),
      name === "YouTube Shorts" && el("button", { class: "btn small", title: "Uploads this reel to your channel as a Short. It asks first.", onclick: () => uploadToYoutube(d, x, title, text).catch((e) => toast(e.message, true)) }, "Upload"));
  };
  return [
    el("div", { class: "controls" }, el("span", { class: "kicker" }, `Ready to post · ${reels.length}`),
      el("span", { class: "help" }, "Upload and Post on Instagram send a reel from here and tick it. For the rest, copy the text, upload the file by hand, then tick the platform."), el("span", { class: "spacer" }), done),
    el("div", { class: "finals" }, reels.map((x) => el("div", { class: "panel final" },
      el("div", { class: "tv tall" }, voice(el("video", { src: `/files/finals/${d.finals[x.id].file}?v=${d.finals[x.id].v}`, controls: true, preload: "metadata" }))),
      el("div", { class: "info" },
        el("div", { class: "top" }, el("span", { class: "tape" }, x.id), el("span", { class: "when" }, `${clock(x.in)} – ${clock(x.out)}`)),
        el("div", { class: "title" }, x.title || x.slug),
        el("div", { class: "file" }, d.finals[x.id].file),
        el("div", { class: "posts" },
          postRows(x).map((name) => { const p = postText(x, name); return row(x, name, p.title, p.text); })),
        el("div", { class: "row" },
          el("button", { class: "btn small insta-small", title: "Posts this reel on your Instagram page; it asks first. Without a key that may post (or with Shift held) it copies the reel's file path and opens your page in the Studio.",
            onclick: (e) => (e.shiftKey ? openInstagram(d.finals[x.id]) : postOnInstagram(d, x).catch((err) => toast(err.message, true))) }, svg(ICONS.instagram), "Post on Instagram"),
          el("button", { class: "btn ghost small", onclick: () => api("/api/reveal", "POST", { file: d.finals[x.id].file }).catch((e) => toast(e.message, true)) }, "Show file in folder")))))),
  ];
}

// ---------------------------------------------------------------- loading and polling

async function refreshSources() {
  const before = state.sources.map((s) => s.id);
  state.sources = await api("/api/sources");
  if (!state.renaming) state.lib = await api("/api/folders").catch(() => state.lib);
  const ids = new Set(state.sources.map((s) => s.id));
  state.picked.forEach((t) => ids.has(t) || state.picked.delete(t));
  const fresh = state.sources.find((s) => before.length && !before.includes(s.id));
  if (fresh) Object.assign(state, { id: fresh.id, tab: "candidates", draft: null, open: null, reel: null });
  if (fresh && !(state.shell && state.shell.recording)) {   // show the tape that was just processed
    state.studio = state.analytics = state.library = false;
    state.settings = null;
  }
  if (state.id && !state.sources.some((s) => s.id === state.id)) state.id = null;
  if (!state.id && state.sources.length) state.id = state.sources[0].id;
  state.detail = state.id ? await api(`/api/sources/${state.id}`) : null;
  if (state.draft && state.detail && same(state.draft, state.detail.edl)) state.draft = null;
  if (!state.draft && state.detail) rebase(state.detail.version);
  renderAll();
}

async function refreshStatus() {
  state.status = await api("/api/status");
  const running = state.status.job.running;
  if (running && !state.jobWasRunning) state.jobHidden = false;  // a job Link started by itself shows too
  renderHud();
  renderJob();
  if (state.jobWasRunning && !running) {
    await refreshSources();
    if (state.status.job.kind === "render" || state.status.job.kind === "ingest") loadLearned();   // new reels or a new tape: learn if there is something new
    if (state.status.job.kind === "analyze" && state.id) await select(state.id);   // its candidates are new: the tape is read again
    // A video that is a tape already makes nothing new: show the tape it is, not only the sentence.
    const [, tape] = state.status.job.log.match(/^Already a tape: (SRC-\d+)/m) || [];
    if (tape && state.sources.some((s) => s.id === tape) && !(state.shell && state.shell.recording)) await select(tape);
  }
  state.jobWasRunning = running;
  if (!running) nextIngest();
}

async function loop() {
  try {
    await refreshStatus();
    await checkVersion();
  } catch (e) {
    put($("slots"), el("div", { class: "closed" }, el("div", { class: "pix" }, "LINK IS NOT ANSWERING")));
    state.sig = {};
  }
  setTimeout(loop, state.status && state.status.job.running ? 1000 : 3000);
}

$("btn-studio").onclick = () => showStudio(!state.studio);
$("side-toggle").onclick = () => setSidebar(!document.body.classList.contains("side-hidden"));
// Link opens on the Studio, with the sidebar shown and the tapes under Sources folded.
setSidebar(false);
try { if (localStorage.getItem("link.sourcesView") === "grid") state.libView = "grid"; } catch (e) { /* the list by day */ }
try { if (localStorage.getItem("link.analytics") === "youtube") state.platform = "youtube"; } catch (e) { /* Analytics just starts on Instagram */ }
document.addEventListener("mousedown", (e) => { if (!$("ctx").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (/^[123]$/.test(e.key) && !typing && !e.ctrlKey && !e.altKey && !e.metaKey && !document.querySelector("dialog[open]")) {
    return switchTab(TABS[Number(e.key) - 1]);
  }
  if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && !document.querySelector("dialog[open]") && candKey(e)) return e.preventDefault();
  if (e.key !== "Escape") return;
  if (!$("ctx").hidden) return closeMenu();
  if (state.picked.size && !state.renaming) {
    state.picked.clear();
    renderSources();
  }
});
// A right-click on the Sources screen itself (not on a tape or a folder, which have menus of their own).
$("main").addEventListener("contextmenu", (e) => {
  if (!state.library || e.target.closest(".lib-tape, .lib-folder, .chip, input, button, .crumb")) return;
  e.preventDefault();
  const grid = state.libView === "grid", here = grid && state.libFolder ? libFolder(state.libFolder) : null;
  openMenu(e.clientX, e.clientY, [
    { title: here ? here.name : "Sources" },
    { label: here ? "New folder inside" : "New folder", run: () => newFolder(here ? here.id : null) },
    { label: "Process recording", run: processRecordings },
    { label: grid ? "Show as a list by day" : "Show as a grid", run: () => setLib({ libView: grid ? "day" : "grid" }) },
  ]);
});
document.addEventListener("dragend", endDrag);
document.addEventListener("pointerdown", (e) => {
  const box = $("problems-box");
  if (box && !box.contains(e.target) && $("main").contains(e.target)) foldProblems(state.id);
});
addEventListener("blur", closeMenu);
addEventListener("resize", closeMenu);
$("sources").addEventListener("scroll", closeMenu);
$("rec-form").onsubmit = processTicked;
$("rec-cancel").onclick = () => $("rec-dialog").close();
$("rec-dialog").addEventListener("close", placePlayer);
$("btn-analytics").prepend(svg(ICONS.chart));
$("btn-analytics").onpointerdown = press(() => showAnalytics(!state.analytics));   // on the press, like the list on the left
$("btn-audio").prepend(svg(ICONS.sliders));
$("btn-discord").prepend(svg(ICONS.discord));
$("btn-discord").onclick = () => (shell ? shell.discord(!(state.shell && state.shell.discord && state.shell.discord.open))
  : toast("The Discord bot works in Link's own window. Start Link from its Desktop icon.", true));
// A link the crew sent and the user opened from the widget: the Studio shows it, the link in the bar.
if (shell && shell.onStudio) shell.onStudio((url, kind) => { $("open-url").value = kind === "video" ? url : ""; showStudio(true, kind || "stream"); });
// The mixer is a window of Link's own, so in an ordinary browser the button only says so. The music
// player is opened from the mixer's Music row.
$("btn-audio").onclick = () => (shell ? shell.audioPanel(!(state.shell && state.shell.audioOpen))
  : toast("The mixer works in Link's own window. Start Link from its Desktop icon.", true));
if (shell && shell.audio) shell.audio.onLevels((levels) => { if (mixer) mixer.levels(levels); });
if (shell && shell.onSettings) shell.onSettings((section) => showSettings(section));   // "All settings" in the mixer's window
$("btn-insta").prepend(svg(ICONS.instagram));
$("btn-settings").prepend(svg(ICONS.gear));
$("btn-settings").onpointerdown = press(() => showSettings());
$("btn-insta").onclick = () => openInstagram();
$("btn-insta").oncontextmenu = (e) => { e.preventDefault(); askInstagram(); };
$("insta-form").onsubmit = saveInstagram;
$("insta-cancel").onclick = () => $("insta-dialog").close();
$("ask-dialog").addEventListener("close", placePlayer);
$("keep-dialog").addEventListener("close", placePlayer);
$("insta-dialog").addEventListener("close", placePlayer);  // the Studio's panel was taken away while the question was up
$("opener").onsubmit = openLink;
$("btn-file").onclick = uploadVideo;
for (const f of [$("open-url"), $("open-twitch")]) f.oninput = f.onfocus = () => { f.classList.remove("bad"); state.linkField = f.id; };
if (shell) {
  shell.onState(onShell);
  shell.state().then(onShell);
  if (shell.selfCheck) shell.selfCheck().then(showSelfCheck).catch(() => {});   // the start-up self-check card
  new ResizeObserver(placePlayer).observe($("main"));  // the window was resized, or a panel opened under the Studio
  setInterval(tickRecording, 500);
  setInterval(tickMonitors, 50);   // the readouts type and tick; nothing to do while no monitor shows
}
$("auto").onchange = () => api("/api/settings", "POST", { auto: $("auto").checked }).then(refreshStatus);
$("banner-load").onclick = async () => { state.draft = null; await refreshSources(); toast("Loaded the version on disk"); };
$("banner-keep").onclick = () => { state.force = true; $("banner").hidden = true; toast("Your next save will overwrite the version on disk"); };
$("lightbox").onclick = () => $("lightbox").close();

// Start-up screen: the dashboard loads behind it; a click or a key skips it. After the name the
// screen goes black (style.css) and the credit is typed here, the way a game types its dialogue:
// one letter at a time, with a breath after each sentence.
const CREDIT = ["* Created by Shushu.", "* The clips belong to the people who made them."];
(() => {
  const root = document.documentElement, boot = $("boot");
  if (!root.classList.contains("booting")) return;
  try { sessionStorage.setItem("link.booted", "1"); } catch (e) { /* plays again on reload, nothing worse */ }
  const LETTER = 34, BREATH = 380, HOLD = 1300, BLACK_AT = 4500;   // milliseconds
  const text = CREDIT.join("\n"), line = $("boot-credit");
  let timer = null, sound = null;
  // Each letter makes a short square-wave blip, as typed dialogue does in old games. It is made here,
  // not played from a file. A browser that will not start sound without a click just stays silent.
  const blip = () => {
    try {
      sound = sound || new AudioContext();
      if (sound.state !== "running") return;
      const tone = sound.createOscillator(), level = sound.createGain(), now = sound.currentTime;
      tone.type = "square";
      tone.frequency.setValueAtTime(470, now);
      tone.frequency.exponentialRampToValueAtTime(380, now + 0.05);
      level.gain.setValueAtTime(0.06, now);
      level.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      tone.connect(level).connect(sound.destination);
      tone.start(now);
      tone.stop(now + 0.06);
    } catch (e) { /* no sound device: the credit is typed in silence */ }
  };
  const type = (shown) => {
    line.textContent = text.slice(0, shown);
    if (/\S/.test(text[shown - 1])) blip();
    if (shown >= text.length) return void (timer = setTimeout(() => boot.classList.add("done"), HOLD));
    timer = setTimeout(type, text[shown - 1] === "." ? BREATH : LETTER, shown + 1);
  };
  // The block is as wide as the finished text and stays that wide, so it sits in the middle of the
  // window from the first letter instead of drifting as the lines grow.
  timer = setTimeout(() => {
    line.textContent = text;
    line.style.width = `${Math.ceil(line.getBoundingClientRect().width)}px`;
    type(1);
  }, BLACK_AT);
  const skip = () => { clearTimeout(timer); boot.classList.add("skip"); };
  boot.addEventListener("animationend", (e) => {
    if (e.target !== boot) return;
    root.classList.remove("booting");
    removeEventListener("keydown", skip);
    if (sound) sound.close();
    placePlayer();
    if (selfCheckPending) showSelfCheck(selfCheckPending);   // the self-check was ready behind the start-up screen
  });
  boot.addEventListener("click", skip);
  addEventListener("keydown", skip);
})();

refreshSources().catch((e) => toast(e.message, true));
loop();
resumeUnfinished();
// Once Link is open the room is measured, so that the gear wears its dot when room is running out.
// Nothing is said out loud: the dot is there, and Settings > Storage says the rest.
setTimeout(loadStorage, 8000);
setTimeout(loadAbout, 3000);   // which version this is, and whether Link just updated itself
