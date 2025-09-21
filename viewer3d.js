import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let currentBasketGroup = null;
let shouldAutoFit = true;
let clickableZoneGroups = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isPointerDown = false;
let pointerMoved = false;
const pointerDownPosition = { x: 0, y: 0 };

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.35);
    scene.add(hemiLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

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

    // --- Assumptions ---
    const basketWidth = 200; // in mm
    const basketHeight = 200; // in mm
    const scale = 0.01; // Scale down for easier viewing (1mm = 0.01 units)

    const scaledLength = basketData.totalLength * scale;
    const scaledWidth = basketWidth * scale;
    const scaledHeight = basketHeight * scale;
    const mainBarRadius = (basketData.mainBarDiameter / 2) * scale;

    const material = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
    const stirrupMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.5 });

    // Create 4 main bars
    const mainBarGeometry = new THREE.CylinderGeometry(mainBarRadius, mainBarRadius, scaledLength, 8);
    const positions = [
        [scaledWidth / 2, scaledHeight / 2],
        [-scaledWidth / 2, scaledHeight / 2],
        [scaledWidth / 2, -scaledHeight / 2],
        [-scaledWidth / 2, -scaledHeight / 2]
    ];

    positions.forEach(pos => {
        const bar = new THREE.Mesh(mainBarGeometry, material);
        bar.position.set(pos[0], pos[1], 0);
        bar.rotation.x = Math.PI / 2;
        basketGroup.add(bar);
    });

    // Create stirrups
    let currentZ = -scaledLength / 2;
    basketData.zones.forEach((zone, index) => {
        const stirrupRadius = (zone.dia / 2) * scale;
        const stirrupPitch = zone.pitch * scale;
        const displayIndex = index + 1;

        const zoneGroup = new THREE.Group();
        zoneGroup.name = `zoneGroup-${displayIndex}`;
        zoneGroup.userData = zoneGroup.userData || {};
        zoneGroup.userData.zoneDisplayIndex = displayIndex;

        for (let i = 0; i < zone.num; i++) {
            currentZ += stirrupPitch;
            if (currentZ > scaledLength / 2) break;

            const stirrup = createStirrup(scaledWidth, scaledHeight, stirrupRadius, stirrupMaterial);
            stirrup.position.z = currentZ;
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
    });

    scene.add(basketGroup);
    currentBasketGroup = basketGroup;

    if (shouldAutoFit) {
        fitCameraToObject(basketGroup);
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
    prepareAutoFit
};
