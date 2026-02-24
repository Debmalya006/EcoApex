import { loadEcoApexConfig } from "./config-loader.js";
import { createTwinEngine } from "./twin.js";
import { buildHyperNudges } from "./nudges.js";
import { createHarmonyEconomy } from "./economy.js";
import { createUI } from "./ui.js";
import { createApiClient } from "./api-client.js";

const STUDENT_SSO_MAP = {
  "STU-ALPHA-2026": { username: "student_alpha", password: "stu_alpha123", wing: "Alpha" },
  "STU-BETA-2026": { username: "student_beta", password: "stu_beta123", wing: "Beta" },
  "STU-GAMMA-2026": { username: "student_gamma", password: "stu_gamma123", wing: "Gamma" },
  "STU-DELTA-2026": { username: "student_delta", password: "stu_delta123", wing: "Delta" },
  "STU-EPSILON-2026": { username: "student_epsilon", password: "stu_epsilon123", wing: "Epsilon" }
};
const STUDENT_NUDGE_DELAY_MS = 1000;
const DEFAULT_NUDGE_DELAY_MS = 3000;

function onboardingStorageKey(username) {
  return `ecoapex_onboarding_${username}`;
}

function loadOnboarding(username) {
  if (!username) return null;
  try {
    const raw = window.localStorage.getItem(onboardingStorageKey(username));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveOnboarding(username, data) {
  if (!username) return;
  window.localStorage.setItem(onboardingStorageKey(username), JSON.stringify(data));
}

function forceShowOnboardingModal() {
  const modal = document.getElementById("onboard-modal");
  if (modal) {
    modal.style.display = "grid";
  }
}

function behaviorFactorFromOnboarding(onboarding) {
  if (!onboarding) return 1;
  let factor = 1;
  if (onboarding.studyPreference === "common_hall") factor -= 0.06;
  if (onboarding.connectDevices === "yes") factor -= 0.04;
  if (onboarding.laundryPriority === "friday") factor += 0.03;
  return Math.max(0.82, Math.min(1.15, factor));
}

function firstWing(user) {
  if (!user || !Array.isArray(user.wings) || !user.wings.length || user.wings[0] === "*") {
    return null;
  }
  return user.wings[0];
}

function normalizeWingKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+wing$/i, "")
    .replace(/\s+/g, " ");
}

function isGlobalWing(value) {
  const wing = normalizeWingKey(value);
  return !wing || wing === "*" || wing === "all" || wing === "all wings" || wing.startsWith("campus");
}

function asHarDelta(value, sign = "+") {
  const amount = Math.max(0, Math.round(Number(value || 0)));
  return `${sign}${amount} $HAR`;
}

function nudgeWingKey(nudge) {
  if (!nudge || typeof nudge !== "object") return "";

  const wingLabel = normalizeWingKey(nudge.wing);
  if (wingLabel && !isGlobalWing(wingLabel)) {
    return wingLabel;
  }

  const nudgeId = String(nudge.id || "").trim().toLowerCase();
  const idMatch = nudgeId.match(/^([a-z0-9_]+)-[a-z0-9_-]+$/);
  if (!idMatch) return "";

  const fromId = idMatch[1].replace(/_/g, " ");
  return isGlobalWing(fromId) ? "" : fromId;
}

function filterNudgesForViewer(nudges, roleView, user) {
  const list = Array.isArray(nudges) ? nudges : [];
  if (roleView !== "student") return list;

  const studentWing = normalizeWingKey(firstWing(user));
  if (!studentWing) return list;

  return list.filter(nudge => {
    const wingKey = nudgeWingKey(nudge);
    return wingKey === studentWing;
  });
}

function withNudgeRevealDelay(nudges, revealAtMs) {
  const list = Array.isArray(nudges) ? nudges : [];
  if (Date.now() < Number(revealAtMs || 0)) {
    return [];
  }
  return list;
}

function startClock(ui) {
  ui.updateClock();
  setInterval(() => ui.updateClock(), 1000);
}

async function startEdgeMode(ui) {
  const api = createApiClient("/api");
  const backendReady = await api.checkHealth();
  if (!backendReady) {
    return false;
  }

  try {
    await api.loginGuest();
  } catch (error) {
    ui.showToast(`Could not start sign-in automatically. ${error.message}`);
    return false;
  }

  const config = await api.fetchConfig();
  ui.renderHeatmap(Array.isArray(config.heatmapPattern) ? config.heatmapPattern : []);

  const state = {
    frame: null,
    user: null,
    roleView: null,
    onboarding: null,
    streamStop: null,
    nudgeRevealAtMs: Date.now() + DEFAULT_NUDGE_DELAY_MS
  };

  function renderFrame(frame, callbacks) {
    if (!frame) return;
    state.frame = frame;
    const filteredNudges = filterNudgesForViewer(frame.nudges, state.roleView, state.user);
    const visibleNudges = withNudgeRevealDelay(filteredNudges, state.nudgeRevealAtMs);
    ui.renderStats(frame.snapshot, frame.state, frame.wings);
    ui.renderNudges(visibleNudges, callbacks.onAcceptTrade);
    ui.renderHarmonyBoard(
      Array.isArray(frame.wings) ? frame.wings : [],
      Array.isArray(frame.utilities) ? frame.utilities : [],
      callbacks.onSpendTokens
    );
    ui.renderInference(frame.inference);
    ui.renderAnalytics({
      ...frame,
      nudges: visibleNudges
    });

    if (state.roleView === "student" && state.user) {
      ui.renderStudentPanel({
        user: state.user,
        frame,
        wingName: firstWing(state.user) || "Campus",
        behaviorFactor: behaviorFactorFromOnboarding(state.onboarding),
        spendOptions: Array.isArray(frame.utilities) ? frame.utilities : [],
        onSpend: callbacks.onSpendTokens
      });
    }

    if (state.roleView === "admin" && state.user) {
      ui.renderAdminPanel({
        user: state.user,
        frame
      });
    }
  }

  async function onAcceptTrade(nudge) {
    if (!nudge || !nudge.id) return false;
    if (state.roleView !== "student") {
      ui.showToast("Only student accounts can apply Deep Freeze or Kill Standby Load actions.");
      return false;
    }
    try {
      const result = await api.acceptTrade(nudge.id);
      ui.showToast(result.message || `Energy-saving action accepted for ${nudge.wing}.`);
      if (state.roleView === "student") {
        ui.addStudentActivity(`Accepted nudge: ${nudge.action} (${nudge.wing})`, asHarDelta(nudge.reward), "positive");
      }
      if (result.frame) {
        renderFrame(result.frame, { onAcceptTrade, onSpendTokens });
      }
      return true;
    } catch (error) {
      ui.showToast(`Could not apply the energy action. ${error.message}`);
      return false;
    }
  }

  async function onSpendTokens(cost, utilityName) {
    try {
      const wing = state.roleView === "student" ? firstWing(state.user) : undefined;
      const result = await api.spend(cost, utilityName, wing);
      ui.showToast(result.message || `Redeemed ${utilityName} for ${cost} $HAR.`);
      if (result.frame) {
        renderFrame(result.frame, { onAcceptTrade, onSpendTokens });
      }
      return true;
    } catch (error) {
      ui.showToast(`Could not redeem this option. ${error.message}`);
      return false;
    }
  }

  async function onGlobalNudge(payload) {
    try {
      const result = await api.globalNudge(payload.message, payload.durationMin, payload.targetWing, payload.severity);
      ui.showToast(result.message || "Global nudge sent to all wings.");
      if (result.frame) {
        renderFrame(result.frame, { onAcceptTrade, onSpendTokens });
      }
    } catch (error) {
      ui.showToast(`Could not send the global nudge. ${error.message}`);
    }
  }

  function startStream() {
    if (state.streamStop) {
      state.streamStop();
      state.streamStop = null;
    }
    state.streamStop = api.openStream({
      onSnapshot: frame => renderFrame(frame, { onAcceptTrade, onSpendTokens }),
      onError: () => {
        ui.showToast("Live updates paused for a moment. Reconnecting now.");
      }
    });
  }

  async function authenticate(username, password, viewRole, options) {
    const opts = options || {};
    const label = opts.label || "user";
    try {
      ui.setPortalStatus(`Signing in ${label}. Please wait...`);
      await api.login(username, password);
      const mePayload = await api.me();
      state.user = mePayload.user;
      state.roleView = viewRole;
      state.onboarding = loadOnboarding(state.user.username);
      state.nudgeRevealAtMs = Date.now() + (viewRole === "student" ? STUDENT_NUDGE_DELAY_MS : DEFAULT_NUDGE_DELAY_MS);

      ui.setPortalStatus(`Login successful. Welcome, ${state.user.username}.`, "success");
      ui.hidePortal();
      ui.setRolePanel(viewRole);

      if (viewRole === "student") {
        if (!state.onboarding) {
          ui.showOnboarding();
          forceShowOnboardingModal();
        } else {
          ui.hideOnboarding();
        }
      } else {
        ui.hideOnboarding();
      }

      startStream();
      const frame = await api.fetchState();
      renderFrame(frame, { onAcceptTrade, onSpendTokens });
      return true;
    } catch (error) {
      ui.setPortalStatus(`Login failed for ${label}. ${error.message}`, "error");
      return false;
    }
  }

  ui.initAccessPortal({
    onStudentSso: async studentId => {
      const credential = STUDENT_SSO_MAP[studentId];
      if (!credential) {
        ui.setPortalStatus(`Student ID ${studentId} was not found.`, "error");
        return;
      }
      const ok = await authenticate(credential.username, credential.password, "student", {
        label: `SSO ${studentId}`
      });
      if (ok) {
        ui.showToast(`Signed in with ${studentId}. Your next 4-hour usage prediction is ready.`);
      }
    },
    onStudentBiometric: async studentId => {
      const credential = STUDENT_SSO_MAP[studentId];
      if (!credential) {
        ui.setPortalStatus(`Student ID ${studentId} was not found.`, "error");
        return;
      }
      ui.setPortalStatus("Scanning biometric login...");
      const ok = await authenticate(credential.username, credential.password, "student", {
        label: `Biometric ${studentId}`
      });
      if (ok) {
        ui.showToast("Biometric login verified. Your personal 4-hour prediction is now ready.");
      }
    },
    onAdminLogin: async (username, password) => {
      const ok = await authenticate(username, password, "admin", {
        label: username || "admin"
      });
      if (ok) {
        ui.showToast("Admin access granted. Command Center is ready.");
      }
    },
    onOnboardingSave: answers => {
      if (!state.user) return;
      saveOnboarding(state.user.username, answers);
      state.onboarding = answers;
      ui.hideOnboarding();
      if (state.frame) {
        renderFrame(state.frame, { onAcceptTrade, onSpendTokens });
      }
    },
    onGlobalNudge
  });

  ui.showPortal();
  ui.setRolePanel("none");
  ui.setPortalStatus("Choose Student or Admin to continue.");

  startStream();
  const initialFrame = await api.fetchState();
  renderFrame(initialFrame, { onAcceptTrade, onSpendTokens });

  window.showToast = () => {
    const frameNudges = Array.isArray(state.frame && state.frame.nudges) ? state.frame.nudges : [];
    const filteredNudges = filterNudgesForViewer(frameNudges, state.roleView, state.user);
    const visibleNudges = withNudgeRevealDelay(filteredNudges, state.nudgeRevealAtMs);
    const activeNudges = visibleNudges.filter(nudge => String(nudge && (nudge.tone || nudge.type || "")).toLowerCase() !== "ok");
    if (!activeNudges.length) {
      ui.showToast("No active energy alerts right now.");
      return;
    }
    const top = activeNudges[0];
    ui.showToast(`${top.wing}: ${top.message} -> ${top.action} (+${top.reward} tokens).`);
  };

  window.ecoApexLogin = async (username, password) => {
    const session = await api.login(username, password);
    const me = await api.me();
    return { session, me };
  };
  window.ecoApexOpenPortal = () => ui.showPortal();
  window.ecoApexIngest = records => api.ingest(records, "browser-console");
  window.ecoApexLedger = options => api.fetchLedgerTransactions(options || { limit: 50 });
  window.ecoApexBalances = () => api.fetchLedgerBalances();
  return true;
}

async function startLocalFallback(ui) {
  const config = await loadEcoApexConfig();
  const twin = createTwinEngine(config);
  const economy = createHarmonyEconomy(config);
  const nudgeLocks = new Map();
  const defaultNudgeCooldownSec = 30;
  const nudgeRevealAtMs = Date.now() + DEFAULT_NUDGE_DELAY_MS;

  ui.hidePortal();
  ui.hideOnboarding();
  ui.setRolePanel("none");

  function pruneNudgeLocks() {
    const now = Date.now();
    for (const [nudgeId, lockUntil] of nudgeLocks.entries()) {
      if (Number(lockUntil || 0) <= now) {
        nudgeLocks.delete(nudgeId);
      }
    }
  }

  function formatDuration(seconds) {
    const totalSec = Math.max(1, Math.round(Number(seconds || 0)));
    if (totalSec < 60) return `${totalSec} sec`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec > 0 ? `${min} min ${sec} sec` : `${min} min`;
  }

  function getRemainingNudgeLockSec(nudgeId) {
    pruneNudgeLocks();
    const until = Number(nudgeLocks.get(String(nudgeId)) || 0);
    if (!until || until <= Date.now()) return 0;
    return Math.max(1, Math.ceil((until - Date.now()) / 1000));
  }

  function lockNudge(nudgeId, cooldownSec) {
    const nudgeKey = String(nudgeId || "").trim();
    if (!nudgeKey) return;
    const seconds = Math.max(1, Number(cooldownSec || defaultNudgeCooldownSec));
    nudgeLocks.set(nudgeKey, Date.now() + seconds * 1000);
  }

  function renderTick({ advanceState = true, countNudges = true } = {}) {
    const snapshot = advanceState ? twin.tick() : twin.getSnapshot();
    const generatedNudges = buildHyperNudges(snapshot, config.nudgePolicy)
      .filter(nudge => getRemainingNudgeLockSec(nudge.id) === 0);
    const nudges = withNudgeRevealDelay(generatedNudges, nudgeRevealAtMs);
    twin.state.lastNudges = nudges;
    if (countNudges) {
      twin.addNudgesSent(nudges.length);
    }

    ui.renderStats(snapshot, twin.state, twin.wingState);
    ui.renderNudges(nudges, acceptTrade);
    ui.renderHarmonyBoard(economy.rankWings(twin.wingState), economy.utilities, spendTokens);
    ui.renderInference({
      mode: "local-fallback",
      modelVersion: "heuristic-v1"
    });
  }

  function acceptTrade(nudge) {
    if (!nudge || !nudge.id) {
      return false;
    }
    const remainingSec = getRemainingNudgeLockSec(nudge.id);
    if (remainingSec > 0) {
      ui.showToast(`${nudge.action} is already active for ${nudge.wing}. Try again in ${formatDuration(remainingSec)}.`);
      return false;
    }
    lockNudge(nudge.id, nudge.cooldownSec);
    const topWing = twin.applyIntervention({
      kwhSaved: nudge.kwhSaved,
      co2Saved: nudge.co2Saved,
      tokensReward: nudge.reward
    });
    ui.showToast(`${nudge.wing}: ${nudge.action} applied. +${nudge.reward} $HAR added to ${topWing.name} Wing.`);
    ui.addStudentActivity(`Accepted nudge: ${nudge.action} (${nudge.wing})`, asHarDelta(nudge.reward), "positive");
    renderTick({ advanceState: false, countNudges: false });
    return true;
  }

  function spendTokens(cost, utilityName) {
    const result = economy.spend(twin.wingState, cost, utilityName);
    ui.showToast(result.message || `Redeemed ${utilityName} for ${cost} $HAR.`);
    if (result.ok) {
      ui.renderHarmonyBoard(economy.rankWings(twin.wingState), economy.utilities, spendTokens);
    }
    return Boolean(result.ok);
  }

  ui.renderHeatmap(config.heatmapPattern);
  renderTick({ advanceState: true, countNudges: true });

  setInterval(() => renderTick({ advanceState: true, countNudges: true }), Number(config.campus.tickMs || 7000));

  window.showToast = () => {
    ui.showToast("Running in local demo mode. Start the edge API server for live shared data.");
  };
}

async function bootEcoApex() {
  const ui = createUI();
  ui.initTabs();
  ui.initInteractions();
  startClock(ui);

  try {
    const connected = await startEdgeMode(ui);
    if (!connected) {
      await startLocalFallback(ui);
    }
  } catch (error) {
    ui.showToast(`Could not start live edge mode. ${error.message}. Switched to local demo mode.`);
    await startLocalFallback(ui);
  }
}

bootEcoApex();
