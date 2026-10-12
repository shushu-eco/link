# Chrome Web Store listing: Link Lite Recorder

Everything to paste into the Chrome Web Store developer dashboard, in the order its tabs ask for it.
The files are in this folder: `link-lite-recorder-0.5.0.zip` (the package; zips are not kept in the
repository, make it as said below), `screenshots/` (five, 1280x800), `promo-tile-440x280.png` (the small
promo tile). The store icon is taken from the package.

Version 0.5.0 follows 0.4.3, in the store since 2026-10-09. What changes in the dashboard with it is marked **(changed)** below.

Rebuild the package after any change to `extension/`: zip the folder's contents without `README.md`.
Remake the screenshots with `node store/shots.js`. The moving demonstration at the top of the repository's README is `screenshots/demo.gif` (`node store/readme-demo.js`); it is not for the store. Try the package with `node store/freetest.js`.

---

## Package

Upload `link-lite-recorder-0.5.0.zip`. **(changed)**

## Store listing

**Title** (from the package): Link Lite Recorder

**Summary** (from the package, 132 characters at most):

```
Records the Kick or Twitch stream in this tab, with its chat speed and your marked highlights, for Link. Nothing is uploaded.
```

**Description** **(changed)**

```
Link Lite Recorder records the Kick or Twitch stream playing in your own browser tab, lets you mark the highlights as they happen, and saves one mp4 file to your own computer.

It is made for streamers, video editors and people who run social media accounts, who cut clips from streams they have the right to use.

WHAT IT DOES

● Records the stream: picture and sound, cut out of the page, as one mp4. Up to 30 minutes a recording.
★ Marks highlights: press a hotkey and write a few words ("clutch 1v3"). It also marks by itself when chat suddenly speeds up.
⟲ Rewind: switch it on and Link keeps the last 3 minutes while you watch, so you can save a moment after it happened.
▣ For your editor: the marks come with the recording. Copy them as a list of times and notes, or save a marker file that DaVinci Resolve imports as timeline markers.
⤢ Sharper picture: Link switches the site to theatre mode while it records, and back when it stops.

HOW IT WORKS

1. Open a live channel on kick.com or twitch.tv.
2. Press the Link button in the toolbar (or Alt+Shift+K). A small panel opens on the page.
3. Press Record. Mark highlights with Alt+Shift+M. Press Stop.
4. The file is in your Downloads folder, in a folder named Link.

PRIVATE BY DESIGN

Nothing is uploaded. Your recordings, marks and notes stay on your computer. There is no account, no analytics and no tracking, and the extension makes no request of its own to any server. Chat is only counted (messages per second), never who wrote or what was written.

FREE AND OPEN SOURCE

Link Lite Recorder is free: no licence key, no account, no limit on recordings. Its code is public under the GPL-3.0 licence at https://github.com/shushu-eco/link, so anyone can check what it does. Four skins for the panel are included.

USE IT FOR STREAMS YOU HAVE THE RIGHT TO RECORD

Link is a tool. Record your own streams, or streams whose owner allows it. Link writes the channel's name into every recording so the creator can be credited. You are responsible for following the rules of the platform you record from.

Works in Chrome, Edge and Brave. Not affiliated with Kick or Twitch.

Website: https://linkturbo.app
Code: https://github.com/shushu-eco/link
Support: support@linkturbo.app
```

**Category**: Tools (if "Workflow & Planning" or "Developer Tools" are the only near choices, use Tools)

**Language**: English

**Screenshots** **(changed)**: the five files in `screenshots/`, in their numbered order (`node store/shots.js`). Take the old ones off the listing.

**Store icon** (128 x 128): `store-icon-128.png`

**Small promo tile**: `promo-tile-440x280.png`

**Marquee promo tile** (1400 x 560, optional): `marquee-tile-1400x560.png` **(changed)**: made again for 0.5.0 with `node store/marquee.js`.

**Official URL**: none needed (optional; it needs the site verified in Google Search Console).

**Homepage URL**: `https://linkturbo.app`

**Support URL**: `https://linkturbo.app/support`

## Privacy

**Single purpose**

```
Records the live stream playing in the current Kick or Twitch tab to a video file on the user's own computer, with the highlights the user marks.
```

**Permission justifications**

| Permission | What to write |
|---|---|
| tabCapture | `Captures the picture and sound of the tab the user chose to record, after they press the extension's button or shortcut on that tab. This is the extension's single purpose.` |
| offscreen | `The recording is encoded in an offscreen document, because a service worker cannot hold a media stream or a MediaRecorder.` |
| activeTab | `Recording starts only on the tab where the user pressed the extension's button or shortcut; activeTab gives access to that tab at that moment.` |
| storage **(changed)** | `Keeps the user's settings, the position of the panel and the list of their last eight recordings. It stays in the browser.` |
| downloads | `Saves the finished recording, and the marker file the user asks for, to the user's Downloads folder, and shows a recording in its folder when asked.` |
| scripting | `Adds the extension's own page script to Kick and Twitch tabs that were already open when the extension was installed or updated, so the user does not have to reload the page.` |
| Host permission: kick.com, twitch.tv **(changed)** | `The page script runs only on these two sites. It finds the stream's video on the page, reads the channel's name and viewer count, counts chat messages per second (never their content), notices ads, and shows the extension's panel.` |

**Are you using remote code?** No. All code is in the package.

**Data usage** (what the extension collects or sends off the device)

- **(changed)** Untick **Authentication information**: there is no licence key any more, and nothing leaves the device.
- Leave every box unticked: personally identifiable information, health, financial and payment, authentication information, personal communications, location, web history, user activity, website content. The recording itself is never transmitted.

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: `https://linkturbo.app/privacy`

## Distribution

- **Payments** **(changed)**: free of charge, no in-app purchases.
- **Visibility**: Public.
- **Regions**: All regions.

## Notes for the reviewer (the "Test instructions" box, if shown)

```
No account or login is needed. Open any live channel on kick.com or twitch.tv, press the extension's toolbar button to open its panel on the page, then press Record, Mark and Stop. The file is saved to Downloads/Link. The extension is free and open source (https://github.com/shushu-eco/link): there is no licence key, no trial and no purchase, and it makes no network request of its own. The host permission for api.lemonsqueezy.com was removed in 0.5.0.
```

## After 0.5.0 is approved

1. Announce it in Discord.
