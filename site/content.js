// What the pages say: the lists the templates in site/pages are filled with. Every statement here is
// about the extension as it is (extension/README.md) or as agreed for its release. Change wording here.
// Link is free and open source, and the pages say only that.

// "before": the extension is not in the store yet, the main button leads to Discord.
// "after": set STORE to the listing's address and RELEASE to "after".
const RELEASE = "after";
const STORE = "https://chromewebstore.google.com/detail/link-lite-recorder/jjbnifoddmcjocjdmiaondcimkjmkjaa";
const DISCORD = "https://discord.gg/N3jdn6WPJd";
const SOURCE = "https://github.com/shushu-eco/link";
// Link TURBO for Windows: the installer and the zip, always the newest, under one fixed address each.
const SETUP = "https://github.com/shushu-eco/link/releases/download/installer/Link-Setup.exe";
const ZIP = "https://github.com/shushu-eco/link/releases/download/installer/Link-Windows.zip";
// Link Dev, the developer tools extension: on Gumroad (free, pay what you want) until its Chrome Web Store listing
// is approved. Then set DEV_STORE to the listing's address and the page's main button says Add to Chrome.
const DEV_GUMROAD = "https://linkturbo.gumroad.com/l/linkdev";
const DEV_STORE = "";

const cta = RELEASE === "before"
  ? { ctaLabel: "Coming soon · get the date in Discord", ctaMid: "Coming soon · date in Discord", ctaShort: "Coming soon", ctaHref: DISCORD }
  : { ctaLabel: "Add to Chrome · free", ctaMid: "Add to Chrome · free", ctaShort: "Add to Chrome", ctaHref: STORE };
// ctaMid and ctaShort are the same button where a phone has less room (the hero and menu; the header and bottom bar).

const dot = { html: '<span aria-hidden="true" style="width:10px;height:10px;background:#ff5d5d;display:inline-block;animation:blink 1s steps(1) infinite"></span>' };

// What of the newer design the site shows. The header's product list and the cover under /turbo's hero are
// built and kept here, switched off until they are wanted: the built site is what is live.
const LIVE = { menu: false, cover: false };
const when = on => (on ? [1] : []);   // a template shows a part once or not at all: <sc-for list="{{ ... }}">

function header({ current = "" }) {
  const line = k => (current === k ? "#7fd6c2" : "transparent");
  const here = k => ({ html: current === k ? 'aria-current="page"' : "" }); // the phone menu marks the page you are on
  return { ...cta, plainNav: when(!LIVE.menu), dropNav: when(LIVE.menu), productLine: line(current === "home" ? "home" : "turbo"), liteLine: line("home"), turboLine: line("turbo"), devLine: line("dev"), howLine: line("how"), supportLine: line("support"),
    liteCur: here("home"), turboCur: here("turbo"), devCur: here("dev"), howCur: here("how"), supportCur: here("support") };
}

const home = {
  ...cta,
  source: SOURCE,
  recDot: dot,
  timer: { html: '<span class="timer">0:16</span>' },
  features: [
    { k: "RECORD", t: "Records the stream", d: "Picture and sound, cut out of the page. One mp4, up to 30 minutes." },
    { k: "MARK", t: "Marks highlights", d: "A hotkey and a few words. Or by itself, when chat speeds up." },
    { k: "REWIND", t: "Rewind", d: "Switched on, it keeps the last minutes, so a moment can be saved after it happened." },
    { k: "EXPORT", t: "For your editor", d: "The marks come with the recording: a list to copy, or a marker file for DaVinci Resolve." },
    { k: "LOCAL", t: "Stays on your computer", d: "Nothing is uploaded. No analytics. Chat is only counted: never who wrote, or what." },
    { k: "FREE", t: "Free and open source", d: "No key, no account, no limit. The code is public, so anyone can check what it does." },
  ],
  // The second section of the home page: three short films of the panel at work (site/clips, made from the
  // GIFs of the profile's README). Each plays by itself, silent, for as long as it is on the screen.
  clips: [
    { file: "demo", k: "RECORD · MARK", t: "Mark the moment, in a few words", d: "Press Record, and when something happens press Mark. A few words tell you later what it was.", alt: "The Link Lite panel records a stream; a highlight is marked and given the note clutch" },
    { file: "marks", k: "YOUR MARKS", t: "Every mark: its time and your note", d: "Each recording keeps its list of marks. Copy it, or take it into DaVinci Resolve as markers.", alt: "The panel's list of recordings, one of them open with its four marks, their times and notes" },
    { file: "rewind", k: "REWIND", t: "It already happened?", d: "With the rewind on, Link holds the last minutes while you watch. Save last makes a file of them.", alt: "The rewind holds 2:39 of 3:00; Save last is pressed and a file of the last minute is saved" },
  ],
  // The third section of the home page is one block with two faces that take turns: Link TURBO with its
  // services and what it is (free, open source), then the same for Link Lite. Each service is on show for a few seconds
  // (`g` is its place in the whole turn: TURBO's six, then Lite's six).
  faces: [
    { key: "turbo", f: 0, kicker: "The full program · for Windows", kickerColor: "#ff8a8a",
      name: { html: 'Link <span style="font-family:VT323,monospace;font-size:1em;letter-spacing:4px;color:#ff5d5d">TURBO</span>' },
      blurb: "The full program for Windows: from a live stream to a posted clip, on one computer. Download it as an installer or a zip; it keeps itself up to date.",
      slides: [
        { g: 0, n: "01", name: "RECORD", t: "Studio", d: "Up to 3 Kick or Twitch streams recorded at once, on your own computer.", big: "3", small: "STREAMS AT ONCE" },
        { g: 1, n: "02", name: "FIND", t: "Moments found for you", d: "Up to 30 ranked moments per recording, each with the time it happened.", big: "30", small: "MOMENTS A RECORDING" },
        { g: 2, n: "03", name: "EDIT", t: "Finished 9:16 clips", d: "Title, hook and captions timed to the voice. Ready for a phone screen.", big: "9:16", small: "FINISHED CLIPS" },
        { g: 3, n: "04", name: "POST", t: "YouTube Shorts and Instagram", d: "Post the clips you choose. Only those leave your computer.", big: "2", small: "PLACES TO POST" },
        { g: 4, n: "05", name: "MEASURE", t: "Analytics", d: "See how each posted clip did: over 7 days, 28 days or all time.", big: "7 · 28", small: "DAYS, OR ALL TIME" },
        { g: 5, n: "06", name: "NIGHT", t: "Link Night", d: "Choose the hours and go to bed. Link Night records your streams while you are away, three at a time, and has the moments ranked when you are back.", big: "1–12", small: "HOURS, BY ITSELF" },
      ],
      links: [{ href: SETUP, label: "Download for Windows" }, { href: "Turbo.dc.html", label: "What it does" }],
      terms: { kicker: "Link TURBO · open source", amount: "FREE", unit: "OPEN SOURCE", tag: "", tagShow: "none",
        points: [{ l: "Six services in one program", s: "Six services" }, { l: "Link Night included", s: "Night included" }, { l: "No key, no account, no limits", s: "No key" }, { l: "Runs on your own computer", s: "On your computer" }],
        note: "Windows 10 or 11. The installer or the zip, with everything it needs inside." } },
    { key: "lite", f: 1, kicker: "Today · browser extension", kickerColor: "#7fd6c2",
      name: { html: 'Link <span style="font-family:VT323,monospace;font-size:1em;letter-spacing:6px;color:#b9b4e0">LITE</span>' },
      blurb: "The recorder for Chrome, Edge and Brave: one recording of the stream in your tab, with the moments already marked.",
      slides: [
        { g: 6, n: "01", name: "RECORD", t: "Records the stream", d: "Picture and sound, cut out of the page. One mp4, up to 30 minutes.", big: "30", small: "MINUTES A FILE" },
        { g: 7, n: "02", name: "MARK", t: "Marks highlights", d: "A hotkey and a few words. Or by itself, when chat speeds up.", big: "★", small: "ALT+SHIFT+M" },
        { g: 8, n: "03", name: "REWIND", t: "Rewind", d: "Switched on, it keeps the last minutes, so a moment can be saved after it happened.", big: "3", small: "MINUTES KEPT" },
        { g: 9, n: "04", name: "EXPORT", t: "For your editor", d: "The marks come with the recording: a list to copy, or a marker file for DaVinci Resolve.", big: "1", small: "FILE, MARKS INSIDE" },
        { g: 10, n: "05", name: "LOCAL", t: "Stays on your computer", d: "Nothing is uploaded. No analytics. Chat is only counted: never who wrote, or what.", big: "0", small: "UPLOADS" },
        { g: 11, n: "06", name: "FREE", t: "Free and open source", d: "No key, no account, no limit. The code is public, so anyone can check what it does.", big: "GPL", small: "VERSION 3" },
      ],
      links: [{ href: "How It Works.dc.html", label: "See how it works" }, { href: "Open Source.dc.html", label: "About Link being open source" }],
      terms: { kicker: "Link Lite · open source", amount: "FREE", unit: "OPEN SOURCE", tag: "", tagShow: "none",
        points: [{ l: "No key and no account", s: "No key" }, { l: "No limit on how many recordings", s: "No limit" }, { l: "Every skin included", s: "Skins included" }, { l: "The code is public: GPL-3.0", s: "Code is public" }],
        note: "Add it from the Chrome Web Store, or load it from the code on GitHub." } },
  ],
  faqs: [
    { q: "Does it work on any stream?", a: "It works on Kick and Twitch stream pages in Chrome, Edge or Brave. Use it for streams you have the right to record." },
    { q: "Where does the file go?", a: "Into a folder named Link in your browser’s Downloads folder, as one mp4 named after the channel, the date and the time. Nothing leaves your computer." },
    { q: "How long can one recording be?", a: "Up to 30 minutes. Start again for a new file." },
    { q: "Is it really free?", a: "Yes. Link is free and open source: there is no licence key, no account and no limit on recordings." },
    { q: "Where is the code?", a: "On GitHub, at github.com/shushu-eco/link, under the GNU General Public License, version 3." },
  ],
};

// The cover under /turbo's hero is one layout (.mag in build.js) that takes a theme: its four pictures, shown
// as finished 9:16 clips, and its writing. COVER says which one the site shows. A theme also names the shape of
// its container: "device" is the machine of chrome and bone with the cover on its screen, "flat" the plain page. The pictures are made for
// Link (site/clips), never taken from a real magazine, poster or game.
const COVER = "cars";
const sticker = (colour, big, small) => ({ html: `<figcaption class="${colour}"><b>${big}</b><small>${small}</small></figcaption>` });
const clip = (cls, img, hook, cap, st) => ({ cls, img, hook: { html: hook }, cap: { html: cap }, sticker: st || { html: "" } });
const covers = {
  // a Japanese car magazine from a station kiosk
  cars: { key: "cars", shape: "device", label: "Link TURBO as the cover of a Japanese car magazine, its pictures four finished 9:16 clips with a hook and captions: it records three streams at once, finds the moments, edits 9:16 clips, records while you sleep, and is free",
    strip: "21世紀のクリップ製造マシン！", word: "ターボ", price: "定価 0円", head: [{ t: "寝てる間に" }, { t: "録るという" }, { t: "選択。" }], badge: "無料", badgeSmall: "FREE", foot: "投稿までおまかせ",
    reels: [
      clip("r1", "car-1", "The one<br>everybody wants", "just look at <b>that</b>"),
      clip("r2", "car-2", "Snow day,<br>no grip", "he sends it <b>anyway</b>", sticker("g", "3配信を同時録画！", "3 streams at once")),
      clip("r3", "car-3", "Wait,<br>two of them?", "parked like <b>twins</b>", sticker("y", "見どころを自動検出", "finds the moments")),
      clip("r4", "car-4", "Four<br>throttles", "listen to <b>this</b>", sticker("p", "9:16クリップに編集", "edits 9:16 clips")),
    ] },
  // a machine of chrome and bone with a green screen, and what it logs
  gothic: { key: "gothic", shape: "device", label: "Link TURBO as a machine of chrome and bone with a green terminal screen, its pictures four finished 9:16 clips with a hook and captions: it records three streams at once, finds the moments, edits 9:16 clips, records while you sleep, and is free",
    strip: "<<LINK TURBO>> SIGNAL RECEIVED · 3 STREAMS FOUND", word: "TURBO", price: "PRICE 0.00", head: [{ t: "> IT RECORDS" }, { t: "> WHILE YOU" }, { t: "> SLEEP_" }], badge: "FREE", badgeSmall: "0.00", foot: "POSTING · LEFT TO THE MACHINE",
    reels: [
      clip("r1", "g-1", "It woke up<br>at 3 AM", "nobody <b>touched it</b>"),
      clip("r2", "g-2", "One arrow<br>left", "he does not <b>miss</b>", sticker("g", "003 RECORDING ×3", "3 streams at once")),
      clip("r3", "g-3", "Do not take<br>its hand", "it <b>remembers</b>", sticker("y", "030 MOMENTS FOUND", "finds the moments")),
      clip("r4", "g-4", "Under<br>the church", "still <b>running</b>", sticker("p", "916 CLIP EDITED", "edits 9:16 clips")),
    ] },
};

const turbo = {
  cover: covers[COVER], coverOn: when(LIVE.cover),
  steps: [
    { n: "01", name: "RECORD", t: "Studio", d: "Up to 3 Kick or Twitch streams at once, on your own computer." },
    { n: "02", name: "FIND", t: "Moments found for you", d: "Up to 30 ranked moments per recording, with the time they happened." },
    { n: "03", name: "EDIT", t: "Finished 9:16 clips", d: "Title, hook and captions timed to the voice." },
    { n: "04", name: "POST", t: "YouTube Shorts and Instagram", d: "Post the clips you choose. Only those leave your computer." },
    { n: "05", name: "MEASURE", t: "Analytics", d: "See how each posted clip did: over 7 days, 28 days or all time." },
  ],
  // Link Night, as it works in the program today (tools/reels/ui/README.md, "Night run"), told as what it
  // is for: the user's own material. How it comes by its streams is not said here (the user's wish, 2026-10-09).
  // Three short films of the Night window (site/films/make.js makes them; a made-up night of six hours).
  nightClips: [
    { file: "night-1", k: "BEFORE BED", t: "Give it the hours, press Start night", d: "One to twelve hours. Tick Sleep PC when done if the computer should switch itself off afterwards. Then go.", alt: "The Link Night window: the hours are set to six, Sleep PC when done is ticked, Start night is pressed and the first stretch begins" },
    { file: "night-2", k: "WHILE YOU SLEEP", t: "Three streams at a time, all night", d: "It records in stretches of 30 minutes. After each one the recordings are checked and made into tapes, and the next stretch begins.", alt: "The night passes on a clock from 23:00 to 05:00 while the window's bar fills and its count of tapes and moments grows" },
    { file: "night-3", k: "THE MORNING", t: "Done, asleep, and waiting for you", d: "When the hours are up the PC goes to sleep by itself. In the morning the tapes are there, with their moments found.", alt: "The night is done, the window counts down to sleep, the screen goes dark; in the morning it shows 27 tapes and their moments" },
  ],
  night: [
    { k: "HOURS", t: "You choose how long", d: "From 1 to 12 hours. Press Start night and go. It ends by itself." },
    { k: "THREE AT ONCE", t: "Three streams side by side", d: "Recorded in 30-minute stretches, one after the other, for as long as the night lasts." },
    { k: "YOUR MATERIAL", t: "Made for your own streams", d: "Your own channel, and the channels you have permission to clip. It works through the night on material that is yours to use." },
    { k: "CHECKED", t: "Every recording is checked", d: "Whole length, sound, and the moments found, before the next stretch begins. A stream that goes offline is replaced." },
    { k: "REMOTE", t: "Watch it from your phone", d: "Updates in your own Discord server: progress, a picture of the night, and a warning at once if something stops. Start, stop or continue from there." },
    { k: "CAREFUL", t: "Looks after the computer", d: "Keeps it awake while it works, says beforehand how much room the night will take, stops before the disk fills, and can put it to sleep when done." },
  ],
};

// Link Dev (linkdev/ on the link-dev branch; its README and MVP.md say what it does). Its short films are made
// in linkdev/films (node linkdev/films/make.js site) and copied to site/clips as dev-<name>.mp4 and .jpg.
const dev = {
  get: DEV_STORE
    ? { href: DEV_STORE, label: "Add to Chrome · free", note: "free · open source · Chrome, Edge and Brave" }
    : { href: DEV_GUMROAD, label: "Get it free on Gumroad", note: "free · open source · pay what you want, if you like it" },
  gumroad: DEV_GUMROAD,
  source: SOURCE,   // Link's repository: the hero's Star button (Link Dev's own code is not on GitHub yet)
  storeSoon: when(!DEV_STORE),
  clips: [
    { file: "dev-recorded", k: "ALREADY RECORDING", t: "It failed before you opened F12", d: "Link Dev records from the moment the page starts. When something breaks, press Alt+Shift+D: the request, the console error and the cookies are already there. No reload, no trying again.", alt: "A request fails on a shop page; Alt+Shift+D opens Link Dev, which already holds the failed call with its status and answer" },
    { file: "dev-cors", k: "CONSOLE", t: "CORS errors, in plain words", d: "Not just “blocked”: which header is missing, which preflight failed, or why * is not allowed with cookies.", alt: "Link Dev's Console names the reason a cross-site call was blocked: the preflight answer has no Access-Control-Allow-Origin header" },
    { file: "dev-allow", k: "ALLOW IN DEV", t: "Blocked by CORS? See why, then allow it", d: "One click, in development, adds the headers the API forgot, as a rule you can see and switch off.", alt: "Allow in dev is pressed on a CORS error; a Headers rule is made and the call goes through" },
    { file: "dev-graphql", k: "GRAPHQL", t: "200 OK. But it failed.", d: "GraphQL hides its errors behind a 200. Link Dev names each call by its operation and counts a 200 with errors as failed, with the errors first.", alt: "A GraphQL call answered 200 with errors shows red in Link Dev, named by its operation, with its error message" },
    { file: "dev-mock", k: "MOCK", t: "Test your error screens", d: "Make any call answer what you want, in one click from the request: status, headers, body and delay.", alt: "A Mock rule answers the orders call with 503, and the shop page shows its error screen" },
    { file: "dev-scripts", k: "MOCK SCRIPTS", t: "Mocks that think", d: "A few lines of JavaScript work out each answer from the call. They run in a sandbox, never in the page.", alt: "A Mock script works out its answer from the call; Try it shows the answer" },
    { file: "dev-redirect", k: "REDIRECT", t: "Production calls, your localhost", d: "Replace a part of any address, so the live site talks to the server on your own computer. Page loads too.", alt: "A Redirect rule sends the production API to localhost; the calls in the list are tagged redirect" },
    { file: "dev-copyas", k: "COPY AS", t: "Copy as cURL, PowerShell, fetch, Python", d: "Seven forms, made to run as they are, on Windows too: cURL for bash and cmd, PowerShell, fetch, Node.js, Python requests and HTTPie.", alt: "Copy as on a request lists seven forms, and one of them is copied" },
    { file: "dev-secrets", k: "SECRETS", t: "Share your screen. Not your tokens.", d: "Tokens, cookies and passwords are hidden by default: on screen, in HAR files, reports and summaries. The eye shows them when you want.", alt: "Token and cookie values show as dots in Link Dev, on screen and in what it exports" },
  ],
  features: [
    { k: "NETWORK", t: "Every request, kept", d: "Status, headers, payload and response, kept across reloads. A badge counts the failed ones. Edit and resend, and export a HAR file or a summary for a ticket." },
    { k: "GRAPHQL", t: "Calls named by their operation", d: "query GetOrders, not just /graphql. A 200 with GraphQL errors counts as failed." },
    { k: "CONSOLE", t: "The page's console, copied", d: "Logs, uncaught errors and rejected promises, written the way DevTools writes them, and a line for every failed request." },
    { k: "APPLICATION", t: "Cookies and storage", d: "Cookies, local and session storage, IndexedDB and Cache storage: view, edit, add and delete." },
    { k: "RULES", t: "One click from any request", d: "Mock, Block, Delay, Redirect, or change headers. Each rule can be seen and switched off in Settings." },
    { k: "PRIVATE", t: "Nothing leaves your browser", d: "No account, no server, no analytics. It reads only the sites you turn on; local addresses are on from the start." },
  ],
  steps: [
    { n: "01", name: "INSTALL", t: "Add it to your browser", d: "Chrome, Edge or Brave, version 126 or newer. No account." },
    { n: "02", name: "OPEN", t: "Press Alt+Shift+D", d: "Or the Link Dev button. A window you put anywhere, or the side panel." },
    { n: "03", name: "TURN ON", t: "Your site, and nothing else", d: "Localhost works at once. On any other site, press Turn on for this site." },
  ],
};

const guide = [
  ["install", "Install", "Add Link Lite from the Chrome Web Store. It works in Chrome, Edge and Brave. There is no account.", "STORE", "The store listing, with the Add button."],
  ["open", "Open the panel on a stream page", "Go to a Kick or Twitch channel that is live and press the Link button in the browser’s toolbar, or Alt+Shift+K. The panel opens on the page as a small dark capsule, showing the site and the channel’s name. Drag its dotted top edge to move it. More widens it and shows the choices and your recordings.", "IDLE", "Compact panel: KICK · yourchannel · Record."],
  ["record", "Record and stop", "Press Record. The REC dot blinks and the timer runs. Only the stream’s picture is recorded: the page around it, the player’s buttons and the mouse pointer are left out. Press Stop, or let it reach the 30-minute limit, and the file is saved.", "REC 0:16", "The panel while recording: timer, marks, viewers, Stop and Mark."],
  ["mark", "Mark a highlight and add a note", "Press Alt+Shift+M or the Mark button when something happens, and type a few words if you want (“clutch 1v3”). Link also marks by itself when chat suddenly speeds up.", "MARK 4", "The note field that follows a mark."],
  ["rewind", "The rewind", "Switch the rewind on and Link keeps the last 3 minutes while you watch. Save the last minute (or 30 seconds, 2 or 3 minutes) makes a file of what you just saw. Record from here starts a recording that begins that far back. It uses some of the computer’s power for as long as it is on.", "REWIND", "Rewind on, with Save the last minute."],
  ["file", "Where the file goes and how it is named", "One mp4 goes into a folder named Link in your Downloads folder, named after the channel, the date and the time: “yourchannel 2026-10-08 15-07-12.mp4”. The marks, their notes and the stream’s title travel inside the file. Nothing is uploaded.", "SAVED", "The saved notice with the file’s name."],
  ["list", "The marks list and Copy list", "Under Recordings in the panel, a recording with marks has a star button. It opens the marks, each with its time and note. Copy list puts them on your clipboard as text, for any editing program.", "LIST", "The marks of a recording, with Copy list."],
  ["resolve", "Importing markers into DaVinci Resolve", "Markers for Resolve saves a marker file beside the video. In Resolve, put the recording at the start of a timeline, right-click that timeline in the media pool and choose Timelines, Import, Timeline Markers from EDL. The marks appear on the timeline; the ones chat made are yellow.", "EXPORT", "The Markers for Resolve button."],
  ["theatre", "Theatre mode for a sharper picture", "A recording is as sharp as the stream is big on the page. So when you press Record, Link switches the site to its theatre mode, says so for a few seconds, and switches back when the recording ends. This can be switched off.", "THEATRE", "The note shown when theatre mode is switched on."],
  ["shortcuts", "Keyboard shortcuts", "Alt+Shift+K opens or closes the panel. Alt+Shift+L starts recording, or stops and saves. Alt+Shift+M marks a highlight. Alt+Shift+J saves the last minute when the rewind is on. They can be changed on the browser’s extension shortcuts page.", "KEYS", "The four shortcuts."],
  ["settings", "The choices that can be switched off", "Under Choices: record only the stream’s picture, keep the player’s buttons and the pointer out of it, marks made by chat’s speed, and theatre mode by itself. Each can be switched off. Chat is only counted: never who wrote, or what.", "CHOICES", "The Choices part of the panel."],
];
const how = { ...cta, sections: guide.map((r, i) => ({ id: r[0], href: "#" + r[0], n: String(i + 1).padStart(2, "0"), t: r[1], p: r[2], tag: r[3], pic: r[4] })) };

const open = {
  ...cta,
  source: SOURCE,
  notes: [
    { k: "Licence", t: "What the licence allows", d: "The GNU General Public License, version 3. You may use Link for anything, read its code, change it and pass it on. Whoever passes on a changed version must pass on its code under the same licence." },
    { k: "Install", t: "Loading it from the code", d: "Download the code from GitHub, open chrome://extensions, switch on Developer mode, press Load unpacked and choose the folder named extension. That is the newest version, as it is in the repository." },
    { k: "Privacy", t: "Nothing to take on trust", d: "The extension uploads nothing and makes no request of its own to any server. With the code public, anyone can check that." },
    { k: "Help", t: "Found a problem, or want to help", d: "Open an issue on GitHub or say it in Discord. Changes to the code are welcome as pull requests." },
  ],
};

const g = (id, name, items) => ({ id, href: "#" + id, name, items: items.map(([q, a]) => ({ q, a })) });
const support = {
  groups: [
    g("recording", "Recording", [
      ["Which sites and browsers work?", "Kick and Twitch stream pages, in Chrome, Edge or Brave. Use it for streams you have the right to record."],
      ["How long can one recording be?", "Up to 30 minutes per file. Start again for a new file."],
      ["Why is the picture not sharp?", "The recording is as sharp as the stream is big on the page. Link switches the site to theatre mode when you press Record; for the sharpest picture, use a wide window as well."],
      ["Does it record the sound?", "Yes. Picture and sound go together into one mp4. Link puts the stream at full volume when the capture starts, because the recording is as loud as the page plays."],
    ]),
    g("marks", "Marks and editing", [
      ["How do I mark a highlight?", "Press Alt+Shift+M or the Mark button. Type a few words if you want. Link also marks by itself when chat speeds up."],
      ["How do I get the marks into my editor?", "Under Recordings in the panel, press the star beside a recording. Copy list gives a text list for any editor. Markers for Resolve saves a file that DaVinci Resolve imports as timeline markers."],
      ["What does the rewind do?", "Switched on, it keeps the last 3 minutes while you watch. You can save what just happened as a file, or start a recording that begins that far back."],
    ]),
    g("free", "Free and open source", [
      ["Is it really free?", "Yes. There is no licence key, no account and no limit on recordings."],
      ["Where is the code?", "On GitHub, at github.com/shushu-eco/link, under the GNU General Public License, version 3. You may use it, change it and pass it on under the same licence."],
      ["Are the skins free too?", "Yes. Classic, Midnight, Sakura and Halloween come with version 0.5.0, under More, in Skins."],
    ]),
    g("privacy", "Privacy", [
      ["Is anything uploaded?", "No. The recording and the marks stay on your computer. The extension makes no request of its own to any server, and the site and the extension have no analytics. The code is public, so this can be checked."],
      ["Does Link read the chat?", "It counts how many messages arrive each second, to mark busy moments. It never keeps who wrote a message or what it said. The marks made this way can be switched off."],
    ]),
    g("trouble", "Troubleshooting", [
      ["The panel does not appear.", "Press the Link button in the browser’s toolbar while you are on a Kick or Twitch page, and make sure the extension is switched on. If nothing happens, load the page again."],
      ["The file is missing.", "Look in the folder named Link inside the browser’s Downloads folder. The file is named after the channel, the date and the time. The panel’s Recordings list has a button that shows each file in its folder."],
      ["Recording stopped by itself.", "A recording ends at 30 minutes or when the stream’s page is closed. Start a new one to continue."],
    ]),
  ],
};

// Newest first. 0.4.3 is the version in the Chrome Web Store since 2026-10-09; the ones before it were never released.
const changelog = {
  entries: [
    { v: "v0.5.0", date: "2026-10-12", t: "Free and open source", d: "Link Lite has no licence key and no limit on recordings any more, and its code is public on GitHub under the GPL-3.0 licence. New in the panel: a sound bar for what you hear while it records, and four skins (Classic, Midnight, Sakura, Halloween), all included." },
    { v: "v0.4.3", date: "2026-10-08", t: "Start Watching on Twitch", d: "On Twitch, Link waits for you to press Start Watching before it records. In the Chrome Web Store since 9 October 2026." },
    { v: "v0.3.4", date: "2026-10-08", t: "Marks for your editor, and theatre mode by itself", d: "A recording’s marks can be copied as a list or saved as a marker file for DaVinci Resolve. Link switches the site to theatre mode when you press Record, and back when the recording ends." },
    { v: "v0.3.2", date: "2026-10-08", t: "One panel, one file", d: "The panel is one fixed size that can be moved anywhere. A recording is a single mp4 with its marks inside, named after the channel and the time. A stream page that was already open no longer needs to be loaded again." },
  ],
};

module.exports = {
  header,
  pages: {
    "index": { template: "home", data: home, title: "Link Lite Recorder · record a Kick or Twitch stream, with your highlights marked", script: "timer",
      description: "A browser extension for Chrome, Edge and Brave. It records the Kick or Twitch stream in your tab, marks the highlights and saves one file to your own computer. Free and open source." },
    "turbo": { template: "turbo", data: { ...turbo, setup: SETUP, zip: ZIP, source: SOURCE }, title: "Link TURBO · free and open source",
      description: "The full program for Windows, to download: records up to 3 streams at once, finds the moments, edits 9:16 clips and posts them. Link Night collects streams while you are away. Free and open source." },
    "dev": { template: "dev", data: dev, title: "Link Dev · DevTools without F12, free and open source",
      description: "A browser extension for Chrome, Edge and Brave: DevTools' Network, Console and Application tabs in a window you put anywhere, already recording when something breaks. Mocks, redirects, CORS in plain words. Nothing leaves your browser. Free and open source." },
    "how-it-works": { template: "how-it-works", data: how, title: "How it works · Link Lite Recorder", script: "phone",
      description: "Everything Link Lite Recorder does, in the order you will meet it: recording, marks, the rewind, the file, and getting marks into your editor." },
    "open-source": { template: "open-source", data: open, title: "Free and open source · Link", script: "phone",
      description: "Link is free and open source: no licence key, no account. Where the code is, what its licence allows, and how to help." },
    "support": { template: "support", data: support, title: "Support · Link",
      description: "Questions and answers about recording, marks, privacy and Link being free and open source, and how to reach support." },
    "changelog": { template: "changelog", data: changelog, title: "What's new · Link Lite Recorder",
      description: "Every version of Link Lite Recorder, newest first." },
    "404": { template: "404", data: { dot }, title: "Not found · Link", robots: "noindex", description: "This page is not here." },
  },
  documents: {
    "privacy": { source: "PRIVACY.md", title: "Privacy policy", description: "What Link does with data: it works on your own computer and nothing is uploaded." },
    "terms": { source: "TERMS.md", title: "Terms of use", description: "The terms for using Link Lite Recorder and Link TURBO: free, open source, and your responsibility for what you record." },
    "copyright": { source: "COPYRIGHT.md", title: "Copyright", description: "How to tell us about content that infringes your rights." },
  },
};
