import {
  listPidSymbols,
  getPidSymbolImageBuffer,
} from '../services/pidSymbols/index.js';

export default async function symbolRoutes(fastify) {
  fastify.get('/symbols', async () => {
    const symbols = await listPidSymbols({ activeOnly: true });
    return { symbols };
  });

  fastify.get('/symbols/:id/image', async (request, reply) => {
    try {
      const result = await getPidSymbolImageBuffer(request.params.id);
      if (!result) return reply.status(404).send({ error: 'Symbol image not found' });
      return reply
        .header('Content-Type', result.contentType)
        .header('Cache-Control', 'public, max-age=3600')
        .send(result.buffer);
    } catch (err) {
      return reply.status(404).send({ error: err.message || 'Symbol image not found' });
    }
  });
}
