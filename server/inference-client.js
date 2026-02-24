const DEFAULT_INFERENCE_URL = process.env.ECOAPEX_INFERENCE_URL || "http://localhost:8790";
const REQUEST_TIMEOUT_MS = Number(process.env.ECOAPEX_INFERENCE_TIMEOUT_MS || 1500);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
}

function localPredict(payload, reason) {
  const wings = Array.isArray(payload.wingState) ? payload.wingState : [];
  const nudgePolicy = payload.nudgePolicy || {};
  const overThreshold = Number(nudgePolicy.overQuotaKwPerRoom || 4.8);
  const vampireOccupancy = Number(nudgePolicy.vampireOccupancyThreshold || 0.4);
  const vampireBaseline = Number(nudgePolicy.vampireBaselineThresholdKw || 290);

  const base = wings.reduce((sum, wing) => sum + Number(wing.loadNow || 0), 0) / 10;
  const avgTemp = wings.length ? wings.reduce((sum, wing) => sum + Number(wing.tempC || 0), 0) / wings.length : 28;
  const forecast = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const circadian = 1 + 0.2 * Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2);
    const classSchedule = hour >= 9 && hour <= 16 ? 0.88 : 1.08;
    const weather = 1 + Math.max(0, avgTemp - 28) * 0.015;
    forecast.push(base * circadian * classSchedule * weather);
  }

  return {
    forecast,
    overQuotaWings: wings.filter(wing => Number(wing.loadNow || 0) / Number(wing.rooms || 1) > overThreshold),
    vampireWings: wings
      .filter(wing => Number(wing.occupancyPct || 0) < vampireOccupancy && Number(wing.baselineLoad || 0) > vampireBaseline)
      .sort((a, b) => Number(b.baselineLoad || 0) - Number(a.baselineLoad || 0))
      .slice(0, 2),
    featureWeights: {
      temperature: 0.72,
      classSchedule: 0.48,
      occupancy: 0.61,
      dayOfWeek: 0.29
    },
    inference: {
      mode: "local-fallback",
      modelVersion: "heuristic-v1",
      provider: "edge-server",
      reason: reason || "inference service unavailable",
      latencyMs: 0,
      serviceUrl: DEFAULT_INFERENCE_URL
    }
  };
}

function normalizeRemotePrediction(payload, inferenceUrl, latencyMs) {
  const normalized = payload && typeof payload === "object" ? payload : {};
  const inference = normalized.inference && typeof normalized.inference === "object" ? normalized.inference : {};
  return {
    forecast: Array.isArray(normalized.forecast) ? normalized.forecast : [],
    overQuotaWings: Array.isArray(normalized.overQuotaWings) ? normalized.overQuotaWings : [],
    vampireWings: Array.isArray(normalized.vampireWings) ? normalized.vampireWings : [],
    featureWeights: normalized.featureWeights && typeof normalized.featureWeights === "object" ? normalized.featureWeights : {},
    inference: {
      mode: "remote",
      modelVersion: inference.modelVersion || "unknown",
      provider: inference.provider || "inference-service",
      reason: inference.reason || "remote inference",
      latencyMs,
      serviceUrl: inferenceUrl
    }
  };
}

function createInferenceClient(inferenceUrl = DEFAULT_INFERENCE_URL) {
  let status = {
    mode: "local-fallback",
    lastOk: false,
    lastLatencyMs: 0,
    reason: "not-called-yet",
    serviceUrl: inferenceUrl,
    lastUpdatedAt: new Date().toISOString()
  };

  async function predict(payload) {
    const start = Date.now();
    const { controller, timer } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${inferenceUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`Remote inference failed (${response.status})`);
      }
      const json = await response.json();
      const latencyMs = Date.now() - start;
      const normalized = normalizeRemotePrediction(json, inferenceUrl, latencyMs);
      status = {
        mode: "remote",
        lastOk: true,
        lastLatencyMs: latencyMs,
        reason: "remote inference active",
        serviceUrl: inferenceUrl,
        lastUpdatedAt: new Date().toISOString()
      };
      return normalized;
    } catch (error) {
      clearTimeout(timer);
      const fallback = localPredict(payload, error.message);
      status = {
        mode: "local-fallback",
        lastOk: false,
        lastLatencyMs: 0,
        reason: error.message,
        serviceUrl: inferenceUrl,
        lastUpdatedAt: new Date().toISOString()
      };
      return fallback;
    }
  }

  async function health() {
    const { controller, timer } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${inferenceUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        return { ok: false, status: response.status };
      }
      const payload = await response.json();
      return { ok: true, payload };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, error: error.message };
    }
  }

  function getStatus() {
    return clone(status);
  }

  return {
    predict,
    health,
    getStatus
  };
}

module.exports = {
  createInferenceClient
};
