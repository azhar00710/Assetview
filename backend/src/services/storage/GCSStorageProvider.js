import { createHash } from 'crypto';
import StorageProvider from './StorageProvider.js';

/**
 * Google Cloud Storage provider.
 * Uses the @google-cloud/storage SDK.
 * Supports authentication via:
 *   1. Service account JSON key file (GOOGLE_APPLICATION_CREDENTIALS env var)
 *   2. Service account JSON passed in config.credentials_json
 *   3. Default application credentials (on GCE/Cloud Run)
 */
export default class GCSStorageProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.bucketName = config.bucket_or_container || config.bucket;
    this.basePath = config.base_path || '';
    this._storage = null;
    this._bucket = null;
  }

  async _getStorage() {
    if (this._storage) return this._storage;

    try {
      const { Storage } = await import('@google-cloud/storage');
      const opts = {};

      if (this.config.credentials_json) {
        try {
          const creds = typeof this.config.credentials_json === 'string'
            ? JSON.parse(this.config.credentials_json)
            : this.config.credentials_json;
          opts.credentials = creds;
          opts.projectId = creds.project_id;
        } catch (e) {
          throw new Error(`Invalid credentials JSON: ${e.message}`);
        }
      }

      this._storage = new Storage(opts);
      this._bucket = this._storage.bucket(this.bucketName);
      return this._storage;
    } catch (err) {
      if (err.message.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'Google Cloud Storage SDK not installed. Run: npm install @google-cloud/storage'
        );
      }
      throw err;
    }
  }

  async _getBucket() {
    await this._getStorage();
    return this._bucket;
  }

  _fullKey(key) {
    return this.basePath ? `${this.basePath.replace(/\/+$/, '')}/${key}` : key;
  }

  _stripBase(fullKey) {
    if (this.basePath) {
      const prefix = this.basePath.replace(/\/+$/, '') + '/';
      return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey;
    }
    return fullKey;
  }

  async upload(file, key, options = {}) {
    const bucket = await this._getBucket();
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    const fullKey = this._fullKey(key);
    const checksum = createHash('sha256').update(buffer).digest('hex');

    const blob = bucket.file(fullKey);
    await blob.save(buffer, {
      contentType: options.contentType || 'application/octet-stream',
      metadata: {
        metadata: { checksum, ...(options.metadata || {}) },
      },
    });

    return {
      storageKey: key,
      size: buffer.length,
      checksum,
    };
  }

  async download(key) {
    const bucket = await this._getBucket();
    const blob = bucket.file(this._fullKey(key));
    const [buffer] = await blob.download();
    const [metadata] = await blob.getMetadata();

    return {
      buffer,
      contentType: metadata.contentType || 'application/octet-stream',
      size: parseInt(metadata.size || buffer.length, 10),
    };
  }

  async getUrl(key, expiresIn = 3600) {
    const bucket = await this._getBucket();
    const blob = bucket.file(this._fullKey(key));

    const [url] = await blob.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });

    return url;
  }

  async getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    const bucket = await this._getBucket();
    const blob = bucket.file(this._fullKey(key));

    const [url] = await blob.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresIn * 1000,
      contentType,
    });

    return { url };
  }

  async delete(key) {
    const bucket = await this._getBucket();
    await bucket.file(this._fullKey(key)).delete({ ignoreNotFound: true });
  }

  async exists(key) {
    const bucket = await this._getBucket();
    const [exists] = await bucket.file(this._fullKey(key)).exists();
    return exists;
  }

  async copy(sourceKey, destKey) {
    const bucket = await this._getBucket();
    await bucket.file(this._fullKey(sourceKey)).copy(bucket.file(this._fullKey(destKey)));
  }

  async list(prefix = '', options = {}) {
    const bucket = await this._getBucket();
    const fullPrefix = this._fullKey(prefix);
    const delimiter = options.delimiter !== undefined ? options.delimiter : '/';

    const queryOpts = {
      prefix: fullPrefix,
      delimiter,
      maxResults: options.maxKeys || 1000,
      autoPaginate: false,
    };
    if (options.continuationToken) {
      queryOpts.pageToken = options.continuationToken;
    }

    const [gcsFiles, nextQuery, apiResponse] = await bucket.getFiles(queryOpts);

    const files = gcsFiles
      .filter(f => f.name !== fullPrefix) // exclude prefix marker
      .map(f => ({
        key: this._stripBase(f.name),
        name: f.name.split('/').filter(Boolean).pop(),
        size: parseInt(f.metadata.size || 0, 10),
        lastModified: f.metadata.updated || null,
        contentType: f.metadata.contentType || null,
      }));

    const folders = (apiResponse?.prefixes || []).map(p => this._stripBase(p));

    return {
      files,
      folders,
      isTruncated: !!nextQuery,
      nextToken: nextQuery?.pageToken || undefined,
    };
  }

  async createFolder(folderKey) {
    const bucket = await this._getBucket();
    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    const blob = bucket.file(this._fullKey(key));
    await blob.save('', { contentType: 'application/x-directory' });
  }

  async deleteFolder(folderKey) {
    const bucket = await this._getBucket();
    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    const fullPrefix = this._fullKey(key);

    const [files] = await bucket.getFiles({ prefix: fullPrefix });
    let deletedCount = 0;

    // Delete in batches of 100
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100);
      await Promise.all(batch.map(f => f.delete({ ignoreNotFound: true })));
      deletedCount += batch.length;
    }

    return { deletedCount };
  }

  async getMetadata(key) {
    const bucket = await this._getBucket();
    const blob = bucket.file(this._fullKey(key));
    const [metadata] = await blob.getMetadata();

    return {
      key,
      name: key.split('/').filter(Boolean).pop(),
      size: parseInt(metadata.size || 0, 10),
      lastModified: metadata.updated || null,
      contentType: metadata.contentType || 'application/octet-stream',
      metadata: metadata.metadata || {},
    };
  }

  async testConnection() {
    try {
      const bucket = await this._getBucket();
      const [metadata] = await bucket.getMetadata();
      return {
        ok: true,
        message: `Connected to GCS bucket: ${this.bucketName} (location: ${metadata.location}, class: ${metadata.storageClass})`,
      };
    } catch (err) {
      return { ok: false, message: `GCS connection failed: ${err.message}` };
    }
  }

  async getUsage(prefix = '') {
    try {
      const bucket = await this._getBucket();
      const fullPrefix = this._fullKey(prefix);

      let fileCount = 0;
      let totalSizeBytes = 0;

      const [files] = await bucket.getFiles({ prefix: fullPrefix });
      for (const file of files) {
        fileCount++;
        totalSizeBytes += parseInt(file.metadata.size || 0, 10);
      }

      return { fileCount, totalSizeBytes };
    } catch (err) {
      return { fileCount: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * List files in a bucket prefix — used by the sync/watcher service.
   * Returns array of { key, size, updated, contentType }
   */
  async listFiles(prefix = '') {
    const bucket = await this._getBucket();
    const fullPrefix = this._fullKey(prefix);

    const [files] = await bucket.getFiles({ prefix: fullPrefix });
    return files.map(f => ({
      key: this._stripBase(f.name),
      size: parseInt(f.metadata.size || 0, 10),
      updated: f.metadata.updated,
      contentType: f.metadata.contentType,
    }));
  }
}
