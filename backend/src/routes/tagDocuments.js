import prisma from '../db.js';

export default async function tagDocumentRoutes(fastify) {
  // GET /tags/:tag/documents — returns linked documents for a tag
  fastify.get('/tags/:tag/documents', async (request, reply) => {
    const { tag } = request.params;
    const { document_type } = request.query;

    const where = { tag };
    if (document_type) where.document_type = document_type;

    const links = await prisma.tag_document_link.findMany({
      where,
      orderBy: { document_ref: 'asc' },
    });

    if (links.length === 0) {
      return reply.code(404).send({ error: 'No documents found for tag', tag });
    }

    return {
      tag,
      documents: links.map(l => ({
        id: l.id,
        documentType: l.document_type,
        documentId: l.document_id,
        documentRef: l.document_ref,
        pageNumber: l.page_number,
        regionXPct: l.region_x_pct,
        regionYPct: l.region_y_pct,
        metadata: l.metadata,
      })),
    };
  });

  // GET /tags/search?q= — search tags with fuzzy matching
  fastify.get('/tags/search', async (request, reply) => {
    const { q, limit } = request.query;

    if (!q || q.length < 1) {
      return reply.code(400).send({ error: 'Query parameter q is required' });
    }

    const maxResults = Math.min(parseInt(limit) || 50, 200);

    // Use raw query for ILIKE search on tags, return distinct tags with document counts
    const results = await prisma.$queryRaw`
      SELECT
        tag,
        COUNT(*) as document_count,
        ARRAY_AGG(DISTINCT document_type) as document_types
      FROM tag_document_link
      WHERE tag ILIKE ${'%' + q + '%'}
      GROUP BY tag
      ORDER BY tag
      LIMIT ${maxResults}
    `;

    return {
      query: q,
      results: results.map(r => ({
        tag: r.tag,
        documentCount: Number(r.document_count),
        documentTypes: r.document_types,
      })),
    };
  });
}
