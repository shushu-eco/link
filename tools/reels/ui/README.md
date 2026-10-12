# Link UI

The dashboard of Link, the video-to-reels program in `tools/reels/`.

## Run

Double-click **Link** on the Desktop. It runs `tools/reels/link.pyw`, which starts the server and
opens the dashboard in Link's own window: `tools/reels/shell`, a small Electron program that adds a
browser panel and a recorder to the dashboard (see **Studio** below). The server stops when the
window is closed; while it is open the launcher starts the server again if it has stopped. A second
click on the icon brings the open window forward. Problems starting are written to
`%USERPROFILE%\.link\link.log`, and so is the output of every job (processing, rendering, previews),
each line with its time. That folder also holds the settings, the Instagram key and the Studio's
sign-ins. It is in the user's folder and not under AppData on purpose: a program started from a Store
app (the Claude desktop app is one) gets a private copy of AppData, so Link started from Claude and
Link started from the Desktop icon would not share them. What Link 1.0 kept in `%LOCALAPPDATA%\Link`
is moved there the first time this version starts.

The shell is installed with `npm install` in `tools/reels/shell` (Electron and the ad blocker, about 330 MB in
`node_modules`). The launcher says so if it is missing.

Until 2 October 2026 Link recorded through Streamlabs Desktop and the Brave browser. Those scripts
(`streamlabs.py`, `preflight.py`, `open_link.py`, the tutorial recorder) are no longer part of Link.

A new Link window opens with a nine-second start-up screen: "LINK 64", after the Nintendo 64 boot
screen ("LINK" sits on the exact middle of the window with the 64 hanging off its corner), then a
black screen where a credit is typed out letter by letter in white pixel type with a red ghost. The
credit's lines are `CREDIT` at the end of `static/app.js`. All of it plays while the dashboard loads
behind it. A click or any key skips it; a reload does not play it again; with "reduce motion" set in Windows it is not shown. Its markup is the `#boot` block in
`static/index.html`, its timing the "Start-up screen" rules in `static/style.css`.

For development, run the server alone and open http://127.0.0.1:8765 yourself (in VS Code:
Terminal > Run Build Task, "Link: start UI"). In an ordinary browser the tapes and reels work, but
the Studio does not: opening and recording a video need Link's window.

```
python tools/reels/ui/server.py
```

## Look

The interface follows a Claude Design file, "Link Redesign", in its quieter
variant 2a: a 16-bit game HUD across the top, slate-teal panels, gold only for the primary action,
marked moments and the selection cursor, pixel type for labels and timecodes, TV frames around every
player, and a dialogue box at the bottom that says what to do next. Colours, type and component
styles are the variables and classes at the top of `static/style.css`. The three fonts (Cinzel,
VT323, Nunito Sans) are in `static/fonts/`, so nothing is fetched from the internet.

From the design's "needs new data" list, these now exist: dismissing a candidate, a posted tick per
platform (both kept in `videos/reels/<SRC-id>/ui.json`), sort and filter for candidates, the timeline
linked to the list and to the player, a visual caption strip, the hook as two lines, human names for
sources, job progress as steps with the raw log behind "Show details", and "Show file in folder".

## Studio

Paste a link in the **Video link** strip and press **Open video**: the page opens in a browser panel
inside Link. The panel has two sides in the sidebar: the **Studio** (gold) for live streams, up to three
recorded side by side, and **URL** (blue) for one video, e.g. from YouTube. A link pasted in the Studio
opens there; anywhere else it opens in URL, except a Kick channel, which always goes to the Studio.
Each side keeps its own page: switching between them puts back the one it showed. URL's video does not
count towards the three streams, and a new link replaces it unless it is recording. Everything below
works the same on both sides.

**Monitors** (Studio only): **Minimise** puts the stream on the big screen onto a small monitor in a column
beside it (CH-1 to CH-3) and empties the big screen for the next link; pasting a link while one records
does the same. Each monitor shows the stream live under a Tekken 3 style health bar: the channel in
green and the recording's time in yellow above it, the stream's name in red and a round light per
marked highlight below. A Kick stream's bar is its chat speed, full at the busiest it has been so far
(hover it for the numbers); when chat slows, the lost part turns red and drains away like damage.
Another stream's bar is the page's volume. On hover: ★ mark, ■ stop and
save, ✕ close (when not recording). Click a monitor to put that stream on the big screen; click a free
one to empty the big screen for a new stream. The column shows only once a stream is minimised. It
takes the room left free beside the big screen (up to 300 px wide); when there is none it is 200 px and
the big screen gives that up. A recording is as sharp as the big screen is big when it starts (one
already recording keeps its size), so hiding the sidebar or widening Link keeps it at full size. Away from the Studio, minimised streams show as pills under
the link bar instead. It is a full browser page (any site, links and sign-ins work, cookies are
kept between sessions), not an embedded player.

- **Record** (in the Studio and in URL) records the panel's picture and sound with Link's own
  recorder. The timer counts next to both buttons, followed by the length of the video when the page
  tells it (`3:22 / 10:23`; a live stream has none).
- The recording is exactly what the panel shows, at the panel's size (about 1050x590 in the default
  window, more when Link is maximised); the Studio says the size before Record is pressed. Use the
  video's own full-screen button (F on YouTube): it fills the panel, not the monitor.
- The Studio warns when the video does not fill the panel (the page around it would be recorded)
  and when the video's own subtitles are on (YouTube's CC button, or any subtitle track shown). Then
  the first press of **Record** only repeats the warning; a second press within six seconds records
  as it is. While recording it reminds you to keep the mouse off the video, whose controls would be
  recorded. The checks are `MEDIA` in `shell/main.js`, run every two seconds.
- The recording is as loud as the page plays. When the video's own volume is under 50% or muted, the
  Studio warns and offers **Set it to 100%**.
- **Mark highlight** remembers the moment; it becomes a candidate when the recording is processed.
- **Sound on / Sound off** switches the video's sound off for you only, so you can do other things
  while a video is captured. The recording keeps its sound (measured: nothing reaches the speakers,
  the file is as loud as with the sound on). It can be switched at any time, also mid-recording, and
  starts as "on" every time Link is opened.
- Recording goes on while you look at other tapes, while other windows cover Link, and when the page
  in the panel goes to another site. Minimising Link is untested. Closing Link stops the recording
  and saves it first.
- **Stop recording** saves `<date time>.mp4` in the recording folder (Videos), with marks in
  `<date time>.markers.json`. With **Auto-process** on, a recording of 30
  seconds or more is processed at once and its tape opens. Only that recording: others in the
  folder wait for **Process recording**.
- **Block ads** (on by default, remembered) keeps ads out of the panel and so out of the recording.
  It is Ghostery's blocker (`@ghostery/adblocker-electron`) with the public ad lists, fetched again
  when the saved copy is over a day old, and it works on the panel's pages only. With it on, YouTube
  holds a video back for about ten seconds before it starts. A site that refuses to play with a
  blocker can be opened with the box unticked; changing it reloads the page.

How it is built: `shell/main.js` owns the window, the panel (a `WebContentsView` laid over the
`#player-slot` element, whose place the page reports) and the recorder (a hidden page,
`shell/recorder.js`, that captures the panel's page with `getDisplayMedia` and `MediaRecorder`,
H.264 and Opus, 6 Mbit/s at most). The page reaches it through `window.linkShell`
(`shell/preload.js`). The raw capture is copied into an mp4 with ffmpeg when it stops; that adds
the length and index without re-encoding.

## Audio

The **Audio** button opens the mixer (`static/audio.html`, a window of Link's own); **Settings > Audio**
draws the same rows in the dashboard. Both are `static/audio_ui.js` with `static/audio.css`, and both
talk to "the sound" in `shell/main.js`.

- A stream's sound does not go to its file as it comes: in the recorder's hidden page
  (`shell/recorder.js`) it passes through a small Web Audio mixer, which applies the row's volume
  (-60 to +12 dB), the limiter, mono, and mixes the microphone in. The page's own volume and what the
  user hears are not touched. Measured against the direct path: the same level, about 10 ms more
  delay, no dropouts. If the mixer cannot start, the sound is recorded directly, as before, and the
  row says so.
- While a mixer is on screen, each open page's recorder page also listens to its sound for the meter
  (sound only; nothing is recorded). When no mixer shows, that stops.
- What the user hears is separate. "Hear only the big screen" (the default) or each row's speaker;
  the Studio's **Sound off** silences all of it. A page that is not recording is switched with
  `setAudioMuted`. A page that records is kept silent itself for the whole recording, and its recorder
  page plays it to the loudspeakers when it is to be heard: switching a page's own sound back on makes
  Chromium reopen its output, which used to put about a second of silence into the recording each
  time a recording stream came back to the big screen.
- The limiter is a compressor (from -6 dB, 20 to 1) followed by a soft clipper that lets nothing above
  -2 dB. It is in whenever the row asks for it, the volume is above 0 dB, or the microphone is mixed in.
- The microphone is opened only by a recording that is to have it (and by a mixer on screen, for its
  meter), with the device and processing chosen in its row. `LINK_FAKE_MIC=1` makes every microphone
  request get Chromium's stand-in device, for tests.
- The choices are kept in `%USERPROFILE%\.link\audio.json`: who is heard, sound quality, the
  microphone, and the volume last set for each Kick channel by name.

## Settings

The square gear button at the end of the top bar. Its sections are listed in the sidebar, under the
screens (beside the section when the sidebar is folded away):
**General**: auto-process, the ad blocker, the recording folder. **Accounts**: the Instagram page
and key, YouTube, Kick, the Discord bot, Spotify, each with its icon and the button that opens or connects it.
**Audio**: the mixer and its settings. **Recording**: picture quality (4 to 12 Mbit/s, kept by
Link's window), the size a recording would have now. **Storage** and **Learning**: see below. **About**: Link's version (`GET /api/about`),
Electron's version, and Link's folders, each opened in Explorer by Link's window (only the folders
the server names).

**Storage** (`tools/reels/storage.py`, `GET /api/storage`) shows how much room Link takes: the drive
as one bar with Link's parts in colour (recordings, tapes, finished reels, working files, the
window's cache and sign-ins, Link itself), then everything else on the drive, then what is free;
under it one row per part with its size and its folder, and the three heaviest tapes. A tape's
video is a hard link to its recording, the same bytes under two names, so every file is counted
once. The line on top also says how many hours of recording fit in the free room at the chosen
picture quality. When the drive is getting full, or Link, its working files or its browser cache
have grown large, a notice says which and what to do; when recording is about to run out of room
(under 5 GB free, or under an hour) the notice is red, the gear button wears a red dot on every
screen (nothing is said out loud when Link opens). The lines are drawn by the numbers at the top of
`storage.py`. Nothing is deleted from here: tapes are deleted in Sources.

Storage also keeps track: once a day it notes Link's size and the drive's free room
(`%USERPROFILE%\.link\storage_history.json`, the last 120 days) and, from a straight line through
the last 30 days, says how fast Link grows, how fast the drive fills and in how many days it would
be full. Under 30 days the notice is amber, under 7 red.

**Learning** (`tools/reels/learn.py`, `GET /api/learned`, `POST /api/learn`) is what Link has learned
about which moments become reels. Every candidate that became a reel or was marked is a yes; every
dismissed one, and every one passed over on a tape reels were taken from, is a no. Each moment is
described by seventeen numbers, none of them the words said: the old score and its parts
(loudness, motion, chat speed), the shape of the moment (how the sound rises into it, how it
swings, how long the excitement lasts, where its high point sits, its cuts) and the sound itself
from one pass over the audio (how much is voice, how much is shrill, how fast it changes, sudden
bangs; kept per tape as `audio.json`), plus how much is said. A small model (a logistic regression)
learns which of these go with a yes. It is checked by leaving each tape out in turn, and its order
is used only when there are at least 15 reels on 5 tapes and it finds the left-out tapes' reels at
least as well as the old order does. Then every candidate gets a **Pick** (0 to 100), Candidates
can be sorted by it, and the section shows the check, the signs that count most in plain words,
and a line for every time Link learned. Link learns again by itself when a render or a new tape
is done and the library has new answers. What it learned is in `videos/learned.json`. Reels posted
from Link have their post ids kept in the tape's `ui.json` (`published`), so that their numbers
can be tied to the moment later; learning from views and watch time is not built yet.

Learning's nearer goal is cutting: a reel that needs no trimming. Every reel made from a candidate
is compared with the cut Link proposed (`learn.cutting`): was its start moved, was its end moved,
which way and by how much, for long recordings and short clips apart. When ten cuts were moved and
seven in ten the same way, a reel made from a candidate from then on starts (or ends) that much
earlier or later by itself (`learn.cut_for`, used by `add_reel`). Until then the section says what
it sees and Link cuts as before. Trimming a reel makes Link learn again. The picture is not looked
at for any of this: the signs are sound, movement, chat and the shape of the moment.

**How a reel is cut** (Settings > Learning, `learn.place`) is chosen in three styles, for a reel made
from a candidate. *Balanced* (the default) keeps the candidate's stretch. *Airy* gives it 4 s more
before and 2 s more after, room to breathe. *Tight* cuts it down to the moment itself, from where
the excitement begins to rise to where it has died down. In every style each end is then put on a
scene cut if one is within a second, else in a pause of the sound within a second and a half
(found in the sound's level ten times a second), so nothing is chopped mid-sound; Link says in a
line what it did. A reel cut by hand from any stretch is left exactly as asked. Measured on the
library of 4 October 2026: balanced puts 460 of 544 ends on a cut or a pause and moves a cut by
0.8 s on average; tight shortens the median reel from 19 s to 13 s but lands further from the
cuts that were made by hand (15.8 s against 10.3 s), which is why it is a choice and not the default.

**What Link notices** without being told, each kept in the tape's `ui.json` and counted in the
section ("What Link has to go on"): `seen`, how long each candidate was watched (a candidate that
was looked at and passed over is a firmer no than one never looked at); `removed`, the stretch of
a reel that was made and removed again (a clear no); `proposed`, the cut each reel was made with
(so a later trim is measured from it); and the reels that were posted (a yes that counts double).

The version is `rwa-` and a number, for example `rwa-15`: how many commits git counts, so it goes
up by one with every change. An installed Link reads it from the `VERSION` file its installer wrote.

## Analytics

The **Analytics** screen has two sides, chosen at its top right and remembered: **Instagram** and
**YouTube**. Both are drawn by the same table and tiles (`statsTable`, `kpi` in `app.js`).

**YouTube** (`tools/reels/youtube_api.py`, `GET`/`POST /api/youtube`): the user's Shorts, through the
YouTube Data API v3 (the list of Shorts from the channel's `UUSH…` playlist, their titles, and views,
likes and comments, up to the minute) and the YouTube Analytics API (shares, average watch time,
percentage watched and subscribers gained per Short, and the last 28 days). It signs in with an OAuth
client of the user's own (ID and secret pasted once, then Google's sign-in page in the browser, PKCE,
back to `/youtube/callback`); the secret and tokens stay in `%USERPROFILE%\.link\youtube.json` and never
reach the page. When there is no Shorts playlist it takes uploads of up to 3 minutes and says so; when
the Analytics API refuses the Shorts filter the 28 days are the whole channel's; when the Analytics
API is off the Shorts still list with their public counts and a note says what to enable.
`LINK_GOOGLE_AUTH`, `LINK_GOOGLE_TOKEN`, `LINK_YOUTUBE_API` and `LINK_YOUTUBE_ANALYTICS` point it at a
stand-in for tests.

**Instagram**: the real
numbers of the Instagram page, read through Instagram's official API by `tools/reels/instagram_api.py`:

- tiles for all posts together (followers, posts, views, likes, comments, shares, saves, engagement)
  and for the whole account over the last 28 days (reach, views, accounts engaged, interactions);
- one table row per post with views, reach, likes, comments, shares, saves, average watch time and
  engagement; click a column to sort, **Open** shows the reel in the Studio.

Engagement is likes, comments, shares and saves per 100 views. A dash means Instagram has not
reported that number (yet); its figures can lag by up to 48 hours. The numbers are read again when
the screen is opened and the last reading is over 15 minutes old, or with **Refresh**.

It needs a professional (Creator) Instagram account and an access key from the Meta developer
dashboard (Instagram > API setup with Instagram login > Generate token), pasted once into the
screen. The key is kept in `%USERPROFILE%\.link\instagram.json`, is never sent to the page, and is
renewed by itself while Link is used at least every two months. **Disconnect** forgets it.

**Kick** (`tools/reels/kick_api.py`, `GET`/`POST /api/kick`), connected in Settings > Accounts with
the Client ID and secret of the user's own Kick app (kick.com > Settings > Developer). Link then
asks Kick's official API every 20 seconds whether a channel open in the Studio is live, so the
"offline" notice is Kick's own answer; without it Link goes by the picture, as before. The
stream's title and category at the start of a recording are kept next to it (`.stream.json`) and
in the tape's `ingest.json`; the category becomes a tag in the suggested texts. It reads only what
anyone can see on Kick, and Kick's API has nothing about clips. `LINK_KICK_TOKEN` and
`LINK_KICK_API` point it at a stand-in for tests.

## Updates

An installed Link (Link-Setup.exe) brings itself up to date when it starts (`tools/reels/update.py`,
called by `link.pyw` before the server and the window). It reads `latest.json` from the newest
release of Link's public repository (`shushu-eco/link`: the code, the installer, the zip and the
update packages). When that release's number is higher than its own
`rwa-` number, it downloads the package (a zip of `tools/reels`, a few megabytes), checks its size
and SHA-256 against `latest.json`, unpacks it beside the installed files and then puts the files in
place, takes away the ones the new version no longer has, writes the new `VERSION`, and starts
again as the new version; the page says "Link updated itself to rwa-N" once.

- It never keeps Link from starting: without internet (it waits 6 seconds at most), with a failed
  download or a wrong checksum, Link opens as the version it is. Why is in `link.log`.
- Nothing is replaced until the package is down, checked and unpacked. If Link is stopped while
  the files are being put in place, the next start finishes that first, without the internet.
- Only Link's own code is updated. The speech model and Electron are never written to, and a
  package holding a file that would land anywhere else is refused whole.
- A copy run from the project (a git checkout) is never touched: git updates that one.
- The heavy files (Python, Electron, ffmpeg) come only with the installer. They have a number
  (`tools/package/RUNTIME`, kept in an install as `update/runtime.txt`); a release whose code needs
  a higher one is not applied, and the user is told once to download the new installer.

**The Updater** is a small window of its own (`tools/reels/updater`, started with Link's Electron:
`electron tools/reels/updater`), with a gear icon beside Link's on the Desktop (the installer makes
both; `ui/static/link_updater.ico`). It is Link's look at a fraction of the size: which version
this Link is, which is the newest, one sentence, and two buttons, **Update** and **Open Link**. It
asks `update.py --status` and `update.py --apply`. For an installed Link, Update does what Link
does by itself at start, and asks for Link to be closed first. For a copy run from the project,
where git owns the files, Update is `git pull --ff-only`: it fetches, and takes the new commits
only when the copy has no uncommitted changes of its own and nothing has to be merged. Nothing
from the internet is loaded into the window itself.

A release is made with `tools/package/release.ps1`: it packs `tools/reels` as git has it at HEAD
(it refuses uncommitted or unpushed work), writes `latest.json`, and with `-Publish` makes it the
newest release. The installer is not in every release: it lives under the fixed tag `installer`
(`-Installer` uploads `dist\Link-Setup.exe` there), so its download address never changes, and an
installer a few versions old installs a Link that updates itself at its first start. Installs made before this existed have no updater and need the new installer once.

## Night run

**Link Night** is a small window of its own (`tools/reels/night`, started with Link's Electron:
`electron tools/reels/night`). It opens from **Settings > General**, the square moon button
(`openNight` in `shell/main.js`); it has no Desktop icon. Its window's icon is
`ui/static/link_night.ico`. It lets Link collect material while nobody is there: choose the hours
(1 to 12), press **Start night**, and go.

- **What it records.** Live game streams on Kick (no ads there), three side by side for 30 minutes
  at a time: two shooters and one other game, taken from Kick's own list of who is live
  (`night/kick_live.py`, through the Kick app connected in Settings > Accounts), the most watched
  first, English before other languages, a channel not recorded yet before one that was. IRL, Just
  Chatting, casino and the like are left out. Without a Kick app it tries a fixed list of channels.
- **What it does with them.** After each stretch the recordings are stopped, "Keep this
  recording?" is answered with Save under the name Link offers, Link makes them tapes, and each
  recording and tape is checked (whole length, sound, candidates, transcript). Then the next
  stretch begins. Nothing is marked, dismissed or made into a reel: those are the user's answers,
  and learning takes nothing from a tape until the user has gone through it.
- **While it runs** the sound is off for the user, the PC is kept from sleeping and the screen from
  switching off, and the window shows a progress bar that fills, green, as the night's hours pass,
  the stretch, the streams and what was collected so far. The run is a program of its own
  (`night/driver.js`), and the window's program (`night/main.js`) stays to watch over it, also
  when the window is closed; the icon opens the window again. **Stop** ends the run after what
  records now is saved and made into tapes. It also stops by itself under 25 GB of free room.
- **It opens to a sound:** a tape going into a VCR, under two seconds and quiet (`night/open.mp3`,
  played by `night.js` at 30% volume): the clunk, a second of rewinding, the stop. It was cut
  from a 34-second recording of a VCR rewinding; the whirr, which is some 25 dB under the clunks
  there, is lifted so that it is heard. The picture taken for Discord loads the page in silence.
- **Night goes with Link.** It opens from Link and is not there without it: started while Link is
  closed, it ends at once; left open, it closes within about ten seconds of Link closing. Closing
  Link while a night runs ends the night: Link saves what it was recording (and makes those tapes
  the next time it opens), `#night` gets "Link Night ended: Link was closed", and Night closes.
  Link's window notes that it was closed on purpose (`link-closed.json` in the night's folder,
  written when the window goes); without that note a Link that is gone counts as crashed, and
  the night is *interrupted* instead (below). The night run's own restart of Link is noted as such.
- **How much room a night takes.** Under the boxes the window says it for the hours chosen:
  "About 8.1 GB for 5 hours: 11.6 h of streams. 95.6 GB are free", and in amber when that would
  leave under 25 GB (a night stops there). It is three streams, recording about three quarters of
  the time, at the size this PC's own nights' recordings have had (`usage.json` in the night's
  folder: each night of half an hour of recording or more adds its megabytes and seconds;
  `estimate` in `night/panel.js`), or at 0.9 GB an hour of stream until a night has been measured.
  The start card and the remote in `#night` say the same figure.
- **The PC's sleep timer.** Night reads Windows' own setting (`powercfg`, the time on mains or on
  battery, whichever the PC runs on) and says it in the window: "Your computer is set to sleep
  after 30 minutes, so Night keeps it awake while it works", with the user's own number, or that
  it is set never to sleep.
- **Sleep PC when done** (off): when a night has run its hours and its tapes are made, `#night`
  gets "Night is done working · the PC will go to sleep soon" and the window counts down 90
  seconds, with **Stay awake** to call it off (a button in both). Then Night waits until Link has
  nothing left to do, closes Link the way its close button does, posts "Night is putting the PC
  to sleep" right before it does, and puts the PC to sleep. Not after Stop, and not after an
  interruption. If Link does not close, the PC stays on and `#night` says so. `LINK_NIGHT_NO_SLEEP=1`
  does all of it but the sleep itself, for tests.
- **Options** (ticked in the window, kept in `%USERPROFILE%\.link\night\options.json`):
  *Updates in #night* (on): the Discord posts below. *Log live chat* (off): the streams' own chat
  is relayed to Discord's `#chat` during the night, and put back as it was afterwards; the chat's
  speed is counted either way. *Carry on by itself* (off): an interrupted night is carried on
  without being told, three times at most. *Shooters only* (off): the third stream is a shooter
  too. A night that runs keeps the chat and shooter choices it began with.
- **Discord `#night`.** The first night makes a channel `#night` that only the server's owner and
  the bot see (`makeNightChannel` in `shell/main.js`; the bot needs Manage Channels, else the
  alerts channel is used). There go: a line when the night starts, after every stretch and at the
  end; every 25 minutes "Link Night is still running… progress bar at N%" with a picture of the
  whole Night window (drawn off screen, so it is there with the window closed); and at once,
  marked ⚠, anything that interrupts a recording: a recording that stopped by itself, a stream
  that went offline (Kick's API is asked every three minutes; its recording is stopped and kept,
  and another stream is opened in its place when ten minutes or more of the stretch are left), a
  recording whose file stopped growing, a stream that could not be opened, a stretch cut short, a
  tape without sound. Every post is a card (a Discord embed, built by `post` in `night/main.js`
  from what the run writes to `events.jsonl`): a bar in its kind's colour (green for running,
  teal for a finished stretch, amber for trouble, red for interrupted, gold for the end), a title,
  named fields (the streams with their game and viewers, each new tape with its length and
  moments, the night's totals, the checks, the free room), the picture inside the card, and under
  it the night's progress as a bar with the time left and when it ends. The posts go straight to Discord with the bot's token from Link's
  `discord.json`, so they arrive when Link itself is down; the token never reaches a page.
- **Buttons.** Under a card are the buttons that fit it (`night/panel.js`, used by both programs):
  Status, Stop and Settings under a running night; Continue, Start over and Settings under an
  interrupted one; Start night and Settings under a finished one. **Settings**, `/nightset` and
  `/nightstop` on a night that is not running post the *remote*: how the night stands, and a
  button for everything (Start night, Stop, Status, Continue, Start over, one hour less or more,
  and a switch for each choice, green when on). A switch is flipped by Link's bot at once and the
  remote is drawn again in place; a button that does something is handed to the Night program
  like the command of that name. Buttons are heard by Link's bot (`answerButton` in
  `shell/main.js`), so they work while Link is open; the owner alone may press them.
- **Interrupted.** When the run's program is gone or gives up, or Link closes or crashes, the
  night is *interrupted*: what Link still records is saved, Link is opened again if it is gone
  (its bot has to be there to hear commands; recordings that were cut off are finished there),
  and `#night` gets "Oh no, Link Night was interrupted" with the reason and the picture. The
  window shows **Continue** (carry on until the time the night was to end) and **Start over**.
- **Commands in `#night`** (the owner alone; registered with Link's other commands in
  `shell/discord.js`, `NIGHT_COMMANDS`): `/night` (start a night, or a picture of how the running
  one stands), `/nightset` (show the settings, or change them without starting), `/continue`,
  `/retry` (from the beginning; `hours` for another length) and `/nightstop`. `/night` and
  `/nightset` take the window's choices as options: `hours`, `shooters_only`, `log_chat`,
  `carry_on`, `updates`; one that is given is kept from then on, as if ticked in the window.
  Link's bot hands each command to the Night program (`electron tools/reels/night --do=<what>`,
  started if it is not open), which does it and answers in the channel.
- **How it works Link.** Through Link's window's test port, which Link opens only when it is started
  with `LINK_DEBUG_PORT`. So the night run opens Link itself. A Link that is open the ordinary way
  is asked to close first, as its own close button would (a second copy of Link's window started
  with `--close-for-night` hands that on: recordings are saved, a job that runs is asked about),
  and is then opened again; when it does not close, the window says so. The port answers on this
  PC only, and stays open until Link is next started from its own icon.
- **What it leaves.** A report beside the walkthroughs, `videos/walkthroughs/<date>_<time>.md`
  (**Report** opens the newest), and the same as `.json` when it ends, with `"tapes": []` on
  purpose: learning leaves a walkthrough's tapes out, and these are to be learned from. What the
  night keeps while it runs is in `%USERPROFILE%\.link\night`: `plan.json` (when it began, when
  it ends, how it stands), `status.json`, `events.jsonl` and `night.log`.
- **Not covered.** If the Night program itself is ended, or the PC goes off or loses the internet,
  nothing can be posted; the next time the window opens it shows the night as interrupted.

## What it does today

- **Top bar:** two lights (a video is open in the Studio; a recording is running), the counters of
  the open tape, and buttons to record, mark a highlight and process recordings. While a recording
  runs, its length counts up next to the **Record** button.
  **Process recording** looks in the recording folder (Videos) for Link recordings that are not tapes
  yet. One is processed at once; with more, a list (newest first, the newest ticked) asks which,
  because the folder can hold recordings the user never meant to make tapes of, such as a call.
  **Auto-process** (on by default) processes each recording as soon as it is saved. Recordings under
  30 seconds are not auto-processed, as tests. While a video is processed the job box counts the
  steps; on a long one it estimates the analysis time and counts the candidates being listened to.
  In front of that sentence the box says what Link is up to, for fun ("Link is thinking…",
  "Hunting for the good parts…"): a few lines for each stage, a new one every four seconds
  (`MUSING` in `app.js`). A line that changes rolls: the old one up and out, the new one in from
  below (`funLine`, and `fun-out` / `fun-in` in `style.css`; no roll with "reduce motion" set).
  A job that went well hides its box after a few seconds (not while the mouse is on it or its details
  are open); a failed one stays.
- **When a recording stops, Link asks** at once: *Keep this recording?*, with a field for its name
  (offered: the channel or the page's name and the time) and two buttons. The file is on the disk
  already, so nothing is lost while the question is open. **Save** keeps it, gives the tape that
  name (`POST /api/recordings`, kept beside the recording as `.name.json` until `ingest.py` makes
  the tape, or put on the tape if it exists already) and, with Auto-process on, makes it a tape.
  **Discard**, after a second click, puts the recording and what Link kept beside it in the
  Recycle Bin; a recording that is a tape already is not thrown away from here. Esc is Save, and
  a question nobody answers for two minutes counts as Save, so a recording made while the user
  is away is still processed and none is thrown away by accident. Several recordings that stop
  together are asked about one after another. A recording saved as Link closes, or found again
  after a cut-off, is kept without asking.
- **Closed while it works.** Link can be closed, or the PC can go off, at any moment; nothing is
  left half made, and what was cut off is finished the next time Link opens, with a line saying so.
  - *Asked first.* Closing the window while a video is processed or reels are rendered asks
    whether to keep Link open. Closing it on a recording saves the recording first, as before, and
    notes it (`videos/pending.json`) to be processed next time when Auto-process is on.
  - *The job ends with Link.* The server's job is ended by Windows together with the server
    (`safe.end_with_me`), so nothing works on unseen. While a job runs it is written down in
    `videos/job.json`; one found there when the server starts was cut off.
  - *A video* being processed says so in its tape's `ingest.json` (`"state": "processing"`) until
    the last step is done. The next start processes it again under the same tape number
    (`GET /api/unfinished`), keeping the analysis if that was finished; uploading the file does the
    same. Link starts it twice in all; after that the tape is named once as not processable and
    left to the user (upload it again to try once more).
  - *Reels* are rendered under another name (`….part.mp4`) and put in place when whole, so a
    cut-off render leaves the reel that was there. The reels it did not get to are rendered when
    Link opens.
  - *A recording* that Link never got to finish is still in the Videos folder as
    `<date time>.part.webm`. At the next start it is made into its mp4 and treated like a recording
    just saved; its marks and chat counts are gone. One that cannot be read becomes `.broken.webm`.
  - *Every file Link writes* (edit lists, settings, sign-ins, analyses) is written under another
    name and swapped in (`tools/reels/safe.py`), and a file that cannot be read counts as not there
    instead of stopping the screen that lists all of them.
- **Video link** (in the heading of the Studio and of URL, between the screen's name and its
  buttons; the other screens have no link fields, and the list on the left reaches the top bar)
  opens a video in the Studio, see above. While the Studio
  shows it is the **Stream link**: `kick.com/<channel>` opens as `player.kick.com/<channel>` with the
  video laid over the player's own title, controls and badge, at full volume (Kick's own pages, such
  as signing in, open as they are). A hidden window then holds the channel's public chat and counts
  its messages per second (**CHAT n/min** in the Studio); a recording saves the counts as
  `<recording>.chat.json`, never the text. If nothing plays after 10 s, the Studio says the channel
  seems offline.
- **Upload video** (in the same strip) is the other way in: it asks for a video file on this PC and
  processes it like a recording (candidates, transcript, reels). The tape is named after the file.
  Any length is taken, and anything ffmpeg can read. The original stays where it is; Link works
  from a hard link in `videos/sources/`, or a copy when the file is on another drive. Choosing a
  file that is a tape already says which tape it is and opens it. An upright (9:16) video is not zoomed in.
  The file window belongs to Link's window, so in an ordinary browser the button only says so.
- **Instagram** (the button at the end of the top bar) opens your Instagram page in the Studio; you
  sign in there once and stay signed in. The first click asks for the page's name (kept as
  `instagram` in `%USERPROFILE%\.link\settings.json`); right-click the button to change it. It
  refuses while a recording runs, because the page would take the video's place.
- **Sidebar:** Studio, URL, Analytics and Sources. The handle on the sidebar's right edge slides it
  away and back; the choice is remembered.
- **Sources:** every analysed recording in `videos/reels/`, named by its date and time, on a screen
  of its own (`renderLibrary` in app.js): a list by day, or a grid of cards after **Change grid**
  (kept in the page's `link.sourcesView`). Both show the same tapes, narrowed by the chosen folder,
  the search and the filter. A tape's picture is `GET /strip/<id>.jpg`: eight frames spread over the
  video, made with ffmpeg the first time it is asked for and kept in the tape's `preview/` folder.
  An uploaded video has no recording time; it is listed under the day it became a tape (`made`).
  With no folder chosen the screen shows the tapes in no folder (the recent ones); a search or a
  filter looks through all of them. A tape's own name is kept in `label.json` in its folder
  (`POST /api/sources/<id>/name`), apart from `ingest.json`, which the recorder's bookkeeping reads.
  `POST /api/sources/<id>/delete` moves the tape's folder and its video in `videos/sources/` to the
  Recycle Bin (with `recording`, the recording in Videos too).
- **A tape's heading:** the tabs (Candidates, Reels, Finals) at the left, the tape's name at the
  right with what it is under it (its number, length, size, mode and file).
- **The timeline behaves freely** (`timeline` in `app.js`), in Candidates and in Reels. The mouse
  wheel zooms in and out around the pointer (down to ten seconds across); Shift and the wheel, or
  the bar that appears under it, moves along the recording; − + and FIT do the same by button, and
  ◎ zooms to the chosen stretch. That stretch, gold with an orange grip at each end and its times
  written on it, is dragged: an end to where the reel starts or ends, the middle to move it whole.
  In Candidates it is the chosen candidate, and what is dragged is the stretch its reel will be
  made of (the same as Set In / Set Out in the player; **↺ As found** puts it back). In Reels it
  is the open reel, and dragging changes its In and Out as typing them does: captions stay on
  their words, and it is unsaved until Save.
- **Candidates:** the score timeline on top, then two columns that scroll on their own: at the left
  the chosen candidate (`candFocus`: player, numbers, actions, what was said, its contact sheet), at
  the right every candidate as a row with three frames (`GET /strip/<id>/cand_NN.jpg`, cut from its
  contact sheet with ffmpeg once and kept in `preview/`). Arrows step, Space plays or pauses, Enter
  makes the reel, Delete dismisses (`candKey`); the keys are left alone while a field, a button or
  the video has them. Moments you marked while recording are flagged. A **Problems** box lists stretches with
  a black picture or no sound (red on the timeline; no candidates are taken there) and says when the
  whole recording was captured too quiet. **Play** shows that stretch of the source;
  **Make reel** adds it to the edit list with the next `POST-0NN` id, an empty title and hook, and
  captions pre-filled from what was said: one caption per sentence, without sound labels such as
  "(coughs)". Speech that starts before the moment or runs past it counts with the words said inside
  it. Candidate windows overlap, so the same speech can be in the transcript twice; the window that
  covers the moment best is used first, and each stretch of time is used once.
  A Kick recording's chat speed counts towards the score (as much as loudness, 4 s earlier than typed),
  shows as a green line on the timeline (CHAT), and a candidate where chat ran at 1.5× its average or
  more is tagged CHAT ×N.
  Speech is heard as English, and what whisper makes of noise (punctuation, broken characters,
  scripts mixed in one phrase) is dropped; a transcript made before that filter keeps its junk until
  `transcribe.py` is run on it again.
  **Any stretch** (under the timeline): click the timeline or type a time to play two minutes of the
  source from there, mark In and Out in the player, and make a reel from exactly that stretch.
- **Reels:** edit in/out, zoom, title, hook and captions of the edit list (`reels.json`). Above the
  player two small buttons, Instagram and YouTube, draw that platform's own screen over the reel
  (the page's name and picture, the caption or title, the column of buttons), so you see what the
  hook and captions end up under; a press on the lit one takes it away. It is drawn by Link
  (`lookOver`), nothing is fetched from the platform, and the numbers a platform would show are
  left out. Captions
  are timed from the reel's start, so moving In moves them the other way and each stays on its words;
  one that would end before the new start is dropped.
  - **Post text** (fold-out under the captions): the title and description for YouTube Shorts and
    TikTok. Saving rewrites the post file of a rendered reel when its title or post text changed.
  - **Play source footage** plays 5 s either side of the reel; **Set In here** / **Set Out here** copy
    the player's position into the fields.
  - **Preview** renders that reel as it is in the form, without saving, and shows it next to the form
    (a few seconds per reel).
  - **Zoom** is per reel: 1 shows the whole frame, higher enlarges the footage and crops its sides.
  - **Caption pacing:** a caption whose words are what is being said is paced by the voice, using
    speech recognition (accurate to roughly half a second; the first preview of a reel takes a few
    seconds longer while it listens). Other captions are paced evenly from their time; one left with
    less than a quarter second per word before the next caption is left out of the render rather
    than flashed. To turn voice pacing off for a source, add `"sync_captions": false` to `style` in
    its `reels.json`.
  - **Render** saves, then writes the final and its post file. **Remove** takes a reel off the list
    (second click confirms; it saves the form and keeps rendered files).
- **Sound of a reel** (`build_reels.py`): loudness in two passes (the stretch is measured, then
  `loudnorm` is told what it measured: `I=-14:TP=-2:LRA=11`), because one pass guesses and left
  short clips up to 2 dB low. Before that `aresample=async=1:first_pts=0` fills any hole in the
  tape's sound with silence of the same length, so sound and picture stay together (the preview
  clips and the transcript do the same).
- **Suggested texts** (`suggest_texts` in server.py): `add_reel` fills `title`, `hook` and
  `platforms` (YouTube Shorts, TikTok) from the reel's captions, the tape's Kick channel
  (`ingest.json` `chat`) or the recorded page's title (`title`, which the recorder keeps beside
  the recording as `<name>.title.json`).
- **Chat count** (`CHAT_WATCH` in main.js): Kick's chat window keeps 300 messages numbered 0-299
  and draws only the last screenful. While the list fills, the numbers tell new from old; once it
  is full, the new messages are the rows after the last ones seen a second before.
- **The recorder waits 0.45 s for the sound** before it starts the file (`recorder.js`), so the
  file's sound and picture begin together.
- **`/refresh`** (`quickNumbers` in `shell/main.js`): the two channels' own numbers read right now
  and shown where it was asked: followers or subscribers and the 28-day numbers of Instagram and
  of YouTube, without the posts one by one (that is the 12-hour report). For the owner and the
  crew's role, like `/status`. The 12-hour report and every such answer carry a **Refresh** button
  that does the same. It keeps nothing, so what the next report compares with stays as it was.
- **The remote as buttons** (`shell/remote_panel.js`): `/remote` in the control channel posts one
  message with a button for every command: List tapes, Tape, Status, Open, Record, Stop, Process
  newest, Process all, Reel, Render, Auto, Cancel auto, and Night remote. A command that needs to
  be told something (which tape, which link, how many minutes) asks for it in a small form first.
  A button, or its form filled in, becomes the command of that name with its options and goes the
  way a typed command goes (`answerRemoteButton`, then `answer`): the owner alone, in the control
  channel alone.
- **The owner's remote** (`shell/main.js`, "the owner's remote"; commands in `shell/discord.js`,
  `OWNER_COMMANDS`): slash commands answered only for the server's owner in the control channel
  (`dcfg.channels.control`). They call the same things the page does: `openPage`, `startRecording`,
  `stopRecording` in the window process, and the server's `/api/sources`, `/api/jobs` and
  `/api/sources/<id>/reels`. A slow command is deferred and its answer edited in; `/auto` reports
  its steps as ordinary messages.
- **The recorder's mixer keeps time by the PC's sound output** (`recorder.js`), playing silence
  there. With no output behind it (`sinkId: none`) it kept time by a timer, and Windows slows the
  timers of a program whose window is minimised or fully covered: recordings then lost a third
  of their sound for as long as Link was out of sight.
- **Finals:** the rendered videos with copy buttons for each platform's title and description, and a
  tick per platform for when it is posted. Every platform a reel is for counts, written or not, so
  "posts done" only reaches the total when each one is ticked; one without text says so.
  **Upload** on the YouTube Shorts row puts the reel on the channel as a Short
  (`youtube_api.upload`), and **Post on Instagram** posts it on the page as a reel
  (`instagram_api.publish_reel`); both go through `POST /api/publish`, both first show the title,
  text and file and wait for a press, and both tick their row when it worked. The upload needs a
  YouTube sign-in made after Link began asking for the upload permission (it offers to sign in
  again); Google keeps uploads from an unaudited project private, and Link says so when that
  happens. Posting needs an access key with `instagram_business_content_publish`. With a key
  that may not post, or with Shift held, **Post on Instagram** does what it always did: it copies
  the reel's file path and opens your Instagram page in the Studio, where you press Create and
  paste the path into the file window.

You can build reels entirely in the UI, or say "run Link" in Claude Code to have the moments picked
and the hooks and captions written, then adjust them here.

A reel made from a candidate gets a placeholder file name (`moment_<seconds>`); it is renamed after
its title the first time you save or preview it, and keeps that name once rendered.

Clips and previews are cached in `videos/reels/<SRC-id>/preview/`. Delete that folder to free space.

The page notices when `reels.json` is changed by something else, such as Claude Code or a text
editor. With no unsaved edits it reloads the list. With unsaved edits it shows a banner and refuses
to save until you choose: load the new version (your edits are dropped) or keep yours (the next save
overwrites the file).

## Files

| File | Role |
|---|---|
| `server.py` | HTTP server (Python standard library only). Reads Link's output folders and starts the Link scripts as jobs. API routes are listed in its docstring. |
| `static/index.html` | Page skeleton: top bar, source list, main area, job log. |
| `static/app.js` | All behaviour: polling, tabs, timeline drawing, reel form, finals. No framework, no build step. |
| `static/style.css` | Dark theme; colours are variables at the top. |

Edit a static file and reload the page. Restart the server after changing `server.py`.

## Not built yet

- Adding a platform other than YouTube Shorts and TikTok from the page (edit `reels.json` for that).
- Merging outside changes with unsaved edits; today it is one version or the other.
- Browsing more than two minutes of source at a time.
