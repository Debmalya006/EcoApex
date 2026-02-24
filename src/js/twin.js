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

function totalStandbyKw(devices) {
  return devices.reduce((sum, device) => {
    const count = Number(device.count || 0);
    const standbyW = Number(device.standbyW || 0);
    return sum + (count * standbyW) / 1000;
  }, 0);
}

export function createTwinEngine(config) {
  const campus = config.campus;
  const nudgePolicy = config.nudgePolicy || {};
  const roomsTotal = Number(campus.roomsTotal);
  const quotaKwh = Number(campus.quotaKwh);
  const tickDeltaKwhMin = Number(campus.tickDeltaKwhMin || 12);
  const tickDeltaKwhMax = Number(campus.tickDeltaKwhMax || 18);

  const wingState = config.wings.map(wing => ({
    name: wing.name,
    rooms: Number(wing.rooms),
    occupancyPct: Number(wing.initial?.occupancyPct || 0.6),
    loadNow: Number(wing.initial?.loadNowKw || 450),
    baselineLoad: Number(wing.initial?.baselineLoadKw || 280),
    tempC: Number(wing.initial?.tempC || 28),
    tokens: Number(wing.initial?.tokens || 50),
    standbyKw: totalStandbyKw(Array.isArray(wing.devices) ? wing.devices : []),
    devices: Array.isArray(wing.devices) ? wing.devices : []
  }));

  const state = {
    todayKwh: Number(campus.startTodayKwh || 0),
    co2SavedKg: Number(campus.startCo2SavedKg || 0),
    nudgesSent: 0,
    acceptedTrades: 0,
    lastNudges: [],
    runtimeDayKey: dayKeyFromDate(new Date())
  };

  function normalizeRuntimeForDay(nowInput) {
    const now = nowInput instanceof Date ? nowInput : new Date();
    const todayKey = dayKeyFromDate(now);
    if (state.runtimeDayKey !== todayKey) {
      state.runtimeDayKey = todayKey;
      state.todayKwh = Math.max(0, Number(campus.startTodayKwh || 0) * 0.18);
      state.co2SavedKg = Math.max(0, Number(campus.startCo2SavedKg || 0) * 0.12);
      state.nudgesSent = 0;
      state.acceptedTrades = 0;
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
  }

  function forecastNext24h() {
    const base = wingState.reduce((sum, wing) => sum + wing.loadNow, 0) / 10;
    const avgTemp = wingState.reduce((sum, wing) => sum + wing.tempC, 0) / wingState.length;
    const out = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const circadian = 1 + 0.2 * Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2);
      const classSchedule = hour >= 9 && hour <= 16 ? 0.88 : 1.08;
      const weather = 1 + Math.max(0, avgTemp - 28) * 0.015;
      out.push(base * circadian * classSchedule * weather);
    }
    return out;
  }

  function getOverQuotaWings() {
    const threshold = Number(nudgePolicy.overQuotaKwPerRoom || 4.8);
    return wingState.filter(wing => wing.loadNow / wing.rooms > threshold);
  }

  function detectVampireLoads() {
    const occupancyThreshold = Number(nudgePolicy.vampireOccupancyThreshold || 0.4);
    const baselineThreshold = Number(nudgePolicy.vampireBaselineThresholdKw || 290);
    return wingState
      .filter(wing => wing.occupancyPct < occupancyThreshold && wing.baselineLoad > baselineThreshold)
      .sort((a, b) => b.baselineLoad - a.baselineLoad)
      .slice(0, 2);
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
      const standbyDrag = wing.standbyKw * randomIn(0.8, 1.2);
      wing.loadNow = Math.max(240, wing.baselineLoad * behaviorPenalty * classScheduleFactor + standbyDrag + randomIn(10, 55));
    });

    state.todayKwh += randomIn(tickDeltaKwhMin, tickDeltaKwhMax);
  }

  function getSnapshot() {
    normalizeRuntimeForDay();
    const forecast = forecastNext24h();
    const overQuotaWings = getOverQuotaWings();
    const vampireWings = detectVampireLoads();
    const activeRooms = wingState.reduce((sum, wing) => sum + Math.round(wing.rooms * wing.occupancyPct), 0);
    const occupancyPct = (activeRooms / roomsTotal) * 100;
    const projectedTodayKwh = state.todayKwh + forecast.slice(0, 8).reduce((sum, value) => sum + value, 0);
    const budgetUsePct = Math.min(100, (projectedTodayKwh / quotaKwh) * 100);
    const overByKwh = Math.max(0, projectedTodayKwh - quotaKwh);
    const avgTempC = wingState.reduce((sum, wing) => sum + wing.tempC, 0) / wingState.length;
    const remainingKwh = Math.max(0, quotaKwh - projectedTodayKwh);

    return {
      forecast,
      overQuotaWings,
      vampireWings,
      activeRooms,
      occupancyPct,
      projectedTodayKwh,
      budgetUsePct,
      overByKwh,
      avgTempC,
      remainingKwh
    };
  }

  function tick() {
    tickWingState();
    return getSnapshot();
  }

  function addNudgesSent(count) {
    state.nudgesSent += count;
  }

  function applyIntervention({ kwhSaved, co2Saved, tokensReward }) {
    normalizeRuntimeForDay();
    state.todayKwh = Math.max(0, state.todayKwh - Number(kwhSaved || 0));
    state.co2SavedKg += Number(co2Saved || 0);
    state.acceptedTrades += 1;
    const topWing = [...wingState].sort((a, b) => b.tokens - a.tokens)[0];
    topWing.tokens += Number(tokensReward || 0);
    return topWing;
  }

  return {
    wingState,
    state,
    tick,
    getSnapshot,
    addNudgesSent,
    applyIntervention
  };
}
