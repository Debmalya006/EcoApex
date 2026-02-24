const API_BASE = process.env.ECOAPEX_API || "http://localhost:8787/api";
const INTERVAL_MS = Number(process.env.ECOAPEX_SIM_MS || 5000);
const WINGS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
let AUTH_TOKEN = null;

function randomRecord(wing) {
  return {
    wing,
    occupancyPct: Number((0.35 + Math.random() * 0.55).toFixed(3)),
    loadNowKw: Number((380 + Math.random() * 240).toFixed(2)),
    baselineLoadKw: Number((240 + Math.random() * 110).toFixed(2)),
    tempC: Number((26 + Math.random() * 6).toFixed(2))
  };
}

async function pushBatch() {
  const records = WINGS.map(randomRecord);
  const response = await fetch(`${API_BASE}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {})
    },
    body: JSON.stringify({
      source: "simulator",
      records
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ingest failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  process.stdout.write(`[sim] pushed ${records.length} records, updated=${payload.updated}\n`);
}

async function loginGuest() {
  const response = await fetch(`${API_BASE}/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Guest login failed (${response.status}): ${text}`);
  }
  const payload = await response.json();
  AUTH_TOKEN = payload.token;
  process.stdout.write(`[sim] authenticated as ${payload.user.username}\n`);
}

async function run() {
  process.stdout.write(`[sim] posting to ${API_BASE}/ingest every ${INTERVAL_MS}ms\n`);
  await loginGuest();
  await pushBatch();
  setInterval(() => {
    pushBatch().catch(error => {
      process.stderr.write(`[sim] ${error.message}\n`);
    });
  }, INTERVAL_MS);
}

run().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
