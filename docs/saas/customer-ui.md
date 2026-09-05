# Gate 3: Customer UI Scaffolding & Onboarding

## Architecture Overview

Gate 3 provides the multi-tenant SaaS frontend interface for customers. It interfaces directly with the PostgreSQL-backed multi-tenant API routes (`/api/v1/workspaces/...`).

---

## 1. Bengali-First Onboarding Flow

New customer registration or login without a workspace triggers the **3-step setup modal (`#onboardingModal`)**:

1. **Step 1: ওয়ার্কস্পেস তৈরি (Workspace Creation)**:
   - User inputs their organization or business name.
   - Dispatches `POST /api/v1/workspaces`.
   - On success, advances immediately to Step 2.
2. **Step 2: ফেসবুক পেজ সংযোগ (Facebook Page OAuth Connection)**:
   - Displays official Meta OAuth button linking to `GET /api/v1/workspaces/:id/facebook/auth`.
   - Allows customer to initiate OAuth or click "পরে করব (Skip for now)".
3. **Step 3: ড্যাশবোর্ডে প্রবেশ (Dashboard Entry)**:
   - Congratulates user, closes wizard, and switches to active workspace dashboard.

---

## 2. Workspace Switcher & Navigation

- **Top Workspace Bar (`#workspaceSelectorContainer`)**:
  - Displays active workspace name (`#currentWorkspaceName`).
  - Displays localized role badge (`#currentWorkspaceRoleBadge`) in Bengali:
    - `owner` ➔ `মালিক (Owner)`
    - `admin` ➔ `অ্যাডমিন (Admin)`
    - `editor` ➔ `সম্পাদক (Editor)`
    - `reviewer` ➔ `পর্যালোচক (Reviewer)`
    - `viewer` ➔ `দর্শক (Viewer)`
  - Dropdown lists all workspaces the user is an active member of (`GET /api/v1/workspaces`).
  - Switching workspace immediately triggers scoped reloads of pages, posts, team members, and audit logs without full page refresh.
  - "নতুন ওয়ার্কস্পেস তৈরি করুন (+ Create Workspace)" modal shortcut.

---

## 3. Team Management & Invitations UI

- Located at sidebar navigation item **"টিম সদস্য (Team)" (`#view-team`)**.
- **Members List**: Displays all members with email, role badge, status, joined date, and removal action.
- **Role-Based Access Control (RBAC)**:
  - Only `owner` and `admin` roles can view the "সদস্য আমন্ত্রণ করুন (Invite Member)" button and removal actions.
  - `editor`, `reviewer`, and `viewer` see member listings but cannot mutate memberships or invite others.
- **Invitation Modal (`#inviteMemberModal`)**:
  - Inputs: email and role selector (`editor`, `reviewer`, `admin`, `viewer`).
  - Submits `POST /api/v1/workspaces/:id/invitations`.
  - Dispatches invitation and renders pending invites ledger with revocation button.

---

## 4. Post Version History Drawer

- Slide-out right panel (`#postVersionDrawer`) callable via `openPostVersionHistory(postId)`.
- Queries `GET /api/v1/workspaces/:id/posts/:postId/versions`.
- Renders chronological list of immutable post versions with version numbers (`#1`, `#2`, etc.), timestamps, and captions.

---

## 5. Security & Audit Trail View

- Located at sidebar navigation item **"নিরাপত্তা ও অডিট" (`#view-security`)**.
- Chronological table of workspace audit events from `GET /api/v1/workspaces/:id/audit-logs`.
- Displays sanitized actions (`workspace:create`, `member:add`, `token:stored`, etc.), resource IDs, and timestamps.

---

## 6. Security Invariants Verified

1. **Zero Secret/Token Exposure**:
   - Access tokens (`EAAB...`) are never present in DOM elements, input placeholders, console logs, `localStorage`, or `sessionStorage`.
2. **Dual-Mode Coexistence**:
   - In single-tenant mode (`STORAGE_MODE !== 'postgres'`), existing operator dashboard remains 100% backward-compatible.
   - In multi-tenant mode (`STORAGE_MODE === 'postgres'`), customer workspace switcher and onboarding flow activate seamlessly.
3. **Loopback Network Isolation**:
   - Zero external third-party CDN or font requests; all assets served locally.
