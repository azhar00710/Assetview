/**
 * Central Hub Outbox Worker Contract
 *
 * This worker is intentionally dependency-light for now.
 * It defines the polling and delivery flow that can later be wired to
 * Kafka, RabbitMQ, SQS/SNS, or webhook fan-out.
 */
import { createMessageBusPublisher, createWebhookPublisher } from './centralHubPublishers.js';

const DEFAULT_BATCH_SIZE = 100;

export async function fetchPendingOutboxEvents({ prisma, batchSize = DEFAULT_BATCH_SIZE }) {
  if (!prisma) {
    throw new Error('fetchPendingOutboxEvents requires prisma');
  }

  // Placeholder contract query; table arrives with central hub migration.
  return prisma.$queryRawUnsafe(
    `
      SELECT id, event_type, event_key, payload, headers
      FROM cp_event_outbox
      WHERE published_at IS NULL
      ORDER BY created_at ASC
      LIMIT $1
    `,
    batchSize
  );
}

export async function publishEvent(eventRecord, publisher) {
  if (!publisher || typeof publisher.publish !== 'function') {
    throw new Error('publishEvent requires a publisher with publish(eventRecord)');
  }
  await publisher.publish(eventRecord);
}

async function fetchActiveSubscriptions({ prisma, eventType, eventKey }) {
  return prisma.$queryRawUnsafe(
    `
      SELECT id, tenant_id, event_types, delivery
      FROM ceh_event_subscription
      WHERE active = true
        AND (event_types ? $1 OR event_types ? '*')
        AND ($2::text IS NULL OR tenant_id::text = $2::text)
      ORDER BY created_at ASC
    `,
    eventType,
    eventKey || null
  );
}

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function publishEventToSubscriptions({
  prisma,
  eventRecord,
  webhookPublisher,
  messageBusPublisher,
}) {
  const subscriptions = await fetchActiveSubscriptions({
    prisma,
    eventType: eventRecord.event_type,
    eventKey: eventRecord.event_key,
  });

  for (const subscription of subscriptions) {
    const delivery = parseJsonField(subscription.delivery, {});
    const mode = String(delivery.mode || '').toUpperCase();

    if (mode === 'WEBHOOK') {
      await webhookPublisher.publish(eventRecord, delivery);
      continue;
    }

    if (mode === 'MESSAGE_BUS') {
      await messageBusPublisher.publish(eventRecord, delivery);
    }
  }
}

export async function markOutboxEventPublished({ prisma, eventId }) {
  if (!prisma) {
    throw new Error('markOutboxEventPublished requires prisma');
  }
  await prisma.$queryRawUnsafe(
    `
      UPDATE cp_event_outbox
      SET published_at = now(), failed_attempts = 0, next_attempt_at = NULL
      WHERE id = $1
    `,
    eventId
  );
}

export async function markOutboxEventFailed({ prisma, eventId, retryDelaySeconds = 30 }) {
  if (!prisma) {
    throw new Error('markOutboxEventFailed requires prisma');
  }
  await prisma.$queryRawUnsafe(
    `
      UPDATE cp_event_outbox
      SET failed_attempts = failed_attempts + 1,
          next_attempt_at = now() + ($2::text || ' seconds')::interval
      WHERE id = $1
    `,
    eventId,
    String(retryDelaySeconds)
  );
}

export async function processOutboxBatch({
  prisma,
  publisher = null,
  webhookPublisher = createWebhookPublisher(),
  messageBusPublisher = createMessageBusPublisher(),
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  const events = await fetchPendingOutboxEvents({ prisma, batchSize });
  const summary = { total: events.length, published: 0, failed: 0 };

  for (const eventRecord of events) {
    try {
      if (publisher) {
        await publishEvent(eventRecord, publisher);
      } else {
        await publishEventToSubscriptions({
          prisma,
          eventRecord,
          webhookPublisher,
          messageBusPublisher,
        });
      }
      await markOutboxEventPublished({ prisma, eventId: eventRecord.id });
      summary.published += 1;
    } catch (err) {
      await markOutboxEventFailed({ prisma, eventId: eventRecord.id });
      summary.failed += 1;
    }
  }

  return summary;
}
