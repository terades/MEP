/* global i18n, showFeedback */
(function () {
    const META_DEFAULTS = Object.freeze({
        project: '',
        order: '',
        position: '',
        diameter: 12,
        rollDiameter: 48,
        quantity: 1,
        steelGrade: 'B500B',
        remark: ''
    });

    const state = {
        segments: [],
        meta: { ...META_DEFAULTS },
        datasetText: '',
        previewNoteOverride: null,
        viewMode: '2d'
    };

    let initialized = false;
    let segmentIdCounter = 0;
    let rollDiameterAuto = true;
    let standardShapes = [];

    const RESOURCE_STORAGE_KEY = 'bvbsResources';
    const RESOURCE_TYPE_2D = '2d';
    const ROLL_MATCH_TOLERANCE_MM = 0.5;

    let availableResources = [];
    let resourceSubscriptionCleanup = null;
    let resourcesEventListenerRegistered = false;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const dimensionPreferences = {
        showLengths: true,
        showRadii: true
    };
    const preview3dPreferences = {
        showDimensions: true,
        showZoneLengths: true,
        showOverhangs: true
    };
    const DIMENSION_CONFIG = Object.freeze({
        lengthOffsetPx: 16,
        lengthTextGapPx: 10,
        lengthTextExtraGapPx: 18,
        minLengthTextSpanPx: 50,
        approxCharWidthPx: 6.5,
        radiusInnerOffsetPx: 14,
        radiusTextOffsetPx: 10,
        angleTextOffsetPx: 24,
        minArcTextWidthPx: 48
    });
    const SAVED_FORMS_STORAGE_KEY = 'bf2dSavedForms';
    const ABS_START_TOKEN_REGEX = /^(BF2D|BF3D|BFWE|BFMA|BFGT|BFAU)@/;
    const ABS_BLOCK_START_REGEX = /(?:(?<=@)|^)([HGMAPCXYE])/g;
    const ABS_FIELD_REGEX = /([a-z])([^@]*)@/g;
    const importState = {
        entries: [],
        selectedIds: new Set(),
        activeId: null,
        fileName: '',
        lastError: null
    };

    function createSvgElement(tagName, attributes = {}) {
        const element = document.createElementNS(SVG_NS, tagName);
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            element.setAttribute(key, String(value));
        });
        return element;
    }

    function toFiniteNumber(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function normalizeResourceTypes(values) {
        if (!Array.isArray(values)) {
            return [];
        }
        const seen = new Set();
        return values
            .map(value => String(value || '').trim())
            .filter(value => {
                if (!value) return false;
                if (seen.has(value)) return false;
                seen.add(value);
                return true;
            });
    }

    function parseRollDiametersValue(value) {
        if (Array.isArray(value)) {
            return value
                .map(entry => {
                    if (typeof entry === 'string') {
                        return Number.parseFloat(entry.replace(',', '.'));
                    }
                    return Number(entry);
                })
                .filter(num => Number.isFinite(num) && num > 0);
        }
        if (typeof value === 'string') {
            return value
                .split(/[,;\s]+/)
                .map(part => Number.parseFloat(part.replace(',', '.')))
                .filter(num => Number.isFinite(num) && num > 0);
        }
        return [];
    }

    function normalizeRollDiameters(value) {
        const parsed = parseRollDiametersValue(value);
        const unique = [];
        parsed.forEach(num => {
            if (!unique.some(existing => Math.abs(existing - num) <= 1e-6)) {
                unique.push(num);
            }
        });
        return unique.sort((a, b) => a - b);
    }

    function normalizeResourceEntry(resource) {
        const data = (typeof resource === 'object' && resource !== null) ? resource : {};
        return {
            id: typeof data.id === 'string' ? data.id : '',
            name: typeof data.name === 'string' ? data.name : '',
            description: typeof data.description === 'string' ? data.description : '',
            minDiameter: toFiniteNumber(data.minDiameter),
            maxDiameter: toFiniteNumber(data.maxDiameter),
            supportedTypes: normalizeResourceTypes(data.supportedTypes),
            availableRollDiameters: normalizeRollDiameters(data.availableRollDiameters)
        };
    }

    function getResourcesFromLocalStorage() {
        try {
            if (typeof localStorage === 'undefined') {
                return [];
            }
            const raw = localStorage.getItem(RESOURCE_STORAGE_KEY);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.map(normalizeResourceEntry);
        } catch (error) {
            console.warn('Could not read stored resources', error);
            return [];
        }
    }

    function setAvailableResources(resources) {
        if (!Array.isArray(resources)) {
            availableResources = [];
        } else {
            availableResources = resources.map(normalizeResourceEntry);
        }
        if (initialized) {
            updateMachineCompatibility();
        }
    }

    function setupResourceIntegration() {
        if (!resourcesEventListenerRegistered) {
            resourcesEventListenerRegistered = true;
            window.addEventListener('bvbs:resources-changed', event => {
                if (Array.isArray(event?.detail?.resources)) {
                    setAvailableResources(event.detail.resources);
                }
            });
        }
        if (typeof resourceSubscriptionCleanup === 'function') {
            resourceSubscriptionCleanup();
            resourceSubscriptionCleanup = null;
        }
        if (window.resourceManager && typeof window.resourceManager.subscribe === 'function') {
            resourceSubscriptionCleanup = window.resourceManager.subscribe(setAvailableResources);
        } else {
            setAvailableResources(getResourcesFromLocalStorage());
        }
    }

    function evaluateResourceCompatibility(resource, requirements) {
        if (!resource || typeof resource !== 'object') {
            return null;
        }
        const supportedTypes = Array.isArray(resource.supportedTypes) ? resource.supportedTypes : [];
        if (supportedTypes.length > 0) {
            const supports2d = supportedTypes.some(type => String(type).toLowerCase() === RESOURCE_TYPE_2D);
            if (!supports2d) {
                return null;
            }
        }
        const minDiameter = toFiniteNumber(resource.minDiameter);
        const maxDiameter = toFiniteNumber(resource.maxDiameter);
        const diameter = requirements.diameter;
        if (Number.isFinite(minDiameter) && diameter + 1e-6 < minDiameter) {
            return null;
        }
        if (Number.isFinite(maxDiameter) && diameter - 1e-6 > maxDiameter) {
            return null;
        }
        let matchedRolls = [];
        if (requirements.requiresRoll) {
            const rolls = Array.isArray(resource.availableRollDiameters) ? resource.availableRollDiameters : [];
            if (rolls.length > 0) {
                matchedRolls = rolls.filter(value => Math.abs(value - requirements.rollDiameter) <= ROLL_MATCH_TOLERANCE_MM);
                if (!matchedRolls.length) {
                    return null;
                }
            }
        }
        return { resource, matchedRolls };
    }

    function getRollRadius() {
        const rollDiameter = Number(state.meta.rollDiameter);
        if (!Number.isFinite(rollDiameter) || rollDiameter <= 0) {
            return 0;
        }
        return rollDiameter / 2;
    }

    function enforceMinimumRadius(radius) {
        const rollRadius = getRollRadius();
        const numericRadius = Number(radius);
        if (!Number.isFinite(numericRadius) || numericRadius <= 0) {
            return 0;
        }
        if (rollRadius > 0 && numericRadius <= rollRadius) {
            return rollRadius + 1;
        }
        return numericRadius;
    }

    function createSegment(length, bendAngle, bendDirection = 'L', radius = null) {
        const numericLength = Number(length) || 0;
        const numericAngle = Number(bendAngle) || 0;
        const normalizedDirection = bendDirection === 'R' ? 'R' : 'L';
        let numericRadius = 0;
        if (numericAngle > 0) {
            if (radius === null || typeof radius === 'undefined') {
                numericRadius = enforceMinimumRadius(getRollRadius());
            } else {
                numericRadius = enforceMinimumRadius(Number(radius) || 0);
            }
        }
        return {
            id: ++segmentIdCounter,
            length: numericLength,
            bendAngle: numericAngle,
            bendDirection: normalizedDirection,
            radius: numericRadius
        };
    }

    function clampNumber(value, min, max = Number.POSITIVE_INFINITY) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return min;
        }
        return Math.min(Math.max(num, min), max);
    }

    function formatNumberForInput(value, decimals = 1) {
        if (!Number.isFinite(value)) return '';
        const rounded = Number(value).toFixed(decimals);
        const normalized = parseFloat(rounded);
        if (Number.isNaN(normalized)) {
            return '';
        }
        return normalized.toString();
    }

    function formatNumberForDataset(value) {
        if (!Number.isFinite(value)) {
            return '0.0';
        }
        return (Math.round(value * 10) / 10).toFixed(1);
    }

    function formatDisplayNumber(value, decimals = 1) {
        if (!Number.isFinite(value)) {
            return '0';
        }
        const factor = Math.pow(10, decimals);
        const rounded = Math.round(value * factor) / factor;
        let text = rounded.toFixed(decimals);
        if (decimals > 0) {
            text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        }
        return text;
    }

    function areNumbersClose(a, b, epsilon = 1e-6) {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return false;
        }
        const diff = Math.abs(a - b);
        const scale = Math.max(1, Math.abs(a), Math.abs(b));
        return diff <= epsilon * scale;
    }

    function applyRollDiameterToSegments() {
        const rollRadius = getRollRadius();
        state.segments.forEach((segment, index) => {
            const isLast = index === state.segments.length - 1;
            const angle = Number(segment.bendAngle) || 0;
            if (isLast || angle <= 0) {
                segment.radius = 0;
            } else {
                if (rollRadius > 0) {
                    segment.radius = enforceMinimumRadius(rollRadius);
                } else {
                    segment.radius = enforceMinimumRadius(segment.radius);
                }
            }
        });
    }

    function updateSegmentRadiusInputs() {
        const inputs = document.querySelectorAll('.bf2d-radius-input');
        inputs.forEach(input => {
            const segmentId = Number(input.dataset.segmentId);
            if (!segmentId) return;
            const segment = state.segments.find(item => item.id === segmentId);
            if (!segment) return;
            const formatted = formatNumberForInput(segment.radius);
            if (input.value !== formatted) {
                input.value = formatted;
            }
        });
    }

    function rollValueKey(value) {
        return Number(value || 0).toFixed(3);
    }

    function formatMachineDiameterText(resource) {
        const min = toFiniteNumber(resource.minDiameter);
        const max = toFiniteNumber(resource.maxDiameter);
        const formatValue = value => formatDisplayNumber(value, Number.isInteger(value) ? 0 : 1);
        if (Number.isFinite(min) && Number.isFinite(max)) {
            if (Math.abs(min - max) <= 1e-6) {
                return `Ø ${formatValue(min)} mm`;
            }
            return `Ø ${formatValue(min)} – ${formatValue(max)} mm`;
        }
        if (Number.isFinite(min)) {
            return `Ø ≥ ${formatValue(min)} mm`;
        }
        if (Number.isFinite(max)) {
            return `Ø ≤ ${formatValue(max)} mm`;
        }
        return '';
    }

    function renderRollChips(container, resource, matchedRolls = []) {
        if (!container) return;
        container.innerHTML = '';
        const values = Array.isArray(resource.availableRollDiameters) ? resource.availableRollDiameters : [];
        const matchKeys = new Set(matchedRolls.map(rollValueKey));
        if (!values.length) {
            const chip = document.createElement('span');
            chip.className = 'bf2d-machine-chip';
            chip.textContent = translateText('Keine Angabe');
            container.appendChild(chip);
            return;
        }
        values.forEach(value => {
            const chip = document.createElement('span');
            chip.className = 'bf2d-machine-chip';
            const decimals = Number.isInteger(value) ? 0 : 1;
            chip.textContent = `${formatDisplayNumber(value, decimals)} mm`;
            if (matchKeys.has(rollValueKey(value))) {
                chip.classList.add('bf2d-machine-chip--match');
            }
            container.appendChild(chip);
        });
    }

    function updateMachineCompatibility(summary = null) {
        if (!initialized) return;
        const statusEl = document.getElementById('bf2dMachineCompatibilityStatus');
        const listEl = document.getElementById('bf2dMachineCompatibilityList');
        if (!statusEl || !listEl) {
            return;
        }

        const resources = Array.isArray(availableResources) ? availableResources : [];
        listEl.innerHTML = '';

        if (!resources.length) {
            statusEl.textContent = translateText('Keine Ressourcen vorhanden');
            return;
        }

        const effectiveSummary = summary || computeSummary();
        const diameter = Number(state.meta.diameter);
        const rollDiameter = Number(state.meta.rollDiameter);
        const requiresRoll = !!effectiveSummary?.requiresRollDiameter;

        if (!Number.isFinite(diameter) || diameter <= 0) {
            statusEl.textContent = translateText('Bitte Durchmesser eingeben, um passende Maschinen zu ermitteln.');
            return;
        }

        if (requiresRoll && (!Number.isFinite(rollDiameter) || rollDiameter <= 0)) {
            statusEl.textContent = translateText('Biegerollendurchmesser muss größer als 0 sein.');
            return;
        }

        const compatible = resources
            .map(resource => evaluateResourceCompatibility(resource, { diameter, rollDiameter, requiresRoll }))
            .filter(Boolean);

        if (!compatible.length) {
            statusEl.textContent = translateText('Keine geeignete Maschine gefunden.');
            return;
        }

        statusEl.textContent = translateText('Passende Maschinen: {count}', { count: compatible.length });

        compatible
            .sort((a, b) => a.resource.name.localeCompare(b.resource.name, undefined, { sensitivity: 'base' }))
            .forEach(entry => {
                const { resource, matchedRolls } = entry;
                const item = document.createElement('li');
                item.className = 'bf2d-machine-list-item';

                const nameEl = document.createElement('span');
                nameEl.className = 'bf2d-machine-name';
                nameEl.textContent = resource.name || translateText('Ressourcename');
                item.appendChild(nameEl);

                const metaEl = document.createElement('div');
                metaEl.className = 'bf2d-machine-meta';
                const diameterText = formatMachineDiameterText(resource);
                if (diameterText) {
                    const diameterSpan = document.createElement('span');
                    diameterSpan.textContent = diameterText;
                    metaEl.appendChild(diameterSpan);
                }
                const rollLabel = document.createElement('span');
                rollLabel.textContent = `${translateText('Roll-Ø')}:`;
                metaEl.appendChild(rollLabel);
                item.appendChild(metaEl);

                const chipContainer = document.createElement('div');
                chipContainer.className = 'bf2d-machine-chips';
                renderRollChips(chipContainer, resource, matchedRolls);
                item.appendChild(chipContainer);

                listEl.appendChild(item);
            });
    }

    function setRollDiameterValue(value, { updateInput = true, fromUser = false } = {}) {
        const parsed = clampNumber(parseFloat(value), 0, 100000);
        state.meta.rollDiameter = parsed;
        if (updateInput) {
            const rollInput = document.getElementById('bf2dRollDiameter');
            if (rollInput) {
                rollInput.value = formatNumberForInput(parsed);
            }
        }
        const diameter = Number(state.meta.diameter);
        if (Number.isFinite(diameter) && diameter > 0) {
            const defaultRoll = diameter * 4;
            const isDefault = areNumbersClose(parsed, defaultRoll);
            if (fromUser) {
                rollDiameterAuto = isDefault;
            } else if (rollDiameterAuto) {
                rollDiameterAuto = isDefault;
            } else if (isDefault) {
                rollDiameterAuto = true;
            }
        } else {
            rollDiameterAuto = true;
        }
        applyRollDiameterToSegments();
        updateSegmentRadiusInputs();
    }

    function enforceLastSegmentDefaults() {
        if (!state.segments.length) return;
        const last = state.segments[state.segments.length - 1];
        last.bendAngle = 0;
        last.radius = 0;
        last.bendDirection = last.bendDirection === 'R' ? 'R' : 'L';
    }

    function initDefaultSegments() {
        state.segments = [
            createSegment(800, 90, 'L'),
            createSegment(400, 90, 'L'),
            createSegment(600, 0, 'L', 0)
        ];
        enforceLastSegmentDefaults();
        applyRollDiameterToSegments();
    }

    function metaFieldDefinitions() {
        return [
            { id: 'bf2dProject', key: 'project', parser: value => (value || '').trim() },
            { id: 'bf2dOrder', key: 'order', parser: value => (value || '').trim() },
            { id: 'bf2dPosition', key: 'position', parser: value => (value || '').trim() },
            {
                id: 'bf2dDiameter',
                key: 'diameter',
                parser: value => clampNumber(parseFloat(value), 0.1, 200)
            },
            {
                id: 'bf2dRollDiameter',
                key: 'rollDiameter',
                parser: value => clampNumber(parseFloat(value), 0, 100000)
            },
            {
                id: 'bf2dQuantity',
                key: 'quantity',
                parser: value => Math.max(1, Math.round(parseFloat(value) || 0))
            },
            { id: 'bf2dSteelGrade', key: 'steelGrade', parser: value => (value || '').trim() },
            { id: 'bf2dRemark', key: 'remark', parser: value => (value || '').trim() }
        ];
    }

    function readMetaFromInputs() {
        metaFieldDefinitions().forEach(def => {
            const el = document.getElementById(def.id);
            if (!el) return;
            state.meta[def.key] = def.parser(el.value);
        });
    }

    function writeMetaToInputs() {
        metaFieldDefinitions().forEach(def => {
            const el = document.getElementById(def.id);
            if (!el) return;
            const value = state.meta[def.key];
            if (def.key === 'diameter' || def.key === 'rollDiameter') {
                const formatted = formatNumberForInput(value);
                if (def.key === 'rollDiameter' && formatted && window.masterDataManager?.addValue) {
                    window.masterDataManager.addValue('rollDiameters', Number(formatted));
                }
                el.value = formatted;
                if (el.tagName === 'SELECT' && formatted && el.value !== formatted) {
                    el.dataset.masterdataPendingValue = formatted;
                    if (typeof window.masterDataManager?.refreshSelects === 'function') {
                        window.masterDataManager.refreshSelects();
                    }
                }
            } else if (def.key === 'quantity') {
                el.value = Number.isFinite(value) ? String(Math.round(value)) : '1';
            } else {
                const textValue = value !== undefined && value !== null ? String(value) : '';
                if (def.key === 'steelGrade' && textValue && window.masterDataManager?.addValue) {
                    window.masterDataManager.addValue('steelGrades', textValue);
                }
                el.value = textValue;
                if (el.tagName === 'SELECT' && textValue && el.value !== textValue) {
                    el.dataset.masterdataPendingValue = textValue;
                    if (typeof window.masterDataManager?.refreshSelects === 'function') {
                        window.masterDataManager.refreshSelects();
                    }
                }
            }
        });
    }

    function attachMetaListeners() {
        metaFieldDefinitions().forEach(def => {
            const el = document.getElementById(def.id);
            if (!el) return;
            const handleUpdate = event => {
                if (def.key === 'rollDiameter') {
                    setRollDiameterValue(event.target.value, { updateInput: false, fromUser: true });
                } else {
                    state.meta[def.key] = def.parser(event.target.value);
                    if (def.key === 'diameter' && rollDiameterAuto) {
                        setRollDiameterValue(state.meta.diameter * 4);
                    }
                }
                updateOutputs();
            };
            el.addEventListener('input', handleUpdate);
            if (el.tagName === 'SELECT') {
                el.addEventListener('change', handleUpdate);
            }
            el.addEventListener('blur', event => {
                if (def.key === 'rollDiameter') {
                    setRollDiameterValue(event.target.value, { updateInput: true, fromUser: true });
                } else {
                    state.meta[def.key] = def.parser(event.target.value);
                    if (def.key === 'diameter') {
                        el.value = formatNumberForInput(state.meta.diameter);
                        if (rollDiameterAuto) {
                            setRollDiameterValue(state.meta.diameter * 4);
                        }
                    } else if (def.key === 'quantity') {
                        el.value = Number.isFinite(state.meta.quantity) ? String(Math.round(state.meta.quantity)) : '1';
                    }
                }
                updateOutputs();
            });
        });
    }

    function attachActionListeners() {
        const addBtn = document.getElementById('bf2dAddSegmentButton');
        if (addBtn) {
            addBtn.addEventListener('click', addSegment);
        }

        const copyBtn = document.getElementById('bf2dCopyButton');
        if (copyBtn) {
            copyBtn.addEventListener('click', copyDataset);
        }

        const downloadBtn = document.getElementById('bf2dDownloadButton');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', downloadDataset);
        }

        const lengthToggle = document.getElementById('bf2dShowLengths');
        if (lengthToggle) {
            lengthToggle.checked = dimensionPreferences.showLengths;
            lengthToggle.addEventListener('change', () => {
                dimensionPreferences.showLengths = lengthToggle.checked;
                updateOutputs();
            });
        }

        const radiusToggle = document.getElementById('bf2dShowRadii');
        if (radiusToggle) {
            radiusToggle.checked = dimensionPreferences.showRadii;
            radiusToggle.addEventListener('change', () => {
                dimensionPreferences.showRadii = radiusToggle.checked;
                updateOutputs();
            });
        }

        const toggle3dDimensions = document.getElementById('bf2d3dToggleDimensions');
        if (toggle3dDimensions) {
            toggle3dDimensions.checked = preview3dPreferences.showDimensions;
            toggle3dDimensions.addEventListener('change', () => {
                preview3dPreferences.showDimensions = toggle3dDimensions.checked;
                updateOutputs();
            });
        }

        const toggle3dZoneLengths = document.getElementById('bf2d3dToggleZoneLengths');
        if (toggle3dZoneLengths) {
            toggle3dZoneLengths.checked = preview3dPreferences.showZoneLengths;
            toggle3dZoneLengths.addEventListener('change', () => {
                preview3dPreferences.showZoneLengths = toggle3dZoneLengths.checked;
                updateOutputs();
            });
        }

        const toggle3dOverhangs = document.getElementById('bf2d3dToggleOverhangs');
        if (toggle3dOverhangs) {
            toggle3dOverhangs.checked = preview3dPreferences.showOverhangs;
            toggle3dOverhangs.addEventListener('change', () => {
                preview3dPreferences.showOverhangs = toggle3dOverhangs.checked;
                updateOutputs();
            });
        }

        const view2dBtn = document.getElementById('bf2dViewToggle2d');
        if (view2dBtn) {
            view2dBtn.addEventListener('click', () => setPreviewViewMode('2d'));
        }

        const view3dBtn = document.getElementById('bf2dViewToggle3d');
        if (view3dBtn) {
            view3dBtn.addEventListener('click', () => setPreviewViewMode('3d'));
        }

        const reset3dBtn = document.getElementById('bf2dReset3dButton');
        if (reset3dBtn) {
            reset3dBtn.addEventListener('click', () => {
                if (window.bf2dViewer3D && typeof window.bf2dViewer3D.resetView === 'function') {
                    window.bf2dViewer3D.resetView();
                }
            });
        }

        const zoom3dBtn = document.getElementById('bf2dZoom3dButton');
        if (zoom3dBtn) {
            zoom3dBtn.addEventListener('click', () => {
                if (window.bf2dViewer3D && typeof window.bf2dViewer3D.zoomToFit === 'function') {
                    window.bf2dViewer3D.zoomToFit();
                }
            });
        }

        const dropZone = document.getElementById('bf2dDropZone');
        const importInput = document.getElementById('bf2dImportFileInput');
        if (dropZone && importInput) {
            dropZone.addEventListener('click', () => importInput.click());
            dropZone.addEventListener('dragover', handleDragOver);
            dropZone.addEventListener('dragleave', handleDragLeave);
            dropZone.addEventListener('drop', handleDrop);
        }
        if (importInput) {
            importInput.addEventListener('change', handleFileInputChange);
        }

        const exportButton = document.getElementById('bf2dExportSelectionButton');
        if (exportButton) {
            exportButton.addEventListener('click', exportSelectedAbsEntries);
        }

        const selectAll = document.getElementById('bf2dImportSelectAll');
        if (selectAll) {
            selectAll.addEventListener('change', handleImportSelectAll);
        }

        const clearImportButton = document.getElementById('bf2dClearImportButton');
        if (clearImportButton) {
            clearImportButton.addEventListener('click', clearImport);
        }
    }

    function getLocalStorageSafe() {
        try {
            if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
                return null;
            }
            return window.localStorage;
        } catch (error) {
            return null;
        }
    }

    function readSavedForms() {
        const storage = getLocalStorageSafe();
        if (!storage) return {};
        const raw = storage.getItem(SAVED_FORMS_STORAGE_KEY);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.error('Failed to parse saved BF2D forms', error);
        }
        return {};
    }

    function persistSavedForms(forms) {
        const storage = getLocalStorageSafe();
        if (!storage) return false;
        try {
            const entries = Object.keys(forms || {});
            if (!entries.length) {
                storage.removeItem(SAVED_FORMS_STORAGE_KEY);
            } else {
                storage.setItem(SAVED_FORMS_STORAGE_KEY, JSON.stringify(forms));
            }
            return true;
        } catch (error) {
            console.error('Failed to persist BF2D forms', error);
            return false;
        }
    }

    function notifySavedFormsUpdated(names) {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
            return;
        }
        try {
            const detail = {
                names: Array.isArray(names) ? [...names] : []
            };
            window.dispatchEvent(new CustomEvent('bf2dSavedFormsUpdated', { detail }));
        } catch (error) {
            console.warn('Failed to dispatch bf2dSavedFormsUpdated event', error);
        }
    }

    function populateSavedFormsSelect(selectedName = '') {
        const select = document.getElementById('bf2dSavedForms');
        if (!select) return;
        const storage = getLocalStorageSafe();
        const forms = storage ? readSavedForms() : {};
        const names = Object.keys(forms).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const placeholderText = typeof i18n?.t === 'function' ? i18n.t('Gespeicherte Biegeform auswählen…') : 'Gespeicherte Biegeform auswählen…';
        select.innerHTML = '';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = placeholderText;
        select.appendChild(placeholderOption);
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
        const sanitizedSelected = sanitizeText(selectedName);
        if (sanitizedSelected && Object.prototype.hasOwnProperty.call(forms, sanitizedSelected)) {
            select.value = sanitizedSelected;
        } else {
            select.value = '';
        }
        const storageAvailable = !!storage;
        const hasForms = storageAvailable && names.length > 0;
        select.disabled = !hasForms;
        const loadBtn = document.getElementById('bf2dLoadShapeButton');
        if (loadBtn) {
            loadBtn.disabled = !hasForms;
        }
        const deleteBtn = document.getElementById('bf2dDeleteShapeButton');
        if (deleteBtn) {
            deleteBtn.disabled = !hasForms;
        }
        notifySavedFormsUpdated(names);
    }

    function readShapeNameInput() {
        const input = document.getElementById('bf2dShapeName');
        if (!input) return '';
        return sanitizeText(input.value);
    }

    function setShapeNameInputValue(value) {
        const input = document.getElementById('bf2dShapeName');
        if (!input) return;
        input.value = value || '';
    }

    function resolveTargetShapeName() {
        const select = document.getElementById('bf2dSavedForms');
        if (select && select.value) {
            return sanitizeText(select.value);
        }
        return readShapeNameInput();
    }

    function showStorageUnavailableFeedback() {
        if (typeof showFeedback === 'function') {
            const message = typeof i18n?.t === 'function' ? i18n.t('Speicherfunktion nicht verfügbar.') : 'Speicherfunktion nicht verfügbar.';
            showFeedback('bf2dStatus', message, 'warning', 4000);
        }
    }

    function buildCurrentShapeSnapshot() {
        return {
            meta: { ...state.meta },
            segments: state.segments.map(segment => ({
                length: Number(segment.length) || 0,
                bendAngle: Number(segment.bendAngle) || 0,
                bendDirection: segment.bendDirection === 'R' ? 'R' : 'L',
                radius: Number(segment.radius) || 0
            })),
            dimensionPreferences: {
                showLengths: !!dimensionPreferences.showLengths,
                showRadii: !!dimensionPreferences.showRadii
            },
            rollDiameterAuto: !!rollDiameterAuto
        };
    }

    function saveCurrentShape() {
        const storage = getLocalStorageSafe();
        if (!storage) {
            showStorageUnavailableFeedback();
            return;
        }
        const name = readShapeNameInput();
        if (!name) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Bitte einen Namen für die Biegeform angeben.') : 'Bitte einen Namen für die Biegeform angeben.';
                showFeedback('bf2dStatus', message, 'warning', 3000);
            }
            return;
        }
        setShapeNameInputValue(name);
        const forms = readSavedForms();
        forms[name] = buildCurrentShapeSnapshot();
        if (!persistSavedForms(forms)) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform konnte nicht gespeichert werden.') : 'Biegeform konnte nicht gespeichert werden.';
                showFeedback('bf2dStatus', message, 'error', 4000);
            }
            return;
        }
        populateSavedFormsSelect(name);
        if (typeof showFeedback === 'function') {
            const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform gespeichert.') : 'Biegeform gespeichert.';
            showFeedback('bf2dStatus', message, 'success', 2000);
        }
    }

    function applySavedShapeData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        const metaSource = {
            ...META_DEFAULTS,
            ...(typeof data.meta === 'object' && data.meta !== null ? data.meta : {})
        };

        metaFieldDefinitions().forEach(def => {
            const hasOwn = Object.prototype.hasOwnProperty.call(metaSource, def.key);
            const rawValue = hasOwn ? metaSource[def.key] : META_DEFAULTS[def.key];
            let parserInput;
            if (typeof rawValue === 'number' || typeof rawValue === 'string') {
                parserInput = rawValue;
            } else {
                parserInput = META_DEFAULTS[def.key];
            }
            const parsed = def.parser(parserInput);
            state.meta[def.key] = parsed;
            const el = document.getElementById(def.id);
            if (!el) return;
            if (el.type === 'number') {
                if (def.key === 'quantity') {
                    const qty = Math.max(1, Math.round(Number(parsed) || 0));
                    state.meta.quantity = qty;
                    el.value = String(qty);
                } else {
                    el.value = formatNumberForInput(parsed);
                }
            } else {
                el.value = parsed || '';
            }
        });

        segmentIdCounter = 0;
        if (Array.isArray(data.segments) && data.segments.length > 0) {
            state.segments = data.segments.map(segment => {
                const length = Number(segment?.length) || 0;
                const bendAngle = Number(segment?.bendAngle) || 0;
                const direction = segment?.bendDirection === 'R' ? 'R' : 'L';
                const radiusValue = Number(segment?.radius);
                const radius = Number.isFinite(radiusValue) ? radiusValue : null;
                return createSegment(length, bendAngle, direction, radius);
            });
            enforceLastSegmentDefaults();
        } else {
            initDefaultSegments();
        }

        const savedPreferences = (typeof data.dimensionPreferences === 'object' && data.dimensionPreferences !== null) ? data.dimensionPreferences : {};
        dimensionPreferences.showLengths = savedPreferences.showLengths !== undefined ? !!savedPreferences.showLengths : true;
        dimensionPreferences.showRadii = savedPreferences.showRadii !== undefined ? !!savedPreferences.showRadii : true;
        const lengthToggle = document.getElementById('bf2dShowLengths');
        if (lengthToggle) {
            lengthToggle.checked = dimensionPreferences.showLengths;
        }
        const radiusToggle = document.getElementById('bf2dShowRadii');
        if (radiusToggle) {
            radiusToggle.checked = dimensionPreferences.showRadii;
        }

        setRollDiameterValue(state.meta.rollDiameter, { updateInput: true, fromUser: false });
        if (typeof data.rollDiameterAuto === 'boolean') {
            rollDiameterAuto = data.rollDiameterAuto;
        } else {
            rollDiameterAuto = true;
        }

        renderSegmentTable();
        updateOutputs();
        return true;
    }

    function handleLoadSelectedShape() {
        const storage = getLocalStorageSafe();
        if (!storage) {
            showStorageUnavailableFeedback();
            return;
        }
        const name = resolveTargetShapeName();
        if (!name) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Bitte eine gespeicherte Biegeform auswählen.') : 'Bitte eine gespeicherte Biegeform auswählen.';
                showFeedback('bf2dStatus', message, 'warning', 3000);
            }
            return;
        }
        const forms = readSavedForms();
        const data = forms[name];
        if (!data) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform nicht gefunden.') : 'Biegeform nicht gefunden.';
                showFeedback('bf2dStatus', message, 'warning', 3000);
            }
            populateSavedFormsSelect('');
            return;
        }
        setShapeNameInputValue(name);
        if (!applySavedShapeData(data)) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform konnte nicht geladen werden.') : 'Biegeform konnte nicht geladen werden.';
                showFeedback('bf2dStatus', message, 'error', 4000);
            }
            return;
        }
        populateSavedFormsSelect(name);
        if (typeof showFeedback === 'function') {
            const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform geladen.') : 'Biegeform geladen.';
            showFeedback('bf2dStatus', message, 'success', 2000);
        }
    }

    function handleDeleteSelectedShape() {
        const storage = getLocalStorageSafe();
        if (!storage) {
            showStorageUnavailableFeedback();
            return;
        }
        const name = resolveTargetShapeName();
        if (!name) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Bitte eine gespeicherte Biegeform auswählen.') : 'Bitte eine gespeicherte Biegeform auswählen.';
                showFeedback('bf2dStatus', message, 'warning', 3000);
            }
            return;
        }
        setShapeNameInputValue(name);
        const forms = readSavedForms();
        if (!Object.prototype.hasOwnProperty.call(forms, name)) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform nicht gefunden.') : 'Biegeform nicht gefunden.';
                showFeedback('bf2dStatus', message, 'warning', 3000);
            }
            populateSavedFormsSelect('');
            return;
        }
        delete forms[name];
        if (!persistSavedForms(forms)) {
            if (typeof showFeedback === 'function') {
                const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform konnte nicht gelöscht werden.') : 'Biegeform konnte nicht gelöscht werden.';
                showFeedback('bf2dStatus', message, 'error', 4000);
            }
            return;
        }
        populateSavedFormsSelect('');
        if (typeof showFeedback === 'function') {
            const message = typeof i18n?.t === 'function' ? i18n.t('Biegeform gelöscht.') : 'Biegeform gelöscht.';
            showFeedback('bf2dStatus', message, 'success', 2000);
        }
    }

    function attachStorageListeners() {
        const saveBtn = document.getElementById('bf2dSaveShapeButton');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveCurrentShape);
        }
        const loadBtn = document.getElementById('bf2dLoadShapeButton');
        if (loadBtn) {
            loadBtn.addEventListener('click', handleLoadSelectedShape);
        }
        const deleteBtn = document.getElementById('bf2dDeleteShapeButton');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', handleDeleteSelectedShape);
        }
        const select = document.getElementById('bf2dSavedForms');
        if (select) {
            select.addEventListener('change', event => {
                const value = sanitizeText(event.target.value);
                if (value) {
                    setShapeNameInputValue(value);
                }
            });
        }
        const input = document.getElementById('bf2dShapeName');
        if (input) {
            input.addEventListener('input', () => {
                const dropdown = document.getElementById('bf2dSavedForms');
                if (dropdown && dropdown.value) {
                    dropdown.value = '';
                }
            });
        }
    }

    function createActionButton(symbol, titleKey, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bf2d-action-button';
        button.textContent = symbol;
        const label = typeof i18n?.t === 'function' ? i18n.t(titleKey) : titleKey;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.dataset.i18nTitle = titleKey;
        button.addEventListener('click', handler);
        return button;
    }

    function renderSegmentTable() {
        applyRollDiameterToSegments();
        const tbody = document.getElementById('bf2dSegmentsBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.segments.forEach((segment, index) => {
            const isLast = index === state.segments.length - 1;
            const row = document.createElement('tr');

            const indexCell = document.createElement('td');
            indexCell.textContent = String(index + 1);
            row.appendChild(indexCell);

            const lengthCell = document.createElement('td');
            const lengthInput = document.createElement('input');
            lengthInput.type = 'number';
            lengthInput.min = '0';
            lengthInput.step = '1';
            lengthInput.value = formatNumberForInput(segment.length);
            lengthInput.addEventListener('input', event => {
                segment.length = clampNumber(parseFloat(event.target.value), 0, 100000);
                updateOutputs();
            });
            lengthInput.addEventListener('blur', () => {
                segment.length = clampNumber(parseFloat(lengthInput.value), 0, 100000);
                lengthInput.value = formatNumberForInput(segment.length);
                updateOutputs();
            });
            lengthCell.appendChild(lengthInput);
            row.appendChild(lengthCell);

            const angleCell = document.createElement('td');
            const angleInput = document.createElement('input');
            angleInput.type = 'number';
            angleInput.min = '0';
            angleInput.max = '180';
            angleInput.step = '1';
            angleInput.value = formatNumberForInput(segment.bendAngle);
            angleInput.disabled = isLast;
            angleInput.addEventListener('input', event => {
                segment.bendAngle = clampNumber(parseFloat(event.target.value), 0, 180);
                updateOutputs();
            });
            angleInput.addEventListener('blur', () => {
                segment.bendAngle = clampNumber(parseFloat(angleInput.value), 0, 180);
                angleInput.value = formatNumberForInput(segment.bendAngle);
                updateOutputs();
            });
            angleCell.appendChild(angleInput);
            row.appendChild(angleCell);

            const directionCell = document.createElement('td');
            const directionSelect = document.createElement('select');
            ['L', 'R'].forEach(dir => {
                const option = document.createElement('option');
                option.value = dir;
                const labelKey = dir === 'L' ? 'Links' : 'Rechts';
                option.textContent = typeof i18n?.t === 'function' ? i18n.t(labelKey) : labelKey;
                directionSelect.appendChild(option);
            });
            directionSelect.value = segment.bendDirection === 'R' ? 'R' : 'L';
            directionSelect.disabled = isLast;
            directionSelect.addEventListener('change', event => {
                segment.bendDirection = event.target.value === 'R' ? 'R' : 'L';
                updateOutputs();
            });
            directionCell.appendChild(directionSelect);
            row.appendChild(directionCell);

            const radiusCell = document.createElement('td');
            const radiusInput = document.createElement('input');
            radiusInput.type = 'number';
            radiusInput.min = '0';
            radiusInput.step = '1';
            radiusInput.value = formatNumberForInput(segment.radius);
            radiusInput.dataset.segmentId = String(segment.id);
            radiusInput.classList.add('bf2d-radius-input');
            radiusInput.readOnly = true;
            radiusInput.setAttribute('aria-readonly', 'true');
            radiusCell.appendChild(radiusInput);
            row.appendChild(radiusCell);

            const actionsCell = document.createElement('td');
            actionsCell.className = 'bf2d-actions-cell';
            const upButton = createActionButton('↑', 'Nach oben', () => moveSegment(index, -1));
            upButton.disabled = index === 0;
            const downButton = createActionButton('↓', 'Nach unten', () => moveSegment(index, 1));
            downButton.disabled = index === state.segments.length - 1;
            const removeButton = createActionButton('✕', 'Segment entfernen', () => removeSegment(segment.id));
            removeButton.disabled = state.segments.length <= 2;
            actionsCell.appendChild(upButton);
            actionsCell.appendChild(downButton);
            actionsCell.appendChild(removeButton);
            row.appendChild(actionsCell);

            tbody.appendChild(row);
        });
    }

    function addSegment() {
        state.previewNoteOverride = null;
        if (state.segments.length === 0) {
            state.segments.push(createSegment(500, 0, 'L', 0));
        } else {
            const previousLast = state.segments[state.segments.length - 1];
            if ((Number(previousLast.bendAngle) || 0) === 0) {
                previousLast.bendAngle = 90;
            }
            state.segments.push(createSegment(500, 0, previousLast.bendDirection || 'L', 0));
        }
        enforceLastSegmentDefaults();
        applyRollDiameterToSegments();
        renderSegmentTable();
        updateOutputs();
    }

    function removeSegment(id) {
        state.previewNoteOverride = null;
        if (state.segments.length <= 2) {
            if (typeof showFeedback === 'function') {
                showFeedback('bf2dStatus', i18n.t('Mindestens zwei Segmente erforderlich.'), 'warning', 3000);
            }
            return;
        }
        const index = state.segments.findIndex(segment => segment.id === id);
        if (index === -1) return;
        state.segments.splice(index, 1);
        enforceLastSegmentDefaults();
        applyRollDiameterToSegments();
        renderSegmentTable();
        updateOutputs();
    }

    function moveSegment(index, direction) {
        state.previewNoteOverride = null;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= state.segments.length) return;
        const [segment] = state.segments.splice(index, 1);
        state.segments.splice(targetIndex, 0, segment);
        enforceLastSegmentDefaults();
        applyRollDiameterToSegments();
        renderSegmentTable();
        updateOutputs();
    }

    function computeSummary() {
        const errors = [];
        applyRollDiameterToSegments();

        const segments = state.segments;
        if (segments.length < 2) {
            errors.push(i18n.t('Mindestens zwei Segmente erforderlich.'));
        }

        let straightLength = 0;
        let arcLength = 0;
        let requiresRollDiameter = false;

        const rollDiameter = Number(state.meta.rollDiameter);
        const rollRadius = Number.isFinite(rollDiameter) && rollDiameter > 0 ? rollDiameter / 2 : 0;

        segments.forEach((segment, index) => {
            const length = Number(segment.length);
            if (!Number.isFinite(length) || length <= 0) {
                errors.push(i18n.t('Segment {index}: Länge muss größer als 0 sein.', { index: index + 1 }));
            } else {
                straightLength += Math.max(length, 0);
            }

            const isLast = index === segments.length - 1;
            if (!isLast) {
                const angle = Number(segment.bendAngle) || 0;
                if (angle < 0 || angle > 180) {
                    errors.push(i18n.t('Segment {index}: Biegewinkel muss zwischen 0° und 180° liegen.', { index: index + 1 }));
                }
                if (angle > 0) {
                    requiresRollDiameter = true;
                    if (rollRadius > 0) {
                        const angleRad = (Math.abs(angle) * Math.PI) / 180;
                        arcLength += angleRad * rollRadius;
                    }
                }
            }
        });

        const quantity = Number(state.meta.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            errors.push(i18n.t('Stückzahl muss größer als 0 sein.'));
        }

        const diameter = Number(state.meta.diameter);
        if (!Number.isFinite(diameter) || diameter <= 0) {
            errors.push(i18n.t('Durchmesser muss größer als 0 sein.'));
        }

        if (requiresRollDiameter && (!Number.isFinite(rollDiameter) || rollDiameter <= 0)) {
            errors.push(i18n.t('Biegerollendurchmesser muss größer als 0 sein.'));
        }

        const totalLength = straightLength + arcLength;
        let geometry = null;
        let width = 0;
        let height = 0;

        if (errors.length === 0) {
            geometry = buildGeometry(segments);
            width = geometry.width;
            height = geometry.height;
            if (geometry && geometry.pathSegments) {
                geometry.intersections = findSelfIntersections(geometry.pathSegments);
                if (geometry.intersections.length > 0) {
                    errors.push('Warnung: Die Form überschneidet sich selbst.');
                }
            }
        }

        const weightPerMeter = Number.isFinite(diameter) ? (diameter * diameter) / 162 : 0;
        const lengthMeters = totalLength / 1000;
        const weightPerBar = weightPerMeter * lengthMeters;
        const totalWeight = weightPerBar * Math.max(quantity, 0);

        return {
            straightLength,
            arcLength,
            totalLength,
            width,
            height,
            weightPerBar,
            totalWeight,
            quantity,
            geometry,
            errors,
            requiresRollDiameter,
            diameter,
            rollDiameter
        };
    }

    function findSelfIntersections(pathSegments) {
        const intersections = [];
        const lines = pathSegments.filter(p => p.type === 'line');

        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 2; j < lines.length; j++) {
                // Don't check adjacent segments
                if (i === 0 && j === lines.length - 1) continue;

                const p1 = lines[i].start;
                const q1 = lines[i].end;
                const p2 = lines[j].start;
                const q2 = lines[j].end;

                const a1 = q1.y - p1.y;
                const b1 = p1.x - q1.x;
                const c1 = a1 * p1.x + b1 * p1.y;

                const a2 = q2.y - p2.y;
                const b2 = p2.x - q2.x;
                const c2 = a2 * p2.x + b2 * p2.y;

                const determinant = a1 * b2 - a2 * b1;

                if (Math.abs(determinant) > 1e-9) { // Check if lines are not parallel
                    const x = (b2 * c1 - b1 * c2) / determinant;
                    const y = (a1 * c2 - a2 * c1) / determinant;

                    const onSegment1 = Math.min(p1.x, q1.x) - 1e-9 <= x && x <= Math.max(p1.x, q1.x) + 1e-9 &&
                                     Math.min(p1.y, q1.y) - 1e-9 <= y && y <= Math.max(p1.y, q1.y) + 1e-9;
                    const onSegment2 = Math.min(p2.x, q2.x) - 1e-9 <= x && x <= Math.max(p2.x, q2.x) + 1e-9 &&
                                     Math.min(p2.y, q2.y) - 1e-9 <= y && y <= Math.max(p2.y, q2.y) + 1e-9;

                    if (onSegment1 && onSegment2) {
                        intersections.push({ x, y });
                    }
                }
            }
        }
        return intersections;
    }

    function buildGeometry(segments) {
        applyRollDiameterToSegments();
        let orientation = 0;
        let current = { x: 0, y: 0 };
        const mathPoints = [{ x: 0, y: 0 }];
        const legs = [];
        const bends = [];
        const pathSegments = [];

        segments.forEach((segment, index) => {
            const length = Math.max(0, Number(segment.length) || 0);
            const dir = { x: Math.cos(orientation), y: Math.sin(orientation) };
            const startPoint = { ...current };
            current = {
                x: current.x + dir.x * length,
                y: current.y + dir.y * length
            };
            const endPoint = { ...current };
            mathPoints.push(endPoint);

            const screenStart = { x: startPoint.x, y: -startPoint.y };
            const screenEnd = { x: endPoint.x, y: -endPoint.y };
            const dx = screenEnd.x - screenStart.x;
            const dy = screenEnd.y - screenStart.y;
            const screenSegmentLength = Math.hypot(dx, dy);
            const screenOrientation = screenSegmentLength > 0 ? Math.atan2(dy, dx) : 0;

            legs.push({
                index,
                length,
                start: startPoint,
                end: endPoint,
                screenStart,
                screenEnd,
                orientation,
                screenOrientation
            });

            if (length > 0) {
                pathSegments.push({
                    type: 'line',
                    start: { ...startPoint },
                    end: { ...endPoint }
                });
            }

            const isLast = index === segments.length - 1;
            let signedAngleRad = 0;
            if (!isLast) {
                const angleDeg = Number(segment.bendAngle) || 0;
                const sign = segment.bendDirection === 'R' ? -1 : 1;
                signedAngleRad = (angleDeg * Math.PI / 180) * sign;
                let radius = enforceMinimumRadius(segment.radius);
                if (angleDeg > 0 && radius > 0) {
                    segment.radius = radius;
                    const arcStart = { ...endPoint };
                    const leftNormal = { x: -dir.y, y: dir.x };
                    const center = {
                        x: arcStart.x + leftNormal.x * radius * sign,
                        y: arcStart.y + leftNormal.y * radius * sign
                    };
                    const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
                    const endAngle = startAngle + signedAngleRad;
                    const steps = Math.min(32, Math.max(6, Math.ceil(Math.abs(angleDeg) / 10)));
                    for (let step = 1; step <= steps; step++) {
                        const theta = startAngle + signedAngleRad * (step / steps);
                        const arcPoint = {
                            x: center.x + Math.cos(theta) * radius,
                            y: center.y + Math.sin(theta) * radius
                        };
                        mathPoints.push(arcPoint);
                    }
                    const arcEnd = { ...mathPoints[mathPoints.length - 1] };
                    current = arcEnd;

                    pathSegments.push({
                        type: 'arc',
                        start: { ...arcStart },
                        end: { ...arcEnd },
                        center: { ...center },
                        radius,
                        startAngle,
                        endAngle,
                        clockwise: signedAngleRad < 0,
                        subdivisions: steps
                    });

                    const screenCenter = { x: center.x, y: -center.y };
                    const screenArcStart = { x: arcStart.x, y: -arcStart.y };
                    const screenArcEnd = { x: arcEnd.x, y: -arcEnd.y };

                    const startVector = {
                        x: screenArcStart.x - screenCenter.x,
                        y: screenArcStart.y - screenCenter.y
                    };
                    const endVector = {
                        x: screenArcEnd.x - screenCenter.x,
                        y: screenArcEnd.y - screenCenter.y
                    };
                    const startVectorLength = Math.hypot(startVector.x, startVector.y) || 1;
                    const endVectorLength = Math.hypot(endVector.x, endVector.y) || 1;
                    const startUnit = {
                        x: startVector.x / startVectorLength,
                        y: startVector.y / startVectorLength
                    };
                    const endUnit = {
                        x: endVector.x / endVectorLength,
                        y: endVector.y / endVectorLength
                    };
                    const cross = startUnit.x * endUnit.y - startUnit.y * endUnit.x;

                    bends.push({
                        index,
                        angleDeg,
                        angleRad: Math.abs(signedAngleRad),
                        radius,
                        screenCenter,
                        startUnit,
                        endUnit,
                        screenStart: screenArcStart,
                        screenEnd: screenArcEnd,
                        sweepDir: cross < 0 ? -1 : 1
                    });
                }
            }
            orientation += signedAngleRad;
        });

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        mathPoints.forEach(point => {
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        });

        const screenPoints = mathPoints.map(point => ({ x: point.x, y: -point.y }));

        let screenMinX = Infinity;
        let screenMaxX = -Infinity;
        let screenMinY = Infinity;
        let screenMaxY = -Infinity;
        screenPoints.forEach(point => {
            if (point.x < screenMinX) screenMinX = point.x;
            if (point.x > screenMaxX) screenMaxX = point.x;
            if (point.y < screenMinY) screenMinY = point.y;
            if (point.y > screenMaxY) screenMaxY = point.y;
        });

        const width = Number.isFinite(maxX - minX) ? maxX - minX : 0;
        const height = Number.isFinite(maxY - minY) ? maxY - minY : 0;

        const padding = Math.max(20, Math.max(width, height) * 0.15);
        let viewWidth = Number.isFinite(screenMaxX - screenMinX) ? screenMaxX - screenMinX : 0;
        let viewHeight = Number.isFinite(screenMaxY - screenMinY) ? screenMaxY - screenMinY : 0;
        if (viewWidth <= 0) viewWidth = padding * 2;
        if (viewHeight <= 0) viewHeight = padding * 2;

        const viewBox = {
            x: (Number.isFinite(screenMinX) ? screenMinX : 0) - padding,
            y: (Number.isFinite(screenMinY) ? screenMinY : 0) - padding,
            width: viewWidth + padding * 2,
            height: viewHeight + padding * 2
        };

        const pathData = screenPoints
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
            .join(' ');

        return {
            pathData,
            viewBox,
            width,
            height,
            screenPoints,
            legs,
            bends,
            mathPoints,
            pathSegments
        };
    }

    function updateSummaryUI(summary) {
        const totalEl = document.getElementById('bf2dSummaryTotalLength');
        if (totalEl) totalEl.textContent = `${formatDisplayNumber(summary.totalLength)} mm`;
        const straightEl = document.getElementById('bf2dSummaryStraightLength');
        if (straightEl) straightEl.textContent = `${formatDisplayNumber(summary.straightLength)} mm`;
        const arcEl = document.getElementById('bf2dSummaryArcLength');
        if (arcEl) arcEl.textContent = `${formatDisplayNumber(summary.arcLength)} mm`;
        const dimensionsEl = document.getElementById('bf2dSummaryDimensions');
        if (dimensionsEl) dimensionsEl.textContent = `${formatDisplayNumber(summary.width)} × ${formatDisplayNumber(summary.height)} mm`;
        const weightEl = document.getElementById('bf2dSummaryWeight');
        if (weightEl) weightEl.textContent = `${formatDisplayNumber(summary.weightPerBar, 3)} kg`;
        const totalWeightEl = document.getElementById('bf2dSummaryTotalWeight');
        if (totalWeightEl) totalWeightEl.textContent = `${formatDisplayNumber(summary.totalWeight, 3)} kg`;
    }

    function updateErrorList(errors) {
        const list = document.getElementById('bf2dErrorList');
        if (!list) return;
        list.innerHTML = '';
        if (!errors.length) return;
        errors.forEach(message => {
            const item = document.createElement('li');
            item.textContent = message;
            list.appendChild(item);
        });
    }

    function computeSvgScale(svg, viewBox) {
        if (!svg || !viewBox) {
            return { unitPerPx: 1, pxPerUnit: 1 };
        }
        const rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
        const widthPx = (rect?.width || svg.clientWidth || 0);
        const heightPx = (rect?.height || svg.clientHeight || 0);
        const viewWidth = Number.isFinite(viewBox.width) && viewBox.width > 0 ? viewBox.width : 1;
        const viewHeight = Number.isFinite(viewBox.height) && viewBox.height > 0 ? viewBox.height : 1;

        let pxPerUnitX = Number.isFinite(viewWidth) && viewWidth > 0 && widthPx > 0 ? widthPx / viewWidth : Number.POSITIVE_INFINITY;
        let pxPerUnitY = Number.isFinite(viewHeight) && viewHeight > 0 && heightPx > 0 ? heightPx / viewHeight : Number.POSITIVE_INFINITY;
        let pxPerUnit = Math.min(pxPerUnitX, pxPerUnitY);

        if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) {
            const fallbackWidthPx = widthPx > 0 ? widthPx : 800;
            pxPerUnit = viewWidth > 0 ? fallbackWidthPx / viewWidth : 1;
        }
        if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) {
            pxPerUnit = 1;
        }
        return { pxPerUnit, unitPerPx: 1 / pxPerUnit };
    }

    function addLengthDimension(group, leg, config) {
        const length = Number(leg.length);
        if (!Number.isFinite(length) || length <= 0) return;

        const start = leg.screenStart;
        const end = leg.screenEnd;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const segmentLength = Math.hypot(dx, dy);
        if (!Number.isFinite(segmentLength) || segmentLength <= 1e-6) return;

        const unitPerPx = config.unitPerPx;
        const pxPerUnit = config.pxPerUnit;
        const charWidthUnits = config.charWidthUnits;

        const offsetUnits = DIMENSION_CONFIG.lengthOffsetPx * unitPerPx;
        const textGapUnits = DIMENSION_CONFIG.lengthTextGapPx * unitPerPx;
        const extraGapUnits = DIMENSION_CONFIG.lengthTextExtraGapPx * unitPerPx;

        const ux = dx / segmentLength;
        const uy = dy / segmentLength;
        const nx = -uy;
        const ny = ux;

        const dimStart = {
            x: start.x + nx * offsetUnits,
            y: start.y + ny * offsetUnits
        };
        const dimEnd = {
            x: end.x + nx * offsetUnits,
            y: end.y + ny * offsetUnits
        };

        const label = `${formatDisplayNumber(length)} mm`;
        const dimensionLength = Math.hypot(dimEnd.x - dimStart.x, dimEnd.y - dimStart.y);
        const availableForText = dimensionLength;
        const textWidthEstimate = label.length * charWidthUnits;
        const dimensionLengthPx = dimensionLength * pxPerUnit;
        let textOffset = textGapUnits;
        if (availableForText < textWidthEstimate || dimensionLengthPx < DIMENSION_CONFIG.minLengthTextSpanPx) {
            textOffset += extraGapUnits;
        }

        const midpoint = {
            x: (dimStart.x + dimEnd.x) / 2,
            y: (dimStart.y + dimEnd.y) / 2
        };
        const textPosition = {
            x: midpoint.x + nx * textOffset,
            y: midpoint.y + ny * textOffset
        };

        let angleDeg = Math.atan2(dimEnd.y - dimStart.y, dimEnd.x - dimStart.x) * 180 / Math.PI;
        if (angleDeg > 90 || angleDeg < -90) {
            angleDeg += 180;
        }

        const textGroup = createSvgElement('g', {
            transform: `translate(${textPosition.x.toFixed(2)} ${textPosition.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`
        });
        const textElement = createSvgElement('text', {
            class: 'bf2d-dimension-text',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': config.fontSize.toFixed(2)
        });
        textElement.textContent = label;
        textGroup.appendChild(textElement);
        group.appendChild(textGroup);
    }

    function addBendDimension(group, bend, config) {
        const angleDeg = Number(bend.angleDeg);
        const angleRad = Number(bend.angleRad);
        const radius = Number(bend.radius);
        if (!Number.isFinite(angleDeg) || angleDeg <= 0 || !Number.isFinite(angleRad) || angleRad <= 0 || !Number.isFinite(radius) || radius < 0) {
            return;
        }

        const unitPerPx = config.unitPerPx;
        const pxPerUnit = config.pxPerUnit;
        const baseFontSize = config.fontSize;

        let dimensionRadius = radius - DIMENSION_CONFIG.radiusInnerOffsetPx * unitPerPx;
        if (!Number.isFinite(dimensionRadius) || dimensionRadius <= 0) {
            dimensionRadius = Math.max(radius * 0.6, 24 * unitPerPx);
        }

        const center = bend.screenCenter;
        const startUnit = bend.startUnit;
        const endUnit = bend.endUnit;
        const sweepDir = bend.sweepDir;

        const startAngle = Math.atan2(startUnit.y, startUnit.x);
        const endAngle = Math.atan2(endUnit.y, endUnit.x);
        let delta = endAngle - startAngle;
        if (sweepDir < 0 && delta > 0) {
            delta -= 2 * Math.PI;
        } else if (sweepDir > 0 && delta < 0) {
            delta += 2 * Math.PI;
        }
        const totalAngle = Math.abs(delta);
        const midAngle = startAngle + delta / 2;

        const angleLabel = `${formatDisplayNumber(angleDeg)}°`;
        const arcLengthPx = Math.abs(dimensionRadius) * totalAngle * pxPerUnit;
        const requiresExtraOffset = arcLengthPx < DIMENSION_CONFIG.minArcTextWidthPx;

        let angleTextOffset = DIMENSION_CONFIG.angleTextOffsetPx * unitPerPx;
        if (requiresExtraOffset) {
            angleTextOffset += (DIMENSION_CONFIG.angleTextOffsetPx * 0.5) * unitPerPx;
        }

        let angleTextRadius = Math.max(dimensionRadius - angleTextOffset, dimensionRadius * 0.35);

        const angleTextPosition = {
            x: center.x + Math.cos(midAngle) * angleTextRadius,
            y: center.y + Math.sin(midAngle) * angleTextRadius
        };

        const angleTextElement = createSvgElement('text', {
            class: 'bf2d-angle-text',
            x: angleTextPosition.x.toFixed(2),
            y: angleTextPosition.y.toFixed(2),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': (baseFontSize * 0.9).toFixed(2)
        });
        angleTextElement.textContent = angleLabel;
        group.appendChild(angleTextElement);
    }

    function renderDimensions(svg, geometry, scale) {
        if (!geometry) return;
        const hasLengths = dimensionPreferences.showLengths && Array.isArray(geometry.legs) && geometry.legs.length > 0;
        const hasRadii = dimensionPreferences.showRadii && Array.isArray(geometry.bends) && geometry.bends.length > 0;
        if (!hasLengths && !hasRadii) {
            return;
        }

        const dimensionGroup = createSvgElement('g', { class: 'bf2d-dimensions' });
        const charWidthUnits = DIMENSION_CONFIG.approxCharWidthPx * scale.unitPerPx;
        const fontSize = Math.max(12 * scale.unitPerPx, 6 * scale.unitPerPx);

        if (hasLengths) {
            geometry.legs.forEach(leg => addLengthDimension(dimensionGroup, leg, {
                unitPerPx: scale.unitPerPx,
                pxPerUnit: scale.pxPerUnit,
                fontSize,
                charWidthUnits
            }));
        }

        if (hasRadii) {
            geometry.bends.forEach(bend => addBendDimension(dimensionGroup, bend, {
                unitPerPx: scale.unitPerPx,
                pxPerUnit: scale.pxPerUnit,
                fontSize,
                charWidthUnits
            }));
        }

        if (dimensionGroup.childNodes.length) {
            svg.appendChild(dimensionGroup);
        }
    }

    function setPreviewViewMode(mode) {
        const nextMode = mode === '3d' ? '3d' : '2d';
        const previousMode = state.viewMode;
        state.viewMode = nextMode;

        const container = document.querySelector('.bf2d-preview-container');
        if (container) {
            container.setAttribute('data-view-mode', nextMode);
        }

        const svg = document.getElementById('bf2dPreviewSvg');
        if (svg) {
            svg.setAttribute('aria-hidden', nextMode === '3d' ? 'true' : 'false');
        }

        const preview3d = document.getElementById('bf2dPreview3d');
        if (preview3d) {
            preview3d.setAttribute('aria-hidden', nextMode === '3d' ? 'false' : 'true');
        }

        const view2dBtn = document.getElementById('bf2dViewToggle2d');
        if (view2dBtn) {
            view2dBtn.classList.toggle('is-active', nextMode === '2d');
            view2dBtn.setAttribute('aria-pressed', nextMode === '2d' ? 'true' : 'false');
        }

        const view3dBtn = document.getElementById('bf2dViewToggle3d');
        if (view3dBtn) {
            view3dBtn.classList.toggle('is-active', nextMode === '3d');
            view3dBtn.setAttribute('aria-pressed', nextMode === '3d' ? 'true' : 'false');
        }

        if (nextMode === '3d' && window.bf2dViewer3D) {
            if (typeof window.bf2dViewer3D.init === 'function') {
                window.bf2dViewer3D.init();
            }
            if (previousMode !== '3d' && typeof window.bf2dViewer3D.prepareAutoFit === 'function') {
                window.bf2dViewer3D.prepareAutoFit();
            }
            if (typeof window.bf2dViewer3D.onResize === 'function') {
                window.bf2dViewer3D.onResize();
            }
        }
    }

    function renderSvgPreview(summary) {
        const svg = document.getElementById('bf2dPreviewSvg');
        const note = document.getElementById('bf2dPreviewNote');
        if (!svg) return;
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }
        if (note) {
            note.textContent = '';
            note.classList.remove('warning-message', 'error-message', 'success-message', 'info-message');
        }
        if (state.previewNoteOverride && (!summary.geometry || summary.errors.length)) {
            if (note) {
                const message = typeof state.previewNoteOverride === 'string'
                    ? state.previewNoteOverride
                    : state.previewNoteOverride?.message
                        || (state.previewNoteOverride?.messageKey && typeof i18n?.t === 'function'
                            ? i18n.t(state.previewNoteOverride.messageKey)
                            : state.previewNoteOverride?.messageKey)
                        || (typeof i18n?.t === 'function'
                            ? i18n.t('Keine Geometrie verfügbar.')
                            : 'Keine Geometrie verfügbar.');
                note.textContent = message;
                const type = state.previewNoteOverride?.type || 'info';
                if (type === 'error') {
                    note.classList.add('error-message');
                } else if (type === 'success') {
                    note.classList.add('success-message');
                } else if (type === 'warning') {
                    note.classList.add('warning-message');
                } else {
                    note.classList.add('info-message');
                }
            }
            svg.removeAttribute('viewBox');
            return;
        }
        if (summary.errors.length || !summary.geometry) {
            if (note) {
                note.textContent = typeof i18n?.t === 'function' ? i18n.t('Keine gültige Vorschau verfügbar.') : 'Keine gültige Vorschau verfügbar.';
                note.classList.add('warning-message');
            }
            svg.removeAttribute('viewBox');
            return;
        }

        const geometry = summary.geometry;
        const { viewBox, pathData, screenPoints } = geometry;
        svg.setAttribute('viewBox', `${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.width.toFixed(2)} ${viewBox.height.toFixed(2)}`);

        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('class', 'bf2d-svg-background');
        background.setAttribute('x', viewBox.x.toFixed(2));
        background.setAttribute('y', viewBox.y.toFixed(2));
        background.setAttribute('width', viewBox.width.toFixed(2));
        background.setAttribute('height', viewBox.height.toFixed(2));
        svg.appendChild(background);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'bf2d-svg-path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);

        const scale = computeSvgScale(svg, viewBox);
        renderDimensions(svg, geometry, scale);

        if (geometry.intersections && geometry.intersections.length > 0) {
            const intersectionGroup = createSvgElement('g', { class: 'bf2d-intersections' });
            geometry.intersections.forEach(point => {
                const screenPoint = { x: point.x, y: -point.y };
                const circle = createSvgElement('circle', {
                    cx: screenPoint.x.toFixed(2),
                    cy: screenPoint.y.toFixed(2),
                    r: 5 * scale.unitPerPx,
                    class: 'bf2d-intersection-marker'
                });
                intersectionGroup.appendChild(circle);
            });
            svg.appendChild(intersectionGroup);
        }

        if (screenPoints.length) {
            const start = screenPoints[0];
            const startMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            startMarker.setAttribute('class', 'bf2d-svg-start');
            startMarker.setAttribute('cx', start.x.toFixed(2));
            startMarker.setAttribute('cy', start.y.toFixed(2));
            startMarker.setAttribute('r', '4');
            svg.appendChild(startMarker);

            const end = screenPoints[screenPoints.length - 1];
            const endMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            endMarker.setAttribute('class', 'bf2d-svg-end');
            endMarker.setAttribute('cx', end.x.toFixed(2));
            endMarker.setAttribute('cy', end.y.toFixed(2));
            endMarker.setAttribute('r', '4');
            svg.appendChild(endMarker);
        }
    }

    function get3dDimensionSettings() {
        return {
            showDimensions: preview3dPreferences.showDimensions !== false,
            showZoneLengths: preview3dPreferences.showZoneLengths !== false,
            showOverhangs: preview3dPreferences.showOverhangs !== false
        };
    }

    function update3dPreview(summary) {
        const viewer = window.bf2dViewer3D;
        if (!viewer || typeof viewer.update !== 'function') {
            return;
        }

        if (typeof viewer.init === 'function') {
            viewer.init();
        }

        if (!summary || summary.errors.length || !summary.geometry) {
            viewer.update(null);
            return;
        }

        const geometry = summary.geometry;
        viewer.update({
            diameter: Number(state.meta.diameter) || 0,
            rollDiameter: Number(state.meta.rollDiameter) || 0,
            pathSegments: Array.isArray(geometry.pathSegments) ? geometry.pathSegments : [],
            points: Array.isArray(geometry.mathPoints) ? geometry.mathPoints : [],
            dimensionSettings: get3dDimensionSettings()
        });

        if (state.viewMode === '3d' && typeof viewer.onResize === 'function') {
            viewer.onResize();
        }
    }

    function findOptimizations(summary, allMachines) {
        const suggestions = [];
        if (!summary || !summary.requiresRollDiameter) {
            return suggestions;
        }

        const currentRollDiameter = summary.rollDiameter;
        const allAvailableRolls = new Set();
        allMachines.forEach(resource => {
            if (Array.isArray(resource.availableRollDiameters)) {
                resource.availableRollDiameters.forEach(roll => allAvailableRolls.add(roll));
            }
        });

        if (allAvailableRolls.size > 0 && !allAvailableRolls.has(currentRollDiameter)) {
            let closestRoll = -1;
            let minDiff = Infinity;
            allAvailableRolls.forEach(roll => {
                const diff = Math.abs(roll - currentRollDiameter);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestRoll = roll;
                }
            });

            if (closestRoll > 0) {
                suggestions.push({
                    type: 'roll_diameter',
                    message: `Vorschlag: Biegerollendurchmesser auf ${closestRoll} mm ändern, um die Maschinenkompatibilität zu verbessern.`,
                    action: () => {
                        setRollDiameterValue(closestRoll, { updateInput: true, fromUser: false });
                        updateOutputs();
                    }
                });
            }
        }

        return suggestions;
    }

    function renderOptimizations(suggestions) {
        const card = document.getElementById('bf2dOptimizerCard');
        const list = document.getElementById('bf2dOptimizerList');
        if (!card || !list) return;

        list.innerHTML = '';
        if (suggestions.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        suggestions.forEach(suggestion => {
            const item = document.createElement('div');
            item.className = 'bf2d-optimizer-item';

            const message = document.createElement('div');
            message.className = 'bf2d-optimizer-message';
            message.textContent = suggestion.message;
            item.appendChild(message);

            if (typeof suggestion.action === 'function') {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn-secondary';
                button.textContent = 'Anwenden';
                button.addEventListener('click', suggestion.action);
                item.appendChild(button);
            }

            list.appendChild(item);
        });
    }

    async function loadStandardShapes() {
        try {
            const response = await fetch('standard-shapes.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                standardShapes = data;
            }
        } catch (error) {
            console.error('Could not load standard shapes library:', error);
            standardShapes = [];
        }
    }

    function openStandardShapeLibrary() {
        const modal = document.getElementById('standardShapeLibraryModal');
        if (!modal) return;
        renderStandardShapeLibrary();
        modal.classList.add('visible');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeStandardShapeLibrary() {
        const modal = document.getElementById('standardShapeLibraryModal');
        if (!modal) return;
        modal.classList.remove('visible');
        modal.setAttribute('aria-hidden', 'true');
    }

    function renderStandardShapeLibrary() {
        const listEl = document.getElementById('standardShapeLibraryList');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (standardShapes.length === 0) {
            listEl.innerHTML = `<p>Standardformen-Bibliothek konnte nicht geladen werden.</p>`;
            return;
        }

        standardShapes.forEach(item => {
            const card = document.createElement('div');
            card.className = 'saved-shape-card';
            card.innerHTML = `
                <div class="saved-shape-card-header">
                    <h4 class="saved-shape-name">${item.name}</h4>
                </div>
                <div class="saved-shape-card-body">
                    <div class="bf2d-preview-stage" style="min-height: 150px;"></div>
                    <p>${item.description}</p>
                    <button type="button" class="btn-primary">Auswählen</button>
                </div>
            `;
            const previewContainer = card.querySelector('.bf2d-preview-stage');
            const shapeData = { ...item.shape, segments: item.shape.segments.map(s => createSegment(s.length, s.bendAngle, s.bendDirection, s.radius)) };
            const tempSummary = { geometry: buildGeometry(shapeData.segments), errors: [] };

            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('style', 'width: 100%; height: 150px;');
            previewContainer.appendChild(svg);
            renderSvgPreview({ ...tempSummary, errors: [] }, svg);


            card.querySelector('button').addEventListener('click', () => {
                applySavedShapeData(item.shape);
                closeStandardShapeLibrary();
            });

            listEl.appendChild(card);
        });
    }

    function updateOutputs() {
        if (!initialized) return;
        applyRollDiameterToSegments();
        updateSegmentRadiusInputs();
        const summary = computeSummary();
        updateSummaryUI(summary);
        updateErrorList(summary.errors);
        renderSvgPreview(summary);
        update3dPreview(summary);
        updateDataset(summary);
        updateMachineCompatibility(summary);
        const optimizations = findOptimizations(summary, availableResources);
        renderOptimizations(optimizations);
    }

    function sanitizeText(value) {
        return (value || '').toString().replace(/[;\r\n]+/g, ' ').trim();
    }

    function sanitizeFilename(value) {
        return sanitizeText(value).replace(/[^a-zA-Z0-9_-]+/g, '_');
    }

    function calculateAbsChecksum(text) {
        let sum = 0;
        for (let i = 0; i < text.length; i++) {
            sum = (sum + text.charCodeAt(i)) % 256;
        }
        return sum.toString(16).toUpperCase().padStart(2, '0');
    }

    function buildAbsDataset(summary) {
        const lines = [];
        const project = sanitizeText(state.meta.project);
        const order = sanitizeText(state.meta.order);
        const position = sanitizeText(state.meta.position);
        const steelGrade = sanitizeText(state.meta.steelGrade);
        const remark = sanitizeText(state.meta.remark);
        const diameter = Number(state.meta.diameter) || 0;
        const rollDiameter = Number(state.meta.rollDiameter) || 0;
        const rollRadius = rollDiameter > 0 ? rollDiameter / 2 : 0;
        const quantity = Math.max(1, Math.round(Number(state.meta.quantity) || 0));

        lines.push('BVBS;3.1;ABS');
        lines.push('ST;FORM;BF2D');
        lines.push(`ID;${project};${order};${position};${remark}`);
        lines.push(`PR;DIAMETER;${formatNumberForDataset(diameter)};STEEL;${steelGrade};QUANTITY;${quantity};S;${formatNumberForDataset(Math.max(rollDiameter, 0))}`);
        lines.push(`RE;STRAIGHT;${formatNumberForDataset(summary.straightLength)};ARC;${formatNumberForDataset(summary.arcLength)};TOTAL;${formatNumberForDataset(summary.totalLength)}`);

        state.segments.forEach((segment, index) => {
            const legIndex = index + 1;
            lines.push(`LG;${legIndex};${formatNumberForDataset(Math.max(segment.length, 0))}`);
            if (index < state.segments.length - 1) {
                const direction = segment.bendDirection === 'R' ? 'R' : 'L';
                const bendAngle = Math.max(segment.bendAngle, 0);
                const signedAngle = (direction === 'R' ? -1 : 1) * bendAngle;
                const radiusSource = bendAngle > 0 ? segment.radius : 0;
                const radiusValue = bendAngle > 0 ? enforceMinimumRadius(radiusSource) : 0;
                lines.push(`BN;${legIndex};${formatNumberForDataset(signedAngle)};RADIUS;${formatNumberForDataset(Math.max(radiusValue, 0))};DIR;${direction}`);
            }
        });

        lines.push(`EN;${formatNumberForDataset(summary.totalLength)}`);
        const baseText = lines.join('\n');
        const checksum = calculateAbsChecksum(baseText);
        return `${baseText}\nCS;${checksum}`;
    }

    function updateDataset(summary) {
        const textarea = document.getElementById('bf2dDatasetOutput');
        const copyBtn = document.getElementById('bf2dCopyButton');
        const downloadBtn = document.getElementById('bf2dDownloadButton');
        if (!textarea) return;

        if (summary.errors.length) {
            state.datasetText = '';
            textarea.value = '';
            copyBtn?.setAttribute('disabled', 'disabled');
            downloadBtn?.setAttribute('disabled', 'disabled');
            return;
        }

        const dataset = buildAbsDataset(summary);
        state.datasetText = dataset;
        textarea.value = dataset;
        copyBtn?.removeAttribute('disabled');
        downloadBtn?.removeAttribute('disabled');
    }

    async function copyDataset() {
        if (!state.datasetText) {
            if (typeof showFeedback === 'function') {
                showFeedback('bf2dDatasetStatus', i18n.t('Bitte Eingaben korrigieren, um den Datensatz zu erzeugen.'), 'warning', 3000);
            }
            return;
        }
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(state.datasetText);
            } else {
                throw new Error('clipboard unavailable');
            }
            if (typeof showFeedback === 'function') {
                showFeedback('bf2dDatasetStatus', i18n.t('Datensatz in Zwischenablage kopiert.'), 'success', 2000);
            }
        } catch (error) {
            const textarea = document.getElementById('bf2dDatasetOutput');
            if (textarea) {
                textarea.focus();
                textarea.select();
            }
            if (typeof showFeedback === 'function') {
                showFeedback('bf2dDatasetStatus', i18n.t('Clipboard nicht verfügbar.'), 'warning', 4000);
            }
        }
    }

    function downloadDataset() {
        if (!state.datasetText) {
            if (typeof showFeedback === 'function') {
                showFeedback('bf2dDatasetStatus', i18n.t('Bitte Eingaben korrigieren, um den Datensatz zu erzeugen.'), 'warning', 3000);
            }
            return;
        }
        const blob = new Blob([state.datasetText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const filenameParts = [sanitizeFilename(state.meta.project || 'bf2d'), sanitizeFilename(state.meta.position || 'form')].filter(Boolean);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameParts.join('_') || 'bf2d_form'}.abs`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        if (typeof showFeedback === 'function') {
            showFeedback('bf2dDatasetStatus', i18n.t('ABS-Datei heruntergeladen.'), 'success', 2000);
        }
    }

    function normalizeAbsContent(text) {
        if (typeof text !== 'string') return '';
        return text.replace(/\r\n?/g, '\n');
    }

    function normalizeAbsLine(line) {
        if (typeof line !== 'string') return '';
        const trimmed = line.trim();
        if (!trimmed) return '';
        return trimmed.replace(/@\s+([HGMAPCXYE])/g, '@$1');
    }

    function parseAbsBlock(rawBlock, blockId) {
        const block = {
            id: blockId,
            raw: rawBlock,
            fields: {},
            errors: [],
            warnings: []
        };
        if (!rawBlock || typeof rawBlock !== 'string') {
            block.errors.push('Leerer Block');
            return block;
        }
        if (blockId === 'C') {
            block.checkValue = null;
            return block;
        }
        const content = rawBlock.slice(1);
        const normalizedContent = content.trim();
        let lastIndex = 0;
        ABS_FIELD_REGEX.lastIndex = 0;
        let fieldMatch;
        while ((fieldMatch = ABS_FIELD_REGEX.exec(normalizedContent)) !== null) {
            lastIndex = ABS_FIELD_REGEX.lastIndex;
            const key = fieldMatch[1];
            const rawValue = fieldMatch[2] || '';
            const trimmedValue = rawValue.trim();
            if (trimmedValue.includes('@')) {
                block.warnings.push(`Unzulässiges Zeichen '@' im Feld ${key}`);
            }
            const value = trimmedValue.includes(';')
                ? trimmedValue.split(';').map(part => part.trim())
                : trimmedValue;
            if (!block.fields[key]) {
                block.fields[key] = [];
            }
            block.fields[key].push(value);
        }
        const remainder = normalizedContent.slice(lastIndex).trim();
        if (remainder.length > 0) {
            block.errors.push('Block unvollständig');
        }
        return block;
    }

    function getFirstFieldValue(block, key) {
        if (!block || !block.fields || !block.fields[key] || !block.fields[key].length) {
            return undefined;
        }
        const first = block.fields[key][0];
        if (Array.isArray(first)) {
            return first.length ? first[0] : undefined;
        }
        return first;
    }

    function parseNumberValue(value) {
        if (Array.isArray(value)) {
            return parseNumberValue(value[0]);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : NaN;
        }
        if (typeof value !== 'string') return NaN;
        const text = value.trim();
        if (!text) return NaN;
        const normalized = text.replace(',', '.');
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function parseIntegerValue(value) {
        const numeric = parseNumberValue(value);
        if (!Number.isFinite(numeric)) return NaN;
        return Math.round(numeric);
    }

    function parseDiameterValue(value) {
        if (Array.isArray(value)) {
            return parseDiameterValue(value[0]);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : NaN;
        }
        if (typeof value !== 'string') return NaN;
        const text = value.trim();
        if (!text) return NaN;
        const cleaned = text.replace(/d$/i, '').replace(',', '.');
        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function buildSegmentsFromNodes(nodes) {
        if (!Array.isArray(nodes) || nodes.length < 2) {
            return null;
        }
        const segments = [];
        const orientations = [];
        for (let i = 0; i < nodes.length - 1; i++) {
            const start = nodes[i];
            const end = nodes[i + 1];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            const orientation = Math.atan2(dy, dx);
            orientations.push(orientation);
            segments.push({
                length,
                bendAngle: 0,
                bendDirection: 'L'
            });
        }
        for (let i = 0; i < segments.length - 1; i++) {
            let delta = orientations[i + 1] - orientations[i];
            while (delta <= -Math.PI) delta += Math.PI * 2;
            while (delta > Math.PI) delta -= Math.PI * 2;
            let angleDeg = Math.abs(delta * 180 / Math.PI);
            if (angleDeg < 1e-6) angleDeg = 0;
            if (angleDeg > 180) angleDeg = 180;
            segments[i].bendAngle = angleDeg;
            segments[i].bendDirection = delta < 0 ? 'R' : 'L';
        }
        if (segments.length) {
            const last = segments[segments.length - 1];
            last.bendAngle = 0;
            last.bendDirection = last.bendDirection === 'R' ? 'R' : 'L';
        }
        return segments;
    }

    function parseAbsLine(line, orderIndex, originalLine, sourceIndex) {
        const entry = {
            id: `abs-${orderIndex + 1}`,
            index: orderIndex,
            sourceIndex: typeof sourceIndex === 'number' ? sourceIndex : orderIndex,
            rawLine: line,
            originalLine: originalLine ?? line,
            type: '',
            startValid: true,
            blocks: [],
            blockMap: new Map(),
            metadata: {},
            segmentDefinitions: null,
            hasGeometry: false,
            lengthFromGeometry: NaN,
            checksum: null,
            errorMessages: [],
            warningMessages: []
        };

        if (!line) {
            entry.startValid = false;
            entry.errorMessages.push('Leerer Datensatz');
            return entry;
        }

        const startMatch = ABS_START_TOKEN_REGEX.exec(line);
        if (startMatch) {
            entry.type = startMatch[1];
        } else {
            entry.startValid = false;
            const prefix = line.split('@', 1)[0];
            entry.type = prefix || '';
            entry.errorMessages.push('Ungültiger Startmarker');
        }

        const blockMatches = [];
        ABS_BLOCK_START_REGEX.lastIndex = 0;
        let blockMatch;
        while ((blockMatch = ABS_BLOCK_START_REGEX.exec(line)) !== null) {
            blockMatches.push({ id: blockMatch[1], index: blockMatch.index });
        }
        if (!blockMatches.length) {
            entry.errorMessages.push('Keine Blöcke gefunden');
            return entry;
        }

        blockMatches.forEach((match, idx) => {
            const start = match.index;
            const end = idx + 1 < blockMatches.length ? blockMatches[idx + 1].index : line.length;
            const rawBlock = line.slice(start, end);
            const parsedBlock = parseAbsBlock(rawBlock, match.id);
            parsedBlock.startIndex = start;
            parsedBlock.order = idx;
            entry.blocks.push(parsedBlock);
            if (!entry.blockMap.has(match.id)) {
                entry.blockMap.set(match.id, []);
            }
            entry.blockMap.get(match.id).push(parsedBlock);
            parsedBlock.errors.forEach(message => {
                entry.errorMessages.push(`Block ${match.id}: ${message}`);
            });
            parsedBlock.warnings.forEach(message => {
                entry.warningMessages.push(`Block ${match.id}: ${message}`);
            });
        });

        const headerBlock = (entry.blockMap.get('H') || [])[0];
        if (headerBlock) {
            const diameterRaw = getFirstFieldValue(headerBlock, 'd');
            const diameter = parseDiameterValue(diameterRaw);
            const quantity = parseIntegerValue(getFirstFieldValue(headerBlock, 'n'));
            const totalLength = parseNumberValue(getFirstFieldValue(headerBlock, 'l'));
            const rollDiameter = parseNumberValue(getFirstFieldValue(headerBlock, 'f'));
            entry.metadata = {
                project: getFirstFieldValue(headerBlock, 'j') || '',
                order: getFirstFieldValue(headerBlock, 'i') || '',
                position: getFirstFieldValue(headerBlock, 'p') || '',
                diameter,
                diameterRaw: typeof diameterRaw === 'string' ? diameterRaw : '',
                totalLength: Number.isFinite(totalLength) ? totalLength : NaN,
                quantity: Number.isFinite(quantity) ? quantity : NaN,
                steelGrade: getFirstFieldValue(headerBlock, 's') || '',
                remark: getFirstFieldValue(headerBlock, 'v') || '',
                rollDiameter: Number.isFinite(rollDiameter) ? rollDiameter : NaN,
                doubleBar: typeof diameterRaw === 'string' && /d$/i.test(diameterRaw)
            };
        } else {
            entry.metadata = {
                project: '',
                order: '',
                position: '',
                diameter: NaN,
                diameterRaw: '',
                totalLength: NaN,
                quantity: NaN,
                steelGrade: '',
                remark: '',
                rollDiameter: NaN,
                doubleBar: false
            };
            entry.warningMessages.push('H-Block fehlt');
        }

        const nodes = [];
        ['X', 'Y', 'E'].forEach(blockId => {
            const blocks = entry.blockMap.get(blockId) || [];
            blocks.forEach(block => {
                const xValue = getFirstFieldValue(block, 'x');
                const yValue = getFirstFieldValue(block, 'y');
                if (xValue === undefined || yValue === undefined) {
                    entry.warningMessages.push(`Block ${blockId}: Koordinaten fehlen`);
                    return;
                }
                const x = parseNumberValue(xValue);
                const y = parseNumberValue(yValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    entry.errorMessages.push(`Block ${blockId}: Ungültige Koordinaten`);
                    return;
                }
                const sequence = parseNumberValue(getFirstFieldValue(block, 's'));
                nodes.push({
                    x,
                    y,
                    blockId,
                    order: block.order || 0,
                    sequence: Number.isFinite(sequence) ? sequence : null
                });
            });
        });

        if (nodes.length >= 2) {
            const sortedNodes = nodes.slice().sort((a, b) => {
                if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) {
                    return a.sequence - b.sequence;
                }
                if (a.order !== b.order) {
                    return a.order - b.order;
                }
                return 0;
            });
            const segments = buildSegmentsFromNodes(sortedNodes);
            if (segments && segments.length) {
                entry.segmentDefinitions = segments;
                entry.hasGeometry = segments.length >= 2;
                entry.lengthFromGeometry = segments.reduce((total, segment) => total + Math.max(segment.length, 0), 0);
            }
        }

        if (!entry.segmentDefinitions) {
            entry.hasGeometry = false;
            entry.segmentDefinitions = null;
            entry.lengthFromGeometry = NaN;
            if (!nodes.length) {
                entry.warningMessages.push('Keine Geometrie gefunden');
            } else {
                entry.warningMessages.push('Geometrie unvollständig');
            }
        }

        return entry;
    }

    function parseAbsFileContent(text) {
        const normalized = normalizeAbsContent(text);
        const rawLines = normalized.split(/\n/);
        const entries = [];
        rawLines.forEach((rawLine, sourceIndex) => {
            const trimmed = typeof rawLine === 'string' ? rawLine.trim() : '';
            if (!trimmed) return;
            const normalizedLine = normalizeAbsLine(rawLine);
            if (!normalizedLine) return;
            const entry = parseAbsLine(normalizedLine, entries.length, trimmed, sourceIndex);
            entries.push(entry);
        });
        assignDisplayPositions(entries);
        return entries;
    }

    function assignDisplayPositions(entries) {
        const counts = new Map();
        entries.forEach(entry => {
            const position = entry?.metadata?.position || '';
            if (!position) return;
            counts.set(position, (counts.get(position) || 0) + 1);
        });
        const usedIndices = new Map();
        entries.forEach(entry => {
            const position = entry?.metadata?.position || '';
            if (!position) {
                entry.displayPosition = '';
                return;
            }
            const total = counts.get(position) || 0;
            if (total <= 1) {
                entry.displayPosition = position;
                return;
            }
            const index = (usedIndices.get(position) || 0) + 1;
            usedIndices.set(position, index);
            entry.displayPosition = `${position} (${index})`;
        });
    }

    function formatOptionalNumber(value, decimals = 1) {
        if (!Number.isFinite(value)) {
            return '—';
        }
        const factor = Math.pow(10, decimals);
        const rounded = Math.round(value * factor) / factor;
        let text = rounded.toFixed(decimals);
        if (decimals > 0) {
            text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        }
        return text;
    }

    function updateImportControls() {
        const selectAll = document.getElementById('bf2dImportSelectAll');
        const total = importState.entries.length;
        const selected = importState.selectedIds.size;
        if (selectAll) {
            if (!total) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            } else {
                selectAll.checked = selected > 0 && selected === total;
                selectAll.indeterminate = selected > 0 && selected < total;
            }
        }
        const exportButton = document.getElementById('bf2dExportSelectionButton');
        if (exportButton) {
            if (selected > 0) {
                exportButton.removeAttribute('disabled');
            } else {
                exportButton.setAttribute('disabled', 'disabled');
            }
        }
    }

    function updateImportStatusDisplay() {
        const statusEl = document.getElementById('bf2dImportStatus');
        if (!statusEl) return;
        const total = importState.entries.length;
        if (!total) {
            statusEl.textContent = typeof i18n?.t === 'function'
                ? i18n.t('Keine Positionen importiert.')
                : 'Keine Positionen importiert.';
            statusEl.classList.remove('error-message', 'warning-message', 'success-message');
            return;
        }
        const errorCount = importState.entries.filter(entry => entry.errorMessages.length > 0 || entry.startValid === false).length;
        const warningCount = importState.entries.filter(entry => entry.errorMessages.length === 0 && entry.warningMessages.length > 0).length;
        const parts = [];
        if (typeof i18n?.t === 'function') {
            parts.push(i18n.t('{count} Positionen importiert.', { count: total }));
            if (errorCount) {
                parts.push(i18n.t('{count} mit Fehlern', { count: errorCount }));
            }
            if (warningCount) {
                parts.push(i18n.t('{count} mit Warnungen', { count: warningCount }));
            }
        } else {
            parts.push(`${total} Positionen importiert.`);
            if (errorCount) parts.push(`${errorCount} mit Fehlern`);
            if (warningCount) parts.push(`${warningCount} mit Warnungen`);
        }
        statusEl.textContent = parts.join(' · ');
        statusEl.classList.remove('error-message', 'warning-message', 'success-message');
        if (errorCount) {
            statusEl.classList.add('error-message');
        } else if (warningCount) {
            statusEl.classList.add('warning-message');
        }
    }

    function renderImportTable() {
        const tbody = document.getElementById('bf2dImportTableBody');
        if (!tbody) return;
        tbody.textContent = '';
        const entries = importState.entries || [];
        if (!entries.length) {
            const row = document.createElement('tr');
            row.className = 'bf2d-import-empty-row';
            const cell = document.createElement('td');
            cell.colSpan = 7;
            cell.className = 'bf2d-import-empty-cell';
            cell.textContent = typeof i18n?.t === 'function'
                ? i18n.t('Keine Positionen importiert.')
                : 'Keine Positionen importiert.';
            row.appendChild(cell);
            tbody.appendChild(row);
            updateImportControls();
            updateImportStatusDisplay();
            return;
        }

        entries.forEach(entry => {
            const row = document.createElement('tr');
            row.dataset.entryId = entry.id;
            if (entry.errorMessages.length || entry.startValid === false) {
                row.classList.add('bf2d-import-error');
            } else if (entry.warningMessages.length) {
                row.classList.add('bf2d-import-warning');
            }
            if (importState.activeId === entry.id) {
                row.classList.add('bf2d-import-active');
            }
            const tooltipParts = [];
            if (entry.errorMessages.length) {
                tooltipParts.push(entry.errorMessages.join(' · '));
            }
            if (entry.warningMessages.length) {
                tooltipParts.push(entry.warningMessages.join(' · '));
            }
            if (tooltipParts.length) {
                row.title = tooltipParts.join('\n');
            }

            const selectCell = document.createElement('td');
            selectCell.className = 'bf2d-import-select-cell';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'bf2d-import-select';
            checkbox.dataset.entryId = entry.id;
            checkbox.checked = importState.selectedIds.has(entry.id);
            checkbox.addEventListener('change', event => {
                const input = event.currentTarget;
                if (!(input instanceof HTMLInputElement)) {
                    return;
                }
                if (input.checked) {
                    importState.selectedIds.add(entry.id);
                } else {
                    importState.selectedIds.delete(entry.id);
                }
                updateImportControls();
                updateImportStatusDisplay();
            });
            selectCell.appendChild(checkbox);
            row.appendChild(selectCell);

            const typeCell = document.createElement('td');
            typeCell.textContent = entry.type || '—';
            row.appendChild(typeCell);

            const positionCell = document.createElement('td');
            positionCell.textContent = entry.displayPosition || entry.metadata.position || '—';
            row.appendChild(positionCell);

            const diameterCell = document.createElement('td');
            diameterCell.textContent = formatOptionalNumber(entry.metadata.diameter, 1);
            row.appendChild(diameterCell);

            const lengthValue = Number.isFinite(entry.metadata.totalLength) ? entry.metadata.totalLength : entry.lengthFromGeometry;
            const lengthCell = document.createElement('td');
            lengthCell.textContent = formatOptionalNumber(lengthValue, 1);
            row.appendChild(lengthCell);

            const quantityCell = document.createElement('td');
            const quantity = Number.isFinite(entry.metadata.quantity) ? Math.round(entry.metadata.quantity) : NaN;
            quantityCell.textContent = Number.isFinite(quantity) ? String(quantity) : '—';
            row.appendChild(quantityCell);

            const checksumCell = document.createElement('td');
            checksumCell.className = 'bf2d-import-checksum-cell';
            checksumCell.textContent = '—';
            row.appendChild(checksumCell);

            row.tabIndex = 0;
            row.addEventListener('click', event => {
                if (event.target.closest('.bf2d-import-select')) {
                    return;
                }
                loadImportEntry(entry);
            });

            row.addEventListener('keydown', event => {
                if (event.target.closest('.bf2d-import-select')) {
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    loadImportEntry(entry);
                }
            });

            tbody.appendChild(row);
        });

        updateImportControls();
        updateImportStatusDisplay();
    }

    function setImportView(state) {
        const dropZone = document.getElementById('bf2dDropZone');
        const instructions = dropZone?.querySelector('.bf2d-drop-zone-instructions');
        const content = document.getElementById('bf2dImportContent');
        const clearButton = document.getElementById('bf2dClearImportButton');

        if (!instructions || !content || !clearButton) return;

        if (state === 'empty') {
            instructions.style.display = 'block';
            content.style.display = 'none';
            clearButton.style.display = 'none';
            if (dropZone) {
                dropZone.style.cursor = 'pointer';
            }
        } else if (state === 'data') {
            instructions.style.display = 'none';
            content.style.display = 'block';
            clearButton.style.display = 'inline-flex';
            if (dropZone) {
                dropZone.style.cursor = 'default';
            }
        }
    }

    function clearImport() {
        importState.entries = [];
        importState.selectedIds.clear();
        importState.activeId = null;
        importState.fileName = '';
        const importInput = document.getElementById('bf2dImportFileInput');
        if (importInput) {
            importInput.value = '';
        }
        renderImportTable();
        setImportView('empty');
    }

    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        const dropZone = document.getElementById('bf2dDropZone');
        if (dropZone) {
            dropZone.classList.add('drag-over');
        }
    }

    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        const dropZone = document.getElementById('bf2dDropZone');
        if (dropZone) {
            dropZone.classList.remove('drag-over');
        }
    }

    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        const dropZone = document.getElementById('bf2dDropZone');
        if (dropZone) {
            dropZone.classList.remove('drag-over');
        }
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            processAbsFile(files[0]);
        }
    }

    function handleFileInputChange(event) {
        const input = event.target;
        const files = input?.files;
        if (!files || !files.length) return;
        processAbsFile(files[0]);
    }

    async function processAbsFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            importState.entries = parseAbsFileContent(text);
            importState.selectedIds.clear();
            importState.activeId = null;
            importState.fileName = file.name || '';
            renderImportTable();
            setImportView('data');
        } catch (error) {
            console.error('Failed to import ABS file', error);
            clearImport();
            const statusEl = document.getElementById('bf2dImportStatus');
            if (statusEl) {
                const message = typeof i18n?.t === 'function'
                    ? i18n.t('Fehler beim Einlesen der ABS-Datei.')
                    : 'Fehler beim Einlesen der ABS-Datei.';
                statusEl.textContent = message;
                statusEl.classList.add('error-message');
                setImportView('data'); // Show error message inside the content area
            }
        }
    }

    function handleImportSelectAll(event) {
        const checked = Boolean(event.target.checked);
        importState.selectedIds.clear();
        if (checked) {
            importState.entries.forEach(entry => importState.selectedIds.add(entry.id));
        }
        renderImportTable();
    }

    function exportSelectedAbsEntries() {
        if (!importState.selectedIds.size) {
            return;
        }
        const selectedEntries = importState.entries
            .filter(entry => importState.selectedIds.has(entry.id))
            .sort((a, b) => a.sourceIndex - b.sourceIndex);
        if (!selectedEntries.length) return;
        const content = selectedEntries.map(entry => entry.originalLine || entry.rawLine).join('\n');
        if (!content) return;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const baseName = importState.fileName ? importState.fileName.replace(/\.[^.]+$/, '') : 'abs_selection';
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeFilename(baseName || 'abs_selection')}.abs`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function loadImportEntry(entry) {
        if (!entry) return;
        importState.activeId = entry.id;
        const meta = { ...META_DEFAULTS };
        const header = entry.metadata || {};
        meta.project = header.project || META_DEFAULTS.project;
        meta.order = header.order || META_DEFAULTS.order;
        meta.position = header.position || META_DEFAULTS.position;
        meta.steelGrade = header.steelGrade || META_DEFAULTS.steelGrade;
        meta.remark = header.remark || META_DEFAULTS.remark;
        const quantity = Number.isFinite(header.quantity) && header.quantity > 0 ? Math.round(header.quantity) : META_DEFAULTS.quantity;
        meta.quantity = Math.max(1, quantity);
        meta.diameter = Number.isFinite(header.diameter) && header.diameter > 0 ? header.diameter : META_DEFAULTS.diameter;
        const rollDiameter = Number.isFinite(header.rollDiameter) && header.rollDiameter > 0
            ? header.rollDiameter
            : Number.isFinite(meta.diameter) && meta.diameter > 0
                ? meta.diameter * 4
                : META_DEFAULTS.rollDiameter;
        meta.rollDiameter = rollDiameter;
        Object.assign(state.meta, meta);
        writeMetaToInputs();

        let segments = [];
        if (Array.isArray(entry.segmentDefinitions) && entry.segmentDefinitions.length) {
            segmentIdCounter = 0;
            segments = entry.segmentDefinitions.map(segment => createSegment(segment.length, segment.bendAngle, segment.bendDirection));
        } else {
            segmentIdCounter = 0;
            segments = [];
        }
        state.segments = segments;
        state.previewNoteOverride = entry.hasGeometry ? null : { type: 'info', messageKey: 'Keine Geometrie verfügbar.' };
        setRollDiameterValue(state.meta.rollDiameter, { updateInput: true, fromUser: false });
        renderSegmentTable();
        updateOutputs();
        renderImportTable();
    }

    function init() {
        if (initialized) return;
        const view = document.getElementById('bf2dView');
        if (!view) return;
        loadStandardShapes();
        initialized = true;
        segmentIdCounter = 0;
        initDefaultSegments();
        readMetaFromInputs();
        const initialRoll = Number(state.meta.rollDiameter);
        const defaultRoll = Number(state.meta.diameter) * 4;
        if (Number.isFinite(initialRoll) && initialRoll > 0) {
            setRollDiameterValue(initialRoll);
        } else if (Number.isFinite(defaultRoll) && defaultRoll > 0) {
            setRollDiameterValue(defaultRoll);
        } else {
            setRollDiameterValue(0);
        }
        attachMetaListeners();
        attachActionListeners();
        attachStorageListeners();

        document.getElementById('bf2dOpenLibraryButton')?.addEventListener('click', openStandardShapeLibrary);
        document.getElementById('closeStandardShapeLibraryModalBtn')?.addEventListener('click', closeStandardShapeLibrary);
        document.getElementById('cancelStandardShapeLibraryBtn')?.addEventListener('click', closeStandardShapeLibrary);

        populateSavedFormsSelect();
        renderImportTable();
        renderSegmentTable();
        setupResourceIntegration();
        setPreviewViewMode(state.viewMode || '2d');
        updateOutputs();
    }

    const configurator = {
        init,
        onShow() {
            if (!initialized) return;
            const currentSelection = document.getElementById('bf2dSavedForms')?.value || '';
            populateSavedFormsSelect(currentSelection);
            setPreviewViewMode(state.viewMode || '2d');
            updateOutputs();
        },
        refreshTranslations() {
            if (!initialized) return;
            const currentSelection = document.getElementById('bf2dSavedForms')?.value || '';
            populateSavedFormsSelect(currentSelection);
            renderSegmentTable();
            setPreviewViewMode(state.viewMode || '2d');
            updateOutputs();
        }
    };

    window.bf2dConfigurator = configurator;

    document.addEventListener('DOMContentLoaded', init);
})();
