'use strict';

const fs = require('node:fs');

// Read only the explicit project .env. Existing process environment wins.
function loadEnv(file, target = process.env) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw new Error('无法读取项目环境配置'); }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || target[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '').trim();
    target[match[1]] = value;
  }
}

module.exports = { loadEnv };
