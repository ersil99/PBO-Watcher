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
console.log('tab cache helper ok');
