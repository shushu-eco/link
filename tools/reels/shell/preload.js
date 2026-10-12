"use strict";
// What the dashboard page may ask of Link's window; see main.js for what each call does.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("linkShell", {
  state: () => ipcRenderer.invoke("shell:state"),
  selfCheck: () => ipcRenderer.invoke("shell:selfcheck"),   // how each part of Link came up, for the start-up card
  onState: (listener) => ipcRenderer.on("shell:state", (_event, state) => listener(state)),
  copy: (text) => ipcRenderer.invoke("shell:copy", text),
  pick: () => ipcRenderer.invoke("shell:pick"),
  open: (url, kind) => ipcRenderer.invoke("player:open", url, kind),   // kind: "stream" (Studio) or "video" (URL)
  view: (kind) => ipcRenderer.send("player:view", kind),
  bounds: (rect) => ipcRenderer.send("player:bounds", rect),
  nav: (action) => ipcRenderer.send("player:nav", action),
  close: () => ipcRenderer.send("player:close"),
  loud: () => ipcRenderer.send("player:loud"),
  ads: (on) => ipcRenderer.send("player:ads", on),
  mute: (on) => ipcRenderer.send("player:mute", on),
  record: () => ipcRenderer.invoke("rec:start"),
  stop: () => ipcRenderer.invoke("rec:stop"),
  mark: (id) => ipcRenderer.invoke("rec:mark", id),
  // the channels: streams recorded side by side, the minimised ones shown as pills
  show: (id) => ipcRenderer.send("channel:show", id),
  minimise: () => ipcRenderer.invoke("channel:minimise"),
  stopChannel: (id) => ipcRenderer.invoke("channel:stop", id),
  closeChannel: (id) => ipcRenderer.send("channel:close", id),
  // a live picture of channel id: call this, then getDisplayMedia({ video: true }) (see the monitors in app.js)
  preview: (id) => ipcRenderer.invoke("channel:preview", id),
  music: (on) => ipcRenderer.send("music:show", on),
  // the sound: the mixer's window, and its settings for Settings > Audio (see "the sound" in main.js)
  audioPanel: (on) => ipcRenderer.send("audio:show", on),
  audio: {
    set: (patch) => ipcRenderer.send("mix:set", patch),
    mic: (patch) => ipcRenderer.send("mix:mic", patch),
    channel: (id, patch) => ipcRenderer.send("mix:channel", id, patch),
    loud: (id) => ipcRenderer.send("mix:loud", id),
    hush: (on) => ipcRenderer.send("mix:hush", on),
    music: () => ipcRenderer.send("mix:music"),
    watch: (on) => ipcRenderer.send("mix:watch", on),
    onLevels: (listener) => ipcRenderer.on("mix:levels", (_event, levels) => listener(levels)),
  },
  quality: (mbit) => ipcRenderer.send("rec:quality", mbit),
  about: () => ipcRenderer.invoke("shell:about"),
  reveal: (which) => ipcRenderer.invoke("shell:reveal", which),
  onSettings: (listener) => ipcRenderer.on("shell:settings", (_event, section) => listener(section)),   // the mixer's window asked for the big settings
  discord: (on) => ipcRenderer.send("discord:show", on),
  nightOpen: () => ipcRenderer.invoke("night:open"),   // the Night window (Settings > General)
  night: (what, value) => ipcRenderer.invoke("night:ask", what, value),   // the night run: "channel" (its Discord channel), "relay" (the chat relay on or off)
  onStudio: (listener) => ipcRenderer.on("shell:studio", (_event, url, kind) => listener(url, kind)),   // a link opened from the Discord widget
});
