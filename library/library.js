// UCL, Bartlett, RC5
import { AuthApi, auth, db, FsApi } from "../firebase/firebaseClient.js";

function getInitials(user) {
    const name = (user?.displayName || "").trim();
    const email = (user?.email || "").trim();

    const source = name || email || "User";

    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    const left = source.split("@")[0] || source;
    const letters = left.replace(/[^a-zA-Z0-9]/g, "");
    return (letters.slice(0, 2) || "U").toUpperCase();
}

function pickDisplayName(user) {
    return (user?.displayName || user?.email || "Signed in").trim();
}


function genRoomKey() {
    return `space_${crypto.randomUUID().slice(0, 8)}`;
}

function createCardElement(space) {
    const tpl = document.getElementById("cardTemplate");
    const clone = tpl.content.cloneNode(true);

    const card = clone.querySelector(".room-card");
    const nameEl = clone.querySelector(".room-name");
    const idEl = clone.querySelector(".room-id-value");
    const descEl = clone.querySelector(".room-desc");
    const metaEl = clone.querySelector(".room-meta");
    const btnOpen = clone.querySelector(".room-open-link");

    const href = `../app/app.html?room=${encodeURIComponent(space.roomKey)}`;
    const updated = new Date(space.updatedAtMs || Date.now()).toLocaleString();
    const btnShare = clone.querySelector(".room-share-link");
    const shareHref = `../app/app.html?room=${encodeURIComponent(space.roomKey)}&public=1`;
    const shareUrl = new URL(shareHref, window.location.href).toString();

    btnShare?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            btnShare.textContent = "Copied!";
            setTimeout(() => (btnShare.textContent = "Share"), 800);
        } catch {
            // fallback
            window.prompt("Copy this link:", shareUrl);
        }
    });

    card.setAttribute("data-room", space.roomKey);
    nameEl.textContent = space.name || space.roomKey;
    if (idEl) idEl.textContent = space.roomKey;
    metaEl.textContent = `Updated: ${updated}`;


    if (space.description) {
        descEl.textContent = space.description;
    } else {
        descEl.remove();
    }

    btnOpen.setAttribute("href", href);

    return clone;
}

async function listSpaces(uid) {
    const spacesCol = FsApi.collection(db, "users", uid, "spaces");
    const q = FsApi.query(spacesCol, FsApi.orderBy("updatedAtMs", "desc"));
    const snap = await FsApi.getDocs(q);
    const spaces = [];
    snap.forEach((d) => spaces.push(d.data()));
    return spaces;
}

async function createSpace(uid, { name, description, roomKey }) {
    const rk = roomKey || genRoomKey();
    const ref = FsApi.doc(db, "users", uid, "spaces", rk);
    const existing = await FsApi.getDoc(ref);

    if (existing.exists()) {
        throw new Error("That room key already exists.");
    }

    const now = Date.now();
    const payload = {
        roomKey: rk,
        name,
        description,
        createdAtMs: now,
        updatedAtMs: now,
    };

    await FsApi.setDoc(ref, payload);
    return payload;
}

async function deleteSpace(uid, roomKey) {
    const ref = FsApi.doc(db, "users", uid, "spaces", roomKey);
    await FsApi.deleteDoc(ref);
}


async function boot(user) {
    const uid = user.uid;

    const grid = document.getElementById("roomGrid");
    const btnSignOut = document.getElementById("btnSignOut");
    const btnNewRoom = document.getElementById("btnNewRoom");

    const createDialog = document.getElementById("createSpaceDialog");
    const btnCreate = document.getElementById("btnCreate");
    const btnCancel = document.getElementById("btnCancel");
    const inputName = document.getElementById("spaceName");
    const inputDesc = document.getElementById("spaceDesc");
    const inputRoom = document.getElementById("spaceRoomKey");

    const deleteDialog = document.getElementById("deleteDialog");
    const deleteText = document.getElementById("deleteText");
    const btnDeleteConfirm = document.getElementById("btnDeleteConfirm");
    const btnDeleteCancel = document.getElementById("btnDeleteCancel");

    const layout = document.getElementById("appLayout");
    const btnHideSidebar = document.getElementById("btnHideSidebar");
    const btnShowSidebar = document.getElementById("btnShowSidebar");
    const userAvatar = document.getElementById("userAvatar");
    const userName = document.getElementById("userName");
    const userEmail = document.getElementById("userEmail");

    if (userAvatar) userAvatar.textContent = getInitials(user);
    if (userName) userName.textContent = pickDisplayName(user);
    if (userEmail) userEmail.textContent = user?.email || "";


    let spaceToDelete = null;


    btnSignOut.onclick = async () => {
        await AuthApi.signOut();
        window.location.replace("../index.html");
    };


    async function refresh() {
        grid.innerHTML = '';

        const spinner = document.createElement('sl-spinner');
        grid.appendChild(spinner);

        try {
            const spaces = await listSpaces(uid);
            grid.innerHTML = '';

            if (spaces.length === 0) {
                grid.innerHTML = '<div style="opacity:0.6; padding:20px;">No spaces found. Create one!</div>';
            } else {
                spaces.forEach(space => {
                    const cardNode = createCardElement(space);
                    grid.appendChild(cardNode);
                });
            }
        } catch (e) {
            console.error(e);
            grid.innerHTML = 'Error loading spaces.';
        }
    }

    btnNewRoom.onclick = () => {
        inputName.value = "";
        inputDesc.value = "";
        inputRoom.value = "";
        createDialog.show();
    };


    btnCancel.onclick = () => createDialog.hide();


    btnCreate.onclick = async () => {
        const name = (inputName.value || "").trim();
        if (!name) {
            alert("Please enter a name");
            return;
        }

        btnCreate.loading = true;

        try {
            await createSpace(uid, {
                name,
                description: inputDesc.value.trim(),
                roomKey: inputRoom.value.trim()
            });
            createDialog.hide();
            await refresh();
        } catch (err) {
            alert(err.message);
        } finally {
            btnCreate.loading = false;
        }
    };
    btnHideSidebar.onclick = () => {
        layout.classList.add("sidebar-closed");
    };

    btnShowSidebar.onclick = () => {
        layout.classList.remove("sidebar-closed");
    };

    grid.addEventListener("click", (e) => {

        const btn = e.target.closest('[data-action="delete"]');
        if (!btn) return;


        const card = btn.closest(".room-card");
        const roomKey = card?.getAttribute("data-room");
        if (!roomKey) return;


        spaceToDelete = roomKey;
        deleteText.textContent = `Are you sure you want to delete "${roomKey}"? This cannot be undone.`;
        deleteDialog.show();
    });


    btnDeleteCancel.onclick = () => {
        spaceToDelete = null;
        deleteDialog.hide();
    };


    btnDeleteConfirm.onclick = async () => {
        if (!spaceToDelete) return;

        btnDeleteConfirm.loading = true;
        try {
            await deleteSpace(uid, spaceToDelete);
            deleteDialog.hide();
            await refresh();
        } catch (err) {
            alert(err.message);
        } finally {
            btnDeleteConfirm.loading = false;
            spaceToDelete = null;
        }
    };


    await refresh();
}

AuthApi.onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.replace("./index.html");
        return;
    }
    boot(user);
});