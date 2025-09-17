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
        datasetText: ''
    };

    let initialized = false;
    let segmentIdCounter = 0;
    let rollDiameterAuto = true;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const dimensionPreferences = {
        showLengths: true,
        showRadii: true
    };
    const DIMENSION_CONFIG = Object.freeze({
        lengthOffsetPx: 16,
        lengthTextGapPx: 10,
        lengthTextExtraGapPx: 18,
        lengthArrowClearancePx: 6,
        minLengthTextSpanPx: 50,
        approxCharWidthPx: 6.5,
        radiusInnerOffsetPx: 14,
        radiusTextOffsetPx: 10,
        angleTextOffsetPx: 24,
        minArcTextWidthPx: 48
    });
    const DIMENSION_ARROW_MARKER_ID = 'bf2d-dim-arrow';
    const SAVED_FORMS_STORAGE_KEY = 'bf2dSavedForms';

    function createSvgElement(tagName, attributes = {}) {
        const element = document.createElementNS(SVG_NS, tagName);
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            element.setAttribute(key, String(value));
        });
        return element;
    }

    function getRollRadius() {
        const rollDiameter = Number(state.meta.rollDiameter);
        if (!Number.isFinite(rollDiameter) || rollDiameter <= 0) {
            return 0;
        }
        return rollDiameter / 2;
    }

    function createSegment(length, bendAngle, bendDirection = 'L', radius = null) {
        const numericLength = Number(length) || 0;
        const numericAngle = Number(bendAngle) || 0;
        const normalizedDirection = bendDirection === 'R' ? 'R' : 'L';
        let numericRadius;
        if (radius === null || typeof radius === 'undefined') {
            numericRadius = numericAngle > 0 ? getRollRadius() : 0;
        } else {
            numericRadius = Number(radius) || 0;
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
            if (isLast || angle <= 0 || rollRadius <= 0) {
                segment.radius = 0;
            } else {
                segment.radius = rollRadius;
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

    function attachMetaListeners() {
        metaFieldDefinitions().forEach(def => {
            const el = document.getElementById(def.id);
            if (!el) return;
            el.addEventListener('input', event => {
                if (def.key === 'rollDiameter') {
                    setRollDiameterValue(event.target.value, { updateInput: false, fromUser: true });
                } else {
                    state.meta[def.key] = def.parser(event.target.value);
                    if (def.key === 'diameter' && rollDiameterAuto) {
                        setRollDiameterValue(state.meta.diameter * 4);
                    }
                }
                updateOutputs();
            });
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
            errors
        };
    }

    function buildGeometry(segments) {
        applyRollDiameterToSegments();
        let orientation = 0;
        let current = { x: 0, y: 0 };
        const mathPoints = [{ x: 0, y: 0 }];
        const legs = [];
        const bends = [];

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

            const isLast = index === segments.length - 1;
            let signedAngleRad = 0;
            if (!isLast) {
                const angleDeg = Number(segment.bendAngle) || 0;
                const sign = segment.bendDirection === 'R' ? -1 : 1;
                signedAngleRad = (angleDeg * Math.PI / 180) * sign;
                const radius = Number(segment.radius) || 0;
                if (angleDeg > 0 && radius > 0) {
                    const arcStart = { ...endPoint };
                    const leftNormal = { x: -dir.y, y: dir.x };
                    const center = {
                        x: arcStart.x + leftNormal.x * radius * sign,
                        y: arcStart.y + leftNormal.y * radius * sign
                    };
                    const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
                    const steps = Math.max(6, Math.ceil(Math.abs(angleDeg) / 10));
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
            bends
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

    function createDimensionMarkerDefs() {
        const defs = createSvgElement('defs');
        const marker = createSvgElement('marker', {
            id: DIMENSION_ARROW_MARKER_ID,
            orient: 'auto-start-reverse',
            markerWidth: '6',
            markerHeight: '6',
            refX: '4',
            refY: '3',
            markerUnits: 'strokeWidth'
        });
        const markerPath = createSvgElement('path', {
            d: 'M0 0 L6 3 L0 6 Z',
            fill: 'var(--text-color)'
        });
        marker.appendChild(markerPath);
        defs.appendChild(marker);
        return defs;
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
        const strokeWidth = config.strokeWidth;
        const charWidthUnits = config.charWidthUnits;

        const offsetUnits = DIMENSION_CONFIG.lengthOffsetPx * unitPerPx;
        const textGapUnits = DIMENSION_CONFIG.lengthTextGapPx * unitPerPx;
        const extraGapUnits = DIMENSION_CONFIG.lengthTextExtraGapPx * unitPerPx;
        const arrowClearanceUnits = DIMENSION_CONFIG.lengthArrowClearancePx * unitPerPx;

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

        const extensionStart = createSvgElement('line', {
            class: 'bf2d-dimension-extension',
            x1: start.x.toFixed(2),
            y1: start.y.toFixed(2),
            x2: dimStart.x.toFixed(2),
            y2: dimStart.y.toFixed(2),
            'stroke-width': strokeWidth.toFixed(2)
        });
        const extensionEnd = createSvgElement('line', {
            class: 'bf2d-dimension-extension',
            x1: end.x.toFixed(2),
            y1: end.y.toFixed(2),
            x2: dimEnd.x.toFixed(2),
            y2: dimEnd.y.toFixed(2),
            'stroke-width': strokeWidth.toFixed(2)
        });
        group.appendChild(extensionStart);
        group.appendChild(extensionEnd);

        const dimensionLine = createSvgElement('line', {
            class: 'bf2d-dimension-line',
            x1: dimStart.x.toFixed(2),
            y1: dimStart.y.toFixed(2),
            x2: dimEnd.x.toFixed(2),
            y2: dimEnd.y.toFixed(2),
            'stroke-width': strokeWidth.toFixed(2),
            'marker-start': `url(#${DIMENSION_ARROW_MARKER_ID})`,
            'marker-end': `url(#${DIMENSION_ARROW_MARKER_ID})`
        });
        group.appendChild(dimensionLine);

        const label = `${formatDisplayNumber(length)} mm`;
        const dimensionLength = Math.hypot(dimEnd.x - dimStart.x, dimEnd.y - dimStart.y);
        const availableForText = dimensionLength - 2 * arrowClearanceUnits;
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
        const strokeWidth = config.strokeWidth;
        const baseFontSize = config.fontSize;

        let dimensionRadius = radius - DIMENSION_CONFIG.radiusInnerOffsetPx * unitPerPx;
        if (!Number.isFinite(dimensionRadius) || dimensionRadius <= 0) {
            dimensionRadius = Math.max(radius * 0.6, 24 * unitPerPx);
        }

        const center = bend.screenCenter;
        const startUnit = bend.startUnit;
        const endUnit = bend.endUnit;
        const sweepDir = bend.sweepDir;

        const dimensionStart = {
            x: center.x + startUnit.x * dimensionRadius,
            y: center.y + startUnit.y * dimensionRadius
        };
        const dimensionEnd = {
            x: center.x + endUnit.x * dimensionRadius,
            y: center.y + endUnit.y * dimensionRadius
        };

        const sweepFlag = sweepDir < 0 ? 1 : 0;
        const arcPath = createSvgElement('path', {
            class: 'bf2d-dimension-arc',
            d: `M ${dimensionStart.x.toFixed(2)} ${dimensionStart.y.toFixed(2)} A ${dimensionRadius.toFixed(2)} ${dimensionRadius.toFixed(2)} 0 0 ${sweepFlag} ${dimensionEnd.x.toFixed(2)} ${dimensionEnd.y.toFixed(2)}`,
            'stroke-width': strokeWidth.toFixed(2),
            'marker-start': `url(#${DIMENSION_ARROW_MARKER_ID})`,
            'marker-end': `url(#${DIMENSION_ARROW_MARKER_ID})`
        });
        group.appendChild(arcPath);

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

        const radiusLabel = `R${formatDisplayNumber(radius)} mm`;
        const angleLabel = `${formatDisplayNumber(angleDeg)}°`;
        const arcLengthPx = Math.abs(dimensionRadius) * totalAngle * pxPerUnit;
        const radiusTextWidthPx = radiusLabel.length * DIMENSION_CONFIG.approxCharWidthPx;
        const requiresExtraOffset = arcLengthPx < Math.max(radiusTextWidthPx, DIMENSION_CONFIG.minArcTextWidthPx);

        let radiusTextOffset = DIMENSION_CONFIG.radiusTextOffsetPx * unitPerPx;
        let angleTextOffset = DIMENSION_CONFIG.angleTextOffsetPx * unitPerPx;
        if (requiresExtraOffset) {
            radiusTextOffset += DIMENSION_CONFIG.radiusTextOffsetPx * unitPerPx;
            angleTextOffset += (DIMENSION_CONFIG.angleTextOffsetPx * 0.5) * unitPerPx;
        }

        let radiusTextRadius = Math.max(dimensionRadius - radiusTextOffset, dimensionRadius * 0.45);
        let angleTextRadius = Math.max(radiusTextRadius - angleTextOffset, dimensionRadius * 0.35);

        const radiusTextPosition = {
            x: center.x + Math.cos(midAngle) * radiusTextRadius,
            y: center.y + Math.sin(midAngle) * radiusTextRadius
        };
        const angleTextPosition = {
            x: center.x + Math.cos(midAngle) * angleTextRadius,
            y: center.y + Math.sin(midAngle) * angleTextRadius
        };

        let tangentAngleDeg = (midAngle + (sweepDir < 0 ? -Math.PI / 2 : Math.PI / 2)) * 180 / Math.PI;
        if (tangentAngleDeg > 90 || tangentAngleDeg < -90) {
            tangentAngleDeg += 180;
        }

        const radiusTextGroup = createSvgElement('g', {
            transform: `translate(${radiusTextPosition.x.toFixed(2)} ${radiusTextPosition.y.toFixed(2)}) rotate(${tangentAngleDeg.toFixed(2)})`
        });
        const radiusTextElement = createSvgElement('text', {
            class: 'bf2d-dimension-text',
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': (baseFontSize * 0.95).toFixed(2)
        });
        radiusTextElement.textContent = radiusLabel;
        radiusTextGroup.appendChild(radiusTextElement);
        group.appendChild(radiusTextGroup);

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

        const defs = createDimensionMarkerDefs();
        svg.appendChild(defs);

        const dimensionGroup = createSvgElement('g', { class: 'bf2d-dimensions' });
        const charWidthUnits = DIMENSION_CONFIG.approxCharWidthPx * scale.unitPerPx;
        const fontSize = Math.max(12 * scale.unitPerPx, 6 * scale.unitPerPx);
        const strokeWidth = Math.max(scale.unitPerPx * 1.2, scale.unitPerPx * 0.8);

        if (hasLengths) {
            geometry.legs.forEach(leg => addLengthDimension(dimensionGroup, leg, {
                unitPerPx: scale.unitPerPx,
                pxPerUnit: scale.pxPerUnit,
                strokeWidth,
                fontSize,
                charWidthUnits
            }));
        }

        if (hasRadii) {
            geometry.bends.forEach(bend => addBendDimension(dimensionGroup, bend, {
                unitPerPx: scale.unitPerPx,
                pxPerUnit: scale.pxPerUnit,
                strokeWidth,
                fontSize,
                charWidthUnits
            }));
        }

        if (dimensionGroup.childNodes.length) {
            svg.appendChild(dimensionGroup);
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
            note.classList.remove('warning-message', 'error-message', 'success-message');
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

    function updateOutputs() {
        if (!initialized) return;
        applyRollDiameterToSegments();
        updateSegmentRadiusInputs();
        const summary = computeSummary();
        updateSummaryUI(summary);
        updateErrorList(summary.errors);
        renderSvgPreview(summary);
        updateDataset(summary);
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
                const radiusValue = bendAngle > 0 ? rollRadius : 0;
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

    function init() {
        if (initialized) return;
        const view = document.getElementById('bf2dView');
        if (!view) return;
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
        populateSavedFormsSelect();
        renderSegmentTable();
        updateOutputs();
    }

    const configurator = {
        init,
        onShow() {
            if (!initialized) return;
            const currentSelection = document.getElementById('bf2dSavedForms')?.value || '';
            populateSavedFormsSelect(currentSelection);
            updateOutputs();
        },
        refreshTranslations() {
            if (!initialized) return;
            const currentSelection = document.getElementById('bf2dSavedForms')?.value || '';
            populateSavedFormsSelect(currentSelection);
            renderSegmentTable();
            updateOutputs();
        }
    };

    window.bf2dConfigurator = configurator;

    document.addEventListener('DOMContentLoaded', init);
})();
