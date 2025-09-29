(function () {
    const viewElement = document.getElementById('databaseViewerView');

    const noop = () => {};

    if (!viewElement) {
        window.databaseViewer = {
            onShow: noop,
            refresh: noop
        };
        return;
    }

    const elements = {
        tableBody: document.getElementById('databaseViewerTableBody'),
        status: document.getElementById('databaseViewerStatus'),
        refreshButton: document.getElementById('databaseViewerRefreshBtn')
    };

    let isLoading = false;
    let lastEntries = [];

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
                const value = replacements[name];
                text = text.replace(new RegExp(`{${name}}`, 'g'), value);
            });
        }
        return text;
    }

    function setStatus(text, type = 'info') {
        if (!elements.status) {
            return;
        }
        elements.status.textContent = text || '';
        elements.status.classList.toggle('is-loading', type === 'loading');
        elements.status.classList.toggle('is-error', type === 'error');
    }

    function formatUpdatedAt(value) {
        if (!value) {
            return translate('DatabaseViewer.Table.UpdatedUnknown', 'Unbekannt');
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

    function countEntries(value) {
        if (value === null || value === undefined) {
            return 0;
        }
        if (Array.isArray(value)) {
            return value.length;
        }
        if (typeof value === 'object') {
            return Object.keys(value).length;
        }
        return 1;
    }

    function renderEmptyRow() {
        if (!elements.tableBody) {
            return;
        }
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = translate('DatabaseViewer.Empty', 'Keine gespeicherten Daten vorhanden.');
        row.appendChild(cell);
        elements.tableBody.appendChild(row);
    }

    function renderEntries(entries) {
        if (!elements.tableBody) {
            return;
        }
        elements.tableBody.innerHTML = '';
        if (!Array.isArray(entries) || entries.length === 0) {
            renderEmptyRow();
            return;
        }

        entries.forEach(entry => {
            const row = document.createElement('tr');
            const keyCell = document.createElement('td');
            keyCell.textContent = entry.key || '';
            row.appendChild(keyCell);

            const countCell = document.createElement('td');
            countCell.textContent = String(countEntries(entry.value));
            row.appendChild(countCell);

            const updatedCell = document.createElement('td');
            updatedCell.textContent = formatUpdatedAt(entry.updatedAt);
            row.appendChild(updatedCell);

            const detailsCell = document.createElement('td');
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = translate('DatabaseViewer.Details.Toggle', 'Details anzeigen');
            details.appendChild(summary);
            const pre = document.createElement('pre');
            pre.className = 'servicebus-history-details-pre';
            try {
                pre.textContent = JSON.stringify(entry.value, null, 2);
            } catch (error) {
                pre.textContent = String(entry.value);
            }
            details.appendChild(pre);
            detailsCell.appendChild(details);
            row.appendChild(detailsCell);

            elements.tableBody.appendChild(row);
        });
    }

    async function loadEntries() {
        if (isLoading) {
            return;
        }
        isLoading = true;
        if (elements.refreshButton) {
            elements.refreshButton.disabled = true;
        }
        setStatus(translate('DatabaseViewer.Status.Loading', 'Lade gespeicherte Daten…'), 'loading');

        try {
            const response = await fetch('/api/bending-forms/storage', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            const data = await response.json();
            const entries = Array.isArray(data?.entries) ? data.entries : [];
            lastEntries = entries;
            renderEntries(entries);
            if (entries.length === 0) {
                setStatus(translate('DatabaseViewer.Status.Empty', 'Keine gespeicherten Daten gefunden.'), 'info');
            } else {
                setStatus(translate('DatabaseViewer.Status.Success', 'Daten erfolgreich geladen.'), 'info');
            }
        } catch (error) {
            console.error('Failed to load bending form storage snapshot', error);
            setStatus(translate('DatabaseViewer.Error.Load', 'Daten konnten nicht geladen werden.'), 'error');
            renderEntries(lastEntries);
        } finally {
            isLoading = false;
            if (elements.refreshButton) {
                elements.refreshButton.disabled = false;
            }
        }
    }

    if (elements.refreshButton) {
        elements.refreshButton.addEventListener('click', () => {
            loadEntries();
        });
    }

    window.databaseViewer = {
        onShow() {
            if (!lastEntries.length) {
                loadEntries();
            }
        },
        refresh() {
            loadEntries();
        }
    };
})();
