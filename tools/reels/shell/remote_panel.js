"use strict";
// The owner's remote as buttons: one message in the control channel with a button for every command
// (main.js, "the owner's remote"). A button does what the command of that name does. A command that
// needs to be told something (which tape, which link) asks for it in a small form first (a Discord
// "modal"), and what is typed there goes on as the command's options.
//
// A button's id is "ctl:<command>" with the options it fixes after it ("ctl:rec:start"); a form's id
// is "ctlm:<command>". Rows are Discord "components": type 1 a row (five buttons, five rows at
// most), type 2 a button (style 1 blue, 2 grey, 3 green, 4 red), type 4 a line to type in.

const button = (id, emoji, label, style = 2) => ({ type: 2, style, custom_id: id, label, emoji: { name: emoji } });
const row = (...buttons) => ({ type: 1, components: buttons });
const field = (id, label, placeholder, required = true, long = false) =>
  ({ type: 1, components: [{ type: 4, custom_id: id, label, placeholder, required, style: long ? 2 : 1, max_length: long ? 300 : 200 }] });
const TAPE = field("tape", "Tape", "SRC-021, or just 21");

// The command a button stands for, with the options that button fixes. Null: the button opens a form.
const DIRECT = {
  "ctl:list": ["list", {}], "ctl:status": ["status", {}], "ctl:cancel": ["cancel", {}],
  "ctl:rec:start": ["rec", { action: "start" }], "ctl:rec:stop": ["rec", { action: "stop" }],
  "ctl:process": ["process", {}], "ctl:process:all": ["process", { all: true }],
};

// The forms: what is asked before the command can run.
const FORMS = {
  "ctl:tape": { custom_id: "ctlm:tape", title: "One tape", components: [TAPE] },
  "ctl:open": { custom_id: "ctlm:open", title: "Open a stream or a video", components: [field("link", "Link", "kick.com/channel, twitch.tv/channel or a video link")] },
  "ctl:reel": { custom_id: "ctlm:reel", title: "Make a reel and render it", components: [TAPE, field("moment", "Moment", "Its number in the tape's list, e.g. 1"),
    field("title", "Title (optional)", "The reel's title", false), field("hook", "Hook (optional)", "The line shown at the start", false, true)] },
  "ctl:render": { custom_id: "ctlm:render", title: "Render a tape's reels", components: [TAPE] },
  "ctl:auto": { custom_id: "ctlm:auto", title: "The whole way: link to rendered reels", components: [field("link", "Link", "kick.com/channel, twitch.tv/channel or a video link"),
    field("minutes", "Minutes to record", "1 to 180"), field("reels", "Reels to make (optional)", "1 to 5, default 3", false)] },
};

// The remote: a card that says what each button does, and the buttons.
function controlPanel() {
  return {
    embeds: [{
      color: 0x9fd8c8, title: "🕹 Link remote",
      description: "Every command as a button. One that needs a tape or a link asks for it first.",
      fields: [
        { name: "Look", value: "**List tapes** every tape · **Tape** one tape's moments and reels · **Status** what Link is doing" },
        { name: "Record", value: "**Open** a stream or a video · **Record** / **Stop** the recording · **Process** makes a tape of a recording that waits" },
        { name: "Reels", value: "**Reel** one moment of a tape, rendered · **Render** a tape's reels · **Auto** the whole way from a link · **Cancel auto**" },
      ],
      footer: { text: "Only you can press these. The answer comes in this channel." },
    }],
    components: [
      row(button("ctl:list", "📼", "List tapes"), button("ctl:tape", "🔎", "Tape"), button("ctl:status", "📡", "Status")),
      row(button("ctl:open", "▶", "Open", 1), button("ctl:rec:start", "🔴", "Record", 3), button("ctl:rec:stop", "⏹", "Stop", 4)),
      row(button("ctl:process", "⚙", "Process newest"), button("ctl:process:all", "🗂", "Process all")),
      row(button("ctl:reel", "🎬", "Reel"), button("ctl:render", "🎞", "Render")),
      row(button("ctl:auto", "🚀", "Auto", 1), button("ctl:cancel", "✖", "Cancel auto"), button("night:panel", "🌙", "Night remote")),
    ],
  };
}

// What was typed into a form, as the command's name and options; an error in words when it cannot be used.
function fromForm(data) {
  const name = String(data.custom_id || "").slice(5);
  const typed = Object.fromEntries((data.components || []).flatMap((r) => r.components || []).map((c) => [c.custom_id, String(c.value || "").trim()]).filter(([, v]) => v));
  if (!FORMS[`ctl:${name}`]) return { error: "That form is not known to this Link." };
  if (name === "reel" && !(Number(typed.moment) >= 1)) return { error: "The moment is its number in the tape's list, e.g. 1." };
  if (name === "auto") {
    if (!(Number(typed.minutes) >= 1 && Number(typed.minutes) <= 180)) return { error: "Minutes to record: a number from 1 to 180." };
    if (typed.reels && !(Number(typed.reels) >= 1 && Number(typed.reels) <= 5)) return { error: "Reels to make: a number from 1 to 5." };
  }
  for (const key of ["moment", "minutes", "reels"]) if (typed[key]) typed[key] = Math.round(Number(typed[key]));
  return { name, options: typed };
}

module.exports = { DIRECT, FORMS, controlPanel, fromForm };
