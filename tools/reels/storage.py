"""How much room Link takes on the PC, and whether that is getting out of hand.

Usage:
    python tools/reels/storage.py            print what Settings > Storage shows, as JSON

What is counted, in six parts:
    recordings   Link's own files in the recording folder (names with Link's date stamp: the mp4,
                 its side files, a ".part.webm" still being written). Other videos there are the
                 user's and are not counted.
    tapes        the tapes' videos (videos/sources) and what Link knows about them (videos/reels)
    finals       the finished reels (videos/finals)
    working      what Link made to show things quickly and can make again: clips, strips, previews,
                 Discord copies (videos/reels/*/preview) and the words cache
    data         the sign-ins, settings, log and the built-in browser's cache (%USERPROFILE%\\.link)
    program      Link itself: the speech model, Electron, an installed copy's Python and ffmpeg

A tape's video is a hard link to its recording when both are on one drive: the same bytes under two
names. Every file is counted once, by what it is on the disk, the recording first; a tape's video
whose recording is gone counts under tapes.

The level says whether to worry (judge):
    fine     nothing to say
    watch    the drive is getting full, or Link, its working files or its cache have grown large
    warn     recording is about to run out of room, or Link has grown very large
Each reason is a sentence the user can act on. The numbers below are where those lines are drawn.

Link also keeps track: once a day the measurement is noted in HISTORY (the day, Link's bytes, the
drive's free bytes; the last 120 days). From those notes it works out how fast Link grows and how
fast the drive fills (a straight line through the last 30 days, which a single big day does not
swing), and from that how many days are left until the drive is full. A drive that is filling
fast is worth a word long before it is nearly full.
"""
import datetime
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

GB = 1024 ** 3
DRIVE_WATCH_GB, DRIVE_WATCH_SHARE = 20, 0.10   # the drive: this little room left is worth a word
DRIVE_WARN_GB, RECORD_WARN_HOURS = 5, 1.0       # and this little stops a recording soon
LINK_WATCH_GB, LINK_WARN_GB = 50, 150           # everything of Link's together
WORKING_WATCH_GB, DATA_WATCH_GB = 5, 3          # the parts that only ever grow
MB_A_MINUTE = 7.5                               # of recording, for each Mbit/s of picture quality (Settings > Recording says the same)
STAMP = r"\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}"  # how Link's recorder names a recording
NAMES = {"recordings": "Recordings", "tapes": "Tapes", "finals": "Finished reels", "working": "Working files",
         "data": "Window cache and sign-ins", "program": "Link itself"}
KEEP = 60   # seconds a measurement stands
HISTORY = Path.home() / ".link" / "storage_history.json"
FULL_WATCH_DAYS, FULL_WARN_DAYS = 30, 7         # the drive would be full this soon at the rate it fills
TREND_DAYS, TREND_MIN_DAYS = 30, 3              # the days the rate is worked out over, and the fewest that say anything

_last = (0, None)


def files(folder):
    """Every file under a folder as (path, DirEntry); nothing for a folder that is not there."""
    stack = [str(folder)]
    while stack:
        try:
            entries = list(os.scandir(stack.pop()))
        except OSError:
            continue
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    stack.append(e.path)
                elif e.is_file(follow_symlinks=False):
                    yield e
            except OSError:
                pass


def measure(recordings, sources, reels, finals, data, program):
    """The bytes of each part, each file once, and the three heaviest tapes. `program` is a list of folders."""
    seen, parts = set(), dict.fromkeys(NAMES, 0)

    def once(path):
        """A file's size, or 0 when the same bytes were counted under another name already."""
        try:
            st = os.stat(path)   # not the DirEntry's: on Windows that one has no identity to tell hard links by
        except OSError:
            return 0
        key = (st.st_dev, st.st_ino) if st.st_ino else path
        if key in seen:
            return 0
        seen.add(key)
        return st.st_size

    def size(entry):
        try:
            return entry.stat(follow_symlinks=False).st_size
        except OSError:
            return 0

    try:
        for e in os.scandir(recordings):
            if e.is_file(follow_symlinks=False) and re.match(STAMP + r"\.", e.name):
                parts["recordings"] += once(e.path)
    except OSError:
        pass
    tapes = {}   # SRC id -> what the tape weighs: its video (also when that is the recording's bytes) and its folder
    for e in files(sources):
        parts["tapes"] += once(e.path)
        if m := re.match(r"(SRC-\d+)", e.name):
            tapes[m.group(1)] = tapes.get(m.group(1), 0) + size(e)
    for e in files(reels):
        inside = Path(e.path).relative_to(reels).parts
        working = len(inside) > 2 and inside[1] in ("preview", "words")
        parts["working" if working else "tapes"] += size(e)
        if re.fullmatch(r"SRC-\d+", inside[0]):
            tapes[inside[0]] = tapes.get(inside[0], 0) + size(e)
    for part, folders in (("finals", [finals]), ("data", [data]), ("program", program)):
        for folder in folders:
            parts[part] += sum(size(e) for e in files(folder))
    largest = sorted(tapes.items(), key=lambda t: -t[1])[:3]
    return parts, [{"id": src_id, "bytes": n} for src_id, n in largest if n]


def note(link, free, today=None):
    """Keep today's measurement (one a day, the latest of the day) and give back all that are kept."""
    try:
        days = [d for d in json.loads(HISTORY.read_text(encoding="utf-8")) if isinstance(d, list) and len(d) == 3]
    except (OSError, ValueError):
        days = []
    today = today or datetime.date.today().isoformat()
    days = [d for d in days if d[0] != today][-119:] + [[today, int(link), int(free)]]
    try:
        import safe
        HISTORY.parent.mkdir(parents=True, exist_ok=True)
        safe.write_json(HISTORY, days)
    except OSError:
        pass
    return days


def trend(days):
    """How things move, from the daily notes: {"link_a_day", "free_a_day" (negative: the drive fills),
    "days_left" until the drive is full at that rate (None when it is not filling), "over" (days looked at)}.
    None with too few days to say. The rate is the slope of the straight line that fits the days best."""
    recent = days[-TREND_DAYS:]
    when = [datetime.date.fromisoformat(d[0]).toordinal() for d in recent]
    if len(recent) < 2 or when[-1] - when[0] < TREND_MIN_DAYS:
        return None
    mean = sum(when) / len(when)
    spread = sum((x - mean) ** 2 for x in when)

    def slope(column):
        values = [d[column] for d in recent]
        middle = sum(values) / len(values)
        return sum((x - mean) * (v - middle) for x, v in zip(when, values)) / spread

    link, free = slope(1), slope(2)
    return {"link_a_day": link, "free_a_day": free, "over": when[-1] - when[0],
            "days_left": recent[-1][2] / -free if free < -1024 ** 2 else None}


def show(n):
    """Bytes as the user reads them: 7.4 GB, 340 MB."""
    return f"{n / GB:.1f} GB" if n >= GB else f"{max(1, round(n / 1024 ** 2))} MB" if n else "0 MB"


def hours(free, mbit):
    """How long a recording at this picture quality can run before the drive is full."""
    return free / (max(1, mbit) * MB_A_MINUTE * 1024 ** 2 * 60)


def judge(parts, free, total, mbit, drive="C", largest=(), moving=None):
    """("fine" | "watch" | "warn", [why, in sentences the user can act on]). `moving` is trend()'s answer."""
    link, room = sum(parts.values()), hours(free, mbit)
    tapes = ", ".join(f"{t['id']} ({show(t['bytes'])})" for t in largest)
    make_room = f" The largest tapes are {tapes}; delete the ones you no longer need in Sources." if tapes else ""
    warn, watch = [], []
    if free < DRIVE_WARN_GB * GB or room < RECORD_WARN_HOURS:
        warn.append(f"Drive {drive} has {show(free)} free: room for about {room:.1f} hours of recording at this picture quality. "
                    f"A recording that fills the drive is cut off.{make_room}")
    elif free < DRIVE_WATCH_GB * GB or (total and free / total < DRIVE_WATCH_SHARE):
        watch.append(f"Drive {drive} is getting full: {show(free)} free, room for about {room:.0f} hours of recording.{make_room}")
    left = (moving or {}).get("days_left")
    if left is not None and left < FULL_WATCH_DAYS and free >= DRIVE_WARN_GB * GB:
        (warn if left < FULL_WARN_DAYS else watch).append(
            f"Drive {drive} is filling by about {show(-moving['free_a_day'])} a day: at this rate it is full in about {max(1, round(left))} days."
            + (f" Link itself grows by {show(moving['link_a_day'])} a day." if moving["link_a_day"] > 50 * 1024 ** 2 else " Most of that is not Link's.") + make_room)
    if link > LINK_WARN_GB * GB:
        warn.append(f"Link takes {show(link)}.{make_room}")
    elif link > LINK_WATCH_GB * GB:
        watch.append(f"Link has grown to {show(link)}.{make_room}")
    if parts.get("working", 0) > WORKING_WATCH_GB * GB:
        watch.append(f"The working files take {show(parts['working'])}. They are safe to delete: Link makes a tape's clips and previews again when it needs them.")
    if parts.get("data", 0) > DATA_WATCH_GB * GB:
        watch.append(f"The built-in browser's cache has grown to {show(parts['data'])}. Its \"shell\" folder holds your sign-ins to the sites too, so clearing it signs you out there.")
    return ("warn", warn + watch) if warn else ("watch", watch) if watch else ("fine", [])


def report(folders, mbit=6, fresh=False, track=True):
    """What Settings > Storage shows. `folders` are measure()'s; the measuring is kept for KEEP seconds.
    `track`: note today's measurement in HISTORY (not for a made-up library)."""
    global _last
    if fresh or time.time() - _last[0] > KEEP or _last[1] is None:
        _last = (time.time(), measure(**folders))
    parts, largest = _last[1]
    where = next((p for p in (Path(folders["recordings"]), Path(folders["reels"]).parent, Path.home()) if p.is_dir()), Path.home())
    try:
        disk = shutil.disk_usage(where)   # the drive recordings are saved to: that is the one that fills
        total, free = disk.total, disk.free
    except OSError:
        total = free = 0
    drive = (where.drive or str(where)).rstrip(":")   # "C"
    days = note(sum(parts.values()), free) if total and track else []
    moving = trend(days)
    level, reasons = judge(parts, free, total, mbit, drive, largest, moving) if total else ("fine", [])
    return {"parts": [{"key": k, "name": NAMES[k], "bytes": parts[k], "size": show(parts[k])} for k in sorted(parts, key=lambda k: -parts[k])],
            "link_bytes": sum(parts.values()), "link": show(sum(parts.values())),
            "drive": {"name": drive, "free_bytes": free, "total_bytes": total, "free": show(free), "total": show(total)},
            "hours": round(hours(free, mbit), 1), "mbit": mbit, "largest_tapes": [{**t, "size": show(t["bytes"])} for t in largest],
            "level": level, "reasons": reasons, "measured": _last[0],
            # what the daily notes say: None until there are a few days of them
            "trend": moving and {"link_a_day": show(max(0, moving["link_a_day"])), "growing": moving["link_a_day"] > 1024 ** 2,
                                 "free_a_day": show(abs(moving["free_a_day"])), "filling": moving["free_a_day"] < -1024 ** 2,
                                 "days_left": moving["days_left"] and round(moving["days_left"]), "over": moving["over"]},
            "tracked_days": len(days)}


def link_folders():
    """Where Link's own things are on this PC."""
    from ingest import RECORDINGS, REELS, ROOT, SOURCES
    here = Path(__file__).resolve().parent
    return {"recordings": RECORDINGS, "sources": SOURCES, "reels": REELS, "finals": ROOT / "videos" / "finals",
            "data": Path.home() / ".link", "program": [here / "models", here / "shell" / "node_modules", ROOT / "runtime"]}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(json.dumps(report(link_folders()), indent=1))
