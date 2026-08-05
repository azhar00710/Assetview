import S3StorageProvider from './S3StorageProvider.js';

/**
 * DigitalOcean Spaces provider.
 * DO Spaces is S3-compatible, so this extends S3StorageProvider
 * with DO-specific defaults and endpoint handling.
 *
 * Config:
 *   - region: e.g. 'nyc3', 'sfo3', 'ams3', 'sgp1', 'fra1'
 *   - bucket_or_container: Space name
 *   - access_key: DO Spaces access key
 *   - secret_key: DO Spaces secret key
 *   - endpoint_url: (auto-generated from region if not set)
 */
export default class DOSpacesProvider extends S3StorageProvider {
  constructor(config) {
    // Auto-build endpoint from region if not explicitly set
    const region = config.region || 'nyc3';
    if (!config.endpoint_url) {
      config.endpoint_url = `https://${region}.digitaloceanspaces.com`;
    }
    // DO Spaces always uses path-style (handled by parent's forcePathStyle)
    super({ ...config, region, provider: 'do_spaces' });
  }

  async testConnection() {
    const result = await super.testConnection();
    if (result.ok) {
      result.message = `Connected to DigitalOcean Space: ${this.bucket} (${this.region})`;
    }
    return result;
  }
}
