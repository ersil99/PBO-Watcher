const defaultSpreadsheetId = "1Dsr3ZQXvHs0ZwyhovHx1TeVZbkUAHvV1-57L3SqvqtI";
const isFileProtocol = typeof window === "undefined" || window.location.protocol === "file:";
const yahooBaseUrl = isFileProtocol ? "https://query1.finance.yahoo.com" : "/yahoo";
const naverBaseUrl = isFileProtocol ? "https://api.finance.naver.com" : "/naver";
const naverStockBaseUrl = isFileProtocol ? "https://m.stock.naver.com" : "/naver-stock";
const markets = {
  한국: { gidByPeriod: { 일봉: "0", 주봉: "1097197674", 월봉: "2089529874" }, sheetName: "일봉", codeColumn: 0, nameColumn: 1, changeColumn: 2, boldColumn: 1, colorColumn: 1, source: "naver" },
  미국: { gid: "1000437246", sheetName: "미국", codeColumn: 0, nameColumn: 1, changeColumn: 2, periodColumn: 5, boldColumn: 0, colorColumn: 0, colorTarget: "code", source: "yahoo" },
  일본: { gid: "726759276", sheetName: "일본", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0, colorColumn: 0, source: "yahoo" },
  중국: { gid: "1837366506", sheetName: "중국", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0, colorColumn: 0, source: "yahoo" },
};
const savedSourceType = typeof localStorage !== "undefined" ? localStorage.getItem("pbo-source-type") || "xlsx" : "xlsx";
const savedSpreadsheetId = typeof localStorage !== "undefined" ? localStorage.getItem("pbo-source-id") || defaultSpreadsheetId : defaultSpreadsheetId;
const savedSourceUrl = typeof localStorage !== "undefined" ? localStorage.getItem("pbo-source-url") || "" : "";
const state = { rows: [], updatedAt: null, market: "한국", period: "일봉", view: "stocks", industrySummary: null, industryLoading: false, industryRequestId: 0, spreadsheetId: savedSpreadsheetId, sourceType: savedSourceType, sourceUrl: savedSourceUrl, tabCache: new Map(), industrySummaryCache: new Map(), industryLookupCache: new Map(), isLoading: false, loadingKey: null };
let loadSequence = 0;
let naverIndustryNamesPromise = null;
const sourceStorageKeys = ["pbo-source-id", "pbo-source-type", "pbo-source-url"];
const sourceChannel = typeof document !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pbo-source-sync") : null;
const sourceConfigEndpoint = isFileProtocol ? null : "/api/source-config";

function buildTabCacheKey(market, period) {
  return `${market}|${period}`;
}

function readCachedRows(market, period) {
  const key = buildTabCacheKey(market, period);
  return state.tabCache.get(key) || null;
}

function clearSourceCache() {
  state.industryRequestId += 1;
  state.industryLoading = false;
  state.industrySummary = null;
  state.tabCache.clear();
  state.industrySummaryCache.clear();
  state.industryLookupCache.clear();
  state.rows = [];
  state.updatedAt = null;
}

function applyStoredSource(source) {
  if (!source?.id || !source.type) return false;
  const changed = state.spreadsheetId !== source.id || state.sourceType !== source.type || state.sourceUrl !== source.url;
  if (!changed) return false;
  state.spreadsheetId = source.id;
  state.sourceType = source.type;
  state.sourceUrl = source.url || "";
  clearSourceCache();
  if (sourceUrlElement) sourceUrlElement.value = getStoredSourceUrl();
  return true;
}

function readStoredSource() {
  return {
    id: localStorage.getItem("pbo-source-id"),
    type: localStorage.getItem("pbo-source-type"),
    url: localStorage.getItem("pbo-source-url") || "",
  };
}

async function loadSharedSource() {
  if (!sourceConfigEndpoint) return null;
  try {
    const response = await fetch(sourceConfigEndpoint, { cache: "no-store" });
    if (!response.ok) return null;
    const source = await response.json();
    if (source) applyStoredSource(source);
    return source;
  } catch {
    return null;
  }
}

async function saveSharedSource(source) {
  if (!sourceConfigEndpoint) return false;
  try {
    const response = await fetch(sourceConfigEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(source),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function syncSource(source) {
  if (!applyStoredSource(source)) return;
  sourceMessageElement.textContent = "변경된 소스를 불러오는 중...";
  try {
    const gids = state.sourceType === "published"
      ? await discoverPublishedSheetGids(state.spreadsheetId)
      : await discoverSheetGids(state.spreadsheetId);
    applySheetGids(gids);
    sourceMessageElement.textContent = "변경된 소스를 사용 중입니다.";
  } catch (error) {
    sourceMessageElement.textContent = error.message;
  }
  if (state.view === "industry") loadIndustrySummary();
  else loadCodes();
}

if (typeof module !== "undefined") module.exports = { buildTabCacheKey, buildIndustryNameMap, findYahooIndustry, buildIndustrySummary };

const listElement = typeof document !== "undefined" ? document.querySelector("#list") : null;
const countElement = typeof document !== "undefined" ? document.querySelector("#count") : null;
const updatedElement = typeof document !== "undefined" ? document.querySelector("#updated") : null;
const footerTimeElement = typeof document !== "undefined" ? document.querySelector("#footer-time") : null;
const statusElement = typeof document !== "undefined" ? document.querySelector("#status") : null;
const searchElement = typeof document !== "undefined" ? document.querySelector("#search") : null;
const rateFilterElement = typeof document !== "undefined" ? document.querySelector("#rate-filter") : null;
const focusFilterElement = typeof document !== "undefined" ? document.querySelector("#focus-filter") : null;
const industryToggleElement = typeof document !== "undefined" ? document.querySelector("#industry-toggle") : null;
const sourceToggleElement = typeof document !== "undefined" ? document.querySelector("#source-toggle") : null;
const sourceFormElement = typeof document !== "undefined" ? document.querySelector("#source-form") : null;
const sourceUrlElement = typeof document !== "undefined" ? document.querySelector("#source-url") : null;
const sourceMessageElement = typeof document !== "undefined" ? document.querySelector("#source-message") : null;
const chartPanelElement = typeof document !== "undefined" ? document.querySelector("#chart-panel") : null;
const chartPlotElement = typeof document !== "undefined" ? document.querySelector("#chart-plot") : null;
const chartTitleElement = typeof document !== "undefined" ? document.querySelector("#chart-title") : null;
const chartSymbolElement = typeof document !== "undefined" ? document.querySelector("#chart-symbol") : null;

function extractSpreadsheetId(value) {
  const match = value.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function isPublishedSpreadsheet(value) {
  return /\/spreadsheets\/d\/e\//.test(value) || value.includes("/pubhtml");
}

function getStoredSourceUrl() {
  if (state.sourceUrl) return state.sourceUrl;
  if (state.sourceType === "published") return `https://docs.google.com/spreadsheets/d/e/${state.spreadsheetId}/pubhtml`;
  return `https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit`;
}

async function discoverSheetGids(spreadsheetId) {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=drivesdk`, { cache: "no-store" });
  if (!response.ok) throw new Error("스프레드시트에 접근할 수 없습니다.");
  const html = await response.text();
  const gids = {};
  const pattern = /\[\d+,\d+,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^\\]+)\\"/g;
  for (const match of html.matchAll(pattern)) gids[match[2]] = match[1];
  if (!Object.keys(gids).length) throw new Error("시트 탭을 찾지 못했습니다. 스프레드시트 접근 권한과 탭 이름을 확인해 주세요.");
  return gids;
}

async function discoverPublishedSheetGids(publishedId) {
  const baseUrl = `https://docs.google.com/spreadsheets/d/e/${publishedId}/pubhtml`;
  const response = await fetch(baseUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("게시된 스프레드시트에 접근할 수 없습니다.");
  const html = await response.text();
  const gids = {};
  const pattern = /items\.push\(\{name:\s*\\?"([^"\\]+)\\?"[\s\S]*?gid:\s*\\?"(\d+)/g;
  for (const match of html.matchAll(pattern)) gids[match[1]] = match[2];
  if (!Object.keys(gids).length) throw new Error("게시된 시트 탭을 찾지 못했습니다. '웹에 게시'가 완료됐는지 확인하고 게시 링크를 다시 입력해 주세요.");
  return gids;
}

async function readPublishedRows(publishedId, gid, config, period) {
  const url = `https://docs.google.com/spreadsheets/d/e/${publishedId}/pubhtml/sheet?headers=false&gid=${gid}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("게시된 시트 데이터를 읽을 수 없습니다.");
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const styleMap = new Map();
  for (const match of html.matchAll(/\.s(\d+)\{([^}]+)\}/g)) {
    styleMap.set(`s${match[1]}`, match[2]);
  }
  const rows = [];
  for (const tableRow of document.querySelectorAll("table tr")) {
    const cells = [...tableRow.querySelectorAll(":scope > td")];
    if (!cells.length) continue;
    const code = cellText({ v: cells[config.codeColumn]?.textContent });
    const name = config.nameColumn === null ? "" : cellText({ v: cells[config.nameColumn]?.textContent });
    const changeRate = Number(cellText({ v: cells[config.changeColumn]?.textContent }).replace(/,/g, ""));
    const periodValue = config.periodColumn === undefined ? period : cellText({ v: cells[config.periodColumn]?.textContent });
    const matchesPeriod = config.periodColumn === undefined
      || (period === "일봉" ? !periodValue || periodValue === "일봉" : periodValue === period);
    if (!code || code === "종목코드" || !matchesPeriod) continue;
    const boldStyle = styleMap.get(cells[config.boldColumn]?.className) || "";
    const colorStyle = styleMap.get(cells[config.colorColumn]?.className) || "";
    const color = colorStyle.match(/(?:^|;)color:\s*(#[0-9a-f]{6})/i)?.[1] || null;
    rows.push({ code, name: name || code, changeRate: Number.isFinite(changeRate) ? changeRate : 0, hasSheetRate: Number.isFinite(changeRate), bold: /font-weight:bold/.test(boldStyle), color });
  }
  return rows;
}

function applySheetGids(gids) {
  ["일봉", "주봉", "월봉"].forEach((name) => {
    markets.한국.gidByPeriod[name] = gids[name] || markets.한국.gidByPeriod[name];
  });
  ["미국", "일본", "중국"].forEach((name) => {
    if (gids[name]) markets[name].gid = gids[name];
  });
}

function getCellFontStyles(workbook) {
  const stylesXml = new TextDecoder().decode(workbook.files["xl/styles.xml"].content);
  const sheetXml = new TextDecoder().decode(workbook.files["xl/worksheets/sheet1.xml"].content);
  const stylesDocument = new DOMParser().parseFromString(stylesXml, "application/xml");
  const sheetDocument = new DOMParser().parseFromString(sheetXml, "application/xml");
  const fonts = [...stylesDocument.querySelectorAll("fonts > font")];
  const cellFormats = [...stylesDocument.querySelectorAll("cellXfs > xf")];
  const styles = new Map();
  sheetDocument.querySelectorAll("c[r]").forEach((cell) => {
    const styleIndex = Number(cell.getAttribute("s") || 0);
    const fontId = Number(cellFormats[styleIndex]?.getAttribute("fontId") || 0);
    const font = fonts[fontId];
    const color = font?.querySelector("color")?.getAttribute("rgb");
    styles.set(cell.getAttribute("r"), { bold: Boolean(font?.querySelector("b")), color: color ? `#${color.slice(-6)}` : null });
  });
  return styles;
}

function buildIndustryNameMap(groups) {
  return new Map((groups || []).map((group) => [String(group.no), group.name]));
}

function findYahooIndustry(quotes, symbol) {
  const quote = (quotes || []).find((item) => String(item.symbol).toUpperCase() === symbol.toUpperCase());
  return quote?.industryDisp || quote?.industry || quote?.sectorDisp || quote?.sector || "";
}

function buildIndustrySummary(rowsByPeriod, industriesByCode) {
  const summary = new Map();
  ["일봉", "주봉", "월봉"].forEach((period) => {
    const uniqueCodes = new Set();
    (rowsByPeriod[period] || []).forEach((row) => {
      if (!row.code || uniqueCodes.has(row.code)) return;
      uniqueCodes.add(row.code);
      const industry = industriesByCode.get(row.code) || "업종 미분류";
      const entry = summary.get(industry) || { industry, 일봉: 0, 주봉: 0, 월봉: 0, total: 0 };
      entry[period] += 1;
      entry.total += 1;
      summary.set(industry, entry);
    });
  });
  return [...summary.values()].sort((left, right) => right.total - left.total || left.industry.localeCompare(right.industry, "ko"));
}

function cellText(cell) {
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function rateClass(value) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "";
}

function readableTextColor(color) {
  const match = String(color || "").match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16));
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance < 220 ? match[0] : null;
}

function getChartSymbol(code, market) {
  if (market === "한국") return `${code.startsWith("0") || code.length === 6 ? "KRX" : "KOSDAQ"}:${code}`;
  if (market === "일본") return `TSE:${code.padStart(4, "0")}`;
  if (market === "중국") return `${code.startsWith("6") ? "SSE" : "SZSE"}:${code.padStart(6, "0")}`;
  return code;
}

function getTradingViewInterval(period) {
  return period === "주봉" ? "W" : period === "월봉" ? "M" : "D";
}

function buildTradingViewEmbedUrl(symbol, interval) {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: "light",
    locale: "kr",
    timezone: "Asia/Seoul",
    hidesidetoolbar: "0",
    hideideas: "1",
    allow_symbol_change: "0",
  });
  return `https://www.tradingview.com/widgetembed/?${params}`;
}

function drawChart(points) {
  if (!points.length) {
    chartPlotElement.innerHTML = "<div class=\"chart-empty\">차트 데이터를 불러오지 못했습니다.</div>";
    return;
  }
  const width = 900;
  const height = 500;
  const padding = { top: 18, right: 12, bottom: 30, left: 12 };
  const priceBottom = 330;
  const volumeTop = 370;
  const values = points.flatMap((point) => [point.high, point.low, point.ma20].filter(Number.isFinite));
  const logValues = values.map((value) => Math.log(Math.max(value, 0.000001)));
  const min = Math.min(...logValues);
  const max = Math.max(...logValues);
  const span = max - min || 1;
  const maxVolume = Math.max(...points.map((point) => point.volume || 0), 1);
  const x = (index) => padding.left + (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value) => padding.top + (1 - (Math.log(Math.max(value, 0.000001)) - min) / span) * (priceBottom - padding.top);
  const volumeY = (value) => volumeTop + (1 - value / maxVolume) * (height - volumeTop - padding.bottom);
  const ma20Line = points.map((point, index) => Number.isFinite(point.ma20) ? `${x(index).toFixed(1)},${y(point.ma20).toFixed(1)}` : null).filter(Boolean).join(" ");
  const volumeMaLine = points.map((point, index) => Number.isFinite(point.volumeMa30) ? `${x(index).toFixed(1)},${volumeY(point.volumeMa30).toFixed(1)}` : null).filter(Boolean).join(" ");
  const candleWidth = Math.max(1.5, Math.min(8, (width - padding.left - padding.right) / points.length * .62));
  const candles = points.map((point, index) => {
    const color = point.close >= point.open ? "#16835c" : "#ef745e";
    const center = x(index);
    const bodyTop = y(Math.max(point.open, point.close));
    const bodyHeight = Math.max(1, Math.abs(y(point.open) - y(point.close)));
    const volumeHeight = height - padding.bottom - volumeY(point.volume || 0);
    return `<line x1="${center.toFixed(1)}" y1="${y(point.high).toFixed(1)}" x2="${center.toFixed(1)}" y2="${y(point.low).toFixed(1)}" stroke="${color}" stroke-width="1"></line><rect x="${(center - candleWidth / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}" fill="${color}"></rect><rect x="${(center - candleWidth / 2).toFixed(1)}" y="${volumeY(point.volume || 0).toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${volumeHeight.toFixed(1)}" fill="${color}" opacity=".42"></rect>`;
  }).join("");
  const firstLabel = points[0].label;
  const lastLabel = points.at(-1).label;
  chartPlotElement.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><line class="chart-grid" x1="${padding.left}" y1="${priceBottom + 18}" x2="${width - padding.right}" y2="${priceBottom + 18}"></line><text class="chart-label" x="${padding.left}" y="${priceBottom + 14}">로그 가격 / 20일선</text><text class="chart-label" x="${padding.left}" y="${volumeTop - 8}">거래량 / 30일평균</text>${candles}<polyline class="chart-ma" points="${ma20Line}"></polyline><polyline class="chart-volume-ma" points="${volumeMaLine}"></polyline><text class="chart-label" x="${padding.left}" y="${height - 8}">${firstLabel}</text><text class="chart-label" text-anchor="end" x="${width - padding.right}" y="${height - 8}">${lastLabel}</text></svg>`;
}

function addMovingAverages(points) {
  return points.map((point, index) => {
    const priceWindow = points.slice(Math.max(0, index - 19), index + 1).map((item) => item.close);
    const volumeWindow = points.slice(Math.max(0, index - 29), index + 1).map((item) => item.volume);
    return { ...point, ma20: priceWindow.reduce((sum, value) => sum + value, 0) / priceWindow.length, volumeMa30: volumeWindow.reduce((sum, value) => sum + value, 0) / volumeWindow.length };
  });
}

async function getChartPoints(row) {
  const config = markets[state.market];
  if (config.source === "naver") {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (state.period === "월봉" ? 365 : state.period === "주봉" ? 180 : 45));
    const formatDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
    const response = await fetch(`${naverBaseUrl}/siseJson.naver?symbol=${row.code}&requestType=1&startTime=${formatDate(start)}&endTime=${formatDate(today)}&timeframe=day`, { cache: "no-store" });
    if (!response.ok) throw new Error("chart request failed");
    const points = JSON.parse((await response.text()).replace(/'/g, '"')).slice(1).filter((item) => Array.isArray(item) && Number.isFinite(Number(item[4]))).map((item) => ({ label: String(item[0]).slice(4, 6) + "/" + String(item[0]).slice(6, 8), open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]), volume: Number(item[5]) || 0 }));
    return addMovingAverages(points);
  }
  const symbol = getYahooSymbol(row.code, state.market);
  const range = state.period === "월봉" ? "2y" : state.period === "주봉" ? "1y" : "1mo";
  const response = await fetch(`${yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { cache: "no-store" });
  if (!response.ok) throw new Error("chart request failed");
  const result = (await response.json()).chart.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const points = (result?.timestamp || []).map((timestamp, index) => ({ label: new Date(timestamp * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }), open: quote?.open?.[index], high: quote?.high?.[index], low: quote?.low?.[index], close: quote?.close?.[index], volume: quote?.volume?.[index] || 0 })).filter((point) => [point.open, point.high, point.low, point.close].every(Number.isFinite));
  return addMovingAverages(points);
}

async function openChart(row) {
  chartTitleElement.textContent = `${row.name} ${state.period} 차트`;
  const symbol = getChartSymbol(row.code, state.market);
  chartSymbolElement.textContent = symbol;
  chartPanelElement.hidden = false;
  if (state.market === "한국" || state.market === "일본") {
    chartPlotElement.innerHTML = "<div class=\"chart-empty\">차트 불러오는 중...</div>";
    chartPanelElement.scrollIntoView({ behavior: "smooth", block: "start" });
    try { drawChart(await getChartPoints(row)); }
    catch { chartPlotElement.innerHTML = "<div class=\"chart-empty\">차트 데이터를 불러오지 못했습니다.</div>"; }
    return;
  }
  const chartFrame = document.createElement("iframe");
  chartFrame.title = `${row.name} TradingView 차트`;
  chartFrame.src = buildTradingViewEmbedUrl(symbol, getTradingViewInterval(state.period));
  chartFrame.loading = "eager";
  chartFrame.referrerPolicy = "origin";
  chartPlotElement.replaceChildren(chartFrame);
  chartPanelElement.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderIndustrySummary() {
  listElement.classList.add("industry-view");
  listElement.innerHTML = "";
  if (state.industryLoading) {
    const loading = document.createElement("p");
    loading.className = "empty";
    loading.textContent = "일봉·주봉·월봉 업종별 종목 수 집계 중...";
    listElement.append(loading);
    return;
  }
  const query = searchElement.value.trim().toLowerCase();
  const rows = (state.industrySummary || []).filter((row) => row.industry.toLowerCase().includes(query));
  countElement.textContent = query ? `${rows.length}/${state.industrySummary?.length || 0}` : rows.length;
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "집계된 업종이 없습니다.";
    listElement.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "stock-table industry-table";
  table.innerHTML = "<thead><tr><th>업종</th><th>일봉</th><th>주봉</th><th>월봉</th><th>합계</th></tr></thead>";
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    [row.industry, row["일봉"], row["주봉"], row["월봉"], row.total].forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 4) cell.className = "industry-total";
      tableRow.append(cell);
    });
    body.append(tableRow);
  });
  table.append(body);
  listElement.append(table);
}

function render() {
  if (state.view === "industry") {
    renderIndustrySummary();
    return;
  }
  listElement.classList.remove("industry-view");
  const query = searchElement.value.trim().toLowerCase();
  const rateHeader = state.period === "주봉" ? "이번주 등락률" : state.period === "월봉" ? "이번달 등락률" : "오늘 등락률";
  const volumeHeader = state.period === "주봉" ? "전주 대비 거래량" : state.period === "월봉" ? "전월 대비 거래량" : "전일 대비 오늘 거래량";
  const currentKey = buildTabCacheKey(state.market, state.period);
  const visibleRows = state.rows
    .filter((row) => !focusFilterElement.checked || row.bold)
    .filter((row) => !rateFilterElement.checked || row.changeRate >= 2)
    .filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const boldOrder = Number(right.bold) - Number(left.bold);
      if (boldOrder) return boldOrder;
      const rateOrder = right.changeRate - left.changeRate;
      if (rateOrder) return rateOrder;
      return (right.volumeChange ?? Number.NEGATIVE_INFINITY) - (left.volumeChange ?? Number.NEGATIVE_INFINITY);
    });
  countElement.textContent = query ? `${visibleRows.length}/${state.rows.length}` : state.rows.length;
  listElement.innerHTML = "";

  const statusText = statusElement ? statusElement.textContent : "";
  const isCurrentLoading = state.loadingKey === currentKey || state.isLoading || statusText.includes("시트 읽는 중") || statusText.includes("데이터 확인 중") || statusText.includes("로딩 중");
  if (isCurrentLoading) {
    const loading = document.createElement("p");
    loading.className = "empty";
    loading.textContent = "로딩 중...";
    listElement.append(loading);
    return;
  }

  if (!visibleRows.length && state.rows.length === 0 && !state.isLoading && state.loadingKey === null) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "검색 결과가 없습니다.";
    listElement.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "stock-table";
  table.innerHTML = `<thead><tr><th>종목명</th><th>${rateHeader}</th><th>${volumeHeader}</th></tr></thead>`;
  const body = document.createElement("tbody");
  visibleRows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.dataset.code = row.code;
    tableRow.dataset.name = row.name;
    tableRow.tabIndex = 0;
    tableRow.setAttribute("aria-label", `${row.name}${row.industry ? ` ${row.industry}` : ""} ${state.period} 차트 열기`);
    tableRow.innerHTML = `<td><div class="stock-title"><strong class="stock-name"></strong><span class="stock-industry"></span></div><span class="stock-code"></span></td><td><span class="rate"></span></td><td><span class="volume-change"></span><span class="volume-total"></span></td>`;
    const stockName = tableRow.querySelector(".stock-name");
    stockName.textContent = row.name;
    stockName.classList.toggle("is-bold", row.bold);
    tableRow.querySelector(".stock-industry").textContent = row.industry || "";
    const textColor = readableTextColor(row.color);
    if (textColor) stockName.style.color = textColor;
    const stockCode = tableRow.querySelector(".stock-code");
    stockCode.textContent = row.code;
    if (textColor && markets[state.market].colorTarget === "code") stockCode.style.color = textColor;
    const rate = tableRow.querySelector(".rate");
    rate.textContent = `${row.changeRate > 0 ? "+" : ""}${row.changeRate.toFixed(2)}%`;
    const rateColor = rateClass(row.changeRate);
    if (rateColor) rate.classList.add(rateColor);
    const volumeChange = tableRow.querySelector(".volume-change");
    volumeChange.textContent = row.volumeChange === null ? "--" : `${row.volumeChange.toFixed(1)}%`;
    const volumeColor = row.volumeChange === null ? "" : rateClass(row.volumeChange - 100);
    if (volumeColor) volumeChange.classList.add(volumeColor);
    const volumeLabel = state.period === "일봉" ? "오늘" : `${state.period === "주봉" ? "이번주" : "이번달"} 일평균`;
    tableRow.querySelector(".volume-total").textContent = row.volume === null ? "거래량 확인 불가" : `${volumeLabel} ${formatNumber(Math.round(row.volume))}주`;
    body.append(tableRow);
  });
  table.append(body);
  listElement.append(table);
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

function getPeriodVolumes(rows, period) {
  if (period === "일봉") {
    return { volume: Number(rows.at(-1)?.[5]) || null, previousVolume: Number(rows.at(-2)?.[5]) || null };
  }
  const grouped = new Map();
  rows.forEach((row) => {
    const key = getPeriodKey(String(row[0]), period);
    const entry = grouped.get(key) || { total: 0, days: 0 };
    entry.total += Number(row[5]) || 0;
    entry.days += 1;
    grouped.set(key, entry);
  });
  const values = [...grouped.values()];
  const current = values.at(-1);
  const previous = values.at(-2);
  return {
    volume: current?.days ? current.total / current.days : null,
    previousVolume: previous?.days ? previous.total / previous.days : null,
    currentAverageVolume: current?.days ? current.total / current.days : null,
  };
}

function getPeriodCloses(rows, period) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = getPeriodKey(String(row[0]), period);
    grouped.set(key, Number(row[4]));
  });
  return [...grouped.values()].filter((value) => Number.isFinite(value));
}

async function getNaverData(code, period) {
  const industryPromise = getNaverIndustry(code).catch(() => "");
  const today = new Date();
  const endTime = today.toISOString().slice(0, 10).replaceAll("-", "");
  const start = new Date(today);
  start.setDate(start.getDate() - (period === "월봉" ? 120 : 45));
  const startTime = start.toISOString().slice(0, 10).replaceAll("-", "");
  const url = `${naverBaseUrl}/siseJson.naver?symbol=${code}&requestType=1&startTime=${startTime}&endTime=${endTime}&timeframe=day`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Volume HTTP ${response.status}`);
  const rows = JSON.parse((await response.text()).replace(/'/g, '"')).slice(1).filter((row) => Array.isArray(row) && row.length > 5);
  const { volume, previousVolume, currentAverageVolume } = getPeriodVolumes(rows, period);
  const closes = getPeriodCloses(rows, period);
  const close = closes.at(-1);
  const previousClose = closes.at(-2);
  return {
    industry: await industryPromise,
    volume: volume || null,
    volumeChange: previousVolume ? ((period === "일봉" ? volume : currentAverageVolume) / previousVolume) * 100 : null,
    changeRate: previousClose ? ((close - previousClose) / previousClose) * 100 : null,
  };
}

async function getNaverIndustry(code) {
  if (!naverIndustryNamesPromise) {
    naverIndustryNamesPromise = fetch(`${naverStockBaseUrl}/api/stocks/industry?page=1&pageSize=100`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Naver 업종 목록을 읽을 수 없습니다.");
        return response.json();
      })
      .then((data) => buildIndustryNameMap(data.groups));
    naverIndustryNamesPromise.catch(() => { naverIndustryNamesPromise = null; });
  }
  const [names, response] = await Promise.all([
    naverIndustryNamesPromise,
    fetch(`${naverStockBaseUrl}/api/stock/${encodeURIComponent(code)}/integration`, { cache: "no-store" }),
  ]);
  if (!response.ok) return "";
  const data = await response.json();
  return names.get(String(data.industryCode)) || "";
}

function getYahooSymbol(code, market) {
  if (market === "일본") return `${code.padStart(4, "0")}.T`;
  if (market === "중국") return `${code.startsWith("6") ? code.padStart(6, "0") + ".SS" : code.padStart(6, "0") + ".SZ"}`;
  return code;
}

function getYahooPeriodKey(timestamp, period, market) {
  if (period === "일봉") return new Intl.DateTimeFormat("en-CA", { timeZone: market === "일본" ? "Asia/Tokyo" : market === "중국" ? "Asia/Shanghai" : "America/New_York" }).format(new Date(timestamp * 1000));
  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: market === "일본" ? "Asia/Tokyo" : market === "중국" ? "Asia/Shanghai" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (period === "월봉") return `${values.year}-${values.month}`;
  const localDate = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
  const day = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() - day + 1);
  return localDate.toISOString().slice(0, 10);
}

async function getYahooData(code, market, period) {
  const symbol = getYahooSymbol(code, market);
  const industryPromise = getYahooIndustry(code, market).catch(() => "");
  const range = period === "월봉" ? "2y" : period === "주봉" ? "1y" : "1mo";
  const response = await fetch(`${yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { cache: "no-store" });
  if (!response.ok) throw new Error("Yahoo 시세를 읽을 수 없습니다.");
  const result = (await response.json()).chart.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0];
  const grouped = new Map();
  (result?.timestamp || []).forEach((timestamp, index) => {
    const close = quote?.close?.[index];
    const volume = quote?.volume?.[index];
    if (!Number.isFinite(close)) return;
    const key = getYahooPeriodKey(timestamp, period, market);
    const entry = grouped.get(key) || { close: null, volume: 0, days: 0 };
    entry.close = close;
    entry.volume += Number.isFinite(volume) ? volume : 0;
    entry.days += 1;
    grouped.set(key, entry);
  });
  const periods = [...grouped.values()];
  const current = periods.at(-1);
  const previous = periods.at(-2);
  const currentAverageVolume = current?.volume / (current?.days || 1);
  const previousAverageVolume = previous?.volume / (previous?.days || 1);
  return {
    industry: await industryPromise,
    name: meta.longName || meta.shortName || code,
    volume: currentAverageVolume || null,
    volumeChange: previousAverageVolume ? (currentAverageVolume / previousAverageVolume) * 100 : null,
    changeRate: period === "일봉" && Number.isFinite(meta.regularMarketChangePercent)
      ? meta.regularMarketChangePercent
      : previous?.close ? ((current.close - previous.close) / previous.close) * 100 : null,
  };
}

async function getYahooIndustry(code, market) {
  const symbol = getYahooSymbol(code, market);
  const response = await fetch(`${yahooBaseUrl}/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=10&newsCount=0`, { cache: "no-store" });
  if (!response.ok) return "";
  const data = await response.json();
  return findYahooIndustry(data.quotes, symbol);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function readMarketRows(market, period) {
  const config = markets[market];
  const gid = config.gidByPeriod?.[period] || config.gid;
  if (state.sourceType === "published") {
    return readPublishedRows(state.spreadsheetId, gid, config, period);
  }

  const response = await fetch(`https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/export?format=xlsx&gid=${gid}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const workbook = XLSX.read(await response.arrayBuffer(), { cellStyles: true, cellNF: true, bookFiles: true });
  const sheet = workbook.Sheets[workbook.SheetNames.find((name) => name === config.sheetName) || workbook.SheetNames[0]];
  if (!sheet) throw new Error(`${market} 시트를 찾을 수 없습니다.`);
  const cellFontStyles = getCellFontStyles(workbook);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:B1");
  const rows = [];
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const code = cellText(sheet[XLSX.utils.encode_cell({ r: row, c: config.codeColumn })]);
    const name = config.nameColumn === null ? code : cellText(sheet[XLSX.utils.encode_cell({ r: row, c: config.nameColumn })]);
    const changeRate = Number(cellText(sheet[XLSX.utils.encode_cell({ r: row, c: config.changeColumn })]).replace(/,/g, ""));
    const boldCellRef = XLSX.utils.encode_cell({ r: row, c: config.boldColumn });
    const colorCellRef = XLSX.utils.encode_cell({ r: row, c: config.colorColumn });
    const boldStyle = cellFontStyles.get(boldCellRef);
    const colorStyle = cellFontStyles.get(colorCellRef);
    const periodValue = config.periodColumn === undefined ? period : cellText(sheet[XLSX.utils.encode_cell({ r: row, c: config.periodColumn })]);
    const matchesPeriod = config.periodColumn === undefined
      || (period === "일봉" ? !periodValue || periodValue === "일봉" : periodValue === period);
    if (code && matchesPeriod) rows.push({ code, name, changeRate: Number.isFinite(changeRate) ? changeRate : 0, hasSheetRate: Number.isFinite(changeRate), bold: Boolean(boldStyle?.bold), color: colorStyle?.color });
  }
  return rows;
}

async function loadIndustrySummary() {
  const market = state.market;
  const cacheKey = `${state.spreadsheetId}|${market}|${focusFilterElement.checked}|${rateFilterElement.checked}`;
  const cached = state.industrySummaryCache.get(cacheKey);
  const requestId = ++state.industryRequestId;
  state.industryLoading = !cached;
  state.industrySummary = cached || null;
  if (statusElement) statusElement.textContent = cached ? `${cached.length}개 업종` : "업종별 종목 집계 중";
  render();
  if (cached) return;

  try {
    const periods = ["일봉", "주봉", "월봉"];
    const rowsByPeriodEntries = await Promise.all(periods.map(async (period) => {
      const periodCache = readCachedRows(market, period);
      return [period, periodCache?.rows || await readMarketRows(market, period)];
    }));
    const rowsByPeriod = Object.fromEntries(rowsByPeriodEntries);
    const industryByCode = new Map();
    const codes = [...new Set(Object.values(rowsByPeriod).flat().map((row) => row.code).filter(Boolean))];
    codes.forEach((code) => {
      const cachedIndustry = state.industryLookupCache.get(`${market}|${code}`)
        || Object.values(rowsByPeriod).flat().find((row) => row.code === code && row.industry)?.industry;
      if (cachedIndustry) industryByCode.set(code, cachedIndustry);
    });
    const unresolvedCodes = codes.filter((code) => !industryByCode.has(code));
    const resolved = await mapWithConcurrency(unresolvedCodes, 8, async (code) => {
      try {
        const industry = market === "한국"
          ? await getNaverIndustry(code)
          : await getYahooIndustry(code, market);
        if (industry) state.industryLookupCache.set(`${market}|${code}`, industry);
        return [code, industry];
      } catch {
        return [code, ""];
      }
    });
    resolved.forEach(([code, industry]) => {
      if (industry) industryByCode.set(code, industry);
    });
    if (requestId !== state.industryRequestId) return;
    const applyFilters = (rows) => rows
      .filter((row) => !focusFilterElement.checked || row.bold)
      .filter((row) => !rateFilterElement.checked || row.changeRate >= 2);
    const filteredRowsByPeriod = Object.fromEntries(periods.map((period) => [period, applyFilters(rowsByPeriod[period])]));
    state.industrySummary = buildIndustrySummary(filteredRowsByPeriod, industryByCode);
    state.industrySummaryCache.set(cacheKey, state.industrySummary);
    state.industryLoading = false;
    if (statusElement) statusElement.textContent = `${state.industrySummary.length}개 업종`;
    render();
  } catch (error) {
    if (requestId !== state.industryRequestId) return;
    state.industryLoading = false;
    state.industrySummary = [];
    if (statusElement) statusElement.textContent = "업종 집계 실패";
    listElement.innerHTML = `<p class="empty">업종별 목록을 불러오지 못했습니다. ${error.message}</p>`;
  }
}

async function loadCodes() {
  const requestId = ++loadSequence;
  const market = state.market;
  const period = state.period;
  const key = buildTabCacheKey(market, period);
  const cached = readCachedRows(market, period);
  state.isLoading = !cached;
  state.loadingKey = cached ? null : key;
  if (!cached) {
    state.rows = [];
  }
  if (cached) {
    state.rows = cached.rows;
    state.updatedAt = cached.updatedAt;
    if (statusElement) statusElement.textContent = `${state.rows.length}개 종목 확인`;
    if (updatedElement) updatedElement.textContent = `${cached.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준`;
    if (footerTimeElement) footerTimeElement.textContent = cached.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    render();
  } else {
    if (statusElement) statusElement.textContent = "시트 읽는 중";
    if (updatedElement) updatedElement.textContent = "데이터 확인 중";
    render();
  }

  const config = markets[market];
  try {
    const rows = await readMarketRows(market, period);

    const initialRows = rows.map((row) => ({ ...row, volume: null, volumeChange: null }));
    if (requestId !== loadSequence) return;
    state.rows = initialRows;
    state.updatedAt = new Date();
    const needsNameLookup = config.nameColumn === null;
    state.isLoading = needsNameLookup;
    state.loadingKey = needsNameLookup ? key : null;
    state.tabCache.set(key, { rows: initialRows, updatedAt: state.updatedAt });
    const time = state.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    if (updatedElement) updatedElement.textContent = `${time} 기준`;
    if (footerTimeElement) footerTimeElement.textContent = time;
    if (statusElement) statusElement.textContent = needsNameLookup ? `${state.rows.length}개 종목 이름 확인 중` : `${state.rows.length}개 종목 확인`;
    render();

    const enrichedRows = await Promise.all(rows.map(async (row) => {
      try {
        const quote = config.source === "naver" ? await getNaverData(row.code, period) : await getYahooData(row.code, market, period);
        return { ...row, ...quote, changeRate: quote.changeRate ?? row.changeRate };
      }
      catch { return { ...row, volume: null, volumeChange: null }; }
    }));
    if (requestId !== loadSequence) return;
    state.rows = enrichedRows.map((row) => ({ ...row, name: row.name && row.name !== row.code ? row.name : row.code }));
    state.updatedAt = new Date();
    state.isLoading = false;
    state.loadingKey = null;
    state.tabCache.set(key, { rows: enrichedRows, updatedAt: state.updatedAt });
    const refreshedTime = state.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    if (updatedElement) updatedElement.textContent = `${refreshedTime} 기준`;
    if (footerTimeElement) footerTimeElement.textContent = refreshedTime;
    if (statusElement) statusElement.textContent = `${state.rows.length}개 종목 확인`;
    render();
  } catch (error) {
    if (requestId !== loadSequence) return;
    state.isLoading = false;
    state.loadingKey = null;
    state.rows = cached ? cached.rows : [];
    if (countElement) countElement.textContent = cached ? state.rows.length : "!";
    if (statusElement) statusElement.textContent = cached ? `${state.rows.length}개 종목 확인` : "불러오기 실패";
    if (updatedElement) updatedElement.textContent = cached ? `${cached.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준` : "다시 시도해 주세요";
    if (cached) {
      render();
      return;
    }
    if (listElement) listElement.innerHTML = "<p class=\"empty\">시트 데이터를 가져오지 못했습니다. 원본 시트 공개 설정과 네트워크 연결을 확인한 뒤 새로고침해 주세요.</p>";
    console.error(error);
  }
}

if (typeof document !== "undefined") {
  searchElement.addEventListener("input", render);
  rateFilterElement.addEventListener("change", () => state.view === "industry" ? loadIndustrySummary() : render());
  focusFilterElement.addEventListener("change", () => state.view === "industry" ? loadIndustrySummary() : render());
  document.querySelector("#refresh").addEventListener("click", () => {
    if (state.view === "industry") {
      state.industrySummaryCache.delete(`${state.spreadsheetId}|${state.market}|${focusFilterElement.checked}|${rateFilterElement.checked}`);
      loadIndustrySummary();
    } else {
      loadCodes();
    }
  });
  listElement.addEventListener("click", (event) => {
    const rowElement = event.target.closest("tbody tr");
    if (!rowElement || state.view !== "stocks") return;
    openChart({ code: rowElement.dataset.code, name: rowElement.dataset.name });
  });
  listElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const rowElement = event.target.closest("tbody tr");
    if (!rowElement || state.view !== "stocks") return;
    event.preventDefault();
    openChart({ code: rowElement.dataset.code, name: rowElement.dataset.name });
  });
  document.querySelector("#chart-close").addEventListener("click", () => {
    chartPanelElement.hidden = true;
    chartPlotElement.innerHTML = "";
  });
  sourceToggleElement.addEventListener("click", () => {
    sourceFormElement.hidden = !sourceFormElement.hidden;
    if (!sourceFormElement.hidden) sourceUrlElement.focus();
  });
  sourceFormElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sourceUrl = sourceUrlElement.value.trim();
    const nextId = extractSpreadsheetId(sourceUrl);
    if (!nextId) {
      sourceMessageElement.textContent = "Google Sheets 게시 링크 또는 원본 URL을 확인해 주세요.";
      return;
    }
    sourceMessageElement.textContent = "시트 탭을 확인하는 중...";
    try {
      const nextSourceType = isPublishedSpreadsheet(sourceUrl) ? "published" : "xlsx";
      const gids = nextSourceType === "published" ? await discoverPublishedSheetGids(nextId) : await discoverSheetGids(nextId);
      const sharedSaved = await saveSharedSource({ id: nextId, type: nextSourceType, url: sourceUrl });
      applySheetGids(gids);
      state.spreadsheetId = nextId;
      state.sourceType = nextSourceType;
      state.sourceUrl = sourceUrl;
      clearSourceCache();
      localStorage.setItem("pbo-source-id", nextId);
      localStorage.setItem("pbo-source-type", nextSourceType);
      localStorage.setItem("pbo-source-url", sourceUrl);
      sourceChannel?.postMessage({ id: nextId, type: nextSourceType, url: sourceUrl });
      sourceMessageElement.textContent = sharedSaved
        ? "소스가 변경되었습니다."
        : "이 브라우저에 소스를 적용했습니다. 공용 저장소가 연결되지 않아 다른 기기에는 공유되지 않습니다.";
      if (state.view === "industry") loadIndustrySummary();
      else loadCodes();
    } catch (error) {
      sourceMessageElement.textContent = error.message;
    }
  });
  document.querySelectorAll(".market-tab").forEach((tab) => tab.addEventListener("click", () => {
    state.industryRequestId += 1;
    state.industryLoading = false;
    state.market = tab.dataset.market;
    document.querySelectorAll(".market-tab").forEach((item) => item.classList.toggle("active", item === tab));
    searchElement.value = "";
    const cached = readCachedRows(state.market, state.period);
    const nextKey = buildTabCacheKey(state.market, state.period);
    state.isLoading = !cached;
    state.loadingKey = cached ? null : nextKey;
    state.rows = cached ? cached.rows : [];
    state.updatedAt = cached ? cached.updatedAt : state.updatedAt;
    if (statusElement) statusElement.textContent = cached ? `${cached.rows.length}개 종목 확인` : "시트 읽는 중";
    if (updatedElement) updatedElement.textContent = cached ? `${cached.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준` : "데이터 확인 중";
    render();
    if (state.view === "industry") loadIndustrySummary();
    else loadCodes();
  }));
  document.querySelectorAll(".period-tab").forEach((tab) => tab.addEventListener("click", () => {
    if (!tab.dataset.period) return;
    state.industryRequestId += 1;
    state.industryLoading = false;
    state.view = "stocks";
    state.period = tab.dataset.period;
    document.querySelectorAll(".period-tab").forEach((item) => item.classList.toggle("active", item === tab));
    industryToggleElement.classList.remove("active");
    industryToggleElement.setAttribute("aria-pressed", "false");
    const cached = readCachedRows(state.market, state.period);
    const nextKey = buildTabCacheKey(state.market, state.period);
    state.isLoading = !cached;
    state.loadingKey = cached ? null : nextKey;
    state.rows = cached ? cached.rows : [];
    state.updatedAt = cached ? cached.updatedAt : state.updatedAt;
    if (statusElement) statusElement.textContent = cached ? `${cached.rows.length}개 종목 확인` : "시트 읽는 중";
    if (updatedElement) updatedElement.textContent = cached ? `${cached.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준` : "데이터 확인 중";
    render();
    loadCodes();
  }));
  industryToggleElement.addEventListener("click", () => {
    state.view = "industry";
    document.querySelectorAll(".period-tab[data-period]").forEach((tab) => tab.classList.remove("active"));
    industryToggleElement.classList.add("active");
    industryToggleElement.setAttribute("aria-pressed", "true");
    loadIndustrySummary();
  });
  window.addEventListener("storage", (event) => {
    if (!sourceStorageKeys.includes(event.key)) return;
    syncSource(readStoredSource());
  });
  sourceChannel?.addEventListener("message", (event) => syncSource(event.data));
  sourceUrlElement.value = getStoredSourceUrl();
  if (!state.sourceUrl) {
    state.sourceUrl = sourceUrlElement.value;
    localStorage.setItem("pbo-source-url", state.sourceUrl);
  }
  (async () => {
    try {
      await loadSharedSource();
      sourceUrlElement.value = getStoredSourceUrl();
      const gids = state.sourceType === "published"
        ? await discoverPublishedSheetGids(state.spreadsheetId)
        : await discoverSheetGids(state.spreadsheetId);
      applySheetGids(gids);
      if (state.sourceUrl) sourceMessageElement.textContent = "저장된 소스를 사용 중입니다.";
    } catch (error) {
      if (state.sourceUrl) sourceMessageElement.textContent = error.message;
    }
    loadCodes();
  })();
}
