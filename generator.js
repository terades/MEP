let zonesData = [];
let templates = [];
let nextZoneId = 0;
let savedOrders = [];
let currentSavedOrderId = null;
const LOCAL_STORAGE_SAVED_ORDERS_KEY = 'bvbsSavedOrders';
const LOCAL_STORAGE_BF2D_FORMS_KEY = 'bf2dSavedForms';
const SVG_NS = 'http://www.w3.org/2000/svg';

function getEffectiveZoneNum(zone, index) {
    return index === 0 ? zone.num + 1 : zone.num;
}

function getStirrupCount(zonesArr) {
    if (!Array.isArray(zonesArr)) {
        return 0;
    }
    return zonesArr.reduce((sum, zone, index) => sum + getEffectiveZoneNum(zone, index), 0);
}

const STEEL_DENSITY_KG_PER_M3 = 7850;

function sanitizeBvbsSegment(value) {
    return (value ?? '').toString().replace(/[@|\r\n]+/g, ' ').trim();
}

function formatNumberForBvbs(value, decimals = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '0';
    }
    if (decimals > 0) {
        return num.toFixed(decimals);
    }
    if (Math.abs(num - Math.round(num)) < 1e-6) {
        return String(Math.round(num));
    }
    return num.toString();
}

function calculateBarWeightKg(lengthMm, diameterMm) {
    const length = Number(lengthMm);
    const diameter = Number(diameterMm);
    if (!Number.isFinite(length) || !Number.isFinite(diameter) || length <= 0 || diameter <= 0) {
        return 0;
    }
    const lengthMeters = length / 1000;
    const radiusMeters = (diameter / 1000) / 2;
    const crossSectionArea = Math.PI * radiusMeters * radiusMeters;
    return crossSectionArea * lengthMeters * STEEL_DENSITY_KG_PER_M3;
}

function formatWeightForBvbs(lengthMm, diameterMm) {
    const weight = calculateBarWeightKg(lengthMm, diameterMm);
    if (!Number.isFinite(weight) || weight <= 0) {
        return '0';
    }
    return weight.toFixed(6);
}

function readSavedBf2dForms() {
    try {
        if (typeof localStorage === 'undefined') {
            return {};
        }
        const raw = localStorage.getItem(LOCAL_STORAGE_BF2D_FORMS_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (error) {
        console.warn('Konnte gespeicherte BF2D-Formen nicht lesen.', error);
    }
    return {};
}

function getSavedBf2dFormNames() {
    const forms = readSavedBf2dForms();
    return Object.keys(forms)
        .map(name => String(name))
        .filter(name => name.trim().length > 0)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function translateText(key, replacements = {}) {
    if (typeof window.i18n?.t === 'function') {
        return window.i18n.t(key, replacements);
    }
    let text = key;
    if (replacements && typeof replacements === 'object') {
        Object.entries(replacements).forEach(([placeholder, value]) => {
            text = text.replace(new RegExp(`{${placeholder}}`, 'g'), value);
        });
    }
    return text;
}

let stirrupFormPickerState = null;
const stirrupFormFilterState = {
    diameter: 'all',
    steelGrade: 'all',
    segmentThreshold: 'all'
};

function isStirrupFormModalOpen() {
    return document.getElementById('stirrupFormModal')?.classList.contains('visible') || false;
}

function computeStirrupFormSummary(formData = {}) {
    const segments = Array.isArray(formData?.segments) ? formData.segments : [];
    let straightLength = 0;
    let arcLength = 0;

    segments.forEach((segment, index) => {
        const lengthValue = Number(segment?.length);
        if (Number.isFinite(lengthValue) && lengthValue > 0) {
            straightLength += lengthValue;
        }
        if (index < segments.length - 1) {
            const angleValue = Math.abs(Number(segment?.bendAngle) || 0);
            if (angleValue > 0) {
                let radiusValue = Number(segment?.radius);
                if (!Number.isFinite(radiusValue) || radiusValue <= 0) {
                    const rollDiameter = Number(formData?.meta?.rollDiameter);
                    if (Number.isFinite(rollDiameter) && rollDiameter > 0) {
                        radiusValue = rollDiameter / 2;
                    }
                }
                if (Number.isFinite(radiusValue) && radiusValue > 0) {
                    arcLength += (angleValue * Math.PI / 180) * radiusValue;
                }
            }
        }
    });

    const meta = typeof formData?.meta === 'object' && formData.meta !== null ? formData.meta : {};
    const diameterValue = Number(meta.diameter);
    const quantityValue = Number(meta.quantity);
    const rollDiameterValue = Number(meta.rollDiameter);
    const remark = typeof meta.remark === 'string' ? meta.remark.trim() : '';
    const steelGrade = typeof meta.steelGrade === 'string' ? meta.steelGrade.trim() : '';

    const segmentPreviewValues = segments
        .map(segment => Number(segment?.length))
        .filter(value => Number.isFinite(value) && value > 0)
        .map(length => `${formatNumberForBvbs(length)} mm`);

    const maxSegmentsToShow = 6;
    let segmentPreviewText = '';
    if (segmentPreviewValues.length > 0) {
        if (segmentPreviewValues.length > maxSegmentsToShow) {
            segmentPreviewText = `${segmentPreviewValues.slice(0, maxSegmentsToShow).join(' • ')} …`;
        } else {
            segmentPreviewText = segmentPreviewValues.join(' • ');
        }
    }

    return {
        segmentCount: segments.length,
        straightLength,
        arcLength,
        totalLength: straightLength + arcLength,
        diameter: Number.isFinite(diameterValue) && diameterValue > 0 ? diameterValue : null,
        quantity: Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : null,
        rollDiameter: Number.isFinite(rollDiameterValue) && rollDiameterValue > 0 ? rollDiameterValue : null,
        remark,
        steelGrade,
        segmentPreview: segmentPreviewText
    };
}

function buildStirrupFormSearchText(name, formData = {}, summary = {}) {
    const meta = typeof formData?.meta === 'object' && formData.meta !== null ? formData.meta : {};
    const segments = Array.isArray(formData?.segments) ? formData.segments : [];
    const parts = [
        name,
        meta.project,
        meta.order,
        meta.position,
        meta.remark,
        meta.steelGrade,
        meta.diameter,
        meta.quantity,
        meta.rollDiameter,
        summary.segmentPreview,
        summary.totalLength
    ];
    segments.forEach(segment => {
        parts.push(segment?.length);
        parts.push(segment?.bendAngle);
    });
    return parts
        .filter(value => value !== null && value !== undefined && String(value).trim().length > 0)
        .map(value => String(value).toLowerCase())
        .join(' ');
}

function createStirrupFormMetaBadge(text) {
    const badge = document.createElement('span');
    badge.className = 'stirrup-form-item__meta-badge';
    badge.textContent = text;
    return badge;
}

function getActiveStirrupInputValue() {
    if (!stirrupFormPickerState?.inputId) {
        return '';
    }
    const input = document.getElementById(stirrupFormPickerState.inputId);
    const rawValue = input?.value;
    return typeof rawValue === 'string' ? rawValue.trim() : '';
}

function updateStirrupFormSelectButtonState() {
    const button = document.getElementById('stirrupFormSelectButton');
    if (!button) {
        return;
    }
    if (!button.dataset.labelBase) {
        button.dataset.labelBase = button.textContent || translateText('Übernehmen');
    }
    const baseLabel = button.dataset.labelBase;
    const selectedName = stirrupFormPickerState?.selectedName?.trim() || '';
    const forms = readSavedBf2dForms();
    const isValidSelection = !!(selectedName && Object.prototype.hasOwnProperty.call(forms, selectedName));
    button.disabled = !isValidSelection;
    if (isValidSelection) {
        button.textContent = `${baseLabel} (${selectedName})`;
        button.setAttribute('aria-label', `${baseLabel} (${selectedName})`);
    } else {
        button.textContent = baseLabel;
        button.setAttribute('aria-label', baseLabel);
    }
}

function updateStirrupFormListSelection() {
    const listEl = document.getElementById('stirrupFormList');
    if (!listEl) {
        return;
    }
    const items = listEl.querySelectorAll('.stirrup-form-item');
    const selectedName = stirrupFormPickerState?.selectedName?.trim() || '';
    const activeValue = getActiveStirrupInputValue();
    items.forEach(item => {
        const itemName = item.dataset.formName || '';
        const isSelected = selectedName ? itemName === selectedName : (!!activeValue && itemName === activeValue);
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
}

function setStirrupFormSelectedName(name) {
    if (!stirrupFormPickerState) {
        return;
    }
    stirrupFormPickerState.selectedName = typeof name === 'string' ? name.trim() : '';
    updateStirrupFormListSelection();
    updateStirrupFormPreview(stirrupFormPickerState.selectedName);
    updateStirrupFormSelectButtonState();
}

function passesStirrupFormFilters(summary = {}) {
    if (!summary || typeof summary !== 'object') {
        return true;
    }

    if (stirrupFormFilterState.diameter !== 'all') {
        const diameterFilter = Number(stirrupFormFilterState.diameter);
        if (Number.isFinite(diameterFilter)) {
            if (!Number.isFinite(summary.diameter) || Math.abs(Number(summary.diameter) - diameterFilter) > 1e-6) {
                return false;
            }
        }
    }

    if (stirrupFormFilterState.steelGrade !== 'all') {
        const filterGrade = String(stirrupFormFilterState.steelGrade).toLowerCase();
        const summaryGrade = summary.steelGrade ? String(summary.steelGrade).toLowerCase() : '';
        if (summaryGrade !== filterGrade) {
            return false;
        }
    }

    if (stirrupFormFilterState.segmentThreshold !== 'all') {
        const threshold = Number(stirrupFormFilterState.segmentThreshold);
        if (Number.isFinite(threshold) && Number(summary.segmentCount) < threshold) {
            return false;
        }
    }

    return true;
}

function setFilterSelectOptions(selectEl, options, filterKey, placeholderLabel) {
    if (!selectEl) {
        return;
    }
    const normalizedPlaceholder = placeholderLabel || '';
    const previousValue = stirrupFormFilterState[filterKey] || 'all';
    selectEl.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = 'all';
    placeholderOption.textContent = normalizedPlaceholder;
    selectEl.appendChild(placeholderOption);
    const allowedValues = new Set(['all']);
    options.forEach(option => {
        if (!option || typeof option.value === 'undefined') {
            return;
        }
        const optionValue = String(option.value);
        allowedValues.add(optionValue);
        const opt = document.createElement('option');
        opt.value = optionValue;
        opt.textContent = option.label;
        selectEl.appendChild(opt);
    });
    const nextValue = allowedValues.has(String(previousValue)) ? String(previousValue) : 'all';
    stirrupFormFilterState[filterKey] = nextValue;
    selectEl.value = nextValue;
}

function populateStirrupFilterOptions(entries = []) {
    const diameterSelect = document.getElementById('stirrupFormDiameterFilter');
    const steelSelect = document.getElementById('stirrupFormSteelFilter');
    const diameterValues = new Set();
    const steelValues = new Set();

    entries.forEach(entry => {
        const summary = entry?.summary;
        if (!summary) {
            return;
        }
        if (Number.isFinite(summary.diameter)) {
            diameterValues.add(Number(summary.diameter));
        }
        if (summary.steelGrade) {
            steelValues.add(String(summary.steelGrade));
        }
    });

    if (diameterSelect) {
        const diameterOptions = Array.from(diameterValues)
            .sort((a, b) => a - b)
            .map(value => ({
                value,
                label: `Ø ${formatNumberForBvbs(value)} mm`
            }));
        setFilterSelectOptions(diameterSelect, diameterOptions, 'diameter', translateText('Alle Durchmesser'));
    }

    if (steelSelect) {
        const steelOptions = Array.from(steelValues)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .map(value => ({ value, label: value }));
        setFilterSelectOptions(steelSelect, steelOptions, 'steelGrade', translateText('Alle Stahlgüten'));
    }
}

function buildStirrupPreviewPoints(segments = []) {
    if (!Array.isArray(segments) || segments.length === 0) {
        return [];
    }
    const points = [{ x: 0, y: 0 }];
    let angleDeg = 0;
    segments.forEach((segment, index) => {
        const lengthValue = Number(segment?.length);
        const length = Number.isFinite(lengthValue) ? Math.max(lengthValue, 0) : 0;
        const radians = angleDeg * Math.PI / 180;
        const lastPoint = points[points.length - 1];
        const nextPoint = {
            x: lastPoint.x + Math.cos(radians) * length,
            y: lastPoint.y + Math.sin(radians) * length
        };
        points.push(nextPoint);
        if (index < segments.length - 1) {
            const bendAngleValue = Number(segment?.bendAngle);
            if (Number.isFinite(bendAngleValue) && bendAngleValue !== 0) {
                const directionMultiplier = segment?.bendDirection === 'R' ? -1 : 1;
                angleDeg += bendAngleValue * directionMultiplier;
            }
        }
    });
    return points;
}

function createStirrupPreviewSvg(formData = {}) {
    const segments = Array.isArray(formData?.segments) ? formData.segments : [];
    if (segments.length === 0) {
        return null;
    }
    const points = buildStirrupPreviewPoints(segments);
    if (points.length < 2) {
        return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    points.forEach(point => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });

    const padding = 18;
    const targetWidth = 320;
    const targetHeight = 220;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((targetWidth - padding * 2) / spanX, (targetHeight - padding * 2) / spanY);
    const effectiveScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const width = spanX * effectiveScale + padding * 2;
    const height = spanY * effectiveScale + padding * 2;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', translateText('Vorschau der Biegeform'));

    const normalizedPoints = points.map(point => ({
        x: padding + (point.x - minX) * effectiveScale,
        y: padding + (maxY - point.y) * effectiveScale
    }));

    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.setAttribute('stroke-width', '2');
    polyline.style.stroke = 'var(--primary-color)';
    polyline.setAttribute('points', normalizedPoints.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
    svg.appendChild(polyline);

    normalizedPoints.forEach((point, index) => {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', point.x.toFixed(1));
        circle.setAttribute('cy', point.y.toFixed(1));
        circle.setAttribute('r', index === 0 ? '3.8' : '3');
        circle.style.fill = index === 0 ? 'var(--primary-color)' : 'currentColor';
        circle.style.opacity = index === 0 ? '1' : '0.75';
        svg.appendChild(circle);
    });

    return svg;
}

function createPreviewMetaItem(label, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'stirrup-form-preview__meta-item';
    const labelEl = document.createElement('span');
    labelEl.className = 'stirrup-form-preview__meta-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'stirrup-form-preview__meta-value';
    valueEl.textContent = value;
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
}

function updateStirrupFormPreview(name = '') {
    const previewContainer = document.getElementById('stirrupFormPreview');
    if (!previewContainer) {
        return;
    }
    previewContainer.innerHTML = '';

    const zoneLabel = stirrupFormPickerState?.zoneLabel?.trim() || '';
    const sanitizedName = typeof name === 'string' ? name.trim() : '';
    const forms = readSavedBf2dForms();
    const formData = sanitizedName && Object.prototype.hasOwnProperty.call(forms, sanitizedName)
        ? forms[sanitizedName]
        : null;
    const activeValue = getActiveStirrupInputValue();

    const header = document.createElement('div');
    header.className = 'stirrup-form-preview__header';
    const title = document.createElement('h3');
    title.className = 'stirrup-form-preview__title';
    title.textContent = formData ? sanitizedName : translateText('Keine Biegeform ausgewählt');
    header.appendChild(title);

    if (zoneLabel) {
        const zoneBadge = document.createElement('span');
        zoneBadge.className = 'stirrup-form-item__badge stirrup-form-preview__badge';
        zoneBadge.textContent = translateText('Zone {label}', { label: zoneLabel });
        header.appendChild(zoneBadge);
    }

    if (formData && activeValue && activeValue === sanitizedName) {
        const currentBadge = document.createElement('span');
        currentBadge.className = 'stirrup-form-item__badge stirrup-form-preview__badge';
        currentBadge.textContent = translateText('Aktuelle Auswahl');
        header.appendChild(currentBadge);
    }

    previewContainer.appendChild(header);

    if (!formData) {
        const placeholder = document.createElement('p');
        placeholder.className = 'stirrup-form-preview__placeholder';
        placeholder.textContent = translateText('Bitte wählen Sie eine Biegeform aus der Liste.');
        previewContainer.appendChild(placeholder);
        return;
    }

    const canvas = document.createElement('div');
    canvas.className = 'stirrup-form-preview__canvas';
    const previewSvg = createStirrupPreviewSvg(formData);
    if (previewSvg) {
        canvas.appendChild(previewSvg);
    } else {
        const fallback = document.createElement('p');
        fallback.className = 'stirrup-form-preview__placeholder';
        fallback.textContent = translateText('Keine Vorschau verfügbar.');
        canvas.appendChild(fallback);
    }
    previewContainer.appendChild(canvas);

    const summary = computeStirrupFormSummary(formData);
    const metaItems = [];
    if (summary.diameter !== null) {
        metaItems.push({ label: translateText('Durchmesser'), value: `Ø ${formatNumberForBvbs(summary.diameter)} mm` });
    }
    if (summary.rollDiameter !== null) {
        metaItems.push({ label: translateText('Roll-Ø'), value: `${formatNumberForBvbs(summary.rollDiameter)} mm` });
    }
    if (summary.totalLength > 0) {
        metaItems.push({ label: translateText('Gesamtlänge'), value: `${formatNumberForBvbs(summary.totalLength)} mm` });
    }
    metaItems.push({ label: translateText('Segmente'), value: formatNumberForBvbs(summary.segmentCount) });
    if (summary.segmentPreview) {
        metaItems.push({ label: translateText('Schenkel'), value: summary.segmentPreview });
    }
    if (summary.quantity !== null) {
        metaItems.push({ label: translateText('Stückzahl'), value: formatNumberForBvbs(summary.quantity) });
    }
    const weightKg = summary.totalLength > 0 && summary.diameter !== null
        ? calculateBarWeightKg(summary.totalLength, summary.diameter)
        : 0;
    if (Number.isFinite(weightKg) && weightKg > 0) {
        metaItems.push({ label: translateText('Gewicht'), value: `${weightKg.toFixed(3)} kg` });
    }
    if (summary.steelGrade) {
        metaItems.push({ label: translateText('Stahlgüte'), value: summary.steelGrade });
    }

    if (metaItems.length > 0) {
        const metaGrid = document.createElement('div');
        metaGrid.className = 'stirrup-form-preview__meta';
        metaItems.forEach(item => {
            metaGrid.appendChild(createPreviewMetaItem(item.label, item.value));
        });
        previewContainer.appendChild(metaGrid);
    }

    const formMeta = typeof formData?.meta === 'object' && formData.meta !== null ? formData.meta : {};
    const docItems = [];
    if (formMeta.project) {
        docItems.push({ label: translateText('Projekt'), value: formMeta.project });
    }
    if (formMeta.order) {
        docItems.push({ label: translateText('Auftrag'), value: formMeta.order });
    }
    if (formMeta.position) {
        docItems.push({ label: translateText('Position'), value: formMeta.position });
    }
    if (docItems.length > 0) {
        const docGrid = document.createElement('div');
        docGrid.className = 'stirrup-form-preview__meta';
        docItems.forEach(item => {
            docGrid.appendChild(createPreviewMetaItem(item.label, item.value));
        });
        previewContainer.appendChild(docGrid);
    }

    if (summary.remark) {
        const remarkBlock = document.createElement('div');
        remarkBlock.className = 'stirrup-form-preview__remark';
        const remarkLabel = document.createElement('span');
        remarkLabel.className = 'stirrup-form-preview__remark-label';
        remarkLabel.textContent = translateText('Notiz');
        const remarkValue = document.createElement('span');
        remarkValue.className = 'stirrup-form-preview__remark-text';
        remarkValue.textContent = summary.remark;
        remarkBlock.appendChild(remarkLabel);
        remarkBlock.appendChild(remarkValue);
        previewContainer.appendChild(remarkBlock);
    }

    const segments = Array.isArray(formData?.segments) ? formData.segments : [];
    if (segments.length > 0) {
        const segmentWrapper = document.createElement('div');
        segmentWrapper.className = 'stirrup-form-preview__segments';
        const segmentTitle = document.createElement('h4');
        segmentTitle.className = 'stirrup-form-preview__segments-title';
        segmentTitle.textContent = translateText('Segmentdetails');
        segmentWrapper.appendChild(segmentTitle);

        const table = document.createElement('table');
        table.className = 'stirrup-form-preview__segments-table';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        [translateText('#'), translateText('Länge'), translateText('Biegung'), translateText('Radius')].forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        segments.forEach((segment, index) => {
            const row = document.createElement('tr');

            const indexCell = document.createElement('td');
            indexCell.textContent = String(index + 1);
            row.appendChild(indexCell);

            const lengthCell = document.createElement('td');
            const lengthValue = Number(segment?.length);
            lengthCell.textContent = Number.isFinite(lengthValue) && lengthValue > 0
                ? `${formatNumberForBvbs(lengthValue)} mm`
                : '–';
            row.appendChild(lengthCell);

            const bendCell = document.createElement('td');
            const angleValue = Number(segment?.bendAngle);
            if (Number.isFinite(angleValue) && angleValue > 0) {
                const directionSymbol = segment?.bendDirection === 'R' ? '↻' : '↺';
                bendCell.textContent = `${formatNumberForBvbs(angleValue)}° ${directionSymbol}`;
            } else {
                bendCell.textContent = translateText('Gerade');
            }
            row.appendChild(bendCell);

            const radiusCell = document.createElement('td');
            const radiusValue = Number(segment?.radius);
            radiusCell.textContent = Number.isFinite(radiusValue) && radiusValue > 0
                ? `${formatNumberForBvbs(radiusValue)} mm`
                : '–';
            row.appendChild(radiusCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        segmentWrapper.appendChild(table);
        previewContainer.appendChild(segmentWrapper);
    }
}

function renderStirrupFormModalList() {
    const listEl = document.getElementById('stirrupFormList');
    const emptyStateEl = document.getElementById('stirrupFormEmptyState');
    const searchEl = document.getElementById('stirrupFormSearch');
    const resultInfoEl = document.getElementById('stirrupFormResultInfo');
    if (!listEl || !emptyStateEl) {
        return;
    }

    const zoneLabel = stirrupFormPickerState?.zoneLabel?.trim() || '';
    const listLabelBase = translateText('Gespeicherte Biegeformen');
    if (zoneLabel) {
        listEl.setAttribute('aria-label', `${listLabelBase} (${zoneLabel})`);
    } else {
        listEl.setAttribute('aria-label', listLabelBase);
    }

    const forms = readSavedBf2dForms();
    const entries = Object.entries(forms)
        .map(([name, data]) => ({
            name: String(name).trim(),
            data,
            summary: computeStirrupFormSummary(data)
        }))
        .filter(entry => entry.name.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map(entry => ({
            ...entry,
            searchText: buildStirrupFormSearchText(entry.name, entry.data, entry.summary)
        }));

    populateStirrupFilterOptions(entries);

    const filterValue = searchEl?.value?.toLowerCase().trim() || '';
    const selectedName = stirrupFormPickerState?.selectedName?.trim() || '';
    const activeValue = getActiveStirrupInputValue();

    listEl.innerHTML = '';
    let visibleCount = 0;

    entries.forEach(entry => {
        const { summary, searchText } = entry;
        if (filterValue && !searchText.includes(filterValue)) {
            return;
        }
        if (!passesStirrupFormFilters(summary)) {
            return;
        }

        visibleCount += 1;

        const itemButton = document.createElement('button');
        itemButton.type = 'button';
        itemButton.className = 'stirrup-form-item';
        itemButton.dataset.formName = entry.name;
        itemButton.setAttribute('role', 'option');

        const isSelected = selectedName ? entry.name === selectedName : (!!activeValue && entry.name === activeValue);
        itemButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        if (isSelected) {
            itemButton.classList.add('selected');
        }

        itemButton.addEventListener('click', () => {
            setStirrupFormSelectedName(entry.name);
            itemButton.focus({ preventScroll: true });
        });
        itemButton.addEventListener('dblclick', (event) => {
            event.preventDefault();
            applyStirrupFormSelection(entry.name);
        });
        itemButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyStirrupFormSelection(entry.name);
            } else if (event.key === ' ') {
                event.preventDefault();
                setStirrupFormSelectedName(entry.name);
            }
        });

        const header = document.createElement('div');
        header.className = 'stirrup-form-item__header';
        const nameEl = document.createElement('span');
        nameEl.className = 'stirrup-form-item__name';
        nameEl.textContent = entry.name;
        header.appendChild(nameEl);

        if (activeValue && entry.name === activeValue) {
            const currentBadge = document.createElement('span');
            currentBadge.className = 'stirrup-form-item__badge stirrup-form-item__badge--current';
            currentBadge.textContent = translateText('Aktuell');
            header.appendChild(currentBadge);
        }

        if (summary.segmentCount > 0) {
            header.appendChild(createStirrupFormMetaBadge(`${translateText('Segmente')}: ${summary.segmentCount}`));
        }

        itemButton.appendChild(header);

        const metaRow = document.createElement('div');
        metaRow.className = 'stirrup-form-item__meta';

        if (summary.diameter !== null) {
            metaRow.appendChild(createStirrupFormMetaBadge(`Ø ${formatNumberForBvbs(summary.diameter)} mm`));
        }
        if (summary.rollDiameter !== null) {
            metaRow.appendChild(createStirrupFormMetaBadge(`${translateText('Roll-Ø')} ${formatNumberForBvbs(summary.rollDiameter)} mm`));
        }
        if (summary.totalLength > 0) {
            metaRow.appendChild(createStirrupFormMetaBadge(`${translateText('Länge')}: ${formatNumberForBvbs(summary.totalLength)} mm`));
        }
        if (summary.quantity !== null) {
            metaRow.appendChild(createStirrupFormMetaBadge(`${translateText('Stückzahl')}: ${formatNumberForBvbs(summary.quantity)}`));
        }
        if (summary.steelGrade) {
            metaRow.appendChild(createStirrupFormMetaBadge(summary.steelGrade));
        }

        if (metaRow.children.length > 0) {
            itemButton.appendChild(metaRow);
        }

        const details = document.createElement('div');
        details.className = 'stirrup-form-item__details';

        if (summary.segmentPreview) {
            const segmentsEl = document.createElement('div');
            segmentsEl.textContent = `${translateText('Schenkel')}: ${summary.segmentPreview}`;
            details.appendChild(segmentsEl);
        }

        if (summary.remark) {
            const remarkEl = document.createElement('div');
            remarkEl.className = 'stirrup-form-item__remark';
            remarkEl.textContent = `${translateText('Notiz')}: ${summary.remark}`;
            details.appendChild(remarkEl);
        }

        if (details.children.length > 0) {
            itemButton.appendChild(details);
        }

        listEl.appendChild(itemButton);
    });

    updateStirrupFormListSelection();

    const totalCount = entries.length;
    if (resultInfoEl) {
        if (totalCount === 0) {
            resultInfoEl.textContent = translateText('Keine gespeicherten Biegeformen verfügbar');
        } else {
            const resultLabel = translateText('Treffer');
            resultInfoEl.textContent = `${formatNumberForBvbs(visibleCount)} / ${formatNumberForBvbs(totalCount)} ${resultLabel}`;
        }
    }

    const hasFilterControls = stirrupFormFilterState.diameter !== 'all'
        || stirrupFormFilterState.steelGrade !== 'all'
        || stirrupFormFilterState.segmentThreshold !== 'all';

    if (visibleCount === 0) {
        emptyStateEl.hidden = false;
        const noFormsText = translateText('Keine gespeicherten Biegeformen verfügbar');
        const noFilterMatchText = translateText('Keine passenden Biegeformen für die aktuellen Filter.');
        const noSearchMatchText = translateText('Keine passenden Biegeformen gefunden.');
        if (totalCount === 0) {
            emptyStateEl.textContent = noFormsText;
        } else if (hasFilterControls) {
            emptyStateEl.textContent = noFilterMatchText;
        } else if (filterValue) {
            emptyStateEl.textContent = noSearchMatchText;
        } else {
            emptyStateEl.textContent = noFormsText;
        }
    } else {
        emptyStateEl.hidden = true;
        emptyStateEl.textContent = '';
    }

    updateStirrupFormPreview(stirrupFormPickerState?.selectedName || '');
    updateStirrupFormSelectButtonState();
}

function updateStirrupPickerButton(buttonId, inputId) {
    const button = document.getElementById(buttonId);
    const input = document.getElementById(inputId);
    if (!button || !input) {
        return;
    }
    const names = getSavedBf2dFormNames();
    const labelSpan = button.querySelector('.saved-form-button-text');
    const zoneLabel = button.dataset.zoneLabel ? button.dataset.zoneLabel.trim() : '';
    const hasForms = names.length > 0;
    const trimmedValue = input.value.trim();
    const matchesSavedForm = hasForms && trimmedValue && names.includes(trimmedValue);

    button.disabled = !hasForms;

    const baseLabel = hasForms
        ? translateText('Gespeicherte Biegeform wählen')
        : translateText('Keine gespeicherten Biegeformen verfügbar');
    const selectedLabel = matchesSavedForm
        ? translateText('Gespeicherte Biegeform: {name}', { name: trimmedValue })
        : baseLabel;

    if (labelSpan) {
        const defaultText = labelSpan.dataset.defaultText || labelSpan.textContent || baseLabel;
        labelSpan.textContent = matchesSavedForm ? selectedLabel : (baseLabel || defaultText);
    } else {
        button.textContent = matchesSavedForm ? selectedLabel : baseLabel;
    }

    const ariaLabelBase = matchesSavedForm
        ? translateText('Gespeicherte Biegeform auswählen, aktuell: {name}', { name: trimmedValue })
        : baseLabel;

    if (zoneLabel) {
        button.setAttribute('aria-label', `${ariaLabelBase} (${zoneLabel})`);
        button.title = `${baseLabel} (${zoneLabel})`;
    } else {
        button.setAttribute('aria-label', ariaLabelBase);
        button.title = baseLabel;
    }
}

function setupStirrupPicker(buttonId, inputId) {
    const button = document.getElementById(buttonId);
    const input = document.getElementById(inputId);
    if (!button || !input) {
        return;
    }
    button.addEventListener('click', () => {
        const zoneLabel = button.dataset.zoneLabel ? button.dataset.zoneLabel.trim() : '';
        openStirrupFormModal(inputId, buttonId, zoneLabel);
    });
    input.addEventListener('input', () => updateStirrupPickerButton(buttonId, inputId));
    input.addEventListener('change', () => updateStirrupPickerButton(buttonId, inputId));
}

function openStirrupFormModal(inputId, buttonId, zoneLabel = '') {
    const modal = document.getElementById('stirrupFormModal');
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!modal || !input || !button) {
        return;
    }

    const currentValue = typeof input.value === 'string' ? input.value.trim() : '';
    stirrupFormPickerState = { inputId, buttonId, zoneLabel, selectedName: currentValue };

    const titleEl = document.getElementById('stirrupFormModalTitle');
    if (titleEl) {
        const titleBase = titleEl.getAttribute('data-title-base') || 'Gespeicherte Biegeform wählen';
        const translatedBase = translateText(titleBase);
        titleEl.textContent = zoneLabel ? `${translatedBase} (${zoneLabel})` : translatedBase;
    }

    const searchEl = document.getElementById('stirrupFormSearch');
    if (searchEl) {
        searchEl.value = '';
        searchEl.setAttribute('aria-label', translateText('Suchen'));
        setTimeout(() => {
            searchEl.focus();
        }, 0);
    }

    renderStirrupFormModalList();
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
}

function closeStirrupFormModal() {
    const modal = document.getElementById('stirrupFormModal');
    if (!modal) {
        return;
    }
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');

    const buttonId = stirrupFormPickerState?.buttonId;
    stirrupFormPickerState = null;

    if (buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.focus({ preventScroll: true });
        }
    }

    const searchEl = document.getElementById('stirrupFormSearch');
    if (searchEl) {
        searchEl.value = '';
    }

    updateStirrupFormPreview('');
    updateStirrupFormSelectButtonState();
}

function applyStirrupFormSelection(name) {
    if (!stirrupFormPickerState) {
        return;
    }
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
        updateStirrupFormSelectButtonState();
        return;
    }
    stirrupFormPickerState.selectedName = trimmedName;
    const forms = readSavedBf2dForms();
    if (!Object.prototype.hasOwnProperty.call(forms, trimmedName)) {
        updateStirrupFormSelectButtonState();
        return;
    }
    const { inputId, buttonId } = stirrupFormPickerState;
    const input = document.getElementById(inputId);
    if (!input) {
        return;
    }
    input.value = trimmedName;
    closeStirrupFormModal();
    updateStirrupPickerButton(buttonId, inputId);
    if (typeof triggerPreviewUpdateDebounced === 'function') {
        triggerPreviewUpdateDebounced();
    }
    updateGenerateButtonState();
}

function refreshStirrupNameSelects() {
    updateStirrupPickerButton('buegelname1PickerButton', 'buegelname1');
    updateStirrupPickerButton('buegelname2PickerButton', 'buegelname2');
    const searchEl = document.getElementById('stirrupFormSearch');
    if (searchEl) {
        searchEl.setAttribute('aria-label', translateText('Suchen'));
    }
    if (isStirrupFormModalOpen()) {
        renderStirrupFormModalList();
    }
}

window.closeStirrupFormModal = closeStirrupFormModal;

function encodeZonesForBvbs(zonesArr, startOverhang, endOverhang, extra = {}) {
    const padValue = (value, digits) => {
        const safe = Math.max(0, Math.round(Number(value) || 0));
        return safe.toString().padStart(digits, '0');
    };
    const startSegment = padValue(startOverhang, 3);
    const endSegment = padValue(endOverhang, 3);
    const zoneSegments = Array.isArray(zonesArr)
        ? zonesArr.map((zone, index) => {
            const count = Math.max(0, Math.round(Number(getEffectiveZoneNum(zone, index)) || 0));
            const pitch = Math.max(0, Math.round(Number(zone?.pitch) || 0));
            const countDigits = count < 100 ? 2 : 3;
            const countStr = count.toString().padStart(countDigits, '0');
            const pitchStr = pitch.toString().padStart(4, '0');
            return `${countStr}${pitchStr}`;
        }).join('')
        : '';
    const extras = [];
    const sanitizedName = extra.name ? sanitizeBvbsSegment(extra.name) : '';
    const sanitizedRecipe = extra.recipe ? sanitizeBvbsSegment(extra.recipe) : '';
    if (sanitizedName) {
        extras.push(`s${sanitizedName}`);
    }
    if (sanitizedRecipe) {
        extras.push(`r${sanitizedRecipe}`);
    }
    let encoded = `a${startSegment}-${endSegment}${zoneSegments}`;
    if (extras.length > 0) {
        encoded += `|${extras.join('|')}`;
    }
    return encoded;
}

                        // Visual constants for SVG rendering
                        const STIRRUP_HEIGHT_VISUAL = 50;
			const PADDING_VISUAL = 35;
			const DIM_LINE_OFFSET_ABOVE = 30;
			const DIM_LINE_OFFSET_BELOW = 25;
			const INTER_ZONE_DIM_OFFSET = 20;
			const TEXT_ABOVE_LINE_OFFSET = 7;
			const SVG_FONT_FAMILY = "var(--font-family-sans-serif)";
			const SVG_DIM_FONT_SIZE = "14px";
			const SVG_TOTAL_DIM_FONT_SIZE = "15px";
			const SVG_SINGLE_STIRRUP_FONT_SIZE = "13px";
const NUM_ZONE_COLORS_AVAILABLE = 20;
let maxZones = 20; // maximale Anzahl an Zonen, per UI anpassbar
let zonesPerLabel = 16; // Zonenanzahl Zone 1 (aufteilbar)
			
			// Highlight classes
			const HIGHLIGHT_COLOR_CLASS_STROKE = 'highlight-stroke';
			const HIGHLIGHT_COLOR_CLASS_FILL = 'highlight-fill';
			const HIGHLIGHT_BG_FILL_CLASS = 'highlight-bg-fill';
			
			let previewUpdateTimer;
let highlightedZoneDisplayIndex = null;
let dimensioningMode = 'arrangementLength'; // 'arrangementLength' or 'totalZoneSpace'
let showOverhangs = false;
let summaryStatusOverride = null;
let summaryStatusTimer = null;
			
			// Local storage key for templates
const LOCAL_STORAGE_TEMPLATES_KEY = 'bvbsKorbsTemplates';
const LOCAL_STORAGE_LABEL_LAYOUT_KEY = 'labelLayoutConfig';
const LABEL_ELEMENT_IDS = ['descPosnr','labelPosnr','labelKommNr','labelBuegelname','descProjekt','labelProjekt','descAuftrag','labelAuftrag','descLange','labelGesamtlange'];
let labelLayout = {};
let labelDesignMode = false;
			
			// Helper function to show/hide feedback messages
			function showFeedback(elementId, message, type = 'info', duration = 3000) {
			    const element = document.getElementById(elementId);
			    if (!element) return;
			    element.textContent = message;
			    element.className = `info-text ${type}-message`;
			    clearTimeout(element.timer);
			    element.timer = setTimeout(() => {
			        element.textContent = '';
			        element.className = 'info-text';
			    }, duration);
			}
			
			// Helper function for input-specific feedback
                        function showInputFeedback(inputElement, message, type = 'info', duration = 3000) {
			    let feedbackElement = inputElement.nextElementSibling;
			    if (!feedbackElement || !feedbackElement.classList.contains('input-feedback')) {
			        feedbackElement = document.createElement('span');
			        feedbackElement.classList.add('input-feedback');
			        inputElement.parentNode.insertBefore(feedbackElement, inputElement.nextSibling);
			    }
			    feedbackElement.textContent = message;
			    feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    if (message) {
			        feedbackElement.classList.add(`${type}-message`);
			        feedbackElement.style.height = 'auto';
			        feedbackElement.style.opacity = '1';
			    } else {
			        feedbackElement.style.height = '0';
			        feedbackElement.style.opacity = '0';
			        feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    }
			    clearTimeout(inputElement.feedbackTimer);
			    inputElement.feedbackTimer = setTimeout(() => {
			        feedbackElement.textContent = '';
			        feedbackElement.style.height = '0';
			        feedbackElement.style.opacity = '0';
			        feedbackElement.classList.remove('error-message', 'warning-message', 'success-message');
			    }, duration);
			}
			
			// Updates the debug info log
			function updateBarcodeDebugInfo(message) {
			    const debugInfoEl = document.getElementById('barcodeDebugInfo');
			    if (debugInfoEl) {
			        const timestamp = new Date().toLocaleTimeString();
			        debugInfoEl.textContent += `[${timestamp}] ${message}\n`;
			        debugInfoEl.scrollTop = debugInfoEl.scrollHeight; // Scroll to bottom
			    }
			    console.log(`[Barcode Debug] ${message}`);
			}
			
function getBvbsCodes() {
    const code1 = document.getElementById('outputBvbsCode1')?.value.trim();
    const code2 = document.getElementById('outputBvbsCode2')?.value.trim();
    return [code1, code2].filter(code => code && code.startsWith('BF2'));
}

// Saved orders management
function loadSavedOrders() {
    const data = localStorage.getItem(LOCAL_STORAGE_SAVED_ORDERS_KEY);
    if (data) {
        try {
            savedOrders = JSON.parse(data);
        } catch (e) {
            console.error('Could not parse saved orders', e);
            savedOrders = [];
        }
    }
}

function persistSavedOrders() {
    try {
        localStorage.setItem(LOCAL_STORAGE_SAVED_ORDERS_KEY, JSON.stringify(savedOrders));
    } catch (e) {
        console.error('Could not store saved orders', e);
    }
}

function getZonePreviewColor(index, computedStyles) {
    if (!computedStyles && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        computedStyles = window.getComputedStyle(document.documentElement);
    }
    const colorVar = `--svg-zone-color-${index % NUM_ZONE_COLORS_AVAILABLE}`;
    const color = computedStyles ? computedStyles.getPropertyValue(colorVar) : null;
    return color ? color.trim() || '#6c757d' : '#6c757d';
}

function createSavedOrderPreview(order) {
    if (!order) return null;
    const totalLength = parseFloat(order.gesamtlange) || 0;
    const zones = Array.isArray(order.zonesData) ? order.zonesData : [];
    if (totalLength <= 0 || zones.length === 0) {
        return null;
    }

    const width = 160;
    const height = 44;
    const paddingX = 10;
    const paddingY = 6;
    const drawableWidth = width - paddingX * 2;
    const scale = drawableWidth / totalLength;
    if (!Number.isFinite(scale) || scale <= 0) {
        return null;
    }

    const stirrupHeight = height - paddingY * 2;
    const top = (height - stirrupHeight) / 2;
    const bottom = top + stirrupHeight;
    const endX = paddingX + totalLength * scale;

    let computedStyles = null;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        computedStyles = window.getComputedStyle(document.documentElement);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('saved-order-preview-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const backgroundGroup = document.createElementNS(SVG_NS, 'g');
    backgroundGroup.classList.add('saved-order-preview-background');
    svg.appendChild(backgroundGroup);

    const stirrupGroup = document.createElementNS(SVG_NS, 'g');
    stirrupGroup.classList.add('saved-order-preview-stirrups');
    svg.appendChild(stirrupGroup);

    let currentPosition = 0;
    zones.forEach((zone, index) => {
        const pitch = Number(zone.pitch) || 0;
        const numStirrups = Math.max(0, getEffectiveZoneNum(zone, index));
        const zoneLength = numStirrups > 0 && pitch > 0 ? numStirrups * pitch : 0;
        if (zoneLength > 0) {
            const zoneStartX = paddingX + currentPosition * scale;
            const zoneWidth = zoneLength * scale;
            const zoneColor = getZonePreviewColor(index, computedStyles);

            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', zoneStartX.toFixed(2));
            rect.setAttribute('y', top.toFixed(2));
            rect.setAttribute('width', Math.max(zoneWidth, 0.5).toFixed(2));
            rect.setAttribute('height', stirrupHeight.toFixed(2));
            rect.setAttribute('fill', zoneColor);
            rect.setAttribute('fill-opacity', '0.12');
            rect.setAttribute('stroke', zoneColor);
            rect.setAttribute('stroke-width', '0.5');
            backgroundGroup.appendChild(rect);

            for (let j = 1; j <= numStirrups; j++) {
                const stirrupPos = currentPosition + j * pitch;
                const stirrupX = paddingX + stirrupPos * scale;
                if (stirrupX > endX + 0.5) {
                    break;
                }
                const stirrupLine = document.createElementNS(SVG_NS, 'line');
                stirrupLine.setAttribute('x1', stirrupX.toFixed(2));
                stirrupLine.setAttribute('x2', stirrupX.toFixed(2));
                stirrupLine.setAttribute('y1', top.toFixed(2));
                stirrupLine.setAttribute('y2', bottom.toFixed(2));
                stirrupLine.setAttribute('stroke', zoneColor);
                stirrupLine.setAttribute('stroke-width', '1');
                stirrupGroup.appendChild(stirrupLine);
            }
        }
        currentPosition += zoneLength;
    });

    if (currentPosition < totalLength) {
        const emptyStartX = paddingX + currentPosition * scale;
        const emptyWidth = (totalLength - currentPosition) * scale;
        if (emptyWidth > 0.5) {
            const emptyRect = document.createElementNS(SVG_NS, 'rect');
            emptyRect.setAttribute('x', emptyStartX.toFixed(2));
            emptyRect.setAttribute('y', top.toFixed(2));
            emptyRect.setAttribute('width', emptyWidth.toFixed(2));
            emptyRect.setAttribute('height', stirrupHeight.toFixed(2));
            emptyRect.setAttribute('fill', 'var(--light-bg-color, rgba(0,0,0,0.06))');
            emptyRect.setAttribute('fill-opacity', '0.35');
            emptyRect.setAttribute('stroke', 'var(--border-color, #ced4da)');
            emptyRect.setAttribute('stroke-dasharray', '3 3');
            emptyRect.setAttribute('stroke-width', '0.5');
            backgroundGroup.appendChild(emptyRect);
        }
    }

    const baseLine = document.createElementNS(SVG_NS, 'line');
    baseLine.setAttribute('x1', paddingX.toFixed(2));
    baseLine.setAttribute('x2', endX.toFixed(2));
    baseLine.setAttribute('y1', bottom.toFixed(2));
    baseLine.setAttribute('y2', bottom.toFixed(2));
    baseLine.setAttribute('stroke', 'var(--secondary-color, #495057)');
    baseLine.setAttribute('stroke-width', '1.4');
    baseLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(baseLine);

    const topLine = document.createElementNS(SVG_NS, 'line');
    topLine.setAttribute('x1', paddingX.toFixed(2));
    topLine.setAttribute('x2', endX.toFixed(2));
    topLine.setAttribute('y1', top.toFixed(2));
    topLine.setAttribute('y2', top.toFixed(2));
    topLine.setAttribute('stroke', 'var(--border-color, #ced4da)');
    topLine.setAttribute('stroke-width', '0.8');
    topLine.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(topLine);

    const startPost = document.createElementNS(SVG_NS, 'line');
    startPost.setAttribute('x1', paddingX.toFixed(2));
    startPost.setAttribute('x2', paddingX.toFixed(2));
    startPost.setAttribute('y1', top.toFixed(2));
    startPost.setAttribute('y2', bottom.toFixed(2));
    startPost.setAttribute('stroke', 'var(--secondary-color, #495057)');
    startPost.setAttribute('stroke-width', '1.6');
    svg.appendChild(startPost);

    const endPost = document.createElementNS(SVG_NS, 'line');
    endPost.setAttribute('x1', endX.toFixed(2));
    endPost.setAttribute('x2', endX.toFixed(2));
    endPost.setAttribute('y1', top.toFixed(2));
    endPost.setAttribute('y2', bottom.toFixed(2));
    endPost.setAttribute('stroke', 'var(--secondary-color, #495057)');
    endPost.setAttribute('stroke-width', '1.6');
    svg.appendChild(endPost);

    return svg;
}

function renderSavedOrdersList() {
    const list = document.getElementById('savedOrdersList');
    if (!list) return;
    const filterText = document.getElementById('savedOrdersFilterInput')?.value.toLowerCase() || '';
    list.innerHTML = '';
    const ordersToShow = savedOrders.filter(order => {
        if (!filterText) return true;
        return [order.projekt, order.komm, order.auftrag, order.posnr, order.buegelname1, order.buegelname2]
            .some(val => (val || '').toString().toLowerCase().includes(filterText));
    });
    if (ordersToShow.length === 0) {
        const li = document.createElement('li');
        li.textContent = i18n.t('Keine Aufträge gespeichert.');
        list.appendChild(li);
        return;
    }
    ordersToShow.forEach(order => {
        const li = document.createElement('li');
        li.className = 'production-item saved-order-item';

        const mainRow = document.createElement('div');
        mainRow.className = 'saved-order-main';

        const previewContainer = document.createElement('div');
        previewContainer.className = 'saved-order-preview-container';
        const previewSvg = createSavedOrderPreview(order);
        if (previewSvg) {
            previewContainer.appendChild(previewSvg);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'saved-order-preview-placeholder';
            placeholder.textContent = '–';
            previewContainer.appendChild(placeholder);
        }

        const infoContainer = document.createElement('div');
        infoContainer.className = 'saved-order-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'saved-order-name';
        const stirrupNames = [order.buegelname1, order.buegelname2]
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean);
        const nameText = stirrupNames.join(' / ') ||
            order.projekt ||
            order.posnr ||
            order.komm ||
            order.auftrag ||
            '-';
        nameEl.textContent = nameText;
        if (nameText && nameText !== '-') {
            nameEl.title = nameText;
        }
        infoContainer.appendChild(nameEl);

        const details = document.createElement('div');
        details.className = 'saved-order-details';
        const detailFields = [
            { label: i18n.t('Projekt'), value: order.projekt },
            { label: 'Komm', value: order.komm },
            { label: i18n.t('Auftrag'), value: order.auftrag },
            { label: 'Pos-Nr', value: order.posnr }
        ];
        detailFields.forEach(field => {
            const detailItem = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = `${field.label}:`;
            detailItem.appendChild(strong);
            detailItem.appendChild(document.createTextNode(' '));
            detailItem.appendChild(document.createTextNode(field.value || '-'));
            details.appendChild(detailItem);
        });
        infoContainer.appendChild(details);

        mainRow.appendChild(previewContainer);
        mainRow.appendChild(infoContainer);
        li.appendChild(mainRow);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'button-group saved-order-actions';
        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn-secondary';
        loadBtn.textContent = i18n.t('Laden');
        loadBtn.addEventListener('click', () => {
            loadOrderIntoForm(order.id);
            closeSavedOrdersModal();
        });
        btnGroup.appendChild(loadBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-secondary';
        delBtn.textContent = i18n.t('Löschen');
        delBtn.addEventListener('click', () => deleteSavedOrder(order.id));
        btnGroup.appendChild(delBtn);
        li.appendChild(btnGroup);

        list.appendChild(li);
    });
}

function saveCurrentOrder() {
    const now = new Date().toISOString();
    const orderId = currentSavedOrderId || Date.now();
    const existingOrder = savedOrders.find(o => o.id === orderId);

    const order = {
        id: orderId,
        projekt: document.getElementById('projekt')?.value || '',
        komm: document.getElementById('KommNr')?.value || '',
        auftrag: document.getElementById('auftrag')?.value || '',
        posnr: document.getElementById('posnr')?.value || '',
        buegelname1: document.getElementById('buegelname1')?.value || '',
        buegelname2: document.getElementById('buegelname2')?.value || '',
        steelGrade: document.getElementById('stahlgute')?.value || '',
        gesamtlange: document.getElementById('gesamtlange')?.value || '',
        anzahl: document.getElementById('anzahl')?.value || '',
        langdrahtDurchmesser: document.getElementById('langdrahtDurchmesser')?.value || '',
        anfangsueberstand: document.getElementById('anfangsueberstand')?.value || '',
        endueberstand: document.getElementById('endueberstand')?.value || '',
        rezeptname: document.getElementById('rezeptname')?.value || '',
        maxZones: maxZones,
        zonesPerLabel: zonesPerLabel,
        zonesData: JSON.parse(JSON.stringify(zonesData)),
        status: 'Draft',
        createdAt: existingOrder?.createdAt || now,
        lastModified: now
    };
    const idx = savedOrders.findIndex(o => o.id === order.id);
    if (idx >= 0) {
        savedOrders[idx] = order;
    } else {
        savedOrders.push(order);
    }
    currentSavedOrderId = order.id;
    persistSavedOrders();
    renderSavedOrdersList();
    showFeedback('templateFeedback', i18n.t('Auftrag gespeichert.'), 'success', 2000);
}

function loadOrderIntoForm(id) {
    const order = savedOrders.find(o => o.id === id);
    if (!order) return;
    document.getElementById('projekt').value = order.projekt;
    document.getElementById('KommNr').value = order.komm;
    document.getElementById('auftrag').value = order.auftrag;
    document.getElementById('posnr').value = order.posnr;
    const buegelname1Input = document.getElementById('buegelname1');
    if (buegelname1Input) buegelname1Input.value = order.buegelname1 || '';
    const buegelname2Input = document.getElementById('buegelname2');
    if (buegelname2Input) buegelname2Input.value = order.buegelname2 || '';
    refreshStirrupNameSelects();
    const steelGradeInput = document.getElementById('stahlgute');
    const steelGradeValue = order.steelGrade || 'B500B';
    if (steelGradeValue && window.masterDataManager?.addValue) {
        window.masterDataManager.addValue('steelGrades', steelGradeValue);
    }
    if (steelGradeInput) {
        steelGradeInput.value = steelGradeValue;
        if (steelGradeInput.value !== steelGradeValue) {
            steelGradeInput.dataset.masterdataPendingValue = steelGradeValue;
            if (typeof window.masterDataManager?.refreshSelects === 'function') {
                window.masterDataManager.refreshSelects();
            }
        }
    }
    document.getElementById('gesamtlange').value = order.gesamtlange;
    document.getElementById('anzahl').value = order.anzahl;
    document.getElementById('langdrahtDurchmesser').value = order.langdrahtDurchmesser;
    document.getElementById('anfangsueberstand').value = order.anfangsueberstand;
    document.getElementById('endueberstand').value = order.endueberstand;
    const rezeptInput = document.getElementById('rezeptname');
    if (rezeptInput) rezeptInput.value = order.rezeptname || '';
    document.getElementById('maxZonesInput').value = order.maxZones || maxZones;
    updateMaxZones(document.getElementById('maxZonesInput').value);
    document.getElementById('zonesPerLabelInput').value = order.zonesPerLabel || zonesPerLabel;
    updateZonesPerLabel(document.getElementById('zonesPerLabelInput').value);
    zonesData = JSON.parse(JSON.stringify(order.zonesData || []));
    renderAllZones();
    updateAddZoneButtonState();
    triggerPreviewUpdateDebounced();
    currentSavedOrderId = id;
}

function deleteSavedOrder(id) {
    savedOrders = savedOrders.filter(o => o.id !== id);
    if (currentSavedOrderId === id) currentSavedOrderId = null;
    persistSavedOrders();
    renderSavedOrdersList();
}

function openSavedOrdersModal() {
    const filterEl = document.getElementById('savedOrdersFilterInput');
    if (filterEl) {
        filterEl.value = '';
    }
    renderSavedOrdersList();
    document.getElementById('savedOrdersModal')?.classList.add('visible');
    filterEl?.focus();
}

function closeSavedOrdersModal() {
    document.getElementById('savedOrdersModal')?.classList.remove('visible');
}

function deleteCurrentSavedOrder() {
    if (currentSavedOrderId) {
        deleteSavedOrder(currentSavedOrderId);
        currentSavedOrderId = null;
    }
}
window.deleteCurrentSavedOrder = deleteCurrentSavedOrder;

                        // Updates the barcode status text
                        function updateBarcodeStatus() {
                            const statusEl = document.getElementById('barcodeStatus');
                            const barcodeContainer = document.getElementById('barcodeSvgContainer');
                            const bvbsCodes = getBvbsCodes();
                            if (!statusEl) return;
                            if (barcodeContainer && barcodeContainer.querySelector('svg') && !barcodeContainer.classList.contains('hidden')) {
                                statusEl.textContent = 'Barcode generiert';
                                statusEl.style.color = 'var(--success-color)';
                            } else if (bvbsCodes.length > 0) {
                                statusEl.textContent = 'Code generiert, Barcode fehlt';
                                statusEl.style.color = 'var(--warning-color)';
                            } else {
                                statusEl.textContent = 'Bereit zur Generierung';
                                statusEl.style.color = 'var(--text-muted-color)';
                            }
                        }
			
			// Checks if the barcode library is loaded
function checkBarcodeLibraryStatus() {
                            if (typeof bwipjs === 'undefined') {
                                console.warn("bwip-js library not available");
                                updateBarcodeDebugInfo("bwip-js Bibliothek nicht verfügbar");
                                return false;
                            }
                            console.log("bwip-js library loaded successfully");
                            updateBarcodeDebugInfo("bwip-js Bibliothek erfolgreich geladen");
                            return true;
}

function updateGenerateButtonState() {
    const generateBtn = document.getElementById('generateButton');
    const buegelname2El = document.getElementById('buegelname2');
    const errorEl = document.getElementById('generateError');
    if (!generateBtn || !buegelname2El) return;
    const needSecond = zonesData.length > zonesPerLabel;
    const hasName = buegelname2El.value.trim().length > 0;
    if (needSecond && !hasName) {
        generateBtn.disabled = true;
        if (errorEl) {
            errorEl.textContent = 'Fehler: Bügelname (s) - Zone 2 ist erforderlich.';
            errorEl.className = 'info-text error-message';
        }
    } else {
        generateBtn.disabled = false;
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.className = 'info-text';
        }
    }
}

function loadLabelLayout() {
                            const data = localStorage.getItem(LOCAL_STORAGE_LABEL_LAYOUT_KEY);
                            if (data) {
                                try { labelLayout = JSON.parse(data); } catch(e) { labelLayout = {}; }
                            }
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                if (el && !labelLayout[id]) {
                                    const fs = parseFloat(window.getComputedStyle(el).fontSize) || 12;
                                    labelLayout[id] = { dx: 0, dy: 0, fontSize: fs };
                                }
                            });
                        }

                        function saveLabelLayout() {
                            localStorage.setItem(LOCAL_STORAGE_LABEL_LAYOUT_KEY, JSON.stringify(labelLayout));
                        }

                        function applyLabelLayout() {
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                const layout = labelLayout[id];
                                if (el && layout) {
                                    el.style.transform = `translate(${layout.dx}px, ${layout.dy}px)`;
                                    el.style.fontSize = layout.fontSize + 'pt';
                                }
                                const el2 = document.getElementById(id + '2');
                                if (el2 && layout) {
                                    el2.style.transform = `translate(${layout.dx}px, ${layout.dy}px)`;
                                    el2.style.fontSize = layout.fontSize + 'pt';
                                }
                            });
                        }

                        function makeElementDraggable(el) {
                            let startX, startY, origX, origY;
                            const id = el.id.replace('2','');
                            el.addEventListener('mousedown', (e) => {
                                if (!labelDesignMode) return;
                                startX = e.clientX; startY = e.clientY;
                                const layout = labelLayout[id] || { dx:0, dy:0, fontSize: parseFloat(getComputedStyle(el).fontSize) || 12 };
                                origX = layout.dx; origY = layout.dy;
                                const onMove = (ev) => {
                                    const dx = ev.clientX - startX;
                                    const dy = ev.clientY - startY;
                                    const newX = origX + dx;
                                    const newY = origY + dy;
                                    el.style.transform = `translate(${newX}px, ${newY}px)`;
                                    if (labelLayout[id]) { labelLayout[id].dx = newX; labelLayout[id].dy = newY; }
                                    const el2 = document.getElementById(id + '2');
                                    if (el2) el2.style.transform = `translate(${newX}px, ${newY}px)`;
                                };
                                const onUp = () => {
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                    saveLabelLayout();
                                };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                                e.preventDefault();
                            });
                            el.addEventListener('dblclick', () => {
                                if (!labelDesignMode) return;
                                const current = labelLayout[id]?.fontSize || parseFloat(getComputedStyle(el).fontSize) || 12;
                                const input = prompt('Schriftgröße (pt)', current);
                                if (input) {
                                    const fs = parseFloat(input);
                                    if (!isNaN(fs)) {
                                        labelLayout[id].fontSize = fs;
                                        el.style.fontSize = fs + 'pt';
                                        const el2 = document.getElementById(id + '2');
                                        if (el2) el2.style.fontSize = fs + 'pt';
                                        saveLabelLayout();
                                    }
                                }
                            });
                        }

                        function toggleLabelDesignMode() {
                            labelDesignMode = !labelDesignMode;
                            const labels = [document.getElementById('printableLabel'), document.getElementById('printableLabel2')];
                            labels.forEach(l => { if (l) l.classList.toggle('label-edit-mode', labelDesignMode); });
                            LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                const el2 = document.getElementById(id + '2');
                                [el, el2].forEach(item => { if (item) item.classList.toggle('label-edit-item', labelDesignMode); });
                            });
                            if (!labelDesignMode) saveLabelLayout();
                        }
			
			// Load templates from localStorage or default file
			async function loadTemplatesFromFile() {
			    try {
			        const storedTemplates = localStorage.getItem(LOCAL_STORAGE_TEMPLATES_KEY);
			        if (storedTemplates) {
			            templates = JSON.parse(storedTemplates);
			            populateTemplateDropdown();
			            console.log("Templates aus localStorage geladen.");
			            renderAllZones();
			            return;
			        }
			        const response = await fetch('lagen.json');
			        if (!response.ok) {
			            if (response.status === 404) {
			                console.warn("lagen.json nicht gefunden oder leer, starte mit leeren Templates.");
                                        templates = [];
                                        populateTemplateDropdown();
                                        renderAllZones();
                                        return;
			            }
			            throw new Error(`HTTP error! status: ${response.status}`);
			        }
			        const data = await response.json();
			        templates = data;
			        populateTemplateDropdown();
			        console.log("Templates aus lagen.json geladen.");
			        saveTemplatesToLocalStorage();
			        renderAllZones();
			    } catch (e) {
			        console.error("Konnte Templates nicht laden:", e);
			        showFeedback('templateFeedback', "Fehler: Templates konnten nicht geladen werden.", 'error', 5000);
                                templates = [];
                                populateTemplateDropdown();
                                renderAllZones();
                            }
                        }
			
			// Save templates to localStorage
			function saveTemplatesToLocalStorage() {
			    try {
			        localStorage.setItem(LOCAL_STORAGE_TEMPLATES_KEY, JSON.stringify(templates));
			        console.log("Templates im localStorage gespeichert.");
			    } catch (e) {
			        console.error("Fehler beim Speichern der Templates in localStorage:", e);
			        showFeedback('templateFeedback', "Fehler: Templates konnten nicht lokal gespeichert werden.", 'error', 5000);
			    }
			}
			
			// Populate the template dropdown menu
			function populateTemplateDropdown() {
			    const dropdown = document.getElementById('templateSelect');
			    if (!dropdown) return;
			    dropdown.innerHTML = '<option value="">Template auswählen…</option>';
			    templates.forEach(template => {
			        const option = document.createElement('option');
			        option.value = template.name;
			        option.textContent = template.name;
			        dropdown.appendChild(option);
			    });
			}
			
			// Apply a selected template
			function applyTemplate(templateName) {
			    if (!templateName) {
			        zonesData = [];
			        nextZoneId = 0;
			        renderAllZones();
			        showFeedback('templateFeedback', `Aktuelle Zonen geleert.`, 'info');
			        return;
			    }
			    const template = templates.find(t => t.name === templateName);
			    if (template && template.zones) {
			        zonesData = JSON.parse(JSON.stringify(template.zones)); // Deep copy to prevent reference issues
			        nextZoneId = zonesData.length > 0 ? Math.max(...zonesData.map(z => z.id)) + 1 : 0;
			        renderAllZones();
			        showFeedback('templateFeedback', `Template "${templateName}" geladen.`, 'success');
			    } else {
			        showFeedback('templateFeedback', `Template "${templateName}" nicht gefunden.`, 'error');
			    }
			}
			
			// Save the current zones as a new template
			function saveCurrentTemplate() {
			    const templateNameInput = document.getElementById('templateName');
			    const feedbackEl = document.getElementById('templateFeedback');
			    const templateName = templateNameInput.value.trim();
			    feedbackEl.textContent = '';
			    if (!templateName) {
			        showFeedback('templateFeedback', "Bitte einen Template-Namen eingeben.", 'warning');
			        return;
			    }
			    if (zonesData.length === 0) {
			        showFeedback('templateFeedback', "Es sind keine Zonen zum Speichern vorhanden.", 'warning');
			        return;
			    }
			    const existingIndex = templates.findIndex(t => t.name === templateName);
			    const newTemplate = {
			        name: templateName,
			        zones: JSON.parse(JSON.stringify(zonesData))
			    };
			    if (existingIndex > -1) {
			        templates[existingIndex] = newTemplate;
			        showFeedback('templateFeedback', `Template "${templateName}" aktualisiert.`, 'success');
			    } else {
			        templates.push(newTemplate);
			        showFeedback('templateFeedback', `Template "${templateName}" gespeichert.`, 'success');
			    }
			    populateTemplateDropdown();
			    document.getElementById('templateSelect').value = templateName;
			    templateNameInput.value = '';
			    saveTemplatesToLocalStorage();
			}
			
			// Delete a template by its name
			function deleteTemplateById(templateName) {
			    if (confirm(`Soll das Template "${templateName}" wirklich gelöscht werden?`)) {
			        templates = templates.filter(t => t.name !== templateName);
			        saveTemplatesToLocalStorage();
			        populateTemplateDropdown();
			        renderTemplateListInModal();
			        if (document.getElementById('templateSelect').value === templateName) {
			            document.getElementById('templateSelect').value = "";
			            applyTemplate("");
			        }
			        showFeedback('templateFeedback', `Template "${templateName}" gelöscht.`, 'success');
			    }
			}
			
			// Delete all templates from modal
			function deleteAllTemplatesFromModal() {
			    if (confirm("Sind Sie sicher, dass Sie ALLE gespeicherten Templates löschen möchten? Dies kann nicht rückgängig gemacht werden!")) {
			        templates = [];
			        saveTemplatesToLocalStorage();
			        populateTemplateDropdown();
			        document.getElementById('templateSelect').value = "";
			        applyTemplate("");
			        renderTemplateListInModal();
			        showFeedback('templateFeedback', "Alle Templates gelöscht.", 'success');
			    }
			}
			
                        // Download templates as a JSON file
                        function downloadTemplatesAsJson() {
                            const json = JSON.stringify(templates, null, 2);
                            const blob = new Blob([json], {
                                type: 'application/json'
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'lagen.json';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            showFeedback('templateFeedback', i18n.t('lagen.json heruntergeladen! Bitte manuell in den Projektordner verschieben.'), 'info', 5000);
                          }

                          // Download a label as PNG using html2canvas
                          function downloadLabelAsPng(labelId) {
                              const label = document.getElementById(labelId);
                              if (!label) return;
                              html2canvas(label).then(canvas => {
                                  const link = document.createElement('a');
                                  link.href = canvas.toDataURL('image/png');
                                  link.download = labelId + '.png';
                                  link.click();
                              });
                          }

                          // Trigger the hidden file input for importing templates
                          function uploadTemplatesFromJson() {
                            const input = document.getElementById('templateFileInput');
                            if (input) {
                                input.value = '';
                                input.click();
                            }
                        }

                        // Handle uploaded template JSON
                        function handleTemplateFileImport(event) {
                            const file = event.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                try {
                                    const data = JSON.parse(e.target.result);
                                    if (Array.isArray(data)) {
                                        templates = data;
                                        saveTemplatesToLocalStorage();
                                        populateTemplateDropdown();
                                        renderTemplateListInModal();
                                        showFeedback('templateFeedback', i18n.t('Templates importiert.'), 'success');
                                    } else {
                                        throw new Error('Invalid format');
                                    }
                                } catch (err) {
                                    console.error(i18n.t('Fehler beim Import der Templates:'), err);
                                    showFeedback('templateFeedback', i18n.t('Fehler: Ungültige Template-Datei.'), 'error', 5000);
                                }
                            };
                            reader.readAsText(file);
                        }
			
			// Open the template management modal
			function openTemplateManagerModal() {
			    const modal = document.getElementById('templateManagerModal');
			    modal.classList.add('visible');
			    renderTemplateListInModal();
			}
			
			// Close the template management modal
                        function closeTemplateManagerModal() {
                            const modal = document.getElementById('templateManagerModal');
                            modal.classList.remove('visible');
                        }

                        function openZplModal() {
                            const modal = document.getElementById('zplModal');
                            const content = document.getElementById('zplCodeContent');
                            if (modal && content) {
                                const zpl1 = generateZplForLabel('');
                                const secondLabelVisible = zonesData.length > zonesPerLabel;
                                const zpl2 = secondLabelVisible ? '\n\n' + generateZplForLabel('2') : '';
                                content.textContent = zpl1 + zpl2;
                                modal.classList.add('visible');
                            }
                        }

function closeZplModal() {
    const modal = document.getElementById('zplModal');
    if (modal) modal.classList.remove('visible');
}

function renderQrCodeToCanvas(canvas, text) {
    if (!canvas) {
        throw new Error('canvas missing');
    }
    if (typeof qrcode === 'undefined') {
        throw new Error('QR library unavailable');
    }
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const cellSize = Math.max(2, Math.floor(260 / moduleCount));
    const margin = 4;
    const size = moduleCount * cellSize + margin * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('No canvas context');
    }
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
                ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
            }
        }
    }
}

function setQrModalTitle(labelSuffix = '') {
    const titleEl = document.getElementById('qrModalTitle');
    if (!titleEl) return;
    const baseKey = titleEl.getAttribute('data-i18n') || titleEl.getAttribute('data-title-base') || 'BVBS QR-Code';
    const baseText = (window.i18n?.t?.(baseKey) || baseKey).trim();
    titleEl.textContent = labelSuffix ? `${baseText} ${labelSuffix}` : baseText;
}

function openQrModalWithCode(code, labelSuffix = '') {
    const modal = document.getElementById('qrModal');
    const canvas = document.getElementById('qrCodeCanvas');
    const valueEl = document.getElementById('qrCodeValue');
    const errorEl = document.getElementById('qrCodeError');
    if (!modal || !canvas || !valueEl) {
        console.warn('QR modal elements missing');
        return;
    }
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
    try {
        renderQrCodeToCanvas(canvas, code);
    } catch (err) {
        console.error('Unable to generate QR code', err);
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = window.i18n?.t?.('QR-Code konnte nicht erzeugt werden.') || 'QR-Code konnte nicht erzeugt werden.';
        }
    }
    valueEl.textContent = code;
    setQrModalTitle(labelSuffix);
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    if (!modal) return;
    const canvas = document.getElementById('qrCodeCanvas');
    const valueEl = document.getElementById('qrCodeValue');
    const errorEl = document.getElementById('qrCodeError');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    if (valueEl) {
        valueEl.textContent = '';
    }
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
    setQrModalTitle('');
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
}
window.closeQrModal = closeQrModal;

// Generate a compact summary of zones for the template manager
function generateZoneSummary(zones) {
    if (!zones || zones.length === 0) {
        return "Keine Zonen definiert.";
    }
                            const summary = zones.map((zone, idx) => {
                                const effectiveNum = getEffectiveZoneNum(zone, idx);
                                if (effectiveNum === 1) {
                                    return `Ø${zone.dia}(1x)`;
                                } else if (effectiveNum > 1) {
                                    return `Ø${zone.dia}(${effectiveNum}x${zone.pitch})`;
                                } else {
                                    return `Ø${zone.dia}(0x)`;
                                }
                            });
			    return `${zones.length} Zone(n): ${summary.join(', ')}`;
			}
			
			// Render the list of templates in the modal
			function renderTemplateListInModal() {
			    const tbody = document.querySelector('#templateListTable tbody');
			    tbody.innerHTML = '';
			    if (templates.length === 0) {
			        const row = tbody.insertRow();
			        const cell = row.insertCell();
			        cell.colSpan = 3;
			        cell.textContent = "Keine Templates gespeichert.";
			        cell.style.textAlign = "center";
			        cell.style.fontStyle = "italic";
			        cell.style.padding = "1rem";
			        return;
			    }
			    templates.forEach(template => {
			        const row = tbody.insertRow();
			        row.dataset.templateName = template.name;
			        const nameCell = row.insertCell();
			        nameCell.classList.add('template-name-cell');
			        nameCell.textContent = template.name;
			        nameCell.setAttribute('data-label', 'Name');
			        nameCell.ondblclick = () => makeTemplateNameEditable(nameCell, template);
			        const zonesCell = row.insertCell();
			        zonesCell.textContent = generateZoneSummary(template.zones);
			        zonesCell.setAttribute('data-label', 'Zonenübersicht');
			        const actionsCell = row.insertCell();
			        actionsCell.style.textAlign = "center";
			        actionsCell.setAttribute('data-label', 'Aktionen');
			        actionsCell.innerHTML = `
			            <button type="button" class="btn-secondary btn-delete-template" title="Template löschen" onclick="deleteTemplateById('${template.name.replace(/'/g, "\\'")}')">
			                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12l1.41 1.41L13.41 14l2.12 2.12l-1.41 1.41L12 15.41l-2.12 2.12l-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
			            </button>
			        `;
			    });
			}
			
			// Make a template name editable on double-click
			function makeTemplateNameEditable(cell, template) {
			    if (cell.querySelector('input')) return;
			    const originalName = template.name;
			    const input = document.createElement('input');
			    input.type = 'text';
			    input.value = originalName;
			    input.classList.add('form-control');
			    cell.textContent = '';
			    cell.appendChild(input);
			    input.focus();
			
			    const saveChange = () => {
			        const newName = input.value.trim();
			        if (newName === originalName) {
			            cell.textContent = originalName;
			            return;
			        }
			        if (newName === "") {
			            showFeedback('templateFeedback', "Template-Name darf nicht leer sein.", 'error');
			            cell.textContent = originalName;
			            return;
			        }
			        if (templates.some(t => t.name === newName && t.name !== originalName)) {
			            showFeedback('templateFeedback', `Template "${newName}" existiert bereits.`, 'error');
			            cell.textContent = originalName;
			            return;
			        }
			
			        const index = templates.findIndex(t => t.name === originalName);
			        if (index !== -1) {
			            templates[index].name = newName;
			            saveTemplatesToLocalStorage();
			            populateTemplateDropdown();
			            renderTemplateListInModal();
			            showFeedback('templateFeedback', `Template umbenannt zu "${newName}".`, 'success');
			        }
			    };
			
			    input.addEventListener('blur', saveChange);
			    input.addEventListener('keypress', (e) => {
			        if (e.key === 'Enter') {
			            input.blur();
			        }
			    });
			}
			
			// Validate a number input field
			function validateNumberInput(inputElement, min = 0, type = 'float', infoText = '') {
			    const value = type === 'int' ? parseInt(inputElement.value, 10) : parseFloat(inputElement.value);
			    const labelText = inputElement.previousElementSibling ? inputElement.previousElementSibling.textContent.replace(':', '').trim() : inputElement.id;
			
			    if (isNaN(value)) {
			        showInputFeedback(inputElement, `${labelText} muss eine Zahl sein.`, 'error');
			        inputElement.classList.add('input-error');
			        return false;
			    }
			    if (value < min) {
			        showInputFeedback(inputElement, `${labelText} muss mindestens ${min} sein.`, 'error');
			        inputElement.classList.add('input-error');
			        return false;
			    }
			
			    if (infoText) {
			        showInputFeedback(inputElement, infoText, 'info', 2000);
			    } else {
			        showInputFeedback(inputElement, '');
			    }
			    inputElement.classList.remove('input-error');
			    return true;
			}
			
			// Toggle the dimensioning mode for the SVG preview
                        function toggleDimensioningMode(mode) {
                            dimensioningMode = mode;
                            drawCagePreview();
                        }

                        // Toggle visibility of overhangs in the SVG preview
                        function toggleOverhangVisibility(show) {
                            showOverhangs = show;
                            drawCagePreview();
                        }

                        function updateGeneratorSummary() {
                            const locale = document.documentElement?.lang || 'de';
                            let numberFormatter = null;
                            try {
                                numberFormatter = new Intl.NumberFormat(locale);
                            } catch (error) {
                                numberFormatter = null;
                            }
                            const formatNumber = (value) => {
                                if (!Number.isFinite(value)) {
                                    return '0';
                                }
                                if (numberFormatter) {
                                    return numberFormatter.format(value);
                                }
                                return value.toString();
                            };

                            const totalLengthInput = document.getElementById('gesamtlange');
                            const totalLength = parseFloat(totalLengthInput?.value) || 0;
                            const totalLengthEl = document.getElementById('summaryTotalLength');
                            if (totalLengthEl) {
                                const roundedLength = Math.max(0, Math.round(totalLength));
                                totalLengthEl.textContent = roundedLength > 0 ? `${formatNumber(roundedLength)} mm` : '0 mm';
                            }

                            const zoneCount = zonesData.length;
                            const zoneCountEl = document.getElementById('summaryZoneCount');
                            if (zoneCountEl) {
                                zoneCountEl.textContent = formatNumber(zoneCount);
                            }

                            const stirrupCount = zonesData.reduce((sum, zone, index) => sum + getEffectiveZoneNum(zone, index), 0);
                            const stirrupCountEl = document.getElementById('summaryStirrupCount');
                            if (stirrupCountEl) {
                                stirrupCountEl.textContent = formatNumber(stirrupCount);
                            }

                            const statusEl = document.getElementById('summaryStatus');
                            if (statusEl) {
                                statusEl.classList.remove('summary-status--ready', 'summary-status--warning', 'summary-status--highlight');
                                let statusText;
                                if (summaryStatusOverride) {
                                    const overrideKey = summaryStatusOverride.key || summaryStatusOverride.fallback;
                                    const overrideFallback = summaryStatusOverride.fallback || overrideKey;
                                    statusText = (window.i18n?.t?.(overrideKey) || overrideFallback);
                                    statusEl.classList.add('summary-status--highlight');
                                } else if (zoneCount === 0) {
                                    statusText = window.i18n?.t?.('Füge Zonen hinzu, um zu starten.') || 'Füge Zonen hinzu, um zu starten.';
                                    statusEl.classList.add('summary-status--warning');
                                } else {
                                    statusText = window.i18n?.t?.('Bereit zur Generierung') || 'Bereit zur Generierung';
                                    statusEl.classList.add('summary-status--ready');
                                }
                                statusEl.textContent = statusText;
                            }
                        }

                        function setSummaryStatusOverride(key, fallback = key, duration = 4000) {
                            if (!key) {
                                summaryStatusOverride = null;
                            } else {
                                summaryStatusOverride = { key, fallback };
                            }
                            updateGeneratorSummary();
                            if (summaryStatusTimer) {
                                clearTimeout(summaryStatusTimer);
                                summaryStatusTimer = null;
                            }
                            if (summaryStatusOverride && duration > 0) {
                                summaryStatusTimer = setTimeout(() => {
                                    summaryStatusOverride = null;
                                    updateGeneratorSummary();
                                }, duration);
                            }
                        }
			
			// Initialize collapsible sections
			function initCollapsibleHeaders() {
			document.querySelectorAll('.collapsible-header').forEach(header => {
			const content = header.nextElementSibling;
			// entferne das automatische Einklappen:
			// content.classList.remove('collapsed');
			// header.classList.remove('collapsed');
			header.addEventListener('click', () => {
			content.classList.toggle('collapsed');
			header.classList.toggle('collapsed');
			});
			});
			}
			
			
			// Set the currently highlighted zone
                        function setHighlightedZone(displayIndex, isHighlighted) {
                            const activeElement = document.activeElement;
                            let activeIndex = null;
                            if (activeElement) {
                                const activeRow = activeElement.closest('#zonesTable tbody tr');
                                if (activeRow && activeRow.parentElement) {
                                    const rows = Array.from(activeRow.parentElement.children);
                                    const index = rows.indexOf(activeRow);
                                    if (index >= 0) {
                                        activeIndex = index + 1;
                                    }
                                }
                            }

                            if (!isHighlighted && activeIndex !== null) {
                                if (displayIndex === null || displayIndex === undefined || activeIndex !== Number(displayIndex)) {
                                    displayIndex = activeIndex;
                                    isHighlighted = true;
                                } else if (highlightedZoneDisplayIndex !== null && activeIndex === highlightedZoneDisplayIndex) {
                                    return;
                                }
                            }

                            const allRows = document.querySelectorAll('.focused-zone-form');
                            allRows.forEach(row => row.classList.remove('focused-zone-form'));

                            const numericDisplayIndex = Number(displayIndex);
                            highlightedZoneDisplayIndex = isHighlighted && Number.isFinite(numericDisplayIndex) ? numericDisplayIndex : null;
                            if (isHighlighted && highlightedZoneDisplayIndex !== null) {
                                const tableRow = document.querySelector(`#zonesTable tbody tr:nth-child(${highlightedZoneDisplayIndex})`);
                                if (tableRow) {
                                    tableRow.classList.add('focused-zone-form');
                                }
                                const summaryCells = document.querySelectorAll('#zoneSummaryTable tbody tr');
                                summaryCells.forEach(row => {
                                    const cells = row.querySelectorAll('td');
                                    if (cells[highlightedZoneDisplayIndex]) {
                                        cells[highlightedZoneDisplayIndex].classList.add('focused-zone-form');
                                    }
                                });
                            }
                            triggerPreviewUpdateDebounced();
                        }

                        function focusZoneFromPreview(displayIndex) {
                            const numericIndex = Number(displayIndex);
                            if (!Number.isFinite(numericIndex) || numericIndex < 1) {
                                return;
                            }

                            const tableRow = document.querySelector(`#zonesTable tbody tr:nth-child(${numericIndex})`);
                            if (!tableRow) {
                                return;
                            }

                            setHighlightedZone(numericIndex, true);

                            if (typeof tableRow.scrollIntoView === 'function') {
                                tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }

                            const focusable = tableRow.querySelector('input, select, textarea');
                            if (focusable) {
                                focusable.focus({ preventScroll: true });
                                if (typeof focusable.select === 'function') {
                                    focusable.select();
                                }
                            }
                        }

                        window.focusZoneFromPreview = focusZoneFromPreview;
			
			// Render all zone input fields and buttons AND the summary table
                        function renderAllZones() {
                            const tbody = document.querySelector('#zonesTable tbody');
                            if (!tbody) return;
                            tbody.innerHTML = '';
                            updateGeneratorSummary();
                            if (zonesData.length === 0) {
                                const emptyRow = tbody.insertRow();
                                const cell = emptyRow.insertCell();
                                cell.colSpan = 5;
			        cell.textContent = "Noch keine Zonen definiert. Fügen Sie eine hinzu!";
			        cell.style.textAlign = "center";
			        cell.style.fontStyle = "italic";
			        cell.style.padding = "1rem";
			        tbody.appendChild(emptyRow);
			        renderZoneSummaryTable(); // Now calling the correct function
			        triggerPreviewUpdateDebounced();
			        return;
			    }
			
			    zonesData.forEach((zone, index) => {
			        const displayIndex = index + 1;
                                const row = tbody.insertRow();
                                row.dataset.zoneId = zone.id;
                                row.classList.add('zone-item');
                                if (index < zonesPerLabel) {
                                    row.classList.add('first-label-zone');
                                }
                                if (highlightedZoneDisplayIndex === displayIndex) {
                                    row.classList.add('focused-zone-form');
                                }
			
			        const zoneCell = row.insertCell();
			        zoneCell.textContent = displayIndex;
			        zoneCell.setAttribute('data-label', 'Zone');
			        zoneCell.style.fontWeight = 'bold';
			        zoneCell.style.textAlign = 'center';
			
			        // Add mouse events for highlighting on hover
			        row.addEventListener('mouseover', () => setHighlightedZone(displayIndex, true));
			        row.addEventListener('mouseout', () => setHighlightedZone(displayIndex, false));
			
			        const diaCell = row.insertCell();
			        diaCell.setAttribute('data-label', 'Ø (d)');
			        diaCell.innerHTML = `
			            <div class="form-group">
			                <label for="durchmesser-${zone.id}">Ø (d):</label>
			                <select id="durchmesser-${zone.id}" oninput="updateZoneData(${zone.id}, 'dia', this.value); validateNumberInput(this, 6, 'int', 'Mind. 6mm');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
			                    <option value="6" ${zone.dia == 6 ? 'selected' : ''}>6 mm</option>
			                    <option value="8" ${zone.dia == 8 ? 'selected' : ''}>8 mm</option>
			                    <option value="10" ${zone.dia == 10 ? 'selected' : ''}>10 mm</option>
			                    <option value="12" ${zone.dia == 12 ? 'selected' : ''}>12 mm</option>
			                    <option value="14" ${zone.dia == 14 ? 'selected' : ''}>14 mm</option>
			                    <option value="16" ${zone.dia == 16 ? 'selected' : ''}>16 mm</option>
			                </select>
			                <span class="input-feedback"></span>
			            </div>
			        `;
			
			        const numCell = row.insertCell();
			        numCell.setAttribute('data-label', 'Anzahl (n)');
			        numCell.innerHTML = `
			            <div class="form-group">
			                <label for="anzahlBUEGEL-${zone.id}">Anzahl (n):</label>
			                <input type="number" id="anzahlBUEGEL-${zone.id}" value="${zone.num}" min="0" oninput="updateZoneData(${zone.id}, 'num', this.value); validateNumberInput(this, 0, 'int', 'Anzahl >= 0');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
			                <span class="input-feedback"></span>
			            </div>
			        `;
			
			        const pitchCell = row.insertCell();
                                pitchCell.setAttribute('data-label', 'Pitch (p)');
                                pitchCell.innerHTML = `
                                    <div class="form-group">
                                        <label for="pitch-${zone.id}">Pitch (p):</label>
                                        <input type="number" id="pitch-${zone.id}" value="${zone.pitch}" min="1" oninput="updateZoneData(${zone.id}, 'pitch', this.value); validateNumberInput(this, 1, 'int', 'Pitch >= 1mm');" onfocus="setHighlightedZone(${displayIndex},true)" onblur="setHighlightedZone(${displayIndex},false)">
                                        <span class="input-feedback"></span>
                                    </div>
                                `;
                                const pitchInput = pitchCell.querySelector('input');
                                if (pitchInput) {
                                    pitchInput.addEventListener('keydown', (e) => {
                                        if (e.key === 'Tab' && !e.shiftKey && index === zonesData.length - 1) {
                                            e.preventDefault();
                                            addZone(8, 3, 150, true);
                                        }
                                    });
                                }
			
			        const actionsCell = row.insertCell();
			        actionsCell.setAttribute('data-label', 'Aktion');
			        actionsCell.style.textAlign = 'center';
			        actionsCell.innerHTML = `
			            <button type="button" class="btn-delete-zone" onclick="removeSpecificZoneById(${zone.id})" title="Diese Zone löschen">
			                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12l1.41 1.41L13.41 14l2.12 2.12l-1.41 1.41L12 15.41l-2.12 2.12l-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
			            </button>
			        `;
			    });
			    renderZoneSummaryTable();
			    triggerPreviewUpdateDebounced();
			}
			
			// Update a specific zone's data
			function updateZoneData(zoneId, field, value) {
			    const zone = zonesData.find(z => z.id == zoneId);
			    if (zone) {
			        let parsedValue;
			        if (field === 'num') {
			            parsedValue = parseInt(value, 10);
			            zone[field] = Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : zone[field] || 0;
			        } else {
			            parsedValue = parseFloat(value);
			            zone[field] = parsedValue > 0 ? parsedValue : zone[field] || (field === 'dia' ? 8 : 1);
			        }
			    }
			    triggerPreviewUpdateDebounced();
			    renderZoneSummaryTable(); // This is the corrected call
			}
			
			// Add a new zone to the list
                        function addZone(dia = 8, num = 3, pitch = 150, focusNum = false) {
                            if (zonesData.length >= maxZones) {
                                showFeedback('templateFeedback', 'Maximale Zonenanzahl erreicht.', 'warning', 3000);
                                return;
                            }
                            const newId = nextZoneId++;
                            zonesData.push({
                                id: newId,
                                dia: dia,
                                num: num,
                                pitch: pitch
                            });
                            renderAllZones();
                            updateAddZoneButtonState();
                            if (focusNum) {
                                const numInput = document.getElementById(`anzahlBUEGEL-${newId}`);
                                if (numInput) {
                                    numInput.focus();
                                }
                            }

                            // Scroll to the new zone and briefly highlight it
                            setTimeout(() => {
                                const newRow = document.querySelector(`#zonesTable tr[data-zone-id="${newId}"]`);
                                if (newRow) {
                                    const tableWrapper = newRow.closest('.zone-table-wrapper');
                                    if (tableWrapper) {
                                        const wrapperRect = tableWrapper.getBoundingClientRect();
                                        const rowRect = newRow.getBoundingClientRect();
			                const isVisible = rowRect.top >= wrapperRect.top && rowRect.bottom <= wrapperRect.bottom;
			                if (!isVisible) {
			                    newRow.scrollIntoView({
			                        behavior: 'smooth',
			                        block: 'nearest'
			                    });
			                }
			            } else {
			                newRow.scrollIntoView({
			                    behavior: 'smooth',
			                    block: 'nearest'
			                });
			            }
			            newRow.style.transition = 'background-color .3s ease-in-out';
			            newRow.style.backgroundColor = 'rgba(var(--primary-color-rgb), .1)';
			            setTimeout(() => {
			                newRow.style.backgroundColor = '';
			            }, 1500);
			        }
			    }, 100);
			}
			
			// Remove a specific zone by ID
                        function removeSpecificZoneById(zoneId) {
                            zonesData = zonesData.filter(zone => zone.id != zoneId);
                            // Adjust highlighted zone if it was deleted
                            if (highlightedZoneDisplayIndex && (zonesData.length < highlightedZoneDisplayIndex || !zonesData.find((z, i) => i + 1 === highlightedZoneDisplayIndex))) {
                                setHighlightedZone(null, false);
			    } else if (zonesData.length === 0) {
			        setHighlightedZone(null, false);
                            }
                            renderAllZones();
                            updateAddZoneButtonState();
                            showFeedback('templateFeedback', 'Zone gelöscht.', 'success', 2000);
                        }

                        function updateAddZoneButtonState() {
                            const btn = document.getElementById('addZoneButton');
                            if (btn) btn.disabled = zonesData.length >= maxZones;
                        }

function updateMaxZones(value) {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
        maxZones = parsed;
    }
    updateAddZoneButtonState();
}

function updateZonesPerLabel(value) {
    const parsed = parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 1) {
        zonesPerLabel = parsed;
    }
    renderAllZones();
    updateLabelPreview();
}


function loadSampleBasket() {
    const sample = {
        projekt: 'Demo-Projekt MEP',
        komm: 'K-0424',
        auftrag: 'BVBS-2024',
        posnr: '12',
        gesamtlange: 4200,
        anzahl: 2,
        langdrahtDurchmesser: 12,
        steelGrade: 'B500B',
        anfangsueberstand: 80,
        endueberstand: 80,
        buegelname1: 'Korb Typ A',
        buegelname2: 'Korb Typ B',
        zones: [
            { dia: 8, num: 6, pitch: 150 },
            { dia: 8, num: 5, pitch: 180 },
            { dia: 10, num: 8, pitch: 160 },
            { dia: 8, num: 6, pitch: 150 },
            { dia: 8, num: 5, pitch: 180 }
        ]
    };

    const applyValue = (id, value) => {
        const element = document.getElementById(id);
        if (element !== null && element !== undefined) {
            element.value = value;
        }
    };

    applyValue('projekt', sample.projekt);
    applyValue('KommNr', sample.komm);
    applyValue('auftrag', sample.auftrag);
    applyValue('posnr', sample.posnr);
    applyValue('gesamtlange', sample.gesamtlange);
    applyValue('anzahl', sample.anzahl);
    applyValue('langdrahtDurchmesser', sample.langdrahtDurchmesser);
    applyValue('stahlgute', sample.steelGrade || 'B500B');
    applyValue('anfangsueberstand', sample.anfangsueberstand);
    applyValue('endueberstand', sample.endueberstand);
    applyValue('buegelname1', sample.buegelname1);
    applyValue('buegelname2', sample.buegelname2);
    refreshStirrupNameSelects();

    zonesData = sample.zones.map((zone, index) => ({
        id: index,
        dia: zone.dia,
        num: zone.num,
        pitch: zone.pitch
    }));
    nextZoneId = zonesData.length;

    renderAllZones();
    updateAddZoneButtonState();
    if (window.viewer3d && typeof window.viewer3d.prepareAutoFit === 'function') {
        window.viewer3d.prepareAutoFit();
    }
    updateLabelPreview();
    setSummaryStatusOverride('Beispielkorb aktiv', 'Beispielkorb aktiv');
    triggerPreviewUpdateDebounced();
    updateGenerateButtonState();

    const view3dBtn = document.getElementById('view3dBtn');
    if (view3dBtn && !view3dBtn.classList.contains('active')) {
        view3dBtn.click();
    } else if (window.viewer3d) {
        window.viewer3d.onResize();
    }
}



                        // Debounce function to prevent excessive updates while typing
function triggerPreviewUpdateDebounced() {
    updateGeneratorSummary();
    clearTimeout(previewUpdateTimer);
    previewUpdateTimer = setTimeout(() => {
                    drawCagePreview();
                    if(window.viewer3d) {
                        const basketData = {
                            totalLength: parseFloat(document.getElementById('gesamtlange').value) || 0,
                            mainBarDiameter: parseFloat(document.getElementById('langdrahtDurchmesser').value) || 0,
                            zones: JSON.parse(JSON.stringify(zonesData)),
                            highlightedZoneDisplayIndex
                        };
                        window.viewer3d.update(basketData);
                    }
                }, 150);
			}
			
			// Render the summary table of zones
                        function renderZoneSummaryTable() {
                            const tbody = document.querySelector("#zoneSummaryTable tbody");
                            if (!tbody) return;

                            tbody.innerHTML = ''; // Clear old content

                            if (zonesData.length === 0) {
                                const emptyRow = document.createElement('tr');
                                const emptyCell = document.createElement('td');
                                emptyCell.textContent = "Keine Zonen definiert.";
                                emptyCell.colSpan = 2; // Span across two columns
                                emptyRow.appendChild(emptyCell);
                                tbody.appendChild(emptyRow);
                                return;
                            }

                            const headerLabels = ["Zone", "Anzahl (n)", "Abstand (p)"];
                            const firstGroup = zonesData.slice(0, zonesPerLabel);
                            const secondGroup = zonesData.slice(zonesPerLabel);

                            if (secondGroup.length > 0) {
                                const groupRow = document.createElement('tr');
                                const emptyTh = document.createElement('th');
                                groupRow.appendChild(emptyTh);
                                const g1 = document.createElement('th');
                                g1.textContent = 'Code 1';
                                g1.colSpan = firstGroup.length;
                                groupRow.appendChild(g1);
                                const g2 = document.createElement('th');
                                g2.textContent = 'Code 2';
                                g2.colSpan = secondGroup.length;
                                groupRow.appendChild(g2);
                                tbody.appendChild(groupRow);
                            }

                            headerLabels.forEach((label, colIndex) => {
                                const row = document.createElement('tr');
                                const headerCell = document.createElement('th');
                                headerCell.textContent = label;
                                row.appendChild(headerCell);

                                const values = [];
                                if (colIndex === 0) {
                                    zonesData.forEach((zone, index) => values.push(index + 1));
                                } else if (colIndex === 1) {
                                    zonesData.forEach((zone, i) => values.push(getEffectiveZoneNum(zone, i)));
                                } else {
                                    zonesData.forEach(zone => values.push(zone.pitch));
                                }

                                values.forEach((value, cellIndex) => {
                                    const cell = document.createElement('td');
                                    cell.textContent = value;
                                    if (highlightedZoneDisplayIndex === cellIndex + 1) {
                                        cell.classList.add('focused-zone-form');
                                    }
                                    if (cellIndex < zonesPerLabel) {
                                        cell.classList.add('first-label-zone');
                                    }
                                    row.appendChild(cell);
                                });

                                tbody.appendChild(row);
                            });
                        }
			
			
			// Build an SVG dimension line group
			function buildDimensionLineSvg(x1, y1, x2, y2, label, offset = 0, textClass = 'dim-text-default', lineClass = 'dim-line-default', textAnchor = 'center') {
			    let svg = `<g class="dimension">`;
			    const tickSize = 4;
			    // Main dimension line
			    svg += `<line class="${lineClass}" x1="${Math.round(x1)}" y1="${Math.round(y1)}" x2="${Math.round(x2)}" y2="${Math.round(y1)}"/>`;
			    // Ticks
			    svg += `<line class="${lineClass}" x1="${Math.round(x1)}" y1="${Math.round(y1 - tickSize)}" x2="${Math.round(x1)}" y2="${Math.round(y1 + tickSize)}"/>`;
			    svg += `<line class="${lineClass}" x1="${Math.round(x2)}" y1="${Math.round(y1 - tickSize)}" x2="${Math.round(x2)}" y2="${Math.round(y1 + tickSize)}"/>`;
			    // Text
			    let textAnchorValue = 'middle';
			    let textX = Math.round((x1 + x2) / 2);
			    if (textAnchor === 'left') {
			        textAnchorValue = 'start';
			        textX = Math.round(x1 + TEXT_ABOVE_LINE_OFFSET);
			    } else if (textAnchor === 'right') {
			        textAnchorValue = 'end';
			        textX = Math.round(x2 - TEXT_ABOVE_LINE_OFFSET);
			    }
			    const textY = Math.round(y1 - TEXT_ABOVE_LINE_OFFSET + offset);
			    svg += `<text class="${textClass}" x="${textX}" y="${textY}" text-anchor="${textAnchorValue}">${label}</text>`;
			    svg += `</g>`;
			    return svg;
			}
			
			// Main function to draw the SVG preview of the cage
			function drawCagePreview() {
			    const svgContainer = document.getElementById('cagePreviewSvg');
			    const svgWrapper = document.getElementById('cagePreviewSvgContainer');
			    const errorEl = document.getElementById('previewError');
			    errorEl.textContent = '';
			    errorEl.className = 'info-text';
			
			    const width = svgWrapper.clientWidth;
			    const height = 320;
			    svgContainer.setAttribute('width', width.toString());
			    svgContainer.setAttribute('height', height.toString());
			    svgContainer.setAttribute('viewBox', `0 0 ${width} ${height}`);
			
			    let svgContent = `<defs><style type="text/css"><![CDATA[
			    .main-bar{stroke:var(--secondary-color);stroke-width:1.5px;}
			    .overhang-rect{fill:rgba(108,117,125,.08);}
			    .stirrup{stroke-linecap:round;}
			    .dim-line-default{stroke:var(--svg-dim-line-color);stroke-width:.8px;}
			    .dim-text-default{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:var(--svg-text-color);}
			    .dim-text-overhang{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:#000000;}
			    .dim-text-total{font-family:${SVG_FONT_FAMILY};font-size:${SVG_TOTAL_DIM_FONT_SIZE};font-weight:bold;fill:var(--text-color);}
			    .dim-text-single-stirrup{font-family:${SVG_FONT_FAMILY};font-size:${SVG_SINGLE_STIRRUP_FONT_SIZE};}
			    .dim-text-inter-zone{font-family:${SVG_FONT_FAMILY};font-size:${SVG_DIM_FONT_SIZE};fill:var(--secondary-color);}
			    `;
			    // Add dynamic zone colors
			    for (let i = 0; i < NUM_ZONE_COLORS_AVAILABLE; i++) {
			        let color = getComputedStyle(document.documentElement).getPropertyValue(`--svg-zone-color-${i}`)?.trim();
			        let r = 0, g = 0, b = 0;
			        if (color && color.startsWith('#')) {
			            r = parseInt(color.substring(1, 3), 16);
			            g = parseInt(color.substring(3, 5), 16);
			            b = parseInt(color.substring(5, 7), 16);
			            svgContent += `.zone-${i}-stroke{stroke:var(--svg-zone-color-${i});}
			                            .zone-${i}-fill{fill:var(--svg-zone-color-${i});}
			                            .zone-${i}-bg-fill{fill:rgba(${r},${g},${b},.1);}`;
			        } else {
			            svgContent += `.zone-${i}-stroke{stroke:#888;}
			                            .zone-${i}-fill{fill:#888;}
			                            .zone-${i}-bg-fill{fill:rgba(128,128,128,.1);}`;
			        }
			    }
			    const highlightRgba = getComputedStyle(document.documentElement).getPropertyValue('--svg-highlight-bg-color-rgba')?.trim() || "214, 51, 132";
			    svgContent += `.highlight-stroke{stroke:var(--svg-highlight-color)!important;}
			                    .highlight-fill{fill:var(--svg-highlight-color)!important;}
			                    .${HIGHLIGHT_BG_FILL_CLASS}{fill:rgba(${highlightRgba},.15)!important;}
			                    .leerraum-fill{fill:url(#hatchPattern);opacity:.5;}
			                    .dimension text{dominant-baseline:middle;}
			                    ]]></style>
			    <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
			        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch-line-color)" stroke-width=".7"/>
			    </pattern>
			    </defs>
			    `;
			    svgContent += '<g class="cage-drawing-group">';
			
			    try {
			        const totalLength = parseFloat(document.getElementById('gesamtlange').value) || 0;
			        if (totalLength <= 0) {
			            errorEl.textContent = 'Gesamtlänge muss größer als 0 sein.';
			            errorEl.classList.add('error');
			            svgContainer.innerHTML = svgContent + '</g>';
			            return;
			        }
			
                                const initialOverhang = 0;
                                const finalOverhang = 0;
			        const drawingWidth = width - 2 * PADDING_VISUAL;
			        if (drawingWidth <= 0) {
			            svgContainer.innerHTML = svgContent + '</g>';
			            return;
			        }
			
			        const scale = drawingWidth / totalLength;
			        const centerY = height / 2 - 20;
			
			        svgContent += '<g class="main-bars-group">';
			        const barYTop = Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 3.5);
			        const barYBottom = Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 3.5);
			        const startX = Math.round(PADDING_VISUAL);
			        const endX = Math.round(PADDING_VISUAL + totalLength * scale);
			        svgContent += `<line class="main-bar" x1="${startX}" y1="${barYTop}" x2="${endX}" y2="${barYTop}"/>`;
			        svgContent += `<line class="main-bar" x1="${startX}" y1="${barYBottom}" x2="${endX}" y2="${barYBottom}"/>`;
			        svgContent += '</g>';
			
                                let currentPositionMm = 0;
                                let stirrupZoneTotalLength = 0;
                                const dimY = centerY + STIRRUP_HEIGHT_VISUAL / 2 + DIM_LINE_OFFSET_BELOW;
                                const dimYPitch = centerY - STIRRUP_HEIGHT_VISUAL / 2 - DIM_LINE_OFFSET_ABOVE;

                                // draw standard stirrup at position 0
                                if (zonesData.length > 0) {
                                    const firstDia = zonesData[0].dia;
                                    let strokeWidthStd = Math.max(1, Math.min(3.5, firstDia / 3));
                                    const xStd = Math.round(PADDING_VISUAL);
                                    svgContent += `<line class="stirrup" style="stroke-width:${strokeWidthStd}px;stroke:#000" x1="${xStd}" y1="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" x2="${xStd}" y2="${Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 2)}"/>`;
                                }

                                svgContent += '<g class="stirrup-zones-group">';
                                zonesData.forEach((zone, index) => {
                                    const zoneStart = currentPositionMm;
                                    const displayIndex = index + 1;
                                    const numStirrups = zone.num;
                                    const pitch = zone.pitch;
                                    const dia = zone.dia;

                                    const zoneLength = numStirrups > 0 && pitch > 0 ? numStirrups * pitch : 0;
                                    stirrupZoneTotalLength += zoneLength;

                                    const isHighlighted = highlightedZoneDisplayIndex === displayIndex;
                                    const zoneColorIndex = index % NUM_ZONE_COLORS_AVAILABLE;
                                    const stirrupStrokeClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_STROKE : `zone-${zoneColorIndex}-stroke`;
                                    const stirrupFillClass = isHighlighted ? HIGHLIGHT_COLOR_CLASS_FILL : `zone-${zoneColorIndex}-fill`;
                                    const zoneBgFillClass = isHighlighted ? HIGHLIGHT_BG_FILL_CLASS : `zone-${zoneColorIndex}-bg-fill`;
                                    let stirrupStrokeWidth = Math.max(1, Math.min(3.5, dia / 3));
                                    let highlightedStrokeWidth = isHighlighted ? stirrupStrokeWidth + 1 : stirrupStrokeWidth;

                                    svgContent += `<g class="stirrup-zone zone-group-${displayIndex} ${isHighlighted ? 'highlighted-svg-zone' : ''}" onmouseover="setHighlightedZone(${displayIndex},true)" onmouseout="setHighlightedZone(${displayIndex},false)" onclick="focusZoneFromPreview(${displayIndex})">`;

                                    if (numStirrups > 0) {
                                        const zoneStartScaled = PADDING_VISUAL + zoneStart * scale;
                                        if (zoneLength > 0) {
                                            svgContent += `<rect class="${zoneBgFillClass}" x="${Math.round(zoneStartScaled)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.round(zoneLength * scale)}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
                                        }
                                        for (let j = 1; j <= numStirrups; j++) {
                                            const stirrupPos = zoneStart + j * pitch;
                                            const stirrupX = Math.round(PADDING_VISUAL + stirrupPos * scale);
                                            if (stirrupPos <= totalLength + 1) {
                                                const strokeClass = stirrupStrokeClass;
                                                const strokeStyle = `stroke-width:${highlightedStrokeWidth}px`;
                                                svgContent += `<line class="stirrup ${strokeClass}" style="${strokeStyle}" x1="${stirrupX}" y1="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" x2="${stirrupX}" y2="${Math.round(centerY + STIRRUP_HEIGHT_VISUAL / 2)}"/>`;
                                            }
                                        }

                                        const dimLineY = dimY + (index % 2) * INTER_ZONE_DIM_OFFSET;
                                        const dimLineYPitch = dimYPitch + (index % 2) * -INTER_ZONE_DIM_OFFSET;
                                        let dimLength = 0;
                                        let dimText = '';

                                        if (dimensioningMode === 'totalZoneSpace' && numStirrups > 0 && pitch > 0) {
                                            dimLength = numStirrups * pitch;
                                            dimText = `${numStirrups}x${pitch}=${dimLength}`;
                                            const dimEndScaled = PADDING_VISUAL + (zoneStart + dimLength) * scale;
                                            if (dimLength > 0) {
                                                svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
                                            }
                                        } else if (numStirrups > 0 && pitch > 0) {
                                            dimLength = numStirrups * pitch;
                                            dimText = `${numStirrups}x${pitch}=${dimLength}`;
                                            const dimEndScaled = PADDING_VISUAL + (zoneStart + dimLength) * scale;
                                            svgContent += buildDimensionLineSvg(zoneStartScaled, dimLineY, dimEndScaled, dimLineY, dimText, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'center');
                                        }

                                        // Pitch dimension for multi-stirrup zones
                                        if (numStirrups > 1 && pitch > 0) {
                                            const pitchStartScaled = PADDING_VISUAL + (zoneStart + pitch) * scale;
                                            const pitchEndScaled = pitchStartScaled + pitch * scale;
                                            if (pitchEndScaled <= zoneStartScaled + (zoneLength * scale) + 1.1 && pitch * scale > 5) {
                                                svgContent += buildDimensionLineSvg(pitchStartScaled, dimLineYPitch, pitchEndScaled, dimLineYPitch, `p=${pitch}`, 0, `dim-text-default ${zoneColorIndex}`, `dim-line-default ${zoneColorIndex}`, 'left');
                                            }
                                        }

                                        currentPositionMm += zoneLength;
                                    }
                                    svgContent += `</g>`;
                                });
                                svgContent += '</g>';

                                if (stirrupZoneTotalLength < totalLength - 0.1) {
                                    const leerraumStart = PADDING_VISUAL + stirrupZoneTotalLength * scale;
                                    const leerraumEnd = PADDING_VISUAL + totalLength * scale;
                                    svgContent += '<g class="leerraum-visual-group">';
                                    svgContent += `<rect class="leerraum-fill" x="${Math.round(leerraumStart)}" y="${Math.round(centerY - STIRRUP_HEIGHT_VISUAL / 2)}" width="${Math.round(leerraumEnd - leerraumStart)}" height="${Math.round(STIRRUP_HEIGHT_VISUAL)}"/>`;
                                    svgContent += '</g>';
                                }

                                const effectiveLength = totalLength;
                                if (Math.abs(stirrupZoneTotalLength - effectiveLength) > 0.1 && stirrupZoneTotalLength < effectiveLength) {
                                    errorEl.textContent = `Warnung: Leerraum (${(effectiveLength - stirrupZoneTotalLength).toFixed(1)}mm).`;
                                    errorEl.classList.add('warning');
                                } else if (stirrupZoneTotalLength > effectiveLength + 0.1) {
                                    errorEl.textContent = `Fehler: Bügelzonen (${stirrupZoneTotalLength.toFixed(1)}mm) > Platz (${effectiveLength.toFixed(1)}mm)!`;
                                    errorEl.classList.add('error');
                                }

                                svgContent += '<g class="total-length-dimension-group">';
                                const totalDimStart = PADDING_VISUAL;
                                const totalDimEnd = PADDING_VISUAL + totalLength * scale;
                                svgContent += buildDimensionLineSvg(totalDimStart, height - PADDING_VISUAL + 10, totalDimEnd, height - PADDING_VISUAL + 10, `Gesamtlänge L = ${totalLength}mm`, 0, 'dim-text-total', 'dim-line-default', 'center');
                                svgContent += '</g>';
			        
			        svgContent += '</g>';
                                svgContainer.innerHTML = svgContent;
                            } catch (e) {
                                console.error("Fehler beim Zeichnen der SVG-Vorschau:", e);
                                errorEl.textContent = "Fehler Vorschau (SVG): " + e.message;
                                errorEl.classList.add('error');
                                if (e && svgContent) {
                                    svgContainer.innerHTML = svgContent.endsWith("</g>") ? svgContent : svgContent + "</g>";
                                }
                            }
                            updateGenerateButtonState();
                        }
			
			// Calculate the BVBS checksum
			function calculateChecksum(bvbsCode) {
			    let sum = 0;
			    for (let i = 0; i < bvbsCode.length; i++) {
			        sum += bvbsCode.charCodeAt(i);
			    }
			    return 96 - (sum % 32);
			}
			
			// Main function to generate BVBS code and trigger barcode creation
			function generateBvbsCodeAndBarcode() {
                            const errorEl = document.getElementById('barcodeError');
                            errorEl.textContent = '';
                            const output1 = document.getElementById('outputBvbsCode1');
                            const output2 = document.getElementById('outputBvbsCode2');
                            const outputField2 = document.getElementById('bvbsOutputField2');
                            if (output1) output1.value = '';
                            if (output2) output2.value = '';
                            if (outputField2) outputField2.style.display = 'none';
                            const barcodeContainer = document.getElementById('barcodeSvgContainer');
                            barcodeContainer.innerHTML = '';
                            barcodeContainer.classList.add('hidden');
			
			    let isValid = true;
			    // Validate all form fields before generation
			    const inputsToValidate = [{
			        id: 'gesamtlange',
			        min: 1,
			        type: 'int',
			        info: 'Gesamtlänge in mm (min. 1)'
			    }, {
			        id: 'anzahl',
			        min: 1,
			        type: 'int',
			        info: 'Anzahl Körbe (min. 1)'
			    }, {
			        id: 'langdrahtDurchmesser',
			        min: 1,
			        type: 'int',
			        info: 'Längsdraht-Ø in mm (min. 1)'
			    }, {
			        id: 'anfangsueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Anfangsüberstand in mm (min. 0)'
			    }, {
			        id: 'endueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Endüberstand in mm (min. 0)'
			    }];
			
			    inputsToValidate.forEach(input => {
			        const el = document.getElementById(input.id);
			        if (el && !validateNumberInput(el, input.min, input.type, input.info)) {
			            isValid = false;
			        }
			    });
			
			    zonesData.forEach(zone => {
			        const diaEl = document.getElementById(`durchmesser-${zone.id}`);
			        if (diaEl && !validateNumberInput(diaEl, 6, 'int', 'Mind. 6mm')) {
			            isValid = false;
			        }
			        const numEl = document.getElementById(`anzahlBUEGEL-${zone.id}`);
			        if (numEl && !validateNumberInput(numEl, 0, 'int', 'Anzahl >= 0')) {
			            isValid = false;
			        }
			        const pitchEl = document.getElementById(`pitch-${zone.id}`);
			        if (pitchEl && !validateNumberInput(pitchEl, 1, 'int', 'Pitch >= 1mm')) {
			            isValid = false;
			        }
			    });
			
			    if (!isValid) {
			        showFeedback('barcodeError', "Bitte korrigieren Sie die markierten Eingabefehler.", 'error', 5000);
			        updateLabelPreview();
			        return;
			    }
			
			    try {
			        // Get all input values
                                const projekt = document.getElementById('projekt').value;
                                const KommNr = document.getElementById('KommNr').value;
                                const auftrag = document.getElementById('auftrag').value;
                                const posnr = document.getElementById('posnr').value;
                                const rawGesamtlange = document.getElementById('gesamtlange').value;
                                const rawQuantity = document.getElementById('anzahl').value;
                                const rawDiameter = document.getElementById('langdrahtDurchmesser').value;
                                const rawAnfangsueberstand = document.getElementById('anfangsueberstand').value;
                                const rawEndueberstand = document.getElementById('endueberstand').value;
                                const steelGradeRaw = document.getElementById('stahlgute')?.value || 'B500B';
                                const gesamtlangeVal = parseFloat(rawGesamtlange) || 0;
                                const quantityValue = Math.max(1, Math.round(parseFloat(rawQuantity) || 0));
                                const diameterValue = Math.max(0, Math.round(parseFloat(rawDiameter) || 0));
                                const startOverhangValue = Math.max(0, Math.round(parseFloat(rawAnfangsueberstand) || 0));
                                const endOverhangValue = Math.max(0, Math.round(parseFloat(rawEndueberstand) || 0));
                                const buegelname1 = document.getElementById('buegelname1').value.trim();
                                const buegelname2 = document.getElementById('buegelname2').value.trim();
                                const rezeptname = document.getElementById('rezeptname').value.trim();
                                const sanitizedProjekt = sanitizeBvbsSegment(projekt);
                                const sanitizedKomm = sanitizeBvbsSegment(KommNr);
                                const sanitizedAuftrag = sanitizeBvbsSegment(auftrag);
                                const sanitizedPosnr = sanitizeBvbsSegment(posnr);
                                const sanitizedSteelGrade = sanitizeBvbsSegment(steelGradeRaw) || 'B500B';
                                const sanitizedRecipe = sanitizeBvbsSegment(rezeptname);
                                const formattedLength = formatNumberForBvbs(gesamtlangeVal);
                                const formattedQuantity = formatNumberForBvbs(quantityValue);
                                const formattedDiameter = formatNumberForBvbs(diameterValue);
                                const formattedWeight = formatWeightForBvbs(gesamtlangeVal, diameterValue);

                                if (zonesData.length > zonesPerLabel && !buegelname2) {
                                    updateGenerateButtonState();
                                    return;
                                }

                                const buildCode = (zonesArr, startOv, endOv, stirrupName) => {
                                    const sanitizedName = sanitizeBvbsSegment(stirrupName);
                                    const zoneCount = getStirrupCount(zonesArr);
                                    const encodedZones = encodeZonesForBvbs(zonesArr, startOv, endOv, {
                                        name: sanitizedName,
                                        recipe: sanitizedRecipe
                                    });
                                    const segments = [
                                        `BF2D`,
                                        `Hj${sanitizedProjekt}`,
                                        `r${sanitizedKomm}`,
                                        `i${sanitizedAuftrag}`,
                                        `p${sanitizedPosnr}`,
                                        `l${formattedLength}`,
                                        `n${formattedQuantity}`,
                                        `e${formattedWeight}`,
                                        `d${formattedDiameter}`,
                                        `g${sanitizedSteelGrade}`,
                                        `s${zoneCount}`,
                                        `v`,
                                        `a`,
                                        `c`,
                                        `G${formattedLength}`,
                                        `w0`,
                                        `P${encodedZones}`
                                    ];
                                    const pre = segments.join('@') + '@C';
                                    const cs = calculateChecksum(pre);
                                    return `${pre}${cs}@`;
                                };
                                let finalBvbsCode = buildCode(zonesData, startOverhangValue, endOverhangValue, buegelname1);
                                let finalBvbsCode2 = null;
                                if (zonesData.length > zonesPerLabel) {
                                    const firstZones = zonesData.slice(0, zonesPerLabel);
                                    const secondZones = zonesData.slice(zonesPerLabel);
                                    finalBvbsCode = buildCode(firstZones, startOverhangValue, 0, buegelname1);
                                    const startOvSecond = Math.max(0, Math.round(Number(zonesData[zonesPerLabel - 1]?.pitch) || 0));
                                    finalBvbsCode2 = buildCode(secondZones, startOvSecond, endOverhangValue, buegelname2);
                                }
                                const out1 = document.getElementById('outputBvbsCode1');
                                const out2 = document.getElementById('outputBvbsCode2');
                                const field2 = document.getElementById('bvbsOutputField2');
                                if (out1) out1.value = finalBvbsCode;
                                if (finalBvbsCode2 && out2 && field2) {
                                    out2.value = finalBvbsCode2;
                                    field2.style.display = 'flex';
                                } else if (out2 && field2) {
                                    out2.value = '';
                                    field2.style.display = 'none';
                                }

                                const primaryZones = zonesData.length > zonesPerLabel ? zonesData.slice(0, zonesPerLabel) : zonesData;
                                const secondaryZones = zonesData.length > zonesPerLabel ? zonesData.slice(zonesPerLabel) : [];
                                const primaryCount = getStirrupCount(primaryZones);
                                const secondaryCount = secondaryZones.length ? getStirrupCount(secondaryZones) : 0;

                                updateBarcodeDebugInfo(`Generated BVBS code: ${finalBvbsCode}`);
                                if (finalBvbsCode2) {
                                    updateBarcodeDebugInfo(`Generated BVBS code (2): ${finalBvbsCode2}`);
                                }
                                updateBarcodeDebugInfo(`Code length: ${finalBvbsCode.length}${finalBvbsCode2 ? '/' + finalBvbsCode2.length : ''}`);
                                updateBarcodeDebugInfo(`Stirrup count: ${finalBvbsCode2 ? `${primaryCount}/${secondaryCount}` : primaryCount}`);
                                updateBarcodeDebugInfo(`Weight per piece: ${formattedWeight} kg | Steel grade: ${sanitizedSteelGrade}`);

                                // Check for library before trying to use it
                                if (typeof bwipjs === 'undefined') {
                                    console.error("bwip-js library not loaded!");
                                    updateBarcodeDebugInfo("bwip-js Bibliothek nicht geladen!");
			            showFeedback('barcodeError', 'Fehler: Barcode-Bibliothek nicht geladen. Bitte Seite neu laden.', 'error', 5000);
                                createFallbackBarcode(finalBvbsCode, finalBvbsCode2);
			            return;
			        }
			
			        generatePDF417Barcode(finalBvbsCode);
			
			    } catch (e) {
			        console.error("Error in generateBvbsCodeAndBarcode:", e);
                                updateBarcodeDebugInfo(`Fehler bei Code-Generierung: ${e.message}`);
                                const outErr = document.getElementById('outputBvbsCode1');
                                if (outErr) outErr.value = 'Fehler: ' + e.message;
			        showFeedback('barcodeError', "Fehler: " + e.message, 'error', 5000);
			        barcodeContainer.innerHTML = '';
			        barcodeContainer.classList.add('hidden');
			        updateLabelPreview();
			    }
			}
			
			// Generate the PDF417 barcode
			/**
			* Erzeugt im PDF417‑Card den Barcode als Canvas.
			* Schreibt ihn in das Element mit ID "barcodeSvgContainer".
			*/
			function generatePDF417Barcode(bvbsCode) {
			const container = document.getElementById('barcodeSvgContainer');
			const errorEl   = document.getElementById('barcodeError');
			
			if (!container) {
			console.error('Kein Element mit ID "barcodeSvgContainer" gefunden.');
			return;
			}
			if (errorEl) {
			errorEl.textContent = '';
			}
			
			// Alten Inhalt löschen
			container.innerHTML = '';
			
			try {
			// Neues Canvas erzeugen
			const canvas = document.createElement('canvas');
			
			// bwip-js: Canvas‑Barcode generieren
			bwipjs.toCanvas(canvas, {
			    bcid:        'pdf417',      // Barcode‑Typ
			    text:        bvbsCode,      // zu codierender Text
			scaleX:  2,
			scaleY:  4,             // Skalierung
			    height:      12,            // Höhe
			    includetext: true,          // Text unter Barcode
			    textxalign:  'center',      // Text zentriert
			    textsize:    15              // Textgröße
			});
			
			// Canvas ins DOM hängen
			container.appendChild(canvas);
			
			// Status aktualisieren
			updateBarcodeStatus();
			
			} catch (err) {
			console.error('Error generating PDF417 canvas barcode:', err);
			if (errorEl) {
			    errorEl.textContent = `Fehler beim Erstellen des Canvas-Barcodes: ${err.message}`;
			    errorEl.classList.add('error');
			}
			// optional: Fallback-Text anzeigen
			container.textContent = bvbsCode;
			}
			}
			
			
			
			// Fallback for barcode generation (e.g. if running from file:// protocol)
                        function createFallbackBarcode(code1, code2) {
                        const barcodeContainer = document.getElementById('barcodeSvgContainer');
                        const errorEl = document.getElementById('barcodeError');
                        barcodeContainer.innerHTML = '';
                        barcodeContainer.classList.add('hidden');
                        errorEl.textContent = '';
                        try {
                            updateBarcodeDebugInfo("Erstelle Fallback-Barcode (Text)");
                                const fill = (suffix, code) => {
                                    const labelImage = document.getElementById('labelBarcodeImage' + suffix);
                                    const labelText = document.getElementById('labelBarcodeText' + suffix);
                                    if (labelImage) {
                                        labelImage.src = '';
                                        labelImage.style.display = 'none';
                                    }
                                    if (labelText) {
                                        labelText.textContent = code;
                                        labelText.style.display = 'block';
                                        labelText.style.fontStyle = 'normal';
                                        labelText.style.color = '#333';
                                    }
                                };

                                fill('', code1);
                                if (code2) fill('2', code2);
			        showFeedback('barcodeError', 'Barcode-Generierung fehlgeschlagen. Es wird ein Text-Fallback angezeigt.', 'warning', 5000);
			        updateBarcodeDebugInfo("Fallback-Barcode (Text) erfolgreich erstellt");
			        updateLabelPreview(null);
			    } catch (e) {
			        console.error("Even fallback barcode creation failed:", e);
			        updateBarcodeDebugInfo(`Fallback (Text) fehlgeschlagen: ${e.message}`);
			        showFeedback('barcodeError', 'Barcode-Generierung fehlgeschlagen. Es gibt keinen Fallback.', 'error', 5000);
			        updateLabelPreview(null);
			    }
			}
			
			// Update the printable label preview
			// Update the printable label preview
function updateLabelPreview(barcodeSvg) {
                        const projekt = document.getElementById('projekt').value || '-';
                        const KommNr  = document.getElementById('KommNr').value || '-';
                        const buegelname1 = document.getElementById('buegelname1').value || '-';
                        const buegelname2 = document.getElementById('buegelname2').value || '-';
                        const auftrag = document.getElementById('auftrag').value || '-';
                        const total = parseFloat(document.getElementById('gesamtlange').value) || 0;
                        const gesamtlange = total + ' mm';
                        const posnr = document.getElementById('posnr').value || '-';

                        const codes = getBvbsCodes();

                        const suffixFirst = zonesData.length > zonesPerLabel ? '/1' : '';
                        const suffixSecond = zonesData.length > zonesPerLabel ? '/2' : '';

                        const fillLabel = (idSuffix, suffix, name) => {

                            document.getElementById('labelProjekt' + idSuffix).textContent = projekt;
                            document.getElementById('labelKommNr' + idSuffix).textContent = KommNr;
                            document.getElementById('labelBuegelname' + idSuffix).textContent = name;
                            document.getElementById('labelAuftrag' + idSuffix).textContent = auftrag;
                            document.getElementById('labelGesamtlange' + idSuffix).textContent = gesamtlange;

                            document.getElementById('labelPosnr' + idSuffix).textContent = posnr + suffix;
                        };

                        fillLabel('', suffixFirst, buegelname1);

                        const second = document.getElementById('printableLabel2');
                        if (second) {
                            if (zonesData.length > zonesPerLabel) {
                                second.style.display = 'block';
                                document.body.classList.add('two-page');

                                fillLabel('2', suffixSecond, buegelname2);

                            } else {
                                second.style.display = 'none';
                                document.body.classList.remove('two-page');
                            }
                        } else {
                            document.body.classList.remove('two-page');
                        }

                        const labelImage  = document.getElementById('labelBarcodeImage');
                        const labelText   = document.getElementById('labelBarcodeText');
                        const labelImage2 = document.getElementById('labelBarcodeImage2');
                        const labelText2  = document.getElementById('labelBarcodeText2');

                        if (barcodeSvg) {
                        labelImage.src         = `data:image/svg+xml;base64,${btoa(barcodeSvg)}`;
                        labelImage.style.display = 'block';
                        labelText.style.display  = 'none';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = codes[1] || '';
                            labelText2.style.display = codes[1] ? 'block' : 'none';
                        }
                        }
                        else if (codes.length) {
                        labelImage.style.display = 'none';
                        labelText.textContent    = codes[0] || '';
                        labelText.style.display  = 'block';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = codes[1] || '';
                            labelText2.style.display = codes[1] ? 'block' : 'none';
                        }
                        }
                        else {
                        labelImage.style.display = 'none';
                        labelText.textContent    = '';
                        labelText.style.display  = 'block';
                        if (labelImage2 && labelText2) {
                            labelImage2.style.display = 'none';
                            labelText2.textContent = '';
                            labelText2.style.display = 'none';
                        }
                        }
                        applyLabelLayout();
                        updateGenerateButtonState();
                        }
			
			
			// Initial setup on page load
document.addEventListener('DOMContentLoaded', () => {
    initCollapsibleHeaders();
    loadTemplatesFromFile();
    loadLabelLayout();
    if(window.viewer3d) {
        window.viewer3d.init();
    }
    applyLabelLayout();
    LABEL_ELEMENT_IDS.forEach(id => {
                                const el = document.getElementById(id);
                                if (el) makeElementDraggable(el);
                                const el2 = document.getElementById(id + '2');
        if (el2) makeElementDraggable(el2);
    });

    loadSavedOrders();
    renderSavedOrdersList();

    setupStirrupPicker('buegelname1PickerButton', 'buegelname1');
    setupStirrupPicker('buegelname2PickerButton', 'buegelname2');
    refreshStirrupNameSelects();

    const stirrupFormModalEl = document.getElementById('stirrupFormModal');
    if (stirrupFormModalEl) {
        stirrupFormModalEl.addEventListener('click', (event) => {
            if (event.target === stirrupFormModalEl) {
                closeStirrupFormModal();
            }
        });
    }

    document.getElementById('stirrupFormSearch')?.addEventListener('input', () => {
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

    document.getElementById('stirrupFormDiameterFilter')?.addEventListener('change', (event) => {
        const value = event?.target?.value ?? 'all';
        stirrupFormFilterState.diameter = value || 'all';
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

    document.getElementById('stirrupFormSteelFilter')?.addEventListener('change', (event) => {
        const value = event?.target?.value ?? 'all';
        stirrupFormFilterState.steelGrade = value || 'all';
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

    document.getElementById('stirrupFormSegmentFilter')?.addEventListener('change', (event) => {
        const value = event?.target?.value ?? 'all';
        stirrupFormFilterState.segmentThreshold = value || 'all';
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

    document.getElementById('stirrupFormResetFilters')?.addEventListener('click', () => {
        stirrupFormFilterState.diameter = 'all';
        stirrupFormFilterState.steelGrade = 'all';
        stirrupFormFilterState.segmentThreshold = 'all';
        const diameterFilter = document.getElementById('stirrupFormDiameterFilter');
        const steelFilter = document.getElementById('stirrupFormSteelFilter');
        const segmentFilter = document.getElementById('stirrupFormSegmentFilter');
        if (diameterFilter) diameterFilter.value = 'all';
        if (steelFilter) steelFilter.value = 'all';
        if (segmentFilter) segmentFilter.value = 'all';
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

    document.getElementById('stirrupFormSelectButton')?.addEventListener('click', () => {
        const selectedName = stirrupFormPickerState?.selectedName;
        if (selectedName) {
            applyStirrupFormSelection(selectedName);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isStirrupFormModalOpen()) {
            closeStirrupFormModal();
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key === LOCAL_STORAGE_BF2D_FORMS_KEY) {
            refreshStirrupNameSelects();
            if (isStirrupFormModalOpen()) {
                renderStirrupFormModalList();
            }
        }
    });

    window.addEventListener('bf2dSavedFormsUpdated', () => {
        refreshStirrupNameSelects();
        if (isStirrupFormModalOpen()) {
            renderStirrupFormModalList();
        }
    });

                            // Event listeners
    document.getElementById('addZoneButton')?.addEventListener('click', () => addZone());
                            document.getElementById('maxZonesInput')?.addEventListener('input', (e) => updateMaxZones(e.target.value));
                            const maxZonesEl = document.getElementById('maxZonesInput');
                            if (maxZonesEl) {
                                updateMaxZones(maxZonesEl.value);
                            }
    document.getElementById('zonesPerLabelInput')?.addEventListener('input', (e) => updateZonesPerLabel(e.target.value));
                            const zonesPerLabelEl = document.getElementById('zonesPerLabelInput');
    if (zonesPerLabelEl) {
        updateZonesPerLabel(zonesPerLabelEl.value);
    }
    document.getElementById('loadSampleBasketBtn')?.addEventListener('click', () => loadSampleBasket());
    document.getElementById('saveOrderButton')?.addEventListener('click', () => saveCurrentOrder());
    document.getElementById('openSavedOrdersButton')?.addEventListener('click', () => openSavedOrdersModal());
    document.getElementById('savedOrdersFilterInput')?.addEventListener('input', () => renderSavedOrdersList());
    document.getElementById('generateButton').addEventListener('click', () => {
                        generateBvbsCodeAndBarcode();
                        updateLabelPreview();
                        const codes = getBvbsCodes();
                        if (codes.length > 0) {
                            generateBarcodeToLabel(codes[0], '');
                            if (codes.length > 1) {
                                generateBarcodeToLabel(codes[1], '2');
                            }
                        }
                        });

                            document.getElementById('buegelname2')?.addEventListener('input', () => updateGenerateButtonState());
			
			
			
			
                            document.querySelectorAll('.copy-bvbs-btn')?.forEach(btn => {
                                btn.addEventListener('click', async () => {
                                    const target = btn.getAttribute('data-target');
                                    const output = document.getElementById(target)?.value.trim();
                                    if (output) {
                                        try {
                                            await navigator.clipboard.writeText(output);
                                            showFeedback('copyFeedback', 'Code in die Zwischenablage kopiert!', 'success', 3000);
                                        } catch (err) {
                                            console.error('Fehler beim Kopieren: ', err);
                                            showFeedback('copyFeedback', 'Fehler beim Kopieren.', 'error', 3000);
                                        }
                                    }
                                });
                            });
                            document.querySelectorAll('.open-qr-btn')?.forEach(btn => {
                                btn.addEventListener('click', () => {
                                    const target = btn.getAttribute('data-target');
                                    const label = btn.getAttribute('data-label') || '';
                                    if (!target) {
                                        return;
                                    }
                                    const code = document.getElementById(target)?.value.trim();
                                    if (code) {
                                        openQrModalWithCode(code, label);
                                    } else {
                                        showFeedback('barcodeError', window.i18n?.t?.('Kein BVBS-Code vorhanden.') || 'Kein BVBS-Code vorhanden.', 'warning', 4000);
                                    }
                                });
                            });
                            document.getElementById('downloadSvgButton')?.addEventListener('click', () => {
                                const svgElement = document.getElementById('cagePreviewSvg');
                                if (!svgElement) return;
                                const svgString = new XMLSerializer().serializeToString(svgElement);
                                const blob = new Blob([svgString], { type: 'image/svg+xml' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'korb_vorschau.svg';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            });
                            document.querySelectorAll('.download-label-btn')?.forEach(btn => {
                                btn.addEventListener('click', () => {
                                    const target = btn.getAttribute('data-target');
                                    if (target) downloadLabelAsPng(target);
                                });
                            });
                            const qrModal = document.getElementById('qrModal');
                            if (qrModal) {
                                qrModal.addEventListener('click', (event) => {
                                    if (event.target === qrModal) {
                                        closeQrModal();
                                    }
                                });
                            }
                            document.getElementById('printLabelButton')?.addEventListener('click', () => {
                                if (getBvbsCodes().length === 0) {
                                    showFeedback('barcodeError', 'Bitte generieren Sie zuerst den Code, um das Label zu drucken.', 'warning', 5000);
                                    return;
                                }
                                window.print();
                            });
                            document.getElementById('showZplButton')?.addEventListener('click', () => openZplModal());
                            document.getElementById('editLabelLayoutButton')?.addEventListener('click', () => toggleLabelDesignMode());
                            document.getElementById('openTemplateManagerButton')?.addEventListener('click', () => openTemplateManagerModal());
			    document.getElementById('saveCurrentTemplateButton')?.addEventListener('click', () => saveCurrentTemplate());
			    document.getElementById('downloadTemplatesButton')?.addEventListener('click', () => downloadTemplatesAsJson());
                            document.getElementById('deleteAllTemplatesButton')?.addEventListener('click', () => deleteAllTemplatesFromModal());
                            document.getElementById('clearDebugLogButton')?.addEventListener('click', () => {
                                const debugInfoEl = document.getElementById('barcodeDebugInfo');
                                if (debugInfoEl) debugInfoEl.textContent = '';
                                console.clear();
                                showFeedback('barcodeError', 'Debug-Log gelöscht.', 'info', 2000);
                            });

                            document.getElementById('view2dBtn')?.addEventListener('click', () => {
                                document.getElementById('cagePreviewSvgContainer').style.display = 'block';
                                document.getElementById('viewer3dContainer').style.display = 'none';
                                document.getElementById('view2dBtn').classList.add('active');
                                document.getElementById('view3dBtn').classList.remove('active');
                            });

                            document.getElementById('view3dBtn')?.addEventListener('click', () => {
                                document.getElementById('cagePreviewSvgContainer').style.display = 'none';
                                document.getElementById('viewer3dContainer').style.display = 'block';
                                document.getElementById('view2dBtn').classList.remove('active');
                                document.getElementById('view3dBtn').classList.add('active');
                                // May need to trigger a resize/render of the 3D view
                                if(window.viewer3d) {
                                    window.viewer3d.onResize();
                                }
                            });
                            // Initial validation and rendering
                            const inputsToValidateOnLoad = [{
			        id: 'gesamtlange',
			        min: 1,
			        type: 'int',
			        info: 'Gesamtlänge in mm (min. 1)'
			    }, {
			        id: 'anzahl',
			        min: 1,
			        type: 'int',
			        info: 'Anzahl Körbe (min. 1)'
			    }, {
			        id: 'langdrahtDurchmesser',
			        min: 1,
			        type: 'int',
			        info: 'Längsdraht-Ø in mm (min. 1)'
			    }, {
			        id: 'anfangsueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Anfangsüberstand in mm (min. 0)'
			    }, {
			        id: 'endueberstand',
			        min: 0,
			        type: 'int',
			        info: 'Endüberstand in mm (min. 0)'
			    }];
			    inputsToValidateOnLoad.forEach(input => {
			        const el = document.getElementById(input.id);
			        if (el) {
			            el.addEventListener('input', () => validateNumberInput(el, input.min, input.type, input.info));
			            validateNumberInput(el, input.min, input.type, input.info);
			        }
			    });
			// ganz unten im DOMContentLoaded-Callback
                        updateLabelPreview();
                        const initialCodes = getBvbsCodes();
                        if (initialCodes.length > 0) {
                            generateBarcodeToLabel(initialCodes[0], '');
                            if (initialCodes.length > 1) {
                                generateBarcodeToLabel(initialCodes[1], '2');
                            }
                        }
			
                            renderAllZones();
                            updateAddZoneButtonState();
                            drawCagePreview();
                            // 1) Label mit Feldern befüllen
                            updateLabelPreview();
                            // 2) echten Barcode erzeugen (SVG im PDF417‑Card und Canvas im Label)
                            generateBvbsCodeAndBarcode();
                            updateGenerateButtonState();
			
			    
			    // Check library status after a short delay to ensure it's loaded
                            setTimeout(() => {
			        updateBarcodeStatus();
                                if (!checkBarcodeLibraryStatus()) {
                                    updateBarcodeDebugInfo('bwip-js Bibliothek nicht verfügbar');
                                } else {
                                    updateBarcodeDebugInfo('bwip-js Bibliothek erfolgreich geladen');
                                }
                            }, 1000);
                        });
			
			
                        function generateBarcodeToLabel(text, idSuffix = '') {
                        const container = document.getElementById('labelBarcodeContainer' + idSuffix);
                        if (!container) {
                        console.error('Kein Label‑Container gefunden!');
                        return;
                        }
                        container.innerHTML = '';

                        const img = document.getElementById('labelBarcodeImage' + idSuffix);
                        const txt = document.getElementById('labelBarcodeText' + idSuffix);
                        if (img) img.style.display = 'none';
                        if (txt) txt.style.display = 'none';
			
			// create a new canvas
			const canvas = document.createElement('canvas');
			try {
                        bwipjs.toCanvas(canvas, {
                        bcid:        'pdf417',    // Barcode‑Typ
                        text:        text,        // Dein BVBS‑Code
                        scaleX:      3,           // breit
                        scaleY:      4,           // hoch
                        height:      15,          // Stirrup‑Höhe
                        includetext: false        // kein Text unterm Barcode
                        });
			container.appendChild(canvas);
			} catch (err) {
                        console.error('Barcode Label Fehler:', err);
                        // als Fallback einfach den rohen Text anzeigen
                        if (txt) {
                        txt.textContent = text;
                        txt.style.display = 'block';
                        }
                        }
                        }

                        function generateZplForLabel(idSuffix = '') {
                            const getText = (id) => document.getElementById(id + idSuffix)?.textContent || '';
                            const pos = getText('labelPosnr');
                            const komm = getText('labelKommNr');
                            const name = getText('labelBuegelname');
                            const proj = getText('labelProjekt');
                            const auftrag = getText('labelAuftrag');
                            const laenge = getText('labelGesamtlange');
                            const codes = getBvbsCodes();
                            const code = idSuffix === '2' ? (codes[1] || '') : (codes[0] || '');

                            let zpl = '^XA\n';
                            zpl += `^FO20,20^A0N,40,40^FDPos: ${pos}^FS\n`;
                            zpl += `^FO20,70^A0N,30,30^FD${komm}^FS\n`;
                            zpl += `^FO20,110^A0N,30,30^FD${name}^FS\n`;
                            zpl += `^FO20,150^A0N,30,30^FDProjekt: ${proj}^FS\n`;
                            zpl += `^FO20,190^A0N,30,30^FDAuftrag: ${auftrag}^FS\n`;
                            zpl += `^FO20,230^A0N,30,30^FDL\xC3\xA4nge: ${laenge}^FS\n`;
                            if (code) {
                                zpl += `^FO20,270^B7N,4,3^FD${code}^FS\n`;
                            }
                            zpl += '^XZ';
                            return zpl;
                        }
			
			
