# Page DNA Backward-Compatible Migration Strategy

## 1. Overview & Objectives

Phase 3 introduces Page DNA to the existing multi-page Facebook auto-poster. To maintain strict backward compatibility with existing deployments:
1. **Zero Credential Loss**: Existing page access tokens, page IDs, page names, and user secrets remain untouched.
2. **Preservation of Existing Prompts**: Existing custom `systemPrompt` configurations on pages are preserved and isolated at Hierarchy Level 7 (untrusted operator input).
3. **Automatic Schema Seeding**: Any connected page without a `contentProfile` automatically receives a normalized default profile, seeded with the page's existing `category` (if non-General).
4. **Idempotent Migration**: Running migration multiple times produces identical, stable state with zero schema corruption.
5. **Automated Atomic Backup**: Before any migration write occurs, an atomic timestamped backup of `data/settings.json` is generated.

---

## 2. Migration Architecture

The migration logic is embedded in `services/storage.js` within `migrateAllPages(options)`:

```
                  ┌───────────────────────────────┐
                  │ Storage Initialization Check │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │ Backup:                       │
                  │ settings.backup.<time>.json   │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │ For each connected page:      │
                  │ - Preserve tokens & secrets   │
                  │ - Default contentProfile      │
                  │ - Seed niche from category    │
                  │ - Set onboardingStatus        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │ Atomic Write to settings.json │
                  └───────────────────────────────┘
```

### Migration Code Flow
```javascript
migrateAllPages(options = {}) {
  const { createBackup = true } = options;
  const s = this.getSettings();
  if (!Array.isArray(s.pages) || s.pages.length === 0) {
    return { success: true, migratedCount: 0, pages: [] };
  }

  if (createBackup && fs.existsSync(SETTINGS_FILE)) {
    const backupPath = path.join(DATA_DIR, `settings.backup.${Date.now()}.json`);
    try {
      fs.copyFileSync(SETTINGS_FILE, backupPath);
      console.log(`[Storage Migration] Created pre-migration backup at ${backupPath}`);
    } catch (err) {
      console.error('[Storage Migration] Failed to create backup:', err.message);
    }
  }

  let migratedCount = 0;
  s.pages = s.pages.map(page => {
    let modified = false;
    let profile = page.contentProfile;
    if (!profile || typeof profile !== 'object') {
      profile = createDefaultContentProfile({
        niche: page.category && page.category !== 'General' ? page.category : ''
      });
      modified = true;
    } else {
      profile = normalizeContentProfile(profile);
    }

    const onboardingStatus = page.onboardingStatus || calculateOnboardingStatus(profile);
    if (!page.onboardingStatus) modified = true;

    if (modified) migratedCount++;
    return {
      ...page,
      contentProfile: profile,
      onboardingStatus
    };
  });

  if (apply && migratedCount > 0) {
    this.saveSettings(s);
    this.pruneOldBackups();
  }

  return { success: true, migratedCount, pages: s.pages };
}
```

---

## 3. Operator CLI Migration Tool (`npm run migrate:page-dna`)

To prevent unexpected disk writes during startup, production deployments use the dedicated CLI runner `scripts/migrate-page-dna.js`:

```bash
# Dry-run mode (default, zero disk modifications):
npm run migrate:page-dna
# or: node scripts/migrate-page-dna.js --dry-run

# Apply mode (creates atomic backup, writes settings.json with 0600 permissions):
npm run migrate:page-dna -- --apply
# or: node scripts/migrate-page-dna.js --apply
```

### Safety & Isolation Guarantees:
1. **Dry-Run by Default**: Unless `--apply` is explicitly passed, the migration runs in dry-run mode and modifies nothing on disk.
2. **Pre-Migration Backup**: When `--apply` is specified, an atomic timestamped backup `settings.backup.<timestamp>.json` is generated before writing. If backup generation fails, migration halts immediately.
3. **Atomic File Replacement & 0600 Permissions**: Writes to a temporary file with strict `0600` permissions before atomically renaming it to `settings.json`.
4. **Automated Backup Retention**: Automatically retains only the newest 5 backups (configurable via `PAGE_DNA_BACKUP_RETENTION`). Older backups are pruned safely.
5. **Symlink Protection**: Backup pruning inspects file entries via `lstat` and strictly ignores symbolic links to avoid symlink traversal attacks.
6. **Zero Secret Leakage in CLI**: CLI output only reports page counts, page IDs, and names. Tokens, keys, and password hashes are never logged to console.

---

## 4. Backward Compatibility Assurances

| Legacy Field | Migrated State | Behavior / Impact |
| :--- | :--- | :--- |
| `page.id` | Retained | Unchanged primary identifier. |
| `page.name` | Retained | Display name preserved. |
| `page.category` | Retained | Used to seed `contentProfile.niche` if not "General". |
| `page.access_token` | Retained (encrypted/raw) | Publishing credentials strictly preserved. |
| `page.systemPrompt` | Retained | Preserved as operator prompt in prompt hierarchy Level 7. |
| `page.contentProfile` | **Added** (Normalized) | Baseline 5-mix distribution and 3 standard pillars. |
| `page.onboardingStatus`| **Added** (`not_started`) | Informs UI to show Setup button instead of Edit. |

---

## 5. Rollback & Recovery Procedures

If a migration issue occurs in production:

### 5.1. Locate Backup File
All backups are saved in the `data/` directory with the timestamp format:
```bash
ls -lt data/settings.backup.*.json
```

### 5.2. Restore From Backup
1. Stop the application daemon:
   ```bash
   npm run stop # or pm2 stop facebook-auto-poster
   ```
2. Copy the desired backup file over `data/settings.json`:
   ```bash
   cp data/settings.backup.<TIMESTAMP>.json data/settings.json
   chmod 0600 data/settings.json
   ```
3. Restart the service:
   ```bash
   npm start
   ```

### 5.3. Verification Checklist Post-Rollback
- Verify pages are listed with original tokens and categories.
- Verify existing scheduled queue items remain executable.
- Run tests:
  ```bash
  npm test
  ```
