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
    };

    // --- DOM ELEMENTS ---
    let fileInput, dropZone, openUploadBtn, tableBody, statusEl;

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
            entry.metadata = {
                position: getFirstFieldValue(headerBlock, 'p') || '',
                type: getFirstFieldValue(headerBlock, 't') || '',
                diameter,
                totalLength: parseNumberValue(getFirstFieldValue(headerBlock, 'l')),
                quantity: parseIntegerValue(getFirstFieldValue(headerBlock, 'n')),
                rollDiameter: parseNumberValue(getFirstFieldValue(headerBlock, 'f'))
            };
        } else {
            entry.metadata = { diameter: NaN, rollDiameter: NaN };
            entry.warningMessages.push('H-Block fehlt');
        }

        const mappedType = START_TYPE_MAP[entry.type];
        entry.displayType = mappedType || entry.metadata.type || entry.type || '';

        const geometryBlocks = entry.blockMap.get('G') || [];
        if (geometryBlocks.length) {
            const segments = buildSegmentsFromGeometryBlocks(geometryBlocks, entry);
            if (segments) {
                entry.segmentDefinitions = segments;
                entry.hasGeometry = true;
            }
        }

        if (!entry.hasGeometry) {
            entry.warningMessages.push('Keine Geometrie gefunden');
        }

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

    // --- RENDERING ---
    function renderTable() {
        if (!tableBody) return;
        tableBody.innerHTML = '';

        if (state.entries.length === 0) {
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = typeof i18n !== 'undefined' ? i18n.t('Keine Daten zum Anzeigen. Bitte laden Sie eine BVBS-Datei hoch.') : 'No data to display. Please upload a BVBS file.';
            cell.style.textAlign = 'center';
            cell.style.padding = '1rem';
            return;
        }

        state.entries.forEach(entry => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = entry.displayType || '—';
            row.insertCell().textContent = entry.metadata.position || '—';
            row.insertCell().textContent = formatDisplayNumber(entry.metadata.diameter, 1);
            row.insertCell().textContent = formatDisplayNumber(entry.metadata.totalLength, 1);
            row.insertCell().textContent = formatDisplayNumber(entry.metadata.quantity, 0);

            const previewCell = row.insertCell();
            previewCell.style.width = '150px';
            previewCell.style.height = '75px';
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.display = 'block';
            previewCell.appendChild(svg);

            renderEntryPreview(svg, entry);
        });
    }

    // --- FILE HANDLING ---
    async function processBvbsFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            state.entries = parseAbsFileContent(text);
            state.fileName = file.name || '';

            if (statusEl) {
                const msg = typeof i18n !== 'undefined'
                    ? i18n.t('{count} Positionen geladen aus {fileName}', { count: state.entries.length, fileName: state.fileName })
                    : `${state.entries.length} positions loaded from ${state.fileName}`;
                statusEl.textContent = msg;
                statusEl.classList.remove('error-message');
            }

            renderTable();
        } catch (error) {
            console.error('Failed to process BVBS file', error);
            if (statusEl) {
                 const msg = typeof i18n !== 'undefined'
                    ? i18n.t('Fehler beim Verarbeiten der Datei.')
                    : 'Error processing file.';
                statusEl.textContent = msg;
                statusEl.classList.add('error-message');
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

    // --- MAIN MODULE LOGIC ---
    function init() {
        fileInput = document.getElementById('bvbsListFileInput');
        dropZone = document.getElementById('bvbsListDropZone');
        openUploadBtn = document.getElementById('bvbsListOpenUploadBtn');
        tableBody = document.getElementById('bvbsListTableBody');
        statusEl = document.getElementById('bvbsListImportStatus');

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

        renderTable(); // Initial render for empty state
    }

    document.addEventListener('DOMContentLoaded', init);

})();