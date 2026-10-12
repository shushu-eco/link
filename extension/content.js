"use strict";
// Link Lite Recorder, on kick.com and twitch.tv: what only the stream's own page can tell.
//
//   who       which channel this tab shows, and what the stream is called
//   view      where the stream's picture is on the page, so the recorder can cut it out of the tab's picture
//             (the page is not changed: the chat stays where it is)
//   counting  while its tab is captured, how many chat messages arrived each second, and whether Twitch
//             plays an ad. Only the count leaves this page, never who wrote or what was written.
//   clean     while it records, what the site draws over the stream (the player's buttons, banners, the
//             mouse pointer) is kept out of sight, so that the recording is the stream alone
//   theatre   presses the site's own theatre-mode button: the recording is as sharp as the stream is big
//
//   panel     Link's own window on the page: a bar under the stream, as wide as it, which the toolbar button
//             (or its shortcut) opens and closes. It is the extension's popup page shown in a frame, so the
//             site cannot read or change it. It lies neither over the chat nor over the stream, and the
//             recording is cut to the stream, so it is not in the file; when there is no room under the
//             stream (theatre mode) it goes to the foot of the window, and says so if it is in the picture.
(() => {
  if (window.__linkLite) return;   // put in twice into the same page by the same extension: the first copy stays
  window.__linkLite = true;
  // The extension was loaded again while this page was open: the copy of this script that was here is
  // dead (it cannot reach the extension any more), and so is its panel. The panel is taken away; this
  // copy draws its own when asked.
  for (const old of document.querySelectorAll('iframe[title="Link Lite Recorder"]')) {
    (old.parentElement && old.parentElement.parentElement === document.documentElement ? old.parentElement : old).remove();
  }

  const KICK_PAGES = /^(login|signup|register|popout|video|videos|clips|categories|category|search|following|browse|dashboard|settings|terms-of-service|privacy-policy|community-guidelines|dmca-policy)$/i;
  const TWITCH_PAGES = /^(directory|videos|settings|login|signup|popout|downloads|jobs|search|subscriptions|wallet|inventory|drops|turbo|prime|store|friends|following|moderator|team|collections|embed|clips|bits|privacy|security|creatorcamp|broadcast|activate|payments|annual-recap|p|u)$/i;

  // The live channel this page is: { site, channel }, or null on any other page of the site.
  function channel() {
    const host = location.hostname.replace(/^(www|m)\./, "").toLowerCase();
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    if (host === "kick.com" && /^[a-z0-9_-]{2,40}$/i.test(parts[0]) && !KICK_PAGES.test(parts[0])) return { site: "kick", channel: parts[0].toLowerCase() };
    if (host === "twitch.tv" && /^[a-z0-9_]{3,25}$/i.test(parts[0]) && !TWITCH_PAGES.test(parts[0])) return { site: "twitch", channel: parts[0].toLowerCase() };
    return null;
  }

  const text = (selector) => { const node = document.querySelector(selector); return node ? node.textContent.replace(/\s+/g, " ").trim() : ""; };
  function who() {
    const c = channel();
    if (!c) return null;
    const title = c.site === "twitch"
      ? text('[data-a-target="stream-title"]') || text("h2[title]")
      : text('[data-testid="livestream-title"]') || text('[data-testid="stream-title"]');
    const category = c.site === "twitch" ? text('[data-a-target="stream-game-link"]') : text('a[href^="/category/"]');
    return { ...c, title: title.slice(0, 150), category: category.slice(0, 80), video: !!mainVideo(), view: view(), theatre: canTheatre(), viewers: viewers(c.site), gate: gate() };
  }

  // Twitch asks before it shows some streams ("intended for certain audiences", with a Start Watching
  // button over the player). Until that is answered there is no stream on the page, only the question,
  // and a recording would be of the question.
  function gate() {
    if (!/(^|\.)twitch\.tv$/.test(location.hostname)) return false;
    if (document.querySelector('[data-a-target*="content-classification-gate"]')) return true;
    return [...document.querySelectorAll("button")].some((b) => /^start watching$/i.test(b.textContent.trim()));
  }

  // Versions before 0.5.0 kept a count of recordings in this site's own storage too. It is not used any
  // more: that one small entry is taken away.
  try { localStorage.removeItem("link-lite"); } catch (e) { /* the site's storage is shut: nothing was kept */ }

  // How many are watching, as the page shows it. Twitch writes the number out. Kick draws each digit as a
  // strip of 0 to 9 that rolls to the right one, so the digit read is the one in the middle of each strip.
  function viewers(site) {
    let text = "";
    if (site === "twitch") text = (document.querySelector('[data-a-target="animated-channel-viewers-count"]') || {}).textContent || "";
    else {
      const root = document.querySelector('[data-testid="viewer-count"]');
      if (!root) return null;
      const box = root.getBoundingClientRect(), middle = box.top + box.height / 2, strips = new Map();
      for (const n of root.querySelectorAll("*")) {
        if (n.children.length || !/^[\d,.]$/.test(n.textContent.trim())) continue;
        const r = n.getBoundingClientRect();
        if (!r.height) continue;
        const at = Math.round(r.left), off = Math.abs(r.top + r.height / 2 - middle);
        if (!strips.has(at) || off < strips.get(at).off) strips.set(at, { off, digit: n.textContent.trim() });
      }
      text = [...strips.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s.digit).join("");
    }
    const n = Number(text.replace(/[^\d]/g, ""));
    return text && Number.isFinite(n) ? n : null;
  }

  // The stream's own picture: the largest video that is playing on the page.
  function mainVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area && (v.readyState > 1 || !best)) { best = v; area = a; }
    }
    return best;
  }

  // ---- where the stream is on the page. The recording is of the whole tab; the recorder cuts the stream out
  // of it by this, so the page itself is left as it is and the chat stays where the user reads it.
  function view() {
    const v = mainVideo();
    if (!v || !innerWidth || !innerHeight) return null;
    const box = v.getBoundingClientRect();
    if (box.width < 64 || box.height < 36) return null;
    // The picture itself, not the player's box: a box of another shape (theatre mode) has black bars beside it.
    let r = { left: box.left, top: box.top, width: box.width, height: box.height };
    if (v.videoWidth && v.videoHeight) {
      const fit = Math.min(box.width / v.videoWidth, box.height / v.videoHeight), w = v.videoWidth * fit, h = v.videoHeight * fit;
      r = { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
    }
    r.right = r.left + r.width;
    r.bottom = r.top + r.height;
    const seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1, x: r.left, y: r.top, w: r.width, h: r.height, seen: seen / (r.width * r.height) };
  }

  // The recording is as loud as the page plays, and both sites start a new visitor muted: the stream is
  // put at full volume when a recording starts, as Link's own Studio does.
  function loud() {
    const v = mainVideo();
    if (!v) return;
    if (v.muted) {
      const button = document.querySelector('[data-a-target="player-mute-unmute-button"]');   // Twitch keeps its own mute beside the video's
      if (button) button.click();
    }
    v.muted = false;
    v.volume = 1;
  }

  // ---- clean: what lies over the stream's picture is out of sight while it records.
  // Both sites keep the video in a few boxes exactly its size, with their buttons and banners as the
  // other things in those boxes: those are what is hidden. They stay where they are and go on working
  // (an ad is still noticed); they are only not drawn.
  const HIDE = "data-link-lite-hide";
  let cleaning = false;
  function clean(on) {
    cleaning = !!on;
    if (cleaning && !document.getElementById("link-lite-clean")) {
      const style = document.createElement("style");
      style.id = "link-lite-clean";
      style.textContent = `html.link-lite-clean [${HIDE}] { opacity: 0 !important; }
        html.link-lite-clean [${HIDE}], html.link-lite-clean [${HIDE}] *, html.link-lite-clean video { cursor: none !important; }`;
      document.documentElement.appendChild(style);
    }
    document.documentElement.classList.toggle("link-lite-clean", cleaning);
    for (const n of document.querySelectorAll(`[${HIDE}]`)) n.removeAttribute(HIDE);
    const v = cleaning ? mainVideo() : null;
    if (!v) return;
    const r = v.getBoundingClientRect(), area = r.width * r.height;
    for (let inner = v, box = v.parentElement; box && box !== document.body; inner = box, box = box.parentElement) {
      const b = box.getBoundingClientRect();
      if (b.width * b.height > area * 1.15) break;   // from here on it is the page, not the player
      for (const other of box.children) if (other !== inner && other.tagName !== "VIDEO") other.setAttribute(HIDE, "");
    }
  }

  // ---- theatre mode: the site's own
  // Kick's button has no name, only a mark of its own, and Kick draws its player's buttons only while the
  // mouse is over the stream; whether theatre mode is on, Kick says on the page itself (data-theatre).
  // Twitch has a button too ("Theatre Mode", "Exit Theatre Mode" while in it), but it is not always on the
  // page and not always named. So on Twitch its own shortcut is used when the button is not found, Alt+T,
  // and whether theatre mode is on is read from how the page is laid out (its player is marked "--theatre").
  const KICK_THEATRE = 'button[data-testid="video-player-theatre-mode"]';
  function theatreButton() {
    return document.querySelector(KICK_THEATRE)
      || [...document.querySelectorAll("button[aria-label], button[title]")].find((b) => /theat(re|er) mode/i.test(b.getAttribute("aria-label") || b.title || "")) || null;
  }
  const kickSays = () => document.querySelector("[data-theatre]");
  const onTwitch = () => /(^|\.)twitch\.tv$/.test(location.hostname);
  const twitchSays = () => !!document.querySelector('.persistent-player--theatre, [class*="--theatre-mode"]');
  function twitchKey() {   // Alt+T, as Twitch's player takes it from the keyboard
    for (const type of ["keydown", "keyup"]) document.dispatchEvent(new KeyboardEvent(type, { key: "t", code: "KeyT", keyCode: 84, which: 84, altKey: true, bubbles: true, cancelable: true }));
  }
  const canTheatre = () => !!(theatreButton() || kickSays() || (onTwitch() && mainVideo()));
  function inTheatre(b) {
    const kick = kickSays();
    if (kick) return kick.dataset.theatre === "true";
    return onTwitch() ? twitchSays() : /exit|leave|default/i.test((b && (b.getAttribute("aria-label") || b.title)) || "");
  }
  // Makes the site draw its player's buttons, as a mouse over the stream would.
  function wakePlayer() {
    const v = mainVideo();
    if (!v) return;
    const r = v.getBoundingClientRect();
    for (let e = v, i = 0; e && i < 5; e = e.parentElement, i++) {
      for (const type of ["pointerenter", "mouseenter", "pointermove", "mousemove", "mouseover"]) {
        e.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window }));
      }
    }
  }
  // Theatre mode on or off, or (no `on` given) the other way round.
  async function theatre(on) {
    let b = theatreButton();
    for (let i = 0; !b && kickSays() && i < 4; i++) {   // Kick: the button is not there until the player is woken
      wakePlayer();
      await new Promise((resolve) => setTimeout(resolve, 250));
      b = theatreButton();
    }
    if (!b && !(onTwitch() && mainVideo())) return { ok: false };
    const is = inTheatre(b);
    const changed = on === undefined || on !== is;
    if (changed) { if (b) b.click(); else twitchKey(); }
    return { ok: true, changed, was: is };
  }

  // ---- the panel
  // A box of the page's with two things in it: a grip along its top to move it by, and the extension's
  // popup page in a frame. It has two shapes and cannot be sized by hand: a capsule as wide as WIDE, which
  // is how it always opens, and as wide as ROOMY while "More" is open, with what is behind it in columns. In both it is as tall
  // as its page asks for. Moved by hand it stays where it was put, on every page and after a reload, until
  // the grip is double-clicked: then Link places it again (docked in a bottom corner of the window).
  const GRIP = 12, WIDE = 292, ROOMY = 560;
  const GLIDE = "transition:height .14s cubic-bezier(.2,.8,.2,1),top .14s cubic-bezier(.2,.8,.2,1),opacity .18s ease-out,box-shadow .18s ease-out;";
  let panel = null, frame = null, free = null, dragging = false, roomy = false;
  // The colours of the box and its grip: the panel's page says them (its skin), as four plain colours.
  let look = { bar: "#120f2a", grip: "#1c1740", dot: "#3f6f7a", ink: "#090c1e" };
  const shadow = () => `0 0 0 2px ${look.ink},0 8px 26px rgba(0,0,0,.6)`;
  function wear(said) {
    const next = { ...look };
    for (const k of Object.keys(look)) if (said && /^#[0-9a-f]{6}$/i.test(said[k] || "")) next[k] = said[k];
    if (Object.keys(look).every((k) => look[k] === next[k])) return;
    look = next;
    if (!panel) return;
    panel.style.background = look.bar;
    Object.assign(panel.firstChild.style, { backgroundColor: look.grip, backgroundImage: `radial-gradient(circle,${look.dot} 1px,transparent 1.5px)`, borderBottomColor: look.ink });
    ghost();
  }
  const part = (css) => { const n = document.createElement("div"); n.style.cssText = "all:initial;position:absolute;" + css; return n; };
  function showPanel(on) {
    if (!on) { if (panel) panel.remove(); panel = frame = null; return; }
    if (panel) return;
    roomy = false;   // its page always opens as the capsule
    panel = document.createElement("div");
    // From one shape to the other its width is set at once and its height glides, quickly, with its top
    // edge gliding too (docked, it grows upwards from the foot of the window).
    panel.style.cssText = `all:initial;position:fixed;z-index:2147483646;background:${look.bar};box-sizing:border-box;`
      + `box-shadow:${shadow()};` + GLIDE;
    const grip = part(`left:0;top:0;right:0;height:${GRIP}px;cursor:move;background:${look.grip} radial-gradient(circle,${look.dot} 1px,transparent 1.5px) center/6px 6px repeat-x;border-bottom:1px solid ${look.ink};box-sizing:border-box;`);
    grip.title = "Drag to move. Double-click: Link places it again.";
    frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("popup.html");
    frame.title = "Link Lite Recorder";
    frame.style.cssText = `all:initial;position:absolute;left:0;top:${GRIP}px;width:100%;height:calc(100% - ${GRIP}px);border:0;color-scheme:normal;`;
    panel.append(grip, frame);
    hold(grip);
    grip.addEventListener("dblclick", () => { free = null; chrome.storage.local.remove("panelPlace").catch(() => {}); placePanel(); });
    panel.addEventListener("mouseenter", () => { hovering = true; ghost(); });
    panel.addEventListener("mouseleave", () => { hovering = false; ghost(); });
    document.documentElement.appendChild(panel);
    ghost();
    placePanel();
    chrome.storage.local.get("panelPlace").then((kept) => {
      const at = kept && kept.panelPlace;
      if (at && Number.isFinite(at.left) && Number.isFinite(at.top) && !dragging) { free = { left: at.left, top: at.top }; placePanel(); }
    }).catch(() => {});
  }
  // Moving by hand. While the grip is held the frame takes no mouse, or the pointer would be lost to it
  // the moment it crosses it; and nothing glides, the panel follows the hand.
  function hold(grip) {
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !panel) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const box = panel.getBoundingClientRect(), from = { x: e.clientX, y: e.clientY };
      dragging = true;
      frame.style.pointerEvents = "none";
      panel.style.transition = "none";
      const move = (m) => {
        free = { left: box.left + m.clientX - from.x, top: box.top + m.clientY - from.y };
        placePanel();
      };
      const done = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", done);
        grip.removeEventListener("pointercancel", done);
        dragging = false;
        frame.style.pointerEvents = "";
        panel.style.cssText += GLIDE;
        if (free) {   // kept as it now lies, so that a pull past the window's edge is not remembered
          const now = panel.getBoundingClientRect();
          free = { left: now.left, top: now.top };
          chrome.storage.local.set({ panelPlace: free }).catch(() => {});
        }
        ghost();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", done);
      grip.addEventListener("pointercancel", done);
    });
  }
  // Transparent mode: the bar is faint until the mouse is on it, so it takes nothing from the stream's page.
  let ghostly = false, hovering = false;
  function ghost() {
    if (!panel) return;
    const faint = ghostly && !hovering && !dragging;
    panel.style.opacity = faint ? "0.28" : "1";
    panel.style.boxShadow = faint ? "none" : shadow();
  }
  // The stream on the page: only on a channel's page, and only a picture big enough to be it.
  // (A page of thumbnails plays small previews; they are not the stream.)
  function streamBox() {
    if (!channel()) return null;
    const v = mainVideo(), box = v ? v.getBoundingClientRect() : null;
    return box && box.width >= 320 && box.height >= 180 ? box : null;
  }
  // Where Link puts it: docked in a bottom corner of the window, beside the stream where the site keeps
  // its menu, which stays put when the page scrolls. Put somewhere by hand, it is there instead, kept
  // inside the window. Its size is the same in both.
  let panelHeight = 58;
  function placePanel() {
    if (!panel) return;
    const edge = 10, box = streamBox();
    const wide = Math.min(roomy ? ROOMY : WIDE, innerWidth), high = Math.min(panelHeight + GRIP, innerHeight);
    let left, top;
    if (free) {
      left = Math.max(0, Math.min(free.left, innerWidth - wide));
      top = Math.max(0, Math.min(free.top, innerHeight - high));
    } else {
      // the side with room beside the stream: the left one, unless only the right one has any
      const roomLeft = box ? box.left : innerWidth, roomRight = box ? innerWidth - box.right : 0;
      const onRight = roomLeft < wide + 2 * edge && roomRight > roomLeft;
      left = Math.max(0, onRight ? innerWidth - wide - edge : Math.min(edge, innerWidth - wide));
      top = Math.max(0, innerHeight - high - edge);
    }
    // While the tab is captured (it records, or the rewind is on) the bar keeps off the stream's picture:
    // the file is cut to that picture, so a bar beside it is seen on the screen and is not in the file,
    // and neither is the mouse on it.
    if (ticking) ({ left, top } = clearOf({ left, top, wide, high }, view()));
    Object.assign(panel.style, { width: `${Math.round(wide)}px`, height: `${Math.round(high)}px`, left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }
  // The nearest place for the bar that does not touch the stream's picture: under it, over it, or beside
  // it. Where the picture leaves no room (theatre mode filling the window) the bar stays where it is, and
  // says that it is in the picture.
  function clearOf(p, pic) {
    if (!pic) return p;
    const gap = 8, r = { left: pic.x, top: pic.y, right: pic.x + pic.w, bottom: pic.y + pic.h };
    const hits = (q) => q.left < r.right && q.left + q.wide > r.left && q.top < r.bottom && q.top + q.high > r.top;
    if (!hits(p)) return p;
    const fits = (q) => q.left >= 0 && q.top >= 0 && q.left + q.wide <= innerWidth && q.top + q.high <= innerHeight;
    const ways = [
      { ...p, top: r.bottom + gap },
      { ...p, top: r.top - gap - p.high },
      { ...p, left: r.left - gap - p.wide },
      { ...p, left: r.right + gap },
    ].filter((q) => fits(q) && !hits(q));
    const far = (q) => Math.abs(q.left - p.left) + Math.abs(q.top - p.top);
    return ways.sort((a, b) => far(a) - far(b))[0] || p;
  }
  addEventListener("resize", placePanel);
  addEventListener("scroll", placePanel, true);
  setInterval(placePanel, 500);   // the player moves when the site changes its layout (theatre mode, the chat folded away)
  // The panel's page says how tall it is, and when its close button was pressed. Only its own frame is listened to.
  addEventListener("message", (event) => {
    if (!panel || event.source !== frame.contentWindow || !event.data || event.data.linkLite !== true) return;
    if (event.data.look) wear(event.data.look);
    if ("ghost" in event.data && ghostly !== !!event.data.ghost) { ghostly = !!event.data.ghost; ghost(); placePanel(); }
    // "More" opened or closed: the other shape. The height said with it was measured at the old width, so
    // it is passed over; the page says its height again as soon as it has its new width.
    if ("wide" in event.data && roomy !== !!event.data.wide) { roomy = !!event.data.wide; placePanel(); return; }
    if (event.data.close) showPanel(false);
    else if (Number.isFinite(event.data.height)) { panelHeight = Math.max(44, Math.ceil(event.data.height)); placePanel(); }
  });
  // Whether the panel is in the recording: it lies over the stream's picture.
  function panelOver() {
    const v = mainVideo();
    if (!panel || !v) return false;
    const a = panel.getBoundingClientRect(), b = v.getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // ---- counting the chat. Both sites keep only their newest messages on the page.
  // Twitch leaves a message's row as it is until it takes it away: a row not seen before is a new message.
  // Kick numbers its rows and, once its list is full, gives the newest always the same number: then the new
  // ones are the rows after the last ones seen a second ago (told by who wrote them and what they said).
  let chat = null;
  function newMessages() {
    const c = channel();
    if (!c) return null;
    if (c.site === "twitch") {
      const root = document.querySelector(".chat-scrollable-area__message-container, [data-test-selector='chat-scrollable-area__message-container']");
      if (!root) return null;
      if (!chat || chat.root !== root) chat = { root, first: true, seen: new WeakSet() };
      let n = 0;
      for (const row of root.querySelectorAll(".chat-line__message")) {
        if (chat.seen.has(row)) continue;
        chat.seen.add(row);
        if (!chat.first) n++;
      }
      chat.first = false;
      return n;
    }
    const root = document.querySelector("#chatroom-messages");
    if (!root) return null;
    if (!chat || chat.root !== root) chat = { root, top: null, tail: [] };
    const rows = [...root.querySelectorAll("[data-index]")]
      .map((row) => ({ index: Number(row.getAttribute("data-index")), key: row.textContent.replace(/\s+/g, " ").trim() }))
      .filter((m) => Number.isFinite(m.index)).sort((a, b) => a.index - b.index);
    if (!rows.length) return 0;
    const top = rows[rows.length - 1].index, keys = rows.map((m) => m.key);
    let n = 0;
    if (chat.top === null) n = 0;                                     // the first look: all of it was said before
    else if (top > chat.top) n = rows.filter((m) => m.index > chat.top).length;   // the list is still filling
    else if (top === chat.top) {                                      // full (or nothing new): go by what was said
      let from = -1;
      for (let k = Math.min(3, chat.tail.length); k >= 1 && from < 0; k--) {
        const want = chat.tail.slice(-k);
        for (let i = keys.length - k; i >= 0; i--) if (want.every((w, j) => keys[i + j] === w)) { from = i + k; break; }
      }
      n = from < 0 ? (top >= 250 ? rows.length : 0) : rows.length - from;
    }                                                                 // a lower number: the list was built again
    chat.top = top;
    chat.tail = keys.slice(-6);
    return n;
  }

  const adPlays = () => !!document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]');

  // The tab is captured (the rewind is on, or it records): the page counts and reports once a second.
  let ticking = null, wantClean = false;
  function capture({ on, recording, clean: tidy }) {
    wantClean = !!(on && recording && tidy);
    clean(wantClean);
    if (on && ticking) return { ok: true };   // already counting: only what is cleaned changed
    clearInterval(ticking);
    ticking = null;
    chat = null;
    if (!on) { placePanel(); return { ok: true }; }   // the bar may lie over the picture again
    newMessages();   // what is there now was said before
    loud();
    ticking = setInterval(() => {
      const n = newMessages();
      if (wantClean) clean(true);   // the player was built again (an ad ended, the quality changed)
      let v = mainVideo();
      if (v && (v.muted || v.volume < 1)) loud();   // the site turned it down again (Kick goes back to half): the recording is as loud as the page plays
      v = mainVideo();
      chrome.runtime.sendMessage({ target: "offscreen", type: "tick", n: n || 0, seen: n !== null, ad: adPlays(), view: view(), muted: !v || v.muted || v.volume === 0, panel: !!panel, over: panelOver() }).catch(() => {
        clearInterval(ticking);   // the extension was reloaded or removed: this page stops counting
        ticking = null;
        clean(false);
      });
    }, 1000);
    placePanel();   // off the picture from the first frame on
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "link:who") reply(who());
    else if (message.type === "link:capture") reply(capture(message));
    else if (message.type === "link:theatre") { theatre(message.on).then(reply, () => reply({ ok: false })); return true; }   // answered a moment later
    else if (message.type === "link:panel") { showPanel(!panel); reply({ ok: true, open: !!panel }); }
  });

  // On this page the toolbar button opens the panel, not the popup.
  chrome.runtime.sendMessage({ type: "link:here" }).catch(() => {});

  // The page was loaded again while its tab is being recorded: it takes up where the old page left off.
  chrome.runtime.sendMessage({ type: "link:state" }).then((s) => {
    if (!s || !s.here || !s.cap || (s.cap.state !== "recording" && s.cap.state !== "armed")) return;
    capture({ on: true, recording: s.cap.state === "recording", clean: s.options && s.options.clean });
  }).catch(() => {});
})();
