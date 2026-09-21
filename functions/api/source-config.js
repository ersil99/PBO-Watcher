const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequestGet({ env }) {
  const source = await env.SOURCE_CONFIG.get("source", "json");
  return json(source || null);
}

export async function onRequestPost({ request, env }) {
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