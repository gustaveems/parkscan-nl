// ParkScan NL — browser demo runtime.
//
// On *.github.io the Express backend cannot run, so this module intercepts
// every /api/* request and dispatches it through the REAL route handlers
// (copied verbatim from backend/src/routes/api.js) against the in-memory
// store. PDOK/BAG lookups are live public APIs (CORS: *); Google/Gemini
// features fall back to the same deterministic mocks the server uses when no
// API keys are configured; PDF & SMTP are disabled.

import router from "./apiRouter.js";
import { dispatch } from "./expressShim.js";
import { getStore } from "./store.js";

globalThis.process = globalThis.process || { env: {} };

const DEMO_PROVIDERS = {
  store: "browser-memory",
  places: "mock",
  streetview: "mock",
  maps: "mock",
  bag: "pdok_locatieserver",
  llm: "mock",
  vision: "mock",
  mode: "github-pages-demo",
};

function toUrl(raw) {
  const s = String(raw);
  const i = s.indexOf("/api/");
  return i >= 0 ? s.slice(i + 4) : null; // strip leading host, keep "/api..."
}

export function isDemoHost() {
  return (
    typeof location !== "undefined" &&
    (location.hostname.endsWith("github.io") ||
      new URLSearchParams(location.search).get("demo") === "1")
  );
}

export function installDemoFetch() {
  if (typeof window === "undefined" || window.__parkscanDemo) return;
  window.__parkscanDemo = true;
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    let url = typeof input === "string" ? input : input?.url ?? String(input);
    const rel = url.includes("/api/") ? url.slice(url.indexOf("/api/") + 4) : null;
    if (rel === null) return realFetch(input, init);

    const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    let body = {};
    if (init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }

    try {
      if (rel === "/providers") {
        return jsonResponse(DEMO_PROVIDERS);
      }
      const { code, payload } = await dispatch(router, method, rel, body);
      return jsonResponse(payload ?? { error: "empty response" }, code);
    } catch (err) {
      const code = err?.code === "DEMO_NO_PDF" ? 501 : 500;
      return jsonResponse({ error: err.message || String(err) }, code);
    }
  };
  // Warm the store handle so first scan is fast
  getStore();
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
