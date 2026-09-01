// Node 16 的 node:crypto 缺少 getRandomValues,而 vite 6 的 resolveConfig 需要
// (见 dep chunk 中 `crypto.getRandomValues(new Uint8Array(9))`),这里用 webcrypto 补齐后再启动 vite CLI。
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
if (typeof crypto.getRandomValues !== 'function' && crypto.webcrypto) {
  crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
}
const viteEntry = pathToFileURL(path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')).href;
import(viteEntry).catch(err => {
  console.error(err);
  process.exit(1);
});
