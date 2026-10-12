"""What a kind of content shows that plain loudness and movement do not: detectors for analyze.py.

Usage:
    python tools/reels/detect.py kills <recording> valorant|cs2 [from to]    the kill rows seen, per second, as JSON

analyze.py adds up loudness, movement and chat speed for every recording alike. A kind of content
("--content") adds what that kind shows. The first is "shooter":

    kill_rows   A shooter writes every kill in a list in the top right corner (the kill feed), and marks
                the rows the streamer's side is in with a colour of its own. Those rows are counted from
                their colour and shape alone; nothing is read. Each game has its own look (GAMES):
                    valorant   a kill by the streamer's side is a green banner; the others are red
                    cs2        a row the streamer is in (a kill or a death) has a dark red outline
                The count is how many such rows are on screen in each second. A row stays for some
                seconds, so the count rises as kills come quickly one after another: a streak.
    streaks     The stretches in which such rows stay on screen without a longer pause: one fight.
    scare, roar From loudness alone: a jump out of a long quiet (horror), and loudness that holds (a crowd).
    talk_moments  For a podcast or an interview: stretches that begin and end with a sentence, found from
                what was said in the whole recording (transcribe.whole) and how lively it was said.
    guess       What kind a recording is, when nobody said: by its stream's category, or its kill feed.

The counts are estimates. On a recording 500 lines high a row is about fifteen lines, and they were
checked by eye against two recordings (one of each game): the count is often one off, while the
stretches with and without kills are found. That is enough to say where the fights are, not to
keep score.
"""
import json
import subprocess
import sys

import cv2
import numpy as np

W, H = 378, 132            # the corner is read at this size whatever the recording's own (42% by 26% of the picture, top right)
CORNER = "crop=iw*0.42:ih*0.26:iw*0.58:ih*0.03"
RATE = 2                   # looks at the corner per second
GAMES = ("valorant", "cs2")
STREAK_GAP = 5             # seconds without a row that end a streak


def bands(rows, least, most):
    """How many runs of rows that are on are `least` to `most` rows tall."""
    n = run = 0
    for on in [*rows, False]:
        if on:
            run += 1
        else:
            n += least <= run <= most
            run = 0
    return n


def valorant(frame):
    """Green banners: kills by the streamer's side."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    green = (h >= 68) & (h <= 95) & (s >= 60) & (v >= 110)
    return bands(green.sum(axis=1) >= 0.08 * W, 7, 24)   # a banner is a wide stretch of it; its words and icons are not green


def others_valorant(frame):
    """Red banners: kills by the other side (Valorant). Not counted as the streamer's; they tell the game apart."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    red = ((h <= 8) | (h >= 172)) & (s >= 90) & (v >= 120)
    return bands(red.sum(axis=1) >= 0.16 * W, 7, 24)


def cs2(frame):
    """Rows with a dark red outline: the streamer killed, or was killed."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(int)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    red = (((h <= 11) | (h >= 170)) & (s >= 125) & (v >= 90) & (v <= 215)).sum(axis=1)
    # where a thin red line begins: one to four rows of it. A thick red band is something else (Valorant's banners).
    lines, y = [], 0
    while y < H:
        if red[y] >= 30:
            top = y
            while y < H and red[y] >= 30:
                y += 1
            if y - top <= 4:
                lines.append(top)
        else:
            y += 1
    boxes, used = 0, set()
    for i, y in enumerate(lines):   # a row's outline is two such lines, 9 to 17 rows apart
        if i in used:
            continue
        for j in range(i + 1, len(lines)):
            if j not in used and 9 <= lines[j] - y <= 17:
                boxes += 1
                used.update((i, j))
                break
    return boxes


def kill_rows(src, game, seconds, start=0.0, length=None):
    """The streamer's rows in the kill feed, per second of the recording: the most seen in that second."""
    count = {"valorant": valorant, "cs2": cs2}[game]
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-ss", str(start)]
    cmd += (["-t", str(length)] if length else []) + ["-i", str(src), "-an", "-vf", f"fps={RATE},{CORNER},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    out = np.zeros(seconds)
    size = W * H * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=size * 8)
    try:
        i = 0
        while len(buf := proc.stdout.read(size)) == size:
            sec = min(int(start) + i // RATE, seconds - 1)
            out[sec] = max(out[sec], count(np.frombuffer(buf, np.uint8).reshape(H, W, 3)))
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()
    return out


def streaks(rows, gap=STREAK_GAP):
    """[(first second, last second, most rows at once)] of the stretches with rows on screen, a pause of up to `gap` seconds bridged."""
    out, start, last, most = [], None, None, 0
    for t, n in enumerate(rows):
        if n > 0:
            if start is None:
                start, most = t, 0
            last, most = t, max(most, int(n))
        elif start is not None and t - last > gap:
            out.append((start, last, most))
            start = None
    if start is not None:
        out.append((start, last, most))
    return out


def fight_around(rows, peak, gap=STREAK_GAP):
    """The streak the second `peak` lies in or beside, as (first, last), or None when no row is near."""
    near = [s for s in streaks(rows, gap) if s[0] - gap <= peak <= s[1] + gap]
    return (min(s[0] for s in near), max(s[1] for s in near)) if near else None


# ---------------------------------------------------------------- from the sound's loudness alone

def scare(loud):
    """Per second: how far the sound jumps up out of a quiet stretch. A horror game's moment is a long quiet
    and then a scream; plain loudness scores the scream no higher than any loud talk."""
    n = len(loud)
    out = np.zeros(n)
    calm = np.percentile(loud, 40)
    for t in range(12, n):
        before = loud[t - 12:t - 1]
        if np.median(before) <= calm:                 # it was quiet for the ten seconds before
            out[t] = max(0.0, float(loud[t] - np.max(before)))
    return out


def roar(loud, hold=4):
    """Per second: how far the sound stays above the minutes around it for `hold` seconds on end: a crowd
    or a commentator after a goal or a knockout, where one bang or one shout does not count."""
    n = len(loud)
    out = np.zeros(n)
    for t in range(n - hold):
        base = np.median(loud[max(0, t - 90):t + 90])
        out[t] = max(0.0, float(np.min(loud[t:t + hold]) - base))
    return out


# ---------------------------------------------------------------- talk: a podcast, an interview

STOP = set("""a an the and or but so if then than that this these those there here of to in on at by for from with without into over under
about as is are was were be been being am do does did done have has had having i you he she it we they me him her us them my your his its our their
mine yours what which who whom whose when where why how not no yes yeah okay ok oh uh um like just really very also too can could would should will
shall may might must dont doesnt didnt im youre hes shes its were theyre ive youve weve theyve id youd hed wed theyd ill youll hell well theyll
thats theres whats lets one two get got go going gonna know think say said mean thing things kind sort lot right actually because""".split())


def words(text):
    return [w for w in "".join(c.lower() if c.isalnum() or c == "'" else " " for c in text).replace("'", "").split() if w]


def sentences(phrases, pause=0.7):
    """The recogniser's phrases joined into sentences: {"t", "end", "text"}. A sentence ends at a full stop,
    a question mark or an exclamation mark, or where the speaker pauses."""
    out, cur = [], None
    for p in phrases:
        text = p["text"].strip()
        if not text:
            continue
        if cur and p["t"] - cur["end"] >= pause:
            out.append(cur)
            cur = None
        cur = {"t": p["t"], "end": p["end"], "text": text} if cur is None else {"t": cur["t"], "end": p["end"], "text": cur["text"] + " " + text}
        if text[-1] in ".?!":
            out.append(cur)
            cur = None
    if cur:
        out.append(cur)
    return out


def topic_starts(sents, span=45.0):
    """Indexes of the sentences at which the talk turns to something else: where the words of the 45 seconds
    before and of the 45 seconds after have least in common, compared with the rest of the recording."""
    bags = [set(w for w in words(s["text"]) if w not in STOP and len(w) > 2) for s in sents]
    alike = []
    for i in range(1, len(sents)):
        before = set().union(*[b for b, s in zip(bags[:i], sents[:i]) if s["end"] >= sents[i]["t"] - span] or [set()])
        after = set().union(*[b for b, s in zip(bags[i:], sents[i:]) if s["t"] <= sents[i]["t"] + span] or [set()])
        both = len(before | after)
        alike.append(len(before & after) / both if both >= 6 else 1.0)
    if len(alike) < 5:
        return set()
    low = np.mean(alike) - 0.6 * np.std(alike)
    return {i + 1 for i, v in enumerate(alike) if v <= low and v == min(alike[max(0, i - 2):i + 3])}


def talk_moments(phrases, loud, duration, limit, least=30.0, most=90.0, best=55.0):
    """Candidates for a recording that is talk: stretches of 30 to 90 seconds that begin at the start of a
    sentence (best at a turn of topic, or at a question) and end at the end of one. A stretch scores by how
    lively it is: how fast the words come, how loud they are against the rest, how many of its words are
    this recording's own (said here and seldom elsewhere in it), and the questions in it.
    Returns (candidates, a score per second for the timeline)."""
    sents = sentences(phrases)
    per_second = np.zeros(int(np.ceil(duration)) + 1)
    if len(sents) < 4:
        return [], per_second
    turns = topic_starts(sents)
    counts = {}
    for s in sents:
        for w in set(words(s["text"])):
            counts[w] = counts.get(w, 0) + 1
    z = lambda x: (x - np.mean(x)) / (np.std(x) + 1e-9)
    rate = np.array([len(words(s["text"])) / max(0.6, s["end"] - s["t"]) for s in sents])
    level = np.array([float(np.mean(loud[int(s["t"]):int(s["end"]) + 1])) if loud is not None and int(s["t"]) < len(loud) else 0.0 for s in sents])
    own = np.array([np.mean([1.0 / counts[w] for w in set(words(s["text"])) if w not in STOP and len(w) > 2] or [0.0]) for s in sents])
    ask = np.array([1.0 if s["text"].rstrip().endswith("?") else 0.0 for s in sents])
    hot = 0.8 * z(rate) + 1.0 * z(level) + 0.6 * z(own) + 0.5 * ask
    for s, h in zip(sents, hot):
        per_second[int(s["t"]):int(s["end"]) + 1] = np.maximum(per_second[int(s["t"]):int(s["end"]) + 1], h)
    options = []
    for i in range(len(sents)):
        if i and sents[i]["t"] - sents[i - 1]["end"] < 0.25 and not sents[i - 1]["text"].rstrip()[-1:] in ".?!":
            continue   # not a place where a thought begins
        top = None
        for j in range(i, len(sents)):
            length = sents[j]["end"] - sents[i]["t"]
            if length > most:
                break
            if length < least:
                continue
            said = sum(s["end"] - s["t"] for s in sents[i:j + 1]) / length          # talk, not long silences
            value = float(np.mean(hot[i:j + 1])) * said - abs(length - best) / 120  # near a minute is best
            if top is None or value > top[0]:
                top = (value, j)
        if top:
            value = top[0] + (0.5 if i in turns else 0.0) + (0.3 if ask[i] else 0.0)
            options.append((value, i, top[1]))
    picked = []
    for value, i, j in sorted(options, reverse=True):
        a, b = sents[i]["t"], sents[j]["end"]
        if any(a < q["out"] and b > q["in"] for q in picked):
            continue
        k = i + int(np.argmax(hot[i:j + 1]))
        picked.append({"in": round(max(0.0, a - 0.3), 2), "out": round(min(duration, b + 0.4), 2), "peak": int(sents[k]["t"]),
                       "score": round(max(0.0, value) * 3, 2), "talk": True, **({"turn": True} if i in turns else {}),
                       "begins": sents[i]["text"][:90]})
        if len(picked) >= limit:
            break
    for rank, c in enumerate(picked, 1):
        c["rank"] = rank
    return sorted(picked, key=lambda c: c["in"]), per_second


# ---------------------------------------------------------------- what kind of content a recording is

CATEGORIES = (   # what a stream's own category (Kick says it) means here
    (r"valorant", ("shooter", "valorant")), (r"counter.?strike|cs ?2|cs:?go", ("shooter", "cs2")),
    (r"apex|fortnite|call of duty|warzone|pubg|overwatch|rainbow six|battlefield|escape from tarkov|halo|the finals|delta force|rust|dayz", ("shooter", None)),
    (r"podcast|talk show|interview", ("talk", None)), (r"just chatting|irl|reaction", ("chatting", None)),
    (r"horror|phasmophobia|resident evil|outlast|dead by daylight|silent hill|amnesia", ("horror", None)),
    (r"sports?|football|soccer|fifa|ea fc|nba|ufc|boxing|wrestling|formula|racing|mma", ("sports", None)),
)


def guess(src, seconds, category=""):
    """(content, game, why) for a recording nobody has said the kind of: by its stream's category when one
    is known, else by whether a kill feed Link knows is seen in it (looked for every six seconds), else general."""
    import re
    for pattern, (content, game) in CATEGORIES:
        if category and re.search(pattern, category, re.I):
            return content, game, f"the stream's category is {category}"
    # one quick pass over the recording's key pictures, both games looked for in each
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-skip_frame", "nokey", "-i", str(src), "-an",
           "-vf", f"fps=1/6,{CORNER},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    size = W * H * 3
    frames = np.frombuffer(raw[:len(raw) // size * size], np.uint8).reshape(-1, H, W, 3)
    share = lambda count: float(np.mean([count(f) > 0 for f in frames])) if len(frames) else 0.0
    green, banners, outlines = share(valorant), share(others_valorant), share(cs2)
    # Valorant's feed is thick banners, green ones among them; CS2's has thin red outlines and nothing green.
    # (Valorant's red banners also set off the search for thin red lines, so green decides.)
    if green >= 0.05 and banners >= 0.10:
        return "shooter", "valorant", f"Valorant's kill feed is seen in {round(max(green, banners) * 100)}% of the looks taken"
    if outlines >= 0.08 and green < 0.03:
        return "shooter", "cs2", f"CS2's kill feed is seen in {round(outlines * 100)}% of the looks taken"
    return "general", None, "nothing said what it is"


if __name__ == "__main__":
    if len(sys.argv) < 4 or sys.argv[1] != "kills" or sys.argv[3] not in GAMES:
        sys.exit(__doc__)
    a, b = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (0.0, None)
    info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", sys.argv[2]], capture_output=True, text=True).stdout)
    seconds = int(np.ceil(float(info["format"]["duration"])))
    rows = kill_rows(sys.argv[2], sys.argv[3], seconds, a, (b - a) if b else None)
    print(json.dumps({"rows": [int(x) for x in rows], "streaks": streaks(rows)}))
