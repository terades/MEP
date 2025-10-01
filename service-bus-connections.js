(function () {
    const viewElement = document.getElementById('serviceBusConnectionsView');
    const noop = () => {};

    if (!viewElement) {
        window.serviceBusConnections = { onShow: noop, refresh: noop };
        return;
    }

    const elements = {
        view: viewElement,
        newButton: document.getElementById('serviceBusConnectionsNewBtn'),
        status: document.getElementById('serviceBusConnectionsStatus'),
        tableBody: document.getElementById('serviceBusConnectionsTableBody'),
        emptyMessage: document.getElementById('serviceBusConnectionsEmpty'),
        modal: {
            overlay: document.getElementById('serviceBusConnectionModal'),
            title: document.getElementById('serviceBusConnectionModalTitle'),
            form: document.getElementById('serviceBusConnectionForm'),
            idInput: document.getElementById('serviceBusConnectionId'),
            nameInput: document.getElementById('serviceBusConnectionName'),
            connectionStringInput: document.getElementById('serviceBusConnectionConnectionString'),
            error: document.getElementById('serviceBusConnectionModalError'),
            saveButton: document.getElementById('serviceBusConnectionModalSaveBtn'),
            cancelButton: document.getElementById('serviceBusConnectionModalCancelBtn'),
            closeButton: document.getElementById('serviceBusConnectionModalCloseBtn'),
        }
    };

    const state = {
        initialized: false,
        isLoading: false,
        connections: [],
        editingConnection: null,
    };

    function translate(key, fallback, replacements = {}) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const translated = window.i18n.t(key, replacements);
            return translated && translated !== key ? translated : fallback;
        }
        let text = fallback ?? key;
        Object.keys(replacements).forEach(name => {
            text = text.replace(new RegExp(`{${name}}`, 'g'), replacements[name]);
        });
        return text;
    }

    function formatDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function setStatus(text, type = 'info') {
        elements.status.textContent = text || '';
        elements.status.className = `info-text is-${type}`;
    }

    function setLoading(isLoading) {
        state.isLoading = isLoading;
        elements.view.classList.toggle('is-loading', isLoading);
    }

    function renderTable() {
        elements.tableBody.innerHTML = '';
        if (state.connections.length === 0) {
            elements.emptyMessage.hidden = false;
            return;
        }
        elements.emptyMessage.hidden = true;

        state.connections.forEach(conn => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td data-label="${translate('ServiceBusConnections.Table.Name', 'Name')}">${conn.name}</td>
                <td data-label="${translate('ServiceBusConnections.Table.CreatedAt', 'Erstellt am')}">${formatDateTime(conn.created_at)}</td>
                <td data-label="${translate('ServiceBusConnections.Table.UpdatedAt', 'Aktualisiert am')}">${formatDateTime(conn.updated_at)}</td>
                <td data-label="${translate('ServiceBusConnections.Table.Actions', 'Aktionen')}">
                    <div class="button-group">
                        <button type="button" class="btn-secondary btn-sm edit-btn" data-id="${conn.id}">${translate('Bearbeiten', 'Bearbeiten')}</button>
                        <button type="button" class="btn-danger btn-sm delete-btn" data-id="${conn.id}">${translate('Löschen', 'Löschen')}</button>
                    </div>
                </td>
            `;
            elements.tableBody.appendChild(row);
        });
    }

    async function loadConnections() {
        setLoading(true);
        setStatus(translate('ServiceBusConnections.Status.Loading', 'Verbindungen werden geladen…'), 'loading');
        try {
            const response = await fetch('/api/service-bus/connections');
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            state.connections = data.connections || [];
            renderTable();
            setStatus('', 'info');
        } catch (error) {
            console.error('Failed to load connections:', error);
            setStatus(translate('ServiceBusConnections.Status.Error', 'Fehler beim Laden der Verbindungen.'), 'error');
        } finally {
            setLoading(false);
        }
    }

    function openModal(connection = null) {
        state.editingConnection = connection;
        elements.modal.form.reset();
        elements.modal.error.textContent = '';
        if (connection) {
            elements.modal.title.textContent = translate('ServiceBusConnections.Form.EditTitle', 'Verbindung bearbeiten');
            elements.modal.idInput.value = connection.id;
            elements.modal.nameInput.value = connection.name;
            // Connection string is not sent to client, so it's empty for editing
            elements.modal.connectionStringInput.placeholder = translate('ServiceBusConnections.Form.ConnectionStringPlaceholderEdit', 'Verbindungszeichenfolge erneut eingeben');
        } else {
            elements.modal.title.textContent = translate('ServiceBusConnections.Form.NewTitle', 'Neue Verbindung erstellen');
            elements.modal.idInput.value = '';
            elements.modal.connectionStringInput.placeholder = 'Endpoint=sb://...';
        }
        elements.modal.overlay.hidden = false;
        elements.modal.overlay.classList.add('visible');
        elements.modal.overlay.setAttribute('aria-hidden', 'false');
        elements.modal.nameInput.focus();
    }

    function closeModal() {
        elements.modal.overlay.hidden = true;
        elements.modal.overlay.classList.remove('visible');
        elements.modal.overlay.setAttribute('aria-hidden', 'true');
        state.editingConnection = null;
    }

    function notifyConnectionsUpdated() {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
            return;
        }
        try {
            window.dispatchEvent(new CustomEvent('servicebus:connections-updated'));
        } catch (error) {
            console.warn('Failed to dispatch connections updated event', error);
        }
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        const id = elements.modal.idInput.value;
        const name = elements.modal.nameInput.value.trim();
        const connectionString = elements.modal.connectionStringInput.value.trim();

        if (!name || !connectionString) {
            elements.modal.error.textContent = translate('ServiceBusConnections.Form.ValidationError', 'Name und Verbindungszeichenfolge sind erforderlich.');
            return;
        }

        const url = id ? `/api/service-bus/connections/${id}` : '/api/service-bus/connections';
        const method = id ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, connectionString }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Unknown error');
            }

            closeModal();
            await loadConnections();
            notifyConnectionsUpdated();
            setStatus(id
                ? translate('ServiceBusConnections.Status.UpdateSuccess', 'Verbindung aktualisiert.')
                : translate('ServiceBusConnections.Status.CreateSuccess', 'Verbindung erstellt.'), 'success');
        } catch (error) {
            elements.modal.error.textContent = error.message;
        }
    }

    async function handleDeleteClick(event) {
        const button = event.target.closest('.delete-btn');
        if (!button) return;

        const id = button.dataset.id;
        const connection = state.connections.find(c => c.id == id);
        if (!connection) return;

        if (!confirm(translate('ServiceBusConnections.ConfirmDelete', 'Möchten Sie die Verbindung "{name}" wirklich löschen?', { name: connection.name }))) {
            return;
        }

        try {
            const response = await fetch(`/api/service-bus/connections/${id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete');
            await loadConnections();
            notifyConnectionsUpdated();
            setStatus(translate('ServiceBusConnections.Status.DeleteSuccess', 'Verbindung gelöscht.'), 'success');
        } catch (error) {
            console.error('Failed to delete connection:', error);
            setStatus(translate('ServiceBusConnections.Status.DeleteError', 'Fehler beim Löschen der Verbindung.'), 'error');
        }
    }

    function handleEditClick(event) {
        const button = event.target.closest('.edit-btn');
        if (!button) return;

        const id = button.dataset.id;
        const connection = state.connections.find(c => c.id == id);
        if (connection) {
            openModal(connection);
        }
    }

    function initialize() {
        if (state.initialized) return;
        state.initialized = true;

        elements.newButton.addEventListener('click', () => openModal());
        elements.modal.form.addEventListener('submit', handleFormSubmit);
        elements.modal.cancelButton.addEventListener('click', closeModal);
        elements.modal.closeButton.addEventListener('click', closeModal);
        elements.tableBody.addEventListener('click', handleDeleteClick);
        elements.tableBody.addEventListener('click', handleEditClick);
    }

    window.serviceBusConnections = {
        onShow() {
            initialize();
            loadConnections();
        },
        refresh() {
            if(state.initialized) {
                loadConnections();
            }
        }
    };
})();