// chat routes — See docs/P2.2_api_specification.md for full spec
// TODO: Implement with Prisma queries

export default async function chatRoutes(fastify) {
  // Stub — implement per API spec
  fastify.get('/chat', async (request, reply) => {
    return { message: 'chat endpoint — not yet implemented' };
  });
}
