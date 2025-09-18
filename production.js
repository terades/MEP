// production.js

const LOCAL_STORAGE_PRODUCTION_LIST_KEY = 'bvbsProductionList';
let productionList = [];

function loadProductionList() {
    const data = localStorage.getItem(LOCAL_STORAGE_PRODUCTION_LIST_KEY);
    if (data) {
        try {
            productionList = JSON.parse(data);
        } catch (e) {
            console.error('Could not parse production list', e);
            productionList = [];
        }
    }
}

function persistProductionList() {
    try {
        localStorage.setItem(LOCAL_STORAGE_PRODUCTION_LIST_KEY, JSON.stringify(productionList));
    } catch (e) {
        console.error('Could not store production list', e);
    }
}

let productionFilterText = '';
let productionSortKey = 'startTime';
let productionStatusFilter = 'all';
const EDIT_PASSWORD = 'mep';
let selectedProductionIds = new Set();

function updateBatchButtonsState() {
    const hasSelection = selectedProductionIds.size > 0;
    const printBtn = document.getElementById('printSelectedButton');
    if (printBtn) printBtn.disabled = !hasSelection;
}

const APP_VIEW_IDS = ['generatorView', 'bf2dView', 'bfmaView', 'productionView'];

function setActiveNavigation(view) {
    document.body.dataset.activeView = view;
    document.querySelectorAll('.sidebar-link[data-view-target]').forEach(btn => {
        const isActive = btn.dataset.viewTarget === view;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.removeAttribute('aria-current');
        }
    });
}

function showView(view) {
    APP_VIEW_IDS.forEach(viewId => {
        const el = document.getElementById(viewId);
        if (el) {
            el.style.display = viewId === view ? 'block' : 'none';
        }
    });
    setActiveNavigation(view);
    if (view === 'productionView') {
        renderProductionList();
    }
    if (view === 'bf2dView' && window.bf2dConfigurator && typeof window.bf2dConfigurator.onShow === 'function') {
        window.bf2dConfigurator.onShow();
    }
    if (view === 'bfmaView' && window.bfmaConfigurator && typeof window.bfmaConfigurator.onShow === 'function') {
        window.bfmaConfigurator.onShow();
    }
}

function showGeneratorView() {
    showView('generatorView');
}

function showProductionView() {
    showView('productionView');
}

function showBf2dView() {
    showView('bf2dView');
}

function showBfmaView() {
    showView('bfmaView');
}

function openGeneratorAndClick(buttonId) {
    showGeneratorView();
    requestAnimationFrame(() => {
        document.getElementById(buttonId)?.click();
    });
}

function openReleaseModal() {
    const modal = document.getElementById('releaseModal');
    if (modal) modal.classList.add('visible');
}

function closeReleaseModal() {
    const modal = document.getElementById('releaseModal');
    if (modal) modal.classList.remove('visible');
}

function statusKey(status) {
    switch (status) {
        case 'inProgress': return 'In Arbeit';
        case 'done': return 'Abgeschlossen';
        default: return 'Offen';
    }
}

function statusClass(status) {
    switch (status) {
        case 'inProgress': return 'in-progress';
        case 'done': return 'done';
        default: return 'pending';
    }
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function updateSelectAllCheckboxState() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const tableBody = document.getElementById('productionList');
    if (!tableBody || !selectAllCheckbox) return;
    const rowCheckboxes = tableBody.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(rowCheckboxes).every(checkbox => checkbox.checked);
    selectAllCheckbox.checked = rowCheckboxes.length > 0 && allChecked;
}

function updateSelectAllCheckboxState() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const tableBody = document.getElementById('productionList');
    if (!tableBody || !selectAllCheckbox) return;
    const rowCheckboxes = tableBody.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(rowCheckboxes).every(checkbox => checkbox.checked);
    selectAllCheckbox.checked = rowCheckboxes.length > 0 && allChecked;
}

function renderProductionList() {
    const tbody = document.getElementById('productionList');
    if (!tbody) return;

    let items = productionList.filter(item => {
        const textMatch = productionFilterText === '' ||
            [item.projekt, item.komm, item.auftrag, item.posnr, item.note]
            .some(f => f && f.toLowerCase().includes(productionFilterText));
        const statusMatch = productionStatusFilter === 'all' || item.status === productionStatusFilter;
        return textMatch && statusMatch;
    });

    items.sort((a, b) => {
        if (productionSortKey === 'projekt') {
            return a.projekt.localeCompare(b.projekt);
        }
        return (b.startTime || '').localeCompare(a.startTime || '');
    });

    tbody.innerHTML = '';
    items.forEach(item => {
        const row = tbody.insertRow();
        row.className = `production-item ${statusClass(item.status)}`;
        row.dataset.id = item.id || (item.komm + item.posnr);

        // Checkbox
        const cellCheckbox = row.insertCell();
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'row-checkbox';
        checkbox.dataset.id = row.dataset.id;
        checkbox.checked = selectedProductionIds.has(row.dataset.id);
        cellCheckbox.appendChild(checkbox);

        // Data cells
        row.insertCell().textContent = item.projekt;
        row.insertCell().textContent = item.komm;
        row.insertCell().textContent = item.auftrag;
        row.insertCell().textContent = item.posnr;

        // Status
        const cellStatus = row.insertCell();
        const statusSelect = document.createElement('select');
        statusSelect.className = 'status-select';

        const updateSelectClass = () => {
            statusSelect.classList.remove('pending', 'in-progress', 'done');
            statusSelect.classList.add(statusClass(statusSelect.value));
        };

        const statuses = ['pending', 'inProgress', 'done'];
        statuses.forEach(status => {
            const option = document.createElement('option');
            option.value = status;
            option.textContent = i18n.t(statusKey(status));
            if (status === item.status) {
                option.selected = true;
            }
            statusSelect.appendChild(option);
        });
        statusSelect.addEventListener('change', (e) => {
            const newStatus = e.target.value;
            item.status = newStatus;
            if (newStatus === 'inProgress' && !item.startTimestamp) {
                item.startTimestamp = Date.now();
            } else if (newStatus === 'done' && !item.endTimestamp) {
                item.endTimestamp = Date.now();
            }
            updateSelectClass();
            persistProductionList();
            renderProductionList();
        });
        updateSelectClass();
        cellStatus.appendChild(statusSelect);


        // Timestamps and Duration
        row.insertCell().textContent = item.startTime ? new Date(item.startTime).toLocaleString() : '-';
        const duration = item.startTimestamp ? ((item.status === 'done' ? item.endTimestamp : Date.now()) - item.startTimestamp) : null;
        row.insertCell().textContent = duration !== null ? formatDuration(duration) : '-';

        // Note
        row.insertCell().textContent = item.note || '';

        // Label Preview
        const cellLabel = row.insertCell();
        const img = document.createElement('img');
        img.src = item.labelImg;
        img.className = 'label-thumbnail';
        img.addEventListener('click', () => window.open(item.labelImg, '_blank'));
        cellLabel.appendChild(img);

        // Actions
        const cellActions = row.insertCell();
        const btnGroup = document.createElement('div');
        btnGroup.className = 'button-group';

        cellActions.appendChild(btnGroup);
    });

    updateBatchButtonsState();
    updateSelectAllCheckboxState();
}

document.addEventListener('DOMContentLoaded', () => {
    loadProductionList();
    const updateSidebarState = () => {
        const isOpen = document.body.classList.contains('sidebar-open');
        const labelKey = isOpen ? 'Menü einklappen' : 'Menü ausklappen';
        const label = typeof i18n !== 'undefined' ? i18n.t(labelKey) : labelKey;
        document.querySelectorAll('[data-sidebar-toggle]').forEach(toggle => {
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            toggle.setAttribute('aria-label', label);
        });
    };

    const closeSidebarOnSmallScreens = () => {
        if (window.matchMedia('(max-width: 900px)').matches) {
            if (document.body.classList.contains('sidebar-open')) {
                document.body.classList.remove('sidebar-open');
                updateSidebarState();
            }
        }
    };

    document.querySelectorAll('[data-sidebar-toggle]').forEach(toggle => {
        toggle.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-open');
            updateSidebarState();
        });
    });

    const wideSidebarQuery = window.matchMedia('(min-width: 1200px)');
    const handleWideSidebarChange = event => {
        if (event.matches) {
            document.body.classList.add('sidebar-open');
        } else {
            document.body.classList.remove('sidebar-open');
        }
        updateSidebarState();
    };
    if (wideSidebarQuery.matches) {
        document.body.classList.add('sidebar-open');
    }
    updateSidebarState();
    if (typeof wideSidebarQuery.addEventListener === 'function') {
        wideSidebarQuery.addEventListener('change', handleWideSidebarChange);
    } else if (typeof wideSidebarQuery.addListener === 'function') {
        wideSidebarQuery.addListener(handleWideSidebarChange);
    }

    document.getElementById('showGeneratorBtn')?.addEventListener('click', () => {
        showGeneratorView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showBf2dBtn')?.addEventListener('click', () => {
        showBf2dView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showBfmaBtn')?.addEventListener('click', () => {
        showBfmaView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showProductionBtn')?.addEventListener('click', () => {
        showProductionView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('quickReleaseButton')?.addEventListener('click', () => {
        openGeneratorAndClick('releaseButton');
        closeSidebarOnSmallScreens();
    });
    document.getElementById('quickSavedOrdersButton')?.addEventListener('click', () => {
        openGeneratorAndClick('openSavedOrdersButton');
        closeSidebarOnSmallScreens();
    });
    document.getElementById('quickSvgButton')?.addEventListener('click', () => {
        openGeneratorAndClick('downloadSvgButton');
        closeSidebarOnSmallScreens();
    });
    document.getElementById('quickPrintLabelButton')?.addEventListener('click', () => {
        openGeneratorAndClick('printLabelButton');
        closeSidebarOnSmallScreens();
    });
    document.getElementById('releaseButton')?.addEventListener('click', () => {
        const input = document.getElementById('releaseStartzeit');
        if (input) {
            input.value = new Date().toISOString().slice(0,16);
        }
        const note = document.getElementById('releaseNote');
        if (note) note.value = '';
        const err = document.getElementById('releaseModalError');
        if (err) err.textContent = '';
        openReleaseModal();
    });

    document.getElementById('confirmReleaseButton')?.addEventListener('click', async () => {
        const startTime = document.getElementById('releaseStartzeit')?.value;
        if (!startTime) {
            showFeedback('releaseModalError', i18n.t('Bitte Startzeitpunkt angeben.'), 'warning', 3000);
            return;
        }
        const labelElement = document.getElementById('printableLabel');
        const canvas = await html2canvas(labelElement);
        const imgData = canvas.toDataURL('image/png');
        const codes = typeof getBvbsCodes === 'function' ? getBvbsCodes() : [];
        productionList.push({
            id: Date.now(),
            startTime,
            projekt: document.getElementById('projekt').value,
            komm: document.getElementById('KommNr').value,
            auftrag: document.getElementById('auftrag').value,
            posnr: document.getElementById('posnr').value,
            note: document.getElementById('releaseNote')?.value || '',
            labelImg: imgData,
            status: 'pending',
            bvbsCodes: codes
        });
        if (window.deleteCurrentSavedOrder) {
            window.deleteCurrentSavedOrder();
        }
        persistProductionList();
        closeReleaseModal();
        renderProductionList();
        showProductionView();
    });
    document.getElementById('productionFilter')?.addEventListener('input', e => {
        productionFilterText = e.target.value.toLowerCase();
        renderProductionList();
    });
    document.getElementById('productionSort')?.addEventListener('change', e => {
        productionSortKey = e.target.value;
        renderProductionList();
    });
    document.getElementById('productionStatusFilter')?.addEventListener('change', e => {
        productionStatusFilter = e.target.value;
        renderProductionList();
    });

    const tableBody = document.getElementById('productionList');
    tableBody?.addEventListener('change', e => {
        if (e.target.classList.contains('row-checkbox')) {
            const id = e.target.dataset.id;
            if (e.target.checked) {
                selectedProductionIds.add(id);
            } else {
                selectedProductionIds.delete(id);
            }
            updateBatchButtonsState();
            updateSelectAllCheckboxState();
        }
    });

    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox?.addEventListener('change', e => {
        const tableBody = document.getElementById('productionList');
        if (!tableBody) return;
        const isChecked = e.target.checked;
        const rowCheckboxes = tableBody.querySelectorAll('.row-checkbox');
        rowCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
            const id = checkbox.dataset.id;
            if (isChecked) {
                selectedProductionIds.add(id);
            } else {
                selectedProductionIds.delete(id);
            }
        });
        updateBatchButtonsState();
        updateSelectAllCheckboxState();
    });

    setInterval(() => {
        if (productionList.some(p => p.status === 'inProgress')) {
            renderProductionList();
        }
    }, 1000);

    document.getElementById('printSelectedButton')?.addEventListener('click', () => {
        const printContainer = document.getElementById('print-container');
        if (!printContainer) return;

        const selectedOrders = productionList.filter(order => selectedProductionIds.has(String(order.id)));

        if (selectedOrders.length === 0) {
            alert(i18n.t('Bitte wählen Sie mindestens einen Auftrag zum Drucken aus.'));
            return;
        }

        printContainer.innerHTML = selectedOrders.map((order, index) => generateLabelHtml(order, index)).join('');

        // Timeout to allow DOM to update before generating barcodes
        setTimeout(() => {
            selectedOrders.forEach((order, index) => {
                if (order.bvbsCodes && order.bvbsCodes[0]) {
                    generateBarcodeToLabel(order.bvbsCodes[0], `_batch_${index}_1`);
                }
                if (order.bvbsCodes && order.bvbsCodes[1]) {
                    generateBarcodeToLabel(order.bvbsCodes[1], `_batch_${index}_2`);
                }
            });

            window.print();
        }, 100);
    });

    showGeneratorView();
});

function generateLabelHtml(order, index) {
    const hasTwoLabels = order.bvbsCodes && order.bvbsCodes.length > 1;
    const posnr1 = `${order.posnr}${hasTwoLabels ? '/1' : ''}`;
    const posnr2 = `${order.posnr}${hasTwoLabels ? '/2' : ''}`;

    const label1 = `
        <div class="label-wrapper-print">
            <div id="printableLabel_batch_${index}_1" class="printableLabel-batch">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm;">
                    <h3 style="margin: 0; font-size: 16pt; font-weight: bold;">
                        <span data-i18n="Pos‑Nr:">Pos‑Nr:</span> <span>${posnr1}</span>
                    </h3>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;font-size:14pt;font-weight:bold;color:#000;">
                        <div>${order.komm}</div>
                    </div>
                </div>
                <div class="label-grid" style="font-size: 12pt; margin-bottom: 4mm;">
                    <div><strong data-i18n="Projekt:">Projekt:</strong></div><div>${order.projekt}</div>
                    <div><strong data-i18n="Auftrag:">Auftrag:</strong></div><div>${order.auftrag}</div>
                </div>
                <div id="labelBarcodeContainer_batch_${index}_1" style="text-align: center; margin-top: 4mm;"></div>
            </div>
        </div>`;

    if (!hasTwoLabels) {
        return label1;
    }

    const label2 = `
        <div class="label-wrapper-print">
            <div id="printableLabel_batch_${index}_2" class="printableLabel-batch">
                 <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm;">
                    <h3 style="margin: 0; font-size: 16pt; font-weight: bold;">
                        <span data-i18n="Pos‑Nr:">Pos‑Nr:</span> <span>${posnr2}</span>
                    </h3>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;font-size:14pt;font-weight:bold;color:#000;">
                        <div>${order.komm}</div>
                    </div>
                </div>
                <div class="label-grid" style="font-size: 12pt; margin-bottom: 4mm;">
                    <div><strong data-i18n="Projekt:">Projekt:</strong></div><div>${order.projekt}</div>
                    <div><strong data-i18n="Auftrag:">Auftrag:</strong></div><div>${order.auftrag}</div>
                </div>
                <div id="labelBarcodeContainer_batch_${index}_2" style="text-align: center; margin-top: 4mm;"></div>
            </div>
        </div>`;

    return label1 + label2;
}
