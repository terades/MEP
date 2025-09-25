import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

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
    labelRenderer: null,
    controls: null,
    grid: null,
    tubeMesh: null,
    labelRoot: null,
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
    if (state.labelRenderer) {
        state.labelRenderer.render(state.scene, state.camera);
    }
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
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    state.renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(state.renderer.domElement);

    state.labelRenderer = new CSS2DRenderer();
    state.labelRenderer.setSize(width, height);
    state.labelRenderer.domElement.style.position = 'absolute';
    state.labelRenderer.domElement.style.top = '0';
    state.labelRenderer.domElement.style.left = '0';
    state.labelRenderer.domElement.style.pointerEvents = 'none';
    state.labelRenderer.domElement.classList.add('bf2d-label-layer');
    container.appendChild(state.labelRenderer.domElement);

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

    state.labelRoot = new THREE.Group();
    state.scene.add(state.labelRoot);

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
    state.labelRenderer?.setSize(width, height);
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
    clearLabels();
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

function normalizeDimensionSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return {
            showDimensions: true,
            showZoneLengths: true,
            showOverhangs: true
        };
    }
    return {
        showDimensions: settings.showDimensions !== false,
        showZoneLengths: settings.showZoneLengths !== false,
        showOverhangs: settings.showOverhangs !== false
    };
}

function clearLabels() {
    if (!state.labelRoot) {
        return;
    }
    const children = [...state.labelRoot.children];
    children.forEach(child => {
        if (child.element?.parentNode) {
            child.element.parentNode.removeChild(child.element);
        }
        state.labelRoot.remove(child);
    });
}

function formatMeasurement(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function createLabel(text, className = '') {
    const el = document.createElement('div');
    el.className = `bf2d-dim-label${className ? ` ${className}` : ''}`;
    el.textContent = text;
    return new CSS2DObject(el);
}

function computeDimensionSegments(pathSegments) {
    const segments = [];
    let totalLength = 0;

    if (!Array.isArray(pathSegments)) {
        return { segments, totalLength };
    }

    pathSegments.forEach((segment, index) => {
        if (!segment || typeof segment !== 'object') {
            return;
        }
        if (segment.type === 'line') {
            const start = toVector3(segment.start);
            const end = toVector3(segment.end);
            const length = start.distanceTo(end);
            if (!Number.isFinite(length) || length <= 1e-3) {
                return;
            }
            const direction = end.clone().sub(start);
            if (direction.lengthSq() === 0) {
                return;
            }
            direction.normalize();
            const midpoint = start.clone().add(end).multiplyScalar(0.5);
            segments.push({
                type: 'line',
                index,
                start,
                end,
                length,
                midpoint,
                direction
            });
            totalLength += length;
        } else if (segment.type === 'arc') {
            const radius = Number(segment.radius) || 0;
            const startAngle = Number(segment.startAngle);
            const endAngle = Number(segment.endAngle);
            if (!(radius > 0) || !Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
                return;
            }
            const sweep = endAngle - startAngle;
            const angle = Math.abs(sweep);
            if (!Number.isFinite(angle) || angle <= 1e-5) {
                return;
            }
            const center = toVector3(segment.center);
            const length = radius * angle;
            totalLength += length;
            segments.push({
                type: 'arc',
                index,
                center,
                radius,
                startAngle,
                endAngle,
                midAngle: startAngle + sweep / 2,
                clockwise: segment.clockwise !== undefined ? !!segment.clockwise : sweep < 0,
                length,
                angleRad: angle,
                angleDeg: THREE.MathUtils.radToDeg(angle)
            });
        }
    });

    const lineSegments = segments.filter(segment => segment.type === 'line');
    if (lineSegments.length >= 1) {
        lineSegments[0].isOverhang = true;
        if (lineSegments.length > 1) {
            lineSegments[lineSegments.length - 1].isOverhang = true;
        }
    }

    return { segments, totalLength };
}

function computeLineLabelPosition(segment, offsetDistance, boundsCenter) {
    const midpoint = segment.midpoint.clone();
    const direction = segment.direction.clone();
    if (direction.lengthSq() === 0) {
        direction.set(1, 0, 0);
    }
    direction.normalize();
    let normal = new THREE.Vector3(-direction.y, direction.x, 0);
    if (normal.lengthSq() === 0) {
        normal = new THREE.Vector3(0, 0, 1);
    } else {
        normal.normalize();
    }

    const center = boundsCenter || new THREE.Vector3(0, 0, 0);
    const toMidpoint = midpoint.clone().sub(center);
    if (normal.dot(toMidpoint) < 0) {
        normal.multiplyScalar(-1);
    }

    const result = midpoint.clone();
    result.add(normal.multiplyScalar(offsetDistance));
    result.add(new THREE.Vector3(0, 0, offsetDistance * 0.05));
    return result;
}

function computeArcLabelPosition(segment, offsetDistance) {
    const center = segment.center.clone();
    const radius = segment.radius;
    const midAngle = segment.midAngle;
    const innerRadius = Math.max(radius * 0.45, radius - offsetDistance, radius * 0.25);
    const clampedRadius = Math.min(innerRadius, radius * 0.92);
    const cos = Math.cos(midAngle);
    const sin = Math.sin(midAngle);
    const position = new THREE.Vector3(
        center.x + clampedRadius * cos,
        center.y + clampedRadius * sin,
        center.z + offsetDistance * 0.05
    );
    return position;
}

function addLineLabel(segment, offsetDistance, boundsCenter) {
    const label = createLabel(
        `${formatMeasurement(segment.length)} mm`,
        segment.isOverhang ? 'bf2d-dim-label--overhang' : ''
    );
    label.position.copy(computeLineLabelPosition(segment, offsetDistance, boundsCenter));
    state.labelRoot?.add(label);
}

function addArcLabel(segment, offsetDistance) {
    const angleDeg = Number(segment.angleDeg);
    const label = createLabel(`${formatMeasurement(angleDeg)}°`, 'bf2d-dim-label--arc');
    label.position.copy(computeArcLabelPosition(segment, offsetDistance));
    state.labelRoot?.add(label);
}

function updateDimensionLabels({ segments, settings, tubeRadius, bounds }) {
    clearLabels();

    if (!settings?.showDimensions) {
        return;
    }

    const offsetDistance = Math.max((Number(tubeRadius) || 0) * 3, 40);

    if (!Array.isArray(segments) || !segments.length) {
        return;
    }

    const boundsCenter = bounds ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);

    segments.forEach(segment => {
        if (segment.type === 'line') {
            if (!settings.showOverhangs && segment.isOverhang) {
                return;
            }
            if (!settings.showZoneLengths && !segment.isOverhang) {
                return;
            }
            addLineLabel(segment, offsetDistance, boundsCenter);
        } else if (segment.type === 'arc') {
            addArcLabel(segment, offsetDistance * 0.8);
        }
    });
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

    const dimensionSettings = normalizeDimensionSettings(data.dimensionSettings);
    const dimensionData = computeDimensionSegments(data.pathSegments);

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

    updateDimensionLabels({
        segments: dimensionData.segments,
        settings: dimensionSettings,
        tubeRadius: radius,
        bounds: state.currentBounds
    });
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
