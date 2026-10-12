# Link Lite Recorder (Chrome / Edge extension)

Records the Kick or Twitch stream in the tab in front, for Link. Free and open source (GPL-3.0, see
`LICENSE` at the top of the repository). Version 0.5.0 (0.4.3, in the Chrome Web Store since
2026-10-09, has no sound bar and no skins).

## What it does

- **A panel on the stream's page**: on kick.com and twitch.tv the toolbar button (or Alt+Shift+K) opens
  Link's panel on the page, with a close button. It always opens as a small capsule, 292 px wide.
  "More" makes it 560 px wide and shows the folded parts ("More streams at once", "Choices",
  "Recordings"), each shut, with its dropdown mark at the end of its title; a click opens one and the
  panel grows to hold it. "Less" brings the capsule back. It cannot be sized by hand and never shows a
  scrollbar. On any other page the toolbar button opens the ordinary popup.
- **Docked**: Link puts the panel in the bottom left corner of the window, over the site's menu. It
  stays there when the page scrolls. With no room on the left it goes to the right; it says so if it is
  in the picture.
- **Move it**: drag the dotted grip along the panel's top to put it anywhere in the window. It then stays
  there, on every page and after a reload. Double-click the grip and Link docks it again.
- **Never in the recording**: while it records or the rewind is on, the bar keeps off the stream's picture.
  Put over it, it slips to the nearest place beside it (under, over, left or right). You see it on the
  screen; the file, which is cut to the stream's picture, does not have it, nor the mouse on it. Only
  when the stream fills the whole window is there no such place: then the bar says it is in the picture.
- **Transparent mode**: the ◐ button makes the panel faint until the mouse is on it. Kept for next time.
- **How busy the stream is**: the bar shows the chat's speed and how many are watching, in turn.
- **Record this stream**: records the tab's picture and sound to an mp4. With "Record only the
  stream's picture" on (the default) the file holds just the stream, cut out of the page; the page
  itself is left as it is, so the chat stays readable while it records.
- **Rewind**: switched on, Link keeps the last 3 minutes while you watch. **Save the last minute**
  (or 30 seconds, 2 or 3 minutes) makes a file of what you just saw, and **Record from here** starts a
  recording that begins that far back. It uses some of the PC's power for as long as it is on.
- **Mark highlight**: remembers the moment, from the panel or with a shortcut, and asks for a few
  words to go with it ("clutch 1v3").
- **Marks by itself**: when the chat suddenly speeds up (three times its usual speed over five
  seconds), the moment the viewers are reacting to is marked. Can be switched off.
- **Chat speed**: counts the chat's messages each second. Only the count is kept, never who wrote or
  what was written. The chat has to be open on the stream's page.
- **Ads**: notices when Twitch plays an ad, so Link takes no moments from it.
- **Clean picture**: while it records, the player's buttons, the site's banners and the mouse
  pointer are kept out of the picture. Can be switched off.
- **Theatre mode, by itself**: a recording is as sharp as the stream is big on the page. So when Record is
  pressed Link switches the site to its theatre mode first, says so in the panel for a few seconds, and
  switches back when the recording ends (on Twitch with the site's own shortcut, Alt+T, when its button is
  not on the page). It can be chosen off under "Choices". (The rewind alone does not
  switch it.) The panel still shows how sharp the recording will be and, on Twitch, a button for theatre mode.
- **Twitch's question first**: some Twitch streams are shown only after "Start Watching" is pressed
  ("intended for certain audiences"). Until then there is no stream on the page, so Record and the rewind
  are switched off and the panel says to press it first (`gate()` in `content.js`).
- **For Halloween**: a jack-o'-lantern in pixels beside the name, from the first of October to the second
  of November (`halloween()` in `popup.js`; it stands where "OPEN BETA" was).
- **Sound**: puts the stream at full volume when the capture starts (both sites start a new visitor
  muted, and the recording is as loud as the page plays).
- **Sound bar**: since the site's own volume is kept at full, the panel has its own for what is heard.
  While the tab is captured (it records, or the rewind is on) a thin bar lies along the panel's bottom
  edge: a speaker (press: mute) and a slider; the mouse wheel over it moves it too. It turns down only
  what comes out of the speakers (a gain in `offscreen.js`, between the tab's sound and the sound
  output); the file is as loud as ever. The level is kept for next time (`options.volume`), a mute is
  not. It lies in the strip between the last row and the edge, so the panel is as big as without it;
  under the toolbar button it is a row of its own. Tried with `node store/fulltest.js <url> <port> ear <dir>`.
- **Skins**: the panel in other colours: Classic, Midnight, Sakura and Halloween. All are free. They are
  under "More", in the fold "Skins": a press puts one on, and it is kept for next time (`options.skin`).
  A skin is a list of colours in `popup.css` (`[data-skin="…"]`) and nothing else; red stays red in all
  of them (the name, TURBO, a recording that runs). The box around the panel on the page (its grip) is
  told the colours and wears them too.
  A skin's background moves: slow, dim marbling in the skin's own colours with faint lines across it,
  as on an old screen (`flowFrame()` in `popup.js`, `--flow` in `popup.css`). It is worked out on a
  picture a quarter of the panel's size, twelve times a second, stands still while the panel is out of
  sight, and is one still picture for whoever asked their computer for less movement. Classic has none.
- **Recordings**: the panel lists the last eight, each with a button that shows the file in its folder.
- **Marks, for an editor**: a recording with marks has a ★ button in the list. It opens the marks, each with
  its time and note. "Copy list" puts them on the clipboard as text, for any editing program; "Markers for
  Resolve" saves `<recording>.markers.edl` beside the video, which DaVinci Resolve imports as timeline
  markers (right-click the timeline in the media pool, Timelines > Import > Timeline Markers from EDL;
  the recording must start at the beginning of the timeline). Marks made by the chat's speed are yellow there.
- **Saved**: when a recording is saved the panel says so in green for two seconds. What went wrong stays until it is answered.
- **Tidying up after 0.4.3**: that version kept a count of recordings and a licence key in the browser's
  storage, and one entry (`link-lite`) in the own storage of kick.com and twitch.tv. This version takes
  them away when it arrives (`forgetLicence()` in `background.js`, and the top of `content.js`).
- **One stream at a time, recordings up to 30 minutes**: this is Link Lite.
- **More streams, shown locked**: the panel shows two more link fields, greyed, and says that several
  streams side by side come with Link TURBO, the full program, and to join Link's Discord for the news.
  "TURBO" is always written in small red pixel type (`.turbo` in `popup.css`).
  The Discord button appears once `DISCORD_INVITE` at the top of `popup.js` holds the invitation link.

Nothing is uploaded, and the extension makes no request of its own to anywhere. A recording is one file and one download, named after whose stream it is and when it began: `Downloads/Link/cammytft 2026-10-08 15-07-12.mp4`. What
belongs to it is inside the mp4 itself, in a box at the file's end (a `uuid` box named
`LinkLiteRecord01`, holding JSON; `tag()` in `offscreen.js`). A player passes over it; Link reads it
when the file is given to **Upload video** (`inside()` in `tools/reels/ingest.py`).

| Inside the file | Holds |
|---|---|
| `markers` | the highlights marked, as seconds |
| `notes` | what was written with a mark, and which marks the chat's speed made (`auto`) |
| `chat` | `{ channel, site, rate }`: chat messages per second |
| `ads` | stretches in which Twitch played an ad |
| `stream` | the stream's title and category, and whose it is (`channel`, `site`, `credit`: "twitch.tv/name") for the credit on a reel |

Only a browser that cannot make an mp4 (it then makes `.webm` or `.mkv`) still gets a folder,
`Downloads/Link/<its name>/`, with the video and the same things beside it as `….markers.json`,
`….notes.json`, `….chat.json`, `….ads.json` and `….stream.json`.

## The parts

| File | What it is |
|---|---|
| `manifest.json` | permissions, shortcuts, where the page script runs (kick.com, twitch.tv) |
| `background.js` | starts and ends the capture (rewind, recording), saves the files |
| `offscreen.js` | the recorder: a page nobody sees that encodes the picture and sound, keeps the rewind's last minutes and cuts files out of them |
| `content.js` | on the stream's page: which channel, where the stream is, chat counts, ads, the clean picture, the panel |
| `popup.*` | Link's window: the panel on a stream's page, and the popup under the toolbar button elsewhere |

## Try it

1. Open `chrome://extensions` (or `edge://extensions`), switch on **Developer mode**.
2. **Load unpacked**, and choose this `extension` folder.
3. Open a live channel on kick.com or twitch.tv (reload it if it was open already), press the Link
   button in the toolbar, then **Record this stream** in the panel that appears on the page.

A stream's page that was open before the extension was installed, updated or loaded again need not be
loaded again: the extension puts its page script into every open kick.com and twitch.tv tab when it starts,
and once more when its button is pressed on a page that does not answer (`wakeAll()` and `wake()` in
`background.js`; this is what the `scripting` permission and the two sites under `host_permissions` are for).

Chrome lets an extension record a tab only right after its button or shortcut was used on that tab.
Shortcuts are set at `chrome://extensions/shortcuts` (suggested: Alt+Shift+K panel, Alt+Shift+L record/stop, Alt+Shift+M mark, Alt+Shift+J save the last minute).

## Known limits

- The recording is as sharp as the stream is big on the page, and its size is set when the capture
  starts. Theatre mode is switched on for a recording; full 1080p still needs a window about 1920 wide
  with the chat folded away, or a larger screen.
- Clean picture works while a recording runs, not while only the rewind is on (the player's buttons
  would be gone for as long as you watch). A file saved from the rewind can have them in it.
- A part of the stream scrolled out of view is black in the recording (the panel warns).
- The rewind needs a browser that records mp4 (Chrome, Edge and Brave from version 126).
- Link does not show a mark's note yet: the notes travel inside the recording, and that is all so far.
