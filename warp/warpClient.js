// UCL, Bartlett, RC5
import * as THREE from "three";

export function createWarpClient({
    relayBase = "wss://relay.curvf.com/ws",
    room = "warp_test_local_001",
    role = "client",
    fmt = "binary",
    reconnectMs = 1000,
    requestMeshOnConnect = true,
    maxBufferedAmount = 2_000_000,
    onStatus = () => { },
    onParams = () => { },
    onMesh = () => { },
    onProgress = () => { },
} = {}) {
    let ws = null;
    let closedByUser = false;
    let currentRelayBase = relayBase;

    let state = "idle";
    const wantsBinary = String(fmt).toLowerCase() === "binary";
    const CHNK_MAGIC = 0x4b4e4843;
    let inflight = null;

    let lastParams = null;

    const getUrl = () => {
        const fmtQuery = wantsBinary ? "&fmt=binary" : "";
        return `${currentRelayBase}?room=${encodeURIComponent(room)}&role=${encodeURIComponent(role)}${fmtQuery}`;
    };

    function status(s, info, extra = {}) {
        state = s;
        const meta = {
            url: getUrl(),
            room,
            fmt: wantsBinary ? "binary" : "json",
            relayBase: currentRelayBase,
            ...extra,
        };
        try {
            onStatus(s, info, meta);
        } catch { }
    }

    function resetInflight() {
        inflight = null;
        try {
            onProgress(0, { state: "idle" });
        } catch { }
    }

    function canSend() {
        return ws && ws.readyState === WebSocket.OPEN && (ws.bufferedAmount || 0) <= maxBufferedAmount;
    }

    function sendJson(obj) {
        if (!canSend()) return false;
        try {
            ws.send(JSON.stringify(obj));
            return true;
        } catch {
            return false;
        }
    }

    function sendParams(paramsObj) {
        lastParams = paramsObj;
        return sendJson({ type: "setParams", params: paramsObj });
    }

    function parseMeshUpdate(msg) {
        const meshes = msg?.mesh?.Meshes;
        if (!Array.isArray(meshes) || meshes.length === 0) return null;

        const geometries = [];

        for (let idx = 0; idx < meshes.length; idx++) {
            const m = meshes[idx];
            if (!m) continue;

            if (Array.isArray(m.v) && Array.isArray(m.i)) {
                const pos = new Float32Array(m.v);

                for (let k = 0; k < pos.length; k += 3) {
                    const x = pos[k + 0];
                    const y = pos[k + 1];
                    const z = pos[k + 2];
                    pos[k + 0] = x;
                    pos[k + 1] = z;
                    pos[k + 2] = -y;
                }

                const ind = new Uint32Array(m.i);
                const geom = new THREE.BufferGeometry();
                geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
                geom.setIndex(new THREE.BufferAttribute(ind, 1));

                if (Array.isArray(m.Colors) && m.Colors.length > 0) {
                    const col = new Float32Array(m.Colors);
                    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
                }

                geom.computeVertexNormals();
                geom.computeBoundingSphere();
                geometries.push(geom);
            }
        }

        if (geometries.length === 0) return null;
        return { geometries, source: "json" };
    }

    function parseWarpBinaryMeshPacket(arrayBuffer) {
        const dv = new DataView(arrayBuffer);
        let o = 0;

        dv.getUint32(o, true);
        o += 4;

        const version = dv.getUint16(o, true);
        o += 2;

        o += 2;

        const meshCount = dv.getUint32(o, true);
        o += 4;

        if (version !== 1) throw new Error("Unsupported version: " + version);

        const geometries = [];

        for (let mi = 0; mi < meshCount; mi++) {
            const vertexCount = dv.getUint32(o, true);
            o += 4;

            const indexCount = dv.getUint32(o, true);
            o += 4;

            const meshFlags = dv.getUint16(o, true);
            o += 2;

            o += 2;
            o += 24;

            const hasColors = (meshFlags & 1) !== 0;
            const colorsAreF32 = (meshFlags & 2) !== 0;

            const vLen = vertexCount * 3;
            const vBytes = vLen * 4;
            const pos = new Float32Array(arrayBuffer, o, vLen);
            o += vBytes;

            for (let k = 0; k < pos.length; k += 3) {
                const x = pos[k + 0];
                const y = pos[k + 1];
                const z = pos[k + 2];
                pos[k + 0] = x;
                pos[k + 1] = z;
                pos[k + 2] = -y;
            }

            const iBytes = indexCount * 4;
            const ind = new Uint32Array(arrayBuffer, o, indexCount);
            o += iBytes;

            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
            geom.setIndex(new THREE.BufferAttribute(ind, 1));

            if (hasColors) {
                if (colorsAreF32) {
                    const cLen = vertexCount * 3;
                    const cBytes = cLen * 4;
                    const col = new Float32Array(arrayBuffer, o, cLen);
                    o += cBytes;
                    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
                } else {
                    const cLen = vertexCount * 3;
                    const col = new Uint8Array(arrayBuffer, o, cLen);
                    o += cLen;
                    geom.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
                }
            }

            geom.computeVertexNormals();
            geom.computeBoundingSphere();
            geometries.push(geom);
        }

        if (geometries.length === 0) return null;
        return { geometries, source: "binary" };
    }

    async function maybeGunzip(uint8Array) {
        const ds = new DecompressionStream("gzip");
        const writer = ds.writable.getWriter();
        writer.write(uint8Array);
        writer.close();
        return await new Response(ds.readable).arrayBuffer();
    }

    function connect() {
        closedByUser = false;
        const url = getUrl();
        status("connecting", url);

        const myWs = new WebSocket(url);
        if (wantsBinary) myWs.binaryType = "arraybuffer";
        ws = myWs;

        myWs.addEventListener("open", () => {
            if (ws !== myWs) return;

            status("connected", url);
            resetInflight();

            if (requestMeshOnConnect) {
                sendJson({ type: "requestMesh" });
            }

            if (lastParams) {
                sendParams(lastParams);
            }
        });

        myWs.addEventListener("message", async (ev) => {
            if (ws !== myWs) return;

            if (ev.data instanceof ArrayBuffer) {
                if (!wantsBinary) {
                    status("unexpected_binary", "Got binary but client is fmt=json");
                    return;
                }

                try {
                    const ab = ev.data;
                    const dv = new DataView(ab);
                    const magic = dv.getUint32(0, true);

                    if (magic === CHNK_MAGIC) {
                        if (!inflight) throw new Error("Got CHNK but no inflight meshBegin");

                        const idx = dv.getUint32(4, true);
                        const count = dv.getUint32(8, true);

                        if (count !== inflight.chunkCount) throw new Error(`CHNK count mismatch: got ${count}, expected ${inflight.chunkCount}`);
                        if (idx >= count) throw new Error(`CHNK idx out of range: ${idx}/${count}`);

                        if (!inflight.got.has(idx)) {
                            const payload = new Uint8Array(ab, 12);
                            const dstOffset = idx * inflight.chunkBytes;

                            if (dstOffset + payload.byteLength > inflight.buf.byteLength) throw new Error("CHNK write would overflow buffer");

                            inflight.buf.set(payload, dstOffset);
                            inflight.got.add(idx);
                            inflight.gotBytes += payload.byteLength;

                            const p = Math.min(1, inflight.gotBytes / inflight.totalBytes);
                            onProgress(p, {
                                state: "downloading",
                                id: inflight.id,
                                gotChunks: inflight.got.size,
                                chunkCount: inflight.chunkCount,
                                gotBytes: inflight.gotBytes,
                                totalBytes: inflight.totalBytes,
                            });
                        }
                        return;
                    }

                    onProgress(0.95, { state: "parsing", mode: "single_packet", bytes: ab.byteLength });
                    const result = parseWarpBinaryMeshPacket(ab);
                    if (result) {
                        onMesh(result);
                        onProgress(1, { state: "done", source: "binary_single" });
                    }
                } catch (e) {
                    status("bad_binary", e?.message || String(e), { detail: e?.message || String(e) });
                    resetInflight();
                }
                return;
            }

            let msg;
            try {
                msg = JSON.parse(ev.data);
            } catch (e) {
                status("bad_json", e?.message || String(e), { detail: e?.message || String(e) });
                return;
            }

            if (msg.type === "meshBegin") {
                if (!wantsBinary) return;

                inflight = {
                    id: msg.id,
                    totalBytes: msg.totalBytes,
                    chunkBytes: msg.chunkBytes,
                    chunkCount: msg.chunkCount,
                    buf: new Uint8Array(msg.totalBytes),
                    compression: msg.compression || null,
                    got: new Set(),
                    gotBytes: 0,
                };

                onProgress(0, {
                    state: "begin",
                    id: inflight.id,
                    totalBytes: inflight.totalBytes,
                    chunkCount: inflight.chunkCount,
                    chunkBytes: inflight.chunkBytes,
                });
                return;
            }

            if (msg.type === "meshEnd") {
                if (!wantsBinary) return;

                if (!inflight || msg.id !== inflight.id) {
                    status("meshEnd_mismatch", msg.id || "");
                    return;
                }

                if (inflight.got.size !== inflight.chunkCount) {
                    status("mesh_incomplete", `got ${inflight.got.size}/${inflight.chunkCount} chunks`);
                    resetInflight();
                    return;
                }

                try {
                    onProgress(0.95, { state: "parsing", mode: "chunked" });

                    let finalBuffer = inflight.buf.buffer;

                    if (inflight.compression === "gzip") {
                        onProgress(0.96, { state: "decompressing" });
                        finalBuffer = await maybeGunzip(inflight.buf);
                    }

                    const result = parseWarpBinaryMeshPacket(finalBuffer);
                    resetInflight();
                    if (result) onMesh(result);
                    onProgress(1, { state: "done", source: "binary_chunked" });
                } catch (e) {
                    status("bad_binary_parse", e?.message || String(e), { detail: e?.message || String(e) });
                    resetInflight();
                }
                return;
            }

            if (msg.type === "meshUpdate") {
                const result = parseMeshUpdate(msg);
                if (result) onMesh(result);
                onProgress(1, { state: "done", source: "json" });
                return;
            }

            if (msg.type === "setParams") {
                onParams(msg.params || {});
                return;
            }
        });

        myWs.addEventListener("close", (ev) => {
            if (ws !== myWs) return;
            status("disconnected", `${url} (${ev.code} ${ev.reason || ""})`, { code: ev.code, reason: ev.reason || "" });
            resetInflight();
            if (!closedByUser) setTimeout(connect, reconnectMs);
        });

        myWs.addEventListener("error", () => {
            if (ws !== myWs) return;
            status("error", getUrl());
        });
    }

    function close() {
        closedByUser = true;
        resetInflight();
        try {
            ws?.close();
        } catch { }
    }

    function setRelayBase(newUrl) {
        if (currentRelayBase === newUrl) return;
        currentRelayBase = newUrl;
        closedByUser = true;
        try {
            ws?.close();
        } catch { }
        connect();
    }

    function getState() {
        return {
            state,
            url: getUrl(),
            room,
            fmt: wantsBinary ? "binary" : "json",
            relayBase: currentRelayBase,
        };
    }

    connect();

    return {
        setRelayBase,
        sendParams,
        sendJson,
        close,
        disconnect: close,
        getState,
    };
}
