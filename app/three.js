// UCL, Bartlett, RC5
import * as THREE from "three";
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

import { createControls } from "./controls.js";
import { createWarpClient } from "../warp/warpClient.js";

import { initParamsUi } from "../sender/paramsUi.js";
import { initChatUi } from "../sender/chatUi.js";

if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons();
}

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 5);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 15, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0001;
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
scene.add(dirLight);

// Ground receiving shadows (nice grounding)
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

// Grid
const grid = new THREE.GridHelper(50, 50, 0x888888, 0xdddddd);
grid.position.y = -0.01;
scene.add(grid);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));



// Outline
const outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    scene,
    camera
);
outlinePass.edgeStrength = 4;
outlinePass.edgeThickness = 3;
outlinePass.edgeGlow = 0;
outlinePass.pulsePeriod = 0;
outlinePass.visibleEdgeColor.set(0x00aaff);
outlinePass.hiddenEdgeColor.set(0x00aaff);
composer.addPass(outlinePass);
const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms["resolution"].value.set(
    1 / (window.innerWidth * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1)),
    1 / (window.innerHeight * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1))
);
composer.addPass(fxaaPass);


// Better shadow
const gtaoPass = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtaoPass.enabled = true;

if (gtaoPass.params) {
    gtaoPass.params.intensity = 0.9;
    gtaoPass.params.radius = 0.35;
    gtaoPass.params.thickness = 1.0;
    gtaoPass.params.distanceFallOff = 1.0;
}
composer.addPass(gtaoPass);
composer.addPass(new OutputPass());



// Environment map
const loader = new HDRLoader();
const envMap = await loader.loadAsync('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/empty_warehouse_01_1k.hdr');
envMap.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = envMap;

//Controls
const controls = createControls({
    camera,
    renderer,
    scene,
    ui: {
        btnMove: document.getElementById("btnMove"),
        btnRotate: document.getElementById("btnRotate"),
        btnScale: document.getElementById("btnScale"),
        selectedName: document.getElementById("selectedName"),
    },
    onSelect: (obj) => {
        outlinePass.selectedObjects = obj ? [obj] : [];
    },
});


//UIs
const URL_MAIN = "wss://relay.curvf.com/ws";
const URL_BACKUP = "wss://warp-relay.qinzehaozln.workers.dev/ws";

const statusText = document.getElementById("statusText");
const connectionDot = document.getElementById("connectionDot");

const loadingSpinner = document.getElementById("loadingSpinner");

function setLoadingProgress(p) {
    if (!loadingSpinner) return;
    const pct = Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 100);
    loadingSpinner.style.setProperty("--p", String(pct));
    loadingSpinner.setAttribute("data-pct", String(pct));
}


function setLoadingVisible(v) {
    if (!loadingSpinner) return;
    loadingSpinner.style.opacity = v ? "1" : "0.45";
}



function setDotState(state) {
    if (!connectionDot) return;
    connectionDot.classList.remove("connected", "connecting");
    if (state === "connected") connectionDot.classList.add("connected");
    else if (state === "connecting") connectionDot.classList.add("connecting");
}

let warpGroup = new THREE.Group();
warpGroup.name = "Warp Group";
scene.add(warpGroup);

// Material
const sharedMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.5,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
});

function clearWarpGeometries() {
    controls.detach?.();
    controls.clearPickables?.();

    for (let i = warpGroup.children.length - 1; i >= 0; i--) {
        const child = warpGroup.children[i];
        warpGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
    }
}


function setWarpGeometries(geometries) {
    clearWarpGeometries();

    for (let i = 0; i < geometries.length; i++) {
        const mesh = new THREE.Mesh(geometries[i], sharedMaterial);
        mesh.name = `Warp Mesh ${i}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        warpGroup.add(mesh);
        controls.addPickable?.(mesh);
    }
}

//sending parameters
let warpClientInstance = null;
let paramsUiHandle = null;

const initialRoom =
    new URLSearchParams(window.location.search).get("room") || "warp_test_local_001";

let currentRoom = initialRoom;

//init params sender
paramsUiHandle = initParamsUi({
    warp: {
        sendParams: () => false,
    },
    throttle: 50,
    sendAll: true,
    mappings: [
        { sliderId: "sHeight", valueId: "vHeight", key: "height" },
        { sliderId: "sRot", valueId: "vRot", key: "rotation" },
        { sliderId: "sSmoothness", valueId: "vSmoothness", key: "smoothness" },
        { sliderId: "sLength", valueId: "vLength", key: "length" },
        { sliderId: "sExpected top surface", valueId: "vExpected top surface", key: "expected_top_surface" },
        { sliderId: "sContraction of the form", valueId: "vContraction of the form", key: "contraction_of_the_form" },
        { sliderId: "sPosition of Contraction", valueId: "vPosition of Contraction", key: "position_of_contraction" },   
        { sliderId: "sthickness", valueId: "vThickness", key: "thickness" },     

    ],
});

//init chat sender
initChatUi({
    warp: {
        sendParams: (p) => warpClientInstance ? warpClientInstance.sendParams(p) : false,
    },
    getBaseParams: () => paramsUiHandle.currentParams,
});

function initWarp(roomKey) {
    clearWarpGeometries();
    setLoadingVisible(true);
    setLoadingProgress(0, "Connecting…");

    if (warpClientInstance) {
        try { warpClientInstance.close(); } catch { }
        warpClientInstance = null;
    }

    currentRoom = roomKey;

    warpClientInstance = createWarpClient({
        relayBase: URL_MAIN,
        room: roomKey,

        onStatus: (state, info) => {
            if (statusText) statusText.innerText = `${state}`;
            setDotState(state);

            if (state === "connected") {
                setLoadingVisible(true);
                setLoadingProgress(0, "Waiting for mesh…");

                if (paramsUiHandle) {
                    setTimeout(() => {
                        paramsUiHandle.pushAll();
                    }, 0);
                }
            }

            if (state === "disconnected" || state === "error" || state === "bad_binary" || state === "bad_json") {
                setLoadingVisible(false);
            }
        },

        onProgress: (p, meta) => {
            if (meta?.state === "idle") {
                setLoadingVisible(false);
                return;
            }
            setLoadingVisible(true);

            if (meta?.state === "begin") {
                setLoadingProgress(0, "Loading 0%");
            } else if (meta?.state === "downloading") {
                setLoadingProgress(p, `Loading ${Math.round(p * 100)}%`);
            } else if (meta?.state === "parsing") {
                setLoadingProgress(0.95, "Parsing…");
            } else if (meta?.state === "decompressing") {
                setLoadingProgress(0.96, "Unzipping…");
            } else if (meta?.state === "done") {
                setLoadingProgress(1, "Done");
                setTimeout(() => setLoadingVisible(false), 200);
            }
        },

        onMesh: (payload) => {
            const geometries = payload?.geometries || [];
            setWarpGeometries(geometries);
        },
    });

    paramsUiHandle = initParamsUi({
        warp: {
            sendParams: (p) => warpClientInstance ? warpClientInstance.sendParams(p) : false,
        },
        throttle: 50,
        sendAll: true,
        mappings: [
            { sliderId: "sHeight", valueId: "vHeight", key: "height" },
            { sliderId: "sWidth", valueId: "vWidth", key: "width" },
            { sliderId: "sLength", valueId: "vLength", key: "length" },
            { sliderId: "sSmoothness", valueId: "vSmoothness", key: "smoothness" },
            { sliderId: "sExpected top surface", valueId: "vExpected top surface", key: "expected_top_surface" },
            { sliderId: "sContraction of the form", valueId: "vContraction of the form", key: "contraction_of_the_form" },
            { sliderId: "sPosition of Contraction", valueId: "vPosition of Contraction", key: "position_of_contraction" },
            { sliderId: "sthickness", valueId: "vThickness", key: "thickness" },


        ],
    });
}

// Initial startup
initWarp(initialRoom);

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    composer.render();
}
animate();

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    outlinePass.setSize(window.innerWidth, window.innerHeight);

    fxaaPass.material.uniforms["resolution"].value.set(
        1 / (window.innerWidth * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1)),
        1 / (window.innerHeight * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1))
    );

    if (gtaoPass && gtaoPass.setSize) gtaoPass.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================================================
   👑 建筑学 PRO 级扩展功能 (Architectural Pro Features)
   ========================================================================= */

// --- 1. 石膏白模渲染系统 (Clay Render Mode) ---
const clayMaterial = new THREE.MeshStandardMaterial({
    color: 0xEEEEEE, // 纯净的石膏白
    roughness: 0.85, // 极高的粗糙度，模拟漫反射
    metalness: 0.0,
    side: THREE.DoubleSide
});

let isClayMode = false;
function toggleClayMode() {
    isClayMode = !isClayMode;
    // 遍历所有生成的建筑网格，切换材质
    warpGroup.children.forEach(mesh => {
        if (mesh.isMesh) {
            mesh.material = isClayMode ? clayMaterial : sharedMaterial;
        }
    });
    console.log(isClayMode ? "Clay Render: ON" : "Clay Render: OFF");
}

// --- 2. 电影级展台自动旋转 (Cinematic Turntable) ---
let isAutoRotate = false;
function toggleTurntable() {
    isAutoRotate = !isAutoRotate;
    // 直接操控我们之前写的 controls 对象里的 orbit
    controls.orbit.autoRotate = isAutoRotate;
    controls.orbit.autoRotateSpeed = 1.5; // 缓慢而优雅的旋转速度
    console.log(isAutoRotate ? "Turntable: ON" : "Turntable: OFF");
}

// --- 3. 一键快照并打通历史记录 (Snapshot to History) ---
function takeSnapshotAndSave() {
    // 隐藏不想被截图进去的 UI (比如蓝色的高亮描边)
    const previousSelection = outlinePass.selectedObjects;
    outlinePass.selectedObjects = [];
    
    // 强制渲染一帧
    composer.render(); 
    
    // 提取高清图像的 Base64 数据
    const imgData = renderer.domElement.toDataURL("image/jpeg", 0.9);
    
    // 恢复之前的选中高亮
    outlinePass.selectedObjects = previousSelection;

    // 寻找左侧边栏中当前激活的方案卡片
    const activeHistoryCard = document.querySelector('.history-card.active');
    if (activeHistoryCard) {
        const thumbDiv = activeHistoryCard.querySelector('.history-thumb');
        if (thumbDiv) {
            // 将截图作为背景图赋给缩略图
            thumbDiv.style.backgroundImage = `url(${imgData})`;
            thumbDiv.style.backgroundSize = 'cover';
            thumbDiv.style.backgroundPosition = 'center';
            
            // 加入一个轻微的闪烁动画，给用户“快门”的反馈
            thumbDiv.animate([
                { opacity: 0.2, filter: 'brightness(2)' },
                { opacity: 1, filter: 'brightness(1)' }
            ], { duration: 400, easing: 'ease-out' });
        }
    }
    console.log("Snapshot saved to History Sidebar!");
}

// --- 4. 绑定高级功能到键盘快捷键 ---
window.addEventListener("keydown", (e) => {
    // 防止在打字时触发快捷键
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;

    switch (e.key.toLowerCase()) {
        case "m": // 按 M 键切换材质 (Material/Clay)
            toggleClayMode();
            break;
        case "p": // 按 P 键开启/关闭自动展示 (Presentation)
            toggleTurntable();
            break;
        case "s": // 按 S 键保存快照 (Snapshot)
            takeSnapshotAndSave();
            break;
    }
});

// 重写原有的 animate 函数，以支持 autoRotate
const originalAnimate = animate;
// (注：由于上面原代码里 animate 被直接调用了，我们只要确保 controls.update() 在循环里就行。
// OrbitControls 会自动处理 autoRotate 逻辑，只要 autoRotate=true 且调用了 orbit.update() 即可)