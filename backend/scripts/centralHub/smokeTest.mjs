/* eslint-disable no-console */
const baseUrl = process.env.CENTRAL_HUB_BASE_URL || 'http://127.0.0.1:3001/api/v1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(method, path, body, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { status: response.status, ok: response.ok, payload };
}

function randomCode(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function run() {
  console.log(`Using base URL: ${baseUrl}`);

  // 0) Health check
  const health = await api('GET', '/central-hub/health');
  assert(health.ok, `Health check failed: ${health.status}`);
  console.log('Health check: OK');

  // 1) Create tenant (idempotent)
  const tenantCode = randomCode('CEH');
  const tenantBody = {
    name: `Central Hub Smoke ${tenantCode}`,
    code: tenantCode,
    deployment_mode: 'SAAS_MULTI_TENANT',
    data_residency: 'AE',
  };
  const tenantKey = randomCode('idem-tenant');

  const tenantCreate = await api('POST', '/tenants', tenantBody, tenantKey);
  assert(tenantCreate.status === 201, `Tenant create expected 201, got ${tenantCreate.status}`);
  const tenantId = tenantCreate.payload?.tenant?.id;
  assert(tenantId, 'Tenant create returned no tenant.id');
  console.log('Create tenant: OK');

  const tenantReplay = await api('POST', '/tenants', tenantBody, tenantKey);
  assert(tenantReplay.status === 201, `Tenant replay expected 201, got ${tenantReplay.status}`);
  assert(
    tenantReplay.payload?.tenant?.id === tenantId,
    'Tenant replay did not return the same tenant record'
  );
  console.log('Tenant idempotency replay: OK');

  const tenantConflict = await api(
    'POST',
    '/tenants',
    { ...tenantBody, name: `${tenantBody.name} changed` },
    tenantKey
  );
  assert(tenantConflict.status === 409, `Tenant key conflict expected 409, got ${tenantConflict.status}`);
  console.log('Tenant idempotency conflict detection: OK');

  // 2) Create package (HIGH criticality for approval matrix test)
  const packageKey = randomCode('idem-package');
  const packageBody = {
    tenant_id: tenantId,
    source_system: 'P&ID_MODULE',
    source_org: 'GeoSoft',
    package_type: 'DESIGN_MODIFICATION',
    risk: { criticality: 'HIGH' },
    scope: { platform_ids: ['WHT-5'], moc_reference: 'MOC-SMOKE-001' },
    metadata: { smoke_test: true },
  };

  const pkgCreate = await api('POST', '/change-packages', packageBody, packageKey);
  assert(pkgCreate.status === 201, `Package create expected 201, got ${pkgCreate.status}`);
  const packageId = pkgCreate.payload?.changePackage?.id;
  assert(packageId, 'Package create returned no changePackage.id');
  console.log('Create change package: OK');

  const pkgReplay = await api('POST', '/change-packages', packageBody, packageKey);
  assert(pkgReplay.status === 201, `Package replay expected 201, got ${pkgReplay.status}`);
  assert(
    pkgReplay.payload?.changePackage?.id === packageId,
    'Package replay did not return same package'
  );
  console.log('Package idempotency replay: OK');

  // 3) Lifecycle transitions with idempotency
  const submit = await api('POST', `/change-packages/${packageId}/submit`, {}, randomCode('idem-submit'));
  assert(submit.status === 200, `Submit expected 200, got ${submit.status}`);

  const validate = await api(
    'POST',
    `/change-packages/${packageId}/validate`,
    {},
    randomCode('idem-validate')
  );
  assert(validate.status === 200, `Validate expected 200, got ${validate.status}`);

  const map = await api('POST', `/change-packages/${packageId}/map`, {}, randomCode('idem-map'));
  assert(map.status === 200, `Map expected 200, got ${map.status}`);
  console.log('Lifecycle transitions submit/validate/map: OK');

  // 4) Approval matrix for HIGH: DISCIPLINE_LEAD + OPERATIONS + DATA_GOVERNANCE
  const approve1 = await api(
    'POST',
    `/change-packages/${packageId}/approvals`,
    { approver_role: 'DISCIPLINE_LEAD', approver_id: 'smoke-user-1', decision: 'APPROVE' },
    randomCode('idem-approve-1')
  );
  assert(approve1.status === 200, `Approval 1 expected 200, got ${approve1.status}`);
  assert(
    approve1.payload?.changePackage?.status === 'REVIEW_REQUIRED',
    `After approval 1 expected REVIEW_REQUIRED, got ${approve1.payload?.changePackage?.status}`
  );

  const approve2 = await api(
    'POST',
    `/change-packages/${packageId}/approvals`,
    { approver_role: 'OPERATIONS', approver_id: 'smoke-user-2', decision: 'APPROVE' },
    randomCode('idem-approve-2')
  );
  assert(approve2.status === 200, `Approval 2 expected 200, got ${approve2.status}`);
  assert(
    approve2.payload?.changePackage?.status === 'REVIEW_REQUIRED',
    `After approval 2 expected REVIEW_REQUIRED, got ${approve2.payload?.changePackage?.status}`
  );

  const approve3 = await api(
    'POST',
    `/change-packages/${packageId}/approvals`,
    { approver_role: 'DATA_GOVERNANCE', approver_id: 'smoke-user-3', decision: 'APPROVE' },
    randomCode('idem-approve-3')
  );
  assert(approve3.status === 200, `Approval 3 expected 200, got ${approve3.status}`);
  assert(
    approve3.payload?.changePackage?.status === 'APPROVED',
    `After approval 3 expected APPROVED, got ${approve3.payload?.changePackage?.status}`
  );
  console.log('Approval matrix enforcement (HIGH): OK');

  // 5) Inject + publish
  const inject = await api('POST', `/change-packages/${packageId}/inject`, {}, randomCode('idem-inject'));
  assert(
    inject.status === 202,
    `Inject expected 202, got ${inject.status}. payload=${JSON.stringify(inject.payload)}`
  );

  const publish = await api(
    'POST',
    `/change-packages/${packageId}/publish`,
    {},
    randomCode('idem-publish')
  );
  assert(
    publish.status === 200,
    `Publish expected 200, got ${publish.status}. payload=${JSON.stringify(publish.payload)}`
  );
  assert(
    publish.payload?.changePackage?.status === 'PUBLISHED',
    `After publish expected PUBLISHED, got ${publish.payload?.changePackage?.status}`
  );
  console.log('Inject + publish: OK');

  // 6) Event subscription flow + idempotent checkpoint write
  const sub = await api(
    'POST',
    '/events/subscriptions',
    {
      tenant_id: tenantId,
      event_types: ['*'],
      delivery: { mode: 'MESSAGE_BUS', topic: 'ceh.smoke.topic' },
    },
    randomCode('idem-subscription')
  );
  assert(sub.status === 201, `Create subscription expected 201, got ${sub.status}`);
  const subId = sub.payload?.subscription?.id;
  assert(subId, 'Subscription creation returned no id');

  const patchSub = await api(
    'PATCH',
    `/events/subscriptions/${subId}`,
    { active: false },
    randomCode('idem-subscription-patch')
  );
  assert(patchSub.status === 200, `Patch subscription expected 200, got ${patchSub.status}`);
  console.log('Event subscription create/patch: OK');

  const checkpointKey = randomCode('idem-checkpoint');
  const checkpointBody = {
    tenant_id: tenantId,
    checkpoint: 'offset-42',
    last_event_id: 'event-42',
  };
  const cp1 = await api('POST', '/sync/satellites/smoke-sat/checkpoints', checkpointBody, checkpointKey);
  assert(cp1.status === 200, `Checkpoint upsert expected 200, got ${cp1.status}`);
  const cp2 = await api('POST', '/sync/satellites/smoke-sat/checkpoints', checkpointBody, checkpointKey);
  assert(cp2.status === 200, `Checkpoint replay expected 200, got ${cp2.status}`);
  console.log('Checkpoint idempotency replay: OK');

  // 7) Enterprise writeback envelope (idempotent create + optimistic ack)
  const writebackBody = {
    tenant_id: tenantId,
    module: 'sap_pm',
    external_ref: 'SAP-WO-10042',
    command_type: 'status_feedback',
    command_payload: {
      wo_number: '10042',
      status: 'COMPLETE',
      source: 'sap_pm',
    },
    requested_by: 'smoke-bot',
  };
  const writebackKey = randomCode('idem-writeback');
  const wbCreate = await api('POST', '/integrations/enterprise/writeback', writebackBody, writebackKey);
  assert(wbCreate.status === 201, `Writeback create expected 201, got ${wbCreate.status}`);
  const commandId = wbCreate.payload?.command?.id;
  assert(commandId, 'Writeback create returned no command.id');

  const wbReplay = await api('POST', '/integrations/enterprise/writeback', writebackBody, writebackKey);
  assert(wbReplay.status === 201, `Writeback replay expected 201, got ${wbReplay.status}`);
  assert(
    wbReplay.payload?.command?.id === commandId,
    'Writeback replay did not return the same command'
  );

  const wbGet = await api('GET', `/integrations/enterprise/writeback/${commandId}`);
  assert(wbGet.status === 200, `Writeback detail expected 200, got ${wbGet.status}`);
  assert(wbGet.payload?.command?.status === 'RECEIVED', `Writeback initial status expected RECEIVED, got ${wbGet.payload?.command?.status}`);

  const wbAck = await api(
    'POST',
    `/integrations/enterprise/writeback/${commandId}/ack`,
    {
      status: 'ACKNOWLEDGED',
      expected_lock_version: wbGet.payload?.command?.lock_version ?? 0,
      response_payload: { ack_id: 'ack-smoke-1' },
      reason: 'Smoke acknowledgement',
    },
    randomCode('idem-writeback-ack')
  );
  assert(wbAck.status === 200, `Writeback ack expected 200, got ${wbAck.status}`);
  assert(
    wbAck.payload?.command?.status === 'ACKNOWLEDGED',
    `Writeback ack status expected ACKNOWLEDGED, got ${wbAck.payload?.command?.status}`
  );

  const wbList = await api('GET', `/integrations/enterprise/writeback?tenant_id=${tenantId}&module=sap_pm&status=ACKNOWLEDGED&limit=10`);
  assert(wbList.status === 200, `Writeback list expected 200, got ${wbList.status}`);
  assert(Array.isArray(wbList.payload?.commands), 'Writeback list returned invalid payload');
  console.log('Enterprise writeback lifecycle: OK');

  console.log('Central Hub smoke test PASSED');
}

run().catch((err) => {
  console.error('Central Hub smoke test FAILED');
  console.error(err.message);
  process.exit(1);
});
