// Shared active-session bus: Chat publishes, panels (Documents / KB / Dashboard) subscribe.
// Keeps per-session knowledge-base panels in sync without lifting all Chat state to App.
export const ACTIVE_SESSION_KEY = "kb-active-session";
export const SESSION_EVENT = "kb:active-session";

export function getActiveSessionId() {
  try {
    const v = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (v === null || v === "" || v === "null") return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export function publishActiveSession(sessionId) {
  try {
    if (sessionId === null || sessionId === undefined || sessionId === "") {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } else {
      localStorage.setItem(ACTIVE_SESSION_KEY, String(sessionId));
    }
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: sessionId ?? null }));
  } catch {}
}
