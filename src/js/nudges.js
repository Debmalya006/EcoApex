function asPct(value) {
  return `${Math.round(value)}%`;
}

export function buildHyperNudges(snapshot, nudgePolicy) {
  const policy = nudgePolicy || {};
  const cohortName = policy.cohortName || "Class of 2026";
  const maxActiveNudges = Number(policy.maxActiveNudges || 3);
  const nudges = [];

  snapshot.overQuotaWings.forEach((wing, index) => {
    const wingKey = String(wing.name || "").toLowerCase();
    const reward = 50 - index * 5;
    const kwhSaved = Math.max(16, reward * 0.45);
    nudges.push({
      id: `${wingKey}-deep-freeze`,
      wing: `${wing.name} Wing`,
      tone: "urgent",
      delta: `+${asPct((wing.loadNow / wing.baselineLoad - 1) * 100)}`,
      message: `${cohortName}: ${(100 - wing.occupancyPct * 100).toFixed(0)}% of your wing is in class right now. Switch common room to Deep Freeze for 60 minutes to earn ${reward} $HAR.`,
      action: "Apply Deep Freeze",
      cooldownSec: 30,
      reward,
      kwhSaved,
      co2Saved: Math.max(3, kwhSaved * 0.42)
    });
  });

  snapshot.vampireWings.forEach((wing, index) => {
    const wingKey = String(wing.name || "").toLowerCase();
    const reward = 30 - index * 3;
    const kwhSaved = Math.max(11, reward * 0.4);
    nudges.push({
      id: `${wingKey}-vampire-cut`,
      wing: `${wing.name} Wing`,
      tone: "warn",
      delta: `+${Math.round(wing.baselineLoad / 10)} kWh`,
      message: "Vampire load signature detected in low-occupancy rooms. Cut standby strips for 45 minutes to reclaim hidden base load.",
      action: "Kill Standby Loads",
      cooldownSec: 30,
      reward,
      kwhSaved,
      co2Saved: Math.max(2, kwhSaved * 0.35)
    });
  });

  if (!nudges.length) {
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

  return nudges.slice(0, maxActiveNudges);
}
