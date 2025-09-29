const fs = require('fs');
const path = require('path');
const express = require('express');
const { ServiceBusClient } = require('@azure/service-bus');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

const DATA_DIRECTORY = path.join(__dirname, 'data');
const DATABASE_FILE = path.join(DATA_DIRECTORY, 'bvbs-service-bus.sqlite');

const SERVICE_BUS_MAX_MESSAGES = 50;
const SERVICE_BUS_MIN_TIMEOUT = 5;
const SERVICE_BUS_MAX_TIMEOUT = 60;
const SERVICE_BUS_DEFAULT_TIMEOUT = 10;

if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
}

const database = new sqlite3.Database(DATABASE_FILE, error => {
    if (error) {
        console.error('Failed to open SQLite database', error);
    }
});

const databaseInitPromise = new Promise((resolve, reject) => {
    database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS service_bus_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT NOT NULL,
            subscription TEXT NOT NULL,
            message_id TEXT,
            sequence_number INTEGER,
            raw_body TEXT,
            content_type TEXT,
            broker_properties_json TEXT,
            application_properties_json TEXT,
            annotations_json TEXT,
            received_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_service_bus_messages_topic_subscription
            ON service_bus_messages (topic, subscription, received_at);
        CREATE INDEX IF NOT EXISTS idx_service_bus_messages_message_id
            ON service_bus_messages (message_id);
    `, error => {
        if (error) {
            reject(error);
            return;
        }
        resolve();
    });
});

databaseInitPromise.catch(error => {
    console.error('Failed to initialize SQLite database', error);
});

function safeJsonStringify(value) {
    if (value === undefined) {
        return null;
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        console.warn('Failed to stringify value for persistence', error);
        return null;
    }
}

function coerceRawBody(value) {
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString('utf8');
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('utf8');
    }
    return String(value);
}

function runDatabaseCommand(sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function (error) {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function persistServiceBusMessages(messages, context = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return;
    }

    await databaseInitPromise;

    const insertSql = `
        INSERT INTO service_bus_messages (
            topic,
            subscription,
            message_id,
            sequence_number,
            raw_body,
            content_type,
            broker_properties_json,
            application_properties_json,
            annotations_json,
            received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const topic = typeof context.topic === 'string' ? context.topic : '';
    const subscription = typeof context.subscription === 'string' ? context.subscription : '';

    await runDatabaseCommand('BEGIN TRANSACTION');

    try {
        for (const message of messages) {
            const brokerProperties = message?.brokerProperties || {};
            const sequenceNumber = brokerProperties?.SequenceNumber;
            const recordedAt = new Date().toISOString();

            await runDatabaseCommand(insertSql, [
                topic,
                subscription,
                brokerProperties?.MessageId || null,
                Number.isFinite(sequenceNumber) ? sequenceNumber : null,
                coerceRawBody(message?.rawBody),
                message?.contentType || null,
                safeJsonStringify(message?.brokerProperties),
                safeJsonStringify(message?.applicationProperties),
                safeJsonStringify(message?.annotations),
                recordedAt
            ]);
        }

        await runDatabaseCommand('COMMIT');
    } catch (error) {
        await runDatabaseCommand('ROLLBACK').catch(rollbackError => {
            console.error('Failed to rollback SQLite transaction', rollbackError);
        });
        throw error;
    }
}

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

        await persistServiceBusMessages(payload, { topic, subscription });

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

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

function closeDatabaseConnection(callback) {
    database.close(error => {
        if (error) {
            console.error('Failed to close SQLite database', error);
        }
        if (typeof callback === 'function') {
            callback();
        }
    });
}

let isShuttingDown = false;

function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    console.log(`Received ${signal}. Shutting down gracefully…`);
    server.close(() => {
        closeDatabaseConnection(() => {
            process.exit(0);
        });
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
