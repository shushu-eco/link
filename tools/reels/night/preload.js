// What the Night window's page may ask of its window: nothing but these eight.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("night", {
  state: () => ipcRenderer.invoke("night:state"),
  start: (hours) => ipcRenderer.invoke("night:start", hours),
  carryOn: () => ipcRenderer.invoke("night:continue"),
  stop: () => ipcRenderer.invoke("night:stop"),
  awake: () => ipcRenderer.invoke("night:awake"),   // call off the sleep that was announced
  options: (change) => ipcRenderer.invoke("night:options", change),
  report: () => ipcRenderer.invoke("night:report"),
  close: () => ipcRenderer.send("night:close"),
});
