// UCL, Bartlett, RC5
import { AuthApi, auth } from "./firebase/firebaseClient.js";

function wireLoginUi() {
    const btnGoogle = document.getElementById("btnGoogle");
    const btnHelp = document.getElementById("btnHelp");

    if (btnGoogle) {
        btnGoogle.onclick = async () => {
            try {
                await AuthApi.signInWithGoogle();
            } catch (e) {
                alert(e?.message || String(e));
            }
        };
    }

}

AuthApi.onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.replace("./library/library.html");
        return;
    }
    wireLoginUi();
});
