"use strict";
// The hidden recorder page's line to main.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rec", {
  onStart: (listener) => ipcRenderer.on("rec:start", (_event, options) => listener(options)),
  onStop: (listener) => ipcRenderer.on("rec:stop", () => listener()),
  started: (info) => ipcRenderer.send("rec:started", info),
  failed: (message) => ipcRenderer.send("rec:failed", message),
  chunk: (data) => ipcRenderer.send("rec:chunk", data),
  stopped: () => ipcRenderer.send("rec:stopped"),
  // the sound: what the mixer is set to, the level it measures, and whether it is in use
  onAudio: (listener) => ipcRenderer.on("audio:set", (_event, settings) => listener(settings)),
  level: (level) => ipcRenderer.send("audio:level", level),
  engine: (info) => ipcRenderer.send("audio:engine", info),
});
