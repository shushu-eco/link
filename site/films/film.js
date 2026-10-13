// The three Link Night films (site/films/make.js films them, a frame at a time). The window in them is
// Link's own Night page with its own script (tools/reels/night); what it is told here, in place of the
// real night run, is a made-up night of six hours: three streams in stretches of 30 minutes, each stretch
// made into three tapes. window.film.set(seconds) draws the frame for that moment of the film.
//   ?clip=1  choose the hours, press Start night
//   ?clip=2  the night passes
//   ?clip=3  it is done, the PC goes to sleep; the morning
(() => {
  const CLIP = Number(new URLSearchParams(location.search).get("clip")) || 1;
  const $ = (id) => document.getElementById(id);
  const HOURS = 6, STRETCH = 40, REC = 30, MINUTES = HOURS * 60, STRETCHES = MINUTES / STRETCH;
  const START = new Date(2026, 9, 12, 23, 0, 0).getTime(), END = START + MINUTES * 60000;
  const NAMES = ["yourchannel", "secondchannel", "thirdchannel"];
  let wall = START;
  Date.now = () => wall;   // the window reads the time for "until 05:00"

  // ---- what the window is told
  const options = { hours: 5, streams: 3, discord: true, relayChat: false, autoContinue: false, shootersOnly: false, sleepAfter: false };
  const room = (h) => ({ gb: (1.62 * h).toFixed(1), streamHours: (2.32 * h).toFixed(1), measured: true, freeGb: 95.6, fits: true });
  const moments = (tapes) => { let n = 0; for (let i = 0; i < tapes; i++) n += 30 - ((i * 7) % 5); return n; };   // 26 to 30 a tape
  const plan = (state) => ({ hours: HOURS, end: END, options: { streams: 3 }, state });
  const base = () => ({ power: { seconds: 1800, onBattery: false }, room: room(options.hours), options: { ...options }, plan: null, run: null, progress: 0,
    running: false, starting: false, stopping: false, interrupted: false, sleepIn: 0, sleeping: false });
  function running(m) {   // m: minutes into the night
    m = Math.max(0, Math.min(MINUTES - 0.01, m));
    const segment = Math.floor(m / STRETCH) + 1, within = m % STRETCH, recording = within < REC;
    const made = recording ? 0 : Math.min(3, 1 + Math.floor((within - REC) / ((STRETCH - REC) / 3)));
    const tapes = (segment - 1) * 3 + Math.max(0, made - 1);
    return { ...base(), plan: plan("running"), running: true, progress: m / MINUTES, phaseNow: recording ? "rec" : "tape", made,
      run: { tapes: Array(tapes).fill(0), hours_collected: tapes * 0.5, candidates: moments(tapes), failed: [], findings: [], report: true, at: "23:00:00", minutes: m, segment,
        phase: recording ? "recording" : "processing", now: recording ? { minute: Math.max(1, Math.ceil(within)), of: REC, recording: NAMES.map((name) => ({ name })) } : { processing: `${made} of 3 tapes` } } };
  }
  const TAPES = STRETCHES * 3;
  const done = (sleepIn) => ({ ...base(), plan: plan("done"), progress: 1, sleepIn, phaseNow: "done",
    run: { tapes: Array(TAPES).fill(0), hours_collected: TAPES * 0.5, candidates: moments(TAPES), failed: [], findings: [], report: true, at: "05:02:10", minutes: MINUTES + 2, segment: STRETCHES, phase: "done", now: {} } });
  let state = base();
  window.night = { state: async () => state, start: async () => ({ ok: true }), carryOn: async () => ({ ok: true }), stop: async () => ({ ok: true }),
    awake: async () => ({ ok: true }), options: async () => ({ ok: true }), report: async () => ({ ok: true }), close() {} };

  // ---- the three films: what happens when (seconds), where the mouse goes, what is said
  const FILMS = {
    1: { length: 14,
      at(t) {
        options.hours = t < 2.7 ? 5 : 6;
        options.sleepAfter = t >= 5.2;
        wall = START;
        if (t < 7.6) return base();
        if (t < 8.9) return { ...base(), plan: plan("running"), starting: true };
        const m = (t - 8.9) * 0.85;
        wall = START + m * 60000;
        return running(m);
      },
      mouse: [[0, [330, 300]], [1.5, [330, 300]], [2.5, "more"], [3.6, "more"], [5.0, "o-sleepAfter"], [6.0, "o-sleepAfter"], [7.4, "go"], [9.2, "go"], [10.6, [620, 292]]],
      clicks: [2.7, 5.2, 7.6],
      says: [[0, 4.4, "Going to bed? Give it the hours"], [4.4, 6.8, "It can put the PC to sleep after"], [6.8, 14, "★ Press Start night, and go"]] },
    2: { length: 14,
      at(t) {
        options.hours = 6; options.sleepAfter = true;
        const m = Math.max(0.5, Math.min(MINUTES - 0.5, (t - 0.8) / 11.6 * MINUTES));
        wall = START + m * 60000;
        return running(m);
      },
      mouse: [[0, [620, 292]]], clicks: [],
      says: [[0, 4.6, "While you sleep: 3 streams at a time"], [4.6, 9.4, "Checked, and made into tapes"], [9.4, 14, `★ Six hours: ${TAPES} tapes, ${moments(TAPES)} moments`]] },
    3: { length: 13,
      at(t) {
        options.hours = 6; options.sleepAfter = true;
        if (t < 1.4) { wall = END - 30000; return running(MINUTES); }
        if (t < 6.4) { wall = END + 130000 + (t - 1.4) * 1000; return done(Math.max(1, 90 - Math.floor(t - 1.4))); }
        wall = new Date(2026, 9, 13, 8, 30, 0).getTime() + (t - 6.4) * 1000;
        return done(0);
      },
      dark: (t) => (t < 4.6 ? 0 : t < 5.4 ? (t - 4.6) / 0.8 : t < 6.6 ? 1 : t < 7.4 ? 1 - (t - 6.6) / 0.8 : 0),
      mouse: [[0, [620, 292]], [8.6, [620, 292]], [10.2, "second"], [13, "second"]], clicks: [],
      says: [[0, 1.4, "The last tapes are made"], [1.4, 5.2, "Done. The PC goes to sleep by itself"], [7.2, 13, "★ Morning: your tapes, moments found"]] },
  };
  const film = FILMS[CLIP];

  // ---- drawing a frame
  const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c) => `rgb(${c.join(",")})`;
  function point(target) {
    if (Array.isArray(target)) return target;
    const stage = $("stage").getBoundingClientRect(), r = $(target).getBoundingClientRect();
    return [r.left - stage.left + r.width * 0.55, r.top - stage.top + r.height * 0.6];
  }
  function mouseAt(t) {
    const keys = film.mouse;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const k = b[0] > a[0] ? ease((t - a[0]) / (b[0] - a[0])) : 1, p = point(a[1]), q = point(b[1]);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  }
  const two = (n) => String(n).padStart(2, "0");
  async function set(t) {
    state = film.at(t);
    await window.look();   // the window's own script draws itself from what it is told
    // The window's own first line says how Night comes by its streams; these films say what the site says.
    if ($("say").textContent.startsWith("Records live game streams")) $("say").textContent = "Records your streams, three at a time, and makes them tapes while you are away. Nothing is marked or cut: the tapes wait for you in Sources.";
    // the clock and the sky: night until four, then it grows light
    const d = new Date(wall), hour = d.getHours() + d.getMinutes() / 60, light = hour >= 12 ? 0 : hour < 4 ? 0 : hour < 5 ? (hour - 4) * 0.45 : Math.min(1, 0.45 + (hour - 5) * 0.16);
    $("clock").textContent = `${two(d.getHours())}:${two(d.getMinutes())}`;
    $("when").textContent = state.running ? `Hour ${Math.min(HOURS, Math.floor(state.progress * HOURS) + 1)} of ${HOURS}` : state.starting ? "Starting" : state.phaseNow === "done" ? (state.sleepIn ? "The night is done" : "Good morning") : "Before the night";
    const st = $("stage").style;
    st.setProperty("--sky-a", rgb(mix([11, 16, 38], [58, 72, 128], light)));
    st.setProperty("--sky-b", rgb(mix([19, 26, 58], [150, 104, 122], light)));
    st.setProperty("--stars", String(1 - light));
    st.setProperty("--dawn", String(0.5 * light));
    // the three channels
    document.querySelectorAll(".tile").forEach((tile, i) => {
      const how = state.phaseNow === "rec" ? "rec" : state.phaseNow === "tape" ? (i < state.made ? "tape" : "wait") : state.phaseNow === "done" ? "tape" : "";
      tile.className = "tile " + how;
      tile.querySelector("em").textContent = how === "rec" ? "● REC" : how === "tape" ? "✓ TAPE" : how === "wait" ? "CHECKING" : "READY";
    });
    // words, mouse, a ring where it presses, and the dark of a sleeping PC
    const line = film.says.find(([from, to]) => t >= from && t < to);
    $("cap").textContent = line ? line[2] : "";
    const [x, y] = mouseAt(t);
    $("cur").style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    const press = film.clicks.find((c) => t >= c && t < c + 0.4), k = press == null ? 1 : (t - press) / 0.4;
    Object.assign($("ring").style, { transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${0.5 + k})`, opacity: press == null ? "0" : String(1 - k) });
    for (const id of ["more", "go"]) $(id).classList.toggle("pressed", film.clicks.some((c) => t >= c && t < c + 0.2) && Math.hypot(point(id)[0] - x, point(id)[1] - y) < 4);
    const dark = film.dark ? Math.max(0, Math.min(1, film.dark(t))) : 0;
    $("dark").style.opacity = String(dark);
    $("dark").textContent = dark > 0.9 ? "z z z" : "";
    $("cur").style.opacity = dark > 0.5 ? "0" : "1";
    return true;
  }
  window.film = { length: film.length, set };
})();
