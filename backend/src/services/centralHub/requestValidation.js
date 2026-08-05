const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEPLOYMENT_MODES = new Set([
  'SAAS_MULTI_TENANT',
  'SINGLE_TENANT_CLOUD',
  'ON_PREMISE',
  'HYBRID',
]);

const PACKAGE_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'VALIDATED',
  'MAPPED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'INJECTED',
  'PUBLISHED',
  'REJECTED',
  'NEEDS_REWORK',
  'CANCELLED',
]);

const APPROVAL_DECISIONS = new Set(['APPROVE', 'REJECT', 'REQUEST_REWORK']);
const AUTH_TYPES = new Set(['OAUTH2_CLIENT_CREDENTIALS', 'API_KEY', 'MTLS']);
const DELIVERY_MODES = new Set(['WEBHOOK', 'MESSAGE_BUS']);
const ENTERPRISE_MODULES = new Set(['sap_pm', 'work_management', 'edms', 'pi_system', 'dcs', 'predictive_analytics']);
const WRITEBACK_STATUSES = new Set(['RECEIVED', 'VALIDATED', 'DISPATCHED', 'ACKNOWLEDGED', 'REJECTED', 'FAILED']);

function validationError(message) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  return err;
}

function ensureObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${name} must be an object`);
  }
}

function ensureUuid(value, name) {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw validationError(`${name} must be a valid UUID`);
  }
}

function ensureString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(`${name} is required`);
  }
}

function ensureStringArray(value, name) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
    throw validationError(`${name} must be an array of strings`);
  }
}

export function validateTenantIdParam(tenantId) {
  ensureUuid(tenantId, 'tenantId');
}

export function validatePackageIdParam(packageId) {
  ensureUuid(packageId, 'packageId');
}

export function validateCommandIdParam(commandId) {
  ensureUuid(commandId, 'commandId');
}

export function validateSubscriptionIdParam(subscriptionId) {
  ensureUuid(subscriptionId, 'subscriptionId');
}

export function validateCreateTenantBody(body) {
  ensureObject(body, 'body');
  ensureString(body.name, 'name');
  ensureString(body.code, 'code');
  if (body.deployment_mode && !DEPLOYMENT_MODES.has(body.deployment_mode)) {
    throw validationError('deployment_mode is invalid');
  }
}

export function validatePatchTenantModulesBody(body) {
  ensureObject(body, 'body');
  if (body.enabled_modules !== undefined) ensureStringArray(body.enabled_modules, 'enabled_modules');
  if (body.disabled_modules !== undefined) ensureStringArray(body.disabled_modules, 'disabled_modules');
}

export function validateRegisterModuleClientBody(body) {
  ensureObject(body, 'body');
  ensureString(body.module_name, 'module_name');
  ensureString(body.auth_type, 'auth_type');
  if (!AUTH_TYPES.has(body.auth_type)) {
    throw validationError('auth_type is invalid');
  }
  if (body.scopes !== undefined) ensureStringArray(body.scopes, 'scopes');
  if (body.callback_urls !== undefined) ensureStringArray(body.callback_urls, 'callback_urls');
}

export function validateListChangePackagesQuery(query) {
  if (!query || typeof query !== 'object') return;
  if (query.tenant_id !== undefined && query.tenant_id !== null) ensureUuid(query.tenant_id, 'tenant_id');
  if (query.status !== undefined && query.status !== null && !PACKAGE_STATUSES.has(query.status)) {
    throw validationError('status is invalid');
  }
}

export function validateCreateChangePackageBody(body) {
  ensureObject(body, 'body');
  ensureUuid(body.tenant_id, 'tenant_id');
  ensureString(body.source_system, 'source_system');
  ensureString(body.package_type, 'package_type');
}

export function validateCreateApprovalDecisionBody(body) {
  ensureObject(body, 'body');
  ensureString(body.approver_role, 'approver_role');
  ensureString(body.decision, 'decision');
  if (!APPROVAL_DECISIONS.has(body.decision)) {
    throw validationError('decision is invalid');
  }
}

export function validateMasterTagsQuery(query) {
  if (!query || typeof query !== 'object') return;
  if (query.tenant_id !== undefined && query.tenant_id !== null) ensureUuid(query.tenant_id, 'tenant_id');
}

export function validateMasterRelationshipsQuery(query) {
  if (!query || typeof query !== 'object') return;
  if (query.object_id !== undefined && query.object_id !== null) ensureString(query.object_id, 'object_id');
  if (query.relationship_type !== undefined && query.relationship_type !== null) {
    if (!['topology_edge', 'pnid_line'].includes(String(query.relationship_type))) {
      throw validationError('relationship_type must be topology_edge or pnid_line');
    }
  }
  if (query.direction !== undefined && query.direction !== null) {
    const normalized = String(query.direction).toUpperCase();
    if (!['INBOUND', 'OUTBOUND', 'BOTH'].includes(normalized)) {
      throw validationError('direction must be INBOUND, OUTBOUND, or BOTH');
    }
  }
  if (query.depth !== undefined && query.depth !== null) {
    const depth = Number(query.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 6) {
      throw validationError('depth must be an integer between 1 and 6');
    }
    if (depth > 1 && (query.object_id === undefined || query.object_id === null || String(query.object_id).trim() === '')) {
      throw validationError('object_id is required when depth > 1');
    }
  }
  if (query.limit !== undefined && query.limit !== null) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
      throw validationError('limit must be an integer between 1 and 5000');
    }
  }
}

export function validateCheckpointQuery(query) {
  if (!query || typeof query !== 'object') {
    throw validationError('query is required');
  }
  ensureUuid(query.tenant_id, 'tenant_id');
}

export function validateCheckpointBody(body) {
  ensureObject(body, 'body');
  ensureUuid(body.tenant_id, 'tenant_id');
}

export function validateCreateEventSubscriptionBody(body) {
  ensureObject(body, 'body');
  ensureUuid(body.tenant_id, 'tenant_id');
  ensureStringArray(body.event_types, 'event_types');
  ensureObject(body.delivery, 'delivery');
  ensureString(body.delivery.mode, 'delivery.mode');
  if (!DELIVERY_MODES.has(body.delivery.mode)) {
    throw validationError('delivery.mode is invalid');
  }
}

export function validatePatchEventSubscriptionBody(body) {
  ensureObject(body, 'body');
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    throw validationError('active must be boolean');
  }
  if (body.event_types !== undefined) ensureStringArray(body.event_types, 'event_types');
}

export function validateEnterpriseWritebackCreateBody(body) {
  ensureObject(body, 'body');
  ensureUuid(body.tenant_id, 'tenant_id');
  ensureString(body.module, 'module');
  ensureString(body.external_ref, 'external_ref');
  ensureString(body.command_type, 'command_type');
  ensureObject(body.command_payload, 'command_payload');
  if (!ENTERPRISE_MODULES.has(String(body.module))) {
    throw validationError('module is invalid');
  }
  if (body.requested_by !== undefined && body.requested_by !== null) {
    ensureString(body.requested_by, 'requested_by');
  }
}

export function validateEnterpriseWritebackListQuery(query) {
  if (!query || typeof query !== 'object') return;
  if (query.tenant_id !== undefined && query.tenant_id !== null) ensureUuid(query.tenant_id, 'tenant_id');
  if (query.module !== undefined && query.module !== null && !ENTERPRISE_MODULES.has(String(query.module))) {
    throw validationError('module is invalid');
  }
  if (query.status !== undefined && query.status !== null && !WRITEBACK_STATUSES.has(String(query.status).toUpperCase())) {
    throw validationError('status is invalid');
  }
  if (query.limit !== undefined && query.limit !== null) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw validationError('limit must be an integer between 1 and 500');
    }
  }
}

export function validateEnterpriseWritebackAckBody(body) {
  ensureObject(body, 'body');
  ensureString(body.status, 'status');
  if (!['VALIDATED', 'DISPATCHED', 'ACKNOWLEDGED', 'REJECTED', 'FAILED'].includes(String(body.status).toUpperCase())) {
    throw validationError('status must be one of VALIDATED, DISPATCHED, ACKNOWLEDGED, REJECTED, FAILED');
  }
  if (body.expected_lock_version !== undefined && body.expected_lock_version !== null) {
    const lockVersion = Number(body.expected_lock_version);
    if (!Number.isInteger(lockVersion) || lockVersion < 0) {
      throw validationError('expected_lock_version must be a non-negative integer');
    }
  }
  if (body.response_payload !== undefined && body.response_payload !== null) {
    ensureObject(body.response_payload, 'response_payload');
  }
}
