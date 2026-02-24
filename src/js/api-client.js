function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && (payload.error || payload.message)
      ? (payload.error || payload.message)
      : `Request failed (${response.status})`;
    const requestError = new Error(message);
    requestError.status = response.status;
    requestError.payload = payload;
    throw requestError;
  }

  return payload;
}

export function createApiClient(basePath = "/api") {
  const base = trimTrailingSlash(basePath);
  let authToken = null;
  let currentUser = null;

  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    return headers;
  }

  function setToken(token, user) {
    authToken = token || null;
    currentUser = user || null;
  }

  function getAuth() {
    return {
      token: authToken,
      user: currentUser
    };
  }

  async function loginGuest() {
    const data = await requestJson(`${base}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    setToken(data.token, data.user);
    return data;
  }

  async function login(username, password) {
    const data = await requestJson(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    setToken(data.token, data.user);
    return data;
  }

  async function me() {
    return requestJson(`${base}/auth/me`, {
      headers: authHeaders()
    });
  }

  async function checkHealth() {
    try {
      const data = await requestJson(`${base}/health`);
      return Boolean(data && data.ok);
    } catch (error) {
      return false;
    }
  }

  async function fetchConfig() {
    return requestJson(`${base}/config`);
  }

  async function fetchState() {
    return requestJson(`${base}/state`, {
      headers: authHeaders()
    });
  }

  async function fetchLedgerBalances() {
    return requestJson(`${base}/ledger/balances`, {
      headers: authHeaders()
    });
  }

  async function fetchLedgerTransactions(params) {
    const query = new URLSearchParams();
    const options = params || {};
    if (options.limit != null) query.set("limit", String(options.limit));
    if (options.wing) query.set("wing", String(options.wing));
    if (options.type) query.set("type", String(options.type));
    if (options.actor) query.set("actor", String(options.actor));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson(`${base}/ledger/transactions${suffix}`, {
      headers: authHeaders()
    });
  }

  async function ingest(records, source = "dashboard") {
    return requestJson(`${base}/ingest`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ source, records })
    });
  }

  async function acceptTrade(nudgeId) {
    return requestJson(`${base}/actions/accept-trade`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ nudgeId })
    });
  }

  async function spend(cost, utilityName, wing) {
    return requestJson(`${base}/actions/spend`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ cost, utilityName, wing })
    });
  }

  async function globalNudge(message, durationMin, targetWing, severity = "warn") {
    return requestJson(`${base}/actions/global-nudge`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message, durationMin, targetWing, severity })
    });
  }

  function openStream({ onSnapshot, onError }) {
    const streamUrl = authToken ? `${base}/stream?token=${encodeURIComponent(authToken)}` : `${base}/stream`;
    const stream = new EventSource(streamUrl);

    stream.addEventListener("snapshot", event => {
      try {
        const frame = JSON.parse(event.data);
        onSnapshot(frame);
      } catch (error) {
        if (onError) onError(error);
      }
    });

    stream.onerror = event => {
      if (onError) onError(event);
    };

    return () => stream.close();
  }

  return {
    setToken,
    getAuth,
    loginGuest,
    login,
    me,
    checkHealth,
    fetchConfig,
    fetchState,
    fetchLedgerBalances,
    fetchLedgerTransactions,
    ingest,
    acceptTrade,
    spend,
    globalNudge,
    openStream
  };
}
