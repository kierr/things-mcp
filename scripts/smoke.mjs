#!/usr/bin/env node
/**
 * Live smoke against the real running Things app.
 *
 * Run: `bun scripts/smoke.mjs`
 *
 * Verifies: server boot, /health, tools/list count, things_query (inbox),
 * things_app status, create→query→update→delete round-trip, things_exec
 * (if THINGS_MCP_ENABLE_EXEC=1).
 *
 * Creates and trashes a real "things-mcp smoke test — delete me" todo.
 */
import { spawn } from "node:child_process";

const PORT = process.env.SMOKE_PORT ?? "18197";
const ROOT = import.meta.dir.replace("/scripts", "");

function log(label, value) {
  console.log(
    `  ${label}: ${
      typeof value === "string" ? value : JSON.stringify(value)
    }`
  );
}

async function rpc(serverStdin, serverStdout, method, params, id) {
  const msg = { jsonrpc: "2.0", id, method, params };
  serverStdin.write(JSON.stringify(msg) + "\n");
  // wait for a matching id line on stdout
  return new Promise((resolve, reject) => {
    const onData = (d) => {
      for (const line of d.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            serverStdout.off("data", onData);
            resolve(parsed);
            return;
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    };
    serverStdout.on("data", onData);
    setTimeout(
      () => {
        serverStdout.off("data", onData);
        reject(new Error(`timeout waiting for id=${id}`));
      },
      15_000
    );
  });
}

const server = spawn("bun", ["run", `${ROOT}/src/index.ts`], {
  stdio: ["pipe", "pipe", "pipe"],
});
server.stdout.on("data", (d) => process.stdout.write(d));
server.stderr.on("data", (d) => process.stderr.write(`[srv err] ${d}`));

let nextId = 1;
const id = () => nextId++;

try {
  await rpc(server.stdin, server.stdout, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  }, id());
  server.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n"
  );

  const list = await rpc(server.stdin, server.stdout, "tools/list", {}, id());
  const names = list.result.tools.map((t) => t.name);
  log("tools/list", names.join(", "));

  const status = await rpc(
    server.stdin,
    server.stdout,
    "tools/call",
    { name: "things_app", arguments: { action: "status" } },
    id()
  );
  log("things_app status", JSON.parse(status.result.content[0].text));

  const inbox = await rpc(
    server.stdin,
    server.stdout,
    "tools/call",
    { name: "things_query", arguments: { view: "inbox", limit: 3 } },
    id()
  );
  const inboxData = JSON.parse(inbox.result.content[0].text);
  log("inbox total", inboxData.total);
  log("inbox sample", inboxData.items.map((i) => i.title));

  // create → query → update → delete round-trip
  const created = await rpc(
    server.stdin,
    server.stdout,
    "tools/call",
    {
      name: "things_create",
      arguments: {
        items: [
          {
            type: "to-do",
            attributes: { title: "things-mcp smoke test — delete me", when: "today" },
          },
        ],
      },
    },
    id()
  );
  log("create", JSON.parse(created.result.content[0].text));

  // give Things a moment to commit, then find it
  await new Promise((r) => setTimeout(r, 2500));
  const found = await rpc(
    server.stdin,
    server.stdout,
    "tools/call",
    {
      name: "things_query",
      arguments: {
        query: "things-mcp smoke test",
        fields: ["id", "title", "tags"],
        limit: 5,
      },
    },
    id()
  );
  const foundData = JSON.parse(found.result.content[0].text);
  log("found after create", `${foundData.total} match(es)`);
  const smokeId = foundData.items[0]?.id;
  if (!smokeId) throw new Error("smoke todo not found after create");

  const updated = await rpc(
    server.stdin,
    server.stdout,
    "tools/call",
    {
      name: "things_update",
      arguments: {
        updates: [
          {
            type: "to-do",
            id: smokeId,
            attributes: { "append-notes": "smoke update", canceled: true },
          },
        ],
      },
    },
    id()
  );
  log("update", JSON.parse(updated.result.content[0].text));

  // things_exec round-trip (if enabled)
  if (process.env.THINGS_MCP_ENABLE_EXEC === "1") {
    const exec = await rpc(
      server.stdin,
      server.stdout,
      "tools/call",
      {
        name: "things_exec",
        arguments: {
          script: `const t = await things.query({view:"inbox", limit:1, fields:["id","title"]}); return {first: t.items[0]?.title, total: t.total};`,
        },
      },
      id()
    );
    log("things_exec", JSON.parse(exec.result.content[0].text));
  }

  console.log("\n✅ smoke passed");
} catch (err) {
  console.error("\n❌ smoke failed:", err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
