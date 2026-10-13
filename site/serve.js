// Shows site/out the way GitHub Pages serves it: /turbo answers with turbo.html, an unknown address with
// 404.html. Run: node site/serve.js [port]
const http = require("http"), fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "out"), port = Number(process.argv[2]) || 8791;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain" };

http.createServer((request, response) => {
  const asked = decodeURIComponent(new URL(request.url, "http://x").pathname);
  const tries = [asked, asked + ".html", path.join(asked, "index.html")].map(p => path.join(OUT, path.normalize(p)));
  const file = tries.find(p => p.startsWith(OUT) && fs.existsSync(p) && fs.statSync(p).isFile());
  response.writeHead(file ? 200 : 404, { "Content-Type": (file ? TYPES[path.extname(file)] : TYPES[".html"]) || "application/octet-stream" });
  response.end(fs.readFileSync(file || path.join(OUT, "404.html")));
}).listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
