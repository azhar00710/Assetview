import { createHash } from 'crypto';
import StorageProvider from './StorageProvider.js';

/**
 * AWS S3 / S3-compatible (MinIO, DigitalOcean Spaces) storage provider.
 * Uses the AWS SDK v3 for S3 operations.
 */
export default class S3StorageProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.bucket = config.bucket_or_container || config.bucket;
    this.region = config.region || 'us-east-1';
    this.endpoint = config.endpoint_url || undefined;
    this.basePath = config.base_path || '';
    this._client = null;
  }

  async _getClient() {
    if (this._client) return this._client;

    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const clientConfig = { region: this.region };

      if (this.endpoint) {
        clientConfig.endpoint = this.endpoint;
        clientConfig.forcePathStyle = true; // Required for MinIO / DO Spaces
      }

      if (this.config.access_key) {
        clientConfig.credentials = {
          accessKeyId: this.config.access_key,
          secretAccessKey: this.config.secret_key,
        };
      }

      this._client = new S3Client(clientConfig);
      return this._client;
    } catch (err) {
      throw new Error(
        `AWS SDK not installed. Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner. Error: ${err.message}`
      );
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
    const client = await this._getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
    const fullKey = this._fullKey(key);
    const checksum = createHash('sha256').update(buffer).digest('hex');

    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: fullKey,
      Body: buffer,
      ContentType: options.contentType || 'application/octet-stream',
      Metadata: { checksum, ...(options.metadata || {}) },
    }));

    return {
      storageKey: key,
      size: buffer.length,
      checksum,
    };
  }

  async download(key) {
    const client = await this._getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    const res = await client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
    }));

    const chunks = [];
    for await (const chunk of res.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      contentType: res.ContentType || 'application/octet-stream',
      size: res.ContentLength || buffer.length,
    };
  }

  async getUrl(key, expiresIn = 3600) {
    const client = await this._getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const url = await getSignedUrl(client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
    }), { expiresIn });

    return url;
  }

  async getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    const client = await this._getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const url = await getSignedUrl(client, new PutObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
      ContentType: contentType,
    }), { expiresIn });

    return { url };
  }

  async delete(key) {
    const client = await this._getClient();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

    await client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
    }));
  }

  async exists(key) {
    const client = await this._getClient();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      await client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this._fullKey(key),
      }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async download(key) {
    const client = await this._getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const response = await client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
    }));
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async copy(sourceKey, destKey) {
    const client = await this._getClient();
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');

    await client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${this._fullKey(sourceKey)}`,
      Key: this._fullKey(destKey),
    }));
  }

  async list(prefix = '', options = {}) {
    const client = await this._getClient();
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

    const maxKeys = options.maxKeys || 1000;
    const delimiter = options.delimiter !== undefined ? options.delimiter : '/';
    const fullPrefix = this._fullKey(prefix);

    const res = await client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: fullPrefix,
      Delimiter: delimiter,
      MaxKeys: maxKeys,
      ContinuationToken: options.continuationToken || undefined,
    }));

    const files = (res.Contents || [])
      .filter(obj => obj.Key !== fullPrefix) // exclude the prefix itself
      .map(obj => ({
        key: this._stripBase(obj.Key),
        name: obj.Key.split('/').filter(Boolean).pop(),
        size: obj.Size || 0,
        lastModified: obj.LastModified?.toISOString() || null,
        contentType: null, // S3 ListObjects doesn't return content type
      }));

    const folders = (res.CommonPrefixes || []).map(cp => this._stripBase(cp.Prefix));

    return {
      files,
      folders,
      isTruncated: res.IsTruncated || false,
      nextToken: res.NextContinuationToken || undefined,
    };
  }

  async createFolder(folderKey) {
    const client = await this._getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
      Body: '',
      ContentType: 'application/x-directory',
    }));
  }

  async deleteFolder(folderKey) {
    const client = await this._getClient();
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

    const key = folderKey.endsWith('/') ? folderKey : folderKey + '/';
    const fullPrefix = this._fullKey(key);
    let deletedCount = 0;
    let continuationToken;

    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));

      const objects = (res.Contents || []).map(obj => ({ Key: obj.Key }));
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: objects },
        }));
        deletedCount += objects.length;
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return { deletedCount };
  }

  async getMetadata(key) {
    const client = await this._getClient();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    const res = await client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: this._fullKey(key),
    }));

    return {
      key,
      name: key.split('/').filter(Boolean).pop(),
      size: res.ContentLength || 0,
      lastModified: res.LastModified?.toISOString() || null,
      contentType: res.ContentType || 'application/octet-stream',
      metadata: res.Metadata || {},
    };
  }

  async testConnection() {
    try {
      const client = await this._getClient();
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');

      await client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, message: `Connected to S3 bucket: ${this.bucket}` };
    } catch (err) {
      return { ok: false, message: `S3 connection failed: ${err.message}` };
    }
  }

  async getUsage(prefix = '') {
    try {
      const client = await this._getClient();
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

      let fileCount = 0;
      let totalSizeBytes = 0;
      let continuationToken;
      const fullPrefix = this._fullKey(prefix);

      do {
        const res = await client.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix,
          ContinuationToken: continuationToken,
        }));

        for (const obj of (res.Contents || [])) {
          fileCount++;
          totalSizeBytes += obj.Size || 0;
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);

      return { fileCount, totalSizeBytes };
    } catch (err) {
      return { fileCount: 0, totalSizeBytes: 0 };
    }
  }
}
