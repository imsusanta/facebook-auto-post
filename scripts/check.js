const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'uploads'].includes(entry.name))
      continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js'))
      execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
walk(path.join(__dirname, '..'));
console.log('JavaScript syntax checks passed');
