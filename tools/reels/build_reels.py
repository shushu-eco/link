"""Render vertical 9:16 reels from an edit list.

Usage:
    python tools/reels/build_reels.py videos/reels/SRC-011/reels.json [--only POST-009] [--out-dir DIR] [--posts]

reels.json:
    {
      "source": "videos/sources/SRC-011_ufc_x.mp4",
      "language": "English",                    optional, labels the caption in each post file
      "risks": ["..."],                         optional, copied into each post file
      "style": {"caption_size": 112},           optional overrides of STYLE, e.g. {"zoom": 1.5} for gameplay
      "reels": [
        {"id": "POST-009", "slug": "ufc_knockdown", "title": "...",
         "in": 12.5, "out": 27.0,               seconds in the source
         "hook": "CUANDO ...",                  static line in the top blurred bar; \\N forces a line break
         "captions": [{"t": 1.0, "text": "MIRA ESTE GOLPE"}],   t = seconds from reel start, optional "end"
         "style": {"zoom": 1.2},                optional, overrides the edit list's style for this reel
         "platforms": {"YouTube Shorts": {"title": "...", "description": "..."},
                       "TikTok": {"title": "...", "description": "..."}},
         "post_caption": "... #fyp"}            optional single caption instead of / as well as platforms
      ]
    }

Each reel is a blurred-fill vertical: the full source frame centred over a blurred copy of itself,
hook in the top bar, word-by-word pop captions in the bottom bar. A caption whose words are what is
being said at that point is paced by the voice (speech recognition, cached in <edl folder>/words/);
any other caption is paced evenly from its "t". Set style "sync_captions" to false to turn that off. Emoji are dropped from on-screen
text (Impact has no emoji glyphs); they are kept in the post caption.
"""
import argparse
import bisect
import difflib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import safe

ROOT = Path(__file__).resolve().parents[2]
W, H, FPS = 1080, 1920, 30

STYLE = {
    "font": "Impact",
    "hook_size": 84,
    "caption_size": 112,
    "highlight": "&H00FFFF&",   # ASS colours are BGR: yellow
    "chunk_words": 3,           # words on screen at once
    "chunk_chars": 16,          # keeps a chunk on one line at caption_size
    "max_word_time": 0.45,      # seconds per word
    "min_word_time": 0.25,      # a caption with less time than this per word is left out: it could not be read
    "last_word_hold": 1.2,      # how long the final word of a caption stays up
    "sync_captions": True,      # pace a caption by the voice when its words are what is being said
    "zoom": 1.0,                # >1 enlarges the footage and crops its sides (16:9 gameplay)
    "hook_floor": 420,          # hook never sits higher than this (TikTok top UI)
    "caption_ceiling": 1340,    # captions never start lower than this (TikTok bottom UI)
}


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
    info = json.loads(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    num, den = v["r_frame_rate"].split("/")
    return {
        "width": int(v["width"]),
        "height": int(v["height"]),
        "fps": round(int(num) / int(den), 2),
        "codec": v["codec_name"],
        "duration": float(info["format"]["duration"]),
        "size_mb": int(info["format"]["size"]) / 1e6,
        "has_audio": any(s["codec_type"] == "audio" for s in info["streams"]),
    }


def screen_text(s):
    s = s.replace("…", "...").replace("“", '"').replace("”", '"').replace("’", "'")
    s = "".join(c for c in s if ord(c) < 0x2000)
    return re.sub(r"\s+", " ", s.replace("{", "(").replace("}", ")")).strip().upper()


def ass_time(t):
    cs = max(0, round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def chunk_words(words, st):
    chunks, cur = [], []
    for w in words:
        if cur and (len(cur) >= st["chunk_words"] or len(" ".join(cur + [w])) > st["chunk_chars"]):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def letters(text):
    return [c for c in text.lower() if c.isalnum()]


def spoken_letters(reel, src, work_dir):
    """Every letter said during the reel with the time it is said (seconds from the reel start).

    Returns None when there is no speech model. The recognition is cached per in/out in work_dir/words.
    """
    import transcribe
    if not transcribe.MODEL.exists():
        return None
    start, end = float(reel["in"]), float(reel["out"])
    cache = work_dir / "words" / f"{start:g}_{end:g}.json"
    pieces = safe.read_json(cache)
    if pieces is None:
        pieces = transcribe.speech_pieces(src, start, end - start)
        cache.parent.mkdir(exist_ok=True)
        safe.write_json(cache, pieces)
    chars, times = [], []
    for p in pieces:
        found = letters(p["text"])
        # A piece after a pause is reported as starting when the pause began; count back from its end instead.
        t0 = max(p["t"], p["end"] - (0.08 * len(found) + 0.25))
        for k, c in enumerate(found):
            chars.append(c)
            times.append(t0 + (p["end"] - t0) * k / len(found) - start)
    return "".join(chars), times


def spoken_times(words, start, limit, speech):
    """When each caption word is said, or None if the caption is not (mostly) what was said around then."""
    chars, times = speech
    lo = bisect.bisect_left(times, start - 1.0)
    hi = bisect.bisect_right(times, limit + 0.5)
    target = "".join("".join(letters(w)) for w in words)
    if not target or hi <= lo:
        return None
    blocks = difflib.SequenceMatcher(None, target, chars[lo:hi], autojunk=False).get_matching_blocks()
    if sum(b.size for b in blocks) < 0.6 * len(target):
        return None
    at = {b.a + k: times[lo + b.b + k] for b in blocks for k in range(b.size)}
    out, pos = [], 0
    for w in words:
        n = len(letters(w))
        out.append(next((at[i] for i in range(pos, pos + n) if i in at), None))
        pos += n
    # A word the recogniser missed takes its place between its neighbours.
    known = [(i, t) for i, t in enumerate(out) if t is not None]
    for i, t in enumerate(out):
        if t is None:
            before = max((k for k in known if k[0] < i), default=None)
            after = min((k for k in known if k[0] > i), default=None)
            if before and after:
                out[i] = before[1] + (after[1] - before[1]) * (i - before[0]) / (after[0] - before[0])
            else:
                out[i] = (before or after)[1] + 0.3 * (i - (before or after)[0])
    return [max(0.0, t) for t in out]


def caption_events(captions, dur, st, speech=None):
    pop = f"{{\\c{st['highlight']}\\fscx118\\fscy118\\t(0,110,\\fscx100\\fscy100)}}"
    caps = [(float(c["t"]), screen_text(c["text"]).split(), c) for c in captions]
    caps = [c for c in caps if c[1] and c[0] < dur]
    # With speech available, a caption that matches what is said is paced by the voice, word for word.
    spoken = [speech and spoken_times(words, start, caps[i + 1][0] if i + 1 < len(caps) else dur, speech)
              for i, (start, words, _) in enumerate(caps)]
    events, floor = [], 0.0
    for i, (start, words, cap) in enumerate(caps):
        nxt = (spoken[i + 1][0] if spoken[i + 1] else caps[i + 1][0]) if i + 1 < len(caps) else dur
        limit = min(nxt, dur)
        if spoken[i]:
            times = []
            for t in spoken[i]:  # keep the words in order and after the previous caption
                times.append(min(max(t, floor, times[-1] + 0.05 if times else 0.0), dur))
            end = max(min(limit, times[-1] + st["last_word_hold"]), times[-1] + 0.05)
        else:
            start = max(start, floor)
            end = max(min(float(cap["end"]), limit) if "end" in cap else limit, start + 0.05)
            step = min(st["max_word_time"], (end - start) / len(words))
            if step < st["min_word_time"]:  # squeezed in before the next caption: a flicker nobody can read
                print(f"   caption at {start:.1f} s left out: {len(words)} words in {end - start:.1f} s is too fast to read", flush=True)
                continue
            if "end" not in cap:
                end = min(end, start + step * len(words) + st["last_word_hold"])
            times = [start + n * step for n in range(len(words))]
        floor = end
        n = 0
        for chunk in chunk_words(words, st):
            for j in range(len(chunk)):
                t0 = times[n]
                t1 = end if n == len(words) - 1 else times[n + 1]
                text = " ".join(f"{pop}{w}{{\\r}}" if k == j else w for k, w in enumerate(chunk))
                events.append(f"Dialogue: 1,{ass_time(t0)},{ass_time(t1)},Cap,,0,0,0,,{text}")
                n += 1
    return events


def write_ass(path, reel, dur, fg_top, fg_bottom, st, speech=None):
    hook_margin = H - max(fg_top - 40, st["hook_floor"])          # bottom-aligned, grows upward
    cap_margin = min(fg_bottom + 50, st["caption_ceiling"])       # top-aligned, grows downward
    base = "&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1"
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding",
        f"Style: Hook,{st['font']},{st['hook_size']},{base},5,2,2,70,70,{hook_margin},1",
        f"Style: Cap,{st['font']},{st['caption_size']},{base},6,3,8,70,70,{cap_margin},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    hook = screen_text(reel.get("hook", ""))
    if hook:
        lines.append(f"Dialogue: 0,{ass_time(0)},{ass_time(dur)},Hook,,0,0,0,,{{\\fad(200,0)}}{hook}")
    lines += caption_events(reel.get("captions", []), dur, st, speech)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# Every reel at the same loudness: -14 LUFS, the level the platforms play at. The peaks are kept 2 dB
# under full scale; the file's sound format (AAC) overshoots a little, and the platforms encode again.
LOUD = "I=-14:TP=-2:LRA=11"
# A recording can have small holes in its sound (packets due later than the sound before them ends).
# Strung together as they come, the sound would run ahead of the picture after each hole; this fills
# every hole with silence of its own length, so the two stay together. A sound track without holes
# passes through unchanged.
IN_STEP = "aresample=async=1:first_pts=0"


def loudness_filter(reel, src, dur):
    """The filter that brings this reel's sound to the level above. In one pass the filter has to
    guess from what it has heard so far, and a short clip came out up to 2 dB under the mark; so the
    stretch is measured first and the filter is told what it measured."""
    res = run(["ffmpeg", "-hide_banner", "-nostats", "-ss", f"{float(reel['in']):.3f}", "-i", str(src), "-t", f"{dur:.3f}",
               "-vn", "-map", "0:a:0", "-af", f"{IN_STEP},loudnorm={LOUD}:print_format=json", "-f", "null", "-"])
    found = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", res.stderr or "")
    try:
        m = json.loads(found.group(0))
        values = [float(m[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")]   # "-inf" for silence fails here
        if any(v != v or abs(v) == float("inf") for v in values):
            raise ValueError
    except (AttributeError, KeyError, ValueError):
        return f"loudnorm={LOUD}"   # not measurable (no sound to speak of): one pass, as before
    i, tp, lra, thresh, offset = values
    return f"loudnorm={LOUD}:measured_I={i}:measured_TP={tp}:measured_LRA={lra}:measured_thresh={thresh}:offset={offset}:linear=true"


def render(reel, src, src_info, work_dir, out_path, st):
    dur = float(reel["out"]) - float(reel["in"])
    scale = min(W / src_info["width"], H / src_info["height"]) * st["zoom"]
    fg_w = int(src_info["width"] * scale) // 2 * 2
    fg_h = int(src_info["height"] * scale) // 2 * 2
    show_w, show_h = min(fg_w, W), min(fg_h, H)  # zoom overflows the frame; keep the centre
    fg_top = (H - show_h) // 2

    speech = None
    if st["sync_captions"] and reel.get("captions") and src_info["has_audio"]:
        speech = spoken_letters(reel, src, work_dir)
    ass = work_dir / f"{reel['id']}.ass"
    write_ass(ass, reel, dur, fg_top, fg_top + show_h, st, speech)

    graph = (
        f"[0:v]fps={FPS},split=2[a][b];"
        f"[a]scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},"
        f"boxblur=6:2,scale={W}:{H},eq=brightness=-0.06[bg];"
        f"[b]scale={fg_w}:{fg_h},crop={show_w}:{show_h}[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,ass={ass.name},setsar=1,format=yuv420p[v]"
    )
    # -t after -i: as an input option it lets a variable-frame-rate source (Link's own recordings) run
    # seconds past the out point on some ffmpeg versions, picture without sound.
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-ss", f"{float(reel['in']):.3f}", "-i", str(src), "-t", f"{dur:.3f}",
           "-filter_complex", graph, "-map", "[v]"]
    if src_info["has_audio"]:
        fade_out = max(0.0, dur - 0.3)
        cmd += ["-map", "0:a:0",
                "-af", f"{IN_STEP},{loudness_filter(reel, src, dur)},afade=t=in:d=0.15,afade=t=out:st={fade_out:.3f}:d=0.3",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    else:
        cmd += ["-an"]
    # Rendered under another name and put in place when it is whole: a render that is cut off (Link
    # closed, ffmpeg failing) leaves the reel that was there, or none, never half a video under its name.
    part = out_path.with_name(out_path.stem + safe.PART + out_path.suffix)
    tail = ["-movflags", "+faststart", str(part)]
    encoders = (["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "19", "-b:v", "0",
                 "-maxrate", "12M", "-bufsize", "24M"],
                ["-c:v", "libx264", "-preset", "medium", "-crf", "18"])
    for enc in encoders:
        # cwd is the .ass folder so the filter can name the file without Windows path escaping
        res = run(cmd + enc + tail, cwd=work_dir)
        if res.returncode == 0:
            os.replace(part, out_path)
            return
    part.unlink(missing_ok=True)
    sys.exit(f"ffmpeg failed for {reel['id']}:\n{res.stderr}")


def fmt_ts(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def write_post(reel, edl, src_rel, out_rel, info, path):
    audio = "with crowd audio" if info["has_audio"] else "no audio"
    status = "Ready; upload it by hand." + ("" if info["has_audio"] else " Silent file: add a sound.")
    lines = [
        f"# {reel['id']}: {reel.get('title', reel['slug'])}",
        "",
        "| Field | Value |",
        "|---|---|",
        f"| Source footage | `{src_rel}`, {fmt_ts(reel['in'])} to {fmt_ts(reel['out'])} (local edit, no generation, 0 cr) |",
        f"| Final file (upload this) | `{out_rel}` ({info['width']}×{info['height']}, {info['fps']:g} fps, "
        f"{info['duration']:.1f} s, {info['size_mb']:.1f} MB, H.264, blurred-fill vertical, {audio}) |",
        f"| Status | {status} |",
    ]
    language = edl.get("language", "English")
    for platform, text in reel.get("platforms", {}).items():
        lines += ["", f"## {platform} ({language}, copy-paste)",
                  "Title:", "```", text.get("title", ""), "```",
                  "Description:", "```", text.get("description", ""), "```"]
    if "post_caption" in reel:
        lines += ["", f"## Caption ({language}, copy-paste)", "```", reel["post_caption"], "```"]
    lines += [
        "",
        "## On-screen hook (top blurred area)",
        f"`{reel.get('hook', '').replace(chr(92) + 'N', ' ')}`",  # \N is a forced line break on screen
        "",
        "## On-screen captions (word-by-word, bottom blurred area)",
    ]
    lines += [f"- {c['t']:g} s: `{c['text']}`" for c in reel.get("captions", [])] or ["- none"]
    risks = reel.get("risks", edl.get("risks", []))
    if risks:
        lines += ["", "## Risks"] + [f"- {r}" for r in risks]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def validate(reels, src_dur):
    errors = []
    for r in reels:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", f"{r['id']}{r['slug']}"):
            errors.append(f"{r['id']}: id and slug may only contain letters, digits, - and _")
        if not 0 <= r["in"] < r["out"] <= src_dur + 0.05:
            errors.append(f"{r['id']}: in/out {r['in']}-{r['out']} outside source (0-{src_dur:.2f})")
    ordered = sorted(reels, key=lambda r: r["in"])
    for a, b in zip(ordered, ordered[1:]):
        if b["in"] < a["out"]:
            errors.append(f"{a['id']} and {b['id']} overlap ({a['in']}-{a['out']} vs {b['in']}-{b['out']})")
    if errors:
        sys.exit("Edit list problems:\n  " + "\n  ".join(errors))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("edl", help="path to reels.json")
    ap.add_argument("--only", nargs="+", help="render only these reel ids")
    ap.add_argument("--out-dir", help="output directory (default videos/finals)")
    ap.add_argument("--posts", action="store_true", help="also write strategy/posts/<id>_<slug>.md")
    ap.add_argument("--posts-only", action="store_true", help="rewrite the post files without re-rendering")
    args = ap.parse_args()

    edl_path = Path(args.edl).resolve()
    edl = json.loads(edl_path.read_text(encoding="utf-8-sig"))  # tolerate a BOM from Windows editors
    src = Path(edl["source"])
    src = src if src.is_absolute() else ROOT / src
    src_info = probe(src)
    st = {**STYLE, **edl.get("style", {})}
    validate(edl["reels"], src_info["duration"])

    out_dir = Path(args.out_dir).resolve() if args.out_dir else ROOT / "videos" / "finals"
    out_dir.mkdir(parents=True, exist_ok=True)
    posts_dir = ROOT / "strategy" / "posts"
    if args.posts or args.posts_only:
        posts_dir.mkdir(parents=True, exist_ok=True)   # absent on a fresh copy of the project

    def rel(p):
        return p.relative_to(ROOT).as_posix() if p.is_relative_to(ROOT) else str(p)

    for reel in edl["reels"]:
        if args.only and reel["id"] not in args.only:
            continue
        out = out_dir / f"{reel['id']}_{reel['slug']}_TIKTOK_9x16.mp4"
        if not args.posts_only:
            render(reel, src, src_info, edl_path.parent, out, {**st, **reel.get("style", {})})
        info = probe(out)
        want = reel["out"] - reel["in"]
        ok = (info["width"], info["height"]) == (W, H) and abs(info["duration"] - want) < 0.25
        print(f"{'ok ' if ok else 'BAD'} {out.name}: {info['width']}x{info['height']} {info['fps']:g} fps "
              f"{info['duration']:.2f} s (wanted {want:.2f}) {info['size_mb']:.1f} MB {info['codec']}")
        if args.posts or args.posts_only:
            write_post(reel, edl, rel(src), rel(out), info, posts_dir / f"{reel['id']}_{reel['slug']}.md")


if __name__ == "__main__":
    main()
