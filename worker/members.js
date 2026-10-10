/**
 * Samachar Daily — Team Members & Multi-User Authentication Engine
 *
 * Implements server-side foundation for:
 * 1. Team member records and lifecycle (Owner, Admin, Editor)
 * 2. Secure single-use cryptographically random invitations (stored as SHA-256 hash)
 * 3. Strict server-side Gmail address validation (@gmail.com / @googlemail.com only)
 * 4. Google Identity / OAuth 2.0 verification and account provisioning
 * 5. Server-side role-based authorization helpers (requireRole, hasPermission)
 * 6. Safe backward compatibility with existing Technical Admin account
 * 7. Zero Node.js dependencies (100% standard Web Crypto & Fetch APIs)
 */

import {
  base64UrlEncode,
  base64UrlDecode,
  base64UrlDecodeToString,
  verifySessionToken
} from './auth.js';

// Role definitions
export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor'
};

// Roles that can be assigned via invitations (Owner is reserved for technical admin)
export const INVITABLE_ROLES = [ROLES.ADMIN, ROLES.EDITOR];

// Status constants
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
};

export const MEMBER_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled'
};

// Expiration windows
export const INVITATION_TTL_SECONDS = 48 * 60 * 60; // 48 hours
export const OAUTH_STATE_TTL_SECONDS = 15 * 60; // 15 minutes

// KV Storage Key Prefixes
export const KEY_MEMBER_PREFIX = 'member:';
export const KEY_MEMBER_EMAIL_PREFIX = 'member_email:';
export const KEY_MEMBERS_INDEX = 'members:index';
export const KEY_INVITATION_PREFIX = 'invitation:';
export const KEY_INVITATION_TOKEN_PREFIX = 'invitation_token:';
export const KEY_INVITATIONS_INDEX = 'invitations:index';

/**
 * Permanent Root Owner Configuration
 * Identity: Arjun
 * Title: Root Owner / Technical Admin
 * Note: Configured strictly via Cloudflare Worker environment variable ROOT_OWNER_EMAIL.
 * Zero hardcoded personal email fallbacks.
 */
export const DEFAULT_ROOT_OWNER_NAME = 'Arjun';
export const DEFAULT_ROOT_OWNER_TITLE = 'Root Owner / Technical Admin';

/**
 * Resolves the configured Root Owner email strictly from Worker environment configuration.
 * Contains ZERO hardcoded personal email fallbacks.
 * Returns normalized email string if configured, or null if missing/empty.
 */
export function getRootOwnerEmail(env) {
  const envEmail = env?.ROOT_OWNER_EMAIL;
  if (!envEmail || typeof envEmail !== 'string') return null;
  const normalized = normalizeEmail(envEmail);
  return normalized || null;
}

/**
 * Checks if a given email is the immutable Root Owner
 */
export function isRootOwnerEmail(email, env) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const rootEmail = getRootOwnerEmail(env);
  if (rootEmail && normalized === rootEmail) {
    return true;
  }
  return normalized === 'admin@samachardaily.internal' ||
         normalized === 'admin';
}

/**
 * Returns the immutable Root Owner record bound to Arjun / owner-admin.
 * Uses configured ROOT_OWNER_EMAIL if present; reports missing configuration cleanly if absent.
 */
export function getOwnerRecord(env) {
  const rootEmail = getRootOwnerEmail(env);
  const isConfigured = Boolean(rootEmail);
  return {
    id: 'owner-admin',
    email: rootEmail || null,
    normalizedEmail: rootEmail || null,
    displayName: DEFAULT_ROOT_OWNER_NAME,
    title: DEFAULT_ROOT_OWNER_TITLE,
    role: ROLES.OWNER,
    status: MEMBER_STATUS.ACTIVE,
    isConfigured,
    configurationWarning: isConfigured ? null : 'ROOT_OWNER_EMAIL is not configured in Cloudflare Workers environment.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    acceptedAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    authProvider: 'password',
    providerSubject: 'admin',
    invitationId: null
  };
}

export const OWNER_RECORD = getOwnerRecord();


// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes email address (lowercase, trimmed)
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Validates that an email is strictly a Gmail address (@gmail.com or @googlemail.com)
 * Rejects non-Gmail addresses server-side.
 */
export function isGmailAddress(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254) return false;
  
  // Standard RFC-compliant local part check ending strictly with @gmail.com or @googlemail.com
  const gmailRegex = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@(gmail\.com|googlemail\.com)$/;
  return gmailRegex.test(normalized);
}

/**
 * Validates that a role is assignable to invited members
 */
export function isValidInvitableRole(role) {
  return INVITABLE_ROLES.includes(role);
}

/**
 * Validates any known system role
 */
export function isRecognizedRole(role) {
  return Object.values(ROLES).includes(role);
}

// ---------------------------------------------------------------------------
// Cryptographic Token Generation & Hashing
// ---------------------------------------------------------------------------

/**
 * Converts ArrayBuffer / Uint8Array to hex string
 */
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Generates a high-entropy cryptographically secure random invitation token (256-bit hex)
 */
export function generateInvitationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bufferToHex(bytes);
}

/**
 * Hashes an invitation token with SHA-256.
 * The raw token is NEVER stored in database/KV; only this hash is persisted.
 */
export async function hashInvitationToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invitation token must be a non-empty string.');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(token.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

// ---------------------------------------------------------------------------
// Member Record CRUD & Identity
// ---------------------------------------------------------------------------

/**
 * Fetches a member record by member ID from KV
 */
export async function getMemberById(env, memberId) {
  if (!memberId || typeof memberId !== 'string') return null;

  // Root Owner and technical admin alias mapping
  if (memberId === 'admin' || memberId === 'owner-admin') {
    return getOwnerRecord(env);
  }

  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const raw = await env.AUTH_KV.get(KEY_MEMBER_PREFIX + memberId);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Fetches a member record by normalized email from KV
 */
export async function getMemberByEmail(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  if (isRootOwnerEmail(normalized, env)) {
    return getOwnerRecord(env);
  }

  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const memberId = await env.AUTH_KV.get(KEY_MEMBER_EMAIL_PREFIX + normalized);
  if (!memberId) return null;

  return await getMemberById(env, memberId);
}

/**
 * Saves or updates a member record in KV, maintaining email pointer and index
 */
export async function saveMember(env, member) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }
  if (!member || !member.id) {
    throw new Error('Invalid member object.');
  }

  // Prevent overwriting, demoting, or modifying the immutable Root Owner
  if (member.id === 'owner-admin' || member.id === 'admin' || isRootOwnerEmail(member.email, env) || isRootOwnerEmail(member.normalizedEmail, env)) {
    return getOwnerRecord(env);
  }

  // Prevent non-owner accounts from being assigned the Owner role
  if (member.role === ROLES.OWNER) {
    member.role = ROLES.ADMIN;
  }

  // Persist member record
  await env.AUTH_KV.put(KEY_MEMBER_PREFIX + member.id, JSON.stringify(member));

  // Persist email lookup pointer
  if (member.normalizedEmail) {
    await env.AUTH_KV.put(KEY_MEMBER_EMAIL_PREFIX + member.normalizedEmail, member.id);
  }

  // Update members index
  const rawIndex = await env.AUTH_KV.get(KEY_MEMBERS_INDEX);
  let index = [];
  try {
    index = rawIndex ? JSON.parse(rawIndex) : [];
  } catch (_) {
    index = [];
  }
  if (!Array.isArray(index)) index = [];

  if (!index.includes(member.id)) {
    index.push(member.id);
    await env.AUTH_KV.put(KEY_MEMBERS_INDEX, JSON.stringify(index));
  }

  return member;
}

/**
 * Lists all active and registered members, including the Owner
 */
export async function listMembers(env) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const ownerRecord = getOwnerRecord(env);
  const members = [{ ...ownerRecord }];

  const rawIndex = await env.AUTH_KV.get(KEY_MEMBERS_INDEX);
  if (!rawIndex) return members;

  let index = [];
  try {
    index = JSON.parse(rawIndex);
  } catch (_) {
    return members;
  }

  if (Array.isArray(index)) {
    for (const id of index) {
      if (id === 'owner-admin' || id === 'admin') continue;
      const m = await getMemberById(env, id);
      if (m && !isRootOwnerEmail(m.email, env)) {
        members.push(m);
      }
    }
  }

  return members;
}

/**
 * Updates member's lastActiveAt timestamp
 */
export async function updateMemberLastActive(env, memberId, timestampMs = Date.now()) {
  if (!env || !env.AUTH_KV || !memberId) return;
  if (memberId === 'admin' || memberId === 'owner-admin') return;

  const member = await getMemberById(env, memberId);
  if (!member) return;

  member.lastActiveAt = new Date(timestampMs).toISOString();
  member.updatedAt = new Date(timestampMs).toISOString();
  await env.AUTH_KV.put(KEY_MEMBER_PREFIX + member.id, JSON.stringify(member));
}

// ---------------------------------------------------------------------------
// Invitation Lifecycle & CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new invitation record with cryptographically secure token and 48-hour expiration.
 * Stores only token hash in KV.
 */
export async function createInvitation(env, { email, role, invitedBy = 'owner-admin', nowMs = Date.now() }) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  // 1. Validate Gmail format
  if (!isGmailAddress(email)) {
    throw new Error('Only @gmail.com or @googlemail.com addresses are permitted for invitations.');
  }
  const normalized = normalizeEmail(email);

  // 2. Validate role
  if (!isValidInvitableRole(role)) {
    throw new Error(`Invalid role "${role}". Allowed roles: ${INVITABLE_ROLES.join(', ')}.`);
  }

  // 3. Verify user is not already the Root Owner or an active member
  if (isRootOwnerEmail(normalized, env)) {
    throw new Error('The Root Owner account is permanent and cannot be invited or modified.');
  }
  const existingMember = await getMemberByEmail(env, normalized);
  if (existingMember && existingMember.status === MEMBER_STATUS.ACTIVE) {
    throw new Error(`A member with email ${normalized} already exists and is active.`);
  }

  // 4. Generate random token and hash
  const rawToken = generateInvitationToken();
  const tokenHash = await hashInvitationToken(rawToken);

  const invitationId = 'inv_' + crypto.randomUUID().replace(/-/g, '');
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + INVITATION_TTL_SECONDS * 1000).toISOString();

  const invitation = {
    id: invitationId,
    email: normalized,
    normalizedEmail: normalized,
    role: role,
    tokenHash: tokenHash,
    status: INVITATION_STATUS.PENDING,
    invitedBy: invitedBy,
    createdAt: nowIso,
    expiresAt: expiresAtIso,
    acceptedAt: null,
    cancelledAt: null
  };

  // 5. Store invitation record & token lookup in KV
  await env.AUTH_KV.put(KEY_INVITATION_PREFIX + invitationId, JSON.stringify(invitation));
  await env.AUTH_KV.put(KEY_INVITATION_TOKEN_PREFIX + tokenHash, invitationId, {
    expirationTtl: INVITATION_TTL_SECONDS
  });

  // 6. Update invitations index
  const rawIndex = await env.AUTH_KV.get(KEY_INVITATIONS_INDEX);
  let index = [];
  try {
    index = rawIndex ? JSON.parse(rawIndex) : [];
  } catch (_) {
    index = [];
  }
  if (!Array.isArray(index)) index = [];
  if (!index.includes(invitationId)) {
    index.push(invitationId);
    await env.AUTH_KV.put(KEY_INVITATIONS_INDEX, JSON.stringify(index));
  }

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedBy: invitation.invitedBy,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt
    },
    rawToken
  };
}

/**
 * Fetches an invitation by its raw token (hashes token, looks up ID, checks expiration)
 */
export async function getInvitationByToken(env, rawToken, nowMs = Date.now()) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const tokenHash = await hashInvitationToken(rawToken);
  const invitationId = await env.AUTH_KV.get(KEY_INVITATION_TOKEN_PREFIX + tokenHash);
  if (!invitationId) return null;

  const raw = await env.AUTH_KV.get(KEY_INVITATION_PREFIX + invitationId);
  if (!raw) return null;

  let invitation = null;
  try {
    invitation = JSON.parse(raw);
  } catch (_) {
    return null;
  }

  // Automatic expiration check
  if (invitation.status === INVITATION_STATUS.PENDING) {
    const expiresAtMs = Date.parse(invitation.expiresAt);
    if (!isNaN(expiresAtMs) && nowMs > expiresAtMs) {
      invitation.status = INVITATION_STATUS.EXPIRED;
      // Invalidate token pointer
      await env.AUTH_KV.delete(KEY_INVITATION_TOKEN_PREFIX + tokenHash);
      await env.AUTH_KV.put(KEY_INVITATION_PREFIX + invitationId, JSON.stringify(invitation));
    }
  }

  return invitation;
}

/**
 * Fetches an invitation by ID
 */
export async function getInvitationById(env, invitationId, nowMs = Date.now()) {
  if (!invitationId || typeof invitationId !== 'string') return null;
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const raw = await env.AUTH_KV.get(KEY_INVITATION_PREFIX + invitationId);
  if (!raw) return null;

  let invitation = null;
  try {
    invitation = JSON.parse(raw);
  } catch (_) {
    return null;
  }

  if (invitation.status === INVITATION_STATUS.PENDING) {
    const expiresAtMs = Date.parse(invitation.expiresAt);
    if (!isNaN(expiresAtMs) && nowMs > expiresAtMs) {
      invitation.status = INVITATION_STATUS.EXPIRED;
      if (invitation.tokenHash) {
        await env.AUTH_KV.delete(KEY_INVITATION_TOKEN_PREFIX + invitation.tokenHash);
      }
      await env.AUTH_KV.put(KEY_INVITATION_PREFIX + invitationId, JSON.stringify(invitation));
    }
  }

  return invitation;
}

/**
 * Cancels a pending invitation
 */
export async function cancelInvitation(env, invitationId, cancelledBy = 'owner-admin', nowMs = Date.now()) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const invitation = await getInvitationById(env, invitationId, nowMs);
  if (!invitation) {
    throw new Error('Invitation not found.');
  }

  // Idempotent: If already cancelled or revoked, return cleanly
  if (invitation.status === INVITATION_STATUS.CANCELLED || invitation.status === INVITATION_STATUS.REVOKED) {
    return invitation;
  }

  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new Error(`Cannot cancel invitation with status "${invitation.status}".`);
  }

  invitation.status = INVITATION_STATUS.CANCELLED;
  invitation.cancelledAt = new Date(nowMs).toISOString();
  invitation.revokedAt = invitation.cancelledAt;
  invitation.revoked = true;

  // Delete token lookup pointer so it cannot be accepted
  if (invitation.tokenHash) {
    await env.AUTH_KV.delete(KEY_INVITATION_TOKEN_PREFIX + invitation.tokenHash);
  }

  await env.AUTH_KV.put(KEY_INVITATION_PREFIX + invitation.id, JSON.stringify(invitation));

  return invitation;
}

/**
 * Permanently deletes a revoked, cancelled, or expired invitation record.
 * Admin/Owner only. Active (pending) invitations cannot be deleted.
 */
export async function deleteInvitation(env, invitationId, nowMs = Date.now()) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }
  if (!invitationId || typeof invitationId !== 'string') {
    throw new Error('Missing or invalid invitation ID.');
  }

  const invitation = await getInvitationById(env, invitationId, nowMs);
  if (!invitation) {
    // If already missing from KV, ensure removed from index
    const rawIndex = await env.AUTH_KV.get(KEY_INVITATIONS_INDEX);
    if (rawIndex) {
      try {
        let index = JSON.parse(rawIndex);
        if (Array.isArray(index) && index.includes(invitationId)) {
          index = index.filter(id => id !== invitationId);
          await env.AUTH_KV.put(KEY_INVITATIONS_INDEX, JSON.stringify(index));
        }
      } catch (_) {}
    }
    return { success: true, deleted: true, id: invitationId };
  }

  const isDeletable = invitation.status === INVITATION_STATUS.CANCELLED ||
                      invitation.status === INVITATION_STATUS.REVOKED ||
                      invitation.status === INVITATION_STATUS.EXPIRED ||
                      invitation.revoked === true;

  if (!isDeletable) {
    throw new Error(`Cannot delete active invitation with status "${invitation.status}". Only revoked, cancelled, or expired invitations can be deleted.`);
  }

  // 1. Delete token pointer
  if (invitation.tokenHash) {
    await env.AUTH_KV.delete(KEY_INVITATION_TOKEN_PREFIX + invitation.tokenHash);
  }

  // 2. Delete invitation record
  await env.AUTH_KV.delete(KEY_INVITATION_PREFIX + invitationId);

  // 3. Remove from invitations index
  const rawIndex = await env.AUTH_KV.get(KEY_INVITATIONS_INDEX);
  if (rawIndex) {
    try {
      let index = JSON.parse(rawIndex);
      if (Array.isArray(index)) {
        index = index.filter(id => id !== invitationId);
        await env.AUTH_KV.put(KEY_INVITATIONS_INDEX, JSON.stringify(index));
      }
    } catch (_) {}
  }

  return { success: true, deleted: true, id: invitationId };
}

/**
 * Accepts an invitation with a verified Google Identity.
 * Creates or activates the member account, updates invitation to accepted,
 * deletes the single-use token pointer, and returns the activated member record.
 */
export async function acceptInvitation(env, rawToken, googleIdentity, nowMs = Date.now()) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Missing or invalid invitation token.');
  }
  if (!googleIdentity || !googleIdentity.email) {
    throw new Error('Missing verified Google identity information.');
  }

  // 1. Verify invitation token
  const invitation = await getInvitationByToken(env, rawToken, nowMs);
  if (!invitation) {
    throw new Error('Invalid or expired invitation token.');
  }

  if (invitation.status === INVITATION_STATUS.EXPIRED) {
    throw new Error('This invitation has expired.');
  }
  if (invitation.status === INVITATION_STATUS.CANCELLED) {
    throw new Error('This invitation was cancelled by an administrator.');
  }
  if (invitation.status === INVITATION_STATUS.ACCEPTED) {
    throw new Error('This invitation has already been accepted.');
  }
  if (invitation.status !== INVITATION_STATUS.PENDING) {
    throw new Error(`Invitation is not pending (status: ${invitation.status}).`);
  }

  // 2. Verify Google Email matches invited email
  const googleEmail = normalizeEmail(googleIdentity.email);
  if (googleEmail !== invitation.normalizedEmail) {
    throw new Error(
      `Google account email (${googleEmail}) does not match the invited address (${invitation.email}).`
    );
  }

  // 3. Verify Google email is verified by Google
  if (googleIdentity.email_verified === false) {
    throw new Error('The Google account email is not verified by Google.');
  }

  // 4. Create or activate member record
  const nowIso = new Date(nowMs).toISOString();
  let member = await getMemberByEmail(env, googleEmail);

  if (member) {
    // If existing member, update attributes
    member.role = invitation.role;
    member.status = MEMBER_STATUS.ACTIVE;
    member.updatedAt = nowIso;
    member.acceptedAt = nowIso;
    member.lastActiveAt = nowIso;
    member.authProvider = 'google';
    member.providerSubject = googleIdentity.sub || member.providerSubject;
    member.invitationId = invitation.id;
    if (googleIdentity.name) {
      member.displayName = googleIdentity.name.trim();
    }
  } else {
    // New member record
    const memberId = 'mem_' + crypto.randomUUID().replace(/-/g, '');
    const displayName = (googleIdentity.name || googleEmail.split('@')[0]).trim();
    member = {
      id: memberId,
      email: invitation.email,
      normalizedEmail: googleEmail,
      displayName: displayName,
      role: invitation.role,
      status: MEMBER_STATUS.ACTIVE,
      createdAt: nowIso,
      updatedAt: nowIso,
      acceptedAt: nowIso,
      lastActiveAt: nowIso,
      authProvider: 'google',
      providerSubject: googleIdentity.sub || null,
      invitationId: invitation.id
    };
  }

  await saveMember(env, member);

  // 5. Invalidate invitation (single-use guarantee)
  invitation.status = INVITATION_STATUS.ACCEPTED;
  invitation.acceptedAt = nowIso;
  if (invitation.tokenHash) {
    await env.AUTH_KV.delete(KEY_INVITATION_TOKEN_PREFIX + invitation.tokenHash);
  }
  await env.AUTH_KV.put(KEY_INVITATION_PREFIX + invitation.id, JSON.stringify(invitation));

  return { member, invitation };
}

/**
 * Lists all invitations
 */
export async function listInvitations(env, nowMs = Date.now()) {
  if (!env || !env.AUTH_KV) {
    throw new Error('AUTH_KV binding is missing or unavailable.');
  }

  const rawIndex = await env.AUTH_KV.get(KEY_INVITATIONS_INDEX);
  if (!rawIndex) return [];

  let index = [];
  try {
    index = JSON.parse(rawIndex);
  } catch (_) {
    return [];
  }

  const invitations = [];
  if (Array.isArray(index)) {
    for (const id of index) {
      const inv = await getInvitationById(env, id, nowMs);
      if (inv) {
        invitations.push({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          invitedBy: inv.invitedBy,
          createdAt: inv.createdAt,
          expiresAt: inv.expiresAt,
          acceptedAt: inv.acceptedAt,
          cancelledAt: inv.cancelledAt,
          revokedAt: inv.revokedAt || inv.cancelledAt,
          revoked: !!(inv.revoked || inv.cancelledAt || inv.status === INVITATION_STATUS.CANCELLED || inv.status === INVITATION_STATUS.REVOKED)
        });
      }
    }
  }

  return invitations;
}

/**
 * Builds the canonical invitation URL from a raw token
 */
export function buildInvitationUrl(rawToken, baseUrl = 'https://thesamachardaily.in') {
  if (!rawToken) return '';
  return `${baseUrl.replace(/\/+$/, '')}/admin/invite?token=${encodeURIComponent(rawToken)}`;
}

// ---------------------------------------------------------------------------
// Server-Side Authorization Abstraction
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated member from the incoming Request.
 * Supports both technical admin sessions ('admin') and individual member sessions.
 */
export async function getAuthenticatedMember(request, env) {
  if (!request || !env || !env.ADMIN_SESSION_SECRET) return null;

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [name, ...val] = c.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(val.join('='));
  });

  const token = cookies['samachar_admin_session'];
  if (!token) return null;

  const session = await verifySessionToken(token, env.ADMIN_SESSION_SECRET);
  if (!session) return null;

  // Technical Admin or Root Owner account
  if (session.sub === 'admin' || session.sub === 'owner-admin' || (session.email && isRootOwnerEmail(session.email, env))) {
    return getOwnerRecord(env);
  }

  // Individual Member account
  const member = await getMemberById(env, session.sub);
  if (!member || member.status !== MEMBER_STATUS.ACTIVE) {
    return null; // Disabled or deleted account
  }

  return member;
}

/**
 * Returns member role
 */
export function getMemberRole(member) {
  return member && member.role ? member.role : null;
}

/**
 * Checks if a member possesses one of the allowed roles
 */
export function requireRole(member, allowedRoles) {
  if (!member || member.status !== MEMBER_STATUS.ACTIVE) return false;
  if (!member.role) return false;

  if (Array.isArray(allowedRoles)) {
    return allowedRoles.includes(member.role);
  }
  return member.role === allowedRoles;
}

/**
 * Server-side permission check foundation for Phase 14B-3
 */
export function hasPermission(member, permission) {
  if (!member || member.status !== MEMBER_STATUS.ACTIVE) return false;
  const role = member.role;

  // Owner possesses all permissions unconditionally
  if (role === ROLES.OWNER) return true;

  const permissions = {
    manage_members: [ROLES.OWNER, ROLES.ADMIN],
    invite_members: [ROLES.OWNER, ROLES.ADMIN],
    cancel_invitations: [ROLES.OWNER, ROLES.ADMIN],
    delete_invitations: [ROLES.OWNER, ROLES.ADMIN],
    view_members: [ROLES.OWNER, ROLES.ADMIN],
    edit_articles: [ROLES.OWNER, ROLES.ADMIN, ROLES.EDITOR],
    publish_articles: [ROLES.OWNER, ROLES.ADMIN, ROLES.EDITOR],
    delete_articles: [ROLES.OWNER, ROLES.ADMIN],
    view_audit: [ROLES.OWNER, ROLES.ADMIN],
    view_settings: [ROLES.OWNER, ROLES.ADMIN]
  };

  const allowed = permissions[permission];
  return allowed ? allowed.includes(role) : false;
}

// ---------------------------------------------------------------------------
// Google Identity / OAuth 2.0 Integration Foundation
// ---------------------------------------------------------------------------

/**
 * Inspects whether Google OAuth environment secrets are configured
 */
export function getGoogleOAuthConfig(env) {
  const clientId = env?.GOOGLE_CLIENT_ID || null;
  const clientSecret = env?.GOOGLE_CLIENT_SECRET || null;
  const missing = [];

  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');

  return {
    configured: missing.length === 0,
    clientId,
    clientSecret,
    missing
  };
}

/**
 * Resolves canonical Invitation Google OAuth redirect URI.
 * Guarantees that apex and www both resolve to https://thesamachardaily.in/admin/invite/callback
 * while preserving localhost dev environment origins.
 */
export function resolveInvitationRedirectUri(url, env) {
  if (env?.INVITATION_REDIRECT_URI) {
    return env.INVITATION_REDIRECT_URI;
  }
  const u = typeof url === 'string' ? new URL(url) : url;
  const host = (u.hostname || '').toLowerCase();
  if (host === 'thesamachardaily.in' || host === 'www.thesamachardaily.in') {
    return 'https://thesamachardaily.in/admin/invite/callback';
  }
  return `${u.origin}/admin/invite/callback`;
}

/**
 * Generates an HMAC-SHA256 tamper-proof signed OAuth state parameter
 */
export async function createOAuthState(payload, sessionSecret, ttlSeconds = OAUTH_STATE_TTL_SECONDS) {
  if (!sessionSecret) throw new Error('ADMIN_SESSION_SECRET is required to sign OAuth state.');
  const now = Math.floor(Date.now() / 1000);
  const stateData = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
    nonce: crypto.randomUUID()
  };

  const dataString = JSON.stringify(stateData);
  const dataBase64 = base64UrlEncode(dataString);

  const secretBytes = new TextEncoder().encode(sessionSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(dataBase64)
  );

  const signatureBase64 = base64UrlEncode(signatureBytes);
  return `${dataBase64}.${signatureBase64}`;
}

/**
 * Verifies the signature and expiration of an OAuth state parameter
 */
export async function verifyOAuthState(stateString, sessionSecret) {
  if (!stateString || typeof stateString !== 'string') return null;
  const dotIndex = stateString.indexOf('.');
  if (dotIndex === -1) return null;

  const dataBase64 = stateString.substring(0, dotIndex);
  const signatureBase64 = stateString.substring(dotIndex + 1);
  if (!dataBase64 || !signatureBase64) return null;

  try {
    const secretBytes = new TextEncoder().encode(sessionSecret);
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = base64UrlDecode(signatureBase64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(dataBase64)
    );

    if (!isValid) return null;

    const dataJson = base64UrlDecodeToString(dataBase64);
    const data = JSON.parse(dataJson);

    const now = Math.floor(Date.now() / 1000);
    if (!data.exp || data.exp < now) {
      return null; // Expired
    }

    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Builds standard Google OAuth 2.0 authorization URL
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'online',
    prompt: 'select_account'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges Google authorization code for tokens
 */
export async function exchangeGoogleCode({ code, clientId, clientSecret, redirectUri }) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google token exchange failed (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

/**
 * Fetches verified user identity from Google UserInfo endpoint
 */
export async function fetchGoogleUserInfo(accessToken) {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google userinfo request failed (${resp.status}): ${errText}`);
  }

  return await resp.json();
}

// ---------------------------------------------------------------------------
// Email Delivery Integration Point
// ---------------------------------------------------------------------------

/**
 * Generates responsive, brand-aligned HTML for team member invitations.
 */
export function generateInvitationEmailHtml({ email, role, inviteUrl, expiresAt }) {
  const roleName = role === ROLES.ADMIN ? 'Administrator' : 'Editor';
  const expiresFormatted = expiresAt
    ? new Date(expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
    : '48 hours from dispatch';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to SamacharDaily Editorial Control</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #f6f7f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #17202a; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e4e7ec; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,0.06);">
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 2px solid #881337;">
              <span style="font-size: 18px; font-weight: 800; color: #881337; letter-spacing: -0.02em;">SAMACHAR<span style="color: #17202a;">DAILY</span></span>
              <div style="font-size: 11px; font-weight: 600; color: #667085; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px;">Editorial Control Center</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #17202a; line-height: 1.3;">
                You've been invited to join the newsroom
              </h1>
              <p style="margin: 0 0 20px 0; font-size: 14px; color: #344054; line-height: 1.6;">
                You have been granted <strong>${roleName}</strong> access to the SamacharDaily Editorial Control Center.
                This single-use access link allows you to verify your identity and sign in with your Google Account (${email}).
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${inviteUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #881337; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 1px 2px rgba(16,24,40,0.05);">
                  ACCEPT INVITATION
                </a>
              </div>
              <p style="margin: 24px 0 8px 0; font-size: 12px; color: #667085; line-height: 1.5;">
                If the button above does not open, copy and paste this secure link directly into your browser:
              </p>
              <div style="padding: 10px 12px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; font-family: monospace; font-size: 11px; color: #475569; word-break: break-all;">
                ${inviteUrl}
              </div>
              <p style="margin: 20px 0 0 0; font-size: 12px; color: #98a2b3;">
                This invitation is single-use and will expire on <strong>${expiresFormatted}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #fafbfc; border-top: 1px solid #f2f4f7; font-size: 11px; color: #98a2b3; line-height: 1.5;">
              If you did not expect this invitation, you can safely ignore this email.<br>
              © SamacharDaily — Precision Journalism &amp; Content Operations Platform.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generates fallback plain text for team member invitations.
 */
export function generateInvitationEmailText({ email, role, inviteUrl, expiresAt }) {
  const roleName = role === ROLES.ADMIN ? 'Administrator' : 'Editor';
  return `SAMACHARDAILY — Editorial Control Center

You've been invited to join the SamacharDaily newsroom team as ${roleName}.

To accept your invitation and sign in with your verified Google Account (${email}), click the following link:
${inviteUrl}

This single-use invitation is active for 48 hours.

If you did not expect this invitation, you can safely ignore this email.
`;
}

/**
 * Email delivery integration point.
 * Dispatches real emails via Resend API when API key is provided,
 * or reports honest unconfigured status if no email provider is bound.
 * Never fakes delivery; strictly returns verified provider outcomes.
 */
export async function sendInvitationEmail(env, { email, role, inviteUrl, expiresAt }) {
  const apiKey = env?.RESEND_API_KEY || env?.EMAIL_API_KEY;
  if (!apiKey) {
    return {
      sent: false,
      reason: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      inviteUrl
    };
  }

  const fromAddress = env?.EMAIL_FROM || 'SamacharDaily Editorial <editorial@thesamachardaily.in>';
  const html = generateInvitationEmailHtml({ email, role, inviteUrl, expiresAt });
  const text = generateInvitationEmailText({ email, role, inviteUrl, expiresAt });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: "You're invited to SamacharDaily Editorial Control",
        html,
        text
      })
    });

    if (res.ok) {
      const data = await res.json();
      return {
        sent: true,
        id: data.id || null,
        provider: 'resend',
        to: email,
        inviteUrl
      };
    } else {
      const errText = await res.text();
      let errMsg = `Email provider rejected message (${res.status})`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.message) errMsg = errJson.message;
      } catch (_) {}
      return {
        sent: false,
        reason: errMsg,
        providerStatus: res.status,
        inviteUrl
      };
    }
  } catch (err) {
    return {
      sent: false,
      reason: err.message || 'Network error reaching email provider',
      inviteUrl
    };
  }
}
