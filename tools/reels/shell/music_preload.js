"use strict";
// What the music player's window (ui/static/music.html) may ask of Link's window: only to hide itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicWindow", {
  hide: () => ipcRenderer.send("music:hide"),
});
