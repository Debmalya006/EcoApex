export function createHarmonyEconomy(config) {
  const utilities = Array.isArray(config.utilities) ? config.utilities : [];

  function rankWings(wingState) {
    return [...wingState].sort((a, b) => b.tokens - a.tokens);
  }

  function spend(wingState, cost, utilityName) {
    const ranked = rankWings(wingState);
    const topWing = ranked[0];
    if (!topWing) {
      return { ok: false, message: "No wing data available for redemption." };
    }
    if (topWing.tokens < cost) {
      return { ok: false, message: `${topWing.name} Wing lacks $HAR balance for ${utilityName}.` };
    }
    topWing.tokens -= cost;
    return { ok: true, message: `${topWing.name} Wing redeemed ${utilityName} for ${cost} $HAR.` };
  }

  return {
    utilities,
    rankWings,
    spend
  };
}
