// The Night window's page: show how the night run stands, start it, stop it, carry it on, and keep its options.
const $ = (id) => document.getElementById(id);
const say = (text, how = "") => { $("say").textContent = text; $("say").className = how; };
const ABOUT = "Records live game streams on Kick, three at a time, and makes them tapes while you are away. Nothing is marked or cut: the tapes wait for you in Sources.";
const OPTIONS = ["discord", "relayChat", "autoContinue", "shootersOnly", "sleepAfter"];
const FIXED = ["relayChat", "shootersOnly"];   // a night that runs keeps these as it began with them
let hours = 5, busy = false, told = "", last = null;   // told: what the last press answered, shown until the run says something newer

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// 1800 -> "30 minutes", 3600 -> "1 hour", 5400 -> "1 hour 30 minutes"
function span(seconds) {
  const m = Math.round(seconds / 60), h = Math.floor(m / 60), rest = m % 60;
  const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return m < 1 ? many(seconds, "second") : [h && many(h, "hour"), rest && many(rest, "minute")].filter(Boolean).join(" ");
}

// What Windows is set to do with this PC when it is left alone, and what Night does about it.
function powerLine(power) {
  if (!power) return "";
  const when = power.onBattery ? " on battery" : "";
  return power.seconds > 0 ? `Your computer is set to sleep after ${span(power.seconds)}${when}, so Night keeps it awake while it works.`
    : `Your computer is set never to sleep${when}. Night keeps it awake while it works all the same.`;
}

function show(s) {
  last = s;
  $("power").textContent = powerLine(s.power);
  // how much room the night takes, by the hours it is set to
  const r = s.room, h = (s.running || s.starting || s.interrupted) && s.plan ? s.plan.hours : s.options.hours;
  $("room").className = r && !r.fits ? "bad" : "";
  $("room").replaceChildren(...(r ? [document.createElement("b"), document.createTextNode(` for ${h} hour${h === 1 ? "" : "s"}: ${r.streamHours} h of streams${r.measured ? ", by what your nights measured" : ""}.`
    + (r.freeGb == null ? "" : ` ${r.freeGb} GB are free.`) + (r.fits ? "" : " Too much: a night stops under 25 GB free."))] : []));
  if (r) $("room").firstChild.textContent = `About ${r.gb} GB`;
  const run = s.run, plan = s.plan, live = s.running || s.starting, began = live || s.interrupted;
  hours = s.options.hours;
  $("hours").textContent = began && plan ? plan.hours : hours;
  $("less").disabled = began || hours <= 1;
  $("more").disabled = began || hours >= 12;
  const streams = began && plan && plan.options && plan.options.streams ? plan.options.streams : s.options.streams;
  $("streams").textContent = streams;
  $("fewer").disabled = began || streams <= 1;
  $("extra").disabled = began || streams >= 3;
  $("until").textContent = began && plan ? `until ${clock(plan.end)}` : `until ${clock(Date.now() + hours * 3600000)}`;
  for (const key of OPTIONS) {
    $(`o-${key}`).checked = !!s.options[key];
    $(`o-${key}`).disabled = live && FIXED.includes(key);
    $(`o-${key}`).parentElement.classList.toggle("fixed", live && FIXED.includes(key));
  }
  const pct = plan ? Math.round(s.progress * 100) : 0;
  $("fill").style.width = `${pct}%`;
  $("pct").textContent = `${pct}%`;
  $("bar").className = s.interrupted ? "bar off" : "bar";
  const dozing = s.sleepIn > 0 || s.sleeping;   // the night is done and the PC is about to be put to sleep
  $("go").disabled = busy || s.starting || s.stopping || s.sleeping;
  $("go").textContent = s.starting ? "Starting…" : s.stopping ? "Stopping…" : s.sleeping ? "Going to sleep…" : dozing ? "Stay awake" : s.running ? "Stop" : s.interrupted ? "Continue" : "Start night";
  $("go").classList.toggle("primary", !s.running);
  $("second").textContent = s.interrupted && !live ? "Start over" : "Report";
  $("second").disabled = s.interrupted && !live ? busy : !run || !run.report;
  $("sofar").textContent = run ? `${run.tapes.length} tape${run.tapes.length === 1 ? "" : "s"} · ${Number(run.hours_collected).toFixed(1)} h · ${run.candidates || 0} moments` : "nothing yet";
  $("now").className = s.running ? "on" : s.interrupted ? "off" : "";
  if (dozing) {
    $("now").textContent = s.sleeping ? "Going to sleep" : `Sleep in ${s.sleepIn} s`;
    return say(s.sleeping ? "Link is closed once it has nothing left to do, then the PC goes to sleep." : "The night is done. Link is closed and the PC put to sleep when the count runs out. Stay awake calls that off.");
  }
  if (s.starting) { $("now").textContent = "Opening Link"; return say("Link is opened for the night run (one that is open is closed first, its recordings saved). This takes about half a minute."); }
  if (s.interrupted) {
    $("now").textContent = "Interrupted";
    return say(told || `Interrupted: ${plan.why}. Continue carries on until ${clock(plan.end)}; Start over begins the ${plan.hours} hours again.`, "bad");
  }
  if (!run || !plan) { $("now").textContent = "Not running"; return say(told || ABOUT, told ? "bad" : ""); }
  const bad = run.failed.length ? ` ${run.failed.length} check${run.failed.length === 1 ? "" : "s"} failed; see the report.` : "";
  if (s.running) {
    const n = run.now || {}, names = (n.recording || []).map((r) => r.name).join(", ");
    $("now").textContent = run.phase === "recording" && n.minute ? `Stretch ${run.segment} · ${n.minute} of ${n.of} min`
      : run.phase === "processing" ? `Stretch ${run.segment} · making tapes${n.processing ? ` (${n.processing.replace(" tapes", "")})` : ""}`
      : `${run.segment ? `Stretch ${run.segment} · ` : ""}${run.phase}`;
    if (s.stopping) return say("Stopping. What records now is saved and made into tapes first; that takes a few minutes.");
    return say(`${names ? `Recording ${names}. ` : ""}The sound is off for you; the PC is kept awake. You can close this window.${bad}`, bad ? "bad" : "");
  }
  $("now").textContent = `${plan.state === "stopped" ? "Stopped" : "Finished"} ${run.at.slice(0, 5)}`;
  if (told) return say(told, "bad");
  say((run.findings.length ? run.findings[run.findings.length - 1] : `Done in ${(run.minutes / 60).toFixed(1)} h.`) + bad, bad ? "bad" : "good");
}

async function look() {
  const s = await window.night.state();
  if (s) show(s);
}

// A press that takes a while: the window keeps showing how it stands meanwhile, and says why if it did not work.
async function press(what) {
  if (busy) return;
  busy = true;
  told = "";
  $("go").disabled = true;
  const watch = setInterval(look, 1000);
  const done = await what();
  clearInterval(watch);
  if (done && done.ok === false) told = done.error;
  busy = false;
  look();
}

const setHours = async (n) => { await window.night.options({ hours: n }); look(); };
$("less").onclick = () => setHours(Math.max(1, hours - 1));
$("more").onclick = () => setHours(Math.min(12, hours + 1));
const setStreams = async (by) => { await window.night.options({ streams: Math.min(3, Math.max(1, ((last && last.options.streams) || 3) + by)) }); look(); };
$("fewer").onclick = () => setStreams(-1);
$("extra").onclick = () => setStreams(1);
// Enter starts the night (or carries an interrupted one on), as the gold button does. It never stops one.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat || busy || !last || last.running || last.starting || last.stopping || last.sleeping || last.sleepIn > 0) return;
  e.preventDefault();
  $("go").click();
});
for (const key of OPTIONS) $(`o-${key}`).onchange = async (e) => { await window.night.options({ [key]: e.target.checked }); look(); };
$("go").onclick = () => press(() => (last && last.sleepIn > 0 ? window.night.awake() : last && last.running ? window.night.stop() : last && last.interrupted ? window.night.carryOn() : window.night.start(hours)));
$("second").onclick = () => (last && last.interrupted && !last.running ? press(() => window.night.start(last.plan.hours)) : press(() => window.night.report()));
$("x").onclick = () => window.night.close();
setInterval(look, 3000);
look();

// The window opens to the sound of a tape going into a VCR: the clunk, a second of rewinding, the stop
// (open.mp3, under two seconds). Quiet on purpose: it is to be noticed, not to startle. Not for the
// picture of the window that is taken for Discord, which loads this page too.
const OPENING_VOLUME = 0.3;
if (!new URLSearchParams(location.search).has("camera")) {
  const sound = new Audio("open.mp3");
  sound.volume = OPENING_VOLUME;
  sound.play().catch(() => { /* no sound device, or sound not allowed: the window opens without it */ });
}
