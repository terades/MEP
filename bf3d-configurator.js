/* global i18n, calculateChecksum */
(function () {
    if (!window.bf3dConfigurator) {
        window.bf3dConfigurator = {};
    }

    const state = {
        header: { p: '1', n: 1, d: 10, g: 'B500B', s: 40 },
        points: [],
        selectedPointId: null,
        history: [],
        historyIndex: -1,
        isDirty: false,
        geometry: {
            segments: [],
            totalLength: 0,
            boundingBox: null
        },
        ui: {
            snapGrid: false,
            gridSize: 10,
            forceIntegers: false,
        }
    };

    let pointIdCounter = 0;
    let scheduledUpdateHandle = null;
    const previewTransform = {
        scale: 1,
        offsetX: 0,
        offsetY: 0
    };

    function translate(key, fallback = key) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const translated = window.i18n.t(key);
            if (translated && translated !== key) {
                return translated;
            }
        }
        return fallback;
    }

    function vectorSubtract(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    function vectorAdd(a, b) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    function vectorScale(v, scalar) {
        return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
    }

    function vectorDot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    function vectorCross(a, b) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }

    function vectorLength(v) {
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }

    function vectorDistance(a, b) {
        return vectorLength(vectorSubtract(a, b));
    }

    function vectorNormalize(v) {
        const length = vectorLength(v);
        if (length === 0) {
            return { x: 0, y: 0, z: 0 };
        }
        return vectorScale(v, 1 / length);
    }

    function clonePoint(point) {
        return {
            x: Number(point?.x) || 0,
            y: Number(point?.y) || 0,
            z: Number(point?.z) || 0
        };
    }

    function computeCircle2D(p1, p2, p3) {
        const x1 = p1.x;
        const y1 = p1.y;
        const x2 = p2.x;
        const y2 = p2.y;
        const x3 = p3.x;
        const y3 = p3.y;

        const det = (x1 - x2) * (y2 - y3) - (x2 - x3) * (y1 - y2);
        if (Math.abs(det) < 1e-7) {
            return null;
        }

        const x1Sq = x1 * x1 + y1 * y1;
        const x2Sq = x2 * x2 + y2 * y2;
        const x3Sq = x3 * x3 + y3 * y3;

        const bc = (x1Sq - x2Sq) / 2;
        const cd = (x2Sq - x3Sq) / 2;

        const cx = (bc * (y2 - y3) - cd * (y1 - y2)) / det;
        const cy = ((x1 - x2) * cd - (x2 - x3) * bc) / det;
        const radius = Math.sqrt((cx - x1) * (cx - x1) + (cy - y1) * (cy - y1));

        if (!Number.isFinite(radius) || radius <= 0) {
            return null;
        }

        return {
            center: { x: cx, y: cy },
            radius
        };
    }

    function unwrapAngle(value, reference) {
        let result = value;
        while (result - reference > Math.PI) {
            result -= Math.PI * 2;
        }
        while (result - reference < -Math.PI) {
            result += Math.PI * 2;
        }
        return result;
    }

    function projectPointToArcBasis(point, center, axisX, axisY) {
        const relative = vectorSubtract(point, center);
        const radius = vectorLength(relative);
        if (!(radius > 0)) {
            return null;
        }
        const x = vectorDot(relative, axisX);
        const y = vectorDot(relative, axisY);
        const angle = Math.atan2(y, x);
        return { radius, angle };
    }

    function buildArcSegment(points, startIndex) {
        if (!Array.isArray(points) || startIndex + 2 >= points.length) {
            return null;
        }

        const p0 = points[startIndex];
        const p1 = points[startIndex + 1];
        const p2 = points[startIndex + 2];

        const baseV1 = vectorSubtract(p1, p0);
        const baseV2 = vectorSubtract(p2, p0);
        const planeNormalRaw = vectorCross(baseV1, baseV2);
        const planeNormalLength = vectorLength(planeNormalRaw);
        if (planeNormalLength < 1e-5) {
            return null;
        }
        const planeNormal = vectorScale(planeNormalRaw, 1 / planeNormalLength);

        const axisXInitial = vectorNormalize(vectorSubtract(p1, p0));
        if (vectorLength(axisXInitial) < 1e-6) {
            return null;
        }
        const axisYInitialRaw = vectorCross(planeNormal, axisXInitial);
        const axisYInitialLength = vectorLength(axisYInitialRaw);
        if (axisYInitialLength < 1e-6) {
            return null;
        }
        const axisYInitial = vectorScale(axisYInitialRaw, 1 / axisYInitialLength);

        const localP0 = { x: 0, y: 0 };
        const localP1 = {
            x: vectorDot(vectorSubtract(p1, p0), axisXInitial),
            y: vectorDot(vectorSubtract(p1, p0), axisYInitial)
        };
        const localP2 = {
            x: vectorDot(vectorSubtract(p2, p0), axisXInitial),
            y: vectorDot(vectorSubtract(p2, p0), axisYInitial)
        };

        const circle = computeCircle2D(localP0, localP1, localP2);
        if (!circle) {
            return null;
        }

        const centerLocal = circle.center;
        const center = vectorAdd(
            p0,
            vectorAdd(
                vectorScale(axisXInitial, centerLocal.x),
                vectorScale(axisYInitial, centerLocal.y)
            )
        );
        const radius = circle.radius;

        if (!(radius > 0) || !Number.isFinite(radius)) {
            return null;
        }

        const axisX = vectorNormalize(vectorSubtract(p0, center));
        if (vectorLength(axisX) < 1e-6) {
            return null;
        }
        const axisYRaw = vectorCross(planeNormal, axisX);
        const axisYLength = vectorLength(axisYRaw);
        if (axisYLength < 1e-6) {
            return null;
        }
        const axisY = vectorScale(axisYRaw, 1 / axisYLength);

        const toleranceRadius = Math.max(0.5, radius * 0.01);
        const angles = [];

        for (let idx = 0; idx < 3; idx++) {
            const point = points[startIndex + idx];
            const projection = projectPointToArcBasis(point, center, axisX, axisY);
            if (!projection) {
                return null;
            }
            if (Math.abs(projection.radius - radius) > toleranceRadius) {
                return null;
            }
            if (idx === 0) {
                angles.push(0);
            } else {
                const rawAngle = unwrapAngle(projection.angle, angles[angles.length - 1]);
                angles.push(rawAngle);
            }
        }

        const initialDelta = angles[1] - angles[0];
        if (Math.abs(initialDelta) < 1e-3) {
            return null;
        }
        const directionSign = initialDelta > 0 ? 1 : -1;
        let lastAngle = angles[angles.length - 1];
        let endIndex = startIndex + 2;

        for (let idx = startIndex + 3; idx < points.length; idx++) {
            const projection = projectPointToArcBasis(points[idx], center, axisX, axisY);
            if (!projection) {
                break;
            }
            if (Math.abs(projection.radius - radius) > toleranceRadius) {
                break;
            }
            const angle = unwrapAngle(projection.angle, lastAngle);
            const delta = angle - lastAngle;
            if (delta * directionSign <= 1e-4) {
                break;
            }
            angles.push(angle);
            lastAngle = angle;
            endIndex = idx;
        }

        const totalAngle = lastAngle - angles[0];
        const totalAngleAbs = Math.abs(totalAngle);
        if (totalAngleAbs < 0.05) { // ~3°
            return null;
        }

        if (endIndex - startIndex < 2 && totalAngleAbs < 0.35) {
            return null;
        }

        const length = radius * totalAngleAbs;

        return {
            segment: {
                type: 'arc',
                start: clonePoint(points[startIndex]),
                end: clonePoint(points[endIndex]),
                center: clonePoint(center),
                radius,
                startAngle: angles[0],
                endAngle: lastAngle,
                angle: totalAngle,
                normal: clonePoint(planeNormal),
                axisX: clonePoint(axisX),
                axisY: clonePoint(axisY),
                length
            },
            endIndex
        };
    }

    function computePathGeometry(points) {
        if (!Array.isArray(points) || points.length < 2) {
            return {
                segments: [],
                totalLength: 0,
                boundingBox: null
            };
        }

        const cleanPoints = points.map(clonePoint);
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        cleanPoints.forEach(point => {
            if (point.x < minX) minX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.z < minZ) minZ = point.z;
            if (point.x > maxX) maxX = point.x;
            if (point.y > maxY) maxY = point.y;
            if (point.z > maxZ) maxZ = point.z;
        });

        const segments = [];
        let index = 0;
        while (index < cleanPoints.length - 1) {
            const arcCandidate = buildArcSegment(cleanPoints, index);
            if (arcCandidate) {
                segments.push(arcCandidate.segment);
                index = arcCandidate.endIndex;
                continue;
            }

            const start = cleanPoints[index];
            const end = cleanPoints[index + 1];
            const length = vectorDistance(start, end);
            const midpoint = vectorScale(vectorAdd(start, end), 0.5);
            const direction = vectorNormalize(vectorSubtract(end, start));

            segments.push({
                type: 'line',
                start: clonePoint(start),
                end: clonePoint(end),
                length,
                midpoint: clonePoint(midpoint),
                direction: clonePoint(direction)
            });
            index += 1;
        }

        const lineIndices = segments
            .map((segment, idx) => (segment.type === 'line' ? idx : null))
            .filter(idx => idx !== null);
        if (lineIndices.length > 0) {
            segments[lineIndices[0]].isOverhang = true;
            const lastIndex = lineIndices[lineIndices.length - 1];
            segments[lastIndex].isOverhang = true;
        }

        const totalLength = segments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0);

        const boundingBox = (Number.isFinite(minX) && Number.isFinite(maxX))
            ? {
                min: { x: minX, y: minY, z: minZ },
                max: { x: maxX, y: maxY, z: maxZ }
            }
            : null;

        return {
            segments,
            totalLength,
            boundingBox
        };
    }

    function getDimensionSettings() {
        const showDimensions = document.getElementById('bf3dToggleDimensions')?.checked;
        const showZoneLengths = document.getElementById('bf3dToggleZoneLengths')?.checked;
        const showOverhangs = document.getElementById('bf3dToggleOverhangs')?.checked;

        return {
            showDimensions: showDimensions !== false,
            showZoneLengths: showZoneLengths !== false,
            showOverhangs: showOverhangs !== false
        };
    }

    function roundToPrecision(value, decimals = 3) {
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    function scheduleUpdate() {
        if (scheduledUpdateHandle) {
            cancelAnimationFrame(scheduledUpdateHandle);
        }
        scheduledUpdateHandle = requestAnimationFrame(() => {
            updateAll();
            scheduledUpdateHandle = null;
        });
    }

    function saveState() {
        // Clear redo history
        if (state.historyIndex < state.history.length - 1) {
            state.history = state.history.slice(0, state.historyIndex + 1);
        }

        // Push a deep copy of the current state
        state.history.push(JSON.parse(JSON.stringify({
            points: state.points,
            header: state.header
        })));

        // Limit history size
        if (state.history.length > 50) {
            state.history.shift();
        }

        state.historyIndex = state.history.length - 1;
    }

    function undo() {
        if (state.historyIndex > 0) {
            state.historyIndex--;
            const previousState = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
            state.points = previousState.points;
            state.header = previousState.header;
            pointIdCounter = Math.max(0, ...state.points.map(p => p.id));
            scheduleUpdate();
        }
    }

    function redo() {
        if (state.historyIndex < state.history.length - 1) {
            state.historyIndex++;
            const nextState = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
            state.points = nextState.points;
            state.header = nextState.header;
            pointIdCounter = Math.max(0, ...state.points.map(p => p.id));
            scheduleUpdate();
        }
    }

    function addPoint() {
        const lastPoint = state.points[state.points.length - 1];
        const newPoint = {
            id: ++pointIdCounter,
            x: lastPoint ? lastPoint.x : 0,
            y: lastPoint ? lastPoint.y + 100 : 0,
            z: lastPoint ? lastPoint.z : 0,
        };
        state.points.push(newPoint);
        state.selectedPointId = newPoint.id;
        saveState();
        scheduleUpdate();
    }

    function removeSelectedPoint() {
        if (state.selectedPointId === null) return;
        state.points = state.points.filter(p => p.id !== state.selectedPointId);
        state.selectedPointId = null;
        saveState();
        scheduleUpdate();
    }

    function renderPointTable() {
        const tbody = document.getElementById('bf3dPointTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (state.points.length === 0) {
            const row = tbody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 5;
            cell.textContent = 'Noch keine Punkte definiert.';
            cell.style.textAlign = 'center';
            return;
        }

        state.points.forEach((point, index) => {
            const row = tbody.insertRow();
            row.dataset.pointId = point.id;
            if (point.id === state.selectedPointId) {
                row.classList.add('selected');
            }

            row.addEventListener('click', () => {
                state.selectedPointId = point.id;
                scheduleUpdate();
            });

            const pointCell = row.insertCell();
            pointCell.textContent = index + 1;

            ['x', 'y', 'z'].forEach(axis => {
                const cell = row.insertCell();
                const input = document.createElement('input');
                input.type = 'number';
                input.value = point[axis];
                input.addEventListener('input', () => {
                    point[axis] = parseFloat(input.value) || 0;
                    saveState();
                    scheduleUpdate();
                });
                cell.appendChild(input);
            });

            const actionsCell = row.insertCell();
            // TODO: Add move up/down buttons
        });
    }

    function generateBf3dString() {
        if (state.points.length < 2) {
            return "Fehler: Mindestens 2 Punkte erforderlich.";
        }
        const h = state.header;
        const headerString = `BF3D@H@P${h.p}@N${h.n}@D${h.d}@G${h.g}@S${h.s}@`;

        let geometryString = 'G';
        let lastPoint = { x: 0, y: 0, z: 0 };

        for (const point of state.points) {
            let segment = '';
            // Round to avoid floating point issues, BVBS usually deals with integers or fixed decimals
            const currentPoint = {
                x: Math.round(point.x * 10) / 10,
                y: Math.round(point.y * 10) / 10,
                z: Math.round(point.z * 10) / 10,
            };

            if (currentPoint.x !== lastPoint.x) segment += `X${currentPoint.x}`;
            if (currentPoint.y !== lastPoint.y) segment += `Y${currentPoint.y}`;
            if (currentPoint.z !== lastPoint.z) segment += `Z${currentPoint.z}`;

            if (segment) {
                geometryString += `@${segment}`;
            }
            lastPoint = currentPoint;
        }
        geometryString += '@';

        const preChecksum = headerString + geometryString + 'C';
        if (typeof calculateChecksum !== 'function') {
            return "Fehler: Checksum-Funktion nicht gefunden.";
        }
        const checksum = calculateChecksum(preChecksum);
        return `${preChecksum}${checksum}@`;
    }


    function updateAll() {
        const headerInputs = [
            { key: 'p', id: 'bf3dPosition', type: 'string' },
            { key: 'n', id: 'bf3dQuantity', type: 'number' },
            { key: 'd', id: 'bf3dDiameter', type: 'number' },
            { key: 'g', id: 'bf3dSteelGrade', type: 'string' },
            { key: 's', id: 'bf3dBendingRoller', type: 'number' }
        ];

        headerInputs.forEach(({ key, id, type }) => {
            const el = document.getElementById(id);
            if (!el) return;
            const value = state.header[key];
            if (id === 'bf3dSteelGrade' && value && window.masterDataManager?.addValue) {
                window.masterDataManager.addValue('steelGrades', value);
            }
            if (id === 'bf3dBendingRoller' && Number.isFinite(Number(value)) && window.masterDataManager?.addValue) {
                window.masterDataManager.addValue('rollDiameters', Number(value));
            }
            if (el.tagName === 'SELECT') {
                const normalized = type === 'number' ? (Number.isFinite(Number(value)) ? String(Number(value)) : '') : (value ?? '').toString();
                el.value = normalized;
                if (normalized && el.value !== normalized) {
                    el.dataset.masterdataPendingValue = normalized;
                    if (typeof window.masterDataManager?.refreshSelects === 'function') {
                        window.masterDataManager.refreshSelects();
                    }
                }
            } else if (el.type === 'number') {
                el.value = Number.isFinite(Number(value)) ? Number(value) : 0;
            } else {
                el.value = (value ?? '').toString();
            }
        });

        renderPointTable();

        const removeBtn = document.getElementById('bf3dRemovePoint');
        if(removeBtn) {
            removeBtn.disabled = state.selectedPointId === null;
        }

        const output = document.getElementById('bf3dDatasetOutput');
        if(output) {
            output.value = generateBf3dString();
        }

        state.geometry = computePathGeometry(state.points);

        // Update 2D and 3D previews
        render2dPreview();
        if (window.bf3dViewer) {
            window.bf3dViewer.update({
                header: state.header,
                points: state.points,
                segmentsInfo: state.geometry,
                dimensionSettings: getDimensionSettings()
            });
        }
    }

    function worldToCanvas(pos) {
        const scale = previewTransform.scale || 1;
        return {
            x: previewTransform.offsetX + pos.x * scale,
            y: previewTransform.offsetY - pos.y * scale
        };
    }

    function canvasToWorld(pos) {
        const scale = previewTransform.scale || 1;
        if (scale === 0) {
            return { x: 0, y: 0 };
        }
        return {
            x: (pos.x - previewTransform.offsetX) / scale,
            y: (previewTransform.offsetY - pos.y) / scale
        };
    }

    let isDragging = false;
    let draggedPointId = null;

    function onCanvasMouseDown(e) {
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        for (const point of state.points) {
            const canvasPos = worldToCanvas(point);
            const dist = Math.hypot(mousePos.x - canvasPos.x, mousePos.y - canvasPos.y);
            if (dist < 10) { // Click radius
                isDragging = true;
                draggedPointId = point.id;
                state.selectedPointId = point.id;
                scheduleUpdate();
                return;
            }
        }
    }

    function onCanvasMouseMove(e) {
        if (!isDragging || draggedPointId === null) return;

        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        let worldPos = canvasToWorld(mousePos);
        const draggedPoint = state.points.find(p => p.id === draggedPointId);

        if (draggedPoint) {
            if (state.ui.snapGrid && state.ui.gridSize > 0) {
                worldPos.x = Math.round(worldPos.x / state.ui.gridSize) * state.ui.gridSize;
                worldPos.y = Math.round(worldPos.y / state.ui.gridSize) * state.ui.gridSize;
            }
            if (state.ui.forceIntegers) {
                worldPos.x = Math.round(worldPos.x);
                worldPos.y = Math.round(worldPos.y);
            }

            draggedPoint.x = worldPos.x;
            draggedPoint.y = worldPos.y;
            scheduleUpdate();
        }
    }

    function onCanvasMouseUp() {
        if (isDragging) {
            saveState();
        }
        isDragging = false;
        draggedPointId = null;
    }

    function render2dPreview() {
        const canvas = document.getElementById('bf3dPreview2d');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth || canvas.width || 600;
        const height = canvas.clientHeight || canvas.height || 400;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        state.points.forEach(point => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        });

        if (!Number.isFinite(minX)) {
            minX = -100;
            maxX = 100;
            minY = -100;
            maxY = 100;
        }

        const marginPx = 40;
        const worldWidth = Math.max(maxX - minX, 10);
        const worldHeight = Math.max(maxY - minY, 10);
        const availableWidth = Math.max(width - marginPx * 2, 20);
        const availableHeight = Math.max(height - marginPx * 2, 20);
        const scale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight);

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        previewTransform.scale = scale;
        previewTransform.offsetX = width / 2 - centerX * scale;
        previewTransform.offsetY = height / 2 + centerY * scale;

        // Draw grid
        ctx.strokeStyle = '#e9ecef';
        ctx.lineWidth = 1;
        const gridSize = Math.max(1, state.ui.gridSize);
        const gridStartX = Math.floor((minX - gridSize * 5) / gridSize) * gridSize;
        const gridEndX = Math.ceil((maxX + gridSize * 5) / gridSize) * gridSize;
        const gridStartY = Math.floor((minY - gridSize * 5) / gridSize) * gridSize;
        const gridEndY = Math.ceil((maxY + gridSize * 5) / gridSize) * gridSize;

        const gridSpacingPx = gridSize * scale;

        if (gridSpacingPx >= 4 && gridSpacingPx < 2000) {
            for (let gx = gridStartX; gx <= gridEndX; gx += gridSize) {
                const start = worldToCanvas({ x: gx, y: gridStartY });
                const end = worldToCanvas({ x: gx, y: gridEndY });
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
            }

            for (let gy = gridStartY; gy <= gridEndY; gy += gridSize) {
                const start = worldToCanvas({ x: gridStartX, y: gy });
                const end = worldToCanvas({ x: gridEndX, y: gy });
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
            }
        }

        // Draw path
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        state.points.forEach((point, index) => {
            const canvasPos = worldToCanvas(point);
            if (index === 0) {
                ctx.moveTo(canvasPos.x, canvasPos.y);
            } else {
                ctx.lineTo(canvasPos.x, canvasPos.y);
            }
        });
        ctx.stroke();

        // Draw points
        state.points.forEach(point => {
            const canvasPos = worldToCanvas(point);
            ctx.beginPath();
            ctx.arc(canvasPos.x, canvasPos.y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = point.id === state.selectedPointId ? '#dc3545' : '#007bff';
            ctx.fill();
        });
    }

    function init() {
        if (state.isDirty) return;

        const canvas = document.getElementById('bf3dPreview2d');
        if(canvas) {
            canvas.addEventListener('mousedown', onCanvasMouseDown);
            canvas.addEventListener('mousemove', onCanvasMouseMove);
            canvas.addEventListener('mouseup', onCanvasMouseUp);
            canvas.addEventListener('mouseout', onCanvasMouseUp); // Stop dragging if mouse leaves canvas
        }

        document.getElementById('bf3dAddPoint')?.addEventListener('click', addPoint);
        document.getElementById('bf3dRemovePoint')?.addEventListener('click', removeSelectedPoint);
        document.getElementById('bf3dAddStraight')?.addEventListener('click', addStraight);
        document.getElementById('bf3dAddArc')?.addEventListener('click', addArc);
        document.getElementById('bf3dSaveAbs')?.addEventListener('click', saveAbsFile);

        // View toggles
        const view2dBtn = document.getElementById('bf3dViewToggle2d');
        const view3dBtn = document.getElementById('bf3dViewToggle3d');
        const preview2d = document.getElementById('bf3dPreview2d');
        const preview3d = document.getElementById('bf3dPreview3d');

        view2dBtn?.addEventListener('click', () => {
            preview2d.style.display = 'block';
            preview3d.style.display = 'none';
            view2dBtn.classList.add('is-active');
            view3dBtn.classList.remove('is-active');
        });

        view3dBtn?.addEventListener('click', () => {
            preview2d.style.display = 'none';
            preview3d.style.display = 'block';
            view3dBtn.classList.add('is-active');
            view2dBtn.classList.remove('is-active');
            if (window.bf3dViewer) {
                window.bf3dViewer.init();
                window.bf3dViewer.update({
                    header: state.header,
                    points: state.points,
                    segmentsInfo: state.geometry,
                    dimensionSettings: getDimensionSettings()
                });
            }
        });


        // UI Toggles
        const snapGridCheckbox = document.getElementById('bf3dSnapGrid');
        if(snapGridCheckbox) snapGridCheckbox.addEventListener('change', (e) => state.ui.snapGrid = e.target.checked);

        const gridSizeInput = document.getElementById('bf3dGridSize');
        if(gridSizeInput) gridSizeInput.addEventListener('input', (e) => state.ui.gridSize = Math.max(1, parseInt(e.target.value) || 10));

        const forceIntegersCheckbox = document.getElementById('bf3dForceIntegers');
        if(forceIntegersCheckbox) forceIntegersCheckbox.addEventListener('change', (e) => state.ui.forceIntegers = e.target.checked);

        ['bf3dToggleDimensions', 'bf3dToggleZoneLengths', 'bf3dToggleOverhangs'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', () => {
                if (window.bf3dViewer) {
                    window.bf3dViewer.update({
                        header: state.header,
                        points: state.points,
                        segmentsInfo: state.geometry,
                        dimensionSettings: getDimensionSettings()
                    });
                }
            });
        });

        // Header inputs
        ['p:bf3dPosition', 'n:bf3dQuantity', 'd:bf3dDiameter', 'g:bf3dSteelGrade', 's:bf3dBendingRoller'].forEach(mapping => {
            const [key, id] = mapping.split(':');
            const el = document.getElementById(id);
            if (el) {
                const updateHeaderField = () => {
                    if (id === 'bf3dBendingRoller') {
                        const parsed = Number(parseFloat(el.value));
                        state.header[key] = Number.isFinite(parsed) ? parsed : 0;
                    } else if (el.type === 'number') {
                        state.header[key] = parseFloat(el.value);
                    } else {
                        state.header[key] = el.value;
                    }
                    saveState();
                    scheduleUpdate();
                };
                el.addEventListener('input', updateHeaderField);
                if (el.tagName === 'SELECT') {
                    el.addEventListener('change', updateHeaderField);
                }
            }
        });

        // Add a default starting point
        if (state.points.length === 0) {
            state.points.push({ id: ++pointIdCounter, x: 0, y: 0, z: 0 });
            state.points.push({ id: ++pointIdCounter, x: 0, y: 500, z: 0 });
        }
        saveState();
        scheduleUpdate();
        state.isDirty = true;
    }

    function saveAbsFile() {
        const text = document.getElementById('bf3dDatasetOutput').value;
        if (!text || text.startsWith('Fehler:')) {
            alert('Kein gültiger BVBS-Datensatz zum Speichern vorhanden.');
            return;
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bf3d_${state.header.p || 'pos'}.abs`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function addStraight() {
        const length = parseFloat(document.getElementById('bf3dStraightLength').value) || 0;
        const direction = document.getElementById('bf3dStraightDirection').value;
        const lastPoint = state.points[state.points.length - 1];
        if (!lastPoint || length === 0) return;

        const newPoint = { ...lastPoint, id: ++pointIdCounter };
        newPoint[direction] += length;

        state.points.push(newPoint);
        saveState();
        scheduleUpdate();
    }

    function addArc() {
        const radius = parseFloat(document.getElementById('bf3dArcRadius').value) || 0;
        const plane = document.getElementById('bf3dArcPlane').value;
        const directionSelect = document.getElementById('bf3dArcDirection');
        const directionValue = directionSelect ? directionSelect.value : 'ccw';
        const orientationSign = directionValue === 'cw' ? -1 : 1;

        const rollerDiameter = state.header.s || 0;
        if (radius <= rollerDiameter / 2) {
            alert(`Fehler: Der Radius (R=${radius}) muss größer als der halbe Biegerollendurchmesser (s/2 = ${rollerDiameter / 2}) sein.`);
            return;
        }

        if (radius <= 0) {
            return;
        }

        if (state.points.length < 2) {
            alert(translate('Fehler: Mindestens zwei Punkte sind erforderlich, um einen Bogen zu erstellen.'));
            return;
        }

        const p1 = state.points[state.points.length - 1];
        const p0 = state.points[state.points.length - 2];
        const tangentRaw = vectorSubtract(p1, p0);
        if (vectorLength(tangentRaw) < 1e-6) {
            alert(translate('Fehler: Der letzte Abschnitt ist zu kurz für einen Bogen.'));
            return;
        }

        let planeNormal;
        switch (plane) {
            case 'yz':
                planeNormal = { x: 1, y: 0, z: 0 };
                break;
            case 'xz':
                planeNormal = { x: 0, y: 1, z: 0 };
                break;
            case 'xy':
            default:
                planeNormal = { x: 0, y: 0, z: 1 };
                break;
        }

        // Project tangent into plane
        const normalUnit = vectorNormalize(planeNormal);
        const dot = vectorDot(tangentRaw, normalUnit);
        const tangentInPlane = vectorSubtract(tangentRaw, vectorScale(normalUnit, dot));
        const tangent = vectorNormalize(tangentInPlane);

        if (vectorLength(tangent) < 1e-6) {
            alert(translate('Fehler: Das letzte Segment muss in der gewählten Ebene liegen.'));
            return;
        }

        const perpendicular = vectorCross(normalUnit, tangent);
        const perpendicularLength = vectorLength(perpendicular);
        if (perpendicularLength < 1e-6) {
            alert(translate('Fehler: Das letzte Segment muss in der gewählten Ebene liegen.'));
            return;
        }

        const centerOffsetDir = vectorScale(perpendicular, orientationSign / perpendicularLength);
        const center = vectorAdd(p1, vectorScale(centerOffsetDir, radius));
        const startVector = vectorSubtract(p1, center);
        const startVectorLength = vectorLength(startVector);
        if (startVectorLength < 1e-6) {
            alert(translate('Fehler: Der letzte Abschnitt ist zu kurz für einen Bogen.'));
            return;
        }

        const baseCross = vectorCross(normalUnit, startVector);
        const numSegments = Math.max(6, Math.min(48, Math.round((Math.PI * radius) / 15)));
        const angleStep = (Math.PI / 2) / numSegments;

        for (let i = 1; i <= numSegments; i++) {
            const theta = orientationSign * angleStep * i;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const rotated = {
                x: startVector.x * cos + baseCross.x * sin,
                y: startVector.y * cos + baseCross.y * sin,
                z: startVector.z * cos + baseCross.z * sin
            };
            const newPoint = {
                id: ++pointIdCounter,
                x: roundToPrecision(center.x + rotated.x),
                y: roundToPrecision(center.y + rotated.y),
                z: roundToPrecision(center.z + rotated.z)
            };
            state.points.push(newPoint);
        }

        state.selectedPointId = state.points[state.points.length - 1].id;
        saveState();
        scheduleUpdate();
    }

    window.bf3dConfigurator = {
        onShow() {
            init();
        },
        getState() {
            return state;
        }
    };
})();
