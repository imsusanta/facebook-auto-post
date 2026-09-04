/**
 * Encoding & Mojibake Checker
 * Scans repository source files to ensure no corrupted UTF-8 or Latin1 mojibake characters exist.
 */

const fs = require('fs');
const path = require('path');

// Unicode escaped definitions of mojibake patterns
const MOJIBAKE_PATTERNS = [
  { name: 'Corrupted Bengali UTF-8 (à¦ / à§)', regex: /\u00E0[\u00A6\u00A7]/ },
  { name: 'Corrupted Accents (Ã©, Ã , etc.)', regex: /\u00C3[\u00A9\u00A0\u00AD\u0080-\u00BF]/ },
  { name: 'Corrupted Emojis (ðŸ)', regex: /\u00F0\u0178/ },
  { name: 'Unicode Replacement Character (U+FFFD)', regex: /\uFFFD/ }
];

const IGNORE_PATHS = [
  'node_modules',
  '.git',
  'docs/phase-1-audit.md', // Audit document quotes original corrupted strings as evidence
  'scripts/check-encoding.js', // Checker file
  'tests/runner.js', // Test file asserting mojibake detection
  'package-lock.json',
  '.gemini'
];

const EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.md']);

function scanDirectory(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(process.cwd(), fullPath);

    if (IGNORE_PATHS.some(ignored => relPath === ignored || relPath.startsWith(ignored + path.sep))) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (EXTENSIONS.has(path.extname(file))) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, idx) => {
    for (const pattern of MOJIBAKE_PATTERNS) {
      if (pattern.regex.test(line)) {
        issues.push({
          line: idx + 1,
          pattern: pattern.name,
          snippet: line.trim().slice(0, 100)
        });
      }
    }
  });

  return issues;
}

function run() {
  console.log('🔍 Checking source files for encoding corruption / mojibake...');
  const files = scanDirectory(process.cwd());
  let totalErrors = 0;

  for (const file of files) {
    const issues = checkFile(file);
    if (issues.length > 0) {
      const relPath = path.relative(process.cwd(), file);
      console.error(`\n❌ [Mojibake Detected] in ${relPath}:`);
      issues.forEach(issue => {
        console.error(`  Line ${issue.line}: [${issue.pattern}] -> "${issue.snippet}"`);
      });
      totalErrors += issues.length;
    }
  }

  if (totalErrors > 0) {
    console.error(`\n💥 Found ${totalErrors} encoding issues! Please fix corrupted strings.`);
    process.exit(1);
  } else {
    console.log(`✅ All ${files.length} source files checked: Clean UTF-8 encoding verified with 0 mojibake issues.`);
    process.exit(0);
  }
}

run();
