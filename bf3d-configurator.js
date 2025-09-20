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
        ui: {
            snapGrid: false,
            gridSize: 10,
            forceIntegers: false,
        }
    };

    let pointIdCounter = 0;
    let scheduledUpdateHandle = null;

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
        renderPointTable();

        const removeBtn = document.getElementById('bf3dRemovePoint');
        if(removeBtn) {
            removeBtn.disabled = state.selectedPointId === null;
        }

        const output = document.getElementById('bf3dDatasetOutput');
        if(output) {
            output.value = generateBf3dString();
        }

        // Update 2D and 3D previews
        render2dPreview();
        if (window.bf3dViewer) {
             window.bf3dViewer.update(state);
        }
    }

    function worldToCanvas(pos) {
        const canvas = document.getElementById('bf3dPreview2d');
        const width = canvas.width;
        const height = canvas.height;
        const scale = 0.5; // Will be dynamic later
        const offsetX = width / 2;
        const offsetY = height / 2;
        return {
            x: offsetX + pos.x * scale,
            y: offsetY - pos.y * scale
        };
    }

    function canvasToWorld(pos) {
        const canvas = document.getElementById('bf3dPreview2d');
        const width = canvas.width;
        const height = canvas.height;
        const scale = 0.5; // Will be dynamic later
        const offsetX = width / 2;
        const offsetY = height / 2;
        return {
            x: (pos.x - offsetX) / scale,
            y: (pos.y - offsetY) / -scale
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
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);

        // For now, simple fixed scale and origin at center
        const scale = 0.5;
        const offsetX = width / 2;
        const offsetY = height / 2;

        // Draw grid
        ctx.strokeStyle = '#e9ecef';
        ctx.lineWidth = 1;
        const gridSize = state.ui.gridSize * scale;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
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
                window.bf3dViewer.update(state);
            }
        });


        // UI Toggles
        const snapGridCheckbox = document.getElementById('bf3dSnapGrid');
        if(snapGridCheckbox) snapGridCheckbox.addEventListener('change', (e) => state.ui.snapGrid = e.target.checked);

        const gridSizeInput = document.getElementById('bf3dGridSize');
        if(gridSizeInput) gridSizeInput.addEventListener('input', (e) => state.ui.gridSize = Math.max(1, parseInt(e.target.value) || 10));

        const forceIntegersCheckbox = document.getElementById('bf3dForceIntegers');
        if(forceIntegersCheckbox) forceIntegersCheckbox.addEventListener('change', (e) => state.ui.forceIntegers = e.target.checked);

        // Header inputs
        ['p:bf3dPosition', 'n:bf3dQuantity', 'd:bf3dDiameter', 'g:bf3dSteelGrade', 's:bf3dBendingRoller'].forEach(mapping => {
            const [key, id] = mapping.split(':');
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    state.header[key] = el.type === 'number' ? parseFloat(el.value) : el.value;
                    saveState();
                    scheduleUpdate();
                });
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

        const rollerDiameter = state.header.s || 0;
        if (radius <= rollerDiameter / 2) {
            alert(`Fehler: Der Radius (R=${radius}) muss größer als der halbe Biegerollendurchmesser (s/2 = ${rollerDiameter / 2}) sein.`);
            return;
        }

        if (radius === 0 || state.points.length < 1) return;

        const p1 = state.points[state.points.length - 1];
        const p0 = state.points.length > 1 ? state.points[state.points.length - 2] : {x: p1.x, y: p1.y - 1, z: p1.z}; // Assume initial direction if only one point

        // Simplified logic: assumes the arc starts tangentially from the last segment
        // A full implementation would be more complex, handling all orientations
        // For now, let's just add a 90 deg arc in the specified plane
        const numSegments = 8; // More segments for smoother curve
        const angleStep = (Math.PI / 2) / numSegments;
        let lastPoint = { ...p1 };

        for (let i = 1; i <= numSegments; i++) {
            const angle = i * angleStep;
            const newPoint = { id: ++pointIdCounter, x: lastPoint.x, y: lastPoint.y, z: lastPoint.z };

            // This is a simplified example assuming starting direction is +Y
            switch (plane) {
                case 'xy':
                    newPoint.x = p1.x + radius * Math.sin(angle);
                    newPoint.y = p1.y + radius * (1 - Math.cos(angle));
                    break;
                case 'yz':
                     newPoint.y = p1.y + radius * Math.sin(angle);
                     newPoint.z = p1.z + radius * (1 - Math.cos(angle));
                    break;
                case 'xz':
                    newPoint.x = p1.x + radius * Math.sin(angle);
                    newPoint.z = p1.z + radius * (1 - Math.cos(angle));
                    break;
            }
            state.points.push(newPoint);
            lastPoint = newPoint;
        }

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
