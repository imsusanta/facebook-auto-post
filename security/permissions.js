'use strict';

const CANONICAL_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'];

const ALL_PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer',

  'members:list',
  'members:invite',
  'members:update_role',
  'members:remove',

  'audit:read',

  'pages:read',
  'pages:manage',

  'page_dna:read',
  'page_dna:update',
  'page_dna:reset',

  'drafts:read',
  'drafts:create',
  'drafts:update',
  'drafts:delete',

  'approvals:read',
  'approvals:submit',
  'approvals:decide',

  'schedule:read',
  'schedule:create',
  'schedule:update',
  'schedule:cancel',

  'publish:trigger',
  'publish:retry',

  'templates:read',
  'templates:manage',

  'settings:read',
  'settings:update',

  'media:read',
  'media:upload',
  'media:delete',

  'billing:read',
  'billing:manage'
];

const ROLE_PERMISSIONS = {
  owner: new Set(ALL_PERMISSIONS),

  admin: new Set([
    'workspace:read',
    'workspace:update',
    'members:list',
    'members:invite',
    'members:update_role',
    'members:remove',
    'audit:read',
    'pages:read',
    'pages:manage',
    'page_dna:read',
    'page_dna:update',
    'page_dna:reset',
    'drafts:read',
    'drafts:create',
    'drafts:update',
    'drafts:delete',
    'approvals:read',
    'approvals:submit',
    'approvals:decide',
    'schedule:read',
    'schedule:create',
    'schedule:update',
    'schedule:cancel',
    'publish:trigger',
    'publish:retry',
    'templates:read',
    'templates:manage',
    'settings:read',
    'settings:update',
    'media:read',
    'media:upload',
    'media:delete',
    'billing:read'
  ]),

  reviewer: new Set([
    'workspace:read',
    'members:list',
    'pages:read',
    'page_dna:read',
    'page_dna:update',
    'drafts:read',
    'drafts:create',
    'drafts:update',
    'drafts:delete',
    'approvals:read',
    'approvals:submit',
    'approvals:decide',
    'schedule:read',
    'schedule:create',
    'schedule:update',
    'schedule:cancel',
    'publish:trigger',
    'templates:read',
    'settings:read',
    'media:read'
  ]),

  editor: new Set([
    'workspace:read',
    'members:list',
    'pages:read',
    'page_dna:read',
    'drafts:read',
    'drafts:create',
    'drafts:update',
    'drafts:delete',
    'approvals:read',
    'approvals:submit',
    'schedule:read',
    'publish:trigger',
    'templates:read',
    'settings:read',
    'media:read',
    'media:upload'
  ]),

  viewer: new Set([
    'workspace:read',
    'members:list',
    'pages:read',
    'page_dna:read',
    'drafts:read',
    'approvals:read',
    'schedule:read',
    'templates:read',
    'settings:read',
    'media:read'
  ])
};

function isValidRole(role) {
  return CANONICAL_ROLES.includes(role);
}

function hasPermission(role, permission) {
  if (!isValidRole(role)) return false;
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.has(permission) : false;
}

function getRolePermissions(role) {
  if (!isValidRole(role)) return [];
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? Array.from(permissions) : [];
}

module.exports = {
  CANONICAL_ROLES,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  isValidRole,
  hasPermission,
  getRolePermissions
};
