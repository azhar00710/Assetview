import {
  getSystemTopology,
  getSystemTopologyLegacy,
  getUpstream,
  getDownstream,
  getUpstreamLegacy,
  getDownstreamLegacy,
  getIsolationBoundary,
  getBoundaries,
  getLayout,
  saveLayout,
} from '../services/topology/index.js';
import {
  generateCanvasFromAnnotations,
  checkGenerationReadiness,
} from '../services/canvasGeneration/canvasGenerator.js';
import { suggestPositionsFromOcr, getAutoPlaceableSuggestions } from '../services/canvasGeneration/aiAssistance.js';

export default async function topologyRoutes(fastify) {
  // ═══════════════════════════════════════════════════════════════
  // NEW ENDPOINTS — recursive CTE based (topology_edges table)
  // ═══════════════════════════════════════════════════════════════

  // GET /topology/system/:systemId — full topology nodes + edges
  fastify.get('/topology/system/:systemId', async (request, reply) => {
    const { systemId } = request.params;
    const result = await getSystemTopology(systemId);
    if (!result) {
      return reply.code(404).send({ error: 'System not found' });
    }
    return result;
  });

  // GET /topology/upstream/:entityId — recursive CTE upstream trace
  fastify.get('/topology/upstream/:entityId', async (request, reply) => {
    const { entityId } = request.params;
    const maxDepth = parseInt(request.query.maxDepth) || 50;
    const result = await getUpstream(entityId, maxDepth);
    return result;
  });

  // GET /topology/downstream/:entityId — recursive CTE downstream trace
  fastify.get('/topology/downstream/:entityId', async (request, reply) => {
    const { entityId } = request.params;
    const maxDepth = parseInt(request.query.maxDepth) || 50;
    const result = await getDownstream(entityId, maxDepth);
    return result;
  });

  // GET /topology/boundaries?platform_id=... — boundary edges for overview mode
  fastify.get('/topology/boundaries', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) {
      return reply.code(400).send({ error: 'platform_id query parameter is required' });
    }
    const result = await getBoundaries(platform_id);
    return { boundaries: result };
  });

  // POST /topology/isolation — find isolation boundary for equipment
  fastify.post('/topology/isolation', async (request, reply) => {
    const { equipmentId } = request.body || {};
    if (!equipmentId) {
      return reply.code(400).send({ error: 'equipmentId is required' });
    }
    const result = await getIsolationBoundary(equipmentId);
    return result;
  });

  // GET /topology/layout/:systemId — get persisted positions
  fastify.get('/topology/layout/:systemId', async (request, reply) => {
    const { systemId } = request.params;
    const result = await getLayout(systemId);
    return result;
  });

  // PUT /topology/layout/:systemId — save positions
  fastify.put('/topology/layout/:systemId', async (request, reply) => {
    const { systemId } = request.params;
    const { positions } = request.body || {};
    if (!positions || !Array.isArray(positions)) {
      return reply.code(400).send({ error: 'positions array is required' });
    }
    const result = await saveLayout(systemId, positions);
    return result;
  });

  // ═══════════════════════════════════════════════════════════════
  // CANVAS GENERATION — annotation-to-canvas pipeline
  // ═══════════════════════════════════════════════════════════════

  // GET /topology/generation-readiness/:systemId — preflight check
  fastify.get('/topology/generation-readiness/:systemId', async (request, reply) => {
    const { systemId } = request.params;
    const result = await checkGenerationReadiness(systemId);
    return result;
  });

  // POST /topology/generate/:systemId — generate canvas from annotations
  fastify.post('/topology/generate/:systemId', async (request, reply) => {
    const { systemId } = request.params;
    const { dryRun } = request.body || {};
    const result = await generateCanvasFromAnnotations(systemId, { dryRun: !!dryRun });
    return result;
  });

  // GET /topology/ocr-suggestions/:pnidId — AI-assisted position suggestions (with confidence tiers)
  fastify.get('/topology/ocr-suggestions/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;
    const suggestions = await suggestPositionsFromOcr(pnidId);
    return { suggestions };
  });

  // GET /topology/ocr-auto-place/:pnidId — only high-confidence (auto-tier) suggestions for batch placement
  fastify.get('/topology/ocr-auto-place/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;
    const suggestions = await getAutoPlaceableSuggestions(pnidId);
    return { suggestions };
  });

  // ═══════════════════════════════════════════════════════════════
  // LEGACY ENDPOINTS — JS BFS based (graphUtils.js)
  // Kept for backward compatibility during transition
  // ═══════════════════════════════════════════════════════════════

  // GET /systems/:systemId/topology — React Flow nodes + edges (legacy)
  fastify.get('/systems/:systemId/topology', async (request, reply) => {
    const { systemId } = request.params;
    const result = await getSystemTopologyLegacy(systemId);
    if (!result) {
      return reply.code(404).send({ error: 'System not found' });
    }
    return result;
  });

  // GET /systems/:systemId/topology/upstream/:nodeId — BFS upstream (legacy)
  fastify.get('/systems/:systemId/topology/upstream/:nodeId', async (request, reply) => {
    const { systemId, nodeId } = request.params;
    const result = await getUpstreamLegacy(systemId, nodeId);
    if (!result) {
      return reply.code(404).send({ error: 'System or equipment not found' });
    }
    return result;
  });

  // GET /systems/:systemId/topology/downstream/:nodeId — BFS downstream (legacy)
  fastify.get('/systems/:systemId/topology/downstream/:nodeId', async (request, reply) => {
    const { systemId, nodeId } = request.params;
    const result = await getDownstreamLegacy(systemId, nodeId);
    if (!result) {
      return reply.code(404).send({ error: 'System or equipment not found' });
    }
    return result;
  });
}
