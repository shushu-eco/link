"""Pick up new recordings, or a video file of the user's own, register them as sources and analyse them.

Usage:
    python tools/reels/ingest.py [--dir DIR] [--file PATH...] [--no-analyze]

For each video given with --file, or without it for every finished recording in the recording folder
(the user's Videos folder) that has not been ingested yet, newest first:
    videos/sources/SRC-0NN_stream_<date>.<ext>   hard link to the recording (a copy if linking fails)
    videos/reels/SRC-0NN/ingest.json             original path, start time, markers
then runs analyze.py on it (stream mode for long recordings) and, if the whisper model is present,
transcribe.py. The original recording is never moved or deleted.

While a video is being made into a tape its ingest.json says "state": "processing", and how many
times that has been started ("tries"); the last thing a run does is take both out. So a run that
was cut off at any point (Link was closed while it worked, the PC went off, the analysis failed)
leaves a folder that says so. The next run on the same file finishes that tape under the same SRC
id and says "resumed" where it would say "linked": the analysis is done again unless
analysis.json is there, and the transcription in any case. Link does that by itself when it opens
(ui/server.py, /api/unfinished), but only MAX_TRIES times, so a video that cannot be processed is
not tried at every start for ever. A folder with ingest.json and no analysis.json from before this
was written counts as cut off too.

Recordings are recognised by the name Link's recorder (tools/reels/shell) gives them,
"2026-10-02 14-01-16.mp4". The highlights marked while recording are in
"2026-10-02 14-01-16.markers.json" next to it, as seconds into the recording. A recording of a Kick or Twitch
stream also has "2026-10-02 14-01-16.chat.json": the stream's chat speed, messages per second (the
count only), which goes to the analysis with --chat.

A recording made by Link Lite Recorder (the browser extension) is one mp4 with all of that inside it,
in a box at the file's end (see inside()). What is beside a recording is read first, what is inside it
where there is nothing beside it.

--file takes any video, which is how Link's "Upload video" brings in a file of the user's own. A file
that is not named like a recording keeps its name: it becomes videos/sources/SRC-0NN_<name>.<ext>,
and ingest.json has "name" (what the tape is called) instead of "started".

Link itself always names the files: the recording just saved, or the ones the user ticked. The
folder may hold recordings the user never meant to make tapes of (a call, an old test), so a run
without --file is for when the user asks for all of them.
"""
import argparse
import functools
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import safe
from analyze import probe

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCES, REELS = ROOT / "videos" / "sources", ROOT / "videos" / "reels"
RECORDINGS = Path.home() / "Videos"   # ui/server.py tells Link's recorder to save here too
MODEL = HERE / "models" / "ggml-small.bin"
VIDEO_EXT = {".mkv", ".mp4", ".mov", ".flv", ".ts"}
STAMP = r"(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2})"
MIN_REEL = 3   # seconds; the shortest reel the page lets the user make
MAX_TRIES = 2  # how often Link starts a video's processing by itself before it leaves it to the user


TAG = b"LinkLiteRecord01"   # the name of the box Link Lite Recorder writes (extension/offscreen.js, tag())


@functools.lru_cache(maxsize=8)
def inside(rec):
    """What Link Lite Recorder wrote into an mp4: {"markers", "notes", "chat", "ads", "stream"}, or {} for
    a file without it. An mp4 is a row of boxes, each beginning with its length and a name of four
    letters; this one is named "uuid" and then TAG, and holds JSON. The others are stepped over unread."""
    if Path(rec).suffix.lower() != ".mp4":
        return {}
    try:
        with open(rec, "rb") as f:
            end = f.seek(0, os.SEEK_END)
            at = 0
            while at + 8 <= end:
                f.seek(at)
                head = f.read(32)
                size, header = int.from_bytes(head[:4], "big"), 8
                if size == 1:    # a long box: its length is in the eight bytes after its name
                    size, header = int.from_bytes(head[8:16], "big"), 16
                elif size == 0:  # the last box: it runs to the end of the file
                    size = end - at
                if size < header or at + size > end:
                    break        # not a row of boxes (any more)
                if head[4:8] == b"uuid" and head[header:header + 16] == TAG:
                    f.seek(at + header + 16)
                    data = json.loads(f.read(size - header - 16).decode("utf-8"))
                    return data if isinstance(data, dict) else {}
                at += size
    except (OSError, ValueError):
        pass
    return {}


def marked(rec):
    """Highlights marked while recording: seconds into the recording, kept next to it or inside it."""
    try:
        return [float(t) for t in json.loads(rec.with_suffix(".markers.json").read_text(encoding="utf-8"))]
    except (OSError, ValueError, TypeError):
        pass
    try:
        return [float(t) for t in inside(rec).get("markers") or []]
    except (ValueError, TypeError):
        return []


def ad_spans(rec):
    """The stretches in which Twitch played an ad while Link recorded: [[from, to], ...] in seconds, kept next to the recording."""
    try:
        return [[float(a), float(b)] for a, b in json.loads(rec.with_suffix(".ads.json").read_text(encoding="utf-8")) if b > a]
    except (OSError, ValueError, TypeError):
        pass
    try:
        return [[float(a), float(b)] for a, b in inside(rec).get("ads") or [] if b > a]
    except (ValueError, TypeError):
        return []


def read_stream(rec):
    """{"title": ..., "category": ...} kept by Link's recorder next to a recording of a Kick stream, if Kick was connected."""
    try:
        about = json.loads(rec.with_suffix(".stream.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        about = inside(rec).get("stream")
    try:
        return {k: str(about[k])[:200] for k in ("title", "category") if about.get(k)} or None
    except (AttributeError, TypeError):
        return None


def chat_file(rec, keep=None):
    """The chat speed recorded with a Kick or Twitch stream, if there is one: {"channel": name, "site": "kick" or "twitch", "rate": [per second]}.
    Where it is inside the recording and not beside it, it is written out to `keep` (the analysis reads a file)."""
    path = rec.with_suffix(".chat.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return path if isinstance(data.get("rate"), list) else None
    except (OSError, ValueError, AttributeError):
        pass
    data = inside(rec).get("chat")
    if keep is None or not isinstance(data, dict) or not isinstance(data.get("rate"), list):
        return None
    safe.write_json(keep, data)
    return keep


def name_time(path):
    m = re.fullmatch(STAMP, path.stem)  # the whole name: a Game Bar clip "Forza 2026-06-23 02-36-49" is an upload
    return datetime.strptime(m.group(1), "%Y-%m-%d %H-%M-%S") if m else None


def still_writing(path, wait=2.0):
    if time.time() - path.stat().st_mtime > 10:  # untouched for a while: no need to watch it
        return False
    size = path.stat().st_size
    time.sleep(wait)
    return path.stat().st_size != size or time.time() - path.stat().st_mtime < wait


def tapes():
    """Every tape folder's ingest.json as (SRC id, what it says, whether the tape is finished). Not
    finished: its processing was cut off or failed (see the top of this file). A folder made with
    --no-analyze is neither, and one whose ingest.json cannot be read is left out."""
    for f in sorted(REELS.glob("*/ingest.json")):
        about = safe.read_json(f)
        if not isinstance(about, dict) or not about.get("original") or about.get("state") == "registered":
            continue
        yield f.parent.name, about, about.get("state") != "processing" and safe.read_json(f.parent / "analysis.json") is not None


def ingested(finished=True):
    """The files that are tapes already, each with its SRC id; with finished=False the ones whose
    processing was cut off instead."""
    return {os.path.normcase(about["original"]): src_id for src_id, about, done in tapes() if done == finished}


def waiting(folder=RECORDINGS):
    """Link's recordings in the folder that are not tapes yet, newest first."""
    if not folder.is_dir():
        return []
    done = ingested()
    return sorted((p for p in folder.iterdir() if p.suffix.lower() in VIDEO_EXT and re.fullmatch(STAMP, p.stem)
                   and os.path.normcase(str(p)) not in done), reverse=True)


def next_src_id():
    ids = [int(m.group(1)) for p in [*SOURCES.glob("SRC-*"), *REELS.glob("SRC-*")]
           if (m := re.match(r"SRC-(\d+)", p.name))]
    return f"SRC-{max(ids, default=0) + 1:03d}"


def content_of(rec, dest, duration, stream, asked=("auto", None)):
    """(content, game) a new tape is analysed as: what the user chose when the recording stopped (kept beside
    it as <recording>.content.json by the page), else what was asked for on the command line, and for
    "auto" what Link makes of it itself (detect.guess: the stream's category, or a kill feed it knows)."""
    chosen = safe.read_json(rec.with_suffix(".content.json"))
    content, game = (chosen.get("content"), chosen.get("game")) if isinstance(chosen, dict) and chosen.get("content") else asked
    if content != "auto":
        return content, game
    try:
        import detect
        content, game, why = detect.guess(dest, int(duration) + 1, (stream or {}).get("category") or "")
        if content != "general":
            print(f"Taken as {content}{' · ' + game if game else ''}: {why}.", flush=True)
        return content, game
    except Exception as e:  # noqa: BLE001  a guess that fails is no reason not to make the tape
        print(f"What kind of video this is could not be guessed ({e}); it is taken as general.", flush=True)
        return "general", None


def ingest(rec, analyze, begun=None, asked=("auto", None)):
    """`begun` is the SRC id of a tape started from this file whose processing was cut off: it is finished
    under that id, with the copy of the video it already has, instead of a second tape being made."""
    started = name_time(rec)   # None for a file of the user's own, which is called by its name instead
    duration = probe(rec)["duration"]
    markers = sorted({round(t, 1) for t in marked(rec) if 0 < t <= duration + 5})

    src_id = begun or next_src_id()
    label = f"stream_{started:%Y-%m-%d}" if started else re.sub(r"[^a-z0-9]+", "_", rec.stem.lower()).strip("_")[:40] or "video"
    dest = SOURCES / f"{src_id}_{label}{rec.suffix.lower()}"
    SOURCES.mkdir(parents=True, exist_ok=True)
    if begun and dest.is_file():  # ingest.json is written after the link or copy, so this one is whole
        how = "resumed"
    else:
        try:
            os.link(rec, dest)
            how = "linked"
        except OSError:  # different drive, or a file system without hard links
            shutil.copy2(rec, dest)
            how = "copied"
    out_dir = REELS / src_id
    out_dir.mkdir(parents=True, exist_ok=True)
    tries = int((safe.read_json(out_dir / "ingest.json") or {}).get("tries") or 0) + 1 if begun else 1
    about = {
        "original": str(rec), "source": dest.relative_to(ROOT).as_posix(),
        **({"started": started.isoformat(sep=" ")} if started else {"name": rec.stem}),
        "duration": round(duration, 1), "markers": markers,
        **({"chat": (said := json.loads(chat.read_text(encoding="utf-8"))).get("channel"), "chat_site": said.get("site") or "kick"}
           if (chat := chat_file(rec, out_dir / "chat.json")) else {}),
        # what the recorded page called itself (a video's name), kept by Link's recorder next to the recording
        **({"title": json.loads(named.read_text(encoding="utf-8")).get("title")} if (named := rec.with_suffix(".title.json")).is_file() else {}),
        # what Kick's API called the stream and its category when the recording began (see kick_api.py)
        **({"stream": stream} if isinstance(stream := read_stream(rec), dict) else {}),
    }
    # in the works until the last line of this function says otherwise; "registered" is never analysed
    safe.write_json(out_dir / "ingest.json", {**about, **({"state": "processing", "tries": tries} if analyze else {"state": "registered"})}, indent=1)
    # The name the user gave the recording when it stopped (the page asks; ui/server.py keeps it beside the recording)
    given = safe.read_json(rec.with_suffix(".name.json"))
    if isinstance(given, dict) and str(given.get("name") or "").strip() and not (out_dir / "label.json").exists():
        safe.write_json(out_dir / "label.json", {"name": " ".join(str(given["name"]).split())[:80]})
    print(f"{src_id}: {how} {rec.name} -> {dest.relative_to(ROOT).as_posix()} "
          f"({duration / 60:.0f} min, {len(markers)} markers)", flush=True)

    if analyze:
        content, game = content_of(rec, dest, duration, about.get("stream"), asked)
        about = {**about, "content": content, **({"game": game} if game else {})}
        cmd = [sys.executable, str(HERE / "analyze.py"), str(dest), "--content", content, *(["--game", game] if content == "shooter" and game else [])]
        if markers:
            cmd += ["--markers", *map(str, markers)]
        if chat:
            cmd += ["--chat", str(chat)]
        if ads := ad_spans(rec):
            cmd += ["--ads", *(str(t) for span in ads for t in span)]
        if begun and safe.read_json(out_dir / "analysis.json") is not None:
            print("The analysis was finished before; it is kept.", flush=True)
        else:
            subprocess.run(cmd, check=True)
        if MODEL.exists():
            subprocess.run([sys.executable, str(HERE / "transcribe.py"), str(out_dir / "analysis.json")], check=True)
        else:
            print(f"No whisper model at {MODEL.relative_to(ROOT).as_posix()}: skipped transcription.")
        safe.write_json(out_dir / "ingest.json", about, indent=1)   # finished


def again(src_id, content, game):
    """Analyse a tape again as another kind of content (analyze.py --content): its candidates are found
    anew, with what that kind shows counted too, and what is said in them is listened to again. The
    tape's reels are left as they are. What it was analysed as is kept in its ingest.json."""
    out_dir = REELS / src_id
    about = safe.read_json(out_dir / "ingest.json") or {}
    analysis = safe.read_json(out_dir / "analysis.json")
    if not analysis:
        sys.exit(f"{src_id} has no analysis to do again.")
    dest = Path(analysis["source"])
    if not dest.is_file():
        sys.exit(f"The video of {src_id} is not there any more: {dest}")
    markers = about.get("markers") or analysis.get("markers") or []
    rec = Path(about.get("original") or dest)   # the chat and the ads are kept beside the recording it was made from
    # the same first line as a new tape's, so the page shows its three steps for this too
    print(f"{src_id}: resumed {dest.name} -> {dest.name} ({analysis['info']['duration'] / 60:.0f} min, {len(markers)} markers)", flush=True)
    cmd = [sys.executable, str(HERE / "analyze.py"), str(dest), "--out", str(out_dir), "--content", content]
    if content == "shooter" and game:
        cmd += ["--game", game]
    if markers:
        cmd += ["--markers", *map(str, markers)]
    if chat := chat_file(rec, out_dir / "chat.json") or ((out_dir / "chat.json") if (out_dir / "chat.json").is_file() else None):
        cmd += ["--chat", str(chat)]
    if ads := ad_spans(rec):
        cmd += ["--ads", *(str(t) for span in ads for t in span)]
    subprocess.run(cmd, check=True)
    if MODEL.exists():
        subprocess.run([sys.executable, str(HERE / "transcribe.py"), str(out_dir / "analysis.json")], check=True)
    safe.write_json(out_dir / "ingest.json", {**about, "content": content, **({"game": game} if content == "shooter" and game else {})}, indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--again", metavar="SRC-ID", help="analyse this tape again, as --content (and --game)")
    ap.add_argument("--content", choices=["auto", "general", "shooter", "talk", "chatting", "horror", "sports"], default="auto", help="what the video is (analyze.py --content); auto: Link makes it out itself")
    ap.add_argument("--game", choices=["valorant", "cs2"], help="for --content shooter")
    ap.add_argument("--dir", help=f"recording folder (default: {RECORDINGS})")
    ap.add_argument("--file", nargs="+", help="ingest these videos, whatever their names")
    ap.add_argument("--no-analyze", action="store_true", help="register the source only")
    ap.add_argument("--min-seconds", type=int, default=30, help="ignore recordings shorter than this")
    args = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")  # a file name in letters the console cannot show must not stop the ingest
    if args.again:
        return again(args.again, "general" if args.content == "auto" else args.content, args.game)

    if args.file:
        recordings = [Path(f).resolve() for f in args.file]
        for rec in recordings:
            if not rec.is_file():
                sys.exit(f"File not found: {rec}")
            try:
                length = probe(rec)["duration"]
            except (StopIteration, KeyError, ValueError):  # no video stream, or nothing ffprobe can read
                sys.exit(f"{rec.name} is not a video Link can read.")
            if length < MIN_REEL:
                sys.exit(f"{rec.name} is only {length:.1f} s long; a reel needs at least {MIN_REEL} seconds.")
    else:
        # Every recording that is not a tape yet, also ones made long ago: the page asks the user which
        # (ui/server.py, /api/recordings) and passes them with --file instead.
        folder = Path(args.dir).resolve() if args.dir else RECORDINGS
        if not folder.is_dir():
            sys.exit("Recording folder not found; pass --dir or --file.")
        recordings = waiting(folder)
        if not recordings:
            print(f"No new recordings in {folder}.")

    done, begun = ingested(), ingested(finished=False)
    for rec in recordings:
        if args.file and os.path.normcase(str(rec)) in done:
            print(f"Already a tape: {done[os.path.normcase(str(rec))]} was made from {rec.name}.")
    new = [r for r in recordings if os.path.normcase(str(r)) not in done]
    for rec in new:
        if still_writing(rec):
            print(f"Skipped {rec.name}: still being written.")
            continue
        if not args.file and probe(rec)["duration"] < args.min_seconds:
            print(f"Skipped {rec.name}: shorter than {args.min_seconds} s, so probably a test.")
            continue
        ingest(rec, not args.no_analyze, begun.get(os.path.normcase(str(rec))), (args.content, args.game))


if __name__ == "__main__":
    main()
