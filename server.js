const path = require('path');
const express = require('express');
const { ServiceBusClient } = require('@azure/service-bus');

const app = express();
const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

const SERVICE_BUS_MAX_MESSAGES = 50;
const SERVICE_BUS_MIN_TIMEOUT = 5;
const SERVICE_BUS_MAX_TIMEOUT = 60;
const SERVICE_BUS_DEFAULT_TIMEOUT = 10;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(STATIC_DIR, { extensions: ['html'] }));

function sanitizeText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim();
}

function coerceTimeoutSeconds(value) {
    const numeric = Number.parseInt(value, 10);
    const bounded = Number.isFinite(numeric) ? numeric : SERVICE_BUS_DEFAULT_TIMEOUT;
    return Math.max(
        SERVICE_BUS_MIN_TIMEOUT,
        Math.min(SERVICE_BUS_MAX_TIMEOUT, bounded)
    );
}

function coerceMessageCount(value) {
    const numeric = Number.parseInt(value, 10);
    const fallback = Number.isFinite(numeric) ? numeric : 1;
    return Math.max(1, Math.min(SERVICE_BUS_MAX_MESSAGES, fallback));
}

function decodeMessageBody(body) {
    if (body === undefined || body === null) {
        return '';
    }
    if (typeof body === 'string') {
        return body;
    }
    if (Buffer.isBuffer(body)) {
        return body.toString('utf8');
    }
    if (body instanceof Uint8Array) {
        return Buffer.from(body).toString('utf8');
    }
    try {
        return JSON.stringify(body);
    } catch (error) {
        return String(body);
    }
}

function toIsoString(date) {
    if (!date) {
        return undefined;
    }
    try {
        return new Date(date).toISOString();
    } catch (error) {
        return undefined;
    }
}

function buildBrokerProperties(message) {
    return {
        MessageId: message.messageId || undefined,
        CorrelationId: message.correlationId || undefined,
        SequenceNumber: message.sequenceNumber,
        EnqueuedSequenceNumber: message.enqueuedSequenceNumber,
        EnqueuedTimeUtc: toIsoString(message.enqueuedTimeUtc),
        LockedUntilUtc: toIsoString(message.lockedUntilUtc),
        ExpiresAtUtc: toIsoString(message.expiresAtUtc),
        DeadLetterSource: message.deadLetterSource || undefined,
        DeliveryCount: message.deliveryCount,
        LockToken: message.lockToken || undefined,
        PartitionKey: message.partitionKey || undefined,
        ViaPartitionKey: message.viaPartitionKey || undefined,
        SessionId: message.sessionId || undefined,
        ReplyToSessionId: message.replyToSessionId || undefined,
        ReplyTo: message.replyTo || undefined,
        To: message.to || undefined,
        Subject: message.subject || undefined,
        Label: message.subject || undefined
    };
}

function buildProxyResponse(messages) {
    return messages.map(message => {
        const rawBody = decodeMessageBody(message.body);
        return {
            body: message.body,
            rawBody,
            contentType: message.contentType || '',
            brokerProperties: buildBrokerProperties(message),
            applicationProperties: message.applicationProperties || {},
            annotations: message.annotations || {}
        };
    });
}

app.post('/api/service-bus/messages', async (req, res) => {
    const connectionString = sanitizeText(req.body?.connectionString);
    const topic = sanitizeText(req.body?.topic);
    const subscription = sanitizeText(req.body?.subscription);
    const peekOnly = req.body?.peekOnly !== false;
    const maxMessages = coerceMessageCount(req.body?.maxMessages);
    const timeoutSeconds = coerceTimeoutSeconds(req.body?.timeoutSeconds);

    if (!connectionString) {
        return res.status(400).json({ error: 'Connection string is required.' });
    }
    if (!topic || !subscription) {
        return res.status(400).json({ error: 'Topic and subscription are required.' });
    }

    let client;
    let receiver;

    try {
        client = new ServiceBusClient(connectionString);
        receiver = client.createReceiver(topic, subscription);

        let receivedMessages = [];
        if (peekOnly) {
            receivedMessages = await receiver.peekMessages(maxMessages);
        } else {
            receivedMessages = await receiver.receiveMessages(maxMessages, {
                maxWaitTimeInMs: timeoutSeconds * 1000
            });
        }

        const payload = buildProxyResponse(receivedMessages);

        if (!peekOnly && receivedMessages.length) {
            await Promise.all(
                receivedMessages.map(message => receiver.completeMessage(message).catch(() => null))
            );
        }

        return res.json({ messages: payload });
    } catch (error) {
        console.error('Service Bus proxy request failed:', error);
        let statusCode = 500;
        if (error?.code === 'UnauthorizedError') {
            statusCode = 401;
        } else if (error?.code === 'MessagingEntityNotFoundError') {
            statusCode = 404;
        } else if (error?.name === 'TypeError' || error?.code === 'ArgumentError') {
            statusCode = 400;
        } else if (error?.code === 'ServiceBusError' && error?.retryable === false) {
            statusCode = 400;
        }

        return res.status(statusCode).json({
            error: error?.message || 'Failed to fetch Service Bus messages.'
        });
    } finally {
        if (receiver) {
            try {
                await receiver.close();
            } catch (closeError) {
                console.warn('Failed to close Service Bus receiver', closeError);
            }
        }
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.warn('Failed to close Service Bus client', closeError);
            }
        }
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
