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

const APP_VIEW_IDS = ['generatorView', 'bf2dView', 'bfmaView', 'bf3dView', 'savedShapesView', 'productionView', 'settingsView'];

const SETTINGS_STORAGE_KEY = 'bvbsAppSettings';
const DEFAULT_APP_SETTINGS = {
    theme: 'light',
    density: 'comfortable',
    motion: 'full'
};
let appSettings = { ...DEFAULT_APP_SETTINGS };

function loadAppSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object') {
                appSettings = { ...DEFAULT_APP_SETTINGS, ...parsed };
            }
        }
    } catch (error) {
        console.error('Could not parse application settings', error);
        appSettings = { ...DEFAULT_APP_SETTINGS };
    }
}

function persistAppSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
    } catch (error) {
        console.error('Could not store application settings', error);
    }
}

function applyAppSettings() {
    document.body.dataset.theme = appSettings.theme;
    document.body.dataset.density = appSettings.density;
    document.body.dataset.motion = appSettings.motion;

    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.checked = appSettings.theme === 'dark';
    }

    const compactModeToggle = document.getElementById('compactModeToggle');
    if (compactModeToggle) {
        compactModeToggle.checked = appSettings.density === 'compact';
    }

    const reduceMotionToggle = document.getElementById('reduceMotionToggle');
    if (reduceMotionToggle) {
        reduceMotionToggle.checked = appSettings.motion === 'reduced';
    }
}

function setSubmenuExpanded(submenu, expanded) {
    if (!submenu) return;
    submenu.classList.toggle('is-open', expanded);
    const toggle = submenu.querySelector('[data-submenu-toggle]');
    if (toggle) {
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    const list = submenu.querySelector('[data-submenu-list]');
    if (list) {
        list.hidden = !expanded;
    }
}

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
    document.querySelectorAll('[data-submenu-views]').forEach(submenu => {
        const views = (submenu.dataset.submenuViews || '')
            .split(',')
            .map(viewName => viewName.trim())
            .filter(Boolean);
        const isActive = views.includes(view);
        submenu.classList.toggle('is-active', isActive);
        if (isActive) {
            setSubmenuExpanded(submenu, true);
        }
    });
}

function getTranslation(key, fallback = key) {
    if (typeof i18n !== 'undefined' && typeof i18n.t === 'function') {
        const translated = i18n.t(key);
        if (translated && translated !== key) {
            return translated;
        }
    }
    return fallback;
}

function formatNumberLocalized(value, decimals = 0) {
    if (!Number.isFinite(value)) {
        return '';
    }
    try {
        return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(value);
    } catch (error) {
        const fixed = Number(value).toFixed(decimals);
        return decimals === 0 ? String(Math.round(Number(value))) : fixed;
    }
}

function readLocalStorageJson(key) {
    try {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        const raw = localStorage.getItem(key);
        if (!raw) {
            return null;
        }
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Could not parse saved data for ${key}`, error);
        return null;
    }
}

function collectSaved2dShapes() {
    const forms = readLocalStorageJson('bf2dSavedForms');
    if (!forms || typeof forms !== 'object') {
        return [];
    }
    return Object.entries(forms)
        .filter(([, data]) => data && typeof data === 'object')
        .map(([name, data]) => {
            const meta = (typeof data.meta === 'object' && data.meta !== null) ? data.meta : {};
            const segments = Array.isArray(data.segments) ? data.segments : [];
            const diameter = Number(meta.diameter);
            const quantity = Number(meta.quantity);
            const totalLength = segments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0);
            const stats = [
                {
                    labelKey: 'Durchmesser',
                    fallbackLabel: 'Durchmesser',
                    value: Number.isFinite(diameter) && diameter > 0 ? `${formatNumberLocalized(diameter, 1)} mm` : '–'
                },
                {
                    labelKey: 'Anzahl',
                    fallbackLabel: 'Anzahl',
                    value: Number.isFinite(quantity) ? formatNumberLocalized(quantity, 0) : '–'
                },
                {
                    labelKey: 'Segmente',
                    fallbackLabel: 'Segmente',
                    value: formatNumberLocalized(segments.length, 0)
                },
                {
                    labelKey: 'Gesamtlänge',
                    fallbackLabel: 'Gesamtlänge',
                    value: totalLength > 0 ? `${formatNumberLocalized(totalLength, 0)} mm` : '0 mm'
                }
            ];
            return { name, typeKey: 'Biegeformen 2D', stats };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function collectSaved3dShapes() {
    const keys = ['bf3dSavedShapes', 'bf3dSavedForms'];
    let entries = [];
    for (const key of keys) {
        const raw = readLocalStorageJson(key);
        if (!raw) {
            continue;
        }
        if (Array.isArray(raw)) {
            entries = raw
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return null;
                    }
                    const name = item.name || item.title || item.id;
                    const data = item.state && typeof item.state === 'object' ? item.state : (item.data && typeof item.data === 'object' ? item.data : item);
                    if (!name || !data || typeof data !== 'object') {
                        return null;
                    }
                    return { name, data };
                })
                .filter(Boolean);
        } else if (typeof raw === 'object') {
            entries = Object.entries(raw)
                .map(([name, value]) => {
                    if (!name || !value || typeof value !== 'object') {
                        return null;
                    }
                    const data = value.state && typeof value.state === 'object' ? value.state : value;
                    if (!data || typeof data !== 'object') {
                        return null;
                    }
                    return { name, data };
                })
                .filter(Boolean);
        }
        if (entries.length) {
            break;
        }
    }
    if (!entries.length) {
        return [];
    }
    return entries
        .map(({ name, data }) => {
            const header = (typeof data.header === 'object' && data.header !== null) ? data.header : {};
            const quantityRaw = header.n ?? header.quantity;
            const diameterRaw = header.d ?? header.diameter;
            const quantity = Number(quantityRaw);
            const diameter = Number(diameterRaw);
            const points = Array.isArray(data.points) ? data.points : [];
            const segments = Array.isArray(data.segments) ? data.segments : [];
            const segmentCount = segments.length || (points.length > 0 ? Math.max(points.length - 1, 0) : 0);
            let totalLength = 0;
            if (segments.length) {
                totalLength = segments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0);
            } else if (Array.isArray(data.segmentLengths)) {
                totalLength = data.segmentLengths.reduce((sum, value) => sum + (Number(value) || 0), 0);
            }
            const stats = [
                {
                    labelKey: 'Durchmesser',
                    fallbackLabel: 'Durchmesser',
                    value: Number.isFinite(diameter) && diameter > 0 ? `${formatNumberLocalized(diameter, 1)} mm` : '–'
                },
                {
                    labelKey: 'Anzahl',
                    fallbackLabel: 'Anzahl',
                    value: Number.isFinite(quantity) && quantity > 0 ? formatNumberLocalized(quantity, 0) : '–'
                },
                {
                    labelKey: 'Punkte',
                    fallbackLabel: 'Punkte',
                    value: formatNumberLocalized(points.length, 0)
                }
            ];
            if (totalLength > 0) {
                stats.push({
                    labelKey: 'Gesamtlänge',
                    fallbackLabel: 'Gesamtlänge',
                    value: `${formatNumberLocalized(totalLength, 0)} mm`
                });
            } else if (segmentCount > 0) {
                stats.push({
                    labelKey: 'Segmente',
                    fallbackLabel: 'Segmente',
                    value: formatNumberLocalized(segmentCount, 0)
                });
            }
            return { name, typeKey: 'Biegeformen 3D', stats };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function collectSavedMeshes() {
    const meshes = readLocalStorageJson('bfmaSavedMeshes');
    if (!meshes || typeof meshes !== 'object') {
        return [];
    }
    return Object.entries(meshes)
        .map(([name, value]) => {
            if (!value || typeof value !== 'object') {
                return null;
            }
            const state = value.state && typeof value.state === 'object' ? value.state : value;
            if (!state || typeof state !== 'object') {
                return null;
            }
            const header = (typeof state.header === 'object' && state.header !== null) ? state.header : {};
            const summary = (typeof state.summary === 'object' && state.summary !== null) ? state.summary : {};
            const length = Number(header.l);
            const width = Number(header.b);
            const quantity = Number(header.n);
            const totalWeight = Number(summary.totalWeight);
            const fallbackY = Array.isArray(state.yBars) ? state.yBars.length : 0;
            const fallbackX = Array.isArray(state.xBars) ? state.xBars.length : 0;
            const fallbackE = Array.isArray(state.eBars) ? state.eBars.length : 0;
            const yCount = Number.isFinite(summary.yCount) ? summary.yCount : fallbackY;
            const xCount = Number.isFinite(summary.xCount) ? summary.xCount : fallbackX;
            const eCount = Number.isFinite(summary.eCount) ? summary.eCount : fallbackE;
            const lengthDisplay = Number.isFinite(length) && length > 0 ? formatNumberLocalized(length, 0) : '–';
            const widthDisplay = Number.isFinite(width) && width > 0 ? formatNumberLocalized(width, 0) : '–';
            const dimensionsValue = (lengthDisplay === '–' && widthDisplay === '–') ? '–' : `${lengthDisplay} × ${widthDisplay} mm`;
            const stats = [
                {
                    labelKey: 'Anzahl',
                    fallbackLabel: 'Anzahl',
                    value: Number.isFinite(quantity) && quantity > 0 ? formatNumberLocalized(quantity, 0) : '–'
                },
                {
                    labelKey: 'Abmessungen',
                    fallbackLabel: 'Abmessungen',
                    value: dimensionsValue
                },
                {
                    labelKey: 'Stäbe',
                    fallbackLabel: 'Stäbe',
                    value: `Y: ${formatNumberLocalized(yCount, 0)} | X: ${formatNumberLocalized(xCount, 0)} | E: ${formatNumberLocalized(eCount, 0)}`
                }
            ];
            if (Number.isFinite(totalWeight) && totalWeight > 0) {
                stats.push({
                    labelKey: 'Gewicht',
                    fallbackLabel: 'Gewicht',
                    value: `${formatNumberLocalized(totalWeight, 2)} kg`
                });
            }
            return { name, typeKey: 'Matten', stats };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function renderSavedShapesGroup({ items, gridId, countId, emptyId }) {
    const grid = document.getElementById(gridId);
    const count = document.getElementById(countId);
    const empty = document.getElementById(emptyId);
    if (!grid || !count || !empty) {
        return;
    }
    grid.textContent = '';
    count.textContent = String(items.length);
    if (!items.length) {
        grid.hidden = true;
        empty.hidden = false;
        return;
    }
    grid.hidden = false;
    empty.hidden = true;
    items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'saved-shape-card';

        const header = document.createElement('header');
        header.className = 'saved-shape-card-header';

        const nameEl = document.createElement('h4');
        nameEl.className = 'saved-shape-name';
        nameEl.textContent = item.name;

        const typeEl = document.createElement('span');
        typeEl.className = 'saved-shape-type';
        typeEl.textContent = getTranslation(item.typeKey, item.typeKey);

        header.appendChild(nameEl);
        header.appendChild(typeEl);
        card.appendChild(header);

        if (Array.isArray(item.stats) && item.stats.length) {
            const list = document.createElement('ul');
            list.className = 'saved-shape-stats';
            item.stats.forEach(stat => {
                const li = document.createElement('li');
                li.className = 'saved-shape-stat';
                const label = document.createElement('span');
                label.className = 'saved-shape-stat-label';
                label.textContent = getTranslation(stat.labelKey, stat.fallbackLabel || stat.labelKey);
                const value = document.createElement('span');
                value.className = 'saved-shape-stat-value';
                value.textContent = stat.value;
                li.appendChild(label);
                li.appendChild(value);
                list.appendChild(li);
            });
            card.appendChild(list);
        }

        grid.appendChild(card);
    });
}

function renderSavedShapesOverview() {
    const view = document.getElementById('savedShapesView');
    if (!view) {
        return;
    }
    const groups = [
        { items: collectSaved2dShapes(), gridId: 'savedShapes2dGrid', countId: 'savedShapes2dCount', emptyId: 'savedShapes2dEmpty' },
        { items: collectSaved3dShapes(), gridId: 'savedShapes3dGrid', countId: 'savedShapes3dCount', emptyId: 'savedShapes3dEmpty' },
        { items: collectSavedMeshes(), gridId: 'savedShapesMatGrid', countId: 'savedShapesMatCount', emptyId: 'savedShapesMatEmpty' }
    ];
    groups.forEach(renderSavedShapesGroup);
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
    if (view === 'savedShapesView') {
        renderSavedShapesOverview();
    }
    if (view === 'bf2dView' && window.bf2dConfigurator && typeof window.bf2dConfigurator.onShow === 'function') {
        window.bf2dConfigurator.onShow();
    }
    if (view === 'bfmaView' && window.bfmaConfigurator && typeof window.bfmaConfigurator.onShow === 'function') {
        window.bfmaConfigurator.onShow();
    }
    if (view === 'bf3dView' && window.bf3dConfigurator && typeof window.bf3dConfigurator.onShow === 'function') {
        window.bf3dConfigurator.onShow();
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

function showBf3dView() {
    showView('bf3dView');
}

function showSavedShapesView() {
    showView('savedShapesView');
}

function showSettingsView() {
    showView('settingsView');
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
    loadAppSettings();
    applyAppSettings();
    loadProductionList();
    const updateSidebarState = () => {
        const isOpen = document.body.classList.contains('sidebar-open');
        const labelKey = isOpen ? 'Menü einklappen' : 'Menü ausklappen';
        const label = typeof i18n !== 'undefined' ? i18n.t(labelKey) : labelKey;
        const sidebarElement = document.getElementById('appSidebar');
        if (sidebarElement) {
            sidebarElement.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            sidebarElement.dataset.state = isOpen ? 'expanded' : 'collapsed';
        }
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

    document.querySelectorAll('[data-submenu-toggle]').forEach(toggle => {
        const submenu = toggle.closest('[data-submenu]');
        if (!submenu) return;
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        setSubmenuExpanded(submenu, isExpanded);
        toggle.addEventListener('click', () => {
            const currentlyExpanded = toggle.getAttribute('aria-expanded') === 'true';
            setSubmenuExpanded(submenu, !currentlyExpanded);
        });
    });

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
    document.getElementById('showBf3dBtn')?.addEventListener('click', () => {
        showBf3dView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showSavedShapesBtn')?.addEventListener('click', () => {
        showSavedShapesView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showProductionBtn')?.addEventListener('click', () => {
        showProductionView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showSettingsBtn')?.addEventListener('click', () => {
        showSettingsView();
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
    const darkModeToggle = document.getElementById('darkModeToggle');
    darkModeToggle?.addEventListener('change', (e) => {
        appSettings.theme = e.target.checked ? 'dark' : 'light';
        applyAppSettings();
        persistAppSettings();
    });
    const compactModeToggle = document.getElementById('compactModeToggle');
    compactModeToggle?.addEventListener('change', (e) => {
        appSettings.density = e.target.checked ? 'compact' : 'comfortable';
        applyAppSettings();
        persistAppSettings();
    });
    const reduceMotionToggle = document.getElementById('reduceMotionToggle');
    reduceMotionToggle?.addEventListener('change', (e) => {
        appSettings.motion = e.target.checked ? 'reduced' : 'full';
        applyAppSettings();
        persistAppSettings();
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

    applyAppSettings();

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
