// Firestore cho Countdown Online
//
//   cd_users/{uid}                    hồ sơ: name, photoURL, total (điểm mùa), streak, lastCheckinAt, lastAt, lastSeen
//   cd_days/{2026-12-01}/players/{uid}  điểm trong ngày
//   cd_weeks/{2026-W49}/players/{uid}   điểm trong tuần
//   cd_wishes/{id}                    lời chúc (lời chúc đầu tiên sau 00:00 = "Người mở màn 2027")
import {
  doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, writeBatch, addDoc,
  collection, query, where, orderBy, limit, increment, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { TARGET } from "./time.js";

const NAME_MAX = 24;
export const cleanName = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const userRef = (uid) => doc(db, "cd_users", uid);
const users = collection(db, "cd_users");

export async function ensureUser(user) {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);
  const g = user.providerData.find((p) => p.providerId === "google.com");
  const base = { photoURL: g?.photoURL || null, isGuest: user.isAnonymous, lastSeen: serverTimestamp() };
  if (!snap.exists()) {
    const data = { ...base, name: g?.displayName ? cleanName(g.displayName) : null, total: 0, streak: 0, createdAt: serverTimestamp() };
    await setDoc(ref, data);
    return { ...data, total: 0 };
  }
  const data = snap.data();
  const patch = { ...base };
  if (!data.name && g?.displayName) patch.name = cleanName(g.displayName);
  await updateDoc(ref, patch);
  return { ...data, ...patch };
}

export const setName = (uid, name) => updateDoc(userRef(uid), { name: cleanName(name) });
/** Tỉnh/thành người chơi chọn (để sau này đấu theo tỉnh) */
export const setProvince = (uid, key) => updateDoc(userRef(uid), { province: key || null });
export const heartbeat = (uid) => updateDoc(userRef(uid), { lastSeen: serverTimestamp() });

export function watchMe(uid, cb, onErr) {
  return onSnapshot(userRef(uid), (s) => cb(s.data({ serverTimestamps: "estimate" })), onErr);
}

/** Điểm danh: tăng chuỗi + cộng điểm thưởng vào tổng (1 lần mỗi ~ngày, máy chủ kiểm tra) */
export function checkin(uid, streak, bonus) {
  return updateDoc(userRef(uid), {
    streak, lastCheckinAt: serverTimestamp(), total: increment(bonus), lastSeen: serverTimestamp(),
  });
}

/** Ghi điểm đã gom: userPts vào tổng mùa, periodPts vào bảng ngày + tuần */
export function flush({ uid, name, photoURL, userPts, periodPts, day, week }) {
  const b = writeBatch(db);
  b.update(userRef(uid), { total: increment(userPts), lastAt: serverTimestamp(), lastSeen: serverTimestamp() });
  const p = { name: cleanName(name) || "Ẩn danh", photoURL: photoURL || null, pts: increment(periodPts), lastAt: serverTimestamp() };
  b.set(doc(db, "cd_days", day, "players", uid), p, { merge: true });
  b.set(doc(db, "cd_weeks", week, "players", uid), p, { merge: true });
  return b.commit();
}

const rows = (s, field) => s.docs.map((d) => {
  const x = d.data();
  return { uid: d.id, name: x.name, photoURL: x.photoURL, pts: x[field] || 0, lastSeen: x.lastSeen };
});

/** Bảng xếp hạng: kind = "day" | "week" | "season" */
export async function fetchBoard(kind, key, n = 10) {
  if (kind === "season") return rows(await getDocs(query(users, orderBy("total", "desc"), limit(n))), "total");
  const col = collection(db, kind === "day" ? "cd_days" : "cd_weeks", key, "players");
  return rows(await getDocs(query(col, orderBy("pts", "desc"), limit(n))), "pts");
}

export async function fetchOnline(nowMs) {
  const since = Timestamp.fromMillis(nowMs - 150_000);
  const s = await getDocs(query(users, where("lastSeen", ">=", since), orderBy("lastSeen", "desc"), limit(15)));
  return rows(s, "total");
}

/** Gửi lời chúc + ghi lastWishAt vào hồ sơ (máy chủ dùng để chặn gửi dồn dập < 15 giây) */
export function addWish(uid, name, text) {
  const b = writeBatch(db);
  b.set(doc(collection(db, "cd_wishes")), { uid, name: cleanName(name) || "Ẩn danh", text, createdAt: serverTimestamp() });
  b.update(userRef(uid), { lastWishAt: serverTimestamp() });
  return b.commit();
}
export async function fetchWishes(n = 8) {
  const s = await getDocs(query(collection(db, "cd_wishes"), orderBy("createdAt", "desc"), limit(n)));
  return s.docs.map((d) => d.data());
}
/** Người gửi lời chúc đầu tiên sau giao thừa */
export async function fetchOpener() {
  const q = query(collection(db, "cd_wishes"), where("createdAt", ">=", Timestamp.fromMillis(TARGET)), orderBy("createdAt", "asc"), limit(1));
  const s = await getDocs(q);
  return s.empty ? null : s.docs[0].data();
}

/** Điểm của tôi trong ngày / tuần */
export async function fetchMine(kind, key, uid) {
  const s = await getDoc(doc(db, kind === "day" ? "cd_days" : "cd_weeks", key, "players", uid));
  return s.exists() ? s.data().pts || 0 : 0;
}

// ---- Cập nhật tức thì (realtime) ----
function boardQuery(kind, key, n) {
  if (kind === "season") return query(users, orderBy("total", "desc"), limit(n));
  return query(collection(db, kind === "day" ? "cd_days" : "cd_weeks", key, "players"), orderBy("pts", "desc"), limit(n));
}
/** Theo dõi bảng xếp hạng: cb(list) mỗi khi có người thay đổi điểm */
export function watchBoard(kind, key, cb, onErr, n = 10) {
  return onSnapshot(boardQuery(kind, key, n), (s) => cb(rows(s, kind === "season" ? "total" : "pts")), onErr);
}
/** Theo dõi người đang online (hoạt động trong 2,5 phút). Tự đăng ký lại mỗi phút. */
export function watchOnline(nowFn, cb, onErr) {
  let unsub = null;
  const sub = () => {
    unsub?.();
    const since = Timestamp.fromMillis(nowFn() - 150_000);
    unsub = onSnapshot(query(users, where("lastSeen", ">=", since), orderBy("lastSeen", "desc"), limit(15)),
      (s) => cb(rows(s, "total")), onErr);
  };
  sub();
  const t = setInterval(sub, 60_000);
  return () => { clearInterval(t); unsub?.(); };
}
