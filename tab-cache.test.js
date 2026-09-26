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
