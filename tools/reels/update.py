"""Bring an installed Link up to date when it starts.

Usage:
    python tools/reels/update.py            say which version this is and which is the newest, change nothing
    python tools/reels/update.py --status   the same as JSON, for the Updater's window (tools/reels/updater)
    python tools/reels/update.py --apply    update now, and say how it went as JSON

A copy run from the project (the author's own Link) is updated by changing its files, one commit for
each update. An open Link goes on running the code it started with, so the Updater shows what waits
("ready") and its button has the open Link start again with it: the Link window says "Update is
underway", closes and comes back by itself (link.pyw and shell/main.js do that part; this file asks
for it through ~/.link/restart.json and waits for the answer). The updates made so far are listed in
the Updater's window, newest first: that list is git's own log of tools/reels.

The Updater (the gear icon beside Link's) is a small window that shows this and has one button.
For an installed Link the button does what Link does by itself when it starts. For a copy run from
the project, where git owns the files, the button is "git pull": it fetches, and takes the new
commits only when the copy has no changes of its own and nothing has to be merged.

An installed Link (Link-Setup.exe) has two kinds of files: the heavy ones that seldom change
(Python, Electron, ffmpeg, the speech model) and Link's own code in tools/reels, a few megabytes,
which changes with every version ("rwa-" and a number). Only the code is updated here.

Each time Link starts, the launcher (link.pyw) calls check_and_apply() before anything else runs:
    1. It reads MANIFEST, a small file kept with the newest release: the version's number, the
       package's address, size and SHA-256, and which "runtime" the code needs.
    2. If that number is higher than this Link's, it downloads the package (a zip of tools/reels),
       checks its size and SHA-256, and unpacks it next to the installed files (update/new).
    3. Then it puts the new files in place one by one, takes away the files the new version no
       longer has, and writes the new VERSION. The launcher starts again as the new version.
Nothing is replaced until the whole package is down, checked and unpacked. While files are being
put in place a note says so (update/applying.json); if Link is stopped just then, the next start
finishes the job from what was unpacked, before anything else.

It never gets in the way: with no internet, a failed download or a wrong checksum, Link starts
as the version it is. A copy that is run from the project (a git checkout, where the user or git
changes the files) is never touched. A release whose code needs newer heavy files than this
install has ("runtime" higher than the number in update/runtime.txt) is not applied; the user is told once
to download the new installer.

What is trusted: the package comes over HTTPS from the address in MANIFEST, which is on the same
host, and must match the manifest's SHA-256 and size. Its files may only land in tools/reels;
models and node_modules are never written to.
"""
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
# The newest release's manifest: an asset of the latest release of Link's public repository, where the
# code, the installer, the zip and the update packages are. The variable is for tests.
MANIFEST = os.environ.get("LINK_UPDATE_URL", "https://github.com/shushu-eco/link/releases/latest/download/latest.json")
WORK = ROOT / "update"
MAX_PACKAGE = 60 * 1024 * 1024          # a code package is a few megabytes; more than this is not one
KEEP_OUT = ("models", "shell/node_modules")   # under tools/reels: never written to, never deleted from
TIMEOUT = 6                              # seconds to wait for the manifest: Link must not start slowly without internet
AGENT = "Link-updater/1"


class UpdateError(Exception):
    """Why an update was not made, in words for the log."""


def installed():
    """An installed copy has its own Python beside it and is not a git checkout."""
    return (ROOT / "runtime" / "python").is_dir() and not (ROOT / ".git").exists()


def number(text):
    m = re.search(r"rwa-(\d+)", str(text))
    return int(m.group(1)) if m else 0


def here():
    """(this Link's version number, the runtime it has)."""
    try:
        version = number((ROOT / "VERSION").read_text(encoding="utf-8"))
    except OSError:
        version = 0
    try:
        runtime = int((WORK / "runtime.txt").read_text(encoding="utf-8").strip())   # not ROOT/RUNTIME: Windows takes that for the "runtime" folder
    except (OSError, ValueError):
        runtime = 1
    return version, runtime


def fetch(url, limit, timeout=TIMEOUT):
    if not url.startswith("https://") and "LINK_UPDATE_URL" not in os.environ:
        raise UpdateError(f"not an https address: {url}")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": AGENT}), timeout=timeout) as res:
            data = res.read(limit + 1)
    except (OSError, ValueError) as e:
        raise UpdateError(f"could not read {url} ({e})") from None
    if len(data) > limit:
        raise UpdateError(f"{url} is larger than expected")
    return data


def newest():
    """The manifest of the newest release: {"version", "package", "sha256", "size", "runtime", "installer"}."""
    try:
        m = json.loads(fetch(MANIFEST, 64 * 1024))
    except ValueError:
        raise UpdateError("the manifest is not readable") from None
    if not isinstance(m, dict) or not isinstance(m.get("version"), int) or not re.fullmatch(r"[0-9a-f]{64}", str(m.get("sha256", ""))):
        raise UpdateError("the manifest is not a manifest")
    return m


def inside(name):
    """A package's file name as a path under tools/reels, or None for one that must not be written."""
    name = name.replace("\\", "/")
    if name.endswith("/") or name.startswith("/") or ":" in name or ".." in name.split("/"):
        return None
    if any(name == k or name.startswith(k + "/") for k in KEEP_OUT):
        return None
    return name


def stage(manifest):
    """Download, check and unpack the package into update/new. Returns the list of its files."""
    data = fetch(urllib.parse.urljoin(MANIFEST, manifest["package"]), MAX_PACKAGE, timeout=60)
    if len(data) != manifest.get("size") or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise UpdateError("the package does not match its checksum")
    new = WORK / "new"
    shutil.rmtree(new, ignore_errors=True)
    new.mkdir(parents=True)
    (WORK / "package.zip").write_bytes(data)
    names = []
    try:
        with zipfile.ZipFile(WORK / "package.zip") as z:
            for info in z.infolist():
                name = inside(info.filename)
                if info.is_dir():
                    continue
                if name is None:
                    raise UpdateError(f"the package holds a file that does not belong: {info.filename}")
                target = new / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(info))
                names.append(name)
    except zipfile.BadZipFile:
        raise UpdateError("the package is not a zip") from None
    finally:
        (WORK / "package.zip").unlink(missing_ok=True)
    if not {"link.pyw", "ui/server.py", "shell/main.js", "update.py"} <= set(names):
        raise UpdateError("the package is not Link")
    return sorted(names)


def apply(note):
    """Put the unpacked files in place. `note` is {"version", "label", "files"}; safe to run again after being cut off."""
    safe_write(WORK / "applying.json", json.dumps(note))
    new = WORK / "new"
    for name in note["files"]:
        source, target = new / name, HERE / name
        if not source.is_file():
            continue   # put in place before the cut-off
        target.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(20):
            try:
                os.replace(source, target)
                break
            except PermissionError:   # something has the old file open this instant
                if attempt == 19:
                    raise UpdateError(f"{name} is in use") from None
                time.sleep(0.25)
    try:
        before = json.loads((WORK / "files.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        before = []
    for name in set(before) - set(note["files"]):   # what the new version no longer has
        if inside(name):
            (HERE / name).unlink(missing_ok=True)
    safe_write(WORK / "files.json", json.dumps(note["files"]))
    safe_write(ROOT / "VERSION", note["label"] + "\n")
    safe_write(WORK / "updated.json", json.dumps({"version": note["version"], "at": time.time()}))   # for the page to say so once
    (WORK / "applying.json").unlink(missing_ok=True)
    shutil.rmtree(new, ignore_errors=True)


def safe_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def check_and_apply(log=print):
    """Called by the launcher before Link starts. Returns "updated" (start again as the new version),
    "installer" plus the address (this install's heavy files are too old for the newest code), or None."""
    if not installed():
        return None
    try:
        try:   # an update that was being put in place when Link was stopped is finished first
            cut = json.loads((WORK / "applying.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cut = None
        if cut:
            apply(cut)
            log(f"finished the update to rwa-{cut['version']} that was cut off")
            return "updated"
        version, runtime = here()
        manifest = newest()
        if manifest["version"] <= version:
            return None
        if int(manifest.get("runtime", 1)) > runtime:
            log(f"rwa-{manifest['version']} needs a newer installer than this Link was installed with")
            return f"installer {manifest.get('installer', '')}".strip()
        files = stage(manifest)
        apply({"version": manifest["version"], "label": f"Link rwa-{manifest['version']} ({manifest.get('date', 'updated online')})", "files": files})
        log(f"updated from rwa-{version} to rwa-{manifest['version']}")
        return "updated"
    except UpdateError as e:
        log(f"not updated: {e}")
    except Exception as e:  # noqa: BLE001  an updater must never keep Link from starting
        log(f"not updated: {type(e).__name__}: {e}")
    return None


# ---------------------------------------------------------------- for the Updater's window

def link_running():
    """Whether Link is open: its server holds its port."""
    try:
        socket.create_connection(("127.0.0.1", 8765), timeout=0.25).close()
        return True
    except OSError:
        return False


def git(*args, timeout=25):
    """(worked, what git said) for a git command in this copy of the project."""
    try:
        # There is no terminal behind the Updater's window: git must answer, not wait for a name to be typed.
        res = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=timeout,
                             env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return res.returncode == 0, (res.stdout or res.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)


RUNNING = Path.home() / ".link" / "running.json"    # which code the open Link started with (link.pyw writes it)
RESTART = Path.home() / ".link" / "restart.json"    # the Updater's request that the open Link start again, and Link's answer


def read(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def updates(open_head, limit=14):
    """The updates made to this copy, newest first: [{"version", "date", "text", "waiting"}]. An update is
    a commit that changed Link's code; "waiting" ones came after the open Link started."""
    ok, said = git("log", f"-n{limit}", "--format=%H%x09%cs%x09%s", "--", "tools/reels")
    if not ok:
        return []
    later = set(git("rev-list", f"{open_head}..HEAD")[1].split()) if open_head else set()
    out = []
    for line in said.splitlines():
        sha, date, text = (line.split("\t", 2) + ["", ""])[:3]
        out.append({"version": int(git("rev-list", "--count", sha)[1] or 0), "date": date, "text": text, "waiting": sha in later})
    return out


def status():
    """What the Updater shows: {"kind": "installed" | "project", "version", "newest", "behind" (versions
    to catch up), "date", "running", "dirty" (a project copy with changes of its own), "installer"
    (an address, when the newest needs a new installer), "error"}. For a copy run from the project also
    "open" (the version the open Link started with), "ready" (updates made since) and "log" (updates())."""
    out = {"kind": "installed" if installed() else "project", "version": 0, "newest": None, "behind": 0, "date": "",
           "running": link_running(), "dirty": False, "installer": None, "error": None, "open": None, "ready": 0, "log": []}
    if installed():
        out["version"], runtime = here()
        try:
            m = newest()
            out.update(newest=m["version"], date=m.get("date", ""), behind=max(0, m["version"] - out["version"]))
            if out["behind"] and int(m.get("runtime", 1)) > runtime:
                out["installer"] = m.get("installer") or ""
        except UpdateError as e:
            out["error"] = "The newest version could not be looked up. Is this PC online?" if "could not read" in str(e) else str(e)
        return out
    ok, count = git("rev-list", "--count", "HEAD")
    if not ok:
        return {**out, "error": "This copy of Link is not a git checkout, so there is nothing to update it from."}
    out["version"] = out["newest"] = int(count)
    out["dirty"] = bool(git("status", "--porcelain", "--untracked-files=no", "--", "tools")[1])
    out["date"] = git("log", "-1", "--format=%cs", "--", "tools/reels")[1]
    # what the open Link runs, and what was made since: known without the internet
    at = read(RUNNING) if out["running"] else {}
    head = at.get("head") if git("cat-file", "-e", f"{at.get('head')}^{{commit}}")[0] else None
    out["log"] = updates(head)
    if out["running"]:
        out["open"] = at.get("version") or None
        out["ready"] = sum(1 for u in out["log"] if u["waiting"])
    # GitHub is not asked: this copy is the author's own and its updates are made here. (Asking made git's
    # sign-in window come up each time the Updater was looked at, again and again.)
    return out


def restart_link(version):
    """Have the open Link start again with the code that is on the PC now, and say how it went. Link's
    window answers in RESTART: it says "Update is underway" and goes ("restarting"), or it waits for a
    recording or a job to end and goes then by itself."""
    asked = time.time()
    RESTART.write_text(json.dumps({"state": "asked", "at": asked, "version": version}), encoding="utf-8")
    until = asked + 70
    while time.time() < until:
        time.sleep(0.5)
        state = read(RESTART).get("state")
        if state == "recording":
            return {"ok": True, "message": "Link is recording. The update goes in by itself when the recordings are stopped.", "version": version}
        if state == "working":
            return {"ok": True, "message": "Link is in the middle of a job. The update goes in by itself when it is done.", "version": version}
        if read(RUNNING).get("at", 0) > asked and link_running():
            return {"ok": True, "message": f"Updated. Link is running rwa-{version} now.", "version": version}
        if state == "asked" and time.time() - asked > 12:   # a Link from before this was built does not hear the request
            break
    try:
        if read(RESTART).get("state") == "asked":
            RESTART.unlink()
    except OSError:
        pass
    return {"ok": False, "message": "Link did not answer. Close Link and open it again: it starts with the update.", "version": version}


def apply_now():
    """Update now: {"ok", "message", "version"}."""
    if installed():
        if link_running():
            return {"ok": False, "message": "Link is open. Close it, then press Update again.", "version": here()[0]}
        said = []
        done = check_and_apply(said.append)
        version = here()[0]
        if done == "updated":
            return {"ok": True, "message": f"Updated to rwa-{version}.", "version": version}
        if done and done.startswith("installer"):
            return {"ok": False, "message": "The newest version needs a new installer: download Link-Setup.exe (or Link-Windows.zip) again. " + done.partition(" ")[2], "version": version}
        return {"ok": not said, "message": said[-1].replace("not updated: ", "Not updated: ") if said else "Link is up to date.", "version": version}
    before = status()
    if before["error"]:
        return {"ok": False, "message": before["error"], "version": before["version"]}
    if not before["behind"]:
        if before["ready"]:
            return restart_link(before["version"])
        return {"ok": True, "message": "Link is up to date.", "version": before["version"]}
    if before["dirty"]:
        return {"ok": False, "message": "This copy has changes of its own that are not committed. Commit them or put them aside (git stash), then update.", "version": before["version"]}
    ok, said = git("pull", "--ff-only", "--quiet", timeout=120)
    version = int(git("rev-list", "--count", "HEAD")[1] or before["version"])
    if not ok:
        return {"ok": False, "message": "git could not take the new commits without a merge: " + (said.splitlines()[-1] if said else "no reason given"), "version": version}
    if link_running():
        return restart_link(version)
    return {"ok": True, "message": f"Updated to rwa-{version}.", "version": version}


if __name__ == "__main__":
    if "--status" in sys.argv or "--apply" in sys.argv:
        print(json.dumps(apply_now() if "--apply" in sys.argv else status()))
        sys.exit(0)
    version, runtime = here()
    print(f"This Link: rwa-{version}, runtime {runtime}, {'installed' if installed() else 'run from the project (never updated here)'}")
    try:
        m = newest()
        print(f"Newest release: rwa-{m['version']} ({m.get('date', '')}), runtime {m.get('runtime', 1)}, {m.get('size', 0) / 1e6:.1f} MB")
    except UpdateError as e:
        sys.exit(f"The newest release could not be read: {e}")
