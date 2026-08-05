import {
  acknowledgeEnterpriseWritebackCommand,
  createApprovalDecision,
  createChangePackage,
  createEnterpriseWritebackCommand,
  createEventSubscription,
  createTenant,
  getSatelliteCheckpoint,
  getEnterpriseWritebackCommand,
  listChangePackages,
  listEnterpriseWritebackCommands,
  listMasterRelationships,
  listMasterTags,
  listTenantModules,
  listTenants,
  patchEventSubscription,
  patchTenantModules,
  publishChangePackage,
  registerModuleClient,
  runPipelineStep,
  upsertSatelliteCheckpoint,
} from '../services/centralHub/serviceContract.js';
import {
  validateCommandIdParam,
  validateCheckpointBody,
  validateCheckpointQuery,
  validateEnterpriseWritebackAckBody,
  validateEnterpriseWritebackCreateBody,
  validateEnterpriseWritebackListQuery,
  validateCreateApprovalDecisionBody,
  validateCreateChangePackageBody,
  validateCreateEventSubscriptionBody,
  validateCreateTenantBody,
  validateListChangePackagesQuery,
  validateMasterRelationshipsQuery,
  validateMasterTagsQuery,
  validatePackageIdParam,
  validatePatchEventSubscriptionBody,
  validatePatchTenantModulesBody,
  validateRegisterModuleClientBody,
  validateSubscriptionIdParam,
  validateTenantIdParam,
} from '../services/centralHub/requestValidation.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  getIdempotencyKey,
} from '../services/centralHub/idempotency.js';

function notImplementedError(reply, message) {
  return reply.code(501).send({
    error: 'Not implemented',
    message,
    hint: 'Apply central hub migrations and wire service implementations.',
  });
}

function serviceError(reply, err, fallbackMessage) {
  if (err.code === 'CEH_NOT_IMPLEMENTED') return notImplementedError(reply, err.message);
  if (err.code === 'VALIDATION_ERROR') return reply.code(400).send({ error: fallbackMessage, detail: err.message });
  if (err.code === 'NOT_FOUND') return reply.code(404).send({ error: fallbackMessage, detail: err.message });
  if (err.code === 'IDEMPOTENCY_CONFLICT') return reply.code(409).send({ error: fallbackMessage, detail: err.message });
  if (err.code === 'CONFLICT_RETRY') return reply.code(409).send({ error: fallbackMessage, detail: err.message });
  if (err.code === 'INVALID_TRANSITION') return reply.code(409).send({ error: fallbackMessage, detail: err.message });
  return reply.code(500).send({ error: fallbackMessage, detail: err.message });
}

async function executeIdempotent({
  request,
  reply,
  scope,
  payload,
  defaultSuccessCode = 200,
  fallbackMessage,
  execute,
}) {
  const key = getIdempotencyKey(request);
  let context = null;
  try {
    context = await beginIdempotentRequest({ scope, key, payload });
    if (context.mode === 'replay') {
      return reply.code(context.statusCode).send(context.responseBody);
    }

    const result = await execute();
    await completeIdempotentRequest({
      scope,
      key,
      requestHash: context.requestHash,
      statusCode: defaultSuccessCode,
      responseBody: result,
    });
    return reply.code(defaultSuccessCode).send(result);
  } catch (err) {
    if (context?.mode === 'execute') {
      await failIdempotentRequest({
        scope,
        key,
        requestHash: context.requestHash,
        message: err.message,
      });
    }
    return serviceError(reply, err, fallbackMessage);
  }
}

export default async function centralHubRoutes(fastify) {
  fastify.get('/central-hub/health', async () => ({
    status: 'ok',
    module: 'central-hub',
    mode: 'skeleton',
  }));

  fastify.get('/tenants', async (request, reply) => {
    try {
      return await listTenants(request);
    } catch (err) {
      return serviceError(reply, err, 'Failed to list tenants');
    }
  });

  fastify.post('/tenants', async (request, reply) => {
    validateCreateTenantBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: 'ceh:tenants:create',
      payload: request.body,
      defaultSuccessCode: 201,
      fallbackMessage: 'Failed to create tenant',
      execute: async () => createTenant(request.body),
    });
  });

  fastify.get('/tenants/:tenantId/modules', async (request, reply) => {
    try {
      validateTenantIdParam(request.params.tenantId);
      return await listTenantModules(request.params.tenantId);
    } catch (err) {
      return serviceError(reply, err, 'Failed to list tenant modules');
    }
  });

  fastify.patch('/tenants/:tenantId/modules', async (request, reply) => {
    validateTenantIdParam(request.params.tenantId);
    validatePatchTenantModulesBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:tenant:${request.params.tenantId}:modules:patch`,
      payload: request.body,
      fallbackMessage: 'Failed to patch tenant modules',
      execute: async () => patchTenantModules(request.params.tenantId, request.body),
    });
  });

  fastify.post('/tenants/:tenantId/module-clients', async (request, reply) => {
    validateTenantIdParam(request.params.tenantId);
    validateRegisterModuleClientBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:tenant:${request.params.tenantId}:module-clients:create`,
      payload: request.body,
      defaultSuccessCode: 201,
      fallbackMessage: 'Failed to register module client',
      execute: async () => registerModuleClient(request.params.tenantId, request.body),
    });
  });

  fastify.get('/change-packages', async (request, reply) => {
    try {
      validateListChangePackagesQuery(request.query);
      return await listChangePackages(request.query);
    } catch (err) {
      return serviceError(reply, err, 'Failed to list change packages');
    }
  });

  fastify.post('/change-packages', async (request, reply) => {
    validateCreateChangePackageBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:tenant:${request.body.tenant_id}:change-packages:create`,
      payload: request.body,
      defaultSuccessCode: 201,
      fallbackMessage: 'Failed to create change package',
      execute: async () => createChangePackage(request.body),
    });
  });

  fastify.post('/change-packages/:packageId/submit', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:submit`,
      payload: request.body,
      fallbackMessage: 'Failed to submit change package',
      execute: async () => runPipelineStep(request.params.packageId, 'submit'),
    });
  });

  fastify.post('/change-packages/:packageId/validate', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:validate`,
      payload: request.body,
      fallbackMessage: 'Failed to validate change package',
      execute: async () => runPipelineStep(request.params.packageId, 'validate'),
    });
  });

  fastify.post('/change-packages/:packageId/map', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:map`,
      payload: request.body,
      fallbackMessage: 'Failed to map change package',
      execute: async () => runPipelineStep(request.params.packageId, 'map'),
    });
  });

  fastify.post('/change-packages/:packageId/approvals', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    validateCreateApprovalDecisionBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:approval`,
      payload: request.body,
      fallbackMessage: 'Failed to create approval decision',
      execute: async () => createApprovalDecision(request.params.packageId, request.body),
    });
  });

  fastify.post('/change-packages/:packageId/inject', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:inject`,
      payload: request.body,
      defaultSuccessCode: 202,
      fallbackMessage: 'Failed to start injection',
      execute: async () => runPipelineStep(request.params.packageId, 'inject'),
    });
  });

  fastify.post('/change-packages/:packageId/publish', async (request, reply) => {
    validatePackageIdParam(request.params.packageId);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:change-package:${request.params.packageId}:publish`,
      payload: request.body,
      fallbackMessage: 'Failed to publish package',
      execute: async () => publishChangePackage(request.params.packageId),
    });
  });

  fastify.get('/master/tags', async (request, reply) => {
    try {
      validateMasterTagsQuery(request.query);
      return await listMasterTags(request.query);
    } catch (err) {
      return serviceError(reply, err, 'Failed to query tags');
    }
  });

  fastify.get('/master/relationships', async (request, reply) => {
    try {
      validateMasterRelationshipsQuery(request.query);
      return await listMasterRelationships(request.query);
    } catch (err) {
      return serviceError(reply, err, 'Failed to query relationships');
    }
  });

  fastify.get('/integrations/enterprise/writeback', async (request, reply) => {
    try {
      validateEnterpriseWritebackListQuery(request.query);
      return await listEnterpriseWritebackCommands(request.query);
    } catch (err) {
      return serviceError(reply, err, 'Failed to list enterprise writeback commands');
    }
  });

  fastify.post('/integrations/enterprise/writeback', async (request, reply) => {
    validateEnterpriseWritebackCreateBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:tenant:${request.body.tenant_id}:enterprise-writeback:create`,
      payload: request.body,
      defaultSuccessCode: 201,
      fallbackMessage: 'Failed to create enterprise writeback command',
      execute: async () => createEnterpriseWritebackCommand(request.body),
    });
  });

  fastify.get('/integrations/enterprise/writeback/:commandId', async (request, reply) => {
    try {
      validateCommandIdParam(request.params.commandId);
      return await getEnterpriseWritebackCommand(request.params.commandId);
    } catch (err) {
      return serviceError(reply, err, 'Failed to get enterprise writeback command');
    }
  });

  fastify.post('/integrations/enterprise/writeback/:commandId/ack', async (request, reply) => {
    validateCommandIdParam(request.params.commandId);
    validateEnterpriseWritebackAckBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:enterprise-writeback:${request.params.commandId}:ack`,
      payload: request.body,
      fallbackMessage: 'Failed to acknowledge enterprise writeback command',
      execute: async () => acknowledgeEnterpriseWritebackCommand(request.params.commandId, request.body),
    });
  });

  fastify.post('/sync/satellites/:satelliteId/pull-token', async (request, reply) => {
    return reply.code(501).send({
      error: 'Not implemented',
      message: 'Pull token issuance is defined in the OpenAPI contract and pending implementation.',
    });
  });

  fastify.get('/sync/satellites/:satelliteId/checkpoints', async (request, reply) => {
    try {
      validateCheckpointQuery(request.query);
      return await getSatelliteCheckpoint(request.params.satelliteId, request.query);
    } catch (err) {
      return serviceError(reply, err, 'Failed to get checkpoint');
    }
  });

  fastify.post('/sync/satellites/:satelliteId/checkpoints', async (request, reply) => {
    validateCheckpointBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:sync:${request.params.satelliteId}:checkpoint`,
      payload: request.body,
      fallbackMessage: 'Failed to upsert checkpoint',
      execute: async () => upsertSatelliteCheckpoint(request.params.satelliteId, request.body),
    });
  });

  fastify.post('/events/subscriptions', async (request, reply) => {
    validateCreateEventSubscriptionBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:tenant:${request.body.tenant_id}:event-subscriptions:create`,
      payload: request.body,
      defaultSuccessCode: 201,
      fallbackMessage: 'Failed to create event subscription',
      execute: async () => createEventSubscription(request.body),
    });
  });

  fastify.patch('/events/subscriptions/:subscriptionId', async (request, reply) => {
    validateSubscriptionIdParam(request.params.subscriptionId);
    validatePatchEventSubscriptionBody(request.body);
    return executeIdempotent({
      request,
      reply,
      scope: `ceh:event-subscription:${request.params.subscriptionId}:patch`,
      payload: request.body,
      fallbackMessage: 'Failed to patch event subscription',
      execute: async () => patchEventSubscription(request.params.subscriptionId, request.body),
    });
  });
}
