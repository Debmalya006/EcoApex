function fmt(num) {
  return Math.round(num).toLocaleString("en-US");
}

function heatColor(value, minValue, maxValue, mode) {
  const min = Number.isFinite(minValue) ? Number(minValue) : 0;
  const max = Number.isFinite(maxValue) ? Number(maxValue) : Math.max(min + 1, Number(value || 0) + 1);
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : min;
  const ratio = Math.min(1, Math.max(0, (safeValue - min) / Math.max(1, max - min)));
  const hue = 152 - ratio * 152;
  const saturation = 78 - ratio * 9;
  const lightness = 25 + ratio * 32;
  const alphaBase = 0.3 + ratio * 0.58;
  const alpha = mode === "future" ? alphaBase * 0.72 : alphaBase;
  return `hsla(${hue.toFixed(1)},${saturation.toFixed(1)}%,${lightness.toFixed(1)}%,${alpha.toFixed(2)})`;
}

const HEATMAP_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatmapDayIndex(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date();
  // Convert JS Sunday-first (0..6) into Monday-first (0..6).
  return (date.getDay() + 6) % 7;
}

function heatmapGradientColor(value, minValue, maxValue) {
  const min = Number.isFinite(Number(minValue)) ? Number(minValue) : 0;
  const maxRaw = Number.isFinite(Number(maxValue)) ? Number(maxValue) : min + 1;
  const max = maxRaw > min ? maxRaw : min + 1;
  const safe = Number.isFinite(Number(value)) ? Number(value) : min;
  const t = clamp((safe - min) / (max - min), 0, 1);

  const stops = [
    [0.0, [20, 45, 90]],
    [0.25, [15, 90, 80]],
    [0.45, [35, 180, 100]],
    [0.65, [140, 230, 80]],
    [0.8, [255, 195, 50]],
    [0.92, [255, 130, 40]],
    [1.0, [255, 60, 80]]
  ];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const [t0, c0] = stops[index];
    const [t1, c1] = stops[index + 1];
    if (t >= t0 && t <= t1) {
      const span = Math.max(0.0001, t1 - t0);
      const ratio = (t - t0) / span;
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * ratio);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * ratio);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * ratio);
      return `rgb(${r},${g},${b})`;
    }
  }

  return "rgb(255,60,80)";
}

function seededWave(seed, rowIndex, hour) {
  const a = Math.sin((hour + 1) * 0.67 + rowIndex * 1.19 + seed * 0.31);
  const b = Math.cos((hour + 1) * 1.37 + rowIndex * 0.53 + seed * 0.17);
  return (a + b) * 0.5;
}

function heatIntensity(value, minValue, maxValue) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const min = Number.isFinite(Number(minValue)) ? Number(minValue) : 0;
  const max = Number.isFinite(Number(maxValue)) ? Number(maxValue) : min;
  const range = max - min;

  if (range > 0.0001) {
    return clamp(((safeValue - min) / range) * 100, 0, 100);
  }

  // Fallback: preserve variation when values are near-uniform.
  return clamp(safeValue, 0, 100);
}

function barColor(index, total) {
  if (index <= 1) return "var(--green)";
  if (index === total - 1) return "var(--red)";
  return "var(--amber)";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function inferCampusQuotaKwh(snapshot, state) {
  const projectedKwh = Math.max(0, Number((snapshot && snapshot.projectedTodayKwh) || 0));
  const overByKwh = Math.max(0, Number((snapshot && snapshot.overByKwh) || 0));
  const remainingKwh = Math.max(0, Number((snapshot && snapshot.remainingKwh) || 0));
  const budgetUsePct = Number((snapshot && snapshot.budgetUsePct) || 0);
  const todayKwh = Math.max(0, Number((state && state.todayKwh) || 0));

  if (overByKwh > 0) {
    return Math.max(1, projectedKwh - overByKwh);
  }
  if (remainingKwh > 0) {
    return Math.max(1, projectedKwh + remainingKwh);
  }
  if (budgetUsePct > 0 && budgetUsePct < 100) {
    const inferred = projectedKwh / (budgetUsePct / 100);
    if (Number.isFinite(inferred) && inferred > 0) {
      return inferred;
    }
  }
  return Math.max(1, projectedKwh || todayKwh || 1);
}

function getWingDemandShare(wings, wingName) {
  const list = Array.isArray(wings) ? wings : [];
  if (!list.length) {
    return { wing: null, share: 0.2 };
  }

  const targetName = String(wingName || "").trim().toLowerCase();
  const wing = list.find(item => String((item && item.name) || "").trim().toLowerCase() === targetName) || list[0];
  const totalRooms = list.reduce((sum, item) => sum + Math.max(1, Number((item && item.rooms) || 1)), 0);
  const totalLoad = list.reduce((sum, item) => sum + Math.max(0, Number((item && (item.loadNow || item.usage)) || 0)), 0);

  const roomsShare = Math.max(1, Number((wing && wing.rooms) || 1)) / Math.max(1, totalRooms);
  const loadShare = totalLoad > 0
    ? Math.max(0, Number((wing && (wing.loadNow || wing.usage)) || 0)) / totalLoad
    : roomsShare;
  const occupancyPct = clamp(Number((wing && wing.occupancyPct) || 0.6), 0.2, 0.95);
  const weightedShare = (roomsShare * 0.58 + loadShare * 0.42) * (0.92 + occupancyPct * 0.14);

  return {
    wing,
    share: clamp(weightedShare, 0.06, 0.72)
  };
}

function normalizeWingKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+wing$/i, "")
    .replace(/\s+/g, " ");
}

function isGlobalWingKey(value) {
  const wing = normalizeWingKey(value);
  return !wing || wing === "*" || wing === "all" || wing === "all wings" || wing.startsWith("campus");
}

function nudgeWingKey(nudge) {
  if (!nudge || typeof nudge !== "object") return "";

  const wingLabel = normalizeWingKey(nudge.wing);
  if (wingLabel && !isGlobalWingKey(wingLabel)) {
    return wingLabel;
  }

  const nudgeId = String(nudge.id || "").trim().toLowerCase();
  const idMatch = nudgeId.match(/^([a-z0-9_]+)-[a-z0-9_-]+$/);
  if (!idMatch) return "";

  const fromId = idMatch[1].replace(/_/g, " ");
  return isGlobalWingKey(fromId) ? "" : fromId;
}

const DEFAULT_PAGE = "energy-overview";
const STUDENT_PAGE = "student-app";
const ADMIN_PAGE = "admin-command-center";
const MARKET_ITEMS = [
  { id: "lib", name: "Late Night Library Pass", cost: 15, iconHtml: "&#128218;" },
  { id: "lnd", name: "Express Laundry Slot", cost: 10, iconHtml: "&#129530;" },
  { id: "h2o", name: "Hot Water Priority", cost: 5, iconHtml: "&#128703;" },
  { id: "gym", name: "Gym Peak Hour Access", cost: 12, iconHtml: "&#127947;" }
];
const WING_COLORS = {
  alpha: "#23d08f",
  beta: "#4f8dd0",
  gamma: "#d39c39",
  delta: "#8aa0b7",
  epsilon: "#de667b"
};
const HOURLY_BASE = [88, 72, 65, 58, 54, 60, 110, 175, 215, 245, 260, 270, 275, 268, 255, 260, 275, 310, 350, 383, 370, 340, 300, 250];
const SIDEBAR_COLLAPSE_STORAGE_KEY = "ecoapex_sidebar_collapsed";
const MAX_STUDENT_ACTIVITY_ITEMS = 18;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toFriendlyPopupMessage(message) {
  const raw = cleanText(message);
  if (!raw) return "Update received.";
  const lower = raw.toLowerCase();

  if (lower.includes("auth bootstrap failed")) {
    return "We could not start your login session. Please check the server and refresh.";
  }
  if (lower.includes("trade action failed")) {
    return "We could not apply this energy action. Please try again.";
  }
  if (lower.includes("global nudge failed")) {
    return "Global nudge was not sent. Please check the message and retry.";
  }
  if (lower.includes("spend failed")) {
    return "Token redemption failed. Please check your balance and try again.";
  }
  if (lower.includes("edge stream reconnecting")) {
    return "Live data connection dropped. Reconnecting now.";
  }
  if (lower.includes("edge startup failed")) {
    return "Live edge service is unavailable. The app is running in local mode.";
  }
  if (lower.includes("connected to ecoapex edge api as")) {
    return raw.replace("Connected to EcoApex edge API as", "Connected successfully as");
  }

  return raw
    .replace(/\$HARMONY/gi, "$HAR")
    .replace(/\bHarmony tokens?\b/gi, "$HAR")
    .replace(/\b([0-9]+(?:\.[0-9]+)?)\s*H\b/g, "$1 $HAR")
    .replace(/\s*\|\s*/g, " - ");
}

function popupTitleFromMessage(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("failed") || lower.includes("could not") || lower.includes("error")) {
    return "Action Needed";
  }
  if (
    lower.includes("saved") ||
    lower.includes("success") ||
    lower.includes("granted") ||
    lower.includes("accepted") ||
    lower.includes("connected")
  ) {
    return "Success";
  }
  if (lower.includes("nudge") || lower.includes("tip")) {
    return "Energy Tip";
  }
  return "EcoApex Update";
}

function renderBoardUsageWidth(wing) {
  const usage = Number(wing.loadNow || wing.usage || 0);
  return Math.max(8, Math.min(100, 100 - usage / 4));
}

function medalByRank(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1);
}

function wingColorForName(wingName) {
  const key = normalizeWingKey(wingName).split(" ")[0];
  return WING_COLORS[key] || "#5a8cbf";
}

export function createUI() {
  const el = {
    shell: document.querySelector(".shell"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    clock: document.getElementById("clock"),
    totalKwh: document.getElementById("stat-total-kwh"),
    totalDelta: document.getElementById("stat-total-delta"),
    co2: document.getElementById("stat-co2"),
    co2Delta: document.getElementById("stat-co2-delta"),
    activeRooms: document.getElementById("stat-active-rooms"),
    occupancy: document.getElementById("stat-occupancy"),
    overQuota: document.getElementById("stat-over-quota"),
    nudgesSent: document.getElementById("stat-nudges-sent"),
    nudgeCount: document.getElementById("nudge-count"),
    sidebarNudgeCount: document.getElementById("sidebar-nudge-count"),
    notifNudgeCount: document.getElementById("notif-nudge-count"),
    nudgeList: document.getElementById("nudge-list"),
    harmonyBoard: document.getElementById("harmony-board"),
    marketplaceBoard: document.getElementById("marketplace-board"),
    predictBadge: document.getElementById("predict-badge"),
    predictProgressLabel: document.getElementById("predict-progress-label"),
    predictFill: document.getElementById("predict-fill"),
    predictUsed: document.getElementById("predict-used"),
    predictOver: document.getElementById("predict-over"),
    predictTemp: document.getElementById("predict-temp"),
    predictQuotaLine: document.getElementById("predict-quota-line"),
    predictQuotaLabel: document.getElementById("predict-quota-label"),
    predictMinLabel: document.getElementById("predict-min-label"),
    predictMidLabel: document.getElementById("predict-mid-label"),
    predictMaxLabel: document.getElementById("predict-max-label"),
    predictHourly: document.getElementById("predict-hourly"),
    predictDriverWeather: document.getElementById("predict-driver-weather"),
    predictDriverOccupancy: document.getElementById("predict-driver-occupancy"),
    predictDriverSchedule: document.getElementById("predict-driver-schedule"),
    predictRiskNote: document.getElementById("predict-risk-note"),
    chartActualPath: document.getElementById("chart-actual-path"),
    chartPredPath: document.getElementById("chart-pred-path"),
    chartQuotaLine: document.getElementById("chart-quota-line"),
    inferenceModeTag: document.getElementById("inference-mode-tag"),
    heatmap: document.getElementById("heatmap"),
    heatmapPeak: document.getElementById("heatmap-peak"),
    heatmapPeakTime: document.getElementById("heatmap-peak-time"),
    heatmapPeakKwh: document.getElementById("heatmap-peak-kwh"),
    heatmapNowKwh: document.getElementById("heatmap-now-kwh"),
    heatmapActiveWing: document.getElementById("heatmap-active-wing"),
    heatmapWingTabs: document.getElementById("heatmap-wing-tabs"),
    heatmapStatAvg: document.getElementById("heatmap-stat-avg"),
    heatmapStatPeak: document.getElementById("heatmap-stat-peak"),
    heatmapStatSaved: document.getElementById("heatmap-stat-saved"),
    heatmapLiveClock: document.getElementById("heatmap-live-clock"),
    heatmapTooltip: document.getElementById("heatmap-tooltip"),
    heatmapTipWing: document.getElementById("heatmap-tip-wing"),
    heatmapTipVal: document.getElementById("heatmap-tip-val"),
    heatmapTipTime: document.getElementById("heatmap-tip-time"),
    heatmapStatus: document.getElementById("heatmap-status"),
    toast: document.getElementById("toast"),
    accessPortal: document.getElementById("access-portal"),
    studentAccessPane: document.getElementById("student-access-pane"),
    adminAccessPane: document.getElementById("admin-access-pane"),
    accessRoleButtons: Array.from(document.querySelectorAll("[data-role-tab]")),
    studentIdSelect: document.getElementById("student-id-select"),
    studentBiometricBtn: document.getElementById("student-biometric-btn"),
    studentSsoBtn: document.getElementById("student-sso-btn"),
    adminUsername: document.getElementById("admin-username"),
    adminPassword: document.getElementById("admin-password"),
    adminLoginBtn: document.getElementById("admin-login-btn"),
    portalStatus: document.getElementById("portal-status"),
    onboardModal: document.getElementById("onboard-modal"),
    onboardStudy: document.getElementById("onboard-study"),
    onboardLaundry: document.getElementById("onboard-laundry"),
    onboardDevices: document.getElementById("onboard-devices"),
    onboardSaveBtn: document.getElementById("onboard-save-btn"),
    studentPanel: document.getElementById("student-panel"),
    adminPanel: document.getElementById("admin-panel"),
    studentAuraOrb: document.getElementById("student-aura-orb"),
    studentUserLabel: document.getElementById("student-user-label"),
    studentQuotaLeft: document.getElementById("student-quota-left"),
    studentQuotaUnit: document.getElementById("student-quota-unit"),
    studentPrediction4h: document.getElementById("student-prediction-4h"),
    studentMarketList: document.getElementById("student-market-list"),
    studentActivityLog: document.getElementById("student-activity-log"),
    adminHeat: document.getElementById("admin-heat"),
    adminLogic: document.getElementById("admin-logic"),
    adminUserLabel: document.getElementById("admin-user-label"),
    globalNudgeMessage: document.getElementById("global-nudge-message"),
    globalNudgeBtn: document.getElementById("global-nudge-btn"),
    analyticsBudgetUse: document.getElementById("analytics-budget-use"),
    analyticsBudgetDetail: document.getElementById("analytics-budget-detail"),
    analyticsOverrun: document.getElementById("analytics-overrun"),
    analyticsTemp: document.getElementById("analytics-temp"),
    analyticsNudges: document.getElementById("analytics-nudges"),
    analyticsTopWing: document.getElementById("analytics-top-wing"),
    analyticsGlobalNudge: document.getElementById("analytics-global-nudge"),
    aiGhost: document.getElementById("ai-ghost"),
    aiGhostMsg: document.getElementById("ai-ghost-msg"),
    toastHead: null
  };
  el.toastHead = el.toast ? el.toast.querySelector(".toast-head") : null;
  const chartState = {
    scopeKey: "campus",
    windowKey: "today",
    actualLoadHistory: [],
    heatmap: {
      scopeKey: "campus",
      dayKey: "",
      hourlyKwh: Array(24).fill(0),
      initialized: false,
      lastTodayKwh: null,
      lastUpdateMs: 0
    }
  };
  const toastState = {
    queue: [],
    pauseUntilMs: 0
  };
  const wingFilterState = {
    key: "",
    label: "Campus"
  };
  const forecastWindowState = {
    key: "today"
  };
  const renderCache = {
    snapshot: null,
    state: null,
    wings: [],
    nudges: [],
    onAcceptNudge: () => false,
    onSpend: null
  };
  const studentActivityFeed = [];
  let activeRole = "none";
  let ghostDockRaf = 0;
  let ghostPinnedToToast = false;
  const ghostToastSlot = {
    active: false,
    right: 16,
    bottom: 16,
    width: null,
    untilMs: 0
  };

  function setGhostDefaultDock(edgePad = 16) {
    if (!el.aiGhost) return;
    el.aiGhost.style.left = "";
    el.aiGhost.style.right = `${edgePad}px`;
    el.aiGhost.style.bottom = `${edgePad}px`;
    el.aiGhost.style.width = "";
  }

  function captureToastSlot() {
    if (!el.toast) return;
    const toastRect = el.toast.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 720;
    ghostToastSlot.right = Math.max(16, viewportW - toastRect.right);
    ghostToastSlot.bottom = Math.max(16, viewportH - toastRect.bottom);
    ghostToastSlot.width = Math.max(250, Math.round(toastRect.width || 0));
  }

  function dockGhostNearToast() {
    if (!el.aiGhost) return;
    const ghostOpen = el.aiGhost.style.display === "block";
    const toastOpen = el.toast && el.toast.style.display === "block";
    const edgePad = 16;
    const gap = 14;
    const toastSlotActive = ghostToastSlot.active && Date.now() < Number(ghostToastSlot.untilMs || 0);

    if (!ghostOpen) {
      setGhostDefaultDock(edgePad);
      return;
    }

    if (!toastOpen && toastSlotActive) {
      const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
      const width = Number(ghostToastSlot.width || 320);
      const maxWidth = Math.max(250, viewportW - edgePad * 2);
      el.aiGhost.style.left = "";
      el.aiGhost.style.right = `${ghostToastSlot.right}px`;
      el.aiGhost.style.bottom = `${ghostToastSlot.bottom}px`;
      el.aiGhost.style.width = `${Math.min(width, maxWidth)}px`;
      return;
    }

    if (!toastOpen || !el.toast) {
      setGhostDefaultDock(edgePad);
      return;
    }

    const toastRect = el.toast.getBoundingClientRect();
    const ghostRect = el.aiGhost.getBoundingClientRect();
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 720;

    const canPlaceLeft = toastRect.left - gap - ghostRect.width >= edgePad;
    if (canPlaceLeft) {
      const right = Math.max(edgePad, viewportW - (toastRect.left - gap));
      const bottom = Math.max(edgePad, viewportH - toastRect.bottom);
      el.aiGhost.style.left = "";
      el.aiGhost.style.right = `${right}px`;
      el.aiGhost.style.bottom = `${bottom}px`;
      el.aiGhost.style.width = "";
      return;
    }

    const stackedBottom = Math.max(edgePad, viewportH - toastRect.top + gap);
    el.aiGhost.style.left = "";
    el.aiGhost.style.right = `${edgePad}px`;
    el.aiGhost.style.bottom = `${stackedBottom}px`;
    el.aiGhost.style.width = "";
  }

  function scheduleGhostDock() {
    if (ghostDockRaf) {
      cancelAnimationFrame(ghostDockRaf);
    }
    ghostDockRaf = requestAnimationFrame(() => {
      ghostDockRaf = 0;
      dockGhostNearToast();
    });
  }

  function setSidebarCollapsed(collapsed, options = {}) {
    if (!el.shell) return;
    const opts = options || {};
    const isCollapsed = Boolean(collapsed);
    el.shell.classList.toggle("sidebar-collapsed", isCollapsed);

    if (el.sidebarToggle) {
      const label = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
      el.sidebarToggle.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
      el.sidebarToggle.setAttribute("aria-label", label);
      el.sidebarToggle.setAttribute("title", label);
    }

    if (opts.persist !== false) {
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, isCollapsed ? "1" : "0");
      } catch (_error) {
        // Ignore persistence issues (private mode / blocked storage).
      }
    }
  }

  function restoreSidebarCollapsed() {
    let stored = "";
    try {
      stored = String(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) || "");
    } catch (_error) {
      stored = "";
    }
    setSidebarCollapsed(stored === "1", { persist: false });
  }

  function updateClock() {
    const now = new Date();
    const timeText = now.toLocaleTimeString("en-US", { hour12: false });
    if (el.clock) {
      el.clock.textContent = timeText;
    }
    if (el.heatmapLiveClock) {
      el.heatmapLiveClock.textContent = timeText;
    }
  }

  function dayKey(date) {
    const now = date instanceof Date ? date : new Date();
    return now.toISOString().slice(0, 10);
  }

  function campusLoadNow(wings) {
    const list = Array.isArray(wings) ? wings : [];
    if (!list.length) return 0;
    return list.reduce((sum, wing) => sum + Number(wing.loadNow || wing.usage || 0), 0) / 10;
  }

  function setWingFilter(wingName) {
    const key = normalizeWingKey(wingName);
    wingFilterState.key = key;
    wingFilterState.label = key ? String(wingName || "").trim() || "Selected Wing" : "Campus";
  }

  function buildWingScope(snapshot, state, wings) {
    const snap = snapshot || {};
    const runtime = state || {};
    const wingList = Array.isArray(wings) ? wings : [];
    const selectedKey = wingFilterState.key;

    if (!selectedKey) {
      return {
        key: "campus",
        label: "Campus",
        selectedWing: null,
        snapshot: snap,
        state: runtime,
        wings: wingList
      };
    }

    const selectedWing = wingList.find(wing => normalizeWingKey(wing && wing.name) === selectedKey);
    if (!selectedWing) {
      return {
        key: "campus",
        label: "Campus",
        selectedWing: null,
        snapshot: snap,
        state: runtime,
        wings: wingList
      };
    }

    const demand = getWingDemandShare(wingList, selectedWing.name);
    const share = clamp(Number(demand.share || 0.2), 0.06, 0.72);
    const quotaKwh = inferCampusQuotaKwh(snap, runtime);
    const campusTodayKwh = Math.max(0, Number(runtime.todayKwh || 0));
    const campusProjectedKwh = Math.max(campusTodayKwh, Number(snap.projectedTodayKwh || campusTodayKwh));

    const projectedTodayKwh = campusProjectedKwh * share;
    const todayKwh = campusTodayKwh * share;
    const quotaForWingKwh = quotaKwh * share;
    const overByKwh = Math.max(0, projectedTodayKwh - quotaForWingKwh);
    const remainingKwh = Math.max(0, quotaForWingKwh - projectedTodayKwh);
    const occupancyPct = Number.isFinite(Number(selectedWing.occupancyPct))
      ? clamp(Number(selectedWing.occupancyPct), 0, 1) * 100
      : Number(snap.occupancyPct || 0);
    const avgTempC = Number.isFinite(Number(selectedWing.tempC))
      ? Number(selectedWing.tempC)
      : Number(snap.avgTempC || 0);
    const wingForecast = Array.isArray(snap.forecast)
      ? snap.forecast.map(value => Math.max(0, Number(value || 0)) * share)
      : [];

    return {
      key: selectedKey,
      label: `${selectedWing.name} Wing`,
      selectedWing,
      snapshot: {
        ...snap,
        forecast: wingForecast,
        projectedTodayKwh,
        overByKwh,
        remainingKwh,
        budgetUsePct: (projectedTodayKwh / Math.max(1, quotaForWingKwh)) * 100,
        occupancyPct,
        avgTempC
      },
      state: {
        ...runtime,
        todayKwh
      },
      wings: [selectedWing]
    };
  }

  function filterNudgesByWingSelection(nudges) {
    const list = Array.isArray(nudges) ? nudges : [];
    if (activeRole === "student") {
      return list;
    }
    const selectedKey = wingFilterState.key;
    if (!selectedKey) return list;

    const scoped = list.filter(nudge => {
      const wingKey = nudgeWingKey(nudge);
      return !wingKey || wingKey === selectedKey;
    });

    if (scoped.length || !list.length) {
      return scoped;
    }

    // If the selected wing has no live nudge, show campus nudges instead of an empty panel.
    return list;
  }

  function buildHeatmapBaseline(snapshot, wings) {
    const rawForecast = Array.isArray(snapshot && snapshot.forecast) ? snapshot.forecast.slice(0, 24) : [];
    const forecast = rawForecast
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0);
    if (forecast.length >= 24) {
      return forecast.slice(0, 24).map(value => Math.max(14, value));
    }

    const liveLoad = Math.max(90, campusLoadNow(wings));
    const occupancyRatio = clamp(Number((snapshot && snapshot.occupancyPct) || 70) / 100, 0.35, 0.95);
    const avgTemp = Number((snapshot && snapshot.avgTempC) || 28);
    const weatherPressure = 1 + Math.max(0, avgTemp - 26) * 0.024;
    return Array.from({ length: 24 }, (_, hour) => {
      const circadian = 0.82 + 0.24 * Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2);
      const schedule = hour >= 9 && hour <= 17 ? 0.89 : 1.08;
      const occupancyLift = 0.88 + occupancyRatio * 0.24;
      return Math.max(16, liveLoad * circadian * schedule * weatherPressure * occupancyLift);
    });
  }

  function scaleSeriesSegment(series, start, end, targetTotal, minScale, maxScale) {
    const from = Math.max(0, Number(start || 0));
    const to = Math.min(series.length, Math.max(from, Number(end || 0)));
    const target = Math.max(0, Number(targetTotal || 0));
    if (to <= from) return;

    const currentTotal = series
      .slice(from, to)
      .reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    if (currentTotal <= 0 || target <= 0) return;

    const factor = clamp(target / currentTotal, Number(minScale || 0.5), Number(maxScale || 1.8));
    for (let hour = from; hour < to; hour += 1) {
      series[hour] = Math.max(8, Number(series[hour] || 0) * factor);
    }
  }

  function seedHeatmapSeries(snapshot, state, wings, currentHour) {
    const baseline = buildHeatmapBaseline(snapshot, wings);
    const seeded = baseline.map((base, hour) => {
      const wave = 0.94 + 0.08 * Math.sin((hour + 1) * 0.91 + currentHour * 0.13);
      const drift = 0.98 + 0.04 * Math.cos((hour + 2) * 1.31);
      return Math.max(10, base * wave * drift);
    });

    const todayKwh = Math.max(0, Number((state && state.todayKwh) || 0));
    const projectedKwh = Math.max(todayKwh, Number((snapshot && snapshot.projectedTodayKwh) || todayKwh));
    const observedEnd = Math.min(24, Math.max(1, Number(currentHour || 0) + 1));
    scaleSeriesSegment(seeded, 0, observedEnd, todayKwh, 0.55, 1.72);
    if (observedEnd < 24) {
      scaleSeriesSegment(seeded, observedEnd, 24, Math.max(0, projectedKwh - todayKwh), 0.58, 1.68);
    }
    return seeded;
  }

  function renderPredictHourly(options) {
    if (!el.predictHourly) return;
    const now = new Date().getHours();
    const nextHours = Array.from({ length: 6 }, (_, index) => {
      const hour = (now + index + 1) % 24;
      const base = Number(HOURLY_BASE[hour] || 0);
      const projected = Math.round(base * (1 + 0.43 * (1 - index / 6)));
      return { hour, projected };
    });
    const maxProjected = Math.max(...nextHours.map(item => item.projected), 1);

    el.predictHourly.innerHTML = "";
    nextHours.forEach(item => {
      const pct = item.projected / maxProjected;
      const color = item.projected > 300 ? "var(--red)" : item.projected > 200 ? "var(--amber)" : "var(--green)";
      el.predictHourly.innerHTML += `
        <div class="predict-hour-col">
          <div class="predict-hour-bar-wrap">
            <div class="predict-hour-bar" style="height:${Math.round(pct * 48)}px;background:${color}"></div>
          </div>
          <div class="predict-hour-label">${String(item.hour).padStart(2, "0")}:00</div>
          <div class="predict-hour-number">${item.projected}</div>
        </div>`;
    });
  }

  function hideHeatmapTooltip() {
    if (el.heatmapTooltip) {
      el.heatmapTooltip.style.opacity = "0";
    }
  }

  function moveHeatmapTooltip(event) {
    if (!el.heatmapTooltip || !event) return;
    const margin = 8;
    const pointerX = Number(event.clientX || 0);
    const pointerY = Number(event.clientY || 0);
    const rect = el.heatmapTooltip.getBoundingClientRect();
    const maxX = Math.max(margin, (window.innerWidth || 0) - rect.width - margin);
    const maxY = Math.max(margin, (window.innerHeight || 0) - rect.height - margin);
    const left = clamp(pointerX + 14, margin, maxX);
    const top = clamp(pointerY - rect.height - 10, margin, maxY);
    el.heatmapTooltip.style.left = `${left}px`;
    el.heatmapTooltip.style.top = `${top}px`;
  }

  function showHeatmapTooltip(event, details) {
    if (!el.heatmapTooltip) return;
    const payload = details || {};
    const wingLabel = payload.wingLabel || "Campus";
    const dayLabel = payload.dayLabel || "--";
    const value = Math.max(0, Number(payload.value || 0));
    const hour = clamp(Number(payload.hour || 0), 0, 23);
    const color = payload.color || "var(--cyan)";

    if (el.heatmapTipWing) {
      el.heatmapTipWing.textContent = `${wingLabel} · ${dayLabel}`;
    }
    if (el.heatmapTipVal) {
      el.heatmapTipVal.textContent = `${Math.round(value)}`;
      el.heatmapTipVal.style.color = color;
    }
    if (el.heatmapTipTime) {
      el.heatmapTipTime.textContent = `${String(hour).padStart(2, "0")}:00 - ${String((hour + 1) % 24).padStart(2, "0")}:00`;
    }

    el.heatmapTooltip.style.opacity = "1";
    moveHeatmapTooltip(event);
  }

  function renderHeatmapWingTabs(options) {
    if (!el.heatmapWingTabs) return;
    const opts = options || {};
    const allWings = Array.isArray(opts.wings) ? opts.wings : [];
    const selectedKey = normalizeWingKey(opts.activeWingKey || wingFilterState.key);
    const tabs = [{ key: "", name: "Campus", label: "Campus", color: "var(--cyan)" }];

    allWings.forEach(wing => {
      const name = cleanText(wing && wing.name);
      if (!name) return;
      const key = normalizeWingKey(name);
      if (!key || tabs.some(tab => tab.key === key)) return;
      tabs.push({
        key,
        name,
        label: name.replace(/\s+wing$/i, ""),
        color: wingColorForName(name)
      });
    });

    const hasSelection = tabs.some(tab => tab.key === selectedKey);
    const activeKey = hasSelection ? selectedKey : "";
    el.heatmapWingTabs.innerHTML = tabs.map(tab => `
      <button class="heatmap-wing-tab${tab.key === activeKey ? " active" : ""}" type="button" data-wing-key="${tab.key}" data-wing-name="${tab.name}">
        <span class="heatmap-wing-tab-dot" style="background:${tab.color}"></span>${tab.label}
      </button>
    `).join("");

    el.heatmapWingTabs.querySelectorAll(".heatmap-wing-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const nextKey = normalizeWingKey(tab.dataset.wingKey);
        const currentKey = normalizeWingKey(wingFilterState.key);
        if (nextKey === currentKey) return;
        if (!nextKey) {
          setWingFilter("");
        } else {
          setWingFilter(tab.dataset.wingName || tab.textContent || nextKey);
        }
        rerenderWingScopedSections();
      });
    });
  }

  function buildWeeklyHeatmap(values, todayRow, currentHour, seed) {
    return HEATMAP_DAY_LABELS.map((_, rowIndex) => values.map((baseValue, hour) => {
      const base = Math.max(5, Number(baseValue || 0));
      if (rowIndex === todayRow) {
        const futureLift = hour > currentHour
          ? 1 + 0.05 * Math.sin((hour + 1) * 0.71 + seed * 0.13)
          : 1;
        return Math.max(5, Math.round(base * futureLift));
      }

      const dayOffset = rowIndex - todayRow;
      const dayWave = 0.93 + 0.1 * Math.sin((rowIndex + 1) * 1.17 + seed * 0.09);
      const weekendFactor = rowIndex >= 5 ? 0.92 : 1.04;
      const hourWave = 0.9 + 0.13 * Math.sin((hour + 1) * 0.49 + rowIndex * 0.62 + seed * 0.07);
      const drift = 1 + dayOffset * 0.018;
      const jitter = 1 + seededWave(seed, rowIndex, hour) * 0.085;
      return Math.max(5, Math.round(base * dayWave * weekendFactor * hourWave * drift * jitter));
    }));
  }

  function renderHeatmap(patternOrWingFilter, options) {
    if (!el.heatmap) return;
    const opts = options || {};
    const now = opts.now instanceof Date ? opts.now : new Date();
    const currentHour = Number.isInteger(opts.currentHour) ? clamp(opts.currentHour, 0, 23) : now.getHours();
    const activeWingLabel = cleanText(opts.activeWingLabel) || "Campus";
    const activeWingKey = normalizeWingKey(opts.activeWingKey || wingFilterState.key);
    const quotaKwh = Math.max(0, Number(opts.quotaKwh || 0));

    const inputSeries = Array.isArray(patternOrWingFilter)
      ? patternOrWingFilter
      : HOURLY_BASE;
    const values = inputSeries
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0)
      .slice(0, 24);

    if (!values.length) return;
    while (values.length < 24) {
      values.push(values.length ? values[values.length - 1] : 0);
    }

    const todayRow = heatmapDayIndex(now);
    const seed = normalizeWingKey(activeWingKey || activeWingLabel)
      .split("")
      .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
    const weekly = buildWeeklyHeatmap(values, todayRow, currentHour, seed);
    const allValues = weekly.flat();
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues, minValue + 1);

    let peakValue = -Infinity;
    let peakRow = 0;
    let peakHour = 0;
    weekly.forEach((row, rowIndex) => {
      row.forEach((value, hour) => {
        if (value > peakValue) {
          peakValue = value;
          peakRow = rowIndex;
          peakHour = hour;
        }
      });
    });

    const nowValue = Number(weekly[todayRow] && weekly[todayRow][currentHour]) || 0;
    const avgPerHour = allValues.length
      ? allValues.reduce((sum, value) => sum + Number(value || 0), 0) / allValues.length
      : 0;
    const savedKwh = quotaKwh > 0
      ? Math.max(0, Math.round((quotaKwh / 24 - avgPerHour) * 24))
      : Math.max(0, Math.round((Math.max(1, peakValue) - avgPerHour) * 2));

    if (el.heatmapActiveWing) {
      el.heatmapActiveWing.textContent = activeWingLabel;
    }
    if (el.heatmapNowKwh) {
      el.heatmapNowKwh.textContent = fmt(nowValue);
    }
    if (el.heatmapPeakTime) {
      el.heatmapPeakTime.textContent = `${String(peakHour).padStart(2, "0")}:00`;
    }
    if (el.heatmapPeakKwh) {
      el.heatmapPeakKwh.textContent = fmt(peakValue);
    }
    if (el.heatmapPeak && (!el.heatmapPeakTime || !el.heatmapPeakKwh)) {
      el.heatmapPeak.textContent = `Peak ${String(peakHour).padStart(2, "0")}:00 (${fmt(peakValue)} kWh)`;
    }
    if (el.heatmapStatAvg) {
      el.heatmapStatAvg.textContent = fmt(avgPerHour);
    }
    if (el.heatmapStatPeak) {
      el.heatmapStatPeak.textContent = fmt(peakValue);
    }
    if (el.heatmapStatSaved) {
      el.heatmapStatSaved.textContent = fmt(savedKwh);
    }

    renderHeatmapWingTabs({
      activeWingKey,
      wings: Array.isArray(opts.wings) ? opts.wings : []
    });

    hideHeatmapTooltip();
    el.heatmap.innerHTML = "";
    weekly.forEach((row, rowIndex) => {
      const rowEl = document.createElement("div");
      rowEl.className = "heatmap-row";

      const rowLabel = document.createElement("div");
      rowLabel.className = "heatmap-row-label";
      rowLabel.textContent = HEATMAP_DAY_LABELS[rowIndex];
      if (rowIndex === todayRow) {
        rowLabel.style.color = wingColorForName(activeWingLabel);
        rowLabel.style.fontWeight = "600";
      }
      rowEl.appendChild(rowLabel);

      const rowCells = document.createElement("div");
      rowCells.className = "heatmap-row-cells";
      row.forEach((value, hour) => {
        const cell = document.createElement("div");
        const color = heatmapGradientColor(value, minValue, maxValue);
        const isFuture = rowIndex === todayRow && hour > currentHour;
        cell.className = `heatmap-cell${isFuture ? " future" : ""}`;
        cell.style.background = color;
        cell.style.color = color;
        cell.style.animationDelay = `${(rowIndex * 24 + hour) * 4}ms`;
        cell.title = `${HEATMAP_DAY_LABELS[rowIndex]} ${String(hour).padStart(2, "0")}:00 - ${fmt(value)} kWh`;

        if (rowIndex === peakRow && hour === peakHour) {
          cell.classList.add("peak-glow");
          cell.style.boxShadow = `0 0 10px ${color}`;
        }

        cell.addEventListener("mouseenter", event => {
          showHeatmapTooltip(event, {
            wingLabel: activeWingLabel,
            dayLabel: HEATMAP_DAY_LABELS[rowIndex],
            value,
            hour,
            color
          });
        });
        cell.addEventListener("mousemove", moveHeatmapTooltip);
        cell.addEventListener("mouseleave", hideHeatmapTooltip);
        rowCells.appendChild(cell);
      });

      rowEl.appendChild(rowCells);
      el.heatmap.appendChild(rowEl);
    });

    if (el.heatmapStatus) {
      const statusText = opts.statusText || `${activeWingLabel} | Now ${fmt(nowValue)} kWh | Peak ${String(peakHour).padStart(2, "0")}:00 (${fmt(peakValue)} kWh)`;
      el.heatmapStatus.textContent = statusText;
    }
  }

  function updateLiveHeatmap(snapshot, state, wings, scope, allWings) {
    const snap = snapshot || {};
    const runtime = state || {};
    const wingState = Array.isArray(wings) ? wings : [];
    const wingTabsSource = Array.isArray(allWings) && allWings.length ? allWings : wingState;
    const now = new Date();
    const currentHour = now.getHours();
    const nowMs = now.getTime();
    const heatmap = chartState.heatmap;
    const key = dayKey(now);
    const scopeKey = scope && scope.key ? scope.key : "campus";
    const scopeLabel = scope && scope.key && scope.key !== "campus"
      ? (scope.label || "Selected Wing")
      : "";

    if (heatmap.dayKey !== key || heatmap.scopeKey !== scopeKey) {
      heatmap.scopeKey = scopeKey;
      heatmap.dayKey = key;
      heatmap.hourlyKwh = Array(24).fill(0);
      heatmap.initialized = false;
      heatmap.lastTodayKwh = null;
      heatmap.lastUpdateMs = 0;
    }

    if (!heatmap.initialized) {
      heatmap.hourlyKwh = seedHeatmapSeries(snap, runtime, wingState, currentHour);
      heatmap.initialized = true;
    }

    const liveLoad = Math.max(20, campusLoadNow(wingState));
    const todayKwh = Math.max(0, Number(runtime.todayKwh || 0));
    let measuredHourKwh = liveLoad;

    if (Number.isFinite(Number(heatmap.lastTodayKwh)) && heatmap.lastUpdateMs > 0 && todayKwh >= Number(heatmap.lastTodayKwh)) {
      const elapsedHours = Math.max((nowMs - heatmap.lastUpdateMs) / 3600000, 1 / 300);
      const derivative = (todayKwh - Number(heatmap.lastTodayKwh)) / elapsedHours;
      if (Number.isFinite(derivative) && derivative > 0) {
        const boundedDerivative = clamp(derivative, liveLoad * 0.45, liveLoad * 2.2);
        measuredHourKwh = liveLoad * 0.58 + boundedDerivative * 0.42;
      }
    }

    const currentHourExisting = Math.max(0, Number(heatmap.hourlyKwh[currentHour] || measuredHourKwh));
    heatmap.hourlyKwh[currentHour] = currentHourExisting * 0.64 + measuredHourKwh * 0.36;

    const baseline = buildHeatmapBaseline(snap, wingState);
    for (let hour = currentHour + 1; hour < 24; hour += 1) {
      const baseHourKwh = Math.max(12, Number(baseline[hour] || measuredHourKwh));
      const existing = Math.max(0, Number(heatmap.hourlyKwh[hour] || baseHourKwh));
      heatmap.hourlyKwh[hour] = existing * 0.2 + baseHourKwh * 0.8;
    }

    const projectedKwh = Math.max(todayKwh, Number(snap.projectedTodayKwh || todayKwh));
    const remainingProjected = Math.max(0, projectedKwh - todayKwh);
    if (currentHour < 23) {
      const futureTotal = heatmap.hourlyKwh
        .slice(currentHour + 1)
        .reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
      if (futureTotal > 0 && remainingProjected > 0) {
        const futureScale = clamp(remainingProjected / futureTotal, 0.58, 1.62);
        for (let hour = currentHour + 1; hour < 24; hour += 1) {
          heatmap.hourlyKwh[hour] = Math.max(8, heatmap.hourlyKwh[hour] * futureScale);
        }
      }
    }

    heatmap.lastTodayKwh = todayKwh;
    heatmap.lastUpdateMs = nowMs;

    const values = heatmap.hourlyKwh.map(value => Math.max(6, Number(value || 0)));
    const peakValue = Math.max(...values);
    const peakHour = values.indexOf(peakValue);
    const currentValue = values[currentHour] || 0;
    const statusPrefix = scopeLabel ? `${scopeLabel} | ` : "Campus | ";
    const statusText = `${statusPrefix}Now ${currentValue.toFixed(0)} kWh | Peak ${String(peakHour).padStart(2, "0")}:00 (${peakValue.toFixed(0)} kWh)`;
    const activeWingLabel = scope && scope.key && scope.key !== "campus"
      ? (scope.label || "Selected Wing")
      : "Campus";
    renderHeatmap(values, {
      currentHour,
      futureFrom: currentHour + 1,
      statusText,
      activeWingKey: scopeKey === "campus" ? "" : scopeKey,
      activeWingLabel,
      wings: wingTabsSource,
      quotaKwh: inferCampusQuotaKwh(snap, runtime),
      now
    });
  }

  function toNumberSeries(values, limit = 12) {
    if (!Array.isArray(values)) return [];
    return values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
      .slice(0, limit);
  }

  function parseForecastWindowKey(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    if (key.includes("today")) return "today";
    if (key.includes("week")) return "week";
    if (key.includes("month")) return "month";
    return "";
  }

  function normalizeForecastWindowKey(value) {
    return parseForecastWindowKey(value) || "today";
  }

  function buildWindowChartSeries(snapshot, windowKey) {
    const hourlyForecast = toNumberSeries(snapshot && snapshot.forecast, 24);
    if (!hourlyForecast.length) {
      return { predicted: [], actual: [] };
    }

    if (windowKey === "week") {
      const baseLoad = hourlyForecast.reduce((sum, value) => sum + value, 0) / hourlyForecast.length;
      const dayMultipliers = [0.95, 0.98, 1.01, 1.03, 1.06, 1.11, 1.04];
      const predicted = dayMultipliers.map((multiplier, index) => {
        const rhythm = 1 + Math.sin((index + 1) * 0.93) * 0.028;
        return Math.max(8, baseLoad * multiplier * rhythm);
      });
      const actual = predicted.map((value, index) => {
        const drift = 0.95 + Math.cos((index + 1) * 0.87) * 0.048;
        return Math.max(8, value * drift);
      });
      return { predicted, actual };
    }

    if (windowKey === "month") {
      const baseLoad = hourlyForecast.reduce((sum, value) => sum + value, 0) / hourlyForecast.length;
      const predicted = Array.from({ length: 30 }, (_, index) => {
        const weekday = index % 7;
        const weekendLift = weekday >= 5 ? 1.08 : 0.97;
        const weeklyWave = 1 + Math.sin(((index + 1) / 7) * Math.PI * 2) * 0.055;
        const trend = 1 + (index - 14.5) * 0.0019;
        return Math.max(8, baseLoad * weekendLift * weeklyWave * trend);
      });
      const actual = predicted.map((value, index) => {
        const drift = 0.94 + Math.cos((index + 2) * 0.51) * 0.044;
        return Math.max(8, value * drift);
      });
      return { predicted, actual };
    }

    return {
      predicted: hourlyForecast.slice(0, 12),
      actual: []
    };
  }

  function buildPolylinePoints(series, toY, xStart = 0, xEnd = 100) {
    if (!Array.isArray(series) || !series.length) return "";
    if (series.length === 1) {
      const y = toY(series[0]).toFixed(2);
      return `${xStart.toFixed(2)},${y} ${xEnd.toFixed(2)},${y}`;
    }
    const step = (xEnd - xStart) / (series.length - 1);
    return series
      .map((value, index) => {
        const x = xStart + step * index;
        const y = toY(value);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  function animateLineDraw(lineEl, durationMs = 760) {
    if (!lineEl || typeof lineEl.getTotalLength !== "function") return;
    const totalLength = Number(lineEl.getTotalLength());
    if (!Number.isFinite(totalLength) || totalLength <= 1) return;

    lineEl.style.transition = "none";
    lineEl.style.strokeDasharray = `${totalLength}`;
    lineEl.style.strokeDashoffset = `${totalLength}`;
    lineEl.getBoundingClientRect();
    lineEl.style.transition = `stroke-dashoffset ${Math.max(280, Math.round(durationMs))}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    lineEl.style.strokeDashoffset = "0";
  }

  function renderForecastChart(snapshot, wings, scope) {
    if (!el.chartActualPath || !el.chartPredPath || !el.chartQuotaLine) return;
    const windowKey = normalizeForecastWindowKey(forecastWindowState.key);
    const seriesSet = buildWindowChartSeries(snapshot, windowKey);
    const predicted = seriesSet.predicted;
    if (!predicted.length) return;

    const scopeKey = scope && scope.key ? scope.key : "campus";
    if (chartState.scopeKey !== scopeKey || chartState.windowKey !== windowKey) {
      chartState.scopeKey = scopeKey;
      chartState.windowKey = windowKey;
      chartState.actualLoadHistory = [];
    }
    let actual = [];

    if (windowKey === "today") {
      const wingList = Array.isArray(wings) ? wings : [];
      const liveActual = wingList.length
        ? wingList.reduce((sum, wing) => sum + Number(wing.loadNow || wing.usage || 0), 0) / 10
        : null;

      if (Number.isFinite(liveActual) && liveActual > 0) {
        chartState.actualLoadHistory.push(liveActual);
        if (chartState.actualLoadHistory.length > predicted.length) {
          chartState.actualLoadHistory.splice(0, chartState.actualLoadHistory.length - predicted.length);
        }
      }

      actual = chartState.actualLoadHistory.slice();
      while (actual.length < predicted.length) {
        const seedIndex = Math.max(0, predicted.length - actual.length - 1);
        const seedValue = predicted[seedIndex] * 0.96;
        actual.unshift(seedValue);
      }
    } else {
      actual = Array.isArray(seriesSet.actual) && seriesSet.actual.length
        ? seriesSet.actual.slice(0, predicted.length)
        : predicted.map(value => value * 0.95);
    }

    const predictedAvg = predicted.reduce((sum, value) => sum + value, 0) / predicted.length;
    const quotaLevel = snapshot && Number(snapshot.overByKwh || 0) > 0
      ? predictedAvg * 0.9
      : predictedAvg * 1.03;

    const chartValues = [...actual, ...predicted, quotaLevel];
    const minValue = Math.min(...chartValues) * 0.93;
    const maxValue = Math.max(...chartValues) * 1.08;
    const range = Math.max(1, maxValue - minValue);
    const top = 8;
    const bottom = 94;
    const toY = value => bottom - ((value - minValue) / range) * (bottom - top);

    const nextActualPoints = buildPolylinePoints(actual, toY);
    const prevActualPoints = String(el.chartActualPath.getAttribute("points") || "");
    el.chartActualPath.setAttribute("points", nextActualPoints);
    if (nextActualPoints && nextActualPoints !== prevActualPoints) {
      animateLineDraw(el.chartActualPath, 760);
    }

    el.chartPredPath.setAttribute("points", buildPolylinePoints(predicted, toY));
    const quotaY = toY(quotaLevel).toFixed(2);
    el.chartQuotaLine.setAttribute("y1", quotaY);
    el.chartQuotaLine.setAttribute("y2", quotaY);
  }

  function renderStats(snapshot, state, wings) {
    const snap = snapshot || {};
    const runtime = state || {};
    const wingState = Array.isArray(wings) ? wings : [];
    renderCache.snapshot = snap;
    renderCache.state = runtime;
    renderCache.wings = wingState;

    el.totalKwh.textContent = fmt(runtime.todayKwh);
    el.totalDelta.textContent = `down ${(Math.max(4, 14 - runtime.acceptedTrades)).toFixed(1)}% vs yesterday`;
    el.co2.textContent = fmt(runtime.co2SavedKg);
    el.co2Delta.textContent = `up ${(7 + runtime.acceptedTrades * 0.8).toFixed(1)}% above target`;
    el.activeRooms.textContent = String(snap.activeRooms);
    el.occupancy.textContent = `${Number(snap.occupancyPct || 0).toFixed(1)}% occupancy`;
    el.overQuota.textContent = String(Array.isArray(snap.overQuotaWings) ? snap.overQuotaWings.length : 0);
    el.nudgesSent.textContent = `up Nudges sent: ${runtime.nudgesSent}`;

    const scoped = buildWingScope(snap, runtime, wingState);
    const scopedSnapshot = scoped.snapshot || {};
    const scopedState = scoped.state || {};
    const scopedLabel = scoped && scoped.key && scoped.key !== "campus"
      ? scoped.label || "Selected Wing"
      : "";

    const projectedKwh = Math.max(0, Number(scopedSnapshot.projectedTodayKwh || 0));
    const occupancyPct = Number(scopedSnapshot.occupancyPct || 0);
    const avgTempC = Number(scopedSnapshot.avgTempC || 0);
    const quotaKwh = inferCampusQuotaKwh(scopedSnapshot, scopedState);
    const overByKwh = Math.max(0, projectedKwh - quotaKwh);
    const remainingKwh = Math.max(0, quotaKwh - projectedKwh);
    const budgetUsePct = (projectedKwh / Math.max(1, quotaKwh)) * 100;

    const stressCapKwh = Math.max(quotaKwh * 1.22, projectedKwh * 1.08, 1);
    const quotaRatio = projectedKwh / Math.max(1, quotaKwh);
    const warnRatio = 0.92;
    const highRiskRatio = 1.12;
    const isOverQuota = overByKwh > 0;
    const isHighRisk = quotaRatio >= highRiskRatio;
    const isWarn = quotaRatio >= warnRatio;
    const fillPct = Math.max(2, Math.min(100, (projectedKwh / stressCapKwh) * 100));
    const quotaPct = Math.max(1, Math.min(99, (quotaKwh / stressCapKwh) * 100));

    el.predictFill.style.width = `${fillPct.toFixed(1)}%`;
    el.predictFill.className = `predict-fill ${isHighRisk ? "over" : isWarn ? "warn" : "safe"}`;

    if (el.predictQuotaLine) {
      el.predictQuotaLine.style.left = `${quotaPct.toFixed(1)}%`;
    }
    if (el.predictQuotaLabel) {
      el.predictQuotaLabel.textContent = "Green Quota";
    }
    if (el.predictMinLabel) {
      el.predictMinLabel.textContent = "0 kWh";
    }
    if (el.predictMidLabel) {
      const quotaLabel = scopedLabel ? `${scopedLabel} Quota` : "Green Quota";
      el.predictMidLabel.textContent = `${quotaLabel}: ${fmt(quotaKwh)} kWh`;
    }
    if (el.predictMaxLabel) {
      el.predictMaxLabel.textContent = `Stress Cap: ${fmt(stressCapKwh)} kWh`;
    }

    const targetPct = quotaRatio * 100;
    if (isHighRisk) {
      el.predictProgressLabel.textContent = `${targetPct.toFixed(1)}% of quota | +${fmt(overByKwh)} kWh risk`;
      el.predictProgressLabel.style.color = "var(--red)";
    } else if (isOverQuota) {
      el.predictProgressLabel.textContent = `${targetPct.toFixed(1)}% of quota | +${fmt(overByKwh)} kWh above quota`;
      el.predictProgressLabel.style.color = "var(--amber)";
    } else {
      el.predictProgressLabel.textContent = `${targetPct.toFixed(1)}% of quota | ${fmt(remainingKwh)} kWh buffer`;
      el.predictProgressLabel.style.color = isWarn ? "var(--amber)" : "var(--green)";
    }

    el.predictUsed.textContent = fmt(projectedKwh);
    if (isHighRisk) {
      el.predictOver.textContent = `+${fmt(overByKwh)} kWh`;
      el.predictOver.style.color = "var(--red)";
    } else if (isOverQuota) {
      el.predictOver.textContent = `+${fmt(overByKwh)} kWh`;
      el.predictOver.style.color = "var(--amber)";
    } else {
      el.predictOver.textContent = `-${fmt(remainingKwh)} kWh`;
      el.predictOver.style.color = isWarn ? "var(--amber)" : "var(--green)";
    }
    el.predictTemp.textContent = `${avgTempC.toFixed(1)} C`;

    renderPredictHourly({ riskRatio: quotaRatio });

    const weatherPressurePct = (avgTempC - 24) * 3.1;
    const occupancyPressurePct = (occupancyPct - 70) * 0.26;
    const hourNow = new Date().getHours();
    const schedulePressurePct = hourNow >= 9 && hourNow <= 17 ? -7.5 : 5.5;
    const asSignedPct = value => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

    if (el.predictDriverWeather) {
      el.predictDriverWeather.textContent = `${asSignedPct(weatherPressurePct)} demand`;
      el.predictDriverWeather.style.color = weatherPressurePct >= 10 ? "var(--red)" : weatherPressurePct >= 3 ? "var(--amber)" : "var(--green)";
    }
    if (el.predictDriverOccupancy) {
      el.predictDriverOccupancy.textContent = `${asSignedPct(occupancyPressurePct)} demand`;
      el.predictDriverOccupancy.style.color = occupancyPressurePct >= 7 ? "var(--red)" : occupancyPressurePct >= 2 ? "var(--amber)" : "var(--green)";
    }
    if (el.predictDriverSchedule) {
      el.predictDriverSchedule.textContent = `${asSignedPct(schedulePressurePct)} demand`;
      el.predictDriverSchedule.style.color = schedulePressurePct > 4 ? "var(--amber)" : "var(--green)";
    }

    if (el.predictRiskNote) {
      if (isHighRisk) {
        el.predictRiskNote.className = "predict-risk over";
        el.predictRiskNote.textContent = `High breach probability: projected overrun of ${fmt(overByKwh)} kWh by day-end if no intervention is applied.`;
      } else if (isOverQuota) {
        el.predictRiskNote.className = "predict-risk warn";
        el.predictRiskNote.textContent = `Mild overrun detected: projected usage is ${fmt(overByKwh)} kWh above quota. Fast nudge actions should recover this drift.`;
      } else if (isWarn) {
        el.predictRiskNote.className = "predict-risk warn";
        el.predictRiskNote.textContent = `Buffer is narrowing: only ${fmt(remainingKwh)} kWh remains before hitting green quota.`;
      } else {
        el.predictRiskNote.className = "predict-risk safe";
        el.predictRiskNote.textContent = `Stable trajectory: ${fmt(remainingKwh)} kWh of quota buffer available under current weather and occupancy trends.`;
      }
    }

    if (isHighRisk) {
      el.predictBadge.textContent = "BREACH RISK HIGH";
      el.predictBadge.className = "card-badge red pulsing";
    } else if (isOverQuota) {
      el.predictBadge.textContent = "ABOVE QUOTA";
      el.predictBadge.className = "card-badge amber";
    } else if (isWarn) {
      el.predictBadge.textContent = "BUFFER NARROW";
      el.predictBadge.className = "card-badge amber";
    } else {
      el.predictBadge.textContent = "STABLE TRAJECTORY";
      el.predictBadge.className = "card-badge green";
    }

    renderForecastChart(scopedSnapshot, scoped.wings, scoped);
    updateLiveHeatmap(scopedSnapshot, scopedState, scoped.wings, scoped, renderCache.wings);
  }

  function syncNudgeCounterBadges(count) {
    const value = Math.max(0, Number(count || 0));
    if (el.sidebarNudgeCount) {
      el.sidebarNudgeCount.textContent = String(value);
      el.sidebarNudgeCount.classList.toggle("is-zero", value === 0);
    }
    if (el.notifNudgeCount) {
      el.notifNudgeCount.textContent = String(value);
      el.notifNudgeCount.classList.toggle("is-zero", value === 0);
    }
  }

  function renderNudges(nudges, onAcceptNudge) {
    renderCache.nudges = Array.isArray(nudges) ? nudges : [];
    renderCache.onAcceptNudge = typeof onAcceptNudge === "function" ? onAcceptNudge : () => false;
    const nudgeItems = filterNudgesByWingSelection(renderCache.nudges);
    const actionableNudgeCount = nudgeItems.filter(nudge => {
      const tone = String(nudge && (nudge.tone || nudge.type || "")).toLowerCase();
      return tone !== "ok";
    });
    el.nudgeList.innerHTML = "";
    if (!nudgeItems.length) {
      const studentWingLabel = (() => {
        if (!el.studentUserLabel) return "";
        const raw = String(el.studentUserLabel.textContent || "");
        const parts = raw.split("|");
        return parts.length > 1 ? parts[1].trim() : "";
      })();
      const scopeLabel = wingFilterState.key ? `${wingFilterState.label}` : "";
      const emptyHead = activeRole === "student"
        ? (studentWingLabel ? `No active nudges for ${studentWingLabel}` : "No active nudges for your wing right now")
        : (scopeLabel ? `No active nudges for ${scopeLabel}` : "No active nudges right now");
      const emptySub = activeRole === "student"
        ? "Your wing is stable for now. Wing-specific nudges will appear here when action is needed."
        : "AI is monitoring live telemetry. A new nudge will appear automatically when a trigger is detected.";
      const empty = document.createElement("div");
      empty.className = "nudge-empty";
      empty.innerHTML = `
        <div class="nudge-empty-head">${emptyHead}</div>
        <div class="nudge-empty-sub">${emptySub}</div>
      `;
      el.nudgeList.appendChild(empty);
      el.nudgeCount.textContent = "0";
      syncNudgeCounterBadges(0);
      return;
    }

    nudgeItems.forEach(nudge => {
      const item = document.createElement("div");
      item.className = `nudge ${nudge.tone}`;
      item.innerHTML = `
        <div class="nudge-icon">${nudge.tone === "urgent" ? "!" : nudge.tone === "warn" ? "~" : "+"}</div>
        <div class="nudge-content">
          <div class="nudge-wing">${nudge.wing}</div>
          <div class="nudge-msg">${nudge.message}</div>
          <div class="nudge-action">-> ${nudge.action} (+${nudge.reward} $HAR)</div>
        </div>
        <div class="nudge-pct">${nudge.delta}</div>
      `;
      item.addEventListener("click", async () => {
        if (item.dataset.pending === "1") return;
        item.dataset.pending = "1";
        item.style.pointerEvents = "none";
        item.style.opacity = "0.62";
        try {
          const ok = await Promise.resolve(renderCache.onAcceptNudge(nudge));
          if (ok === false) {
            item.dataset.pending = "0";
            item.style.pointerEvents = "";
            item.style.opacity = "";
          }
        } catch (error) {
          item.dataset.pending = "0";
          item.style.pointerEvents = "";
          item.style.opacity = "";
        }
      });
      el.nudgeList.appendChild(item);
    });
    el.nudgeCount.textContent = String(actionableNudgeCount.length);
    syncNudgeCounterBadges(actionableNudgeCount.length);
  }

  function renderEconomy(rankedWings, onSpend) {
    if (el.studentMarketList) {
      el.studentMarketList.innerHTML = MARKET_ITEMS.map(item => `
        <button class="access-btn secondary student-spend-btn" data-id="${item.id}" data-cost="${item.cost}" data-label="${item.name}">
          <span aria-hidden="true">${item.iconHtml}</span> ${item.name} (${item.cost} $HAR)
        </button>
      `).join("");
      el.studentMarketList.querySelectorAll(".student-spend-btn").forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          await purchaseItem(button.dataset.label, Number(button.dataset.cost), onSpend);
        });
      });
    }

    const sortedWings = [...rankedWings].sort((left, right) => Number(right.tokens || 0) - Number(left.tokens || 0));
    const maxKwh = Math.max(1, ...sortedWings.map(wing => Math.max(0, Number(wing.loadNow || wing.usage || 0))));
    const boardHtml = sortedWings.map((wing, index) => {
      const tokens = Math.round(Number(wing.tokens || 0));
      const kwh = Math.max(0, Number(wing.loadNow || wing.usage || 0));
      const barPct = Math.round((kwh / maxKwh) * 100);
      const color = wingColorForName(wing.name);
      return `
        <div class="board-item">
          <div class="rank-num">${medalByRank(index)}</div>
          <div class="board-info">
            <div class="board-wing">${wing.name} Wing</div>
            <div class="board-score">${tokens} $HAR</div>
            <div class="board-reward">+${Math.max(0, tokens - 40)} earned today</div>
          </div>
          <div class="board-bar-wrap">
            <div class="board-kwh">${kwh.toFixed(1)} kWh</div>
            <div class="board-bar-bg">
              <div class="board-bar" style="width:${barPct}%;background:${color}"></div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    if (el.harmonyBoard) {
      el.harmonyBoard.innerHTML = boardHtml;
    }
    if (el.marketplaceBoard) {
      el.marketplaceBoard.innerHTML = boardHtml;
    }
  }

  function renderHarmonyBoard(rankedWings, _utilities, onSpend) {
    renderCache.onSpend = onSpend;
    renderEconomy(Array.isArray(rankedWings) ? rankedWings : [], onSpend);
  }

  function renderToast(message) {
    if (!el.toast) return;
    const friendlyMessage = toFriendlyPopupMessage(message);
    const msg = el.toast.querySelector(".toast-msg");
    if (msg) {
      msg.textContent = friendlyMessage;
    }
    if (el.toastHead) {
      el.toastHead.textContent = popupTitleFromMessage(friendlyMessage);
    }
    el.toast.style.display = "block";
  }

  function dismissToast(options = {}) {
    if (!el.toast) return;
    const opts = options || {};
    const clearQueue = opts.clearQueue !== false;
    if (clearQueue) {
      toastState.queue = [];
    }

    const hasQueuedToast = toastState.queue.length > 0;
    el.toast.style.display = "none";
    if (hasQueuedToast) {
      const nextMessage = toastState.queue[toastState.queue.length - 1];
      toastState.queue = [];
      setTimeout(() => renderToast(nextMessage), 140);
    }
  }

  function showToast(message) {
    if (!el.toast) return;
    if (Date.now() < Number(toastState.pauseUntilMs || 0)) return;
    const hasOpenToast = el.toast.style.display === "block";
    if (hasOpenToast) {
      const friendly = toFriendlyPopupMessage(message);
      const visible = el.toast.querySelector(".toast-msg");
      const visibleText = visible ? String(visible.textContent || "").trim() : "";
      if (friendly === visibleText) return;
      const lastQueued = toastState.queue.length ? toastState.queue[toastState.queue.length - 1] : "";
      if (friendly === lastQueued) return;
      toastState.queue = [friendly];
      return;
    }
    renderToast(message);
  }

  function setPortalRole(role) {
    const current = role === "admin" ? "admin" : "student";
    if (el.studentAccessPane) {
      el.studentAccessPane.style.display = current === "student" ? "" : "none";
    }
    if (el.adminAccessPane) {
      el.adminAccessPane.style.display = current === "admin" ? "" : "none";
    }
    el.accessRoleButtons.forEach(button => {
      button.classList.toggle("active", button.dataset.roleTab === current);
    });
  }

  function setPortalStatus(message, tone = "info") {
    if (!el.portalStatus) return;
    el.portalStatus.textContent = message;
    if (tone === "error") {
      el.portalStatus.style.color = "var(--red)";
      return;
    }
    if (tone === "success") {
      el.portalStatus.style.color = "var(--green)";
      return;
    }
    el.portalStatus.style.color = "var(--blue)";
  }

  function hidePortal() {
    if (document.body) {
      document.body.classList.remove("auth-mode");
    }
    if (el.accessPortal) {
      el.accessPortal.style.display = "none";
    }
  }

  function showPortal() {
    if (document.body) {
      document.body.classList.add("auth-mode");
    }
    if (el.accessPortal) {
      el.accessPortal.style.display = "grid";
    }
  }

  function showOnboarding() {
    if (el.onboardModal) {
      el.onboardModal.style.display = "grid";
    }
  }

  function hideOnboarding() {
    if (el.onboardModal) {
      el.onboardModal.style.display = "none";
    }
  }

  function switchPage(page, options) {
    const opts = options || {};
    const navItems = Array.from(document.querySelectorAll(".nav-item[data-page]"));
    const pages = Array.from(document.querySelectorAll("[data-page-content]"));
    if (!pages.length) return DEFAULT_PAGE;

    let requestedPage = page || DEFAULT_PAGE;
    if (requestedPage === ADMIN_PAGE && activeRole !== "admin") {
      requestedPage = activeRole === "student" ? STUDENT_PAGE : DEFAULT_PAGE;
      if (!opts.silent) {
        showToast("Admin Command Center is restricted to warden/admin accounts. Student view remains active.");
      }
    }
    const selectedPage = pages.some(section => section.dataset.pageContent === requestedPage)
      ? requestedPage
      : DEFAULT_PAGE;

    navItems.forEach(item => {
      item.classList.toggle("active", item.dataset.page === selectedPage);
    });
    pages.forEach(section => {
      section.classList.toggle("active", section.dataset.pageContent === selectedPage);
    });

    if (selectedPage === "marketplace") {
      renderMarketplace();
    }
    if (selectedPage === "analytics") {
      refreshAnalytics();
    }

    return selectedPage;
  }

  function setRolePanel(role) {
    activeRole = role === "admin" ? "admin" : role === "student" ? "student" : "none";
    const adminNavItem = document.querySelector(`.nav-item[data-page="${ADMIN_PAGE}"]`);
    if (adminNavItem) {
      adminNavItem.style.display = activeRole === "student" ? "none" : "";
    }

    if (role === "student") {
      switchPage(STUDENT_PAGE, { silent: true });
      return;
    }
    if (role === "admin") {
      switchPage(ADMIN_PAGE, { silent: true });
      return;
    }
    switchPage(DEFAULT_PAGE, { silent: true });
  }

  function renderStudentPanel(context) {
    const info = context || {};
    const user = info.user || {};
    const frame = info.frame || {};
    const snapshot = frame.snapshot || {};
    const state = frame.state || {};
    const wings = Array.isArray(frame.wings) ? frame.wings : [];
    const wingName = info.wingName || "Wing";
    const next4h = Array.isArray(snapshot.forecast) ? snapshot.forecast.slice(0, 4) : [];
    const adjustment = Number(info.behaviorFactor || 1);
    const quotaKwh = inferCampusQuotaKwh(snapshot, state);
    const demandShare = getWingDemandShare(wings, wingName);
    const share = Number(demandShare.share || 0.2);
    const todayKwh = Math.max(0, Number(state.todayKwh || 0));
    const projectedKwh = Math.max(todayKwh, Number(snapshot.projectedTodayKwh || todayKwh));
    const next4hCampusKwh = next4h.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);

    const wingQuotaKwh = quotaKwh * share;
    const wingUsedKwh = todayKwh * share;
    const wingProjectedKwh = projectedKwh * share;
    const liveQuotaDeltaKwh = wingQuotaKwh - wingUsedKwh;
    const projectedQuotaDeltaKwh = wingQuotaKwh - wingProjectedKwh;
    const quotaMagnitudeKwh = Math.abs(liveQuotaDeltaKwh);
    const next4hKwh = next4hCampusKwh * share * adjustment;
    const modeLabel = adjustment < 0.98 ? "optimized" : adjustment > 1.02 ? "high-load" : "baseline";

    if (el.studentUserLabel) {
      el.studentUserLabel.textContent = `${user.username || "student"} | ${wingName} Wing`;
    }
    if (el.studentQuotaLeft) {
      el.studentQuotaLeft.textContent = quotaMagnitudeKwh.toFixed(1);
      el.studentQuotaLeft.style.color = liveQuotaDeltaKwh >= 0 ? "var(--green)" : "var(--red)";
    }
    if (el.studentQuotaUnit) {
      if (liveQuotaDeltaKwh >= 0) {
        el.studentQuotaUnit.textContent = " kWh remaining";
        el.studentQuotaUnit.style.color = "var(--muted)";
      } else {
        el.studentQuotaUnit.textContent = " kWh over target";
        el.studentQuotaUnit.style.color = "var(--red)";
      }
    }
    if (el.studentPrediction4h) {
      const dayEndLabel = projectedQuotaDeltaKwh >= 0
        ? `${projectedQuotaDeltaKwh.toFixed(1)} kWh buffer`
        : `${Math.abs(projectedQuotaDeltaKwh).toFixed(1)} kWh overrun risk`;
      el.studentPrediction4h.textContent = `${next4hKwh.toFixed(1)} kWh expected in next 4h (${modeLabel} mode). Day-end trend: ${wingProjectedKwh.toFixed(1)} / ${wingQuotaKwh.toFixed(1)} kWh (${dayEndLabel}).`;
    }
    if (el.studentAuraOrb) {
      const projectedStress = wingProjectedKwh / Math.max(1, wingQuotaKwh);
      const stress = clamp(projectedStress / 1.25, 0, 1);
      const hue = Math.round((1 - stress) * 130);
      el.studentAuraOrb.style.background = `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.64), hsla(${hue},85%,58%,0.68), rgba(2,20,20,0.48))`;
      el.studentAuraOrb.style.boxShadow = `0 0 20px hsla(${hue},85%,55%,0.55), inset 0 -12px 18px rgba(0,0,0,0.3)`;
    }
    renderStudentActivity();

  }

  function renderStudentActivity() {
    if (!el.studentActivityLog) return;
    if (!studentActivityFeed.length) {
      el.studentActivityLog.innerHTML = `
        <div style="padding:8px 0;font-size:12px;color:var(--muted)">
          No recent activity yet. Marketplace purchases and accepted nudges will appear here.
        </div>
      `;
      return;
    }
    el.studentActivityLog.innerHTML = studentActivityFeed.map(activity => `
      <div style="display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(111,153,199,.1)">
        <span style="font-family:var(--mono);font-size:10px;color:var(--muted);white-space:nowrap">${activity.time}</span>
        <span style="font-size:12px;flex:1">${activity.action}</span>
        <span style="font-family:var(--mono);font-size:10px;color:${activity.color};white-space:nowrap">${activity.impact}</span>
      </div>`).join("");
  }

  function addStudentActivity(action, impact, tone = "neutral") {
    const actionText = cleanText(action);
    if (!actionText) return;
    const impactText = cleanText(impact) || "--";
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const color = tone === "positive" ? "var(--green)" : tone === "negative" ? "var(--red)" : "var(--muted)";
    studentActivityFeed.unshift({
      time,
      action: actionText,
      impact: impactText,
      color
    });
    if (studentActivityFeed.length > MAX_STUDENT_ACTIVITY_ITEMS) {
      studentActivityFeed.length = MAX_STUDENT_ACTIVITY_ITEMS;
    }
    renderStudentActivity();
  }

  async function purchaseItem(name, cost, onSpend) {
    if (typeof onSpend === "function") {
      const ok = await Promise.resolve(onSpend(cost, name));
      if (ok === false) {
        addStudentActivity(`Purchase failed: ${name}`, "No debit", "negative");
        showGhost(`Transaction failed: ${name} could not be purchased right now.`);
        return;
      }
    }
    addStudentActivity(`Marketplace purchase: ${name}`, `-${Math.max(0, Math.round(Number(cost || 0)))} $HAR`, "negative");
    showGhost(`Transaction successful: ${name} purchased for ${cost} $HAR. Digital receipt sent to your Aura.`);
  }

  function renderAdminPanel(context) {
    const info = context || {};
    const frame = info.frame || {};
    const wings = Array.isArray(frame.wings) ? frame.wings : [];
    const user = info.user || {};

    if (el.adminUserLabel) {
      el.adminUserLabel.textContent = `${user.username || "admin"} | ${user.role || "operator"}`;
    }

    const nodeMap = wings.map(wing => {
      const loadNow = Number(wing.loadNow || 0);
      const rooms = Math.max(1, Number(wing.rooms || 1));
      const tempC = Number(wing.tempC || 0);
      const occupancyPct = Math.max(0, Math.min(100, Math.round(Number(wing.occupancyPct || 0) * 100)));
      const loadPerRoom = loadNow / rooms;
      const stress = Math.max(0, Math.min(1, (loadPerRoom - 2.2) / 4));
      const latencyMs = Math.round(18 + stress * 56 + Math.max(0, tempC - 27) * 1.7);
      const packetLossPct = Math.max(0, Math.min(12, Number((stress * 6.8 + Math.max(0, tempC - 29) * 0.9).toFixed(1))));
      const healthScore = Math.max(28, Math.min(99, Math.round(100 - stress * 44 - packetLossPct * 2.8 - Math.max(0, tempC - 30) * 4)));
      const nodeCount = Math.max(8, Math.round(rooms / 7));

      let statusClass = "online";
      let statusLabel = "ONLINE";
      if (healthScore < 58 || packetLossPct >= 6 || tempC >= 31.5) {
        statusClass = "offline";
        statusLabel = "CRITICAL";
      } else if (healthScore < 78 || packetLossPct >= 3 || tempC >= 30) {
        statusClass = "warn";
        statusLabel = "DEGRADED";
      }

      return {
        wingName: wing.name,
        nodeCount,
        loadNow,
        latencyMs,
        packetLossPct,
        occupancyPct,
        healthScore,
        statusClass,
        statusLabel
      };
    });

    if (el.adminHeat) {
      el.adminHeat.innerHTML = nodeMap.map(node => {
        const fillColor = node.statusClass === "online"
          ? "var(--green)"
          : node.statusClass === "warn"
            ? "var(--amber)"
            : "var(--red)";

        return `
          <div class="admin-cell ${node.statusClass}">
            <div class="admin-node-head">
              <div>
                <div class="admin-node-title">${node.wingName} Edge Hub</div>
                <div class="admin-node-sub">${node.nodeCount} active nodes</div>
              </div>
              <div class="admin-node-pill ${node.statusClass}">${node.statusLabel}</div>
            </div>
            <div class="admin-metrics">
              <div class="admin-metric"><div class="admin-metric-lbl">Health</div><div class="admin-metric-val">${node.healthScore}%</div></div>
              <div class="admin-metric"><div class="admin-metric-lbl">Latency</div><div class="admin-metric-val">${node.latencyMs} ms</div></div>
              <div class="admin-metric"><div class="admin-metric-lbl">Packet Loss</div><div class="admin-metric-val">${node.packetLossPct}%</div></div>
              <div class="admin-metric"><div class="admin-metric-lbl">Load</div><div class="admin-metric-val">${node.loadNow.toFixed(0)} kW</div></div>
            </div>
            <div class="admin-health-track"><div class="admin-health-fill" style="width:${node.healthScore}%;background:${fillColor}"></div></div>
          </div>
        `;
      }).join("");
    }

    if (el.adminLogic) {
      const riskNode = nodeMap.reduce((lowest, node) => (node.healthScore < lowest.healthScore ? node : lowest), nodeMap[0] || { healthScore: 100 });
      if (!riskNode || !riskNode.wingName) {
        el.adminLogic.textContent = "Node telemetry not available.";
        return;
      }
      el.adminLogic.textContent = `${riskNode.wingName} Edge Hub flagged ${riskNode.statusLabel}: ${riskNode.packetLossPct}% packet loss, ${riskNode.latencyMs} ms latency, ${riskNode.occupancyPct}% occupancy.`;
    }
  }

  function renderAnalytics(frame) {
    const currentFrame = frame || {};
    const snapshot = currentFrame.snapshot || {};
    const state = currentFrame.state || {};
    const nudges = Array.isArray(currentFrame.nudges) ? currentFrame.nudges : [];
    const activeNudges = nudges.filter(nudge => String(nudge && (nudge.tone || nudge.type || "")).toLowerCase() !== "ok");
    const wings = Array.isArray(currentFrame.wings) ? currentFrame.wings : [];
    const quotaKwh = inferCampusQuotaKwh(snapshot, state);
    const liveKwh = Math.max(0, Number(state.todayKwh || 0));
    const projectedKwh = Math.max(liveKwh, Number(snapshot.projectedTodayKwh || liveKwh));
    const projectedBudgetUsePct = (projectedKwh / Math.max(1, quotaKwh)) * 100;
    const projectedOverByKwh = Math.max(0, projectedKwh - quotaKwh);
    const projectedBufferKwh = Math.max(0, quotaKwh - projectedKwh);
    const topWing = wings.reduce((best, wing) => {
      if (!best || Number(wing.tokens || 0) > Number(best.tokens || 0)) {
        return wing;
      }
      return best;
    }, null);

    if (el.analyticsBudgetUse) {
      el.analyticsBudgetUse.textContent = `${projectedBudgetUsePct.toFixed(1)}%`;
      el.analyticsBudgetUse.style.color = projectedOverByKwh > 0
        ? "var(--red)"
        : projectedBudgetUsePct >= 90
          ? "var(--amber)"
          : "var(--green)";
    }
    if (el.analyticsBudgetDetail) {
      if (projectedOverByKwh > 0) {
        el.analyticsBudgetDetail.textContent = "Campus budget consumption vs green quota. Currently in breach zone.";
      } else {
        el.analyticsBudgetDetail.textContent = `Projected ${projectedBudgetUsePct.toFixed(1)}% of quota with ${fmt(projectedBufferKwh)} kWh buffer by day-end.`;
      }
    }
    if (el.analyticsOverrun) {
      el.analyticsOverrun.textContent = projectedOverByKwh > 0 ? `+${fmt(projectedOverByKwh)} kWh` : "On Track";
      el.analyticsOverrun.style.color = projectedOverByKwh > 0 ? "var(--red)" : "var(--green)";
    }
    if (el.analyticsTemp) {
      el.analyticsTemp.textContent = `${Number(snapshot.avgTempC || 0).toFixed(1)} C`;
      el.analyticsTemp.style.color = "var(--blue)";
    }
    if (el.analyticsNudges) {
      el.analyticsNudges.textContent = String(activeNudges.length);
    }
    if (el.analyticsTopWing) {
      el.analyticsTopWing.textContent = topWing ? `${topWing.name} Wing` : "N/A";
      el.analyticsTopWing.style.color = topWing ? "var(--green)" : "";
    }
    if (el.analyticsGlobalNudge) {
      if (state.globalNudge && state.globalNudge.message) {
        const endsAtRaw = state.globalNudge.endsAt;
        const endsAt = endsAtRaw
          ? new Date(endsAtRaw).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
          : "N/A";
        el.analyticsGlobalNudge.textContent = `${state.globalNudge.message} (${state.globalNudge.severity || "info"}, until ${endsAt})`;
      } else {
        el.analyticsGlobalNudge.textContent = "No active global nudge.";
      }
    }
  }

  function showGhost(message, options = {}) {
    if (!el.aiGhost || !el.aiGhostMsg) return;
    const persist = Boolean(options && options.persist);
    const inToastSlot = Boolean(options && options.inToastSlot);
    const durationMs = Math.max(900, Number((options && options.durationMs) || 6500));
    const toastOpen = Boolean(el.toast && el.toast.style.display === "block");

    el.aiGhostMsg.textContent = message;
    el.aiGhost.style.display = "block";
    scheduleGhostDock();
    clearTimeout(showGhost._timer);

    if (inToastSlot) {
      ghostPinnedToToast = false;
      ghostToastSlot.active = true;
      ghostToastSlot.untilMs = Date.now() + durationMs;
      scheduleGhostDock();
      showGhost._timer = setTimeout(() => {
        ghostToastSlot.active = false;
        ghostToastSlot.untilMs = 0;
        if (el.aiGhost) {
          el.aiGhost.style.display = "none";
          scheduleGhostDock();
        }
      }, durationMs);
      return;
    }

    ghostToastSlot.active = false;
    ghostToastSlot.untilMs = 0;
    if (persist) {
      ghostPinnedToToast = true;
      return;
    }
    if (ghostPinnedToToast && toastOpen) {
      return;
    }
    ghostPinnedToToast = false;
    showGhost._timer = setTimeout(() => {
      if (el.aiGhost) {
        el.aiGhost.style.display = "none";
        scheduleGhostDock();
      }
    }, 6500);
  }

  function renderInference(inference) {
    if (!el.inferenceModeTag) return;
    const info = inference && typeof inference === "object" ? inference : {};
    const mode = info.mode || "local-fallback";
    const modelVersion = info.modelVersion || "heuristic-v1";
    if (mode === "remote") {
      el.inferenceModeTag.textContent = `Remote Inference | ${modelVersion}`;
      return;
    }
    el.inferenceModeTag.textContent = `Fallback Inference | ${modelVersion}`;
  }

  function renderMarketplace() {
    if (!renderCache.wings.length) return;
    renderHarmonyBoard(renderCache.wings, [], renderCache.onSpend);
  }

  function refreshAnalytics() {
    if (!renderCache.snapshot || !renderCache.state) return;
    renderAnalytics({
      snapshot: renderCache.snapshot,
      state: renderCache.state,
      wings: renderCache.wings,
      nudges: renderCache.nudges
    });
  }

  function rerenderWingScopedSections() {
    if (renderCache.snapshot && renderCache.state) {
      renderStats(renderCache.snapshot, renderCache.state, renderCache.wings);
    }
    renderNudges(renderCache.nudges, renderCache.onAcceptNudge);
  }

  function initTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
      const parsedKey = parseForecastWindowKey(tab.dataset.window || tab.textContent);
      if (parsedKey) {
        tab.dataset.forecastTab = "1";
        tab.dataset.window = parsedKey;
        if (tab.classList.contains("active")) {
          forecastWindowState.key = parsedKey;
        }
      }
      tab.addEventListener("click", () => {
        const group = tab.closest(".tabs");
        if (group) {
          group.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
        }
        tab.classList.add("active");

        if (tab.dataset.forecastTab === "1") {
          const nextKey = normalizeForecastWindowKey(tab.dataset.window || tab.textContent);
          if (forecastWindowState.key !== nextKey) {
            forecastWindowState.key = nextKey;
            if (renderCache.snapshot && renderCache.state) {
              renderStats(renderCache.snapshot, renderCache.state, renderCache.wings);
            }
          }
        }
      });
    });

    const activeForecastTab = document.querySelector(".tab[data-forecast-tab=\"1\"].active");
    if (activeForecastTab) {
      forecastWindowState.key = normalizeForecastWindowKey(activeForecastTab.dataset.window || activeForecastTab.textContent);
    }
  }

  function initInteractions() {
    restoreSidebarCollapsed();

    const navItems = Array.from(document.querySelectorAll(".nav-item[data-page]"));
    navItems.forEach(item => {
      const navLabel = String(item.textContent || "").replace(/\s+/g, " ").trim();
      if (navLabel) {
        item.setAttribute("title", navLabel);
      }
      item.addEventListener("click", event => {
        event.preventDefault();
        switchPage(item.dataset.page);
      });
    });

    const wingItems = Array.from(document.querySelectorAll(".wing-item"));
    const activateWing = (item, options = {}) => {
      const opts = options || {};
      if (!item) return;
      wingItems.forEach(wing => wing.classList.remove("active"));
      item.classList.add("active");
      const wingName = item.querySelector(".wing-name") ? item.querySelector(".wing-name").textContent.trim() : "";
      setWingFilter(wingName);
      rerenderWingScopedSections();
      if (!opts.silent) {
        showToast(`${wingName || "Selected wing"} selected. Forecast, heatmap, and nudges are now filtered to this wing.`);
      }
    };

    const initiallyActiveWing = wingItems.find(item => item.classList.contains("active")) || wingItems[0];
    if (initiallyActiveWing) {
      activateWing(initiallyActiveWing, { silent: true });
    }

    wingItems.forEach(item => {
      const wingName = item.querySelector(".wing-name") ? item.querySelector(".wing-name").textContent.trim() : "";
      if (wingName) {
        item.setAttribute("title", wingName);
      }
      item.addEventListener("click", () => {
        if (item.classList.contains("active")) return;
        activateWing(item);
      });
    });

    if (!wingItems.length) {
      setWingFilter("");
    }

    if (el.sidebarToggle && el.shell) {
      el.sidebarToggle.addEventListener("click", () => {
        const nextCollapsed = !el.shell.classList.contains("sidebar-collapsed");
        setSidebarCollapsed(nextCollapsed);
      });
    }

    const autoBtn = document.querySelector(".toast-btn.primary");
    if (autoBtn) {
      autoBtn.addEventListener("click", () => {
        toastState.queue = [];
        toastState.pauseUntilMs = Date.now() + 4000;
        dismissToast({ reason: "apply" });
      });
    }

    window.ecoApexDismissToast = () => dismissToast({ reason: "dismiss" });
    window.addEventListener("resize", scheduleGhostDock);

    switchPage(DEFAULT_PAGE);
  }

  function initAccessPortal(handlers) {
    const events = handlers || {};
    const onStudentSso = typeof events.onStudentSso === "function" ? events.onStudentSso : () => {};
    const onStudentBiometric = typeof events.onStudentBiometric === "function" ? events.onStudentBiometric : () => {};
    const onAdminLogin = typeof events.onAdminLogin === "function" ? events.onAdminLogin : () => {};
    const onOnboardingSave = typeof events.onOnboardingSave === "function" ? events.onOnboardingSave : () => {};
    const onGlobalNudge = typeof events.onGlobalNudge === "function" ? events.onGlobalNudge : () => {};

    setPortalRole("student");

    el.accessRoleButtons.forEach(button => {
      button.addEventListener("click", () => {
        setPortalRole(button.dataset.roleTab);
      });
    });

    if (el.studentSsoBtn) {
      el.studentSsoBtn.addEventListener("click", () => {
        onStudentSso(el.studentIdSelect ? el.studentIdSelect.value : "");
      });
    }

    if (el.studentBiometricBtn) {
      el.studentBiometricBtn.addEventListener("click", () => {
        onStudentBiometric(el.studentIdSelect ? el.studentIdSelect.value : "");
      });
    }

    if (el.adminLoginBtn) {
      el.adminLoginBtn.addEventListener("click", () => {
        onAdminLogin(
          el.adminUsername ? el.adminUsername.value : "",
          el.adminPassword ? el.adminPassword.value : ""
        );
      });
    }

    if (el.onboardSaveBtn) {
      el.onboardSaveBtn.addEventListener("click", () => {
        onOnboardingSave({
          studyPreference: el.onboardStudy ? el.onboardStudy.value : "room",
          laundryPriority: el.onboardLaundry ? el.onboardLaundry.value : "friday",
          connectDevices: el.onboardDevices ? el.onboardDevices.value : "yes"
        });
      });
    }

    if (el.globalNudgeBtn) {
      el.globalNudgeBtn.addEventListener("click", () => {
        onGlobalNudge({
          message: el.globalNudgeMessage ? el.globalNudgeMessage.value : "",
          durationMin: 90,
          targetWing: "All Wings",
          severity: "warn"
        });
      });
    }
  }

  return {
    updateClock,
    renderHeatmap,
    renderStats,
    renderNudges,
    renderHarmonyBoard,
    renderInference,
    renderStudentPanel,
    renderAdminPanel,
    renderAnalytics,
    addStudentActivity,
    setRolePanel,
    switchPage,
    showGhost,
    setPortalRole,
    setPortalStatus,
    showPortal,
    hidePortal,
    showOnboarding,
    hideOnboarding,
    showToast,
    dismissToast,
    initTabs,
    initInteractions,
    initAccessPortal
  };
}
