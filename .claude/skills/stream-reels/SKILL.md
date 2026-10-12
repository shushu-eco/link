---
name: stream-reels
description: Link, the video-to-reels software. Turns a recording made in Link into vertical reels. Use when the user mentions Link, says "process my last recording", "make reels from my recording", or asks for highlights.
---

# Link: recording to reels

Link is the user's name for this pipeline (`tools/reels/`). Link records and analyses; you
do the creative step (choose the moments, write hook and captions). All commands run from the
project root.

## 0. Recording

The user records inside Link: they open Link from the Desktop icon, paste a video link, the page
opens in the **Studio** (a browser panel in Link's window), and **Record** captures its picture and
sound. **Mark highlight** flags a moment. **Stop recording** saves `<date time>.mp4` in the user's
Videos folder, with marks in `<date time>.markers.json`. You do not start or stop recordings.

The other way in is **Upload video**: the user chooses a video file they already have, and Link
ingests it (step 1 with `--file`). Its tape is named after the file, not after a date.

## 1. Ingest

```
python tools/reels/ingest.py --file "C:\Users\...\Videos\2026-10-03 02-00-38.mp4"
```

Links each named video into `videos/sources/SRC-0NN_stream_<date>.<ext>` (a Link recording) or
`SRC-0NN_<name>.<ext>` (any other file, whose `ingest.json` then has `name` instead of `started`), and
runs the analysis into `videos/reels/SRC-0NN/`. Marked highlights become markers. Link does this by
itself for the recording just saved (Auto-process) and for an **Upload video**, so usually the tape
already exists.

Run it without `--file` only when the user asks for every recording: it then takes all Link recordings
in the Videos folder that are not tapes yet, newest first, and that folder can hold recordings the
user never meant to process (calls, old tests). Link's **Process recording** button lists them and
lets the user tick which.

## 2. Review

In `videos/reels/SRC-0NN/`:

- `analysis.json`: `candidates` with `in`, `out`, `rank`, `score`, and `marked: true` for moments the
  user marked while recording. The per-second arrays are long; read only the `candidates` part.
  `problems` lists stretches with a black picture or no sound (never put a reel there) and
  `level.quiet` says the whole recording was captured too quiet; tell the user about both.
  A recording of a Kick stream also has `chat` (the chat's speed per second, smoothed and moved 4 s
  earlier to meet the moment it reacts to; only counts are ever kept) and `chat_channel`, and each
  candidate a `chat` ratio against the average. A burst of chat is a strong hint of a moment worth a reel.
- `overview_###.jpg`: one frame every 30 s. Skim these first to learn what the recording was.
- `cand_##.jpg`: one sheet per candidate, one frame per second. Labels are `h:mm:ss seconds`; the
  second number is what goes into `in` and `out`. Grey labels are outside the suggested window.
- `transcript.json` (only if the whisper model is installed): phrases around each candidate, timed in
  source seconds, heard as English. Whisper invents text over music and game noise; the obvious junk
  (punctuation, broken characters, mixed scripts) is dropped, but trust a phrase only if it fits what
  the frames show. Candidate windows overlap, so the same speech can appear under two candidates.

Look at marked candidates first: the user chose those. Then go down the ranks. The score only says
"louder and busier than the minutes around it"; many candidates are menus, loading screens or
nothing much. Reject freely. Adjust `in` and `out` by eye so the reel starts just before the action
and ends on the payoff.

## 3. Write `videos/reels/SRC-0NN/reels.json`

Format is in the docstring of `tools/reels/build_reels.py`; `videos/reels/SRC-012/reels.json` is a
complete example. Rules that hold for this project:

- Ids continue the `POST-0NN` sequence in `strategy/posts/`.
- Distinct moments only, no variants of the same moment. Reels must not overlap.
- Hook, captions and platform text in English unless the user says otherwise.
- Captions: use what was actually said when the transcript has a good line
  (`t` = phrase time minus the reel's `in`, optionally `end`); otherwise write them. When a caption's
  words match the speech, the renderer paces it by the voice, so keep spoken captions close to the
  real wording and `t` within a second of when the line starts.
- For 16:9 gameplay set `"style": {"zoom": 1.5}` so the game fills more of the frame, unless the
  user chose another value. Check that nothing important (HUD, kill feed) is cropped off the sides.
  An upright (9:16) upload fills the frame already: leave the zoom out.

## 4. Render

```
python tools/reels/build_reels.py videos/reels/SRC-0NN/reels.json --posts
```

Every line must start with `ok`. Finals go to `videos/finals/`, post files to `strategy/posts/`.
Extract a frame from each final and look at it before reporting. The user uploads manually.

## UI

The user opens Link from the **Link** icon on the Desktop (`tools/reels/link.pyw`: server plus Link's
window, `tools/reels/shell`; closing the window stops the server). `python tools/reels/ui/server.py` serves the same
dashboard on http://127.0.0.1:8765 for development (candidates, reel editor, render, finals); see
`tools/reels/ui/README.md`. The page reloads by itself when you change `reels.json`. After writing `reels.json`, point the user
at its Reels tab to adjust and render.

## Notes

- Analysis takes about 4 minutes per hour of recording, transcription about 7 s per candidate.
  `analyze.py --mode stream|clip` overrides the automatic choice (stream mode above 10 minutes).
- Re-run parts by hand: `analyze.py <source> --markers <seconds...>`,
  `transcribe.py videos/reels/SRC-0NN/analysis.json [--only RANK...] [--language en]` (`--language
  auto` or another code when the speech is not English). Re-running it also clears junk from a
  transcript made before the filter existed.
- Every job Link runs (processing, render, preview) is written with times to
  `%USERPROFILE%\.link\link.log`; look there when the user says something went wrong.
- The recording in the Videos folder and the file in `videos/sources/` are the same data (hard
  link); deleting one does not free the space until the other is deleted too.
