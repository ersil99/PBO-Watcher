import { unzipSync } from "fflate";

const defaultSpreadsheetId = "1Dsr3ZQXvHs0ZwyhovHx1TeVZbkUAHvV1-57L3SqvqtI";
const periods = ["일봉", "주봉", "월봉"];
const markets = {
  한국: { gidByPeriod: { 일봉: "0", 주봉: "1097197674", 월봉: "2089529874" }, sheetName: "일봉", codeColumn: 0, nameColumn: 1, changeColumn: 2, boldColumn: 1 },
  미국: { gid: "1000437246", sheetName: "미국", codeColumn: 0, nameColumn: 1, changeColumn: 2, periodColumn: 5, boldColumn: 0 },
  일본: { gid: "726759276", sheetName: "일본", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0 },
  중국: { gid: "1837366506", sheetName: "중국", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0 },
};
const asianMarketNames = ["한국", "일본", "중국"];
const allMarketNames = Object.keys(markets);
const notificationQueueKey = "telegram-notification-queue";
// Four stocks keep worst-case Naver retries below the Worker subrequest limit.
const sendNowBatchSize = { 한국: 4, 미국: 6, 일본: 6, 중국: 6 };
const sendNowConcurrency = 2;
const queueContinuationDelaySeconds = 1;

function getZonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
}

function isWeekday(weekday) {
  return weekday !== "Sat" && weekday !== "Sun";
}

export function getDueNotifications(date) {
  const notifications = [];
  const seoul = getZonedParts(date, "Asia/Seoul");
  if (isWeekday(seoul.weekday)) {
    const time = `${seoul.hour}:${seoul.minute}`;
    if (["10:00", "13:00", "15:00", "15:15"].includes(time)) {
      const dateKey = `${seoul.year}-${seoul.month}-${seoul.day}`;
      notifications.push({
        key: `asia:${dateKey}:${time}`,
        title: `아시아 시장 · ${dateKey} ${time} KST`,
        markets: asianMarketNames,
      });
    }
  }

  const newYork = getZonedParts(date, "America/New_York");
  if (isWeekday(newYork.weekday)) {
    const time = `${newYork.hour}:${newYork.minute}`;
    const schedule = {
      "10:00": "미국 시장 · 개장 30분 후",
      "15:50": "미국 시장 · 장 종료 10분 전",
      "16:30": "미국 시장 · 장 종료 30분 후",
    };
    if (schedule[time]) {
      const dateKey = `${newYork.year}-${newYork.month}-${newYork.day}`;
      notifications.push({
        key: `us:${dateKey}:${time}`,
        title: `${schedule[time]} · ${dateKey} ET`,
        markets: ["미국"],
      });
    }
  }

  return notifications;
}

export function isAuthorizedSendNowCommand(message, chatId) {
  if (String(message?.chat?.id) !== String(chatId) || typeof message?.text !== "string") return false;
  const [command, ...argumentsList] = message.text.trim().split(/\s+/);
  return command.split("@", 1)[0] === "/sendnow" && argumentsList.length === 0;
}

export async function handleTelegramWebhook(request, env) {
  const respond = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
  if (request.method !== "POST") return respond({ error: "method not allowed" }, 405);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET || !env.NOTIFICATION_QUEUE) {
    return respond({ error: "Telegram webhook is not configured" }, 503);
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return respond({ error: "unauthorized" }, 403);
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return respond({ error: "invalid JSON body" }, 400);
  }
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
    return respond({ error: "invalid Telegram update" }, 400);
  }
  if (!isAuthorizedSendNowCommand(update.message, env.TELEGRAM_CHAT_ID)) return respond({ ok: true });
  if (!Number.isSafeInteger(update.message.date) || update.message.date < 0) {
    return respond({ error: "invalid Telegram message date" }, 400);
  }

  await env.NOTIFICATION_QUEUE.send({
    type: "telegram-update",
    update: {
      update_id: update.update_id,
      message: {
        chat: { id: update.message.chat.id },
        text: update.message.text,
        date: update.message.date,
      },
    },
  });
  return respond({ ok: true });
}

async function readNotificationQueue(env) {
  const queue = await env.SOURCE_CONFIG.get(notificationQueueKey, "json");
  return queue && Array.isArray(queue.pending) ? queue : { active: null, pending: [] };
}

async function writeNotificationQueue(env, queue) {
  await env.SOURCE_CONFIG.put(notificationQueueKey, JSON.stringify(queue), { expirationTtl: 86400 });
}

export async function enqueueScheduledNotifications(env, notifications) {
  const queue = await readNotificationQueue(env);
  for (const notification of notifications) {
    const sentKey = `telegram-sent:${notification.key}`;
    if (await env.SOURCE_CONFIG.get(sentKey)) continue;
    const alreadyQueued = queue.active?.notificationKey === notification.key
      || queue.pending.some((job) => job.notificationKey === notification.key);
    if (alreadyQueued) continue;
    queue.pending.push({
      type: "scheduled",
      notificationKey: notification.key,
      title: notification.title,
      marketNames: notification.markets,
      stage: "load",
      marketIndex: 0,
      stockOffset: 0,
      metricsByMarket: {},
    });
  }
  await writeNotificationQueue(env, queue);
}

export async function processTelegramWebhookCommand(env, update) {
  if (!env.SOURCE_CONFIG) throw new Error("Telegram webhook handling requires SOURCE_CONFIG KV storage");
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) {
    throw new Error("Telegram webhook update has an invalid ID");
  }
  if (!Number.isSafeInteger(update.message?.date) || update.message.date < 0) {
    throw new Error("Telegram webhook message has an invalid date");
  }
  if (!isAuthorizedSendNowCommand(update.message, env.TELEGRAM_CHAT_ID)) return;

  const updateKey = `telegram-webhook-update:${update.update_id}`;
  if (await env.SOURCE_CONFIG.get(updateKey)) return;

  const queue = await readNotificationQueue(env);
  let reply;
  if (queue.active || queue.pending.length) {
    reply = "이전 종목 목록을 수집 중입니다. 완료될 때까지 잠시 기다려 주세요.";
  } else {
    const requestedAt = new Date(Number(update.message.date) * 1000).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    queue.pending.push({
      type: "manual",
      title: `포커스리스트 조건 검색 · ${requestedAt} KST`,
      marketNames: allMarketNames,
      stage: "load",
      marketIndex: 0,
      stockOffset: 0,
      metricsByMarket: {},
    });
    await writeNotificationQueue(env, queue);
    reply = "요청을 접수했습니다. 네 시장을 나눠 조회한 뒤 조건에 맞는 목록을 보내겠습니다.";
  }
  await env.SOURCE_CONFIG.put(updateKey, "1", { expirationTtl: 604800 });
  await sendTelegramText(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, reply);
}

export async function processNotificationQueueMessage(env, message) {
  if (!env.NOTIFICATION_QUEUE) throw new Error("Notification queue binding is not configured");
  if (message?.type === "scheduled") {
    await enqueueScheduledNotifications(env, [message.notification]);
  } else if (message?.type === "telegram-update") {
    await processTelegramWebhookCommand(env, message.update);
  } else if (message?.type !== "process") {
    throw new Error("Unknown notification queue message type");
  }

  await processFilteredStockQueue(env);
  const queue = await readNotificationQueue(env);
  if (queue.active || queue.pending.length) {
    await env.NOTIFICATION_QUEUE.send({ type: "process" }, { delaySeconds: queueContinuationDelaySeconds });
  }
}

async function getSource(env) {
  const source = env.SOURCE_CONFIG ? await env.SOURCE_CONFIG.get("source", "json") : null;
  if (source && /^[a-zA-Z0-9_-]+$/.test(source.id || "") && ["xlsx", "published"].includes(source.type)) {
    return source;
  }
  return { id: defaultSpreadsheetId, type: "xlsx" };
}

async function discoverSheetGids(source) {
  const baseUrl = source.type === "published"
    ? `https://docs.google.com/spreadsheets/d/e/${source.id}/pubhtml`
    : `https://docs.google.com/spreadsheets/d/${source.id}/edit?usp=drivesdk`;
  const response = await fetch(baseUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Google Sheets tab discovery failed: HTTP ${response.status}`);
  const html = await response.text();
  const gids = {};
  const pattern = source.type === "published"
    ? /items\.push\(\{name:\s*\\?"([^"\\]+)\\?"[\s\S]*?gid:\s*\\?"(\d+)/g
    : /\[\d+,\d+,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^\\]+)\\"/g;
  for (const match of html.matchAll(pattern)) {
    if (source.type === "published") gids[match[1]] = match[2];
    else gids[match[2]] = match[1];
  }
  return gids;
}

function htmlText(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function publishedCellClass(attributes) {
  return attributes.match(/\bclass=["']([^"']+)["']/i)?.[1] || "";
}

export function readPublishedStocks(html, config, period = "일봉") {
  const styleMap = new Map([...html.matchAll(/\.s(\d+)\{([^}]+)\}/g)].map((match) => [`s${match[1]}`, match[2]]));
  const stocks = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (!cells.length) continue;
    const cell = (index) => htmlText(cells[index]?.[2] || "");
    const code = cell(config.codeColumn);
    const periodValue = config.periodColumn === undefined ? period : cell(config.periodColumn);
    const periodMatches = config.periodColumn === undefined
      || (period === "일봉" ? !periodValue || periodValue === "일봉" : periodValue === period);
    if (!code || code === "종목코드" || !periodMatches) continue;
    const styleName = publishedCellClass(cells[config.boldColumn]?.[1] || "");
    const style = styleMap.get(styleName) || "";
    if (!/font-weight:\s*bold/i.test(style)) continue;
    const name = config.nameColumn === null ? code : cell(config.nameColumn) || code;
    const changeRate = Number(cell(config.changeColumn).replace(/,/g, ""));
    stocks.push({ code, name, changeRate: Number.isFinite(changeRate) ? changeRate : 0 });
  }
  return stocks;
}

function xmlAttributes(value) {
  return Object.fromEntries([...value.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() || "";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function getXlsxRows(files) {
  const decode = (path) => files[path] ? new TextDecoder().decode(files[path]) : "";
  const stylesXml = decode("xl/styles.xml");
  const sheetXml = decode("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("XLSX worksheet data is missing");
  const sharedStrings = [...decode("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join(""));
  const fonts = [...stylesXml.matchAll(/<font\b([^>]*?)(?:\/>|>([\s\S]*?)<\/font>)/g)].map((match) => {
    const boldTag = match[2]?.match(/<b\b([^>]*)\/?>/i);
    return Boolean(boldTag && xmlAttributes(boldTag[1]).val !== "0");
  });
  const cellFormatsXml = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  const formats = [...cellFormatsXml.matchAll(/<xf\b([^>]*)\/?>/g)].map((match) => xmlAttributes(match[1]));
  const numFormatsXml = stylesXml.match(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/)?.[1] || "";
  const numFormats = new Map([...numFormatsXml.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((match) => {
    const attributes = xmlAttributes(match[1]);
    return [attributes.numFmtId, decodeXml(attributes.formatCode || "")];
  }));
  const cellsByRow = new Map();
  for (const match of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = xmlAttributes(match[1]);
    if (!attributes.r) continue;
    const rowIndex = Number(attributes.r.match(/\d+$/)?.[0]) - 1;
    const style = formats[Number(attributes.s || 0)] || {};
    const value = match[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";
    const inline = match[2]?.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1];
    let text = attributes.t === "s" ? sharedStrings[Number(value)] || "" : inline
      ? [...inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("")
      : decodeXml(value);
    const numberFormat = numFormats.get(style.numFmtId);
    if (!attributes.t && /^\d+$/.test(numberFormat || "")) text = text.padStart(numberFormat.length, "0");
    const row = cellsByRow.get(rowIndex) || new Map();
    row.set(columnIndex(attributes.r), { text: text.trim(), bold: Boolean(fonts[Number(style.fontId || 0)]) });
    cellsByRow.set(rowIndex, row);
  }
  return cellsByRow;
}

export function readXlsxStocks(buffer, config, period = "일봉") {
  const files = unzipSync(new Uint8Array(buffer));
  const rows = getXlsxRows(files);
  const stocks = [];
  for (const [rowIndex, cells] of rows) {
    if (rowIndex === 0) continue;
    const code = cells.get(config.codeColumn)?.text || "";
    const name = (config.nameColumn === null ? code : cells.get(config.nameColumn)?.text) || code;
    const periodValue = config.periodColumn === undefined ? period : cells.get(config.periodColumn)?.text || "";
    const periodMatches = config.periodColumn === undefined
      || (period === "일봉" ? !periodValue || periodValue === "일봉" : periodValue === period);
    const changeRate = Number((cells.get(config.changeColumn)?.text || "").replace(/,/g, ""));
    if (code && code !== "종목코드" && periodMatches && cells.get(config.boldColumn)?.bold) {
      stocks.push({ code, name, changeRate: Number.isFinite(changeRate) ? changeRate : 0 });
    }
  }
  return stocks;
}

async function loadMarketPeriodRows(source, gids, market, period, worksheetCache) {
  const config = markets[market];
  if (!config) throw new Error(`Unsupported market: ${market}`);
  const gid = market === "한국"
    ? gids[period] || config.gidByPeriod?.[period]
    : gids[config.sheetName] || config.gid;
  if (!gid) throw new Error(`Google Sheets tab not found for ${market} ${period}`);
  const cacheKey = `${source.type}|${source.id}|${gid}`;
  let contentPromise = worksheetCache.get(cacheKey);
  if (!contentPromise) {
    const url = source.type === "published"
      ? `https://docs.google.com/spreadsheets/d/e/${source.id}/pubhtml/sheet?headers=false&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${source.id}/export?format=xlsx&gid=${gid}`;
    contentPromise = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${market} ${period} worksheet request failed: HTTP ${response.status}`);
      return source.type === "published" ? response.text() : response.arrayBuffer();
    })();
    worksheetCache.set(cacheKey, contentPromise);
  }
  const content = await contentPromise;
  return source.type === "published"
    ? readPublishedStocks(content, config, period)
    : readXlsxStocks(content, config, period);
}

export function matchesFocusFilters(row) {
  return row.bold && (row.changeRate >= 2
    || (row.changeRate > 0 && row.closeLowRate >= 2 && Number.isFinite(row.close)
      && Number.isFinite(row.previousDayHigh) && row.close >= row.previousDayHigh));
}

export async function fetchWithRetry(url, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        ...options?.headers,
      },
    });
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 2) return response;

    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.min(retryAfter * 1000, 2000)
      : 250 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Request retry loop ended unexpectedly");
}

function getPeriodKey(dateText, period) {
  if (period === "월봉") return dateText.slice(0, 6);
  if (period === "주봉") {
    const date = new Date(Date.UTC(Number(dateText.slice(0, 4)), Number(dateText.slice(4, 6)) - 1, Number(dateText.slice(6, 8))));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }
  return dateText;
}

function calculateCloseLowRate(close, low) {
  if (!Number.isFinite(close) || !Number.isFinite(low) || close <= 0 || low <= 0) return null;
  return ((close - low) / low) * 100;
}

function parseNaverDailyRows(text) {
  const data = JSON.parse(text.replace(/'/g, '"'));
  return data.slice(1).filter((row) => Array.isArray(row) && row.length > 5)
    .map((row) => row.map((value) => Number.isFinite(Number(value)) ? Number(value) : value));
}

export function getNaverPeriodData(rows, period, sheetChangeRate) {
  const grouped = new Map();
  for (const row of rows) {
    const key = getPeriodKey(String(row[0]), period);
    const entry = grouped.get(key) || { close: null, low: Infinity };
    entry.close = Number(row[4]);
    entry.low = Math.min(entry.low, Number(row[3]));
    grouped.set(key, entry);
  }
  const values = [...grouped.values()];
  const current = values.at(-1);
  const previous = values.at(-2);
  return {
    close: current?.close,
    changeRate: Number.isFinite(sheetChangeRate)
      ? sheetChangeRate
      : previous?.close > 0 ? ((current.close - previous.close) / previous.close) * 100 : null,
    closeLowRate: calculateCloseLowRate(current?.close, current?.low),
  };
}

function getYahooSymbol(code, market) {
  if (market === "일본") return `${code.padStart(4, "0")}.T`;
  if (market === "중국") return `${code.startsWith("6") ? code.padStart(6, "0") + ".SS" : code.padStart(6, "0") + ".SZ"}`;
  return code;
}

function getYahooPeriodKey(timestamp, period, market) {
  const timeZone = market === "일본" ? "Asia/Tokyo" : market === "중국" ? "Asia/Shanghai" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const dateText = `${values.year}${values.month}${values.day}`;
  if (period === "일봉") return dateText;
  if (period === "월봉") return `${values.year}${values.month}`;
  return getPeriodKey(dateText, period);
}

function getYahooMarketData(result, market, period, sheetChangeRate) {
  const quote = result?.indicators?.quote?.[0];
  const candles = (result?.timestamp || []).map((timestamp, index) => ({
    timestamp,
    close: quote?.close?.[index],
    high: quote?.high?.[index],
    low: quote?.low?.[index],
  })).filter((candle) => Number.isFinite(candle.close));
  const currentDaily = candles.at(-1);
  const previousDaily = candles.at(-2);
  const grouped = new Map();
  for (const candle of candles) {
    const key = getYahooPeriodKey(candle.timestamp, period, market);
    const entry = grouped.get(key) || { close: null, low: Infinity };
    entry.close = candle.close;
    if (Number.isFinite(candle.low)) entry.low = Math.min(entry.low, candle.low);
    grouped.set(key, entry);
  }
  const periodsData = [...grouped.values()];
  const currentPeriod = periodsData.at(-1);
  const previousPeriod = periodsData.at(-2);
  const periodChangeRate = previousPeriod?.close > 0
    ? ((currentPeriod.close - previousPeriod.close) / previousPeriod.close) * 100
    : null;
  const marketChangeRate = result?.meta?.regularMarketChangePercent;
  return {
    name: result?.meta?.longName || result?.meta?.shortName || "",
    close: currentDaily?.close,
    previousDayHigh: previousDaily?.high,
    changeRate: Number.isFinite(sheetChangeRate)
      ? sheetChangeRate
      : period === "일봉"
        ? Number.isFinite(marketChangeRate) ? marketChangeRate : periodChangeRate
        : periodChangeRate,
    closeLowRate: calculateCloseLowRate(currentPeriod?.close, currentPeriod?.low),
  };
}

export async function fetchStockMetrics(market, row, naverIndustries) {
  const sheetRates = row.changeRatesByPeriod || {};
  const rates = Object.values(sheetRates).length ? Object.values(sheetRates) : [row.changeRate];
  const needsCloseLowMetrics = rates.some((rate) => Number.isFinite(rate) && rate > 0 && rate < 2);
  const hasJapanesePeriods = row.marketPeriods?.length > 0
    || periods.some((period) => Object.prototype.hasOwnProperty.call(sheetRates, period));
  const needsJapanesePeriodMetrics = market === "일본" && hasJapanesePeriods;

  if (market === "한국") {
    const chartPromise = needsCloseLowMetrics
      ? (() => {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - 90);
        const dateText = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
        const chartUrl = `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(row.code)}&requestType=1&startTime=${dateText(start)}&endTime=${dateText(end)}&timeframe=day`;
        return fetchWithRetry(chartUrl);
      })()
      : Promise.resolve(null);
    const [chartResponse, stockResponse] = await Promise.all([
      chartPromise,
      fetchWithRetry(`https://m.stock.naver.com/api/stock/${encodeURIComponent(row.code)}/integration`),
    ]);
    if (chartResponse && !chartResponse.ok) throw new Error(`Naver chart HTTP ${chartResponse.status}`);
    const dailyRows = chartResponse ? parseNaverDailyRows(await chartResponse.text()) : [];
    const stockInfo = stockResponse.ok ? await stockResponse.json() : {};
    const industry = naverIndustries.get(String(stockInfo.industryCode)) || "";
    const name = stockInfo.stockName || row.name;
    const metricsByPeriod = Object.fromEntries(periods.map((period) => {
      const sheetChangeRate = sheetRates[period] ?? row.changeRate;
      const periodData = getNaverPeriodData(dailyRows, period, sheetChangeRate);
      return [period, {
        close: periodData.close,
        previousDayHigh: dailyRows.length > 1 ? Number(dailyRows.at(-2)?.[2]) : null,
        closeLowRate: periodData.closeLowRate,
        changeRate: sheetChangeRate,
      }];
    }));
    return { name, industry, metricsByPeriod };
  }

  const symbol = getYahooSymbol(row.code, market);
  const [chartResponse, searchResponse] = await Promise.all([
    needsCloseLowMetrics || needsJapanesePeriodMetrics
      ? fetchWithRetry(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`)
      : Promise.resolve(null),
    fetchWithRetry(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=10&newsCount=0`),
  ]);
  if (chartResponse && !chartResponse.ok) throw new Error(`Yahoo chart HTTP ${chartResponse.status}`);
  const result = chartResponse ? (await chartResponse.json()).chart?.result?.[0] : null;
  if (chartResponse && !result) throw new Error(`Yahoo chart data missing for ${symbol}`);
  const searchData = searchResponse.ok ? await searchResponse.json() : {};
  const stockQuote = searchData.quotes?.find((quote) => String(quote.symbol).toUpperCase() === symbol.toUpperCase());
  const industry = stockQuote?.industryDisp || stockQuote?.industry || stockQuote?.sectorDisp || stockQuote?.sector || "";
  const metricsByPeriod = Object.fromEntries(periods.map((period) => [
    period,
    getYahooMarketData(
      result,
      market,
      period,
      market === "일본" ? null : sheetRates[period] ?? row.changeRate,
    ),
  ]));
  return {
    name: result?.meta?.longName || result?.meta?.shortName || stockQuote?.longname || stockQuote?.shortname || row.name,
    industry,
    metricsByPeriod,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

export async function loadFocusRows(env, marketNames) {
  const source = await getSource(env);
  const gids = await discoverSheetGids(source);
  const rowsByMarket = {};
  const uniqueRowsByMarket = {};
  const worksheetCache = new Map();
  for (const market of marketNames) {
    rowsByMarket[market] = Object.fromEntries(await Promise.all(periods.map(async (period) => [
      period,
      await loadMarketPeriodRows(source, gids, market, period, worksheetCache),
    ])));
    const uniqueRows = new Map();
    periods.forEach((period) => {
      rowsByMarket[market][period].forEach((row) => {
        const uniqueRow = uniqueRows.get(row.code);
        if (uniqueRow) {
          uniqueRow.marketPeriods.push(period);
          uniqueRow.changeRatesByPeriod[period] = row.changeRate;
        } else {
          uniqueRows.set(row.code, {
            ...row,
            marketPeriods: [period],
            changeRatesByPeriod: { [period]: row.changeRate },
          });
        }
      });
    });
    uniqueRowsByMarket[market] = [...uniqueRows.values()].filter((row) =>
      Object.values(row.changeRatesByPeriod).some((rate) => Number.isFinite(rate) && rate > 0));
  }
  return { rowsByMarket, uniqueRowsByMarket };
}

async function getNaverIndustries() {
  const industries = new Map();
  const response = await fetchWithRetry("https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100");
  if (!response.ok) throw new Error(`Naver industry list HTTP ${response.status}`);
  const data = await response.json();
  data.groups?.forEach((group) => industries.set(String(group.no), group.name));
  return industries;
}

function buildFilteredMarketStocks(marketNames, rowsByMarket, metricsByMarket) {
  return Object.fromEntries(marketNames.map((market) => [
    market,
    Object.fromEntries(periods.map((period) => [
      period,
      rowsByMarket[market][period].map((row) => {
        const stockMetrics = metricsByMarket[market]?.[row.code];
        const metric = stockMetrics?.metricsByPeriod[period] || {};
        return {
          ...row,
          name: row.name && row.name !== row.code ? row.name : stockMetrics?.name || row.code,
          industry: stockMetrics?.industry || "업종 미분류",
          ...metric,
          bold: true,
        };
      }).filter(matchesFocusFilters),
    ])),
  ]));
}

export async function processFilteredStockQueue(env) {
  const queue = await readNotificationQueue(env);
  if (!queue.active) {
    queue.active = queue.pending.shift() || null;
    if (!queue.active) return;
  }
  const job = queue.active;

  if (job.stage === "load") {
    const { rowsByMarket, uniqueRowsByMarket } = await loadFocusRows(env, job.marketNames);
    job.stage = "metrics";
    job.rowsByMarket = rowsByMarket;
    job.uniqueRowsByMarket = uniqueRowsByMarket;
    await writeNotificationQueue(env, queue);
  }

  if (job.stage === "metrics") {
    let market = job.marketNames[job.marketIndex];
    let rows = job.uniqueRowsByMarket[market] || [];
    while (market && job.stockOffset >= rows.length) {
      job.marketIndex += 1;
      job.stockOffset = 0;
      market = job.marketNames[job.marketIndex];
      rows = job.uniqueRowsByMarket[market] || [];
    }

    if (!market) {
      job.stage = "send";
      await writeNotificationQueue(env, queue);
    } else {
      const batch = rows.slice(job.stockOffset, job.stockOffset + sendNowBatchSize[market]);
      let naverIndustries = new Map(Object.entries(job.naverIndustries || {}));
      if (market === "한국" && !job.naverIndustriesLoaded) {
        job.naverIndustriesLoaded = true;
        try {
          naverIndustries = await getNaverIndustries();
        } catch (error) {
          console.error("Unable to load Naver industry list:", error);
        }
      }
      job.naverIndustries = Object.fromEntries(naverIndustries);
      const results = await mapWithConcurrency(batch, sendNowConcurrency, async (row) => {
        try {
          return [row.code, await fetchStockMetrics(market, row, naverIndustries)];
        } catch (error) {
          console.error(`Unable to load current metrics for ${market} ${row.code}:`, error);
          return [row.code, {
            name: row.name,
            industry: "",
            metricsByPeriod: Object.fromEntries(periods.map((period) => [period, {
              changeRate: row.changeRatesByPeriod?.[period] ?? row.changeRate,
              close: null,
              previousDayHigh: null,
              closeLowRate: null,
            }])),
          }];
        }
      });
      job.metricsByMarket[market] = { ...job.metricsByMarket[market], ...Object.fromEntries(results) };
      job.stockOffset += batch.length;
      if (job.stockOffset >= rows.length) {
        job.marketIndex += 1;
        job.stockOffset = 0;
      }
      if (job.marketIndex >= job.marketNames.length) job.stage = "send";
      await writeNotificationQueue(env, queue);
      if (job.stage !== "send") return;
    }
  }

  if (job.stage === "send") {
    const stocks = buildFilteredMarketStocks(job.marketNames, job.rowsByMarket, job.metricsByMarket);
    await sendFilteredStockNotification(
      env.TELEGRAM_BOT_TOKEN,
      env.TELEGRAM_CHAT_ID,
      job.title,
      stocks,
    );
    if (job.notificationKey) {
      await env.SOURCE_CONFIG.put(`telegram-sent:${job.notificationKey}`, "1", { expirationTtl: 5184000 });
    }
    queue.active = null;
    await writeNotificationQueue(env, queue);
    return;
  }

  throw new Error(`Unknown Telegram send-now job stage: ${job.stage}`);
}

export function formatFilteredStockMessages(title, stocksByMarket) {
  const lines = [title];
  for (const market of Object.keys(stocksByMarket)) {
    lines.push("", `【${market}】`);
    for (const period of periods) {
      const stocks = stocksByMarket[market]?.[period] || [];
      lines.push("", `${period} · ${stocks.length}개`);
      if (!stocks.length) {
        lines.push("• 해당 종목 없음");
        continue;
      }
      const sortedStocks = [...stocks].sort((left, right) => {
        const leftRate = Number.isFinite(left.changeRate) ? left.changeRate : -Infinity;
        const rightRate = Number.isFinite(right.changeRate) ? right.changeRate : -Infinity;
        return rightRate - leftRate || String(left.code).localeCompare(String(right.code));
      });
      lines.push(...sortedStocks.map((stock) => {
        const industry = stock.industry && stock.industry !== "업종 미분류" ? ` (${stock.industry})` : "";
        const change = Number.isFinite(stock.changeRate) ? ` 등락 ${stock.changeRate >= 0 ? "+" : ""}${stock.changeRate.toFixed(2)}%` : "";
        return `• ${stock.code} ${stock.name}${industry}${change}`;
      }));
    }
  }

  const messages = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 3800 && current) {
      messages.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) messages.push(current);
  return messages;
}

export async function sendFilteredStockNotification(botToken, chatId, title, stocksByMarket) {
  for (const text of formatFilteredStockMessages(title, stocksByMarket)) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error("Telegram sendMessage returned an error");
  }
}

export async function sendTelegramText(botToken, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error("Telegram sendMessage returned an error");
}

export { asianMarketNames };
