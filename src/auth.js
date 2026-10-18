import { messageBoardConfig } from "./config.js";

const storageKey = `yapern-session:${messageBoardConfig.projectId}`;
let memorySession = null;

export function isSession(value) {
  return Boolean(value && typeof value.token === "string" && /^bff_us_[a-f0-9]{64}$/.test(value.token) &&
    typeof value.session?.id === "string" && typeof value.session.user_id === "string" &&
    Number.isFinite(Date.parse(value.session.expires_at)) &&
    typeof value.user?.id === "string" && value.user.id === value.session.user_id &&
    typeof value.user.email === "string");
}

export function storeSession(session) {
  memorySession = session;
  try {
    if (session) window.sessionStorage.setItem(storageKey, JSON.stringify(session));
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    // Like the BFF example, retain the current page's session if storage is blocked.
  }
}

export function readStoredSession() {
  let value = memorySession;
  try { value = JSON.parse(window.sessionStorage.getItem(storageKey) || "null"); }
  catch { /* Storage may be blocked or malformed. */ }
  if (isSession(value) && Date.parse(value.session.expires_at) > Date.now()) return value;
  storeSession(null);
  return null;
}

export function createAuthClient(fetcher = fetch) {
  const base = `${messageBoardConfig.apiOrigin}/bff/data/${messageBoardConfig.projectId}/auth`;
  async function request(path, { method = "GET", session, body } = {}) {
    let response;
    try {
      response = await fetcher(`${base}/${path}`, {
        method, mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { apikey: messageBoardConfig.publicKey,
          ...(session ? { authorization: `Bearer ${session.token}` } : {}),
          ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("Could not reach Yapern sign-in. Check your connection and try again.");
    }
    const result = await response.json().catch(() => null);
    return { response, result };
  }
  return {
    async readSession() {
      const session = readStoredSession();
      if (!session) return null;
      const { response, result } = await request("session", { session });
      if (response.status === 401) { storeSession(null); return null; }
      const current = { ...result, token: session.token };
      if (!response.ok || !isSession(current) || Date.parse(current.session.expires_at) <= Date.now()) {
        throw new Error("Could not check your session. Please try again.");
      }
      storeSession(current);
      return current;
    },
    async signInWithEmail(email, password) {
      const { response, result } = await request("email", { method: "POST",
        body: { email: email.trim().toLowerCase(), password } });
      if (!response.ok || !isSession(result) || Date.parse(result.session.expires_at) <= Date.now()) {
        const messages = {
          invalid_request: "Enter a valid email and a password of no more than 128 characters.",
          weak_password: "Use at least 8 characters for a new password.",
          invalid_credentials: "Email or password is incorrect.",
          rate_limited: "Too many attempts. Please wait a minute and try again.",
          session_limit: "Sign-in is busy. Please try again later.",
        };
        throw new Error(messages[result?.error] || "Could not finish signing you in. Please try again.");
      }
      storeSession(result);
      return result;
    },
    async signOut() {
      const session = readStoredSession();
      if (session) {
        const { response, result } = await request("session", { method: "DELETE", session });
        if (!response.ok || result?.revoked !== true) throw new Error("Could not sign you out. Please try again.");
      }
      storeSession(null);
    },
  };
}
