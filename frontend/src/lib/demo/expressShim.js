// Minimal express-Router stand-in for the browser demo build.

export function Router() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const rx = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((seg) => {
            if (seg.startsWith(":")) {
              keys.push(seg.slice(1));
              return "([^/]+)";
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/") +
        "$",
    );
    routes.push({ method, rx, keys, handler: handlers[handlers.length - 1] });
  };
  return {
    get: add("GET"),
    post: add("POST"),
    patch: add("PATCH"),
    delete: add("DELETE"),
    _routes: routes,
  };
}

export async function dispatch(router, method, url, body = {}) {
  const [pathRaw, queryRaw = ""] = url.split("?");
  const query = Object.fromEntries(new URLSearchParams(queryRaw));
  for (const r of router._routes) {
    if (r.method !== method) continue;
    const m = pathRaw.match(r.rx);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let code = 200;
    let payload = null;
    const res = {
      status(c) {
        code = c;
        return this;
      },
      setHeader() {
        return this;
      },
      json(obj) {
        payload = obj;
        return this;
      },
      send(obj) {
        payload = obj;
        return this;
      },
      end() {
        return this;
      },
    };
    await r.handler({ params, query, body }, res);
    return { code, payload };
  }
  return { code: 404, payload: { error: `no demo route for ${method} ${pathRaw}` } };
}
