// Đăng nhập: Google, Khách (Anonymous), liên kết Khách → Google
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInAnonymously,
  linkWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function loginGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // Một số trình duyệt di động chặn popup → chuyển sang redirect
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export function loginGuest() {
  return signInAnonymously(auth);
}

/**
 * Liên kết tài khoản khách hiện tại với Google, giữ nguyên uid và dữ liệu.
 * Nếu tài khoản Google đó đã từng chơi (đã có uid riêng) → trả về { conflict: true }.
 */
export async function linkGuestToGoogle() {
  try {
    const res = await linkWithPopup(auth.currentUser, provider);
    return { user: res.user };
  } catch (e) {
    if (e.code === "auth/credential-already-in-use" || e.code === "auth/email-already-in-use") {
      return { conflict: true };
    }
    throw e;
  }
}

export function logout() {
  return signOut(auth);
}
