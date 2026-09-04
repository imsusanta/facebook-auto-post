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

  if (migratedCount > 0) {
    this.saveSettings(s);
  }

  return { success: true, migratedCount, pages: s.pages };
}
```

---

## 3. Backward Compatibility Assurances

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

## 4. Rollback & Recovery Procedures

If a migration issue occurs in production:

### 4.1. Locate Backup File
All backups are saved in the `data/` directory with the timestamp format:
```bash
ls -lt data/settings.backup.*.json
```

### 4.2. Restore From Backup
1. Stop the application daemon:
   ```bash
   npm run stop # or pm2 stop facebook-auto-poster
   ```
2. Copy the desired backup file over `data/settings.json`:
   ```bash
   cp data/settings.backup.<TIMESTAMP>.json data/settings.json
   ```
3. Restart the service:
   ```bash
   npm start
   ```

### 4.3. Verification Checklist Post-Rollback
- Verify pages are listed with original tokens and categories.
- Verify existing scheduled queue items remain executable.
- Run tests:
  ```bash
  npm test
  ```
