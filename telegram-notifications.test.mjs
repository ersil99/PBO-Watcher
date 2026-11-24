import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { fetchStockMetrics, fetchWithRetry, formatFilteredStockMessages, getDueNotifications, getNaverPeriodData, handleTelegramWebhook, isAuthorizedSendNowCommand, loadFocusRows, matchesFocusFilters, processNotificationQueueMessage, processTelegramWebhookCommand, readPublishedStocks, readXlsxStocks } from "./telegram-notifications.mjs";

test("sends Asian market lists at all configured Seoul times on weekdays", () => {
  const expectedTimes = ["10:00", "13:00", "15:00", "15:15"];
  for (const time of expectedTimes) {
    const [hour, minute] = time.split(":").map(Number);
    const date = new Date(Date.UTC(2026, 10, 23, hour - 9, minute));
    const [notification] = getDueNotifications(date);
    assert.equal(notification?.title, `아시아 시장 · 2026-11-23 ${time} KST`);
    assert.deepEqual(notification?.markets, ["한국", "일본", "중국"]);
  }
});

test("skips weekends", () => {
  assert.deepEqual(getDueNotifications(new Date("2026-11-22T01:00:00Z")), []);
});

test("accepts /sendnow only from the configured chat", () => {
  assert.equal(isAuthorizedSendNowCommand({ chat: { id: 123 }, text: "/sendnow" }, "123"), true);
  assert.equal(isAuthorizedSendNowCommand({ chat: { id: 123 }, text: "/sendnow@PBOWatcherbot" }, 123), true);
  assert.equal(isAuthorizedSendNowCommand({ chat: { id: 456 }, text: "/sendnow" }, 123), false);
  assert.equal(isAuthorizedSendNowCommand({ chat: { id: 123 }, text: "/start" }, 123), false);
  assert.equal(isAuthorizedSendNowCommand({ chat: { id: 123 }, text: "/sendnow please" }, 123), false);
});

test("requires a positive period change for close-low matches", () => {
  assert.equal(matchesFocusFilters({ bold: true, changeRate: 2, closeLowRate: 0 }), true);
  assert.equal(matchesFocusFilters({ bold: true, changeRate: 1, closeLowRate: 2, close: 100, previousDayHigh: 100 }), true);
  assert.equal(matchesFocusFilters({ bold: true, changeRate: -1, closeLowRate: 3, close: 101, previousDayHigh: 100 }), false);
  assert.equal(matchesFocusFilters({ bold: true, changeRate: 1, closeLowRate: 2, close: 99, previousDayHigh: 100 }), false);
  assert.equal(matchesFocusFilters({ bold: false, changeRate: 5, closeLowRate: 4, close: 105, previousDayHigh: 100 }), false);
  assert.equal(matchesFocusFilters({ bold: true, changeRate: 1.99, closeLowRate: 1.99, close: 105, previousDayHigh: 100 }), false);
});

test("retries rate-limited quote requests a bounded number of times", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("", { status: 429, headers: { "retry-after": "0" } })
      : Response.json({ ok: true });
  };
  try {
    const response = await fetchWithRetry("https://quotes.example.test");
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("formats matches by market, period, and industry", () => {
  const [message] = formatFilteredStockMessages("2026. 11. 23. 10:00", {
    한국: {
      일봉: [
        { code: "005930", name: "삼성전자", industry: "반도체", changeRate: 2.5, closeLowRate: 3 },
        { code: "000660", name: "SK하이닉스", industry: "반도체", changeRate: 5, closeLowRate: 4 },
        { code: "035420", name: "NAVER", industry: "인터넷", changeRate: 1, closeLowRate: 2 },
      ],
      주봉: [
        { code: "003350", name: "한국화장품제조", industry: "화장품", changeRate: -1.14 },
        { code: "000500", name: "가온전선", industry: "전기장비", changeRate: 8.96 },
      ],
      월봉: [
        { code: "017900", name: "광전자", industry: "전자장비와기기", changeRate: -20.42 },
        { code: "003230", name: "삼양식품", industry: "식품", changeRate: 8.24 },
      ],
    },
    미국: { 일봉: [], 주봉: [], 월봉: [] },
  });
  assert.match(message, /【한국】/);
  assert.match(message, /일봉 · 3개/);
  assert.match(message, /반도체/);
  assert.match(message, /005930 삼성전자 \(반도체\) 등락 \+2\.50%/);
  assert.doesNotMatch(message, /종가-저가/);
  assert.ok(message.indexOf("000660") < message.indexOf("005930"));
  assert.ok(message.indexOf("005930") < message.indexOf("035420"));
  assert.match(message, /주봉 · 2개/);
  assert.match(message, /월봉 · 2개/);
  assert.ok(message.indexOf("000500") < message.indexOf("003350"));
  assert.ok(message.indexOf("003230") < message.indexOf("017900"));
  assert.match(message, /【미국】/);
});

test("uses the weekly sheet change rate instead of recalculating it from daily candles", () => {
  const rows = [
    [20261116, 100, 105, 95, 100, 1000],
    [20261120, 100, 105, 95, 100, 1000],
    [20261123, 100, 105, 100, 100, 1000],
    [20261124, 104, 110, 100, 104, 1000],
  ];

  const metrics = getNaverPeriodData(rows, "주봉", -1.14);
  assert.equal(metrics.changeRate, -1.14);
  assert.equal(metrics.close, 104);
  assert.ok(Math.abs(metrics.closeLowRate - 4) < 1e-10);
  assert.equal(getNaverPeriodData(rows, "주봉").changeRate, 4);
});

test("uses each Korean sheet period's own change rate in notification metrics", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("siseJson.naver")) {
      return new Response("[['날짜','시가','고가','저가','종가','거래량'],['20261116',100,105,95,100,1000],['20261120',100,105,95,100,1000],['20261123',100,105,100,100,1000],['20261124',104,110,100,104,1000]]");
    }
    if (String(url).includes("/integration")) {
      return Response.json({ stockName: "한국화장품제조", industryCode: "1" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const metrics = await fetchStockMetrics("한국", {
      code: "003350",
      name: "한국화장품제조",
      changeRate: 3.68,
      marketPeriods: ["일봉", "주봉"],
      changeRatesByPeriod: { 일봉: 3.68, 주봉: -1.14 },
    }, new Map([["1", "화장품"]]));

    assert.equal(metrics.metricsByPeriod["주봉"].changeRate, -1.14);
    assert.ok(!requests.some((url) => url.includes("siseJson.naver")));
    assert.ok(!requests.some((url) => url.includes("timeframe=minute")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetches Korean candle history only for positive rates below two percent", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("siseJson.naver")) {
      return new Response("[['날짜','시가','고가','저가','종가','거래량'],['20261116',100,105,95,100,1000],['20261120',100,105,95,100,1000],['20261123',100,105,100,100,1000],['20261124',104,110,100,104,1000]]");
    }
    if (String(url).includes("/integration")) {
      return Response.json({ stockName: "한국화장품제조", industryCode: "1" });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const metrics = await fetchStockMetrics("한국", {
      code: "003350",
      name: "한국화장품제조",
      changeRate: 1.5,
      marketPeriods: ["주봉"],
      changeRatesByPeriod: { 주봉: 1.5 },
    }, new Map([["1", "화장품"]]));

    assert.ok(requests.some((url) => url.includes("siseJson.naver")));
    assert.equal(metrics.metricsByPeriod["주봉"].changeRate, 1.5);
    assert.equal(metrics.metricsByPeriod["주봉"].closeLowRate, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps each sheet's period rate and downloads each worksheet only once", async () => {
  const originalFetch = globalThis.fetch;
  const worksheetRequests = [];
  const sheetRows = {
    "11": `<style>.s1{font-weight:bold}</style><table><tr><td>003350</td><td class="s1">한국화장품제조</td><td>3.68</td></tr></table>`,
    "12": `<style>.s1{font-weight:bold}</style><table><tr><td>003350</td><td class="s1">한국화장품제조</td><td>-1.14</td></tr></table>`,
    "13": `<style>.s1{font-weight:bold}</style><table><tr><td>003350</td><td class="s1">한국화장품제조</td><td>-2.00</td></tr></table>`,
    "21": `<style>.s1{font-weight:bold}</style><table><tr><td class="s1">7203</td><td>3.00</td><td>일봉</td></tr><tr><td class="s1">7203</td><td>1.00</td><td>주봉</td></tr><tr><td class="s1">7203</td><td>2.00</td><td>월봉</td></tr></table>`,
    "31": `<style>.s1{font-weight:bold}</style><table><tr><td class="s1">600406</td><td>3.00</td><td>일봉</td></tr><tr><td class="s1">600406</td><td>1.00</td><td>주봉</td></tr><tr><td class="s1">600406</td><td>2.00</td><td>월봉</td></tr></table>`,
  };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/pubhtml")) {
      return new Response(`<script>items.push({name:"일봉",gid:"11"});items.push({name:"주봉",gid:"12"});items.push({name:"월봉",gid:"13"});items.push({name:"일본",gid:"21"});items.push({name:"중국",gid:"31"});</script>`);
    }
    const gid = new URL(requestUrl).searchParams.get("gid");
    worksheetRequests.push(gid);
    return new Response(sheetRows[gid]);
  };
  try {
    const { uniqueRowsByMarket } = await loadFocusRows({
      SOURCE_CONFIG: { get: async () => ({ id: "testsheet", type: "published" }) },
    }, ["한국", "일본", "중국"]);
    const korea = uniqueRowsByMarket.한국.find(({ code }) => code === "003350");

    assert.deepEqual(korea.changeRatesByPeriod, { 일봉: 3.68, 주봉: -1.14, 월봉: -2 });
    assert.deepEqual(worksheetRequests.sort(), ["11", "12", "13", "21", "31"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queues authorized Telegram webhook requests and rejects invalid secrets", async () => {
  const messages = [];
  const env = {
    TELEGRAM_BOT_TOKEN: "123:token",
    TELEGRAM_CHAT_ID: "123",
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    NOTIFICATION_QUEUE: {
      send: async (message) => messages.push(message),
    },
  };
  const body = JSON.stringify({
    update_id: 50,
    message: { chat: { id: 123 }, text: "/sendnow", date: 1795395600 },
  });
  const invalid = await handleTelegramWebhook(new Request("https://worker.example/api/telegram-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
    body,
  }), env);
  assert.equal(invalid.status, 403);
  assert.equal(messages.length, 0);

  const response = await handleTelegramWebhook(new Request("https://worker.example/api/telegram-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
    body,
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(messages, [{
    type: "telegram-update",
    update: { update_id: 50, message: { chat: { id: 123 }, text: "/sendnow", date: 1795395600 } },
  }]);

  const unauthorized = await handleTelegramWebhook(new Request("https://worker.example/api/telegram-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
    body: JSON.stringify({ update_id: 51, message: { chat: { id: 999 }, text: "/sendnow", date: 1795395600 } }),
  }), env);
  assert.equal(unauthorized.status, 200);
  assert.equal(messages.length, 1);
});

test("handles a Telegram webhook command once and stores its manual job", async () => {
  const stored = new Map();
  const replies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.telegram.org/bot123:token/sendMessage");
    replies.push(JSON.parse(init.body).text);
    return Response.json({ ok: true, result: {} });
  };
  try {
    const env = {
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_CHAT_ID: "123",
      SOURCE_CONFIG: {
        get: async (key) => stored.get(key) ?? null,
        put: async (key, value) => {
          stored.set(key, key === "telegram-notification-queue" ? JSON.parse(value) : value);
        },
      },
    };
    const update = {
      update_id: 50,
      message: { chat: { id: 123 }, text: "/sendnow", date: 1795395600 },
    };
    await processTelegramWebhookCommand(env, update);
    await processTelegramWebhookCommand(env, update);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const queue = stored.get("telegram-notification-queue");
  assert.equal(queue.pending[0].stage, "load");
  assert.deepEqual(queue.pending[0].marketNames, ["한국", "미국", "일본", "중국"]);
  assert.match(replies[0], /요청을 접수했습니다/);
  assert.equal(replies.length, 1);
});

test("continues queued notification jobs without waiting for another Cron Trigger", async () => {
  const queueKey = "telegram-notification-queue";
  const stored = new Map([[queueKey, {
    active: {
      stage: "send",
      title: "current",
      marketNames: ["한국"],
      rowsByMarket: { 한국: { 일봉: [], 주봉: [], 월봉: [] } },
      metricsByMarket: {},
    },
    pending: [{ stage: "load", title: "next" }],
  }]]);
  const queueMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true, result: {} });
  try {
    await processNotificationQueueMessage({
      TELEGRAM_BOT_TOKEN: "123:token",
      TELEGRAM_CHAT_ID: "123",
      SOURCE_CONFIG: {
        get: async (key) => stored.get(key) ?? null,
        put: async (key, value) => {
          stored.set(key, key === queueKey ? JSON.parse(value) : value);
        },
      },
      NOTIFICATION_QUEUE: {
        send: async (message, options) => queueMessages.push({ message, options }),
      },
    }, { type: "process" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(queueMessages, [{ message: { type: "process" }, options: { delaySeconds: 1 } }]);
  assert.equal(stored.get(queueKey).pending.length, 1);
});

test("uses New York local time for US sessions in both DST and standard time", () => {
  const cases = [
    ["2026-01-05T15:00:00Z", "미국 시장 · 개장 30분 후 · 2026-01-05 ET"],
    ["2026-07-06T14:00:00Z", "미국 시장 · 개장 30분 후 · 2026-07-06 ET"],
    ["2026-01-05T20:50:00Z", "미국 시장 · 장 종료 10분 전 · 2026-01-05 ET"],
    ["2026-07-06T19:50:00Z", "미국 시장 · 장 종료 10분 전 · 2026-07-06 ET"],
    ["2026-01-05T21:30:00Z", "미국 시장 · 장 종료 30분 후 · 2026-01-05 ET"],
    ["2026-07-06T20:30:00Z", "미국 시장 · 장 종료 30분 후 · 2026-07-06 ET"],
  ];
  for (const [timestamp, expectedTitle] of cases) {
    const notification = getDueNotifications(new Date(timestamp)).find(({ markets }) => markets[0] === "미국");
    assert.equal(notification?.title, expectedTitle);
  }
});

test("reads only bold daily stock rows from XLSX and keeps zero-padded numeric codes", () => {
  const files = {
    "xl/sharedStrings.xml": `<sst><si><t>삼성 &amp; 전자</t></si></sst>`,
    "xl/styles.xml": `<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="000000"/></numFmts><fonts count="2"><font/><font><b/></font></fonts><cellXfs count="3"><xf fontId="0" numFmtId="0"/><xf fontId="0" numFmtId="164"/><xf fontId="1" numFmtId="0"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>종목코드</t></is></c><c r="B1" t="inlineStr"><is><t>종목명</t></is></c></row>
      <row r="2"><c r="A2" s="1"><v>5930</v></c><c r="B2" s="2" t="s"><v>0</v></c></row>
      <row r="3"><c r="A3" s="1"><v>1234</v></c><c r="B3" t="inlineStr"><is><t>비굵은 종목</t></is></c></row>
      <row r="4"><c r="A4" s="2"><v>5555</v></c><c r="B4" t="inlineStr"><is><t>주간 종목</t></is></c><c r="F4" t="inlineStr"><is><t>주봉</t></is></c></row>
    </sheetData></worksheet>`,
  };
  const workbook = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, new TextEncoder().encode(text)])));
  assert.deepEqual(readXlsxStocks(workbook, {
    codeColumn: 0,
    nameColumn: 1,
    boldColumn: 1,
  }), [{ code: "005930", name: "삼성 & 전자", changeRate: 0 }]);
  assert.deepEqual(readXlsxStocks(workbook, {
    codeColumn: 0,
    nameColumn: null,
    boldColumn: 0,
    periodColumn: 5,
  }), []);
  assert.deepEqual(readXlsxStocks(workbook, {
    codeColumn: 0,
    nameColumn: null,
    boldColumn: 0,
    periodColumn: 5,
  }, "주봉"), [{ code: "5555", name: "5555", changeRate: 0 }]);
});

test("reads published sheet rows with bold CSS styles and daily period filtering", () => {
  const html = `<style>.s1{font-weight:bold}</style><table>
    <tr><td class="s1">AAPL</td><td class="s0">Apple</td><td></td><td></td><td></td><td class="s0">일봉</td></tr>
    <tr><td class="s0">MSFT</td><td class="s0">Microsoft</td><td></td><td></td><td></td><td class="s0">일봉</td></tr>
    <tr><td class="s1">NVDA</td><td class="s0">Nvidia</td><td></td><td></td><td></td><td class="s0">주봉</td></tr>
  </table>`;
  assert.deepEqual(readPublishedStocks(html, {
    codeColumn: 0,
    nameColumn: 1,
    periodColumn: 5,
    boldColumn: 0,
  }), [{ code: "AAPL", name: "Apple", changeRate: 0 }]);
  assert.deepEqual(readPublishedStocks(html, {
    codeColumn: 0,
    nameColumn: 1,
    periodColumn: 5,
    boldColumn: 0,
  }, "주봉"), [{ code: "NVDA", name: "Nvidia", changeRate: 0 }]);
});
