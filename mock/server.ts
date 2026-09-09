/**
 * Static server for the Herd mock.
 *
 * Deliberately dumb: there is no game logic here and no chain. Every player
 * except you is simulated in the browser, so the whole loop can be judged on
 * feel before a single instruction is written.
 *
 * Run:  bun run server.ts
 */

const PORT = Number(process.env.PORT ?? 5173);
const ROOT = new URL("./public/", import.meta.url).pathname;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    // Keep it to the public directory; a mock is still served over a network.
    if (path.includes("..")) return new Response("no", { status: 400 });

    const file = Bun.file(ROOT + path.slice(1));
    if (!(await file.exists())) return new Response("not found", { status: 404 });

    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  },
});

console.log(`Herd mock  ->  http://localhost:${server.port}`);
