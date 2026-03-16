// UCL, Bartlett, RC5 - Configurator Logic Hub
import { AuthApi, auth, db, FsApi } from "../firebase/firebaseClient.js";

// =========================================
// 1. 初始化与 UI 元素抓取
// =========================================
if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
}

const qs = new URLSearchParams(window.location.search);
const isPublic = qs.get("public") === "1";
const room = qs.get("room");

// 抓取面板
const panels = {
    toolbar: document.querySelector(".panel.toolbar"),
    sliders: document.querySelector(".panel.sliders"),
    chat: document.querySelector(".panel.chat"),
    history: document.getElementById("historyPanel") // 新增：历史边栏
};

// 抓取控制按钮
const btns = {
    toolbar: document.getElementById("btnToggleToolbar"),
    sliders: document.getElementById("btnToggleParams"),
    chat: document.getElementById("btnToggleChat"),
    history: document.getElementById("btnToggleHistory") // 新增：历史按钮
};

// =========================================
// 2. 高级 UI 交互逻辑 (状态联动)
// =========================================

/**
 * 切换面板显示状态，并同步更新按钮的高亮视觉反馈
 */
function togglePanel(panelName) {
    const panel = panels[panelName];
    const btn = btns[panelName];
    if (!panel) return;

    // 切换隐藏状态
    const isHidden = panel.classList.toggle("hidden");
    
    // UX 优化：如果面板显示，则顶部对应的控制按钮高亮；反之变暗
    if (btn) {
        if (!isHidden) {
            btn.classList.add("active-nav"); 
            btn.style.background = "rgba(255, 255, 255, 0.15)"; // 模拟按下的玻璃态
        } else {
            btn.classList.remove("active-nav");
            btn.style.background = ""; // 恢复默认
        }
    }
}

// 绑定顶部导航点击事件
if (btns.toolbar) btns.toolbar.onclick = () => togglePanel("toolbar");
if (btns.sliders) btns.sliders.onclick = () => togglePanel("sliders");
if (btns.chat) btns.chat.onclick = () => togglePanel("chat");
if (btns.history) btns.history.onclick = () => togglePanel("history");

// 绑定全局快捷键 (Pro 级软件必备)
window.addEventListener("keydown", (e) => {
    // 防止在输入框打字时触发快捷键
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;
    
    if (e.key === "1") togglePanel("toolbar");
    if (e.key === "2") togglePanel("sliders");
    if (e.key === "3") togglePanel("chat");
    if (e.key === "4" || e.key.toLowerCase() === "h") togglePanel("history"); // 快捷键 4 或 H 呼出历史记录
});

// =========================================
// 3. 底部 3D 变换工具互斥逻辑 (Radio Button Group)
// =========================================
const toolIds = ["btnMove", "btnRotate", "btnScale"];
toolIds.forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    
    btn.addEventListener("click", (e) => {
        // 先熄灭所有工具按钮
        toolIds.forEach(otherId => {
            const otherBtn = document.getElementById(otherId);
            if(otherBtn) otherBtn.classList.remove("active");
        });
        // 点亮当前被点击的按钮
        e.target.classList.add("active");
        
        // TODO: 在这里通过 CustomEvent 或直接调用 Three.js 的 TransformControls 进行模式切换
        // window.dispatchEvent(new CustomEvent('toolChanged', { detail: id }));
    });
});

// =========================================
// 4. 返回导航与加载动画 API
// =========================================
const btnBack = document.getElementById("btnBack");
if (btnBack) {
    btnBack.onclick = () => {
        window.location.href = isPublic ? "../index.html" : "../library/library.html";
    };
}

// 预留给 Three.js 的进度条控制接口
// 可以在加载 GLTF 模型时调用 window.updateLoadingProgress(50)
window.updateLoadingProgress = (pct) => {
    const spinner = document.getElementById("loadingSpinner");
    if (spinner) {
        spinner.style.setProperty('--p', pct);
        spinner.setAttribute('data-pct', Math.round(pct));
    }
};

// =========================================
// 5. Firebase 权限守卫与引擎懒加载
// =========================================
async function ensureSpaceExists(uid, roomKey) {
    const ref = FsApi.doc(db, "users", uid, "spaces", roomKey);
    const snap = await FsApi.getDoc(ref);
    return snap.exists();
}

AuthApi.onAuthStateChanged(auth, async (user) => {
    if (!room) {
        window.location.replace(isPublic ? "../index.html" : "../library/library.html");
        return;
    }

    if (isPublic) {
        if (!user) {
            try {
                await AuthApi.signInAnonymously();
            } catch (e) {
                console.warn("Anonymous sign-in failed:", e?.message || e);
            }
        }
        await import("./three.js");
        return;
    }
    
    if (!user) {
        window.location.replace("../index.html");
        return;
    }

    const ok = await ensureSpaceExists(user.uid, room);
    if (!ok) {
        alert("This space does not exist or has been deleted."); // 增加优雅的错误提示
        window.location.replace("../library/library.html");
        return;
    }

    // 权限校验通过，加载核心渲染引擎
    await import("./three.js");
});