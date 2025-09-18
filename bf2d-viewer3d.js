import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class ArcCurve3 extends THREE.Curve {
    constructor(center, radius, startAngle, endAngle) {
        super();
        this.center = center.clone();
        this.radius = radius;
        this.startAngle = startAngle;
        this.endAngle = endAngle;
    }

    getPoint(t, target = new THREE.Vector3()) {
        const angle = THREE.MathUtils.lerp(this.startAngle, this.endAngle, t);
        target.set(
            this.center.x + Math.cos(angle) * this.radius,
            this.center.y + Math.sin(angle) * this.radius,
            this.center.z
        );
        return target;
    }
}

const DEFAULT_DIRECTION = new THREE.Vector3(0.78, -0.82, 0.58).normalize();
const DEFAULT_DISTANCE = 1600;

const state = {
    initialized: false,
    container: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    grid: null,
    tubeMesh: null,
    shouldAutoFit: true,
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
    if (state.initialized) {
        return true;
    }

    const container = document.getElementById('bf2dPreview3d');
    if (!container) {
        return false;
    }

    state.container = container;
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0xf4f6f9);

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    state.camera = new THREE.PerspectiveCamera(55, aspect > 0 ? aspect : 1, 0.1, 100000);
    state.camera.position.copy(DEFAULT_DIRECTION.clone().multiplyScalar(DEFAULT_DISTANCE));
    state.camera.lookAt(0, 0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(window.devicePixelRatio || 1);
    state.renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
    container.innerHTML = '';
    container.appendChild(state.renderer.domElement);

    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.08;
    state.controls.enablePan = true;
    state.controls.addEventListener('start', () => {
        state.shouldAutoFit = false;
    });

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    state.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(600, -420, 920);
    state.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-540, 620, 540);
    state.scene.add(fillLight);

    const grid = new THREE.GridHelper(4000, 40, 0xb8b8b8, 0xe0e0e0);
    grid.rotation.x = Math.PI / 2;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach(material => {
        material.opacity = 0.35;
        material.transparent = true;
    });
    state.scene.add(grid);
    state.grid = grid;

    window.addEventListener('resize', onResize);

    state.initialized = true;
    state.shouldAutoFit = true;
    animate();
    return true;
}

function onResize() {
    if (!state.initialized || !state.container || !state.renderer || !state.camera) {
        return;
    }
    const width = Math.max(state.container.clientWidth, 1);
    const height = Math.max(state.container.clientHeight, 1);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height);
}

function disposeCurrentMesh() {
    if (!state.tubeMesh) return;
    state.scene.remove(state.tubeMesh);
    if (state.tubeMesh.geometry) {
        state.tubeMesh.geometry.dispose();
    }
    if (Array.isArray(state.tubeMesh.material)) {
        state.tubeMesh.material.forEach(material => material?.dispose?.());
    } else if (state.tubeMesh.material && typeof state.tubeMesh.material.dispose === 'function') {
        state.tubeMesh.material.dispose();
    }
    state.tubeMesh = null;
}

function toVector3(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return new THREE.Vector3(0, 0, 0);
    }
    return new THREE.Vector3(point.x, point.y, point.z || 0);
}

function buildCurveFromSegments(segments) {
    const curvePath = new THREE.CurvePath();
    const boundingBox = new THREE.Box3();
    boundingBox.makeEmpty();
    let subdivisions = 0;
    let hasCurve = false;

    segments.forEach(segment => {
        if (!segment || typeof segment !== 'object') {
            return;
        }
        if (segment.type === 'line') {
            const start = toVector3(segment.start);
            const end = toVector3(segment.end);
            if (start.distanceToSquared(end) < 1e-6) {
                boundingBox.expandByPoint(start);
                return;
            }
            curvePath.add(new THREE.LineCurve3(start, end));
            boundingBox.expandByPoint(start);
            boundingBox.expandByPoint(end);
            subdivisions += 1;
            hasCurve = true;
        } else if (segment.type === 'arc') {
            const radius = Number(segment.radius) || 0;
            const startAngle = Number(segment.startAngle);
            const endAngle = Number(segment.endAngle);
            if (!(radius > 0) || !Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
                return;
            }
            const center = toVector3(segment.center);
            const arcCurve = new ArcCurve3(center, radius, startAngle, endAngle);
            curvePath.add(arcCurve);
            const steps = Math.min(32, Math.max(4, Math.round(segment.subdivisions) || 12));
            arcCurve.getPoints(steps).forEach(point => boundingBox.expandByPoint(point));
            subdivisions += steps;
            hasCurve = true;
        }
    });

    if (!hasCurve) {
        return null;
    }

    return { curvePath, boundingBox, subdivisions: Math.max(subdivisions, 8) };
}

function fitCameraToBounds(box, { useDefaultDirection = false, immediate = false } = {}) {
    if (!box || !state.camera || !state.controls) {
        return;
    }

    const bounds = box.clone();
    if (bounds.isEmpty()) {
        resetCameraToDefault();
        return;
    }

    const sphere = new THREE.Sphere();
    bounds.getBoundingSphere(sphere);
    const radius = Math.max(sphere.radius, 1);
    const center = sphere.center;

    const camera = state.camera;
    const controls = state.controls;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = camera.aspect || 1;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitHeightDistance = radius / Math.sin(verticalFov / 2);
    const fitWidthDistance = radius / Math.sin(horizontalFov / 2);
    const distance = Math.max(fitHeightDistance, fitWidthDistance, radius * 1.2);

    const direction = useDefaultDirection
        ? DEFAULT_DIRECTION.clone()
        : camera.position.clone().sub(controls.target).normalize();
    if (!Number.isFinite(direction.length()) || direction.lengthSq() === 0) {
        direction.copy(DEFAULT_DIRECTION);
    }

    const offsetDistance = distance * 1.2;
    const newPosition = center.clone().add(direction.multiplyScalar(offsetDistance));

    camera.position.copy(newPosition);
    controls.target.copy(center);
    controls.update();

    camera.near = Math.max(0.1, offsetDistance / 500);
    camera.far = Math.max(camera.near * 200, offsetDistance * 6);
    camera.updateProjectionMatrix();
}

function resetCameraToDefault() {
    if (!state.camera || !state.controls) return;
    const target = new THREE.Vector3(0, 0, 0);
    const position = DEFAULT_DIRECTION.clone().multiplyScalar(DEFAULT_DISTANCE);
    state.camera.position.copy(position);
    state.controls.target.copy(target);
    state.controls.update();
    state.camera.updateProjectionMatrix();
}

function update(data) {
    if (!ensureInit()) {
        return;
    }

    const hadMesh = Boolean(state.tubeMesh);
    disposeCurrentMesh();
    state.currentBounds = null;

    if (!data || !Array.isArray(data.pathSegments) || !data.pathSegments.length) {
        return;
    }

    const diameter = Number(data.diameter) || 0;
    const radius = Math.max(0, diameter / 2);
    if (radius <= 0) {
        return;
    }

    const curveInfo = buildCurveFromSegments(data.pathSegments);
    if (!curveInfo) {
        return;
    }

    const { curvePath, boundingBox, subdivisions } = curveInfo;

    if (Array.isArray(data.points)) {
        data.points.forEach(point => {
            if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
                boundingBox.expandByPoint(new THREE.Vector3(point.x, point.y, 0));
            }
        });
    }

    boundingBox.expandByScalar(radius);

    const tubularSegments = Math.min(512, Math.max(16, Math.round(subdivisions * 2)));
    const radialSegments = 24;
    const geometry = new THREE.TubeGeometry(curvePath, tubularSegments, radius, radialSegments, false);
    const material = new THREE.MeshStandardMaterial({
        color: 0x69737d,
        metalness: 0.55,
        roughness: 0.35
    });

    const mesh = new THREE.Mesh(geometry, material);
    state.scene.add(mesh);
    state.tubeMesh = mesh;
    state.currentBounds = boundingBox.clone();

    const autoFit = state.shouldAutoFit || !hadMesh;
    if (autoFit && state.currentBounds) {
        fitCameraToBounds(state.currentBounds, { useDefaultDirection: true, immediate: true });
    }
    state.shouldAutoFit = autoFit;
}

function prepareAutoFit() {
    if (!ensureInit()) return;
    state.shouldAutoFit = true;
    if (state.currentBounds) {
        fitCameraToBounds(state.currentBounds, { useDefaultDirection: true, immediate: true });
    } else {
        resetCameraToDefault();
    }
}

function resetView() {
    if (!ensureInit()) return;
    state.shouldAutoFit = true;
    if (state.currentBounds) {
        fitCameraToBounds(state.currentBounds, { useDefaultDirection: true, immediate: true });
    } else {
        resetCameraToDefault();
    }
}

function zoomToFit() {
    if (!ensureInit() || !state.currentBounds) return;
    state.shouldAutoFit = false;
    fitCameraToBounds(state.currentBounds, { useDefaultDirection: false, immediate: true });
}

function init() {
    ensureInit();
}

if (typeof window !== 'undefined') {
    window.bf2dViewer3D = {
        init,
        update,
        onResize,
        prepareAutoFit,
        resetView,
        zoomToFit
    };
}
