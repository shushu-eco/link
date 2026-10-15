# Link: privacy policy

Last updated: 15 October 2026

## Who is responsible

Link is made and offered by Shu, Spain.
Questions about privacy: support@linkturbo.app.

## The short version

Link works on your own computer. Your recordings, the moments Link finds in them and the clips it makes
are never sent to us. We run no analytics, no advertising and no tracking in any Link product or on this
website. There is no account to create. Link is free and open source: anyone can read
the code and check what is said here (github.com/shushu-eco/link).
Link Dev, the developer tools extension, reads only the sites you turn on, to show them to you, and
sends nothing anywhere.

## Link Lite Recorder (the browser extension)

**What it does with data**

- It records the picture and sound of the Kick or Twitch tab you tell it to record, and saves that as a
  video file in your Downloads folder. The file stays on your computer.
- While it records it counts how many chat messages arrive each second. Only the count is kept. It
  never keeps who wrote a message or what was written.
- It reads the channel's name, the stream's title and category, and how many are watching, from the
  page you have open, and writes the channel, title and category into the recording so the streamer can
  be credited.
- It notices when Twitch plays an ad, and notes when.

**What it stores in the browser**

- Your settings (for example whether the rewind is on, and which skin the panel wears).
- Where you last put its panel on the page.
- A list of your last eight recordings (channel, length, its marks and their notes), so the panel can show them.

This is kept in the browser's own extension storage on your computer and is removed when you remove the
extension.

**What it sends anywhere**

Nothing. Your recordings, marks and chat counts are sent nowhere, and the extension makes no request of
its own to any server. It has a button that opens Link's Discord invitation in a new tab if you press it.

**Versions before 0.5.0**

Versions before 0.5.0 stopped after three recordings and asked for a licence key. They kept the number
of recordings made (in the extension's storage, in the browser's synced storage, and as one small entry
in the browser's storage for kick.com and twitch.tv), and, when a key was entered, sent that key to a
licensing service, Lemon Squeezy (lemonsqueezy.com), to ask whether it was genuine. Version 0.5.0 does
none of this, and removes the count and any key from the browser when it arrives. Your browser updates
the extension by itself.

**Permissions it asks for, and why**

| Permission | Why |
|---|---|
| Record the tab (`tabCapture`, `offscreen`) | to record the stream's picture and sound |
| The tab you use it on (`activeTab`), and kick.com and twitch.tv | to find the stream on the page, count chat messages and show its panel |
| Add its script to open pages (`scripting`) | so it works on a stream page that was already open when the extension started |
| Storage | to keep your settings and the list of recent recordings |
| Downloads | to save the recording to your Downloads folder |

## Link Dev (the developer tools extension)

Link Dev shows what a web page does (its network requests, its console and its storage), the way the
browser's own developer tools do, in a panel you open with a button or Alt+Shift+D.

**What it reads, and only on the sites you turn on**

- Local addresses (localhost and 127.0.0.1) are on from the start. Any other site is read only after you
  press **Turn on for this site** (or **All sites**) and the browser asks you to allow it. Settings > Sites
  turns a site off again.
- On those sites it reads the requests the page makes (addresses, headers, what was sent and what came
  back), what the page writes to its console, and the page's cookies, local storage, session storage,
  IndexedDB and Cache storage, so it can show them to you.
- Secrets (tokens, cookies, passwords and fields whose name says secret) are hidden on screen and in
  every file you export, until you press the eye.

**What it stores in the browser**

- Your settings and the rules you make (Mock, Block, Delay, Redirect, Headers), in the browser's extension
  storage.
- The lists it records for each tab, in the browser's session storage, which is emptied when the browser
  closes.

This stays on your computer and is removed when you remove the extension.

**What it sends anywhere**

Nothing. Link Dev makes no request of its own to any server, and has no account, analytics or tracking.
It sends a request only when you ask it to: **Edit and resend** sends the request you edited from the page
itself, to the address you gave. Files you export (a HAR file, a report, a summary) are saved where you
choose.

**Your own scripts**

A Mock rule can answer with a small script you write. It runs in a sandboxed page inside the extension,
never in the web page, and is kept with your settings.

**Permissions it asks for, and why**

| Permission | Why |
|---|---|
| Read the tab's requests (`webRequest`) | to list the requests of the sites you turned on |
| The tab you open it on (`activeTab`) | to know which site you pressed the button on, so it can offer to turn it on |
| Side panel, storage | to show its panel, and keep your settings and rules |
| Cookies | to show and edit the cookies of the site in the tab (the Application tab) |
| Add its script to pages (`scripting`) | to copy request bodies and console lines on the sites you turned on |
| Change requests (`declarativeNetRequestWithHostAccess`) | for the Block, Redirect and Headers rules you make, on the sites you turned on |
| Offscreen document | to hold the sandbox your own Mock scripts run in |
| localhost and 127.0.0.1; any other site only when you allow it | the sites it may read |

## Link TURBO (the Windows program)

It is downloaded as an installer or a zip, and its code is public. As built today:

- Recording, finding moments, speech-to-text, editing and rendering all happen on your computer.
- If you choose to connect a service (Kick, YouTube, Instagram, Discord, Spotify), Link talks to that
  service directly from your computer, using keys or sign-ins that are your own. Those are stored on
  your computer, in your user folder, and are not sent to us. Each of those services has its own privacy
  policy, which applies to what you do there.
- When you post a clip, the clip and its title and text are sent to the service you post to. Nothing
  else is.
- The program can check whether a newer version exists and download it.
- Its built-in browser panel can block ads with public filter lists. Those lists are downloaded from
  their publishers when the program runs.

## The Discord server

Link's community server runs on Discord. What you write and do there is handled by Discord under
Discord's own privacy policy. We see what any server owner sees: your Discord name, your messages in the
server, and the roles you chose when you joined.

## The code on GitHub

Link's code is kept on GitHub. If you open an issue, comment or send a change there, GitHub handles it
under GitHub's own privacy policy, and what you write is public.

## This website

linkturbo.app is a plain page. It sets no cookies and loads nothing from other companies. The company
that hosts it keeps ordinary server logs (such as IP addresses) for a short time, as every web host does.

## Children

Link is not directed at children. The Discord server requires the minimum age Discord sets for your
country (13 or older).

## Your rights

Because Link does not collect your data, there is normally nothing for us to give you, correct or
delete. If you have written to us by email, you can ask us to delete that correspondence. If you live in
the EU or the UK you also have the right to complain to your data protection authority; in Spain that is the Agencia
Española de Protección de Datos (aepd.es).

## Changes

If this policy changes, the new version will be posted where this one is, with a new date, and
announced in the Discord server's announcements channel.
