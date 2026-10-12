// What the updater's page may ask of its window: nothing but these four.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("updater", {
  status: () => ipcRenderer.invoke("updater:status"),
  apply: () => ipcRenderer.invoke("updater:apply"),
  close: () => ipcRenderer.send("updater:close"),
  link: () => ipcRenderer.send("updater:link"),
});
