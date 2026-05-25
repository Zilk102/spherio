#!/usr/bin/env node
/**
 * Smoke-тест API и клиента. Запуск: node scripts/smoke-test.mjs [baseUrl]
 * baseUrl по умолчанию http://localhost:8080 (nginx) или http://localhost:2567 (server)
 */
const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function post(path, body = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  console.log(`Smoke test → ${base}`);

  const health = await get("/health");
  if (!health.ok) throw new Error("health not ok");
  console.log("✓ /health");

  const auth = await post("/api/auth/guest", { displayName: "SmokeBot" });
  if (!auth.token || !auth.userId) throw new Error("guest auth incomplete");
  console.log("✓ /api/auth/guest");

  const lobby = await post("/api/lobby/create", { maxClients: 8 });
  if (!lobby.code || lobby.roomName !== "private_arena") {
    throw new Error("lobby create invalid");
  }
  console.log(`✓ /api/lobby/create → ${lobby.code}`);

  const info = await get(`/api/lobby/${lobby.code}`);
  if (!info.exists) throw new Error("lobby not found after create");
  console.log("✓ /api/lobby/:code");

  const top = await get("/api/leaderboard?limit=5");
  if (!Array.isArray(top.entries)) throw new Error("leaderboard invalid");
  console.log("✓ /api/leaderboard");

  const index = await fetch(`${base}/`);
  if (!index.ok) throw new Error(`GET / → ${index.status}`);
  console.log("✓ client index");

  console.log("\nВсе проверки пройдены.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
