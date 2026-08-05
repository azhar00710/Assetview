import {
  listPidSymbols,
  createPidSymbol,
  updatePidSymbol,
  deletePidSymbol,
  uploadPidSymbolImage,
} from '../../services/pidSymbols/index.js';

export default async function adminSymbolRoutes(fastify) {
  fastify.get('/admin/symbols', async () => {
    const symbols = await listPidSymbols({ activeOnly: false });
    return { symbols };
  });

  fastify.post('/admin/symbols', async (request, reply) => {
    try {
      const symbol = await createPidSymbol(request.body || {});
      return { symbol };
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.put('/admin/symbols/:id', async (request, reply) => {
    try {
      const symbol = await updatePidSymbol(request.params.id, request.body || {});
      return { symbol };
    } catch (err) {
      return reply.status(err.message === 'Symbol not found' ? 404 : 400).send({ error: err.message });
    }
  });

  fastify.delete('/admin/symbols/:id', async (request, reply) => {
    try {
      await deletePidSymbol(request.params.id);
      return { success: true };
    } catch (err) {
      return reply.status(err.message === 'Symbol not found' ? 404 : 400).send({ error: err.message });
    }
  });

  fastify.post('/admin/symbols/:id/upload', async (request, reply) => {
    try {
      const symbol = await uploadPidSymbolImage(request.params.id, request.body || {});
      return { symbol };
    } catch (err) {
      return reply.status(err.message === 'Symbol not found' ? 404 : 400).send({ error: err.message });
    }
  });
}
