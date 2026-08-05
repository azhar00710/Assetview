import prisma from '../db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 3D Model routes — serves model metadata and tag→objectId mapping
 * for 2D↔3D linking.
 *
 * GET /api/v1/models/:platformId       → model metadata (format, URL, size)
 * GET /api/v1/models/:platformId/tag-map → { tag → objectId } mapping
 */
export default async function modelRoutes(fastify) {
  // GET /models/:platformId — model metadata
  fastify.get('/models/:platformId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          platformId: { type: 'string', format: 'uuid' },
        },
        required: ['platformId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            platformId: { type: 'string' },
            format: { type: 'string' },
            url: { type: 'string' },
            size: { type: 'number' },
            version: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { platformId } = request.params;

      // Check if platform exists
      const platform = await prisma.platform.findUnique({
        where: { id: platformId },
      });

      if (!platform) {
        return reply.code(404).send({ error: 'Platform not found' });
      }

      // Check for model file in public/models directory
      const modelsDir = join(__dirname, '..', '..', 'public', 'models');
      const modelFiles = ['glb', 'gltf'].map((ext) => ({
        ext,
        path: join(modelsDir, `${platform.code}.${ext}`),
        url: `/models/${platform.code}.${ext}`,
      }));

      const found = modelFiles.find((f) => existsSync(f.path));

      if (!found) {
        return reply.code(404).send({
          error: 'No 3D model available for this platform',
          platformCode: platform.code,
        });
      }

      const { statSync } = await import('fs');
      const stats = statSync(found.path);

      return {
        id: platformId,
        platformId,
        format: found.ext === 'glb' ? 'glb' : 'gltf',
        url: found.url,
        size: stats.size,
        version: stats.mtimeMs.toString(36),
      };
    },
  });

  // GET /models/:platformId/tag-map — tag to objectId mapping
  fastify.get('/models/:platformId/tag-map', {
    schema: {
      params: {
        type: 'object',
        properties: {
          platformId: { type: 'string', format: 'uuid' },
        },
        required: ['platformId'],
      },
    },
    handler: async (request, reply) => {
      const { platformId } = request.params;

      // Build tag map from equipment and instruments for this platform
      const systems = await prisma.system.findMany({
        where: { platformId },
        select: { id: true },
      });

      const systemIds = systems.map((s) => s.id);

      const [equipment, instruments] = await Promise.all([
        prisma.equipment.findMany({
          where: { systemId: { in: systemIds } },
          select: {
            id: true,
            tag: true,
            model3dObjectId: true,
          },
        }),
        prisma.instrument.findMany({
          where: { systemId: { in: systemIds } },
          select: {
            id: true,
            tag: true,
          },
        }),
      ]);

      // Build { tag → objectId } mapping
      const tagMap = {};

      for (const eq of equipment) {
        if (eq.tag) {
          tagMap[eq.tag] = eq.model3dObjectId || eq.tag;
        }
      }

      for (const inst of instruments) {
        if (inst.tag) {
          tagMap[inst.tag] = inst.tag;
        }
      }

      return { platformId, tags: tagMap, count: Object.keys(tagMap).length };
    },
  });
}
