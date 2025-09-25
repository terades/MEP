/* global i18n */
(function () {
    const STORAGE_KEY = 'bfmaSavedMeshes';
    const state = {
        header: { p: '1', l: 5000, b: 2000, n: 1, t: 'BWM', e: 0, g: 'B500A', m: 'Q257', s: 0, v: '', a: '' },
        yBars: [], xBars: [], eBars: [],
        bending: { active: false, direction: 'Gy', sequence: [] },
        preview: normalizePreviewSettings({ showDimensions: true, showPitch: false }),
        datasetText: '', errors: [],
        summary: { totalWeight: 0, yCount: 0, xCount: 0, eCount: 0 }
    };
    let barIdCounter = 0, bendingSegmentIdCounter = 0, initialized = false;
    let weightAutoUpdate = true;
    let scheduledUpdateHandle = null;

    const hasWindow = typeof window !== 'undefined';
    const scheduleFrame = hasWindow && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : callback => setTimeout(callback, 16);
    const cancelFrame = hasWindow && typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : handle => clearTimeout(handle);

    function scheduleUpdate({ immediate = false } = {}) {
        if (immediate) {
            if (scheduledUpdateHandle !== null) {
                cancelFrame(scheduledUpdateHandle);
                scheduledUpdateHandle = null;
            }
            updateAll();
            return;
        }
        if (scheduledUpdateHandle !== null) {
            return;
        }
        scheduledUpdateHandle = scheduleFrame(() => {
            scheduledUpdateHandle = null;
            updateAll();
        });
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const BAR_TYPE_CONFIG = Object.freeze({
        Y: {
            collectionKey: 'yBars',
            bodyId: 'bfmaYBarsBody',
            fields: [
                { key: 'd', type: 'number', step: '0.1', min: 0 },
                { key: 'x', type: 'number', step: '1' },
                { key: 'y', type: 'number', step: '1' },
                { key: 'l', type: 'number', step: '1', min: 0 },
                { key: 'e', type: 'text' },
                { key: 'z', type: 'number', step: '1', min: 0 }
            ]
        },
        X: {
            collectionKey: 'xBars',
            bodyId: 'bfmaXBarsBody',
            fields: [
                { key: 'd', type: 'number', step: '0.1', min: 0 },
                { key: 'x', type: 'number', step: '1' },
                { key: 'y', type: 'number', step: '1' },
                { key: 'l', type: 'number', step: '1', min: 0 },
                { key: 'e', type: 'text' },
                { key: 'z', type: 'number', step: '1', min: 0 }
            ]
        },
        E: {
            collectionKey: 'eBars',
            bodyId: 'bfmaEBarsBody',
            fields: [
                { key: 'd', type: 'number', step: '0.1', min: 0 },
                { key: 'x', type: 'number', step: '1' },
                { key: 'y', type: 'number', step: '1' },
                { key: 'l', type: 'number', step: '1', min: 0 },
                { key: 'w', type: 'number', step: '1' },
                { key: 'e', type: 'text' },
                { key: 'z', type: 'number', step: '1', min: 0 }
            ]
        }
    });
    const BENDING_SEGMENT_TYPES = Object.freeze([
        { value: 'STRAIGHT', label: 'Gerade' },
        { value: 'BEND', label: 'Biegung' },
        { value: 'OFFSET', label: 'Versatz' }
    ]);

    function toBase64(str) {
        if (typeof btoa !== 'function') {
            return '';
        }
        try {
            return btoa(str);
        } catch (error) {
            try {
                if (typeof TextEncoder === 'function') {
                    const bytes = new TextEncoder().encode(str);
                    let binary = '';
                    bytes.forEach(byte => {
                        binary += String.fromCharCode(byte);
                    });
                    return btoa(binary);
                }
            } catch (e) {
                // Fallback handled below
            }
            const encoded = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, code) =>
                String.fromCharCode(parseInt(code, 16))
            );
            return btoa(encoded);
        }
    }

    // --- Helper functions ---
    function translateFallback(text) {
        if (typeof i18n?.t === 'function') {
            const translated = i18n.t(text);
            if (translated && translated !== text) {
                return translated;
            }
        }
        return text;
    }

    function formatNumber(value, decimals = 0) {
        if (!Number.isFinite(value)) {
            return '0';
        }
        try {
            return new Intl.NumberFormat('de-DE', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }).format(value);
        } catch (e) {
            const fixed = value.toFixed(decimals);
            return decimals === 0 ? String(Math.round(value)) : fixed;
        }
    }

    function formatDatasetNumber(value, decimals = 0) {
        if (!Number.isFinite(value)) return '0';
        const factor = Math.pow(10, decimals);
        return (Math.round(value * factor) / factor).toFixed(decimals);
    }

    function clamp(value, min, max) {
        if (!Number.isFinite(value)) return min;
        return Math.min(Math.max(value, min), max);
    }

    function parseNumber(value) {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : 0;
        }
        const normalized = String(value ?? '').trim().replace(/,/g, '.');
        const parsed = parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseSpacing(rawValue) {
        if (!rawValue && rawValue !== 0) {
            return { spacing: 0, count: 0 };
        }
        if (typeof rawValue === 'number') {
            return { spacing: rawValue, count: 0 };
        }
        const value = String(rawValue).trim();
        if (!value) {
            return { spacing: 0, count: 0 };
        }
        if (/^\d+,\d+$/.test(value)) {
            const [whole, fraction] = value.split(',');
            if (whole.length <= 2) {
                const decimalValue = parseFloat(`${whole}.${fraction}`);
                if (Number.isFinite(decimalValue)) {
                    return { spacing: decimalValue, count: 0 };
                }
            }
        }
        const sanitized = value.replace(/[a-zA-Z]/g, ' ');
        const tokens = sanitized.split(/[;,\/\s]+/).map(token => token.trim()).filter(Boolean);
        if (!tokens.length) {
            return { spacing: 0, count: 0 };
        }
        const numbers = tokens
            .map(token => parseFloat(token.replace(/,/g, '.')))
            .filter(num => Number.isFinite(num));
        if (!numbers.length) {
            return { spacing: 0, count: 0 };
        }
        const spacing = numbers[0];
        let count = 0;
        if (numbers.length >= 2) {
            count = numbers[numbers.length - 1];
            if (count === spacing && numbers.length >= 3) {
                count = numbers[numbers.length - 2];
            }
        }
        return { spacing, count };
    }

    function normalizePreviewSettings(preview) {
        const source = (preview && typeof preview === 'object') ? preview : {};
        return {
            showDimensions: source.showDimensions !== undefined ? !!source.showDimensions : true,
            showPitch: !!source.showPitch
        };
    }

    function getBarCollection(type) {
        const config = BAR_TYPE_CONFIG[type];
        return config ? state[config.collectionKey] : [];
    }

    function getDefaultBarLength(type) {
        const header = state.header;
        if (type === 'Y') return parseNumber(header.l);
        if (type === 'X') return parseNumber(header.b);
        return Math.min(parseNumber(header.l), parseNumber(header.b));
    }

    function createBar(type) {
        const baseLength = getDefaultBarLength(type) || 1000;
        const bar = {
            id: ++barIdCounter,
            d: 8,
            x: 0,
            y: 0,
            l: baseLength,
            e: '150',
            z: 1
        };
        if (type === 'E') {
            bar.w = 45;
        }
        return bar;
    }

    function addBar(type) {
        const collection = getBarCollection(type);
        collection.push(createBar(type));
        weightAutoUpdate = true;
        scheduleUpdate();
    }

    function removeBar(type, id) {
        const collection = getBarCollection(type);
        const index = collection.findIndex(item => item.id === id);
        if (index !== -1) {
            collection.splice(index, 1);
            weightAutoUpdate = true;
            scheduleUpdate();
        }
    }

    function duplicateBar(type, id) {
        const collection = getBarCollection(type);
        const index = collection.findIndex(item => item.id === id);
        if (index === -1) {
            return;
        }
        const original = collection[index];
        const clone = JSON.parse(JSON.stringify(original));
        clone.id = ++barIdCounter;

        const { spacing } = parseSpacing(original.e);
        const offset = Number.isFinite(spacing) && Math.abs(spacing) > 0 ? Math.abs(spacing) : 50;

        if (type === 'Y') {
            const width = parseNumber(state.header.b);
            const maxWidth = Number.isFinite(width) ? width : Infinity;
            clone.y = clamp(parseNumber(original.y) + offset, 0, maxWidth);
        } else if (type === 'X') {
            const length = parseNumber(state.header.l);
            const maxLength = Number.isFinite(length) ? length : Infinity;
            clone.x = clamp(parseNumber(original.x) + offset, 0, maxLength);
        } else if (type === 'E') {
            const length = parseNumber(state.header.l);
            const maxLength = Number.isFinite(length) ? length : Infinity;
            clone.x = clamp(parseNumber(original.x) + offset, 0, maxLength);
        }

        collection.splice(index + 1, 0, clone);
        weightAutoUpdate = true;
        scheduleUpdate();
    }

    function createBendingSegment() {
        return {
            id: ++bendingSegmentIdCounter,
            type: 'STRAIGHT',
            value: 0
        };
    }

    function addBendingSegment() {
        state.bending.sequence.push(createBendingSegment());
        scheduleUpdate();
    }

    function removeBendingSegment(id) {
        const index = state.bending.sequence.findIndex(item => item.id === id);
        if (index !== -1) {
            state.bending.sequence.splice(index, 1);
            scheduleUpdate();
        }
    }

    // --- LocalStorage ---
    function getLocalStorageSafe() {
        try {
            return window.localStorage;
        } catch (e) {
            return null;
        }
    }
    function readSavedMeshes() {
        const storage = getLocalStorageSafe();
        if (!storage) return {};
        const raw = storage.getItem(STORAGE_KEY);
        try {
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }
    function persistSavedMeshes(meshes) {
        const storage = getLocalStorageSafe();
        if (!storage) return;
        storage.setItem(STORAGE_KEY, JSON.stringify(meshes));
    }

    // --- UI Rendering ---
    function createTableCellInput(bar, field, type) {
        const cell = document.createElement('td');
        const config = BAR_TYPE_CONFIG[type];
        if (!config) return cell;
        const fieldConfig = config.fields.find(item => item.key === field);
        const input = document.createElement('input');
        input.type = fieldConfig?.type === 'text' ? 'text' : 'number';
        if (fieldConfig?.step) input.step = fieldConfig.step;
        if (fieldConfig?.min !== undefined) input.min = fieldConfig.min;
        if (fieldConfig?.type === 'text') {
            input.value = bar[field] ?? '';
        } else {
            const numericValue = parseNumber(bar[field]);
            input.value = Number.isFinite(numericValue) ? numericValue : 0;
        }
        input.addEventListener('input', () => {
            if (fieldConfig?.type === 'text') {
                bar[field] = input.value;
            } else {
                const parsed = parseNumber(input.value);
                bar[field] = parsed;
            }
            if (field === 'd' || field === 'l' || field === 'e' || field === 'z') {
                weightAutoUpdate = true;
            }
            scheduleUpdate();
        });
        cell.appendChild(input);
        return cell;
    }

    function ensureEmptyHint(tbody, colSpan) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = colSpan;
        cell.className = 'table-empty-hint';
        cell.textContent = translateFallback('Keine Stäbe definiert.');
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function renderBarTables() {
        Object.entries(BAR_TYPE_CONFIG).forEach(([type, config]) => {
            const body = document.getElementById(config.bodyId);
            if (!body) return;
            body.textContent = '';
            const bars = state[config.collectionKey];
            if (!bars.length) {
                ensureEmptyHint(body, config.fields.length + 2);
                return;
            }
            const fragment = document.createDocumentFragment();
            bars.forEach(bar => {
                const row = document.createElement('tr');
                config.fields.forEach(field => {
                    row.appendChild(createTableCellInput(bar, field.key, type));
                });
                const countCell = document.createElement('td');
                const barCount = computeBarCount(bar, type);
                countCell.className = 'bfma-count-cell';
                countCell.textContent = Number.isFinite(barCount) ? formatNumber(barCount, 0) : '0';
                countCell.classList.toggle('is-zero', barCount <= 0);
                const { spacing, count } = parseSpacing(bar.e);
                const zoneCount = parseNumber(bar.z);
                const tooltipParts = [];
                if (Number.isFinite(spacing) && spacing > 0) {
                    tooltipParts.push(`e=${formatDatasetNumber(spacing, 1)} mm`);
                }
                if (Number.isFinite(count) && count > 0) {
                    tooltipParts.push(`n=${formatNumber(count, 0)}`);
                }
                if (Number.isFinite(zoneCount) && zoneCount > 0) {
                    tooltipParts.push(`z=${formatNumber(zoneCount, 0)}`);
                }
                if (tooltipParts.length) {
                    countCell.title = tooltipParts.join(' \u00b7 ');
                }
                row.appendChild(countCell);
                const actionCell = document.createElement('td');
                const actionGroup = document.createElement('div');
                actionGroup.className = 'table-action-group';

                const duplicateButton = document.createElement('button');
                duplicateButton.type = 'button';
                duplicateButton.className = 'btn btn-secondary table-action-button';
                duplicateButton.textContent = '⧉';
                duplicateButton.title = translateFallback('Stab duplizieren');
                duplicateButton.setAttribute('aria-label', translateFallback('Stab duplizieren'));
                duplicateButton.addEventListener('click', () => duplicateBar(type, bar.id));
                actionGroup.appendChild(duplicateButton);

                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'btn btn-danger table-action-button';
                removeButton.textContent = '×';
                removeButton.title = translateFallback('Stab entfernen');
                removeButton.setAttribute('aria-label', translateFallback('Stab entfernen'));
                removeButton.addEventListener('click', () => removeBar(type, bar.id));
                actionGroup.appendChild(removeButton);

                actionCell.appendChild(actionGroup);
                row.appendChild(actionCell);
                fragment.appendChild(row);
            });
            body.appendChild(fragment);
        });
    }

    function renderBendingTable() {
        const body = document.getElementById('bfmaBendingSequenceBody');
        if (!body) return;
        body.textContent = '';
        if (!state.bending.sequence.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 3;
            cell.className = 'table-empty-hint';
            cell.textContent = translateFallback('Keine Biegesegmente definiert.');
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }
        const fragment = document.createDocumentFragment();
        state.bending.sequence.forEach(segment => {
            const row = document.createElement('tr');
            const typeCell = document.createElement('td');
            const typeSelect = document.createElement('select');
            BENDING_SEGMENT_TYPES.forEach(option => {
                const opt = document.createElement('option');
                opt.value = option.value;
                opt.textContent = translateFallback(option.label);
                typeSelect.appendChild(opt);
            });
            typeSelect.value = segment.type;
            typeSelect.addEventListener('change', () => {
                segment.type = typeSelect.value;
                scheduleUpdate();
            });
            typeCell.appendChild(typeSelect);
            row.appendChild(typeCell);

            const valueCell = document.createElement('td');
            const valueInput = document.createElement('input');
            valueInput.type = 'number';
            valueInput.step = '1';
            valueInput.value = parseNumber(segment.value);
            valueInput.addEventListener('input', () => {
                segment.value = parseNumber(valueInput.value);
                scheduleUpdate();
            });
            valueCell.appendChild(valueInput);
            row.appendChild(valueCell);

            const actionCell = document.createElement('td');
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'btn btn-danger table-action-button';
            removeButton.textContent = '×';
            removeButton.title = translateFallback('Segment entfernen');
            removeButton.setAttribute('aria-label', translateFallback('Segment entfernen'));
            removeButton.addEventListener('click', () => removeBendingSegment(segment.id));
            actionCell.appendChild(removeButton);
            row.appendChild(actionCell);
            fragment.appendChild(row);
        });
        body.appendChild(fragment);
    }

    function computeBarCount(bar, type) {
        if (!bar) return 0;
        const { spacing, count } = parseSpacing(bar.e);
        if (Number.isFinite(count) && count > 0) {
            return Math.round(count);
        }
        const zoneCount = parseNumber(bar.z);
        if (zoneCount > 0) {
            return Math.round(zoneCount);
        }
        const dimension = type === 'Y' ? parseNumber(state.header.b) : parseNumber(state.header.l);
        if (type === 'E') {
            if (zoneCount > 0) return Math.round(zoneCount);
            return 1;
        }
        if (!Number.isFinite(dimension) || dimension <= 0) {
            return 1;
        }
        if (Number.isFinite(spacing) && spacing > 0) {
            return Math.max(1, Math.floor(dimension / spacing) + 1);
        }
        return 1;
    }

    function computeWeightForBar(bar, type) {
        const length = Math.max(parseNumber(bar.l), 0);
        const diameter = Math.max(parseNumber(bar.d), 0);
        const count = computeBarCount(bar, type);
        if (!(length > 0 && diameter > 0 && count > 0)) {
            return 0;
        }
        const lengthMeters = (length / 1000) * count;
        const weightPerMeter = 0.006165 * diameter * diameter;
        return lengthMeters * weightPerMeter;
    }

    function computeBarPositions(dimension, count, spacing, offset = 0) {
        const positions = [];
        const safeCount = Math.max(1, Math.round(count));
        const safeSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 0;
        if (safeSpacing <= 0) {
            if (safeCount === 1) {
                positions.push(clamp(offset || dimension / 2, 0, dimension));
            } else {
                const step = dimension / (safeCount - 1);
                for (let i = 0; i < safeCount; i++) {
                    positions.push(clamp(i * step, 0, dimension));
                }
            }
            return positions;
        }
        let current = Number.isFinite(offset) ? offset : 0;
        for (let i = 0; i < safeCount; i++) {
            positions.push(clamp(current, 0, dimension));
            current += safeSpacing;
        }
        return positions;
    }

    function buildSvgContent(svg) {
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }

        const length = Math.max(parseNumber(state.header.l), 1);
        const width = Math.max(parseNumber(state.header.b), 1);
        svg.setAttribute('viewBox', `0 0 ${length} ${width}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const fragment = document.createDocumentFragment();
        const background = document.createElementNS(SVG_NS, 'rect');
        background.setAttribute('x', '0');
        background.setAttribute('y', '0');
        background.setAttribute('width', length);
        background.setAttribute('height', width);
        background.setAttribute('fill', '#f9fafb');
        background.setAttribute('stroke', '#d1d5db');
        background.setAttribute('stroke-width', Math.max(length, width) / 400);
        fragment.appendChild(background);

        let hasBars = false;

        const drawBarLines = (bars, type, color) => {
            bars.forEach(bar => {
                const count = computeBarCount(bar, type);
                if (count <= 0) return;
                const { spacing } = parseSpacing(bar.e);
                const strokeWidth = clamp(parseNumber(bar.d) / 2, Math.max(length, width) / 1200, Math.max(length, width) / 40);
                if (type === 'Y') {
                    const positions = computeBarPositions(width, count, spacing, parseNumber(bar.y));
                    positions.forEach(pos => {
                        const line = document.createElementNS(SVG_NS, 'line');
                        line.setAttribute('x1', '0');
                        line.setAttribute('y1', pos);
                        line.setAttribute('x2', length);
                        line.setAttribute('y2', pos);
                        line.setAttribute('stroke', color);
                        line.setAttribute('stroke-width', strokeWidth);
                        line.setAttribute('stroke-linecap', 'round');
                        line.setAttribute('opacity', '0.85');
                        fragment.appendChild(line);
                    });
                } else {
                    const positions = computeBarPositions(length, count, spacing, parseNumber(bar.x));
                    positions.forEach(pos => {
                        const line = document.createElementNS(SVG_NS, 'line');
                        line.setAttribute('x1', pos);
                        line.setAttribute('y1', '0');
                        line.setAttribute('x2', pos);
                        line.setAttribute('y2', width);
                        line.setAttribute('stroke', color);
                        line.setAttribute('stroke-width', strokeWidth);
                        line.setAttribute('stroke-linecap', 'round');
                        line.setAttribute('opacity', '0.85');
                        fragment.appendChild(line);
                    });
                }
                hasBars = true;
            });
        };

        drawBarLines(state.yBars, 'Y', '#2563eb');
        drawBarLines(state.xBars, 'X', '#db2777');

        state.eBars.forEach(bar => {
            const count = Math.max(1, computeBarCount(bar, 'E'));
            const angleDeg = parseNumber(bar.w);
            const lengthDiag = Math.max(parseNumber(bar.l), Math.hypot(length, width));
            const strokeWidth = clamp(parseNumber(bar.d) / 2, Math.max(length, width) / 1200, Math.max(length, width) / 40);
            const centerX = length / 2;
            const centerY = width / 2;
            const angleRad = (angleDeg * Math.PI) / 180;
            for (let i = 0; i < count; i++) {
                const offset = (i - (count - 1) / 2) * (parseSpacing(bar.e).spacing || 0);
                const line = document.createElementNS(SVG_NS, 'line');
                const dx = Math.cos(angleRad) * (lengthDiag / 2);
                const dy = Math.sin(angleRad) * (lengthDiag / 2);
                line.setAttribute('x1', centerX - dx + offset);
                line.setAttribute('y1', centerY - dy + offset);
                line.setAttribute('x2', centerX + dx + offset);
                line.setAttribute('y2', centerY + dy + offset);
                line.setAttribute('stroke', '#059669');
                line.setAttribute('stroke-width', strokeWidth);
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('opacity', '0.85');
                fragment.appendChild(line);
            }
            hasBars = true;
        });

        if (!hasBars) {
            const label = document.createElementNS(SVG_NS, 'text');
            label.textContent = translateFallback('Keine Stäbe definiert.');
            label.setAttribute('x', length / 2);
            label.setAttribute('y', width / 2);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'central');
            label.setAttribute('fill', '#9ca3af');
            label.setAttribute('font-size', Math.min(length, width) / 12);
            fragment.appendChild(label);
        }
        svg.appendChild(fragment);
    }

    function renderSvgPreview(forThumbnail = false) {
        const svg = forThumbnail ? document.createElementNS(SVG_NS, 'svg') : document.getElementById('bfmaPreviewSvg');
        if (!svg) return '';
        if (!forThumbnail) {
            svg.classList.add('bfma-preview-svg');
        }
        buildSvgContent(svg);
        if (forThumbnail) {
            const serializer = new XMLSerializer();
            return serializer.serializeToString(svg);
        }
        return '';
    }

    function renderValidationErrors() {
        const list = document.getElementById('bfmaErrorList');
        if (!list) return;
        list.textContent = '';
        if (!state.errors.length) {
            list.style.display = 'none';
            return;
        }
        const fragment = document.createDocumentFragment();
        state.errors.forEach(error => {
            const item = document.createElement('li');
            item.textContent = error;
            fragment.appendChild(item);
        });
        list.appendChild(fragment);
        list.style.display = 'block';
    }

    function updateSummaryUI() {
        const weightEl = document.getElementById('bfmaSummaryWeight');
        if (weightEl) {
            const quantity = Math.max(1, parseNumber(state.header.n));
            const perMeshWeight = weightAutoUpdate ? state.summary.totalWeight : parseNumber(state.header.e);
            let summaryText = `${formatNumber(perMeshWeight, 2)} kg`;
            if (quantity > 1) {
                const totalWeight = perMeshWeight * quantity;
                summaryText += ` (${quantity}× = ${formatNumber(totalWeight, 2)} kg)`;
            }
            weightEl.textContent = summaryText;
        }
        const countsEl = document.getElementById('bfmaSummaryBarCounts');
        if (countsEl) {
            countsEl.textContent = `${state.summary.yCount} / ${state.summary.xCount} / ${state.summary.eCount}`;
        }
        const weightInput = document.getElementById('bfmaWeight');
        if (weightAutoUpdate && weightInput) {
            const formatted = formatDatasetNumber(state.summary.totalWeight, 2);
            if (weightInput.value !== formatted) {
                weightInput.value = formatted;
            }
        } else if (!weightAutoUpdate && weightInput) {
            const manualValue = formatDatasetNumber(parseNumber(state.header.e), 2);
            if (weightInput.value !== manualValue) {
                weightInput.value = manualValue;
            }
        }
    }

    function populateSavedMeshesSelect(selectedName = '') {
        const select = document.getElementById('bfmaSavedShapes');
        if(!select) return;
        const meshes = readSavedMeshes();
        const names = Object.keys(meshes).sort();
        select.textContent = '';
        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = translateFallback('Gespeicherte Matte auswählen…');
        fragment.appendChild(placeholder);
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            fragment.appendChild(option);
        });
        select.appendChild(fragment);
        if (selectedName && names.includes(selectedName)) {
            select.value = selectedName;
        }
        select.disabled = names.length === 0;
        document.getElementById('bfmaLoadShapeButton').disabled = names.length === 0;
        document.getElementById('bfmaDeleteShapeButton').disabled = names.length === 0;
    }

    // --- Core Logic ---
    function calculateSummary() {
        const summary = { totalWeight: 0, yCount: 0, xCount: 0, eCount: 0 };
        summary.yCount = state.yBars.reduce((acc, bar) => acc + computeBarCount(bar, 'Y'), 0);
        summary.xCount = state.xBars.reduce((acc, bar) => acc + computeBarCount(bar, 'X'), 0);
        summary.eCount = state.eBars.reduce((acc, bar) => acc + computeBarCount(bar, 'E'), 0);
        summary.totalWeight += state.yBars.reduce((acc, bar) => acc + computeWeightForBar(bar, 'Y'), 0);
        summary.totalWeight += state.xBars.reduce((acc, bar) => acc + computeWeightForBar(bar, 'X'), 0);
        summary.totalWeight += state.eBars.reduce((acc, bar) => acc + computeWeightForBar(bar, 'E'), 0);
        summary.totalWeight = Math.max(0, summary.totalWeight);
        if (weightAutoUpdate) {
            state.header.e = parseNumber(formatDatasetNumber(summary.totalWeight, 3));
        }
        state.summary = summary;
    }

    function buildBarDatasetLine(type, bar, index) {
        const parts = [
            `${type}${index}`,
            `D${formatDatasetNumber(parseNumber(bar.d), 1)}`,
            `X${formatDatasetNumber(parseNumber(bar.x), 1)}`,
            `Y${formatDatasetNumber(parseNumber(bar.y), 1)}`,
            `L${formatDatasetNumber(parseNumber(bar.l), 1)}`
        ];
        if (type === 'E') {
            parts.push(`W${formatDatasetNumber(parseNumber(bar.w), 1)}`);
        }
        parts.push(`E${bar.e ?? ''}`);
        parts.push(`Z${formatDatasetNumber(parseNumber(bar.z), 0)}`);
        return `${parts.join('@')}@`;
    }

    function buildAbsDataset() {
        const header = state.header;
        header.t = (header.t ?? '').toString().trim() || 'BWM';
        const headerParts = [
            `P${header.p ?? ''}`,
            `L${formatDatasetNumber(parseNumber(header.l), 0)}`,
            `B${formatDatasetNumber(parseNumber(header.b), 0)}`,
            `N${formatDatasetNumber(parseNumber(header.n), 0)}`,
            `E${formatDatasetNumber(parseNumber(header.e), 2)}`,
            `G${header.g ?? ''}`,
            `M${header.m ?? ''}`,
            `S${formatDatasetNumber(parseNumber(header.s), 0)}`,
            `T${header.t.replace(/@/g, '')}`
        ];
        const lines = ['BFMA@', `H@${headerParts.join('@')}@`];
        state.yBars.forEach((bar, index) => {
            lines.push(buildBarDatasetLine('Y', bar, index + 1));
        });
        state.xBars.forEach((bar, index) => {
            lines.push(buildBarDatasetLine('X', bar, index + 1));
        });
        state.eBars.forEach((bar, index) => {
            lines.push(buildBarDatasetLine('E', bar, index + 1));
        });
        if (state.bending.active) {
            lines.push(`B@D${state.bending.direction}@`);
            state.bending.sequence.forEach((segment, index) => {
                lines.push(`BS${index + 1}@T${segment.type}@V${formatDatasetNumber(parseNumber(segment.value), 1)}@`);
            });
        }
        return lines.join('\n');
    }

    function validateState() {
        const errors = [];
        if (!(parseNumber(state.header.l) > 0)) {
            errors.push(translateFallback('Länge muss größer als 0 sein.'));
        }
        if (!(parseNumber(state.header.b) > 0)) {
            errors.push(translateFallback('Breite muss größer als 0 sein.'));
        }
        if (!state.yBars.length) {
            errors.push(translateFallback('Mindestens ein Y-Stab erforderlich.'));
        }
        if (!state.xBars.length) {
            errors.push(translateFallback('Mindestens ein X-Stab erforderlich.'));
        }
        state.yBars.forEach((bar, index) => {
            if (!(parseNumber(bar.d) > 0)) {
                errors.push(`${translateFallback('Y-Stab')} ${index + 1}: ${translateFallback('Durchmesser fehlt.')}`);
            }
            if (!(parseNumber(bar.l) > 0)) {
                errors.push(`${translateFallback('Y-Stab')} ${index + 1}: ${translateFallback('Länge fehlt.')}`);
            }
        });
        state.xBars.forEach((bar, index) => {
            if (!(parseNumber(bar.d) > 0)) {
                errors.push(`${translateFallback('X-Stab')} ${index + 1}: ${translateFallback('Durchmesser fehlt.')}`);
            }
            if (!(parseNumber(bar.l) > 0)) {
                errors.push(`${translateFallback('X-Stab')} ${index + 1}: ${translateFallback('Länge fehlt.')}`);
            }
        });
        state.eBars.forEach((bar, index) => {
            if (!(parseNumber(bar.d) > 0)) {
                errors.push(`${translateFallback('E-Stab')} ${index + 1}: ${translateFallback('Durchmesser fehlt.')}`);
            }
            if (!(parseNumber(bar.l) > 0)) {
                errors.push(`${translateFallback('E-Stab')} ${index + 1}: ${translateFallback('Länge fehlt.')}`);
            }
        });
        return errors;
    }

    function generateThumbnail() {
        const svgString = renderSvgPreview(true);
        return `data:image/svg+xml;base64,${toBase64(svgString)}`;
    }

    function saveCurrentMesh() {
        const nameInput = document.getElementById('bfmaShapeName');
        const name = nameInput.value.trim();
        if (!name) {
            alert('Bitte einen Namen für die Matte angeben.');
            return;
        }
        const meshes = readSavedMeshes();
        meshes[name] = {
            state: JSON.parse(JSON.stringify(state)), // Deep copy
            thumbnail: generateThumbnail()
        };
        persistSavedMeshes(meshes);
        populateSavedMeshesSelect();
        nameInput.value = '';
        alert(`Matte "${name}" gespeichert.`);
    }

    function loadMeshSnapshot(name, entry, options = {}) {
        const { silent = false } = options;
        if (!entry || typeof entry !== 'object') {
            if (!silent) {
                alert('Matte konnte nicht geladen werden.');
            }
            return false;
        }
        if (!initialized) {
            init();
        }
        const sourceState = (typeof entry.state === 'object' && entry.state !== null) ? entry.state : entry;
        const savedState = JSON.parse(JSON.stringify(sourceState));
        state.header = { ...state.header, ...(savedState.header || {}) };
        state.yBars = Array.isArray(savedState.yBars) ? savedState.yBars : [];
        state.xBars = Array.isArray(savedState.xBars) ? savedState.xBars : [];
        state.eBars = Array.isArray(savedState.eBars) ? savedState.eBars : [];
        const savedBending = savedState.bending || {};
        state.bending = {
            active: !!savedBending.active,
            direction: savedBending.direction || 'Gy',
            sequence: Array.isArray(savedBending.sequence) ? savedBending.sequence : []
        };
        state.preview = normalizePreviewSettings(savedState.preview ?? state.preview);
        weightAutoUpdate = false;
        refreshIdCounters();
        applyStateToUI();
        document.getElementById('bfmaShapeName').value = name || '';
        populateSavedMeshesSelect(name || '');
        scheduleUpdate({ immediate: true });
        if (!silent) {
            alert(`Matte "${name}" geladen.`);
        }
        return true;
    }

    function loadMeshByName(name, options = {}) {
        const { silent = false } = options;
        const sanitized = typeof name === 'string' ? name.trim() : '';
        if (!sanitized) {
            return false;
        }
        const meshes = readSavedMeshes();
        const saved = meshes[sanitized];
        if (!saved) {
            if (!silent) {
                alert(`Matte "${sanitized}" nicht gefunden.`);
            }
            populateSavedMeshesSelect();
            return false;
        }
        return loadMeshSnapshot(sanitized, saved, { silent });
    }

    function loadSelectedMesh() {
        const select = document.getElementById('bfmaSavedShapes');
        const name = select.value;
        if (!name) return;
        loadMeshByName(name, { silent: false });
    }

    function deleteSelectedMesh() {
        const select = document.getElementById('bfmaSavedShapes');
        const name = select.value;
        if (!name || !confirm(`Matte "${name}" wirklich löschen?`)) return;
        const meshes = readSavedMeshes();
        delete meshes[name];
        persistSavedMeshes(meshes);
        populateSavedMeshesSelect();
        alert(`Matte "${name}" gelöscht.`);
    }

    function updateAll() {
        renderBarTables();
        renderBendingTable();
        renderSvgPreview();
        calculateSummary();
        updateSummaryUI();
        state.errors = validateState();
        renderValidationErrors();
        const bendingToggle = document.getElementById('bfmaIsBent');
        if (bendingToggle) {
            bendingToggle.checked = !!state.bending.active;
        }
        const bendingEditor = document.getElementById('bfmaBendingEditor');
        if (bendingEditor) {
            bendingEditor.style.display = state.bending.active ? 'block' : 'none';
        }
        const bendingDirectionSelect = document.getElementById('bfmaBendingDirection');
        if (bendingDirectionSelect) {
            bendingDirectionSelect.value = state.bending.direction;
        }
        if (state.errors.length === 0) {
            state.datasetText = buildAbsDataset();
            const outputEl = document.getElementById('bfmaDatasetOutput');
            if (outputEl) outputEl.value = state.datasetText.replace(/@/g, '@\n');
        } else {
            state.datasetText = '';
            const outputEl = document.getElementById('bfmaDatasetOutput');
            if (outputEl) outputEl.value = '';
        }

    if (window.bfmaViewer3D) {
        window.bfmaViewer3D.update(JSON.parse(JSON.stringify(state)));
    }
    }

    // --- Event Listeners ---
    function attachStorageListeners() {
        document.getElementById('bfmaSaveShapeButton')?.addEventListener('click', saveCurrentMesh);
        document.getElementById('bfmaLoadShapeButton')?.addEventListener('click', loadSelectedMesh);
        document.getElementById('bfmaDeleteShapeButton')?.addEventListener('click', deleteSelectedMesh);
    }
    function syncHeaderFromInputs() {
        const mapping = [
            { id: 'bfmaPos', key: 'p', parser: value => value.trim() },
            { id: 'bfmaLength', key: 'l', parser: parseNumber },
            { id: 'bfmaWidth', key: 'b', parser: parseNumber },
            { id: 'bfmaQuantity', key: 'n', parser: parseNumber },
            { id: 'bfmaType', key: 't', parser: value => value.trim() },
            { id: 'bfmaWeight', key: 'e', parser: parseNumber },
            { id: 'bfmaSteelGrade', key: 'g', parser: value => value.trim() },
            { id: 'bfmaMeshType', key: 'm', parser: value => value.trim() },
            { id: 'bfmaBendingRoll', key: 's', parser: parseNumber }
        ];
        mapping.forEach(item => {
            const el = document.getElementById(item.id);
            if (!el) return;
            const value = item.parser(el.value ?? '');
            state.header[item.key] = typeof value === 'string' ? value : parseNumber(value);
        });
        state.header.t = (state.header.t ?? '').toString().trim() || 'BWM';
    }

    function applyHeaderStateToInputs() {
        state.header.t = (state.header.t ?? '').toString().trim() || 'BWM';
        const mapping = [
            { id: 'bfmaPos', key: 'p' },
            { id: 'bfmaLength', key: 'l' },
            { id: 'bfmaWidth', key: 'b' },
            { id: 'bfmaQuantity', key: 'n' },
            { id: 'bfmaType', key: 't' },
            { id: 'bfmaWeight', key: 'e' },
            { id: 'bfmaSteelGrade', key: 'g' },
            { id: 'bfmaMeshType', key: 'm' },
            { id: 'bfmaBendingRoll', key: 's' }
        ];
        mapping.forEach(item => {
            const el = document.getElementById(item.id);
            if (!el) return;
            const value = state.header[item.key];
            if (el.type === 'number') {
                el.value = Number.isFinite(value) ? value : parseNumber(value);
            } else {
                const textValue = value ?? '';
                if (item.id === 'bfmaSteelGrade' && textValue && window.masterDataManager?.addValue) {
                    window.masterDataManager.addValue('steelGrades', textValue);
                }
                if (item.id === 'bfmaMeshType' && textValue && window.masterDataManager?.addValue) {
                    window.masterDataManager.addValue('meshTypes', textValue);
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

    function applyPreviewSettingsToUI() {
        state.preview = normalizePreviewSettings(state.preview);
        const dimensionToggle = document.getElementById('bfmaToggleDimensions');
        if (dimensionToggle) {
            dimensionToggle.checked = !!state.preview.showDimensions;
        }
        const pitchToggle = document.getElementById('bfmaTogglePitch');
        if (pitchToggle) {
            pitchToggle.checked = !!state.preview.showPitch;
        }
    }

    function attachHeaderListeners() {
        syncHeaderFromInputs();
        const fields = [
            { id: 'bfmaPos', key: 'p', handler: value => value.trim() },
            { id: 'bfmaLength', key: 'l', handler: parseNumber },
            { id: 'bfmaWidth', key: 'b', handler: parseNumber },
            { id: 'bfmaQuantity', key: 'n', handler: parseNumber },
            { id: 'bfmaType', key: 't', handler: value => value.trim() },
            { id: 'bfmaSteelGrade', key: 'g', handler: value => value.trim() },
            { id: 'bfmaMeshType', key: 'm', handler: value => value.trim() },
            { id: 'bfmaBendingRoll', key: 's', handler: parseNumber }
        ];
        fields.forEach(field => {
            const el = document.getElementById(field.id);
            if (!el) return;
            const handleHeaderChange = () => {
                state.header[field.key] = field.handler(el.value ?? '');
                if (['l', 'b', 'n'].includes(field.key)) {
                    weightAutoUpdate = true;
                }
                scheduleUpdate();
            };
            el.addEventListener('input', handleHeaderChange);
            if (el.tagName === 'SELECT') {
                el.addEventListener('change', handleHeaderChange);
            }
        });
        const weightInput = document.getElementById('bfmaWeight');
        if (weightInput) {
            weightInput.addEventListener('input', () => {
                if (weightInput.value === '') {
                    weightAutoUpdate = true;
                    state.header.e = 0;
                } else {
                    weightAutoUpdate = false;
                    state.header.e = parseNumber(weightInput.value);
                }
                scheduleUpdate({ immediate: weightAutoUpdate });
            });
        }
    }

    function setActiveTab(tabId) {
        document.querySelectorAll('.bfma-tabs .tab-button').forEach(button => {
            const isActive = button.dataset.tab === tabId;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
        document.querySelectorAll('.bfma-tabs .tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId);
        });
    }

    function attachTabListeners() {
        const buttons = document.querySelectorAll('.bfma-tabs .tab-button');
        if (!buttons.length) return;
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                setActiveTab(button.dataset.tab);
            });
        });
        setActiveTab('y-bars');
    }

    function attachActionListeners() {
        document.getElementById('bfmaAddYBar')?.addEventListener('click', () => addBar('Y'));
        document.getElementById('bfmaAddXBar')?.addEventListener('click', () => addBar('X'));
        document.getElementById('bfmaAddEBar')?.addEventListener('click', () => addBar('E'));
        const bendingToggle = document.getElementById('bfmaIsBent');
        if (bendingToggle) {
            bendingToggle.addEventListener('change', () => {
                state.bending.active = bendingToggle.checked;
                scheduleUpdate();
            });
        }
        const bendingDirection = document.getElementById('bfmaBendingDirection');
        if (bendingDirection) {
            bendingDirection.addEventListener('change', () => {
                state.bending.direction = bendingDirection.value;
                scheduleUpdate();
            });
        }
        document.getElementById('bfmaAddBendingSegment')?.addEventListener('click', addBendingSegment);
    }

    function importAbsText(text) {
        if (!text) return;
        state.datasetText = text;
        const output = document.getElementById('bfmaDatasetOutput');
        if (output) {
            output.value = text;
        }
    }

    function attachImportListeners() {
        const dropZone = document.getElementById('bfmaDropZone');
        const fileInput = document.getElementById('bfmaImportFileInput');
        if (!dropZone || !fileInput) return;

        const handleFiles = files => {
            if (!files?.length) return;
            const file = files[0];
            const reader = new FileReader();
            reader.onload = () => {
                importAbsText(String(reader.result || ''));
            };
            reader.readAsText(file);
        };

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', event => {
            event.preventDefault();
            dropZone.classList.remove('drag-over');
            handleFiles(event.dataTransfer?.files);
        });
        fileInput.addEventListener('change', () => {
            handleFiles(fileInput.files);
            fileInput.value = '';
        });
    }

    function refreshIdCounters() {
        const allBarIds = [
            ...state.yBars.map(bar => parseNumber(bar.id)),
            ...state.xBars.map(bar => parseNumber(bar.id)),
            ...state.eBars.map(bar => parseNumber(bar.id))
        ].filter(Number.isFinite);
        barIdCounter = allBarIds.length ? Math.max(...allBarIds) : 0;
        const bendingIds = state.bending.sequence
            .map(segment => parseNumber(segment.id))
            .filter(Number.isFinite);
        bendingSegmentIdCounter = bendingIds.length ? Math.max(...bendingIds) : 0;
    }

    function applyStateToUI() {
        applyHeaderStateToInputs();
        applyPreviewSettingsToUI();
        const bendingToggle = document.getElementById('bfmaIsBent');
        if (bendingToggle) {
            bendingToggle.checked = !!state.bending.active;
        }
        const bendingDirection = document.getElementById('bfmaBendingDirection');
        if (bendingDirection) {
            bendingDirection.value = state.bending.direction;
        }
    }

    function attachViewListeners() {
        state.preview = normalizePreviewSettings(state.preview);
        const view2dBtn = document.getElementById('bfmaViewToggle2d');
        const view3dBtn = document.getElementById('bfmaViewToggle3d');
        const zoomBtn = document.getElementById('bfmaZoom3dButton');
        const previewContainer = document.querySelector('#bfmaView .bfma-preview-container');
        const svgPreview = document.getElementById('bfmaPreviewSvg');
        const preview3d = document.getElementById('bfmaPreview3d');
        const when3dControls = document.querySelector('#bfmaView .bfma-when-3d');
        const dimensionToggle = document.getElementById('bfmaToggleDimensions');
        const pitchToggle = document.getElementById('bfmaTogglePitch');

        if (!view2dBtn || !view3dBtn || !zoomBtn || !previewContainer || !svgPreview || !preview3d || !when3dControls) {
            return;
        }

        if (dimensionToggle) {
            dimensionToggle.checked = !!state.preview.showDimensions;
            dimensionToggle.addEventListener('change', () => {
                state.preview.showDimensions = !!dimensionToggle.checked;
                scheduleUpdate({ immediate: true });
            });
        }

        if (pitchToggle) {
            pitchToggle.checked = !!state.preview.showPitch;
            pitchToggle.addEventListener('change', () => {
                state.preview.showPitch = !!pitchToggle.checked;
                scheduleUpdate({ immediate: true });
            });
        }

        view2dBtn.addEventListener('click', () => {
            previewContainer.dataset.viewMode = '2d';
            view2dBtn.classList.add('is-active');
            view3dBtn.classList.remove('is-active');
            svgPreview.style.display = '';
            preview3d.style.display = 'none';
            when3dControls.style.display = 'none';
        });

        view3dBtn.addEventListener('click', () => {
            previewContainer.dataset.viewMode = '3d';
            view3dBtn.classList.add('is-active');
            view2dBtn.classList.remove('is-active');
            svgPreview.style.display = 'none';
            preview3d.style.display = '';
            when3dControls.style.display = '';

            if (window.bfmaViewer3D) {
                window.bfmaViewer3D.init();
                window.bfmaViewer3D.onResize();
                window.bfmaViewer3D.update(JSON.parse(JSON.stringify(state)));
            }
        });

        zoomBtn.addEventListener('click', () => {
            if (window.bfmaViewer3D) {
                window.bfmaViewer3D.zoomToFit();
            }
        });
    }

    function init() {
        if (initialized) return;
        const view = document.getElementById('bfmaView');
        if (!view) return;

        attachHeaderListeners();
        attachTabListeners();
        attachActionListeners();
        attachImportListeners();
        attachStorageListeners();
        attachViewListeners();
        populateSavedMeshesSelect();

        if (!state.yBars.length) addBar('Y');
        if (!state.xBars.length) addBar('X');
        initialized = true;
        applyStateToUI();
        scheduleUpdate({ immediate: true });
    }

    window.bfmaConfigurator = {
        onShow() {
            if (!initialized) {
                init();
            } else {
                scheduleUpdate({ immediate: true });
            }
        },
        forceUpdate: () => scheduleUpdate({ immediate: true }),
        loadMeshByName,
        loadMeshSnapshot
    };
})();
