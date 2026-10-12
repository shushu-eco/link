// The updater's page: ask update.py what there is, show it, and update on the button.
const $ = (id) => document.getElementById(id);
const say = (text, how = "") => { $("say").textContent = text; $("say").className = how; };
let busy = false;

// The updates made so far, newest first; the ones the open Link does not have yet are marked.
function showLog(s) {
  const has = s.kind === "project" && Array.isArray(s.log);
  $("log").hidden = $("log-head").hidden = !has;
  if (!has) return;
  $("log").replaceChildren(...s.log.map((u) => {
    const row = document.createElement("div"), n = document.createElement("b"), text = document.createElement("span"), date = document.createElement("i");
    row.className = "u" + (u.waiting ? " waiting" : "");
    n.textContent = `rwa-${u.version}`;
    text.textContent = u.text;
    date.textContent = u.date;
    row.append(n, text, date);
    return row;
  }));
}

function show(s) {
  showLog(s);
  if (s.kind === "project" && !s.error && !s.behind) {   // the author's own copy: what the open Link runs, and what is on the PC
    $("have-is").textContent = "Open Link";
    $("newest-is").textContent = "On this PC";
    $("have").textContent = !s.running ? "not open" : s.open ? `rwa-${s.open}` : "?";
    $("newest").textContent = `rwa-${s.version}${s.date ? ` · ${s.date}` : ""}`;
    $("newest").className = s.ready ? "new" : "";
    $("go").disabled = !s.ready;
    $("go").textContent = s.ready ? `Update Link to rwa-${s.version}` : "Update";
    if (!s.running) return say("Link is not open. It starts with everything in the list.", "good");
    if (!s.open) return say("This Link was opened before the Updater could tell which version it runs. Close Link and open it once; after that updates go in from here.", "bad");
    if (!s.ready) return say("Link is up to date.", "good");
    return say(`${s.ready} update${s.ready === 1 ? "" : "s"} ready. Update has the open Link close and open again with ${s.ready === 1 ? "it" : "them"}.`);
  }
  $("have-is").textContent = "This Link";
  $("newest-is").textContent = "Newest";
  $("have").textContent = s.version ? `rwa-${s.version}` : "?";
  $("newest").textContent = s.newest ? `rwa-${s.newest}${s.date ? ` · ${s.date}` : ""}` : "?";
  $("newest").className = s.behind ? "new" : "";
  $("go").disabled = true;
  $("go").textContent = "Update";
  if (s.error) return say(s.error, "bad");
  if (!s.behind) return say("Link is up to date.", "good");
  const many = `${s.behind} version${s.behind === 1 ? "" : "s"} behind.`;
  if (s.installer != null) return say(`${many} The newest needs a new installer: download Link-Setup.exe again.`, "bad");
  if (s.dirty) return say(`${many} This copy has changes of its own that are not committed, so it is not updated from here.`, "bad");
  if (s.kind === "installed" && s.running) return say(`${many} Close Link, then press Update.`, "bad");
  $("go").disabled = false;
  $("go").textContent = `Update to rwa-${s.newest}`;
  say(s.kind === "project" ? `${many} Update takes the new commits with git.` : `${many} Update downloads the new version and puts it in place.`);
}

async function look() {
  if (busy) return;
  busy = true;
  say("Looking for a newer version…");
  show(await window.updater.status());
  busy = false;
}

$("go").onclick = async () => {
  if (busy) return;
  busy = true;
  $("go").disabled = true;
  $("go").textContent = "Updating…";
  say("Updating. Link says so in its window, closes and opens again.");
  const done = await window.updater.apply();
  show(await window.updater.status());
  say(done.message || (done.ok ? "Updated." : "Not updated."), done.ok ? "good" : "bad");
  busy = false;
};
$("link").onclick = () => window.updater.link();
$("x").onclick = () => window.updater.close();
window.addEventListener("focus", look);   // Link may have been closed meanwhile, or a release put out
look();
