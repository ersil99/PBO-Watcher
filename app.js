const defaultSpreadsheetId = "1Dsr3ZQXvHs0ZwyhovHx1TeVZbkUAHvV1-57L3SqvqtI";
const yahooBaseUrl = window.location.protocol === "file:" ? "https://query1.finance.yahoo.com" : "/yahoo";
const markets = {
  한국: { gidByPeriod: { 일봉: "0", 주봉: "1097197674", 월봉: "2089529874" }, sheetName: "일봉", codeColumn: 0, nameColumn: 1, changeColumn: 2, boldColumn: 1, colorColumn: 1, source: "naver" },
  미국: { gid: "1000437246", sheetName: "미국", codeColumn: 0, nameColumn: 1, changeColumn: 2, periodColumn: 5, boldColumn: 0, colorColumn: 1, source: "yahoo" },
  일본: { gid: "726759276", sheetName: "일본", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0, colorColumn: 0, source: "yahoo" },
  중국: { gid: "1837366506", sheetName: "중국", codeColumn: 0, nameColumn: null, changeColumn: 1, periodColumn: 2, boldColumn: 0, colorColumn: 0, source: "yahoo" },
};
const state = { rows: [], updatedAt: null, market: "한국", period: "일봉", spreadsheetId: localStorage.getItem("pbo-source-id") || defaultSpreadsheetId };
let loadSequence = 0;
const liveRefreshInterval = 15000;
const listElement = document.querySelector("#list");
const countElement = document.querySelector("#count");
const updatedElement = document.querySelector("#updated");
const footerTimeElement = document.querySelector("#footer-time");
const statusElement = document.querySelector("#status");
const searchElement = document.querySelector("#search");
const rateFilterElement = document.querySelector("#rate-filter");
const focusFilterElement = document.querySelector("#focus-filter");
const sourceToggleElement = document.querySelector("#source-toggle");
const sourceFormElement = document.querySelector("#source-form");
const sourceUrlElement = document.querySelector("#source-url");
const sourceMessageElement = document.querySelector("#source-message");

function extractSpreadsheetId(value) {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

async function discoverSheetGids(spreadsheetId) {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?usp=drivesdk`, { cache: "no-store" });
  if (!response.ok) throw new Error("스프레드시트에 접근할 수 없습니다.");
  const html = await response.text();
  const gids = {};
  const pattern = /\[\d+,\d+,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^\\]+)\\"/g;
  for (const match of html.matchAll(pattern)) gids[match[2]] = match[1];
  return gids;
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

function render() {
  const query = searchElement.value.trim().toLowerCase();
  const rateHeader = state.period === "주봉" ? "이번주 등락률" : state.period === "월봉" ? "이번달 등락률" : "오늘 등락률";
  const volumeHeader = state.period === "주봉" ? "전주 대비 거래량" : state.period === "월봉" ? "전월 대비 거래량" : "전일 대비 오늘 거래량";
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

  if (!visibleRows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state.rows.length ? "검색 결과가 없습니다." : "표시할 종목이 없습니다.";
    listElement.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "stock-table";
  table.innerHTML = `<thead><tr><th>종목명</th><th>${rateHeader}</th><th>${volumeHeader}</th></tr></thead>`;
  const body = document.createElement("tbody");
  visibleRows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.innerHTML = `<td><strong class="stock-name"></strong><span class="stock-code"></span></td><td><span class="rate"></span></td><td><span class="volume-change"></span><span class="volume-total"></span></td>`;
    const stockName = tableRow.querySelector(".stock-name");
    stockName.textContent = row.name;
    stockName.classList.toggle("is-bold", row.bold);
    if (row.color) stockName.style.color = row.color;
    tableRow.querySelector(".stock-code").textContent = row.code;
    const rate = tableRow.querySelector(".rate");
    rate.textContent = `${row.changeRate > 0 ? "+" : ""}${row.changeRate.toFixed(2)}%`;
    const rateColor = rateClass(row.changeRate);
    if (rateColor) rate.classList.add(rateColor);
    const volumeChange = tableRow.querySelector(".volume-change");
    volumeChange.textContent = row.volumeChange === null ? "--" : `${row.volumeChange.toFixed(1)}%`;
    const volumeColor = row.volumeChange === null ? "" : rateClass(row.volumeChange - 100);
    if (volumeColor) volumeChange.classList.add(volumeColor);
    tableRow.querySelector(".volume-total").textContent = row.volume === null ? "거래량 확인 불가" : `오늘 ${formatNumber(row.volume)}주`;
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
    grouped.set(key, (grouped.get(key) || 0) + (Number(row[5]) || 0));
  });
  const values = [...grouped.values()];
  return { volume: values.at(-1) || null, previousVolume: values.at(-2) || null };
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
  const today = new Date();
  const endTime = today.toISOString().slice(0, 10).replaceAll("-", "");
  const start = new Date(today);
  start.setDate(start.getDate() - (period === "월봉" ? 120 : 45));
  const startTime = start.toISOString().slice(0, 10).replaceAll("-", "");
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${startTime}&endTime=${endTime}&timeframe=day`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Volume HTTP ${response.status}`);
  const rows = JSON.parse((await response.text()).replace(/'/g, '"')).slice(1).filter((row) => Array.isArray(row) && row.length > 5);
  const { volume, previousVolume } = getPeriodVolumes(rows, period);
  const closes = getPeriodCloses(rows, period);
  const close = closes.at(-1);
  const previousClose = closes.at(-2);
  return {
    volume: volume || null,
    volumeChange: previousVolume ? (volume / previousVolume) * 100 : null,
    changeRate: previousClose ? ((close - previousClose) / previousClose) * 100 : null,
  };
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
  const range = period === "월봉" ? "2y" : period === "주봉" ? "1y" : "1mo";
  const response = await fetch(`${yahooBaseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { cache: "no-store" });
  if (!response.ok) throw new Error("Yahoo 시세를 읽을 수 없습니다.");
  const result = (await response.json()).chart.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const grouped = new Map();
  (result?.timestamp || []).forEach((timestamp, index) => {
    const close = quote?.close?.[index];
    const volume = quote?.volume?.[index];
    if (!Number.isFinite(close)) return;
    const key = getYahooPeriodKey(timestamp, period, market);
    const entry = grouped.get(key) || { close: null, volume: 0 };
    entry.close = close;
    entry.volume += Number.isFinite(volume) ? volume : 0;
    grouped.set(key, entry);
  });
  const periods = [...grouped.values()];
  const current = periods.at(-1);
  const previous = periods.at(-2);
  return {
    name: result?.meta?.longName || result?.meta?.shortName || code,
    volume: current?.volume || null,
    volumeChange: previous?.volume ? (current.volume / previous.volume) * 100 : null,
    changeRate: previous?.close ? ((current.close - previous.close) / previous.close) * 100 : null,
  };
}

async function loadCodes() {
  const requestId = ++loadSequence;
  const market = state.market;
  const period = state.period;
  const config = markets[market];
  const gid = config.gidByPeriod?.[period] || config.gid;
  statusElement.textContent = "시트 읽는 중";
  updatedElement.textContent = "데이터 확인 중";
  try {
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

    const enrichedRows = await Promise.all(rows.map(async (row) => {
      try {
        const quote = config.source === "naver" ? await getNaverData(row.code, period) : await getYahooData(row.code, market, period);
        return { ...row, ...quote, changeRate: quote.changeRate ?? row.changeRate };
      }
      catch { return { ...row, volume: null, volumeChange: null }; }
    }));
    if (requestId !== loadSequence) return;
    state.rows = enrichedRows;
    state.updatedAt = new Date();
    const time = state.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    updatedElement.textContent = `${time} 기준`;
    footerTimeElement.textContent = time;
    statusElement.textContent = `${state.rows.length}개 종목 확인`;
    render();
  } catch (error) {
    if (requestId !== loadSequence) return;
    state.rows = [];
    countElement.textContent = "!";
    statusElement.textContent = "불러오기 실패";
    updatedElement.textContent = "다시 시도해 주세요";
    listElement.innerHTML = "<p class=\"empty\">시트 데이터를 가져오지 못했습니다. 원본 시트 공개 설정과 네트워크 연결을 확인한 뒤 새로고침해 주세요.</p>";
    console.error(error);
  }
}

searchElement.addEventListener("input", render);
rateFilterElement.addEventListener("change", render);
focusFilterElement.addEventListener("change", render);
document.querySelector("#refresh").addEventListener("click", loadCodes);
sourceToggleElement.addEventListener("click", () => {
  sourceFormElement.hidden = !sourceFormElement.hidden;
  if (!sourceFormElement.hidden) sourceUrlElement.focus();
});
sourceFormElement.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextId = extractSpreadsheetId(sourceUrlElement.value.trim());
  if (!nextId) {
    sourceMessageElement.textContent = "Google Sheets URL을 확인해 주세요.";
    return;
  }
  sourceMessageElement.textContent = "시트 탭을 확인하는 중...";
  try {
    applySheetGids(await discoverSheetGids(nextId));
    state.spreadsheetId = nextId;
    localStorage.setItem("pbo-source-id", nextId);
    sourceMessageElement.textContent = "소스가 변경되었습니다.";
    loadCodes();
  } catch (error) {
    sourceMessageElement.textContent = error.message;
  }
});
document.querySelectorAll(".market-tab").forEach((tab) => tab.addEventListener("click", () => {
  state.market = tab.dataset.market;
  document.querySelectorAll(".market-tab").forEach((item) => item.classList.toggle("active", item === tab));
  searchElement.value = "";
  state.rows = [];
  render();
  loadCodes();
}));
document.querySelectorAll(".period-tab").forEach((tab) => tab.addEventListener("click", () => {
  state.period = tab.dataset.period;
  document.querySelectorAll(".period-tab").forEach((item) => item.classList.toggle("active", item === tab));
  state.rows = [];
  render();
  loadCodes();
}));
loadCodes();
setInterval(loadCodes, liveRefreshInterval);
