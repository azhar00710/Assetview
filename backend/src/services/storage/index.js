import LocalStorageProvider from './LocalStorageProvider.js';
import S3StorageProvider from './S3StorageProvider.js';
import GCSStorageProvider from './GCSStorageProvider.js';
import AzureBlobProvider from './AzureBlobProvider.js';
import DOSpacesProvider from './DOSpacesProvider.js';

/**
 * Storage provider factory.
 * Resolves the correct provider based on config from DB or environment.
 * Supported providers: local, s3, gcs, azure, do_spaces
 */

// Cache provider instances by scope
const providerCache = new Map();

/** All supported provider types with display metadata. */
export const PROVIDER_TYPES = [
  { value: 'local', label: 'Local / NAS', description: 'Files on local disk or network share' },
  { value: 's3', label: 'AWS S3 / MinIO', description: 'S3-compatible cloud storage' },
  { value: 'gcs', label: 'Google Cloud Storage', description: 'Google Cloud Storage buckets' },
  { value: 'azure', label: 'Azure Blob Storage', description: 'Microsoft Azure Blob containers' },
  { value: 'do_spaces', label: 'DigitalOcean Spaces', description: 'DigitalOcean Spaces (S3-compatible)' },
];

/**
 * Create a storage provider from a config object.
 * @param {{ provider: string, base_path?: string, endpoint_url?: string, bucket_or_container?: string, region?: string }} config
 * @returns {import('./StorageProvider.js').default}
 */
export function createProvider(config) {
  // Map DB column `credentials_ref` to `credentials_json` for GCS provider
  if (config.credentials_ref && !config.credentials_json) {
    config.credentials_json = config.credentials_ref;
  }

  switch (config.provider) {
    case 'local':
      return new LocalStorageProvider(config);
    case 's3':
      return new S3StorageProvider(config);
    case 'gcs':
      return new GCSStorageProvider(config);
    case 'azure':
      return new AzureBlobProvider(config);
    case 'do_spaces':
      return new DOSpacesProvider(config);
    default:
      throw new Error(`Unknown storage provider: ${config.provider}. Supported: ${PROVIDER_TYPES.map(p => p.value).join(', ')}`);
  }
}

/**
 * Get the storage provider for a given scope.
 * Checks: platform-specific → concession-specific → global → env fallback.
 * @param {import('../../db.js').default} prisma - Prisma client
 * @param {{ platformId?: string, concessionId?: string }} [scope]
 * @returns {Promise<import('./StorageProvider.js').default>}
 */
export async function getStorageProvider(prisma, scope = {}) {
  // Try platform-specific config
  if (scope.platformId) {
    const cacheKey = `platform:${scope.platformId}`;
    if (providerCache.has(cacheKey)) return providerCache.get(cacheKey);

    const config = await prisma.$queryRaw`
      SELECT * FROM storage_config
      WHERE scope_type = 'platform' AND scope_id = ${scope.platformId}::uuid AND is_active = true
        AND COALESCE(NULLIF(TRIM(base_path), ''), '') <> ''
      ORDER BY updated_at DESC
      LIMIT 1
    `.catch(() => []);

    if (config?.length > 0) {
      const provider = createProvider(config[0]);
      providerCache.set(cacheKey, provider);
      return provider;
    }
  }

  // Try concession-specific config
  if (scope.concessionId) {
    const cacheKey = `concession:${scope.concessionId}`;
    if (providerCache.has(cacheKey)) return providerCache.get(cacheKey);

    const config = await prisma.$queryRaw`
      SELECT * FROM storage_config
      WHERE scope_type = 'concession' AND scope_id = ${scope.concessionId}::uuid AND is_active = true
      LIMIT 1
    `.catch(() => []);

    if (config?.length > 0) {
      const provider = createProvider(config[0]);
      providerCache.set(cacheKey, provider);
      return provider;
    }
  }

  // Try global config from DB
  const globalCacheKey = 'global';
  if (providerCache.has(globalCacheKey)) return providerCache.get(globalCacheKey);

  const globalConfig = await prisma.$queryRaw`
    SELECT * FROM storage_config
    WHERE scope_type = 'global' AND is_active = true
    LIMIT 1
  `.catch(() => []);

  if (globalConfig?.length > 0) {
    const provider = createProvider(globalConfig[0]);
    providerCache.set(globalCacheKey, provider);
    return provider;
  }

  // Fallback to environment variables
  const envConfig = getEnvConfig();
  const provider = createProvider(envConfig);
  providerCache.set(globalCacheKey, provider);
  return provider;
}

/**
 * Build storage config from environment variables.
 */
function getEnvConfig() {
  const provider = process.env.STORAGE_PROVIDER || 'local';

  if (provider === 's3') {
    return {
      provider: 's3',
      bucket_or_container: process.env.STORAGE_S3_BUCKET,
      bucket: process.env.STORAGE_S3_BUCKET,
      region: process.env.STORAGE_S3_REGION || 'us-east-1',
      endpoint_url: process.env.STORAGE_S3_ENDPOINT || undefined,
      base_path: process.env.STORAGE_S3_BASE_PATH || '',
      access_key: process.env.STORAGE_S3_ACCESS_KEY,
      secret_key: process.env.STORAGE_S3_SECRET_KEY,
    };
  }

  if (provider === 'gcs') {
    return {
      provider: 'gcs',
      bucket_or_container: process.env.STORAGE_GCS_BUCKET,
      bucket: process.env.STORAGE_GCS_BUCKET,
      base_path: process.env.STORAGE_GCS_BASE_PATH || '',
      credentials_json: process.env.STORAGE_GCS_CREDENTIALS_JSON || undefined,
      // GOOGLE_APPLICATION_CREDENTIALS env var is picked up by SDK automatically
    };
  }

  // Default: local
  return {
    provider: 'local',
    base_path: process.env.STORAGE_LOCAL_BASE_PATH || './storage/pids',
    endpoint_url: process.env.STORAGE_LOCAL_SERVE_URL || '',
  };
}

/**
 * Clear the provider cache (useful after config changes).
 */
export function clearProviderCache() {
  providerCache.clear();
}

/**
 * Generate a storage key for a P&ID file.
 * Convention: {platform_code}/pids/{drawing_number}/rev_{revision}/{filename}
 */
export function generatePnidStorageKey(platformCode, drawingNumber, revision, filename) {
  const safeDrawing = drawingNumber.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safeRev = (revision || '0').replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return `${platformCode}/pids/${safeDrawing}/rev_${safeRev}/${filename}`;
}

/**
 * Resolve the full hierarchy path for a platform.
 * Returns: { clientCode, projectCode, concessionCode, locationCode, complexCode, platformCode }
 */
export async function resolveHierarchyPath(prisma, platformId) {
  const result = await prisma.platform.findUnique({
    where: { id: platformId },
    include: {
      complex: {
        include: {
          location: {
            include: {
              concession: {
                include: {
                  project: {
                    include: { client: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!result) throw new Error(`Platform ${platformId} not found`);

  const sanitize = (s) => (s || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_');

  const complex = result.complex;
  const location = complex?.location;
  const concession = location?.concession;
  const project = concession?.project;
  const client = project?.client;

  return {
    clientCode: sanitize(client?.code),
    projectCode: sanitize(project?.code),
    concessionCode: sanitize(concession?.code),
    locationCode: sanitize(location?.code),
    complexCode: sanitize(complex?.code),
    platformCode: sanitize(result.code),
  };
}

/**
 * Generate a hierarchy-aware storage key for a P&ID file.
 * Convention: {client}/{project}/{concession}/{location}/{complex}/{platform}/pids/{drawing_number}/rev_{revision}/{filename}
 */
export function generateHierarchyPnidStorageKey(hierarchyPath, drawingNumber, revision, filename) {
  const { clientCode, projectCode, concessionCode, locationCode, complexCode, platformCode } = hierarchyPath;
  const safeDrawing = drawingNumber.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safeRev = (revision || '0').replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return `${clientCode}/${projectCode}/${concessionCode}/${locationCode}/${complexCode}/${platformCode}/pids/${safeDrawing}/rev_${safeRev}/${filename}`;
}

/**
 * Generate storage key for a line list file.
 */
export function generateLineListStorageKey(hierarchyPath, filename, revision) {
  const { clientCode, projectCode, concessionCode, locationCode, complexCode, platformCode } = hierarchyPath;
  const safeRev = (revision || '1').replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return `${clientCode}/${projectCode}/${concessionCode}/${locationCode}/${complexCode}/${platformCode}/linelists/rev_${safeRev}/${filename}`;
}

/**
 * Generate storage key for an equipment list file.
 */
export function generateEquipmentListStorageKey(hierarchyPath, filename, revision) {
  const { clientCode, projectCode, concessionCode, locationCode, complexCode, platformCode } = hierarchyPath;
  const safeRev = (revision || '1').replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return `${clientCode}/${projectCode}/${concessionCode}/${locationCode}/${complexCode}/${platformCode}/equipment/rev_${safeRev}/${filename}`;
}

/**
 * Parse a P&ID filename to extract drawing number and revision.
 * Examples:
 *   'AD219-490-D-15101_Rev4.pdf' -> { drawingNumber: 'AD219-490-D-15101', revision: '4' }
 *   'AD219-490-D-15101_R3.png'   -> { drawingNumber: 'AD219-490-D-15101', revision: '3' }
 *   'AD219-490-D-15101.pdf'      -> { drawingNumber: 'AD219-490-D-15101', revision: null }
 */
export function parsePnidFilename(filename) {
  // Strip extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Try to extract revision: _Rev4, _R3, _rev4, -Rev4, -R3
  const revMatch = nameWithoutExt.match(/[_\-][Rr](?:ev)?(\d+)$/);
  if (revMatch) {
    const revision = revMatch[1];
    const drawingNumber = nameWithoutExt.slice(0, revMatch.index);
    return { drawingNumber, revision };
  }

  return { drawingNumber: nameWithoutExt, revision: null };
}
