import crypto from 'crypto';
import prisma from '../../db.js';

function hashPayload(payload) {
  const text = JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(text).digest('hex');
}

function conflictError(message) {
  const err = new Error(message);
  err.code = 'IDEMPOTENCY_CONFLICT';
  return err;
}

export function getIdempotencyKey(request) {
  const raw = request.headers?.['idempotency-key'] ?? request.headers?.['Idempotency-Key'] ?? null;
  if (raw == null) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return key;
}

export async function beginIdempotentRequest({ scope, key, payload }) {
  if (!key) return { mode: 'passthrough' };

  if (key.length > 200) {
    throw conflictError('Idempotency-Key must be <= 200 characters');
  }

  const requestHash = hashPayload(payload);

  const existingRows = await prisma.$queryRaw`
    SELECT id, scope, idem_key, request_hash, status, response_code, response_body
    FROM ceh_idempotency_key
    WHERE scope = ${scope} AND idem_key = ${key}
    LIMIT 1
  `;

  const existing = existingRows[0];
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw conflictError('Idempotency key already used with a different payload');
    }
    if (existing.status === 'completed') {
      return {
        mode: 'replay',
        statusCode: existing.response_code || 200,
        responseBody: existing.response_body || {},
      };
    }
    if (existing.status === 'in_progress') {
      throw conflictError('Idempotent request is already in progress');
    }
  } else {
    try {
      await prisma.$queryRaw`
        INSERT INTO ceh_idempotency_key (scope, idem_key, request_hash, status)
        VALUES (${scope}, ${key}, ${requestHash}, 'in_progress')
      `;
    } catch (err) {
      if (!String(err.message || '').toLowerCase().includes('duplicate')) {
        throw err;
      }
      const racedRows = await prisma.$queryRaw`
        SELECT id, request_hash, status, response_code, response_body
        FROM ceh_idempotency_key
        WHERE scope = ${scope} AND idem_key = ${key}
        LIMIT 1
      `;
      const raced = racedRows[0];
      if (!raced) throw err;
      if (raced.request_hash !== requestHash) {
        throw conflictError('Idempotency key already used with a different payload');
      }
      if (raced.status === 'completed') {
        return {
          mode: 'replay',
          statusCode: raced.response_code || 200,
          responseBody: raced.response_body || {},
        };
      }
      throw conflictError('Idempotent request is already in progress');
    }
  }

  return { mode: 'execute', scope, key, requestHash };
}

export async function completeIdempotentRequest({ scope, key, requestHash, statusCode, responseBody }) {
  if (!key) return;
  await prisma.$queryRaw`
    UPDATE ceh_idempotency_key
    SET
      status = 'completed',
      response_code = ${statusCode},
      response_body = ${JSON.stringify(responseBody ?? {})}::jsonb,
      error_message = NULL,
      updated_at = now()
    WHERE scope = ${scope}
      AND idem_key = ${key}
      AND request_hash = ${requestHash}
  `;
}

export async function failIdempotentRequest({ scope, key, requestHash, message }) {
  if (!key) return;
  await prisma.$queryRaw`
    UPDATE ceh_idempotency_key
    SET
      status = 'failed',
      error_message = ${message},
      updated_at = now()
    WHERE scope = ${scope}
      AND idem_key = ${key}
      AND request_hash = ${requestHash}
  `;
}
