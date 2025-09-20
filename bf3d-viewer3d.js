import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
    const state = {
        initialized: false,
        container: null,
        scene: null,
        camera: null,
        renderer: null,
        controls: null,
        meshGroup: null,
        currentBounds: null
    };

    function animate() {
        if (!state.renderer || !state.scene || !state.camera) return;
        requestAnimationFrame(animate);
        state.controls.update();
        state.renderer.render(state.scene, state.camera);
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

        state.controls = new OrbitControls(state.camera, state.renderer.domElement);
        state.controls.enableDamping = true;

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        state.scene.add(ambient);
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
        keyLight.position.set(1, 1, 1);
        state.scene.add(keyLight);

        const grid = new THREE.GridHelper(2000, 20, 0xcccccc, 0xdddddd);
        state.scene.add(grid);

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

        const fov = state.camera.fov * (Math.PI / 180);
        const distance = Math.abs(radius / Math.sin(fov / 2));
        const direction = state.camera.position.clone().sub(center).normalize();

        const newPosition = center.clone().add(direction.multiplyScalar(distance * 1.6));
        state.camera.position.copy(newPosition);
        state.controls.target.copy(center);
        state.controls.update();
    }

    function update(configuratorState) {
        if (!ensureInit() || !configuratorState) return;
        disposeCurrentMesh();

        const { points, header } = configuratorState;
        if (!points || points.length < 2) {
            return;
        }

        const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);

        const diameter = Math.max(1, header.d || 10);
        const tubeRadius = diameter / 2;

        const tubeGeometry = new THREE.TubeGeometry(curve, Math.max(2, points.length * 8), tubeRadius, 12, false);
        const material = new THREE.MeshStandardMaterial({ color: 0x6c757d, metalness: 0.7, roughness: 0.5 });
        const mesh = new THREE.Mesh(tubeGeometry, material);

        state.meshGroup = new THREE.Group();
        state.meshGroup.add(mesh);
        state.scene.add(state.meshGroup);

        const boundingBox = new THREE.Box3().setFromObject(state.meshGroup);
        state.currentBounds = boundingBox;
        fitCameraToBounds(boundingBox);
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
