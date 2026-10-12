"use strict";
// Post an announcement in the server's announcements channel, as Link's bot.
//
//   node tools/reels/shell/announce.js <announcement.json> [picture ...]
//
// The announcement is a file: {"title", "text", "fields": [{"name", "value", "inline"}], "footer", "color",
// "pictures": [{"title", "text", "alt"}]}. It goes out as one message: a card with the first picture
// inside it, and for each further picture a small card under it with that picture's title and line from
// "pictures" (in the order the pictures are given; "alt" is what a screen reader says for it).
// With "gallery": true the further pictures are one grid under the card instead, four to a grid.
// The announcement just posted becomes the channel's pinned one, in place of the one before it.
//
//   node tools/reels/shell/announce.js --pin      pin the newest announcement that is there already The channel is the one whose
// name ends in "announcements"; when there is none it is made, at the top of the first category,
// readable by everyone and written in by the bot alone (the bot needs Manage Channels for that).
// An announcement is public: it is posted only when the user has said that an update is to be announced.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DiscordBot } = require("./discord");

const POSTING = 1024 + 2048 + 16384 + 32768;   // view channels, send messages, embed links, attach files
const WRITING = String((1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n));   // writing, threads and writing in threads: closed for everyone else

async function channel(bot, guild) {
  const all = await bot.api("GET", `/guilds/${guild}/channels`);
  const have = all.find((c) => c.type === 0 && /announcements$/.test(c.name));
  if (have) return have;
  const general = all.find((c) => c.type === 0 && /general$/.test(c.name));
  const made = await bot.api("POST", `/guilds/${guild}/channels`, {
    name: "📢・announcements", type: 0, topic: "Every major update of Link. Only Link writes here.",
    ...(general && general.parent_id ? { parent_id: general.parent_id } : {}),
    permission_overwrites: [{ id: guild, type: 0, allow: "0", deny: WRITING }, { id: bot.user.id, type: 1, allow: String(POSTING), deny: "0" }],
  });
  // above the others of its category
  const beside = all.filter((c) => c.type === 0 && c.parent_id === made.parent_id).sort((a, b) => a.position - b.position);
  await bot.api("PATCH", `/guilds/${guild}/channels`, [{ id: made.id, position: 0 }, ...beside.map((c, i) => ({ id: c.id, position: i + 1 }))]);
  return made;
}

// The newest announcement is the pinned one: it is pinned, the bot's earlier announcements are unpinned,
// and the "pinned a message" lines that leaves in the channel are taken away. Pinning needs the bot to
// have Manage Messages (or Pin Messages) in the channel; without it the post stands unpinned, and this says so.
async function pinNewest(bot, channelId, messageId) {
  try {
    await bot.api("PUT", `/channels/${channelId}/pins/${messageId}`);
  } catch (e) {
    return "not pinned: the bot may not pin here. In Discord: Server Settings > Roles > the bot's role > turn on Manage Messages (or Pin Messages), then run:  node tools/reels/shell/announce.js --pin";
  }
  let said = "pinned";
  try {
    const pins = await bot.api("GET", `/channels/${channelId}/pins`);
    const older = pins.filter((p) => p.id !== messageId && p.author && p.author.id === bot.user.id);
    for (const p of older) await bot.api("DELETE", `/channels/${channelId}/pins/${p.id}`);
    if (older.length) said += `; ${older.length} earlier announcement${older.length === 1 ? "" : "s"} unpinned`;
    const recent = await bot.api("GET", `/channels/${channelId}/messages?limit=20`);
    for (const m of recent.filter((x) => x.type === 6)) await bot.api("DELETE", `/channels/${channelId}/messages/${m.id}`).catch(() => {});
  } catch (e) { said += ` (tidying up after it did not finish: ${e.message})`; }
  return said;
}

(async () => {
  if (process.argv[2] === "--pin") {   // pin the newest announcement that is there: for after the bot was given the right to
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".link", "discord.json"), "utf8"));
    const bot = new DiscordBot(cfg.token);
    bot.user = await bot.api("GET", "/users/@me");
    const where = await channel(bot, cfg.guildId);
    const newest = (await bot.api("GET", `/channels/${where.id}/messages?limit=30`)).find((m) => m.author.id === bot.user.id && m.type === 0);
    if (!newest) throw new Error("There is no announcement to pin.");
    return console.log(`${(newest.embeds[0] || {}).title || "the newest announcement"}: ${await pinNewest(bot, where.id, newest.id)}`);
  }
  const [file, ...pictures] = process.argv.slice(2);
  if (!file) throw new Error("Give the announcement's file: node announce.js <announcement.json> [picture ...]");
  if (pictures.length > 9) throw new Error("At most nine pictures fit in one announcement.");
  const a = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".link", "discord.json"), "utf8"));
  if (!cfg.token || !cfg.guildId) throw new Error("Link's Discord bot is not set up.");
  const bot = new DiscordBot(cfg.token);
  bot.user = await bot.api("GET", "/users/@me");
  const where = await channel(bot, cfg.guildId);
  const colour = a.color ?? 0xf2c744, said = a.pictures || [];
  const names = pictures.map((p, i) => `${i + 1}${path.extname(p).toLowerCase() || ".png"}`);   // plain names: Discord finds an attached picture by its name
  // The first picture sits inside the announcement's own card. Each further one has a small card of its
  // own under it, with what "pictures" in the file says about it; the footer goes under the last card.
  const cards = [{ color: colour, title: String(a.title).slice(0, 250), description: String(a.text || "").slice(0, 3500),
    fields: (a.fields || []).slice(0, 10).map((f) => ({ name: String(f.name).slice(0, 250), value: String(f.value).slice(0, 1020), inline: !!f.inline })),
    ...(names[0] ? { image: { url: `attachment://${names[0]}` } } : {}) },
    // "gallery": the further pictures as one grid of up to four under the card (Discord draws cards that
    // share a link as one card with all their pictures); without it each has a small card with its title and line.
    ...names.slice(1).map((name, i) => (a.gallery
      ? { color: colour, url: `https://discord.com/channels/${cfg.guildId}/${where.id}?grid=${Math.floor(i / 4)}`, image: { url: `attachment://${name}` } }
      : { color: colour, title: (said[i + 1] || {}).title ? String(said[i + 1].title).slice(0, 250) : undefined,
          description: (said[i + 1] || {}).text ? String(said[i + 1].text).slice(0, 1000) : undefined, image: { url: `attachment://${name}` } }))];
  // in a grid only its first card's words are shown, so the footer goes there
  Object.assign(cards[a.gallery && cards.length > 1 ? 1 : cards.length - 1], { footer: a.footer ? { text: String(a.footer).slice(0, 500) } : undefined, timestamp: new Date().toISOString() });
  // One message with all its pictures: the JSON part and each file go as a form. "description" is what a
  // screen reader says for the picture.
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ embeds: cards, allowed_mentions: { parse: [] },
    attachments: names.map((name, i) => ({ id: i, filename: name, description: String((said[i] || {}).alt || (said[i] || {}).title || a.title).slice(0, 1000) })) }));
  pictures.forEach((p, i) => form.append(`files[${i}]`, new Blob([fs.readFileSync(p)]), names[i]));
  const res = await fetch(`https://discord.com/api/v10/channels/${where.id}/messages`, { method: "POST", headers: { Authorization: `Bot ${cfg.token}` }, body: form });
  const sent = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(sent.message ? `Discord: ${sent.message} ${JSON.stringify(sent.errors || "")}`.slice(0, 600) : `Discord answered ${res.status}.`);
  console.log(`posted in #${where.name}: https://discord.com/channels/${cfg.guildId}/${where.id}/${sent.id}`);
  console.log(await pinNewest(bot, where.id, sent.id));
})().catch((e) => { console.error(e.message); process.exit(1); });
