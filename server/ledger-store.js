const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildSeed(config) {
  const balances = {};
  const wings = Array.isArray(config.wings) ? config.wings : [];
  wings.forEach(wing => {
    const name = String(wing.name || "").trim();
    if (!name) return;
    const initialTokens = Number(wing.initial && wing.initial.tokens);
    balances[name] = Number.isFinite(initialTokens) ? Math.max(0, Math.round(initialTokens)) : 0;
  });

  const campus = config.campus || {};
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    balances,
    runtime: {
      todayKwh: Number(campus.startTodayKwh || 0),
      co2SavedKg: Number(campus.startCo2SavedKg || 0),
      nudgesSent: 0,
      acceptedTrades: 0,
      runtimeDayKey: dayKey()
    },
    transactions: []
  };
}

function createLedgerStore(options) {
  const settings = options || {};
  const filePath = settings.filePath;
  const maxTransactions = Number(settings.maxTransactions || 4000);
  let data = settings.seedData ? clone(settings.seedData) : null;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.balances && parsed.runtime) {
        data = parsed;
      }
    } catch (error) {
      data = settings.seedData ? clone(settings.seedData) : null;
    }
  }

  if (!data) {
    data = settings.seedData ? clone(settings.seedData) : buildSeed({ wings: [], campus: {} });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  function persist() {
    data.updatedAt = nowIso();
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function hydrateRuntime(wingState, state) {
    if (!Array.isArray(wingState) || !state || typeof state !== "object") return;

    const balances = data.balances || {};
    wingState.forEach(wing => {
      const name = String(wing.name || "");
      if (!name) return;
      if (Object.prototype.hasOwnProperty.call(balances, name)) {
        wing.tokens = Math.max(0, Math.round(Number(balances[name] || 0)));
      } else {
        balances[name] = Math.max(0, Math.round(Number(wing.tokens || 0)));
      }
    });

    if (data.runtime && typeof data.runtime === "object") {
      if (Number.isFinite(Number(data.runtime.todayKwh))) state.todayKwh = Number(data.runtime.todayKwh);
      if (Number.isFinite(Number(data.runtime.co2SavedKg))) state.co2SavedKg = Number(data.runtime.co2SavedKg);
      if (Number.isFinite(Number(data.runtime.nudgesSent))) state.nudgesSent = Number(data.runtime.nudgesSent);
      if (Number.isFinite(Number(data.runtime.acceptedTrades))) state.acceptedTrades = Number(data.runtime.acceptedTrades);
      if (typeof data.runtime.runtimeDayKey === "string" && data.runtime.runtimeDayKey.trim()) {
        state.runtimeDayKey = data.runtime.runtimeDayKey.trim();
      }
    }
  }

  function persistRuntime(wingState, state) {
    if (Array.isArray(wingState)) {
      wingState.forEach(wing => {
        const name = String(wing.name || "").trim();
        if (!name) return;
        data.balances[name] = Math.max(0, Math.round(Number(wing.tokens || 0)));
      });
    }

    if (state && typeof state === "object") {
      data.runtime = {
        todayKwh: Number(state.todayKwh || 0),
        co2SavedKg: Number(state.co2SavedKg || 0),
        nudgesSent: Number(state.nudgesSent || 0),
        acceptedTrades: Number(state.acceptedTrades || 0),
        runtimeDayKey: typeof state.runtimeDayKey === "string" && state.runtimeDayKey.trim()
          ? state.runtimeDayKey.trim()
          : dayKey()
      };
    }
    persist();
  }

  function addTransaction(tx) {
    const record = {
      id: crypto.randomBytes(8).toString("hex"),
      ts: nowIso(),
      type: String(tx.type || "event"),
      wing: tx.wing != null ? String(tx.wing) : null,
      amount: Number(tx.amount || 0),
      currency: tx.currency || "$HARMONY",
      utilityName: tx.utilityName || null,
      action: tx.action || null,
      actor: tx.actor || { username: "system", role: "system" },
      metadata: tx.metadata && typeof tx.metadata === "object" ? clone(tx.metadata) : {}
    };
    data.transactions.unshift(record);
    if (data.transactions.length > maxTransactions) {
      data.transactions = data.transactions.slice(0, maxTransactions);
    }
    persist();
    return clone(record);
  }

  function listTransactions(filters) {
    const options = filters || {};
    const wing = options.wing ? String(options.wing).toLowerCase() : null;
    const type = options.type ? String(options.type).toLowerCase() : null;
    const actor = options.actor ? String(options.actor).toLowerCase() : null;
    const scopeWings = Array.isArray(options.scopeWings) ? options.scopeWings.map(item => String(item).toLowerCase()) : null;
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));

    let rows = Array.isArray(data.transactions) ? data.transactions : [];
    if (wing) {
      rows = rows.filter(item => String(item.wing || "").toLowerCase() === wing);
    }
    if (type) {
      rows = rows.filter(item => String(item.type || "").toLowerCase() === type);
    }
    if (actor) {
      rows = rows.filter(item => String(item.actor && item.actor.username ? item.actor.username : "").toLowerCase() === actor);
    }
    if (scopeWings && scopeWings.length && !scopeWings.includes("*")) {
      rows = rows.filter(item => scopeWings.includes(String(item.wing || "").toLowerCase()));
    }
    return clone(rows.slice(0, limit));
  }

  function getBalances(filters) {
    const options = filters || {};
    const scopeWings = Array.isArray(options.scopeWings) ? options.scopeWings.map(item => String(item).toLowerCase()) : null;
    const rows = Object.entries(data.balances || {}).map(([wing, tokens]) => ({
      wing,
      tokens: Math.max(0, Math.round(Number(tokens || 0)))
    }));
    if (scopeWings && scopeWings.length && !scopeWings.includes("*")) {
      return rows.filter(item => scopeWings.includes(item.wing.toLowerCase()));
    }
    return rows;
  }

  function summary() {
    const balances = getBalances();
    const totalTokens = balances.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
    return {
      updatedAt: data.updatedAt,
      totalWings: balances.length,
      totalTokens,
      transactionCount: Array.isArray(data.transactions) ? data.transactions.length : 0
    };
  }

  return {
    hydrateRuntime,
    persistRuntime,
    addTransaction,
    listTransactions,
    getBalances,
    summary
  };
}

module.exports = {
  buildSeed,
  createLedgerStore
};
