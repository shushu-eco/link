"use strict";
// Link's window: the dashboard (served by ui/server.py) plus a browser panel and a recorder of its own.
//
//   electron tools/reels/shell [--link-url=http://127.0.0.1:8765]
//
// The dashboard page talks to this file through window.linkShell (see preload.js):
//   open(url)        show a web page in the browser panel
//   bounds(rect)     where the panel sits inside the window, or null to hide it
//   nav(action)      back | forward | reload
//   close()          close the page in the panel
//   loud()           set the page's video to full volume (the recording is as loud as the page plays)
//   ads(on)          turn the panel's ad blocker on or off (on by default; the choice is remembered)
//   mute(on)         keep the panel's sound from the speakers; a recording still gets it
//   record() stop()  record the panel's picture and sound to a file in the recording folder
//   mark(id?)        remember this moment of the recording as a highlight (of channel id, or the one recording)
//   show(id) minimise() stopChannel(id)   the channels: several streams recorded side by side, see below
//   state() onState  what the panel and the recorder are doing
//   copy(text)       put text on the clipboard
//   pick()           ask for a video file on this PC; gives its path, or null when the user cancels
//   audioPanel(on)   show or hide the mixer, a window of its own above this one (see "the sound")
//   audio.*          the mixer's settings, also shown by Settings > Audio in the dashboard
//   quality(mbit)    how many megabits a second a recording's picture gets
//   about() reveal(which)   versions for Settings > About, and one of Link's folders opened in Explorer
//   music(on)        show or hide the small music player, a window of its own above this one
//   discord(on)      show or hide the Discord widget (the user's own bot, see "the Discord bot" below)
//
// A recording is written as "<date time>.part.webm" while it runs and becomes "<date time>.mp4" when
// it stops, in the folder the server names (the user's Videos), where ingest.py picks it up.
// Highlights marked during it go to "<date time>.markers.json", and the stretches in which Twitch
// played an ad to "<date time>.ads.json".
// A Kick or Twitch channel opens as the site's bare player, so only the stream is recorded. While one plays, a hidden
// window counts its chat; a recording made meanwhile keeps the count per second (never what was written)
// in "<date time>.chat.json", which ingest.py hands to the analysis as a sign of the exciting moments.
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, screen, session, shell } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const { DiscordBot, OWNER_COMMANDS, NIGHT_COMMANDS } = require("./discord");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DASHBOARD = arg("link-url", "http://127.0.0.1:8765");
const ICON = path.join(__dirname, "..", "ui", "static", "link_desktop.ico");
const WEB = /^https?:\/\//i;
const VIDEO_CHOICES = [4, 6, 8, 12];   // megabits a second for a recording's picture; 6 is about 45 MB a minute

// The Studio's cookies and sign-ins. In the user's folder and not under AppData, see link.pyw.
// Where Link keeps its own things (~/.link). LINK_HOME puts them elsewhere: a test runs a private copy of
// Link beside the user's own, with settings, sign-ins and a single-instance lock of its own.
const HOME = process.env.LINK_HOME || app.getPath("home");
app.setPath("userData", path.join(HOME, ".link", "shell"));
app.setAppUserModelId("Link");
// A page that is covered by another window must keep drawing, or the recording freezes.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.LINK_DEBUG_PORT) {  // lets a script drive the window; normally unset
  app.commandLine.appendSwitch("remote-debugging-port", process.env.LINK_DEBUG_PORT);
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}
// For tests: every microphone request gets Chromium's stand-in (a beep), so the real one is never opened.
if (process.env.LINK_FAKE_MIC) app.commandLine.appendSwitch("use-fake-device-for-media-stream");

// closing: false, or (the window was closed on a recording) the recordings saved since, to process next time
let win = null, closing = false, closeAnswered = false;
let closingForNight = false;   // the night run asked Link to close (it opens Link again itself)
let slot = null;   // the panel's place in the window as the page last reported it
let hushed = false; // the user's Sound off: the stream on screen is kept from the speakers; its recording still gets it

// The Studio holds up to three channels, each a stream of its own with its own player, recorder and
// chat counter, so several streams can be recorded side by side. One is on screen; the others are
// minimised to pills on the dashboard and keep recording, silent for the user. Each recording takes
// only its own page's picture and sound (its recorder lives in a session of its own and is handed
// only its own player's frame), so the streams never mix.
//
// Beside them, URL holds one video (a YouTube link, say) for a quick reel. It is a channel too, of
// kind "video", recorded the same way; it does not count towards the three streams. The dashboard
// shows either the Studio or URL, and each keeps the channel it last showed (`shown`).
const MAX_CHANNELS = 3;
const channels = [];
let cur = null;      // the channel on screen; null when the Studio is empty (e.g. right after minimising)
let channelSeq = 0;
let view = "stream"; // which the dashboard shows: the Studio ("stream") or URL ("video")
const shown = { stream: null, video: null };
const streams = () => channels.filter((c) => c.kind === "stream");

function newChannel(kind = "stream") {
  return {
    id: ++channelSeq, kind, player: null, recorder: null, kickLoud: "",
    slot: null,     // a stream's place among the three (CH-1 to CH-3), kept while it is open
    // its sound, see "the sound": the volume in its recording (decibels), and whether the user hears it when not in solo
    // held: it records, so its page is kept silent and the recorder page plays it to the user instead (see applySound)
    audio: { gain: acfg.volume, limiter: acfg.limiter, mono: false, listen: true, ready: false, level: null, engine: null, held: false, direct: false },
    volume: null,   // how loud the page plays, see checkMedia
    length: null,   // how long its video is, in seconds
    fills: null,    // whether the video fills the panel (otherwise the page around it is recorded too)
    subtitles: false, // whether the video's own subtitles are on (they would be recorded)
    stage: null,    // what a Twitch player is doing: "live", "starting", "offline" or "ad" (see TWITCH_TIDY);
                    // of a Kick channel "live" or "offline" as Kick's API says, when a Kick app is connected (see kickSays)
    kick: { name: "", at: 0, says: null },   // what Kick's API last said about its channel: { live, title, category, viewers }
    rec: { active: false, starting: false, saving: false, since: 0, part: "", file: "", out: null, marks: [], ads: [], size: null,
           error: "", waiting: null, chat: [], chatChannel: null, chatSite: null, chatSeen: false, lastWhat: "", watched: false },
    chat: { channel: null, site: null, view: null, top: null, ok: false, last: [], perMin: 0, since: 0, timer: null, relayed: null, queue: [], relaying: "" },
  };
}
const busy = (c) => c.rec.active || c.rec.starting || c.rec.saving;
const recordingNow = () => channels.filter((c) => c.rec.active);
let saved = [];   // the last recordings saved, newest first, for the page to process each one

// ---------------------------------------------------------------- state for the page

function channelName(c) {
  if (c.chat.channel) return c.chat.channel;
  const wc = c.player && c.player.webContents;
  return (wc && (wc.getTitle() || wc.getURL())) || "Empty";
}

// ---- an update, asked for by the Updater (tools/reels/update.py, restart_link). The Updater leaves a note
// in ~/.link/restart.json; this window answers in the same note. With nothing in the way it says "Update
// is underway" over the whole window, closes, and the launcher (link.pyw) starts Link again with the code
// that is on the PC now. A recording or a job is never cut short: the update waits for it and goes in then.
const RESTART_FILE = path.join(HOME, ".link", "restart.json");
let updateGoing = false;
function sayOnPage(html) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => {
    let box = document.getElementById("update-note");
    if (!box) { box = document.createElement("div"); box.id = "update-note"; document.body.append(box); }
    box.innerHTML = ${JSON.stringify(html)};
  })()`).catch(() => {});
}
async function hearUpdate() {
  if (updateGoing || !win || win.isDestroyed()) return;
  let asked;
  try { asked = JSON.parse(fs.readFileSync(RESTART_FILE, "utf8")); } catch (e) { return; }
  if (!asked || asked.state === "restarting") return;
  const answer = (state) => { if (asked.state !== state) { try { fs.writeFileSync(RESTART_FILE, JSON.stringify({ ...asked, state })); } catch (e) { /* asked again in a moment */ } } };
  const wait = (state, why) => {
    answer(state);
    sayOnPage(`<div class="update-bar">▲ AN UPDATE IS READY${asked.version ? ` · rwa-${asked.version}` : ""} <span>${why}</span></div>`);
  };
  if (channels.some((c) => c.rec.active || c.rec.saving || c.rec.starting)) return wait("recording", "It goes in by itself when the recordings are stopped.");
  let job = false;
  try { job = !!(await (await fetch(`${DASHBOARD}/api/status`)).json()).job.running; } catch (e) { /* no answer: nothing is running */ }
  if (job) return wait("working", "It goes in by itself when Link has finished what it is doing.");
  updateGoing = true;
  answer("restarting");
  for (const c of channels) { if (c.player) { try { c.player.setVisible(false); } catch (e) { /* it is closing anyway */ } } }
  sayOnPage(`<div class="update-over"><div><b>UPDATE IS UNDERWAY</b><span>${asked.version ? `rwa-${asked.version} · ` : ""}Link closes and opens again by itself.</span></div></div>`);
  setTimeout(() => { closeAnswered = true; if (win && !win.isDestroyed()) win.close(); }, 2200);
}

function snapshot() {
  const c = cur || {};
  const player = c.player, rec = c.rec || {}, chat = c.chat || {};
  const wc = player && player.webContents;
  return {
    view,
    kind: c.kind || view,
    open: !!player,
    url: wc ? wc.getURL() : "",
    title: wc ? wc.getTitle() : "",
    loading: wc ? wc.isLoading() : false,
    canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
    canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
    volume: player ? c.volume : null,
    length: player ? c.length : null,
    fills: player ? c.fills : null,
    subtitles: player ? c.subtitles : false,
    stage: player ? c.stage : null,
    stream: player && c.kick && chat.site === "kick" && c.kick.name === chat.channel ? c.kick.says : null,
    size: player ? recordingSize(c) : null,   // what a recording started now would measure
    muted: hushed,
    ads: { on: ads.on, ready: !!ads.engine, error: ads.error },
    recording: rec.active ? { since: rec.since, marks: rec.marks.length, ...rec.size } : null,
    chat: chat.channel ? { channel: chat.channel, site: chat.site, ok: chat.ok, perMin: chat.perMin, since: chat.since } : null,
    busy: !!(rec.starting || rec.saving),
    saving: !!rec.saving,
    last: saved[0] || null,
    saved,
    error: rec.error || "",
    // every channel, for the pills of the minimised ones
    channels: channels.map((k) => ({ id: k.id, kind: k.kind, slot: k.slot, current: k === cur, name: channelName(k), kick: !!k.chat.channel, open: !!k.player,
      recording: k.rec.active ? { since: k.rec.since, marks: k.rec.marks.length, ...k.rec.size } : null,
      starting: k.rec.starting, saving: k.rec.saving, volume: k.volume,
      chat: k.chat.channel ? { site: k.chat.site, ok: k.chat.ok, perMin: k.chat.perMin } : null })),
    maxChannels: MAX_CHANNELS,
    audio: audioState(),
    audioOpen: !!(audioWin && !audioWin.isDestroyed() && audioWin.isVisible()),
    quality: { video: videoMbit(), choices: VIDEO_CHOICES },
    music: !!(music && !music.isDestroyed() && music.isVisible()),
    discord: { open: !!(discordWin && !discordWin.isDestroyed() && discordWin.isVisible()), state: bot ? bot.state : "off", unseen: dc.unseen },
  };
}

// While Link closes, a window can still be there for a moment after its page is gone, and a message
// sent to it then throws ("Object has been destroyed"). Every message to a window asks this first.
const alive = (w) => !!w && !w.isDestroyed() && !!w.webContents && !w.webContents.isDestroyed();

function push() {
  if (alive(win)) win.webContents.send("shell:state", snapshot());
  pushAudio();
}

// ---------------------------------------------------------------- the ad blocker

// Ads in the panel would end up in the recording. The blocker (Ghostery's, with the public filter
// lists) works on the panel's pages only, never on the dashboard. A site that refuses to play with
// it can be opened with the blocker switched off in the Studio.
const PANEL = "persist:player";
const CHOICES = path.join(app.getPath("userData"), "link-shell.json");
const LISTS = path.join(app.getPath("userData"), "adblock-engine.bin");
const LISTS_MAX_AGE = 24 * 3600 * 1000;   // the lists change daily, YouTube's rules most of all
const ads = { on: true, engine: null, error: "" };
// What the user chose and Link keeps for the next start: the ad blocker, and where the music player sits.
let choices = {};
try { choices = JSON.parse(fs.readFileSync(CHOICES, "utf8")) || {}; } catch (e) { /* first start */ }
ads.on = choices.ads !== false;
const choose = (more) => {
  Object.assign(choices, more);
  fs.writeFile(CHOICES, JSON.stringify(choices), () => {});
};
const videoMbit = () => (VIDEO_CHOICES.includes(choices.videoMbit) ? choices.videoMbit : 6);

async function loadBlocker() {
  let age = Infinity;
  try { age = Date.now() - fs.statSync(LISTS).mtimeMs; } catch (e) { /* no copy yet */ }
  if (age > LISTS_MAX_AGE) {
    try {
      const fresh = await ElectronBlocker.fromPrebuiltAdsOnly(fetch);
      fs.writeFileSync(LISTS, fresh.serialize());
      return fresh;
    } catch (e) { /* no internet: an older copy still blocks most ads */ }
  }
  return ElectronBlocker.fromPrebuiltAdsOnly(fetch, { path: LISTS, read: fs.promises.readFile, write: fs.promises.writeFile });
}

// The blocker runs each of its page scripts in the page's global scope, one after another. The
// scripts that remove YouTube's ads share helper classes, so from the second one on they fail with
// "Identifier has already been declared" and the ads stay. Giving each script a scope of its own,
// and running it in the frame that asked rather than always the main one, makes them work.
function scopeScripts(engine) {
  const inject = engine.onInjectCosmeticFilters;
  engine.onInjectCosmeticFilters = (event, url, message) => inject({
    frameId: event.frameId,
    processId: event.processId,
    sender: {
      insertCSS: (css, options) => event.sender.insertCSS(css, options),
      executeJavaScript: (script, gesture) => (event.senderFrame || event.sender).executeJavaScript(`{\n${script}\n}`, gesture).catch(() => {}),
    },
  }, url, message);
  return engine;
}

function applyBlocker() {
  if (!ads.engine) return;
  const panel = session.fromPartition(PANEL);
  const active = ads.engine.isBlockingEnabled(panel);
  if (ads.on && !active) ads.engine.enableBlockingInSession(panel);
  if (!ads.on && active) ads.engine.disableBlockingInSession(panel);
}

let blockerReady = Promise.resolve();
function startBlocker() {
  blockerReady = loadBlocker()
    .then((engine) => { ads.engine = scopeScripts(engine); applyBlocker(); })
    .catch((e) => { ads.error = `The ad blocker could not load its lists (${e.message}).`; })
    .then(push);
}

function setBlocking(on) {
  ads.on = !!on;
  choose({ ads: ads.on });
  applyBlocker();
  for (const c of channels) if (c.player) c.player.webContents.reload();
  push();
}


// ---------------------------------------------------------------- the browser panel

// The channel on screen fills the panel; the others are hidden. A hidden channel that records keeps
// drawing at its size, because its recorder counts as someone watching it (see startRecording).
function place() {
  const shown = !!slot && slot.width >= 2 && slot.height >= 2;
  for (const c of channels) {
    if (!c.player) continue;
    if (c === cur && shown) c.player.setBounds(slot);
    c.player.setVisible(c === cur && shown);
  }
}

// Who the user hears: only the stream on the big screen, or each stream by its own switch, and none of
// them with Sound off (see "the sound"). The recorder pages hear of it too: the microphone follows the
// big screen.
// A page that records is always silent itself, and its recorder page plays it to the user when it is
// to be heard. Switching a page's own sound back on makes Chromium reopen its output, which puts about
// a second of silence into its recording; this way nothing is switched while it records.
function applySound() {
  for (const c of channels) {
    if (c.player) c.player.webContents.setAudioMuted((c.audio.held && !c.audio.direct) || silentFor(c));
    sendAudio(c);
  }
}

// Puts a channel on screen (or none), as the one its side of the dashboard shows.
function setCur(c) {
  cur = c;
  if (c) {
    view = c.kind;
    shown[c.kind] = c;
  } else shown[view] = null;
}

async function openPage(url, kind = "stream") {
  url = String(url || "").trim();
  if (url && !url.includes("://")) url = "https://" + url;
  if (!WEB.test(url) || /\s/.test(url)) return { ok: false, error: "That is not a web link." };
  const live = streamOf(url);
  if (live) {   // a Kick or Twitch channel is always a stream, whichever side it was pasted in
    url = SITES[live.site].player(live.name);
    kind = "stream";
  }
  if (kind === "video") {
    // URL holds one video; a new link replaces it unless it is recording.
    const v = channels.find((k) => k.kind === "video");
    if (v && busy(v)) return { ok: false, error: "The video in URL is recording. Stop it first, then open the next one." };
    if (v) setCur(v);
    else {
      setCur(newChannel("video"));
      channels.push(cur);
    }
  } else {
    // The Studio's stream on screen takes the link, unless it is recording: that one is minimised to a
    // pill and the link opens in a channel of its own.
    const s = shown.stream && channels.includes(shown.stream) ? shown.stream : null;
    if (s && !busy(s)) setCur(s);
    else {
      if (streams().length >= MAX_CHANNELS) return { ok: false, error: `Link records up to ${MAX_CHANNELS} streams at once. Stop or close one first.` };
      const fresh = newChannel("stream");
      const taken = new Set(streams().map((k) => k.slot));
      fresh.slot = [...Array(MAX_CHANNELS).keys()].find((n) => !taken.has(n));
      setCur(fresh);
      channels.push(fresh);
    }
  }
  const c = cur;
  // The first page must not load before the blocker is in place; a slow list download does not hold it up for long.
  if (ads.on) await Promise.race([blockerReady, new Promise((resolve) => setTimeout(resolve, 4000))]);
  if (!c.player) {
    c.player = new WebContentsView({
      webPreferences: { partition: PANEL, backgroundThrottling: false,
                        // Full screen inside the page fills the panel instead of taking over the whole monitor.
                        disableHtmlFullscreenWindowResize: true },
    });
    const wc = c.player.webContents;
    plainAgent(wc);
    wc.setWindowOpenHandler((details) => {   // links that want a new window open in the panel
      if (WEB.test(details.url)) wc.loadURL(details.url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, target) => { if (!WEB.test(target)) event.preventDefault(); });
    // A bare player draws its title, controls and badges over the stream; the video is laid over them all.
    wc.on("dom-ready", () => { const live = streamOf(wc.getURL()); if (live) wc.insertCSS(SITES[live.site].clean).catch(() => {}); });
    for (const name of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) wc.on(name, push);
    wc.session.setPermissionRequestHandler((_wc, permission, done) => done(permission === "fullscreen"));
    win.contentView.addChildView(c.player);
    c.player.setBounds(slot && slot.width >= 2 ? slot : { x: 0, y: 0, width: 1280, height: 720 });
    c.player.setVisible(false);
  }
  applySound();
  place();
  if (metering()) syncEngines();   // the mixer is open: the new page gets its meter
  c.player.webContents.loadURL(url).catch(() => {});  // a page that fails to load shows the browser's own error page
  relayHeader();
  push();
  return { ok: true, kind };
}

// The dashboard switched between the Studio and URL: the channel that side showed last comes back on screen.
function showView(kind) {
  view = kind === "video" ? "video" : "stream";
  const c = shown[view];
  cur = c && channels.includes(c) ? c : null;
  applySound();
  place();
  push();
}

// Puts a channel on screen (from its pill); the one there before keeps going, minimised.
function showChannel(id) {
  const c = channels.find((k) => k.id === id);
  if (!c) return;
  setCur(c);
  applySound();
  place();
  relayHeader();
  push();
}

// Minimises the stream on screen to a pill, leaving the Studio empty for another link.
function minimise() {
  if (!cur || !cur.player) return { ok: false, error: "No stream is open." };
  if (cur.kind !== "stream") return { ok: false, error: "Only a stream can be minimised." };
  setCur(null);
  applySound();
  place();
  relayHeader();
  push();
  return { ok: true };
}

function closeChannel(c) {
  if (!c || busy(c)) return;
  if (c.player) {
    win.contentView.removeChildView(c.player);
    c.player.webContents.close();
    c.player = null;
  }
  watchChat(c, null);
  if (c.recorder && !c.recorder.isDestroyed()) c.recorder.destroy();
  channels.splice(channels.indexOf(c), 1);
  if (cur === c) cur = null;
  if (shown[c.kind] === c) shown[c.kind] = null;
  applySound();
  place();
  push();
}
const closePage = () => closeChannel(cur);

// What the Studio shows about the video in the panel, read from the page every two seconds.
//   volume  0 to 1 for the loudest video or sound on the page, null when it has none. The recording
//           is as loud as the page plays, so the Studio warns when the video's own volume is turned down.
//   length  seconds of the longest video on the page (the others are previews), shown next to the
//           recording's timer; null when there is none or it is a live stream, which has no end.
//   fills   whether the largest video covers nearly all of the panel; null when there is no video;
//           left out while the window is minimised (checkMedia keeps what it knew).
//           The recording is the whole panel, so a video that does not fill it brings the page along.
//   subtitles  whether the video shows its own subtitles (YouTube's CC button, or a text track shown).
const MEDIA = `(() => {
  const media = [...document.querySelectorAll("video, audio")].filter((m) => !m.paused || m.currentTime > 0);
  const youtube = document.querySelector("#movie_player");
  const live = !!(youtube && youtube.getVideoData && youtube.getVideoData().isLive);
  const videos = [...document.querySelectorAll("video")];
  const lengths = videos.map((v) => v.duration).filter((d) => Number.isFinite(d) && d > 0);
  const areas = videos.map((v) => {
    const r = v.getBoundingClientRect();
    return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  });
  return { volume: media.length ? Math.max(...media.map((m) => (m.muted ? 0 : m.volume))) : null,
           length: lengths.length && !live ? Math.round(Math.max(...lengths)) : null,
           // A minimised Link window gives the page no size at all: then nothing can be said, and the last answer stands.
           fills: !innerWidth || !innerHeight ? undefined : areas.some((a) => a > 0) ? Math.max(...areas) >= 0.85 * innerWidth * innerHeight : null,
           subtitles: !!document.querySelector(".ytp-subtitles-button[aria-pressed='true']")
             || videos.some((v) => [...v.textTracks].some((t) => t.mode === "showing")) };
})()`;
const FULL_VOLUME = `(() => {
  const youtube = document.querySelector("#movie_player");   // YouTube keeps its own volume and puts it back otherwise
  if (youtube && youtube.setVolume) { youtube.unMute(); youtube.setVolume(100); }
  for (const m of document.querySelectorAll("video, audio")) { m.muted = false; m.volume = 1; }
})()`;
// What Kick's own API says about a channel, asked through the server (kick_api.py) every 20 seconds.
// null when no Kick app is connected or Kick did not answer: then the page is looked at as before.
async function kickSays(c, name) {
  const k = c.kick;
  if (k.name !== name) Object.assign(k, { name, at: 0, says: null });
  if (Date.now() - k.at < 20000) return k.says;
  k.at = Date.now();
  try {
    const got = await (await fetch(`${DASHBOARD}/api/kick?channel=${encodeURIComponent(name)}`)).json();
    k.says = got.connected && !got.error && got.channel ? got.channel : null;
  } catch (e) {
    k.says = null;
  }
  return k.says;
}
async function checkMedia() {
  let changed = false;
  for (const c of channels) {
    if (!c.player) continue;
    const url = c.player.webContents.getURL();
    const live = streamOf(url);
    watchChat(c, live);
    if (live && c.volume !== null && c.volume < 1 && c.kickLoud !== url) {
      c.kickLoud = url;
      c.player.webContents.executeJavaScript(FULL_VOLUME).catch(() => {});
    }
    const now = (await c.player.webContents.executeJavaScript(MEDIA).catch(() => null)) || { volume: null, length: null, fills: null, subtitles: false };
    if (now.fills === undefined) now.fills = c.fills;
    now.stage = live && SITES[live.site].tidy ? await c.player.webContents.executeJavaScript(SITES[live.site].tidy).catch(() => null) : null;
    if (live && live.site === "kick") {
      const says = await kickSays(c, live.name);
      now.stage = says ? (says.live ? "live" : "offline") : null;
    }
    // An ad that plays while it records: the seconds are kept, so no candidate is taken from them.
    if (now.stage === "ad" && c.rec.active) c.rec.ads.push(Math.floor((Date.now() - c.rec.since) / 1000));
    if (now.volume !== c.volume || now.length !== c.length || now.fills !== c.fills || now.subtitles !== c.subtitles || now.stage !== c.stage) {
      Object.assign(c, now);
      if (c === cur) changed = true;
    }
  }
  if (changed) push();
}

const plainAgent = (wc) => wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|link-shell)\/\S+/g, ""));  // some sites turn Electron away

// ---------------------------------------------------------------- Kick and Twitch

// A channel's page shows the stream beside its chat and menus; the site's bare player shows only the
// stream, filling the panel. The site's own pages (signing in, the front page, search) open as they are.
const OVER_ALL = `position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important; transform: none !important; z-index: 2147483647 !important;
  object-fit: contain !important; background: #000 !important;`;
const KICK_CLEAN = `video { ${OVER_ALL} }`;
// Twitch's player takes a moment to start, so the video goes over the player's controls only once it
// plays. Its cookie banner is taken out of sight; no choice is made in it, so nothing is agreed to.
const TWITCH_BANNER = `.consent-banner, [data-a-target="consent-banner"] { display: none !important; }`;
const TWITCH_CLEAN = `html.link-clean video { ${OVER_ALL} } ${TWITCH_BANNER}`;
// Looked at every two seconds (checkMedia). Twitch asks before some streams ("intended for certain
// audiences"): the user opened the stream to record it, so "Start Watching" is pressed for them. It
// answers with what the player is doing: "ad" (Twitch puts its ads into the stream itself, so they
// cannot be blocked, only noticed), "offline", "starting" or "live".
const TWITCH_TIDY = `(() => {
  const q = (s) => document.querySelector(s);
  const v = q("video");
  const start = q('button[data-a-target="content-classification-gate-overlay-start-watching-button"], button[data-a-target="player-overlay-mature-accept"]');
  if (start) start.click();
  const playing = !!v && !v.paused && v.readyState > 2;
  document.documentElement.classList.toggle("link-clean", playing && !start);
  if (q('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]')) return "ad";
  if (q(".offline-embeds, .channel-status-info--offline")) return "offline";
  return playing ? "live" : "starting";
})()`;
const KICK_PAGES = /^(login|signup|register|popout|video|videos|clips|categories|category|search|following|browse|dashboard|settings|terms-of-service|privacy-policy|community-guidelines|dmca-policy)$/i;
function kickChannel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const name = parts.length === 1 && /^[a-z0-9_-]{2,40}$/i.test(parts[0]) ? parts[0].toLowerCase() : null;
    if (host === "player.kick.com") return name;
    if (host === "kick.com" && name && !KICK_PAGES.test(name)) return name;
  } catch (e) { /* not a link */ }
  return null;
}
const TWITCH_PAGES = /^(directory|videos|settings|login|signup|popout|downloads|jobs|search|subscriptions|wallet|inventory|drops|turbo|prime|store|friends|following|moderator|team|collections|embed|clips|bits|privacy|security|creatorcamp|broadcast|activate|payments|annual-recap|p|u)$/i;
function twitchChannel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "").toLowerCase();
    const ok = (name) => (name && /^[a-z0-9_]{3,25}$/i.test(name) ? name.toLowerCase() : null);
    if (host === "player.twitch.tv") return ok(u.searchParams.get("channel"));
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "twitch.tv" && parts.length === 1 && !TWITCH_PAGES.test(parts[0])) return ok(parts[0]);
  } catch (e) { /* not a link */ }
  return null;
}
// What Link does with each site's channels: the bare player it opens, what tidies that player, and its public chat.
const SITES = {
  kick: { label: "Kick", player: (name) => `https://player.kick.com/${name}`, clean: KICK_CLEAN, tidy: "", chatClean: "",
          chat: (name) => `https://kick.com/popout/${name}/chat` },
  // Twitch's own "popout player". "parent" is the site it says it is shown on: its own.
  twitch: { label: "Twitch", player: (name) => `https://player.twitch.tv/?channel=${name}&parent=twitch.tv&player=popout&muted=false&volume=1`,
            clean: TWITCH_CLEAN, tidy: TWITCH_TIDY, chatClean: TWITCH_BANNER, chat: (name) => `https://www.twitch.tv/popout/${name}/chat?popout=` },
};
// The live channel a link is, on Kick or on Twitch: { site, name }, or null for any other page.
function streamOf(url) {
  const kick = kickChannel(url);
  if (kick) return { site: "kick", name: kick };
  const twitch = twitchChannel(url);
  return twitch ? { site: "twitch", name: twitch } : null;
}
// The name a channel's volume is remembered under. Kick's are plain names, as they always were.
const keptAs = (chat) => (chat.site === "twitch" ? `twitch/${chat.channel}` : chat.channel);


// ---------------------------------------------------------------- chat speed

// While a Kick or Twitch channel plays in the Studio, a hidden window holds its public chat (no account needed),
// and every second Link notes how many messages arrived. Kick numbers each message as it comes
// ([data-index] in #chatroom-messages); only a few dozen are on the page at a time, so the count is
// how far that number moved. A recording keeps only that count. The names and text are read only
// while the user has the chat relay on in the Discord widget, and then only to be posted in their
// own Discord channel; Link keeps none of it. The window is never shown, and a recording never sees
// it, since the recorder takes only the Studio's own frame. Each channel has a counter of its own.
// The messages after a given number, as name and text; an emote becomes its name, e.g. :KEKW:.
// Kick's chat window keeps only its newest 300 messages, numbers them 0 to 299, and draws just the
// last screenful of them. While the list is filling, a message's number tells new from old. Once it is
// full the newest message is always number 299, so numbers say nothing: the new ones are then the rows
// that come after the last messages seen a second ago (found by who wrote them and what they said).
// Every look gives each new message the next number of Link's own and keeps the last few hundred for
// the chat relay. What was there at the first look does not count.
const CHAT_WATCH = `(() => {
  const root = document.querySelector("#chatroom-messages");
  if (!root) return null;
  const st = window.__linkChat && window.__linkChat.root === root ? window.__linkChat : (window.__linkChat = { root, n: 0, top: null, tail: [], log: [] });
  const rows = [...root.querySelectorAll("[data-index]")].map((row) => {
    const who = row.querySelector("button[data-prevent-expand]");
    const sep = row.querySelector('span[aria-hidden="true"]');
    const body = sep && sep.nextElementSibling;
    if (!who || !body) return null;
    const copy = body.cloneNode(true);
    copy.querySelectorAll("img").forEach((img) => img.replaceWith(" :" + (img.alt || "emote").replace(/\\s+/g, "") + ": "));
    const m = { index: Number(row.getAttribute("data-index")), who: who.textContent.trim(), text: copy.textContent.replace(/\\s+/g, " ").trim() };
    m.key = m.who + "\\u0001" + m.text;
    return m;
  }).filter(Boolean).sort((x, y) => x.index - y.index);
  if (!rows.length) return st.n;
  const top = rows[rows.length - 1].index, keys = rows.map((m) => m.key);
  let fresh = [];
  if (st.top === null) fresh = [];                                   // the first look: all of it was said before
  else if (top > st.top) fresh = rows.filter((m) => m.index > st.top);   // the list is still filling
  else if (top === st.top) {                                         // full (or nothing new): go by what was said
    let from = -1;
    for (let k = Math.min(3, st.tail.length); k >= 1 && from < 0; k--) {
      const want = st.tail.slice(-k);
      for (let i = keys.length - k; i >= 0; i--) if (want.every((w, j) => keys[i + j] === w)) { from = i + k; break; }
    }
    fresh = from < 0 ? (top >= 250 ? rows : []) : rows.slice(from);   // none of the known ones shows any more: a whole screenful is new
  }                                                                  // a lower number: the list was built again, count on from it
  for (const m of fresh) { st.n++; st.log.push({ i: st.n, who: m.who, text: m.text }); }
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
  st.top = top;
  st.tail = keys.slice(-6);
  return st.n;
})()`;
// Twitch's chat window keeps its newest messages on the page as they are and takes old ones away, so a
// message is new if its row was not there at the last look. What was there at the first look does not count.
const TWITCH_CHAT_WATCH = `(() => {
  const root = document.querySelector(".chat-scrollable-area__message-container, [data-test-selector='chat-scrollable-area__message-container']");
  if (!root) return null;
  const st = window.__linkChat && window.__linkChat.root === root ? window.__linkChat : (window.__linkChat = { root, n: 0, first: true, seen: new WeakSet(), log: [] });
  for (const row of root.querySelectorAll(".chat-line__message")) {
    if (st.seen.has(row)) continue;
    st.seen.add(row);
    if (st.first) continue;
    st.n++;
    const who = row.querySelector(".chat-author__display-name");
    const body = row.querySelector('[data-a-target="chat-line-message-body"]');
    if (!who || !body) continue;
    const copy = body.cloneNode(true);
    copy.querySelectorAll("img").forEach((img) => img.replaceWith(" :" + (img.alt || "emote").replace(/\\s+/g, "") + ": "));
    st.log.push({ i: st.n, who: who.textContent.trim(), text: copy.textContent.replace(/\\s+/g, " ").trim() });
  }
  st.first = false;
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
  return st.n;
})()`;
const CHAT_TOP = { kick: CHAT_WATCH, twitch: TWITCH_CHAT_WATCH };
const CHAT_READ = (after) => `(() => (window.__linkChat ? window.__linkChat.log.filter((m) => m.i > ${after}) : []))()`;

function watchChat(c, live) {
  const chat = c.chat;
  const name = live ? live.name : null, site = live ? live.site : null;
  if (name === chat.channel && site === chat.site) return;
  clearInterval(chat.timer);
  if (chat.view && !chat.view.isDestroyed()) chat.view.destroy();
  Object.assign(chat, { channel: name, site, view: null, top: null, ok: false, last: [], perMin: 0, since: Date.now(), timer: null, relayed: null, queue: [] });
  const kept = name && acfg.streams[keptAs(chat)];   // the volume the user set for this channel before
  if (kept) {
    Object.assign(c.audio, { gain: decibels(kept.gain), limiter: !!kept.limiter, mono: !!kept.mono });
    sendAudio(c);
  }
  if (c === shown.stream) relayHeader();
  if (name) {
    chat.view = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { partition: PANEL, backgroundThrottling: false } });
    const wc = chat.view.webContents;
    plainAgent(wc);
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    if (SITES[site].chatClean) wc.on("dom-ready", () => wc.insertCSS(SITES[site].chatClean).catch(() => {}));
    wc.loadURL(SITES[site].chat(name)).catch(() => {});
    chat.timer = setInterval(() => countChat(c), 1000);
  }
  push();
}

async function countChat(c) {
  const chat = c.chat, rec = c.rec;
  if (!chat.view || chat.view.isDestroyed()) return;
  const top = await chat.view.webContents.executeJavaScript(CHAT_TOP[chat.site]).catch(() => null);
  let n = 0;
  if (top !== null) {
    if (chat.top !== null && top >= chat.top) n = top - chat.top;   // a lower number: the list was rebuilt, count on from it
    chat.top = top;
  }
  const seen = chat.ok;
  chat.ok = chat.ok || top !== null;
  if (rec.active && chat.ok) {
    const at = Math.max(0, Math.floor((Date.now() - rec.since) / 1000));
    while (rec.chat.length <= at) rec.chat.push(0);
    rec.chat[at] += n;
    rec.chatSeen = true;
  }
  if (c === shown.stream && relayOn() && top !== null) {   // the chat relay follows the Studio's stream on screen
    if (chat.relayed === null || top < chat.relayed) chat.relayed = top;   // start from now, not with what was said before
    else if (top > chat.relayed) {
      const fresh = await chat.view.webContents.executeJavaScript(CHAT_READ(chat.relayed)).catch(() => []);
      if (fresh.length) {
        chat.relayed = fresh[fresh.length - 1].i;
        chat.queue.push(...fresh);
      }
    }
  } else chat.relayed = null;
  chat.last.push(n);
  if (chat.last.length > 60) chat.last.shift();
  const perMin = Math.round(chat.last.reduce((a, b) => a + b, 0) * 60 / chat.last.length);
  if (perMin !== chat.perMin || seen !== chat.ok) {
    chat.perMin = perMin;
    if (c === cur) push();
  }
}


// ---------------------------------------------------------------- the recorder

const two = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {  // the name ingest.py recognises a recording by
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

async function recordingFolder() {
  try {
    const { folder } = await (await fetch(`${DASHBOARD}/api/recorder`)).json();
    if (folder && fs.statSync(folder).isDirectory()) return folder;
  } catch (e) { /* the server is not answering; fall back to the Videos folder */ }
  return app.getPath("videos");
}

// Each channel's capture runs in a page of its own that is never shown, in a session of its own, so
// its capture request is answered with its own player's page only: a reload of the dashboard cannot
// end a recording, and two recordings never take each other's picture or sound.
function recorderWindow(c) {
  if (c.recorder && !c.recorder.isDestroyed()) return c.recorderReady;
  c.audio.ready = false;
  c.recorder = new BrowserWindow({
    show: false, webPreferences: { partition: `recorder-${c.id}`, backgroundThrottling: false, preload: path.join(__dirname, "recorder_preload.js") },
  });
  c.recorder.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    if (!c.player) return callback({});
    const frame = c.player.webContents.mainFrame;
    callback({ video: frame, audio: frame, enableLocalEcho: true });  // local echo: the sound stays audible while it is recorded
  });
  c.recorderReady = c.recorder.loadFile(path.join(__dirname, "recorder.html")).then(() => {
    c.audio.ready = true;
    sendAudio(c);   // its volume, and whether its meter is watched
    return c.recorder;
  });
  return c.recorderReady;
}

// The recording is the panel at its size on screen, in real pixels: a bigger Link window records sharper.
function recordingSize(c) {
  const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  const box = c.player.getBounds();
  return { width: even(box.width), height: even(box.height) };
}

// A file name no other channel is using: two recordings started in the same second get the next second.
function freeStamp() {
  let at = Date.now();
  while (channels.some((k) => k.rec.file && path.basename(k.rec.file, ".mp4") === stamp(new Date(at)))) at += 1000;
  return stamp(new Date(at));
}

async function startRecording(c = cur) {
  if (!c || !c.player) return { ok: false, error: "Open a video first." };
  const rec = c.rec;
  if (busy(c)) return { ok: false, error: "The recorder is busy." };
  rec.starting = true;
  rec.error = "";
  c.audio.held = true;     // silent itself from now until the file is done; the recorder page plays it to the user
  c.audio.direct = false;
  applySound();
  push();
  try {
    const folder = await recordingFolder();
    const name = freeStamp();
    const size = recordingSize(c);
    rec.part = path.join(folder, `${name}.part.webm`);
    rec.file = path.join(folder, `${name}.mp4`);
    rec.out = fs.createWriteStream(rec.part);
    rec.marks = [];
    rec.ads = [];
    rec.chat = [];
    rec.chatSeen = false;
    rec.chatChannel = c.chat.channel;
    rec.chatSite = c.chat.site;
    // what Kick's API calls the stream and its category now; kept with the recording for the texts
    rec.stream = c.chat.site === "kick" && c.kick.name === c.chat.channel && c.kick.says ? { title: c.kick.says.title, category: c.kick.says.category } : null;
    // what the page calls itself (a video's name), without the site's name after it; kept with the recording
    rec.title = c.chat.channel ? "" : String(c.player.webContents.getTitle() || "").replace(/^\(\d+\)\s*/, "").replace(/\s+[-|–]\s+(YouTube|Twitch|Kick|Vimeo|TikTok)\s*$/i, "").trim().slice(0, 150);
    const page = await recorderWindow(c);
    const started = new Promise((resolve, reject) => { rec.waiting = { resolve, reject }; });
    page.webContents.send("rec:start", { ...size, videoBits: videoMbit() * 1e6, audioBits: acfg.bits * 1000, audio: audioFor(c) });
    rec.size = await Promise.race([started, new Promise((_r, reject) => setTimeout(() => reject(new Error("The capture did not start.")), 15000))]);
    if (!rec.size.ear) {     // the recorder page cannot play it to the user: the page plays by itself, as it used to
      c.audio.direct = true;
      applySound();
    }
    // While it records, the page counts as watched: minimised to a pill it keeps drawing and playing at this
    // size. Chromium's own capture of the page does that too; the call is made where Electron still has it.
    const wc = c.player.webContents;
    if (typeof wc.incrementCapturerCount === "function") {
      wc.incrementCapturerCount(size, false, true);
      rec.watched = true;
    }
    rec.since = Date.now();
    rec.active = true;
    discordPost("alerts", `🔴 Recording **${whatPlays(c)}**${rec.size ? ` at ${rec.size.width}×${rec.size.height}` : ""}`);
    return { ok: true };
  } catch (e) {
    if (alive(c.recorder)) c.recorder.webContents.send("rec:stop");   // a capture that did start stops with it
    if (rec.out) rec.out.end(() => fs.rm(rec.part, { force: true }, () => {}));
    rec.out = null;
    rec.error = e.message;
    c.audio.held = false;
    applySound();
    return { ok: false, error: e.message };
  } finally {
    rec.starting = false;
    rec.waiting = null;
    push();
  }
}

function stopRecording(c = cur) {
  if (!c || !c.rec.active) return { ok: false, error: "Nothing is being recorded." };
  const rec = c.rec;
  rec.active = false;
  rec.saving = true;
  rec.seconds = (Date.now() - rec.since) / 1000;
  push();
  if (alive(c.recorder)) c.recorder.webContents.send("rec:stop");
  else finish(c);
  return { ok: true };
}

// A recording whose Link was ended before it could be finished (the PC went off, Link was killed) is
// still there as "<date time>.part.webm": the capture as far as it got. When Link starts, each of
// those is made into its mp4 the way finish() does, and the page is told as for a saved recording,
// so it is processed like one. One that ffmpeg cannot read is renamed ".broken.webm" and named once.
// The marks, chat counts and ads of such a recording were in Link's memory and are gone.
async function recoverRecordings() {
  const folder = await recordingFolder();
  let parts = [];
  try { parts = fs.readdirSync(folder).filter((f) => /^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.part\.webm$/.test(f)); } catch (e) { return; }
  const recording = new Set(channels.map((c) => c.rec.part));
  for (const name of parts) {
    const part = path.join(folder, name), file = part.replace(/\.part\.webm$/, ".mp4"), work = part.replace(/\.part\.webm$/, ".recover.mp4");
    if (recording.has(part)) continue;   // one that is running now
    const code = await new Promise((done) => {
      const ffmpeg = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", part, "-c", "copy", work], { windowsHide: true });
      ffmpeg.on("error", () => done(-1));
      ffmpeg.on("close", done);
    });
    let seconds = 0;
    if (code === 0) seconds = await new Promise((done) => {
      let out = "";
      const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", work], { windowsHide: true });
      probe.stdout.on("data", (d) => { out += d; });
      probe.on("error", () => done(0));
      probe.on("close", () => done(Number(out.trim()) || 0));
    });
    if (code === -1) return;   // no ffmpeg: nothing can be recovered now, and nothing is touched
    if (code !== 0 || !seconds) {
      fs.rm(work, { force: true }, () => {});
      try { fs.renameSync(part, part.replace(/\.part\.webm$/, ".broken.webm")); } catch (e) { continue; }
      saved = [{ name: path.basename(part), file: part, seconds: 0, marks: 0, at: Date.now(), error: `A recording that was cut off could not be read. It is kept as ${path.basename(part).replace(/\.part\.webm$/, ".broken.webm")} in your Videos folder.` }, ...saved].slice(0, 6);
    } else {
      try { fs.renameSync(work, file); } catch (e) { continue; }   // over an mp4 that a cut-off copy left half made
      fs.rm(part, { force: true }, () => {});
      saved = [{ name: path.basename(file), file, seconds, marks: 0, at: Date.now(), error: "", recovered: true }, ...saved].slice(0, 6);
    }
    push();
  }
}

// The capture's own file has no length or index; copying it into an mp4 adds both without re-encoding.
// A minimised channel whose recording is saved closes by itself: its pill has done its job.
function finish(c) {
  const rec = c.rec;
  c.audio.held = c.audio.direct = false;   // the capture has ended: the page may play by itself again
  applySound();
  const { part, file, marks, seconds, chatChannel, chatSite, chatSeen, title, stream } = rec;
  // The ad was seen at these seconds, two seconds apart: each stands for the seconds around it, and those that touch are one stretch.
  const ads = [];
  for (const t of rec.ads) {
    const from = Math.max(0, t - 3), to = Math.min(Math.ceil(seconds), t + 3);
    if (ads.length && from <= ads[ads.length - 1][1]) ads[ads.length - 1][1] = to;
    else if (to > from) ads.push([from, to]);
  }
  const rate = rec.chat.slice(0, Math.ceil(seconds));
  const out = rec.out;
  rec.out = null;
  if (rec.watched && c.player && typeof c.player.webContents.decrementCapturerCount === "function") {
    c.player.webContents.decrementCapturerCount(false, true);
    rec.watched = false;
  }
  const done = (error) => {
    rec.saving = false;
    rec.error = error || "";
    // what: the channel or the page's name, for the page to offer as the recording's name; closing: Link is closing, nobody can be asked
    saved = [{ name: path.basename(error ? part : file), file: error ? part : file, seconds, marks: marks.length, at: Date.now(), error: error || "",
               what: chatChannel || title || "", closing: !!closing }, ...saved].slice(0, 6);
    if (!error) discordPost("alerts", `⏹ Saved ${clockOf(seconds)} of **${rec.lastWhat || "the Studio"}**${marks.length ? `, ★ ${marks.length} marked` : ""}. It becomes a tape when it is processed.`);
    if (c !== cur && !closing) closeChannel(c);
    push();
    if (closing && !error && seconds >= 30) closing.push(file);
    if (closing && !channels.some(busy)) leave();
  };
  const remux = () => {
    const ffmpeg = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", part, "-c", "copy", file], { windowsHide: true });
    let log = "";
    ffmpeg.stderr.on("data", (d) => { log += d; });
    ffmpeg.on("error", () => done("ffmpeg could not be started; the recording is kept as " + path.basename(part)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) return done((log.trim().split("\n").pop() || "ffmpeg failed") + "; the recording is kept as " + path.basename(part));
      fs.rm(part, { force: true }, () => {});
      if (marks.length) fs.writeFileSync(file.replace(/\.mp4$/, ".markers.json"), JSON.stringify(marks));
      if (chatChannel && chatSeen) fs.writeFileSync(file.replace(/\.mp4$/, ".chat.json"), JSON.stringify({ channel: chatChannel, site: chatSite, rate }));
      if (title) fs.writeFileSync(file.replace(/\.mp4$/, ".title.json"), JSON.stringify({ title }));
      if (stream && (stream.title || stream.category)) fs.writeFileSync(file.replace(/\.mp4$/, ".stream.json"), JSON.stringify(stream));
      if (ads.length) fs.writeFileSync(file.replace(/\.mp4$/, ".ads.json"), JSON.stringify(ads));
      done();
    });
  };
  if (out) out.end(remux);
  else remux();
}

// A highlight in the stream on screen if it records, otherwise in the one that does (the newest).
function markTarget() {
  if (cur && cur.rec.active) return cur;
  const going = recordingNow();
  return going[going.length - 1] || null;
}
function markNow(c = markTarget()) {
  if (!c || !c.rec.active) return null;
  const at = Math.round((Date.now() - c.rec.since) / 100) / 10;
  c.rec.marks.push(at);
  push();
  return at;
}


// ---------------------------------------------------------------- the sound

// Link's mixer: the Audio button's window (ui/static/audio.html) and Settings > Audio show one row
// per open stream, one for the URL video and one for the microphone. A stream's row sets how loud it
// is in its recording (a volume in the recorder's page, see recorder.js; the page's own volume is
// left alone) and whether the user hears it. By default only the stream on the big screen is heard
// ("solo"); with that off, each stream's speaker button decides. Sound off, in the Studio, silences
// all of it for the user; recordings keep their sound either way.
// The microphone stays closed until the user switches it on. It is then mixed into the recording on
// the big screen, or into every recording, and opened only while such a recording runs.
// What the user sets for a Kick or Twitch channel is remembered under its name. All of it is kept in
// %USERPROFILE%\.link\audio.json.
const AUDIO_FILE = path.join(HOME, ".link", "audio.json");
const AUDIO_BITS = [96, 128, 160, 192, 256, 320];   // kilobits a second for a recording's sound
const decibels = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.max(-60, Math.min(12, Math.round(Number(v) * 2) / 2)) : fallback);
const acfg = { solo: true, volume: 0, limiter: false, bits: 160, streams: {},
               mic: { on: false, device: "", label: "", gain: 0, into: "screen", noise: true, echo: false, auto: false } };
try {
  const kept = JSON.parse(fs.readFileSync(AUDIO_FILE, "utf8")) || {};
  if (typeof kept.solo === "boolean") acfg.solo = kept.solo;
  if (typeof kept.limiter === "boolean") acfg.limiter = kept.limiter;
  if (AUDIO_BITS.includes(kept.bits)) acfg.bits = kept.bits;
  acfg.volume = decibels(kept.volume);
  if (kept.streams && typeof kept.streams === "object") acfg.streams = kept.streams;
  const m = kept.mic || {};
  for (const k of ["on", "noise", "echo", "auto"]) if (typeof m[k] === "boolean") acfg.mic[k] = m[k];
  for (const k of ["device", "label"]) if (typeof m[k] === "string") acfg.mic[k] = m[k];
  acfg.mic.gain = decibels(m.gain);
  if (m.into === "all") acfg.mic.into = "all";
} catch (e) { /* nothing chosen yet */ }
let audioSave = null;
const saveAudio = () => {   // a volume being dragged changes many times a second; the file is written once it rests
  clearTimeout(audioSave);
  audioSave = setTimeout(() => fs.writeFile(AUDIO_FILE, JSON.stringify(acfg), () => {}), 300);
};

let audioWin = null;
const AUDIO_SIZE = { width: 400, height: 560 };
const meters = { widget: false, page: false };   // who is looking at the level meters
const metering = () => meters.widget || meters.page;
const silentFor = (c) => hushed || (acfg.solo ? c !== cur : !c.audio.listen);   // kept from the user's speakers

// What a channel's recorder page is told: its volume, and the microphone when it is this one's to record.
function micFor(c) {
  const m = acfg.mic;
  if (!m.on || !(c.rec.active || c.rec.starting)) return null;
  if (m.into !== "all" && c !== cur) return null;
  return { device: m.device, gain: m.gain, noise: m.noise, echo: m.echo, auto: m.auto };
}
const audioFor = (c) => ({ gain: c.audio.gain, limiter: c.audio.limiter, mono: c.audio.mono, mic: micFor(c), meter: metering(), tap: metering(), heard: !silentFor(c) });
function sendAudio(c) {
  if (c.audio.ready && alive(c.recorder)) c.recorder.webContents.send("audio:set", audioFor(c));
}
// While someone looks at the meters, every open channel has its recorder page listening to its sound.
function syncEngines() {
  for (const c of channels) {
    if (!c.player) continue;
    if (metering()) recorderWindow(c).catch(() => {});   // tells it what is wanted once it is loaded
    else c.audio.level = null;
    sendAudio(c);
  }
}

function audioState() {
  return {
    solo: acfg.solo, volume: acfg.volume, limiter: acfg.limiter, bits: acfg.bits, bitsChoices: AUDIO_BITS, hushed,
    mic: { ...acfg.mic },
    remembered: Object.keys(acfg.streams).sort().map((name) => ({ name, gain: decibels(acfg.streams[name].gain) })),
    channels: channels.filter((c) => c.player).map((c) => ({
      id: c.id, kind: c.kind, label: c.kind === "video" ? "URL" : `CH-${(c.slot || 0) + 1}`, name: channelName(c), current: c === cur,
      recording: c.rec.active, gain: c.audio.gain, limiter: c.audio.limiter, mono: c.audio.mono, listen: c.audio.listen,
      heard: !silentFor(c), pageVolume: c.volume, engine: c.audio.engine, kick: c.chat.channel ? `${c.chat.channel} on ${SITES[c.chat.site].label}` : "" })),
    music: !!(music && !music.isDestroyed() && music.isVisible()),
  };
}
function pushAudio() {
  if (alive(audioWin) && audioWin.isVisible()) audioWin.webContents.send("mix:state", audioState());
}
let pushTimer = null;
const pushSoon = () => {   // after a volume was dragged: the engines know at once, the screens a moment later
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 120);
};

function setAudio(patch = {}) {
  if (typeof patch.solo === "boolean" && patch.solo !== acfg.solo) {
    if (!patch.solo) for (const c of channels) c.audio.listen = c === cur;   // begin from what is heard now
    acfg.solo = patch.solo;
  }
  if ("volume" in patch) acfg.volume = decibels(patch.volume);
  if (typeof patch.limiter === "boolean") acfg.limiter = patch.limiter;
  if (AUDIO_BITS.includes(patch.bits)) acfg.bits = patch.bits;
  if (typeof patch.forget === "string") delete acfg.streams[patch.forget];
  saveAudio();
  applySound();
  push();
}

function setMic(patch = {}) {
  const m = acfg.mic;
  for (const k of ["on", "noise", "echo", "auto"]) if (typeof patch[k] === "boolean") m[k] = patch[k];
  for (const k of ["device", "label"]) if (typeof patch[k] === "string") m[k] = patch[k].slice(0, 300);
  if ("gain" in patch) m.gain = decibels(patch.gain);
  if (patch.into === "screen" || patch.into === "all") m.into = patch.into;
  saveAudio();
  channels.forEach(sendAudio);
  pushSoon();
}

function setChannelAudio(id, patch = {}) {
  const c = channels.find((k) => k.id === id);
  if (!c) return;
  const a = c.audio;
  if ("gain" in patch) a.gain = decibels(patch.gain);
  if (typeof patch.limiter === "boolean") a.limiter = patch.limiter;
  if (typeof patch.mono === "boolean") a.mono = patch.mono;
  if (typeof patch.listen === "boolean") {
    if (acfg.solo) {   // choosing by hand ends "only the big screen"; the others stay as they sound now
      for (const k of channels) k.audio.listen = k === cur;
      acfg.solo = false;
    }
    a.listen = patch.listen;
  }
  if (c.chat.channel && ("gain" in patch || "limiter" in patch || "mono" in patch)) acfg.streams[keptAs(c.chat)] = { gain: a.gain, limiter: a.limiter, mono: a.mono };
  saveAudio();
  applySound();
  pushSoon();
}

// The mixer's window: like the Discord widget, a child of Link's window that stays above it.
const audioSpot = () => {
  const at = choices.audio;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    const area = screen.getDisplayMatching({ ...at, ...AUDIO_SIZE }).workArea;
    if (at.x >= area.x - AUDIO_SIZE.width / 2 && at.x <= area.x + area.width - AUDIO_SIZE.width / 2 && at.y >= area.y && at.y <= area.y + area.height - 60)
      return { x: Math.round(at.x), y: Math.round(at.y) };
  }
  const b = win.getBounds();
  return { x: b.x + b.width - AUDIO_SIZE.width - 28, y: b.y + 150 };
};
function showAudio(on) {
  if (!win) return;
  if (!on) {
    if (audioWin && !audioWin.isDestroyed()) audioWin.hide();
    return;
  }
  if (audioWin && !audioWin.isDestroyed()) return audioWin.show();
  audioWin = new BrowserWindow({
    ...AUDIO_SIZE, ...audioSpot(), parent: win, show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    backgroundColor: "#00000000", title: "Link · Audio", icon: ICON,
    webPreferences: { preload: path.join(__dirname, "audio_preload.js") },
  });
  const wc = audioWin.webContents;
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  const seen = (on) => () => {   // the meters run only while the window shows
    meters.widget = on;
    syncEngines();
    push();
  };
  audioWin.on("moved", () => { const { x, y } = audioWin.getBounds(); choose({ audio: { x, y } }); });
  audioWin.on("show", seen(true));
  audioWin.on("hide", seen(false));
  audioWin.on("closed", () => { audioWin = null; seen(false)(); });
  audioWin.once("ready-to-show", () => audioWin.show());
  wc.loadURL(`${DASHBOARD}/static/audio.html`).catch(() => {});
}

// The levels the recorder pages measure, passed on to whoever shows meters.
setInterval(() => {
  if (!metering()) return;
  const levels = {};
  for (const c of channels) if (c.audio.level) levels[c.id] = c.audio.level;
  if (meters.widget && alive(audioWin)) audioWin.webContents.send("mix:levels", levels);
  if (meters.page && alive(win)) win.webContents.send("mix:levels", levels);
}, 80);

// ---------------------------------------------------------------- the music player

// A small window of its own (ui/static/music.html) that shows what Spotify plays and presses its
// buttons through the server. Being a child of Link's window it stays above it, the Studio panel
// included, and hides when Link is minimised; it is dragged anywhere by its body. It plays nothing
// itself, and a recording never sees it: the recorder takes only the Studio's own frame.
let music = null;
const MUSIC_SIZE = { width: 340, height: 92 };

// Where it was left, if that is still on a screen; otherwise near the top right of Link's window.
function musicSpot() {
  const at = choices.music;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    const area = screen.getDisplayMatching({ ...at, ...MUSIC_SIZE }).workArea;
    const inside = at.x >= area.x - MUSIC_SIZE.width / 2 && at.x <= area.x + area.width - MUSIC_SIZE.width / 2
      && at.y >= area.y && at.y <= area.y + area.height - MUSIC_SIZE.height / 2;
    if (inside) return { x: Math.round(at.x), y: Math.round(at.y) };
  }
  const b = win.getBounds();
  return { x: b.x + b.width - MUSIC_SIZE.width - 28, y: b.y + 96 };
}

function showMusic(on) {
  if (!win) return;
  choose({ musicOpen: !!on });
  if (!on) {
    if (music && !music.isDestroyed()) music.hide();
    return push();
  }
  if (music && !music.isDestroyed()) {
    music.show();
    return push();
  }
  music = new BrowserWindow({
    ...MUSIC_SIZE, ...musicSpot(), parent: win, show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    backgroundColor: "#00000000", title: "Link · Music", icon: ICON,
    webPreferences: { preload: path.join(__dirname, "music_preload.js") },
  });
  const wc = music.webContents;
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  music.on("moved", () => { const { x, y } = music.getBounds(); choose({ music: { x, y } }); });
  music.on("show", push);
  music.on("hide", push);
  music.on("closed", () => { music = null; push(); });
  music.once("ready-to-show", () => { music.show(); push(); });
  wc.loadURL(`${DASHBOARD}/static/music.html`).catch(() => {});
}

// ---------------------------------------------------------------- the Discord bot

// The user's own bot (shell/discord.js), run while Link is open, and a small widget window of its own
// (ui/static/discord.html) that shows what it does. In the user's server it:
//   posts live alerts   a recording starts or is saved, a tape is processed with its best moments
//   posts finished reels  with a copy small enough for a bot to attach (made by the server)
//   /record <link>      a link a crew member sends; it waits in the widget until the user presses Open
//   /clip               a highlight mark in the recording running now, as Mark highlight does
//   /status             what Link is doing (only the sender sees the answer)
// Only members with the role the user chose (their "Apostles") and the server's owner may use the
// commands. The token and the choices are kept in %USERPROFILE%\.link\discord.json; the token never
// goes to a page. Nothing from Discord starts a recording or opens a page without the user.
const DISCORD_FILE = path.join(HOME, ".link", "discord.json");
let dcfg = {};
try { dcfg = JSON.parse(fs.readFileSync(DISCORD_FILE, "utf8")) || {}; } catch (e) { /* not set up */ }
dcfg.posts = { alerts: true, tapes: true, reels: true, chat: true, summary: true, milestones: true, ...(dcfg.posts || {}) };
// Each kind of post has a channel of its own (e.g. #live, #tapes, #reels); one chosen before that split serves all three.
dcfg.channels = { alerts: dcfg.channelId || null, tapes: dcfg.channelId || null, reels: dcfg.channelId || null, chat: null, summary: null, control: null, night: null, ...(dcfg.channels || {}) };
delete dcfg.channelId;
const channelFor = (kind) => dcfg.channels[kind] || null;
const saveDiscord = () => fs.writeFile(DISCORD_FILE, JSON.stringify(dcfg), () => {});
let bot = null, discordWin = null;
const dc = { feed: [], links: [], unseen: 0, lastClip: 0, linkId: 0, guild: null, channels: {}, role: null, registered: "", job: null };
const DISCORD_SIZE = { width: 380, height: 470 };
const POSTING = 1024 + 2048 + 16384 + 32768;   // view channels, send messages, embed links, attach files
const INVITE_PERMISSIONS = POSTING + 16 + 8192;   // and manage channels, to make the report's own channel; and manage messages, to pin the newest announcement (announce.js)

const clockOf = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}` : Math.floor(s / 60)) + ":" + two(Math.floor(s) % 60);
function whatPlays(c) {
  const what = c.chat.channel ? `${c.chat.channel} on ${SITES[c.chat.site].label}` : (c.player && c.player.webContents.getTitle()) || "the Studio";
  c.rec.lastWhat = what;
  return what;
}

function note(icon, text, bad = false) {
  dc.feed.unshift({ at: Date.now(), icon, text, bad });
  dc.feed.length = Math.min(dc.feed.length, 20);
  pushDiscord();
}

function discordState() {
  return {
    token: !!dcfg.token, state: bot ? bot.state : "off", error: bot ? bot.error : "",
    name: bot && bot.user ? bot.user.global_name || bot.user.username : "",
    avatar: bot && bot.user && bot.user.avatar ? `https://cdn.discordapp.com/avatars/${bot.user.id}/${bot.user.avatar}.png?size=64` : "",
    invite: bot && bot.appId ? `https://discord.com/oauth2/authorize?client_id=${bot.appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}` : "",
    guild: dc.guild, channels: dc.channels, role: dc.role, posts: dcfg.posts, feed: dc.feed, links: dc.links,
    report: { last: dcfg.lastSummary || 0, next: dcfg.lastSummary ? nextSummary() : 0, busy: summary.busy, error: summary.error },
  };
}

function pushDiscord() {
  if (alive(discordWin)) discordWin.webContents.send("discord:state", discordState());
  push();
}

// The names of the chosen server, channels and role, and the server's owner (who may always use the commands).
async function loadChoices() {
  if (!bot || bot.state !== "online" || !dcfg.guildId) return;
  try {
    const guild = await bot.api("GET", `/guilds/${dcfg.guildId}`);
    dc.guild = { id: guild.id, name: guild.name, owner: guild.owner_id };
    const role = (guild.roles || []).find((r) => r.id === dcfg.roleId);
    dc.role = role ? { id: role.id, name: role.name } : null;
    const named = Object.fromEntries((await bot.api("GET", `/guilds/${dcfg.guildId}/channels`)).map((c) => [c.id, c.name]));
    dc.channels = Object.fromEntries(Object.entries(dcfg.channels).map(([kind, id]) => [kind, id && named[id] ? { id, name: named[id] } : null]));
    if (dc.registered !== dcfg.guildId) {
      await bot.register(dcfg.guildId);
      dc.registered = dcfg.guildId;
      note("⚙", `Commands ready on ${guild.name}: /record, /clip, /status, and your remote`);
    }
  } catch (e) {
    note("⚠", e.message, true);
  }
  pushDiscord();
  reportIfDue();
}

function startBot() {
  if (bot) bot.stop();
  bot = null;
  if (!dcfg.token) return pushDiscord();
  let was = "";
  bot = new DiscordBot(dcfg.token, {
    onCommand: answer,
    onButton: answerButton,
    onState: (b) => {
      if (b.state === "online" && was !== "online") { note("●", `${b.user ? b.user.username : "The bot"} is online`); loadChoices(); }
      if (b.state === "error" && was !== "error") note("⚠", b.error, true);
      was = b.state;
      pushDiscord();
    },
  });
  bot.start();
}

async function setDiscordToken(token) {
  token = String(token || "").trim();
  if (token.split(".").length !== 3) return { ok: false, error: "That is not a bot token. In the Developer Portal: your app > Bot > Reset Token, then copy it." };
  dcfg = { ...dcfg, token };
  saveDiscord();
  startBot();
  return { ok: true };
}

function disconnectDiscord() {
  if (bot) bot.stop();
  bot = null;
  delete dcfg.token;
  saveDiscord();
  Object.assign(dc, { guild: null, channels: {}, role: null, registered: "" });
  note("○", "Disconnected; the token is forgotten");
}

// The servers the bot is in, and for one of them its text channels and roles, to choose from.
async function discordLists(guildId) {
  if (!bot || bot.state !== "online") return { guilds: [], channels: [], roles: [] };
  try {
    const guilds = (await bot.api("GET", "/users/@me/guilds")).map((g) => ({ id: g.id, name: g.name }));
    if (!guildId) return { guilds, channels: [], roles: [] };
    const channels = (await bot.api("GET", `/guilds/${guildId}/channels`)).filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name }));
    const roles = (await bot.api("GET", `/guilds/${guildId}/roles`)).filter((r) => r.name !== "@everyone" && !r.managed)
      .sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name }));
    return { guilds, channels, roles };
  } catch (e) {
    return { guilds: [], channels: [], roles: [], error: e.message };
  }
}

async function chooseDiscord(choice) {
  if (choice.guildId !== undefined && choice.guildId !== dcfg.guildId) Object.assign(dcfg, { guildId: choice.guildId, channels: { alerts: null, tapes: null, reels: null, chat: null, summary: null, control: null, night: null }, roleId: null });
  if (choice.channel && choice.channel.kind in dcfg.channels) dcfg.channels[choice.channel.kind] = choice.channel.id || null;
  if (choice.roleId !== undefined) dcfg.roleId = choice.roleId;
  saveDiscord();
  await loadChoices();
  return discordState();
}

function useLink(id, open) {
  const link = dc.links.find((l) => l.id === id);
  if (!link) return { ok: false };
  dc.links = dc.links.filter((l) => l.id !== id);
  if (open && win) {
    const kind = streamOf(link.url) ? "stream" : "video";
    openPage(link.url, kind);
    if (alive(win)) win.webContents.send("shell:studio", link.url, kind);   // the dashboard shows the Studio (or URL) with it
    note("▶", `Opened ${link.url} from ${link.who}`);
  } else pushDiscord();
  return { ok: true };
}

// A slash command from the server.
async function answer(i) {
  const name = i.data.name;
  const member = i.member || {};
  const who = member.nick || (member.user && (member.user.global_name || member.user.username)) || "someone";
  const quiet = (text) => bot.reply(i, text, { quiet: true });
  if (!dcfg.guildId || i.guild_id !== dcfg.guildId) return quiet("Link only answers in its own server.");
  if (OWNER_COMMANDS.some((c) => c.name === name)) {   // the remote: the owner alone, in the control channel alone
    if (!(member.user && dc.guild && member.user.id === dc.guild.owner)) return quiet("Only the server's owner can run Link from Discord.");
    if (!channelFor("control")) return quiet("Link has no control channel yet. In Link: Discord > Create #control.");
    if (i.channel_id !== channelFor("control")) return quiet(`That command works in <#${channelFor("control")}> only.`);
    return answerOwner(i);
  }
  if (NIGHT_COMMANDS.some((c) => c.name === name)) {   // the night run's remote: the owner alone, in the night channel (or the control channel)
    if (!(member.user && dc.guild && member.user.id === dc.guild.owner)) return quiet("Only the server's owner can run Link Night from Discord.");
    const here = [channelFor("night"), channelFor("control")].filter(Boolean);
    if (!here.length) return quiet("Link Night has no channel yet. Start a night once from the Night window: it makes #night.");
    if (!here.includes(i.channel_id)) return quiet(`That command works in <#${here[0]}> only.`);
    return answerNight(i);
  }
  const allowed = (member.user && dc.guild && member.user.id === dc.guild.owner) || (dcfg.roleId && (member.roles || []).includes(dcfg.roleId));
  if (!allowed) return quiet(`Only ${dc.role ? `**${dc.role.name}**` : "the crew's role"} can use Link's commands.`);
  if (name === "refresh") {   // the channels' numbers, read now, shown where it was asked
    await bot.defer(i);
    return bot.edit(i, await quickNumbers());
  }
  if (name === "status") {
    const lines = channels.filter((c) => c.player).map((c) => c.rec.active
      ? `🔴 Recording **${whatPlays(c)}** for ${clockOf((Date.now() - c.rec.since) / 1000)}, ★ ${c.rec.marks.length} marked.`
      : c.rec.saving ? `Saving **${whatPlays(c)}**.` : `Watching **${whatPlays(c)}**, not recording.`);
    return quiet(lines.length ? lines.join("\n") : "Link is open; nothing is playing in the Studio.");
  }
  if (name === "record") {
    let url = String(((i.data.options || []).find((o) => o.name === "link") || {}).value || "").trim();
    if (url && !url.includes("://")) url = "https://" + url;
    if (!WEB.test(url) || /\s/.test(url) || url.length > 500) return quiet("That is not a link. Try kick.com/channel or twitch.tv/channel.");
    dc.links.unshift({ id: ++dc.linkId, url, who, at: Date.now() });
    dc.links.length = Math.min(dc.links.length, 10);
    if (!(discordWin && !discordWin.isDestroyed() && discordWin.isVisible())) dc.unseen++;   // the button's dot, when the widget is not showing it
    note("📡", `${who} sent ${url}`);
    return quiet("📡 Sent to Link. It opens when it's picked up there.");
  }
  if (name === "clip") {
    if (!markTarget()) return quiet("Link is not recording right now.");
    if (Date.now() - dc.lastClip < 5000) return quiet("A moment was just marked. Try again in a few seconds.");
    dc.lastClip = Date.now();
    const target = markTarget();
    const at = markNow(target);
    const where = recordingNow().length > 1 ? ` in ${whatPlays(target)}` : "";
    note("★", `${who} marked ${clockOf(at)}${where}`);
    return bot.reply(i, `★ **${who}** marked ${clockOf(at)}${where}`);
  }
}

// A post in the chosen channel, if that kind of post is on.
async function discordPost(kind, content, file) {
  if (!bot || bot.state !== "online" || !channelFor(kind) || !dcfg.posts[kind]) return;
  try {
    await bot.post(channelFor(kind), content, file);
    note(kind === "reels" ? "🎬" : kind === "tapes" ? "🎞" : "📣", content.split("\n")[0].replace(/\*\*/g, ""));
  } catch (e) {
    note("⚠", `Could not post: ${e.message}`, true);
  }
}

// ---- the chat relay: the stream's chat, posted in the user's chosen channel while a Kick or Twitch stream is open

const relayOn = () => !!(bot && bot.state === "online" && shown.stream && shown.stream.chat.channel && dcfg.posts.chat && channelFor("chat"));
let relaying = "";   // the stream whose chat is coming through, to post when it starts and stops
// Names and words go to Discord as plain text: no markdown from the chat, no pings, no link previews.
const plain = (text) => String(text).replace(/([\\*_~`|>#\[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");

// A line when the chat starts or stops coming through, so the channel reads as one stream's chat.
function relayHeader() {
  const want = relayOn() ? `**${plain(shown.stream.chat.channel)}** on ${SITES[shown.stream.chat.site].label}` : "";
  if (want === relaying) return;
  if (relaying) discordPost("chat", `💬 Chat of ${relaying} closed.`);
  if (want) discordPost("chat", `💬 Chat of ${want}, live from Link:`);
  relaying = want;
}

// Every four seconds, what came in since, as one post; Discord allows a bot about five posts per five
// seconds in a channel, and a busy chat would pass that one message at a time.
async function flushRelay() {
  relayHeader();
  if (!relayOn() || !shown.stream.chat.queue.length) return;
  const chat = shown.stream.chat;
  const lines = [];
  let size = 0;
  while (chat.queue.length) {
    const m = chat.queue[0];
    const line = `**${plain(m.who)}**: ${plain(m.text).slice(0, 300)}`;
    if (size + line.length + 1 > 1850) break;
    lines.push(line);
    size += line.length + 1;
    chat.queue.shift();
  }
  const left = chat.queue.length;
  if (left > 40) chat.queue = [];   // far behind: skip to now rather than fall further behind
  try {
    await bot.post(channelFor("chat"), lines.join("\n") + (left > 40 ? `\n_…${left} more skipped to keep up_` : ""), undefined, true);
  } catch (e) {
    note("⚠", `Chat relay: ${e.message}`, true);
  }
}
setInterval(flushRelay, 4000);

// The server runs processing and rendering; when one of those jobs ends well, the tape or the reels it
// made are posted. Only jobs seen running are followed, so starting Link posts nothing old.
async function watchJobs() {
  if (!bot || bot.state !== "online" || !(channelFor("tapes") || channelFor("reels"))) return;
  let job;
  try { job = (await (await fetch(`${DASHBOARD}/api/status`)).json()).job; } catch (e) { return; }
  if (!job || !job.kind) return;
  const key = `${job.kind}:${job.started}`;
  if (job.running) return void (dc.job = key);
  if (dc.job !== key) return;
  dc.job = null;
  if (job.returncode !== 0) return;
  if (job.kind === "ingest") {
    for (const [, id] of job.log.matchAll(/^(SRC-\d+): (?:linked|copied) /gm)) {
      try {
        const d = await (await fetch(`${DASHBOARD}/api/sources/${id}`)).json();
        const best = [...d.candidates].sort((a, b) => a.rank - b.rank).slice(0, 3).map((c) => clockOf(c.in));
        const marked = d.candidates.filter((c) => c.marked).length;
        await discordPost("tapes", `🎞 Tape **${id}** is ready: ${d.candidates.length} moment${d.candidates.length === 1 ? "" : "s"}${best.length ? `, best at ${best.join(", ")}` : ""}${marked ? ` (★ ${marked} marked)` : ""}.`);
      } catch (e) { /* the tape is posted next time Link is asked, not worth an error */ }
    }
  }
  if (job.kind === "render" && dcfg.posts.reels) {
    for (const [, file] of job.log.matchAll(/\bok\s+(POST-\S+?_TIKTOK_9x16\.mp4)/g)) {
      try {
        const made = await (await fetch(`${DASHBOARD}/api/discord-copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) })).json();
        if (!made || !made.reel) continue;
        const r = made.reel;
        const text = [`🎬 **${r.title || r.id}**`, r.hook && `> ${r.hook}`, r.text, !made.copy && "_The video is too big for Discord; it is in Link's Finals._"].filter(Boolean).join("\n");
        await discordPost("reels", text.slice(0, 1900), made.copy || undefined);
        if (made.copy) fs.rm(made.copy, { force: true }, () => {});
      } catch (e) {
        note("⚠", `Could not post ${file}: ${e.message}`, true);
      }
    }
  }
}
setInterval(watchJobs, 3000);

// ---- the owner's remote: Link run from a private channel in Discord

// Only the server's owner, and only in the control channel (which the bot makes so that nobody else
// sees it). /list and /tape look; /open, /rec, /process, /reel and /render each do one step; /auto
// does all of them in a row. What a command starts is told in the channel as it goes.
const remote = { auto: null };
const REMOTE_SIZE = { width: 1280, height: 720 };   // what an /auto records at
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function serverCall(route, method = "GET", body) {
  const res = await fetch(DASHBOARD + route, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Link answered ${res.status}.`);
  return data;
}
const tapeId = (text) => { const m = /(\d+)/.exec(String(text || "")); return m ? `SRC-${m[1].padStart(3, "0")}` : ""; };
const tapeTitle = (s) => s.name || (s.started ? s.started.slice(0, 16) : s.file);
const say = (text) => (bot && channelFor("control") ? bot.message(channelFor("control"), { content: String(text).slice(0, 1900), flags: 4 }).catch(() => {}) : null);   // 4: no link preview under it
const optionOf = (i, name) => ((i.data.options || []).find((o) => o.name === name) || {}).value;

// A new channel, #control, that only the server's owner and the bot can see.
async function makeControlChannel() {
  if (!bot || bot.state !== "online" || !dcfg.guildId || !dc.guild) return { ok: false, error: "The bot has to be online on a server first." };
  try {
    const may = await botMay();
    if (!(may & bit(4))) return { ok: false, error: "The bot may not make channels. In Discord: Server Settings > Roles > the bot's role > turn on Manage Channels." };
    const all = await bot.api("GET", `/guilds/${dcfg.guildId}/channels`);
    const beside = all.find((c) => c.id === dcfg.channels.reels) || all.find((c) => c.type === 0);
    const made = await bot.api("POST", `/guilds/${dcfg.guildId}/channels`, {
      name: "control", type: 0, topic: "Link's remote. /list, /tape, /open, /rec, /process, /reel, /render, /auto. Only you see this channel.",
      ...(beside && beside.parent_id ? { parent_id: beside.parent_id } : {}),
      permission_overwrites: [
        { id: dcfg.guildId, type: 0, allow: "0", deny: "1024" },                                  // nobody sees it
        // but its owner (read, write, history, commands) and the bot; a bot can only give what it may do itself
        { id: dc.guild.owner, type: 1, allow: String((BigInt(POSTING) | bit(16) | bit(31)) & may), deny: "0" },
        { id: bot.user.id, type: 1, allow: String((BigInt(POSTING) | bit(16)) & may), deny: "0" },
      ],
    });
    dcfg.channels.control = made.id;
    saveDiscord();
    note("🎛", `Made #${made.name}; only you and the bot see it`);
    await loadChoices();
    say("🎛 **Link's remote.** `/list` shows your tapes, `/tape` one of them. `/open`, `/rec`, `/process`, `/reel` and `/render` each do one step; `/auto` does the whole way from a link to rendered reels.");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function remoteList() {
  const [tapes, lib] = await Promise.all([serverCall("/api/sources"), serverCall("/api/folders")]);
  if (!tapes.length) return { content: "No tapes yet. `/auto` makes one from a link." };
  const folder = (id) => (lib.folders.find((f) => f.id === lib.tapes[id]) || {}).name || "";
  // Two short lines a tape, so it reads on a phone (a table of this width wraps there).
  const rows = tapes.slice(0, 25).map((s) => {
    const left = (s.reels || 0) - (s.rendered || 0), where = folder(s.id);
    return `\`${s.id}\` **${plain(cut(tapeTitle(s), 30))}**${where ? ` · 📁 ${plain(cut(where, 16))}` : ""}\n`
      + `${clockOf(s.duration)} · ${s.candidates} moments · ${!s.reels ? "⚪ no reels" : `${left ? "🟡" : "🟢"} ${s.rendered}/${s.reels} reels`}`;
  });
  const todo = tapes.filter((s) => s.reels > s.rendered).length;
  return { embeds: [{ color: 0x9FD8C8, title: `📼 ${tapes.length} tape${tapes.length === 1 ? "" : "s"}`,
    description: rows.join("\n") + (tapes.length > 25 ? `\n…and ${tapes.length - 25} more.` : "") + "\n\n"
      + (todo ? `🟡 ${todo} with reels still to render (\`/render\`).` : "🟢 Every reel is rendered.") + "\n`/tape` shows one tape's moments." }] };
}

async function remoteTape(id) {
  const d = await serverCall(`/api/sources/${id}`);
  const heard = Object.fromEntries((((d.transcript || {}).candidates) || []).map((c) => [c.rank, c.phrases.map((p) => p.text).join(" ")]));
  const gone = new Set(((d.ui || {}).dismissed) || []);
  const reels = ((d.edl || {}).reels) || [];
  const used = (c) => reels.find((r) => r.in < c.out && r.out > c.in);
  const moments = [...d.candidates].sort((a, b) => a.rank - b.rank).filter((c) => !gone.has(`${c.in}-${c.out}`)).slice(0, 10).map((c) => {
    const r = used(c);
    return `**#${c.rank}** \`${clockOf(c.in)}–${clockOf(c.out)}\` · ${Math.round(c.out - c.in)} s · score ${c.score.toFixed(2)}${c.marked ? " · ★" : ""}${c.chat >= 1.5 ? ` · chat ×${c.chat}` : ""}${r ? ` · ▶ ${r.id}` : ""}\n${heard[c.rank] ? `> ${cut(plain(heard[c.rank]), 110)}` : "> _nothing said_"}`;
  });
  return { embeds: [{ color: 0x9FD8C8, title: `📼 ${id} · ${cut(d.name || (d.started || "").slice(0, 16) || d.file, 60)}`,
    description: `${clockOf(d.info.duration)} · ${d.candidates.length} moments · ${reels.length} reel${reels.length === 1 ? "" : "s"}, ${Object.keys(d.finals || {}).length} rendered\n\n${moments.join("\n") || "No moments found."}`.slice(0, 3900),
    fields: reels.length ? [{ name: "Reels", value: reels.slice(0, 12).map((r) => `\`${r.id}\` ${clockOf(r.in)}–${clockOf(r.out)} ${(d.finals || {})[r.id] ? "🟢" : "🟡"} ${cut(plain(r.title || "untitled"), 40)}`).join("\n").slice(0, 1000) }] : [],
    footer: { text: "/reel makes one from a moment · /render renders what is left" } }] };
}

// The server does one job at a time: wait for the one that runs, start ours, wait for it.
async function serverIdle(limit = 30 * 60000) {
  for (const end = Date.now() + limit; Date.now() < end; await pause(2000)) {
    const job = (await serverCall("/api/status")).job;
    if (!job.running) return job;
  }
  throw new Error("Link is still busy with another job.");
}
async function serverJob(body, limit = 60 * 60000) {
  await serverIdle();
  const started = await serverCall("/api/jobs", "POST", body);
  if (!started.ok) throw new Error(started.error || "The job did not start.");
  await pause(1500);
  const job = await serverIdle(limit);
  if (job.returncode !== 0) throw new Error((job.log || "").trim().split("\n").pop() || "The job failed.");
  return job;
}

// Reels from the moments of those ranks; title and hook go on the first. Returns the new reels.
async function makeReels(id, ranks, title, hook) {
  const made = [];
  for (const rank of ranks) {
    const before = new Set((((await serverCall(`/api/sources/${id}`)).edl || {}).reels || []).map((r) => r.id));
    const { edl } = await serverCall(`/api/sources/${id}/reels`, "POST", { rank });
    const fresh = edl.reels.find((r) => !before.has(r.id));
    if (fresh) made.push(fresh);
  }
  if (made.length && (title || hook)) {
    const d = await serverCall(`/api/sources/${id}`);
    const reel = d.edl.reels.find((r) => r.id === made[0].id);
    if (title) reel.title = String(title).slice(0, 120);
    if (hook) reel.hook = String(hook).slice(0, 120);
    await fetch(`${DASHBOARD}/api/sources/${id}/reels`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base: d.version, edl: d.edl }) });
    Object.assign(made[0], { title: reel.title, hook: reel.hook });
  }
  return made;
}

// A page opened from Discord, playing and filling the panel, ready to record.
async function openForRecording(url) {
  const kind = streamOf(url) ? "stream" : "video";
  const opened = await openPage(url, kind);
  if (!opened.ok) throw new Error(opened.error);
  const c = cur;
  if (alive(win)) win.webContents.send("shell:studio", url, opened.kind);   // the dashboard shows the Studio (or URL) with it
  for (const end = Date.now() + 30000; Date.now() < end && (c.player.webContents.isLoading() || c.fills == null); ) await pause(500);
  // Twitch often opens with an ad: the recording starts after it, for up to four minutes of ads.
  for (const end = Date.now() + 240000; Date.now() < end && (c.stage === "ad" || c.stage === "starting"); ) await pause(1000);
  await pause(opened.kind === "stream" ? 6000 : 2500);   // a stream needs a moment before its picture runs
  if (opened.kind === "video") {   // the video's own full-screen button, and play from the start
    await c.player.webContents.executeJavaScript(`(async () => { const v = document.querySelector("video"), b = document.querySelector(".ytp-fullscreen-button");
      if (b && !document.fullscreenElement) b.click(); if (v) { try { v.currentTime = 0; await v.play(); } catch (e) {} } return !!v; })()`, true).catch(() => {});
    await pause(1500);
  }
  return c;
}

async function whenSaved(c) {
  for (const end = Date.now() + 90000; Date.now() < end && c.rec.saving; ) await pause(500);
  if (c.rec.saving || c.rec.error) throw new Error(c.rec.error || "The recording was not saved in time.");
  return c.rec.file;
}

// The tape a recording became. The page starts the processing itself when Auto-process is on;
// when nothing has started after a moment, this starts it.
async function tapeOf(file) {
  const stamp = path.basename(file, ".mp4").replace(/(\d\d)-(\d\d)-(\d\d)$/, "$1:$2:$3");
  await pause(5000);
  if (!(await serverCall("/api/status")).job.running && (await serverCall("/api/recordings")).some((r) => r.file === file))
    await serverCall("/api/jobs", "POST", { kind: "ingest", files: [file], recording: true }).catch(() => {});
  let lost = 0;
  for (const end = Date.now() + 90 * 60000; Date.now() < end; await pause(3000)) {
    const tape = (await serverCall("/api/sources")).find((s) => s.started === stamp), job = (await serverCall("/api/status")).job;
    if (tape && !job.running) return tape;
    if (tape || job.running) { lost = 0; continue; }   // being processed: while that runs it is neither waiting nor a tape yet
    if ((await serverCall("/api/recordings")).some((r) => r.file === file)) {
      if (job.kind === "ingest" && job.returncode) throw new Error((job.log || "").trim().split("\n").pop() || "Processing failed.");
      await serverCall("/api/jobs", "POST", { kind: "ingest", files: [file], recording: true }).catch(() => {});
    } else if (++lost > 3) throw new Error("The recording is gone before it became a tape.");
  }
  throw new Error("Processing took too long.");
}

// The best moments not used yet, as many as asked for, none overlapping another.
function bestMoments(d, n) {
  const gone = new Set(((d.ui || {}).dismissed) || []), taken = (((d.edl || {}).reels) || []).map((r) => [r.in, r.out]);
  const out = [];
  for (const c of [...d.candidates].sort((a, b) => a.rank - b.rank)) {
    if (out.length >= n) break;
    if (gone.has(`${c.in}-${c.out}`) || taken.some(([a, b]) => a < c.out && b > c.in)) continue;
    out.push(c);
    taken.push([c.in, c.out]);
  }
  return out;
}

// /auto: from a link to rendered reels, telling the channel each step. /cancel stops it between steps
// (a running recording is stopped and kept).
async function runAuto(job) {
  const step = (text) => { job.step = text; return say(`⚙ ${text}`); };
  const stopIf = () => { if (job.cancelled) throw new Error("cancelled"); };
  let c = null;
  try {
    await step(`Opening ${job.url}`);
    c = await openForRecording(job.url);
    stopIf();
    // Nobody watches an /auto, so the page is taken off the big screen (it shows as a pill) and given
    // the size of a 720p picture: the recording is that sharp whatever size Link's window is.
    if (cur === c) setCur(null);
    c.player.setBounds({ x: 0, y: 0, width: REMOTE_SIZE.width, height: REMOTE_SIZE.height });
    applySound();
    place();
    push();
    await pause(2500);
    const started = await startRecording(c);
    if (!started.ok) throw new Error(started.error);
    await step(`🔴 Recording **${plain(whatPlays(c))}** for ${job.minutes} min${c.rec.size ? ` at ${c.rec.size.width}×${c.rec.size.height}` : ""}`);
    for (const end = Date.now() + job.minutes * 60000; Date.now() < end && !job.cancelled && c.rec.active; ) await pause(1000);
    const was = (Date.now() - c.rec.since) / 1000;
    if (c.rec.active) stopRecording(c);
    const file = await whenSaved(c);
    if (job.cancelled) return say(`⏹ Cancelled. ${clockOf(was)} was recorded and is kept as \`${path.basename(file)}\`; \`/process\` makes a tape of it.`);
    await step(`⏹ Saved ${clockOf(was)}. Processing it into a tape (this takes a few minutes)`);
    const tape = await tapeOf(file);
    stopIf();
    const d = await serverCall(`/api/sources/${tape.id}`);
    const picks = bestMoments(d, job.reels);
    if (!picks.length) return say(`📼 **${tape.id}** is ready, but Link found no moment worth a reel in it. \`/tape ${tape.id}\` shows what there is.`);
    await step(`📼 **${tape.id}** is ready: ${d.candidates.length} moments. Making ${picks.length} reel${picks.length === 1 ? "" : "s"} from ${picks.map((p) => `#${p.rank}`).join(", ")}`);
    const reels = await makeReels(tape.id, picks.map((p) => p.rank));
    stopIf();
    await serverJob({ kind: "render", source: tape.id, only: reels.map((r) => r.id) });
    const after = await serverCall(`/api/sources/${tape.id}`);
    await bot.message(channelFor("control"), { embeds: [{ color: 0x3DDC84, title: `✅ ${tape.id}: ${reels.length} reel${reels.length === 1 ? "" : "s"} rendered`,
      description: reels.map((r) => `\`${r.id}\` ${clockOf(r.in)}–${clockOf(r.out)} ${(after.finals || {})[r.id] ? "🟢" : "🔴 not rendered"}`).join("\n")
        + `\n\nFrom ${plain(job.url)}, ${clockOf(was)} recorded, in ${clockOf((Date.now() - job.at) / 1000)} all told.`
        + (channelFor("reels") && dcfg.posts.reels ? `\nThe videos are in <#${channelFor("reels")}>.` : "\nThe files are in Link's Finals.")
        + "\nEach has a suggested title, hook and post text. Read them over in Link (Reels and Finals) before you post." }] });
  } catch (e) {
    if (c && c.rec.active) stopRecording(c);
    await say(e.message === "cancelled" ? "⏹ Cancelled. What was made so far is kept." : `⚠ /auto stopped at "${job.step}": ${e.message}`);
  } finally {
    remote.auto = null;
  }
}

// One of the owner's commands. Every answer shows in the control channel, which only the owner sees.
async function answerOwner(i) {
  const name = i.data.name, opt = (key) => optionOf(i, key);
  const fail = (e) => bot.edit(i, { content: e.message === "not found" ? "There is no such tape. `/list` shows them." : `⚠ ${e.message}` }).catch(() => {});
  if (name === "remote") return bot.api("POST", `/interactions/${i.id}/${i.token}/callback`, { type: 4, data: { allowed_mentions: { parse: [] }, ...require("./remote_panel").controlPanel() } });
  await bot.defer(i);
  try {
    if (name === "list") return await bot.edit(i, await remoteList());
    if (name === "tape") return await bot.edit(i, await remoteTape(tapeId(opt("tape"))));
    if (name === "open") {
      const c = await openForRecording(String(opt("link") || ""));
      return await bot.edit(i, { content: `▶ **${plain(whatPlays(c))}** is open in Link. \`/rec start\` records it.` });
    }
    if (name === "rec") {
      const want = String(opt("stream") || "").toLowerCase(), named = (c) => !want || channelName(c).toLowerCase().includes(want);
      if (opt("action") === "start") {
        const c = want ? channels.find((k) => k.player && !busy(k) && named(k)) : cur;
        if (!c || !c.player) return await bot.edit(i, { content: "Nothing is open to record. `/open` a link first." });
        const r = await startRecording(c);
        return await bot.edit(i, { content: r.ok ? `🔴 Recording **${plain(whatPlays(c))}**. \`/rec stop\` ends it.` : `⚠ ${r.error}` });
      }
      const going = recordingNow().filter(named);
      if (!going.length) return await bot.edit(i, { content: "Nothing is being recorded." });
      const lines = [];
      for (const c of going) {
        const was = (Date.now() - c.rec.since) / 1000;
        stopRecording(c);
        lines.push(`⏹ **${plain(c.rec.lastWhat || channelName(c))}**: ${clockOf(was)} saved as \`${path.basename(await whenSaved(c))}\``);
      }
      return await bot.edit(i, { content: `${lines.join("\n")}\n\`/process\` makes a tape of it (with Auto-process on, Link does that by itself for a recording of 30 seconds or more).` });
    }
    if (name === "process") {
      const waiting = await serverCall("/api/recordings");
      if (!waiting.length) return await bot.edit(i, { content: "No recording is waiting: every one is a tape already." });
      const files = (opt("all") ? waiting : waiting.slice(0, 1)).map((r) => r.file);
      await bot.edit(i, { content: `⚙ Processing ${files.map((f) => `\`${path.basename(f)}\``).join(", ")}…${waiting.length > files.length ? ` (${waiting.length - files.length} more wait)` : ""}` });
      const before = new Set((await serverCall("/api/sources")).map((s) => s.id));
      await serverJob({ kind: "ingest", files, recording: true });
      const fresh = (await serverCall("/api/sources")).filter((s) => !before.has(s.id));
      return await say(fresh.length ? `📼 Ready: ${fresh.map((s) => `**${s.id}** (${clockOf(s.duration)}, ${s.candidates} moments)`).join(", ")}. \`/tape\` shows the moments.` : "Processing ended, but no new tape appeared.");
    }
    if (name === "reel") {
      const id = tapeId(opt("tape")), rank = Number(opt("moment"));
      const d = await serverCall(`/api/sources/${id}`);
      if (!d.candidates.some((c) => c.rank === rank)) return await bot.edit(i, { content: `${id} has no moment #${rank}. \`/tape ${id}\` lists them.` });
      const [reel] = await makeReels(id, [rank], opt("title"), opt("hook"));
      if (!reel) return await bot.edit(i, { content: "The reel was not made." });
      await bot.edit(i, { content: `🎬 \`${reel.id}\` made from ${id} #${rank} (${clockOf(reel.in)}–${clockOf(reel.out)}). Rendering…` });
      await serverJob({ kind: "render", source: id, only: [reel.id] });
      return await say(`✅ \`${reel.id}\` is rendered.${channelFor("reels") && dcfg.posts.reels ? ` The video is in <#${channelFor("reels")}>.` : " The file is in Link's Finals."}`);
    }
    if (name === "render") {
      const id = tapeId(opt("tape"));
      const d = await serverCall(`/api/sources/${id}`);
      const left = ((d.edl || {}).reels || []).filter((r) => !(d.finals || {})[r.id]).map((r) => r.id);
      if (!left.length) return await bot.edit(i, { content: `Every reel of ${id} is rendered already.` });
      await bot.edit(i, { content: `⚙ Rendering ${left.map((r) => `\`${r}\``).join(", ")}…` });
      await serverJob({ kind: "render", source: id, only: left });
      return await say(`✅ ${id}: ${left.length} reel${left.length === 1 ? "" : "s"} rendered.`);
    }
    if (name === "auto") {
      if (remote.auto) return await bot.edit(i, { content: `An /auto is running already (${remote.auto.step || "starting"}). \`/cancel\` stops it.` });
      let url = String(opt("link") || "").trim();
      if (url && !url.includes("://")) url = "https://" + url;
      if (!WEB.test(url) || /\s/.test(url)) return await bot.edit(i, { content: "That is not a link. Try kick.com/channel or twitch.tv/channel." });
      remote.auto = { url, minutes: Number(opt("minutes")), reels: Number(opt("reels")) || 3, at: Date.now(), step: "", cancelled: false };
      await bot.edit(i, { content: `🚀 **/auto** started: ${plain(url)}, ${remote.auto.minutes} min, ${remote.auto.reels} reel${remote.auto.reels === 1 ? "" : "s"}. Each step is told here; \`/cancel\` stops it.`, flags: 4 });
      note("🚀", `/auto: ${url} for ${remote.auto.minutes} min`);
      return void runAuto(remote.auto);
    }
    if (name === "cancel") {
      if (!remote.auto) return await bot.edit(i, { content: "No /auto is running." });
      remote.auto.cancelled = true;
      return await bot.edit(i, { content: `⏹ Stopping the /auto (it was at: ${remote.auto.step || "starting"}).` });
    }
  } catch (e) {
    await fail(e);
    note("⚠", `/${name}: ${e.message}`, true);
  }
}

// ---- the report: every 12 hours, how the reels and the Shorts are doing, in a channel only the bot writes in

const SUMMARY_FILE = path.join(HOME, ".link", "discord_summary.json");   // the numbers at the last report, to show what changed
const SUMMARY_EVERY = 12 * 3600 * 1000;
const summary = { busy: false, wait: 0, error: "" };
const bit = (n) => 1n << BigInt(n);
const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const grew = (now, before) => (before == null || now == null || now === before ? "" : ` \`${now > before ? "+" : "−"}${num(Math.abs(now - before))}\``);
const cut = (text, n) => (text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text);
const titleOf = (p) => cut(String(p.caption || "").split("\n")[0].replace(/#\S+/g, "").replace(/[\[\]()*_~`|\\<>]/g, "").trim() || "Untitled", 46);
const nextSummary = () => (dcfg.lastSummary || 0) + SUMMARY_EVERY;

// What the bot may do on the server: its roles' permissions together.
async function botMay() {
  const guild = await bot.api("GET", `/guilds/${dcfg.guildId}`);
  const me = await bot.api("GET", `/guilds/${dcfg.guildId}/members/${bot.user.id}`);
  let may = 0n;
  for (const r of guild.roles || []) if (r.id === guild.id || (me.roles || []).includes(r.id)) may |= BigInt(r.permissions);
  return may & bit(3) ? ~0n : may;   // an administrator may do everything
}

// ---- the night run (tools/reels/night): its channel, its commands, and what it asks of this window

// A new channel, #night, that only the server's owner and the bot can see: the night run's updates
// and pictures go there, and /night, /continue, /retry and /nightstop are answered there.
async function makeNightChannel() {
  if (channelFor("night")) return { ok: true, id: channelFor("night") };
  if (!bot || bot.state !== "online" || !dcfg.guildId || !dc.guild) return { ok: false, error: "The bot has to be online on a server first." };
  try {
    const may = await botMay();
    if (!(may & bit(4))) return { ok: false, error: "The bot may not make channels. In Discord: Server Settings > Roles > the bot's role > turn on Manage Channels." };
    const all = await bot.api("GET", `/guilds/${dcfg.guildId}/channels`);
    const beside = all.find((c) => c.id === dcfg.channels.control) || all.find((c) => c.id === dcfg.channels.reels) || all.find((c) => c.type === 0);
    const made = await bot.api("POST", `/guilds/${dcfg.guildId}/channels`, {
      name: "night", type: 0, topic: "Link Night: how the night run stands, and anything that interrupts it. /night, /continue, /retry, /nightstop. Only you see this channel.",
      ...(beside && beside.parent_id ? { parent_id: beside.parent_id } : {}),
      permission_overwrites: [
        { id: dcfg.guildId, type: 0, allow: "0", deny: "1024" },
        { id: dc.guild.owner, type: 1, allow: String((BigInt(POSTING) | bit(16) | bit(31)) & may), deny: "0" },
        { id: bot.user.id, type: 1, allow: String((BigInt(POSTING) | bit(16)) & may), deny: "0" },
      ],
    });
    dcfg.channels.night = made.id;
    saveDiscord();
    note("🌙", `Made #${made.name}; only you and the bot see it`);
    await loadChoices();
    return { ok: true, id: made.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// One of the night run's commands: handed to the Night window's program (started if it is not open),
// which does it and says how it went in the night channel. The answer here only says it was passed on.
async function answerNight(i) {
  const name = i.data.name;
  // the choices given with the command go along as a query: night?hours=3&shootersOnly=true
  const given = new URLSearchParams();
  for (const [option, key] of [["hours", "hours"], ["shooters_only", "shootersOnly"], ["log_chat", "relayChat"], ["carry_on", "autoContinue"], ["updates", "discord"], ["sleep_after", "sleepAfter"], ["streams", "streams"]]) {
    if (optionOf(i, option) !== undefined) given.set(key, String(optionOf(i, option)));
  }
  const what = ({ nightstop: "stop", nightset: "set" }[name] || name) + (given.size ? `?${given}` : "");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    spawn(process.execPath, [path.join(__dirname, "..", "night"), `--do=${what}`], { cwd: path.join(__dirname, "..", "..", ".."), env, detached: true, stdio: "ignore", windowsHide: true }).unref();
    note("🌙", `/${name} passed to Link Night`);
    return bot.reply(i, { night: "🌙 Asked Link Night.", nightset: "🌙 Asked Link Night for its settings.", continue: "🌙 Asked Link Night to carry on.", retry: "🌙 Asked Link Night to start again.", nightstop: "🌙 Asked Link Night to stop." }[name] + " It answers here in a moment.");
  } catch (e) {
    return bot.reply(i, `⚠ Link Night could not be started: ${e.message}`);
  }
}

// A button under one of the night run's cards (night/panel.js makes them). The owner alone. One that
// changes a choice is done here and the card it sits under is drawn again as the remote, with the
// new choice; one that does something is handed to the Night program, like the command of that name.
async function answerButton(i) {
  const id = String((i.data || {}).custom_id || ""), member = i.member || {};
  if (id.startsWith("ctl")) return answerRemoteButton(i, id);
  if (id === "stats:refresh") return answer({ ...i, data: { name: "refresh", options: [] } });   // the Refresh button under a report: the same as /refresh
  if (!id.startsWith("night:")) return;
  if (!dcfg.guildId || i.guild_id !== dcfg.guildId) return bot.reply(i, "Link only answers in its own server.", { quiet: true });
  if (!(member.user && dc.guild && member.user.id === dc.guild.owner)) return bot.reply(i, "Only the server's owner can run Link Night from Discord.", { quiet: true });
  const nightPanel = require("../night/panel");
  if (id === "night:panel") return bot.api("POST", `/interactions/${i.id}/${i.token}/callback`, { type: 4, data: { allowed_mentions: { parse: [] }, ...nightPanel.panel() } });   // the remote, as a message of its own
  if (nightPanel.press(id)) return bot.update(i, nightPanel.panel());
  const what = id.split(":")[1];
  if (!["start", "stop", "continue", "retry", "status", "awake"].includes(what)) return bot.reply(i, "That button is not known to this Link.", { quiet: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    spawn(process.execPath, [path.join(__dirname, "..", "night"), `--do=${{ start: "night", status: "status" }[what] || what}`], { cwd: path.join(__dirname, "..", "..", ".."), env, detached: true, stdio: "ignore", windowsHide: true }).unref();
    note("🌙", `${what} pressed for Link Night`);
    return bot.reply(i, { start: "🌙 Starting a night.", stop: "🌙 Stopping the night.", continue: "🌙 Carrying on.", retry: "🌙 Starting over.", status: "📸 Taking a picture.", awake: "☕ Keeping the PC awake." }[what] + " The answer comes here in a moment.", { quiet: true });
  } catch (e) {
    return bot.reply(i, `⚠ Link Night could not be started: ${e.message}`, { quiet: true });
  }
}

// A button of the owner's remote (remote_panel.js), or the form one of them opened, filled in. It
// becomes the command of that name with its options, and goes the way a typed command goes: answer()
// checks that it is the owner, in the control channel, and does it.
async function answerRemoteButton(i, id) {
  const panel = require("./remote_panel");
  const as = (name, options) => answer({ ...i, data: { name, options: Object.entries(options).map(([key, value]) => ({ name: key, value })) } });
  if (i.type === 5) {   // a form, filled in
    const form = panel.fromForm(i.data);
    return form.error ? bot.reply(i, `⚠ ${form.error}`, { quiet: true }) : as(form.name, form.options);
  }
  if (panel.FORMS[id]) {   // a form is shown only to the owner, in the control channel: the same rule as for the command it leads to
    const member = i.member || {};
    if (!(member.user && dc.guild && member.user.id === dc.guild.owner)) return bot.reply(i, "Only the server's owner can run Link from Discord.", { quiet: true });
    if (i.channel_id !== channelFor("control")) return bot.reply(i, `That button works in <#${channelFor("control")}> only.`, { quiet: true });
    return bot.form(i, panel.FORMS[id]);
  }
  if (panel.DIRECT[id]) return as(...panel.DIRECT[id]);
  return bot.reply(i, "That button is not known to this Link.", { quiet: true });
}

// The Night window, opened from Settings (the moon button). It is a program of its own; one that is
// open already comes forward.
function openNight() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LINK_DEBUG_PORT;   // the Night window is not to open a test port of its own
  try {
    spawn(process.execPath, [path.join(__dirname, "..", "night")], { cwd: path.join(__dirname, "..", "..", ".."), env, detached: true, stdio: "ignore" }).unref();
    return true;
  } catch (e) {
    return false;
  }
}

// What the night run asks of this window, through the dashboard's page: its channel (made if there is
// none), and the chat relay switched for the night (the answer is how it was, to put back afterwards).
async function nightAsk(what, value) {
  if (what === "channel") return makeNightChannel();
  if (what === "relay") {
    const was = !!dcfg.posts.chat;
    if (typeof value === "boolean" && value !== was) { dcfg.posts.chat = value; saveDiscord(); pushDiscord(); }
    return { ok: true, was };
  }
  return { ok: false, error: "unknown" };
}

// A new channel, #analytics, beside #reels: everyone can read it, only the bot (and the server's
// administrators, whom Discord never locks out) can write in it.
async function makeReportChannel() {
  if (!bot || bot.state !== "online" || !dcfg.guildId) return { ok: false, error: "The bot has to be online on a server first." };
  try {
    const may = await botMay();
    if (!(may & bit(4))) return { ok: false, error: "The bot may not make channels yet. In Discord: Server Settings > Roles > the bot's role > turn on Manage Channels, then press this again. Or choose a channel you made yourself in Settings." };
    // writing, threads and writing in threads: closed for @everyone (a bot can only close what it may do itself)
    const closed = [11, 35, 36, 38].reduce((sum, n) => (may & bit(n) ? sum | bit(n) : sum), 0n);
    const all = await bot.api("GET", `/guilds/${dcfg.guildId}/channels`);
    const beside = all.find((c) => c.id === dcfg.channels.reels) || all.find((c) => c.type === 0);
    const made = await bot.api("POST", `/guilds/${dcfg.guildId}/channels`, {
      name: "analytics", type: 0, topic: "Every 12 hours: how the reels and the Shorts are doing. Only Link writes here.",
      ...(beside && beside.parent_id ? { parent_id: beside.parent_id } : {}),
      permission_overwrites: [
        { id: dcfg.guildId, type: 0, allow: "0", deny: String(closed) },
        { id: bot.user.id, type: 1, allow: String(BigInt(POSTING)), deny: "0" },
      ],
    });
    dcfg.channels.summary = made.id;
    dcfg.posts.summary = true;
    dcfg.lastSummary = 0;
    saveDiscord();
    note("📊", `Made #${made.name}; only the bot writes there`);
    await loadChoices();
    report();   // the first one right away
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// One side's numbers, read now; if that fails, the ones last read (marked as old).
async function numbersOf(what) {
  const ask = async (init) => { try { return await (await fetch(`${DASHBOARD}/api/${what}`, init)).json(); } catch (e) { return null; } };
  let got = await ask({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
  const old = !got || !!got.error;
  if (old) got = await ask();
  return got && got.connected && got.data && got.data.account ? { ...got.data, old } : null;
}

// The report is drawn with what Discord shows in a message: blocks of even-width text for the charts
// (kept under 35 characters a line, so a phone does not wrap them), coloured with the few colours
// such a block knows, and plain lines with links under them.
const tint = (code, text) => `\u001b[${code}m${text}\u001b[0m`;
const GREEN = "1;32", RED = "1;31", YELLOW = "1;33", GREY = "30", PINK = "35", TUBE = "31", WHITE = "1;37";
const block = (lines) => "```ansi\n" + lines.join("\n") + "\n```";
// A bar of that many cells, filled to the part given (eighths of a cell at its end).
function bar(part, cells) {
  const eighths = part > 0 ? Math.max(1, Math.round(Math.min(1, part) * cells * 8)) : 0;
  return ("█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? " ▏▎▍▌▋▊▉"[eighths % 8] : "")).padEnd(cells);
}
const mostSeen = (posts) => [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
const viewsOf = (posts) => posts.reduce((sum, p) => sum + (p.views || 0), 0);

// What changed since the numbers kept at the last report.
function changes(d, before) {
  if (!before) return null;
  const ups = d.posts.map((p) => ({ p, up: Math.max(0, (p.views || 0) - ((before.posts[p.id] || {}).views || 0)), fresh: !before.posts[p.id] }));
  const hours = Math.max(1, Math.round((Date.now() - before.at) / 3600000));
  return {
    views: ups.reduce((sum, u) => sum + u.up, 0), fresh: ups.filter((u) => u.fresh).length,
    best: ups.filter((u) => u.up > 0).sort((a, b) => b.up - a.up)[0] || null,
    people: (d.account.followers || 0) - (before.followers || 0),
    ago: hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} h`,
  };
}

// The most seen posts as bars, with what each gained since the last report.
function chart(posts, before, colour) {
  const top = mostSeen(posts);
  if (!top.length) return "Nothing posted yet.";
  const most = Math.max(1, top[0].views || 0);
  const rows = top.map((p, i) => {
    const old = before && before.posts[p.id];
    const up = old ? (p.views || 0) - old.views : 0;
    const since = !before ? "" : !old ? tint(YELLOW, "NEW".padStart(8)) : up > 0 ? tint(GREEN, `+${num(up)}`.padStart(8)) : tint(GREY, "–".padStart(8));
    return `${tint(WHITE, i + 1)} ${tint(colour, bar((p.views || 0) / most, 15))} ${num(p.views).padStart(7)}${since}`;
  });
  return block([tint(GREY, `# ${"".padEnd(15)} ${"VIEWS".padStart(7)}${before ? "SINCE".padStart(8) : ""}`), ...rows]);
}

// The same posts as lines that open them, each with what people did with it.
function links(posts, line) {
  const out = [];
  let size = 0;
  for (const [i, p] of mostSeen(posts).entries()) {
    const text = `\`${i + 1}\` [${titleOf(p)}](${p.link})\n${line(p)}`;
    if (size + text.length + 1 > 1000) break;
    out.push(text);
    size += text.length + 1;
  }
  return out.join("\n");
}
const share = (part, of) => (of ? `${(part / of * 100).toFixed(part / of < 0.1 ? 1 : 0)}%` : "–");

// One line under a side's name: what moved since the last report.
function moved(c, things, people) {
  if (!c) return "";
  const parts = [`${c.views ? "🟢" : "⚪"} **${c.views ? "+" : ""}${num(c.views)} views** in ${c.ago}`];
  if (c.fresh) parts.push(`${c.fresh} new ${c.fresh === 1 ? things[0] : things[1]}`);
  if (c.people) parts.push(`${c.people > 0 ? "+" : "−"}${num(Math.abs(c.people))} ${Math.abs(c.people) === 1 ? people[0] : people[1]}`);
  return parts.join(" · ") + (c.best ? `\n🔥 Fastest: [${titleOf(c.best.p)}](${c.best.p.link}) \`+${num(c.best.up)}\`` : "") + "\n";
}

const cell = (name, value) => ({ name, value: `**${value}**`, inline: true });
const oldNote = (d, who) => (d.old ? `\n⚠ ${who} could not be read just now; these are the numbers from <t:${Math.round(d.fetched)}:R>.` : "");

function instagramEmbed(d, before) {
  const a = d.account, m = d.last_28_days || {};
  return {
    color: 0xE1306C,
    author: { name: `Instagram Reels · @${a.username}`, url: `https://www.instagram.com/${a.username}/`, ...(a.picture ? { icon_url: a.picture } : {}) },
    description: moved(changes(d, before), ["reel", "reels"], ["follower", "followers"]) + oldNote(d, "Instagram"),
    fields: [
      cell("Views · 28 days", num(m.views)),
      cell("Reached · 28 days", num(m.reach)),
      cell("Followers", num(a.followers)),
      cell("Interactions · 28 days", num(m.total_interactions)),
      cell("Engaged · 28 days", num(m.accounts_engaged)),
      cell("Reels", num(a.posts)),
      { name: "Most seen reels", value: chart(d.posts, before, PINK) },
      d.posts.length && { name: "Open them", value: links(d.posts, (p) =>
        `❤ ${num(p.likes)} · 💬 ${num(p.comments)} · ↗ ${num(p.shares)}${p.saves ? ` · 🔖 ${num(p.saves)}` : ""} · ${share(p.interactions || 0, p.views)} reacted${p.watch_seconds ? ` · watched ${Math.round(p.watch_seconds)} s` : ""}`) },
    ].filter(Boolean),
  };
}

function youtubeEmbed(d, before) {
  const a = d.account, m = d.last_28_days || {};
  const minutes = Math.round(m.estimatedMinutesWatched || 0);
  const of = d.last_28_days_shorts_only ? "" : " (all videos)";
  return {
    color: 0xFF0000,
    author: { name: `YouTube Shorts · ${a.name || a.username}`, ...(a.link ? { url: a.link } : {}), ...(a.picture ? { icon_url: a.picture } : {}) },
    description: moved(changes(d, before), ["Short", "Shorts"], ["subscriber", "subscribers"]) + (d.last_28_days ? "" : "YouTube has no 28-day numbers for this channel yet.") + oldNote(d, "YouTube"),
    fields: [
      ...(d.last_28_days ? [cell(`Views · 28 days${of}`, num(m.views)), cell("Watched · 28 days", minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`)] : []),
      cell("Subscribers", num(a.followers)),
      ...(d.last_28_days ? [cell("Likes · 28 days", num(m.likes)), cell("Comments · 28 days", num(m.comments))] : []),
      cell("Shorts", num(d.posts.length)),
      { name: "Most seen Shorts", value: chart(d.posts, before, TUBE) },
      d.posts.length && { name: "Open them", value: links(d.posts, (p) =>
        `❤ ${num(p.likes)} · 💬 ${num(p.comments)}${p.shares ? ` · ↗ ${num(p.shares)}` : ""}${p.watched_percent != null ? ` · watched ${Math.round(p.watched_percent)}% of it` : ""}${p.length ? ` · ${p.length} s long` : ""}`) },
    ].filter(Boolean),
  };
}

// The card on top: the views of both sides against each other, what came in since the last report,
// and how the last reports compare.
function headEmbed(sides, kept, now) {
  const total = sides.reduce((sum, s) => sum + s.views, 0);
  const gained = sides.some((s) => s.changes) ? sides.reduce((sum, s) => sum + (s.changes ? s.changes.views : 0), 0) : null;
  const ago = (sides.find((s) => s.changes) || { changes: {} }).changes.ago;
  const rows = sides.map((s) => `${s.name.padEnd(9)} ${tint(s.colour, bar(total ? s.views / total : 0, 11))} ${num(s.views).padStart(7)} ${share(s.views, total).padStart(4)}`);
  // what each of the last reports brought, as a row of small bars
  const steps = (kept.history || []).map((h, i, all) => (i ? Math.max(0, h.views - all[i - 1].views) : null)).slice(1).slice(-12);
  const tallest = Math.max(1, ...steps);
  const trend = steps.length >= 2 ? [tint(GREY, `${"NEW VIEWS, REPORT BY REPORT".padEnd(34)}`), `${tint(GREEN, steps.map((v) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.round(v / tallest * 7))]).join(" "))}  ${tint(WHITE, `+${num(steps[steps.length - 1])}`)} now`] : [];
  return {
    color: 0x9FD8C8, title: "📊 Link report",
    description: `<t:${Math.round(now / 1000)}:F>\n\n`
      + (gained == null ? "This is the first report; the next one also shows what changed.\n" : `# ${gained ? "+" : ""}${num(gained)} views\nsince the last report ${ago} ago, on ${sides.map((s) => s.name).join(" and ")}.\n`)
      + block([`${tint(GREY, "VIEWS, LAST 28 DAYS".padEnd(22))}${tint(WHITE, num(total).padStart(7))}`, ...rows, ...(trend.length ? ["", ...trend] : [])])
      + `Next report <t:${Math.round((now + SUMMARY_EVERY) / 1000)}:R>, while Link is open.`,
  };
}

// Reads both sides, posts the report and keeps the numbers for next time. force: asked for by hand,
// so it goes out even with the switch off.
async function report(force = false) {
  if (summary.busy) return { ok: false, error: "A report is being made." };
  if (!bot || bot.state !== "online" || !channelFor("summary")) return { ok: false, error: "The bot needs to be online, with a channel for the report." };
  if (!force && !dcfg.posts.summary) return { ok: false };
  summary.busy = true;
  summary.error = "";
  pushDiscord();
  try {
    const [insta, tube] = await Promise.all([numbersOf("instagram"), numbersOf("youtube")]);
    if (!insta && !tube) throw new Error("Neither Instagram nor YouTube is connected; connect one in Analytics.");
    let kept = {};
    try { kept = JSON.parse(fs.readFileSync(SUMMARY_FILE, "utf8")) || {}; } catch (e) { /* the first report */ }
    const now = Date.now();
    const sides = [
      insta && { name: "Instagram", colour: PINK, views: (insta.last_28_days || {}).views || 0, changes: changes(insta, kept.instagram) },
      tube && { name: "YouTube", colour: TUBE, views: (tube.last_28_days || {}).views || 0, changes: changes(tube, kept.youtube) },
    ].filter(Boolean);
    const month = sides.reduce((sum, s) => sum + s.views, 0);
    const names = sides.map((s) => s.name).join(" and ");
    // the views of every post together, report after report: the row of small bars on the top card
    if (!(insta && insta.old) && !(tube && tube.old)) kept.history = [...(kept.history || []), { at: now, views: (insta ? viewsOf(insta.posts) : 0) + (tube ? viewsOf(tube.posts) : 0) }].slice(-13);
    const embeds = [headEmbed(sides, kept, now), insta && instagramEmbed(insta, kept.instagram), tube && youtubeEmbed(tube, kept.youtube)].filter(Boolean);
    Object.assign(embeds[embeds.length - 1], { footer: { text: "Link · every 12 hours" }, timestamp: new Date(now).toISOString() });
    await bot.message(channelFor("summary"), { embeds, components: refreshRow() });   // with a Refresh button under it (quickNumbers)
    const keep = (d) => ({ at: now, followers: d.account.followers || 0, posts: Object.fromEntries(d.posts.map((p) => [p.id, { views: p.views || 0 }])) });
    // a side read from old numbers keeps what was kept before, so the next report's changes stay true
    if (insta && !insta.old) kept.instagram = keep(insta);
    if (tube && !tube.old) kept.youtube = keep(tube);
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(kept));
    dcfg.lastSummary = now;
    saveDiscord();
    note("📊", `Report posted: ${num(month)} views in 28 days on ${names}`);
    return { ok: true };
  } catch (e) {
    summary.error = e.message;
    summary.wait = Date.now() + 30 * 60 * 1000;   // not again for half an hour, rather than every minute
    note("⚠", `Report: ${e.message}`, true);
    return { ok: false, error: e.message };
  } finally {
    summary.busy = false;
    pushDiscord();
  }
}

// ---- /refresh: the channels' own numbers, read now, on request

// The two accounts as they stand this minute: followers and subscribers and the 28-day numbers, without
// the posts one by one (that is the 12-hour report). It is asked for with /refresh or with the Refresh
// button under a report, and answered where it was asked. It keeps nothing: what the next 12-hour
// report compares with stays as it was.
const refreshRow = () => [{ type: 1, components: [{ type: 2, style: 2, custom_id: "stats:refresh", label: "Refresh", emoji: { name: "🔄" } }] }];
const quick = { busy: false };
async function quickNumbers() {
  if (quick.busy) return { content: "The numbers are being read already. They are here in a moment." };
  quick.busy = true;
  try {
    const [insta, tube] = await Promise.all([numbersOf("instagram"), numbersOf("youtube")]);
    if (!insta && !tube) return { content: "Neither Instagram nor YouTube is connected. Connect one in Link's Analytics." };
    const now = Date.now();
    // the account's cards as the report draws them, without the parts about single posts
    const slim = (embed, d, who) => ({ ...embed, description: oldNote(d, who).trim() || undefined, fields: embed.fields.filter((f) => f.inline) });
    const sides = [
      insta && { name: "Instagram", views: (insta.last_28_days || {}).views || 0, people: `${num(insta.account.followers)} followers` },
      tube && { name: "YouTube", views: (tube.last_28_days || {}).views || 0, people: `${num(tube.account.followers)} subscribers` },
    ].filter(Boolean);
    const embeds = [
      { color: 0x9FD8C8, title: "🔄 The channels right now",
        description: `<t:${Math.round(now / 1000)}:F>\n\n` + sides.map((s) => `**${s.name}** · ${s.people} · ${num(s.views)} views in 28 days`).join("\n") },
      insta && slim(instagramEmbed(insta, null), insta, "Instagram"),
      tube && slim(youtubeEmbed(tube, null), tube, "YouTube"),
    ].filter(Boolean);
    Object.assign(embeds[embeds.length - 1], { footer: { text: "Link · read just now · the full report comes every 12 hours" }, timestamp: new Date(now).toISOString() });
    note("🔄", `Numbers read on request: ${sides.map((s) => `${s.name} ${s.people}`).join(", ")}`);
    return { embeds, components: refreshRow() };
  } catch (e) {
    return { content: `⚠ The numbers could not be read: ${e.message}` };
  } finally {
    quick.busy = false;
  }
}

// Link has no clock of its own running while it is closed: a report that fell due then goes out soon
// after the bot is next online.
function reportIfDue() {
  if (bot && bot.state === "online" && dcfg.posts.summary && channelFor("summary") && Date.now() >= nextSummary() && Date.now() >= summary.wait) report();
}
setInterval(reportIfDue, 60 * 1000);

// ---- milestones: "your reel passed 1,000 views", in the report's channel, as it happens

const MILESTONE_FILE = path.join(HOME, ".link", "discord_milestones.json");   // the highest numbers seen so far
const MILESTONE_EVERY = 30 * 60 * 1000;
const milestone = { busy: false, next: Date.now() + 90 * 1000 };
// What counts on a post, and the first round number worth a message.
const COUNTS = [["views", "views", 100, "👁"], ["likes", "likes", 10, "❤"], ["comments", "comments", 5, "💬"], ["shares", "shares", 5, "↗"], ["saves", "saves", 5, "🔖"]];
// The round numbers are 5, 10, 25, 50, 100, 250, 500, 1,000 and so on. The highest one passed going
// from `before` to `now` (0 if none), so a jump over several says only the biggest.
function stepPassed(before, now, least) {
  let hit = 0;
  for (let ten = 1; ten <= now; ten *= 10) for (const m of [1, 2.5, 5]) {
    const step = m * ten;
    if (Number.isInteger(step) && step >= least && step > before && step <= now) hit = step;
  }
  return hit;
}

async function checkMilestones() {
  if (milestone.busy || summary.busy || !bot || bot.state !== "online" || !channelFor("summary") || !dcfg.posts.milestones) return;
  milestone.busy = true;
  try {
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(MILESTONE_FILE, "utf8")) || {}; } catch (e) { /* the first look */ }
    const hits = [];
    for (const [key, what, thing, people, color] of [["instagram", "Instagram", "reel", "followers", 0xE1306C], ["youtube", "YouTube", "Short", "subscribers", 0xFF0000]]) {
      const d = await numbersOf(key);
      if (!d || d.old) continue;
      const a = d.account, was = seen[key];
      const author = { name: `${what} · ${key === "instagram" ? "@" + a.username : a.name || a.username}`, ...(a.picture ? { icon_url: a.picture } : {}) };
      const now = { followers: a.followers || 0, posts: {} };
      // The first look only notes where everything stands: nothing already passed is announced.
      if (was) {
        const crowd = stepPassed(was.followers || 0, now.followers, 10);
        if (crowd) hits.push({ color, author, title: `🎉 ${num(crowd)} ${people}`, description: `Your ${what} account hit **${num(crowd)} ${people}** (now ${num(now.followers)}).` });
        now.followers = Math.max(now.followers, was.followers || 0);
      }
      for (const p of d.posts) {
        const old = was ? was.posts[p.id] || {} : null;
        now.posts[p.id] = {};
        for (const [count, word, least, icon] of COUNTS) {
          const value = p[count] || 0;
          const step = old ? stepPassed(old[count] || 0, value, least) : 0;
          if (step) hits.push({ color, author, title: `${icon} ${num(step)} ${word}`,
            description: `Your ${thing} [${titleOf(p)}](${p.link}) hit **${num(step)} ${word}** (now ${num(value)}).`, ...(p.thumbnail ? { thumbnail: { url: p.thumbnail } } : {}) });
          // the highest seen is kept, so a number that dips and comes back is not announced twice
          now.posts[p.id][count] = Math.max(value, old ? old[count] || 0 : 0);
        }
      }
      if (was) now.posts = { ...was.posts, ...now.posts };   // posts no longer listed keep their numbers
      seen[key] = now;
    }
    const at = new Date().toISOString();
    for (let i = 0; i < hits.length; i += 10) await bot.message(channelFor("summary"), { embeds: hits.slice(i, i + 10).map((h) => ({ ...h, timestamp: at })) });
    fs.writeFileSync(MILESTONE_FILE, JSON.stringify(seen));
    if (hits.length) note("🎉", hits.length === 1 ? `Milestone: ${hits[0].title.replace(/^\S+ /, "")}` : `${hits.length} milestones posted`);
  } catch (e) {
    note("⚠", `Milestones: ${e.message}`, true);
  } finally {
    milestone.busy = false;
  }
}
setInterval(() => {
  if (Date.now() < milestone.next) return;
  milestone.next = Date.now() + MILESTONE_EVERY;
  checkMilestones();
}, 30 * 1000);

const discordSpot = () => {
  const at = choices.discord;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    const area = screen.getDisplayMatching({ ...at, ...DISCORD_SIZE }).workArea;
    if (at.x >= area.x - DISCORD_SIZE.width / 2 && at.x <= area.x + area.width - DISCORD_SIZE.width / 2 && at.y >= area.y && at.y <= area.y + area.height - 60)
      return { x: Math.round(at.x), y: Math.round(at.y) };
  }
  const b = win.getBounds();
  return { x: b.x + b.width - DISCORD_SIZE.width - 28, y: b.y + 200 };
};

function showDiscord(on) {
  if (!win) return;
  if (!on) {
    if (discordWin && !discordWin.isDestroyed()) discordWin.hide();
    return push();
  }
  dc.unseen = 0;
  if (discordWin && !discordWin.isDestroyed()) {
    discordWin.show();
    return pushDiscord();
  }
  discordWin = new BrowserWindow({
    ...DISCORD_SIZE, ...discordSpot(), parent: win, show: false, frame: false, transparent: true, hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    backgroundColor: "#00000000", title: "Link · Discord", icon: ICON,
    webPreferences: { preload: path.join(__dirname, "discord_preload.js") },
  });
  const wc = discordWin.webContents;
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.setWindowOpenHandler((details) => {   // the invite link and the Developer Portal open in the user's browser
    if (/^https:\/\/discord\.com\//.test(details.url)) shell.openExternal(details.url);
    return { action: "deny" };
  });
  discordWin.on("moved", () => { const { x, y } = discordWin.getBounds(); choose({ discord: { x, y } }); });
  discordWin.on("show", push);
  discordWin.on("hide", push);
  discordWin.on("closed", () => { discordWin = null; push(); });
  discordWin.once("ready-to-show", () => { discordWin.show(); pushDiscord(); });
  wc.loadURL(`${DASHBOARD}/static/discord.html`).catch(() => {});
}

// For tests only (LINK_DEBUG_PORT is set): a debugger can reach this process one port above the
// pages' debug port, and finds the remote's entry points here. Never on in normal use.
if (process.env.LINK_DEBUG_PORT) {
  require("inspector").open(Number(process.env.LINK_DEBUG_PORT) + 1, "127.0.0.1");
  global.linkDebug = { answerOwner, makeControlChannel, remote, quickNumbers, bot: () => bot, config: () => dcfg };
}

// ---------------------------------------------------------------- messages

const fromPage = (event) => win && event.sender === win.webContents;
// The channel whose recorder sent a message.
const fromRecorder = (event) => channels.find((c) => c.recorder && !c.recorder.isDestroyed() && event.sender === c.recorder.webContents);

ipcMain.handle("shell:state", (e) => (fromPage(e) ? snapshot() : null));
ipcMain.handle("shell:selfcheck", (e) => (fromPage(e) ? runCheck() : null));   // the self-check, run each time the page opens
ipcMain.handle("shell:copy", (e, text) => {  // works whether or not the window has the focus, unlike the page's own clipboard
  if (!fromPage(e)) return false;
  clipboard.writeText(String(text));
  return true;
});
ipcMain.handle("shell:pick", async (e) => {  // a video of the user's own, instead of one recorded from a link
  if (!fromPage(e)) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Choose a video", defaultPath: app.getPath("videos"), properties: ["openFile"],
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi", "wmv", "flv", "ts", "mpg", "mpeg"] },
              { name: "All files", extensions: ["*"] }],
  });
  return canceled || !filePaths.length ? null : filePaths[0];
});
ipcMain.handle("player:open", (e, url, kind) => (fromPage(e) ? openPage(url, kind === "video" ? "video" : "stream") : null));
ipcMain.on("player:view", (e, kind) => { if (fromPage(e)) showView(kind); });
ipcMain.handle("rec:start", (e) => (fromPage(e) ? startRecording() : null));
ipcMain.handle("rec:stop", (e) => (fromPage(e) ? stopRecording() : null));
ipcMain.handle("rec:mark", (e, id) => {
  if (!fromPage(e)) return null;
  const c = id ? channels.find((k) => k.id === id) : markTarget();
  if (!c || markNow(c) === null) return { ok: false, error: "Nothing is being recorded." };
  return { ok: true, marks: c.rec.marks.length };
});
// The pills of minimised channels: put one back on screen, stop its recording, or minimise the one on screen.
ipcMain.on("channel:show", (e, id) => { if (fromPage(e)) showChannel(id); });
// The dashboard's next capture request gets this channel's page (picture only), for its monitor.
let previewing = null;
ipcMain.handle("channel:preview", (e, id) => {
  if (!fromPage(e)) return false;
  previewing = channels.find((k) => k.id === id && k.player) || null;
  return !!previewing;
});
ipcMain.handle("channel:stop", (e, id) => (fromPage(e) ? stopRecording(channels.find((k) => k.id === id)) : null));
ipcMain.handle("channel:minimise", (e) => (fromPage(e) ? minimise() : null));
ipcMain.on("channel:close", (e, id) => { if (fromPage(e)) closeChannel(channels.find((k) => k.id === id)); });
ipcMain.on("player:bounds", (e, rect) => {
  if (!fromPage(e)) return;
  const ok = rect && ["x", "y", "width", "height"].every((k) => Number.isFinite(rect[k]));
  slot = ok ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
  place();
});
ipcMain.on("player:nav", (e, action) => {
  if (!fromPage(e) || !cur || !cur.player) return;
  const wc = cur.player.webContents;
  if (action === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (action === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (action === "reload") wc.reload();
});
ipcMain.on("player:close", (e) => { if (fromPage(e)) closePage(); });
// The mixer: its window and the dashboard's Settings > Audio ask the same things.
const fromMixer = (e) => fromPage(e) || (audioWin && !audioWin.isDestroyed() && e.sender === audioWin.webContents);
ipcMain.on("audio:show", (e, on) => { if (fromPage(e)) showAudio(!!on); });
ipcMain.handle("mix:state", (e) => (fromMixer(e) ? audioState() : null));
ipcMain.on("mix:set", (e, patch) => { if (fromMixer(e)) setAudio(patch || {}); });
ipcMain.on("mix:mic", (e, patch) => { if (fromMixer(e)) setMic(patch || {}); });
ipcMain.on("mix:channel", (e, id, patch) => { if (fromMixer(e)) setChannelAudio(id, patch || {}); });
ipcMain.on("mix:watch", (e, on) => {   // Settings > Audio is on the page, or no longer
  if (!fromPage(e)) return;
  meters.page = !!on;
  syncEngines();
});
ipcMain.on("mix:loud", (e, id) => {
  const c = fromMixer(e) && channels.find((k) => k.id === id);
  if (c && c.player) c.player.webContents.executeJavaScript(FULL_VOLUME, true).catch(() => {}).then(checkMedia);
});
ipcMain.on("mix:hush", (e, on) => {
  if (!fromMixer(e)) return;
  hushed = !!on;
  applySound();
  push();
});
ipcMain.on("mix:music", (e) => { if (fromMixer(e)) showMusic(true); });
ipcMain.on("mix:settings", (e) => {   // from the mixer's window: the big settings, in the dashboard
  if (!fromMixer(e) || !win) return;
  if (alive(win)) win.webContents.send("shell:settings", "audio");
  win.focus();
});
ipcMain.on("mix:hide", (e) => { if (fromMixer(e)) showAudio(false); });
ipcMain.on("audio:level", (e, level) => { const c = fromRecorder(e); if (c) c.audio.level = metering() ? level : null; });
ipcMain.on("audio:engine", (e, info) => {
  const c = fromRecorder(e);
  if (!c) return;
  c.audio.engine = info;
  pushSoon();
});
ipcMain.on("rec:quality", (e, mbit) => {
  if (!fromPage(e) || !VIDEO_CHOICES.includes(mbit)) return;
  choose({ videoMbit: mbit });
  push();
});
// Settings > About: the versions, and Link's own folders opened in Explorer (only the ones the server names).
ipcMain.handle("shell:about", (e) => (fromPage(e) ? { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node } : null));
ipcMain.handle("shell:reveal", async (e, which) => {
  if (!fromPage(e)) return false;
  try {
    const { paths } = await (await fetch(`${DASHBOARD}/api/about`)).json();
    const target = paths && paths[String(which)];
    return !!target && (await shell.openPath(target)) === "";
  } catch (err) {
    return false;
  }
});
ipcMain.on("music:show", (e, on) => { if (fromPage(e)) showMusic(!!on); });
ipcMain.on("music:hide", (e) => { if (music && !music.isDestroyed() && e.sender === music.webContents) showMusic(false); });
ipcMain.on("discord:show", (e, on) => { if (fromPage(e)) showDiscord(!!on); });
const fromWidget = (e) => discordWin && !discordWin.isDestroyed() && e.sender === discordWin.webContents;
ipcMain.handle("discord:state", (e) => (fromWidget(e) ? discordState() : null));
ipcMain.handle("discord:token", (e, token) => (fromWidget(e) ? setDiscordToken(token) : null));
ipcMain.handle("discord:lists", (e, guildId) => (fromWidget(e) ? discordLists(guildId) : null));
ipcMain.handle("discord:choose", (e, choice) => (fromWidget(e) ? chooseDiscord(choice) : null));
ipcMain.handle("discord:link", (e, id, open) => (fromWidget(e) ? useLink(id, open) : null));
ipcMain.on("discord:posts", (e, kind, on) => { if (fromWidget(e) && kind in dcfg.posts) { dcfg.posts[kind] = !!on; saveDiscord(); pushDiscord(); } });
ipcMain.handle("night:ask", (e, what, value) => (fromPage(e) ? nightAsk(what, value) : null));
ipcMain.handle("night:open", (e) => (fromPage(e) ? openNight() : false));
ipcMain.handle("discord:control-channel", (e) => (fromWidget(e) ? makeControlChannel() : null));
ipcMain.handle("discord:report-channel", (e) => (fromWidget(e) ? makeReportChannel() : null));
ipcMain.handle("discord:report", (e) => (fromWidget(e) ? report(true) : null));
ipcMain.on("discord:disconnect", (e) => { if (fromWidget(e)) disconnectDiscord(); });
ipcMain.on("discord:hide", (e) => { if (fromWidget(e)) showDiscord(false); });
ipcMain.on("player:ads", (e, on) => { if (fromPage(e)) setBlocking(on); });
ipcMain.on("player:mute", (e, on) => {  // silence for the user only: a recording made meanwhile keeps its sound
  if (!fromPage(e)) return;
  hushed = !!on;
  applySound();
  push();
});
ipcMain.on("player:loud", (e) => {
  if (fromPage(e) && cur && cur.player) cur.player.webContents.executeJavaScript(FULL_VOLUME, true).catch(() => {}).then(checkMedia);
});

ipcMain.on("rec:started", (e, info) => { const c = fromRecorder(e); if (c && c.rec.waiting) c.rec.waiting.resolve(info); });
ipcMain.on("rec:failed", (e, message) => {
  const c = fromRecorder(e);
  if (!c) return;
  if (c.rec.waiting) return c.rec.waiting.reject(new Error(message));
  if (c.rec.active) {  // the capture broke in the middle: keep what there is
    c.rec.active = false;
    c.rec.saving = true;
    c.rec.seconds = (Date.now() - c.rec.since) / 1000;
    finish(c);
  }
});
ipcMain.on("rec:chunk", (e, data) => { const c = fromRecorder(e); if (c && c.rec.out) c.rec.out.write(Buffer.from(data)); });
ipcMain.on("rec:stopped", (e) => { const c = fromRecorder(e); if (c && c.rec.saving) finish(c); });

// ---------------------------------------------------------------- the window

// ---------------------------------------------------------------- the self-check
// When Link opens, it tries each part it leans on once, quickly and all at the same time, and tells the
// page how each one did, so the user sees at a glance that everything came up ready (and what did not).
// Nothing here holds the window up: the window is already on screen, and each probe races a short
// timeout, so the whole check is over in about a second whatever the answers. A part the user has not
// set up yet (the Discord bot, a Kick app) is left out until they do.
const CHECK_CAP = 2500;   // the longest any one probe is waited for, in milliseconds

const raceTimeout = (promise, ms, fail) =>
  Promise.race([Promise.resolve(promise).catch(() => fail), new Promise((r) => setTimeout(() => r(fail), ms))]);

// Runs a command just to see it is there and answers; true when it ends without an error.
function toolResponds(tool) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      const p = spawn(tool, ["-version"], { windowsHide: true });
      p.on("error", () => done(false));
      p.on("close", (code) => done(code === 0));
    } catch (e) { done(false); }
  });
}

// The recording folder: that it is there and can be written to, and how much room is left on its disk.
async function folderCheck() {
  const folder = await recordingFolder();
  let writable = false, freeGB = null;
  const probe = path.join(folder, `.link-check-${process.pid}.tmp`);
  try { fs.writeFileSync(probe, "ok"); writable = true; } catch (e) { /* read-only or gone */ }
  fs.rm(probe, { force: true }, () => {});
  try { const s = fs.statfsSync(folder); freeGB = (s.bavail * s.bsize) / 1e9; } catch (e) { /* older runtime: room left unshown */ }
  return { writable, freeGB };
}

// A page on the internet that answers with nothing (no account, no data sent): just whether we are online.
async function internetUp() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1800);
  try {
    await fetch("https://www.google.com/generate_204", { cache: "no-store", signal: ctrl.signal });
    return true;
  } catch (e) { return false; } finally { clearTimeout(t); }
}

const kickLinked = async () => { try { return !!(await serverCall("/api/kick")).connected; } catch (e) { return false; } };

// The Discord bot signs in while Link opens, which takes a second or two: the check waits that long for
// it, so a bot that is only on its way is not shown as one that needs looking at.
async function botSettled() {
  const until = Date.now() + CHECK_CAP - 200;
  while (dcfg.token && bot && bot.state === "connecting" && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

async function runCheck() {
  const [server, ffmpeg, ffprobe, folder, online, blocker, kick] = await Promise.all([
    raceTimeout(serverCall("/api/status").then(() => true), CHECK_CAP, false),
    raceTimeout(toolResponds("ffmpeg"), CHECK_CAP, false),
    raceTimeout(toolResponds("ffprobe"), CHECK_CAP, false),
    raceTimeout(folderCheck(), CHECK_CAP, null),
    raceTimeout(internetUp(), 1900, false),
    raceTimeout(blockerReady.then(() => !!ads.engine), CHECK_CAP, !!ads.engine),
    raceTimeout(kickLinked(), CHECK_CAP, false),
    botSettled(),
  ]);
  const gb = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const items = [
    { key: "server", label: "Dashboard", ok: server, note: server ? "" : "not answering" },
    { key: "ffmpeg", label: "ffmpeg", ok: ffmpeg, note: ffmpeg ? "" : "not found — recordings cannot be saved" },
    { key: "ffprobe", label: "ffprobe", ok: ffprobe, note: ffprobe ? "" : "not found" },
  ];
  if (folder) {
    const low = folder.freeGB !== null && folder.freeGB < 5;   // under 5 GB is about an hour's recording left
    items.push({ key: "folder", label: "Recordings", ok: folder.writable, warn: folder.writable && low,
      note: !folder.writable ? "cannot write to the folder" : folder.freeGB === null ? "ready" : `${gb(folder.freeGB)} GB free${low ? " — running low" : ""}` });
  } else {
    items.push({ key: "folder", label: "Recordings", ok: false, note: "folder not ready" });
  }
  items.push({ key: "ads", label: "Ad blocker", ok: blocker, warn: !blocker && !ads.error,
    note: blocker ? "" : ads.error ? "lists did not load" : "still loading its lists" });
  items.push({ key: "net", label: "Internet", ok: online, note: online ? "" : "offline — streams will not load" });
  if (dcfg.token) items.push({ key: "discord", label: "Discord bot", ok: !!bot && bot.state === "online",
    warn: !!bot && bot.state === "connecting", note: bot ? (bot.state === "online" ? "connected" : bot.state) : "off" });
  if (kick) items.push({ key: "kick", label: "Kick API", ok: true, note: "linked" });
  return { at: Date.now(), items };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 620, title: "Link", icon: ICON,
    backgroundColor: "#000000",  // the start-up screen begins black, so the window never flashes white
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  const wc = win.webContents;
  // A monitor of a minimised stream: the page asked for one channel (channel:preview); only the picture.
  wc.session.setDisplayMediaRequestHandler((_request, callback) => {
    const c = previewing;
    previewing = null;
    if (!c || !c.player || c.player.webContents.isDestroyed()) return callback({});
    callback({ video: c.player.webContents.mainFrame });
  });
  wc.on("will-navigate", (event, target) => { if (!target.startsWith(DASHBOARD)) event.preventDefault(); });
  wc.setWindowOpenHandler((details) => {
    if (WEB.test(details.url)) shell.openExternal(details.url);
    return { action: "deny" };
  });
  wc.on("did-start-navigation", (_e, _url, inPlace, mainFrame) => {  // a reloading page has no place for the panel yet
    if (mainFrame && !inPlace) {
      slot = null;
      place();
      if (meters.page) {   // the page that showed the meters is gone
        meters.page = false;
        syncEngines();
      }
    }
  });
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5") { wc.reload(); event.preventDefault(); }
    if (input.key === "F12") { wc.toggleDevTools(); event.preventDefault(); }
  });
  setInterval(hearUpdate, 1500);
  const load = () => wc.loadURL(DASHBOARD).catch(() => setTimeout(load, 200));  // the server starts alongside the window
  load();
  wc.once("did-finish-load", () => { if (choices.musicOpen) showMusic(true); });  // open again if it was left open
  wc.once("did-finish-load", () => setTimeout(recoverRecordings, 6000));   // once the page listens for saved recordings
  win.on("close", (event) => {  // finish every file before the window goes
    if (channels.some((c) => c.rec.active || c.rec.saving)) {
      event.preventDefault();
      closing = closing || [];
      for (const c of recordingNow()) stopRecording(c);
    } else if (!closeAnswered && !closing) {
      event.preventDefault();
      askBeforeClosing();
    }
  });
  win.on("closed", () => {
    // Link Night goes when Link goes. It is told here that Link was closed on purpose (and not lost to a
    // crash, after which it opens Link again), and whether it was the night run itself that asked.
    try {
      const dir = path.join(HOME, ".link", "night");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "link-closed.json"), JSON.stringify({ at: Date.now(), forNight: closingForNight }));
    } catch (e) { /* the night run then takes it for a crash */ }
    win = null;
    app.quit();
  });
}

// Closing Link ends its server, and with it a video being processed or reels being rendered. That
// is safe (it is finished the next time Link opens), but minutes of work are done again, so Link asks.
async function askBeforeClosing() {
  let job = null;
  try { job = (await serverCall("/api/status")).job; } catch (e) { /* no server: nothing is running */ }
  if (job && job.running && job.kind !== "preview" && win && !win.isDestroyed()) {
    const what = job.kind === "render" ? "rendering reels" : "processing a video";
    const { response } = await dialog.showMessageBox(win, {
      type: "question", buttons: ["Keep Link open", "Close Link"], defaultId: 0, cancelId: 0, noLink: true,
      title: "Link is still working", message: `Link is still ${what}.`,
      detail: "If you close Link now, that stops. Nothing is lost: Link starts it again the next time it opens, from the beginning of the step it was in.",
    });
    if (response === 0) return;
  }
  closeAnswered = true;
  if (win && !win.isDestroyed()) win.close();
}

// The window was closed on a recording and every file is saved. With Auto-process on, the server
// notes them before the window goes, and Link processes them the next time it opens (ui/server.py,
// unfinished). Left to the page, that depended on whether the page was quick enough to start the
// job, which was then cut off a moment later with the server.
async function leave() {
  const files = closing || [];
  try {
    if (files.length && (await serverCall("/api/status")).auto) await serverCall("/api/unfinished", "POST", { files });
  } catch (e) { /* no server: the recordings wait under Process recording */ }
  if (win && !win.isDestroyed()) win.destroy();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (!win) return;
    // The night run asks Link to close, the way its own close button does (recordings are saved first, a
    // job that runs is asked about), so that it can open Link again in a way it can work it.
    if (argv.includes("--close-for-night")) { closingForNight = true; return win.close(); }
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    startBlocker();
    startBot();   // the user's Discord bot, if a token is saved
    setInterval(checkMedia, 2000);
  });
  app.on("window-all-closed", () => app.quit());
}
