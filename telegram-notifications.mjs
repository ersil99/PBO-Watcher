import { unzipSync } from "fflate";

const defaultSpreadsheetId = "1Dsr3ZQXvHs0ZwyhovHx1TeVZbkUAHvV1-57L3SqvqtI";
const markets = {
  한국: { gidByPeriod: { 일봉: "0" }, sheetName: "일봉", codeColumn: 0, nameColumn: 1, boldColumn: 1 },
  미국: { gid: "1000437246", sheetName: "미국", codeColumn: 0, nameColumn: 1, periodColumn: 5, boldColumn: 0 },
  일본: { gid: "726759276", sheetName: "일본", codeColumn: 0, nameColumn: null, periodColumn: 2, boldColumn: 0 },
  중국: { gid: "1837366506", sheetName: "중국", codeColumn: 0, nameColumn: null, periodColumn: 2, boldColumn: 0 },
};
const asianMarketNames = ["한국", "일본", "중국"];

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

export function readPublishedStocks(html, config) {
  const styleMap = new Map([...html.matchAll(/\.s(\d+)\{([^}]+)\}/g)].map((match) => [`s${match[1]}`, match[2]]));
  const stocks = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (!cells.length) continue;
    const cell = (index) => htmlText(cells[index]?.[2] || "");
    const code = cell(config.codeColumn);
    const period = config.periodColumn === undefined ? "일봉" : cell(config.periodColumn);
    const periodMatches = config.periodColumn === undefined || !period || period === "일봉";
    if (!code || code === "종목코드" || !periodMatches) continue;
    const styleName = publishedCellClass(cells[config.boldColumn]?.[1] || "");
    const style = styleMap.get(styleName) || "";
    if (!/font-weight:\s*bold/i.test(style)) continue;
    const name = config.nameColumn === null ? code : cell(config.nameColumn) || code;
    stocks.push({ code, name });
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

export function readXlsxStocks(buffer, config) {
  const files = unzipSync(new Uint8Array(buffer));
  const rows = getXlsxRows(files);
  const stocks = [];
  for (const [rowIndex, cells] of rows) {
    if (rowIndex === 0) continue;
    const code = cells.get(config.codeColumn)?.text || "";
    const name = (config.nameColumn === null ? code : cells.get(config.nameColumn)?.text) || code;
    const period = config.periodColumn === undefined ? "일봉" : cells.get(config.periodColumn)?.text || "";
    const periodMatches = config.periodColumn === undefined || !period || period === "일봉";
    if (code && code !== "종목코드" && periodMatches && cells.get(config.boldColumn)?.bold) stocks.push({ code, name });
  }
  return stocks;
}

export async function loadMarketStocks(env, marketNames) {
  const source = await getSource(env);
  const gids = await discoverSheetGids(source);
  const results = {};
  for (const market of marketNames) {
    const config = markets[market];
    if (!config) throw new Error(`Unsupported market: ${market}`);
    const gid = gids[config.sheetName] || config.gidByPeriod?.["일봉"] || config.gid;
    if (!gid) throw new Error(`Google Sheets tab not found for ${market}`);
    const url = source.type === "published"
      ? `https://docs.google.com/spreadsheets/d/e/${source.id}/pubhtml/sheet?headers=false&gid=${gid}`
      : `https://docs.google.com/spreadsheets/d/${source.id}/export?format=xlsx&gid=${gid}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${market} worksheet request failed: HTTP ${response.status}`);
    results[market] = source.type === "published"
      ? readPublishedStocks(await response.text(), config)
      : readXlsxStocks(await response.arrayBuffer(), config);
  }
  return results;
}

function formatMessages(notification, stocksByMarket) {
  const lines = [notification.title];
  for (const market of notification.markets) {
    const stocks = stocksByMarket[market] || [];
    lines.push("", `${market} · ${stocks.length}개`);
    lines.push(...(stocks.length ? stocks.map(({ code, name }) => `• ${code}${name && name !== code ? ` ${name}` : ""}`) : ["• 해당 종목 없음"]));
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

export async function sendTelegramNotification(botToken, chatId, notification, stocksByMarket) {
  for (const text of formatMessages(notification, stocksByMarket)) {
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

export { asianMarketNames };
