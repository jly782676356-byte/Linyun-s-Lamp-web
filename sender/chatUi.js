// UCL, Bartlett, RC5
export function initChatUi({
    warp,
    getBaseParams,
    inputId = "chatInput",
    sendBtnId = "chatSend",
    messagesId = "chatMessages",
    maxChars = 2000,
} = {}) {
    if (!warp || typeof warp.sendParams !== "function") {
        throw new Error("initChatUi: warp.sendParams is missing");
    }
    if (typeof getBaseParams !== "function") {
        throw new Error("initChatUi: getBaseParams must be a function returning current params");
    }

    const input = document.getElementById(inputId);
    const btn = document.getElementById(sendBtnId);
    const messagesEl = document.getElementById(messagesId);

    if (!input || !btn || !messagesEl) return;

    function getText() {
        return String(input.value || "").trim();
    }

    function updateBtnState() {
        const ok = getText().length > 0;
        btn.disabled = !ok;
        btn.style.opacity = ok ? "1" : "0.5";
        btn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    function appendBubble({ text, kind, metaText }) {
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble " + (kind || "sys");
        bubble.textContent = text || "";

        if (metaText) {
            const meta = document.createElement("div");
            meta.className = "chat-meta";
            meta.textContent = metaText;
            bubble.appendChild(meta);
        }

        messagesEl.appendChild(bubble);

        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function sendNow() {
        const text = getText();
        if (!text) return;

        appendBubble({ text, kind: "user" });
        const base = getBaseParams() || {};
        const payload = {
            ...base,
            userPrompt: text,
        };

        const ok = warp.sendParams(payload);

        input.value = "";
        updateBtnState();
    }

    btn.addEventListener("click", sendNow);

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendNow();
        }
    });

    input.addEventListener("input", updateBtnState);

    appendBubble({ text: "Please type a prompt and send", kind: "sys" });

    updateBtnState();

    return {
        sendNow,
        appendSystem(text) {
            appendBubble({ text, kind: "sys" });
        },
        appendUser(text) {
            appendBubble({ text, kind: "user" });
        },
    };
}
