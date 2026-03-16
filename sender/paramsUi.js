// UCL, Bartlett, RC5
function throttleMs(fn, ms) {
    let last = 0;
    let pending = null;

    return () => {
        const now = performance.now();
        const dt = now - last;

        if (dt >= ms) {
            last = now;
            fn();
            return;
        }

        clearTimeout(pending);
        pending = setTimeout(() => {
            last = performance.now();
            fn();
        }, ms - dt);
    };
}

export function initParamsUi({
    warp,
    mappings,
    throttle = 200,
    sendAll = true,
} = {}) {
    if (!warp || typeof warp.sendParams !== "function") {
        throw new Error("initParamsUi: warp.sendParams is missing");
    }

    if (!Array.isArray(mappings)) {
        throw new Error("initParamsUi: mappings must be an array");
    }


    const currentParams = {};

    let lastChangedKey = null;

    const doSend = () => {
        if (!lastChangedKey && !sendAll) return;

        if (sendAll) {
            warp.sendParams(currentParams);
        } else {
            warp.sendParams({ [lastChangedKey]: currentParams[lastChangedKey] });
        }
    };

    const sendThrottled = throttleMs(doSend, throttle);

    function pushParams(changedKey, immediate) {
        lastChangedKey = changedKey;

        if (immediate) {
            doSend();
            return;
        }

        sendThrottled();
    }

    function bindOne(m) {
        const slider = document.getElementById(m.sliderId);
        const valueEl = document.getElementById(m.valueId);

        if (!slider || !valueEl) return;

        const toNumber = m.toNumber || ((x) => Number(x));
        const format = m.format || ((v) => String(v));

        function readAndUpdateUI() {
            const val = toNumber(slider.value);
            currentParams[m.key] = val;
            valueEl.textContent = format(val);
            return val;
        }


        slider.addEventListener("input", () => {
            readAndUpdateUI();
            pushParams(m.key, false);
        });

        slider.addEventListener("change", () => {
            readAndUpdateUI();
            pushParams(m.key, true);
        });

        readAndUpdateUI();
    }


    for (let i = 0; i < mappings.length; i++) {
        bindOne(mappings[i]);
    }


    function pushAll() {
        warp.sendParams(currentParams);
    }

    function setParam(key, value, { send = true } = {}) {
        currentParams[key] = value;
        if (send) warp.sendParams(sendAll ? currentParams : { [key]: value });
    }

    return {
        currentParams,
        pushAll,
        setParam,
    };
}
