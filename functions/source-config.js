const { getStore } = require("@netlify/blobs");

const store = getStore("pbo-source-config");
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      return response(200, (await store.get("source", { type: "json" })) || null);
    }
    if (event.httpMethod !== "POST") return response(405, { error: "method not allowed" });

    const source = JSON.parse(event.body || "{}");
    if (!/^[a-zA-Z0-9_-]+$/.test(source.id || "") || !["xlsx", "published"].includes(source.type)) {
      return response(400, { error: "invalid source" });
    }
    await store.setJSON("source", {
      id: source.id,
      type: source.type,
      url: typeof source.url === "string" ? source.url : "",
    });
    return response(200, { ok: true });
  } catch (error) {
    console.error(error);
    return response(500, { error: "source config unavailable" });
  }
};
