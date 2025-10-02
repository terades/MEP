import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const ZONE_COLORS = [0x2563eb, 0x9333ea, 0x059669, 0xf59e0b, 0xec4899, 0x0ea5e9];
const measurementMarkerGeometry = new THREE.SphereGeometry(1, 24, 24);

let scene, camera, renderer, controls;
let textureLoader, steelAlbedo, steelRoughness, steelNormal;
let currentBasketGroup = null;
let shouldAutoFit = true;
let clickableZoneGroups = [];
let viewerContainer = null;
let currentScale = 0.01;
let lastMainBarRadius = 0.05;
const measurementState = {
    active: false,
    points: [],
    markers: [],
    line: null,
    hoverMarker: null,
    labelPoint: null,
    controlsBackup: null
};
let measurementLabelEl = null;
let measurementValueEl = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isPointerDown = false;
let pointerMoved = false;
const pointerDownPosition = { x: 0, y: 0 };

function ensureMeasurementValueElement() {
    if (!viewerContainer) {
        return null;
    }
    if (!measurementValueEl) {
        measurementValueEl = document.createElement('div');
        measurementValueEl.className = 'viewer3d-measure-value';
        measurementValueEl.style.display = 'none';
        viewerContainer.appendChild(measurementValueEl);
    }
    return measurementValueEl;
}

function updateMeasurementValue(text, { isPreview = false } = {}) {
    const element = ensureMeasurementValueElement();
    if (!element) {
        return;
    }
    element.textContent = text;
    element.style.display = 'block';
    element.classList.toggle('is-preview', isPreview);
}

function hideMeasurementValue() {
    if (!measurementValueEl) {
        return;
    }
    measurementValueEl.textContent = '';
    measurementValueEl.style.display = 'none';
    measurementValueEl.classList.remove('is-preview');
}

function init() {
    const container = document.getElementById('viewer3dContainer');
    if (!container) {
        console.error("3D viewer container not found.");
        return;
    }

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    // Camera
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 1000);
    camera.position.set(6, 6, 10);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    viewerContainer = container;
    ensureMeasurementLabel();
    ensureMeasurementValueElement();

    if (renderer.domElement) {
        renderer.domElement.style.cursor = 'grab';
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointermove', onPointerMove);
        renderer.domElement.addEventListener('pointerup', onPointerUp);
        renderer.domElement.addEventListener('pointerleave', onPointerLeave);
        renderer.domElement.addEventListener('pointercancel', onPointerLeave);
    }

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 2;
    controls.maxDistance = 120;
    controls.addEventListener('start', () => {
        shouldAutoFit = false;
    });
    controls.target.set(0, 0, 0);
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(2, 5, 3);
    scene.add(directionalLight);

    // Textures & Environment
    textureLoader = new THREE.TextureLoader();
    steelAlbedo = textureLoader.load('textures/steel_albedo.jpg');
    steelRoughness = textureLoader.load('textures/steel_roughness.jpg');
    steelNormal = textureLoader.load('textures/steel_normal.jpg');

    new RGBELoader()
        .setPath('textures/')
        .load('venice_sunset_1k.hdr', function (texture) {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            scene.environment = texture;
        });

    // Ground grid
    const gridHelper = new THREE.GridHelper(60, 30, 0xd0d0d0, 0xe6e6e6);
    gridHelper.position.y = -1.2;
    const gridMaterials = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
    gridMaterials.forEach(mat => {
        mat.opacity = 0.35;
        mat.transparent = true;
    });
    scene.add(gridHelper);

    // Listeners
    window.addEventListener('resize', onResize);

    animate();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onResize() {
    const container = document.getElementById('viewer3dContainer');
    if (!container || !renderer) return;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);

    if (measurementState.active && measurementState.labelPoint) {
        updateMeasurementLabelPosition(measurementState.labelPoint);
    }
    if (measurementState.active) {
        updateHoverMarkerScale();
    }
}

function update(basketData) {
    // Clear existing basket
    const toRemove = [];
    scene.children.forEach(child => {
        if (child.isGroup && child.name === 'basketGroup') {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => scene.remove(child));
    currentBasketGroup = null;
    clickableZoneGroups = [];

    if (!basketData || !basketData.totalLength) {
        return;
    }

    const basketGroup = new THREE.Group();
    basketGroup.name = 'basketGroup';

    const basketWidth = 200; // in mm
    const basketHeight = 200; // in mm
    const scale = 0.01; // Scale down for easier viewing (1mm = 0.01 units)

    const totalLengthMm = Math.max(0, Number(basketData.totalLength) || 0);
    let initialOverhangMm = Math.max(0, Number(basketData.initialOverhang) || 0);
    let finalOverhangMm = Math.max(0, Number(basketData.finalOverhang) || 0);
    if (initialOverhangMm > totalLengthMm) {
        initialOverhangMm = totalLengthMm;
    }
    if (initialOverhangMm + finalOverhangMm > totalLengthMm) {
        finalOverhangMm = Math.max(0, totalLengthMm - initialOverhangMm);
    }
    const showOverhangs = basketData.showOverhangs !== false;
    const highlightedZoneIndex = Number.isFinite(Number(basketData.highlightedZoneDisplayIndex))
        ? Number(basketData.highlightedZoneDisplayIndex)
        : null;

    const scaledLength = totalLengthMm * scale;
    const scaledWidth = basketWidth * scale;
    const scaledHeight = basketHeight * scale;
    const mainBarRadius = Math.max((Number(basketData.mainBarDiameter) || 0) / 2 * scale, 0.005);
    const zoneBaseWidth = scaledWidth + mainBarRadius * 4;
    const zoneBaseHeight = scaledHeight + mainBarRadius * 4;
    const startReference = -scaledLength / 2;
    const zoneLimitMm = Math.max(0, totalLengthMm - finalOverhangMm);

    currentScale = scale;
    lastMainBarRadius = Math.max(mainBarRadius, 0.05);

    const mainBarMaterial = new THREE.MeshStandardMaterial({
        map: steelAlbedo,
        roughnessMap: steelRoughness,
        normalMap: steelNormal,
        color: 0xffffff,
        metalness: 0.9,
        roughness: 0.6
    });

    const mainBarGeometry = new THREE.CylinderGeometry(mainBarRadius, mainBarRadius, Math.max(scaledLength, 0.001), 12);
    const positions = [
        [scaledWidth / 2, scaledHeight / 2],
        [-scaledWidth / 2, scaledHeight / 2],
        [scaledWidth / 2, -scaledHeight / 2],
        [-scaledWidth / 2, -scaledHeight / 2]
    ];

    positions.forEach(pos => {
        const bar = new THREE.Mesh(mainBarGeometry, mainBarMaterial);
        bar.position.set(pos[0], pos[1], 0);
        bar.rotation.x = Math.PI / 2;
        basketGroup.add(bar);
    });

    if (showOverhangs && initialOverhangMm > 0) {
        const startOverlayMaterial = new THREE.MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.18, depthWrite: false });
        const startOverlay = new THREE.Mesh(new THREE.BoxGeometry(zoneBaseWidth, zoneBaseHeight, Math.max(initialOverhangMm * scale, 0.001)), startOverlayMaterial);
        startOverlay.position.set(0, 0, startReference + (initialOverhangMm * scale) / 2);
        startOverlay.renderOrder = -20;
        basketGroup.add(startOverlay);
    }

    if (showOverhangs && finalOverhangMm > 0) {
        const endOverlayMaterial = new THREE.MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.18, depthWrite: false });
        const endOverlay = new THREE.Mesh(new THREE.BoxGeometry(zoneBaseWidth, zoneBaseHeight, Math.max(finalOverhangMm * scale, 0.001)), endOverlayMaterial);
        endOverlay.position.set(0, 0, startReference + (totalLengthMm - finalOverhangMm / 2) * scale);
        endOverlay.renderOrder = -20;
        basketGroup.add(endOverlay);
    }

    let accumulatedZoneLengthMm = 0;
    const zonesArray = Array.isArray(basketData.zones) ? basketData.zones : [];
    zonesArray.forEach((zone, index) => {
        const displayIndex = index + 1;
        const zoneGroup = new THREE.Group();
        zoneGroup.name = `zoneGroup-${displayIndex}`;
        zoneGroup.userData = zoneGroup.userData || {};
        zoneGroup.userData.zoneDisplayIndex = displayIndex;

        const dia = Math.max(Number(zone?.dia) || 0, 0);
        const num = Math.max(Number(zone?.num) || 0, 0);
        const pitchMm = Math.max(Number(zone?.pitch) || 0, 0);
        const includeStandardStirrup = index === 0 && (num > 0 || pitchMm > 0);

        const stirrupRadius = Math.max((dia / 2) * scale, 0.0035);
        lastMainBarRadius = Math.max(lastMainBarRadius, stirrupRadius);

        const zoneStartMm = initialOverhangMm + accumulatedZoneLengthMm;
        const zoneLengthMm = num > 0 && pitchMm > 0 ? num * pitchMm : 0;
        const zoneEffectiveLengthMm = Math.max(0, Math.min(zoneLengthMm, zoneLimitMm - zoneStartMm));

        const baseColor = new THREE.Color(ZONE_COLORS[index % ZONE_COLORS.length]);
        const isHighlighted = highlightedZoneIndex === displayIndex;
        if (isHighlighted) {
            baseColor.offsetHSL(0, 0, 0.12);
        }
        const stirrupMaterial = new THREE.MeshStandardMaterial({
            map: steelAlbedo,
            roughnessMap: steelRoughness,
            normalMap: steelNormal,
            color: baseColor,
            metalness: 0.9,
            roughness: 0.6
        });

        if (zoneEffectiveLengthMm > 0) {
            const overlayMaterial = new THREE.MeshBasicMaterial({
                color: baseColor,
                transparent: true,
                opacity: isHighlighted ? 0.22 : 0.1,
                depthWrite: false
            });
            const overlay = new THREE.Mesh(new THREE.BoxGeometry(zoneBaseWidth, zoneBaseHeight, Math.max(zoneEffectiveLengthMm * scale, 0.001)), overlayMaterial);
            overlay.position.set(0, 0, startReference + (zoneStartMm + zoneEffectiveLengthMm / 2) * scale);
            overlay.renderOrder = -10;
            overlay.userData = overlay.userData || {};
            overlay.userData.zoneDisplayIndex = displayIndex;
            zoneGroup.add(overlay);
        }

        if (includeStandardStirrup) {
            const standardStirrup = createStirrup(scaledWidth, scaledHeight, stirrupRadius, stirrupMaterial);
            standardStirrup.position.z = startReference + zoneStartMm * scale;
            standardStirrup.userData = standardStirrup.userData || {};
            standardStirrup.userData.zoneDisplayIndex = displayIndex;
            standardStirrup.traverse(child => {
                if (!child) return;
                child.userData = child.userData || {};
                child.userData.zoneDisplayIndex = displayIndex;
            });
            zoneGroup.add(standardStirrup);
        }

        for (let i = 0; i < num; i++) {
            if (pitchMm <= 0) {
                break;
            }
            const stirrupPosMm = zoneStartMm + (i + 1) * pitchMm;
            if (stirrupPosMm > zoneLimitMm + 0.001) {
                break;
            }

            const stirrup = createStirrup(scaledWidth, scaledHeight, stirrupRadius, stirrupMaterial);
            stirrup.position.z = startReference + stirrupPosMm * scale;
            stirrup.userData = stirrup.userData || {};
            stirrup.userData.zoneDisplayIndex = displayIndex;
            stirrup.traverse(child => {
                if (!child) return;
                child.userData = child.userData || {};
                child.userData.zoneDisplayIndex = displayIndex;
            });
            zoneGroup.add(stirrup);
        }

        if (zoneGroup.children.length > 0) {
            basketGroup.add(zoneGroup);
            clickableZoneGroups.push(zoneGroup);
        }

        accumulatedZoneLengthMm += zoneLengthMm;
    });

    scene.add(basketGroup);
    currentBasketGroup = basketGroup;

    if (shouldAutoFit) {
        fitCameraToObject(basketGroup);
    }

    if (measurementState.active) {
        clearMeasurement({ keepHover: true });
        updateHoverMarkerScale();
    }

    updateHoverState();
}

function createStirrup(width, height, radius, material) {
    const stirrupGroup = new THREE.Group();

    const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 8), material);
    top.rotation.z = Math.PI / 2;
    top.position.y = height / 2;

    const bottom = top.clone();
    bottom.position.y = -height / 2;

    const left = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), material);
    left.position.x = -width / 2;

    const right = left.clone();
    right.position.x = width / 2;

    stirrupGroup.add(top, bottom, left, right);
    return stirrupGroup;
}

function ensureMeasurementLabel() {
    if (!viewerContainer) {
        return null;
    }
    if (!measurementLabelEl) {
        measurementLabelEl = document.createElement('div');
        measurementLabelEl.className = 'viewer3d-measure-label';
        measurementLabelEl.style.display = 'none';
        viewerContainer.appendChild(measurementLabelEl);
    }
    return measurementLabelEl;
}

function ensureMeasurementLine() {
    if (!measurementState.line) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        const material = new THREE.LineBasicMaterial({
            color: 0x1d4ed8,
            linewidth: 2,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false
        });
        const line = new THREE.Line(geometry, material);
        line.visible = false;
        line.renderOrder = 1000;
        scene?.add(line);
        measurementState.line = line;
    }
    return measurementState.line;
}

function clearMeasurement({ keepHover = false } = {}) {
    measurementState.points = [];
    measurementState.labelPoint = null;
    measurementState.markers.forEach(marker => {
        scene?.remove(marker);
        marker.material?.dispose?.();
    });
    measurementState.markers = [];

    if (measurementState.line) {
        measurementState.line.visible = false;
    }

    if (measurementLabelEl) {
        measurementLabelEl.style.display = 'none';
        measurementLabelEl.classList.remove('is-preview');
    }

    hideMeasurementValue();

    if (!keepHover && measurementState.hoverMarker) {
        scene?.remove(measurementState.hoverMarker);
        measurementState.hoverMarker.material?.dispose?.();
        measurementState.hoverMarker = null;
    } else if (measurementState.hoverMarker) {
        measurementState.hoverMarker.visible = false;
    }
}

function createMeasurementMarker(position, color, radius, opacity = 0.9) {
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthTest: false,
        depthWrite: false
    });
    const marker = new THREE.Mesh(measurementMarkerGeometry, material);
    marker.scale.setScalar(Math.max(radius, 0.001));
    marker.position.copy(position);
    marker.renderOrder = 1001;
    scene?.add(marker);
    return marker;
}

function updateHoverMarkerScale() {
    if (!measurementState.hoverMarker) {
        return;
    }
    const radius = Math.max(lastMainBarRadius * 1.2, 0.04);
    measurementState.hoverMarker.scale.setScalar(Math.max(radius, 0.001));
}

function updateHoverMarker(position) {
    if (!position) {
        return;
    }
    const radius = Math.max(lastMainBarRadius * 1.2, 0.04);
    if (!measurementState.hoverMarker) {
        const material = new THREE.MeshBasicMaterial({
            color: 0x2563eb,
            transparent: true,
            opacity: 0.35,
            depthTest: false,
            depthWrite: false
        });
        const marker = new THREE.Mesh(measurementMarkerGeometry, material);
        marker.renderOrder = 1000;
        marker.position.copy(position);
        marker.scale.setScalar(Math.max(radius, 0.001));
        scene?.add(marker);
        measurementState.hoverMarker = marker;
    } else {
        measurementState.hoverMarker.visible = true;
        measurementState.hoverMarker.position.copy(position);
        measurementState.hoverMarker.scale.setScalar(Math.max(radius, 0.001));
    }
}

function formatMeasurement(distanceUnits) {
    if (!Number.isFinite(distanceUnits)) {
        return '0 mm';
    }
    const millimetres = distanceUnits / Math.max(currentScale, 1e-6);
    const precision = millimetres >= 1000 ? 0 : millimetres >= 100 ? 1 : 2;
    return `${millimetres.toFixed(precision)} mm`;
}

function projectToScreen(point) {
    if (!camera || !viewerContainer) {
        return null;
    }
    const vector = point.clone().project(camera);
    const width = viewerContainer.clientWidth || 1;
    const height = viewerContainer.clientHeight || 1;
    return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (-vector.y * 0.5 + 0.5) * height,
        visible: vector.z >= -1 && vector.z <= 1
    };
}

function updateMeasurementLabelPosition(point) {
    const label = ensureMeasurementLabel();
    if (!label || !point) {
        return;
    }
    const screenPos = projectToScreen(point);
    if (!screenPos || !screenPos.visible) {
        label.style.display = 'none';
        return;
    }
    label.style.display = 'block';
    label.style.transform = `translate(-50%, -50%) translate(${screenPos.x}px, ${screenPos.y}px)`;
}

function updateMeasurementVisual(start, end, { isFinal = false } = {}) {
    if (!start || !end) {
        return;
    }
    const line = ensureMeasurementLine();
    const positionAttr = line.geometry.getAttribute('position');
    positionAttr.setXYZ(0, start.x, start.y, start.z);
    positionAttr.setXYZ(1, end.x, end.y, end.z);
    positionAttr.needsUpdate = true;
    line.visible = true;
    line.geometry.computeBoundingSphere();

    const distance = start.distanceTo(end);
    const measurementText = formatMeasurement(distance);
    const label = ensureMeasurementLabel();
    if (label) {
        label.textContent = measurementText;
        label.classList.toggle('is-preview', !isFinal);
        label.style.display = 'block';
    }
    updateMeasurementValue(measurementText, { isPreview: !isFinal });
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    measurementState.labelPoint = midpoint;
    updateMeasurementLabelPosition(midpoint);
}

function findMeasurementPoint(event) {
    if (!camera || !renderer) {
        return null;
    }
    if (event && !updatePointerFromEvent(event)) {
        return null;
    }
    raycaster.setFromCamera(pointer, camera);

    if (currentBasketGroup) {
        const intersection = raycaster.intersectObject(currentBasketGroup, true)[0];
        if (intersection) {
            return intersection.point.clone();
        }
    }

    const target = controls?.target ? controls.target.clone() : new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), target.y);
    const fallbackPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, fallbackPoint)) {
        return fallbackPoint;
    }
    return null;
}

function handleMeasurementPointerMove(event) {
    if (!measurementState.active) {
        return;
    }
    const point = findMeasurementPoint(event);
    if (!point) {
        if (measurementState.hoverMarker) {
            measurementState.hoverMarker.visible = false;
        }
        if (measurementState.points.length === 1) {
            if (measurementState.line) {
                measurementState.line.visible = false;
            }
            if (measurementLabelEl) {
                measurementLabelEl.style.display = 'none';
            }
        }
        return;
    }

    updateHoverMarker(point);
    if (measurementState.points.length === 1) {
        updateMeasurementVisual(measurementState.points[0], point, { isFinal: false });
    }
}

function handleMeasurementClick(event) {
    if (!measurementState.active) {
        return;
    }
    const point = findMeasurementPoint(event);
    if (!point) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (measurementState.points.length >= 2) {
        clearMeasurement({ keepHover: true });
    }

    const marker = createMeasurementMarker(point, 0x1d4ed8, Math.max(lastMainBarRadius * 1.35, 0.05), 0.85);
    measurementState.markers.push(marker);
    measurementState.points.push(point.clone());

    updateHoverMarker(point);

    if (measurementState.points.length === 1) {
        if (measurementState.line) {
            measurementState.line.visible = false;
        }
        if (measurementLabelEl) {
            measurementLabelEl.style.display = 'none';
        }
        return;
    }

    if (measurementState.points.length > 2) {
        measurementState.points = measurementState.points.slice(-2);
    }

    updateMeasurementVisual(measurementState.points[0], measurementState.points[1], { isFinal: true });
}

function setMeasurementActive(active) {
    const next = !!active;
    if (next === measurementState.active) {
        if (next) {
            clearMeasurement({ keepHover: true });
            updateHoverMarkerScale();
        }
        return measurementState.active;
    }

    measurementState.active = next;

    if (viewerContainer) {
        viewerContainer.classList.toggle('is-measuring', next);
    }

    if (next) {
        clearMeasurement({ keepHover: false });
        updateHoverMarkerScale();
        if (controls) {
            measurementState.controlsBackup = {
                enabled: controls.enabled,
                enableRotate: controls.enableRotate,
                enablePan: controls.enablePan,
                enableZoom: controls.enableZoom
            };
            controls.enabled = false;
            controls.enableRotate = false;
            controls.enablePan = false;
            controls.enableZoom = false;
        }
    } else {
        if (controls && measurementState.controlsBackup) {
            controls.enabled = measurementState.controlsBackup.enabled;
            controls.enableRotate = measurementState.controlsBackup.enableRotate;
            controls.enablePan = measurementState.controlsBackup.enablePan;
            controls.enableZoom = measurementState.controlsBackup.enableZoom;
        }
        measurementState.controlsBackup = null;
        clearMeasurement({ keepHover: false });
        hideMeasurementValue();
    }

    if (renderer?.domElement) {
        renderer.domElement.style.cursor = next ? 'crosshair' : 'grab';
    }

    return measurementState.active;
}


function updatePointerFromEvent(event) {
    if (!renderer || !renderer.domElement || !event) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
}

function onPointerDown(event) {
    if (!event || event.isPrimary === false) return;
    if (measurementState.active) {
        handleMeasurementPointerMove(event);
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor = 'crosshair';
        }
        return;
    }
    isPointerDown = true;
    pointerMoved = false;
    pointerDownPosition.x = event.clientX;
    pointerDownPosition.y = event.clientY;
    if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = 'grabbing';
    }
}

function onPointerMove(event) {
    if (!event || event.isPrimary === false) return;
    if (measurementState.active) {
        handleMeasurementPointerMove(event);
        updateHoverState(event);
        return;
    }
    if (isPointerDown) {
        const dx = event.clientX - pointerDownPosition.x;
        const dy = event.clientY - pointerDownPosition.y;
        if (!pointerMoved && Math.hypot(dx, dy) > 4) {
            pointerMoved = true;
        }
    }
    updateHoverState(event);
}

function onPointerUp(event) {
    if (!event || event.isPrimary === false) return;
    if (measurementState.active) {
        handleMeasurementPointerMove(event);
        handleMeasurementClick(event);
        pointerMoved = false;
        return;
    }
    const wasPointerDown = isPointerDown;
    isPointerDown = false;
    if (!renderer || !renderer.domElement) {
        pointerMoved = false;
        return;
    }

    const canvas = renderer.domElement;
    const isPrimaryAction = event.pointerType !== 'mouse' || event.button === 0 || event.button === -1;
    if (wasPointerDown && !pointerMoved && isPrimaryAction) {
        handleZonePick(event);
    }

    pointerMoved = false;
    updateHoverState(event);
}

function onPointerLeave() {
    if (measurementState.active) {
        if (measurementState.hoverMarker) {
            measurementState.hoverMarker.visible = false;
        }
        if (renderer && renderer.domElement) {
            renderer.domElement.style.cursor = 'crosshair';
        }
        return;
    }
    isPointerDown = false;
    pointerMoved = false;
    if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = 'grab';
    }
}

function handleZonePick(event) {
    if (!camera || !renderer || !clickableZoneGroups.length) return;
    if (!updatePointerFromEvent(event)) return;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(clickableZoneGroups, true);
    if (!intersects.length) return;

    const zoneIndex = findZoneDisplayIndex(intersects[0].object);
    if (Number.isFinite(zoneIndex) && zoneIndex > 0 && typeof window.focusZoneFromPreview === 'function') {
        window.focusZoneFromPreview(zoneIndex);
    }
}

function updateHoverState(event) {
    if (!renderer || !renderer.domElement) return;
    const canvas = renderer.domElement;

    if (measurementState.active) {
        canvas.style.cursor = 'crosshair';
        if (measurementState.labelPoint) {
            updateMeasurementLabelPosition(measurementState.labelPoint);
        }
        return;
    }

    if (isPointerDown) {
        canvas.style.cursor = 'grabbing';
        return;
    }

    if (!camera || !clickableZoneGroups.length) {
        canvas.style.cursor = 'grab';
        return;
    }

    if (!event) {
        canvas.style.cursor = 'grab';
        return;
    }

    if (!updatePointerFromEvent(event)) {
        canvas.style.cursor = 'grab';
        return;
    }

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(clickableZoneGroups, true);
    canvas.style.cursor = intersects.length > 0 ? 'pointer' : 'grab';
}

function findZoneDisplayIndex(object3D) {
    let current = object3D;
    while (current) {
        if (current.userData && Number.isFinite(current.userData.zoneDisplayIndex)) {
            return current.userData.zoneDisplayIndex;
        }
        current = current.parent;
    }
    return null;
}


function fitCameraToObject(object, offset = 1.6) {
    if (!object || !camera || !controls) return;

    const boundingBox = new THREE.Box3().setFromObject(object);
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (!Number.isFinite(maxDim) || maxDim === 0) {
        return;
    }

    const fitDistance = (maxDim / 2) / Math.tan((Math.PI * camera.fov) / 360);
    const distance = fitDistance * offset;
    const direction = new THREE.Vector3(1, 0.8, 1).normalize();

    camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    camera.near = Math.max(0.1, distance / 100);
    camera.far = Math.max(camera.near * 100, distance * 6);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
}

function prepareAutoFit() {
    shouldAutoFit = true;
    if (currentBasketGroup) {
        fitCameraToObject(currentBasketGroup);
    }
}


// Expose functions to global scope
window.viewer3d = {
    init,
    update,
    onResize,
    prepareAutoFit,
    toggleMeasurementMode: setMeasurementActive
};
