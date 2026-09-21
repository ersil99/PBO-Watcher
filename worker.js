function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function sourceConfig(request, env) {
  if (request.method === "GET") {
    return json((await env.SOURCE_CONFIG.get("source", "json")) || null);
  }
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const source = await request.json();
  if (!/^[a-zA-Z0-9_-]+$/.test(source.id || "") || !["xlsx", "published"].includes(source.type)) {
    return json({ error: "invalid source" }, 400);
  }
  await env.SOURCE_CONFIG.put("source", JSON.stringify({
    id: source.id,
    type: source.type,
    url: typeof source.url === "string" ? source.url : "",
  }));
  return json({ ok: true });
}

async function proxyRequest(request, upstreamBase, prefix) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = `${upstreamBase}${incomingUrl.pathname.slice(prefix.length)}${incomingUrl.search}`;
  return fetch(upstreamUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/source-config") return sourceConfig(request, env);
    if (url.pathname.startsWith("/naver/")) return proxyRequest(request, "https://api.finance.naver.com", "/naver");
    if (url.pathname.startsWith("/yahoo/")) return proxyRequest(request, "https://query1.finance.yahoo.com", "/yahoo");
    return env.ASSETS.fetch(request);
  },
};