import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

class PlanarArcCurve3 extends THREE.Curve {
    constructor(center, radius, axisX, axisY, startAngle, endAngle) {
        super();
        this.center = center.clone();
        this.radius = radius;
        this.axisX = axisX.clone().normalize();
        this.axisY = axisY.clone().normalize();
        this.startAngle = startAngle;
        this.endAngle = endAngle;
    }

    getPoint(t, target = new THREE.Vector3()) {
        const angle = THREE.MathUtils.lerp(this.startAngle, this.endAngle, t);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        target.copy(this.center);
        target.add(this.axisX.clone().multiplyScalar(this.radius * cos));
        target.add(this.axisY.clone().multiplyScalar(this.radius * sin));
        return target;
    }
}

(function () {
    const state = {
        initialized: false,
        container: null,
        scene: null,
        camera: null,
        renderer: null,
        controls: null,
        meshGroup: null,
        labelRenderer: null,
        labelRoot: null,
        currentBounds: null
    };

    function animate() {
        if (!state.renderer || !state.scene || !state.camera) return;
        requestAnimationFrame(animate);
        state.controls.update();
        state.renderer.render(state.scene, state.camera);
        if (state.labelRenderer) {
            state.labelRenderer.render(state.scene, state.camera);
        }
    }

    function ensureInit() {
        if (state.initialized) return true;
        const container = document.getElementById('bf3dPreview3d');
        if (!container) return false;

        state.container = container;
        state.scene = new THREE.Scene();
        state.scene.background = new THREE.Color(0xf4f6f9);

        const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
        state.camera = new THREE.PerspectiveCamera(50, aspect > 0 ? aspect : 1, 0.1, 100000);
        state.camera.position.set(500, 400, 600);
        state.camera.lookAt(0, 0, 0);

        state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        state.renderer.setPixelRatio(window.devicePixelRatio || 1);
        state.renderer.setSize(container.clientWidth, container.clientHeight);
        container.innerHTML = '';
        container.appendChild(state.renderer.domElement);

        state.labelRenderer = new CSS2DRenderer();
        state.labelRenderer.setSize(container.clientWidth, container.clientHeight);
        state.labelRenderer.domElement.style.position = 'absolute';
        state.labelRenderer.domElement.style.top = '0';
        state.labelRenderer.domElement.style.left = '0';
        state.labelRenderer.domElement.style.pointerEvents = 'none';
        state.labelRenderer.domElement.classList.add('bf3d-label-layer');
        container.appendChild(state.labelRenderer.domElement);

        state.controls = new OrbitControls(state.camera, state.renderer.domElement);
        state.controls.enableDamping = true;

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        state.scene.add(ambient);
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
        keyLight.position.set(1, 1, 1);
        state.scene.add(keyLight);

        const grid = new THREE.GridHelper(2000, 20, 0xcccccc, 0xdddddd);
        state.scene.add(grid);

        state.labelRoot = new THREE.Group();
        state.scene.add(state.labelRoot);

        window.addEventListener('resize', onResize, false);
        state.initialized = true;
        animate();
        return true;
    }

    function onResize() {
        if (!state.initialized || !state.container.offsetParent) return;
        const { container, camera, renderer } = state;
        const width = container.clientWidth;
        const height = container.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        state.labelRenderer?.setSize(width, height);
    }

    function disposeCurrentMesh() {
        if (state.meshGroup) {
            state.scene.remove(state.meshGroup);
            state.meshGroup.traverse(child => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    child.material?.dispose();
                }
            });
            state.meshGroup = null;
        }
        clearLabels();
    }

    function fitCameraToBounds(box) {
        if (!box || box.isEmpty() || !state.camera || !state.controls) return;

        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const center = sphere.center;
        const radius = sphere.radius;

        const fov = state.camera.fov * (Math.PI / 180);
        const distance = Math.abs(radius / Math.sin(fov / 2));
        const direction = state.camera.position.clone().sub(center).normalize();

        const newPosition = center.clone().add(direction.multiplyScalar(distance * 1.6));
        state.camera.position.copy(newPosition);
        state.controls.target.copy(center);
        state.controls.update();
    }

    function clearLabels() {
        if (!state.labelRoot) return;
        const children = [...state.labelRoot.children];
        children.forEach(child => {
            if (child.element?.parentNode) {
                child.element.parentNode.removeChild(child.element);
            }
            state.labelRoot.remove(child);
        });
    }

    function toVector3(point) {
        if (!point) return new THREE.Vector3(0, 0, 0);
        return new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
    }

    function buildCurveFromSegments(segments) {
        const curvePath = new THREE.CurvePath();
        const boundingBox = new THREE.Box3();
        boundingBox.makeEmpty();
        let subdivisions = 0;

        segments.forEach(segment => {
            if (!segment) return;
            if (segment.type === 'line') {
                const start = toVector3(segment.start);
                const end = toVector3(segment.end);
                if (start.distanceToSquared(end) < 1e-4) {
                    boundingBox.expandByPoint(start);
                    return;
                }
                const lineCurve = new THREE.LineCurve3(start, end);
                curvePath.add(lineCurve);
                boundingBox.expandByPoint(start);
                boundingBox.expandByPoint(end);
                subdivisions += 1;
            } else if (segment.type === 'arc') {
                const radius = Number(segment.radius) || 0;
                if (!(radius > 0)) {
                    return;
                }
                const center = toVector3(segment.center);
                const axisX = toVector3(segment.axisX);
                const axisY = toVector3(segment.axisY);
                const startAngle = Number(segment.startAngle) || 0;
                const endAngle = Number(segment.endAngle) || 0;
                const arcCurve = new PlanarArcCurve3(center, radius, axisX, axisY, startAngle, endAngle);
                curvePath.add(arcCurve);
                const samples = Math.max(8, Math.round(Math.abs(Number(segment.angle) || (endAngle - startAngle)) / (Math.PI / 18)));
                arcCurve.getPoints(samples).forEach(point => boundingBox.expandByPoint(point));
                subdivisions += samples;
            }
        });

        if (!curvePath.curves.length) {
            return null;
        }

        return {
            curvePath,
            boundingBox,
            subdivisions: Math.max(subdivisions, 8)
        };
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
        el.className = `bf3d-dim-label${className ? ` ${className}` : ''}`;
        el.textContent = text;
        return new CSS2DObject(el);
    }

    function computeLineLabelPosition(segment, offsetDistance) {
        const start = toVector3(segment.start);
        const end = toVector3(segment.end);
        const midpoint = toVector3(segment.midpoint || {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
            z: (start.z + end.z) / 2
        });
        const direction = toVector3(segment.direction || { x: 0, y: 0, z: 0 });
        if (direction.lengthSq() === 0) {
            direction.copy(end).sub(start);
        }
        if (direction.lengthSq() === 0) {
            direction.set(1, 0, 0);
        }
        direction.normalize();
        const up = new THREE.Vector3(0, 1, 0);
        let side = new THREE.Vector3().crossVectors(direction, up);
        if (side.lengthSq() < 1e-4) {
            side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(1, 0, 0));
        }
        if (side.lengthSq() < 1e-4) {
            side.set(0, 0, 1);
        }
        side.normalize();
        const vertical = up.clone().multiplyScalar(offsetDistance * 0.4);
        side.multiplyScalar(offsetDistance * 0.6);
        return midpoint.add(side).add(vertical);
    }

    function computeArcLabelPosition(segment, offsetDistance) {
        const center = toVector3(segment.center);
        const axisX = toVector3(segment.axisX);
        if (axisX.lengthSq() === 0) {
            axisX.set(1, 0, 0);
        } else {
            axisX.normalize();
        }
        const axisY = toVector3(segment.axisY);
        if (axisY.lengthSq() === 0) {
            const fallback = Math.abs(axisX.dot(new THREE.Vector3(0, 1, 0))) > 0.9
                ? new THREE.Vector3(1, 0, 0)
                : new THREE.Vector3(0, 1, 0);
            axisY.crossVectors(fallback, axisX);
            if (axisY.lengthSq() === 0) {
                axisY.set(0, 0, 1);
            } else {
                axisY.normalize();
            }
        } else {
            axisY.normalize();
        }
        const startAngle = Number(segment.startAngle) || 0;
        const endAngle = Number(segment.endAngle) || 0;
        const midAngle = startAngle + (endAngle - startAngle) / 2;
        const radius = Number(segment.radius) || 0;
        const innerRadius = Math.max(radius * 0.5, radius - offsetDistance);
        const cos = Math.cos(midAngle);
        const sin = Math.sin(midAngle);
        return center
            .clone()
            .add(axisX.clone().multiplyScalar(innerRadius * cos))
            .add(axisY.clone().multiplyScalar(innerRadius * sin));
    }

    function addLineLabel(segment, offsetDistance) {
        const length = Number(segment.length) || toVector3(segment.start).distanceTo(toVector3(segment.end));
        const isOverhang = Boolean(segment.isOverhang);
        const label = createLabel(`${formatMeasurement(length)} mm`, isOverhang ? 'bf3d-dim-label--overhang' : '');
        label.position.copy(computeLineLabelPosition(segment, offsetDistance));
        state.labelRoot?.add(label);
    }

    function addArcLabel(segment, offsetDistance) {
        const radiusValue = formatMeasurement(Number(segment.radius) || 0);
        const label = createLabel(`R${radiusValue} mm`, 'bf3d-dim-label--arc');
        label.position.copy(computeArcLabelPosition(segment, offsetDistance));
        state.labelRoot?.add(label);
    }

    function addTotalLengthLabel(totalLength, bounds, offsetDistance) {
        if (!bounds) return;
        const label = createLabel(`L=${formatMeasurement(totalLength)} mm`, 'bf3d-dim-label--total');
        const center = bounds.getCenter(new THREE.Vector3());
        const position = new THREE.Vector3(center.x, bounds.max.y + offsetDistance * 0.6, center.z);
        label.position.copy(position);
        state.labelRoot?.add(label);
    }

    function updateDimensionLabels({ segments, totalLength, settings, tubeRadius, bounds }) {
        clearLabels();
        if (!settings?.showDimensions) {
            return;
        }
        if (!Array.isArray(segments) || !segments.length) {
            if (totalLength > 0 && bounds) {
                addTotalLengthLabel(totalLength, bounds, Math.max(tubeRadius * 3, 40));
            }
            return;
        }

        const offsetDistance = Math.max(tubeRadius * 3, 40);

        segments.forEach(segment => {
            if (segment.type === 'line') {
                if (!settings.showOverhangs && segment.isOverhang) {
                    return;
                }
                if (!settings.showZoneLengths && !segment.isOverhang) {
                    return;
                }
                addLineLabel(segment, offsetDistance);
            } else if (segment.type === 'arc') {
                addArcLabel(segment, offsetDistance * 0.9);
            }
        });

        if (totalLength > 0 && bounds) {
            addTotalLengthLabel(totalLength, bounds, offsetDistance);
        }
    }

    function update(configuratorState) {
        if (!ensureInit() || !configuratorState) return;
        disposeCurrentMesh();

        const diameter = Math.max(1, Number(configuratorState.header?.d) || 10);
        const tubeRadius = diameter / 2;
        const dimensionSettings = configuratorState.dimensionSettings || {};

        let curveInfo = null;
        const segments = configuratorState.segmentsInfo?.segments || [];
        if (segments.length) {
            curveInfo = buildCurveFromSegments(segments);
        }

        let curve = null;
        let boundingBox = null;
        let subdivisions = 0;

        if (curveInfo) {
            curve = curveInfo.curvePath;
            boundingBox = curveInfo.boundingBox;
            subdivisions = curveInfo.subdivisions;
        } else {
            const points = Array.isArray(configuratorState.points)
                ? configuratorState.points.map(point => toVector3(point))
                : [];
            if (points.length < 2) {
                return;
            }
            curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
            boundingBox = new THREE.Box3();
            points.forEach(point => boundingBox.expandByPoint(point));
            subdivisions = Math.max(2, points.length * 8);
        }

        const tubularSegments = Math.min(512, Math.max(32, Math.round(subdivisions * 2)));
        const radialSegments = 24;
        const tubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
        const material = new THREE.MeshStandardMaterial({ color: 0x6c757d, metalness: 0.7, roughness: 0.5 });
        const mesh = new THREE.Mesh(tubeGeometry, material);

        state.meshGroup = new THREE.Group();
        state.meshGroup.add(mesh);
        state.scene.add(state.meshGroup);

        const expandedBounds = boundingBox ? boundingBox.clone().expandByScalar(tubeRadius) : new THREE.Box3().setFromObject(state.meshGroup);
        state.currentBounds = expandedBounds;
        fitCameraToBounds(expandedBounds);

        const totalLength = configuratorState.segmentsInfo?.totalLength || 0;
        updateDimensionLabels({
            segments,
            totalLength,
            settings: dimensionSettings,
            tubeRadius,
            bounds: expandedBounds
        });
    }

    function init() {
        if (ensureInit()) {
            onResize();
        }
    }

    window.bf3dViewer = {
        init,
        update,
        onResize
    };
})();
