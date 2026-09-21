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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/source-config") return sourceConfig(request, env);
    return env.ASSETS.fetch(request);
  },
};