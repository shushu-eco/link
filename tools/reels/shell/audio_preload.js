"use strict";
// What the mixer's window (ui/static/audio.html) may ask of Link's window; see "the sound" in main.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("linkAudio", {
  state: () => ipcRenderer.invoke("mix:state"),
  onState: (listener) => ipcRenderer.on("mix:state", (_event, state) => listener(state)),
  onLevels: (listener) => ipcRenderer.on("mix:levels", (_event, levels) => listener(levels)),
  set: (patch) => ipcRenderer.send("mix:set", patch),
  mic: (patch) => ipcRenderer.send("mix:mic", patch),
  channel: (id, patch) => ipcRenderer.send("mix:channel", id, patch),
  loud: (id) => ipcRenderer.send("mix:loud", id),
  hush: (on) => ipcRenderer.send("mix:hush", on),
  music: () => ipcRenderer.send("mix:music"),
  settings: () => ipcRenderer.send("mix:settings"),
  hide: () => ipcRenderer.send("mix:hide"),
});
