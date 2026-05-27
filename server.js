import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

function loadEnvFile(fileName) {
  const filePath = resolve(fileName);
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const port = Number.parseInt(process.env.PORT || "4173", 10);
const root = resolve("preview");
const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || process.env.GOOGLE_MAP_ID || "";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function resolveRequestPath(url) {
  const parsed = new URL(url, `http://localhost:${port}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const fullPath = resolve(join(root, requested));
  return fullPath.startsWith(root) ? fullPath : join(root, "index.html");
}

const server = createServer((request, response) => {
  const parsedUrl = new URL(request.url || "/", `http://localhost:${port}`);
  if (parsedUrl.pathname === "/config.js" || parsedUrl.pathname === "/preview/config.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end([
      "window.LIVIO_GOOGLE_MAPS_API_KEY = " + JSON.stringify(googleMapsApiKey) + ";",
      "window.LIVIO_GOOGLE_MAP_ID = " + JSON.stringify(googleMapId) + ";",
      "",
    ].join("\n"));
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");
  const finalPath = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(root, "index.html");
  const contentType = contentTypes[extname(finalPath)] || "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  createReadStream(finalPath).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Livio land plotter listening on port ${port}`);
});
