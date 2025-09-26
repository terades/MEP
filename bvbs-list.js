/* global i18n */
(function () {
    'use strict';

    // --- CONSTANTS ---
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ABS_START_TOKEN_REGEX = /^(BF2D|BF3D|BFWE|BFMA|BFGT|BFAU)@/;
    const START_TYPE_MAP = {
        BF2D: 'BWS',
        BF3D: 'BWS',
        BFMA: 'BWM'
    };
    const ABS_BLOCK_START_REGEX = /(?:(?<=@)|^)([HGMAPCXYE])/g;
    const ABS_FIELD_REGEX = /([a-z])([^@]*)@/g;

    // --- STATE ---
    const state = {
        entries: [],
        fileName: '',
        filterText: '',
        sortKey: null,
        sortDirection: null,
        columnFilters: {},
        columnVisibility: {},
        printHeadingText: '',
        selectedEntryIds: new Set()
    };

    // --- DOM ELEMENTS ---
    let fileInput, dropZone, openUploadBtn, tableBody, statusEl, filterInput;
    let printButton, selectedPrintButton, printContainer, printHeadingInput;
    let selectAllCheckbox;
    let previewModal, previewModalSvg, previewModalCloseBtn;
    let columnFilterToggle, columnFilterMenu, columnFilterList, columnFilterResetBtn, columnFilterCloseBtn;
    let columnVisibilityList, columnVisibilityResetBtn;
    let uploadToggleBtn, uploadSection, uploadCard;
    let lastPreviewTrigger = null;
    let tableHeaders = [];

    const columnFilterInputs = new Map();
    const columnVisibilityInputs = new Map();
    const NUMERIC_COLUMN_KEYS = new Set([
        'quantity',
        'weight',
        'totalLength',
        'diameter',
        'rollDiameter',
        'bendCount',
        'maxSegmentLength',
        'totalWeight',
        'totalLengthMeters'
    ]);

    const STORAGE_KEYS = {
        uploadCollapsed: 'bvbsListUploadCollapsed'
    };

    // --- HELPER FUNCTIONS ---
    function formatDisplayNumber(value, decimals = 1) {
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

    function translate(key, fallback) {
        if (typeof i18n !== 'undefined' && typeof i18n.t === 'function') {
            return i18n.t(key);
        }
        return typeof fallback === 'string' ? fallback : key;
    }

    function getPrintHeadingText() {
        if (typeof state.printHeadingText !== 'string') {
            return '';
        }
        return state.printHeadingText.trim();
    }

    function getStoredBoolean(key, defaultValue = false) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) {
                return defaultValue;
            }
            return value === 'true';
        } catch (error) {
            return defaultValue;
        }
    }

    function setStoredBoolean(key, value) {
        try {
            localStorage.setItem(key, value ? 'true' : 'false');
        } catch (error) {
            // Ignore storage errors (e.g. private mode)
        }
    }

    function formatPrintDate(date = new Date()) {
        const target = date instanceof Date ? date : new Date();
        try {
            if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
                const locale = typeof navigator !== 'undefined' && navigator?.language
                    ? navigator.language
                    : undefined;
                return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(target);
            }
        } catch (error) {
            // Ignore formatting errors and use fallback below
        }
        if (typeof target.toLocaleString === 'function') {
            return target.toLocaleString();
        }
        return target.toString();
    }

    function ensureSelectionSet() {
        if (!(state.selectedEntryIds instanceof Set)) {
            state.selectedEntryIds = new Set();
        }
        return state.selectedEntryIds;
    }

    function isEntrySelected(entryId) {
        if (!entryId) {
            return false;
        }
        const selectedSet = ensureSelectionSet();
        return selectedSet.has(entryId);
    }

    function escapeSelector(value) {
        if (typeof value !== 'string') {
            return '';
        }
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(value);
        }
        return value.replace(/(["'\\\[\]\.:#@$%^&*(),+=<>/?{}|~-])/g, '\\$1');
    }

    function updateEntrySelectionIndicators(entryId) {
        if (!tableBody || !entryId) {
            return;
        }
        const selector = `tr[data-entry-id="${escapeSelector(entryId)}"]`;
        const row = tableBody.querySelector(selector);
        if (!row) {
            return;
        }
        const isSelected = isEntrySelected(entryId);
        row.classList.toggle('is-selected', isSelected);
        const checkbox = row.querySelector('.bvbs-selection-checkbox');
        if (checkbox instanceof HTMLInputElement) {
            checkbox.checked = isSelected;
        }
    }

    function toggleEntrySelection(entryId, shouldSelect, options = {}) {
        if (!entryId) {
            return false;
        }

        const selectedSet = ensureSelectionSet();
        const currentlySelected = selectedSet.has(entryId);
        const targetState = typeof shouldSelect === 'boolean' ? shouldSelect : !currentlySelected;

        if (targetState === currentlySelected) {
            return false;
        }

        if (targetState) {
            selectedSet.add(entryId);
        } else {
            selectedSet.delete(entryId);
        }

        if (!options.skipRowUpdate) {
            updateEntrySelectionIndicators(entryId);
        }
        if (!options.skipSelectAllUpdate) {
            updateSelectAllCheckbox();
        }
        if (!options.silent) {
            updateSelectedPrintButtonState();
        }

        return true;
    }

    function clearSelection(options = {}) {
        const selectedSet = ensureSelectionSet();
        if (!selectedSet.size) {
            if (!options.skipButtonUpdate) {
                updateSelectedPrintButtonState();
            }
            if (!options.skipSelectAllUpdate) {
                updateSelectAllCheckbox();
            }
            return;
        }

        selectedSet.clear();

        if (!options.skipRowUpdate && tableBody) {
            tableBody.querySelectorAll('tr.is-selected').forEach(row => {
                row.classList.remove('is-selected');
                const checkbox = row.querySelector('.bvbs-selection-checkbox');
                if (checkbox instanceof HTMLInputElement) {
                    checkbox.checked = false;
                }
            });
        }

        if (!options.skipButtonUpdate) {
            updateSelectedPrintButtonState();
        }

        if (!options.skipSelectAllUpdate) {
            updateSelectAllCheckbox();
        }
    }

    function getSelectedEntries() {
        ensureSelectionSet();
        if (!Array.isArray(state.entries) || !state.entries.length) {
            return [];
        }

        let selectedIds = [];

        if (tableBody instanceof HTMLElement) {
            selectedIds = Array.from(
                tableBody.querySelectorAll('.bvbs-selection-checkbox:checked')
            )
                .map(input => input?.dataset?.entryId || '')
                .filter(id => typeof id === 'string' && id.trim().length > 0);
        }

        if (!selectedIds.length) {
            selectedIds = Array.from(ensureSelectionSet());
        }

        if (!selectedIds.length) {
            return [];
        }

        const seenIds = new Set();
        const results = [];

        selectedIds.forEach(rawId => {
            const entryId = typeof rawId === 'string' ? rawId.trim() : '';
            if (!entryId || seenIds.has(entryId)) {
                return;
            }
            const entry = state.entries.find(item => item?.id === entryId);
            if (entry) {
                results.push(entry);
                seenIds.add(entryId);
            }
        });

        return results;
    }

    const TABLE_COLUMNS = [
        {
            key: 'selection',
            className: 'bvbs-selection-cell',
            isSelection: true,
            excludeFromVisibility: true,
            excludeFromFilters: true,
            includeInPrint: false,
            render(entry, options = {}) {
                if (options?.mode === 'print') {
                    return '';
                }
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'bvbs-selection-checkbox';
                checkbox.dataset.entryId = entry?.id || '';
                checkbox.checked = isEntrySelected(entry?.id);
                const label = translate('Zeile auswählen', 'Select row');
                checkbox.setAttribute('aria-label', label);
                checkbox.addEventListener('change', event => {
                    toggleEntrySelection(entry?.id, event.target.checked);
                });
                return checkbox;
            }
        },
        {
            key: 'displayType',
            render(entry) {
                return entry?.displayType || '—';
            }
        },
        {
            key: 'project',
            render(entry) {
                return entry?.metadata?.project || '—';
            }
        },
        {
            key: 'plan',
            render(entry) {
                return entry?.metadata?.plan || '—';
            }
        },
        {
            key: 'position',
            render(entry) {
                return entry?.metadata?.position || '—';
            }
        },
        {
            key: 'itemId',
            render(entry) {
                return entry?.metadata?.itemId || '—';
            }
        },
        {
            key: 'quantity',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.quantity, 0);
            }
        },
        {
            key: 'steelGrade',
            render(entry) {
                return entry?.metadata?.steelGrade || '—';
            }
        },
        {
            key: 'weight',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.weight, 3);
            }
        },
        {
            key: 'totalLength',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.totalLength, 1);
            }
        },
        {
            key: 'diameter',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.diameter, 1);
            }
        },
        {
            key: 'rollDiameter',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.rollDiameter, 1);
            }
        },
        {
            key: 'bendCount',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.bendCount, 0);
            }
        },
        {
            key: 'maxSegmentLength',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.maxSegmentLength, 1);
            }
        },
        {
            key: 'totalWeight',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.totalWeight, 3);
            }
        },
        {
            key: 'totalLengthMeters',
            render(entry) {
                return formatDisplayNumber(entry?.metadata?.totalLengthMeters, 3);
            }
        },
        {
            key: 'rawLine',
            render(entry) {
                return entry?.metadata?.rawLine || entry?.originalLine || entry?.rawLine || '—';
            }
        },
        {
            key: 'note',
            className: 'bvbs-note-cell',
            render(entry, options = {}) {
                if (options?.mode === 'table') {
                    const textarea = document.createElement('textarea');
                    textarea.className = 'bvbs-note-input';
                    textarea.rows = 2;
                    textarea.placeholder = translate('Notiz hinzufügen', 'Add note');
                    textarea.setAttribute('aria-label', translate('Notiz', 'Note'));
                    textarea.value = entry?.note || '';
                    textarea.dataset.entryId = entry?.id || '';
                    textarea.addEventListener('input', event => {
                        if (entry) {
                            entry.note = event.target.value;
                        }
                    });
                    return textarea;
                }
                return entry?.note || '';
            }
        },
        {
            key: 'preview',
            className: 'bvbs-preview-cell',
            isPreview: true
        }
    ];

    const SORT_DEFINITIONS = {
        displayType: {
            type: 'string',
            getValue(entry) {
                return entry?.displayType || '';
            }
        },
        project: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.project || '';
            }
        },
        plan: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.plan || '';
            }
        },
        position: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.position || '';
            }
        },
        itemId: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.itemId || '';
            }
        },
        quantity: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.quantity;
            }
        },
        steelGrade: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.steelGrade || '';
            }
        },
        weight: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.weight;
            }
        },
        totalLength: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.totalLength;
            }
        },
        diameter: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.diameter;
            }
        },
        rollDiameter: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.rollDiameter;
            }
        },
        bendCount: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.bendCount;
            }
        },
        maxSegmentLength: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.maxSegmentLength;
            }
        },
        totalWeight: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.totalWeight;
            }
        },
        totalLengthMeters: {
            type: 'number',
            getValue(entry) {
                return entry?.metadata?.totalLengthMeters;
            }
        },
        rawLine: {
            type: 'string',
            getValue(entry) {
                return entry?.metadata?.rawLine || entry?.originalLine || entry?.rawLine || '';
            }
        },
        note: {
            type: 'string',
            getValue(entry) {
                return entry?.note || '';
            }
        }
    };

    function enforceMinimumRadius(radius, rollRadius = 0) {
        const numericRadius = Number(radius);
        if (!Number.isFinite(numericRadius) || numericRadius <= 0) {
            return 0;
        }
        if (rollRadius > 0 && numericRadius < rollRadius) {
            return rollRadius;
        }
        return numericRadius;
    }

    // --- PARSING LOGIC (from bf2d-configurator.js) ---
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

    function extractGeometryValues(block, key) {
        const results = [];
        let invalidCount = 0;
        if (!block || !block.fields || !block.fields[key]) {
            return { values: results, invalidCount };
        }
        block.fields[key].forEach(value => {
            const items = Array.isArray(value) ? value : [value];
            items.forEach(item => {
                const numeric = parseNumberValue(item);
                if (Number.isFinite(numeric)) {
                    results.push(numeric);
                } else {
                    invalidCount += 1;
                }
            });
        });
        return { values: results, invalidCount };
    }

    function buildSegmentsFromGeometryBlocks(blocks, entry) {
        if (!Array.isArray(blocks) || !blocks.length) return null;
        const lengths = [];
        const angles = [];
        let invalidLengths = 0;
        let invalidAngles = 0;

        blocks.forEach(block => {
            const { values: blockLengths, invalidCount: blockInvalidLengths } = extractGeometryValues(block, 'l');
            const { values: blockAngles, invalidCount: blockInvalidAngles } = extractGeometryValues(block, 'w');
            if (blockLengths.length) lengths.push(...blockLengths);
            if (blockAngles.length) angles.push(...blockAngles);
            invalidLengths += blockInvalidLengths;
            invalidAngles += blockInvalidAngles;
        });

        if (!lengths.length) {
            if (entry) entry.warningMessages.push('Block G: Keine gültigen Längen gefunden');
            return null;
        }

        if (invalidLengths && entry) entry.warningMessages.push(`Block G: ${invalidLengths} ungültige Längenwerte ignoriert`);
        if (invalidAngles && entry) entry.warningMessages.push(`Block G: ${invalidAngles} ungültige Winkelwerte ignoriert`);

        const segments = lengths.map((lengthValue, index) => {
            const length = Number.isFinite(lengthValue) && lengthValue > 0 ? lengthValue : 0;
            const rawAngle = index < lengths.length - 1 ? (Number(angles[index]) || 0) : 0;
            return {
                length,
                bendAngle: Math.abs(rawAngle),
                bendDirection: rawAngle >= 0 ? 'L' : 'R'
            };
        });

        if (!segments.length) {
            if (entry) entry.warningMessages.push('Block G: Keine gültige Geometrie gefunden');
            return null;
        }
        return segments;
    }

    function buildSegmentsFromNodes(nodes) {
        if (!Array.isArray(nodes) || nodes.length < 2) return null;
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
            segments.push({ length, bendAngle: 0, bendDirection: 'L' });
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
            displayType: '',
            segmentDefinitions: null,
            hasGeometry: false,
            lengthFromGeometry: NaN,
            errorMessages: [],
            warningMessages: [],
            note: ''
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
            entry.type = line.split('@', 1)[0] || '';
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
            const parsedBlock = parseAbsBlock(line.slice(start, end), match.id);
            entry.blocks.push(parsedBlock);
            if (!entry.blockMap.has(match.id)) entry.blockMap.set(match.id, []);
            entry.blockMap.get(match.id).push(parsedBlock);
            parsedBlock.errors.forEach(msg => entry.errorMessages.push(`Block ${match.id}: ${msg}`));
            parsedBlock.warnings.forEach(msg => entry.warningMessages.push(`Block ${match.id}: ${msg}`));
        });

        const headerBlock = (entry.blockMap.get('H') || [])[0];
        if (headerBlock) {
            const diameter = parseDiameterValue(getFirstFieldValue(headerBlock, 'd'));
            const rawRollDiameter = getFirstFieldValue(headerBlock, 'f');
            const fallbackRollDiameter = getFirstFieldValue(headerBlock, 's');
            const totalLength = parseNumberValue(getFirstFieldValue(headerBlock, 'l'));
            const quantityValue = parseIntegerValue(getFirstFieldValue(headerBlock, 'n'));
            const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1;
            const weight = parseNumberValue(getFirstFieldValue(headerBlock, 'e'));

            const totalWeight = Number.isFinite(weight) && Number.isFinite(quantity)
                ? weight * quantity
                : NaN;
            const totalLengthMeters = Number.isFinite(totalLength) && Number.isFinite(quantity)
                ? (totalLength * quantity) / 1000
                : NaN;

            entry.metadata = {
                position: getFirstFieldValue(headerBlock, 'p') || '',
                type: getFirstFieldValue(headerBlock, 't') || '',
                project: getFirstFieldValue(headerBlock, 'j') || '',
                plan: getFirstFieldValue(headerBlock, 'r') || '',
                steelGrade: getFirstFieldValue(headerBlock, 'g') || '',
                diameter,
                totalLength,
                quantity,
                rollDiameter: parseNumberValue(rawRollDiameter) || parseNumberValue(fallbackRollDiameter),
                weight,
                totalWeight,
                totalLengthMeters,
                rawLine: (entry.originalLine || entry.rawLine || '').trim()
            };
        } else {
            entry.metadata = {
                diameter: NaN,
                rollDiameter: NaN,
                totalLength: NaN,
                quantity: 1,
                totalWeight: NaN,
                totalLengthMeters: NaN,
                rawLine: (entry.originalLine || entry.rawLine || '').trim()
            };
            entry.warningMessages.push('H-Block fehlt');
        }

        const mappedType = START_TYPE_MAP[entry.type];
        entry.displayType = mappedType || entry.metadata.type || entry.type || '';

        const itemIdParts = [];
        if (entry.metadata.project) itemIdParts.push(entry.metadata.project);
        if (entry.metadata.plan) itemIdParts.push(entry.metadata.plan);
        const itemType = (entry.displayType || entry.metadata.type || '').toUpperCase();
        if (itemType) itemIdParts.push(itemType);
        if (entry.metadata.position) itemIdParts.push(entry.metadata.position);
        entry.metadata.itemId = itemIdParts.join('-');

        const geometryBlocks = entry.blockMap.get('G') || [];
        let maxSegmentLength = Number.isFinite(entry.metadata.totalLength) ? entry.metadata.totalLength : NaN;
        let bendCount = 0;
        if (geometryBlocks.length) {
            const segments = buildSegmentsFromGeometryBlocks(geometryBlocks, entry);
            if (segments) {
                entry.segmentDefinitions = segments;
                entry.hasGeometry = true;

                const segmentLengths = segments
                    .map(segment => Number(segment.length))
                    .filter(length => Number.isFinite(length) && length >= 0);
                if (segmentLengths.length) {
                    const longest = Math.max(...segmentLengths);
                    if (Number.isFinite(longest)) {
                        maxSegmentLength = longest;
                    }
                }
                bendCount = segments
                    .slice(0, -1)
                    .reduce((count, segment) => count + (Number(segment.bendAngle) > 0 ? 1 : 0), 0);
            }
        }

        if (!entry.hasGeometry) {
            entry.warningMessages.push('Keine Geometrie gefunden');
        }

        entry.metadata.maxSegmentLength = Number.isFinite(maxSegmentLength) ? maxSegmentLength : NaN;
        entry.metadata.bendCount = Number.isFinite(bendCount) ? bendCount : 0;

        return entry;
    }

    function parseAbsFileContent(text) {
        const normalized = normalizeAbsContent(text);
        const rawLines = normalized.split(/\n/);
        return rawLines
            .map((line, i) => normalizeAbsLine(line) ? parseAbsLine(normalizeAbsLine(line), i, line, i) : null)
            .filter(Boolean);
    }

    // --- GEOMETRY & SVG LOGIC ---
    function buildGeometry(segments, rollDiameter) {
        let orientation = 0;
        let current = { x: 0, y: 0 };
        const mathPoints = [{ x: 0, y: 0 }];
        const segmentScreenData = [];
        const bendLabelData = [];
        const rollRadius = (Number(rollDiameter) || 0) / 2;

        segments.forEach((segment, index) => {
            const startPoint = { ...current };
            const length = Math.max(0, Number(segment.length) || 0);
            const startOrientation = orientation;
            const dir = { x: Math.cos(startOrientation), y: Math.sin(startOrientation) };
            current = { x: current.x + dir.x * length, y: current.y + dir.y * length };
            mathPoints.push({ ...current });

            const screenStart = { x: startPoint.x, y: -startPoint.y };
            const screenEnd = { x: current.x, y: -current.y };
            segmentScreenData.push({ start: screenStart, end: screenEnd });

            const isLast = index === segments.length - 1;
            if (isLast) {
                return;
            }

            const angleDeg = Number(segment.bendAngle) || 0;
            const sign = segment.bendDirection === 'R' ? -1 : 1;
            const signedAngleRad = (angleDeg * Math.PI / 180) * sign;
            const nextOrientation = startOrientation + signedAngleRad;

            const startDirScreen = { x: Math.cos(startOrientation), y: -Math.sin(startOrientation) };
            const endDirScreen = { x: Math.cos(nextOrientation), y: -Math.sin(nextOrientation) };
            bendLabelData.push({
                position: { ...screenEnd },
                startDir: startDirScreen,
                endDir: endDirScreen
            });

            const radius = enforceMinimumRadius(rollRadius, rollRadius);
            if (angleDeg > 0 && radius > 0) {
                const arcStart = { ...current };
                const leftNormal = { x: -dir.y, y: dir.x };
                const center = { x: arcStart.x + leftNormal.x * radius * sign, y: arcStart.y + leftNormal.y * radius * sign };
                const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
                const endAngle = startAngle + signedAngleRad;
                const steps = Math.min(16, Math.max(4, Math.ceil(Math.abs(angleDeg) / 15)));
                for (let step = 1; step <= steps; step++) {
                    const theta = startAngle + signedAngleRad * (step / steps);
                    mathPoints.push({ x: center.x + Math.cos(theta) * radius, y: center.y + Math.sin(theta) * radius });
                }
                current = { ...mathPoints[mathPoints.length - 1] };
            }

            orientation = nextOrientation;
        });

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        mathPoints.forEach(p => {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        });

        const screenPoints = mathPoints.map(p => ({ x: p.x, y: -p.y }));
        let screenMinX = Infinity, screenMaxX = -Infinity, screenMinY = Infinity, screenMaxY = -Infinity;
        screenPoints.forEach(p => {
            screenMinX = Math.min(screenMinX, p.x);
            screenMaxX = Math.max(screenMaxX, p.x);
            screenMinY = Math.min(screenMinY, p.y);
            screenMaxY = Math.max(screenMaxY, p.y);
        });

        const width = Number.isFinite(maxX - minX) ? maxX - minX : 0;
        const height = Number.isFinite(maxY - minY) ? maxY - minY : 0;
        const padding = Math.max(10, Math.max(width, height) * 0.1);

        const viewBox = {
            x: screenMinX - padding,
            y: screenMinY - padding,
            width: (screenMaxX - screenMinX) + padding * 2 || 100,
            height: (screenMaxY - screenMinY) + padding * 2 || 100
        };

        const pathData = screenPoints
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
            .join(' ');

        return { pathData, viewBox, screenPoints, segmentScreenData, bendLabelData };
    }

    function renderEntryPreview(svg, entry) {
        if (!svg || !entry || !entry.hasGeometry) {
            svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="bf2d-preview-note">${typeof i18n !== 'undefined' ? i18n.t('Keine Vorschau') : 'No preview'}</text>`;
            return;
        }

        const segments = entry.segmentDefinitions;
        const rollDiameter = entry.metadata.rollDiameter > 0
            ? entry.metadata.rollDiameter
            : (entry.metadata.diameter || 0) * 4;

        const geometry = buildGeometry(segments, rollDiameter);
        if (!geometry || !geometry.viewBox || !geometry.pathData) {
             svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="bf2d-preview-note">${typeof i18n !== 'undefined' ? i18n.t('Fehler') : 'Error'}</text>`;
            return;
        }

        const { viewBox, pathData, segmentScreenData = [], bendLabelData = [] } = geometry;
        svg.setAttribute('viewBox', `${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.width.toFixed(2)} ${viewBox.height.toFixed(2)}`);
        svg.innerHTML = '';

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'bf2d-svg-path');
        const strokeReference = Math.max(viewBox.width, viewBox.height) || 100;
        const strokeWidth = Math.max(Math.min(strokeReference / 50, 6), 1.25);
        path.setAttribute('d', pathData);
        path.style.strokeWidth = `${strokeWidth.toFixed(2)}`;
        svg.appendChild(path);

        const labelLayer = document.createElementNS(SVG_NS, 'g');
        labelLayer.setAttribute('class', 'bf2d-preview-labels');
        svg.appendChild(labelLayer);

        const baseSize = Math.max(viewBox.width, viewBox.height) || 100;
        const lengthFontSize = Math.min(Math.max(baseSize * 0.12, 8), 20);
        const angleFontSize = Math.min(Math.max(baseSize * 0.1, 8), 18);
        const lengthOffset = Math.min(Math.max(baseSize * 0.08, 12), baseSize * 0.3);
        const angleOffset = Math.min(Math.max(baseSize * 0.12, 14), baseSize * 0.35);
        const outlineWidth = Math.max(baseSize / 400, 0.75);

        function createLabel(text, x, y, className, fontSize) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('class', className);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('font-size', fontSize.toFixed(2));
            label.setAttribute('x', x.toFixed(2));
            label.setAttribute('y', y.toFixed(2));
            label.setAttribute('fill', 'var(--text-color, #1f2937)');
            label.setAttribute('stroke', 'var(--card-bg-color, #ffffff)');
            label.setAttribute('stroke-width', outlineWidth.toFixed(2));
            label.setAttribute('paint-order', 'stroke');
            label.setAttribute('stroke-linejoin', 'round');
            label.textContent = text;
            labelLayer.appendChild(label);
        }

        segmentScreenData.forEach((data, index) => {
            const lengthValue = Number(segments[index]?.length);
            if (!Number.isFinite(lengthValue) || lengthValue <= 0) {
                return;
            }
            const { start, end } = data;
            if (!start || !end) return;
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const distance = Math.hypot(dx, dy);
            if (!Number.isFinite(distance) || distance === 0) return;
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const nx = -dy / distance;
            const ny = dx / distance;
            const labelX = midX + nx * lengthOffset;
            const labelY = midY + ny * lengthOffset;
            const decimals = Number.isInteger(lengthValue) ? 0 : 1;
            const labelText = `${formatDisplayNumber(lengthValue, decimals)} mm`;
            createLabel(labelText, labelX, labelY, 'bf2d-dimension-text', lengthFontSize);
        });

        bendLabelData.forEach((bendInfo, index) => {
            const angleValue = Number(segments[index]?.bendAngle);
            if (!Number.isFinite(angleValue) || angleValue < 0) {
                return;
            }
            const { position, startDir, endDir } = bendInfo || {};
            if (!position || !startDir || !endDir) return;
            let direction = { x: startDir.x + endDir.x, y: startDir.y + endDir.y };
            let magnitude = Math.hypot(direction.x, direction.y);
            if (!Number.isFinite(magnitude) || magnitude < 1e-3) {
                direction = { x: -startDir.y, y: startDir.x };
                magnitude = Math.hypot(direction.x, direction.y);
            }
            if (!Number.isFinite(magnitude) || magnitude < 1e-3) return;
            direction.x /= magnitude;
            direction.y /= magnitude;
            const labelX = position.x + direction.x * angleOffset;
            const labelY = position.y + direction.y * angleOffset;
            const decimals = angleValue % 1 === 0 ? 0 : 1;
            const labelText = `${formatDisplayNumber(angleValue, decimals)}°`;
            createLabel(labelText, labelX, labelY, 'bf2d-angle-text', angleFontSize);
        });
    }

    function handlePreviewKeydown(event) {
        if (event.key === 'Escape') {
            closePreviewModal();
        }
    }

    function openPreviewModal(entry) {
        if (!previewModal || !previewModalSvg || !entry) {
            return;
        }

        previewModalSvg.innerHTML = '';
        previewModalSvg.removeAttribute('viewBox');
        renderEntryPreview(previewModalSvg, entry);

        previewModal.classList.add('visible');
        previewModal.setAttribute('aria-hidden', 'false');

        document.addEventListener('keydown', handlePreviewKeydown);

        if (previewModalCloseBtn) {
            previewModalCloseBtn.focus({ preventScroll: true });
        }
    }

    function closePreviewModal() {
        if (!previewModal) {
            return;
        }

        previewModal.classList.remove('visible');
        previewModal.setAttribute('aria-hidden', 'true');

        if (previewModalSvg) {
            previewModalSvg.innerHTML = '';
            previewModalSvg.removeAttribute('viewBox');
        }

        document.removeEventListener('keydown', handlePreviewKeydown);

        if (lastPreviewTrigger && !document.body.contains(lastPreviewTrigger)) {
            lastPreviewTrigger = null;
        }

        if (lastPreviewTrigger) {
            lastPreviewTrigger.focus({ preventScroll: true });
            lastPreviewTrigger = null;
        }
    }

    // --- RENDERING ---
    function entryMatchesFilter(entry, normalizedSearchTerm) {
        if (!normalizedSearchTerm) {
            return true;
        }

        const metadata = entry?.metadata || {};
        const values = [
            entry?.displayType,
            metadata.project,
            metadata.plan,
            metadata.position,
            metadata.itemId,
            metadata.steelGrade,
            metadata.rawLine,
            entry?.originalLine,
            entry?.rawLine,
            entry?.note
        ];

        const numericKeys = [
            'quantity',
            'weight',
            'totalLength',
            'diameter',
            'rollDiameter',
            'bendCount',
            'maxSegmentLength',
            'totalWeight',
            'totalLengthMeters'
        ];

        numericKeys.forEach(key => {
            const value = metadata[key];
            if (value !== undefined && value !== null && value !== '') {
                values.push(value);
            }
        });

        const combined = values
            .filter(value => value !== undefined && value !== null && value !== '')
            .map(value => String(value).toLowerCase())
            .join(' ');

        if (!combined) {
            return false;
        }

        return combined.includes(normalizedSearchTerm);
    }

    function ensureColumnVisibilityState() {
        if (!state.columnVisibility || typeof state.columnVisibility !== 'object') {
            state.columnVisibility = {};
        }

        TABLE_COLUMNS.forEach(column => {
            if (column.excludeFromVisibility) {
                state.columnVisibility[column.key] = true;
                return;
            }
            if (typeof state.columnVisibility[column.key] === 'undefined') {
                state.columnVisibility[column.key] = true;
            }
        });
    }

    function isColumnVisible(columnKey) {
        ensureColumnVisibilityState();
        const column = getColumnDefinitionByKey(columnKey);
        if (column?.excludeFromVisibility) {
            return true;
        }
        return state.columnVisibility[columnKey] !== false;
    }

    function isColumnVisibilityModified() {
        ensureColumnVisibilityState();
        return TABLE_COLUMNS.some(column => !column.excludeFromVisibility && state.columnVisibility[column.key] === false);
    }

    function setColumnVisibility(columnKey, visible, options = {}) {
        if (!columnKey) {
            return;
        }

        ensureColumnVisibilityState();
        const column = getColumnDefinitionByKey(columnKey);
        if (column?.excludeFromVisibility) {
            state.columnVisibility[column.key] = true;
            return;
        }
        state.columnVisibility[columnKey] = visible !== false;

        if (!options.skipInputUpdate) {
            const input = columnVisibilityInputs.get(columnKey);
            if (input) {
                input.checked = state.columnVisibility[columnKey];
            }
        }

        applyColumnVisibilityToTable();
        updateColumnFilterToggleState();
    }

    function resetColumnVisibility() {
        ensureColumnVisibilityState();

        let changed = false;
        TABLE_COLUMNS.forEach(column => {
            if (column.excludeFromVisibility) {
                state.columnVisibility[column.key] = true;
                return;
            }
            if (state.columnVisibility[column.key] === false) {
                state.columnVisibility[column.key] = true;
                changed = true;
            }
        });

        columnVisibilityInputs.forEach(input => {
            input.checked = true;
        });

        if (changed) {
            applyColumnVisibilityToTable();
        }

        updateColumnFilterToggleState();
    }

    function getVisibleColumnCount() {
        ensureColumnVisibilityState();
        return TABLE_COLUMNS.reduce((count, column) => {
            if (column.excludeFromVisibility) {
                return count + 1;
            }
            return count + (state.columnVisibility[column.key] === false ? 0 : 1);
        }, 0);
    }

    function isColumnFilterActive() {
        if (!state.columnFilters || typeof state.columnFilters !== 'object') {
            return false;
        }

        return Object.values(state.columnFilters).some(value =>
            typeof value === 'string' && value.trim() !== ''
        );
    }

    function getColumnDefinitionByKey(columnKey) {
        return TABLE_COLUMNS.find(column => column.key === columnKey);
    }

    function entryMatchesColumnFilters(entry) {
        if (!entry) {
            return false;
        }

        if (!isColumnFilterActive()) {
            return true;
        }

        const filters = state.columnFilters || {};
        return Object.entries(filters).every(([columnKey, filterValue]) => {
            const normalized = typeof filterValue === 'string' ? filterValue.trim().toLowerCase() : '';
            if (!normalized) {
                return true;
            }

            const column = getColumnDefinitionByKey(columnKey);
            if (!column) {
                return true;
            }

            let displayValue = '';
            try {
                displayValue = column.render(entry);
            } catch (error) {
                displayValue = '';
            }

            if (displayValue === undefined || displayValue === null) {
                displayValue = '';
            }

            return displayValue.toString().toLowerCase().includes(normalized);
        });
    }

    function getColumnLabel(columnKey) {
        const selector = `#bvbsListTable thead th[data-column-key="${columnKey}"]`;
        const header = document.querySelector(selector) || document.querySelector(`#bvbsListTable thead th[data-sort-key="${columnKey}"]`);
        if (header && typeof header.textContent === 'string') {
            const trimmed = header.textContent.trim();
            if (trimmed) {
                return trimmed;
            }
        }
        return columnKey;
    }

    function compareEntries(a, b, definition, direction) {
        const dirMultiplier = direction === 'desc' ? -1 : 1;
        const valueA = definition.getValue(a);
        const valueB = definition.getValue(b);

        if (definition.type === 'number') {
            const numA = Number(valueA);
            const numB = Number(valueB);
            const hasA = Number.isFinite(numA);
            const hasB = Number.isFinite(numB);

            if (!hasA && !hasB) return 0;
            if (!hasA) return dirMultiplier;
            if (!hasB) return -dirMultiplier;
            if (numA === numB) return 0;
            return numA < numB ? -dirMultiplier : dirMultiplier;
        }

        const textA = (valueA ?? '').toString().trim().toLowerCase();
        const textB = (valueB ?? '').toString().trim().toLowerCase();

        if (!textA && !textB) return 0;
        if (!textA) return dirMultiplier;
        if (!textB) return -dirMultiplier;

        const comparison = textA.localeCompare(textB, undefined, { numeric: true, sensitivity: 'base' });
        if (comparison === 0) return 0;
        return comparison * dirMultiplier;
    }

    function getVisibleEntries() {
        const baseEntries = Array.isArray(state.entries) ? state.entries.slice() : [];
        const normalizedSearch = state.filterText.trim().toLowerCase();
        const hasGlobalFilter = Boolean(normalizedSearch);
        const hasColumnFilters = isColumnFilterActive();

        const filteredEntries = baseEntries.filter(entry => {
            if (hasGlobalFilter && !entryMatchesFilter(entry, normalizedSearch)) {
                return false;
            }

            if (hasColumnFilters && !entryMatchesColumnFilters(entry)) {
                return false;
            }

            return true;
        });

        if (!state.sortKey || !state.sortDirection) {
            return filteredEntries;
        }

        const definition = SORT_DEFINITIONS[state.sortKey];
        if (!definition) {
            return filteredEntries;
        }

        return filteredEntries.sort((a, b) => compareEntries(a, b, definition, state.sortDirection));
    }

    function getVisibleColumns() {
        return TABLE_COLUMNS.filter(column => column.includeInPrint !== false && isColumnVisible(column.key));
    }

    function updateStatusMessage(visibleCount) {
        if (!statusEl) {
            return;
        }

        if (!state.entries.length) {
            statusEl.textContent = statusEl.dataset?.baseMessage || '';
            return;
        }

        const baseMessage = statusEl.dataset?.baseMessage || '';
        const filterActive = Boolean(state.filterText.trim()) || isColumnFilterActive();
        const suffix = filterActive
            ? `Angezeigt: ${visibleCount} von ${state.entries.length} Positionen (Filter aktiv)`
            : `Angezeigt: ${visibleCount} von ${state.entries.length} Positionen`;
        statusEl.textContent = baseMessage ? `${baseMessage} • ${suffix}` : suffix;
    }

    function updateHeaderSortState() {
        if (!Array.isArray(tableHeaders) || !tableHeaders.length) {
            return;
        }

        tableHeaders.forEach(th => {
            const key = th.getAttribute('data-sort-key');
            if (!key) return;

            let ariaValue = 'none';
            if (state.sortKey === key && state.sortDirection) {
                ariaValue = state.sortDirection === 'desc' ? 'descending' : 'ascending';
            }

            th.setAttribute('aria-sort', ariaValue);
            th.classList.toggle('is-sorted', state.sortKey === key && Boolean(state.sortDirection));
        });
    }

    function updateColumnFilterToggleState() {
        const filtersActive = isColumnFilterActive();
        const visibilityModified = isColumnVisibilityModified();
        const active = filtersActive || visibilityModified;

        if (columnFilterToggle) {
            columnFilterToggle.classList.toggle('is-active', active);
            columnFilterToggle.setAttribute('data-filter-active', filtersActive ? 'true' : 'false');
            columnFilterToggle.setAttribute('data-visibility-active', visibilityModified ? 'true' : 'false');
        }

        updateColumnVisibilityResetButtonState();
    }

    function updateColumnVisibilityResetButtonState() {
        if (!columnVisibilityResetBtn) {
            return;
        }

        columnVisibilityResetBtn.disabled = !isColumnVisibilityModified();
    }

    function handleColumnFilterInput(event) {
        const input = event?.target;
        if (!input || !(input instanceof HTMLInputElement)) {
            return;
        }

        const key = input.dataset?.columnKey;
        if (!key) {
            return;
        }

        const value = input.value || '';
        if (!state.columnFilters || typeof state.columnFilters !== 'object') {
            state.columnFilters = {};
        }

        if (!value.trim()) {
            delete state.columnFilters[key];
        } else {
            state.columnFilters[key] = value;
        }

        renderTable();
    }

    function handleColumnVisibilityInput(event) {
        const input = event?.target;
        if (!input || !(input instanceof HTMLInputElement)) {
            return;
        }

        const columnKey = input.dataset?.columnKey;
        if (!columnKey) {
            return;
        }

        if (!input.checked) {
            const visibleCount = getVisibleColumnCount();
            if (visibleCount <= 1) {
                input.checked = true;
                return;
            }
        }

        setColumnVisibility(columnKey, input.checked, { skipInputUpdate: true });
    }

    function clearColumnFilters(options = {}) {
        state.columnFilters = {};
        columnFilterInputs.forEach(input => {
            input.value = '';
        });
        updateColumnFilterToggleState();

        if (!options?.skipRender) {
            renderTable();
        }
    }

    function openColumnFilterMenu() {
        if (!columnFilterMenu) {
            return;
        }

        columnFilterMenu.hidden = false;
        columnFilterMenu.setAttribute('aria-hidden', 'false');

        if (columnFilterToggle) {
            columnFilterToggle.setAttribute('aria-expanded', 'true');
        }

        const firstInput = columnFilterMenu.querySelector('input[type="search"]');
        if (firstInput instanceof HTMLElement) {
            firstInput.focus({ preventScroll: true });
        }
    }

    function closeColumnFilterMenu(options = {}) {
        if (!columnFilterMenu) {
            return;
        }

        columnFilterMenu.hidden = true;
        columnFilterMenu.setAttribute('aria-hidden', 'true');

        if (columnFilterToggle) {
            columnFilterToggle.setAttribute('aria-expanded', 'false');
            if (options?.focusToggle) {
                columnFilterToggle.focus({ preventScroll: true });
            }
        }
    }

    function toggleColumnFilterMenu() {
        if (!columnFilterMenu) {
            return;
        }

        if (columnFilterMenu.hidden) {
            openColumnFilterMenu();
        } else {
            closeColumnFilterMenu();
        }
    }

    function handleDocumentClick(event) {
        if (!columnFilterMenu || columnFilterMenu.hidden) {
            return;
        }

        const target = event.target;
        if (columnFilterMenu.contains(target) || columnFilterToggle?.contains(target)) {
            return;
        }

        closeColumnFilterMenu();
    }

    function handleColumnFilterKeydown(event) {
        if (event.key === 'Escape' && columnFilterMenu && !columnFilterMenu.hidden) {
            event.stopPropagation();
            closeColumnFilterMenu({ focusToggle: true });
        }
    }

    function buildColumnFilterMenu() {
        ensureColumnVisibilityState();

        if (columnVisibilityList) {
            columnVisibilityInputs.clear();
            columnVisibilityList.innerHTML = '';

            TABLE_COLUMNS.forEach(column => {
                if (column.excludeFromVisibility) {
                    return;
                }
                const item = document.createElement('label');
                item.className = 'column-visibility-item';
                item.setAttribute('for', `bvbsColumnVisibility_${column.key}`);

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `bvbsColumnVisibility_${column.key}`;
                checkbox.dataset.columnKey = column.key;
                checkbox.checked = isColumnVisible(column.key);
                checkbox.addEventListener('change', handleColumnVisibilityInput);

                const labelText = getColumnLabel(column.key);
                const span = document.createElement('span');
                span.textContent = labelText;

                item.appendChild(checkbox);
                item.appendChild(span);
                columnVisibilityList.appendChild(item);
                columnVisibilityInputs.set(column.key, checkbox);
            });
        }

        if (!columnFilterList) {
            updateColumnVisibilityResetButtonState();
            return;
        }

        columnFilterInputs.clear();
        columnFilterList.innerHTML = '';

        const columns = TABLE_COLUMNS.filter(column => !column.isPreview && !column.excludeFromFilters);
        columns.forEach(column => {
            const item = document.createElement('div');
            item.className = 'column-filter-item';

            const inputId = `bvbsColumnFilterInput_${column.key}`;
            const labelText = getColumnLabel(column.key);

            const label = document.createElement('label');
            label.setAttribute('for', inputId);
            label.textContent = labelText;

            const input = document.createElement('input');
            input.type = 'search';
            input.id = inputId;
            input.dataset.columnKey = column.key;
            input.autocomplete = 'off';
            input.setAttribute('aria-label', labelText);
            input.placeholder = typeof i18n !== 'undefined'
                ? i18n.t('Filter') + ' ' + labelText
                : `Filter ${labelText}`;
            input.value = state.columnFilters?.[column.key] || '';

            input.addEventListener('input', handleColumnFilterInput);

            item.appendChild(label);
            item.appendChild(input);
            columnFilterList.appendChild(item);
            columnFilterInputs.set(column.key, input);
        });

        updateColumnVisibilityResetButtonState();
    }

    function applyColumnVisibilityToTable() {
        ensureColumnVisibilityState();

        const table = document.getElementById('bvbsListTable');
        if (!table) {
            return;
        }

        TABLE_COLUMNS.forEach(column => {
            const visible = isColumnVisible(column.key);
            const header = table.querySelector(`thead th[data-column-key="${column.key}"]`);
            if (header) {
                header.hidden = !visible;
            }

            const cells = table.querySelectorAll(`tbody td[data-column-key="${column.key}"]`);
            cells.forEach(cell => {
                cell.hidden = !visible;
            });
        });

        const visibleColumnCount = Math.max(getVisibleColumnCount(), 1);
        const adjustableCells = table.querySelectorAll('tbody td[data-colspan-adjust="true"]');
        adjustableCells.forEach(cell => {
            cell.colSpan = visibleColumnCount;
        });
    }

    function renderTable() {
        if (!tableBody) return;

        ensureSelectionSet();
        const visibleEntries = getVisibleEntries();
        updatePrintButtonState(visibleEntries.length);
        tableBody.innerHTML = '';

        updateHeaderSortState();
        updateColumnFilterToggleState();
        updateStatusMessage(visibleEntries.length);

        if (state.entries.length === 0) {
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.dataset.colspanAdjust = 'true';
            cell.colSpan = Math.max(getVisibleColumnCount(), 1);
            cell.textContent = typeof i18n !== 'undefined'
                ? i18n.t('Keine Daten zum Anzeigen. Bitte laden Sie eine BVBS-Datei hoch.')
                : 'No data to display. Please upload a BVBS file.';
            cell.style.textAlign = 'center';
            cell.style.padding = '1rem';
            return;
        }

        if (visibleEntries.length === 0) {
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.dataset.colspanAdjust = 'true';
            cell.colSpan = Math.max(getVisibleColumnCount(), 1);
            cell.textContent = typeof i18n !== 'undefined'
                ? i18n.t('Keine Einträge entsprechen dem aktuellen Filter.')
                : 'No entries match the current filter.';
            cell.style.textAlign = 'center';
            cell.style.padding = '1rem';
            return;
        }

        visibleEntries.forEach(entry => {
            const row = tableBody.insertRow();
            const entryId = entry?.id || '';
            if (entryId) {
                row.dataset.entryId = entryId;
            }
            row.classList.toggle('is-selected', isEntrySelected(entryId));
            row.addEventListener('click', event => handleRowClick(event, entry));

            TABLE_COLUMNS.forEach(column => {
                const cell = row.insertCell();
                cell.dataset.columnKey = column.key;
                if (column.className) {
                    cell.classList.add(column.className);
                }

                if (column.isSelection) {
                    cell.setAttribute('data-selection-cell', 'true');
                }

                if (column.isPreview) {
                    const previewButton = document.createElement('button');
                    previewButton.type = 'button';
                    previewButton.className = 'bvbs-preview-trigger';
                    const enlargeLabel = typeof i18n !== 'undefined' ? i18n.t('Vergrößern') : 'Enlarge';
                    previewButton.setAttribute('data-i18n-title', 'Vergrößern');
                    previewButton.setAttribute('data-i18n-aria-label', 'Vergrößern');
                    previewButton.setAttribute('title', enlargeLabel);
                    previewButton.setAttribute('aria-label', enlargeLabel);

                    const svg = document.createElementNS(SVG_NS, 'svg');
                    svg.setAttribute('class', 'bvbs-preview-svg');
                    previewButton.appendChild(svg);
                    cell.appendChild(previewButton);

                    renderEntryPreview(svg, entry);

                    previewButton.addEventListener('click', () => {
                        lastPreviewTrigger = previewButton;
                        openPreviewModal(entry);
                    });
                    return;
                }

                let renderedValue;
                try {
                    renderedValue = column.render(entry, { mode: 'table' });
                } catch (error) {
                    renderedValue = '';
                }

                if (renderedValue instanceof Node) {
                    cell.appendChild(renderedValue);
                } else if (renderedValue === null || typeof renderedValue === 'undefined') {
                    cell.textContent = '';
                } else {
                    cell.textContent = String(renderedValue);
                }

                if (column.isSelection) {
                    cell.addEventListener('click', event => {
                        if (event.target instanceof HTMLInputElement) {
                            return;
                        }
                        if (!entryId) {
                            return;
                        }
                        toggleEntrySelection(entryId);
                    });
                }
            });
        });

        applyColumnVisibilityToTable();
        updateSelectAllCheckbox(visibleEntries);
    }

    function handleRowClick(event, entry) {
        if (!entry?.id) {
            return;
        }

        const target = event?.target;
        if (!target || !(target instanceof Node)) {
            return;
        }

        if (target.closest('button, a, input, textarea, select, label')) {
            return;
        }

        if (target.closest('[data-selection-cell="true"]')) {
            return;
        }

        toggleEntrySelection(entry.id);
    }

    function updateSelectAllCheckbox(visibleEntries) {
        if (!selectAllCheckbox) {
            return;
        }

        const entries = Array.isArray(visibleEntries) ? visibleEntries : getVisibleEntries();
        if (!entries.length) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.disabled = true;
            return;
        }

        selectAllCheckbox.disabled = false;
        const selectedCount = entries.filter(entry => entry?.id && isEntrySelected(entry.id)).length;
        if (selectedCount === entries.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
            return;
        }
        if (selectedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
            return;
        }

        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }

    function updateSelectedPrintButtonState() {
        if (!selectedPrintButton) {
            return;
        }

        const selectedEntries = getSelectedEntries();
        const count = selectedEntries.length;
        const columns = getVisibleColumns();
        const hasColumns = columns.length > 0;

        const baseLabelKey = selectedPrintButton.getAttribute('data-i18n-base-label') || 'Auswahl drucken';
        const fallback = selectedPrintButton.getAttribute('data-base-label-fallback') || 'Print selection';
        const baseLabel = translate(baseLabelKey, fallback);
        selectedPrintButton.dataset.baseLabel = baseLabel;
        selectedPrintButton.textContent = `${baseLabel} (${count})`;

        const disabled = count === 0 || !hasColumns;
        selectedPrintButton.disabled = disabled;
        if (disabled) {
            selectedPrintButton.setAttribute('aria-disabled', 'true');
            const message = count === 0
                ? translate('Keine Positionen ausgewählt.', 'No positions selected.')
                : translate('Keine Spalten ausgewählt.', 'No columns selected.');
            selectedPrintButton.setAttribute('title', message);
        } else {
            selectedPrintButton.removeAttribute('aria-disabled');
            selectedPrintButton.removeAttribute('title');
        }
    }

    function updatePrintButtonState(entryCount) {
        if (!printButton) {
            return;
        }
        const hasEntries = entryCount > 0;
        const hasColumns = getVisibleColumns().length > 0;
        const disabled = !hasEntries || !hasColumns;
        printButton.disabled = disabled;
        if (disabled) {
            printButton.setAttribute('aria-disabled', 'true');
            const message = hasEntries
                ? translate('Keine Spalten ausgewählt.', 'No columns selected.')
                : translate('Keine Einträge zum Drucken verfügbar.', 'No entries available for printing.');
            printButton.setAttribute('title', message);
        } else {
            printButton.removeAttribute('aria-disabled');
            printButton.removeAttribute('title');
        }

        updateSelectedPrintButtonState();
    }

    function handleSelectAllChange(event) {
        const checkbox = event?.target;
        if (!(checkbox instanceof HTMLInputElement)) {
            return;
        }

        checkbox.indeterminate = false;
        const shouldSelect = checkbox.checked;
        const visibleEntries = getVisibleEntries();
        visibleEntries.forEach(entry => {
            if (!entry?.id) {
                return;
            }
            toggleEntrySelection(entry.id, shouldSelect, { silent: true, skipSelectAllUpdate: true });
        });
        updateSelectAllCheckbox(visibleEntries);
        updateSelectedPrintButtonState();
    }

    function createPrintMetaItem(label, value) {
        let textValue = value;
        if (typeof textValue === 'string') {
            textValue = textValue.trim();
        }
        if (textValue === '' || textValue === null || typeof textValue === 'undefined') {
            return null;
        }
        const item = document.createElement('li');
        item.className = 'bvbs-print-meta-item';

        const labelEl = document.createElement('span');
        labelEl.className = 'bvbs-print-meta-label';
        labelEl.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'bvbs-print-meta-value';
        valueEl.textContent = String(textValue);

        item.appendChild(labelEl);
        item.appendChild(valueEl);
        return item;
    }

    function buildPrintTable(entries, columns) {
        const wrapper = document.createElement('div');
        wrapper.className = 'bvbs-print-wrapper';

        const header = document.createElement('div');
        header.className = 'bvbs-print-header';

        const headerMain = document.createElement('div');
        headerMain.className = 'bvbs-print-header-main';

        const title = document.createElement('h1');
        title.className = 'bvbs-print-title';
        title.textContent = translate('BVBS-Liste', 'BVBS list');
        headerMain.appendChild(title);

        const metaList = document.createElement('ul');
        metaList.className = 'bvbs-print-meta';

        const now = new Date();
        const metaItems = [];
        metaItems.push(createPrintMetaItem(translate('Druckdatum', 'Print date'), formatPrintDate(now)));
        if (state.fileName) {
            metaItems.push(createPrintMetaItem(translate('Datei', 'File'), state.fileName));
        }
        metaItems.push(createPrintMetaItem(translate('Einträge', 'Entries'), entries.length));
        if (state.filterText && state.filterText.trim()) {
            metaItems.push(createPrintMetaItem(translate('Filter', 'Filter'), state.filterText.trim()));
        }

        metaItems.filter(Boolean).forEach(item => metaList.appendChild(item));
        if (metaList.children.length > 0) {
            headerMain.appendChild(metaList);
        }

        header.appendChild(headerMain);

        const logo = document.createElement('img');
        logo.className = 'bvbs-print-logo';
        logo.src = 'gb.png';
        logo.alt = translate('Logo', 'Logo');
        logo.addEventListener('error', () => {
            logo.remove();
        });
        header.appendChild(logo);

        wrapper.appendChild(header);

        const printHeadingText = getPrintHeadingText();
        if (printHeadingText) {
            const customHeading = document.createElement('p');
            customHeading.className = 'bvbs-print-custom-heading';
            customHeading.textContent = printHeadingText;
            wrapper.appendChild(customHeading);
        }

        const table = document.createElement('table');
        table.className = 'bvbs-print-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        columns.forEach(column => {
            const th = document.createElement('th');
            th.dataset.columnKey = column.key;
            th.textContent = getColumnLabel(column.key);
            if (column.isPreview) {
                th.classList.add('bvbs-print-preview-cell');
            }
            if (NUMERIC_COLUMN_KEYS.has(column.key)) {
                th.classList.add('is-numeric');
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        entries.forEach(entry => {
            const row = document.createElement('tr');
            columns.forEach(column => {
                const cell = document.createElement('td');
                cell.dataset.columnKey = column.key;
                if (NUMERIC_COLUMN_KEYS.has(column.key)) {
                    cell.classList.add('is-numeric');
                }
                if (column.isPreview) {
                    cell.classList.add('bvbs-print-preview-cell');
                    const svg = document.createElementNS(SVG_NS, 'svg');
                    svg.setAttribute('class', 'bvbs-print-preview');
                    renderEntryPreview(svg, entry);
                    cell.appendChild(svg);
                } else {
                    let value;
                    try {
                        value = column.render(entry, { mode: 'print' });
                    } catch (error) {
                        value = '';
                    }
                    if (value instanceof Node) {
                        cell.appendChild(value);
                    } else if (value === null || typeof value === 'undefined') {
                        cell.textContent = '—';
                    } else {
                        cell.textContent = String(value);
                    }
                }
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        wrapper.appendChild(table);

        return wrapper;
    }

    function cleanupPrintContainer() {
        if (!printContainer) {
            return;
        }
        printContainer.innerHTML = '';
        printContainer.classList.remove('is-active');
        printContainer.setAttribute('aria-hidden', 'true');
        const printStyle = document.getElementById('bvbs-print-page-style');
        if (printStyle && printStyle.parentNode) {
            printStyle.parentNode.removeChild(printStyle);
        }
    }

    function showPrintError(message) {
        if (!statusEl) {
            window.alert(message);
            return;
        }

        const restoreMessage = statusEl.dataset?.baseMessage || '';
        statusEl.textContent = message;
        statusEl.classList.add('error-message');

        window.setTimeout(() => {
            if (!statusEl) {
                return;
            }
            const currentBase = statusEl.dataset?.baseMessage || '';
            const nextMessage = currentBase || restoreMessage;
            statusEl.textContent = nextMessage || '';
            statusEl.classList.remove('error-message');
        }, 4000);
    }

    function handlePrintHeadingChange(event) {
        const value = event?.target?.value || '';
        state.printHeadingText = value;
    }

    function handlePrintButtonClick() {
        if (!printContainer) {
            return;
        }

        if (printHeadingInput) {
            state.printHeadingText = printHeadingInput.value || '';
        }

        const entries = getVisibleEntries();
        if (!entries.length) {
            showPrintError(translate('Keine Einträge zum Drucken verfügbar.', 'No entries available for printing.'));
            return;
        }

        const columns = getVisibleColumns();
        if (!columns.length) {
            showPrintError(translate('Keine Spalten ausgewählt.', 'No columns selected.'));
            return;
        }

        printContainer.innerHTML = '';
        const content = buildPrintTable(entries, columns);
        printContainer.appendChild(content);
        printContainer.classList.add('is-active');
        printContainer.setAttribute('aria-hidden', 'false');

        const styleId = 'bvbs-print-page-style';
        let printStyle = document.getElementById(styleId);
        if (!printStyle) {
            printStyle = document.createElement('style');
            printStyle.id = styleId;
            printStyle.textContent = '@page { size: A4 landscape; margin: 10mm; }';
            document.head.appendChild(printStyle);
        }

        try {
            window.print();
        } finally {
            cleanupPrintContainer();
        }
    }

    function handlePrintSelectedButtonClick() {
        if (!printContainer) {
            return;
        }

        if (printHeadingInput) {
            state.printHeadingText = printHeadingInput.value || '';
        }

        const entries = getSelectedEntries();
        if (!entries.length) {
            showPrintError(translate('Keine Positionen ausgewählt.', 'No positions selected.'));
            return;
        }

        const columns = getVisibleColumns();
        if (!columns.length) {
            showPrintError(translate('Keine Spalten ausgewählt.', 'No columns selected.'));
            return;
        }

        printContainer.innerHTML = '';
        const content = buildPrintTable(entries, columns);
        printContainer.appendChild(content);
        printContainer.classList.add('is-active');
        printContainer.setAttribute('aria-hidden', 'false');

        const styleId = 'bvbs-print-page-style';
        let printStyle = document.getElementById(styleId);
        if (!printStyle) {
            printStyle = document.createElement('style');
            printStyle.id = styleId;
            printStyle.textContent = '@page { size: A4 landscape; margin: 10mm; }';
            document.head.appendChild(printStyle);
        }

        try {
            window.print();
        } finally {
            cleanupPrintContainer();
        }
    }
    function handleFilterChange(event) {
        const value = event?.target?.value || '';
        state.filterText = value;
        renderTable();
    }

    function handleSort(sortKey) {
        if (!sortKey) {
            return;
        }

        if (state.sortKey === sortKey) {
            if (state.sortDirection === 'asc') {
                state.sortDirection = 'desc';
            } else if (state.sortDirection === 'desc') {
                state.sortKey = null;
                state.sortDirection = null;
            } else {
                state.sortDirection = 'asc';
            }
        } else {
            state.sortKey = sortKey;
            state.sortDirection = 'asc';
        }

        renderTable();
    }

    function setupTableSorting() {
        tableHeaders = Array.from(document.querySelectorAll('#bvbsListTable thead th[data-sort-key]'));
        if (!tableHeaders.length) {
            return;
        }

        tableHeaders.forEach(th => {
            const key = th.getAttribute('data-sort-key');
            if (!key) {
                return;
            }

            th.setAttribute('tabindex', '0');
            th.setAttribute('aria-sort', 'none');
            th.addEventListener('click', () => handleSort(key));
            th.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSort(key);
                }
            });
        });
    }

    // --- FILE HANDLING ---
    async function processBvbsFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            state.entries = parseAbsFileContent(text);
            state.fileName = file.name || '';
            state.filterText = '';
            state.sortKey = null;
            state.sortDirection = null;
            state.selectedEntryIds = new Set();
            clearColumnFilters({ skipRender: true });

            if (filterInput) {
                filterInput.value = '';
            }

            if (statusEl) {
                const msg = typeof i18n !== 'undefined'
                    ? i18n.t('{count} Positionen geladen aus {fileName}', { count: state.entries.length, fileName: state.fileName })
                    : `${state.entries.length} positions loaded from ${state.fileName}`;
                statusEl.textContent = msg;
                statusEl.classList.remove('error-message');
                statusEl.dataset.baseMessage = msg;
            }

            updateSelectedPrintButtonState();
            renderTable();
        } catch (error) {
            console.error('Failed to process BVBS file', error);
            if (statusEl) {
                const msg = typeof i18n !== 'undefined'
                    ? i18n.t('Fehler beim Verarbeiten der Datei.')
                    : 'Error processing file.';
                statusEl.textContent = msg;
                statusEl.classList.add('error-message');
                statusEl.dataset.baseMessage = '';
            }
        }
    }

    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add('drag-over');
    }

    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');
    }

    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag-over');
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            processBvbsFile(files[0]);
        }
    }

    function handleFileInputChange(event) {
        const files = event.target?.files;
        if (files && files.length > 0) {
            processBvbsFile(files[0]);
        }
    }

    function updateUploadToggleState() {
        if (!uploadToggleBtn || !uploadSection) {
            return;
        }
        const isExpanded = !uploadSection.hasAttribute('hidden');
        const labelKey = isExpanded
            ? uploadToggleBtn.getAttribute('data-i18n-expanded')
            : uploadToggleBtn.getAttribute('data-i18n-collapsed');
        const fallback = isExpanded
            ? uploadToggleBtn.getAttribute('data-expanded-fallback')
            : uploadToggleBtn.getAttribute('data-collapsed-fallback');
        const label = translate(labelKey, fallback);
        const labelContainer = uploadToggleBtn.querySelector('.bvbs-upload-toggle-label');
        if (labelContainer) {
            labelContainer.textContent = label;
        } else if (label) {
            uploadToggleBtn.textContent = label;
        }
        uploadToggleBtn.setAttribute('aria-expanded', String(isExpanded));
    }

    function applyStoredUploadSectionState() {
        if (!uploadSection) {
            return;
        }
        const shouldCollapse = getStoredBoolean(STORAGE_KEYS.uploadCollapsed, false);
        const card = uploadCard || uploadSection.closest('.bvbs-toolbar-card');
        if (shouldCollapse) {
            uploadSection.setAttribute('hidden', '');
            card?.classList.add('is-collapsed');
        } else {
            uploadSection.removeAttribute('hidden');
            card?.classList.remove('is-collapsed');
        }
    }

    function toggleUploadSection() {
        if (!uploadSection) {
            return;
        }
        const card = uploadCard || uploadSection.closest('.bvbs-toolbar-card');
        const willCollapse = !uploadSection.hasAttribute('hidden');
        if (willCollapse) {
            uploadSection.setAttribute('hidden', '');
            card?.classList.add('is-collapsed');
        } else {
            uploadSection.removeAttribute('hidden');
            card?.classList.remove('is-collapsed');
        }
        setStoredBoolean(STORAGE_KEYS.uploadCollapsed, willCollapse);
        updateUploadToggleState();
    }

    // --- MAIN MODULE LOGIC ---
    function init() {
        fileInput = document.getElementById('bvbsListFileInput');
        dropZone = document.getElementById('bvbsListDropZone');
        openUploadBtn = document.getElementById('bvbsListOpenUploadBtn');
        tableBody = document.getElementById('bvbsListTableBody');
        statusEl = document.getElementById('bvbsListImportStatus');
        filterInput = document.getElementById('bvbsListFilterInput');
        uploadToggleBtn = document.getElementById('bvbsListToggleUploadBtn');
        uploadSection = document.getElementById('bvbsListUploadSection');
        uploadCard = document.getElementById('bvbsUploadCard');
        printButton = document.getElementById('bvbsPrintButton');
        selectedPrintButton = document.getElementById('bvbsPrintSelectedButton');
        printContainer = document.getElementById('bvbsPrintContainer');
        printHeadingInput = document.getElementById('bvbsPrintHeadingInput');
        selectAllCheckbox = document.getElementById('bvbsSelectAllCheckbox');
        previewModal = document.getElementById('bvbsPreviewModal');
        previewModalSvg = document.getElementById('bvbsPreviewModalSvg');
        previewModalCloseBtn = document.getElementById('bvbsPreviewModalClose');
        columnFilterToggle = document.getElementById('bvbsColumnFilterToggle');
        columnFilterMenu = document.getElementById('bvbsColumnFilterMenu');
        columnFilterList = document.getElementById('bvbsColumnFilterList');
        columnFilterResetBtn = document.getElementById('bvbsColumnFilterResetBtn');
        columnFilterCloseBtn = document.getElementById('bvbsColumnFilterCloseBtn');
        columnVisibilityList = document.getElementById('bvbsColumnVisibilityList');
        columnVisibilityResetBtn = document.getElementById('bvbsColumnVisibilityResetBtn');

        if (openUploadBtn && fileInput) {
            openUploadBtn.addEventListener('click', () => fileInput.click());
        }
        if (fileInput) {
            fileInput.addEventListener('change', handleFileInputChange);
        }
        if (dropZone) {
            dropZone.addEventListener('dragover', handleDragOver);
            dropZone.addEventListener('dragleave', handleDragLeave);
            dropZone.addEventListener('drop', handleDrop);
        }
        if (filterInput) {
            filterInput.addEventListener('input', handleFilterChange);
        }
        if (printButton) {
            printButton.addEventListener('click', handlePrintButtonClick);
        }
        if (selectedPrintButton) {
            selectedPrintButton.addEventListener('click', handlePrintSelectedButtonClick);
            updateSelectedPrintButtonState();
        }
        if (printHeadingInput) {
            state.printHeadingText = printHeadingInput.value || '';
            printHeadingInput.addEventListener('input', handlePrintHeadingChange);
        }
        if (printContainer) {
            printContainer.setAttribute('aria-hidden', 'true');
        }
        if (selectAllCheckbox) {
            const selectAllLabel = translate('Alle sichtbaren Zeilen auswählen', 'Select all visible rows');
            selectAllCheckbox.setAttribute('aria-label', selectAllLabel);
            selectAllCheckbox.setAttribute('title', selectAllLabel);
            selectAllCheckbox.addEventListener('change', handleSelectAllChange);
        }
        if (statusEl) {
            statusEl.dataset.baseMessage = statusEl.dataset?.baseMessage || '';
        }
        if (previewModalCloseBtn) {
            previewModalCloseBtn.addEventListener('click', closePreviewModal);
        }
        if (previewModal) {
            previewModal.addEventListener('click', event => {
                if (event.target === previewModal) {
                    closePreviewModal();
                }
            });
        }
        if (uploadToggleBtn && uploadSection) {
            applyStoredUploadSectionState();
            updateUploadToggleState();
            uploadToggleBtn.addEventListener('click', toggleUploadSection);
        } else if (uploadSection) {
            uploadSection.removeAttribute('hidden');
        }

        ensureColumnVisibilityState();
        buildColumnFilterMenu();
        updateColumnFilterToggleState();

        if (columnFilterToggle) {
            columnFilterToggle.addEventListener('click', toggleColumnFilterMenu);
        }
        if (columnFilterResetBtn) {
            columnFilterResetBtn.addEventListener('click', () => clearColumnFilters());
        }
        if (columnVisibilityResetBtn) {
            columnVisibilityResetBtn.addEventListener('click', () => resetColumnVisibility());
        }
        if (columnFilterCloseBtn) {
            columnFilterCloseBtn.addEventListener('click', () => closeColumnFilterMenu({ focusToggle: true }));
        }

        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('keydown', handleColumnFilterKeydown);

        setupTableSorting();
        renderTable(); // Initial render for empty state
    }

    window.bvbsListRefreshTranslations = function () {
        ensureColumnVisibilityState();
        buildColumnFilterMenu();
        updateColumnFilterToggleState();
        updateUploadToggleState();
        if (selectAllCheckbox) {
            const selectAllLabel = translate('Alle sichtbaren Zeilen auswählen', 'Select all visible rows');
            selectAllCheckbox.setAttribute('aria-label', selectAllLabel);
            selectAllCheckbox.setAttribute('title', selectAllLabel);
        }
        updateSelectedPrintButtonState();
        renderTable();
    };

    window.addEventListener('afterprint', cleanupPrintContainer);

    document.addEventListener('DOMContentLoaded', init);

})();
