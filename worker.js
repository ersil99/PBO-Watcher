import { getDueNotifications, handleTelegramWebhook, processNotificationQueueMessage } from "./telegram-notifications.mjs";

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
  if (!env.SOURCE_CONFIG) return json({ error: "source config storage is not configured" }, 503);
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
    if (url.pathname === "/api/telegram-webhook") return handleTelegramWebhook(request, env);
    if (url.pathname.startsWith("/naver-stock/")) return proxyRequest(request, "https://m.stock.naver.com", "/naver-stock");
    if (url.pathname.startsWith("/naver-chart/")) return proxyRequest(request, "https://fchart.stock.naver.com", "/naver-chart");
    if (url.pathname.startsWith("/naver/")) return proxyRequest(request, "https://api.finance.naver.com", "/naver");
    if (url.pathname.startsWith("/yahoo/")) return proxyRequest(request, "https://query1.finance.yahoo.com", "/yahoo");
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env) {
    const notifications = getDueNotifications(new Date(controller.scheduledTime));
    if (!notifications.length) return;
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets must be configured");
    }
    if (!env.NOTIFICATION_QUEUE) throw new Error("NOTIFICATION_QUEUE binding is not configured");
    for (const notification of notifications) {
      await env.NOTIFICATION_QUEUE.send({ type: "scheduled", notification });
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      await processNotificationQueueMessage(env, message.body);
    }
  },
};