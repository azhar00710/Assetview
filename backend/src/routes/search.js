import prisma from '../db.js';

export default async function searchRoutes(fastify) {
  // GET /search — global search using search_all() DB function
  fastify.get('/search', async (request, reply) => {
    const { platform_id, q, limit = '50' } = request.query;

    if (!platform_id || !q) {
      return reply.code(400).send({ error: 'platform_id and q are required' });
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const results = await prisma.$queryRaw`
      SELECT entity_type, entity_id, tag, description, system_code, relevance
      FROM search_all(${platform_id}::uuid, ${q}::text, ${limitNum}::integer)
    `;

    return {
      results: results.map(r => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        tag: r.tag,
        description: r.description,
        systemCode: r.system_code,
        relevance: parseFloat(r.relevance),
      })),
    };
  });
}
