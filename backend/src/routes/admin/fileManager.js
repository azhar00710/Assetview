import prisma from '../../db.js';
import { createProvider, clearProviderCache } from '../../services/storage/index.js';

/**
 * File Manager API routes for the admin storage module.
 * Provides browse, upload, download, and file operations on any configured storage provider.
 *
 * All routes require a storage config ID to identify which provider to use.
 */

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_EXTENSIONS = null; // null = allow all; set to ['.pdf', '.png', ...] to restrict

/** Get a storage provider instance from a config ID */
async function getProviderById(configId) {
  const configs = await prisma.$queryRaw`
    SELECT * FROM storage_config WHERE id = ${configId}::uuid AND is_active = true LIMIT 1
  `;
  if (!configs?.length) {
    throw Object.assign(new Error('Storage configuration not found or inactive'), { statusCode: 404 });
  }
  return { provider: createProvider(configs[0]), config: configs[0] };
}

/** Normalize path: remove leading slash, ensure no double slashes, prevent traversal */
function normalizePath(path) {
  if (!path) return '';
  // Prevent directory traversal
  const normalized = path
    .replace(/\.\./g, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');
  return normalized;
}

export default async function adminFileManagerRoutes(fastify) {

  // ═══ GET /admin/storage/:configId/browse — List files and folders ═══
  fastify.get('/admin/storage/:configId/browse', async (request, reply) => {
    const { configId } = request.params;
    const { prefix = '', maxKeys, continuationToken } = request.query;

    try {
      const { provider } = await getProviderById(configId);
      const normalizedPrefix = normalizePath(prefix);
      const result = await provider.list(normalizedPrefix, {
        maxKeys: maxKeys ? parseInt(maxKeys, 10) : 1000,
        continuationToken: continuationToken || undefined,
      });

      return {
        prefix: normalizedPrefix,
        files: result.files,
        folders: result.folders,
        isTruncated: result.isTruncated,
        nextToken: result.nextToken || null,
      };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Browse failed: ${err.message}` });
    }
  });

  // ═══ POST /admin/storage/:configId/upload — Upload file(s) via backend proxy ═══
  fastify.post('/admin/storage/:configId/upload', async (request, reply) => {
    const { configId } = request.params;
    const { key, contentType, fileData } = request.body; // fileData is base64

    if (!key || !fileData) {
      return reply.status(400).send({ error: 'key and fileData (base64) are required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const normalizedKey = normalizePath(key);

      if (!normalizedKey) {
        return reply.status(400).send({ error: 'Invalid file key' });
      }

      const buffer = Buffer.from(fileData, 'base64');

      if (buffer.length > MAX_UPLOAD_SIZE) {
        return reply.status(413).send({ error: `File too large. Max: ${MAX_UPLOAD_SIZE / 1024 / 1024}MB` });
      }

      const result = await provider.upload(buffer, normalizedKey, {
        contentType: contentType || 'application/octet-stream',
      });

      return reply.status(201).send(result);
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Upload failed: ${err.message}` });
    }
  });

  // ═══ POST /admin/storage/:configId/presigned-upload — Get presigned upload URL ═══
  fastify.post('/admin/storage/:configId/presigned-upload', async (request, reply) => {
    const { configId } = request.params;
    const { key, contentType } = request.body;

    if (!key || !contentType) {
      return reply.status(400).send({ error: 'key and contentType are required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const normalizedKey = normalizePath(key);
      const result = await provider.getPresignedUploadUrl(normalizedKey, contentType);

      if (!result) {
        return reply.status(501).send({ error: 'Presigned upload not supported for this provider. Use proxy upload instead.' });
      }

      return result;
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Presigned URL failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/storage/:configId/download — Download a file ═══
  fastify.get('/admin/storage/:configId/download', async (request, reply) => {
    const { configId } = request.params;
    const { key } = request.query;

    if (!key) {
      return reply.status(400).send({ error: 'key query parameter is required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const normalizedKey = normalizePath(key);

      // For cloud providers, redirect to signed URL to avoid proxying large files
      if (provider.type !== 'local') {
        const url = await provider.getUrl(normalizedKey, 300); // 5 min expiry
        return reply.redirect(302, url);
      }

      // For local, stream the file
      const { buffer, contentType, size } = await provider.download(normalizedKey);
      const filename = normalizedKey.split('/').pop();

      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', size)
        .send(buffer);
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      if (err.code === 'ENOENT') return reply.status(404).send({ error: 'File not found' });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Download failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/storage/:configId/url — Get signed URL for a file ═══
  fastify.get('/admin/storage/:configId/url', async (request, reply) => {
    const { configId } = request.params;
    const { key, expiresIn } = request.query;

    if (!key) {
      return reply.status(400).send({ error: 'key query parameter is required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const normalizedKey = normalizePath(key);
      const url = await provider.getUrl(normalizedKey, expiresIn ? parseInt(expiresIn, 10) : 3600);

      return { url };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `URL generation failed: ${err.message}` });
    }
  });

  // ═══ POST /admin/storage/:configId/folder — Create a folder ═══
  fastify.post('/admin/storage/:configId/folder', async (request, reply) => {
    const { configId } = request.params;
    const { path } = request.body;

    if (!path) {
      return reply.status(400).send({ error: 'path is required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const normalizedPath = normalizePath(path);
      await provider.createFolder(normalizedPath);
      return reply.status(201).send({ success: true, path: normalizedPath });
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Create folder failed: ${err.message}` });
    }
  });

  // ═══ DELETE /admin/storage/:configId/file — Delete a file ═══
  fastify.delete('/admin/storage/:configId/file', async (request, reply) => {
    const { key } = request.query;

    if (!key) {
      return reply.status(400).send({ error: 'key query parameter is required' });
    }

    const { configId } = request.params;

    try {
      const { provider } = await getProviderById(configId);
      const normalizedKey = normalizePath(key);
      await provider.delete(normalizedKey);
      return { success: true };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Delete failed: ${err.message}` });
    }
  });

  // ═══ DELETE /admin/storage/:configId/folder — Delete a folder recursively ═══
  fastify.delete('/admin/storage/:configId/folder', async (request, reply) => {
    const { path } = request.query;

    if (!path) {
      return reply.status(400).send({ error: 'path query parameter is required' });
    }

    const { configId } = request.params;

    try {
      const { provider } = await getProviderById(configId);
      const normalizedPath = normalizePath(path);
      const result = await provider.deleteFolder(normalizedPath);
      return { success: true, deletedCount: result.deletedCount };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Delete folder failed: ${err.message}` });
    }
  });

  // ═══ POST /admin/storage/:configId/copy — Copy a file ═══
  fastify.post('/admin/storage/:configId/copy', async (request, reply) => {
    const { configId } = request.params;
    const { sourceKey, destKey } = request.body;

    if (!sourceKey || !destKey) {
      return reply.status(400).send({ error: 'sourceKey and destKey are required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      await provider.copy(normalizePath(sourceKey), normalizePath(destKey));
      return { success: true };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Copy failed: ${err.message}` });
    }
  });

  // ═══ POST /admin/storage/:configId/move — Move/rename a file ═══
  fastify.post('/admin/storage/:configId/move', async (request, reply) => {
    const { configId } = request.params;
    const { sourceKey, destKey } = request.body;

    if (!sourceKey || !destKey) {
      return reply.status(400).send({ error: 'sourceKey and destKey are required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      await provider.move(normalizePath(sourceKey), normalizePath(destKey));
      return { success: true };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Move failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/storage/:configId/metadata — Get file metadata ═══
  fastify.get('/admin/storage/:configId/metadata', async (request, reply) => {
    const { configId } = request.params;
    const { key } = request.query;

    if (!key) {
      return reply.status(400).send({ error: 'key query parameter is required' });
    }

    try {
      const { provider } = await getProviderById(configId);
      const metadata = await provider.getMetadata(normalizePath(key));
      return metadata;
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Metadata fetch failed: ${err.message}` });
    }
  });

  // ═══ GET /admin/storage/:configId/usage — Get storage usage ═══
  fastify.get('/admin/storage/:configId/usage', async (request, reply) => {
    const { configId } = request.params;
    const { prefix = '' } = request.query;

    try {
      const { provider, config } = await getProviderById(configId);
      const usage = await provider.getUsage(normalizePath(prefix));
      return {
        ...usage,
        provider: config.provider,
        bucket: config.bucket_or_container,
      };
    } catch (err) {
      if (err.statusCode) return reply.status(err.statusCode).send({ error: err.message });
      fastify.log.error(err);
      return reply.status(500).send({ error: `Usage fetch failed: ${err.message}` });
    }
  });
}
