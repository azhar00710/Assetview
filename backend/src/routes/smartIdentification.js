import {
  createDetectionSession,
  createDrawSession,
  addManualSegment,
  createManualLinkableEntity,
  getGuideLinesForPnid,
  getSession,
  listSessions,
  assignSegment,
  batchUpdateFlowSequences,
  updateSegmentGeometry,
  deleteSession,
  deleteSegment,
} from '../services/smartIdentification/index.js';
import { hasPermission } from '../auth/permissions.js';

export default async function smartIdentificationRoutes(fastify) {
  // Writes require smart_annotation.use; reads stay available for hierarchy viewing
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    if (!request.user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!hasPermission(request.permissions, 'smart_annotation.use')) {
      return reply.code(403).send({
        error: 'Smart Annotation permission required',
        required: 'smart_annotation.use',
      });
    }
  });

  // GET /pnids/:pnidId/smart-ident/sessions
  fastify.get('/pnids/:pnidId/smart-ident/sessions', async (request, reply) => {
    const { pnidId } = request.params;
    const { mode } = request.query || {};
    const sessions = await listSessions(pnidId, { mode: mode || undefined });
    return { sessions };
  });

  // GET /pnids/:pnidId/smart-ident/sessions/:sessionId
  fastify.get('/pnids/:pnidId/smart-ident/sessions/:sessionId', async (request, reply) => {
    const { pnidId, sessionId } = request.params;
    const result = await getSession(pnidId, sessionId);
    if (!result) return reply.code(404).send({ error: 'Session not found' });
    return result;
  });

  // POST /pnids/:pnidId/smart-ident/draw-session — start manual draw session
  fastify.post('/pnids/:pnidId/smart-ident/draw-session', async (request, reply) => {
    const { pnidId } = request.params;
    const { pageNumber = 1 } = request.body || {};
    try {
      return await createDrawSession(pnidId, { pageNumber });
    } catch (err) {
      console.error('[smart-ident] draw-session failed:', err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /pnids/:pnidId/smart-ident/guide-lines — pipe snap guides from drawing
  fastify.get('/pnids/:pnidId/smart-ident/guide-lines', async (request, reply) => {
    const { pnidId } = request.params;
    const pageNumber = Number(request.query.pageNumber || 1);
    try {
      const guideLines = await getGuideLinesForPnid(pnidId, pageNumber);
      return { guideLines, count: guideLines.length };
    } catch (err) {
      console.error('[smart-ident] guide-lines failed:', err.message);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /pnids/:pnidId/smart-ident/sessions/:sessionId/segments — add manual segment
  fastify.post('/pnids/:pnidId/smart-ident/sessions/:sessionId/segments', async (request, reply) => {
    const { pnidId, sessionId } = request.params;
    const { segmentType, geometry, metadata, displayColor } = request.body || {};
    if (!segmentType || !geometry) {
      return reply.code(400).send({ error: 'segmentType and geometry are required' });
    }
    try {
      const segment = await addManualSegment(pnidId, sessionId, {
        segmentType, geometry, metadata, displayColor,
      });
      return { segment };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /pnids/:pnidId/smart-ident/entities — create missing line/equipment/instrument for Smart ID
  fastify.post('/pnids/:pnidId/smart-ident/entities', async (request, reply) => {
    const { pnidId } = request.params;
    try {
      const result = await createManualLinkableEntity(pnidId, request.body || {});
      return reply.code(201).send(result);
    } catch (err) {
      console.error('[smart-ident] create entity failed:', err.message);
      return reply.code(400).send({ error: err.message || 'Create entity failed' });
    }
  });

  // POST /pnids/:pnidId/smart-ident/detect
  fastify.post('/pnids/:pnidId/smart-ident/detect', async (request, reply) => {
    const { pnidId } = request.params;
    const { boundary, pageNumber = 1, enableSnap = true } = request.body || {};

    if (
      boundary?.xPct == null || boundary?.yPct == null ||
      boundary?.wPct == null || boundary?.hPct == null
    ) {
      return reply.code(400).send({ error: 'boundary with xPct, yPct, wPct, hPct is required' });
    }

    if (boundary.wPct < 0.5 || boundary.hPct < 0.5) {
      return reply.code(400).send({ error: 'Boundary must be at least 0.5% of drawing size' });
    }

    try {
      const result = await createDetectionSession(pnidId, { boundary, pageNumber, enableSnap });
      return result;
    } catch (err) {
      console.error('[smart-ident] detect failed:', err.message);
      return reply.code(500).send({ error: err.message || 'Detection failed' });
    }
  });

  // PATCH /pnids/:pnidId/smart-ident/segments/:segmentId
  fastify.patch('/pnids/:pnidId/smart-ident/segments/:segmentId', async (request, reply) => {
    const { pnidId, segmentId } = request.params;
    const body = request.body || {};
    const { linkedEntityType, linkedEntityId, parentSegmentId, label, geometry, metadata, flowSequences, displayColor } = body;

    try {
      let updated = null;

      if ('geometry' in body) {
        if (!geometry || typeof geometry !== 'object') {
          return reply.code(400).send({ error: 'geometry object is required' });
        }
        updated = await updateSegmentGeometry(pnidId, segmentId, geometry);
        if (!updated) return reply.code(404).send({ error: 'Segment not found' });
      }

      const hasAssign =
        'linkedEntityType' in body ||
        'linkedEntityId' in body ||
        'parentSegmentId' in body ||
        'label' in body ||
        'displayColor' in body ||
        (metadata && typeof metadata === 'object');

      if (hasAssign) {
        const patch = {};
        if ('linkedEntityType' in body) patch.linkedEntityType = linkedEntityType;
        if ('linkedEntityId' in body) patch.linkedEntityId = linkedEntityId;
        if ('parentSegmentId' in body) patch.parentSegmentId = parentSegmentId ?? null;
        if ('label' in body) patch.label = label;
        if ('displayColor' in body) patch.displayColor = displayColor;
        if (metadata && typeof metadata === 'object') patch.metadataPatch = metadata;
        updated = await assignSegment(pnidId, segmentId, patch);
        if (!updated) return reply.code(404).send({ error: 'Segment not found' });
      }

      if (Array.isArray(flowSequences) && flowSequences.length > 0) {
        const batch = await batchUpdateFlowSequences(pnidId, flowSequences);
        return { segment: updated, updatedSegments: batch };
      }

      if (!updated) {
        return reply.code(400).send({ error: 'No supported patch fields in body' });
      }

      return { segment: updated };
    } catch (err) {
      console.error('[smart-ident] patch segment failed:', err.message);
      return reply.code(500).send({ error: err.message || 'Patch failed' });
    }
  });

  // DELETE /pnids/:pnidId/smart-ident/segments/:segmentId
  fastify.delete('/pnids/:pnidId/smart-ident/segments/:segmentId', async (request, reply) => {
    const { pnidId, segmentId } = request.params;
    try {
      const deleted = await deleteSegment(pnidId, segmentId);
      if (!deleted) return reply.code(404).send({ error: 'Segment not found' });
      return { success: true };
    } catch (err) {
      console.error('[smart-ident] delete segment failed:', err.message);
      return reply.code(500).send({ error: err.message || 'Delete failed' });
    }
  });

  // DELETE /pnids/:pnidId/smart-ident/sessions/:sessionId
  fastify.delete('/pnids/:pnidId/smart-ident/sessions/:sessionId', async (request, reply) => {
    const { pnidId, sessionId } = request.params;
    const deleted = await deleteSession(pnidId, sessionId);
    if (!deleted) return reply.code(404).send({ error: 'Session not found' });
    return { success: true };
  });
}
