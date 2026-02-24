const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_USERS = {
  users: [
    { username: "admin", password: "admin123", role: "admin", wings: ["*"] },
    { username: "operator", password: "operator123", role: "operator", wings: ["*"] },
    { username: "alpha_manager", password: "alpha123", role: "wing_manager", wings: ["Alpha"] },
    { username: "beta_manager", password: "beta123", role: "wing_manager", wings: ["Beta"] },
    { username: "student_alpha", password: "stu_alpha123", role: "student", wings: ["Alpha"] },
    { username: "student_beta", password: "stu_beta123", role: "student", wings: ["Beta"] },
    { username: "student_gamma", password: "stu_gamma123", role: "student", wings: ["Gamma"] },
    { username: "student_delta", password: "stu_delta123", role: "student", wings: ["Delta"] },
    { username: "student_epsilon", password: "stu_epsilon123", role: "student", wings: ["Epsilon"] }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeWings(wings) {
  if (!Array.isArray(wings) || !wings.length) return ["*"];
  return wings.map(item => String(item).trim()).filter(Boolean);
}

function normalizeUser(user) {
  return {
    username: String(user.username || "").trim(),
    password: String(user.password || ""),
    role: String(user.role || "operator"),
    wings: normalizeWings(user.wings)
  };
}

function sanitizeUser(user) {
  return {
    username: user.username,
    role: user.role,
    wings: clone(user.wings)
  };
}

function parseBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function createAuthStore(options) {
  const settings = options || {};
  const usersPath = settings.usersPath;
  const sessionTtlMs = Number(settings.sessionTtlMs || 8 * 60 * 60 * 1000);

  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, JSON.stringify(DEFAULT_USERS, null, 2), "utf8");
  }

  let users = [];
  try {
    const raw = fs.readFileSync(usersPath, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.users) ? parsed.users : [];
    users = list.map(normalizeUser).filter(user => user.username && user.password);
  } catch (error) {
    users = clone(DEFAULT_USERS.users).map(normalizeUser);
  }

  const sessions = new Map();

  function issueSession(user, source) {
    const token = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const expiresAt = new Date(now + sessionTtlMs).toISOString();
    const session = {
      token,
      username: user.username,
      role: user.role,
      wings: clone(user.wings),
      allWings: user.wings.includes("*"),
      source: source || "login",
      issuedAt: new Date(now).toISOString(),
      expiresAt
    };
    sessions.set(token, session);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeUser(user)
    };
  }

  function pruneExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (new Date(session.expiresAt).getTime() <= now) {
        sessions.delete(token);
      }
    }
  }

  function resolveSessionByToken(token) {
    if (!token) return null;
    pruneExpiredSessions();
    const session = sessions.get(token);
    if (!session) return null;
    return clone(session);
  }

  function login(username, password) {
    const user = users.find(item => item.username === String(username || "").trim());
    if (!user || user.password !== String(password || "")) {
      return null;
    }
    return issueSession(user, "login");
  }

  function guest() {
    const user = { username: "guest", role: "operator", wings: ["*"] };
    return issueSession(user, "guest");
  }

  function getSessionFromRequest(req, requestUrl) {
    const authHeader = req.headers.authorization;
    const headerToken = parseBearerToken(authHeader);
    const queryToken = requestUrl && requestUrl.searchParams ? requestUrl.searchParams.get("token") : null;
    return resolveSessionByToken(headerToken || queryToken);
  }

  function ensureRole(session, allowedRoles) {
    if (!session) return false;
    if (!Array.isArray(allowedRoles) || !allowedRoles.length) return true;
    return allowedRoles.includes(session.role);
  }

  function canAccessWing(session, wingName) {
    if (!session) return false;
    if (session.allWings) return true;
    if (!wingName) return session.wings.length > 0;
    return session.wings.some(item => item.toLowerCase() === String(wingName).toLowerCase());
  }

  function pickDefaultWing(session) {
    if (!session) return null;
    if (session.allWings) return null;
    return session.wings[0] || null;
  }

  return {
    login,
    guest,
    getSessionFromRequest,
    ensureRole,
    canAccessWing,
    pickDefaultWing,
    resolveSessionByToken
  };
}

module.exports = {
  createAuthStore
};
