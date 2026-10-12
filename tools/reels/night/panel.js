// The night run's choices and its buttons in Discord, shared by the two programs that need them:
// the Night window's program (main.js here), which posts the cards, and Link's window
// (shell/main.js), whose bot hears a button being pressed.
//
// A button's id says what it does: night:start, night:stop, night:continue, night:retry,
// night:status, night:awake, night:panel, night:hours:-1, night:hours:+1, night:toggle:<choice>.
// Rows of buttons are Discord "components": type 1 is a row (five buttons at most, five rows at
// most), type 2 a button; style 1 blue, 2 grey, 3 green, 4 red.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA = path.join(os.homedir(), ".link", "night");
const OPTIONS = path.join(DATA, "options.json"), PLAN = path.join(DATA, "plan.json");
// relayChat: the streams' chat goes to Discord #chat during the night; shootersOnly: all three
// streams are shooters; discord: updates and pictures go to #night; autoContinue: an interrupted
// night is carried on by itself (three times at most); sleepAfter: when the night is done, Link is
// closed and the PC put to sleep. Beside those: hours (1 to 12), streams (how many are recorded side by
// side, 1 to 3) and prefer (games, by their name on Kick, that are taken first when they are live).
const CHOICES = ["relayChat", "shootersOnly", "discord", "autoContinue", "sleepAfter"];
const LABELS = { shootersOnly: ["🎯", "Shooters only"], relayChat: ["💬", "Log live chat"], autoContinue: ["↪", "Carry on by itself"], discord: ["🔔", "Updates here"], sleepAfter: ["💤", "Sleep PC when done"] };

const USAGE = path.join(DATA, "usage.json");
const STREAMS = 3;          // streams a night records side by side, at most (Link's Studio holds three)
const RECORDING = 0.77;     // the share of a night that is recording: 30 minutes of every 39 or so, the rest is making tapes
const RATE = 0.9;           // GB an hour of one stream takes, until this PC's own nights have measured it
const KEEP_FREE = 25;       // GB: a night stops by itself with less than this free (MIN_FREE_GB in driver.js)

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
function writeJson(file, data) {   // whole or not there
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file + ".part", JSON.stringify(data, null, 1));
  fs.renameSync(file + ".part", file);
}

const options = () => ({ hours: 5, relayChat: false, shootersOnly: false, discord: true, autoContinue: false, sleepAfter: false, streams: STREAMS, prefer: [], ...(readJson(OPTIONS) || {}) });
function setOptions(change) {   // from the window's boxes, a Discord command, or a button
  const o = options();
  for (const key of CHOICES) if (change && typeof change[key] === "boolean") o[key] = change[key];
  if (change && Number(change.hours)) o.hours = Math.min(12, Math.max(1, Math.round(Number(change.hours))));
  if (change && Number(change.streams)) o.streams = Math.min(STREAMS, Math.max(1, Math.round(Number(change.streams))));
  if (change && Array.isArray(change.prefer)) o.prefer = change.prefer.map((x) => String(x).slice(0, 60)).slice(0, 6);
  writeJson(OPTIONS, o);
  return o;
}

// How much room a night of so many hours takes, roughly: {gb, streamHours, measured, freeGb, fits}.
// By what this PC's own nights measured (usage.json: the megabytes and seconds of every recording a
// night made, added up by driver.js), or by a usual figure until there is a night to go by.
function estimate(hours, streams = options().streams) {
  const u = readJson(USAGE) || {};
  const measured = u.seconds > 1800 && u.mb > 0;
  const rate = measured ? (u.mb / 1024) / (u.seconds / 3600) : RATE;
  const streamHours = hours * streams * RECORDING, gb = streamHours * rate;
  let freeGb = null;
  try { const d = fs.statfsSync(os.homedir()); freeGb = (d.bavail * d.bsize) / 2 ** 30; } catch { /* not known */ }
  const round = (n) => Math.round(n * 10) / 10;
  return { gb: round(gb), streamHours: round(streamHours), measured, freeGb: freeGb == null ? null : round(freeGb), fits: freeGb == null || freeGb - gb >= KEEP_FREE };
}
// The same, as a sentence.
function estimateSaid(hours, streams = options().streams) {
  const e = estimate(hours, streams);
  return `About ${e.gb} GB for ${hours} hour${hours === 1 ? "" : "s"} (${e.streamHours} h of streams${e.measured ? ", by what your nights have measured" : ""})`
    + (e.freeGb == null ? "." : `; ${e.freeGb} GB are free.`) + (e.fits ? "" : ` That is too much: a night stops when less than ${KEEP_FREE} GB are free.`);
}
// What the recordings of a night came to, added to what earlier nights measured.
function addUsage(mb, seconds) {
  if (!(mb > 0 && seconds > 0)) return;
  const u = readJson(USAGE) || {};
  writeJson(USAGE, { mb: Math.round((u.mb || 0) + mb), seconds: Math.round((u.seconds || 0) + seconds), nights: (u.nights || 0) + 1 });
}

const button = (id, emoji, label, style = 2, disabled = false) => ({ type: 2, style, custom_id: id, label, emoji: { name: emoji }, disabled });
const row = (...buttons) => ({ type: 1, components: buttons });

// The buttons under a card, by what the card is about.
function buttons(kind) {
  if (kind === "interrupted") return [row(button("night:continue", "↪", "Continue", 3), button("night:retry", "🔁", "Start over"), button("night:panel", "⚙", "Settings"))];
  if (kind === "start" || kind === "running") return [row(button("night:status", "📸", "Status"), button("night:stop", "⏹", "Stop", 4), button("night:panel", "⚙", "Settings"))];
  if (kind === "sleep") return [row(button("night:awake", "☕", "Stay awake", 1))];
  if (kind === "end") return [row(button("night:start", "🌙", "Start night", 3), button("night:panel", "⚙", "Settings"))];
  return [];
}

// The remote: how the night stands, its settings, and a button for everything, as a message's body.
function panel() {
  const o = options(), p = readJson(PLAN) || {}, onOff = (v) => (v ? "On" : "Off");
  const live = p.state === "running", cut = p.state === "interrupted";
  const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const toggle = (key) => button(`night:toggle:${key}`, LABELS[key][0], `${LABELS[key][1]}: ${onOff(o[key])}`, o[key] ? 3 : 2);
  return {
    embeds: [{
      color: live ? 0x4ade80 : cut ? 0xff5d5d : 0x9fd8c8, title: "🌙 Link Night remote",
      description: live ? `A night is running until **${clock(p.end)}**.` : cut ? `A night was interrupted: ${p.why || "see above"}. It was to end at **${clock(p.end)}**.` : "No night is running.",
      fields: [{ name: "Hours", value: String(o.hours), inline: true }, { name: "Streams", value: String(o.streams), inline: true }, ...CHOICES.map((key) => ({ name: LABELS[key][1], value: onOff(o[key]), inline: true })),
        { name: "Room it takes", value: estimateSaid(o.hours) }],
      footer: { text: live ? "A night that runs keeps the hours, shooters and chat it began with." : "Press a button. The answer comes in this channel." },
    }],
    components: [
      row(button("night:start", "🌙", live ? "Night is running" : "Start night", 3, live), button("night:stop", "⏹", "Stop", 4, !live), button("night:status", "📸", "Status", 2, !live)),
      row(button("night:continue", "↪", "Continue", 1, !cut), button("night:retry", "🔁", "Start over", 2, live || !p.hours)),
      row(button("night:hours:-1", "➖", "Hour", 2, o.hours <= 1), button("night:hours:0", "⏱", `${o.hours} hours`, 2, true), button("night:hours:+1", "➕", "Hour", 2, o.hours >= 12),
        button("night:streams", "📺", `${o.streams} stream${o.streams === 1 ? "" : "s"}`, 2, live)),
      row(toggle("shootersOnly"), toggle("relayChat")),
      row(toggle("autoContinue"), toggle("discord"), toggle("sleepAfter")),
    ],
  };
}

// What a pressed button changes in the choices, done here; true when the id was one of those.
function press(id) {
  const [, what, value] = String(id).split(":");
  if (what === "hours") { setOptions({ hours: options().hours + Number(value) }); return true; }
  if (what === "streams") { setOptions({ streams: (options().streams % STREAMS) + 1 }); return true; }   // 1, 2, 3 and round again
  if (what === "toggle" && CHOICES.includes(value)) { setOptions({ [value]: !options()[value] }); return true; }
  return false;
}

module.exports = { DATA, CHOICES, options, setOptions, buttons, panel, press, estimate, estimateSaid, addUsage };
