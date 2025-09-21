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

const APP_VIEW_IDS = ['generatorView', 'bf2dView', 'bfmaView', 'bf3dView', 'savedShapesView', 'productionView', 'resourcesView', 'settingsView'];

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

const RESOURCE_STORAGE_KEY = 'bvbsResources';
let resources = [];
let editingResourceId = null;
let resourceFeedbackTimer = null;

const resourceSubscribers = new Set();

function getResourceSnapshot() {
    return resources.map(resource => ({
        ...resource,
        supportedTypes: Array.isArray(resource.supportedTypes) ? [...resource.supportedTypes] : [],
        availableRollDiameters: Array.isArray(resource.availableRollDiameters)
            ? [...resource.availableRollDiameters]
            : []
    }));
}

function notifyResourceSubscribers() {
    const snapshot = getResourceSnapshot();
    resourceSubscribers.forEach(callback => {
        try {
            callback(snapshot);
        } catch (error) {
            console.error('Resource subscriber callback failed', error);
        }
    });
    try {
        window.dispatchEvent(new CustomEvent('bvbs:resources-changed', { detail: { resources: snapshot } }));
    } catch (error) {
        console.error('Could not dispatch resource change event', error);
    }
}

function ensureResourceManager() {
    try {
        if (!window.resourceManager || typeof window.resourceManager !== 'object') {
            window.resourceManager = {};
        }
        window.resourceManager.getResources = () => getResourceSnapshot();
        window.resourceManager.subscribe = callback => {
            if (typeof callback !== 'function') {
                return () => {};
            }
            resourceSubscribers.add(callback);
            try {
                callback(getResourceSnapshot());
            } catch (error) {
                console.error('Resource subscriber callback failed', error);
            }
            return () => {
                resourceSubscribers.delete(callback);
            };
        };
    } catch (error) {
        console.error('Could not expose resource manager', error);
    }
}

ensureResourceManager();

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

const MASTER_DATA_STORAGE_KEY = 'bvbsMasterData';
const MASTER_DATA_TYPES = ['steelGrades', 'rollDiameters', 'meshTypes'];
const DEFAULT_MASTER_DATA = {
    steelGrades: ['B500B', 'B500A', 'B500C'],
    rollDiameters: [40, 48, 56, 70],
    meshTypes: ['Q257', 'Q188', 'R335']
};

let masterData = {
    steelGrades: [...DEFAULT_MASTER_DATA.steelGrades],
    rollDiameters: [...DEFAULT_MASTER_DATA.rollDiameters],
    meshTypes: [...DEFAULT_MASTER_DATA.meshTypes]
};

const MASTER_DATA_CONFIG = {
    steelGrades: {
        listId: 'masterDataSteelList',
        emptyId: 'masterDataSteelEmpty',
        feedbackId: 'masterDataSteelFeedback'
    },
    rollDiameters: {
        listId: 'masterDataRollList',
        emptyId: 'masterDataRollEmpty',
        feedbackId: 'masterDataRollFeedback'
    },
    meshTypes: {
        listId: 'masterDataMeshList',
        emptyId: 'masterDataMeshEmpty',
        feedbackId: 'masterDataMeshFeedback'
    }
};

const masterDataSubscribers = new Set();
const masterDataFeedbackTimers = {};

function sanitizeStringMasterData(values = []) {
    const seen = new Set();
    return values
        .map(value => (value ?? '').toString().trim())
        .filter(value => {
            if (!value) return false;
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function formatMasterDataNumberValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '';
    }
    if (Math.abs(num - Math.round(num)) < 1e-6) {
        return String(Math.round(num));
    }
    return (Math.round(num * 1000) / 1000).toString();
}

function sanitizeNumberMasterData(values = []) {
    const seen = new Set();
    return values
        .map(value => {
            if (typeof value === 'string') {
                return Number(parseFloat(value.replace(',', '.')));
            }
            return Number(value);
        })
        .filter(num => Number.isFinite(num) && num > 0)
        .map(num => Number((Math.round(num * 1000) / 1000)))
        .filter(num => {
            const key = formatMasterDataNumberValue(num);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a - b);
}

function getMasterDataSnapshot() {
    return {
        steelGrades: [...masterData.steelGrades],
        rollDiameters: [...masterData.rollDiameters],
        meshTypes: [...masterData.meshTypes]
    };
}

function persistMasterData() {
    try {
        localStorage.setItem(MASTER_DATA_STORAGE_KEY, JSON.stringify(masterData));
    } catch (error) {
        console.error('Could not store master data', error);
    }
}

function notifyMasterDataSubscribers() {
    const snapshot = getMasterDataSnapshot();
    masterDataSubscribers.forEach(callback => {
        try {
            callback(snapshot);
        } catch (error) {
            console.error('Master data subscriber callback failed', error);
        }
    });
    try {
        window.dispatchEvent(new CustomEvent('bvbs:masterdata-changed', { detail: { masterData: snapshot } }));
    } catch (error) {
        console.error('Could not dispatch master data change event', error);
    }
}

function ensureMasterDataManager() {
    try {
        if (!window.masterDataManager || typeof window.masterDataManager !== 'object') {
            window.masterDataManager = {};
        }
        window.masterDataManager.getSnapshot = () => getMasterDataSnapshot();
        window.masterDataManager.getValues = type => {
            if (!MASTER_DATA_TYPES.includes(type)) {
                return [];
            }
            return [...masterData[type]];
        };
        window.masterDataManager.subscribe = callback => {
            if (typeof callback !== 'function') {
                return () => {};
            }
            masterDataSubscribers.add(callback);
            try {
                callback(getMasterDataSnapshot());
            } catch (error) {
                console.error('Master data subscriber callback failed', error);
            }
            return () => {
                masterDataSubscribers.delete(callback);
            };
        };
        window.masterDataManager.addValue = (type, value) => addMasterDataValue(type, value);
        window.masterDataManager.removeValue = (type, value) => removeMasterDataValue(type, value);
        window.masterDataManager.refreshSelects = () => {
            updateMasterDataSelects(getMasterDataSnapshot());
        };
    } catch (error) {
        console.error('Could not expose master data manager', error);
    }
}

function loadMasterData() {
    const defaults = {
        steelGrades: sanitizeStringMasterData(DEFAULT_MASTER_DATA.steelGrades),
        rollDiameters: sanitizeNumberMasterData(DEFAULT_MASTER_DATA.rollDiameters),
        meshTypes: sanitizeStringMasterData(DEFAULT_MASTER_DATA.meshTypes)
    };
    let stored = null;
    try {
        const raw = localStorage.getItem(MASTER_DATA_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                stored = parsed;
            }
        }
    } catch (error) {
        console.error('Could not load master data', error);
    }
    masterData = {
        steelGrades: sanitizeStringMasterData(Array.isArray(stored?.steelGrades) ? stored.steelGrades : defaults.steelGrades),
        rollDiameters: sanitizeNumberMasterData(Array.isArray(stored?.rollDiameters) ? stored.rollDiameters : defaults.rollDiameters),
        meshTypes: sanitizeStringMasterData(Array.isArray(stored?.meshTypes) ? stored.meshTypes : defaults.meshTypes)
    };
    persistMasterData();
}

function addMasterDataValue(type, rawValue) {
    if (!MASTER_DATA_TYPES.includes(type)) {
        return { success: false, message: getTranslation('Unbekannter Stammdatentyp', 'Unbekannter Stammdatentyp') };
    }
    if (type === 'rollDiameters') {
        const parsed = Number(parseFloat(String(rawValue ?? '').replace(',', '.')));
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return { success: false, message: getTranslation('Bitte einen gültigen Durchmesser eingeben.', 'Bitte einen gültigen Durchmesser eingeben.') };
        }
        const exists = masterData.rollDiameters.some(value => Math.abs(value - parsed) < 1e-6);
        if (exists) {
            return { success: false, message: getTranslation('Wert bereits vorhanden', 'Wert bereits vorhanden') };
        }
        masterData.rollDiameters = sanitizeNumberMasterData([...masterData.rollDiameters, parsed]);
    } else {
        const value = (rawValue ?? '').toString().trim();
        if (!value) {
            return { success: false, message: getTranslation('Bitte einen Wert eingeben.', 'Bitte einen Wert eingeben.') };
        }
        const lower = value.toLowerCase();
        const list = type === 'steelGrades' ? masterData.steelGrades : masterData.meshTypes;
        if (list.some(item => item.toLowerCase() === lower)) {
            return { success: false, message: getTranslation('Wert bereits vorhanden', 'Wert bereits vorhanden') };
        }
        const updated = sanitizeStringMasterData([...list, value]);
        if (type === 'steelGrades') {
            masterData.steelGrades = updated;
        } else {
            masterData.meshTypes = updated;
        }
    }
    persistMasterData();
    notifyMasterDataSubscribers();
    return { success: true };
}

function removeMasterDataValue(type, rawValue) {
    if (!MASTER_DATA_TYPES.includes(type)) {
        return { success: false, message: getTranslation('Unbekannter Stammdatentyp', 'Unbekannter Stammdatentyp') };
    }
    if (type === 'rollDiameters') {
        const parsed = Number(parseFloat(String(rawValue ?? '').replace(',', '.')));
        if (!Number.isFinite(parsed)) {
            return { success: false, message: getTranslation('Wert nicht gefunden', 'Wert nicht gefunden') };
        }
        const before = masterData.rollDiameters.length;
        masterData.rollDiameters = masterData.rollDiameters.filter(value => Math.abs(value - parsed) > 1e-6);
        if (masterData.rollDiameters.length === before) {
            return { success: false, message: getTranslation('Wert nicht gefunden', 'Wert nicht gefunden') };
        }
    } else {
        const value = (rawValue ?? '').toString().trim();
        if (!value) {
            return { success: false, message: getTranslation('Wert nicht gefunden', 'Wert nicht gefunden') };
        }
        const lower = value.toLowerCase();
        if (type === 'steelGrades') {
            const before = masterData.steelGrades.length;
            masterData.steelGrades = masterData.steelGrades.filter(item => item.toLowerCase() !== lower);
            if (masterData.steelGrades.length === before) {
                return { success: false, message: getTranslation('Wert nicht gefunden', 'Wert nicht gefunden') };
            }
        } else {
            const before = masterData.meshTypes.length;
            masterData.meshTypes = masterData.meshTypes.filter(item => item.toLowerCase() !== lower);
            if (masterData.meshTypes.length === before) {
                return { success: false, message: getTranslation('Wert nicht gefunden', 'Wert nicht gefunden') };
            }
        }
    }
    persistMasterData();
    notifyMasterDataSubscribers();
    return { success: true };
}

function renderMasterDataList(type, values) {
    const config = MASTER_DATA_CONFIG[type];
    if (!config) return;
    const listEl = document.getElementById(config.listId);
    const emptyEl = document.getElementById(config.emptyId);
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!Array.isArray(values) || values.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        return;
    }
    if (emptyEl) emptyEl.hidden = true;
    values.forEach(value => {
        const item = document.createElement('li');
        item.className = 'masterdata-item';
        const valueEl = document.createElement('span');
        valueEl.className = 'masterdata-value';
        if (type === 'rollDiameters') {
            valueEl.textContent = `${formatMasterDataNumberValue(value)} mm`;
        } else {
            valueEl.textContent = value;
        }
        item.appendChild(valueEl);
        const actions = document.createElement('div');
        actions.className = 'masterdata-actions';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'masterdata-remove';
        removeBtn.dataset.masterdataRemove = type;
        removeBtn.dataset.value = type === 'rollDiameters' ? formatMasterDataNumberValue(value) : value;
        removeBtn.textContent = getTranslation('Entfernen', 'Entfernen');
        removeBtn.setAttribute('aria-label', getTranslation('Wert entfernen', 'Wert entfernen'));
        actions.appendChild(removeBtn);
        item.appendChild(actions);
        listEl.appendChild(item);
    });
}

function normalizeMasterDataSelectValue(type, rawValue) {
    if (type === 'rollDiameters') {
        const parsed = Number(parseFloat(String(rawValue ?? '').replace(',', '.')));
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return '';
        }
        return formatMasterDataNumberValue(parsed);
    }
    if (rawValue === null || rawValue === undefined) {
        return '';
    }
    return rawValue.toString().trim();
}

function updateMasterDataSelects(snapshot = getMasterDataSnapshot()) {
    const selects = document.querySelectorAll('[data-masterdata-source]');
    selects.forEach(select => {
        const type = select.dataset.masterdataSource;
        if (!MASTER_DATA_TYPES.includes(type)) {
            return;
        }
        const values = Array.isArray(snapshot[type]) ? snapshot[type] : [];
        const placeholderKey = select.dataset.masterdataPlaceholderKey;
        const placeholder = placeholderKey ? getTranslation(placeholderKey, placeholderKey) : '';
        const previousValue = select.value;
        const pendingValue = select.dataset.masterdataPendingValue;
        const normalizedPreviousValue = normalizeMasterDataSelectValue(type, pendingValue || previousValue);
        select.innerHTML = '';
        if (placeholder) {
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.textContent = placeholder;
            select.appendChild(placeholderOption);
        }
        values.forEach(value => {
            const normalizedValue = normalizeMasterDataSelectValue(type, value);
            const option = document.createElement('option');
            option.value = normalizedValue;
            option.textContent = type === 'rollDiameters' ? formatMasterDataNumberValue(value) : value;
            select.appendChild(option);
        });
        const defaultValue = normalizeMasterDataSelectValue(type, select.dataset.masterdataDefault);
        let targetValue = normalizedPreviousValue || defaultValue || '';
        if (!targetValue && !placeholder && values.length > 0) {
            targetValue = normalizeMasterDataSelectValue(type, values[0]);
        }
        if (targetValue) {
            select.value = targetValue;
            if (select.value !== targetValue) {
                const fallbackOption = document.createElement('option');
                fallbackOption.value = targetValue;
                fallbackOption.textContent = targetValue;
                fallbackOption.dataset.masterdataFallback = 'true';
                select.appendChild(fallbackOption);
                select.value = targetValue;
            }
        } else {
            select.value = '';
        }
        select.dataset.masterdataPendingValue = '';
    });
}

function renderMasterDataManagement(snapshot = getMasterDataSnapshot()) {
    renderMasterDataList('steelGrades', snapshot.steelGrades);
    renderMasterDataList('rollDiameters', snapshot.rollDiameters);
    renderMasterDataList('meshTypes', snapshot.meshTypes);
    updateMasterDataSelects(snapshot);
}

function showMasterDataFeedback(type, message) {
    const config = MASTER_DATA_CONFIG[type];
    if (!config) return;
    const feedbackEl = document.getElementById(config.feedbackId);
    if (!feedbackEl) return;
    feedbackEl.textContent = message || '';
    if (masterDataFeedbackTimers[type]) {
        clearTimeout(masterDataFeedbackTimers[type]);
    }
    if (message) {
        masterDataFeedbackTimers[type] = setTimeout(() => {
            if (feedbackEl) {
                feedbackEl.textContent = '';
            }
        }, 4000);
    }
}

function handleMasterDataFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form?.dataset?.masterdataForm;
    if (!type) return;
    const input = form.querySelector('[data-masterdata-input]');
    if (!input) return;
    const result = addMasterDataValue(type, input.value);
    if (result.success) {
        showMasterDataFeedback(type, getTranslation('Wert hinzugefügt', 'Wert hinzugefügt'));
        input.value = '';
        input.focus();
    } else if (result.message) {
        showMasterDataFeedback(type, result.message);
    }
}

function handleMasterDataListClick(event) {
    const button = event.target.closest('[data-masterdata-remove]');
    if (!button) return;
    const type = button.dataset.masterdataRemove;
    if (!type) return;
    const result = removeMasterDataValue(type, button.dataset.value);
    if (result.success) {
        showMasterDataFeedback(type, getTranslation('Wert entfernt', 'Wert entfernt'));
    } else if (result.message) {
        showMasterDataFeedback(type, result.message);
    }
}

function setupMasterDataUI() {
    document.querySelectorAll('[data-masterdata-form]').forEach(form => {
        form.addEventListener('submit', handleMasterDataFormSubmit);
    });
    document.querySelectorAll('[data-masterdata-list]').forEach(list => {
        list.addEventListener('click', handleMasterDataListClick);
    });
}

loadMasterData();
masterDataSubscribers.add(renderMasterDataManagement);
ensureMasterDataManager();
renderMasterDataManagement();
notifyMasterDataSubscribers();

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
    if (view === 'resourcesView') {
        renderResourceList();
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

function showResourcesView() {
    showView('resourcesView');
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

function generateResourceId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `resource-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseResourceNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const stringValue = String(value).trim();
    if (stringValue.length === 0) {
        return null;
    }
    const normalized = stringValue.replace(',', '.');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
}

function normalizeResourceNumericValue(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (value === null || value === undefined || value === '') {
        return null;
    }
    return parseResourceNumber(value);
}

function parseResourceRollDiameterList(value) {
    if (Array.isArray(value)) {
        return value
            .map(parseResourceNumber)
            .filter(number => Number.isFinite(number) && number > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(/[,;\s]+/)
            .map(parseResourceNumber)
            .filter(number => Number.isFinite(number) && number > 0);
    }
    return [];
}

function normalizeRollDiameterValues(value) {
    const parsed = parseResourceRollDiameterList(value);
    const unique = [];
    parsed.forEach(number => {
        if (!unique.some(existing => Math.abs(existing - number) < 1e-6)) {
            unique.push(number);
        }
    });
    return unique.sort((a, b) => a - b);
}

function formatRollDiameterInput(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return '';
    }
    return values
        .map(value => {
            if (!Number.isFinite(value)) {
                return '';
            }
            const decimals = Number.isInteger(value) ? 0 : 1;
            return formatNumberLocalized(value, decimals);
        })
        .filter(Boolean)
        .join(', ');
}

function loadResources() {
    try {
        const stored = localStorage.getItem(RESOURCE_STORAGE_KEY);
        if (!stored) {
            resources = [];
            return;
        }
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            resources = [];
            return;
        }
        resources = parsed.map(item => {
            const normalizedItem = (item && typeof item === 'object') ? item : {};
            const supportedTypes = Array.isArray(normalizedItem.supportedTypes)
                ? normalizedItem.supportedTypes.filter(type => typeof type === 'string')
                : [];
            let createdAt = new Date().toISOString();
            if (typeof normalizedItem.createdAt === 'string' && normalizedItem.createdAt) {
                createdAt = normalizedItem.createdAt;
            } else if (typeof normalizedItem.createdAt === 'number' && Number.isFinite(normalizedItem.createdAt)) {
                const createdDate = new Date(normalizedItem.createdAt);
                createdAt = Number.isNaN(createdDate.getTime()) ? createdAt : createdDate.toISOString();
            }
            return {
                id: typeof normalizedItem.id === 'string' && normalizedItem.id ? normalizedItem.id : generateResourceId(),
                name: typeof normalizedItem.name === 'string' ? normalizedItem.name : '',
                description: typeof normalizedItem.description === 'string' ? normalizedItem.description : '',
                minDiameter: normalizeResourceNumericValue(normalizedItem.minDiameter),
                maxDiameter: normalizeResourceNumericValue(normalizedItem.maxDiameter),
                minLegLength: normalizeResourceNumericValue(normalizedItem.minLegLength),
                maxLegLength: normalizeResourceNumericValue(normalizedItem.maxLegLength),
                supportedTypes,
                availableRollDiameters: normalizeRollDiameterValues(normalizedItem.availableRollDiameters),
                createdAt
            };
        });
    } catch (error) {
        console.error('Could not load resources', error);
        resources = [];
    }
}

function persistResources() {
    try {
        localStorage.setItem(RESOURCE_STORAGE_KEY, JSON.stringify(resources));
        notifyResourceSubscribers();
    } catch (error) {
        console.error('Could not store resources', error);
    }
}

function setResourceFormMode(mode) {
    const title = document.getElementById('resourceFormTitle');
    const submit = document.getElementById('resourceFormSubmit');
    const resetButton = document.getElementById('resourceFormReset');
    const cancelButton = document.getElementById('resourceFormCancel');
    const titleKey = mode === 'edit' ? 'Ressource bearbeiten' : 'Neue Ressource anlegen';
    if (title) {
        title.dataset.i18n = titleKey;
        title.textContent = getTranslation(titleKey, titleKey);
    }
    const submitKey = mode === 'edit' ? 'Änderungen speichern' : 'Ressource speichern';
    if (submit) {
        submit.dataset.i18n = submitKey;
        submit.textContent = getTranslation(submitKey, submitKey);
    }
    if (resetButton) {
        resetButton.hidden = mode === 'edit';
    }
    if (cancelButton) {
        cancelButton.hidden = mode !== 'edit';
    }
}

function resetResourceForm() {
    const form = document.getElementById('resourceForm');
    if (!form) return;
    form.reset();
    editingResourceId = null;
    setResourceFormMode('create');
    const maxDiameterInput = document.getElementById('resourceMaxDiameter');
    if (maxDiameterInput) {
        maxDiameterInput.setCustomValidity('');
    }
    const maxLegLengthInput = document.getElementById('resourceMaxLegLength');
    if (maxLegLengthInput) {
        maxLegLengthInput.setCustomValidity('');
    }
    const rollDiametersInput = document.getElementById('resourceRollDiameters');
    if (rollDiametersInput) {
        rollDiametersInput.value = '';
    }
}

function showResourceFeedback(message, type = 'info') {
    const feedback = document.getElementById('resourceFormFeedback');
    if (!feedback) return;
    clearTimeout(resourceFeedbackTimer);
    if (!message) {
        feedback.textContent = '';
        feedback.className = 'info-text';
        return;
    }
    feedback.textContent = message;
    feedback.className = `info-text ${type}-message`;
    resourceFeedbackTimer = setTimeout(() => {
        feedback.textContent = '';
        feedback.className = 'info-text';
    }, 4000);
}

function formatResourceRange(min, max, unit) {
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) {
        return null;
    }
    const decimalsMin = hasMin && !Number.isInteger(min) ? 1 : 0;
    const decimalsMax = hasMax && !Number.isInteger(max) ? 1 : 0;
    const decimals = Math.max(decimalsMin, decimalsMax);
    const unitSuffix = unit ? ` ${unit}` : '';
    if (hasMin && hasMax) {
        return `${formatNumberLocalized(min, decimals)} – ${formatNumberLocalized(max, decimals)}${unitSuffix}`;
    }
    if (hasMin) {
        return `≥ ${formatNumberLocalized(min, decimals)}${unitSuffix}`;
    }
    return `≤ ${formatNumberLocalized(max, decimals)}${unitSuffix}`;
}

function formatDiameterRange(min, max) {
    const range = formatResourceRange(min, max, 'mm');
    if (!range) {
        return getTranslation('Keine Angabe', 'Keine Angabe');
    }
    return `Ø ${range}`;
}

function createResourceMetric(label, value) {
    const metric = document.createElement('div');
    metric.className = 'resource-metric';
    const labelEl = document.createElement('span');
    labelEl.className = 'resource-metric-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'resource-metric-value';
    valueEl.textContent = value || getTranslation('Keine Angabe', 'Keine Angabe');
    metric.appendChild(labelEl);
    metric.appendChild(valueEl);
    return metric;
}

function renderResourceList() {
    const list = document.getElementById('resourceList');
    const emptyState = document.getElementById('resourceEmptyState');
    if (!list || !emptyState) return;

    list.innerHTML = '';
    if (!Array.isArray(resources) || resources.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;
    const typeLabels = {
        '2d': getTranslation('Biegeformen 2D', 'Biegeformen 2D'),
        '3d': getTranslation('Biegeformen 3D', 'Biegeformen 3D'),
        'mesh': getTranslation('Matten', 'Matten')
    };

    const sorted = [...resources].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    sorted.forEach(resource => {
        const item = document.createElement('article');
        item.className = 'resource-item';
        item.setAttribute('role', 'listitem');

        const header = document.createElement('div');
        header.className = 'resource-item-header';

        const title = document.createElement('h3');
        title.className = 'resource-item-title';
        title.textContent = resource.name || getTranslation('Ressourcename', 'Ressourcename');
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'resource-item-actions';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'resource-action';
        editButton.dataset.action = 'edit';
        editButton.dataset.id = resource.id;
        editButton.textContent = getTranslation('Bearbeiten', 'Bearbeiten');
        actions.appendChild(editButton);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'resource-action resource-action--danger';
        deleteButton.dataset.action = 'delete';
        deleteButton.dataset.id = resource.id;
        deleteButton.textContent = getTranslation('Löschen', 'Löschen');
        actions.appendChild(deleteButton);

        header.appendChild(actions);
        item.appendChild(header);

        if (resource.description) {
            const description = document.createElement('p');
            description.className = 'resource-item-description';
            description.textContent = resource.description;
            item.appendChild(description);
        }

        const metrics = document.createElement('div');
        metrics.className = 'resource-item-metrics';
        metrics.appendChild(createResourceMetric(
            getTranslation('Stabdurchmesser', 'Stabdurchmesser'),
            formatDiameterRange(resource.minDiameter, resource.maxDiameter)
        ));
        metrics.appendChild(createResourceMetric(
            getTranslation('Schenkellänge', 'Schenkellänge'),
            formatResourceRange(resource.minLegLength, resource.maxLegLength, 'mm') || getTranslation('Keine Angabe', 'Keine Angabe')
        ));
        item.appendChild(metrics);

        const supportedWrap = document.createElement('div');
        supportedWrap.className = 'resource-item-supported';

        const supportedLabel = document.createElement('span');
        supportedLabel.className = 'resource-section-label';
        supportedLabel.textContent = getTranslation('Unterstützte Biegeformen', 'Unterstützte Biegeformen');
        supportedWrap.appendChild(supportedLabel);

        const badges = document.createElement('div');
        badges.className = 'resource-badges';

        if (resource.supportedTypes && resource.supportedTypes.length > 0) {
            resource.supportedTypes.forEach(type => {
                const badge = document.createElement('span');
                badge.className = 'resource-badge';
                badge.textContent = typeLabels[type] || type;
                badges.appendChild(badge);
            });
        } else {
            const badge = document.createElement('span');
            badge.className = 'resource-badge resource-badge--muted';
            badge.textContent = getTranslation('Keine Auswahl', 'Keine Auswahl');
            badges.appendChild(badge);
        }

        supportedWrap.appendChild(badges);
        item.appendChild(supportedWrap);

        const rollWrap = document.createElement('div');
        rollWrap.className = 'resource-item-supported';

        const rollLabel = document.createElement('span');
        rollLabel.className = 'resource-section-label';
        rollLabel.textContent = getTranslation('Verfügbare Biegerollen', 'Verfügbare Biegerollen');
        rollWrap.appendChild(rollLabel);

        const rollBadges = document.createElement('div');
        rollBadges.className = 'resource-badges';
        if (Array.isArray(resource.availableRollDiameters) && resource.availableRollDiameters.length > 0) {
            resource.availableRollDiameters.forEach(value => {
                const badge = document.createElement('span');
                badge.className = 'resource-badge';
                const decimals = Number.isInteger(value) ? 0 : 1;
                badge.textContent = `${formatNumberLocalized(value, decimals)} mm`;
                rollBadges.appendChild(badge);
            });
        } else {
            const badge = document.createElement('span');
            badge.className = 'resource-badge resource-badge--muted';
            badge.textContent = getTranslation('Keine Angabe', 'Keine Angabe');
            rollBadges.appendChild(badge);
        }
        rollWrap.appendChild(rollBadges);
        item.appendChild(rollWrap);

        if (resource.createdAt) {
            const created = new Date(resource.createdAt);
            if (!Number.isNaN(created.getTime())) {
                const footer = document.createElement('div');
                footer.className = 'resource-item-footer';
                footer.textContent = `${getTranslation('Angelegt am', 'Angelegt am')} ${created.toLocaleString()}`;
                item.appendChild(footer);
            }
        }

        list.appendChild(item);
    });
}

function populateResourceForm(resourceId) {
    const resource = resources.find(item => item.id === resourceId);
    if (!resource) {
        return;
    }
    const form = document.getElementById('resourceForm');
    if (!form) {
        return;
    }
    editingResourceId = resourceId;
    const nameInput = form.querySelector('#resourceName');
    const descriptionInput = form.querySelector('#resourceDescription');
    const minDiameterInput = form.querySelector('#resourceMinDiameter');
    const maxDiameterInput = form.querySelector('#resourceMaxDiameter');
    const minLegInput = form.querySelector('#resourceMinLegLength');
    const maxLegInput = form.querySelector('#resourceMaxLegLength');
    const rollDiametersInput = form.querySelector('#resourceRollDiameters');
    const rollDiametersInput = form.querySelector('#resourceRollDiameters');
    if (nameInput) nameInput.value = resource.name || '';
    if (descriptionInput) descriptionInput.value = resource.description || '';
    if (minDiameterInput) minDiameterInput.value = resource.minDiameter ?? '';
    if (maxDiameterInput) {
        maxDiameterInput.value = resource.maxDiameter ?? '';
        maxDiameterInput.setCustomValidity('');
    }
    if (minLegInput) minLegInput.value = resource.minLegLength ?? '';
    if (maxLegInput) {
        maxLegInput.value = resource.maxLegLength ?? '';
        maxLegInput.setCustomValidity('');
    }
    if (rollDiametersInput) {
        rollDiametersInput.value = formatRollDiameterInput(resource.availableRollDiameters);
    }
    const typeInputs = form.querySelectorAll('input[name="resourceTypes"]');
    typeInputs.forEach(input => {
        input.checked = Array.isArray(resource.supportedTypes) ? resource.supportedTypes.includes(input.value) : false;
    });
    setResourceFormMode('edit');
    showResourceFeedback('');
    if (nameInput) {
        nameInput.focus();
    }
}

function deleteResource(resourceId) {
    const resource = resources.find(item => item.id === resourceId);
    if (!resource) {
        return;
    }
    const confirmation = getTranslation(
        'Soll die Ressource "{resourceName}" wirklich gelöscht werden?',
        'Soll die Ressource "{resourceName}" wirklich gelöscht werden?',
        { resourceName: resource.name || '' }
    );
    if (!window.confirm(confirmation)) {
        return;
    }
    resources = resources.filter(item => item.id !== resourceId);
    persistResources();
    renderResourceList();
    if (editingResourceId === resourceId) {
        resetResourceForm();
    }
    showResourceFeedback(getTranslation('Ressource gelöscht.', 'Ressource gelöscht.'), 'success');
}

function handleResourceListClick(event) {
    const actionButton = event.target.closest('button[data-action]');
    if (!actionButton) {
        return;
    }
    const resourceId = actionButton.dataset.id;
    if (!resourceId) {
        return;
    }
    if (actionButton.dataset.action === 'edit') {
        populateResourceForm(resourceId);
    } else if (actionButton.dataset.action === 'delete') {
        deleteResource(resourceId);
    }
}

function handleResourceFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (!form) {
        return;
    }
    const nameInput = form.querySelector('#resourceName');
    if (!nameInput) {
        return;
    }
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        nameInput.reportValidity();
        return;
    }
    const descriptionInput = form.querySelector('#resourceDescription');
    const minDiameterInput = form.querySelector('#resourceMinDiameter');
    const maxDiameterInput = form.querySelector('#resourceMaxDiameter');
    const minLegInput = form.querySelector('#resourceMinLegLength');
    const maxLegInput = form.querySelector('#resourceMaxLegLength');

    const minDiameter = parseResourceNumber(minDiameterInput ? minDiameterInput.value : null);
    const maxDiameter = parseResourceNumber(maxDiameterInput ? maxDiameterInput.value : null);
    const minLegLength = parseResourceNumber(minLegInput ? minLegInput.value : null);
    const maxLegLength = parseResourceNumber(maxLegInput ? maxLegInput.value : null);

    const rangeMessage = getTranslation('Maximalwert muss größer oder gleich dem Minimalwert sein.', 'Der Maximalwert muss größer oder gleich dem Minimalwert sein.');
    if (maxDiameterInput) {
        maxDiameterInput.setCustomValidity('');
    }
    if (maxLegInput) {
        maxLegInput.setCustomValidity('');
    }
    if (minDiameter !== null && maxDiameter !== null && maxDiameter < minDiameter) {
        if (maxDiameterInput) {
            maxDiameterInput.setCustomValidity(rangeMessage);
            maxDiameterInput.reportValidity();
        }
        return;
    }
    if (minLegLength !== null && maxLegLength !== null && maxLegLength < minLegLength) {
        if (maxLegInput) {
            maxLegInput.setCustomValidity(rangeMessage);
            maxLegInput.reportValidity();
        }
        return;
    }

    const description = descriptionInput ? descriptionInput.value.trim() : '';
    const supportedTypes = Array.from(form.querySelectorAll('input[name="resourceTypes"]:checked')).map(input => input.value);
    const availableRollDiameters = normalizeRollDiameterValues(rollDiametersInput ? rollDiametersInput.value : []);

    if (editingResourceId) {
        const index = resources.findIndex(item => item.id === editingResourceId);
        if (index !== -1) {
            resources[index] = {
                ...resources[index],
                name,
                description,
                minDiameter,
                maxDiameter,
                minLegLength,
                maxLegLength,
                supportedTypes,
                availableRollDiameters
            };
            persistResources();
            renderResourceList();
            showResourceFeedback(getTranslation('Ressource aktualisiert.', 'Ressource aktualisiert.'), 'success');
        }
    } else {
        const newResource = {
            id: generateResourceId(),
            name,
            description,
            minDiameter,
            maxDiameter,
            minLegLength,
            maxLegLength,
            supportedTypes,
            availableRollDiameters,
            createdAt: new Date().toISOString()
        };
        resources.push(newResource);
        persistResources();
        renderResourceList();
        showResourceFeedback(getTranslation('Ressource gespeichert.', 'Ressource gespeichert.'), 'success');
    }

    resetResourceForm();
}

document.addEventListener('DOMContentLoaded', () => {
    loadAppSettings();
    applyAppSettings();
    loadResources();
    renderResourceList();
    resetResourceForm();
    notifyResourceSubscribers();
    setupMasterDataUI();
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
    document.getElementById('showResourcesBtn')?.addEventListener('click', () => {
        showResourcesView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('showSettingsBtn')?.addEventListener('click', () => {
        showSettingsView();
        closeSidebarOnSmallScreens();
    });
    document.getElementById('resourceForm')?.addEventListener('submit', handleResourceFormSubmit);
    document.getElementById('resourceFormReset')?.addEventListener('click', () => {
        resetResourceForm();
        showResourceFeedback('');
    });
    document.getElementById('resourceFormCancel')?.addEventListener('click', () => {
        resetResourceForm();
        showResourceFeedback('');
    });
    document.getElementById('resourceList')?.addEventListener('click', handleResourceListClick);
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
