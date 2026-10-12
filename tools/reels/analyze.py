"""Analyse a source clip and rank candidate reel moments.

Usage:
    python tools/reels/analyze.py videos/sources/SRC-011_ufc_x.mp4 [--out DIR] [--max-reels 15]
    python tools/reels/analyze.py videos/sources/SRC-015_stream_x.mkv --markers 754 3120

Writes to DIR (default videos/reels/<SRC-id>/):
    analysis.json   source info, shot cuts, per-second loudness/motion, ranked candidate moments,
                    plus "problems" (stretches with a black picture, no sound or an ad, which get no
                    candidates) and "level" (whether the whole recording was captured too quiet)

  both modes:
    cand_##.jpg        one sheet per candidate, one frame per second, window plus 5 s either side;
                       labels are "h:mm:ss seconds", grey outside the window

  clip mode (sources up to 10 minutes):
    sheet_###.jpg   contact sheets, one labelled frame per second, 30 s per sheet

  stream mode (longer sources, e.g. a full livestream recording):
    overview_###.jpg   one frame every 30 s, 15 min per sheet
    Scores are relative to the surrounding 5 minutes, and each --markers time (a marked highlight)
    is always a candidate.

  --content KIND: what the recording is, so that what that kind shows counts too (detect.py).
    general   (the default) loudness, movement and chat speed, as always
    talk      a podcast or an interview. The whole recording is listened to once (transcribe.whole,
              speech.json) and the candidates are stretches of talk of 30 to 90 seconds that begin and
              end with a sentence, the liveliest first (detect.talk_moments). Movement does not count.
    chatting  a streamer talking to the chat, a reaction: loudness and the chat's speed; movement
              counts for little; longer stretches (20 to 60 seconds)
    horror    a jump of the sound out of a long quiet counts most (detect.scare), with the quiet
              before it kept in the stretch
    sports    sports, fighting, racing: loudness that holds for seconds (a crowd, a commentator:
              detect.roar) counts above a single bang
    shooter   without --game: loudness for less, movement for more (a game whose kill feed Link does not know).
              With --game valorant|cs2: the kill feed is watched as well. Kills count for more than
              loudness (KILL_WEIGHT), and a candidate that lies in a fight is cut by the fight: from a
              few seconds before its first kill to a few after its last, not a fixed stretch around the
              loudest second. analysis.json then has "content", "game", "kills" (the streamer's rows in
              the kill feed, per second) and each candidate "kills" (the most rows at once in it) and
              "fight" (true when it was cut by a fight).

  --chat FILE (a Kick stream recorded in Link, "<recording>.chat.json"): the chat's speed, messages per
  second, counts towards the score as much as loudness, a few seconds earlier than it was typed, since
  viewers react after the moment. analysis.json then has "chat" (per second) and "chat_channel".
"""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

import safe

ROOT = Path(__file__).resolve().parents[2]
SHEET_COLS, SHEET_ROWS, THUMB_W = 6, 5, 320
STREAM_MIN = 600          # sources longer than this many seconds use stream mode
SCAN_FPS = 4              # frames per second sampled for motion in stream mode
OVERVIEW_STEP = 30        # seconds between overview frames
STREAM_WINDOW = dict(pre=14.0, post=8.0, min_len=15.0, max_len=45.0)
BLACK_MIN = 3             # seconds of black picture that count as a problem
SILENT_LUFS, SILENT_MIN = -65.0, 10   # this quiet (digital silence) for this many seconds counts as "no sound"
CHAT_LAG = 4              # seconds between a moment and the chat reacting to it
CHAT_WEIGHT = 1.0         # how much chat speed counts, against loudness at 1.0
QUIET_PEAK = -35.0        # a recording whose loudest moments stay below this was captured far too quiet
CONTENTS = ("general", "shooter", "talk", "chatting", "horror", "sports")
# What each kind counts, against loudness at 1.0 in "general", and how its stretches are cut (seconds
# before and after the peak, shortest and longest). None: as a recording of its length is cut anyway.
KINDS = {
    "general":  dict(loud=1.0, motion=1.0, chat=1.0, window=None),
    "shooter":  dict(loud=0.6, motion=1.2, chat=1.0, window=None),
    "chatting": dict(loud=1.0, motion=0.3, chat=1.5, window=dict(pre=14.0, post=10.0, min_len=20.0, max_len=60.0)),
    "horror":   dict(loud=0.5, motion=0.5, chat=1.0, scare=2.0, window=dict(pre=14.0, post=8.0, min_len=16.0, max_len=40.0)),
    "sports":   dict(loud=0.7, motion=0.8, chat=1.0, roar=1.6, window=dict(pre=12.0, post=8.0, min_len=15.0, max_len=45.0)),
}
KILL_WEIGHT = 2.0         # shooter: how much the kill feed counts, against loudness at 1.0
SHOOTER_LOUD = 0.6        # shooter: loudness counts for less (the streamer is often quiet in the best fights)
FIGHT_LEAD, FIGHT_TAIL = 6.0, 4.0   # shooter: seconds kept before a fight's first kill and after its last


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def probe(src):
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(src)]).stdout
    info = json.loads(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    fps = [int(n) / int(d) for n, d in (v[k].split("/") for k in ("r_frame_rate", "avg_frame_rate")) if int(d)]
    # A recording made by Link's own recorder has no fixed frame rate: its nominal rate is the
    # clock's (1000 or more), and only the average says how many frames a second there really are.
    return {
        "width": int(v["width"]),
        "height": int(v["height"]),
        "fps": round(next((f for f in fps if 1 <= f <= 240), 30.0), 3),
        "duration": float(info["format"]["duration"]),
        "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
    }


def scene_cuts(src, threshold):
    err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-an",
               "-vf", f"scale=320:-2,scdet=threshold={threshold}", "-f", "null", "-"]).stderr
    return sorted({round(float(t), 2) for t in re.findall(r"lavfi\.scd\.time: ([\d.]+)", err)})


def loudness(src, seconds):
    """Loudest momentary level (LUFS) in each second; crowd roars show up as peaks."""
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-vn",
               "-af", "ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-",
               "-f", "null", "-"]).stdout
    per_sec = np.full(seconds, -70.0)
    t = None
    for line in out.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.match(r"lavfi\.r128\.M=(\S+)", line)
        if m and t is not None:
            try:
                val = float(m.group(1))
            except ValueError:
                continue
            if np.isfinite(val):
                sec = min(int(t), seconds - 1)
                per_sec[sec] = max(per_sec[sec], min(max(val, -70.0), 0.0))
    return per_sec


def scan_video(src, info, out_dir):
    """One decode pass: motion energy per second plus one thumbnail per second for the contact sheets."""
    cap = cv2.VideoCapture(str(src))
    fps = info["fps"]
    step = max(1, round(fps / 6))
    seconds = int(np.ceil(info["duration"]))
    motion, counts = np.zeros(seconds), np.zeros(seconds)
    seen, black = np.zeros(seconds), np.zeros(seconds)
    thumb_h = round(THUMB_W * info["height"] / info["width"])
    thumbs, prev, i = {}, None, 0
    while cap.grab():
        if i % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000 or i / fps
            sec = min(int(t), seconds - 1)
            small = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
            seen[sec] += 1
            black[sec] += is_black(small)
            if prev is not None:
                motion[sec] += float(np.mean(cv2.absdiff(small, prev)))
                counts[sec] += 1
            prev = small
            if sec not in thumbs:
                thumbs[sec] = stamp(cv2.resize(frame, (THUMB_W, thumb_h)), f"{sec // 60}:{sec % 60:02d}")
        i += 1
    cap.release()

    per_sheet = SHEET_COLS * SHEET_ROWS
    blank = np.zeros((thumb_h, THUMB_W, 3), np.uint8)
    sheets = []
    for n, first in enumerate(range(0, seconds, per_sheet)):
        cells = [thumbs.get(s, blank) for s in range(first, min(first + per_sheet, seconds))]
        sheets.append(write_sheet(out_dir / f"sheet_{n:03d}.jpg", cells))

    motion = motion / np.maximum(counts, 1)
    # Shot cuts produce huge one-frame differences; cap them so they don't outrank real action.
    return np.minimum(motion, np.percentile(motion, 95)), sheets, (black == seen) & (seen > 0)


def is_black(gray):
    """A frame with nothing in it: dark and flat. A dark game scene still has detail, so it does not count."""
    return bool(gray.mean() < 12 and gray.std() < 6)


def runs(mask, min_len):
    """[start, end) ranges, in seconds, where mask holds for at least min_len seconds in a row."""
    out, start = [], None
    for i, on in enumerate([*mask, False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def find_problems(black, loud):
    """Stretches that cannot become a reel: no picture (the page showed nothing)
    or no sound at all (nothing was playing, or the video was muted)."""
    problems = [{"kind": "black", "in": a, "out": b} for a, b in runs(black, BLACK_MIN)]
    if loud is not None:
        problems += [{"kind": "silent", "in": a, "out": b} for a, b in runs(loud <= SILENT_LUFS, SILENT_MIN)]
    return sorted(problems, key=lambda p: p["in"])


def stamp(img, label, colour=(255, 255, 255)):
    cv2.putText(img, label, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
    cv2.putText(img, label, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour, 2)
    return img


def write_sheet(path, cells):
    blank = np.zeros_like(cells[0])
    cells = cells + [blank] * (-len(cells) % SHEET_COLS)  # last row may be short
    rows = [np.hstack(cells[i:i + SHEET_COLS]) for i in range(0, len(cells), SHEET_COLS)]
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return path.name


def pipe_frames(pre, src, vf, shape, pix_fmt, log=subprocess.DEVNULL):
    """Yield frames of `shape` from an ffmpeg filter chain; `pre` are input options (seek, hwaccel)."""
    size = int(np.prod(shape))
    proc = subprocess.Popen(["ffmpeg", "-hide_banner", "-nostats", *pre, "-i", str(src), "-an", "-vf", vf,
                             "-f", "rawvideo", "-pix_fmt", pix_fmt, "-"],
                            stdout=subprocess.PIPE, stderr=log, bufsize=size * 16)
    try:
        while len(buf := proc.stdout.read(size)) == size:
            yield np.frombuffer(buf, np.uint8).reshape(shape)
    finally:
        proc.stdout.close()
        proc.wait()


def scan_stream(src, seconds, threshold):
    """Stream-mode scan: motion energy per second and shot cuts from one low-resolution decode."""
    vf = f"fps={SCAN_FPS},scale=160:90,scdet=threshold={threshold},format=gray"
    for pre in (["-hwaccel", "cuda"], []):
        motion, counts = np.zeros(seconds), np.zeros(seconds)
        seen, black = np.zeros(seconds), np.zeros(seconds)
        prev = None
        with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as log:
            for i, frame in enumerate(pipe_frames(pre, src, vf, (90, 160), "gray", log)):
                sec = min(i // SCAN_FPS, seconds - 1)
                seen[sec] += 1
                black[sec] += is_black(frame)
                if prev is not None:
                    motion[sec] += float(np.mean(cv2.absdiff(frame, prev)))
                    counts[sec] += 1
                prev = frame
            log.seek(0)
            cuts = sorted({round(float(t), 2) for t in re.findall(r"lavfi\.scd\.time: ([\d.]+)", log.read())})
        if prev is not None:  # no frames at all means the hardware decoder refused the file
            break
    motion = motion / np.maximum(counts, 1)
    return np.minimum(motion, np.percentile(motion, 95)), cuts, (black == seen) & (seen > 0)


def clock(sec):
    return f"{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}"


def thumb_shape(info):
    return round(THUMB_W * info["height"] / info["width"]), THUMB_W, 3


def overview_sheets(src, info, out_dir):
    shape = thumb_shape(info)
    vf = f"fps=1/{OVERVIEW_STEP},scale={THUMB_W}:{shape[0]}"
    # Keyframes are enough at this spacing and make the pass take seconds instead of minutes.
    cells = [stamp(f.copy(), clock(n * OVERVIEW_STEP))
             for n, f in enumerate(pipe_frames(["-skip_frame", "nokey"], src, vf, shape, "bgr24"))]
    per_sheet = SHEET_COLS * SHEET_ROWS
    return [write_sheet(out_dir / f"overview_{n:03d}.jpg", cells[first:first + per_sheet])
            for n, first in enumerate(range(0, len(cells), per_sheet))]


def candidate_sheets(src, info, candidates, out_dir, margin=5):
    shape = thumb_shape(info)
    for c in candidates:
        first = max(0, int(c["in"]) - margin)
        length = min(int(np.ceil(info["duration"])), int(np.ceil(c["out"])) + margin) - first
        frames = pipe_frames(["-ss", str(first), "-t", str(length)], src,
                             f"fps=1,scale={THUMB_W}:{shape[0]}", shape, "bgr24")
        cells = []
        for sec, f in enumerate(frames, first):
            inside = c["in"] - 1 < sec < c["out"]
            cells.append(stamp(f.copy(), f"{clock(sec)} {sec}", (255, 255, 255) if inside else (150, 150, 150)))
        if cells:
            c["sheet"] = write_sheet(out_dir / f"cand_{c['rank']:02d}.jpg", cells)


def zscore(x):
    s = x.std()
    return (x - x.mean()) / s if s > 1e-9 else np.zeros_like(x)


def chat_speed(path, seconds):
    """(channel, messages per second shifted back by CHAT_LAG and smoothed over 5 s) from a .chat.json."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rate = np.zeros(seconds)
    raw = np.asarray(data.get("rate") or [], dtype=float)[:seconds]
    rate[:len(raw)] = raw
    rate = np.concatenate([rate[CHAT_LAG:], np.zeros(min(CHAT_LAG, seconds))])[:seconds]
    return data.get("channel"), np.convolve(rate, np.ones(5) / 5, mode="same")


def rolling_z(x, window=300):
    """z-score against the surrounding `window` seconds, so a peak is a jump over the minutes around it."""
    if len(x) <= window:
        return zscore(x)
    half = window // 2
    win = np.lib.stride_tricks.sliding_window_view(np.pad(x, half, mode="reflect"), 2 * half + 1)
    mid = np.median(win, axis=1)
    spread = 1.4826 * np.median(np.abs(win - mid[:, None]), axis=1)
    # A silent or frozen stretch has almost no spread; the floor stops tiny changes there scoring as peaks.
    return np.clip((x - mid) / np.maximum(spread, 0.25 * x.std() + 1e-9), -4.0, 8.0)


def snap(t, cuts, tolerance=2.5):
    near = [c for c in cuts if abs(c - t) <= tolerance]
    return min(near, key=lambda c: abs(c - t)) if near else t


def pick_candidates(score, cuts, duration, max_reels, pre=6.0, post=8.0, min_len=8.0, max_len=30.0,
                    markers=(), marker_lead=25.0, avoid=(), shape=None):
    """`shape`: for a kind of content that knows where a moment begins and ends (a fight): given the peak's
    second it answers (start, end), or None where it knows nothing; then the fixed stretch is used."""
    smooth = np.convolve(score, np.ones(5) / 5, mode="same")
    free = np.ones(len(smooth), bool)
    for p in avoid:  # no candidate peaks inside a black or silent stretch
        free[p["in"]:p["out"]] = False
    picked = []

    def take(start, end, peak, **extra):
        for p in [*picked, *avoid]:  # trim against windows already taken and against problem stretches
            if p["in"] <= peak:
                start = max(start, p["out"])
            else:
                end = min(end, p["in"])
        end = min(end, start + max_len)
        free[max(0, int(start)):int(np.ceil(end)) + 1] = False
        free[peak] = False
        if end - start >= min_len:
            picked.append({"in": round(start, 2), "out": round(end, 2), "peak": peak,
                           "score": round(float(smooth[peak]), 2), **extra})

    # A marker is the moment the user pressed Mark highlight: the action is in the seconds before it.
    for m in sorted(markers):
        lo = max(0, int(m - marker_lead))
        hi = min(len(smooth), int(m) + 1)
        if hi > lo:
            take(float(lo), min(duration, m + 3.0), lo + int(np.argmax(smooth[lo:hi])), marked=True)
    while len(picked) < max_reels and free.any():
        peak = int(np.argmax(np.where(free, smooth, -np.inf)))
        if smooth[peak] <= 0:
            break
        own = shape(peak) if shape else None
        if own:
            take(max(0.0, own[0]), min(duration, own[1]), peak, fight=True)
        else:
            take(max(0.0, snap(peak - pre, cuts)), min(duration, snap(peak + post, cuts)), peak)
    for rank, p in enumerate(picked, 1):
        p["rank"] = rank
    return sorted(picked, key=lambda p: p["in"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("--out", help="output directory (default videos/reels/<SRC-id>/)")
    ap.add_argument("--max-reels", type=int, help="default 15 in clip mode, 30 in stream mode")
    ap.add_argument("--scene-threshold", type=float, default=10.0)
    ap.add_argument("--mode", choices=["auto", "clip", "stream"], default="auto",
                    help=f"auto picks stream mode for sources longer than {STREAM_MIN} s")
    ap.add_argument("--markers", type=float, nargs="*", default=[],
                    help="seconds into the source at which a highlight was marked")
    ap.add_argument("--marker-lead", type=float, default=25.0, help="seconds before a marker to include")
    ap.add_argument("--chat", help="the chat speed recorded with a Kick or Twitch stream (<recording>.chat.json)")
    ap.add_argument("--content", choices=CONTENTS, default="general", help="what the recording is (see above)")
    ap.add_argument("--game", choices=["valorant", "cs2"], help="for --content shooter: whose kill feed to watch")
    ap.add_argument("--ads", type=float, nargs="*", default=[],
                    help="stretches in which the stream played an ad, as from to from to ... in seconds; no candidates are taken there")
    args = ap.parse_args()

    src = Path(args.source).resolve()
    src_id = re.match(r"(SRC-\d+)", src.stem)
    out_dir = Path(args.out) if args.out else ROOT / "videos" / "reels" / (src_id.group(1) if src_id else src.stem)
    out_dir.mkdir(parents=True, exist_ok=True)

    info = probe(src)
    seconds = int(np.ceil(info["duration"]))
    stream = args.mode == "stream" or (args.mode == "auto" and info["duration"] > STREAM_MIN)
    if stream:
        motion, cuts, black = scan_stream(src, seconds, args.scene_threshold)
        sheets = overview_sheets(src, info, out_dir)
        # Gameplay moves all the time, so motion counts for less than a jump in loudness.
        norm, motion_weight, window = rolling_z, 0.5, STREAM_WINDOW
    else:
        cuts = scene_cuts(src, args.scene_threshold)
        motion, sheets, black = scan_video(src, info, out_dir)
        norm, motion_weight, window = zscore, 1.0, {}
    shooter = args.content == "shooter" and bool(args.game)
    kind = KINDS.get(args.content, KINDS["general"])
    if kind["window"]:
        window = kind["window"]
    score = kind["motion"] * motion_weight * norm(motion)
    loud = None
    if info["has_audio"]:
        loud = loudness(src, seconds)
        score = score + (SHOOTER_LOUD if shooter else kind["loud"]) * norm(loud)
        if kind.get("scare") or kind.get("roar"):
            import detect
            extra = detect.scare(loud) if kind.get("scare") else detect.roar(loud)
            if extra.max() > 0:   # in decibels: ten of them count as one of loudness's own units
                score = score + (kind.get("scare") or kind.get("roar")) * np.clip(extra / 10.0, 0, 3)
    kills, shape = None, None
    if shooter:
        import detect
        kills = detect.kill_rows(src, args.game, seconds)
        if kills.max() > 0:   # a recording without a kill feed in it says nothing here
            heat = np.convolve(kills, np.ones(5) / 5, mode="same")   # rows stay on screen a while: quick kills pile up
            score = score + KILL_WEIGHT * np.clip(heat / max(1.0, np.percentile(heat[heat > 0], 90)), 0, 1.5) * 3
            least, most = window.get("min_len", 8.0), window.get("max_len", 30.0)

            def shape(peak):
                fight = detect.fight_around(kills, peak)
                if not fight:
                    return None
                start, end = fight[0] - FIGHT_LEAD, fight[1] + FIGHT_TAIL
                if end - start < least:      # a single quick kill: room is added after it
                    end = start + least
                if end - start > most:       # a long fight: the stretch of it around the peak
                    start = min(max(start, peak - most * 0.6), end - most)
                    end = start + most
                return start, end
    chat, chat_channel = None, None
    if args.chat:
        chat_channel, chat = chat_speed(args.chat, seconds)
        if chat.max() > 0:   # a silent chat says nothing about the moments
            score = score + CHAT_WEIGHT * kind["chat"] * norm(chat)
    problems = find_problems(black, loud)
    for a, b in zip(args.ads[::2], args.ads[1::2]):
        a, b = max(0, int(a)), min(seconds, int(np.ceil(b)))
        if b > a:
            problems.append({"kind": "ad", "in": a, "out": b})
    problems.sort(key=lambda p: p["in"])
    # The loudest moments of a healthy recording sit around -20 LUFS; far below that the capture was
    # turned down in the video's own player.
    peak_lufs = round(float(np.percentile(loud, 99)), 1) if loud is not None else None
    spoken = None
    if args.content == "talk" and info["has_audio"]:
        import detect
        import transcribe
        if transcribe.MODEL.exists():
            print("  listening to the whole recording (a talk is cut by what is said)", flush=True)
            spoken = transcribe.whole(src, info["duration"], out_dir / "speech.json")
    if spoken:
        # a talk: the candidates are stretches of sentences; the line on the timeline is how lively the talk is
        candidates, lively = detect.talk_moments(spoken, loud, info["duration"], args.max_reels or (30 if stream else 15))
        candidates = [c for c in candidates if not any(c["in"] < p["out"] and c["out"] > p["in"] for p in problems)]
        score = lively[:seconds] if len(lively) >= seconds else np.pad(lively, (0, seconds - len(lively)))
    else:
        candidates = pick_candidates(score, cuts, info["duration"], args.max_reels or (30 if stream else 15),
                                     markers=args.markers, marker_lead=args.marker_lead, avoid=problems, shape=shape, **window)
    if kills is not None:
        for c in candidates:
            c["kills"] = int(kills[int(c["in"]):max(int(c["in"]) + 1, int(np.ceil(c["out"])))].max())
    candidate_sheets(src, info, candidates, out_dir)   # the page shows these on each candidate
    if chat is not None and chat.mean() > 0:   # how much busier the chat was during each moment than on average
        for c in candidates:
            c["chat"] = round(float(chat[int(c["in"]):max(int(c["in"]) + 1, int(c["out"]))].mean() / chat.mean()), 1)

    analysis = {
        "source": str(src),
        "mode": "stream" if stream else "clip",
        "content": args.content, **({"game": args.game} if shooter else {}),
        "info": info,
        "markers": args.markers,
        "cuts": cuts,
        "motion": [round(float(x), 2) for x in motion],
        "loudness": [round(float(x), 1) for x in loud] if loud is not None else None,
        "score": [round(float(x), 2) for x in score],
        **({"chat": [round(float(x), 2) for x in chat], "chat_channel": chat_channel} if chat is not None else {}),
        **({"kills": [int(x) for x in kills]} if kills is not None else {}),
        "candidates": candidates,
        "sheets": sheets,
        "problems": problems,
        "level": {"peak_lufs": peak_lufs, "quiet": peak_lufs is not None and peak_lufs < QUIET_PEAK},
    }
    safe.write_text(out_dir / "analysis.json", json.dumps(analysis, indent=1))   # whole or not there: ingest.py goes by it
    try:   # the sound, listened to once for what Link learns from (learn.py); the analysis does not depend on it
        import learn
        learn.tape_audio(out_dir, analysis)
    except Exception as e:  # noqa: BLE001
        print(f"  the sound was not read for learning ({e})")

    print(f"{src.name}: {info['width']}x{info['height']} {info['fps']} fps, {info['duration']:.1f} s, "
          f"audio={'yes' if info['has_audio'] else 'no'}, {len(cuts)} cuts, {len(sheets)} sheets, "
          f"{'stream' if stream else 'clip'} mode")
    for c in candidates:
        print(f"  #{c['rank']:>2}  {c['in']:8.2f} - {c['out']:8.2f}  ({c['out'] - c['in']:4.1f} s)  "
              f"peak {c['peak']} s  score {c['score']}{'  marked' if c.get('marked') else ''}"
              f"{'  fight, ' + str(c['kills']) + ' rows' if c.get('fight') else ''}"
              f"{'  ' + ('turn of topic: ' if c.get('turn') else '') + c['begins'][:50] if c.get('talk') else ''}")
    for p in problems:
        what = {"black": "black picture", "ad": "an ad"}.get(p["kind"], "no sound")
        print(f"  PROBLEM {what} {clock(p['in'])} - {clock(p['out'])} ({p['out'] - p['in']} s); no candidates taken there")
    if analysis["level"]["quiet"]:
        print(f"  PROBLEM the whole recording is very quiet (loudest moments {peak_lufs} LUFS; normal is about -20). "
              "Reels are boosted when rendered; turn the video's own volume up before the next recording.")
    print(f"-> {out_dir}")


if __name__ == "__main__":
    main()
