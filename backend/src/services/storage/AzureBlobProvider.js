import { createHash } from 'crypto';
import StorageProvider from './StorageProvider.js';

/**
 * Azure Blob Storage provider.
 * Uses the @azure/storage-blob SDK.
 * Supports authentication via:
 *   1. Connection string
 *   2. Account name + account key
 *   3. SAS token
 */
export default class AzureBlobProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.containerName = config.bucket_or_container || config.container;
    this.basePath = config.base_path || '';
    this._containerClient = null;
  }

  async _getContainerClient() {
    if (this._containerClient) return this._containerClient;

    try {
      const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob');
      let serviceClient;

      if (this.config.connection_string) {
        serviceClient = BlobServiceClient.fromConnectionString(this.config.connection_string);
      } else if (this.config.account_name && this.config.account_key) {
        const credential = new StorageSharedKeyCredential(
          this.config.account_name,
          this.config.account_key,
        );
        const url = this.config.endpoint_url || `https://${this.config.account_name}.blob.core.windows.net`;
        serviceClient = new BlobServiceClient(url, credential);
      } else if (this.config.sas_token) {
        const url = this.config.endpoint_url || `https://${this.config.account_name}.blob.core.windows.net`;
        serviceClient = new BlobServiceClient(`${url}?${this.config.sas_token}`);
      } else {
        throw new Error('Azure Blob requires connection_string, or account_name + account_key, or sas_token');
      }

      this._containerClient = serviceClient.getContainerClient(this.containerName);
      return this._containerClient;
    } catch (err) {
      if (err.message.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('Azure Blob SDK not installed. Run: npm install @azure/storage-blob');
      }
      throw err;
    }
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
    const container = await this._getContainerClient();
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    const fullKey = this._fullKey(key);
    const checksum = createHash('sha256').update(buffer).digest('hex');

    const blockBlob = container.getBlockBlobClient(fullKey);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: options.contentType || 'application/octet-stream',
      },
      metadata: { checksum, ...(options.metadata || {}) },
    });

    return { storageKey: key, size: buffer.length, checksum };
  }

  async download(key) {
    const container = await this._getContainerClient();
    const blob = container.getBlockBlobClient(this._fullKey(key));
    const downloadResponse = await blob.download(0);

    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      contentType: downloadResponse.contentType || 'application/octet-stream',
      size: downloadResponse.contentLength || buffer.length,
    };
  }

  async getUrl(key, expiresIn = 3600) {
    const container = await this._getContainerClient();
    const blob = container.getBlockBlobClient(this._fullKey(key));

    try {
      const { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } =
        await import('@azure/storage-blob');

      if (this.config.account_name && this.config.account_key) {
        const credential = new StorageSharedKeyCredential(
          this.config.account_name,
          this.config.account_key,
        );
        const sasToken = generateBlobSASQueryParameters({
          containerName: this.containerName,
          blobName: this._fullKey(key),
          permissions: BlobSASPermissions.parse('r'),
          expiresOn: new Date(Date.now() + expiresIn * 1000),
        }, credential).toString();

        return `${blob.url}?${sasToken}`;
      }
    } catch {
      // Fall through to direct URL
    }

    return blob.url;
  }

  async delete(key) {
    const container = await this._getContainerClient();
    const blob = container.getBlockBlobClient(this._fullKey(key));
    await blob.deleteIfExists();
  }

  async exists(key) {
    const container = await this._getContainerClient();
    const blob = container.getBlockBlobClient(this._fullKey(key));
    return blob.exists();
  }

  async copy(sourceKey, destKey) {
    const container = await this._getContainerClient();
    const sourceBlob = container.getBlockBlobClient(this._fullKey(sourceKey));
    const destBlob = container.getBlockBlobClient(this._fullKey(destKey));

    const poller = await destBlob.beginCopyFromURL(sourceBlob.url);
    await poller.pollUntilDone();
  }

  async list(prefix = '', options = {}) {
    const container = await this._getContainerClient();
    const fullPrefix = this._fullKey(prefix);
    const maxKeys = options.maxKeys || 1000;

    const files = [];
    const folders = [];
    let count = 0;

    const iter = container.listBlobsByHierarchy('/', { prefix: fullPrefix });

    for await (const item of iter) {
      if (count >= maxKeys) break;

      if (item.kind === 'prefix') {
        folders.push(this._stripBase(item.name));
      } else {
        if (item.name === fullPrefix) continue;
        files.push({
          key: this._stripBase(item.name),
          name: item.name.split('/').filter(Boolean).pop(),
          size: item.properties?.contentLength || 0,
          lastModified: item.properties?.lastModified?.toISOString() || null,
          contentType: item.properties?.contentType || null,
        });
      }
      count++;
    }

    return { files, folders, isTruncated: false };
  }

  async createFolder(folderKey) {
    const container = await this._getContainerClient();
    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    const blob = container.getBlockBlobClient(this._fullKey(key));
    await blob.uploadData(Buffer.alloc(0), {
      blobHTTPHeaders: { blobContentType: 'application/x-directory' },
    });
  }

  async deleteFolder(folderKey) {
    const container = await this._getContainerClient();
    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    const fullPrefix = this._fullKey(key);
    let deletedCount = 0;

    for await (const blob of container.listBlobsFlat({ prefix: fullPrefix })) {
      await container.getBlockBlobClient(blob.name).deleteIfExists();
      deletedCount++;
    }

    return { deletedCount };
  }

  async getMetadata(key) {
    const container = await this._getContainerClient();
    const blob = container.getBlockBlobClient(this._fullKey(key));
    const props = await blob.getProperties();

    return {
      key,
      name: key.split('/').filter(Boolean).pop(),
      size: props.contentLength || 0,
      lastModified: props.lastModified?.toISOString() || null,
      contentType: props.contentType || 'application/octet-stream',
      metadata: props.metadata || {},
    };
  }

  async testConnection() {
    try {
      const container = await this._getContainerClient();
      const exists = await container.exists();
      if (!exists) {
        return { ok: false, message: `Container "${this.containerName}" does not exist` };
      }
      return { ok: true, message: `Connected to Azure container: ${this.containerName}` };
    } catch (err) {
      return { ok: false, message: `Azure connection failed: ${err.message}` };
    }
  }

  async getUsage(prefix = '') {
    try {
      const container = await this._getContainerClient();
      const fullPrefix = this._fullKey(prefix);
      let fileCount = 0;
      let totalSizeBytes = 0;

      for await (const blob of container.listBlobsFlat({ prefix: fullPrefix })) {
        fileCount++;
        totalSizeBytes += blob.properties?.contentLength || 0;
      }

      return { fileCount, totalSizeBytes };
    } catch (err) {
      return { fileCount: 0, totalSizeBytes: 0 };
    }
  }
}
