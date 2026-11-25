const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const files = {
  "/": "demo/index.html",
  "/app.js": "demo/app.js",
  "/core.js": "integrations/eeva/src/core.js",
  "/flow.js": "integrations/eeva/src/flow.js",
  "/assessment.js": "integrations/eeva/src/assessment.json",
};
http
  .createServer((req, res) => {
    const file = files[req.url];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    let text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    if (req.url === "/assessment.js")
      text = "globalThis.ClariScaleAssessment=" + text + ";";
    res.setHeader(
      "Content-Type",
      req.url === "/"
        ? "text/html; charset=utf-8"
        : "text/javascript; charset=utf-8",
    );
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Synthetic-only ClariScale demo: http://127.0.0.1:4173"),
  );
