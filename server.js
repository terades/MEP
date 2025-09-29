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
const SERVICE_BUS_HISTORY_MAX_LIMIT = 200;

if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
}

const database = new sqlite3.Database(DATABASE_FILE, error => {
    if (error) {
        console.error('Failed to open SQLite database', error);
    }
});

const ADDITIONAL_SERVICE_BUS_COLUMNS = [
    { name: 'raw_body_preview', type: 'TEXT' },
    { name: 'body_json', type: 'TEXT' },
    { name: 'message_subject', type: 'TEXT' },
    { name: 'correlation_id', type: 'TEXT' },
    { name: 'reply_to', type: 'TEXT' },
    { name: 'session_id', type: 'TEXT' },
    { name: 'enqueued_time_utc', type: 'TEXT' },
    { name: 'locked_until_utc', type: 'TEXT' },
    { name: 'expires_at_utc', type: 'TEXT' },
    { name: 'dead_letter_source', type: 'TEXT' },
    { name: 'delivery_count', type: 'INTEGER' },
    { name: 'partition_key', type: 'TEXT' },
    { name: 'via_partition_key', type: 'TEXT' },
    { name: 'context_json', type: 'TEXT' }
];

const databaseInitPromise = new Promise((resolve, reject) => {
    database.serialize(() => {
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
            database.all("PRAGMA table_info('service_bus_messages')", (pragmaError, columns) => {
                if (pragmaError) {
                    reject(pragmaError);
                    return;
                }
                const existingColumns = new Set(columns.map(column => column.name));
                const pendingColumns = ADDITIONAL_SERVICE_BUS_COLUMNS.filter(column => !existingColumns.has(column.name));
                if (pendingColumns.length === 0) {
                    resolve();
                    return;
                }

                const addColumnAtIndex = index => {
                    if (index >= pendingColumns.length) {
                        resolve();
                        return;
                    }
                    const column = pendingColumns[index];
                    database.run(
                        `ALTER TABLE service_bus_messages ADD COLUMN ${column.name} ${column.type}`,
                        alterError => {
                            if (alterError) {
                                console.error(`Failed to add column ${column.name}`, alterError);
                            }
                            addColumnAtIndex(index + 1);
                        }
                    );
                };

                addColumnAtIndex(0);
            });
        });
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

function runDatabaseQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
            } else {
                resolve(rows);
            }
        });
    });
}

function getDatabaseValue(sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
            } else {
                resolve(row);
            }
        });
    });
}

function safeJsonParse(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function tryExtractJson(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return null;
        }
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.stringify(JSON.parse(trimmed));
    } catch (error) {
        return null;
    }
}

function buildRawBodyPreview(rawBody) {
    if (typeof rawBody !== 'string') {
        return null;
    }
    const trimmed = rawBody.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.length <= 240) {
        return trimmed;
    }
    return `${trimmed.slice(0, 237)}…`;
}

function extractBodyJsonString(message) {
    if (!message) {
        return null;
    }
    if (message.body && typeof message.body === 'object' && !Buffer.isBuffer(message.body) && !(message.body instanceof Uint8Array)) {
        return tryExtractJson(message.body);
    }
    return tryExtractJson(message.rawBody);
}

function coerceNullableInteger(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : null;
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
            received_at,
            raw_body_preview,
            body_json,
            message_subject,
            correlation_id,
            reply_to,
            session_id,
            enqueued_time_utc,
            locked_until_utc,
            expires_at_utc,
            dead_letter_source,
            delivery_count,
            partition_key,
            via_partition_key,
            context_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const topic = typeof context.topic === 'string' ? context.topic : '';
    const subscription = typeof context.subscription === 'string' ? context.subscription : '';

    await runDatabaseCommand('BEGIN TRANSACTION');

    try {
        for (const message of messages) {
            const brokerProperties = message?.brokerProperties || {};
            const sequenceNumber = brokerProperties?.SequenceNumber;
            const recordedAt = new Date().toISOString();
            const rawBody = coerceRawBody(message?.rawBody ?? message?.body);
            const rawBodyPreview = buildRawBodyPreview(rawBody);
            const bodyJson = extractBodyJsonString(message);
            const messageSubject = typeof brokerProperties?.Subject === 'string'
                ? brokerProperties.Subject
                : (typeof brokerProperties?.Label === 'string' ? brokerProperties.Label : null);
            const correlationId = typeof brokerProperties?.CorrelationId === 'string'
                ? brokerProperties.CorrelationId
                : null;
            const replyTo = typeof brokerProperties?.ReplyTo === 'string'
                ? brokerProperties.ReplyTo
                : null;
            const sessionId = typeof brokerProperties?.SessionId === 'string'
                ? brokerProperties.SessionId
                : null;
            const enqueuedTimeUtc = typeof brokerProperties?.EnqueuedTimeUtc === 'string'
                ? brokerProperties.EnqueuedTimeUtc
                : null;
            const lockedUntilUtc = typeof brokerProperties?.LockedUntilUtc === 'string'
                ? brokerProperties.LockedUntilUtc
                : null;
            const expiresAtUtc = typeof brokerProperties?.ExpiresAtUtc === 'string'
                ? brokerProperties.ExpiresAtUtc
                : null;
            const deadLetterSource = typeof brokerProperties?.DeadLetterSource === 'string'
                ? brokerProperties.DeadLetterSource
                : null;
            const deliveryCount = Number.isFinite(brokerProperties?.DeliveryCount)
                ? brokerProperties.DeliveryCount
                : null;
            const partitionKey = typeof brokerProperties?.PartitionKey === 'string'
                ? brokerProperties.PartitionKey
                : null;
            const viaPartitionKey = typeof brokerProperties?.ViaPartitionKey === 'string'
                ? brokerProperties.ViaPartitionKey
                : null;
            const contextPayload = {
                ...context,
                topic,
                subscription
            };

            await runDatabaseCommand(insertSql, [
                topic,
                subscription,
                brokerProperties?.MessageId || null,
                Number.isFinite(sequenceNumber) ? sequenceNumber : null,
                rawBody,
                message?.contentType || null,
                safeJsonStringify(message?.brokerProperties),
                safeJsonStringify(message?.applicationProperties),
                safeJsonStringify(message?.annotations),
                recordedAt,
                rawBodyPreview,
                bodyJson,
                messageSubject,
                correlationId,
                replyTo,
                sessionId,
                enqueuedTimeUtc,
                lockedUntilUtc,
                expiresAtUtc,
                deadLetterSource,
                deliveryCount,
                partitionKey,
                viaPartitionKey,
                safeJsonStringify(contextPayload)
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

        await persistServiceBusMessages(payload, {
            topic,
            subscription,
            peekOnly,
            maxMessages,
            timeoutSeconds
        });

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

app.get('/api/service-bus/messages/history', async (req, res) => {
    try {
        await databaseInitPromise;

        const limit = Math.max(
            1,
            Math.min(
                SERVICE_BUS_HISTORY_MAX_LIMIT,
                Number.isFinite(Number.parseInt(req.query?.limit, 10))
                    ? Number.parseInt(req.query.limit, 10)
                    : 50
            )
        );
        const offset = Math.max(
            0,
            Number.isFinite(Number.parseInt(req.query?.offset, 10))
                ? Number.parseInt(req.query.offset, 10)
                : 0
        );
        const topic = sanitizeText(req.query?.topic).slice(0, 200);
        const subscription = sanitizeText(req.query?.subscription).slice(0, 200);
        const search = sanitizeText(req.query?.search).slice(0, 200);

        const whereParts = [];
        const params = [];
        if (topic) {
            whereParts.push('topic = ?');
            params.push(topic);
        }
        if (subscription) {
            whereParts.push('subscription = ?');
            params.push(subscription);
        }
        if (search) {
            const pattern = `%${search.toLowerCase()}%`;
            whereParts.push(`(
                LOWER(raw_body) LIKE ?
                OR LOWER(message_id) LIKE ?
                OR LOWER(message_subject) LIKE ?
                OR LOWER(body_json) LIKE ?
                OR LOWER(context_json) LIKE ?
            )`);
            params.push(pattern, pattern, pattern, pattern, pattern);
        }

        const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

        const rows = await runDatabaseQuery(
            `
                SELECT
                    id,
                    topic,
                    subscription,
                    message_id,
                    sequence_number,
                    raw_body,
                    raw_body_preview,
                    body_json,
                    content_type,
                    broker_properties_json,
                    application_properties_json,
                    annotations_json,
                    received_at,
                    message_subject,
                    correlation_id,
                    reply_to,
                    session_id,
                    enqueued_time_utc,
                    locked_until_utc,
                    expires_at_utc,
                    dead_letter_source,
                    delivery_count,
                    partition_key,
                    via_partition_key,
                    context_json
                FROM service_bus_messages
                ${whereClause}
                ORDER BY received_at DESC, id DESC
                LIMIT ? OFFSET ?
            `,
            [...params, limit, offset]
        );

        const totalRow = await getDatabaseValue(
            `SELECT COUNT(*) AS count FROM service_bus_messages ${whereClause}`,
            params
        );
        const total = coerceNullableInteger(totalRow?.count) || 0;

        const messages = rows.map(row => ({
            id: row.id,
            topic: row.topic,
            subscription: row.subscription,
            messageId: row.message_id,
            sequenceNumber: coerceNullableInteger(row.sequence_number),
            rawBody: row.raw_body,
            rawBodyPreview: row.raw_body_preview,
            bodyJson: safeJsonParse(row.body_json),
            bodyJsonText: row.body_json,
            contentType: row.content_type,
            brokerProperties: safeJsonParse(row.broker_properties_json) || {},
            applicationProperties: safeJsonParse(row.application_properties_json) || {},
            annotations: safeJsonParse(row.annotations_json) || {},
            receivedAt: row.received_at,
            messageSubject: row.message_subject,
            correlationId: row.correlation_id,
            replyTo: row.reply_to,
            sessionId: row.session_id,
            enqueuedTimeUtc: row.enqueued_time_utc,
            lockedUntilUtc: row.locked_until_utc,
            expiresAtUtc: row.expires_at_utc,
            deadLetterSource: row.dead_letter_source,
            deliveryCount: coerceNullableInteger(row.delivery_count),
            partitionKey: row.partition_key,
            viaPartitionKey: row.via_partition_key,
            context: safeJsonParse(row.context_json) || {}
        }));

        return res.json({
            messages,
            pagination: {
                limit,
                offset,
                total
            },
            filters: {
                topic,
                subscription,
                search
            }
        });
    } catch (error) {
        console.error('Failed to load stored Service Bus messages', error);
        return res.status(500).json({ error: 'Failed to load stored Service Bus messages.' });
    }
});

app.get('/api/service-bus/messages/topics', async (req, res) => {
    try {
        await databaseInitPromise;
        const rows = await runDatabaseQuery(
            `
                SELECT
                    topic,
                    subscription,
                    COUNT(*) AS message_count
                FROM service_bus_messages
                GROUP BY topic, subscription
                ORDER BY topic COLLATE NOCASE, subscription COLLATE NOCASE
            `
        );

        return res.json({
            topics: rows.map(row => ({
                topic: row.topic,
                subscription: row.subscription,
                messageCount: coerceNullableInteger(row.message_count) || 0
            }))
        });
    } catch (error) {
        console.error('Failed to load Service Bus topics', error);
        return res.status(500).json({ error: 'Failed to load topics.' });
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
