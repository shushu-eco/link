"use strict";
// What the Discord widget (ui/static/discord.html) may ask of Link's window. The bot's token goes in,
// never out: the widget only learns whether one is saved.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("discordWidget", {
  state: () => ipcRenderer.invoke("discord:state"),
  onState: (listener) => ipcRenderer.on("discord:state", (_event, state) => listener(state)),
  token: (token) => ipcRenderer.invoke("discord:token", token),
  lists: (guildId) => ipcRenderer.invoke("discord:lists", guildId),
  choose: (choice) => ipcRenderer.invoke("discord:choose", choice),
  link: (id, open) => ipcRenderer.invoke("discord:link", id, open),
  posts: (kind, on) => ipcRenderer.send("discord:posts", kind, on),
  controlChannel: () => ipcRenderer.invoke("discord:control-channel"),
  reportChannel: () => ipcRenderer.invoke("discord:report-channel"),
  report: () => ipcRenderer.invoke("discord:report"),
  disconnect: () => ipcRenderer.send("discord:disconnect"),
  hide: () => ipcRenderer.send("discord:hide"),
});
