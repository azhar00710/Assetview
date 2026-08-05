import { promises as fs } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { createHash } from 'crypto';
import { lookup as mimeLookup } from 'mime-types';
import StorageProvider from './StorageProvider.js';

/**
 * Local filesystem storage provider.
 * Files are stored on a local disk or network-mounted share.
 * URLs are constructed from a configurable serve URL base.
 */
export default class LocalStorageProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.basePath = config.base_path || config.basePath || '/tmp/assetview-storage';
    this.serveUrl = config.endpoint_url || config.serveUrl || '';
  }

  _fullPath(key) {
    return join(this.basePath, key);
  }

  async upload(file, key, options = {}) {
    const fullPath = this._fullPath(key);
    await fs.mkdir(dirname(fullPath), { recursive: true });

    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    await fs.writeFile(fullPath, buffer);

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const stat = await fs.stat(fullPath);

    return {
      storageKey: key,
      size: stat.size,
      checksum,
    };
  }

  async download(key) {
    const fullPath = this._fullPath(key);
    const buffer = await fs.readFile(fullPath);
    const stat = await fs.stat(fullPath);
    const contentType = mimeLookup(key) || 'application/octet-stream';
    return { buffer, contentType, size: stat.size };
  }

  async getUrl(key, _expiresIn = 3600) {
    if (this.serveUrl) {
      return `${this.serveUrl.replace(/\/+$/, '')}/${key}`;
    }
    return `/api/v1/storage/files/${encodeURIComponent(key)}`;
  }

  async delete(key) {
    const fullPath = this._fullPath(key);
    try {
      await fs.unlink(fullPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(key) {
    try {
      await fs.access(this._fullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async copy(sourceKey, destKey) {
    const srcPath = this._fullPath(sourceKey);
    const dstPath = this._fullPath(destKey);
    await fs.mkdir(dirname(dstPath), { recursive: true });
    await fs.copyFile(srcPath, dstPath);
  }

  async list(prefix = '', options = {}) {
    const dir = prefix ? this._fullPath(prefix) : this.basePath;
    const files = [];
    const folders = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // skip hidden files
        const entryKey = prefix ? `${prefix.replace(/\/+$/, '')}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          folders.push(entryKey + '/');
        } else {
          const stat = await fs.stat(join(dir, entry.name));
          files.push({
            key: entryKey,
            name: entry.name,
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            contentType: mimeLookup(entry.name) || 'application/octet-stream',
          });
        }
      }
    } catch (err) {
      if (err.code === 'ENOENT') return { files: [], folders: [], isTruncated: false };
      throw err;
    }

    return { files, folders, isTruncated: false };
  }

  async createFolder(folderKey) {
    const dir = this._fullPath(folderKey.replace(/\/+$/, ''));
    await fs.mkdir(dir, { recursive: true });
  }

  async deleteFolder(folderKey) {
    const dir = this._fullPath(folderKey.replace(/\/+$/, ''));
    let deletedCount = 0;
    try {
      await this._walkDir(dir, () => { deletedCount++; });
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (err.code === 'ENOENT') return { deletedCount: 0 };
      throw err;
    }
    return { deletedCount };
  }

  async getMetadata(key) {
    const fullPath = this._fullPath(key);
    const stat = await fs.stat(fullPath);
    return {
      key,
      name: basename(key),
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
      contentType: mimeLookup(key) || 'application/octet-stream',
      metadata: {},
    };
  }

  async testConnection() {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      const testKey = '.assetview-test-' + Date.now();
      const testPath = this._fullPath(testKey);
      await fs.writeFile(testPath, 'test');
      await fs.readFile(testPath);
      await fs.unlink(testPath);
      return { ok: true, message: `Local storage accessible at ${this.basePath}` };
    } catch (err) {
      return { ok: false, message: `Local storage error: ${err.message}` };
    }
  }

  async getUsage(prefix = '') {
    const dir = prefix ? this._fullPath(prefix) : this.basePath;
    let fileCount = 0;
    let totalSizeBytes = 0;

    try {
      await this._walkDir(dir, (filePath, stat) => {
        fileCount++;
        totalSizeBytes += stat.size;
      });
    } catch (err) {
      if (err.code === 'ENOENT') return { fileCount: 0, totalSizeBytes: 0 };
      throw err;
    }

    return { fileCount, totalSizeBytes };
  }

  async _walkDir(dir, callback) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this._walkDir(fullPath, callback);
      } else {
        const stat = await fs.stat(fullPath);
        callback(fullPath, stat);
      }
    }
  }
}
