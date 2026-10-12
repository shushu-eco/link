// Builds linkturbo.app into site/out as plain static pages. Run: node site/build.js
// The pages' look is in site/pages (templates taken from the design), their words are in site/content.js,
// and the three legal pages are made from legal/*.md with the "Draft" line and the author's notes left out.
// A template uses {{ value }}, <sc-for list="{{ items }}" as="x">…</sc-for>, <dc-import name="SiteHeader">
// and style-hover="…"; this file turns all of them into ordinary HTML and CSS. No script runs on the site
// except the few lines that make the home page's timer tick. (On the home page Link TURBO and Link Lite take
// turns in one block, each with its services and what it is, by CSS alone: .duo below. For whoever asked
// for less movement both stand there, one under the other.)
const fs = require("fs"), path = require("path");
const HERE = __dirname, ROOT = path.dirname(HERE), OUT = path.join(HERE, "out");
const { header, pages, documents } = require("./content.js");

const ADDRESS = { "Home.dc.html": "/", "Turbo.dc.html": "/turbo", "How It Works.dc.html": "/how-it-works", "Support.dc.html": "/support",
  "Open Source.dc.html": "/open-source", "Changelog.dc.html": "/changelog", "Privacy.dc.html": "/privacy", "Terms.dc.html": "/terms", "Copyright.dc.html": "/copyright" };
const PARTS = { SiteHeader: ["header", header], SiteFooter: ["footer", () => ({})] };

const BASE = `
@font-face{font-family:"VT323";font-display:swap;src:url("/fonts/vt323-latin.woff2") format("woff2")}
@font-face{font-family:"Nunito Sans";font-weight:400 800;font-display:swap;src:url("/fonts/nunito-sans-latin.woff2") format("woff2")}
*{box-sizing:border-box}
html{background:#090c1e;scroll-behavior:smooth}
body{margin:0;min-height:100vh;background:linear-gradient(180deg,#1c1740 0,#120f2a 50%,#090c1e 100%) fixed;color:#c9c5ea;font-family:'Nunito Sans',sans-serif;overflow-wrap:break-word}
a{color:#9fd8c8}a:hover{color:#7fd6c2}
:focus-visible{outline:2px solid #7fd6c2;outline-offset:2px}
summary::-webkit-details-marker{display:none}
details[open]>summary>span:first-child{color:#7fd6c2}
@keyframes blink{50%{opacity:.15}}
.bump{animation:bump .9s ease-out}
@keyframes bump{0%{color:#3ddc84;transform:translateY(-3px)}60%{color:#3ddc84;transform:none}}
body{isolation:isolate}
.sky{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.sky::before{content:"";position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'%3E%3Crect width='4' height='4' fill='%23b9b4e0'/%3E%3C/svg%3E")}
.sky i{position:absolute;left:0;top:0;width:4px;height:4px}
.sky i:nth-child(1){opacity:.22;animation:twinkle 6s steps(5) infinite;box-shadow:12vw 18vh #7fd6c2,78vw 9vh #ff8a8a,33vw 62vh #b9b4e0,91vw 71vh #f2c744,55vw 35vh #7fd6c2,6vw 84vh #ff8a8a,68vw 90vh #b9b4e0}
.sky i:nth-child(2){opacity:.22;animation:twinkle 9s steps(5) -4s infinite;box-shadow:24vw 44vh #f2c744,86vw 38vh #7fd6c2,47vw 12vh #b9b4e0,15vw 70vh #7fd6c2,72vw 56vh #ff8a8a,40vw 88vh #f2c744,95vw 20vh #b9b4e0}
.sky i:nth-child(n+3){width:3px;height:3px;background:#f6efdc;opacity:0;box-shadow:-6px -12px 0 rgba(246,239,220,.7),-12px -24px 0 rgba(246,239,220,.5),-18px -36px 0 rgba(246,239,220,.3),-24px -48px 0 rgba(246,239,220,.15)}
.sky i:nth-child(3){left:18vw;animation:shoot 19s linear 3s infinite}
.sky i:nth-child(4){left:62vw;animation:shoot 27s linear 12s infinite}
@keyframes twinkle{0%,100%{opacity:.1}50%{opacity:.38}}
@keyframes shoot{0%{transform:translate(0,-8vh);opacity:0}1%{opacity:.3}9%{transform:translate(58vh,108vh);opacity:.3}10%,100%{transform:translate(58vh,108vh);opacity:0}}
.doc h2{margin:26px 0 0;font:700 26px/1.25 'Nunito Sans',sans-serif;color:#f6efdc;scroll-margin-top:16px;padding-bottom:10px;border-bottom:2px solid #22304a}
.doc h3{margin:10px 0 0;font:700 20px/1.3 'Nunito Sans',sans-serif;color:#f6efdc}
.doc p{margin:0;text-wrap:pretty}
.doc ul,.doc ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px}
.doc strong{color:#f6efdc;font-weight:700}
.doc code{font:.9em ui-monospace,Consolas,monospace;color:#f6efdc}
.doc .scroll{overflow-x:auto}
.doc table{border-collapse:collapse;width:100%;min-width:420px;font-size:16px}
.doc th{text-align:left;padding:10px 12px;border:2px solid #22304a;background:#0a0d1f;font-family:VT323,monospace;font-size:17px;letter-spacing:2px;color:#7fd6c2;font-weight:400;text-transform:uppercase}
.doc td{padding:10px 12px;border:2px solid #22304a;vertical-align:top}
.turbo{font-family:VT323,monospace;font-size:1.1em;letter-spacing:2px;color:#ff5d5d}
.duo{display:flex;flex-direction:column;gap:28px}
.duo-face{display:grid;grid-template-columns:minmax(0,1fr) 380px}
.duo-main{position:relative;overflow:hidden;min-width:0;padding:36px 32px;display:flex;flex-direction:column;gap:22px;background:linear-gradient(#13243f,#0f1d34);border:2px solid #3f6f7a;box-shadow:0 0 0 2px #090c1e,inset 0 0 0 2px #090c1e}
.duo-turbo .duo-main{border-color:#c8282e}
.duo-glow{position:absolute;width:600px;height:600px;right:-220px;top:-300px;background:radial-gradient(circle,rgba(127,214,194,.14),transparent 60%);pointer-events:none}
.duo-turbo .duo-glow{background:radial-gradient(circle,rgba(255,93,93,.16),transparent 60%)}
.duo-terms{padding:32px 30px;display:flex;flex-direction:column;justify-content:center;gap:18px;background:linear-gradient(#13243f,#0f1d34);border:2px solid #3f6f7a;border-left:0;box-shadow:0 0 0 2px #090c1e,inset 0 0 0 2px #090c1e}
.duo-turbo .duo-terms{border-color:#c8282e}
.duo-tag{align-items:center;font-family:VT323,monospace;font-size:17px;letter-spacing:2px;text-transform:uppercase;line-height:1;padding:4px 9px;color:#090c1e;background:linear-gradient(#ffe27a,#d9a52a);border:2px solid #090c1e;box-shadow:0 0 0 2px #f2c744}
.duo-tabs{position:relative;display:none;list-style:none;margin:0;padding:0;flex-wrap:wrap;gap:8px}
.duo-tabs li{position:relative;font-family:VT323,monospace;font-size:20px;letter-spacing:3px;background:#0a0d1f;border:2px solid #22304a;padding:8px 14px;color:#6b6a7a}
.duo-tabs li::after{content:"";position:absolute;left:-2px;right:-2px;bottom:-2px;height:2px;background:#ffe27a;transform:scaleX(0);transform-origin:left}
.duo-screen{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}
.duo-slide{background:#0a0d1f;border:2px solid #22304a;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;gap:20px 28px}
.duo-read{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right}
/* The turn: 48 seconds. Link TURBO's face for the first 24, Link Lite's for the rest; within a face each of
   its six services has four seconds. A mouse over the block holds it still. */
@media (prefers-reduced-motion:no-preference){
.duo{display:grid}
.duo-face{grid-area:1/1;animation:duo-face 48s linear infinite both;animation-delay:calc(var(--f)*24s - 48s)}
.duo-tabs{display:flex}
.duo-tabs li{animation:duo-tab 48s steps(1) infinite both;animation-delay:calc(var(--g)*4s - 48s)}
.duo-tabs li::after{animation:duo-bar 48s linear infinite both;animation-delay:calc(var(--g)*4s - 48s)}
.duo-screen{grid-template-columns:minmax(0,1fr)}
.duo-slide{grid-area:1/1;animation:duo-slide 48s linear infinite both;animation-delay:calc(var(--g)*4s - 48s)}
.duo:hover .duo-face,.duo:hover .duo-slide,.duo:hover .duo-tabs li,.duo:hover .duo-tabs li::after{animation-play-state:paused}
.night-bar{animation:night-bar 8s ease-in-out infinite alternate}
}
@keyframes duo-face{0%{opacity:0;visibility:visible}1%,49%{opacity:1;visibility:visible}50%,100%{opacity:0;visibility:hidden}}
@keyframes duo-slide{0%{opacity:0;transform:translateY(8px)}.9%,7.6%{opacity:1;transform:none}8.33%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes duo-tab{0%{color:#f2c744;border-color:#d9a52a}8.33%,100%{color:#6b6a7a;border-color:#22304a}}
@keyframes duo-bar{0%{transform:scaleX(0)}8.33%{transform:scaleX(1)}8.34%,100%{transform:scaleX(0)}}
@keyframes night-bar{from{width:58%}to{width:66%}}
@media (max-width:980px){.duo-face{grid-template-columns:minmax(0,1fr)}.duo-terms{border-left:2px solid #3f6f7a;border-top:0}}
@media (min-width:481px){.note>summary{pointer-events:none}details.note>p{margin-top:0!important}}
@media (max-width:820px){nav[aria-label="Sections"]{position:static!important;max-width:none!important;flex-basis:100%!important}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}html{scroll-behavior:auto}}
`.trim();

const SCRIPTS = {
  // The home page's two pictures of the panel are alive, and in step: the timer ticks; the number watching
  // creeps up a few at a time and every ten to twenty seconds jumps by a few hundred, as it does when
  // something happens on a stream, and most jumps leave a new mark behind (Link marks by itself when chat
  // speeds up). At 30 minutes, a recording's length, it begins again.
  timer: `<script>(function(){var q=function(s){return document.querySelectorAll(s)},ts=q(".timer"),ws=q(".watch"),ms=q(".marks"),s=16,v=10742,m=3,next=7;
if(!ts.length||matchMedia("(prefers-reduced-motion:reduce)").matches)return;
function set(l,t,b){l.forEach(function(e){e.textContent=t;if(b){e.classList.remove("bump");void e.offsetWidth;e.classList.add("bump")}})}
function fmt(n){return String(n).replace(/\\B(?=(\\d{3})+$)/g,",")}
setInterval(function(){s++;if(s>=1800){s=0;m=0;v=10742;set(ms,m)}
set(ts,Math.floor(s/60)+":"+("0"+s%60).slice(-2));
if(--next>0){v+=Math.floor(Math.random()*7)-1;set(ws,fmt(v));return}
next=10+Math.floor(Math.random()*11);var from=v,to=v+140+Math.floor(Math.random()*320),k=0;v=to;
var id=setInterval(function(){k++;set(ws,fmt(Math.round(from+(to-from)*k/8)),k===8);if(k<8)return;clearInterval(id);if(Math.random()<.7){m++;set(ms,m,true)}},60)},1000)})()</script>`,
  // Phones only (site/phone.css): the section list and the notes on /open-source start shut, the bar under the header
  // names the section being read, and choosing a section shuts the list. Without it they are open, as on a desktop.
  phone: `<script>(function(){var h=document.documentElement;h.className+=" js";if(!matchMedia("(max-width:480px)").matches)return;
document.querySelectorAll("details.m-shut").forEach(function(d){d.open=false});
var toc=document.querySelector(".toc details"),now=document.querySelector(".toc-now"),secs=document.querySelectorAll("[data-sec]");
if(toc)toc.querySelector("ol").addEventListener("click",function(){toc.open=false});
if(!now||!secs.length)return;
function upd(){var cur="";for(var i=0;i<secs.length;i++){if(secs[i].getBoundingClientRect().top<=130)cur=secs[i].getAttribute("data-sec");else break}now.textContent=cur}
addEventListener("scroll",upd,{passive:true});upd()})()</script>`,
};

// The background: a faint grid of pixels, a few stars that twinkle and now and then a falling one. All CSS (.sky).
const SKY = `<div class="sky" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const template = name => fs.readFileSync(path.join(HERE, "pages", name + ".html"), "utf8");

function value(expr, scope) {
  const found = expr.trim().split(".").reduce((at, key) => (at == null ? at : at[key]), scope);
  if (found === undefined) throw new Error("nothing called " + expr.trim());
  return found;
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// The end of the <sc-for> that opens at `from`, counting the ones inside it.
function closing(text, from) {
  let depth = 0;
  for (const m of text.slice(from).matchAll(/<sc-for\b|<\/sc-for>/g)) {
    depth += m[0] === "</sc-for>" ? -1 : 1;
    if (depth === 0) return from + m.index;
  }
  throw new Error("sc-for is never closed");
}

function render(text, scope) {
  for (let at = text.indexOf("<sc-for"); at !== -1; at = text.indexOf("<sc-for")) {
    const open = text.slice(at, text.indexOf(">", at) + 1), end = closing(text, at);
    const { list, as } = attrs(open), inner = text.slice(at + open.length, end);
    const made = value(list.replace(/[{}]/g, ""), scope).map(item => render(inner, { ...scope, [as]: item })).join("");
    text = text.slice(0, at) + made + text.slice(end + "</sc-for>".length);
  }
  text = text.replace(/<dc-import\b[^>]*><\/dc-import>/g, tag => {
    const given = attrs(tag), [file, vals] = PARTS[given.name];
    return render(template(file), vals(given));
  });
  return text.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const v = value(expr, scope);
    return v && v.html !== undefined ? v.html : esc(v);
  });
}

// style-hover="…" and style-focus="…" become classes, since a page without script cannot read them.
function hovers(html) {
  const rules = new Map();
  const named = (decl, state) => {
    const key = state + "|" + decl;
    if (!rules.has(key)) rules.set(key, "s" + rules.size);
    return rules.get(key);
  };
  html = html.replace(/<[a-z][^>]*\sstyle-(?:hover|focus)="[^>]*>/g, tag => {
    const classes = [];
    tag = tag.replace(/\sstyle-(hover|focus)="([^"]*)"/g, (_, state, decl) => (classes.push(named(decl, state)), ""));
    return / class="/.test(tag) ? tag.replace(/ class="([^"]*)"/, (_, own) => ` class="${own} ${classes.join(" ")}"`)
      : tag.replace(/^<([a-z0-9]+)/, `<$1 class="${classes.join(" ")}"`);
  });
  const css = [...rules].map(([key, name]) => {
    const [state, decl] = key.split("|");
    const forced = decl.split(";").filter(Boolean).map(d => d.trim() + "!important").join(";");
    return state === "hover" ? `.${name}:hover,.${name}:focus-visible{${forced}}` : `.${name}:focus{${forced}}`;
  }).join("\n");
  return { html, css };
}

function finish(html) {
  html = html.replace(/\s(?:hint-[\w-]+|data-screen-label)="[^"]*"/g, "");
  html = html.replace(/href="([^"]+\.dc\.html)"/g, (_, file) => {
    if (!ADDRESS[file]) throw new Error("no address for " + file);
    return `href="${ADDRESS[file]}"`;
  });
  return html;
}

function page(name, { title, description, body, script, robots }) {
  const { html, css } = hovers(finish(body));
  if (/\{\{|<sc-|<dc-|\.dc\.html|style-hover|style-focus|#store-listing/.test(html)) throw new Error(name + ": something of the template is left in the page");
  const address = "https://linkturbo.app/" + (name === "index" ? "" : name);
  const head = [
    `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(description)}">`,
    robots ? `<meta name="robots" content="${robots}">` : `<link rel="canonical" href="${address}">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:image" content="https://linkturbo.app/link-lite.png">`, `<meta property="og:type" content="website">`,
    `<link rel="icon" href="/icon.png">`, `<link rel="preload" href="/fonts/vt323-latin.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="/site.css">`, `<link rel="stylesheet" href="/phone.css">`, css ? `<style>\n${css}\n</style>` : "",
  ].filter(Boolean).join("\n");
  const whole = `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${SKY}\n${html.trim()}\n${script ? SCRIPTS[script] + "\n" : ""}</body>\n</html>\n`;
  fs.writeFileSync(path.join(OUT, name + ".html"), whole);
  return whole.length;
}

// ---- the legal pages, from Markdown ----

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\b([\w.-]+@linkturbo\.app)\b/g, '<a href="mailto:$1">$1</a>')
    .replace(/\blinkturbo\.app\/(\w+)/g, '<a href="/$1">linkturbo.app/$1</a>')
    .replace(/\((lemonsqueezy\.com|aepd\.es)\)/g, '(<a href="https://$1">$1</a>)').replace(/, (lemonsqueezy\.com)\)/g, ', <a href="https://$1">$1</a>)')
    .replace(/TURBO/g, '<span class="turbo">TURBO</span>');
}

function items(block, mark) {
  const found = [];
  for (const line of block) mark.test(line) ? found.push(line.replace(mark, "")) : (found[found.length - 1] += " " + line.trim());
  return found.map(i => `<li>${inline(i)}</li>`).join("");
}

function document(source) {
  const text = fs.readFileSync(path.join(ROOT, "legal", source), "utf8").replace(/\r/g, "").split("\n---\n")[0];
  const out = [], sections = [];
  let updated = "";
  for (const block of text.split(/\n\s*\n/).map(b => b.split("\n").filter(Boolean)).filter(b => b.length)) {
    const first = block[0], joined = block.map(l => l.trim()).join(" ");
    if (first.startsWith("**Draft") || first.startsWith("# ")) continue;
    if (first.startsWith("Last updated:")) { updated = new Date(first.slice(13).trim() + " UTC").toISOString().slice(0, 10); continue; }
    if (first.startsWith("## ")) {
      const heading = first.slice(3), id = "s" + (sections.length + 1);
      sections.push({ href: "#" + id, n: String(sections.length + 1), t: { html: inline(heading.replace(/^\d+\.\s*/, "")) } });
      out.push(`<h2 id="${id}" data-sec="${esc(sections.length + " " + heading.replace(/^\d+\.\s*/, ""))}">${inline(heading)}</h2>`);
    } else if (/^\*\*[^*]+\*\*$/.test(joined)) out.push(`<h3>${inline(joined.slice(2, -2))}</h3>`);
    else if (first.startsWith("- ")) out.push(`<ul>${items(block, /^- /)}</ul>`);
    else if (/^\d+\. /.test(first)) out.push(`<ol>${items(block, /^\d+\. /)}</ol>`);
    else if (first.startsWith("|")) {
      const rows = block.filter(l => !/^[|\-\s]+$/.test(l)).map(l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
      const head = rows[0].map(c => `<th>${inline(c)}</th>`).join("");
      const rest = rows.slice(1).map(r => "<tr>" + r.map((c, i) => `<td data-th="${esc(rows[0][i])}">${inline(c)}</td>`).join("") + "</tr>").join("");
      out.push(`<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rest}</tbody></table></div>`);
    } else out.push(`<p>${inline(joined)}</p>`);
  }
  if (!updated) throw new Error(source + " has no 'Last updated' line");
  return { updated, sections, body: { html: out.join("\n") } };
}

// ---- build ----

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });
for (const font of ["vt323-latin.woff2", "nunito-sans-latin.woff2"]) fs.copyFileSync(path.join(ROOT, "extension", "fonts", font), path.join(OUT, "fonts", font));
fs.copyFileSync(path.join(ROOT, "extension", "icons", "128.png"), path.join(OUT, "icon.png"));
fs.copyFileSync(path.join(ROOT, "discord", "server-icon-512.png"), path.join(OUT, "logo.png")); // Link's mark, large: for the shop and wherever a logo is asked for
fs.copyFileSync(path.join(ROOT, "store", "screenshots", "1-record.png"), path.join(OUT, "link-lite.png")); // the picture a shared link shows
fs.writeFileSync(path.join(OUT, "site.css"), BASE + "\n");
fs.copyFileSync(path.join(HERE, "phone.css"), path.join(OUT, "phone.css")); // the phone layout: all of it in media queries
fs.writeFileSync(path.join(OUT, "CNAME"), "linkturbo.app"); // GitHub Pages: the address the site answers to
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
fs.cpSync(path.join(HERE, "repo"), OUT, { recursive: true }); // what the public repository shows on its own page: README.md and its pictures

const made = [];
for (const [name, p] of Object.entries(pages)) made.push([name, page(name, { ...p, body: render(template(p.template), p.data) })]);
for (const [name, d] of Object.entries(documents)) {
  const body = render(template("document"), { ...document(d.source), kicker: "Legal · document", title: d.title });
  made.push([name, page(name, { title: d.title + " · Link", description: d.description, body, script: "phone" })]);
}
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  made.filter(([n]) => !pages[n] || !pages[n].robots).map(([n]) => `<url><loc>https://linkturbo.app/${n === "index" ? "" : n}</loc></url>`).join("\n") + "\n</urlset>\n");
fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://linkturbo.app/sitemap.xml\n");
console.log(made.map(([n, size]) => `${n} ${(size / 1024).toFixed(1)}k`).join(" | "));
