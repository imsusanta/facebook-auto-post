# Role-Based Access Control (RBAC) Implementation

## Overview

SaaS Phase 1 establishes a canonical, fail-closed Role-Based Access Control (RBAC) foundation. Authorization is strictly tied to the requested tenant context: a user's role is not a global attribute, but rather a scoped relationship within a specific workspace (`workspace_members`).

---

## Canonical Roles

The system recognizes exactly 5 canonical roles:

1. **`owner`**: Complete authority over the workspace, including ownership transfer and member administration.
2. **`admin`**: Full operational administration (member management, invitations, audit logs, configuration), excluding ownership transfer and granting `owner`.
3. **`editor`**: Content generation, draft editing, and scheduling. Cannot invite members or manage workspace settings.
4. **`reviewer`**: Editorial governance, content approval, quality review, and schedule modifications. Cannot invite members or alter roles.
5. **`viewer`**: Read-only access to workspace drafts, pages, and schedules. Cannot modify content or settings.

---

## Permission Matrix

The permissions are centralized in `security/permissions.js`:

| Permission | `owner` | `admin` | `reviewer` | `editor` | `viewer` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `workspace:read` | [x] | [x] | [x] | [x] | [x] |
| `workspace:update` | [x] | [x] | [ ] | [ ] | [ ] |
| `workspace:delete` | [x] | [ ] | [ ] | [ ] | [ ] |
| `workspace:transfer` | [x] | [ ] | [ ] | [ ] | [ ] |
| `members:list` | [x] | [x] | [x] | [x] | [x] |
| `members:invite` | [x] | [x] | [ ] | [ ] | [ ] |
| `members:update_role`| [x] | [x] | [ ] | [ ] | [ ] |
| `members:remove` | [x] | [x] | [ ] | [ ] | [ ] |
| `audit:read` | [x] | [x] | [ ] | [ ] | [ ] |
| `pages:read` | [x] | [x] | [x] | [x] | [x] |
| `pages:manage` | [x] | [x] | [ ] | [ ] | [ ] |
| `page_dna:read` | [x] | [x] | [x] | [x] | [x] |
| `page_dna:update` | [x] | [x] | [x] | [x] | [ ] |
| `page_dna:reset` | [x] | [x] | [ ] | [ ] | [ ] |
| `drafts:read` | [x] | [x] | [x] | [x] | [x] |
| `drafts:create` | [x] | [x] | [x] | [x] | [ ] |
| `drafts:update` | [x] | [x] | [x] | [x] | [ ] |
| `drafts:delete` | [x] | [x] | [x] | [x] | [ ] |
| `approvals:read` | [x] | [x] | [x] | [x] | [x] |
| `approvals:submit` | [x] | [x] | [x] | [x] | [ ] |
| `approvals:decide` | [x] | [x] | [x] | [ ] | [ ] |
| `schedule:read` | [x] | [x] | [x] | [x] | [x] |
| `schedule:create` | [x] | [x] | [x] | [ ] | [ ] |
| `schedule:update` | [x] | [x] | [x] | [ ] | [ ] |
| `schedule:cancel` | [x] | [x] | [x] | [ ] | [ ] |
| `publish:trigger` | [x] | [x] | [x] | [x] | [ ] |
| `publish:retry` | [x] | [x] | [ ] | [ ] | [ ] |
| `billing:read` | [x] | [x] | [ ] | [ ] | [ ] |
| `billing:manage` | [x] | [ ] | [ ] | [ ] | [ ] |

---

## Authorization Middleware & Request Lifecycle

The request authorization pipeline is enforced via `middleware/workspace-context.js`:

```
Incoming Request
      |
      v
1. Authentication (req.user is resolved via session/header)
      |
      v
2. resolveWorkspaceContext
   ├── Validate req.params.workspaceId is valid UUIDv7
   ├── Anti-Tampering: Reject if req.body contains workspaceId or workspace_id (400)
   ├── Query membership: membershipRepository.findActive(workspaceId, req.user.id)
   └── Anti-Enumeration: If membership missing or inactive, return 404 WORKSPACE_NOT_FOUND
      |
      v
3. requireWorkspacePermission(permission)
   ├── Check permissions.hasPermission(context.role, permission)
   └── If forbidden: Return 403 PERMISSION_DENIED
      |
      v
4. Route Handler & Repository Execution
   └── Database query executes with WHERE workspace_id = $1
```

---

## Critical Privilege Escalation Defenses

1. **Admins Cannot Grant `owner`**: Only an existing `owner` can elevate another user to `owner`.
2. **Self-Promotion Prohibited**: Users cannot alter their own role. Role updates must be performed by another authorized member.
3. **Final Owner Protection**: A workspace cannot have its last remaining `owner` removed or demoted. The operation fails closed inside a serializable transaction.
4. **Invitations Exclude `owner`**: Invitations can only be issued for `admin`, `editor`, `reviewer`, or `viewer`.
5. **Immediate Access Invalidation**: When a member is removed or their status changes to `suspended`, `findActive()` fails immediately, denying access on the very next request.
6. **Uniform Anti-Enumeration**: Foreign tenant resources and non-existent resources return identical 404 responses (`WORKSPACE_NOT_FOUND`), preventing attackers from scanning valid workspace IDs.
