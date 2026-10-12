"use strict";
// The user's own Discord bot, run by Link's window while it is open (see main.js, "the Discord bot").
//
// It keeps one connection to Discord's Gateway (Discord's live link to a bot), which brings the slash
// commands people use, and talks to Discord's REST API to answer them and post in a channel. It asks
// for no privileged intents and never reads messages: a slash command arrives on its own.
//
//   const bot = new DiscordBot(token, { onCommand, onButton, onState })
//   bot.start() / bot.stop()
//   bot.api(method, path, body)                 a REST call; JSON in and out
//   bot.post(channelId, content, file, quiet)   a message, with one file if given (quiet: no link previews)
//   bot.message(channelId, body)                any message, e.g. { embeds: [...] }
//   bot.defer(interaction) / bot.edit(interaction, body)   a slow command: "thinking…", then its answer
//   bot.reply(interaction, content, { quiet })  the answer to a slash command (quiet: only its sender sees it)
//   bot.register(guildId)                       the commands, on that server only
const fs = require("fs");
const path = require("path");

const API = process.env.LINK_DISCORD_API || "https://discord.com/api/v10";   // the variable is for tests
const GATEWAY = process.env.LINK_DISCORD_GATEWAY || "wss://gateway.discord.gg/?v=10&encoding=json";

// The owner's remote: these run Link itself. Discord shows them only to the server's administrators
// (default_member_permissions "0"), and main.js answers them only for the owner, in the control channel.
const TAPE = { type: 3, name: "tape", description: "The tape, e.g. SRC-021 or just 21", required: true };
const OWNER_COMMANDS = [
  { name: "list", description: "Every tape in Link: length, moments, reels" },
  { name: "tape", description: "One tape: its best moments and its reels", options: [TAPE] },
  { name: "open", description: "Open a stream or a video in Link", options: [{ type: 3, name: "link", description: "kick.com/channel, twitch.tv/channel or a video link", required: true }] },
  { name: "rec", description: "Start or stop recording", options: [
    { type: 3, name: "action", description: "start or stop", required: true, choices: [{ name: "start", value: "start" }, { name: "stop", value: "stop" }] },
    { type: 3, name: "stream", description: "Which one, by name. Default: start the one on screen, stop all" }] },
  { name: "process", description: "Make a tape of the newest recording that waits", options: [
    { type: 5, name: "all", description: "Every recording that waits, not just the newest" }] },
  { name: "reel", description: "Make a reel from one moment of a tape and render it", options: [TAPE,
    { type: 4, name: "moment", description: "Its number in /tape, e.g. 1 for #1", required: true, min_value: 1 },
    { type: 3, name: "title", description: "The reel's title" }, { type: 3, name: "hook", description: "The line shown at the start" }] },
  { name: "render", description: "Render the reels of a tape that are not rendered yet", options: [TAPE] },
  { name: "auto", description: "The whole way: open, record, process, make reels, render", options: [
    { type: 3, name: "link", description: "kick.com/channel, twitch.tv/channel or a video link", required: true },
    { type: 4, name: "minutes", description: "How long to record", required: true, min_value: 1, max_value: 180 },
    { type: 4, name: "reels", description: "How many reels to make from the best moments (default 3)", min_value: 1, max_value: 5 }] },
  { name: "cancel", description: "Stop the /auto that is running (what was recorded is kept)" },
  { name: "remote", description: "Every command as a button" },
].map((c) => ({ ...c, default_member_permissions: "0" }));

// The night run's remote (tools/reels/night): the owner alone, in the night channel. main.js hands each
// to the Night window's program, which does it and says how it went in that channel.
// The night's choices, the same as the boxes in the Night window; one that is given is kept from then on.
const NIGHT_HOURS = { type: 4, name: "hours", description: "How many hours to collect (default: as last set)", min_value: 1, max_value: 12 };
const NIGHT_CHOICES = [
  { type: 4, name: "streams", description: "How many streams are recorded side by side (1 to 3)", min_value: 1, max_value: 3 },
  { type: 5, name: "shooters_only", description: "All three streams are shooters (off: the third is another popular game)" },
  { type: 5, name: "log_chat", description: "Relay the streams' chat to #chat during the night" },
  { type: 5, name: "carry_on", description: "Carry on by itself after an interruption, three times at most" },
  { type: 5, name: "updates", description: "Post updates and the picture every 25 minutes here" },
  { type: 5, name: "sleep_after", description: "When the night is done: close Link and put the PC to sleep" },
];
const NIGHT_COMMANDS = [
  { name: "night", description: "Start a night run, or show how the running one stands", options: [NIGHT_HOURS, ...NIGHT_CHOICES] },
  { name: "nightset", description: "Show the night run's settings, or change them without starting", options: [NIGHT_HOURS, ...NIGHT_CHOICES] },
  { name: "continue", description: "Carry on a night run that was interrupted, until the time it was to end" },
  { name: "retry", description: "Start the night run again from the beginning", options: [{ ...NIGHT_HOURS, description: "How many hours this time (default: as many as it had)" }] },
  { name: "nightstop", description: "End the night run: what records now is saved and made into tapes first" },
].map((c) => ({ ...c, default_member_permissions: "0" }));

// What the bot answers to. Options are typed as Discord defines them (3 = text).
const COMMANDS = [
  { name: "record", description: "Send a stream or video link to Link", options: [{ type: 3, name: "link", description: "The link, e.g. kick.com/channel or twitch.tv/channel", required: true }] },
  { name: "clip", description: "Mark this moment as a highlight while Link is recording" },
  { name: "status", description: "What Link is doing right now" },
  { name: "refresh", description: "The Instagram and YouTube channels' numbers, read right now" },
  ...OWNER_COMMANDS,
  ...NIGHT_COMMANDS,
];

class DiscordError extends Error {}

class DiscordBot {
  constructor(token, { onCommand = () => {}, onButton = () => {}, onState = () => {} } = {}) {
    this.token = token;
    this.onCommand = onCommand;
    this.onButton = onButton;
    this.onState = onState;
    this.state = "off";        // off | connecting | online | error
    this.error = "";
    this.user = null;          // the bot's own account
    this.appId = null;
    this.ws = null;
    this.seq = null;
    this.session = null;       // to resume after a dropped connection
    this.resumeUrl = null;
    this.beat = null;
    this.acked = true;
    this.retry = 0;
    this.stopped = true;
  }

  set(state, error = "") {
    this.state = state;
    this.error = error;
    this.onState(this);
  }

  async api(method, route, body, file) {
    const headers = { Authorization: `Bot ${this.token}`, "User-Agent": "DiscordBot (https://github.com, 1.0) Link" };
    let payload;
    if (file) {   // a message with a file: the JSON part and the file go as a form
      payload = new FormData();
      payload.append("payload_json", JSON.stringify(body || {}));
      payload.append("files[0]", new Blob([fs.readFileSync(file)]), path.basename(file));
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(API + route, { method, headers, body: payload });
      if (res.status === 429) {   // too fast: Discord says how long to wait
        const wait = Number((await res.json().catch(() => ({}))).retry_after || 1);
        await new Promise((r) => setTimeout(r, Math.min(10, wait) * 1000 + 100));
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (res.status === 401) throw new DiscordError("Discord does not accept that bot token. Copy it again from the Developer Portal (Bot > Reset Token).");
      if (res.status === 403) throw new DiscordError("The bot is not allowed to do that here. Check its permissions on the server and in the channel.");
      if (!res.ok) throw new DiscordError((data && data.message) || `Discord answered ${res.status}.`);
      return data;
    }
    throw new DiscordError("Discord kept saying to slow down. Try again in a minute.");
  }

  post(channelId, content, file, quiet = false) {
    return this.api("POST", `/channels/${channelId}/messages`, { content, allowed_mentions: { parse: [] }, ...(quiet ? { flags: 4 } : {}) }, file);
  }

  message(channelId, body) {
    return this.api("POST", `/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...body });
  }

  reply(interaction, content, { quiet = false } = {}) {
    return this.api("POST", `/interactions/${interaction.id}/${interaction.token}/callback`,
      { type: 4, data: { content, flags: quiet ? 64 : 0, allowed_mentions: { parse: [] } } });
  }

  // A pressed button answered by changing the message it sits under (its card and its buttons).
  update(interaction, body) {
    return this.api("POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 7, data: { allowed_mentions: { parse: [] }, ...body } });
  }

  // A pressed button answered with a small form to fill in (a modal: {custom_id, title, components}).
  form(interaction, modal) {
    return this.api("POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 9, data: modal });
  }

  // "Link is thinking…": for a command whose answer takes longer than the three seconds Discord allows.
  defer(interaction) {
    return this.api("POST", `/interactions/${interaction.id}/${interaction.token}/callback`, { type: 5 });
  }

  // The answer to a deferred command (it replaces "thinking…").
  edit(interaction, body) {
    return this.api("PATCH", `/webhooks/${this.appId}/${interaction.token}/messages/@original`, { allowed_mentions: { parse: [] }, ...body });
  }

  register(guildId) {
    return this.api("PUT", `/applications/${this.appId}/guilds/${guildId}/commands`, COMMANDS);
  }

  async start() {
    this.stopped = false;
    this.set("connecting");
    try {
      this.user = await this.api("GET", "/users/@me");
      this.appId = (await this.api("GET", "/oauth2/applications/@me")).id;
    } catch (e) {
      return this.set("error", e.message);
    }
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.beat);
    if (this.ws) try { this.ws.close(1000); } catch (e) { /* already closed */ }
    this.ws = null;
    this.set("off");
  }

  send(op, d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d }));
  }

  connect() {
    if (this.stopped) return;
    const resuming = !!(this.session && this.resumeUrl);
    const ws = new WebSocket(resuming ? `${this.resumeUrl}/?v=10&encoding=json` : GATEWAY);
    this.ws = ws;
    ws.onmessage = (m) => this.receive(JSON.parse(m.data), resuming);
    ws.onclose = (e) => {
      clearInterval(this.beat);
      if (this.stopped || this.ws !== ws) return;
      // 4004 is a wrong token, 4013/4014 bad intents: trying again would not help.
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(e.code)) return this.set("error", e.code === 4004 ? "Discord does not accept that bot token." : `Discord closed the connection (${e.code}).`);
      if ([4007, 4009].includes(e.code)) this.session = null;   // the session cannot be resumed; start a new one
      this.set("connecting");
      const wait = Math.min(30, 2 ** this.retry++) * 1000;
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => { /* onclose follows and decides what to do */ };
  }

  receive(msg, resuming) {
    if (msg.s != null) this.seq = msg.s;
    if (msg.op === 10) {   // hello: start beating, then say who we are (or carry on where we were)
      clearInterval(this.beat);
      this.acked = true;
      this.beat = setInterval(() => {
        if (!this.acked) return this.ws && this.ws.close(4000);   // no answer to the last beat: a dead line, reconnect
        this.acked = false;
        this.send(1, this.seq);
      }, msg.d.heartbeat_interval);
      if (resuming) this.send(6, { token: this.token, session_id: this.session, seq: this.seq });
      else this.send(2, { token: this.token, intents: 0, properties: { os: process.platform, browser: "link", device: "link" } });
    } else if (msg.op === 11) {
      this.acked = true;
    } else if (msg.op === 1) {
      this.send(1, this.seq);
    } else if (msg.op === 7) {   // Discord asks for a reconnect
      this.ws.close(4000);
    } else if (msg.op === 9) {   // the session is gone; a fresh one after a short wait, as Discord asks
      this.session = msg.d ? this.session : null;
      setTimeout(() => this.ws && this.ws.close(4000), 1500);
    } else if (msg.op === 0) {
      if (msg.t === "READY") {
        this.session = msg.d.session_id;
        this.resumeUrl = msg.d.resume_gateway_url;
        this.retry = 0;
        this.set("online");
      } else if (msg.t === "RESUMED") {
        this.retry = 0;
        this.set("online");
      } else if (msg.t === "INTERACTION_CREATE" && msg.d.type === 2) {
        Promise.resolve(this.onCommand(msg.d)).catch(() => {});
      } else if (msg.t === "INTERACTION_CREATE" && (msg.d.type === 3 || msg.d.type === 5)) {   // a button under one of the bot's messages, or a form it opened, filled in
        Promise.resolve(this.onButton(msg.d)).catch(() => {});
      }
    }
  }
}

module.exports = { DiscordBot, DiscordError, COMMANDS, OWNER_COMMANDS, NIGHT_COMMANDS };
