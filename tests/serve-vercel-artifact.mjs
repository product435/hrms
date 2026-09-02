import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import handler from "../.vercel/output/functions/__server.func/index.mjs";

const port = Number(process.env.PORT || 4178);
const staticRoot = resolve(".vercel/output/static");
const types = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || `127.0.0.1:${port}`}`,
    );
    const candidate = resolve(staticRoot, `.${decodeURIComponent(url.pathname)}`);
    if (candidate.startsWith(`${staticRoot}${sep}`)) {
      try {
        if ((await stat(candidate)).isFile()) {
          response.writeHead(200, {
            "content-type": types[extname(candidate)] || "application/octet-stream",
          });
          response.end(await readFile(candidate));
          return;
        }
      } catch {
        // The SSR handler owns non-static paths.
      }
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const init = {
      method: request.method,
      headers: request.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    };
    const result = await handler.fetch(new Request(url, init), { waitUntil() {} });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Artifact server failed");
  }
}).listen(port, "127.0.0.1", () => console.log(`Vercel artifact listening on ${port}`));
