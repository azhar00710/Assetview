/**
 * Abstract StorageProvider interface.
 * All storage backends (S3, Azure, GCS, Local, DigitalOcean) implement these methods.
 * AssetView stores references (keys) — NOT the files themselves.
 */
export default class StorageProvider {
  constructor(config) {
    this.config = config;
  }

  /** Provider type identifier (e.g. 's3', 'gcs', 'azure', 'do_spaces', 'local'). */
  get type() {
    return this.config?.provider || 'unknown';
  }

  /**
   * Upload a file and return a storage reference.
   * @param {Buffer|Stream} file - File content
   * @param {string} key - Storage key (path within bucket/folder)
   * @param {object} [options] - { contentType, metadata }
   * @returns {Promise<{ storageKey: string, size: number, checksum: string }>}
   */
  async upload(file, key, options = {}) {
    throw new Error('upload() not implemented');
  }

  /**
   * Download a file from storage.
   * @param {string} key - Storage key
   * @returns {Promise<{ buffer: Buffer, contentType: string, size: number }>}
   */
  async download(key) {
    throw new Error('download() not implemented');
  }

  /**
   * Generate a URL for accessing the file.
   * Cloud: time-limited signed URL. Local: direct serve URL.
   * @param {string} key - Storage key
   * @param {number} [expiresIn=3600] - Seconds until expiry (cloud only)
   * @returns {Promise<string>} URL
   */
  async getUrl(key, expiresIn = 3600) {
    throw new Error('getUrl() not implemented');
  }

  /**
   * Delete a file from storage.
   * @param {string} key - Storage key
   * @returns {Promise<void>}
   */
  async delete(key) {
    throw new Error('delete() not implemented');
  }

  /**
   * Check if a file exists in storage.
   * @param {string} key - Storage key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    throw new Error('exists() not implemented');
  }

  /**
   * Copy a file within storage (used for versioning / archiving).
   * @param {string} sourceKey
   * @param {string} destKey
   * @returns {Promise<void>}
   */
  async copy(sourceKey, destKey) {
    throw new Error('copy() not implemented');
  }

  /**
   * Move (rename) a file within storage.
   * Default implementation: copy + delete.
   * @param {string} sourceKey
   * @param {string} destKey
   * @returns {Promise<void>}
   */
  async move(sourceKey, destKey) {
    await this.copy(sourceKey, destKey);
    await this.delete(sourceKey);
  }

  /**
   * List files and folders at a given prefix (virtual directory).
   * Returns items at ONE level (non-recursive) with pagination support.
   * @param {string} [prefix=''] - Prefix / virtual directory
   * @param {object} [options] - { maxKeys, continuationToken, delimiter }
   * @returns {Promise<{ files: Array<{ key, name, size, lastModified, contentType }>, folders: string[], isTruncated: boolean, nextToken?: string }>}
   */
  async list(prefix = '', options = {}) {
    throw new Error('list() not implemented');
  }

  /**
   * Create a folder (virtual directory).
   * On object stores: creates a zero-byte marker object with trailing slash.
   * On local: creates a real directory.
   * @param {string} folderKey - Folder key (must end with '/')
   * @returns {Promise<void>}
   */
  async createFolder(folderKey) {
    throw new Error('createFolder() not implemented');
  }

  /**
   * Delete a folder and all its contents recursively.
   * @param {string} folderKey - Folder key (must end with '/')
   * @returns {Promise<{ deletedCount: number }>}
   */
  async deleteFolder(folderKey) {
    throw new Error('deleteFolder() not implemented');
  }

  /**
   * Get metadata for a single file.
   * @param {string} key - Storage key
   * @returns {Promise<{ key, name, size, lastModified, contentType, metadata }>}
   */
  async getMetadata(key) {
    throw new Error('getMetadata() not implemented');
  }

  /**
   * Generate a presigned URL for direct upload (bypasses backend proxy).
   * Not all providers support this — returns null if unsupported.
   * @param {string} key - Destination storage key
   * @param {string} contentType - MIME type
   * @param {number} [expiresIn=3600] - Seconds until expiry
   * @returns {Promise<{ url: string, fields?: object } | null>}
   */
  async getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    return null; // Override in providers that support it
  }

  /**
   * Test the connection / configuration.
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  async testConnection() {
    throw new Error('testConnection() not implemented');
  }

  /**
   * Get storage usage statistics.
   * @param {string} [prefix] - Optional prefix to scope
   * @returns {Promise<{ fileCount: number, totalSizeBytes: number }>}
   */
  async getUsage(prefix = '') {
    throw new Error('getUsage() not implemented');
  }

  /**
   * Download a file from storage as a Buffer.
   * @param {string} key - Storage key
   * @returns {Promise<Buffer>}
   */
  async download(key) {
    throw new Error('download() not implemented');
  }
}
