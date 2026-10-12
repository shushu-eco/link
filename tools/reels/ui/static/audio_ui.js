"use strict";
// Link's mixer, drawn the same in two places: the Audio button's own window (audio.html) and
// Settings > Audio in the dashboard. One row per open stream, one for the URL video, one for the
// microphone and one for the music player. A row has a level meter, a volume in decibels (how loud
// it is in the recording), a button for whether you hear it (or, for the microphone, whether it is
// on), and a gear that opens its settings. What the rows do is in "the sound" of shell/main.js.
//
//   const mixer = LinkMixer.mount(element, send, { wide })
//   mixer.update(state)     the state main.js gives (audioState)
//   mixer.levels(levels)    { channel id: { peak, rms, mic } } about 12 times a second, in decibels
//   mixer.destroy()         when the element leaves the page: closes the microphone's meter
// `send` holds the calls back to main.js: set, mic, channel, loud, hush, music, and (optional) settings.
(function () {
  const QUIET = -60, LOUDEST = 12;
  const ICON = {
    ear: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    earOff: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    mic: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    micOff: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" opacity=".45"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8.6" stroke-width="2.6" stroke-dasharray="3.4 3.354" stroke-dashoffset="1.7"/><circle cx="12" cy="12" r="6.2" stroke-width="2"/><circle cx="12" cy="12" r="2.3" stroke-width="2"/></svg>`,
    note: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 18.5a2.5 2.5 0 1 1-2-2.45V5.5l11-2.5v12.5a2.5 2.5 0 1 1-2-2.45V7.1L9 8.7z"/></svg>`,
  };

  function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k.startsWith("data-")) node.setAttribute(k, v);
      else node[k] = v;
    }
    node.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return node;
  }
  const dbText = (v) => (v <= QUIET ? "−∞ dB" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`);
  const meterAt = (db) => `${(Math.max(0, Math.min(1, (db - QUIET) / -QUIET)) * 100).toFixed(1)}%`;   // −60 dB at the left, 0 dB at the right
  const toDb = (a) => (a > 0 ? Math.max(-100, 20 * Math.log10(a)) : -100);
  const check = (label, on, change, title, fixed) => h("label", { class: "mx-check" + (fixed ? " mx-fixed" : ""), title },
    h("input", { type: "checkbox", checked: !!on, disabled: !!fixed, onchange: (e) => change(e.target.checked) }), label);

  function mount(root, send, opts = {}) {
    const rows = new Map();
    let state = null, alive = true, devices = [], micTap = null, micNote = "";
    const list = h("div", { class: "mx-rows" });
    const globals = opts.wide ? h("div", { class: "mx-globals" }) : null;
    const empty = h("p", { class: "mx-empty" }, "No stream is open. Open one in the Studio, or a video in URL, and its row appears here.");
    root.classList.add("mx", opts.wide ? "mx-wide" : "mx-narrow");
    root.replaceChildren(...[globals, list, empty].filter(Boolean));

    // ---- a row

    function makeRow(key, kind) {
      const r = { key, kind, id: null, value: 0, open: false, dragging: false, hold: -100, holdAt: 0, sent: 0, timer: null, sig: "" };
      r.name = h("span", { class: "mx-name" });
      r.tag = h("span", { class: "mx-tag" });
      r.db = h("span", { class: "mx-db" });
      r.level = h("i", { class: "mx-level" });
      r.peak = h("i", { class: "mx-hold" });
      r.meter = h("div", { class: "mx-meter", title: "The level going into the recording. Green is fine; red is close to too loud." }, r.level, r.peak);
      r.fader = h("input", { type: "range", class: "mx-fader", min: QUIET, max: LOUDEST, step: 0.5, value: 0,
        title: "How loud it is in the recording. Double-click for 0 dB, the sound as it comes." });
      r.ear = h("button", { class: "mx-btn mx-ear", type: "button" });
      r.gear = h("button", { class: "mx-btn mx-gear", type: "button", title: "Its settings", html: ICON.gear });
      r.more = h("div", { class: "mx-more" });
      r.el = h("div", { class: `mx-row mx-${kind}`, "data-key": key },
        h("div", { class: "mx-top" }, r.name, r.tag, r.db), r.meter,
        h("div", { class: "mx-ctl" }, r.fader, r.ear, r.gear), r.more);
      r.fader.addEventListener("pointerdown", () => { r.dragging = true; });
      r.fader.addEventListener("input", () => slide(r, Number(r.fader.value)));
      r.fader.addEventListener("change", () => { slide(r, Number(r.fader.value), true); r.dragging = false; });
      r.fader.addEventListener("dblclick", () => { r.fader.value = 0; slide(r, 0, true); });
      r.gear.onclick = () => { r.open = !r.open; r.sig = ""; if (r.open && kind === "mic") listDevices(); update(state); };
      return r;
    }

    // A volume being dragged: the number follows at once, main.js hears at most 20 times a second.
    function slide(r, value, last = false) {
      r.value = value;
      paintVolume(r);
      const commit = () => {
        r.sent = performance.now();
        if (r.kind === "mic") send.mic({ gain: r.value });
        else send.channel(r.id, { gain: r.value });
      };
      clearTimeout(r.timer);
      if (last || performance.now() - r.sent > 50) commit();
      else r.timer = setTimeout(commit, 50);
    }
    function paintVolume(r) {
      r.db.textContent = dbText(r.value);
      r.db.classList.toggle("mx-boost", r.value > 0);
      r.db.classList.toggle("mx-off", r.value <= QUIET);
      r.fader.style.setProperty("--p", `${((r.value - QUIET) / (LOUDEST - QUIET) * 100).toFixed(1)}%`);
    }

    // The meter: the bar is the loudest level now; the tick stays at the loudest of the last second and a half.
    function paintLevel(r, peak) {
      const now = performance.now();
      if (peak == null) {
        r.el.classList.add("mx-idle");
        r.level.style.setProperty("--v", "0%");
        r.peak.style.opacity = 0;
        r.hold = -100;
        return;
      }
      r.el.classList.remove("mx-idle");
      if (peak >= r.hold || now - r.holdAt > 1500) { r.hold = peak; r.holdAt = now; }
      r.level.style.setProperty("--v", meterAt(peak));
      r.peak.style.left = meterAt(r.hold);
      r.peak.style.opacity = r.hold > QUIET ? 1 : 0;
      r.peak.classList.toggle("mx-clip", r.hold >= -0.2);
    }

    // ---- what each kind of row shows

    function fillChannel(r, c) {
      r.id = c.id;
      r.name.textContent = `${c.label} · ${c.name}`;
      r.name.title = c.name;
      r.tag.textContent = c.recording ? "● REC" : c.current ? "ON SCREEN" : "";
      r.tag.className = "mx-tag" + (c.recording ? " mx-rec" : "");
      if (!r.dragging) { r.value = c.gain; r.fader.value = c.gain; paintVolume(r); }
      r.ear.innerHTML = c.heard ? ICON.ear : ICON.earOff;
      r.ear.classList.toggle("on", c.heard);
      r.ear.title = state.hushed ? "Sound is off for you. Click to hear again; recordings keep their sound either way."
        : c.heard ? "You hear it. Click to stop hearing it; its recording keeps its sound."
        : state.solo ? "Only the stream on the big screen is heard. Click to hear this one too." : "You do not hear it. Click to hear it; its recording has its sound either way.";
      r.ear.onclick = () => (state.hushed ? send.hush(false) : send.channel(c.id, { listen: !c.heard }));
      const raw = c.engine && c.engine.raw;
      const quiet = c.pageVolume != null && c.pageVolume < 0.995;
      const boosted = c.gain > 0;   // above 0 dB the limiter is on by itself
      const sig = JSON.stringify([r.open, c.limiter, c.mono, quiet && Math.round(c.pageVolume * 100), raw, c.kick, c.gain !== 0, boosted]);
      if (sig === r.sig) return;
      r.sig = sig;
      r.more.hidden = !r.open;
      r.more.replaceChildren(...(!r.open ? [] : [
        check(boosted ? "Limiter (on above 0 dB)" : "Limiter", c.limiter || boosted, (on) => send.channel(c.id, { limiter: on }),
          "Holds back the loudest moments so they do not distort. It is always on while the volume is above 0 dB, and while the microphone is mixed in.", boosted),
        check("Mono", c.mono, (on) => send.channel(c.id, { mono: on }), "Folds left and right into one, for a stream whose sound sits on one side."),
        h("button", { class: "mx-small", type: "button", disabled: c.gain === 0, onclick: () => send.channel(c.id, { gain: 0 }) }, "Reset to 0 dB"),
        quiet && h("div", { class: "mx-note mx-warn" }, `The page itself plays at ${Math.round(c.pageVolume * 100)}%, and the recording starts from that. `,
          h("button", { class: "mx-small", type: "button", onclick: () => send.loud(c.id) }, "Set the page to 100%")),
        raw && h("div", { class: "mx-note mx-warn" }, "The mixer could not start for this recording: its sound is recorded as it comes, and this volume does not apply."),
        c.kick && h("div", { class: "mx-note" }, `Remembered for ${c.kick}: the next time it opens, it starts with these.`),
      ].filter(Boolean)));
    }

    function fillMic(r) {
      const m = state.mic;
      const used = state.channels.filter((c) => c.engine && c.engine.mic === "on").map((c) => c.label);
      const trouble = state.channels.map((c) => c.engine && c.engine.mic).find((t) => t && t !== "on") || micNote;
      r.name.textContent = "Mic/Aux";
      r.tag.textContent = !m.on ? "OFF" : used.length ? `● IN ${used.join(", ")}` : "ON";
      r.tag.className = "mx-tag" + (used.length ? " mx-rec" : "");
      r.el.classList.toggle("mx-muted", !m.on);
      if (!r.dragging) { r.value = m.gain; r.fader.value = m.gain; paintVolume(r); }
      r.ear.innerHTML = m.on ? ICON.mic : ICON.micOff;
      r.ear.classList.toggle("on", m.on);
      r.ear.title = m.on ? "The microphone is on: your voice goes into the recordings chosen in its settings. Click to switch it off."
        : "The microphone is off and closed. Click to switch it on.";
      r.ear.onclick = () => send.mic({ on: !m.on });
      const sig = JSON.stringify([r.open, m, devices, trouble]);
      if (sig === r.sig) return;
      r.sig = sig;
      r.more.hidden = !r.open;
      const known = devices.some((d) => d.id === m.device);
      r.more.replaceChildren(...(!r.open ? [] : [
        h("label", { class: "mx-field" }, h("span", {}, "Microphone"),
          h("select", { onchange: (e) => { const d = devices.find((x) => x.id === e.target.value); send.mic({ device: e.target.value, label: d ? d.label : "" }); } },
            h("option", { value: "", selected: !m.device }, "The default microphone"),
            devices.filter((d) => d.id && d.id !== "default").map((d) => h("option", { value: d.id, selected: d.id === m.device }, d.label || "Microphone")),
            m.device && !known ? h("option", { value: m.device, selected: true }, `${m.label || "The chosen microphone"} (not connected)`) : null)),
        h("label", { class: "mx-field" }, h("span", {}, "Goes into"),
          h("select", { onchange: (e) => send.mic({ into: e.target.value }) },
            h("option", { value: "screen", selected: m.into !== "all" }, "The recording on the big screen"),
            h("option", { value: "all", selected: m.into === "all" }, "Every recording"))),
        check("Noise suppression", m.noise, (on) => send.mic({ noise: on }), "Takes steady noise (a fan, a hum) out of your voice."),
        check("Echo cancellation", m.echo, (on) => send.mic({ echo: on }), "Takes what your speakers play out of the microphone. Leave it off with headphones."),
        check("Automatic level", m.auto, (on) => send.mic({ auto: on }), "Lets the microphone raise and lower itself as you speak."),
        trouble && h("div", { class: "mx-note mx-warn" }, trouble),
        h("div", { class: "mx-note" }, "The microphone is opened only while this meter shows or a recording uses it, and it is never heard in your speakers."),
      ].filter(Boolean)));
    }

    function fillMusic(r) {
      r.name.textContent = "Music";
      r.tag.textContent = "SPOTIFY";
      r.db.textContent = "";
      const sig = JSON.stringify([state.music]);
      if (sig === r.sig) return;
      r.sig = sig;
      r.more.hidden = false;
      r.more.replaceChildren(
        h("div", { class: "mx-note" }, "Plays in the Spotify app itself, so it is never in a recording."),
        h("button", { class: "mx-small", type: "button", onclick: () => send.music() }, h("span", { class: "mx-ico", html: ICON.note }), state.music ? "Player is open" : "Open the player"));
    }

    // ---- the settings above the rows (Settings > Audio only)

    function fillGlobals() {
      if (!globals) return;
      const sig = JSON.stringify([state.solo, state.hushed, state.volume, state.limiter, state.bits, state.remembered]);
      if (sig === globals.dataset.sig) return;
      globals.dataset.sig = sig;
      const starts = [-12, -9, -6, -3, 0, 3, 6, 9, 12];
      globals.replaceChildren(
        h("div", { class: "mx-group" }, h("h3", {}, "What you hear"),
          h("label", { class: "mx-check" }, h("input", { type: "radio", name: "mx-solo", checked: state.solo, onchange: () => send.set({ solo: true }) }), "Only the stream on the big screen"),
          h("label", { class: "mx-check" }, h("input", { type: "radio", name: "mx-solo", checked: !state.solo, onchange: () => send.set({ solo: false }) }), "Each stream by its own speaker button"),
          check("Sound off for me", state.hushed, (on) => send.hush(on), "Silences every stream in your speakers. Recordings keep their sound."),
          h("p", { class: "mx-note" }, "This is only about your speakers. A recording always has its own stream's sound, at the volume set in its row.")),
        h("div", { class: "mx-group" }, h("h3", {}, "What is recorded"),
          h("label", { class: "mx-field" }, h("span", {}, "Sound quality"),
            h("select", { onchange: (e) => send.set({ bits: Number(e.target.value) }) },
              state.bitsChoices.map((b) => h("option", { value: b, selected: b === state.bits }, `${b} kbit/s${b === 160 ? " (standard)" : ""}`)))),
          h("label", { class: "mx-field" }, h("span", {}, "A new stream starts at"),
            h("select", { onchange: (e) => send.set({ volume: Number(e.target.value) }) },
              starts.map((v) => h("option", { value: v, selected: v === state.volume }, dbText(v) + (v === 0 ? " (as it comes)" : ""))))),
          check("Limiter on for new streams", state.limiter, (on) => send.set({ limiter: on }), "Holds back the loudest moments so they do not distort."),
          h("p", { class: "mx-note" }, "Quality applies from the next recording. Volumes apply at once, also while recording.")),
        h("div", { class: "mx-group" }, h("h3", {}, "Remembered channels"),
          state.remembered.length ? state.remembered.map((s) => h("div", { class: "mx-kept" }, h("b", {}, s.name), h("span", {}, dbText(s.gain)),
              h("button", { class: "mx-small", type: "button", onclick: () => send.set({ forget: s.name }) }, "Forget")))
            : h("p", { class: "mx-note" }, "None yet. Change a Kick or Twitch stream's volume and Link starts it at that volume next time.")));
    }

    // ---- the microphone's own meter and its list of devices

    async function listDevices() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        devices = all.filter((d) => d.kind === "audioinput").map((d) => ({ id: d.deviceId, label: d.label }));
        if (alive && state) update(state);
      } catch (e) { /* the list stays as it was */ }
    }

    // While the mixer shows and the microphone is on, it is opened here for its level only.
    function micMeter() {
      const m = state && state.mic;
      const want = !!(alive && m && m.on && !document.hidden);
      const key = want ? JSON.stringify([m.device, m.noise, m.echo, m.auto]) : "";
      if ((micTap ? micTap.key : "") === key) return;
      if (micTap) {
        clearInterval(micTap.timer);
        if (micTap.stream) micTap.stream.getTracks().forEach((t) => t.stop());
        if (micTap.ctx) micTap.ctx.close().catch(() => {});
        micTap = null;
      }
      const row = rows.get("mic");
      if (!want) return row && paintLevel(row, null);
      const mine = micTap = { key, stream: null, ctx: null, timer: null };
      navigator.mediaDevices.getUserMedia({ audio: { deviceId: m.device ? { exact: m.device } : undefined,
        noiseSuppression: !!m.noise, echoCancellation: !!m.echo, autoGainControl: !!m.auto } }).then((stream) => {
        if (micTap !== mine) return stream.getTracks().forEach((t) => t.stop());
        mine.stream = stream;
        mine.ctx = new AudioContext();
        const scope = mine.ctx.createAnalyser(), samples = new Float32Array(2048);
        scope.fftSize = 2048;
        mine.ctx.createMediaStreamSource(stream).connect(scope);
        mine.timer = setInterval(() => {
          scope.getFloatTimeDomainData(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
          const at = rows.get("mic");
          if (at && state) paintLevel(at, toDb(peak) + state.mic.gain);   // as loud as it goes into a recording
        }, 80);
        micNote = "";
        listDevices();   // the devices' names are known once one was opened
      }).catch((e) => {
        if (micTap !== mine) return;
        micNote = e.name === "NotFoundError" || e.name === "OverconstrainedError" ? "That microphone is not connected." : `The microphone could not be opened (${e.name}).`;
        if (state) update(state);
      });
    }

    // ---- keeping the rows in step with the state

    function update(next) {
      if (!alive || !next) return;
      state = next;
      const want = [...next.channels.map((c) => ["c" + c.id, "stream", c]), ["mic", "mic", null], ["music", "music", null]];
      const keys = new Set(want.map((w) => w[0]));
      for (const [key, r] of rows) if (!keys.has(key)) { r.el.remove(); rows.delete(key); }
      let before = null;
      for (const [key, kind, c] of want) {
        let r = rows.get(key);
        if (!r) {
          rows.set(key, r = makeRow(key, kind));
          r.open = !!opts.wide && kind !== "music";
        }
        if (r.el.previousSibling !== before || r.el.parentNode !== list) list.insertBefore(r.el, before ? before.nextSibling : list.firstChild);
        before = r.el;
        if (kind === "stream") fillChannel(r, c);
        else if (kind === "mic") fillMic(r);
        else fillMusic(r);
      }
      empty.hidden = next.channels.length > 0;
      fillGlobals();
      micMeter();
    }

    function levels(map) {
      if (!alive || !state) return;
      for (const c of state.channels) {
        const r = rows.get("c" + c.id), lv = map && map[c.id];
        if (r) paintLevel(r, lv ? lv.peak : null);
      }
    }

    const hidden = () => micMeter();
    document.addEventListener("visibilitychange", hidden);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", listDevices);
    listDevices();

    return {
      update, levels,
      destroy() {
        alive = false;
        micMeter();
        document.removeEventListener("visibilitychange", hidden);
        if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener("devicechange", listDevices);
      },
    };
  }

  window.LinkMixer = { mount };
})();
