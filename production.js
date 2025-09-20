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

const SAVED_SHAPES_FILTER_DEFAULTS = {
    search: '',
    type: 'all',
    diameter: 'all',
    steelGrade: 'all',
    segments: 'all',
    sort: 'name-asc',
    view: 'grid'
};

let savedShapesFilterState = { ...SAVED_SHAPES_FILTER_DEFAULTS };
let savedShapesAllItems = [];
let savedShapesControlsInitialized = false;

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

function getTranslation(key, fallback = key, replacements = {}) {
    if (typeof i18n !== 'undefined' && typeof i18n.t === 'function') {
        const translated = i18n.t(key, replacements);
        if (translated && translated !== key) {
            return translated;
        }
    }
    if (fallback && replacements && typeof replacements === 'object') {
        return Object.keys(replacements).reduce((text, placeholder) => {
            return text.replace(new RegExp(`{${placeholder}}`, 'g'), replacements[placeholder]);
        }, fallback);
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

function normalizeSearchValue(value) {
    return typeof value === 'string' ? value.toLowerCase() : String(value ?? '').toLowerCase();
}

function buildSavedShapeSearchText(parts = []) {
    return parts
        .filter(value => value !== null && value !== undefined && String(value).trim().length > 0)
        .map(value => normalizeSearchValue(value))
        .join(' ');
}

function formatDiameterBadge(diameter) {
    if (!Number.isFinite(diameter) || diameter <= 0) {
        return '';
    }
    const decimals = Number.isInteger(diameter) ? 0 : 1;
    return `Ø ${formatNumberLocalized(diameter, decimals)} mm`;
}

function formatQuantityBadge(quantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return '';
    }
    return `× ${formatNumberLocalized(quantity, 0)}`;
}

function compareNumericValues(a, b, direction = 'desc') {
    const aFinite = Number.isFinite(a);
    const bFinite = Number.isFinite(b);
    if (!aFinite && !bFinite) {
        return 0;
    }
    if (!aFinite) {
        return direction === 'asc' ? 1 : -1;
    }
    if (!bFinite) {
        return direction === 'asc' ? -1 : 1;
    }
    if (a === b) {
        return 0;
    }
    if (direction === 'asc') {
        return a < b ? -1 : 1;
    }
    return a > b ? -1 : 1;
}

function compareByName(a, b, direction = 'asc') {
    const base = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return direction === 'asc' ? base : -base;
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
            const rollDiameter = Number(meta.rollDiameter);
            const steelGrade = typeof meta.steelGrade === 'string' ? meta.steelGrade.trim() : '';
            const steelGradeNormalized = steelGrade ? steelGrade.toLowerCase() : '';
            const project = typeof meta.project === 'string' ? meta.project.trim() : '';
            const order = typeof meta.order === 'string' ? meta.order.trim() : '';
            const position = typeof meta.position === 'string' ? meta.position.trim() : '';
            const remark = typeof meta.remark === 'string' ? meta.remark.trim() : '';
            const segmentCount = segments.length;
            const totalLength = segments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0);

            const diameterDisplay = Number.isFinite(diameter) && diameter > 0
                ? `${formatNumberLocalized(diameter, Number.isInteger(diameter) ? 0 : 1)} mm`
                : '–';
            const quantityDisplay = Number.isFinite(quantity) && quantity > 0
                ? formatNumberLocalized(quantity, 0)
                : '–';
            const totalLengthDisplay = totalLength > 0 ? `${formatNumberLocalized(totalLength, 0)} mm` : '0 mm';

            const stats = [
                {
                    labelKey: 'Durchmesser',
                    fallbackLabel: 'Durchmesser',
                    value: diameterDisplay
                },
                {
                    labelKey: 'Anzahl',
                    fallbackLabel: 'Anzahl',
                    value: quantityDisplay
                },
                {
                    labelKey: 'Segmente',
                    fallbackLabel: 'Segmente',
                    value: formatNumberLocalized(segmentCount, 0)
                },
                {
                    labelKey: 'Gesamtlänge',
                    fallbackLabel: 'Gesamtlänge',
                    value: totalLengthDisplay
                }
            ];

            const details = [];
            if (project) {
                details.push({ labelKey: 'Projekt', fallbackLabel: 'Projekt', value: project });
            }
            if (order) {
                details.push({ labelKey: 'Auftrag', fallbackLabel: 'Auftrag', value: order });
            }
            if (position) {
                details.push({ labelKey: 'Pos-Nr.', fallbackLabel: 'Pos-Nr.', value: position });
            }
            if (remark) {
                details.push({ labelKey: 'Bemerkung', fallbackLabel: 'Bemerkung', value: remark });
            }
            if (Number.isFinite(rollDiameter) && rollDiameter > 0) {
                details.push({
                    labelKey: 'Rollendurchmesser',
                    fallbackLabel: 'Rollendurchmesser',
                    value: `${formatNumberLocalized(rollDiameter, Number.isInteger(rollDiameter) ? 0 : 1)} mm`
                });
            }

            const badges = [];
            const diameterBadge = formatDiameterBadge(diameter);
            const quantityBadge = formatQuantityBadge(quantity);
            if (diameterBadge) badges.push(diameterBadge);
            if (steelGrade) badges.push(steelGrade);
            if (quantityBadge) badges.push(quantityBadge);

            const segmentValues = segments.flatMap(segment => [segment.length, segment.bendAngle, segment.radius]);
            const searchText = buildSavedShapeSearchText([
                name,
                project,
                order,
                position,
                remark,
                steelGrade,
                diameter,
                quantity,
                rollDiameter,
                segmentCount,
                totalLength,
                ...segmentValues
            ]);

            return {
                id: `bf2d:${name}`,
                name,
                type: '2d',
                typeKey: 'Biegeformen 2D',
                stats,
                details,
                badges,
                diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : null,
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                steelGrade,
                steelGradeNormalized,
                segmentCount,
                totalLength,
                searchText
            };
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
            const meta = (typeof data.meta === 'object' && data.meta !== null) ? data.meta : {};
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

            const steelGrade = typeof header.steelGrade === 'string' ? header.steelGrade.trim()
                : typeof header.g === 'string' ? header.g.trim()
                : typeof meta.steelGrade === 'string' ? meta.steelGrade.trim()
                : '';
            const steelGradeNormalized = steelGrade ? steelGrade.toLowerCase() : '';

            const project = typeof header.project === 'string' ? header.project.trim()
                : typeof meta.project === 'string' ? meta.project.trim()
                : '';
            const order = typeof header.order === 'string' ? header.order.trim()
                : typeof meta.order === 'string' ? meta.order.trim()
                : '';
            const position = typeof header.position === 'string' ? header.position.trim()
                : typeof meta.position === 'string' ? meta.position.trim()
                : '';
            const remark = typeof header.remark === 'string' ? header.remark.trim()
                : typeof meta.remark === 'string' ? meta.remark.trim()
                : '';

            const diameterDisplay = Number.isFinite(diameter) && diameter > 0
                ? `${formatNumberLocalized(diameter, Number.isInteger(diameter) ? 0 : 1)} mm`
                : '–';
            const quantityDisplay = Number.isFinite(quantity) && quantity > 0
                ? formatNumberLocalized(quantity, 0)
                : '–';

            const stats = [
                {
                    labelKey: 'Durchmesser',
                    fallbackLabel: 'Durchmesser',
                    value: diameterDisplay
                },
                {
                    labelKey: 'Anzahl',
                    fallbackLabel: 'Anzahl',
                    value: quantityDisplay
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

            const details = [];
            if (project) {
                details.push({ labelKey: 'Projekt', fallbackLabel: 'Projekt', value: project });
            }
            if (order) {
                details.push({ labelKey: 'Auftrag', fallbackLabel: 'Auftrag', value: order });
            }
            if (position) {
                details.push({ labelKey: 'Pos-Nr.', fallbackLabel: 'Pos-Nr.', value: position });
            }
            if (remark) {
                details.push({ labelKey: 'Bemerkung', fallbackLabel: 'Bemerkung', value: remark });
            }

            const badges = [];
            const diameterBadge = formatDiameterBadge(diameter);
            const quantityBadge = formatQuantityBadge(quantity);
            if (diameterBadge) badges.push(diameterBadge);
            if (steelGrade) badges.push(steelGrade);
            if (quantityBadge) badges.push(quantityBadge);

            const segmentValues = segments.flatMap(segment => [segment.length, segment.bendAngle, segment.radius]);
            const searchText = buildSavedShapeSearchText([
                name,
                project,
                order,
                position,
                remark,
                steelGrade,
                diameter,
                quantity,
                segmentCount,
                totalLength,
                ...segmentValues,
                ...points.flat()
            ]);

            return {
                id: `bf3d:${name}`,
                name,
                type: '3d',
                typeKey: 'Biegeformen 3D',
                stats,
                details,
                badges,
                diameter: Number.isFinite(diameter) && diameter > 0 ? diameter : null,
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                steelGrade,
                steelGradeNormalized,
                segmentCount,
                totalLength,
                searchText
            };
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

            const project = typeof header.project === 'string' ? header.project.trim() : '';
            const order = typeof header.order === 'string' ? header.order.trim() : '';
            const position = typeof header.position === 'string' ? header.position.trim() : '';
            const remark = typeof header.remark === 'string' ? header.remark.trim() : '';

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

            const details = [];
            if (project) {
                details.push({ labelKey: 'Projekt', fallbackLabel: 'Projekt', value: project });
            }
            if (order) {
                details.push({ labelKey: 'Auftrag', fallbackLabel: 'Auftrag', value: order });
            }
            if (position) {
                details.push({ labelKey: 'Pos-Nr.', fallbackLabel: 'Pos-Nr.', value: position });
            }
            if (remark) {
                details.push({ labelKey: 'Bemerkung', fallbackLabel: 'Bemerkung', value: remark });
            }

            const badges = [];
            const quantityBadge = formatQuantityBadge(quantity);
            if (lengthDisplay !== '–' && widthDisplay !== '–') {
                badges.push(`${lengthDisplay} × ${widthDisplay} mm`);
            }
            if (quantityBadge) {
                badges.push(quantityBadge);
            }
            if (Number.isFinite(totalWeight) && totalWeight > 0) {
                badges.push(`${formatNumberLocalized(totalWeight, 1)} kg`);
            }

            const segmentCount = Number.isFinite(yCount + xCount + eCount) ? (yCount + xCount + eCount) : 0;
            const searchText = buildSavedShapeSearchText([
                name,
                project,
                order,
                position,
                remark,
                length,
                width,
                quantity,
                totalWeight,
                yCount,
                xCount,
                eCount
            ]);

            return {
                id: `bfma:${name}`,
                name,
                type: 'mesh',
                typeKey: 'Matten',
                stats,
                details,
                badges,
                diameter: null,
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                steelGrade: '',
                steelGradeNormalized: '',
                segmentCount,
                totalLength: Number.isFinite(length) && Number.isFinite(width) ? (length + width) : 0,
                searchText
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function isSavedShapesUsingDefaults() {
    return Object.entries(SAVED_SHAPES_FILTER_DEFAULTS).every(([key, value]) => savedShapesFilterState[key] === value);
}

function updateSavedShapesResetButtonState() {
    const resetButton = document.getElementById('savedShapesResetFilters');
    if (!resetButton) {
        return;
    }
    resetButton.disabled = isSavedShapesUsingDefaults();
}

function updateSavedShapesViewMode() {
    const viewMode = savedShapesFilterState.view;
    const view = document.getElementById('savedShapesView');
    if (view) {
        view.dataset.viewMode = viewMode;
    }
    document.querySelectorAll('.saved-shapes-grid').forEach(grid => {
        grid.dataset.viewMode = viewMode;
    });
    const gridButton = document.getElementById('savedShapesGridView');
    const listButton = document.getElementById('savedShapesListView');
    [gridButton, listButton].forEach(button => {
        if (!button) return;
        const mode = button.dataset.viewMode || 'grid';
        const isActive = mode === viewMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    const toggle = document.querySelector('.saved-shapes-view-toggle');
    if (toggle) {
        toggle.setAttribute('aria-label', getTranslation('Ansicht', 'Ansicht'));
    }
}

function createSavedShapeCard(item) {
    const card = document.createElement('article');
    card.className = 'saved-shape-card';
    if (savedShapesFilterState.view === 'list') {
        card.classList.add('saved-shape-card--list');
    }
    card.dataset.shapeType = item.type;

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

    if (Array.isArray(item.badges) && item.badges.length) {
        const badgeList = document.createElement('div');
        badgeList.className = 'saved-shape-badges';
        item.badges.forEach(text => {
            if (!text) return;
            const badge = document.createElement('span');
            badge.className = 'saved-shape-badge';
            badge.textContent = text;
            badgeList.appendChild(badge);
        });
        if (badgeList.childElementCount > 0) {
            card.appendChild(badgeList);
        }
    }

    const bodyChildren = [];

    if (Array.isArray(item.details) && item.details.length) {
        const detailList = document.createElement('dl');
        detailList.className = 'saved-shape-details';
        item.details.forEach(detail => {
            if (!detail || !detail.value) {
                return;
            }
            const dt = document.createElement('dt');
            dt.className = 'saved-shape-detail-label';
            dt.textContent = getTranslation(detail.labelKey, detail.fallbackLabel || detail.labelKey);
            const dd = document.createElement('dd');
            dd.className = 'saved-shape-detail-value';
            dd.textContent = detail.value;
            detailList.appendChild(dt);
            detailList.appendChild(dd);
        });
        if (detailList.childElementCount > 0) {
            bodyChildren.push(detailList);
        }
    }

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
        bodyChildren.push(list);
    }

    if (bodyChildren.length) {
        const body = document.createElement('div');
        body.className = 'saved-shape-card-body';
        bodyChildren.forEach(child => body.appendChild(child));
        card.appendChild(body);
    }

    return card;
}

function renderSavedShapesGroup({ items, totalCount, gridId, countId, emptyId }) {
    const grid = document.getElementById(gridId);
    const count = document.getElementById(countId);
    const empty = document.getElementById(emptyId);
    if (!grid || !count || !empty) {
        return;
    }
    grid.textContent = '';
    grid.dataset.viewMode = savedShapesFilterState.view;

    const filteredCount = items.length;
    const total = Number.isFinite(totalCount) ? totalCount : filteredCount;
    if (filteredCount === total) {
        count.textContent = formatNumberLocalized(filteredCount, 0);
    } else {
        count.textContent = `${formatNumberLocalized(filteredCount, 0)} / ${formatNumberLocalized(total, 0)}`;
    }

    if (!filteredCount) {
        grid.hidden = true;
        empty.hidden = false;
        return;
    }

    grid.hidden = false;
    empty.hidden = true;

    items.forEach(item => {
        const card = createSavedShapeCard(item);
        grid.appendChild(card);
    });
}

function updateSavedShapesControlsOptions(items) {
    const searchInput = document.getElementById('savedShapesSearch');
    if (searchInput && searchInput.value !== savedShapesFilterState.search) {
        searchInput.value = savedShapesFilterState.search;
    }

    const typeSelect = document.getElementById('savedShapesTypeFilter');
    if (typeSelect && typeSelect.value !== savedShapesFilterState.type) {
        typeSelect.value = savedShapesFilterState.type;
    }

    const segmentSelect = document.getElementById('savedShapesSegmentFilter');
    if (segmentSelect && segmentSelect.value !== savedShapesFilterState.segments) {
        segmentSelect.value = savedShapesFilterState.segments;
    }

    const sortSelect = document.getElementById('savedShapesSort');
    if (sortSelect && sortSelect.value !== savedShapesFilterState.sort) {
        sortSelect.value = savedShapesFilterState.sort;
    }

    const diameterSelect = document.getElementById('savedShapesDiameterFilter');
    if (diameterSelect) {
        const uniqueDiameters = Array.from(new Set(items
            .map(item => Number(item.diameter))
            .filter(value => Number.isFinite(value) && value > 0)))
            .sort((a, b) => a - b);
        const hasUnknownDiameter = items.some(item => !Number.isFinite(item.diameter));
        const previousValue = savedShapesFilterState.diameter;
        diameterSelect.textContent = '';

        const baseOption = document.createElement('option');
        baseOption.value = 'all';
        baseOption.textContent = getTranslation('Alle Durchmesser', 'Alle Durchmesser');
        diameterSelect.appendChild(baseOption);

        if (hasUnknownDiameter) {
            const option = document.createElement('option');
            option.value = 'none';
            option.textContent = getTranslation('Ohne Durchmesserangabe', 'Ohne Durchmesserangabe');
            diameterSelect.appendChild(option);
        }

        uniqueDiameters.forEach(value => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = `${formatNumberLocalized(value, Number.isInteger(value) ? 0 : 1)} mm`;
            diameterSelect.appendChild(option);
        });

        if (!Array.from(diameterSelect.options).some(option => option.value === previousValue)) {
            savedShapesFilterState.diameter = 'all';
        }
        diameterSelect.value = savedShapesFilterState.diameter;
    }

    const steelSelect = document.getElementById('savedShapesSteelFilter');
    if (steelSelect) {
        const steelGrades = new Map();
        let hasEmpty = false;
        items.forEach(item => {
            const normalized = item.steelGradeNormalized || '';
            if (normalized) {
                if (!steelGrades.has(normalized)) {
                    steelGrades.set(normalized, item.steelGrade);
                }
            } else if (item.steelGrade) {
                const fallback = item.steelGrade.toLowerCase();
                if (!steelGrades.has(fallback)) {
                    steelGrades.set(fallback, item.steelGrade);
                }
            } else {
                hasEmpty = true;
            }
        });
        const sortedGrades = Array.from(steelGrades.entries())
            .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
        const previousValue = savedShapesFilterState.steelGrade;
        steelSelect.textContent = '';

        const baseOption = document.createElement('option');
        baseOption.value = 'all';
        baseOption.textContent = getTranslation('Alle Stahlgüten', 'Alle Stahlgüten');
        steelSelect.appendChild(baseOption);

        if (hasEmpty) {
            const option = document.createElement('option');
            option.value = 'none';
            option.textContent = getTranslation('Ohne Stahlgüte', 'Ohne Stahlgüte');
            steelSelect.appendChild(option);
        }

        sortedGrades.forEach(([normalized, display]) => {
            const option = document.createElement('option');
            option.value = normalized;
            option.textContent = display;
            steelSelect.appendChild(option);
        });

        if (!Array.from(steelSelect.options).some(option => option.value === previousValue)) {
            savedShapesFilterState.steelGrade = 'all';
        }
        steelSelect.value = savedShapesFilterState.steelGrade;
    }

    updateSavedShapesResetButtonState();
}

function applySavedShapesFilters(items) {
    const searchTerm = normalizeSearchValue((savedShapesFilterState.search || '').trim());
    const hasSearch = searchTerm.length > 0;

    const filtered = items.filter(item => {
        if (savedShapesFilterState.type !== 'all' && item.type !== savedShapesFilterState.type) {
            return false;
        }

        if (savedShapesFilterState.diameter !== 'all') {
            if (savedShapesFilterState.diameter === 'none') {
                if (Number.isFinite(item.diameter)) {
                    return false;
                }
            } else {
                const selectedDiameter = Number(savedShapesFilterState.diameter);
                if (!Number.isFinite(selectedDiameter) || !Number.isFinite(item.diameter)) {
                    return false;
                }
                if (Math.abs(item.diameter - selectedDiameter) > 0.0001) {
                    return false;
                }
            }
        }

        if (savedShapesFilterState.steelGrade !== 'all') {
            if (savedShapesFilterState.steelGrade === 'none') {
                if (item.steelGrade && item.steelGrade.trim().length > 0) {
                    return false;
                }
            } else if (item.steelGradeNormalized !== savedShapesFilterState.steelGrade) {
                return false;
            }
        }

        if (savedShapesFilterState.segments !== 'all') {
            const threshold = Number(savedShapesFilterState.segments);
            if (Number.isFinite(threshold)) {
                const count = Number(item.segmentCount || 0);
                if (!Number.isFinite(count) || count < threshold) {
                    return false;
                }
            }
        }

        if (hasSearch) {
            if (!item.searchText || !item.searchText.includes(searchTerm)) {
                return false;
            }
        }

        return true;
    });

    const sorted = filtered.slice();
    switch (savedShapesFilterState.sort) {
        case 'name-desc':
            sorted.sort((a, b) => compareByName(a, b, 'desc'));
            break;
        case 'diameter-desc':
            sorted.sort((a, b) => compareNumericValues(a.diameter, b.diameter, 'desc') || compareByName(a, b));
            break;
        case 'diameter-asc':
            sorted.sort((a, b) => compareNumericValues(a.diameter, b.diameter, 'asc') || compareByName(a, b));
            break;
        case 'segments-desc':
            sorted.sort((a, b) => compareNumericValues(a.segmentCount, b.segmentCount, 'desc') || compareByName(a, b));
            break;
        case 'quantity-desc':
            sorted.sort((a, b) => compareNumericValues(a.quantity, b.quantity, 'desc') || compareByName(a, b));
            break;
        default:
            sorted.sort((a, b) => compareByName(a, b, 'asc'));
            break;
    }

    return sorted;
}

function updateSavedShapesResultInfo(filteredCount, totalCount) {
    const resultInfo = document.getElementById('savedShapesResultInfo');
    if (!resultInfo) {
        return;
    }
    if (totalCount === 0) {
        resultInfo.textContent = getTranslation('Keine gespeicherten Formen', 'Keine gespeicherten Formen');
        return;
    }
    if (filteredCount === 0) {
        resultInfo.textContent = getTranslation('Gespeicherte Formen Keine Treffer', 'Keine Treffer für die aktuellen Filter.');
        return;
    }
    resultInfo.textContent = getTranslation('Gespeicherte Formen Ergebnis', '{count} von {total} Formen angezeigt', {
        count: formatNumberLocalized(filteredCount, 0),
        total: formatNumberLocalized(totalCount, 0)
    });
}

function initializeSavedShapesControls() {
    if (savedShapesControlsInitialized) {
        return;
    }
    savedShapesControlsInitialized = true;

    const searchInput = document.getElementById('savedShapesSearch');
    if (searchInput) {
        searchInput.value = savedShapesFilterState.search;
        searchInput.addEventListener('input', event => {
            savedShapesFilterState.search = event.target.value;
            renderSavedShapesOverview();
        });
    }

    document.getElementById('savedShapesTypeFilter')?.addEventListener('change', event => {
        savedShapesFilterState.type = event.target.value || 'all';
        renderSavedShapesOverview();
    });

    document.getElementById('savedShapesDiameterFilter')?.addEventListener('change', event => {
        savedShapesFilterState.diameter = event.target.value || 'all';
        renderSavedShapesOverview();
    });

    document.getElementById('savedShapesSteelFilter')?.addEventListener('change', event => {
        savedShapesFilterState.steelGrade = event.target.value || 'all';
        renderSavedShapesOverview();
    });

    document.getElementById('savedShapesSegmentFilter')?.addEventListener('change', event => {
        savedShapesFilterState.segments = event.target.value || 'all';
        renderSavedShapesOverview();
    });

    document.getElementById('savedShapesSort')?.addEventListener('change', event => {
        savedShapesFilterState.sort = event.target.value || 'name-asc';
        renderSavedShapesOverview();
    });

    document.getElementById('savedShapesResetFilters')?.addEventListener('click', () => {
        savedShapesFilterState = { ...SAVED_SHAPES_FILTER_DEFAULTS };
        renderSavedShapesOverview();
    });

    document.querySelectorAll('.saved-shapes-view-button').forEach(button => {
        button.addEventListener('click', () => {
            const mode = button.dataset.viewMode || 'grid';
            if (savedShapesFilterState.view === mode) {
                return;
            }
            savedShapesFilterState.view = mode;
            renderSavedShapesOverview();
        });
    });
}

function renderSavedShapesOverview() {
    const view = document.getElementById('savedShapesView');
    if (!view) {
        return;
    }

    initializeSavedShapesControls();

    const allItems = [
        ...collectSaved2dShapes(),
        ...collectSaved3dShapes(),
        ...collectSavedMeshes()
    ];
    savedShapesAllItems = allItems;

    updateSavedShapesControlsOptions(allItems);

    const filteredItems = applySavedShapesFilters(allItems);
    const totalsByType = { '2d': 0, '3d': 0, 'mesh': 0 };
    const filteredByType = { '2d': [], '3d': [], 'mesh': [] };

    allItems.forEach(item => {
        const type = item.type || '2d';
        totalsByType[type] = (totalsByType[type] || 0) + 1;
    });

    filteredItems.forEach(item => {
        const type = item.type || '2d';
        if (!Array.isArray(filteredByType[type])) {
            filteredByType[type] = [];
        }
        filteredByType[type].push(item);
    });

    const groups = [
        { type: '2d', gridId: 'savedShapes2dGrid', countId: 'savedShapes2dCount', emptyId: 'savedShapes2dEmpty' },
        { type: '3d', gridId: 'savedShapes3dGrid', countId: 'savedShapes3dCount', emptyId: 'savedShapes3dEmpty' },
        { type: 'mesh', gridId: 'savedShapesMatGrid', countId: 'savedShapesMatCount', emptyId: 'savedShapesMatEmpty' }
    ];

    groups.forEach(group => {
        const items = filteredByType[group.type] || [];
        const totalCount = totalsByType[group.type] || 0;
        renderSavedShapesGroup({
            items,
            totalCount,
            gridId: group.gridId,
            countId: group.countId,
            emptyId: group.emptyId
        });
    });

    updateSavedShapesResultInfo(filteredItems.length, allItems.length);
    updateSavedShapesViewMode();

    const controls = document.querySelector('.saved-shapes-controls');
    if (controls) {
        controls.setAttribute('aria-label', getTranslation('Filter und Anzeigeoptionen', 'Filter und Anzeigeoptionen'));
    }
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
