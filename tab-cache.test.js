const assert = require('node:assert/strict');

let app;
try {
  app = require('./app.js');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

assert.equal(typeof app.buildTabCacheKey, 'function');
assert.equal(app.buildTabCacheKey('한국', '일봉'), '한국|일봉');
assert.equal(app.buildTabCacheKey('미국', '주봉'), '미국|주봉');
assert.equal(app.resolveStockName('#ERROR!', '아스플로'), '아스플로');
assert.equal(app.resolveStockName('#ERROR!', '피델릭스'), '피델릭스');
assert.equal(app.resolveStockName('시트 종목명', ''), '시트 종목명');
assert.equal(app.resolveYahooStockName('4847', 'Intelligent Wave Inc.', '4847', false), 'Intelligent Wave Inc.');
assert.equal(app.resolveYahooStockName('시트 종목명', 'Yahoo name', '4847', true), '시트 종목명');
assert.equal(app.resolveYahooStockName('4847', '', '4847', false), '4847');
assert.equal(app.getNaverDailyChangeRate([297500, 280000]).toFixed(2), '-5.88');
assert.equal(app.getNaverDailyChangeRate([297500]), null);
assert.equal(app.getNaverDailyChangeRate([0, 297500]), null);
assert.equal(app.getNaverIntegrationChangeRate({ dealTrendInfos: [{ closePrice: '38,700', compareToPreviousClosePrice: '2,200' }] }).toFixed(2), '6.03');
assert.equal(app.getNaverIntegrationChangeRate({ dealTrendInfos: [{ closePrice: '27,000', compareToPreviousClosePrice: '-200' }] }).toFixed(2), '-0.74');
assert.equal(app.getNaverIntegrationChangeRate({ dealTrendInfos: [] }), null);
assert.equal(app.calculateNaverRegularSessionChangeRate([
  { time: '202610161530', close: 36500 },
  { time: '202610161600', close: 35750 },
  { time: '202610191529', close: 38100 },
  { time: '202610191530', close: 38200 },
  { time: '202610191600', close: 38700 },
]).toFixed(2), '4.66');
assert.equal(app.calculateNaverRegularSessionChangeRate([{ time: '202610191600', close: 38700 }]), null);
const tradingViewChartUrl = new URL(app.buildTradingViewChartUrl('NASDAQ:AAPL'));
assert.equal(tradingViewChartUrl.origin, 'https://www.tradingview.com');
assert.equal(tradingViewChartUrl.pathname, '/chart/');
assert.equal(tradingViewChartUrl.searchParams.get('symbol'), 'NASDAQ:AAPL');
assert.equal(new URL(app.buildTradingViewChartUrl('KRX:005930')).searchParams.get('symbol'), 'KRX:005930');
assert.deepEqual([...app.buildIndustryNameMap([{ no: 278, name: '반도체와반도체장비' }])], [['278', '반도체와반도체장비']]);
assert.equal(app.findYahooIndustry([{ symbol: '7203.T', industryDisp: 'Auto Manufacturers' }], '7203.T'), 'Auto Manufacturers');
assert.equal(app.findYahooIndustry([{ symbol: 'AAPL', industry: 'Consumer Electronics' }], 'aapl'), 'Consumer Electronics');
assert.equal(app.findYahooIndustry([{ symbol: 'ACIW', sectorDisp: 'Technology' }], 'ACIW'), 'Technology');
assert.equal(app.findYahooIndustry([{ symbol: '600519.SZ', industry: 'Beverages' }], '600519.SS'), '');
assert.deepEqual(app.buildIndustrySummary({
  일봉: [{ code: 'A' }, { code: 'A' }, { code: 'B' }],
  주봉: [{ code: 'A' }, { code: 'C' }],
  월봉: [{ code: 'D' }],
}, new Map([['A', '전자'], ['B', '금융'], ['C', '전자'], ['D', '기타']])).map(({ industry, 일봉, 주봉, 월봉, total }) => ({ industry, 일봉, 주봉, 월봉, total })), [
  { industry: '전자', 일봉: 1, 주봉: 2, 월봉: 0, total: 3 },
  { industry: '금융', 일봉: 1, 주봉: 0, 월봉: 0, total: 1 },
  { industry: '기타', 일봉: 0, 주봉: 0, 월봉: 1, total: 1 },
]);
console.log('tab cache helper ok');
