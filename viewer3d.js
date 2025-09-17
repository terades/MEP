import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;

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
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Placeholder Geometry
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

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

    const width = container.clientWidth;
    const height = container.clientHeight;

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
    basketData.zones.forEach(zone => {
        const stirrupRadius = (zone.dia / 2) * scale;
        const stirrupPitch = zone.pitch * scale;

        for (let i = 0; i < zone.num; i++) {
            currentZ += stirrupPitch;
            if (currentZ > scaledLength / 2) break;

            const stirrup = createStirrup(scaledWidth, scaledHeight, stirrupRadius, stirrupMaterial);
            stirrup.position.z = currentZ;
            basketGroup.add(stirrup);
        }
    });

    scene.add(basketGroup);
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


// Expose functions to global scope
window.viewer3d = {
    init,
    update,
    onResize
};
