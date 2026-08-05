/**
 * Google Cloud Vision API OCR provider.
 * Extracts text with bounding boxes from P&ID images.
 * Uses DOCUMENT_TEXT_DETECTION for best results on engineering drawings.
 *
 * For PDFs: uses asyncBatchAnnotateFiles with GCS input/output (native multi-page support).
 * For raster images: uses synchronous documentTextDetection with inline content.
 */

export default class VisionOCRProvider {
  constructor(credentialsJson) {
    this._client = null;
    this._credentialsJson = credentialsJson;
  }

  async _getClient() {
    if (this._client) return this._client;

    try {
      const vision = await import('@google-cloud/vision');
      const opts = {};

      if (this._credentialsJson) {
        const creds = typeof this._credentialsJson === 'string'
          ? JSON.parse(this._credentialsJson)
          : this._credentialsJson;
        opts.credentials = creds;
        opts.projectId = creds.project_id;
      }

      this._client = new vision.default.ImageAnnotatorClient(opts);
      return this._client;
    } catch (err) {
      if (err.message?.includes('Cannot find module') || err.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'Google Cloud Vision SDK not installed. Run: npm install @google-cloud/vision'
        );
      }
      throw err;
    }
  }

  /**
   * Extract text from an image buffer (raster images only — PNG, JPEG, TIFF).
   * For PDFs, use extractFromPdf() instead.
   * @param {Buffer} imageBuffer - The image file content
   * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number }>}
   */
  async extractFromImage(imageBuffer) {
    // Reject PDFs — they need the async GCS-based flow
    if (this._isPdf(imageBuffer)) {
      throw new Error('PDF files must use extractFromPdf() with GCS URIs for proper multi-page extraction');
    }

    const client = await this._getClient();

    const [result] = await client.documentTextDetection({
      image: { content: imageBuffer },
    });

    return this._parseResponse(result);
  }

  /**
   * Extract text from a GCS URI (single-page images only).
   * @param {string} gcsUri - gs://bucket/path URI
   * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number }>}
   */
  async extractFromGcsUri(gcsUri) {
    const client = await this._getClient();

    const [result] = await client.documentTextDetection(gcsUri);
    return this._parseResponse(result);
  }

  /**
   * Extract text from a PDF on GCS using asyncBatchAnnotateFiles.
   * This is the correct API for multi-page PDFs — preserves original coordinates.
   *
   * @param {string} gcsInputUri - gs://bucket/path/file.pdf
   * @param {string} gcsOutputPrefix - gs://bucket/path/ocr-output/jobId/ (must end with /)
   * @returns {Promise<{ outputUri: string }>} - The GCS prefix where results were written
   */
  async extractFromPdf(gcsInputUri, gcsOutputPrefix) {
    const client = await this._getClient();

    // Ensure output prefix ends with /
    const outputPrefix = gcsOutputPrefix.endsWith('/') ? gcsOutputPrefix : gcsOutputPrefix + '/';

    const request = {
      requests: [{
        inputConfig: {
          gcsSource: { uri: gcsInputUri },
          mimeType: 'application/pdf',
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        outputConfig: {
          gcsDestination: { uri: outputPrefix },
          batchSize: 20, // pages per output JSON shard
        },
      }],
    };

    console.log(`[VisionOCR] Starting async PDF OCR: ${gcsInputUri} → ${outputPrefix}`);

    // Start the async operation
    const [operation] = await client.asyncBatchAnnotateFiles(request);

    // Wait for completion (the SDK polls automatically via operation.promise())
    console.log(`[VisionOCR] Waiting for async operation to complete...`);
    const [response] = await operation.promise();

    const resultUri = response.responses?.[0]?.outputConfig?.gcsDestination?.uri || outputPrefix;
    console.log(`[VisionOCR] PDF OCR complete. Results at: ${resultUri}`);

    return { outputUri: resultUri };
  }

  /**
   * Parse the async batch results from GCS into the standard words array format.
   * The asyncBatchAnnotateFiles API writes JSON shard files like "output-1-to-5.json".
   *
   * @param {import('../storage/GCSStorageProvider.js').default} storageProvider - GCS provider to read results
   * @param {string} gcsOutputPrefix - gs://bucket/path/ where results were written
   * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number }>}
   */
  async parseAsyncResults(storageProvider, gcsOutputPrefix) {
    // Extract the key prefix (relative to bucket+basePath) from the gs:// URI
    const prefix = this._gcsUriToKey(gcsOutputPrefix, storageProvider);

    // List all output JSON files at the prefix
    const listing = await storageProvider.list(prefix, { delimiter: '' });
    const jsonFiles = listing.files.filter(f => f.key.endsWith('.json'));

    if (jsonFiles.length === 0) {
      console.warn(`[VisionOCR] No output JSON files found at prefix: ${prefix}`);
      return { words: [], fullText: '', pageWidth: 0, pageHeight: 0 };
    }

    // Sort files to process pages in order (output-1-to-5.json, output-6-to-10.json, etc.)
    jsonFiles.sort((a, b) => a.key.localeCompare(b.key));

    const allWords = [];
    let fullText = '';
    let maxPageWidth = 0;
    let maxPageHeight = 0;

    for (const file of jsonFiles) {
      console.log(`[VisionOCR] Parsing result shard: ${file.key}`);
      const { buffer } = await storageProvider.download(file.key);
      const data = JSON.parse(buffer.toString('utf-8'));

      // Each shard contains { responses: [{ fullTextAnnotation: {...} }] }
      const responses = data.responses || [];
      for (const resp of responses) {
        const annotation = resp.fullTextAnnotation;
        if (!annotation) continue;

        fullText += (fullText ? '\n' : '') + (annotation.text || '');

        for (const page of (annotation.pages || [])) {
          const pageWidth = page.width || 0;
          const pageHeight = page.height || 0;
          if (pageWidth > maxPageWidth) maxPageWidth = pageWidth;
          if (pageHeight > maxPageHeight) maxPageHeight = pageHeight;

          // page.property?.detectedLanguages can be used for language detection if needed

          for (const block of (page.blocks || [])) {
            for (const paragraph of (block.paragraphs || [])) {
              for (const word of (paragraph.words || [])) {
                const text = (word.symbols || []).map(s => s.text).join('');
                const rawVerts = word.boundingBox?.vertices;
                const normVerts = word.boundingBox?.normalizedVertices;
                const useNormalized = !rawVerts?.length && normVerts?.length > 0;
                const vertices = (rawVerts || normVerts || []).map(v => ({
                  x: useNormalized ? (v.x || 0) * pageWidth : (v.x || 0),
                  y: useNormalized ? (v.y || 0) * pageHeight : (v.y || 0),
                }));

                if (text.trim().length === 0) continue;

                allWords.push({
                  text,
                  confidence: word.confidence || 0,
                  vertices,
                  pageWidth,
                  pageHeight,
                });
              }
            }
          }
        }
      }
    }

    console.log(`[VisionOCR] Parsed ${allWords.length} words from ${jsonFiles.length} shards`);

    // Clean up temporary output files from GCS
    for (const file of jsonFiles) {
      try {
        await storageProvider.delete(file.key);
      } catch (_) { /* best-effort cleanup */ }
    }

    return {
      words: allWords,
      fullText,
      pageWidth: maxPageWidth,
      pageHeight: maxPageHeight,
    };
  }

  /**
   * Check if a buffer starts with the PDF magic bytes.
   */
  _isPdf(buffer) {
    return buffer && buffer.length > 4 && buffer.slice(0, 5).toString() === '%PDF-';
  }

  /**
   * Convert a gs://bucket/path URI to a storage key relative to the provider's basePath.
   * E.g. gs://my-bucket/base/ocr-output/abc/ → ocr-output/abc/
   */
  _gcsUriToKey(gcsUri, storageProvider) {
    // gs://bucket-name/full/path/prefix/
    const withoutScheme = gcsUri.replace('gs://', '');
    const slashIdx = withoutScheme.indexOf('/');
    const fullPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : '';

    // Strip the basePath prefix if present
    const basePath = storageProvider.basePath?.replace(/\/+$/, '');
    if (basePath && fullPath.startsWith(basePath + '/')) {
      return fullPath.slice(basePath.length + 1);
    }
    return fullPath;
  }

  /**
   * Parse a single synchronous Vision API response into structured words with bounding boxes.
   */
  _parseResponse(result) {
    const annotation = result.fullTextAnnotation;
    if (!annotation) {
      return { words: [], fullText: '', pageWidth: 0, pageHeight: 0 };
    }

    const words = [];
    let pageWidth = 0;
    let pageHeight = 0;

    for (const page of annotation.pages) {
      pageWidth = page.width || 0;
      pageHeight = page.height || 0;

      for (const block of page.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const word of paragraph.words) {
            const text = word.symbols.map(s => s.text).join('');
            const vertices = (word.boundingBox?.vertices || []).map(v => ({
              x: v.x || 0,
              y: v.y || 0,
            }));

            // Skip very short or empty words
            if (text.trim().length === 0) continue;

            words.push({
              text,
              confidence: word.confidence || 0,
              vertices,
              pageWidth,
              pageHeight,
            });
          }
        }
      }
    }

    return {
      words,
      fullText: annotation.text || '',
      pageWidth,
      pageHeight,
    };
  }
}
