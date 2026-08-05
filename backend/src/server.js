import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

import { runMigrations } from './migrationRunner.js';
import prisma from './db.js';
import platformRoutes from './routes/platforms.js';
import systemRoutes from './routes/systems.js';
import pnidRoutes from './routes/pnids.js';
import lineRoutes from './routes/lines.js';
import equipmentRoutes from './routes/equipment.js';
import instrumentRoutes from './routes/instruments.js';
import registerRoutes from './routes/registers.js';
import searchRoutes from './routes/search.js';
import annotationRoutes from './routes/annotations.js';
import chatRoutes from './routes/chat.js';
import assetTreeRoutes from './routes/assetTree.js';
import tagDocumentRoutes from './routes/tagDocuments.js';
import topologyRoutes from './routes/topology.js';
import modelRoutes from './routes/models.js';
import pidModuleRoutes from './routes/pidModule.js';
import centralHubRoutes from './routes/centralHub.js';

import adminHierarchyRoutes from './routes/admin/hierarchy.js';
import adminEntitiesRoutes from './routes/admin/entities.js';
import adminImportExportRoutes from './routes/admin/importExport.js';
import adminLinkageRoutes from './routes/admin/linkage.js';
import adminStorageRoutes from './routes/admin/storage.js';
import adminUploadRoutes from './routes/admin/upload.js';
import adminAuditLogRoutes from './routes/admin/auditLog.js';
import adminTransmittalRoutes from './routes/admin/transmittal.js';
import ocrRoutes from './routes/ocr.js';
import ocrPipelineRoutes from './routes/ocrPipeline.js';
import ocrRegisterStagingRoutes from './routes/ocrRegisterStaging.js';
import aiAnalysisRoutes from './routes/aiAnalysis.js';
import aiAnnotateRoutes from './routes/aiAnnotate.js';
import smartIdentificationRoutes from './routes/smartIdentification.js';
import tagDictionaryRoutes from './routes/tagDictionary.js';
import adminFileManagerRoutes from './routes/admin/fileManager.js';
import adminSymbolRoutes from './routes/admin/symbols.js';
import symbolRoutes from './routes/symbols.js';
import authRoutes from './routes/auth.js';
import adminUsersRoutes from './routes/admin/users.js';
import { bootstrapAuth, authenticateRequest } from './auth/index.js';
import { hasPermission } from './auth/permissions.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
  bodyLimit: 104857600, // 100MB for P&ID file uploads
  pluginTimeout: 180000, // 180s — OCR pipeline startup can be slow on Windows/local DB
});

// Plugins
await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Token', 'x-api-key'],
});
await fastify.register(websocket);

// Allow text/csv request bodies (used by CSV import endpoints)
fastify.addContentTypeParser('text/csv', { parseAs: 'string' }, (req, body, done) => {
  done(null, body);
});

// Serve frontend static files from backend/public
await fastify.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
  wildcard: true,
});

// Attach authenticated user when Bearer token is present
fastify.addHook('onRequest', async (request) => {
  try {
    const auth = await authenticateRequest(request);
    if (auth) {
      request.user = auth.user;
      request.roles = auth.roles;
      request.permissions = auth.permissions;
      request.scope = auth.scope;
    }
  } catch {
    // ignore invalid tokens here — route guards enforce auth when needed
  }
});

// Protect all /api/v1/admin/* endpoints (login + admin.access / users.manage)
fastify.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0];
  if (!url.startsWith('/api/v1/admin')) return;

  const isUsersApi =
    url.startsWith('/api/v1/admin/users') ||
    url.startsWith('/api/v1/admin/roles') ||
    url.startsWith('/api/v1/admin/permissions');

  if (!request.user) {
    return reply.code(401).send({ error: 'Authentication required' });
  }

  if (isUsersApi) {
    if (!hasPermission(request.permissions, 'users.manage') && !hasPermission(request.permissions, 'admin.access')) {
      return reply.code(403).send({ error: 'Insufficient permissions', required: 'users.manage' });
    }
    return;
  }

  if (!hasPermission(request.permissions, 'admin.access')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }
});

// Routes
await fastify.register(authRoutes, { prefix: '/api/v1' });
await fastify.register(platformRoutes, { prefix: '/api/v1' });
await fastify.register(systemRoutes, { prefix: '/api/v1' });
await fastify.register(pnidRoutes, { prefix: '/api/v1' });
await fastify.register(lineRoutes, { prefix: '/api/v1' });
await fastify.register(equipmentRoutes, { prefix: '/api/v1' });
await fastify.register(instrumentRoutes, { prefix: '/api/v1' });
await fastify.register(registerRoutes, { prefix: '/api/v1' });
await fastify.register(searchRoutes, { prefix: '/api/v1' });
await fastify.register(annotationRoutes, { prefix: '/api/v1' });
await fastify.register(chatRoutes, { prefix: '/api/v1' });
await fastify.register(assetTreeRoutes, { prefix: '/api/v1' });
await fastify.register(tagDocumentRoutes, { prefix: '/api/v1' });
await fastify.register(topologyRoutes, { prefix: '/api/v1' });
await fastify.register(modelRoutes, { prefix: '/api/v1' });
await fastify.register(pidModuleRoutes, { prefix: '/api/v1' });
await fastify.register(centralHubRoutes, { prefix: '/api/v1' });

// Admin routes
await fastify.register(adminHierarchyRoutes, { prefix: '/api/v1' });
await fastify.register(adminEntitiesRoutes, { prefix: '/api/v1' });
await fastify.register(adminImportExportRoutes, { prefix: '/api/v1' });
await fastify.register(adminLinkageRoutes, { prefix: '/api/v1' });
await fastify.register(adminStorageRoutes, { prefix: '/api/v1' });
await fastify.register(adminUploadRoutes, { prefix: '/api/v1' });
await fastify.register(adminAuditLogRoutes, { prefix: '/api/v1' });
await fastify.register(adminTransmittalRoutes, { prefix: '/api/v1' });
await fastify.register(adminUsersRoutes, { prefix: '/api/v1' });
await fastify.register(ocrRoutes, { prefix: '/api/v1' });
await fastify.register(ocrPipelineRoutes, { prefix: '/api/v1' });
await fastify.register(ocrRegisterStagingRoutes, { prefix: '/api/v1' });
await fastify.register(aiAnalysisRoutes, { prefix: '/api/v1' });
await fastify.register(aiAnnotateRoutes, { prefix: '/api/v1' });
await fastify.register(smartIdentificationRoutes, { prefix: '/api/v1' });
await fastify.register(tagDictionaryRoutes, { prefix: '/api/v1' });
await fastify.register(adminFileManagerRoutes, { prefix: '/api/v1' });
await fastify.register(adminSymbolRoutes, { prefix: '/api/v1' });
await fastify.register(symbolRoutes, { prefix: '/api/v1' });

// Health check with DB schema validation
fastify.get('/health', async () => ({ status: 'ok', service: 'assetview-api', version: '2.0.0' }));

// Admin endpoint to check/run database migrations
fastify.get('/api/v1/admin/db-status', async (request, reply) => {
  try {
    const result = await runMigrations({ dryRun: true });

    // Also check key tables/columns exist
    const checks = {};
    const tableChecks = ['storage_config', 'ocr_batch', 'ocr_batch_file', 'ai_analysis_job', 'ai_generated_entity', 'ocr_extraction'];
    for (const table of tableChecks) {
      try {
        await prisma.$queryRawUnsafe(`SELECT 1 FROM ${table} LIMIT 0`);
        checks[table] = 'exists';
      } catch {
        checks[table] = 'MISSING';
      }
    }
    // Check key columns on storage_config
    const colChecks = ['vision_credentials_ref', 'ai_credentials_ref', 'ai_model_preference', 'ocr_provider_preference'];
    for (const col of colChecks) {
      try {
        await prisma.$queryRawUnsafe(`SELECT ${col} FROM storage_config LIMIT 0`);
        checks[`storage_config.${col}`] = 'exists';
      } catch {
        checks[`storage_config.${col}`] = 'MISSING';
      }
    }

    checks['env.PADDLE_OCR_URL'] = process.env.PADDLE_OCR_URL ? 'configured' : 'missing';
    checks['env.PADDLE_OCR_TIMEOUT_MS'] = process.env.PADDLE_OCR_TIMEOUT_MS ? 'configured' : 'default';

    return { ...result, schemaChecks: checks };
  } catch (err) {
    return reply.code(500).send({ error: 'DB status check failed', detail: err.message });
  }
});

fastify.post('/api/v1/admin/db-migrate', async (request, reply) => {
  try {
    const result = await runMigrations({ dryRun: false });
    return result;
  } catch (err) {
    return reply.code(500).send({ error: 'Migration failed', detail: err.message });
  }
});

// SPA fallback — serve index.html for non-API routes
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    reply.code(404).send({ error: 'Not found' });
  } else {
    reply.sendFile('index.html');
  }
});

// Start
const port = Number(process.env.PORT || 3001);

async function closeGracefully(signal) {
  console.log(`\n${signal} received — shutting down...`);
  try {
    await fastify.close();
    await prisma.$disconnect();
  } catch (err) {
    fastify.log.warn(err, 'shutdown error');
  }
  process.exit(0);
}

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

try {
  // Migrations: once via scripts/runMigrations.mjs in dev; always on production/docker startup
  if (process.env.SKIP_STARTUP_MIGRATIONS !== '1') {
    console.log('Checking database migrations...');
    const migrationResult = await runMigrations({ dryRun: false });
    if (migrationResult.applied > 0) {
      console.log(`Applied ${migrationResult.applied} migration(s):`);
      for (const m of migrationResult.migrations) {
        console.log(`  ${m.status === 'applied' ? '✓' : '✗'} ${m.file} — ${m.statements || 0} statements ${m.error ? '(ERROR: ' + m.error + ')' : ''}`);
      }
    } else {
      console.log('Database schema is up to date');
    }
    if (migrationResult.errors.length > 0) {
      console.warn('Migration errors:', migrationResult.errors);
    }
  }

  try {
    await bootstrapAuth();
  } catch (authErr) {
    console.warn('[auth] Bootstrap skipped:', authErr.message);
  }

  const isWin = process.platform === 'win32';
  let retries = isWin ? 15 : 5;
  const retryMs = isWin ? 2000 : 1000;
  while (retries > 0) {
    try {
      await fastify.listen({ port, host: '0.0.0.0' });
      console.log(`AssetView API running on port ${port}`);
      break;
    } catch (err) {
      if (err?.code === 'EADDRINUSE' && retries > 1) {
        retries -= 1;
        console.warn(`Port ${port} busy — retrying in ${retryMs / 1000}s (${retries} left)...`);
        await new Promise((r) => setTimeout(r, retryMs));
        continue;
      }
      throw err;
    }
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
