"""Link launcher: starts the Link UI server and Link's window.

Double-click the Link shortcut on the Desktop. It runs this file with pythonw, so no console appears.
The window is Link's own program (tools/reels/shell, built on Electron): the dashboard plus a browser
panel and a recorder. The server and the window start together; the window waits for the server.
The server stops when the window is closed, and while the window is open the launcher starts the
server again if it has gone. A second click on the icon brings the open window forward.

An installed Link brings itself up to date first (update.py): when a newer version is out, its
code is downloaded, checked and put in place, and the launcher starts again as that version.
Without internet, or when anything about the update fails, Link starts as the version it is.

Link keeps its settings, its Instagram key and the Studio's sign-ins in %USERPROFILE%\\.link.
Log: %USERPROFILE%\\.link\\link.log
"""
import ctypes
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PORT = 8765
URL = f"http://127.0.0.1:{PORT}"
# Not under AppData: Windows gives a program started from a Store app (the Claude desktop app is one)
# a private copy of AppData, so Link started from there and Link started from the Desktop icon would
# each keep a key and sign-ins of their own, and each would ask for them again.
DATA = Path.home() / ".link"
OLD_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Link"   # where Link 1.0 kept them
SHELL =HERE / "shell" / "node_modules" / "electron" / "dist" / "electron.exe"


def serving():
    try:
        with urllib.request.urlopen(f"{URL}/api/status", timeout=2) as res:
            return res.status == 200
    except OSError:
        return False


def listening():
    """A quick look at the port: asking a closed port for a page takes Windows two seconds, this a quarter."""
    try:
        socket.create_connection(("127.0.0.1", PORT), timeout=0.25).close()
        return True
    except OSError:
        return False


def fail(text):
    ctypes.windll.user32.MessageBoxW(None, text, "Link", 0x10)
    sys.exit(1)


def bring_old_data():
    """Move what Link 1.0 saved to where Link looks now, the first time this version starts."""
    if DATA.exists() or not OLD_DATA.is_dir():
        return
    try:
        OLD_DATA.rename(DATA)
    except OSError:  # a Link from before the update is still open and holds the files
        fail("Link was updated and has to move its saved sign-ins.\n"
             f"Close every Link window, then start Link again.\n\nIf this keeps coming, move the folder\n{OLD_DATA}\nto\n{DATA}")


def bring_up_to_date():
    """An installed Link updates itself before it starts (update.py); a copy run from the project is
    left alone. After an update the launcher starts again, so that the new launcher runs the new Link."""
    if os.environ.get("LINK_JUST_UPDATED") or listening():   # just done, or a Link is open and using the files
        return
    try:
        import update
        with open(DATA / "link.log", "a", encoding="utf-8") as log:
            done = update.check_and_apply(lambda text: log.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} update: {text}\n"))
    except Exception:  # noqa: BLE001  updating must never keep Link from starting
        return
    if done == "updated":
        subprocess.Popen([sys.executable, str(HERE / "link.pyw")], cwd=ROOT, env={**os.environ, "LINK_JUST_UPDATED": "1"})
        sys.exit(0)
    if done and done.startswith("installer"):
        told = DATA / "installer_told.txt"   # said once for each such release, not at every start
        if not told.exists() or told.read_text(encoding="utf-8") != done:
            told.write_text(done, encoding="utf-8")
            ctypes.windll.user32.MessageBoxW(None, "A new version of Link is out that needs a new installer.\n"
                                             f"Download Link-Setup.exe from\n{done.partition(' ')[2] or 'the place you got Link from'}\n\n"
                                             "Link opens now as the version you have.", "Link", 0x40)


RESTART = DATA / "restart.json"   # the Updater's request to start again with the code on the PC now (update.py, shell/main.js)


def note_running():
    """Which code this Link starts with, for the Updater: it tells from this what was made since."""
    try:
        import update
        if update.installed():
            about = {"version": update.here()[0]}
        else:
            about = {"head": update.git("rev-parse", "HEAD")[1], "version": int(update.git("rev-list", "--count", "HEAD")[1] or 0)}
        (DATA / "running.json").write_text(json.dumps({**about, "at": time.time()}), encoding="utf-8")
    except Exception:  # noqa: BLE001  the Updater then simply does not know
        pass


def start_server():
    # python.exe with a hidden console, not pythonw: the server runs ffmpeg, which would flash a
    # console window if its parent had none.
    python = Path(sys.executable).with_name("python.exe")
    log = open(DATA / "link.log", "a", encoding="utf-8")
    log.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} starting\n")
    log.flush()
    return subprocess.Popen([str(python), str(HERE / "ui" / "server.py"), "--port", str(PORT)], cwd=ROOT,
                            stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    if not SHELL.is_file():
        fail(f"Link's window program is not installed.\nRun \"npm install\" in {HERE / 'shell'}")
    bring_old_data()
    DATA.mkdir(parents=True, exist_ok=True)
    bring_up_to_date()
    # An installed Link (Link-Setup.exe) carries its own ffmpeg beside it; the server and the window
    # both find it through PATH. A copy run from the project has no such folder and uses the PC's own.
    ffmpeg = ROOT / "runtime" / "ffmpeg" / "bin"
    if ffmpeg.is_dir():
        os.environ["PATH"] = f"{ffmpeg}{os.pathsep}{os.environ.get('PATH', '')}"
    # Held for as long as Link runs, so its installer can tell that Link is open and ask to close it.
    running = ctypes.windll.kernel32.CreateMutexW(None, False, "LinkRunning")
    RESTART.unlink(missing_ok=True)   # a request left over from another time is not this Link's
    server =None if listening() else start_server()
    if server:
        note_running()
    # A second copy of the window hands over to the first and ends at once, and this launcher with it.
    env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    window = subprocess.Popen([str(SHELL), str(HERE / "shell"), f"--link-url={URL}"], env=env)
    try:
        started = time.time()
        while window.poll() is None:
            time.sleep(1)
            if server and server.poll() is None:
                continue  # our server is running (or still starting)
            if serving():
                continue  # another launcher's server is doing the work
            if server and time.time() - started < 20:
                window.terminate()
                fail(f"Link could not start its server.\nDetails are in {DATA / 'link.log'}")
            server = start_server()
    finally:
        if server and server.poll() is None:
            server.terminate()
    # The window went because the Updater asked for the new code (it said "restarting" before it closed):
    # the server is gone too, and Link starts again, as the launcher that is on the PC now.
    try:
        again = json.loads(RESTART.read_text(encoding="utf-8")).get("state") == "restarting"
    except (OSError, ValueError):
        again = False
    if again:
        RESTART.unlink(missing_ok=True)
        if server:
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
        subprocess.Popen([sys.executable, str(HERE / "link.pyw")], cwd=ROOT, env={**os.environ, "LINK_JUST_UPDATED": "1"})


if __name__ == "__main__":
    main()
