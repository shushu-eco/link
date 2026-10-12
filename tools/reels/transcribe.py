"""Transcribe the speech around each candidate moment with ffmpeg's whisper filter.

Usage:
    python tools/reels/transcribe.py videos/reels/SRC-015/analysis.json [--model PATH] [--language en]

Writes transcript.json next to analysis.json:
    {"candidates": [{"rank": 1, "in": 1175.0, "out": 1203.0,
                     "phrases": [{"t": 1181.2, "end": 1183.0, "text": "no way"}]}]}

Phrase times are seconds in the source, like the labels on the candidate sheets, and cover the same
window (candidate plus 5 s either side). A caption's "t" in reels.json is the phrase time minus the
reel's "in". Only candidate windows are transcribed, not the whole recording.

The model is a whisper.cpp ggml file (default tools/reels/models/ggml-small.bin, multilingual).
The language is English unless --language says otherwise ("auto" lets whisper guess, which over game
noise means a different script for every window). Whisper invents text over music and game noise; the
plainest inventions (punctuation, broken characters, scripts mixed in one phrase, one letter over and
over) are dropped here, but check the rest against the footage before using it.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

import safe

ROOT = Path(__file__).resolve().parents[2]
MODEL = Path(__file__).resolve().parent / "models" / "ggml-small.bin"
MARGIN = 5
LANGUAGE = "en"   # the reels' captions are English
ASIDE = re.compile(r"[\[(*].*[\])*]")   # [Music], (applause), *laughs*: not speech


def filter_path(p):
    # Quoted so the filtergraph parser leaves it alone; the colon still needs escaping for the option parser.
    return "'" + str(p).replace("\\", "/").replace(":", "\\:") + "'"


def script(c):
    """The writing system of a letter, by its Unicode name: LATIN, CYRILLIC, ... Japanese counts as one."""
    name = unicodedata.name(c, "?").split()[0]
    return "CJK" if name in ("HIRAGANA", "KATAKANA") else name


def speech(text, language=LANGUAGE):
    """Whether a phrase whisper wrote reads as speech, not as what it makes of noise."""
    found = [c for c in text if c.isalpha()]
    if "�" in text or len(found) < 2 or len(found) < 0.5 * len(re.sub(r"\s", "", text)):
        return False  # broken characters, or mostly punctuation: ", ..." ", >>..."
    if len({c.lower() for c in found}) == 1 and len(found) >= 3:
        return False  # one letter over and over: "ᗊᗊᗊ ᗊᗊᗊᗊᗊᗊ"
    scripts = {script(c) for c in found}
    return len(scripts) == 1 and (language != "en" or scripts == {"LATIN"})


def without_asides(pieces):
    """Word pieces minus the ones inside an aside: "*Sounds", "of", "a", "gunshot*" are one noise."""
    out, inside = [], False
    for p in pieces:
        text = p["text"].strip()
        opens, closes = text[:1] in "[(*", text[-1:] in "])*"
        if inside or opens or ASIDE.fullmatch(text):
            inside = (inside or opens) and not closes
            continue
        out.append(p)
    return out


def speech_pieces(src, start, length, model=MODEL, language=LANGUAGE):
    """What is said in a stretch, as small pieces (words or parts of words) with times in source seconds.

    The times are the recogniser's estimates, good to a few tenths of a second: enough to pace
    captions with the voice. build_reels.py uses this to time each caption word.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        return without_asides(transcribe(src, start, length, model, language, Path(tmp_dir) / "whisper.json", pieces=True))


def transcribe(src, start, length, model, language, tmp, pieces=False):
    # Normalise first: a recording made with the player volume turned down is too quiet for whisper.
    # Holes in the sound are filled with silence first (as build_reels.py does), so the times of the
    # words stay the times of the picture.
    af = (f"aresample=async=1:first_pts=0,loudnorm=I=-16:TP=-1.5:LRA=11,whisper=model={filter_path(model)}:language={language}:queue={length}"
          f":destination={filter_path(tmp)}:format=json" + (":max_len=1" if pieces else ""))
    res = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-nostats", "-loglevel", "error",
                          "-ss", str(start), "-t", str(length), "-i", str(src), "-vn", "-af", af, "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        sys.exit(f"ffmpeg whisper failed:\n{res.stderr}")
    phrases = []
    # One object per line, times in ms from the seek point; the text is not JSON-escaped, so no json.loads.
    for m in re.finditer(r'\{"start":(-?\d+),"end":(-?\d+),"text":"(.*)"\}', tmp.read_text(encoding="utf-8", errors="replace")):
        text = re.sub(r"^(>>\s*)+", "", m.group(3).strip())  # whisper's speaker-change mark
        # Pieces are words, and parts of words; only whole phrases are judged as speech.
        if text and (pieces or (not ASIDE.fullmatch(text) and speech(text, language))):
            phrases.append({"t": round(start + int(m.group(1)) / 1000, 2),
                            "end": round(start + int(m.group(2)) / 1000, 2), "text": text})
    return phrases


WHOLE_QUEUE = 300   # seconds the recogniser is given at a time when a whole recording is listened to


def whole(src, duration, out, model=MODEL, language=LANGUAGE):
    """Everything said in a recording, listened to once from start to end: [{"t", "end", "text"}], kept as
    `out` (speech.json). For a recording that is talk (analyze.py --content talk) the candidates are found
    from this, and what is said in each candidate is then taken from it without listening again."""
    kept = safe.read_json(out)
    if isinstance(kept, dict) and kept.get("model") == Path(model).name and kept.get("language") == language and abs(kept.get("duration", 0) - duration) < 2:
        return kept["phrases"]
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir) / "whisper.json"
        af = (f"aresample=async=1:first_pts=0,loudnorm=I=-16:TP=-1.5:LRA=11,whisper=model={filter_path(model)}:language={language}"
              f":queue={WHOLE_QUEUE}:destination={filter_path(tmp)}:format=json")
        res = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-nostats", "-loglevel", "error", "-i", str(src), "-vn", "-af", af, "-f", "null", "-"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace")
        if res.returncode != 0:
            sys.exit(f"ffmpeg whisper failed:\n{res.stderr}")
        phrases = []
        for m in re.finditer(r'\{"start":(-?\d+),"end":(-?\d+),"text":"(.*)"\}', tmp.read_text(encoding="utf-8", errors="replace")):
            text = re.sub(r"^(>>\s*)+", "", m.group(3).strip())
            if text and not ASIDE.fullmatch(text) and speech(text, language):
                phrases.append({"t": round(int(m.group(1)) / 1000, 2), "end": round(int(m.group(2)) / 1000, 2), "text": text})
    safe.write_json(out, {"model": Path(model).name, "language": language, "duration": duration, "phrases": phrases}, indent=1)
    return phrases


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("analysis", help="path to analysis.json")
    ap.add_argument("--model", default=str(MODEL))
    ap.add_argument("--language", default=LANGUAGE, help="en (default), es, ... or auto")
    ap.add_argument("--only", type=int, nargs="+", help="transcribe only these candidate ranks")
    args = ap.parse_args()

    path = Path(args.analysis).resolve()
    analysis = json.loads(path.read_text(encoding="utf-8"))
    model = Path(args.model).resolve()
    if not model.exists():
        sys.exit(f"Whisper model not found: {model}")

    out = {"model": model.name, "language": args.language, "candidates": []}
    heard = safe.read_json(path.parent / "speech.json")   # the whole recording was listened to already (a talk)
    if isinstance(heard, dict) and heard.get("language") == args.language and analysis.get("content") == "talk":
        for c in sorted(analysis["candidates"], key=lambda c: c["rank"]):
            if args.only and c["rank"] not in args.only:
                continue
            phrases = [p for p in heard["phrases"] if p["end"] > c["in"] - MARGIN and p["t"] < c["out"] + MARGIN]
            out["candidates"].append({"rank": c["rank"], "in": c["in"], "out": c["out"], "phrases": phrases})
            print(f"  #{c['rank']:>2}  {len(phrases)} phrases" + (f": {phrases[0]['text'][:60]}" if phrases else ""), flush=True)
    elif analysis["info"]["has_audio"]:
        with tempfile.TemporaryDirectory() as tmp_dir:
            for c in sorted(analysis["candidates"], key=lambda c: c["rank"]):
                if args.only and c["rank"] not in args.only:
                    continue
                start = max(0, int(c["in"]) - MARGIN)
                length = min(int(analysis["info"]["duration"]) + 1, int(c["out"]) + 1 + MARGIN) - start
                phrases = transcribe(analysis["source"], start, length, model, args.language,
                                     Path(tmp_dir) / "whisper.json")
                out["candidates"].append({"rank": c["rank"], "in": c["in"], "out": c["out"], "phrases": phrases})
                print(f"  #{c['rank']:>2}  {len(phrases)} phrases" + (f": {phrases[0]['text'][:60]}" if phrases else ""), flush=True)
    safe.write_json(path.parent / "transcript.json", out, indent=1)
    print(f"-> {path.parent / 'transcript.json'}")


if __name__ == "__main__":
    main()
