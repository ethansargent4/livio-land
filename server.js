import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

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
const localDataDir = resolve(".data");
const localLayoutsFile = join(localDataDir, "layouts.json");
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;
let storeReadyPromise;

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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        rejectBody(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(new Error("Invalid JSON body."));
      }
    });
    request.on("error", rejectBody);
  });
}

function sanitizeLayout(layout) {
  const payload = layout && typeof layout === "object" ? layout : {};
  return {
    id: typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : randomUUID(),
    name: typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : `Livio build ${new Date().toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}`,
    payload,
  };
}

async function ensureLayoutStore() {
  if (!storeReadyPromise) {
    storeReadyPromise = (async () => {
      if (pool) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS land_layouts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        return;
      }

      mkdirSync(localDataDir, { recursive: true });
      if (!existsSync(localLayoutsFile)) writeFileSync(localLayoutsFile, "[]\n");
    })();
  }
  return storeReadyPromise;
}

function readLocalLayouts() {
  try {
    return JSON.parse(readFileSync(localLayoutsFile, "utf8"));
  } catch {
    return [];
  }
}

function writeLocalLayouts(layouts) {
  mkdirSync(localDataDir, { recursive: true });
  writeFileSync(localLayoutsFile, JSON.stringify(layouts, null, 2) + "\n");
}

async function listLayouts() {
  await ensureLayoutStore();
  if (pool) {
    const result = await pool.query(
      "SELECT id, name, payload, created_at, updated_at FROM land_layouts ORDER BY updated_at DESC LIMIT 25"
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: row.payload,
    }));
  }

  return readLocalLayouts()
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, 25);
}

async function saveLayout(layout) {
  await ensureLayoutStore();
  const { id, name, payload } = sanitizeLayout(layout);
  const now = new Date().toISOString();
  const stored = { id, name, payload: { ...payload, id, name }, createdAt: payload.createdAt || now, updatedAt: now };

  if (pool) {
    const result = await pool.query(
      `INSERT INTO land_layouts (id, name, payload, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id)
       DO UPDATE SET name = EXCLUDED.name, payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING id, name, payload, created_at, updated_at`,
      [id, name, stored.payload]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: row.payload,
    };
  }

  const layouts = readLocalLayouts().filter((item) => item.id !== id);
  layouts.unshift(stored);
  writeLocalLayouts(layouts.slice(0, 50));
  return stored;
}

async function handleApi(request, response, parsedUrl) {
  if (parsedUrl.pathname !== "/api/layouts") return false;

  if (request.method === "GET") {
    sendJson(response, 200, { layouts: await listLayouts(), store: pool ? "postgres" : "local" });
    return true;
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    const saved = await saveLayout(body);
    sendJson(response, 200, { layout: saved, store: pool ? "postgres" : "local" });
    return true;
  }

  response.writeHead(405, { Allow: "GET, POST" });
  response.end();
  return true;
}

async function handleRequest(request, response) {
  const parsedUrl = new URL(request.url || "/", `http://localhost:${port}`);
  if (await handleApi(request, response, parsedUrl)) return;

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
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message || "Internal server error" });
    else response.end();
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Livio land plotter listening on port ${port}`);
});
