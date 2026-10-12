"use strict";
// Link Lite Recorder: the part that is always there. It starts and ends the capture of a stream's tab
// and hands the finished files to Chrome's downloads. The picture and sound themselves are handled by
// offscreen.js, a page nobody sees, because a service worker like this one cannot hold them; what the
// stream's page knows (which channel, how fast its chat goes, whether an ad plays) comes from content.js.
//
//   the panel / a shortcut  -->  here  --the tab's picture and sound-->  offscreen.js
//   content.js  --chat counts, ads, where the stream is, once a second-->  offscreen.js
//   stop, or "save the last minute"  -->  offscreen.js makes the file  -->  here: saved to Downloads/Link
//
// A tab is captured in one of two ways, and can go from one to the other:
//   rewind on   only the last few minutes are kept, in memory, so a moment can be saved afterwards
//   recording   everything from Record to Stop goes into a file
// One stream at a time: this is Link Lite. What is going on is kept in chrome.storage.session, since
// Chrome puts this worker to sleep between messages and wakes it with nothing remembered.
//
// The files are named and shaped as Link's own recorder makes them (tools/reels/shell/main.js), so
// Link takes them as it takes its own recordings:
//   2026-10-06 15-04-09.mp4            the recording
//   2026-10-06 15-04-09.markers.json   [seconds, ...]            the highlights marked
//   2026-10-06 15-04-09.notes.json     [{ t, note, auto }, ...]  what was written with a mark; auto: marked by the chat's speed
// (an mp4 holds all of these inside itself instead, under the same names; see saved())
//   2026-10-06 15-04-09.chat.json      { channel, site, rate }   chat messages per second (never what was written)
//   2026-10-06 15-04-09.ads.json       [[from, to], ...]         stretches in which Twitch played an ad
//   2026-10-06 15-04-09.stream.json    { title, category, channel, site, credit }   whose stream it is, for the credit on a reel
const FOLDER = "Link";   // inside the user's Downloads folder
const DEFAULTS = { streamOnly: true, clean: true, autoMarks: true, theatre: true, rewind: 60, ghost: false, volume: 1, skin: "classic" };
const RECENT = 8;        // how many finished recordings the panel lists

const session = chrome.storage.session;
const getCap = async () => (await session.get("cap")).cap || null;
const setCap = (cap) => (cap ? session.set({ cap }) : session.remove("cap"));
const options = async () => ({ ...DEFAULTS, ...((await chrome.storage.local.get("options")).options || {}) });

const two = (n) => String(n).padStart(2, "0");
function stamp(d) {   // the time in a recording's name, written as Link's own recorder writes it
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

function badge(text, color = "#c8282e") {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}
const showState = (cap) => (!cap ? badge("") : cap.state === "recording" ? badge("REC") : cap.state === "armed" ? badge("⟲", "#3f6f7a") : badge("…", "#7a5a1c"));

// To the stream's page; a page that has gone, or has no content script, is simply not told.
const toTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message).catch(() => null);
// To the recorder page. Every part of the extension hears a message; `target` says whose it is.
const toRecorder = (message) => chrome.runtime.sendMessage({ ...message, target: "offscreen" }).catch(() => null);
// What the stream's page does while its tab is captured: count, and keep the picture clean while it records.
const tellTab = async (cap, on) => toTab(cap.tabId, { type: "link:capture", on, recording: on && cap.state === "recording", clean: (await options()).clean });

async function recorderPage() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Records the stream in the tab the user chose, and keeps its sound audible while it is recorded.",
  });
}
// The recorder page goes once nothing uses it: no capture, and every file copied to Downloads.
async function closeIfIdle() {
  if (await getCap()) return;
  const { saving } = await session.get("saving");
  if (saving && Object.keys(saving).length) return;
  if (await chrome.offscreen.hasDocument()) chrome.offscreen.closeDocument().catch(() => {});
}

// Starts capturing the tab: with a recording (`record`), or with only the rewind on.
async function begin(tab, record) {
  if (await getCap()) return { ok: false, error: "Link Lite is capturing a stream already. It takes one stream at a time." };
  if (!tab || !tab.id) return { ok: false, error: "There is no tab to record." };
  let who = await toTab(tab.id, { type: "link:who" });
  if (!who || !who.channel) return { ok: false, error: "Open a Kick or Twitch channel in this tab first." };
  if (who.gate) return { ok: false, error: "Twitch is asking before it shows this stream. Press Start Watching on the page first, then record." };
  // The size of the file is set when it starts, from where the stream's picture is: a player that is
  // still loading is given a few seconds to show it.
  // The stream's title is waited for as well: the site shows it a moment after the page, and a recording
  // begun at once would otherwise not know what it is a recording of.
  for (let i = 0; i < 8 && (!who.view || !who.title); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    who = (await toTab(tab.id, { type: "link:who" })) || who;
  }
  const about = { tabId: tab.id, site: who.site, channel: who.channel, title: who.title || "", category: who.category || "" };
  // A recording is as sharp as the stream is big on the page, and that is settled when it starts. So the
  // site's theatre mode is switched on first (it can be chosen off), the page is given a moment to lay
  // itself out, and the stream's place is read again. It is switched back when the recording ends.
  if (record && (await options()).theatre) {
    const res = await toTab(tab.id, { type: "link:theatre", on: true });
    if (res && res.ok && res.changed) {
      about.theatred = Date.now();
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const now = await toTab(tab.id, { type: "link:who" });
        if (now && now.view && who.view && now.view.w === who.view.w && now.view.h === who.view.h && i > 1) break;   // it has stopped moving
        if (now && now.view) who = { ...who, view: now.view };
      }
    }
  }
  await setCap({ ...about, state: "starting" });
  showState({ state: "starting" });
  try {
    const opts = await options();
    // Allowed only right after the user used the extension on this tab (its button or a shortcut).
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await recorderPage();
    const res = await toRecorder({ type: "start", streamId, record, autoMarks: opts.autoMarks, volume: opts.volume, view: opts.streamOnly ? who.view : null, screen: who.view, meta: about });
    if (!res || !res.ok) throw new Error((res && res.error) || "The capture did not start.");
    const cap = { ...about, state: record ? "recording" : "armed", armed: !record, since: res.since, width: res.width, height: res.height, rewind: !!res.rewind };
    await setCap(cap);
    await tellTab(cap, true);
    showState(cap);
    return { ok: true };
  } catch (e) {
    await setCap(null);
    showState(null);
    await toRecorder({ type: "end" });
    closeIfIdle();
    const message = String((e && e.message) || e);
    return { ok: false, error: /invoked|activeTab/i.test(message) ? "Chrome lets Link record a tab only right after you press Link's button or its shortcut on that tab. Try again from the stream's tab." : message };
  }
}

// Record: a new capture, or (the rewind is on) a recording that begins some seconds back.
async function record(tab) {
  const cap = await getCap();
  if (!cap) return begin(tab, true);
  if (cap.state !== "armed") return { ok: false, error: "Link Lite is recording already." };
  const res = await toRecorder({ type: "record", back: (await options()).rewind });
  if (!res || !res.ok) return res || { ok: false, error: "The recorder did not answer." };
  const next = { ...cap, state: "recording" };
  await setCap(next);
  await tellTab(next, true);
  showState(next);
  return { ok: true, back: res.back };
}

async function arm(tab) {
  const cap = await getCap();
  if (!cap) return begin(tab, false);
  await toRecorder({ type: "armed", on: true });   // recording: the rewind stays on when it stops
  await setCap({ ...cap, armed: true });
  return { ok: true };
}

// The rewind is switched off. A recording that runs goes on; otherwise the tab is let go.
async function disarm() {
  const cap = await getCap();
  if (!cap) return { ok: true };
  if (cap.state === "recording") {
    await toRecorder({ type: "armed", on: false });
    await setCap({ ...cap, armed: false });
    return { ok: true };
  }
  await toRecorder({ type: "end" });
  await toTab(cap.tabId, { type: "link:capture", on: false });
  await setCap(null);
  showState(null);
  closeIfIdle();
  return { ok: true };
}

async function stop() {
  const cap = await getCap();
  if (!cap || cap.state !== "recording") return { ok: false, error: "Nothing is being recorded." };
  await setCap({ ...cap, state: "saving" });
  showState({ state: "saving" });
  const done = await toRecorder({ type: "stop" });
  return finish(cap, done, "");
}

// The last `seconds` out of the rewind, as a file. The rewind goes on.
async function saveLast(seconds) {
  const cap = await getCap();
  if (!cap || cap.state !== "armed") return { ok: false, error: cap ? "A recording is running: stop it to save it." : "The rewind is not on." };
  const done = await toRecorder({ type: "save", seconds: seconds || (await options()).rewind });
  return saved(cap, done, "");
}

// A recording has ended (stopped by the user, or by itself: the tab went, or it reached Lite's length).
async function finish(cap, done, note) {
  const goesOn = !!(done && done.capture);
  if (cap.theatred) toTab(cap.tabId, { type: "link:theatre", on: false });   // the page as it was before the recording
  const next = goesOn ? { ...cap, state: "armed", armed: true, theatred: 0 } : null;
  await setCap(next);
  if (next) await tellTab(next, true);
  else await toTab(cap.tabId, { type: "link:capture", on: false });
  showState(next);
  const res = await saved(cap, done, note);
  closeIfIdle();
  return res;
}

// Hands a finished file and what belongs to it to Chrome's downloads, and remembers it for the panel.
async function saved(cap, done, note) {
  const last = { at: Date.now(), channel: cap.channel, site: cap.site, note: note || "", error: "", name: "", seconds: 0, marks: 0 };
  if (!done || !done.ok || !done.url) {
    last.error = (done && done.error) || "The recording could not be saved.";
    await session.set({ last });
    return { ok: false, error: last.error };
  }
  // Named after whose stream it is and when it began: "cammytft 2026-10-08 15-07-12". (Only letters, digits,
  // _ and - of the channel's name are kept: it becomes part of a file's name.)
  const whose = String(cap.channel || "").replace(/[^\w-]+/g, "").slice(0, 40);
  const name = `${whose ? whose + " " : ""}${stamp(new Date(done.wall || Date.now()))}`;
  // What belongs to the recording. An mp4 takes it inside itself (offscreen.js, tag()): one file, one
  // download, Downloads/Link/<its name>.mp4. Any other kind of file cannot, and gets a folder of its own,
  // Downloads/Link/<its name>/, with the small files beside the video; those are taken off the browser's
  // list of downloads once they are written (the files stay).
  const belongs = {
    v: 1, markers: done.marks, notes: done.notes, chat: done.chat || null, ads: done.ads,
    // whose stream it is goes with every recording: the clips belong to the people who made them
    stream: { title: cap.title, category: done.category || cap.category || "", channel: cap.channel, site: cap.site, credit: `${cap.site === "twitch" ? "twitch.tv" : "kick.com"}/${cap.channel}` },
  };
  const whole = done.ext === "mp4" ? await toRecorder({ type: "tag", url: done.url, data: belongs }) : null;
  const inside = !!(whole && whole.ok);
  if (inside) Object.assign(done, { url: whole.url, size: whole.size });
  const json = async (suffix, data) => {
    const small = await chrome.downloads.download({
      url: "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(data)))),
      filename: `${FOLDER}/${name}/${name}.${suffix}.json`, conflictAction: "overwrite", saveAs: false,
    }).catch(() => null);
    if (small != null) unlist(small);
  };
  try {
    const filename = inside ? `${FOLDER}/${name}.${done.ext}` : `${FOLDER}/${name}/${name}.${done.ext}`;
    naming.set(done.url, filename);
    const id = await chrome.downloads.download({ url: done.url, filename, conflictAction: "uniquify", saveAs: false });
    const { saving } = await session.get("saving");
    await session.set({ saving: { ...(saving || {}), [id]: done.url } });   // let go of in the recorder page once Chrome has the whole file (see below)
    if (!inside) {
      if (done.marks.length) await json("markers", done.marks);
      if (done.notes.length) await json("notes", done.notes);
      if (done.chat) await json("chat", done.chat);
      if (done.ads.length) await json("ads", done.ads);
      await json("stream", belongs.stream);
    }
    // each mark with its note, kept for the panel: an editor who has no Link reads them there
    const points = done.marks.map((t) => { const n = done.notes.find((x) => x.t === t) || {}; return { t, note: n.note || "", ...(n.auto ? { auto: true } : {}) }; });
    Object.assign(last, { id, points, name: `${name}.${done.ext}`, seconds: done.seconds, marks: done.marks.length, autos: done.notes.filter((n) => n.auto).length, chat: !!done.chat, size: done.size, rewound: !!done.rewound });
    const { recent } = await chrome.storage.local.get("recent");
    await chrome.storage.local.set({ recent: [last, ...(recent || [])].slice(0, RECENT) });
  } catch (e) {
    last.error = `Chrome could not save the recording (${e.message}).`;
    toRecorder({ type: "discard", url: done.url });
  }
  await session.set({ last });
  return last.error ? { ok: false, error: last.error } : { ok: true, last };
}

// A recording's marks as a file DaVinci Resolve takes: an EDL of markers (in Resolve: right-click the
// timeline in the media pool, Timelines > Import > Timeline Markers from EDL). It is written the way
// Resolve writes such a file itself: one event a mark, and under it a line with the marker's colour,
// name and length. Times are counted from 01:00:00:00, where Resolve's timelines begin, at 30 frames a
// second; put the recording at the very start of the timeline and the markers stand on its moments.
// A mark of the chat's speed is yellow, one made by hand blue.
function edl(title, points) {
  const two = (n) => String(n).padStart(2, "0");
  const code = (frames) => { const f = 3600 * 30 + frames; return `${two(Math.floor(f / 108000))}:${two(Math.floor((f % 108000) / 1800))}:${two(Math.floor((f % 1800) / 30))}:${two(f % 30)}`; };
  const plain = (text) => String(text).replace(/[|\r\n]+/g, " ").trim().slice(0, 80);
  const lines = [`TITLE: ${plain(title)}`, "FCM: NON-DROP FRAME", ""];
  points.forEach((p, i) => {
    const at = Math.max(0, Math.round(p.t * 30));
    lines.push(`${String(i + 1).padStart(3, "0")}  001      V     C        ${code(at)} ${code(at + 1)} ${code(at)} ${code(at + 1)}  `);
    lines.push(` |C:ResolveColor${p.auto ? "Yellow" : "Blue"} |M:${plain(p.note) || (p.auto ? "Chat sped up" : `Mark ${i + 1}`)} |D:1`);
    lines.push("");
  });
  return lines.join("\r\n");
}
async function markerFile({ at }) {
  const { recent } = await chrome.storage.local.get("recent");
  const rec = (recent || []).find((r) => r.at === at);
  if (!rec || !rec.points || !rec.points.length) return { ok: false, error: "This recording has no marks." };
  const base = rec.name.replace(/\.[a-z0-9]+$/i, "");
  const url = "data:application/octet-stream;base64," + btoa(unescape(encodeURIComponent(edl(base, rec.points))));   // not "text": the browser would rename it .txt
  const filename = `${FOLDER}/${base}.markers.edl`;
  naming.set(url, filename);
  const id = await chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false }).catch(() => null);
  return id == null ? { ok: false, error: "The marker file could not be saved." } : { ok: true, id, name: `${base}.markers.edl` };
}

// A recording is deleted from the panel's list: its file is taken off the computer (not to the recycle
// bin: the browser deletes it), and it leaves the browser's list of downloads and the panel's. A file
// that was moved or deleted by hand cannot be found any more; its line just goes.
async function removeRecording({ at, id }) {
  if (id != null) {
    await chrome.downloads.removeFile(id).catch(() => {});
    await chrome.downloads.erase({ id }).catch(() => {});
  }
  const { recent } = await chrome.storage.local.get("recent");
  await chrome.storage.local.set({ recent: (recent || []).filter((r) => r.at !== at) });
  const { last } = await session.get("last");
  if (last && last.at === at) await session.remove("last");
  return { ok: true };
}

// The recording's name is said a second time, where the browser asks every extension what a download is
// to be called. Without this, another extension that names downloads (a download manager) can take the
// name away, and the file is then called by the long number of its address.
const naming = new Map();   // address of a recording being saved -> its name
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const filename = item.byExtensionId === chrome.runtime.id ? naming.get(item.url) : null;
  if (!filename) return;   // not a recording of Link's: nothing is said about it
  naming.delete(item.url);
  suggest({ filename, conflictAction: "uniquify" });
});

// A small file beside a recording leaves the browser's list of downloads when it is written. It may be
// written already when this is asked (it is tiny), or only a moment later: both are seen to.
async function unlist(id) {
  const [item] = await chrome.downloads.search({ id }).catch(() => []);
  if (item && item.state === "complete") return void chrome.downloads.erase({ id }).catch(() => {});
  const { aside } = await session.get("aside");
  await session.set({ aside: [...(aside || []), id] });
  const [again] = await chrome.downloads.search({ id }).catch(() => []);   // written while it was being noted
  if (again && again.state === "complete") chrome.downloads.erase({ id }).catch(() => {});
}

// A recording is a file inside the recorder page until Chrome has copied it to Downloads; then it is let go.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current === "in_progress") return;
  const { aside } = await session.get("aside");
  if (aside && aside.includes(delta.id)) {
    await session.set({ aside: aside.filter((i) => i !== delta.id) });
    if (delta.state.current === "complete") chrome.downloads.erase({ id: delta.id }).catch(() => {});
    return;
  }
  const { saving } = await session.get("saving");
  if (!saving || !(delta.id in saving)) return;
  const url = saving[delta.id];
  delete saving[delta.id];
  await session.set({ saving });
  if (delta.state.current === "interrupted") {
    const { last } = await session.get("last");
    if (last && last.id === delta.id) await session.set({ last: { ...last, error: "Chrome did not finish saving the recording." } });
  }
  await toRecorder({ type: "discard", url });
  closeIfIdle();
});

async function mark() {
  const cap = await getCap();
  if (!cap || (cap.state !== "recording" && cap.state !== "armed")) return { ok: false, error: "Nothing is being recorded." };
  const res = await toRecorder({ type: "mark" });
  if (res && res.ok) {
    badge(`★${res.marks}`, "#d9a52a");
    setTimeout(async () => showState(await getCap()), 1500);
  }
  return res || { ok: false, error: "The recorder did not answer." };
}

// ---- skins: the panel in other colours (popup.css). Every one is everybody's; options.skin is the one in use ----
const SKINS = [
  { id: "classic", name: "Classic" },
  { id: "midnight", name: "Midnight" },
  { id: "sakura", name: "Sakura" },
  { id: "hallow", name: "Halloween" },   // an experiment: webs, a spider on its thread
];
async function skinState() {
  const using = (await options()).skin;
  return { using: SKINS.some((s) => s.id === using) ? using : "classic", list: SKINS };
}

// Versions before 0.5.0 kept a count of recordings and a licence key in the browser's storage. Neither is
// used any more, and what they left there is taken away when this version arrives.
function forgetLicence() {
  chrome.storage.local.remove(["licence", "trial", "skins", "rewindCounted"]);
  chrome.storage.sync.remove("trial").catch(() => {});
}

async function state(tabId) {
  const cap = await getCap();
  const { last } = await session.get("last");
  const stats = cap && (cap.state === "recording" || cap.state === "armed") ? await toRecorder({ type: "stats" }) : null;
  const who = tabId ? await toTab(tabId, { type: "link:who" }) : null;
  const { recent } = await chrome.storage.local.get("recent");
  return { cap, stats, last: last || null, who, options: await options(), here: !!(cap && cap.tabId === tabId), recent: recent || [], skins: await skinState() };
}

async function setOptions(changed) {
  if ("skin" in changed && !SKINS.some((k) => k.id === changed.skin)) delete changed.skin;   // only a skin there is
  await chrome.storage.local.set({ options: { ...(await options()), ...changed } });
  const cap = await getCap();
  if (cap && "autoMarks" in changed) toRecorder({ type: "options", autoMarks: changed.autoMarks });
  if (cap && "clean" in changed) tellTab(cap, true);
  return options();
}

// The panel's sound bar: how loud the stream is heard while its tab is captured. The recording is not
// touched by it. `keep`: it is the level for next time too (a mute is not: the next capture is heard again).
async function setVolume({ level, keep }) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  const res = await toRecorder({ type: "volume", level: v });
  if (keep && v >= 0.05) await chrome.storage.local.set({ options: { ...(await options()), volume: v } });
  return res || { ok: false };
}

// On kick.com and twitch.tv Link's window is a small panel on the page itself (content.js draws it), so the
// toolbar button has no popup there and its press comes here instead. Anywhere else the popup opens as usual.
//
// A stream's page that was open before the extension was (it was just installed, updated or loaded
// again) has no content.js, or a dead one: the browser puts it only into pages loaded afterwards. So it
// is put into every such page when the extension starts, and once more when the button finds a page
// that does not answer. The page need not be loaded again.
const STREAM_PAGES = chrome.runtime.getManifest().content_scripts[0].matches;
const wake = (tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).then(() => true, () => false);
async function wakeAll() {
  for (const tab of await chrome.tabs.query({ url: STREAM_PAGES }).catch(() => [])) {
    if (!(await toTab(tab.id, { type: "link:who" }))) await wake(tab.id);
  }
}
chrome.action.onClicked.addListener(async (tab) => {
  if (await toTab(tab.id, { type: "link:panel" })) return;
  if (await wake(tab.id) && await toTab(tab.id, { type: "link:panel" })) return;
  await chrome.action.setPopup({ tabId: tab.id, popup: "popup.html" });
  chrome.action.openPopup().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || message.target || typeof message.type !== "string" || !message.type.startsWith("link:")) return;
  const tabOf = async () => chrome.tabs.get(message.tabId || sender.tab.id);
  const run = async () => {
    if (message.type === "link:here") { if (sender.tab) await chrome.action.setPopup({ tabId: sender.tab.id, popup: "" }); return { ok: true }; }
    if (message.type === "link:record") return record(await tabOf());
    if (message.type === "link:arm") return arm(await tabOf());
    if (message.type === "link:disarm") return disarm();
    if (message.type === "link:stop") return stop();
    if (message.type === "link:save") return saveLast(message.seconds);
    if (message.type === "link:mark") return mark();
    if (message.type === "link:note") return toRecorder({ type: "note", index: message.index, text: message.text });
    if (message.type === "link:theatre") return toTab(message.tabId || (sender.tab && sender.tab.id), { type: "link:theatre" });
    if (message.type === "link:state") return state(message.tabId || (sender.tab && sender.tab.id));
    if (message.type === "link:options") return setOptions(message.options || {});
    if (message.type === "link:volume") return setVolume(message);
    if (message.type === "link:forget") { await session.remove("last"); return { ok: true }; }
    if (message.type === "link:delete") return removeRecording(message);
    if (message.type === "link:markers") return markerFile(message);
    if (message.type === "link:reveal") { chrome.downloads.show(message.id); return { ok: true }; }
    if (message.type === "link:show") { const cap = await getCap(); if (cap) { const tab = await chrome.tabs.update(cap.tabId, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); } return { ok: true }; }
    if (message.type === "link:ended") {   // from the recorder page: it ended by itself
      const cap = await getCap();
      if (!cap) return null;
      if (message.result) return finish(cap, message.result, message.note);
      await toTab(cap.tabId, { type: "link:capture", on: false });   // only the rewind was on, and its tab has gone
      await setCap(null);
      showState(null);
      closeIfIdle();
      return { ok: true };
    }
    return null;
  };
  run().then(reply, (e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "mark") return void mark();
  const fail = async (res) => { if (res && res.ok === false) { await session.set({ last: { at: Date.now(), error: res.error, name: "", seconds: 0, marks: 0 } }); badge("!", "#c8282e"); } };
  if (command === "save-last") return void fail(await saveLast());
  if (command !== "toggle-record") return;
  const cap = await getCap();
  if (cap && cap.state === "recording") return void stop();
  if (cap && cap.state !== "armed") return;
  fail(await record(tab));
});

// Chrome was closed or the extension reloaded while something was written down as going on: nothing is.
chrome.runtime.onStartup.addListener(() => { setCap(null); session.remove("saving"); badge(""); });
chrome.runtime.onInstalled.addListener(() => { setCap(null); session.remove("saving"); badge(""); forgetLicence(); wakeAll(); });
