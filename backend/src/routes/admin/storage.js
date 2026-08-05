import prisma from '../../db.js';
import { createProvider, clearProviderCache } from '../../services/storage/index.js';
import { scanPlatformStorage, importDetectedFiles, linkFileToRecord } from '../../services/storage/SyncService.js';

export default async function adminStorageRoutes(fastify) {
  // Auto-create storage_config table if it doesn't exist
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS storage_config (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      scope_type VARCHAR(20) NOT NULL DEFAULT 'global',
      scope_id UUID,
      provider VARCHAR(20) NOT NULL,
      bucket_or_container TEXT,
      region VARCHAR(50),
      endpoint_url TEXT,
      base_path TEXT,
      credentials_ref TEXT,
      vision_credentials_ref TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(scope_type, scope_id)
    )
  `).catch(() => {});

  // Ensure variable-length columns use TEXT (not VARCHAR) for large values
  await prisma.$executeRawUnsafe(`
    ALTER TABLE storage_config
      ALTER COLUMN credentials_ref TYPE TEXT,
      ALTER COLUMN bucket_or_container TYPE TEXT,
      ALTER COLUMN endpoint_url TYPE TEXT,
      ALTER COLUMN base_path TYPE TEXT
  `).catch(() => {});

  // Ensure vision_credentials_ref column exists (separate call to avoid batch failures)
  await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS vision_credentials_ref TEXT`).catch(() => {});

  // ═══ GET /admin/storage/config — Get storage configurations ═══
  fastify.get('/admin/storage/config', async (request, reply) => {
    const configs = await prisma.$queryRaw`
      SELECT id, scope_type, scope_id, provider, bucket_or_container,
             region, endpoint_url, base_path, credentials_ref, is_active, created_at, updated_at
      FROM storage_config
      ORDER BY
        CASE scope_type WHEN 'global' THEN 0 WHEN 'concession' THEN 1 WHEN 'platform' THEN 2 END,
        created_at DESC
    `.catch(() => []);

    return { configs };
  });

  // ═══ POST /admin/storage/config — Create or update storage config ═══
  fastify.post('/admin/storage/config', async (request, reply) => {
    const {
      scope_type = 'global',
      scope_id = null,
      provider,
      bucket_or_container,
      region,
      endpoint_url,
      base_path,
      credentials_ref,
    } = request.body;

    if (!provider) {
      return reply.status(400).send({ error: 'provider is required (s3 | local | azure | gcs)' });
    }
    if (!['s3', 'local', 'azure', 'gcs', 'do_spaces'].includes(provider)) {
      return reply.status(400).send({ error: 'provider must be one of: s3, local, azure, gcs, do_spaces' });
    }
    if (!['global', 'concession', 'platform'].includes(scope_type)) {
      return reply.status(400).send({ error: 'scope_type must be one of: global, concession, platform' });
    }

    try {
      // Upsert: if config for this scope exists, update it; otherwise create
      let existing;
      if (scope_id) {
        existing = await prisma.$queryRaw`
          SELECT id FROM storage_config
          WHERE scope_type = ${scope_type} AND scope_id = ${scope_id}::uuid
          LIMIT 1
        `.catch(() => []);
      } else {
        existing = await prisma.$queryRaw`
          SELECT id FROM storage_config
          WHERE scope_type = ${scope_type} AND scope_id IS NULL
          LIMIT 1
        `.catch(() => []);
      }

      let config;
      if (existing?.length > 0) {
        const existingId = String(existing[0].id);
        [config] = await prisma.$queryRaw`
          UPDATE storage_config SET
            provider = ${provider},
            bucket_or_container = ${bucket_or_container},
            region = ${region},
            endpoint_url = ${endpoint_url},
            base_path = ${base_path},
            credentials_ref = ${credentials_ref},
            is_active = true,
            updated_at = NOW()
          WHERE id = ${existingId}::uuid
          RETURNING id, scope_type, scope_id, provider, bucket_or_container, region, endpoint_url, base_path, is_active
        `;
      } else if (scope_id) {
        [config] = await prisma.$queryRaw`
          INSERT INTO storage_config (scope_type, scope_id, provider, bucket_or_container, region, endpoint_url, base_path, credentials_ref)
          VALUES (${scope_type}, ${scope_id}::uuid, ${provider}, ${bucket_or_container}, ${region}, ${endpoint_url}, ${base_path}, ${credentials_ref})
          RETURNING id, scope_type, scope_id, provider, bucket_or_container, region, endpoint_url, base_path, is_active
        `;
      } else {
        [config] = await prisma.$queryRaw`
          INSERT INTO storage_config (scope_type, scope_id, provider, bucket_or_container, region, endpoint_url, base_path, credentials_ref)
          VALUES (${scope_type}, NULL, ${provider}, ${bucket_or_container}, ${region}, ${endpoint_url}, ${base_path}, ${credentials_ref})
          RETURNING id, scope_type, scope_id, provider, bucket_or_container, region, endpoint_url, base_path, is_active
        `;
      }

      // Clear cached providers so new config takes effect
      clearProviderCache();

      return reply.status(201).send({ config });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to save storage config' });
    }
  });

  // ═══ POST /admin/storage/test-connection — Test storage provider ═══
  fastify.post('/admin/storage/test-connection', async (request, reply) => {
    const { provider, bucket_or_container, region, endpoint_url, base_path, credentials_json } = request.body;

    if (!provider) {
      return reply.status(400).send({ error: 'provider is required' });
    }

    try {
      const storageProvider = createProvider({
        provider,
        bucket_or_container,
        bucket: bucket_or_container,
        region,
        endpoint_url,
        base_path,
        basePath: base_path,
        serveUrl: endpoint_url,
        credentials_json,
        access_key: process.env.STORAGE_S3_ACCESS_KEY,
        secret_key: process.env.STORAGE_S3_SECRET_KEY,
      });

      const result = await storageProvider.testConnection();
      return result;
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  // ═══ GET /admin/storage/usage — Storage usage statistics ═══
  fastify.get('/admin/storage/usage', async (request, reply) => {
    const { scope_type, scope_id } = request.query;

    try {
      // Get the relevant config
      let config;
      if (scope_type && scope_id) {
        [config] = await prisma.$queryRaw`
          SELECT * FROM storage_config
          WHERE scope_type = ${scope_type} AND scope_id = ${scope_id}::uuid AND is_active = true
          LIMIT 1
        `.catch(() => []) || [];
      }
      if (!config) {
        [config] = await prisma.$queryRaw`
          SELECT * FROM storage_config
          WHERE scope_type = 'global' AND is_active = true
          LIMIT 1
        `.catch(() => []) || [];
      }

      if (!config) {
        return { fileCount: 0, totalSizeBytes: 0, message: 'No storage configured' };
      }

      const storageProvider = createProvider(config);
      const usage = await storageProvider.getUsage();
      return usage;
    } catch (err) {
      return { fileCount: 0, totalSizeBytes: 0, message: err.message };
    }
  });

  // ═══ DELETE /admin/storage/config/:id — Remove storage config ═══
  fastify.delete('/admin/storage/config/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.$queryRaw`DELETE FROM storage_config WHERE id = ${id}::uuid`;
      clearProviderCache();
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to delete storage config' });
    }
  });

  // ═══ POST /admin/storage/sync/scan — Scan storage for new P&ID files ═══
  fastify.post('/admin/storage/sync/scan', async (request, reply) => {
    const { platform_id, scan_prefix, config_id } = request.body;

    if (!platform_id) {
      return reply.status(400).send({ error: 'platform_id is required' });
    }

    try {
      const options = {};
      if (scan_prefix) options.scanPrefix = scan_prefix;
      if (config_id) options.configId = config_id;
      const result = await scanPlatformStorage(prisma, platform_id, options);
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ═══ POST /admin/storage/sync/import — Import detected files into DB ═══
  fastify.post('/admin/storage/sync/import', async (request, reply) => {
    const { platform_id, files, system_id } = request.body;

    if (!platform_id || !files || !Array.isArray(files)) {
      return reply.status(400).send({ error: 'platform_id and files[] are required' });
    }

    fastify.log.info({ filesCount: files.length, system_id, platform_id, fileKeys: files.map(f => f.key).slice(0, 5), importTypes: files.map(f => f.importType) }, 'Import request received');

    try {
      const result = await importDetectedFiles(prisma, platform_id, files, system_id || null);
      fastify.log.info({ created: result.created?.length, updated: result.updated?.length, skipped: result.skipped?.length, errors: result.errors?.length }, 'Import result');
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ═══ POST /admin/storage/sync/link — Link a storage file to an existing P&ID record ═══
  fastify.post('/admin/storage/sync/link', async (request, reply) => {
    const { pnid_id, storage_key } = request.body;

    if (!pnid_id || !storage_key) {
      return reply.status(400).send({ error: 'pnid_id and storage_key are required' });
    }

    try {
      await linkFileToRecord(prisma, pnid_id, storage_key);
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI & VISION SERVICE CREDENTIALS — Global admin configuration
  // ═══════════════════════════════════════════════════════════════════════════

  // Ensure AI columns exist on storage_config
  await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_credentials_ref TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_model_preference VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514'`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ocr_provider_preference VARCHAR(20) DEFAULT 'google'`).catch(() => {});

  // GET /admin/ai-config — Get global Claude AI credentials status
  fastify.get('/admin/ai-config', async (request, reply) => {
    try {
      const [config] = await prisma.$queryRaw`
        SELECT ai_credentials_ref, ai_model_preference FROM storage_config
        WHERE scope_type = 'global' AND is_active = true LIMIT 1
      `.catch(() => []);

      const hasAiCredentials = !!(config?.ai_credentials_ref) || !!process.env.ANTHROPIC_API_KEY;
      const source = config?.ai_credentials_ref ? 'global' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none';

      return {
        hasAiCredentials,
        aiModel: config?.ai_model_preference || 'claude-sonnet-4-20250514',
        source,
      };
    } catch (err) {
      return { hasAiCredentials: false, aiModel: 'claude-sonnet-4-20250514', source: 'none' };
    }
  });

  // PUT /admin/ai-config — Save Claude AI credentials globally
  fastify.put('/admin/ai-config', async (request, reply) => {
    const { apiKey, model } = request.body || {};

    if (apiKey && !apiKey.startsWith('sk-ant-')) {
      return reply.status(400).send({ error: 'Invalid API key format. Anthropic keys start with sk-ant-' });
    }

    const validModels = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'];
    const selectedModel = validModels.includes(model) ? model : 'claude-sonnet-4-20250514';

    try {
      const [existing] = await prisma.$queryRaw`
        SELECT id FROM storage_config WHERE scope_type = 'global' AND is_active = true LIMIT 1
      `.catch(() => []);

      if (existing) {
        await prisma.$executeRawUnsafe(`
          UPDATE storage_config SET
            ai_credentials_ref = COALESCE($1, ai_credentials_ref),
            ai_model_preference = $2,
            updated_at = NOW()
          WHERE id = $3::uuid
        `, apiKey || null, selectedModel, existing.id);
      } else {
        await prisma.$executeRawUnsafe(`
          INSERT INTO storage_config (scope_type, provider, ai_credentials_ref, ai_model_preference, is_active)
          VALUES ('global', 'none', $1, $2, true)
        `, apiKey || null, selectedModel);
      }

      return { success: true, hasAiCredentials: !!(apiKey), aiModel: selectedModel };
    } catch (err) {
      return reply.status(500).send({ error: `Failed to save AI config: ${err.message}` });
    }
  });

  // POST /admin/ai-test — Test Claude AI connectivity
  fastify.post('/admin/ai-test', async (request, reply) => {
    const { apiKey } = request.body || {};

    let resolvedKey = apiKey;
    if (!resolvedKey) {
      const [config] = await prisma.$queryRaw`
        SELECT ai_credentials_ref FROM storage_config
        WHERE scope_type = 'global' AND is_active = true LIMIT 1
      `.catch(() => []);
      resolvedKey = config?.ai_credentials_ref || process.env.ANTHROPIC_API_KEY;
    }

    if (!resolvedKey) {
      return { ok: false, message: 'No Claude API key configured. Enter a key above and save first.' };
    }

    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: resolvedKey });
      const start = Date.now();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with just the word OK' }],
      });
      const latencyMs = Date.now() - start;
      const text = response.content?.[0]?.text || '';
      return { ok: true, message: `Claude API connected (${latencyMs}ms) — ${text.trim()}`, latencyMs };
    } catch (err) {
      return { ok: false, message: `Connection failed: ${err.message}` };
    }
  });

  // GET /admin/vision-config — Get global Vision API credentials status
  fastify.get('/admin/vision-config', async (request, reply) => {
    try {
      // Check all global configs to find credentials across multiple rows
      const configs = await prisma.$queryRaw`
        SELECT vision_credentials_ref, credentials_ref FROM storage_config
        WHERE scope_type = 'global' AND is_active = true
      `.catch(() => []);

      const hasVision = configs.some(c => c.vision_credentials_ref);
      const hasStorage = configs.some(c => c.credentials_ref);

      return {
        hasVisionCredentials: hasVision || hasStorage,
        usesSeparateCredentials: hasVision,
        source: configs.length > 0 ? 'global' : 'none',
      };
    } catch (err) {
      return { hasVisionCredentials: false, usesSeparateCredentials: false, source: 'none' };
    }
  });

  // PUT /admin/vision-config — Save Vision API credentials globally
  fastify.put('/admin/vision-config', async (request, reply) => {
    const { visionCredentialsJson } = request.body || {};

    if (visionCredentialsJson) {
      try {
        const parsed = JSON.parse(visionCredentialsJson);
        if (!parsed.project_id || !parsed.private_key) {
          return reply.status(400).send({ error: 'Invalid credentials: must contain project_id and private_key' });
        }
      } catch {
        return reply.status(400).send({ error: 'Invalid JSON format' });
      }
    }

    try {
      const [existing] = await prisma.$queryRaw`
        SELECT id FROM storage_config WHERE scope_type = 'global' AND is_active = true LIMIT 1
      `.catch(() => []);

      if (existing) {
        await prisma.$executeRawUnsafe(`
          UPDATE storage_config SET vision_credentials_ref = $1, updated_at = NOW() WHERE id = $2::uuid
        `, visionCredentialsJson || null, existing.id);
      } else {
        await prisma.$executeRawUnsafe(`
          INSERT INTO storage_config (scope_type, provider, vision_credentials_ref, is_active)
          VALUES ('global', 'none', $1, true)
        `, visionCredentialsJson || null);
      }

      return { success: true, usesSeparateCredentials: !!(visionCredentialsJson) };
    } catch (err) {
      return reply.status(500).send({ error: `Failed to save vision config: ${err.message}` });
    }
  });

  // POST /admin/vision-test — Test Google Vision API connectivity
  fastify.post('/admin/vision-test', async (request, reply) => {
    // Outer try/catch so we never leak a 500 — the UI can render the message.
    try {
      const { credentialsJson } = request.body || {};

      let resolvedCreds = credentialsJson;
      let credsSource = credentialsJson ? 'request_body' : null;
      if (!resolvedCreds) {
        const configsRaw = await prisma.$queryRaw`
          SELECT vision_credentials_ref, credentials_ref FROM storage_config
          WHERE scope_type = 'global' AND is_active = true
          ORDER BY
            CASE WHEN vision_credentials_ref IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN credentials_ref IS NOT NULL THEN 0 ELSE 1 END
        `.catch((dbErr) => {
          fastify.log.warn({ err: dbErr }, 'vision-test: storage_config lookup failed');
          return [];
        });
        const configs = Array.isArray(configsRaw) ? configsRaw : [];
        for (const cfg of configs) {
          if (cfg?.vision_credentials_ref) {
            resolvedCreds = cfg.vision_credentials_ref;
            credsSource = 'vision_credentials_ref';
            break;
          }
          if (cfg?.credentials_ref) {
            resolvedCreds = cfg.credentials_ref;
            credsSource = 'credentials_ref (storage)';
            break;
          }
        }
      }

      if (!resolvedCreds) {
        return reply.send({
          ok: false,
          message: 'No Vision credentials available. Save credentials first or ensure GCS storage credentials exist.',
        });
      }

      // Validate the credentials JSON shape BEFORE asking the SDK to do anything,
      // so a bad paste produces a clear UI message instead of an opaque SDK error.
      let credsObj = null;
      if (typeof resolvedCreds === 'string') {
        try {
          credsObj = JSON.parse(resolvedCreds);
        } catch (parseErr) {
          return reply.send({
            ok: false,
            message: `Vision credentials are not valid JSON (${credsSource}): ${parseErr.message}`,
          });
        }
      } else if (typeof resolvedCreds === 'object') {
        credsObj = resolvedCreds;
      }
      if (!credsObj || typeof credsObj !== 'object') {
        return reply.send({
          ok: false,
          message: `Vision credentials JSON is empty or wrong type (${credsSource}).`,
        });
      }
      const missing = ['type', 'project_id', 'private_key', 'client_email'].filter(k => !credsObj[k]);
      if (missing.length > 0) {
        return reply.send({
          ok: false,
          message: `Vision credentials JSON is missing required fields: ${missing.join(', ')} (${credsSource}). This is usually because Storage credentials were saved as a non-service-account JSON.`,
        });
      }

      try {
        const { default: VisionOCRProvider } = await import('../../services/ocr/VisionOCRProvider.js');
        const provider = new VisionOCRProvider(credsObj);
        const testPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          'base64'
        );
        await provider.extractFromImage(testPng);
        return reply.send({
          ok: true,
          message: `Vision API connected successfully (project: ${credsObj.project_id}, source: ${credsSource})`,
        });
      } catch (err) {
        fastify.log.warn({ err, credsSource, projectId: credsObj.project_id }, 'vision-test: Vision API call failed');
        return reply.send({
          ok: false,
          message: `Vision API failed (project: ${credsObj.project_id}, source: ${credsSource}): ${err.message}`,
        });
      }
    } catch (outerErr) {
      // Defensive — should never hit, but if it does we surface the real error
      // instead of an opaque 500.
      fastify.log.error({ err: outerErr }, 'vision-test: unexpected error');
      return reply.send({
        ok: false,
        message: `Vision test crashed: ${outerErr?.message || outerErr}`,
      });
    }
  });
}
