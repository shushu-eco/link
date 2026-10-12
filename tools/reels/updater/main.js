// Link's updater: a small window of its own (the gear icon beside Link's on the Desktop).
//
//   electron tools/reels/updater
//
// It shows which version this Link is and which is the newest, and has one button that brings
// Link up to date. The work is done by tools/reels/update.py, asked through Python:
//   update.py --status   what to show, as JSON
//   update.py --apply    update now, and how it went, as JSON
// Electron is Link's own (tools/reels/shell/node_modules): this folder holds only this window.
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REELS = path.resolve(__dirname, "..");
const ROOT = path.resolve(REELS, "..", "..");
// An installed Link carries its own Python; a copy run from the project uses the PC's.
const OWN = path.join(ROOT, "runtime", "python");
const python = (windowed) => (fs.existsSync(path.join(OWN, "python.exe")) ? path.join(OWN, windowed ? "pythonw.exe" : "python.exe") : windowed ? "pythonw" : "python");

app.setPath("userData", path.join(os.homedir(), ".link", "updater"));   // beside Link's own settings, not under AppData
let win = null;

// One answer from update.py; whatever goes wrong comes back as words to show.
function ask(what) {
  return new Promise((done) => {
    execFile(python(false), [path.join(REELS, "update.py"), what], { cwd: ROOT, windowsHide: true, timeout: 180000 }, (error, stdout) => {
      try {
        done(JSON.parse(String(stdout).trim().split("\n").pop()));
      } catch (e) {
        const why = error && error.code === "ENOENT" ? "Python was not found on this PC." : "The updater could not be run.";
        done({ error: why, ok: false, message: why });
      }
    });
  });
}

function open() {
  win = new BrowserWindow({
    width: 400, height: 470, resizable: false, maximizable: false, fullscreenable: false, frame: false,
    backgroundColor: "#0e2433", title: "Link Updater", icon: path.join(REELS, "ui", "static", "link_updater.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.on("closed", () => { win = null; app.quit(); });
}

const fromWindow = (e) => !!win && e.sender === win.webContents;
ipcMain.handle("updater:status", (e) => (fromWindow(e) ? ask("--status") : null));
ipcMain.handle("updater:apply", (e) => (fromWindow(e) ? ask("--apply") : null));
ipcMain.on("updater:close", (e) => { if (fromWindow(e) && win) win.close(); });
ipcMain.on("updater:link", (e) => {   // open Link, the way its Desktop icon does, and leave
  if (!fromWindow(e)) return;
  spawn(python(true), [path.join(REELS, "link.pyw")], { cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true }).unref();
  if (win) win.close();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); open(); });
  app.on("window-all-closed", () => app.quit());
}
