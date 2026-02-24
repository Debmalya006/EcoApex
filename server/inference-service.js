const http = require("node:http");

const PORT = Number(process.env.ECOAPEX_INFERENCE_PORT || 8790);
const MAX_BODY_SIZE = 1024 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      throw new Error("Payload too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON payload");
  }
}

function predict(payload) {
  const wings = Array.isArray(payload.wingState) ? payload.wingState : [];
  const nudgePolicy = payload.nudgePolicy || {};
  const overThreshold = Number(nudgePolicy.overQuotaKwPerRoom || 4.8);
  const vampireOccupancy = Number(nudgePolicy.vampireOccupancyThreshold || 0.4);
  const vampireBaseline = Number(nudgePolicy.vampireBaselineThresholdKw || 290);

  const start = Date.now();
  const base = wings.reduce((sum, wing) => sum + Number(wing.loadNow || 0), 0) / 10;
  const avgTemp = wings.length ? wings.reduce((sum, wing) => sum + Number(wing.tempC || 0), 0) / wings.length : 28;
  const forecast = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const circadian = 1 + 0.2 * Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2);
    const classSchedule = hour >= 9 && hour <= 16 ? 0.88 : 1.08;
    const weather = 1 + Math.max(0, avgTemp - 28) * 0.015;
    forecast.push(base * circadian * classSchedule * weather);
  }

  const overQuotaWings = wings.filter(wing => Number(wing.loadNow || 0) / Number(wing.rooms || 1) > overThreshold);
  const vampireWings = wings
    .filter(wing => Number(wing.occupancyPct || 0) < vampireOccupancy && Number(wing.baselineLoad || 0) > vampireBaseline)
    .sort((a, b) => Number(b.baselineLoad || 0) - Number(a.baselineLoad || 0))
    .slice(0, 2);

  const latencyMs = Date.now() - start;
  return {
    forecast,
    overQuotaWings: clone(overQuotaWings),
    vampireWings: clone(vampireWings),
    featureWeights: {
      temperature: 0.72,
      classSchedule: 0.48,
      occupancy: 0.61,
      dayOfWeek: 0.29
    },
    inference: {
      modelVersion: "tft-proxy-v0.1",
      provider: "rocm-edge-service",
      reason: "remote inference active",
      latencyMs
    }
  };
}

const server = http.createServer((req, res) => {
  (async () => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    if (pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        service: "EcoApex Inference Service",
        modelVersion: "tft-proxy-v0.1",
        provider: "rocm-edge-service",
        now: new Date().toISOString()
      });
      return;
    }

    if (pathname === "/predict" && req.method === "POST") {
      try {
        const payload = await readJsonBody(req);
        const output = predict(payload);
        sendJson(res, 200, output);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "Route not found" });
  })().catch(error => {
    sendJson(res, 500, { ok: false, error: error.message });
  });
});

server.listen(PORT, () => {
  process.stdout.write(`EcoApex inference service listening on http://localhost:${PORT}\n`);
});
