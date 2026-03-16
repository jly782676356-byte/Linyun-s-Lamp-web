// UCL, Bartlett, RC5
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

function isInScene(obj, scene) {
  let o = obj;
  while (o) {
    if (o === scene) return true;
    o = o.parent;
  }
  return false;
}

function isObject3D(o) {
  return !!o && (o.isObject3D === true);
}

// 扩展了参数：新增 onDelete 用于处理删除逻辑
export function createControls({ camera, renderer, scene, ui, onSelect, onDelete }) {

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05; // 让漫游的物理惯性更顺滑

  const transform = new TransformControls(camera, renderer.domElement);

  const helper = (typeof transform.getHelper === "function") ? transform.getHelper() : null;
  const toAdd = isObject3D(helper) ? helper : (isObject3D(transform) ? transform : null);

  if (toAdd) scene.add(toAdd);

  transform.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
  });

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const pickables = [];
  
  let currentMode = "translate";
  let currentSelectedObject = null; // 新增：在内存中追踪当前选中的物体

  function setMode(mode) {
    currentMode = mode;
    transform.setMode(mode);

    ui?.btnMove?.classList.toggle("active", mode === "translate");
    ui?.btnRotate?.classList.toggle("active", mode === "rotate");
    ui?.btnScale?.classList.toggle("active", mode === "scale");
  }

  ui?.btnMove && (ui.btnMove.onclick = () => setMode("translate"));
  ui?.btnRotate && (ui.btnRotate.onclick = () => setMode("rotate"));
  ui?.btnScale && (ui.btnScale.onclick = () => setMode("scale"));

  setMode("translate");

  function detach() {
    transform.detach();
    currentSelectedObject = null;
    if (typeof onSelect === "function") onSelect(null);
    ui?.selectedName && (ui.selectedName.innerText = "None");
  }

  function clearPickables() {
    pickables.length = 0;
  }

  // --- 新增：核心聚焦算法 (Frame Selected) ---
  function focusObject(obj) {
    if (!obj) return;
    // 计算物体的真实包围盒（包含所有子网格）
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    
    // 将漫游相机的焦点移动到物体中心
    orbit.target.copy(center);
    orbit.update();
  }

  // --- 新增：高级键盘快捷键系统 ---
  window.addEventListener("keydown", (event) => {
    // 拦截：如果用户正在 UI 里的输入框打字，忽略快捷键
    if (event.target.closest("input, textarea")) return;

    switch (event.key) {
      case "Escape":
        // ESC 快速取消选择
        detach();
        break;
        
      case "Delete":
      case "Backspace":
        // 模块化推敲必备：一键删除
        if (currentSelectedObject && typeof onDelete === "function") {
          onDelete(currentSelectedObject);
          detach();
        }
        break;
        
      case "f":
      case "F":
        // 经典 Rhino/Blender 快捷键：聚焦当前物体
        if (currentSelectedObject) {
          focusObject(currentSelectedObject);
        }
        break;
        
      case "Shift":
        // 建筑学精度控制：按住 Shift 开启正交/网格捕捉
        // 平移每次吸附 1 个单位，旋转每次吸附 15 度 (转换为弧度)
        transform.setTranslationSnap(1); 
        transform.setRotationSnap(THREE.MathUtils.degToRad(15));
        break;
    }
  });

  // 释放 Shift 时关闭捕捉
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      transform.setTranslationSnap(null);
      transform.setRotationSnap(null);
    }
  });

  window.addEventListener("click", (event) => {
    if (event.target.closest(".panel")) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(pickables, true);

    if (hits.length) {
      let obj = hits[0].object;
      while (obj.parent && !pickables.includes(obj)) obj = obj.parent;

      if (obj && isInScene(obj, scene)) {
        transform.attach(obj);
        currentSelectedObject = obj; // 记录当前选中状态
        
        if (typeof onSelect === "function") onSelect(obj);
        transform.setMode(currentMode);
        ui?.selectedName && (ui.selectedName.innerText = obj.name || "Selected");
      } else {
        detach();
      }
    } else {
      detach();
    }
  });

  return {
    orbit,
    transform,
    detach,
    clearPickables,
    addPickable(object) {
      if (!object) return;
      pickables.push(object);
    },
    removePickable(object) {
      // 暴露一个移除可选物体的 API 配合删除逻辑
      const index = pickables.indexOf(object);
      if (index > -1) pickables.splice(index, 1);
    },
    update() {
      orbit.update();
    },
  };
}