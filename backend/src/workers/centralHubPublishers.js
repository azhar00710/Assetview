import crypto from 'crypto';

function safeJsonParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createWebhookPublisher({
  timeoutMs = 10000,
  signingSecret = process.env.CENTRAL_HUB_WEBHOOK_SIGNING_SECRET || '',
} = {}) {
  return {
    async publish(eventRecord, delivery = {}) {
      const webhookUrl = delivery.webhook_url || delivery.url;
      if (!webhookUrl) throw new Error('webhook_url is required for WEBHOOK delivery mode');

      const payload = {
        id: eventRecord.id,
        eventType: eventRecord.event_type,
        eventKey: eventRecord.event_key,
        payload: safeJsonParse(eventRecord.payload, {}),
        headers: safeJsonParse(eventRecord.headers, {}),
      };
      const body = JSON.stringify(payload);
      const signature = signingSecret
        ? crypto.createHmac('sha256', signingSecret).update(body).digest('hex')
        : '';

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CentralHub-Event': eventRecord.event_type,
          'X-CentralHub-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
      }
    },
  };
}

export function createMessageBusPublisher(adapter = null) {
  if (!adapter || typeof adapter.publish !== 'function') {
    return {
      async publish(_eventRecord, delivery = {}) {
        const topic = delivery.topic || delivery.channel;
        if (!topic) throw new Error('topic is required for MESSAGE_BUS delivery mode');
        // No-op fallback: allows wiring later while keeping worker functional.
      },
    };
  }

  return {
    async publish(eventRecord, delivery = {}) {
      const topic = delivery.topic || delivery.channel;
      if (!topic) throw new Error('topic is required for MESSAGE_BUS delivery mode');
      await adapter.publish({
        topic,
        key: eventRecord.event_key || null,
        eventType: eventRecord.event_type,
        payload: safeJsonParse(eventRecord.payload, {}),
        headers: safeJsonParse(eventRecord.headers, {}),
      });
    },
  };
}
