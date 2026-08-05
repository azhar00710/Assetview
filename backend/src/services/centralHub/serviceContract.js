import prisma from '../../db.js';
import {
  approvalsSatisfied,
  hasMocReference,
  normalizeRole,
  requiredRolesForPackage,
} from './approvalPolicy.js';

const VALID_TRANSITIONS = Object.freeze({
  submit: {
    from: ['DRAFT', 'NEEDS_REWORK'],
    to: 'SUBMITTED',
  },
  validate: {
    from: ['SUBMITTED'],
    to: 'VALIDATED',
  },
  map: {
    from: ['VALIDATED'],
    to: 'MAPPED',
  },
  inject: {
    from: ['APPROVED'],
    to: 'INJECTED',
  },
  publish: {
    from: ['INJECTED'],
    to: 'PUBLISHED',
  },
});

function packageRef() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CP-${ymd}-${suffix}`;
}

async function appendPackageAudit({ packageId, fromStatus, toStatus, action, actorId = null, reason = null, payload = {} }) {
  await prisma.$queryRaw`
    INSERT INTO ceh_change_package_audit
      (change_package_id, from_status, to_status, action, actor_id, reason, payload)
    VALUES
      (${packageId}::uuid, ${fromStatus}::ceh_change_package_status, ${toStatus}::ceh_change_package_status, ${action}, ${actorId}, ${reason}, ${JSON.stringify(payload)}::jsonb)
  `;
}

async function enqueueOutboxEvent({ aggregateId, eventType, eventKey = null, payload = {}, headers = {} }) {
  await prisma.$queryRaw`
    INSERT INTO cp_event_outbox
      (aggregate_type, aggregate_id, event_type, event_key, payload, headers)
    VALUES
      ('change_package', ${aggregateId}::uuid, ${eventType}, ${eventKey}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(headers)}::jsonb)
  `;
}

async function getChangePackage(packageId) {
  const rows = await prisma.$queryRaw`
    SELECT id, tenant_id, package_ref, source_system, source_org, package_type, status, scope, risk, metadata, lock_version, created_at, updated_at
    FROM ceh_change_package
    WHERE id = ${packageId}::uuid
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getApprovedRoles(packageId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT UPPER(approver_role) AS approver_role
    FROM ceh_approval_decision_log
    WHERE change_package_id = ${packageId}::uuid
      AND decision = 'APPROVE'::ceh_approval_decision
  `;
  return rows.map((r) => r.approver_role);
}

function normalizeRows(rows) {
  return rows.map((r) => ({
    ...r,
    created_at: r.created_at?.toISOString?.() || r.created_at,
    updated_at: r.updated_at?.toISOString?.() || r.updated_at,
  }));
}

const ENTERPRISE_MODULES = new Set(['sap_pm', 'work_management', 'edms', 'pi_system', 'dcs', 'predictive_analytics']);

function normalizeWritebackRows(rows) {
  return rows.map((r) => ({
    ...r,
    status: String(r.status || '').toUpperCase(),
    created_at: r.created_at?.toISOString?.() || r.created_at,
    updated_at: r.updated_at?.toISOString?.() || r.updated_at,
  }));
}

export async function listTenants() {
  const rows = await prisma.$queryRaw`
    SELECT id, tenant_code, tenant_name, deployment_mode, data_residency, metadata, created_at, updated_at
    FROM ceh_tenant
    ORDER BY tenant_name ASC
  `;
  return { tenants: normalizeRows(rows) };
}

export async function createTenant(input = {}) {
  const {
    name,
    code,
    deployment_mode = 'SAAS_MULTI_TENANT',
    data_residency = null,
    metadata = {},
  } = input;

  if (!name || !code) {
    const err = new Error('name and code are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_tenant
      (tenant_name, tenant_code, deployment_mode, data_residency, metadata)
    VALUES
      (${name}, ${code}, ${deployment_mode}::ceh_deployment_mode, ${data_residency}, ${JSON.stringify(metadata)}::jsonb)
    RETURNING id, tenant_code, tenant_name, deployment_mode, data_residency, metadata, created_at, updated_at
  `;
  return { tenant: normalizeRows(rows)[0] };
}

export async function listTenantModules(tenantId) {
  const rows = await prisma.$queryRaw`
    SELECT id, tenant_id, module_name, is_enabled, config, created_at, updated_at
    FROM ceh_tenant_module
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY module_name ASC
  `;
  return { modules: normalizeRows(rows) };
}

export async function patchTenantModules(tenantId, input = {}) {
  const enabled = Array.isArray(input.enabled_modules) ? input.enabled_modules : [];
  const disabled = Array.isArray(input.disabled_modules) ? input.disabled_modules : [];

  for (const moduleName of enabled) {
    await prisma.$queryRaw`
      INSERT INTO ceh_tenant_module (tenant_id, module_name, is_enabled, config)
      VALUES (${tenantId}::uuid, ${moduleName}, true, '{}'::jsonb)
      ON CONFLICT (tenant_id, module_name)
      DO UPDATE SET is_enabled = true, updated_at = now()
    `;
  }

  for (const moduleName of disabled) {
    await prisma.$queryRaw`
      INSERT INTO ceh_tenant_module (tenant_id, module_name, is_enabled, config)
      VALUES (${tenantId}::uuid, ${moduleName}, false, '{}'::jsonb)
      ON CONFLICT (tenant_id, module_name)
      DO UPDATE SET is_enabled = false, updated_at = now()
    `;
  }

  return listTenantModules(tenantId);
}

export async function registerModuleClient(tenantId, input = {}) {
  const {
    module_name,
    auth_type,
    scopes = [],
    callback_urls = [],
  } = input;

  if (!module_name || !auth_type) {
    const err = new Error('module_name and auth_type are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_module_client
      (tenant_id, module_name, auth_type, scopes, callback_urls, is_active)
    VALUES
      (${tenantId}::uuid, ${module_name}, ${auth_type}, ${JSON.stringify(scopes)}::jsonb, ${JSON.stringify(callback_urls)}::jsonb, true)
    RETURNING id, tenant_id, module_name, auth_type, scopes, callback_urls, is_active, created_at, updated_at
  `;
  return { moduleClient: normalizeRows(rows)[0] };
}

export async function listChangePackages(filters = {}) {
  const { tenant_id = null, status = null } = filters;

  const rows = await prisma.$queryRaw`
    SELECT id, tenant_id, package_ref, source_system, source_org, package_type, status, scope, risk, metadata, lock_version, created_at, updated_at
    FROM ceh_change_package
    WHERE (${tenant_id}::uuid IS NULL OR tenant_id = ${tenant_id}::uuid)
      AND (${status}::text IS NULL OR status::text = ${status}::text)
    ORDER BY created_at DESC
    LIMIT 500
  `;
  return { changePackages: normalizeRows(rows) };
}

export async function createChangePackage(input = {}) {
  const {
    tenant_id,
    source_system,
    source_org = null,
    package_type,
    scope = {},
    risk = {},
    metadata = {},
  } = input;

  if (!tenant_id || !source_system || !package_type) {
    const err = new Error('tenant_id, source_system, package_type are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const ref = packageRef();
  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_change_package
      (tenant_id, package_ref, source_system, source_org, package_type, status, scope, risk, metadata, lock_version)
    VALUES
      (${tenant_id}::uuid, ${ref}, ${source_system}, ${source_org}, ${package_type}, 'DRAFT'::ceh_change_package_status, ${JSON.stringify(scope)}::jsonb, ${JSON.stringify(risk)}::jsonb, ${JSON.stringify(metadata)}::jsonb, 0)
    RETURNING id, tenant_id, package_ref, source_system, source_org, package_type, status, scope, risk, metadata, lock_version, created_at, updated_at
  `;
  const created = rows[0];

  await appendPackageAudit({
    packageId: created.id,
    fromStatus: null,
    toStatus: 'DRAFT',
    action: 'create',
    payload: { source_system, package_type },
  });

  await enqueueOutboxEvent({
    aggregateId: created.id,
    eventType: 'ceh.v1.change_package.created',
    eventKey: tenant_id,
    payload: { packageId: created.id, packageRef: created.package_ref, status: created.status },
  });

  return { changePackage: normalizeRows([created])[0] };
}

export async function runPipelineStep(packageId, step) {
  const rule = VALID_TRANSITIONS[step];
  if (!rule) {
    const err = new Error(`Unknown pipeline step: ${step}`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const current = await getChangePackage(packageId);
  if (!current) {
    const err = new Error('Change package not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (!rule.from.includes(current.status)) {
    const err = new Error(`Invalid transition from ${current.status} via ${step}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const updatedRows = await prisma.$queryRaw`
    UPDATE ceh_change_package
    SET
      status = ${rule.to}::ceh_change_package_status,
      lock_version = lock_version + 1,
      updated_at = now()
    WHERE id = ${packageId}::uuid
      AND lock_version = ${current.lock_version}
    RETURNING id, tenant_id, package_ref, source_system, source_org, package_type, status, scope, risk, metadata, lock_version, created_at, updated_at
  `;
  if (!updatedRows[0]) {
    const err = new Error('Change package was modified concurrently; retry request');
    err.code = 'CONFLICT_RETRY';
    throw err;
  }
  const updated = updatedRows[0];

  await appendPackageAudit({
    packageId,
    fromStatus: current.status,
    toStatus: rule.to,
    action: step,
    payload: { step },
  });

  await enqueueOutboxEvent({
    aggregateId: packageId,
    eventType: `ceh.v1.change_package.${rule.to.toLowerCase()}`,
    eventKey: updated.tenant_id,
    payload: { packageId, packageRef: updated.package_ref, status: updated.status, step },
  });

  return { changePackage: normalizeRows([updated])[0] };
}

export async function createApprovalDecision(packageId, input = {}) {
  const {
    approver_role,
    approver_id = 'unknown',
    decision,
    reason = null,
    evidence_refs = [],
  } = input;

  if (!approver_role || !decision) {
    const err = new Error('approver_role and decision are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const current = await getChangePackage(packageId);
  if (!current) {
    const err = new Error('Change package not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (['INJECTED', 'PUBLISHED', 'CANCELLED'].includes(current.status)) {
    const err = new Error(`Cannot approve package in ${current.status} state`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const normalizedRole = normalizeRole(approver_role);
  const normalizedDecision = String(decision).toUpperCase();
  if (normalizedDecision === 'APPROVE') {
    const { criticality } = requiredRolesForPackage(current);
    if (criticality === 'SAFETY_CRITICAL' && !hasMocReference(current)) {
      const err = new Error('SAFETY_CRITICAL package requires moc_reference in metadata or scope');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
  }

  const logRows = await prisma.$queryRaw`
    INSERT INTO ceh_approval_decision_log
      (change_package_id, approver_role, approver_id, decision, reason, evidence_refs)
    VALUES
      (${packageId}::uuid, ${normalizedRole}, ${approver_id}, ${normalizedDecision}::ceh_approval_decision, ${reason}, ${JSON.stringify(evidence_refs)}::jsonb)
    RETURNING id, change_package_id, approver_role, approver_id, decision, reason, evidence_refs, created_at
  `;

  let targetStatus = current.status;
  if (normalizedDecision === 'REQUEST_REWORK') targetStatus = 'NEEDS_REWORK';
  if (normalizedDecision === 'REJECT') targetStatus = 'REJECTED';
  if (normalizedDecision === 'APPROVE') {
    const { requiredRoles } = requiredRolesForPackage(current);
    const approvedRoles = await getApprovedRoles(packageId);
    targetStatus = approvalsSatisfied(requiredRoles, approvedRoles) ? 'APPROVED' : 'REVIEW_REQUIRED';
  }

  if (targetStatus !== current.status) {
    const updateRows = await prisma.$queryRaw`
      UPDATE ceh_change_package
      SET
        status = ${targetStatus}::ceh_change_package_status,
        lock_version = lock_version + 1,
        updated_at = now()
      WHERE id = ${packageId}::uuid
        AND lock_version = ${current.lock_version}
      RETURNING id
    `;
    if (!updateRows[0]) {
      const err = new Error('Change package was modified concurrently during approval; retry request');
      err.code = 'CONFLICT_RETRY';
      throw err;
    }

    await appendPackageAudit({
      packageId,
      fromStatus: current.status,
      toStatus: targetStatus,
      action: 'approval',
      actorId: approver_id,
      reason,
      payload: { decision: normalizedDecision, approver_role: normalizedRole },
    });

    await enqueueOutboxEvent({
      aggregateId: packageId,
      eventType: `ceh.v1.change_package.${targetStatus.toLowerCase()}`,
      eventKey: current.tenant_id,
      payload: { packageId, decision: normalizedDecision, targetStatus },
    });
  }

  const refreshed = await getChangePackage(packageId);
  return {
    approval: logRows[0],
    changePackage: normalizeRows([refreshed])[0],
  };
}

export async function publishChangePackage(packageId) {
  return runPipelineStep(packageId, 'publish');
}

export async function listMasterTags(query = {}) {
  const { tenant_id = null, q = null } = query;

  const rows = await prisma.$queryRaw`
    WITH tag_rows AS (
      SELECT 'equipment'::text AS tag_source, e.id AS source_id, e.tag, e.description, s.code AS system_code, s.platform_id
      FROM equipment e
      JOIN system s ON s.id = e.system_id
      WHERE e.deleted_at IS NULL AND s.deleted_at IS NULL
      UNION ALL
      SELECT 'instrument'::text AS tag_source, i.id AS source_id, i.tag, i.description, s.code AS system_code, s.platform_id
      FROM instrument i
      JOIN system s ON s.id = i.system_id
      WHERE i.deleted_at IS NULL AND s.deleted_at IS NULL
    )
    SELECT tag_source, source_id, tag, description, system_code, platform_id
    FROM tag_rows
    WHERE (${q}::text IS NULL OR tag ILIKE '%' || ${q}::text || '%' OR COALESCE(description, '') ILIKE '%' || ${q}::text || '%')
      AND (${tenant_id}::uuid IS NULL OR platform_id = ${tenant_id}::uuid)
    ORDER BY tag
    LIMIT 500
  `;

  return { tags: rows };
}

export async function listMasterRelationships(query = {}) {
  const {
    object_id = null,
    relationship_type = null,
    direction = 'BOTH',
    depth = 1,
    limit = 1000,
  } = query;

  const normalizedDirection = String(direction || 'BOTH').toUpperCase();
  const parsedDepth = Number(depth) || 1;
  const parsedLimit = Number(limit) || 1000;

  const rows = await prisma.$queryRaw`
    WITH RECURSIVE rel AS (
      SELECT 'topology_edge'::text AS relationship_type,
             te.id::text AS relationship_id,
             te.from_node_id::text AS from_ref,
             te.to_node_id::text AS to_ref,
             te.edge_type::text AS relation_label
      FROM topology_edge te
      WHERE (${relationship_type}::text IS NULL OR ${relationship_type}::text = 'topology_edge')
      UNION ALL
      SELECT 'pnid_line'::text AS relationship_type,
             pl.id::text AS relationship_id,
             pl.pnid_id::text AS from_ref,
             pl.line_id::text AS to_ref,
             CASE WHEN COALESCE(pl.is_continuation, false) THEN 'continuation' ELSE 'appears_on' END AS relation_label
      FROM pnid_line pl
      WHERE (${relationship_type}::text IS NULL OR ${relationship_type}::text = 'pnid_line')
    ),
    seed AS (
      SELECT
        relationship_type,
        relationship_id,
        from_ref,
        to_ref,
        relation_label,
        CASE
          WHEN ${object_id}::text IS NULL THEN 'TRAVERSED'
          WHEN from_ref = ${object_id}::text THEN 'OUTBOUND'
          WHEN to_ref = ${object_id}::text THEN 'INBOUND'
          ELSE 'TRAVERSED'
        END AS direction,
        1 AS depth,
        ARRAY[relationship_id]::text[] AS visited_edge_ids,
        CASE
          WHEN ${object_id}::text IS NULL THEN NULL::text
          WHEN from_ref = ${object_id}::text THEN to_ref
          WHEN to_ref = ${object_id}::text THEN from_ref
          ELSE NULL::text
        END AS current_node
      FROM rel
      WHERE (${object_id}::text IS NULL OR from_ref = ${object_id}::text OR to_ref = ${object_id}::text)
        AND (
          ${object_id}::text IS NULL
          OR ${normalizedDirection}::text = 'BOTH'
          OR (${normalizedDirection}::text = 'OUTBOUND' AND from_ref = ${object_id}::text)
          OR (${normalizedDirection}::text = 'INBOUND' AND to_ref = ${object_id}::text)
        )
    ),
    walk AS (
      SELECT * FROM seed
      UNION ALL
      SELECT
        nxt.relationship_type,
        nxt.relationship_id,
        nxt.from_ref,
        nxt.to_ref,
        nxt.relation_label,
        CASE
          WHEN nxt.from_ref = walk.current_node THEN 'OUTBOUND'
          ELSE 'INBOUND'
        END AS direction,
        walk.depth + 1 AS depth,
        walk.visited_edge_ids || nxt.relationship_id,
        CASE
          WHEN nxt.from_ref = walk.current_node THEN nxt.to_ref
          ELSE nxt.from_ref
        END AS current_node
      FROM walk
      JOIN rel nxt
        ON walk.current_node IS NOT NULL
        AND walk.depth < ${parsedDepth}
        AND NOT (nxt.relationship_id = ANY(walk.visited_edge_ids))
        AND (
          (${normalizedDirection}::text = 'BOTH' AND (nxt.from_ref = walk.current_node OR nxt.to_ref = walk.current_node))
          OR (${normalizedDirection}::text = 'OUTBOUND' AND nxt.from_ref = walk.current_node)
          OR (${normalizedDirection}::text = 'INBOUND' AND nxt.to_ref = walk.current_node)
        )
    )
    SELECT DISTINCT
      relationship_type,
      relationship_id,
      from_ref,
      to_ref,
      relation_label,
      direction,
      depth
    FROM walk
    ORDER BY depth ASC, relationship_type ASC, relationship_id ASC
    LIMIT ${parsedLimit}
  `;

  return { relationships: rows };
}

export async function getSatelliteCheckpoint(satelliteId, query = {}) {
  const { tenant_id } = query;
  if (!tenant_id) {
    const err = new Error('tenant_id is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    SELECT id, tenant_id, satellite_id, checkpoint, last_event_id, updated_at
    FROM ceh_satellite_checkpoint
    WHERE tenant_id = ${tenant_id}::uuid AND satellite_id = ${satelliteId}
    LIMIT 1
  `;
  return { checkpoint: normalizeRows(rows)[0] || null };
}

export async function upsertSatelliteCheckpoint(satelliteId, input = {}) {
  const { tenant_id, checkpoint = null, last_event_id = null } = input;
  if (!tenant_id) {
    const err = new Error('tenant_id is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_satellite_checkpoint
      (tenant_id, satellite_id, checkpoint, last_event_id, updated_at)
    VALUES
      (${tenant_id}::uuid, ${satelliteId}, ${checkpoint}, ${last_event_id}, now())
    ON CONFLICT (tenant_id, satellite_id)
    DO UPDATE SET checkpoint = EXCLUDED.checkpoint, last_event_id = EXCLUDED.last_event_id, updated_at = now()
    RETURNING id, tenant_id, satellite_id, checkpoint, last_event_id, updated_at
  `;
  return { checkpoint: normalizeRows(rows)[0] };
}

export async function createEventSubscription(input = {}) {
  const { tenant_id, event_types = [], filter = {}, delivery = {} } = input;
  if (!tenant_id || !Array.isArray(event_types) || event_types.length === 0) {
    const err = new Error('tenant_id and non-empty event_types are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const mode = String(delivery.mode || '').toUpperCase();
  if (!['WEBHOOK', 'MESSAGE_BUS'].includes(mode)) {
    const err = new Error('delivery.mode must be WEBHOOK or MESSAGE_BUS');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (mode === 'WEBHOOK' && !delivery.webhook_url && !delivery.url) {
    const err = new Error('WEBHOOK delivery requires webhook_url');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (mode === 'MESSAGE_BUS' && !delivery.topic && !delivery.channel) {
    const err = new Error('MESSAGE_BUS delivery requires topic');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_event_subscription
      (tenant_id, event_types, filter, delivery, active)
    VALUES
      (${tenant_id}::uuid, ${JSON.stringify(event_types)}::jsonb, ${JSON.stringify(filter)}::jsonb, ${JSON.stringify(delivery)}::jsonb, true)
    RETURNING id, tenant_id, event_types, filter, delivery, active, created_at, updated_at
  `;
  return { subscription: normalizeRows(rows)[0] };
}

export async function patchEventSubscription(subscriptionId, input = {}) {
  const { active = null, event_types = null } = input;
  if (event_types !== null && (!Array.isArray(event_types) || event_types.length === 0)) {
    const err = new Error('event_types must be a non-empty array when provided');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const rows = await prisma.$queryRaw`
    UPDATE ceh_event_subscription
    SET
      active = COALESCE(${active}::boolean, active),
      event_types = COALESCE(${event_types ? JSON.stringify(event_types) : null}::jsonb, event_types),
      updated_at = now()
    WHERE id = ${subscriptionId}::uuid
    RETURNING id, tenant_id, event_types, filter, delivery, active, created_at, updated_at
  `;

  if (!rows[0]) {
    const err = new Error('Subscription not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { subscription: normalizeRows(rows)[0] };
}

export async function listEnterpriseWritebackCommands(query = {}) {
  const {
    tenant_id = null,
    module = null,
    status = null,
    limit = 100,
  } = query;

  const parsedLimit = Number(limit) || 100;
  const rows = await prisma.$queryRaw`
    SELECT
      id,
      tenant_id,
      module,
      external_ref,
      command_type,
      command_payload,
      status,
      requested_by,
      response_payload,
      reason,
      lock_version,
      created_at,
      updated_at
    FROM ceh_enterprise_writeback_command
    WHERE (${tenant_id}::uuid IS NULL OR tenant_id = ${tenant_id}::uuid)
      AND (${module}::text IS NULL OR module = ${module}::text)
      AND (${status}::text IS NULL OR status::text = UPPER(${status}::text))
    ORDER BY created_at DESC
    LIMIT ${parsedLimit}
  `;

  return { commands: normalizeWritebackRows(rows) };
}

export async function getEnterpriseWritebackCommand(commandId) {
  const rows = await prisma.$queryRaw`
    SELECT
      id,
      tenant_id,
      module,
      external_ref,
      command_type,
      command_payload,
      status,
      requested_by,
      response_payload,
      reason,
      lock_version,
      created_at,
      updated_at
    FROM ceh_enterprise_writeback_command
    WHERE id = ${commandId}::uuid
    LIMIT 1
  `;

  if (!rows[0]) {
    const err = new Error('Enterprise writeback command not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return { command: normalizeWritebackRows(rows)[0] };
}

export async function createEnterpriseWritebackCommand(input = {}) {
  const {
    tenant_id,
    module,
    external_ref,
    command_type,
    command_payload = {},
    requested_by = 'system',
  } = input;

  if (!ENTERPRISE_MODULES.has(String(module))) {
    const err = new Error(`Unsupported enterprise module: ${module}`);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO ceh_enterprise_writeback_command
      (tenant_id, module, external_ref, command_type, command_payload, status, requested_by, lock_version)
    VALUES
      (${tenant_id}::uuid, ${module}, ${external_ref}, ${command_type}, ${JSON.stringify(command_payload)}::jsonb, 'RECEIVED'::ceh_writeback_status, ${requested_by}, 0)
    RETURNING
      id,
      tenant_id,
      module,
      external_ref,
      command_type,
      command_payload,
      status,
      requested_by,
      response_payload,
      reason,
      lock_version,
      created_at,
      updated_at
  `;
  const command = rows[0];

  await prisma.$queryRaw`
    INSERT INTO ceh_enterprise_writeback_audit
      (command_id, from_status, to_status, action, note, payload)
    VALUES
      (${command.id}::uuid, NULL, 'RECEIVED'::ceh_writeback_status, 'create', NULL, ${JSON.stringify({ module, command_type })}::jsonb)
  `;

  await enqueueOutboxEvent({
    aggregateId: command.id,
    eventType: 'ceh.v1.enterprise_writeback.received',
    eventKey: tenant_id,
    payload: {
      commandId: command.id,
      module,
      externalRef: external_ref,
      commandType: command_type,
    },
  });

  return { command: normalizeWritebackRows([command])[0] };
}

export async function acknowledgeEnterpriseWritebackCommand(commandId, input = {}) {
  const {
    status,
    reason = null,
    response_payload = {},
    expected_lock_version = null,
  } = input;
  const normalizedStatus = String(status).toUpperCase();

  const currentRows = await prisma.$queryRaw`
    SELECT id, tenant_id, module, status, lock_version
    FROM ceh_enterprise_writeback_command
    WHERE id = ${commandId}::uuid
    LIMIT 1
  `;
  const current = currentRows[0];
  if (!current) {
    const err = new Error('Enterprise writeback command not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (expected_lock_version !== null && Number(expected_lock_version) !== Number(current.lock_version)) {
    const err = new Error('Command was modified concurrently; retry with latest lock_version');
    err.code = 'CONFLICT_RETRY';
    throw err;
  }

  const updatedRows = await prisma.$queryRaw`
    UPDATE ceh_enterprise_writeback_command
    SET
      status = ${normalizedStatus}::ceh_writeback_status,
      reason = ${reason},
      response_payload = ${JSON.stringify(response_payload)}::jsonb,
      lock_version = lock_version + 1,
      updated_at = now()
    WHERE id = ${commandId}::uuid
      AND lock_version = ${current.lock_version}
    RETURNING
      id,
      tenant_id,
      module,
      external_ref,
      command_type,
      command_payload,
      status,
      requested_by,
      response_payload,
      reason,
      lock_version,
      created_at,
      updated_at
  `;
  if (!updatedRows[0]) {
    const err = new Error('Command was modified concurrently; retry request');
    err.code = 'CONFLICT_RETRY';
    throw err;
  }
  const updated = updatedRows[0];

  await prisma.$queryRaw`
    INSERT INTO ceh_enterprise_writeback_audit
      (command_id, from_status, to_status, action, note, payload)
    VALUES
      (${commandId}::uuid, ${current.status}::ceh_writeback_status, ${normalizedStatus}::ceh_writeback_status, 'ack', ${reason}, ${JSON.stringify(response_payload)}::jsonb)
  `;

  await enqueueOutboxEvent({
    aggregateId: commandId,
    eventType: `ceh.v1.enterprise_writeback.${normalizedStatus.toLowerCase()}`,
    eventKey: updated.tenant_id,
    payload: {
      commandId,
      module: updated.module,
      status: normalizedStatus,
      reason,
    },
  });

  return { command: normalizeWritebackRows([updated])[0] };
}
