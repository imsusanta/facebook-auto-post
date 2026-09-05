# Gate 2: Tenant-Scoped Business Data Architecture

## Status
- **Current State**: Implemented and verified in Draft PR (Gate 2).
- **Scope**: PostgreSQL storage for workspace-scoped business entities: Facebook Pages, posts, version history, schedules, templates, media, and settings.
- **Enforcement Status**: 131/131 integration tests passing. Zero fallback to legacy file storage (`data/settings.json`, `data/history.json`, `data/queue.json`) in PostgreSQL mode.

---

## 1. Multi-Tenant Data Model & Containment Invariants

All tenant business domain tables maintain a mandatory, non-nullable foreign key referencing `workspaces(id)` with cascading deletion:

```
workspaces (id UUID PK)
  ├── workspace_pages (workspace_id UUID FK)
  ├── workspace_posts (workspace_id UUID FK)
  │     └── workspace_post_versions (workspace_id UUID FK, post_id UUID FK)
  ├── workspace_schedules (workspace_id UUID FK)
  ├── workspace_templates (workspace_id UUID FK)
  ├── workspace_settings (workspace_id UUID PK FK)
  └── workspace_media (workspace_id UUID FK)
```

### Invariant 1: Composite Tenant-Safe Constraints
Global unique constraints risk cross-tenant name collisions and security enumeration leaks. In Gate 2, all unique constraints are composite, scoped strictly by `workspace_id`:
- **Connected Pages**: `UNIQUE (workspace_id, page_id)`. Distinct workspaces can connect the same Facebook Page without collision or enumeration.
- **Templates**: `UNIQUE (workspace_id, slug)`. Distinct tenants can define templates with the same slug (e.g., `promo`, `news-bulletin`).
- **Post Versions**: `UNIQUE (workspace_id, post_id, version_number)`. Revision increments are strictly contained per post and tenant.
- **Settings**: Primary key is `workspace_id UUID PRIMARY KEY REFERENCES workspaces(id)`. Exactly one settings record exists per workspace.

### Invariant 2: Immutable Version History
Modifications to post captions or media automatically produce an immutable row in `workspace_post_versions`:
- Initial post creation creates `version_number = 1`.
- Any modification to caption or media creates `version_number = N + 1` inside the same database transaction.
- When a post is soft-deleted, historical version rows are preserved for tenant compliance and audit trails.

### Invariant 3: Zero JSON Fallback in PostgreSQL Mode
When `STORAGE_MODE=postgres`, the application strictly accesses PostgreSQL repositories. The legacy JSON files (`data/settings.json`, `data/history.json`, `data/queue.json`) are never touched, read, or modified by any workspace operation.

---

## 2. API Surface & Canonical RBAC Mapping

All routes are mounted at `/api/v1/workspaces/:workspaceId/...` and guarded by `resolveWorkspaceContext` and `requireWorkspacePermission(...)`:

| Endpoint | Method | Permission Required | Description |
|---|---|---|---|
| `/:workspaceId/pages` | `GET` | `pages:read` | List connected Facebook Pages for workspace |
| `/:workspaceId/pages` | `POST` | `pages:manage` | Connect or update connected Facebook Page |
| `/:workspaceId/pages/:pageId` | `GET` | `pages:read` | Get connected page details |
| `/:workspaceId/pages/:pageId` | `DELETE` | `pages:manage` | Disconnect page (soft-delete) |
| `/:workspaceId/pages/:pageId/default` | `PATCH` | `pages:manage` | Set default connected page |
| `/:workspaceId/posts` | `GET` | `drafts:read` | List workspace posts (with status filter) |
| `/:workspaceId/posts` | `POST` | `drafts:create` | Create new post (creates v1) |
| `/:workspaceId/posts/:postId` | `GET` | `drafts:read` | Get post details |
| `/:workspaceId/posts/:postId` | `PATCH` | `drafts:update` | Update post (creates vN if content changed) |
| `/:workspaceId/posts/:postId` | `DELETE` | `drafts:delete` | Soft-delete post |
| `/:workspaceId/posts/:postId/versions` | `GET` | `drafts:read` | List post revision versions |
| `/:workspaceId/schedules` | `GET` | `schedule:read` | Read workspace publishing schedule |
| `/:workspaceId/schedules` | `PUT` | `schedule:update` | Save or update publishing schedule |
| `/:workspaceId/templates` | `GET` | `templates:read` | List workspace custom templates |
| `/:workspaceId/templates` | `POST` | `templates:manage` | Create workspace custom template |
| `/:workspaceId/templates/:templateId` | `GET` | `templates:read` | Get template by ID |
| `/:workspaceId/templates/:templateId` | `DELETE` | `templates:manage` | Delete workspace custom template |
| `/:workspaceId/settings` | `GET` | `settings:read` | Get workspace settings |
| `/:workspaceId/settings` | `PUT` | `settings:update` | Merge/update workspace settings |
| `/:workspaceId/media` | `GET` | `media:read` | List workspace media assets |
| `/:workspaceId/media` | `POST` | `media:upload` | Record uploaded media asset |
| `/:workspaceId/media/:mediaId` | `DELETE` | `media:delete` | Soft-delete media asset |

---

## 3. Security & Anti-Tampering Safeguards

1. **Explicit URL Scope & Anti-Tampering**:
   - URL parameter `workspaceId` is the single source of tenant truth.
   - Body properties `workspaceId` or `workspace_id` are rejected with 400 `VALIDATION_FAILED` to prevent injection attacks.
2. **Safe Privacy 404s**:
   - Accessing another tenant's workspace or non-existent resource returns 404 `WORKSPACE_NOT_FOUND` or 404 `RESOURCE_NOT_FOUND`, preventing resource existence probing.
3. **Public Error Sanitization**:
   - Internal database errors, column names, and constraint violation details are stripped by `sendSafeError` and `publicResponse`.
   - Only typed, allowlisted errors are returned to the client.
4. **Append-Only Audit Logging**:
   - Every mutation (`page:connected`, `page:disconnected`, `page:set_default`, `post:created`, `post:updated`, `post:deleted`, `schedule:saved`, `template:created`, `template:deleted`, `settings:updated`, `media:uploaded`, `media:deleted`) records an audit log entry inside the transaction.

---

## 4. Verification Evidence

- **Database Safety Guard**: Loopback-only (`127.0.0.1:5432`), least-privileged role (`app_test`), disposable isolated test schemas.
- **Automated Tests**:
  - `npm run test:postgres`: 131/131 passed
  - `npm run test`: 49/49 passed (legacy operator regressions)
  - `npm run test:safety-guard`: 22/22 passed
  - `node tests/browser-test.js`: 19/19 passed
  - `npm run check:encoding`: 124/124 files clean UTF-8
  - `npm run lint`: 0 errors
  - `verify-clean-worktree.sh --test-failure-mode`: verified fail-closed behavior
