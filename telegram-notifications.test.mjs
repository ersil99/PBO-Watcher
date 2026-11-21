import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { getDueNotifications, readPublishedStocks, readXlsxStocks } from "./telegram-notifications.mjs";

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
  }), [{ code: "005930", name: "삼성 & 전자" }]);
  assert.deepEqual(readXlsxStocks(workbook, {
    codeColumn: 0,
    nameColumn: null,
    boldColumn: 0,
    periodColumn: 5,
  }), []);
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
  }), [{ code: "AAPL", name: "Apple" }]);
});
