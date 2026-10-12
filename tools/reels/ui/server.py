"""Link UI: the dashboard that Link's window (tools/reels/shell) shows.

Usage:
    python tools/reels/ui/server.py [--port 8765]

The Link launcher starts it. Opened in an ordinary browser, http://127.0.0.1:8765 shows the same
dashboard without the Studio (no browser panel, no recorder).

The server only listens on this machine. It reads what the Link scripts write (videos/reels/<SRC-id>/,
videos/finals/) and runs the same scripts for its actions:
    GET  /api/status                 the current job and the settings
    GET  /api/recorder               the folder Link's recorder saves into
    GET  /api/about                  for Settings > About: which version this is ("rwa-15"), and where Link keeps things
    GET  /api/learned                what Link learned about which moments become reels (learn.py), without the
                                     model itself; "due" says the library has new answers since
    POST /api/learn                  learn from the library now; answers when done with the same
    GET  /api/storage                for Settings > Storage: how much room each part of Link takes, the drive's
                                     free room, and whether to worry (storage.py); ?mbit=N is the picture
                                     quality the hours of recording left are worked out for
    POST /api/recordings             what the user answered when a recording stopped: {"action": "name", "file": path,
                                     "name": ...}: call it that (kept beside the recording until it is a tape);
                                     {"action": "discard", "file": path}: put it in the Recycle Bin
    GET  /api/recordings             Link's recordings in that folder that are not tapes yet, newest first
    GET  /api/unfinished             what was cut off when Link last closed, for the page to finish when it opens:
                                     {"videos": [files to process], "stuck": [{"id", "name"}] that failed too
                                     often to try again, "render": {"source", "only"} or null}
    POST /api/unfinished             {"files": [paths]}: recordings saved as Link is closed, to process next time
    GET  /api/sources                every analysed source
    GET  /api/sources/<id>           candidates, transcript, edit list, previews and finals of one source
    GET  /api/sources/<id>/version   changes whenever that source's reels.json is written
    PUT  /api/sources/<id>/reels     {"edl": {...}, "base": version, "force": bool}: save the edit list
                                     (reels.json); refused if the file changed since `base`, unless forced
    POST /api/sources/<id>/reels     {"rank": n} or {"in": s, "out": s}: add a reel from a candidate or any stretch
    POST /api/sources/<id>/ui        {"dismiss": "in-out", "on": bool} or
                                     {"posted": {"reel": id, "platform": name}, "on": bool} (kept in ui.json)
    GET  /api/folders                how the tapes are grouped in the sidebar (videos/reels/folders.json)
    PUT  /api/folders                {"folders": [...], "tapes": {id: folder}, "favorites": [ids]}: save it
    POST /api/reveal                 {"file": name}: show a rendered reel in File Explorer
    POST /api/settings               {"auto": bool}: process a recording as soon as it is saved;
                                     {"instagram": name}: the page the Instagram buttons open
    POST /api/jobs                   {"kind": "ingest", "files": [paths], "recording": bool}: process these
                                     videos; "recording" says they are Link's recordings, not uploads;
                                     {"kind": "render", "source": id, "only": [ids]} or
                                     {"kind": "preview", "source": id, "only": [ids], "edl": {...}}
    GET  /api/instagram              whether an Instagram access key is saved, and the analytics last read
    POST /api/instagram              {"action": "refresh"}: read the analytics from Instagram now;
                                     {"action": "connect", "token": key}: check and keep an access key;
                                     {"action": "disconnect"}: forget the key and the saved analytics
    GET  /api/kick                   whether a Kick app is connected; with ?channel=name also what Kick says
                                     about that channel now: {"live", "title", "category", "viewers"}
    POST /api/publish                {"platform": "youtube" | "instagram", "source": id, "reel": id, "title": ...,
                                     "text": ..., "privacy": "private" | "unlisted" | "public"}: upload that
                                     rendered reel as a Short, or post it on the Instagram page; answers when done
    POST /api/kick                   {"action": "connect", "id": ..., "secret": ...}: check and keep the Kick
                                     app's Client ID and secret; {"action": "disconnect"}: forget them
    GET  /api/spotify                the music player: whether Spotify is set up and connected, what plays
    POST /api/spotify                {"action": "client_id", "id": ...}: keep the Spotify app's Client ID;
                                     {"action": "connect"}: open Spotify's sign-in page in the browser;
                                     {"action": "disconnect"}; {"action": "play" | "pause" | "next" | "previous"}
    GET  /spotify/callback           where Spotify's sign-in page sends the browser back to
    GET  /api/youtube                the Analytics screen's YouTube side: whether it is set up and connected,
                                     and the last numbers read
    POST /api/youtube                {"action": "client", "id": ..., "secret": ...}: keep the OAuth client;
                                     {"action": "connect"}: open Google's sign-in page in the browser;
                                     {"action": "refresh"}: read the numbers now; {"action": "disconnect"};
                                     {"action": "forget"}: forget the client too
    GET  /youtube/callback           where Google's sign-in page sends the browser back to
    POST /api/sources/<id>/name      {"name": text}: what the tape is called; empty goes back to its date
    POST /api/sources/<id>/delete    {"recording": bool}: the tape (and, if asked, the recording it was made
                                     from) goes to the Recycle Bin; finished reels stay
    GET  /api/post/<side>/<id>       one reel (side instagram) or Short (side youtube) in depth, read now:
                                     its views day by day, where they came from, comments, settings
    POST /api/discord-copy           {"file": final}: a copy of a rendered reel small enough for a Discord bot
                                     (under 10 MB), with the reel's title, hook and post text
    GET  /clip/<id>/<in>_<out>.mp4   that stretch of the source, transcoded once for the browser
    GET  /strip/<id>.jpg             eight frames of the whole tape side by side, made once (the Sources screen)
    GET  /strip/<id>/cand_NN.jpg     three frames of one candidate, cut from its contact sheet (the Candidates list)
    GET  /files/reels/<id>/<file>    contact sheets and previews
    GET  /files/finals/<file>        rendered reels

Previews and clips are cached in videos/reels/<SRC-id>/preview/; that folder can be deleted at any time.
Each job's output goes to the server's own output with the time, which the launcher keeps in
link.log in the user's .link folder.
"""
import argparse
import difflib
import html
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(TOOLS))

import instagram_api  # noqa: E402
import kick_api  # noqa: E402
import learn  # noqa: E402
import spotify_api  # noqa: E402
import storage  # noqa: E402
import youtube_api  # noqa: E402
import safe  # noqa: E402
from ingest import MAX_TRIES, ingested, tapes, waiting  # noqa: E402

STATIC = HERE / "static"
# The job that is running, written when it starts and taken away when it ends. One that is there when
# the server starts was cut off: Link was closed, or the PC went off, while it ran (see unfinished).
JOURNAL = ROOT / "videos" / "job.json"
CUT = None   # that job, as the journal had it when this server started
# Recordings saved as Link was closed, to be processed when it opens again (the window names them).
PENDING = ROOT / "videos" / "pending.json"
REELS, FINALS, POSTS = ROOT / "videos" / "reels", ROOT / "videos" / "finals", ROOT / "strategy" / "posts"
RECORDINGS = Path.home() / "Videos"   # where Link's recorder saves and ingest.py looks
TIMELINE_POINTS = 600
MAX_CLIP = 180          # longest source clip, in seconds, the browser may ask for
STREAM_ZOOM = 1.5       # default framing for reels made from a 16:9 stream recording


class Job:
    """One background script run at a time (ingest, render or preview), with its output kept for the UI."""

    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"kind": None, "running": False, "returncode": None, "log": ""}

    def start(self, kind, cmd, journal=None, **about):
        with self.lock:
            if self.state["running"]:
                return False
            self.state = {"kind": kind, "running": True, "returncode": None, "log": "", "started": time.time(), **about}
            JOURNAL.parent.mkdir(parents=True, exist_ok=True)
            safe.write_json(JOURNAL, {"kind": kind, "started": self.state["started"], **(journal or {})})
        threading.Thread(target=self.run, args=(cmd,), daemon=True).start()
        return True

    def run(self, cmd):
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
        # Also written out with the time, so it is in link.log after Link is closed.
        print(f"\n{time.strftime('%Y-%m-%d %H:%M:%S')} job {self.state['kind']}: {subprocess.list2cmdline(cmd)}", flush=True)
        proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace")
        # When Link closes the server is ended at once. The job goes with it, rather than working on
        # unseen and dying at its next line; what it had not finished is found at the next start.
        safe.end_with_me(proc)
        for line in proc.stdout:
            self.state["log"] += line
            print(f"{time.strftime('%H:%M:%S')}  {line}", end="", flush=True)
        self.state["returncode"] = proc.wait()
        print(f"{time.strftime('%H:%M:%S')} job {self.state['kind']} ended with code {self.state['returncode']}", flush=True)
        self.state["ended"] = time.time()
        JOURNAL.unlink(missing_ok=True)
        self.state["running"] = False


JOB = Job()
# What Link keeps beside a recording: its highlight marks, its chat counts, the page's name, its ads,
# the stream's name, and the name the user gave it. They go where the recording goes.
BESIDE = (".markers.json", ".chat.json", ".title.json", ".ads.json", ".stream.json", ".name.json", ".notes.json", ".content.json")
clip_lock = threading.Lock()
# A preview's picture: 720 lines, scaled with the sharper method and its edges brought out a little, so
# it holds up on the whole screen. It cannot show more than the recording has: a recording made in a
# small Link window (the Studio records the panel at its size on screen) stays soft.
PREVIEW_PICTURE = "scale=-2:720:flags=lanczos,unsharp=5:5:0.5:5:5:0.0"
warming = {"turn": 0}   # the newest request to make previews ahead (warm_clips); an older one stops when it sees a newer
mimetypes.add_type("font/woff2", ".woff2")   # Windows does not always know the type of the bundled fonts
SETTINGS_FILE = instagram_api.DATA / "settings.json"
# auto: the page starts processing a recording as soon as it is saved
# instagram: the name of the user's Instagram page, which the Instagram buttons open in the Studio
# cut: how a reel is cut from a candidate: "tight", "balanced" or "airy" (learn.py, AIR)
settings = {"auto": True, "instagram": "", "cut": "balanced"}


def instagram_name(text):
    """The page name from "@name", "name" or the page's address; None if it is none of those."""
    text = str(text).strip()
    text = re.sub(r"^(https?://)?(www\.)?instagram\.com/", "", text, flags=re.I).lstrip("@").split("/")[0].split("?")[0]
    return text if re.fullmatch(r"[A-Za-z0-9._]{1,30}", text) else None


def load_settings():
    try:
        settings.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass


def save_settings():
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    safe.write_json(SETTINGS_FILE, settings)


def version():
    """Which Link this is: "rwa-" and a number that goes up by one with every change to Link's code
    (how many commits git counts). An installed Link has no git; its installer wrote the number into
    the VERSION file beside it (tools/package/build.ps1)."""
    try:
        count = subprocess.run(["git", "-C", str(ROOT), "rev-list", "--count", "HEAD"], capture_output=True, text=True,
                               timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip()
        if count.isdigit():
            return f"rwa-{count}"
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        return (re.search(r"rwa-\d+", (ROOT / "VERSION").read_text(encoding="utf-8")) or [""])[0]
    except OSError:
        return ""


def just_updated():
    """The version Link updated itself to since the page last asked (update.py leaves a note), told once."""
    note = ROOT / "update" / "updated.json"
    said = read_json(note)
    if said:
        note.unlink(missing_ok=True)
    return (said or {}).get("version")


def about():
    """Which Link this is and the folders it uses. Link's window opens one of these in Explorer when
    asked, and only these."""
    return {"version": version(), "updated": just_updated(),
            "paths": {"recordings": str(RECORDINGS), "tapes": str(REELS), "finals": str(FINALS), "posts": str(POSTS),
                      "data": str(instagram_api.DATA), "log": str(instagram_api.DATA / "link.log")}}


def instagram_state(data=None):
    """What the Analytics screen needs. The access key itself never leaves the server."""
    return {"connected": bool(instagram_api.saved_token()), "can_publish": instagram_api.publish_known(), "data": data or instagram_api.cached()}


def publish(data):
    """Post a rendered reel from here: {"platform": "youtube" or "instagram", "source": id, "reel": id, "title", "text",
    "privacy"}. The file is the one this server rendered for that reel, never a path from the page. The
    platform's row in Finals is ticked when it worked. Returns ({"link", ...}, None) or (None, why not)."""
    src, reel_id = str(data.get("source")), str(data.get("reel"))
    edl = read_json(REELS / src / "reels.json") if re.fullmatch(r"SRC-\d+", src) else None
    reel = next((r for r in (edl or {}).get("reels", []) if r["id"] == reel_id), None)
    if not reel or not (file := FINALS / final_name(reel)).is_file():
        return None, "That reel is not rendered."
    try:
        if data.get("platform") == "youtube":
            made, row = youtube_api.upload(file, data.get("title", ""), data.get("text", ""), data.get("privacy", "private")), "YouTube Shorts"
        elif data.get("platform") == "instagram":
            made, row = instagram_api.publish_reel(file, data.get("text", "")), "Caption"
        else:
            return None, "unknown platform"
    except (youtube_api.YouTubeError, instagram_api.InstagramError) as e:
        return None, str(e)
    # the rows this reel has in Finals (postRows in app.js); Instagram's is its caption post, when it has one
    caption = reel.get("post_caption") is not None
    rows = [*(reel.get("platforms") or ([] if caption else ["YouTube Shorts", "TikTok"])), *(["Caption"] if caption else [])]
    if row in rows:
        update_ui_state(src, {"posted": {"reel": reel_id, "platform": row}, "on": True})
    state = ui_state(src)
    state["published"].setdefault(reel_id, {})[str(data.get("platform"))] = made.get("id")
    safe.write_json(REELS / src / "ui.json", state, indent=1)
    return {**made, "ui": ui_state(src)}, None


def read_json(path):
    return safe.read_json(path)   # None for a file that is not there, or that cannot be read


def write_edl(path, edl):
    safe.write_text(path, json.dumps(edl, indent=2, ensure_ascii=False) + "\n")


def final_name(reel):
    return f"{reel['id']}_{reel['slug']}_TIKTOK_9x16.mp4"


DISCORD_LIMIT = 10_000_000   # bytes a bot may attach on a server without boosts


def discord_copy(name):
    """A 720x1280 copy of a rendered reel under DISCORD_LIMIT, in its tape's preview folder, and what the
    reel is: {"copy": path or None, "size": bytes, "reel": {...}}. None when no edit list has that reel."""
    for edl_path in REELS.glob("SRC-*/reels.json"):
        for reel in (read_json(edl_path) or {}).get("reels", []):
            if final_name(reel) != name:
                continue
            src = FINALS / name
            platforms = reel.get("platforms") or {}
            text = next((t.get("description") for t in platforms.values() if t.get("description")), None) or reel.get("post_caption") or ""
            info = {"id": reel["id"], "title": reel.get("title", ""), "hook": (reel.get("hook") or "").replace("\\N", " "), "text": text,
                    "tape": edl_path.parent.name}
            if not src.is_file():
                return {"copy": None, "size": 0, "reel": info}
            out = edl_path.parent / "preview" / f"discord_{name}"
            out.parent.mkdir(exist_ok=True)
            seconds = max(1.0, float(reel["out"]) - float(reel["in"]))
            budget = DISCORD_LIMIT * 0.9 * 8 / seconds   # bits per second for picture and sound together
            for squeeze in (1.0, 0.75, 0.55):
                video = int(max(250_000, min(3_000_000, (budget - 96_000) * squeeze)))
                part = out.with_name(out.stem + safe.PART + out.suffix)   # in place only when it is whole
                made = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf", "scale=720:1280",
                                       "-c:v", "libx264", "-preset", "veryfast", "-b:v", str(video), "-maxrate", str(video), "-bufsize", str(video * 2),
                                       "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(part)], check=False)
                if made.returncode == 0 and part.is_file():
                    os.replace(part, out)
                else:
                    part.unlink(missing_ok=True)
                    out.unlink(missing_ok=True)
                if out.is_file() and out.stat().st_size < DISCORD_LIMIT:
                    return {"copy": str(out), "size": out.stat().st_size, "reel": info}
            out.unlink(missing_ok=True)
            return {"copy": None, "size": src.stat().st_size, "reel": info}
    return None


def tape_name(folder, ingest):
    """The name the user gave a tape (label.json in its folder), else the one it was uploaded under."""
    return (read_json(folder / "label.json") or {}).get("name") or ingest.get("name")


def rename_tape(src_id, name):
    """Keeps the name the user typed; an empty one takes the tape back to its date or file name."""
    folder = REELS / src_id
    if not folder.is_dir():
        return None
    name = " ".join(str(name or "").split())[:80]
    if name:
        safe.write_json(folder / "label.json", {"name": name})
    else:
        (folder / "label.json").unlink(missing_ok=True)
    return {"name": tape_name(folder, read_json(folder / "ingest.json") or {})}


def unfinished():
    """What was cut off because Link was closed (or the PC went off) while a job ran. The page asks
    when it opens and finishes it:
        videos   files whose processing did not finish: a tape folder that still says "processing"
                 (ingest.py), a job that was cut off before it had made the folder (the journal), or
                 a recording saved as Link was closed and noted for later (PENDING)
        stuck    tapes whose processing was started MAX_TRIES times and never finished. They are
                 named once and then left to the user: uploading the file again tries once more.
        render   the reels of a render that was cut off and are not rendered since
    Nothing while a job runs (it may be the one finishing these), and no video that is gone."""
    out = {"videos": [], "stuck": [], "render": None}
    if JOB.state["running"]:
        return out
    begun = set()
    for src_id, about, finished in tapes():
        if finished:
            continue
        begun.add(os.path.normcase(about["original"]))
        if about.get("state") == "failed" or not Path(about["original"]).is_file():
            continue
        if int(about.get("tries") or 1) < MAX_TRIES:
            out["videos"].append(about["original"])
        else:
            out["stuck"].append({"id": src_id, "name": Path(about["original"]).name})
            safe.write_json(REELS / src_id / "ingest.json", {**about, "state": "failed"}, indent=1)   # said once
    cut, done = CUT or {}, ingested()
    for f in [*map(str, (cut.get("files") or []) if cut.get("kind") == "ingest" else []), *pending()]:
        if os.path.normcase(f) not in begun and os.path.normcase(f) not in done and Path(f).is_file() and f not in out["videos"]:
            out["videos"].append(f)
    src = str(cut.get("source"))
    if cut.get("kind") == "render" and re.fullmatch(r"SRC-\d+", src):
        wanted = set(map(str, cut.get("only") or []))
        only = [r["id"] for r in (read_json(REELS / src / "reels.json") or {}).get("reels", [])
                if (not wanted or r["id"] in wanted)
                and not ((f := FINALS / final_name(r)).is_file() and f.stat().st_mtime >= cut.get("started", 0))]
        out["render"] = {"source": src, "only": only} if only else None
    return out


def pending(add=(), drop=()):
    """The recordings noted for later, after adding and dropping some."""
    was = [f for f in read_json(PENDING) or [] if isinstance(f, str)]
    gone = {os.path.normcase(str(f)) for f in drop}
    now = [f for f in dict.fromkeys([*was, *(str(f) for f in add if Path(str(f)).is_file())]) if os.path.normcase(f) not in gone]
    if now != was:
        PENDING.parent.mkdir(parents=True, exist_ok=True)
        safe.write_json(PENDING, now)
    return now


def sweep():
    """When the server starts no job runs, so every unfinished write (a name with safe.PART in it: a
    reel half rendered, a file half written) is what a cut-off left, and goes."""
    for folder, patterns in ((FINALS, ["*.part.mp4"]), (REELS, ["*/*.part", "*/preview/*.part.*", "*/preview/*.part"]), (JOURNAL.parent, ["*.part"])):
        for pattern in patterns:
            for f in folder.glob(pattern):
                try:
                    f.unlink()
                except OSError:
                    pass


def learned_state(known=None):
    """What Settings > Learning shows: everything learn.py wrote but the model's numbers."""
    known = known if known is not None else read_json(learn.LEARNED) or {}
    return {**{k: v for k, v in known.items() if k != "model"}, "due": list(learn.answers()) != known.get("answers")}


def sources():
    out = []
    for d in sorted(REELS.glob("SRC-*"), reverse=True):
        analysis = read_json(d / "analysis.json")
        if not analysis:
            continue
        ingest, edl = read_json(d / "ingest.json") or {}, read_json(d / "reels.json") or {}
        reels = edl.get("reels", [])
        out.append({
            "id": d.name, "file": Path(analysis["source"]).name, "duration": analysis["info"]["duration"],
            "mode": analysis.get("mode", "clip"), "started": ingest.get("started"), "name": tape_name(d, ingest),
            "candidates": len(analysis["candidates"]),
            "marked": sum(1 for c in analysis["candidates"] if c.get("marked")),
            "reels": len(reels), "rendered": sum(1 for r in reels if (FINALS / final_name(r)).exists()),
            # when it became a tape: the day an uploaded video (which has no recording time) is listed under
            # whether the recording it was made from is still in the recordings folder (it can be deleted with the tape)
            "recording": bool(ingest.get("original")) and Path(ingest["original"]).is_file(),
            "made": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime((d / "analysis.json").stat().st_mtime)),
        })
    return out


# The sidebar's folders only group tapes: nothing in a tape's own folder changes when it is filed,
# and deleting a folder in the page never deletes a tape.
FOLDERS = REELS / "folders.json"
FOLDER_COLORS = {"red", "amber", "gold", "green", "teal", "blue", "purple"}


def read_folders():
    """The saved grouping, with tapes that no longer exist left out; empty if the file is missing or broken."""
    try:
        data = read_json(FOLDERS) or {}
        error, clean = check_folders(data)
        if not error:
            return clean
    except (ValueError, OSError):
        pass
    return {"folders": [], "tapes": {}, "favorites": []}


def check_folders(data):
    """(error, cleaned) for a grouping the page sent."""
    if not isinstance(data, dict) or not isinstance(data.get("folders", []), list):
        return "not a folder list", None
    tapes_on_disk = {d.name for d in REELS.glob("SRC-*") if d.is_dir()}
    folders, seen = [], set()
    for f in data.get("folders", []):
        if not isinstance(f, dict):
            return "not a folder", None
        fid, name, parent = str(f.get("id", "")), str(f.get("name", "")).strip(), f.get("parent")
        if not re.fullmatch(r"F\d+", fid) or fid in seen:
            return "a folder id is missing or used twice", None
        if not 1 <= len(name) <= 60:
            return "A folder name needs 1 to 60 characters.", None
        color = f.get("color") if f.get("color") in FOLDER_COLORS else None
        seen.add(fid)
        folders.append({"id": fid, "name": name, "parent": None if parent is None else str(parent),
                        "color": color, "open": bool(f.get("open", True))})
    parents = {f["id"]: f["parent"] for f in folders}
    names = set()
    for f in folders:
        if f["parent"] is not None and f["parent"] not in parents:
            return "a folder is inside a folder that does not exist", None
        at, steps = f["parent"], 0
        while at is not None:   # walk up: a folder may not end up inside itself
            if at == f["id"] or steps > len(folders):
                return "A folder cannot go inside itself.", None
            at, steps = parents[at], steps + 1
        key = (f["parent"], f["name"].casefold())
        if key in names:
            return f'There is already a folder called "{f["name"]}" there.', None
        names.add(key)
    filed = data.get("tapes") if isinstance(data.get("tapes"), dict) else {}
    starred = data.get("favorites") if isinstance(data.get("favorites"), list) else []
    tapes = {str(k): str(v) for k, v in filed.items() if k in tapes_on_disk and str(v) in parents}
    favorites = [t for t in dict.fromkeys(map(str, starred)) if t in tapes_on_disk]
    return None, {"folders": folders, "tapes": tapes, "favorites": favorites}


FOLDERS_LOCK = threading.Lock()   # the server answers requests side by side; the file is written by one at a time


def save_folders(data):
    error, clean = check_folders(data)
    if error:
        return error, None
    with FOLDERS_LOCK:
        tmp = FOLDERS.with_suffix(".tmp")   # written whole, then swapped in, so a crash never leaves half a file
        tmp.write_text(json.dumps(clean, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, FOLDERS)
    return None, clean


def previews(src_id):
    """Newest preview render per reel id; the name carries its time so the browser never shows a stale one."""
    found = {}
    for f in sorted((REELS / src_id / "preview").glob("*_TIKTOK_9x16.mp4"), key=lambda f: f.stat().st_mtime):
        found[f.name.split("_")[0]] = f"{f.name}?v={int(f.stat().st_mtime)}"
    return found


def default_zoom(analysis):
    """A long landscape source is enlarged to fill more of the 9:16 frame; upright footage fills it already."""
    info = analysis["info"]
    return STREAM_ZOOM if analysis.get("mode") == "stream" and info["width"] > info["height"] else 1.0


# ---- how hard the PC is working, for the two thin readouts at the foot of the list on the left
perf = {"lock": threading.Lock(), "cpu": None, "times": None, "cpu_at": 0.0, "gpu": None, "gpu_at": 0.0}


def cpu_times():
    """(idle, busy and idle together) of all processors since the PC started, from Windows; None elsewhere."""
    try:
        import ctypes
        idle, kernel, user = ctypes.c_ulonglong(), ctypes.c_ulonglong(), ctypes.c_ulonglong()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        return idle.value, kernel.value + user.value   # Windows counts idle time inside kernel time
    except (AttributeError, OSError):
        return None


def performance():
    """{"cpu": percent or None, "gpu": {"use": percent, "memory": percent, "name"} or None}. The processor's
    figure is its work since the last time this was asked (at least a second ago). The graphics card's is
    asked of its own tool (nvidia-smi), every two seconds at most; a PC without one has no figure."""
    with perf["lock"]:
        now = time.time()
        if now - perf["cpu_at"] >= 0.9:
            t = cpu_times()
            if t and perf["times"] and t[1] > perf["times"][1]:
                perf["cpu"] = round(100 * (1 - (t[0] - perf["times"][0]) / (t[1] - perf["times"][1])))
            perf["times"], perf["cpu_at"] = t, now
        if now >= perf["gpu_at"]:
            perf["gpu_at"] = now + 2
            try:
                res = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,name", "--format=csv,noheader,nounits"],
                                     capture_output=True, text=True, timeout=3, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                use, used, total, name = [x.strip() for x in res.stdout.strip().splitlines()[0].split(",", 3)]
                perf["gpu"] = {"use": int(use), "memory": round(100 * int(used) / max(1, int(total))), "name": name}
            except (OSError, ValueError, IndexError, subprocess.SubprocessError):
                perf["gpu"] = None
                perf["gpu_at"] = now + 300   # no such card, or its tool is missing: not asked again for a while
        return {"cpu": perf["cpu"], "gpu": perf["gpu"]}


CONTENT_KINDS = ("general", "shooter", "talk", "chatting", "horror", "sports")   # analyze.py --content


plays_known = {}   # recording -> whether the window can play it as it is (plays)


def plays(source):
    """Whether Link's window can play this recording itself, with no preview cut from it: an mp4 or webm
    whose picture and sound are of the kinds Chromium plays (Link's own recordings are). Then the player
    shows the recording and can go anywhere in it at once; otherwise it shows previews (source_clip)."""
    key = str(source)
    if key not in plays_known:
        ok = False
        if Path(source).suffix.lower() in (".mp4", ".m4v", ".webm") and Path(source).is_file():
            res = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", key],
                                 capture_output=True, text=True, encoding="utf-8", errors="replace")
            try:
                kinds = {s["codec_type"]: s.get("codec_name") for s in json.loads(res.stdout).get("streams", [])}
                ok = kinds.get("video") in ("h264", "vp8", "vp9", "av1") and kinds.get("audio", "none") in ("aac", "opus", "mp3", "vorbis", "none")
            except (ValueError, KeyError, TypeError):
                ok = False
        plays_known[key] = ok
    return plays_known[key]


def source_detail(src_id):
    d = REELS / src_id
    analysis = read_json(d / "analysis.json")
    if not analysis:
        return None
    score = analysis["score"]
    step = max(1, -(-len(score) // TIMELINE_POINTS))
    edl, ingest = read_json(d / "reels.json"), read_json(d / "ingest.json") or {}
    try:
        picked = learn.picks(d)
    except Exception:  # noqa: BLE001  what was learned must never keep a tape from opening
        picked = {}
    finals = {}
    for r in (edl or {}).get("reels", []):
        f = FINALS / final_name(r)
        if f.exists():
            finals[r["id"]] = {"file": f.name, "path": str(f), "v": int(f.stat().st_mtime)}
    return {
        "id": src_id, "file": Path(analysis["source"]).name, "info": analysis["info"],
        "plays": plays(analysis["source"]),   # the window can play the recording itself (GET /tape/<id>)
        "content": analysis.get("content", "general"), "game": analysis.get("game"),   # what it was analysed as (analyze.py --content)
        "mode": analysis.get("mode", "clip"), "markers": analysis.get("markers", []),
        # "pick": how much each looks like the moments that became reels, once what was learned is trusted (learn.py)
        "candidates": [{**c, **({"pick": picked[c["rank"]]} if c["rank"] in picked else {})}
                       for c in sorted(analysis["candidates"], key=lambda c: c["rank"])],
        "sheets": analysis.get("sheets", []),
        # The timeline keeps the peak of each bucket so short spikes survive the downsampling.
        "timeline": {"step": step, "score": [round(max(score[i:i + step]), 2) for i in range(0, len(score), step)],
                     # a Kick stream's chat speed (messages per second, smoothed), the same way
                     "chat": [round(max(chat[i:i + step]), 2) for i in range(0, len(chat), step)] if (chat := analysis.get("chat")) else None},
        "transcript": read_json(d / "transcript.json"),
        "problems": analysis.get("problems", []), "level": analysis.get("level"),
        "started": ingest.get("started"), "name": tape_name(d, ingest), "ui": ui_state(src_id),
        "edl": edl, "version": edl_version(src_id), "finals": finals, "previews": previews(src_id),
        "default_zoom": default_zoom(analysis),
    }


def check_edl(edl):
    if not isinstance(edl, dict) or not isinstance(edl.get("reels"), list) or not edl.get("source"):
        return 'The edit list needs "source" and a "reels" list.'
    for r in edl["reels"]:
        if not all(k in r for k in ("id", "slug", "in", "out")):
            return 'Every reel needs "id", "slug", "in" and "out".'
        if not re.fullmatch(r"[A-Za-z0-9_-]+", f"{r['id']}{r['slug']}"):
            return f"{r['id']}: id and slug may only contain letters, digits, - and _"
        if not isinstance(r["in"], (int, float)) or not isinstance(r["out"], (int, float)) or r["in"] >= r["out"]:
            return f"{r['id']}: in must be a number smaller than out."
    ordered = sorted(edl["reels"], key=lambda r: r["in"])
    for a, b in zip(ordered, ordered[1:]):
        if b["in"] < a["out"]:
            return f"{a['id']} and {b['id']} overlap; reels of one source must not share footage."
    return None


def next_post_id():
    """The POST-0NN sequence runs across all sources: post files plus every edit list."""
    used = [int(m.group(1)) for f in POSTS.glob("POST-*") if (m := re.match(r"POST-(\d+)", f.name))]
    for f in REELS.glob("*/reels.json"):
        used += [int(m.group(1)) for r in read_json(f).get("reels", []) if (m := re.fullmatch(r"POST-(\d+)", r["id"]))]
    return f"POST-{max(used, default=0) + 1:03d}"


def ui_state(src_id):
    """What the user did in the page that is not part of the edit list: dismissed candidates, posts done."""
    state = read_json(REELS / src_id / "ui.json") or {}
    # "published": {reel id: {platform: the post's id there}} for the reels Link posted itself, so their
    # numbers can be tied to the moment they were cut from
    # What Link notices for learning (learn.py): "seen", how long each candidate was watched; "removed",
    # the stretches of reels that were made and thrown out again; "proposed", the cut Link gave each reel
    return {"dismissed": state.get("dismissed", []), "posted": state.get("posted", {}), "published": state.get("published", {}),
            "seen": state.get("seen", {}), "removed": state.get("removed", []), "proposed": state.get("proposed", {})}


def update_ui_state(src_id, data):
    state, on = ui_state(src_id), bool(data.get("on"))
    if "dismiss" in data:  # a candidate is named by its window, "in-out", which survives a re-analysis better than its rank
        keys = set(state["dismissed"]) - {str(data["dismiss"])}
        state["dismissed"] = sorted(keys | {str(data["dismiss"])} if on else keys)
    if isinstance(data.get("seen"), dict):   # a stretch of the source was played for so many seconds: note it on the candidate it is
        try:
            a, b, secs = float(data["seen"]["in"]), float(data["seen"]["out"]), min(600.0, max(0.0, float(data["seen"]["seconds"])))
        except (KeyError, TypeError, ValueError):
            a = b = secs = 0.0
        cands = (read_json(REELS / src_id / "analysis.json") or {}).get("candidates", [])
        best = max(cands, key=lambda c: min(b, c["out"]) - max(a, c["in"]), default=None)
        if secs and best and min(b, best["out"]) - max(a, best["in"]) > 0.5 * (best["out"] - best["in"]):
            was = state["seen"].setdefault(f"{best['in']}-{best['out']}", {"plays": 0, "seconds": 0.0})
            was["plays"], was["seconds"] = was["plays"] + 1, round(was["seconds"] + secs, 1)
    if "posted" in data:
        reel, platform = str(data["posted"].get("reel")), str(data["posted"].get("platform"))
        done = set(state["posted"].get(reel, [])) - {platform}
        state["posted"][reel] = sorted(done | {platform} if on else done)
    safe.write_json(REELS / src_id / "ui.json", state, indent=1)
    return state


def edl_version(src_id):
    """Changes whenever reels.json is written, by this server or by anything else (an editor, Claude Code)."""
    path = REELS / src_id / "reels.json"
    return str(path.stat().st_mtime_ns) if path.exists() else "0"


def phrase_part(p, start, end):
    """The part of phrase p said between start and end, or None.

    The recogniser sometimes hears a long stretch as one phrase that starts before the moment or runs
    past it. Its words are spread evenly over its time, and the words whose middle falls inside are kept.
    """
    if start <= p["t"] and p["end"] <= end:
        return p
    words = p["text"].split()
    if not words or p["end"] <= start or p["t"] >= end:
        return None
    step = max(p["end"] - p["t"], 0.1) / len(words)
    keep = [i for i in range(len(words)) if start <= p["t"] + step * (i + 0.5) < end]
    if not keep:
        return None
    return {"t": round(p["t"] + step * keep[0], 2), "end": round(min(p["t"] + step * (keep[-1] + 1), p["end"]), 2),
            "text": " ".join(words[keep[0]:keep[-1] + 1])}


def sentences(p, most=12):
    """A phrase as captions: sound labels like "(coughs)" and the recogniser's "-" for a new speaker left
    out, and more than `most` words split into one caption per sentence (or per `most` words), timed evenly."""
    words = [w for w in re.sub(r"[(\[][^)\]]*[)\]]", " ", p["text"]).replace(" -", " ").lstrip("-").split() if w != "-"]
    if not words:
        return []
    if len(words) <= most:
        return [{**p, "text": " ".join(words)}]
    step, out, first = (p["end"] - p["t"]) / len(words), [], 0
    for i, w in enumerate(words):
        if re.search(r"[.!?]$", w) or i + 1 - first >= most or i == len(words) - 1:
            out.append({"t": round(p["t"] + step * first, 2), "end": round(p["t"] + step * (i + 1), 2),
                        "text": " ".join(words[first:i + 1])})
            first = i + 1
    return out


def spoken_once(transcript, start, end):
    """What was said between start and end, each stretch of speech once, in time order.

    Candidate windows overlap, so one stretch can be transcribed twice: as the same phrase, or with
    other words and a cruder time. The window that covers most of start..end is read first; a phrase
    from another window is left out when the phrases kept already cover half of its time, or hold most
    of its letters. A phrase that only partly falls between start and end counts with its words that do.
    """
    letters = lambda text: re.sub(r"\W", "", text.lower())
    overlap = lambda a, b: max(0.0, min(b, end) - max(a, start))
    windows = sorted((transcript or {}).get("candidates", []), key=lambda c: -overlap(c["in"], c["out"]))
    kept = []
    for c in windows:
        for p in c["phrases"]:
            p = phrase_part(p, start, end)
            if not p or p["t"] >= end - 0.5:
                continue
            around = [k for k in kept if k["t"] < p["end"] and p["t"] < k["end"]]
            covered = sum(min(k["end"], p["end"]) - max(k["t"], p["t"]) for k in around)
            mine = letters(p["text"])
            near = "".join(letters(k["text"]) for k in sorted(around, key=lambda k: k["t"]))
            held = sum(b.size for b in difflib.SequenceMatcher(None, mine, near, autojunk=False).get_matching_blocks())
            if mine and covered < 0.5 * (p["end"] - p["t"]) and held < 0.6 * len(mine):
                kept.append(p)
    return sorted(kept, key=lambda p: p["t"])


# ---- suggested texts for a new reel

# Link writes a first title, hook and post text for every reel it makes, from what is said in it and
# where it came from, so nothing is left empty: the user reads them over and changes what they like.
# No outside service is asked; it is a choice among the reel's own sentences.
PLATFORMS = ("YouTube Shorts", "TikTok")
FILLERS = re.compile(r"^(?:yeah|yea|yes|no|okay|ok|um+|uh+|oh|well|so|and|but|like|i mean|you know|right|alright|hey|bro|man|dude)[,.!\s]+", re.I)
STRONG = re.compile(r"\b(?:never|always|no way|what|why|how|who|wait|crazy|insane|wild|unreal|best|worst|first|last|win|won|lose|lost|resign|quit|dead|kill|"
                    r"killed|money|million|thousand|dollars?|free|banned?|broke|broken|fight|scared|love|hate|cheat|clutch|record|world|god|"
                    r"impossible|perfect|huge|biggest|actually|literally)\b|\d|\$", re.I)


def tidy(sentence):
    """A spoken sentence as a line of text: no music notes, no stutter of fillers at its start."""
    s = re.sub(r"[♪♫]+", " ", sentence or "")
    s = re.sub(r"^\s*[-–—]+\s*", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    for _ in range(3):
        s = FILLERS.sub("", s).strip()
    return s[:1].upper() + s[1:] if s else ""


def sentence_score(s):
    words = s.split()
    n = len(words)
    if n < 3:
        return -5
    score = 3 - abs(n - 8) * 0.35                       # about eight words reads at a glance
    score += 1.5 if s.endswith("?") else 1.0 if s.endswith("!") else 0
    score += min(3, len(STRONG.findall(s))) * 1.2
    score -= 2 if len(set(w.lower().strip(".,!?") for w in words)) < n * 0.6 else 0   # the same words over and over
    score -= 1.5 if s.endswith(("...", "…", ",")) else 0                              # a sentence that was cut off
    return score


def short_line(s, limit):
    """The sentence cut to `limit` characters at a word, without the dots of a cut."""
    s = s.rstrip(" .,;:")
    if len(s) <= limit:
        return s
    cut = s[:limit + 1].rsplit(" ", 1)[0].rstrip(" .,;:-")
    return cut or s[:limit]


DANGLING = {"i", "a", "an", "the", "to", "of", "if", "and", "or", "but", "with", "like", "at", "in", "on", "for", "what", "that", "this", "is", "are", "was", "my",
            "your", "you", "we", "it", "it's", "i'm", "so", "just", "really", "very", "how", "when", "then", "than", "be", "been", "have", "had", "hadn't", "do", "don't"}


def hook_lines(s):
    """The hook as it goes on screen: capitals, at most two lines of about 18 letters (a backslash and
    N break the line). A sentence too long for that is cut at a comma if it has one, and never left hanging on a
    word like "the" or "if"."""
    s = re.sub(r"[.]+$", "", s).strip()
    if len(s) > 38:
        clause = next((c.strip() for c in re.split(r"[,;:]", s) if 10 <= len(c.strip()) <= 38), "")
        words = (clause or short_line(s, 38)).split()
        while len(words) > 3 and words[-1].lower().strip(",.'") in DANGLING:
            words.pop()
        s = " ".join(words)
    words = s.upper().split()
    if len(" ".join(words)) <= 20:
        return " ".join(words)
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
    return " ".join(words[:best]) + "\\N" + " ".join(words[best:])


def best_hook(ranked):
    """The sentence the hook is made of: the best one that fits on screen whole, else the best one cut."""
    whole = next((s for s in ranked if len(s.rstrip(" .")) <= 38 and len(s.split()) >= 3 and sentence_score(s) > 0), None)
    return hook_lines(whole or ranked[0])


def suggest_texts(src_id, start, captions):
    """{title, hook, platforms} for a reel of this tape that starts at `start` with these captions."""
    d = REELS / src_id
    ingest = read_json(d / "ingest.json") or {}
    kick = ingest.get("chat")                                   # the Kick or Twitch channel it was recorded from, if it was one
    site = "Twitch" if ingest.get("chat_site") == "twitch" else "Kick"
    who = kick or tape_name(d, ingest) or ingest.get("title") or ""   # a channel, the tape's own name, or the video's name
    lines = [t for t in (tidy(c.get("text", "")) for c in captions) if t]
    ranked = sorted(lines, key=sentence_score, reverse=True)
    best = ranked[0] if ranked and sentence_score(ranked[0]) > -5 else ""
    second = next((s for s in ranked[1:] if s != best and sentence_score(s) > 0), "")
    at = f"{int(start // 60)}:{int(start % 60):02d}"
    if best:
        quote = short_line(best, 70) + ("" if best[-1:] in "?!" and len(best) <= 70 else "")
        title = f"{who}: {quote}" if who else quote
        hook = best_hook(ranked)
    else:                                                        # nothing was said: a plain, honest line
        title = (who if len(who) > 30 else f"{who} at {at}") if who else f"The moment at {at}"   # a video's own name stands by itself
        hook = "WAIT FOR IT"
    title = short_line(title, 95)
    tag = re.sub(r"[^a-z0-9]", "", who.lower())
    tag = tag if len(tag) <= 24 else ""   # a channel's name makes a tag; a whole video title does not
    game = re.sub(r"[^a-z0-9]", "", str((ingest.get("stream") or {}).get("category") or "").lower())   # the category Kick's API gave, see kick_api.py
    game = game if 2 <= len(game) <= 24 and game != tag else ""
    tags = " ".join(t for t in (f"#{tag}" if tag else "", f"#{game}" if game else "", f"#{site.lower()}" if kick else "", "#clips", "#streamer" if kick else "", "#viral") if t)
    credit = f"🎥 {who} on {site}" if kick else (f"🎥 {who}" if who else "")
    body = "\n\n".join(x for x in (second and f"“{short_line(second, 140)}”", credit) if x)
    return {
        "title": title, "hook": hook,
        "platforms": {
            "YouTube Shorts": {"title": short_line(title, 90), "description": "\n\n".join(x for x in (body, f"#shorts {tags}".strip()) if x)},
            "TikTok": {"title": short_line(title, 90), "description": "\n\n".join(x for x in (short_line(best or title, 120) + " 👀", credit, f"#fyp {tags}".strip()) if x)},
        },
    }


def add_reel(src_id, data):
    """Add a reel for candidate {"rank": n} or for any stretch {"in": seconds, "out": seconds}."""
    d = REELS / src_id
    analysis = read_json(d / "analysis.json")
    if not analysis:
        return None, "No such source."
    if "rank" in data:
        cand = next((c for c in analysis["candidates"] if c["rank"] == data["rank"]), None)
        if not cand:
            return None, "No such candidate."
        # Cut the way the user chose (Settings > Learning), each end on a scene cut or in a pause, then moved
        # the way the user moves cuts once Link has learned that (learn.py). The candidate's own stretch if any of it fails.
        try:
            start, end, notes = learn.cut_for(cand, analysis.get("mode", "clip"), analysis["info"]["duration"],
                                              tape=learn.Tape(d, make_audio=False), air=settings.get("cut", "balanced"))
        except Exception:  # noqa: BLE001
            start, end, notes = cand["in"], cand["out"], []
        taken = [r for r in (read_json(d / "reels.json") or {}).get("reels", []) if r["in"] < end and r["out"] > start]
        if taken and not any(r["in"] < cand["out"] and r["out"] > cand["in"] for r in taken):
            start, end, notes = cand["in"], cand["out"], []   # the wider cut would run into another reel: the candidate's own stretch does not
    else:
        notes = None
        start, end = data.get("in"), data.get("out")
        if not all(isinstance(v, (int, float)) for v in (start, end)):
            return None, "In and Out must be numbers."
        if not 0 <= start < end <= analysis["info"]["duration"] or not 3 <= end - start <= MAX_CLIP:
            return None, f"In and Out must lie inside the source and be 3 to {MAX_CLIP} seconds apart."
    src = Path(analysis["source"])
    edl = read_json(d / "reels.json") or {
        "source": src.relative_to(ROOT).as_posix() if src.is_relative_to(ROOT) else str(src),
        "language": "English",
        "style": {"zoom": default_zoom(analysis)} if default_zoom(analysis) != 1.0 else {},
        "reels": [],
    }
    clash = next((r for r in edl["reels"] if r["in"] < end and r["out"] > start), None)
    if clash:
        return None, f"That stretch overlaps {clash['id']}."
    phrases = spoken_once(read_json(d / "transcript.json"), start, end)
    # What was said during the moment, as a starting point; times are relative to the reel start.
    captions = [{"t": round(max(0.0, s["t"] - start), 1), "end": round(min(s["end"], end) - start, 1),
                 "text": s["text"]} for p in phrases for s in sentences(p)]
    new_id = next_post_id()
    edl["reels"].append({"id": new_id, "slug": f"moment_{int(start)}", "in": start, "out": end,
                         **suggest_texts(src_id, start, captions), "captions": captions})
    edl["reels"].sort(key=lambda r: r["in"])
    write_edl(d / "reels.json", edl)
    # The cut the reel was made with (Link's, or the one typed by hand), kept so that a later trim can be told from it (learn.cuts_made)
    ui = ui_state(src_id)
    ui["proposed"][new_id] = [start, end]
    safe.write_json(d / "ui.json", ui, indent=1)
    return edl, None, notes or []


def save_edl(src_id, edl):
    """Write the edit list; rewrite the post file of each rendered reel whose post text changed."""
    path = REELS / src_id / "reels.json"
    old = {r["id"]: r for r in (read_json(path) or {}).get("reels", [])}
    write_edl(path, edl)
    gone = [r for i, r in old.items() if i not in {x["id"] for x in edl["reels"]}]
    if gone:   # a reel that was made and removed again: Link takes that moment as a no (learn.py)
        ui = ui_state(src_id)
        ui["removed"] = (ui["removed"] + [[r["in"], r["out"]] for r in gone])[-200:]
        for r in gone:
            ui["proposed"].pop(r["id"], None)
        safe.write_json(REELS / src_id / "ui.json", ui, indent=1)
    text = ("title", "platforms", "post_caption")
    changed = [r["id"] for r in edl["reels"] if (FINALS / final_name(r)).exists()
               and any(r.get(k) != old.get(r["id"], {}).get(k) for k in text)]
    if not changed:
        return []
    res = subprocess.run([sys.executable, str(TOOLS / "build_reels.py"), str(path), "--posts-only", "--only", *changed],
                         cwd=ROOT, capture_output=True, text=True)
    return changed if res.returncode == 0 else []


def source_clip(src_id, start, end, gentle=False):
    """A small mp4 of one stretch of the source: browsers cannot play the mkv recording itself.
    `gentle`: made ahead, in the background (warm_clips): at low priority and on two threads, so a
    recording or a render running at the same time does not feel it."""
    analysis = read_json(REELS / src_id / "analysis.json")
    if not analysis or not 0 <= start < end <= analysis["info"]["duration"] + 1 or end - start > MAX_CLIP:
        return None
    # "hd2": 720 lines, a key picture every half second. Earlier kinds (clip_<in>_<out>.mp4 at 360 lines,
    # clip_hd_ with key pictures seconds apart) are cleared away as new ones are made.
    out = REELS / src_id / "preview" / f"clip_hd2_{start:g}_{end:g}.mp4"
    with clip_lock:
        if not out.exists():
            out.parent.mkdir(exist_ok=True)
            tmp = out.with_name(out.stem + ".part.mp4")
            for old in [*out.parent.glob("clip_[0-9]*.mp4"), *out.parent.glob("clip_hd_*.mp4")]:
                old.unlink(missing_ok=True)
            # Same loudness target as the finished reels, so a quietly recorded source is still audible.
            audio = (["-af", "aresample=async=1:first_pts=0,loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k", "-ar", "48000"]
                     if analysis["info"]["has_audio"] else ["-an"])
            # -t after -i, as in build_reels.py: otherwise a recording of Link's own can run long.
            quiet = {"creationflags": getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)} if gentle else {}
            res = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:g}",
                                  "-i", analysis["source"], "-t", f"{end - start:g}", "-vf", PREVIEW_PICTURE,
                                  *(["-threads", "2"] if gentle else []),
                                  # a key picture every half second: the timeline's knob can then be dragged
                                  # through the preview and the picture follows without stuttering
                                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-g", "15", *audio,
                                  "-movflags", "+faststart", str(tmp)], capture_output=True, **quiet)
            if res.returncode != 0:
                return None
            tmp.replace(out)
    return out


def warm_clips(src_id, clips):
    """Make these previews ahead, one after the other, in the order given (the page sends the candidates
    after the one being looked at first). A preview the user asks for meanwhile is made between two of
    these, so it waits for one at most. A newer request takes this one's place."""
    warming["turn"] += 1
    turn = warming["turn"]

    def work():
        for start, end in clips[:60]:
            if warming["turn"] != turn:
                return
            try:
                source_clip(src_id, start, end, gentle=True)
            except Exception:  # noqa: BLE001  a preview that cannot be made ahead is made when it is asked for
                pass
            time.sleep(0.05)   # room for a preview that is wanted now

    threading.Thread(target=work, daemon=True).start()


def source_strip(src_id, frames=8):
    """One picture of the whole tape for the Sources screen: eight frames, evenly spread, side by side."""
    analysis = read_json(REELS / src_id / "analysis.json")
    if not analysis or not analysis.get("info", {}).get("duration"):
        return None
    out = REELS / src_id / "preview" / "strip.jpg"
    with clip_lock:
        if not out.exists():
            out.parent.mkdir(exist_ok=True)
            tmp = out.with_name("strip.part.jpg")
            length = analysis["info"]["duration"]
            inputs, chain = [], []
            for i in range(frames):   # a seek per frame is far quicker than reading the whole video
                inputs += ["-ss", f"{length * (i + 0.5) / frames:.2f}", "-i", analysis["source"]]
                chain.append(f"[{i}:v]scale=160:90:force_original_aspect_ratio=increase,crop=160:90,setsar=1[f{i}]")
            graph = ";".join(chain) + ";" + "".join(f"[f{i}]" for i in range(frames)) + f"hstack=inputs={frames}"
            res = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph,
                                  "-frames:v", "1", "-q:v", "5", str(tmp)], capture_output=True)
            if res.returncode != 0:
                return None
            tmp.replace(out)
    return out


def candidate_strip(src_id, sheet):
    """Three frames of one candidate side by side, cut from its contact sheet (six frames across):
    the first, one from the middle and one near the end. For the rows of the Candidates list."""
    source = REELS / src_id / sheet
    if not source.is_file():
        return None
    out = REELS / src_id / "preview" / f"row_{source.stem}.jpg"
    with clip_lock:
        if not out.exists():
            out.parent.mkdir(exist_ok=True)
            tmp = out.with_name(out.stem + ".part.jpg")
            cell = "w=iw/6:h=iw*3/32"   # a frame of the sheet: a sixth of its width, 16:9
            rows = "floor(ih/(iw*3/32)+0.5)"
            graph = (f"[0:v]split=3[a][b][c];[a]crop={cell}:x=0:y=0,scale=160:90[f0];"
                     f"[b]crop={cell}:x=iw/2:y=floor({rows}/2)*iw*3/32,scale=160:90[f1];"
                     f"[c]crop={cell}:x=iw*2/3:y=max(0\\,{rows}-2)*iw*3/32,scale=160:90[f2];[f0][f1][f2]hstack=inputs=3")
            res = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-filter_complex", graph,
                                  "-frames:v", "1", "-q:v", "5", str(tmp)], capture_output=True)
            if res.returncode != 0:
                return None
            tmp.replace(out)
    return out


def own_recording(file):
    """The path of one of Link's own recordings in the recording folder, or None: nothing else is named or thrown away from the page."""
    p = Path(str(file or ""))
    try:
        inside = p.resolve().parent == RECORDINGS.resolve()
    except OSError:
        inside = False
    return p if inside and p.is_file() and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mp4", p.name) else None


def tape_of(rec):
    """The SRC id of the tape made (or being made) from a recording, or None."""
    return next((src_id for src_id, about, _ in tapes() if os.path.normcase(about["original"]) == os.path.normcase(str(rec))), None)


def name_recording(file, name):
    """Call a recording what the user typed when it stopped. Returns (error, {"tape": id or None})."""
    rec = own_recording(file)
    if not rec:
        return "That recording is not there.", None
    name = " ".join(str(name or "").split())[:80]
    tape = tape_of(rec)
    if tape:   # it became a tape already (Link processed it while the question was open): name the tape
        rename_tape(tape, name)
    elif name:
        safe.write_json(rec.with_suffix(".name.json"), {"name": name})   # ingest.py gives it to the tape
    else:
        rec.with_suffix(".name.json").unlink(missing_ok=True)
    return None, {"tape": tape, "name": name}


def kind_of_recording(file, content, game):
    """Keep what kind of video the user said a recording is when it stopped, beside it, for ingest.py to
    analyse it as ("auto": Link makes it out itself, and nothing is kept). Returns (error, {"content", "game"})."""
    rec = own_recording(file)
    if not rec:
        return "That recording is not there.", None
    if content not in ("auto", *CONTENT_KINDS) or (game is not None and (content != "shooter" or game not in ("valorant", "cs2"))):
        return "Link does not know that kind of content.", None
    if content == "auto":
        rec.with_suffix(".content.json").unlink(missing_ok=True)
    else:
        safe.write_json(rec.with_suffix(".content.json"), {"content": content, **({"game": game} if game else {})})
    return None, {"content": content, "game": game}


def discard_recording(file):
    """Throw a recording away: it and what Link kept beside it go to the Recycle Bin. Returns (error, removed)."""
    rec = own_recording(file)
    if not rec:
        return "That recording is not there.", None
    if tape_of(rec) or (JOB.state["running"] and str(rec) in subprocess.list2cmdline([str(f) for f in JOB.state.get("files", [])])):
        return "This recording is a tape already. Delete the tape in Sources: its recording goes with it.", None
    if os.name != "nt":
        return "Throwing a recording away needs Windows' Recycle Bin.", None
    gone = [rec, *(rec.with_name(rec.stem + b) for b in BESIDE if rec.with_name(rec.stem + b).is_file())]
    if not recycle(gone):
        return "Windows could not move it to the Recycle Bin.", None
    pending(drop=[str(rec)])
    return None, [p.name for p in gone]


def recycle(paths):
    """Puts files and folders in Windows' Recycle Bin, so what was deleted can be brought back."""
    import ctypes
    from ctypes import wintypes

    class Op(ctypes.Structure):   # SHFILEOPSTRUCTW
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", ctypes.c_void_p), ("pTo", ctypes.c_void_p),
                    ("fFlags", ctypes.c_uint16), ("aborted", wintypes.BOOL), ("mappings", ctypes.c_void_p), ("title", ctypes.c_void_p)]

    names = ctypes.create_unicode_buffer("\0".join(str(p) for p in paths) + "\0")   # each name ends with a zero, the list with two
    # delete, to the bin (ALLOWUNDO), without asking or showing anything (the page asked already)
    op = Op(None, 3, ctypes.cast(names, ctypes.c_void_p), None, 0x40 | 0x10 | 0x4 | 0x400, False, None, None)
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 and not op.aborted


def delete_tape(src_id, recording=False):
    """Takes a tape away: its folder and its copy of the video go to the Recycle Bin. With `recording`,
    so does the recording it was made from, if that is still in the recordings folder. Finished reels
    and their post texts stay. Returns (error, what was removed)."""
    folder = REELS / src_id
    if not folder.is_dir():
        return "There is no such tape.", []
    if JOB.state.get("running"):
        return "Link is busy processing or rendering. Delete the tape when that is done.", []
    if os.name != "nt":
        return "Deleting a tape needs Windows' Recycle Bin.", []
    analysis, ingest = read_json(folder / "analysis.json") or {}, read_json(folder / "ingest.json") or {}
    gone = [folder]
    video = Path(analysis.get("source") or "")
    if video.is_file() and (ROOT / "videos" / "sources").resolve() in video.resolve().parents:   # only Link's own copy
        gone.append(video)
    original = Path(ingest.get("original") or "")
    if recording and ingest.get("original") and original.is_file() and RECORDINGS.resolve() in original.resolve().parents:
        gone.append(original)
        for beside in BESIDE:   # its highlight marks, its chat counts, the page's name, its ads, the stream's name
            extra = original.with_name(original.stem + beside)
            if extra.is_file():
                gone.append(extra)
    with clip_lock:   # not while a preview of it is being cut
        if not recycle(gone):
            return "Windows would not move the tape to the Recycle Bin. Close anything that has its video open and try again.", []
    return None, [p.name for p in gone]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, base, rel):
        path = (base / rel).resolve()
        if not path.is_relative_to(base.resolve()) or not path.is_file():
            return self.send_json({"error": "not found"}, 404)
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)):  # video players seek with range requests
            if m.group(1):
                start, end = int(m.group(1)), min(int(m.group(2) or size - 1), size - 1)
            else:
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                return self.end_headers()
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0 and (chunk := f.read(min(1 << 16, left))):
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except ConnectionError:  # the player dropped the request, e.g. after a seek
            pass

    def body(self):
        """What was sent, as a dict. Anything else (not JSON, or JSON that is not an object) is answered
        with a 400 here, and None is returned so that the caller stops."""
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if isinstance(data, dict):
                return data
        except ValueError:   # not JSON, not UTF-8, or a length that is not a number
            pass
        self.send_json({"error": "The request was not understood: it has to be a JSON object."}, 400)
        return None

    def spotify_callback(self):
        """The browser tab Spotify's sign-in page sends back: say how it went, in Link's colours."""
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        try:
            spotify_api.finish_sign_in(params)
            title, text = "Connected to Spotify", "You can close this tab and go back to Link. The player shows what Spotify plays."
        except spotify_api.SpotifyError as e:
            title, text = "Not connected", str(e)
        self.signed_in_page(title, text)

    def youtube_callback(self):
        """The same, for Google's sign-in page."""
        params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        try:
            youtube_api.finish_sign_in(params)
            title, text = "Connected to YouTube", "You can close this tab and go back to Link. Analytics now reads your Shorts."
        except youtube_api.YouTubeError as e:
            title, text = "Not connected", str(e)
        self.signed_in_page(title, text)

    def signed_in_page(self, title, text):
        page = (f'<!doctype html><meta charset="utf-8"><title>Link · {html.escape(title)}</title>'
                '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1d34;color:#f6efdc;'
                'font:16px/1.5 \'Segoe UI\',system-ui,sans-serif"><div style="max-width:440px;padding:28px 32px;'
                'border:2px solid #3f6f7a;border-radius:6px;background:#13243f">'
                f'<h1 style="margin:0 0 8px;font-size:22px;color:#3ddc84">{html.escape(title)}</h1>'
                f'<p style="margin:0">{html.escape(text)}</p></div></body>').encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(page)

    def same_origin(self):
        origin = self.headers.get("Origin")
        return origin is None or origin == f"http://{self.headers.get('Host')}"

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self.send_file(STATIC, "index.html")
        if path.startswith("/static/"):
            return self.send_file(STATIC, path[len("/static/"):])
        if m := re.fullmatch(r"/tape/(SRC-\d+)", path):   # the recording itself, for the player (see plays)
            analysis = read_json(REELS / m.group(1) / "analysis.json")
            if not analysis or not plays(analysis["source"]):
                return self.send_json({"error": "not found"}, 404)
            source = Path(analysis["source"])
            return self.send_file(source.parent, source.name)
        if path.startswith("/files/reels/"):
            return self.send_file(REELS, path[len("/files/reels/"):])
        if path.startswith("/files/finals/"):
            return self.send_file(FINALS, path[len("/files/finals/"):])
        if m := re.fullmatch(r"/clip/(SRC-\d+)/(\d+(?:\.\d+)?)_(\d+(?:\.\d+)?)\.mp4", path):
            clip = source_clip(m.group(1), float(m.group(2)), float(m.group(3)))
            return self.send_file(clip.parent, clip.name) if clip else self.send_json({"error": "no clip"}, 404)
        if m := re.fullmatch(r"/strip/(SRC-\d+)/(cand_\d+\.jpg)", path):
            strip = candidate_strip(m.group(1), m.group(2))
            return self.send_file(strip.parent, strip.name) if strip else self.send_json({"error": "no picture"}, 404)
        if m := re.fullmatch(r"/strip/(SRC-\d+)\.jpg", path):
            strip = source_strip(m.group(1))
            return self.send_file(strip.parent, strip.name) if strip else self.send_json({"error": "no picture"}, 404)
        if path == "/api/status":
            return self.send_json({"job": JOB.state, **settings})
        if path == "/api/instagram":
            return self.send_json(instagram_state())
        if path == "/api/kick":
            name = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query)).get("channel")
            if not name or not kick_api.status()["connected"]:
                return self.send_json(kick_api.status())
            try:
                return self.send_json({**kick_api.status(), "channel": kick_api.channel(name)})
            except kick_api.KickError as e:
                return self.send_json({"error": str(e), **kick_api.status()}, 502)
        if path == "/api/spotify":
            return self.send_json(spotify_api.status())
        if path == "/spotify/callback":
            return self.spotify_callback()
        if path == "/api/youtube":
            return self.send_json(youtube_api.status())
        if path == "/youtube/callback":
            return self.youtube_callback()
        if m := re.fullmatch(r"/api/post/(instagram|youtube)/([\w-]{1,40})", path):   # one reel or Short in depth, read now
            try:
                return self.send_json(instagram_api.media_details(m.group(2)) if m.group(1) == "instagram" else youtube_api.video_details(m.group(2)))
            except (instagram_api.InstagramError, youtube_api.YouTubeError) as e:
                return self.send_json({"error": str(e)}, 502)
        if path == "/api/recorder":
            return self.send_json({"folder": str(RECORDINGS)})
        if path == "/api/learned":
            return self.send_json(learned_state())
        if path == "/api/storage":
            mbit = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query)).get("mbit", "")
            return self.send_json(storage.report(storage.link_folders(), int(mbit) if mbit.isdigit() and 0 < int(mbit) <= 100 else 6))
        if path == "/api/about":
            return self.send_json(about())
        if path == "/api/performance":
            return self.send_json(performance())
        if path == "/api/recordings":
            return self.send_json([{"file": str(p), "name": p.name, "size": p.stat().st_size} for p in waiting(RECORDINGS)])
        if path == "/api/unfinished":
            return self.send_json(unfinished())
        if path == "/api/sources":
            return self.send_json(sources())
        if path == "/api/folders":
            return self.send_json(read_folders())
        if m := re.fullmatch(r"/api/sources/(SRC-\d+)", path):
            detail = source_detail(m.group(1))
            return self.send_json(detail or {"error": "not found"}, 200 if detail else 404)
        if m := re.fullmatch(r"/api/sources/(SRC-\d+)/version", path):
            return self.send_json({"version": edl_version(m.group(1))})
        self.send_json({"error": "not found"}, 404)

    def do_PUT(self):
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        if self.path == "/api/folders":
            if (data := self.body()) is None:   # not a JSON object: body() has answered
                return
            error, clean = save_folders(data)
            return self.send_json({"error": error} if error else clean, 409 if error else 200)
        m = re.fullmatch(r"/api/sources/(SRC-\d+)/reels", self.path)
        if not m or not (REELS / m.group(1)).is_dir():
            return self.send_json({"error": "not found"}, 404)
        if (data := self.body()) is None:
            return
        # "base" is the version the page loaded; a different one on disk means someone else saved since.
        if not data.get("force") and data.get("base") != edl_version(m.group(1)):
            return self.send_json({"error": "The edit list changed on disk since this page loaded it.",
                                   "conflict": True}, 409)
        if error := check_edl(data.get("edl")):
            return self.send_json({"error": error}, 400)
        posts = save_edl(m.group(1), data["edl"])
        self.send_json({"ok": True, "version": edl_version(m.group(1)), "posts": posts})

    def start_job(self, data):
        kind, src = data.get("kind"), str(data.get("source"))
        only = ["--only", *map(str, data["only"])] if data.get("only") else []
        if kind == "ingest":  # always named files: the recording just saved, ticked ones, or an upload
            files = [str(f) for f in data.get("files") or []]
            if not files:
                return None, "No video to process."
            if missing := next((f for f in files if not Path(f).is_file()), None):
                return None, f"{Path(missing).name} is not there any more."
            return [sys.executable, str(TOOLS / "ingest.py"), "--file", *files], None
        if kind == "analyze" and re.fullmatch(r"SRC-\d+", src) and (REELS / src).is_dir():   # the tape again, as another kind of content
            content, game = data.get("content"), data.get("game")
            if content not in CONTENT_KINDS or (game is not None and (content != "shooter" or game not in ("valorant", "cs2"))):
                return None, "Link does not know that kind of content."
            return [sys.executable, str(TOOLS / "ingest.py"), "--again", src, "--content", content, *(["--game", game] if game else [])], None
        if kind in ("render", "preview") and re.fullmatch(r"SRC-\d+", src) and (REELS / src).is_dir():
            if kind == "render":
                return [sys.executable, str(TOOLS / "build_reels.py"), str(REELS / src / "reels.json"), "--posts", *only], None
            # A preview renders the edit list as it is in the page, saved or not, into the cache folder.
            if error := check_edl(data.get("edl")):
                return None, error
            folder = REELS / src / "preview"
            folder.mkdir(exist_ok=True)
            write_edl(folder / "reels.json", data["edl"])
            return [sys.executable, str(TOOLS / "build_reels.py"), str(folder / "reels.json"),
                    "--out-dir", str(folder), *only], None
        return None, "unknown job"

    def do_POST(self):
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        if (data := self.body()) is None:
            return
        if m := re.fullmatch(r"/api/sources/(SRC-\d+)/name", self.path):
            named = rename_tape(m.group(1), data.get("name"))
            return self.send_json(named or {"error": "not found"}, 200 if named else 404)
        if m := re.fullmatch(r"/api/sources/(SRC-\d+)/delete", self.path):
            error, gone = delete_tape(m.group(1), bool(data.get("recording")))
            return self.send_json({"error": error} if error else {"ok": True, "removed": gone}, 409 if error else 200)
        if self.path == "/api/jobs":
            cmd, error = self.start_job(data)
            if error:
                return self.send_json({"error": error}, 400)
            # What the page says while it runs: the file's name, and whether it is a recording or an upload
            files = (data.get("files") or []) if data["kind"] == "ingest" else []
            about = {"file": Path(str(files[0])).name, "count": len(files), "recording": bool(data.get("recording")), "files": [str(f) for f in files]} if files else {}
            journal = {k: data[k] for k in ("files", "source", "only", "content", "game") if data.get(k)}
            started = JOB.start(data["kind"], cmd, journal=journal, **about)
            if started and files:
                pending(drop=files)   # from here on the journal and the tape's own folder say how far it got
            return self.send_json({"ok": started, "error": None if started else "Another job is still running."},
                                  200 if started else 409)
        if self.path == "/api/instagram":
            try:
                if data.get("action") == "connect":
                    instagram_api.connect(data.get("token", ""))
                elif data.get("action") == "disconnect":
                    instagram_api.disconnect()
                    return self.send_json(instagram_state())
                elif data.get("action") == "check":   # whether the key may post: asked from Instagram once, then kept
                    instagram_api.can_publish()
                    return self.send_json(instagram_state())
                elif data.get("action") != "refresh":
                    return self.send_json({"error": "unknown action"}, 400)
                fresh = instagram_api.fetch()
                instagram_api.can_publish()
                return self.send_json(instagram_state(fresh))
            except instagram_api.InstagramError as e:
                return self.send_json({"error": str(e), **instagram_state()}, 502)
        if self.path == "/api/youtube":
            action = data.get("action")
            try:
                if action == "client":
                    youtube_api.set_client(data.get("id", ""), data.get("secret", ""))
                elif action == "connect":
                    webbrowser.open(youtube_api.sign_in_url())
                elif action == "refresh":
                    youtube_api.fetch()
                elif action == "disconnect":
                    youtube_api.disconnect()
                elif action == "forget":
                    youtube_api.forget()
                else:
                    return self.send_json({"error": "unknown action"}, 400)
                return self.send_json(youtube_api.status())
            except youtube_api.YouTubeError as e:
                return self.send_json({"error": str(e), **youtube_api.status()}, 502)
        if self.path == "/api/unfinished":   # the window, closing on a recording: process these next time
            return self.send_json({"pending": pending(add=[f for f in data.get("files") or [] if isinstance(f, str)])})
        if self.path == "/api/recordings":
            if data.get("action") == "name":
                error, done = name_recording(data.get("file"), data.get("name"))
            elif data.get("action") == "content":
                error, done = kind_of_recording(data.get("file"), data.get("content"), data.get("game"))
            elif data.get("action") == "discard":
                error, done = discard_recording(data.get("file"))
                done = {"removed": done}
            else:
                return self.send_json({"error": "unknown action"}, 400)
            return self.send_json({"error": error} if error else done, 409 if error else 200)
        if self.path == "/api/learn":
            try:
                return self.send_json(learned_state(learn.learn()))
            except Exception as e:  # noqa: BLE001
                return self.send_json({"error": f"Learning failed: {e}", **learned_state()}, 500)
        if self.path == "/api/publish":
            made, error = publish(data)
            return self.send_json(made if made else {"error": error}, 200 if made else 502)
        if self.path == "/api/kick":
            try:
                if data.get("action") == "connect":
                    kick_api.connect(data.get("id", ""), data.get("secret", ""))
                elif data.get("action") == "disconnect":
                    kick_api.disconnect()
                else:
                    return self.send_json({"error": "unknown action"}, 400)
                return self.send_json(kick_api.status())
            except kick_api.KickError as e:
                return self.send_json({"error": str(e), **kick_api.status()}, 502)
        if self.path == "/api/spotify":
            action = data.get("action")
            try:
                if action == "client_id":
                    spotify_api.set_client_id(data.get("id", ""))
                elif action == "connect":
                    webbrowser.open(spotify_api.sign_in_url())
                elif action == "disconnect":
                    spotify_api.disconnect()
                elif action in spotify_api.ACTIONS:
                    spotify_api.command(action)
                else:
                    return self.send_json({"error": "unknown action"}, 400)
            except spotify_api.SpotifyError as e:
                return self.send_json({"error": str(e), **spotify_api.status()}, 409)
            return self.send_json(spotify_api.status())
        if self.path == "/api/settings":
            if isinstance(data.get("auto"), bool):
                settings["auto"] = data["auto"]
            if data.get("cut") in learn.AIR:
                settings["cut"] = data["cut"]
            if "instagram" in data:
                name = instagram_name(data["instagram"])
                if not name and data["instagram"] != "":  # an empty name forgets the page
                    return self.send_json({"error": "That is not an Instagram page name. Type it like @yourpage."}, 400)
                settings["instagram"] = name or ""
            save_settings()
            return self.send_json(settings)
        if (m := re.fullmatch(r"/api/sources/(SRC-\d+)/warm", self.path)) and (REELS / m.group(1)).is_dir():
            clips = [(float(a), float(b)) for a, b in (data.get("clips") or []) if isinstance(a, (int, float)) and isinstance(b, (int, float)) and 0 <= a < b]
            warm_clips(m.group(1), clips)
            return self.send_json({"ok": True, "clips": len(clips)})
        if (m := re.fullmatch(r"/api/sources/(SRC-\d+)/ui", self.path)) and (REELS / m.group(1)).is_dir():
            return self.send_json(update_ui_state(m.group(1), data))
        if self.path == "/api/discord-copy":
            made = discord_copy(Path(str(data.get("file", ""))).name)
            return self.send_json(made if made else {"error": "not found"}, 200 if made else 404)
        if self.path == "/api/reveal":
            target = (FINALS / str(data.get("file"))).resolve()
            if not target.is_relative_to(FINALS.resolve()) or not target.is_file():
                return self.send_json({"error": "not found"}, 404)
            subprocess.Popen(["explorer", f"/select,{target}"])
            return self.send_json({"ok": True})
        if m := re.fullmatch(r"/api/sources/(SRC-\d+)/reels", self.path):
            edl, error, *notes = add_reel(m.group(1), data)
            return self.send_json({"edl": edl, "cut": notes[0] if notes else []} if edl else {"error": error}, 200 if edl else 409)
        self.send_json({"error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # job output in any language goes to link.log
    load_settings()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    global CUT
    CUT = safe.read_json(JOURNAL)   # after the port is taken: another server that is running has its job in there
    if CUT:
        print(f"A {CUT.get('kind')} job was cut off when Link last closed; the page finishes it.", flush=True)
    sweep()
    print(f"Link UI on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
