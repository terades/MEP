import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Helper Functions ---
function parseNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    const normalized = String(value ?? '').trim().replace(/,/g, '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getBarPositions(bar, totalDimension, offsetValue) {
    const e = bar.e || '';
    const initialOffset = parseNumber(offsetValue);
    let positions = [];

    if (e.includes(',')) { // Format "mm,n"
        const [spacing, count] = e.split(',').map(s => s.trim()).map(parseNumber);
        if (spacing > 0 && count > 0) {
            for (let i = 0; i < count; i++) {
                positions.push(initialOffset + i * spacing);
            }
            return positions;
        }
    }

    if (e.includes(';')) { // Format "mm;mm;..."
        const spacings = e.split(';').map(s => s.trim()).map(parseNumber);
        let currentPos = initialOffset;
        positions.push(currentPos);
        for (const s of spacings) {
            currentPos += s;
            positions.push(currentPos);
        }
        return positions;
    }

    // Default case: 'e' is a single number (spacing) or empty
    const spacing = parseNumber(e);
    if (spacing > 0) {
        const count = Math.floor((totalDimension - initialOffset) / spacing) + 1;
        for (let i = 0; i < count; i++) {
            positions.push(initialOffset + i * spacing);
        }
    } else { // No valid spacing info, place one bar at the offset
        positions.push(initialOffset);
    }
    return positions;
}


// --- 3D Viewer State and Functions ---
const DEFAULT_DIRECTION = new THREE.Vector3(0.5, -0.6, 0.6).normalize();
const DEFAULT_DISTANCE = 8000;

const state = {
    initialized: false,
    container: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    grid: null,
    meshGroup: null,
    currentBounds: null
};

function animate() {
    if (!state.renderer || !state.scene || !state.camera) return;
    requestAnimationFrame(animate);
    if (state.controls) {
        state.controls.update();
    }
    state.renderer.render(state.scene, state.camera);
}

function ensureInit() {
    if (state.initialized) return true;
    const container = document.getElementById('bfmaPreview3d');
    if (!container) return false;

    state.container = container;
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0xf4f6f9);

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    state.camera = new THREE.PerspectiveCamera(55, aspect > 0 ? aspect : 1, 0.1, 100000);
    state.camera.position.copy(DEFAULT_DIRECTION.clone().multiplyScalar(DEFAULT_DISTANCE));
    state.camera.lookAt(0, 0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    state.renderer.setPixelRatio(window.devicePixelRatio || 1);
    state.renderer.setSize(container.clientWidth, container.clientHeight);
    container.innerHTML = '';
    container.appendChild(state.renderer.domElement);

    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.08;

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    state.scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(1000, -800, 1500);
    state.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-900, 1000, 900);
    state.scene.add(fillLight);

    const grid = new THREE.GridHelper(10000, 100, 0xb8b8b8, 0xe0e0e0);
    grid.rotation.x = Math.PI / 2;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    state.scene.add(grid);
    state.grid = grid;

    window.addEventListener('resize', onResize, false);
    state.initialized = true;
    animate();
    return true;
}

function onResize() {
    if (!state.initialized) return;
    const { container, camera, renderer } = state;
    if (!container || !camera || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

function disposeCurrentMesh() {
    if (!state.meshGroup) return;
    state.scene.remove(state.meshGroup);
    state.meshGroup.traverse(child => {
        if (child.isMesh) {
            child.geometry?.dispose();
            child.material?.dispose();
        }
    });
    state.meshGroup = null;
}

function fitCameraToBounds(box) {
    if (!box || box.isEmpty() || !state.camera || !state.controls) return;

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const center = sphere.center;
    const radius = sphere.radius;

    const camera = state.camera;
    const fov = camera.fov * (Math.PI / 180);
    const distance = Math.abs(radius / Math.sin(fov / 2));
    const direction = camera.position.clone().sub(center).normalize();
    if(direction.lengthSq() < 0.001) {
        direction.copy(DEFAULT_DIRECTION);
    }
    const newPosition = center.clone().add(direction.multiplyScalar(distance * 1.5));

    camera.position.copy(newPosition);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    state.controls.target.copy(center);
    state.controls.update();
}

function zoomToFit() {
    if (state.currentBounds) {
        fitCameraToBounds(state.currentBounds);
    }
}

function update(meshData) {
    if (!ensureInit() || !meshData) return;
    disposeCurrentMesh();

    const { header, yBars, xBars } = meshData;
    if (!header || !yBars || !xBars || (yBars.length === 0 && xBars.length === 0)) {
        state.grid.visible = true; // Show grid even if there's no mesh
        return;
    }
    state.grid.visible = true;

    const meshLength = parseNumber(header.l); // Dimension along Y
    const meshWidth = parseNumber(header.b);  // Dimension along X

    const group = new THREE.Group();
    const boundingBox = new THREE.Box3();
    boundingBox.makeEmpty();

    const yMaterial = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.6, roughness: 0.4 });
    const xMaterial = new THREE.MeshStandardMaterial({ color: 0xdb2777, metalness: 0.6, roughness: 0.4 });

    let maxDiameterY = 0;
    yBars.forEach(bar => maxDiameterY = Math.max(maxDiameterY, parseNumber(bar.d)));

    // Y-Bars (Längsstäbe): run along Y, are positioned across X
    yBars.forEach(bar => {
        const diameter = parseNumber(bar.d);
        if (diameter <= 0) return;
        const radius = diameter / 2;
        const barLength = parseNumber(bar.l) || meshLength;
        const positionsX = getBarPositions(bar, meshWidth, bar.x);
        const doubleBarSpacing = diameter * 1.1;

        positionsX.forEach(posX => {
            for (let i = 0; i < (parseNumber(bar.z) || 1); i++) {
                const offset = i * doubleBarSpacing;
                const zPos = radius; // Bottom of bar sits on z=0
                const start = new THREE.Vector3(posX + offset, 0, zPos);
                const end = new THREE.Vector3(posX + offset, barLength, zPos);
                const path = new THREE.LineCurve3(start, end);
                const tube = new THREE.TubeGeometry(path, 2, radius, 8);
                const mesh = new THREE.Mesh(tube, yMaterial);
                group.add(mesh);
                boundingBox.expandByPoint(start);
                boundingBox.expandByPoint(end);
            }
        });
    });

    // X-Bars (Querstäbe): run along X, are positioned across Y
    xBars.forEach(bar => {
        const diameter = parseNumber(bar.d);
        if (diameter <= 0) return;
        const radius = diameter / 2;
        const barLength = parseNumber(bar.l) || meshWidth;
        const positionsY = getBarPositions(bar, meshLength, bar.y);
        const doubleBarSpacing = diameter * 1.1;

        positionsY.forEach(posY => {
            for (let i = 0; i < (parseNumber(bar.z) || 1); i++) {
                const offset = i * doubleBarSpacing;
                const zPos = maxDiameterY + radius; // Sits on top of Y bars
                const start = new THREE.Vector3(0, posY + offset, zPos);
                const end = new THREE.Vector3(barLength, posY + offset, zPos);
                const path = new THREE.LineCurve3(start, end);
                const tube = new THREE.TubeGeometry(path, 2, radius, 8);
                const mesh = new THREE.Mesh(tube, xMaterial);
                group.add(mesh);
                boundingBox.expandByPoint(start);
                boundingBox.expandByPoint(end);
            }
        });
    });

    if (boundingBox.isEmpty()) {
        boundingBox.setFromCenterAndSize(
            new THREE.Vector3(meshWidth / 2, meshLength / 2, 0),
            new THREE.Vector3(meshWidth, meshLength, Math.max(maxDiameterY, 10))
        );
    }

    const center = new THREE.Vector3();
    boundingBox.getCenter(center);
    group.position.sub(center);

    state.scene.add(group);
    state.meshGroup = group;

    const centeredBox = boundingBox.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(center.negate()));
    state.currentBounds = centeredBox;

    fitCameraToBounds(state.currentBounds);
}

function init() {
    ensureInit();
}

if (typeof window !== 'undefined') {
    window.bfmaViewer3D = {
        init,
        update,
        onResize,
        zoomToFit
    };
}
