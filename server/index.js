const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createInferenceClient } = require("./inference-client");
const { createAuthStore } = require("./auth-store");
const { buildSeed, createLedgerStore } = require("./ledger-store");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "src", "config", "wings.json");
const DATA_DIR = path.join(ROOT_DIR, "server", "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.json");
const PORT = Number(process.env.ECOAPEX_PORT || 8787);
const MAX_BODY_SIZE = 1024 * 1024;

const DEFAULT_CONFIG = {
  campus: {
    roomsTotal: 847,
    quotaKwh: 3400,
    startTodayKwh: 2847,
    startCo2SavedKg: 184,
    tickMs: 4000,
    tickDeltaKwhMin: 12,
    tickDeltaKwhMax: 18
  },
  nudgePolicy: {
    cohortName: "Class of 2026",
    maxActiveNudges: 5,
    overQuotaKwPerRoom: 3.7,
    vampireOccupancyThreshold: 0.62,
    vampireBaselineThresholdKw: 260
  },
  utilities: [
    { label: "Priority Laundry", cost: 40 },
    { label: "Extended AC +1h", cost: 65 },
    { label: "Cafeteria Voucher", cost: 30 }
  ],
  heatmapPattern: [10, 8, 6, 5, 4, 4, 5, 8, 12, 18, 22, 25, 28, 30, 29, 27, 24, 20, 18, 22, 25, 20, 15, 12],
  wings: [
    { name: "Alpha", rooms: 124, initial: { occupancyPct: 0.76, loadNowKw: 470, baselineLoadKw: 278, tempC: 28.1, tokens: 98 } },
    { name: "Beta", rooms: 110, initial: { occupancyPct: 0.69, loadNowKw: 498, baselineLoadKw: 286, tempC: 28.4, tokens: 84 } },
    { name: "Gamma", rooms: 98, initial: { occupancyPct: 0.63, loadNowKw: 525, baselineLoadKw: 292, tempC: 29.0, tokens: 71 } },
    { name: "Delta", rooms: 88, initial: { occupancyPct: 0.58, loadNowKw: 510, baselineLoadKw: 298, tempC: 29.3, tokens: 59 } },
    { name: "Epsilon", rooms: 127, initial: { occupancyPct: 0.61, loadNowKw: 545, baselineLoadKw: 312, tempC: 29.7, tokens: 38 } }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomIn(min, max) {
  return min + Math.random() * (max - min);
}

function dayKeyFromDate(date) {
  const now = date instanceof Date ? date : new Date();
  return now.toISOString().slice(0, 10);
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.wings) || !parsed.wings.length) {
      return clone(DEFAULT_CONFIG);
    }
    const config = clone(parsed);
    config.campus = config.campus || {};
    config.nudgePolicy = config.nudgePolicy || {};
    if (!Array.isArray(config.utilities) || !config.utilities.length) config.utilities = clone(DEFAULT_CONFIG.utilities);
    if (!Array.isArray(config.heatmapPattern) || config.heatmapPattern.length !== 24) {
      config.heatmapPattern = clone(DEFAULT_CONFIG.heatmapPattern);
    }
    return config;
  } catch (error) {
    return clone(DEFAULT_CONFIG);
  }
}

function createEdgeModel(config, inferenceClient, ledgerStore) {
  const campus = config.campus || {};
  const nudgePolicy = config.nudgePolicy || {};
  const utilities = Array.isArray(config.utilities) ? config.utilities : [];
  const quotaKwh = Number(campus.quotaKwh || 3400);
  const roomsTotal = Number(campus.roomsTotal || config.wings.reduce((sum, wing) => sum + Number(wing.rooms || 0), 0));
  const tickDeltaKwhMin = Number(campus.tickDeltaKwhMin || 12);
  const tickDeltaKwhMax = Number(campus.tickDeltaKwhMax || 18);

  const wingState = config.wings.map(wing => ({
    name: wing.name,
    rooms: Number(wing.rooms),
    occupancyPct: Number(wing.initial && wing.initial.occupancyPct) || 0.6,
    loadNow: Number(wing.initial && wing.initial.loadNowKw) || 450,
    baselineLoad: Number(wing.initial && wing.initial.baselineLoadKw) || 280,
    tempC: Number(wing.initial && wing.initial.tempC) || 28,
    tokens: Number(wing.initial && wing.initial.tokens) || 50
  }));

  const state = {
    todayKwh: Number(campus.startTodayKwh || 0),
    co2SavedKg: Number(campus.startCo2SavedKg || 0),
    nudgesSent: 0,
    acceptedTrades: 0,
    lastNudges: [],
    globalNudge: null,
    runtimeDayKey: dayKeyFromDate(new Date())
  };

  ledgerStore.hydrateRuntime(wingState, state);

  let lastInference = {
    mode: "local-fallback",
    modelVersion: "heuristic-v1",
    provider: "edge-server",
    reason: "bootstrapping",
    latencyMs: 0,
    serviceUrl: process.env.ECOAPEX_INFERENCE_URL || "http://localhost:8790"
  };
  const nudgeLocks = new Map();
  let wingCoverageCursor = 0;
  const defaultNudgeCooldownSec = Math.max(1, Number(process.env.ECOAPEX_NUDGE_COOLDOWN_SEC || 30));

  function normalizeRuntimeForDay(nowInput) {
    const now = nowInput instanceof Date ? nowInput : new Date();
    const todayKey = dayKeyFromDate(now);

    if (state.runtimeDayKey !== todayKey) {
      state.runtimeDayKey = todayKey;
      state.todayKwh = Math.max(0, Number(campus.startTodayKwh || 0) * 0.18);
      state.co2SavedKg = Math.max(0, Number(campus.startCo2SavedKg || 0) * 0.12);
      state.nudgesSent = 0;
      state.acceptedTrades = 0;
      wingCoverageCursor = 0;
      nudgeLocks.clear();
    }

    const maxReasonableToday = quotaKwh * 1.35;
    if (!Number.isFinite(state.todayKwh) || state.todayKwh < 0 || state.todayKwh > maxReasonableToday) {
      const hourOfDay = now.getHours() + now.getMinutes() / 60;
      const dayProgress = clamp(hourOfDay / 24, 0.05, 0.98);
      const liveLoadKw = wingState.reduce((sum, wing) => sum + Number(wing.loadNow || 0), 0);
      const baselineLoadKw = wingState.reduce((sum, wing) => sum + Number(wing.baselineLoad || 0), 0);
      const pressure = baselineLoadKw > 0 ? clamp(liveLoadKw / baselineLoadKw, 0.78, 1.24) : 1;
      state.todayKwh = Math.round(quotaKwh * dayProgress * pressure * 0.94);
    }

    if (!Number.isFinite(state.co2SavedKg) || state.co2SavedKg < 0) {
      state.co2SavedKg = Math.max(0, Number(campus.startCo2SavedKg || 0) * 0.12);
    }
  }

  function formatDuration(seconds) {
    const totalSec = Math.max(1, Math.round(Number(seconds || 0)));
    if (totalSec < 60) return `${totalSec} sec`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec > 0 ? `${min} min ${sec} sec` : `${min} min`;
  }

  function pruneNudgeLocks(nowMs = Date.now()) {
    for (const [nudgeId, lock] of nudgeLocks.entries()) {
      if (!lock || Number(lock.until || 0) <= nowMs) {
        nudgeLocks.delete(nudgeId);
      }
    }
  }

  function getNudgeLock(nudgeId, nowMs = Date.now()) {
    pruneNudgeLocks(nowMs);
    if (!nudgeId) return null;
    const lock = nudgeLocks.get(String(nudgeId));
    if (!lock) return null;
    if (Number(lock.until || 0) <= nowMs) {
      nudgeLocks.delete(String(nudgeId));
      return null;
    }
    return lock;
  }

  function isNudgeLocked(nudgeId, nowMs = Date.now()) {
    return Boolean(getNudgeLock(nudgeId, nowMs));
  }

  function lockNudge(nudgeId, cooldownSec, metadata) {
    const nudgeKey = String(nudgeId || "").trim();
    if (!nudgeKey) return;
    const seconds = Math.max(1, Number(cooldownSec || defaultNudgeCooldownSec));
    nudgeLocks.set(nudgeKey, {
      until: Date.now() + seconds * 1000,
      cooldownSec: seconds,
      metadata: metadata && typeof metadata === "object" ? clone(metadata) : {}
    });
  }

  function rankWings() {
    return [...wingState].sort((a, b) => b.tokens - a.tokens);
  }

  function tickWingState() {
    normalizeRuntimeForDay();
    const hour = new Date().getHours();
    const classScheduleFactor = hour >= 9 && hour <= 16 ? 0.88 : 1.05;
    wingState.forEach(wing => {
      wing.occupancyPct = clamp(wing.occupancyPct + randomIn(-0.04, 0.04), 0.2, 0.95);
      wing.tempC = clamp(wing.tempC + randomIn(-0.35, 0.35), 22, 35);
      wing.baselineLoad = Math.max(170, wing.baselineLoad + randomIn(-8, 8));
      const behaviorPenalty = 1 + (1 - wing.occupancyPct) * 0.22;
      wing.loadNow = Math.max(240, wing.baselineLoad * behaviorPenalty * classScheduleFactor + randomIn(10, 55));
    });
    state.todayKwh += randomIn(tickDeltaKwhMin, tickDeltaKwhMax);
  }

  async function snapshot() {
    normalizeRuntimeForDay();
    const prediction = await inferenceClient.predict({
      wingState: clone(wingState),
      campus: clone(campus),
      nudgePolicy: clone(nudgePolicy)
    });

    const forecast = Array.isArray(prediction.forecast) ? prediction.forecast : [];
    const overQuota = Array.isArray(prediction.overQuotaWings) ? prediction.overQuotaWings : [];
    const vampire = Array.isArray(prediction.vampireWings) ? prediction.vampireWings : [];
    const inference = prediction.inference && typeof prediction.inference === "object" ? prediction.inference : {};

    lastInference = {
      mode: inference.mode || "local-fallback",
      modelVersion: inference.modelVersion || "unknown",
      provider: inference.provider || "unknown",
      reason: inference.reason || "unspecified",
      latencyMs: Number(inference.latencyMs || 0),
      serviceUrl: inference.serviceUrl || process.env.ECOAPEX_INFERENCE_URL || "http://localhost:8790"
    };

    const activeRooms = wingState.reduce((sum, wing) => sum + Math.round(wing.rooms * wing.occupancyPct), 0);
    const occupancyPct = (activeRooms / roomsTotal) * 100;
    const projectedTodayKwh = state.todayKwh + forecast.slice(0, 8).reduce((sum, value) => sum + value, 0);
    const budgetUsePct = Math.min(100, (projectedTodayKwh / quotaKwh) * 100);
    const overByKwh = Math.max(0, projectedTodayKwh - quotaKwh);
    const avgTempC = wingState.reduce((sum, wing) => sum + wing.tempC, 0) / wingState.length;
    const remainingKwh = Math.max(0, quotaKwh - projectedTodayKwh);

    return {
      forecast,
      overQuotaWings: overQuota,
      vampireWings: vampire,
      activeRooms,
      occupancyPct,
      projectedTodayKwh,
      budgetUsePct,
      overByKwh,
      avgTempC,
      remainingKwh,
      inference: clone(lastInference),
      featureWeights: prediction.featureWeights && typeof prediction.featureWeights === "object" ? clone(prediction.featureWeights) : {}
    };
  }

  function buildNudges(snap) {
    const cohortName = nudgePolicy.cohortName || "Class of 2026";
    const maxActive = Number(nudgePolicy.maxActiveNudges || 5);
    const overQuotaThreshold = Number(nudgePolicy.overQuotaKwPerRoom || 3.7);
    const vampireOccupancyThreshold = Number(nudgePolicy.vampireOccupancyThreshold || 0.62);
    const vampireBaselineThreshold = Number(nudgePolicy.vampireBaselineThresholdKw || 260);
    const nudges = [];
    pruneNudgeLocks();

    const mergedOverQuotaByWing = new Map();
    const overQuotaFromInference = Array.isArray(snap.overQuotaWings) ? snap.overQuotaWings : [];
    const overQuotaFromLocal = wingState.filter(wing => Number(wing.loadNow || 0) / Math.max(1, Number(wing.rooms || 1)) > overQuotaThreshold);

    [...overQuotaFromInference, ...overQuotaFromLocal].forEach(candidate => {
      const wingName = String(candidate && candidate.name ? candidate.name : "").trim();
      if (!wingName) return;
      const stateWing = findWing(wingName);
      const merged = {
        ...(stateWing || {}),
        ...(candidate || {}),
        name: stateWing && stateWing.name ? stateWing.name : wingName,
        rooms: Number((stateWing && stateWing.rooms) || candidate.rooms || 1),
        loadNow: Number(candidate.loadNow != null ? candidate.loadNow : (stateWing && stateWing.loadNow) || 0),
        baselineLoad: Number(candidate.baselineLoad != null ? candidate.baselineLoad : (stateWing && stateWing.baselineLoad) || 0),
        occupancyPct: Number(candidate.occupancyPct != null ? candidate.occupancyPct : (stateWing && stateWing.occupancyPct) || 0)
      };
      mergedOverQuotaByWing.set(merged.name.toLowerCase(), merged);
    });

    const overQuotaCandidates = [...mergedOverQuotaByWing.values()]
      .filter(wing => Number(wing.loadNow || 0) / Math.max(1, Number(wing.rooms || 1)) > overQuotaThreshold)
      .sort((left, right) => {
        const leftRatio = Number(left.loadNow || 0) / Math.max(1, Number(left.rooms || 1));
        const rightRatio = Number(right.loadNow || 0) / Math.max(1, Number(right.rooms || 1));
        return rightRatio - leftRatio;
      });

    overQuotaCandidates.forEach((wing, index) => {
      const nudgeId = `${String(wing.name).toLowerCase()}-deep-freeze`;
      if (isNudgeLocked(nudgeId)) {
        return;
      }
      const reward = 50 - index * 5;
      const kwhSaved = Math.max(16, reward * 0.45);
      nudges.push({
        id: nudgeId,
        wing: `${wing.name} Wing`,
        tone: "urgent",
        delta: `+${Math.round((Number(wing.loadNow || 0) / Math.max(1, Number(wing.baselineLoad || 1)) - 1) * 100)}%`,
        message: `${cohortName}: ${(100 - Number(wing.occupancyPct || 0) * 100).toFixed(0)}% of your wing is in class right now. Switch common room to Deep Freeze for 60 minutes to earn ${reward} $HAR.`,
        action: "Apply Deep Freeze",
        cooldownSec: 30,
        reward,
        kwhSaved,
        co2Saved: Math.max(3, kwhSaved * 0.42)
      });
    });

    const mergedVampireByWing = new Map();
    const vampireFromInference = Array.isArray(snap.vampireWings) ? snap.vampireWings : [];
    const vampireFromLocal = wingState.filter(wing => {
      const occupancy = Number(wing.occupancyPct || 0);
      const baseline = Number(wing.baselineLoad || 0);
      return occupancy < vampireOccupancyThreshold && baseline > vampireBaselineThreshold;
    });

    [...vampireFromInference, ...vampireFromLocal].forEach(candidate => {
      const wingName = String(candidate && candidate.name ? candidate.name : "").trim();
      if (!wingName) return;
      const stateWing = findWing(wingName);
      const merged = {
        ...(stateWing || {}),
        ...(candidate || {}),
        name: stateWing && stateWing.name ? stateWing.name : wingName,
        rooms: Number((stateWing && stateWing.rooms) || candidate.rooms || 1),
        loadNow: Number(candidate.loadNow != null ? candidate.loadNow : (stateWing && stateWing.loadNow) || 0),
        baselineLoad: Number(candidate.baselineLoad != null ? candidate.baselineLoad : (stateWing && stateWing.baselineLoad) || 0),
        occupancyPct: Number(candidate.occupancyPct != null ? candidate.occupancyPct : (stateWing && stateWing.occupancyPct) || 0)
      };
      mergedVampireByWing.set(merged.name.toLowerCase(), merged);
    });

    const vampireCandidates = [...mergedVampireByWing.values()]
      .filter(wing => Number(wing.occupancyPct || 0) < vampireOccupancyThreshold && Number(wing.baselineLoad || 0) > vampireBaselineThreshold)
      .sort((left, right) => Number(right.baselineLoad || 0) - Number(left.baselineLoad || 0));

    vampireCandidates.forEach((wing, index) => {
      const nudgeId = `${String(wing.name).toLowerCase()}-vampire-cut`;
      if (isNudgeLocked(nudgeId)) {
        return;
      }
      const reward = 30 - index * 3;
      const kwhSaved = Math.max(11, reward * 0.4);
      nudges.push({
        id: nudgeId,
        wing: `${wing.name} Wing`,
        tone: "warn",
        delta: `+${Math.round(Number(wing.baselineLoad || 0) / 10)} kWh`,
        message: "Vampire load signature detected in low-occupancy rooms. Cut standby strips for 45 minutes to reclaim hidden base load.",
        action: "Kill Standby Loads",
        cooldownSec: 30,
        reward,
        kwhSaved,
        co2Saved: Math.max(2, kwhSaved * 0.35)
      });
    });

    if (!nudges.length) {
      const proactiveWings = [...wingState]
        .map(wing => ({
          ...wing,
          loadPerRoom: Number(wing.loadNow || 0) / Math.max(1, Number(wing.rooms || 1))
        }))
        .sort((left, right) => Number(right.loadPerRoom || 0) - Number(left.loadPerRoom || 0))
        .slice(0, maxActive);

      proactiveWings.forEach((wing, index) => {
        const nudgeId = `${String(wing.name).toLowerCase()}-efficiency-pulse`;
        if (isNudgeLocked(nudgeId)) {
          return;
        }
        const reward = Math.max(14, 26 - index * 2);
        const kwhSaved = Math.max(7, reward * 0.32);
        nudges.push({
          id: nudgeId,
          wing: `${wing.name} Wing`,
          tone: "warn",
          delta: `~${wing.loadPerRoom.toFixed(1)} kW/room`,
          message: "Proactive optimization window: trim corridor lighting and idle sockets for 30 minutes to prevent a quota spike.",
          action: "Optimize Common Load",
          cooldownSec: 30,
          reward,
          kwhSaved,
          co2Saved: Math.max(2, kwhSaved * 0.34)
        });
      });
    }

    // Coverage nudges prevent any single wing from being starved when threshold nudges
    // are dominated by hotter wings; selection rotates across wings.
    if (wingState.length) {
      const wingKeysInNudges = new Set(
        nudges
          .map(item => String((item && item.wing) || "").trim().toLowerCase().replace(/\s+wing$/i, ""))
          .filter(Boolean)
      );
      const totalWings = wingState.length;
      const startCursor = ((wingCoverageCursor % totalWings) + totalWings) % totalWings;
      let selectedWing = null;
      let selectedIndex = -1;

      for (let offset = 0; offset < totalWings; offset += 1) {
        const idx = (startCursor + offset) % totalWings;
        const candidate = wingState[idx];
        const wingKey = String(candidate && candidate.name || "").trim().toLowerCase();
        if (!wingKey || wingKeysInNudges.has(wingKey)) continue;
        const coverageNudgeId = `${wingKey}-coverage-pulse`;
        if (isNudgeLocked(coverageNudgeId)) continue;
        selectedWing = candidate;
        selectedIndex = idx;
        break;
      }

      if (selectedWing && selectedIndex >= 0) {
        wingCoverageCursor = (selectedIndex + 1) % totalWings;

        const wingKey = String(selectedWing.name || "").trim().toLowerCase();
        const loadPerRoom = Number(selectedWing.loadNow || 0) / Math.max(1, Number(selectedWing.rooms || 1));
        const baselinePerRoom = Number(selectedWing.baselineLoad || 0) / Math.max(1, Number(selectedWing.rooms || 1));
        const driftPct = baselinePerRoom > 0
          ? ((loadPerRoom / baselinePerRoom) - 1) * 100
          : 0;
        const reward = Math.max(14, Math.min(24, 16 + Math.round(Math.abs(driftPct) * 0.2)));
        const kwhSaved = Math.max(5, reward * 0.3);
        const coverageNudge = {
          id: `${wingKey}-coverage-pulse`,
          wing: `${selectedWing.name} Wing`,
          tone: Math.abs(driftPct) >= 8 ? "warn" : "ok",
          delta: `${driftPct >= 0 ? "+" : ""}${Math.round(driftPct)}%`,
          message: `${selectedWing.name} Wing optimization window: run a 15-minute common-area audit to keep demand stable before the next peak.`,
          action: "Run Wing Audit",
          cooldownSec: 30,
          reward,
          kwhSaved,
          co2Saved: Math.max(1.6, kwhSaved * 0.34)
        };

        if (nudges.length < maxActive) {
          nudges.push(coverageNudge);
        } else {
          const toneRank = tone => {
            const normalized = String(tone || "").toLowerCase();
            if (normalized === "urgent") return 3;
            if (normalized === "warn") return 2;
            return 1;
          };
          let replaceIndex = -1;
          let replaceRank = Number.POSITIVE_INFINITY;
          nudges.forEach((item, idx) => {
            const rank = toneRank(item && item.tone);
            if (rank < replaceRank) {
              replaceRank = rank;
              replaceIndex = idx;
            }
          });
          if (replaceIndex >= 0 && replaceRank < 3) {
            nudges[replaceIndex] = coverageNudge;
          }
        }
      } else {
        wingCoverageCursor = (startCursor + 1) % totalWings;
      }
    }

    if (!nudges.length) {
      if (isNudgeLocked("campus-stable")) {
        return [];
      }
      nudges.push({
        id: "campus-stable",
        wing: "Campus Core",
        tone: "ok",
        delta: "-6%",
        message: "All wings are under predicted quota. Hold policy and mint bonus credits at 18:00.",
        action: "View Rewards",
        cooldownSec: 30,
        reward: 20,
        kwhSaved: 8,
        co2Saved: 2.8
      });
    }

    return nudges.slice(0, maxActive);
  }

  function frameFromSnapshot(snap, nudges) {
    return {
      ts: new Date().toISOString(),
      source: "edge-api",
      snapshot: clone(snap),
      state: clone({ ...state, lastNudges: nudges }),
      wings: clone(rankWings()),
      nudges: clone(nudges),
      utilities: clone(utilities),
      inference: clone(lastInference)
    };
  }

  async function refresh(options) {
    const settings = options || {};
    normalizeRuntimeForDay();
    if (settings.advanceState) {
      tickWingState();
    }
    const snap = await snapshot();
    const nudges = buildNudges(snap);
    state.lastNudges = nudges;
    if (settings.countNudges) {
      state.nudgesSent += nudges.length;
    }
    ledgerStore.persistRuntime(wingState, state);
    return frameFromSnapshot(snap, nudges);
  }

  function findWing(name) {
    if (!name) return null;
    return wingState.find(wing => wing.name.toLowerCase() === String(name).toLowerCase());
  }

  function normalizeActor(actor) {
    if (!actor) {
      return { username: "system", role: "system", wings: ["*"], allWings: true };
    }
    return {
      username: actor.username || "unknown",
      role: actor.role || "unknown",
      wings: Array.isArray(actor.wings) ? clone(actor.wings) : ["*"],
      allWings: Boolean(actor.allWings)
    };
  }

  function parseWingFromNudgeLabel(label) {
    const text = String(label || "").trim();
    if (!text) return null;
    if (text === "Campus Core") return null;
    const match = text.match(/^(.+?)\s+Wing$/i);
    return match ? match[1].trim() : text;
  }

  function actorCanAccessWing(actor, wingName) {
    if (!actor) return true;
    if (actor.allWings) return true;
    if (!wingName) return Array.isArray(actor.wings) && actor.wings.length > 0;
    return Array.isArray(actor.wings) && actor.wings.some(item => item.toLowerCase() === String(wingName).toLowerCase());
  }

  async function applyIngest(records, actor) {
    const items = Array.isArray(records) ? records : records ? [records] : [];
    let updated = 0;
    const actorInfo = normalizeActor(actor);
    items.forEach(record => {
      const wing = findWing(record.wing || record.wingName);
      if (!wing) return;

      const occupancyPct = asNumber(record.occupancyPct);
      const loadNow = asNumber(record.loadNowKw != null ? record.loadNowKw : record.loadNow);
      const baselineLoad = asNumber(record.baselineLoadKw != null ? record.baselineLoadKw : record.baselineLoad);
      const tempC = asNumber(record.tempC);
      const tokens = asNumber(record.tokens);
      const tokensDelta = asNumber(record.tokensDelta);

      if (occupancyPct != null) wing.occupancyPct = clamp(occupancyPct, 0, 1);
      if (loadNow != null) wing.loadNow = Math.max(0, loadNow);
      if (baselineLoad != null) wing.baselineLoad = Math.max(0, baselineLoad);
      if (tempC != null) wing.tempC = clamp(tempC, 15, 45);
      if (tokens != null) {
        const before = wing.tokens;
        wing.tokens = Math.max(0, Math.round(tokens));
        const delta = wing.tokens - before;
        if (delta !== 0) {
          ledgerStore.addTransaction({
            type: "adjust",
            wing: wing.name,
            amount: delta,
            action: "ingest-set-tokens",
            actor: actorInfo,
            metadata: { source: "ingest" }
          });
        }
      }
      if (tokensDelta != null) {
        wing.tokens = Math.max(0, Math.round(wing.tokens + tokensDelta));
        if (Number(tokensDelta) !== 0) {
          ledgerStore.addTransaction({
            type: "adjust",
            wing: wing.name,
            amount: Math.round(Number(tokensDelta)),
            action: "ingest-delta-tokens",
            actor: actorInfo,
            metadata: { source: "ingest" }
          });
        }
      }
      updated += 1;
    });

    return { updated, frame: await refresh({ advanceState: false, countNudges: false }) };
  }

  async function acceptTrade(nudgeId, actor) {
    const nudge = state.lastNudges.find(item => item.id === nudgeId);
    if (!nudge) {
      return { ok: false, message: `Unknown nudge: ${nudgeId}` };
    }

    const existingLock = getNudgeLock(nudge.id);
    if (existingLock) {
      const remainingSec = Math.max(1, Math.ceil((Number(existingLock.until || 0) - Date.now()) / 1000));
      return {
        ok: false,
        status: 409,
        message: `${nudge.action} is already active for ${nudge.wing}. Try again in ${formatDuration(remainingSec)}.`
      };
    }

    const actorInfo = normalizeActor(actor);
    if (actorInfo.role !== "student") {
      return {
        ok: false,
        status: 403,
        message: "Only student accounts can accept trade actions and mint $HAR."
      };
    }
    const nudgeWingName = parseWingFromNudgeLabel(nudge.wing);
    let targetWing = findWing(nudgeWingName);
    if (!targetWing) {
      targetWing = rankWings()[0];
    }

    if (!targetWing) {
      return { ok: false, message: "No wing state is available." };
    }

    if (!actorCanAccessWing(actorInfo, targetWing.name)) {
      return { ok: false, status: 403, message: `Access denied for wing ${targetWing.name}.` };
    }

    lockNudge(nudge.id, nudge.cooldownSec, {
      wing: targetWing.name,
      action: nudge.action
    });

    targetWing.tokens += Number(nudge.reward || 0);
    state.acceptedTrades += 1;
    state.co2SavedKg += Number(nudge.co2Saved || 0);
    state.todayKwh = Math.max(0, state.todayKwh - Number(nudge.kwhSaved || 0));

    ledgerStore.addTransaction({
      type: "mint",
      wing: targetWing.name,
      amount: Number(nudge.reward || 0),
      action: "accept-trade",
      actor: actorInfo,
      metadata: {
        nudgeId: nudge.id,
        nudgeAction: nudge.action,
        co2Saved: Number(nudge.co2Saved || 0),
        kwhSaved: Number(nudge.kwhSaved || 0)
      }
    });

    return {
      ok: true,
      message: `Trade accepted: ${nudge.action} for ${nudge.wing}. +${nudge.reward} $HAR minted to ${targetWing.name} Wing.`,
      frame: await refresh({ advanceState: false, countNudges: false })
    };
  }

  async function spend(cost, utilityName, actor, requestedWingName) {
    const actorInfo = normalizeActor(actor);
    let targetWing = requestedWingName ? findWing(requestedWingName) : null;
    if (!targetWing) {
      if (!actorInfo.allWings && Array.isArray(actorInfo.wings) && actorInfo.wings.length) {
        targetWing = findWing(actorInfo.wings[0]);
      } else {
        targetWing = rankWings()[0];
      }
    }

    if (!targetWing) {
      return { ok: false, message: "No wing state is available." };
    }

    if (!actorCanAccessWing(actorInfo, targetWing.name)) {
      return { ok: false, status: 403, message: `Access denied for wing ${targetWing.name}.` };
    }

    if (!Number.isFinite(cost) || cost <= 0) {
      return { ok: false, message: "Invalid utility cost." };
    }
    if (targetWing.tokens < cost) {
      return { ok: false, message: `${targetWing.name} Wing lacks tokens for ${utilityName}.` };
    }
    targetWing.tokens -= Math.round(cost);

    ledgerStore.addTransaction({
      type: "redeem",
      wing: targetWing.name,
      amount: -Math.round(cost),
      action: "spend-utility",
      utilityName,
      actor: actorInfo,
      metadata: {
        utilityName
      }
    });

    return {
      ok: true,
      message: `${targetWing.name} Wing redeemed ${utilityName} for ${Math.round(cost)} tokens.`,
      frame: await refresh({ advanceState: false, countNudges: false })
    };
  }

  async function globalNudge(payload, actor) {
    const actorInfo = normalizeActor(actor);
    const input = payload || {};
    const message = String(input.message || "").trim();
    if (!message) {
      return { ok: false, message: "Global nudge message is required." };
    }

    const durationMin = Math.max(5, Math.min(240, Number(input.durationMin || 60)));
    const targetWing = input.targetWing ? String(input.targetWing).trim() : "All Wings";
    const severity = input.severity ? String(input.severity) : "warn";

    state.globalNudge = {
      id: `global-${Date.now()}`,
      message,
      durationMin,
      targetWing,
      severity,
      actor: actorInfo.username,
      issuedAt: new Date().toISOString()
    };
    state.nudgesSent += 1;

    ledgerStore.addTransaction({
      type: "override",
      wing: targetWing === "All Wings" ? null : targetWing,
      amount: 0,
      action: "global-nudge",
      actor: actorInfo,
      metadata: {
        message,
        durationMin,
        targetWing,
        severity
      }
    });

    return {
      ok: true,
      message: `Global nudge pushed to ${targetWing} for ${durationMin} min.`,
      frame: await refresh({ advanceState: false, countNudges: false })
    };
  }

  function getInferenceStatus() {
    return clone(lastInference);
  }

  return {
    config,
    refresh,
    applyIngest,
    acceptTrade,
    spend,
    globalNudge,
    getInferenceStatus
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function sendJson(res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(),
    ...(extraHeaders || {})
  });
  res.end(body);
}

function sendText(res, statusCode, body, extraHeaders) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(),
    ...(extraHeaders || {})
  });
  res.end(body);
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

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function staticPathFromRequest(pathname) {
  if (pathname === "/") return path.join(ROOT_DIR, "hostelharmony.html");
  const requested = path.resolve(ROOT_DIR, `.${pathname}`);
  const rootLower = ROOT_DIR.toLowerCase();
  if (!requested.toLowerCase().startsWith(rootLower)) {
    return null;
  }
  return requested;
}

async function serveStatic(pathname, res) {
  const filePath = staticPathFromRequest(pathname);
  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    let target = filePath;
    const stats = await fsp.stat(target);
    if (stats.isDirectory()) {
      target = path.join(target, "hostelharmony.html");
    }
    const data = await fsp.readFile(target);
    const extension = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

const config = loadConfig();
const ledgerSeed = buildSeed(config);
const ledgerStore = createLedgerStore({
  filePath: LEDGER_PATH,
  seedData: ledgerSeed
});
const authStore = createAuthStore({
  usersPath: USERS_PATH
});
const inferenceClient = createInferenceClient();
const model = createEdgeModel(config, inferenceClient, ledgerStore);
let currentFrame = null;
const streamClients = new Set();
let refreshInFlight = false;

function broadcastFrame(frame) {
  const event = `event: snapshot\ndata: ${JSON.stringify(frame)}\n\n`;
  for (const res of streamClients) {
    try {
      res.write(event);
    } catch (error) {
      streamClients.delete(res);
    }
  }
}

async function refreshCurrent(options, shouldBroadcast) {
  const frame = await model.refresh(options);
  currentFrame = frame;
  if (shouldBroadcast) {
    broadcastFrame(currentFrame);
  }
  return currentFrame;
}

async function ensureCurrentFrame() {
  if (!currentFrame) {
    await refreshCurrent({ advanceState: false, countNudges: false }, false);
  }
  return currentFrame;
}

const tickMs = Number(config.campus && config.campus.tickMs) || 4000;
setInterval(() => {
  if (refreshInFlight) return;
  refreshInFlight = true;
  refreshCurrent({ advanceState: true, countNudges: true }, true)
    .catch(error => {
      process.stderr.write(`[edge] tick refresh failed: ${error.message}\n`);
    })
    .finally(() => {
      refreshInFlight = false;
    });
}, tickMs);

function publicActor(session) {
  if (!session) {
    return { username: "anonymous", role: "anonymous", wings: ["*"], allWings: true };
  }
  return {
    username: session.username,
    role: session.role,
    wings: Array.isArray(session.wings) ? clone(session.wings) : ["*"],
    allWings: Boolean(session.allWings)
  };
}

function authUserPayload(session) {
  if (!session) return null;
  return {
    username: session.username,
    role: session.role,
    wings: Array.isArray(session.wings) ? clone(session.wings) : ["*"],
    expiresAt: session.expiresAt
  };
}

function requireSession(req, requestUrl) {
  const session = authStore.getSessionFromRequest(req, requestUrl);
  if (!session) {
    return { ok: false, status: 401, message: "Authentication required." };
  }
  return { ok: true, session };
}

async function handleApi(req, res, pathname, requestUrl) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    const remoteHealth = await inferenceClient.health();
    sendJson(res, 200, {
      ok: true,
      service: "EcoApex Edge API",
      now: new Date().toISOString(),
      inference: model.getInferenceStatus(),
      inferenceRemote: remoteHealth,
      ledger: ledgerStore.summary()
    });
    return;
  }

  if (pathname === "/api/inference/status" && req.method === "GET") {
    const remoteHealth = await inferenceClient.health();
    sendJson(res, 200, {
      ok: true,
      status: model.getInferenceStatus(),
      remoteHealth
    });
    return;
  }

  if (pathname === "/api/auth/guest" && req.method === "POST") {
    const session = authStore.guest();
    sendJson(res, 200, {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: session.user
    });
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const payload = await readJsonBody(req);
      const session = authStore.login(payload.username, payload.password);
      if (!session) {
        sendJson(res, 401, { ok: false, error: "Invalid username or password." });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: session.user
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/auth/me" && req.method === "GET") {
    const result = requireSession(req, requestUrl);
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.message });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      user: authUserPayload(result.session)
    });
    return;
  }

  if (pathname === "/api/ledger/balances" && req.method === "GET") {
    const result = requireSession(req, requestUrl);
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.message });
      return;
    }
    const session = result.session;
    const scopeWings = session.allWings ? ["*"] : session.wings;
    sendJson(res, 200, {
      ok: true,
      balances: ledgerStore.getBalances({ scopeWings }),
      summary: ledgerStore.summary()
    });
    return;
  }

  if (pathname === "/api/ledger/transactions" && req.method === "GET") {
    const result = requireSession(req, requestUrl);
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.message });
      return;
    }
    const session = result.session;
    const limit = Number(requestUrl.searchParams.get("limit") || 100);
    const wing = requestUrl.searchParams.get("wing");
    const type = requestUrl.searchParams.get("type");
    const actor = requestUrl.searchParams.get("actor");

    if (wing && !authStore.canAccessWing(session, wing)) {
      sendJson(res, 403, { ok: false, error: `Access denied for wing ${wing}.` });
      return;
    }

    const scopeWings = session.allWings ? ["*"] : session.wings;
    sendJson(res, 200, {
      ok: true,
      transactions: ledgerStore.listTransactions({
        limit,
        wing,
        type,
        actor,
        scopeWings
      })
    });
    return;
  }

  if (pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, config);
    return;
  }

  if (pathname === "/api/state" && req.method === "GET") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    await ensureCurrentFrame();
    sendJson(res, 200, currentFrame);
    return;
  }

  if (pathname === "/api/stream" && req.method === "GET") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    await ensureCurrentFrame();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...corsHeaders()
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(currentFrame)}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    streamClients.add(res);
    req.on("close", () => {
      clearInterval(keepAlive);
      streamClients.delete(res);
    });
    return;
  }

  if (pathname === "/api/ingest" && req.method === "POST") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    if (!authStore.ensureRole(auth.session, ["admin", "operator"])) {
      sendJson(res, 403, { ok: false, error: "Insufficient role for ingest." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const outcome = await model.applyIngest(payload.records != null ? payload.records : payload, publicActor(auth.session));
      currentFrame = outcome.frame;
      broadcastFrame(currentFrame);
      sendJson(res, 200, {
        ok: true,
        source: payload.source || "unknown",
        updated: outcome.updated,
        frame: currentFrame
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/actions/accept-trade" && req.method === "POST") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    if (!authStore.ensureRole(auth.session, ["student"])) {
      sendJson(res, 403, { ok: false, error: "Only student accounts can accept trade actions." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const outcome = await model.acceptTrade(payload.nudgeId, publicActor(auth.session));
      if (!outcome.ok) {
        const status = outcome.status || 404;
        sendJson(res, status, outcome);
        return;
      }
      currentFrame = outcome.frame;
      broadcastFrame(currentFrame);
      sendJson(res, 200, outcome);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/actions/spend" && req.method === "POST") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    if (!authStore.ensureRole(auth.session, ["admin", "operator", "wing_manager", "student"])) {
      sendJson(res, 403, { ok: false, error: "Insufficient role for spend actions." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const outcome = await model.spend(
        Number(payload.cost),
        payload.utilityName || "utility",
        publicActor(auth.session),
        payload.wing || payload.wingName || authStore.pickDefaultWing(auth.session)
      );
      if (!outcome.ok) {
        const status = outcome.status || 400;
        sendJson(res, status, outcome);
        return;
      }
      currentFrame = outcome.frame;
      broadcastFrame(currentFrame);
      sendJson(res, 200, outcome);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/api/actions/global-nudge" && req.method === "POST") {
    const auth = requireSession(req, requestUrl);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.message });
      return;
    }
    if (!authStore.ensureRole(auth.session, ["admin", "operator"])) {
      sendJson(res, 403, { ok: false, error: "Insufficient role for global nudge override." });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const outcome = await model.globalNudge(payload, publicActor(auth.session));
      if (!outcome.ok) {
        sendJson(res, 400, outcome);
        return;
      }
      currentFrame = outcome.frame;
      broadcastFrame(currentFrame);
      sendJson(res, 200, outcome);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "API route not found" });
}

const server = http.createServer((req, res) => {
  (async () => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname, requestUrl);
      return;
    }

    await serveStatic(pathname, res);
  })().catch(error => {
    sendJson(res, 500, { ok: false, error: error.message });
  });
});

server.listen(PORT, async () => {
  try {
    await refreshCurrent({ advanceState: false, countNudges: false }, false);
  } catch (error) {
    process.stderr.write(`[edge] initial frame failed: ${error.message}\n`);
  }
  process.stdout.write(`EcoApex edge server listening on http://localhost:${PORT}\n`);
});
