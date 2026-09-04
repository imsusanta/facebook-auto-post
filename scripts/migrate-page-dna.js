#!/usr/bin/env node
/**
 * CLI Migration Runner for Page DNA Content Profiles
 *
 * Usage:
 *   node scripts/migrate-page-dna.js [--dry-run]
 *   node scripts/migrate-page-dna.js --apply
 *
 * Security:
 *   - Reports counts and page names only.
 *   - NEVER outputs access tokens, password hashes, or secrets.
 *   - In --apply mode: creates a backup first, writes atomically, and sets permissions to 0600.
 */

const storage = require('../services/storage');

function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');

  console.log('====================================================');
  console.log('  Facebook Auto Poster - Page DNA Migration Runner  ');
  console.log('====================================================');
  console.log(`Mode: ${isApply ? 'APPLY (Writing changes to disk)' : 'DRY-RUN (No disk changes)'}\n`);

  const result = storage.migrateAllPages({ apply: isApply, createBackup: true });

  if (!result.success) {
    console.error(`[ERROR] Migration failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`Total Pages Found:   ${result.totalPages}`);
  console.log(`Pages Migrated:      ${result.migratedCount}`);
  console.log('----------------------------------------------------');

  if (Array.isArray(result.pages) && result.pages.length > 0) {
    console.log('Pages evaluated:');
    result.pages.forEach((p, idx) => {
      const statusStr = isApply
        ? 'Processed'
        : (p.needsMigration ? 'Needs Migration' : 'Already Migrated');
      console.log(`  ${idx + 1}. Page Name: "${p.name || 'Unnamed'}" [${statusStr}]`);
    });
  } else {
    console.log('No pages found in settings.');
  }

  console.log('----------------------------------------------------');
  if (!isApply) {
    console.log('\nDry-run complete. No files were modified.');
    console.log('To apply these changes, run: npm run migrate:page-dna -- --apply');
  } else {
    console.log('\nMigration completed successfully and settings written atomically with 0600 permissions.');
  }
}

main();
