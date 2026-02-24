import { DEFAULT_CONFIG } from "./default-config.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return clone(DEFAULT_CONFIG);
  }
  const config = clone(raw);
  if (!Array.isArray(config.wings) || !config.wings.length) {
    return clone(DEFAULT_CONFIG);
  }

  const roomsFromWings = config.wings.reduce((sum, wing) => sum + Number(wing.rooms || 0), 0);
  if (!config.campus) {
    config.campus = {};
  }
  if (!config.campus.roomsTotal) {
    config.campus.roomsTotal = roomsFromWings;
  }
  if (!config.campus.quotaKwh) {
    config.campus.quotaKwh = DEFAULT_CONFIG.campus.quotaKwh;
  }
  if (!config.campus.tickMs) {
    config.campus.tickMs = DEFAULT_CONFIG.campus.tickMs;
  }
  if (!Array.isArray(config.utilities) || !config.utilities.length) {
    config.utilities = clone(DEFAULT_CONFIG.utilities);
  }
  if (!Array.isArray(config.heatmapPattern) || config.heatmapPattern.length !== 24) {
    config.heatmapPattern = clone(DEFAULT_CONFIG.heatmapPattern);
  }

  return config;
}

export async function loadEcoApexConfig() {
  const configUrl = new URL("../config/wings.json", import.meta.url);
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`Config request failed: ${response.status}`);
    }
    const json = await response.json();
    return normalizeConfig(json);
  } catch (error) {
    console.warn("[EcoApex] Falling back to embedded config.", error);
    return normalizeConfig(DEFAULT_CONFIG);
  }
}
