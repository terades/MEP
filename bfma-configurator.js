/* global i18n, showFeedback */
(function () {
    const STORAGE_KEY = 'bfmaSavedMeshes';
    const state = {
        header: { p: '1', l: 5000, b: 2000, n: 1, e: 0, g: 'B500A', m: 'Q257', s: 0, v: '', a: '' },
        yBars: [], xBars: [], eBars: [],
        bending: { active: false, direction: 'Gy', sequence: [] },
        datasetText: '', errors: [],
        summary: { totalWeight: 0, yCount: 0, xCount: 0, eCount: 0 }
    };
    let barIdCounter = 0, bendingSegmentIdCounter = 0, initialized = false;
    let weightAutoUpdate = true;

    // --- Helper functions ---
    function createBar(type) { /* ... */ return {id: ++barIdCounter}; }
    function addBar(type) { /* ... */ updateAll(); }
    function removeBar(type, id) { /* ... */ updateAll(); }
    function createBendingSegment() { /* ... */ return {id: ++bendingSegmentIdCounter}; }
    function addBendingSegment() { /* ... */ updateAll(); }
    function removeBendingSegment(id) { /* ... */ updateAll(); }
    function parseSpacing(e_string) { /* ... */ return [0,0]; }

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
    function renderBarTables() { /* ... */ }
    function renderBendingTable() { /* ... */ }
    function renderSvgPreview(forThumbnail = false) { /* ... returns SVG string if forThumbnail */ return ''; }
    function renderValidationErrors() { /* ... */ }
    function updateSummaryUI() { /* ... */ }

    function populateSavedMeshesSelect() {
        const select = document.getElementById('bfmaSavedShapes');
        if(!select) return;
        const meshes = readSavedMeshes();
        const names = Object.keys(meshes).sort();
        select.innerHTML = '<option value="">Gespeicherte Matte auswählen…</option>';
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
        select.disabled = names.length === 0;
        document.getElementById('bfmaLoadShapeButton').disabled = names.length === 0;
        document.getElementById('bfmaDeleteShapeButton').disabled = names.length === 0;
    }

    // --- Core Logic ---
    function calculateSummary() { /* ... */ }
    function buildAbsDataset() { /* ... */ return ""; }
    function validateState() { /* ... */ return []; }

    function generateThumbnail() {
        const svgString = renderSvgPreview(true);
        return `data:image/svg+xml;base64,${btoa(svgString)}`;
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

    function loadSelectedMesh() {
        const select = document.getElementById('bfmaSavedShapes');
        const name = select.value;
        if (!name) return;
        const meshes = readSavedMeshes();
        const saved = meshes[name];
        if (saved) {
            // Simple state assignment, might need more robust merging
            Object.assign(state, JSON.parse(JSON.stringify(saved.state)));
            document.getElementById('bfmaShapeName').value = name;
            updateAll();
            alert(`Matte "${name}" geladen.`);
        }
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
        // renderBarTables();
        // renderBendingTable();
        renderSvgPreview();
        calculateSummary();
        updateSummaryUI();
        state.errors = validateState();
        // renderValidationErrors();
        if (state.errors.length === 0) {
            state.datasetText = buildAbsDataset();
            const outputEl = document.getElementById('bfmaDatasetOutput');
            if (outputEl) outputEl.value = state.datasetText.replace(/@/g, '@\n');
        } else {
            // ...
        }
    }

    // --- Event Listeners ---
    function attachStorageListeners() {
        document.getElementById('bfmaSaveShapeButton')?.addEventListener('click', saveCurrentMesh);
        document.getElementById('bfmaLoadShapeButton')?.addEventListener('click', loadSelectedMesh);
        document.getElementById('bfmaDeleteShapeButton')?.addEventListener('click', deleteSelectedMesh);
    }
    function attachHeaderListeners() { /* ... */ }
    function attachTabListeners() { /* ... */ }
    function attachActionListeners() { /* ... */ }
    function attachImportListeners() { /* ... */ }

    function init() {
        if (initialized) return;
        const view = document.getElementById('bfmaView');
        if (!view) return;

        // attachHeaderListeners();
        // attachTabListeners();
        // attachActionListeners();
        // attachImportListeners();
        attachStorageListeners();
        populateSavedMeshesSelect();

        addBar('Y');
        addBar('X');
        initialized = true;
        updateAll();
    }

    window.bfmaConfigurator = { init };
    document.addEventListener('DOMContentLoaded', init);
})();
