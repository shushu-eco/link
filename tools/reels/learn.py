"""Learn, from the reels that were made, which moments of a recording are worth a reel.

Usage:
    python tools/reels/learn.py            learn from the whole library and say what was learned
    python tools/reels/learn.py --show     only say what is known now

analyze.py finds candidates with one fixed recipe: loudness, motion and chat speed added up.
This looks at what happened next. Every candidate that became a reel (or that the user marked) is
a yes, every other candidate of a tape that got reels is a no, and so is every dismissed one. From
those it learns which signs go with a yes, and gives each candidate of every tape a "pick" between
0 and 1: how much it looks like the moments that became reels.

What a moment is described by (FEATURES), none of it the words that were said:
    the old score, and its parts on their own: loudness, motion, chat speed
    the shape of the moment: how sharply the sound rises into it, how much it swings, how long the
        excitement lasts, whether the high point comes early or late, how many cuts it has
    the sound itself, from one pass over the audio (audio_bands, kept per tape as audio.json):
        how much of it is voice, how much is high and shrill, how fast it changes, sudden bangs
    and one thing from the transcript, when there is one: how much is said, not what

The model is a logistic regression, small on purpose: a library has tens of reels, not thousands,
and a bigger model would learn the tapes by heart. It is checked the honest way: each tape is left
out in turn, the model is trained on the others and asked to rank the left-out tape's candidates
(CHECK). The same is done with the old order. The learned order is used ("trusted") only when
there is enough to go on and it finds the reels at least as well as the old order did.

Where a reel is cut (place). A candidate is a stretch around a peak, a fixed number of seconds
either side. A reel made from it is cut one of three ways, the user's choice (AIR): "balanced"
keeps the candidate's stretch, "airy" gives it more room before and after, "tight" cuts it down
to the moment itself, from where the excitement begins to rise to where it has died down. In all
three each end is then put on a scene cut if one is near, else in a pause of the sound if there
is one, so that nothing is chopped in the middle of a sound. Pauses are found in the sound's level ten times a second (audio.json, "level").

More to go on (what Link notices without being told). A "no" is only as good as the look that was
taken: a candidate that was played and passed over counts for more than one never looked at
(ui.json "seen", noted by the page as candidates are watched). A reel that was made and then
removed is a clear no for that moment ("removed"), and a reel that was posted a clear yes. How
much of each there is, is kept with what was learned ("input"), so it can be seen growing.

Cutting is learned too, and it is the nearer goal: a reel that needs no trimming. Every reel made
from a candidate is compared with the candidate Link proposed: was its start moved, was its end
moved, which way and how far (cutting). When the starts (or the ends) were moved often enough and
mostly the same way, Link moves its own cuts that way from then on: a reel made from a candidate
starts and ends where the user would have put it (cut_for). Until then it says what it sees and
changes nothing. Starts and ends are learned apart, and for long recordings (streams) apart from
short clips, because Link cuts those differently to begin with.

Walkthroughs. A walkthrough is a test run of Link from recording to rendered reel, written down
as videos/walkthroughs/<date>.json: its steps, which passed, what was measured, and the tapes it
made. Learning reads those files by itself and acts on them:
    the tapes a walkthrough made are left out of everything above. Their reels, trims and
        dismissals were a test's, not the user's taste, and would teach Link the wrong thing.
    the newest walkthrough's result is kept with what was learned ("walkthrough"), with the steps
        that failed, so Settings > Learning shows whether Link as a whole still works.
    what it measured about cutting (how many reel ends landed on a scene cut or in a pause, how far
        a cut was moved from the candidate) is kept as numbers to compare from one walkthrough to the next.

What was learned is kept in videos/learned.json: the model, how it did in the check next to the
old order, the signs that count most in plain words, and a line of history for every time it
learned, so it can be seen whether Link is getting better as the library grows.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import safe

ROOT = Path(__file__).resolve().parents[2]
REELS = ROOT / "videos" / "reels"
LEARNED = ROOT / "videos" / "learned.json"
WALKS = ROOT / "videos" / "walkthroughs"
RATE = 8000                # samples a second the audio is listened to at: enough for voices and bangs
MIN_YES, MIN_TAPES = 15, 5  # fewer reels or tapes than this is too little to trust what was learned
MIN_AUC = 0.6               # how well a yes must outrank a no in the check (0.5 is a coin)
TOP = 5                     # "was the reel among Link's first five?"
MOVED = 0.3                 # seconds a cut must differ from the proposed one to count as moved by hand
# The three ways a reel is cut from a candidate. "tight": only the moment itself, from where it begins
# to build to where it has died down, with this much before and after. "balanced": the candidate's
# own stretch. "airy": that stretch with this much more before and after it, room to breathe.
AIR = {"tight": (0.5, 0.5), "balanced": (0.0, 0.0), "airy": (4.0, 2.0)}
RISE = 0.25                 # the moment lasts while the excitement is above this share of the way from the tape's usual level to the peak
SNAP_CUT, SNAP_PAUSE, PAUSE_DB = 1.0, 1.5, 6.0   # how far an end moves to a scene cut, to a pause, and how much quieter a pause must be
LOOKED = 3.0                # seconds of a candidate watched that count as having looked at it
CUT_MIN, CUT_AGREE = 10, 0.7  # this many moved cuts, this share of them the same way, before Link follows
PENALTIES = (0.3, 1.0, 3.0, 10.0)   # how hard the model is held back from fitting; the check chooses
# name -> how to say it: "You pick moments with ..."
FEATURES = {
    "score_peak": "a high score by the old recipe (loudness, motion and chat together)",
    "loud_peak": "a loud peak",
    "loud_rise": "sound that jumps up from the seconds before",
    "loud_swing": "sound that rises and falls a lot",
    "motion_peak": "a burst of movement",
    "motion_mean": "movement all the way through",
    "chat_peak": "the chat speeding up",
    "chat_mean": "a busy chat all the way through",
    "cuts": "many cuts",
    "sustain": "excitement that lasts",
    "peak_late": "the high point coming late in the moment",
    "length": "a longer stretch",
    "voice": "a voice carrying the sound",
    "shrill": "high, shrill sound (shouts, screams, whistles)",
    "flux": "sound that keeps changing",
    "bang": "sudden bangs",
    "speech": "a lot being said",
}
NAMES = list(FEATURES)


# ---------------------------------------------------------------- the sound itself

def audio_bands(src, seconds):
    """Four numbers for each second of a video's sound, from one decode at RATE:
    voice   the share of the sound's energy between 300 and 3000 Hz, where speech lives
    shrill  the share above 3000 Hz
    flux    how much the spectrum changed from the second before
    bang    the loudest 50 ms of the second against its average: high for a shot, a clap, a shout starting
    None when the video has no sound that can be read."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    out = {k: np.zeros(seconds) for k in ("voice", "shrill", "flux", "bang")}
    level = np.full(seconds * 10, -90.0)   # dB, ten times a second: where the pauses are
    freq = np.fft.rfftfreq(RATE, 1 / RATE)
    low, high, window = freq < 300, freq >= 3000, np.hanning(RATE)
    prev, n = None, 0
    try:
        while n < seconds and len(buf := proc.stdout.read(RATE * 2)) == RATE * 2:
            x = np.frombuffer(buf, np.int16).astype(np.float64) / 32768
            mag = np.abs(np.fft.rfft(x * window))
            power = mag ** 2
            total = power.sum()
            if total > 1e-9:
                out["voice"][n] = power[~low & ~high].sum() / total
                out["shrill"][n] = power[high].sum() / total
                if prev is not None:
                    out["flux"][n] = np.maximum(mag - prev, 0).sum() / (mag.sum() + 1e-9)
                blocks = np.sqrt((x.reshape(20, -1) ** 2).mean(axis=1))
                out["bang"][n] = blocks.max() / (blocks.mean() + 1e-6)
            level[n * 10:n * 10 + 10] = 20 * np.log10(np.sqrt((x.reshape(10, -1) ** 2).mean(axis=1)) + 1e-5)
            prev = mag
            n += 1
    finally:
        proc.stdout.close()
        proc.wait()
    return {**{k: [round(float(v), 3) for v in a] for k, a in out.items()}, "level": [int(round(v)) for v in level]} if n else None


def tape_audio(folder, analysis, make=True):
    """A tape's audio_bands, from audio.json in its folder; listened to once and kept when it is not there."""
    kept = safe.read_json(folder / "audio.json")
    if isinstance(kept, dict) and all(k in kept for k in ("voice", "shrill", "flux", "bang", "level")):
        return kept
    src = Path(analysis.get("source") or "")
    if not make or not analysis["info"].get("has_audio") or not src.is_file():
        return None
    bands = audio_bands(src, int(np.ceil(analysis["info"]["duration"])))
    if bands:
        safe.write_json(folder / "audio.json", bands)
    return bands


# ---------------------------------------------------------------- describing a moment

def relative(x):
    """Each second against the whole tape: how far from the tape's middle, in the tape's own spread
    (median and MAD, so a few huge seconds do not set the scale)."""
    x = np.asarray(x, dtype=float)
    mid = np.median(x)
    spread = 1.4826 * np.median(np.abs(x - mid))
    return np.clip((x - mid) / max(spread, 0.25 * x.std() + 1e-9), -4.0, 8.0)


class Tape:
    """A tape's signals, each made relative to the tape once, so moments of a quiet tape and of a loud one compare."""

    def __init__(self, folder, make_audio=True):
        self.folder = Path(folder)
        self.analysis = a = safe.read_json(self.folder / "analysis.json") or {}
        n = len(a.get("score") or [])
        self.seconds = n
        zero = np.zeros(n)
        self.score = np.convolve(np.asarray(a.get("score") or zero, dtype=float), np.ones(5) / 5, mode="same") if n else zero
        self.loud = relative(a["loudness"]) if a.get("loudness") else zero
        self.motion = relative(a["motion"]) if a.get("motion") else zero
        chat = np.asarray(a.get("chat") or zero, dtype=float)
        self.chat = relative(chat) if chat.any() else zero
        self.cuts = np.asarray(a.get("cuts") or [], dtype=float)
        bands = tape_audio(self.folder, a, make_audio) if n else None
        self.bands = {k: relative(np.resize(np.asarray(v, dtype=float), n) if len(v) >= n else np.pad(np.asarray(v, dtype=float), (0, n - len(v))))
                      for k, v in (bands or {}).items() if k != "level"} if bands else None
        self.level = np.asarray(bands["level"], dtype=float) if bands and bands.get("level") else None   # dB, ten a second
        self.mode = a.get("mode", "clip")
        self.duration = float((a.get("info") or {}).get("duration") or n)
        self.high = np.percentile(self.score, 75) if n else 0.0
        said = safe.read_json(self.folder / "transcript.json") or {}
        self.phrases = [p for c in said.get("candidates", []) for p in c.get("phrases", [])]

    def describe(self, start, end):
        """The moment from `start` to `end` (seconds) as numbers, in the order of NAMES."""
        a, b = max(0, int(start)), min(self.seconds, max(int(start) + 1, int(np.ceil(end))))
        if b <= a:
            return np.zeros(len(NAMES))
        before = slice(max(0, a - 15), a) if a else slice(0, 1)
        loud, motion, chat, score = self.loud[a:b], self.motion[a:b], self.chat[a:b], self.score[a:b]
        band = (lambda k: float(self.bands[k][a:b].mean())) if self.bands else (lambda k: 0.0)
        peak = (lambda k: float(self.bands[k][a:b].max())) if self.bands else (lambda k: 0.0)
        words = sum(len(p.get("text", "").split()) for p in self.phrases if a <= p.get("t", -1) < b)
        values = {
            "score_peak": float(score.max()), "loud_peak": float(loud.max()),
            "loud_rise": float(loud.mean() - self.loud[before].mean()), "loud_swing": float(loud.std()),
            "motion_peak": float(motion.max()), "motion_mean": float(motion.mean()),
            "chat_peak": float(chat.max()), "chat_mean": float(chat.mean()),
            "cuts": float(((self.cuts >= a) & (self.cuts < b)).sum() / (b - a)),
            "sustain": float((score > self.high).mean()), "peak_late": float(np.argmax(score) / max(1, b - a - 1)),
            "length": float(b - a), "voice": band("voice"), "shrill": peak("shrill"), "flux": band("flux"), "bang": peak("bang"),
            "speech": words / (b - a),
        }
        return np.array([values[k] for k in NAMES])


# ---------------------------------------------------------------- walkthroughs

def walkthroughs(folder=None):
    """Every walkthrough written down, oldest first; one that cannot be read is left out."""
    found = [safe.read_json(f) for f in sorted(Path(folder or WALKS).glob("*.json"))]
    return [w for w in found if isinstance(w, dict) and isinstance(w.get("steps"), list)]


def test_tapes(folder=None):
    """The tapes walkthroughs made: a test's choices, which nothing is learned from."""
    return {t for w in walkthroughs(folder) for t in w.get("tapes") or []}


def last_walkthrough(folder=None):
    """The newest walkthrough in short, for what was learned: when, how many steps passed, which failed, what it measured."""
    walks = walkthroughs(folder)
    if not walks:
        return None
    w = walks[-1]
    failed = [s for s in w["steps"] if not s.get("ok")]
    return {"at": w.get("at"), "minutes": w.get("minutes"), "steps": len(w["steps"]), "passed": len(w["steps"]) - len(failed),
            "failed": [{"step": s.get("step", ""), "saw": str(s.get("saw", ""))[:200]} for s in failed][:12],
            "findings": [str(f)[:300] for f in w.get("findings") or []][:12], "measured": w.get("measured") or {},
            "tapes": w.get("tapes") or [], "count": len(walks)}


# ---------------------------------------------------------------- what the library says

def overlaps(a, b):
    """Whether two stretches are the same moment: they share more than half of the shorter one."""
    shared = min(a["out"], b["out"]) - max(a["in"], b["in"])
    return shared > 0.5 * min(a["out"] - a["in"], b["out"] - b["in"])


def examples(reels_root=REELS, make_audio=True, say=None):
    """Every moment the library has an answer for: (features, yes or no, weight, tape id, the old rank).
    A tape nobody made a reel from and dismissed nothing in gives no answers: it was not looked at yet."""
    rows = []
    tests = test_tapes() if Path(reels_root) == REELS else set()
    for folder in sorted(Path(reels_root).glob("SRC-*")):
        analysis = safe.read_json(folder / "analysis.json")
        if not analysis or not analysis.get("candidates") or folder.name in tests:   # a walkthrough's tape teaches nothing
            continue
        reels = (safe.read_json(folder / "reels.json") or {}).get("reels", [])
        ui = safe.read_json(folder / "ui.json") or {}
        dismissed, seen, posted = set(ui.get("dismissed", [])), ui.get("seen") or {}, ui.get("posted") or {}
        removed = [dict(zip(("in", "out"), w)) for w in ui.get("removed") or []]
        cands = analysis["candidates"]
        if not reels and not dismissed and not removed and not any(c.get("marked") for c in cands):
            continue
        if say:
            say(f"  {folder.name}: {len(cands)} candidates, {len(reels)} reels")
        tape = Tape(folder, make_audio)
        for c in cands:
            key = f"{c['in']}-{c['out']}"
            made = [r for r in reels if overlaps(r, c)]
            yes = bool(c.get("marked")) or bool(made)
            no = key in dismissed or any(overlaps(w, c) for w in removed)   # dismissed, or made into a reel and thrown out again
            if yes:
                weight = 2.0 if any(posted.get(r.get("id")) for r in made) else 1.0   # a reel that was posted says it louder
            elif no:
                weight = 2.0
            elif not seen:
                weight = 1.0   # a tape from before Link noted what was watched
            else:   # passed over: a firm no if it was looked at, a faint one if it never was
                weight = 1.5 if (seen.get(key) or {}).get("seconds", 0) >= LOOKED else 0.5
            if yes or no or reels:
                rows.append((tape.describe(c["in"], c["out"]), 1.0 if yes else 0.0, weight, folder.name, c["rank"]))
        for r in reels:   # a reel cut from a stretch that was no candidate: a yes the old recipe missed
            if not any(overlaps(r, c) for c in cands):
                rows.append((tape.describe(r["in"], r["out"]), 1.0, 1.0, folder.name, None))
    return rows


# ---------------------------------------------------------------- placing the cut

def place(tape, cand, air="balanced"):
    """Where a reel of this candidate starts and ends: (in, out, [what was done, in words]).
    The candidate's own stretch when the tape's signals say nothing (no score, a flat one)."""
    start, end = float(cand["in"]), float(cand["out"])
    n, s = tape.seconds, tape.score
    if not n or air not in AIR:
        return start, end, []
    notes = []
    stream = tape.mode == "stream"
    back, ahead, least, most = (30, 20, 12.0, 45.0) if stream else (15, 15, 8.0, 30.0)
    p = int(min(max(cand.get("peak", (start + end) / 2), 0), n - 1))
    base = float(np.median(s[max(0, p - 150):min(n, p + 150)]))
    before, after = AIR[air]
    if air == "airy":
        start, end = max(0.0, start - before), min(tape.duration, end + after)
        if end - start > most:   # the air goes before the moment rather than after it
            end = start + most
        notes.append(f"{before:g} s more before and {after:g} s more after: room to breathe")
    if air == "tight" and not cand.get("marked") and s[p] - base > 1e-6:   # a marked moment keeps the stretch the user pointed at
        gate = base + RISE * (s[p] - base)
        quiet = lambda i: i < 0 or i >= n or s[i] < gate
        a = p
        while a > max(0, p - back) and not (quiet(a - 1) and quiet(a - 2)):
            a -= 1
        b = p
        while b < min(n - 1, p + ahead) and not (quiet(b + 1) and quiet(b + 2)):
            b += 1
        new_start, new_end = a - before, b + 1 + after
        if new_end - new_start < least:   # a short burst: more of what led up to it than of what came after
            short = least - (new_end - new_start)
            new_start, new_end = new_start - 0.6 * short, new_end + 0.4 * short
        if new_end - new_start > most:
            new_start = max(new_start, min(p - 3.0, new_end - most))
            new_end = min(new_end, new_start + most)
        new_start, new_end = max(0.0, new_start), min(tape.duration, new_end)
        if new_end - new_start >= least - 0.01:
            if abs(new_start - start) >= 1:
                notes.append(f"starts {abs(new_start - start):.0f} s {'later' if new_start > start else 'earlier'}: where it begins to build")
            if abs(new_end - end) >= 1:
                notes.append(f"ends {abs(new_end - end):.0f} s {'later' if new_end > end else 'earlier'}: where it has died down")
            start, end = new_start, new_end

    def snap(t, name):
        near = tape.cuts[np.abs(tape.cuts - t) <= SNAP_CUT] if len(tape.cuts) else []
        if len(near):
            notes.append(f"{name} on a scene cut")
            return float(near[np.argmin(np.abs(near - t))])
        if tape.level is not None:
            lo, hi = max(0, int((t - SNAP_PAUSE) * 10)), min(len(tape.level), int((t + SNAP_PAUSE) * 10) + 1)
            if hi - lo >= 5:
                window = np.convolve(tape.level[lo:hi], np.ones(3) / 3, mode="same")
                i = int(np.argmin(window[1:-1])) + 1
                if window.mean() - window[i] >= PAUSE_DB:
                    notes.append(f"{name} in a pause")
                    return (lo + i) / 10 + 0.05
        return t

    snapped = max(0.0, snap(start, "starts")), min(tape.duration, snap(end, "ends"))
    if snapped[1] - snapped[0] >= least - 0.01 and snapped[0] <= p + 0.5 <= snapped[1] + 0.5:
        start, end = snapped
    else:
        notes = [x for x in notes if "scene cut" not in x and "pause" not in x]
    return round(start, 1), round(end, 1), notes


# ---------------------------------------------------------------- cutting

def cuts_made(reels_root=REELS):
    """Every reel made from a candidate as (mode, how far its start was moved, how far its end was moved),
    in seconds: negative is earlier, positive later, 0 left where Link put it. Moved from the cut Link
    proposed for that reel (ui.json "proposed"), or from the candidate's own stretch for a reel made before Link noted that."""
    rows = []
    tests = test_tapes() if Path(reels_root) == REELS else set()
    for folder in sorted(Path(reels_root).glob("SRC-*")):
        if folder.name in tests:
            continue
        analysis = safe.read_json(folder / "analysis.json") or {}
        cands = analysis.get("candidates") or []
        proposed = (safe.read_json(folder / "ui.json") or {}).get("proposed") or {}
        for r in (safe.read_json(folder / "reels.json") or {}).get("reels", []):
            c = next((c for c in cands if overlaps(r, c)), None)
            was = proposed.get(r.get("id")) or (c and [c["in"], c["out"]])
            if c and was:
                rows.append((analysis.get("mode", "clip"), float(r["in"]) - was[0], float(r["out"]) - was[1]))
    return rows


def cutting(reels_root=REELS):
    """What the reels say about where to cut: for streams and clips, for the start and the end, how
    many were moved, which way, by how much, and whether Link follows ("shift", seconds; 0 when it does not)."""
    rows = cuts_made(reels_root)
    out = {"reels": len(rows), "moved": sum(1 for r in rows if abs(r[1]) > MOVED or abs(r[2]) > MOVED), "says": [], "shift": {}}
    for mode, what in (("stream", "long recordings"), ("clip", "short clips")):
        for side, index, name in (("in", 1, "start"), ("out", 2, "end")):
            moved = [r[index] for r in rows if r[0] == mode and abs(r[index]) > MOVED]
            if not moved:
                continue
            earlier = sum(1 for v in moved if v < 0)
            way, count = ("earlier", earlier) if earlier >= len(moved) - earlier else ("later", len(moved) - earlier)
            median = float(np.median([v for v in moved if (v < 0) == (way == "earlier")]))
            follow = len(moved) >= CUT_MIN and count / len(moved) >= CUT_AGREE
            if follow:
                out["shift"][f"{mode}_{side}"] = round(median * 2) / 2
            out["says"].append(
                f"In {what} you moved the {name} of {len(moved)} reel{'' if len(moved) == 1 else 's'}: {count} {way}, by about {abs(median):.0f} s. "
                + (f"Link now cuts the {name} {abs(round(median * 2) / 2):g} s {way} by itself." if follow
                   else f"Not followed yet: it takes {CUT_MIN} moved cuts, {round(100 * CUT_AGREE)}% of them the same way."))
    if not out["says"]:
        out["says"].append("No reel's cut was moved by hand yet, so there is nothing to learn about cutting. Trim a reel's In and Out in Reels and Link takes note." if rows
                           else "No reels yet.")
    out["trusted"] = bool(out["shift"])
    return out


def cut_for(candidate, mode, duration, learned=None, tape=None, air="balanced"):
    """Where a reel made from this candidate starts and ends, and why: (in, out, notes). First placed
    on the moment itself (place, when `tape` is given and `air` is one of AIR), then moved the way
    the user moves cuts once that is known. Never outside the video, never under 8 seconds."""
    learned = learned if learned is not None else safe.read_json(LEARNED) or {}
    shift = (learned.get("cutting") or {}).get("shift") or {}
    first, last, notes = place(tape, candidate, air) if tape is not None else (float(candidate["in"]), float(candidate["out"]), [])
    start = max(0.0, first + shift.get(f"{mode}_in", 0.0))
    end = min(float(duration), last + shift.get(f"{mode}_out", 0.0))
    if end - start < 8.0:
        return first, last, notes
    return round(start, 2), round(end, 2), notes


# ---------------------------------------------------------------- the model

def fit(X, y, w, penalty):
    """Logistic regression by Newton's method on standardised features. Returns (mean, spread, weights, bias)."""
    mean, spread = X.mean(axis=0), X.std(axis=0)
    spread[spread < 1e-9] = 1.0
    Z = np.hstack([(X - mean) / spread, np.ones((len(X), 1))])
    w = w * np.where(y > 0, len(y) / (2 * max(1.0, y.sum())), len(y) / (2 * max(1.0, (1 - y).sum())))   # a yes is rare: it counts for more
    beta = np.zeros(Z.shape[1])
    ridge = np.eye(Z.shape[1]) * penalty
    ridge[-1, -1] = 0.0   # the bias is not held back
    for _ in range(50):
        p = 1 / (1 + np.exp(-np.clip(Z @ beta, -30, 30)))
        step = np.linalg.solve(Z.T @ (Z * (w * p * (1 - p))[:, None]) + ridge + 1e-9 * np.eye(Z.shape[1]), Z.T @ (w * (y - p)) - ridge @ beta)
        beta += step
        if np.abs(step).max() < 1e-6:
            break
    return mean, spread, beta[:-1], float(beta[-1])


def predict(model, X):
    mean, spread, weights, bias = model
    return 1 / (1 + np.exp(-np.clip(((np.asarray(X) - mean) / spread) @ weights + bias, -30, 30)))


def auc(scores, y):
    """How often a yes outranks a no (1 always, 0.5 a coin). None with only one kind."""
    yes, no = scores[y > 0], scores[y == 0]
    if not len(yes) or not len(no):
        return None
    return float(((yes[:, None] > no[None, :]).sum() + 0.5 * (yes[:, None] == no[None, :]).sum()) / (len(yes) * len(no)))


def check(rows, penalty):
    """Leave each tape out in turn. Returns how the learned order and the old order did on the tapes
    they had not seen: {"learned": {...}, "old": {...}} with "found" (the share of reels among the
    first TOP) and "auc"."""
    X, y, w = (np.array([r[i] for r in rows]) for i in range(3))
    tapes = np.array([r[3] for r in rows])
    old = np.array([-(r[4] if r[4] is not None else 1e6) for r in rows], dtype=float)   # rank 1 is the best
    found = {"learned": 0, "old": 0}
    aucs = {"learned": [], "old": []}
    total = 0
    for tape in sorted(set(tapes)):
        held = tapes == tape
        if not (y[held] > 0).any() or (y[~held] > 0).sum() < 3:
            continue
        scores = {"learned": predict(fit(X[~held], y[~held], w[~held], penalty), X[held]), "old": old[held]}
        total += int((y[held] > 0).sum())
        for how, s in scores.items():
            first = np.argsort(-s, kind="stable")[:TOP]
            found[how] += int((y[held][first] > 0).sum())
            if (a := auc(s, y[held])) is not None:
                aucs[how].append(a)
    return {how: {"found": found[how] / total if total else 0.0, "auc": float(np.mean(aucs[how])) if aucs[how] else 0.5, "reels": total}
            for how in found}


def learn(reels_root=REELS, out=LEARNED, make_audio=True, say=None):
    """Learn from the library, write what was learned, and return it."""
    rows = examples(reels_root, make_audio, say)
    yes, tapes = sum(1 for r in rows if r[1] > 0), len({r[3] for r in rows})
    before = safe.read_json(out) or {}
    learned = {"at": time.time(), "examples": len(rows), "reels": yes, "tapes": tapes, "features": NAMES,
               "answers": list(answers(reels_root)), "trusted": False, "history": before.get("history", []), "cutting": cutting(reels_root), "input": going_on(reels_root),
               "walkthrough": last_walkthrough() if Path(reels_root) == REELS else None}
    if yes < 3 or yes == len(rows) or tapes < 2:
        learned["why"] = (f"Too little to learn from yet: {yes} reel{'' if yes == 1 else 's'} on {tapes} tape{'' if tapes == 1 else 's'}. "
                          f"Link starts learning once a few tapes have reels.")
    else:
        checks = {p: check(rows, p) for p in PENALTIES}
        penalty = max(PENALTIES, key=lambda p: (checks[p]["learned"]["auc"], checks[p]["learned"]["found"]))
        result = checks[penalty]
        X, y, w = (np.array([r[i] for r in rows]) for i in range(3))
        mean, spread, weights, bias = fit(X, y, w, penalty)
        enough = yes >= MIN_YES and tapes >= MIN_TAPES
        better = result["learned"]["found"] >= result["old"]["found"] and result["learned"]["auc"] >= MIN_AUC
        learned.update(trusted=bool(enough and better), penalty=penalty, check=result,
                       model={"mean": mean.tolist(), "spread": spread.tolist(), "weights": weights.tolist(), "bias": bias},
                       signs=[{"feature": NAMES[i], "weight": round(float(weights[i]), 3),
                               "says": ("You pick moments with " if weights[i] > 0 else "You pass over moments with ") + FEATURES[NAMES[i]] + "."}
                              for i in np.argsort(-np.abs(weights)) if abs(weights[i]) > 0.05][:6])
        pct = lambda v: f"{round(100 * v)}%"
        how = (f"Of the reels on tapes it had not seen, {pct(result['learned']['found'])} were among its first {TOP} "
               f"(the old order: {pct(result['old']['found'])}).")
        learned["why"] = (f"Learned from {yes} reels on {tapes} tapes. {how}" if learned["trusted"]
                          else f"Not used yet: {yes} reels on {tapes} tapes is too few to trust (it takes {MIN_YES} on {MIN_TAPES}). {how}" if not enough
                          else f"Not used: on tapes it had not seen it did no better than the old order. {how}")
        line = {"at": learned["at"], "examples": len(rows), "reels": yes, "tapes": tapes, "trusted": learned["trusted"],
                "found": round(result["learned"]["found"], 3), "found_old": round(result["old"]["found"], 3),
                "auc": round(result["learned"]["auc"], 3), "auc_old": round(result["old"]["auc"], 3)}
        same = lambda a, b: all(a.get(k) == b.get(k) for k in line if k != "at")
        if not learned["history"] or not same(learned["history"][-1], line):   # a line only when something came of it
            learned["history"] = (learned["history"] + [line])[-60:]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    safe.write_json(out, learned, indent=1)
    return learned


# ---------------------------------------------------------------- using it

def going_on(reels_root=REELS):
    """How much Link has to go on, counted: the more of each, the surer what it learns."""
    n = {"tapes": 0, "reels": 0, "trimmed": 0, "dismissed": 0, "removed": 0, "posted": 0, "watched": 0, "watched_seconds": 0.0}
    tests = test_tapes() if Path(reels_root) == REELS else set()
    for folder in Path(reels_root).glob("SRC-*"):
        if folder.name in tests:
            continue
        ui = safe.read_json(folder / "ui.json") or {}
        made = (safe.read_json(folder / "reels.json") or {}).get("reels", [])
        n["tapes"] += 1
        n["reels"] += len(made)
        n["dismissed"] += len(ui.get("dismissed") or [])
        n["removed"] += len(ui.get("removed") or [])
        n["posted"] += sum(1 for r in made if (ui.get("posted") or {}).get(r.get("id")))
        looked = [v for v in (ui.get("seen") or {}).values() if v.get("seconds", 0) >= LOOKED]
        n["watched"] += len(looked)
        n["watched_seconds"] += sum(v.get("seconds", 0) for v in (ui.get("seen") or {}).values())
    n["trimmed"] = sum(1 for r in cuts_made(reels_root) if abs(r[1]) > MOVED or abs(r[2]) > MOVED)
    n["watched_seconds"] = round(n["watched_seconds"])
    return n


def answers(reels_root=REELS):
    """What the library has answers for, without opening the tapes: (reels, dismissed, a number that
    changes when any reel's cut does). Learning again is due when it changes."""
    reels = dismissed = 0
    cuts = 0.0
    for folder in Path(reels_root).glob("SRC-*"):
        made = (safe.read_json(folder / "reels.json") or {}).get("reels", [])
        reels += len(made)
        cuts += sum(float(r.get("in", 0)) + 3 * float(r.get("out", 0)) for r in made)
        ui = safe.read_json(folder / "ui.json") or {}
        dismissed += len(ui.get("dismissed", [])) + len(ui.get("removed") or [])
        # what was watched counts as news in steps, so that Link does not learn again after every play
        dismissed += 1000 * (sum(1 for v in (ui.get("seen") or {}).values() if v.get("seconds", 0) >= LOOKED) // 10)
    return reels, dismissed, round(cuts, 2), len(list(WALKS.glob("*.json"))) if Path(reels_root) == REELS else 0   # a new walkthrough is news too


def picks(folder, learned=None):
    """{candidate rank: pick 0..1} for a tape, or {} when nothing learned is trusted. The sound is
    not listened to here (that is done when the tape is analysed, or when Link learns): a tape
    without audio.json is judged on the rest."""
    learned = learned if learned is not None else safe.read_json(LEARNED)
    if not learned or not learned.get("trusted") or learned.get("features") != NAMES:
        return {}
    tape = Tape(folder, make_audio=False)
    cands = tape.analysis.get("candidates") or []
    if not cands:
        return {}
    m = learned["model"]
    model = (np.array(m["mean"]), np.array(m["spread"]), np.array(m["weights"]), m["bias"])
    X = np.array([tape.describe(c["in"], c["out"]) for c in cands])
    if tape.bands is None:   # no sound read for this tape: those signs say neither yes nor no
        for i, name in enumerate(NAMES):
            if name in ("voice", "shrill", "flux", "bang"):
                X[:, i] = model[0][i]
    return {c["rank"]: round(float(p), 3) for c, p in zip(cands, predict(model, X))}


def summary(learned):
    lines = [learned.get("why", ""), *("Cutting: " + s for s in (learned.get("cutting") or {}).get("says", []))]
    lines += [f"  {'+' if s['weight'] > 0 else '-'} {s['says']}  ({s['weight']:+.2f})" for s in learned.get("signs", [])]
    return "\n".join(lines)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--show", action="store_true", help="say what is known now, without learning again")
    args = ap.parse_args()
    known = safe.read_json(LEARNED) if args.show else learn(say=print)
    print(summary(known) if known else "Nothing learned yet.")
