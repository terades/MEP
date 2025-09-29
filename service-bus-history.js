(function () {
    const viewElement = document.getElementById('serviceBusHistoryView');
    const noop = () => {};

    if (!viewElement) {
        window.serviceBusHistory = {
            onShow: noop,
            refresh: noop
        };
        return;
    }

    const elements = {
        view: viewElement,
        topicSelect: document.getElementById('serviceBusHistoryTopicSelect'),
        subscriptionSelect: document.getElementById('serviceBusHistorySubscriptionSelect'),
        searchInput: document.getElementById('serviceBusHistorySearchInput'),
        pageSizeSelect: document.getElementById('serviceBusHistoryPageSizeSelect'),
        refreshButton: document.getElementById('serviceBusHistoryRefreshBtn'),
        status: document.getElementById('serviceBusHistoryStatus'),
        tableBody: document.getElementById('serviceBusHistoryTableBody'),
        paginationInfo: document.getElementById('serviceBusHistoryPaginationInfo'),
        prevButton: document.getElementById('serviceBusHistoryPrevBtn'),
        nextButton: document.getElementById('serviceBusHistoryNextBtn')
    };

    const state = {
        initialized: false,
        topicsLoaded: false,
        topicsMap: new Map(),
        limit: 25,
        offset: 0,
        total: 0,
        topic: '',
        subscription: '',
        search: '',
        isLoading: false
    };

    let historyRequestToken = 0;
    let topicsRequestToken = 0;
    let searchDebounceHandle = null;

    function translate(key, fallback, replacements = {}) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const translated = window.i18n.t(key, replacements);
            if (translated && translated !== key) {
                return translated;
            }
        }
        let text = fallback ?? key;
        if (text && replacements && typeof replacements === 'object') {
            Object.keys(replacements).forEach(name => {
                text = text.replace(new RegExp(`{${name}}`, 'g'), replacements[name]);
            });
        }
        return text;
    }

    function formatDisplayValue(value, unknownKey) {
        if (value === null || value === undefined || value === '') {
            if (unknownKey) {
                return translate(unknownKey, translate('ServiceBusHistory.Value.Empty', '—'));
            }
            return translate('ServiceBusHistory.Value.Empty', '—');
        }
        return String(value);
    }

    function formatDateTime(value) {
        if (!value) {
            return translate('ServiceBusHistory.Value.Empty', '—');
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        try {
            return date.toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'medium'
            });
        } catch (error) {
            return date.toISOString();
        }
    }

    function setStatus(text, type = 'info') {
        if (!elements.status) {
            return;
        }
        elements.status.textContent = text || '';
        elements.status.classList.toggle('is-error', type === 'error');
        elements.status.classList.toggle('is-loading', type === 'loading');
    }

    function hasStructuredData(value) {
        if (!value) {
            return false;
        }
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (typeof value === 'object') {
            return Object.keys(value).length > 0;
        }
        return true;
    }

    function appendTextSection(container, labelKey, value) {
        const section = document.createElement('div');
        section.className = 'servicebus-history-details-section';
        const title = document.createElement('div');
        title.className = 'servicebus-history-details-title';
        title.textContent = translate(labelKey, labelKey);
        section.appendChild(title);
        const pre = document.createElement('pre');
        pre.className = 'servicebus-history-details-pre';
        pre.textContent = value != null && value !== ''
            ? String(value)
            : translate('ServiceBusHistory.Value.Empty', '—');
        section.appendChild(pre);
        container.appendChild(section);
    }

    function appendJsonSection(container, labelKey, value, fallbackText) {
        if (!hasStructuredData(value)) {
            if (fallbackText) {
                appendTextSection(container, labelKey, fallbackText);
            }
            return;
        }
        const section = document.createElement('div');
        section.className = 'servicebus-history-details-section';
        const title = document.createElement('div');
        title.className = 'servicebus-history-details-title';
        title.textContent = translate(labelKey, labelKey);
        section.appendChild(title);
        const pre = document.createElement('pre');
        pre.className = 'servicebus-history-details-pre';
        try {
            const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
            pre.textContent = text;
        } catch (error) {
            pre.textContent = String(value);
        }
        section.appendChild(pre);
        container.appendChild(section);
    }

    function createPreviewCell(message) {
        const cell = document.createElement('td');
        cell.className = 'servicebus-history-preview-cell';
        const preview = message.rawBodyPreview || message.rawBody || '';
        if (preview) {
            cell.textContent = preview;
            if (message.rawBody) {
                cell.title = message.rawBody;
            }
        } else {
            cell.textContent = translate('ServiceBusHistory.Value.Empty', '—');
        }
        return cell;
    }

    function createDetailsCell(message) {
        const cell = document.createElement('td');
        const details = document.createElement('details');
        details.className = 'servicebus-history-details';
        const summary = document.createElement('summary');
        summary.textContent = translate('ServiceBusHistory.Details.Toggle', 'Details anzeigen');
        details.appendChild(summary);

        appendTextSection(details, 'ServiceBusHistory.Details.Raw', message.rawBody);
        if (message.bodyJsonText) {
            appendJsonSection(details, 'ServiceBusHistory.Details.BodyJson', message.bodyJsonText);
        }
        appendJsonSection(details, 'ServiceBusHistory.Details.Broker', message.brokerProperties);
        appendJsonSection(details, 'ServiceBusHistory.Details.Application', message.applicationProperties);
        appendJsonSection(details, 'ServiceBusHistory.Details.Annotations', message.annotations);
        appendJsonSection(details, 'ServiceBusHistory.Details.Context', message.context);

        cell.appendChild(details);
        return cell;
    }

    function renderTable(messages) {
        if (!elements.tableBody) {
            return;
        }
        elements.tableBody.innerHTML = '';
        if (!Array.isArray(messages) || messages.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 9;
            cell.className = 'servicebus-history-empty-cell';
            cell.textContent = translate('ServiceBusHistory.Empty', 'Keine gespeicherten Nachrichten gefunden.');
            row.appendChild(cell);
            elements.tableBody.appendChild(row);
            return;
        }

        messages.forEach(message => {
            const row = document.createElement('tr');

            const receivedCell = document.createElement('td');
            receivedCell.textContent = formatDateTime(message.receivedAt);
            row.appendChild(receivedCell);

            const topicCell = document.createElement('td');
            topicCell.textContent = formatDisplayValue(message.topic, 'ServiceBusHistory.Value.UnknownTopic');
            row.appendChild(topicCell);

            const subscriptionCell = document.createElement('td');
            subscriptionCell.textContent = formatDisplayValue(message.subscription, 'ServiceBusHistory.Value.UnknownSubscription');
            row.appendChild(subscriptionCell);

            const messageIdCell = document.createElement('td');
            messageIdCell.textContent = formatDisplayValue(message.messageId);
            row.appendChild(messageIdCell);

            const subjectCell = document.createElement('td');
            subjectCell.textContent = formatDisplayValue(message.messageSubject);
            row.appendChild(subjectCell);

            const contentTypeCell = document.createElement('td');
            contentTypeCell.textContent = formatDisplayValue(message.contentType);
            row.appendChild(contentTypeCell);

            const deliveryCountCell = document.createElement('td');
            deliveryCountCell.textContent = typeof message.deliveryCount === 'number'
                ? String(message.deliveryCount)
                : formatDisplayValue(message.deliveryCount);
            row.appendChild(deliveryCountCell);

            row.appendChild(createPreviewCell(message));
            row.appendChild(createDetailsCell(message));

            elements.tableBody.appendChild(row);
        });
    }

    function syncPageSizeOption(value) {
        if (!elements.pageSizeSelect) {
            return;
        }
        const numericValue = Math.max(1, Math.min(200, Number.parseInt(value, 10) || state.limit));
        let optionExists = false;
        Array.from(elements.pageSizeSelect.options).forEach(option => {
            if (Number.parseInt(option.value, 10) === numericValue) {
                optionExists = true;
            }
        });
        if (!optionExists) {
            const option = document.createElement('option');
            option.value = String(numericValue);
            option.textContent = String(numericValue);
            elements.pageSizeSelect.appendChild(option);
        }
        elements.pageSizeSelect.value = String(numericValue);
    }

    function updatePaginationInfo() {
        if (elements.paginationInfo) {
            if (!state.total) {
                elements.paginationInfo.textContent = '';
            } else {
                const from = Math.min(state.total, state.offset + 1);
                const to = Math.min(state.total, state.offset + state.limit);
                const totalPages = Math.max(1, Math.ceil(state.total / Math.max(state.limit, 1)));
                const currentPage = Math.min(totalPages, Math.floor(state.offset / Math.max(state.limit, 1)) + 1);
                const rangeText = translate('ServiceBusHistory.Status.Count', 'Zeige {from}–{to} von {total} Einträgen.', {
                    from,
                    to,
                    total: state.total
                });
                const pageText = translate('ServiceBusHistory.Pagination.Page', 'Seite {current} von {total}', {
                    current: currentPage,
                    total: totalPages
                });
                elements.paginationInfo.textContent = `${rangeText} • ${pageText}`;
            }
        }
        if (elements.prevButton) {
            elements.prevButton.disabled = state.isLoading || state.offset <= 0;
        }
        if (elements.nextButton) {
            elements.nextButton.disabled = state.isLoading || state.total === 0 || (state.offset + state.limit) >= state.total;
        }
    }

    function renderTopicSelect() {
        if (!elements.topicSelect) {
            return;
        }
        const previousValue = state.topic;
        elements.topicSelect.innerHTML = '';
        const anyOption = document.createElement('option');
        anyOption.value = '';
        anyOption.textContent = translate('ServiceBusHistory.Value.AnyTopic', 'Alle Topics');
        elements.topicSelect.appendChild(anyOption);

        const topics = Array.from(state.topicsMap.values()).sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';
            return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        });
        topics.forEach(topicInfo => {
            const option = document.createElement('option');
            option.value = topicInfo.name;
            const label = topicInfo.name || translate('ServiceBusHistory.Value.UnknownTopic', 'Ohne Topic');
            option.textContent = `${label} (${topicInfo.count})`;
            elements.topicSelect.appendChild(option);
        });

        if (previousValue && !state.topicsMap.has(previousValue)) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = previousValue;
            fallbackOption.textContent = previousValue;
            elements.topicSelect.appendChild(fallbackOption);
        }
        elements.topicSelect.value = state.topic;
    }

    function renderSubscriptionSelect() {
        if (!elements.subscriptionSelect) {
            return;
        }
        elements.subscriptionSelect.innerHTML = '';
        const anyOption = document.createElement('option');
        anyOption.value = '';
        anyOption.textContent = translate('ServiceBusHistory.Value.AnySubscription', 'Alle Subscriptions');
        elements.subscriptionSelect.appendChild(anyOption);

        if (!state.topic) {
            elements.subscriptionSelect.disabled = true;
            elements.subscriptionSelect.value = '';
            return;
        }

        elements.subscriptionSelect.disabled = false;
        const topicInfo = state.topicsMap.get(state.topic);
        if (topicInfo) {
            const subs = Array.from(topicInfo.subscriptions.values()).sort((a, b) => {
                const nameA = a.name || '';
                const nameB = b.name || '';
                return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
            });
            subs.forEach(subInfo => {
                const option = document.createElement('option');
                option.value = subInfo.name;
                const label = subInfo.name || translate('ServiceBusHistory.Value.UnknownSubscription', 'Ohne Subscription');
                option.textContent = `${label} (${subInfo.count})`;
                elements.subscriptionSelect.appendChild(option);
            });
        }

        if (state.subscription && (!topicInfo || !topicInfo.subscriptions.has(state.subscription))) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = state.subscription;
            fallbackOption.textContent = state.subscription;
            elements.subscriptionSelect.appendChild(fallbackOption);
        }
        elements.subscriptionSelect.value = state.subscription;
    }

    function setLoading(isLoading) {
        state.isLoading = isLoading;
        if (elements.refreshButton) {
            elements.refreshButton.disabled = isLoading;
        }
        updatePaginationInfo();
    }

    function normalizeTopicEntry(entry) {
        const topicName = typeof entry.topic === 'string' ? entry.topic : '';
        const subscriptionName = typeof entry.subscription === 'string' ? entry.subscription : '';
        const count = Number.isFinite(entry.messageCount)
            ? entry.messageCount
            : Number.parseInt(entry.messageCount, 10) || 0;
        return { topicName, subscriptionName, count };
    }

    async function loadTopics() {
        const requestId = ++topicsRequestToken;
        try {
            const response = await fetch('/api/service-bus/messages/topics', {
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`.trim());
            }
            const data = await response.json().catch(() => null);
            if (requestId !== topicsRequestToken) {
                return;
            }
            const topicsMap = new Map();
            const entries = Array.isArray(data?.topics) ? data.topics : [];
            entries.forEach(rawEntry => {
                const { topicName, subscriptionName, count } = normalizeTopicEntry(rawEntry || {});
                if (!topicsMap.has(topicName)) {
                    topicsMap.set(topicName, {
                        name: topicName,
                        count: 0,
                        subscriptions: new Map()
                    });
                }
                const topicInfo = topicsMap.get(topicName);
                topicInfo.count += count;
                if (!topicInfo.subscriptions.has(subscriptionName)) {
                    topicInfo.subscriptions.set(subscriptionName, {
                        name: subscriptionName,
                        count: 0
                    });
                }
                const subInfo = topicInfo.subscriptions.get(subscriptionName);
                subInfo.count += count;
            });
            state.topicsMap = topicsMap;
            state.topicsLoaded = true;
            renderTopicSelect();
            renderSubscriptionSelect();
        } catch (error) {
            if (requestId !== topicsRequestToken) {
                return;
            }
            console.warn('Failed to load Service Bus topics', error);
        }
    }

    async function loadHistory() {
        const requestId = ++historyRequestToken;
        setLoading(true);
        setStatus(translate('ServiceBusHistory.Status.Loading', 'Nachrichten werden geladen…'), 'loading');
        try {
            const params = new URLSearchParams();
            params.set('limit', String(state.limit));
            params.set('offset', String(Math.max(0, state.offset)));
            if (state.topic) {
                params.set('topic', state.topic);
            }
            if (state.subscription) {
                params.set('subscription', state.subscription);
            }
            if (state.search) {
                params.set('search', state.search);
            }
            const response = await fetch(`/api/service-bus/messages/history?${params.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`.trim());
            }
            const data = await response.json().catch(() => null);
            if (requestId !== historyRequestToken) {
                return;
            }
            const messages = Array.isArray(data?.messages) ? data.messages : [];
            const pagination = data?.pagination || {};
            if (Number.isFinite(pagination.limit)) {
                state.limit = Math.max(1, Math.min(200, pagination.limit));
            }
            if (Number.isFinite(pagination.offset)) {
                state.offset = Math.max(0, pagination.offset);
            }
            state.total = Number.isFinite(pagination.total) ? Math.max(0, pagination.total) : 0;

            renderTable(messages);
            syncPageSizeOption(state.limit);
            updatePaginationInfo();
            if (!messages.length) {
                setStatus(translate('ServiceBusHistory.Empty', 'Keine gespeicherten Nachrichten gefunden.'), 'info');
            } else {
                setStatus('', 'info');
            }
        } catch (error) {
            if (requestId !== historyRequestToken) {
                return;
            }
            const message = error && error.message ? error.message : 'Unbekannter Fehler';
            setStatus(translate('ServiceBusHistory.Status.Error', 'Fehler beim Laden: {message}', { message }), 'error');
            console.error('Failed to load Service Bus history', error);
        } finally {
            if (requestId === historyRequestToken) {
                setLoading(false);
            }
        }
    }

    async function refreshData(options = {}) {
        const { reloadTopics = false, keepPage = false } = options;
        if (!keepPage) {
            state.offset = 0;
        }
        if (reloadTopics || !state.topicsLoaded) {
            await loadTopics();
        }
        await loadHistory();
    }

    function handleTopicChange() {
        if (!elements.topicSelect) {
            return;
        }
        state.topic = elements.topicSelect.value || '';
        state.subscription = '';
        state.offset = 0;
        renderSubscriptionSelect();
        loadHistory();
    }

    function handleSubscriptionChange() {
        if (!elements.subscriptionSelect) {
            return;
        }
        state.subscription = elements.subscriptionSelect.value || '';
        state.offset = 0;
        loadHistory();
    }

    function handleSearchInput() {
        if (!elements.searchInput) {
            return;
        }
        if (searchDebounceHandle) {
            clearTimeout(searchDebounceHandle);
        }
        searchDebounceHandle = setTimeout(() => {
            const value = elements.searchInput.value || '';
            state.search = value.trim().slice(0, 200);
            state.offset = 0;
            loadHistory();
        }, 300);
    }

    function handlePageSizeChange() {
        if (!elements.pageSizeSelect) {
            return;
        }
        const parsed = Number.parseInt(elements.pageSizeSelect.value, 10);
        const sanitized = Math.max(1, Math.min(200, Number.isFinite(parsed) ? parsed : state.limit));
        if (sanitized !== state.limit) {
            state.limit = sanitized;
            state.offset = 0;
            loadHistory();
        } else {
            syncPageSizeOption(state.limit);
        }
    }

    function handlePrevClick() {
        if (state.offset <= 0) {
            return;
        }
        state.offset = Math.max(0, state.offset - state.limit);
        loadHistory();
    }

    function handleNextClick() {
        const nextOffset = state.offset + state.limit;
        if (nextOffset >= state.total) {
            return;
        }
        state.offset = nextOffset;
        loadHistory();
    }

    function initialize() {
        if (state.initialized) {
            return;
        }
        state.initialized = true;
        syncPageSizeOption(state.limit);
        renderTopicSelect();
        renderSubscriptionSelect();
        updatePaginationInfo();
        setStatus('', 'info');

        elements.topicSelect?.addEventListener('change', handleTopicChange);
        elements.subscriptionSelect?.addEventListener('change', handleSubscriptionChange);
        elements.searchInput?.addEventListener('input', handleSearchInput);
        elements.pageSizeSelect?.addEventListener('change', handlePageSizeChange);
        elements.refreshButton?.addEventListener('click', () => {
            refreshData({ reloadTopics: true });
        });
        elements.prevButton?.addEventListener('click', handlePrevClick);
        elements.nextButton?.addEventListener('click', handleNextClick);
    }

    window.serviceBusHistory = {
        onShow() {
            initialize();
            refreshData({ reloadTopics: !state.topicsLoaded });
        },
        refresh() {
            initialize();
            refreshData({ reloadTopics: true });
        }
    };
})();
