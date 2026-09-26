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
console.log('tab cache helper ok');
