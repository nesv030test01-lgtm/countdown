// Firestore cho Countdown Online — MỖI NĂM MỘT MÙA, lưu riêng, không xoá năm cũ
//
//   cd_seasons/{Y}/users/{uid}                    hồ sơ mùa Y: name, photoURL, province, total, streak,
//                                                 lastCheckinAt, lastAt, lastWishAt, lastSeen
//   cd_seasons/{Y}/days/{YYYY-MM-DD}/players/{uid}  điểm trong ngày
//   cd_seasons/{Y}/weeks/{YYYY-Www}/players/{uid}   điểm trong tuần
//   cd_seasons/{Y}/wishes/{id}                    lời chúc gửi trong mùa Y
//
// Mùa Y = đếm ngược đến 01/01/Y. "Người mở màn Y" = lời chúc đầu tiên của mùa Y+1.
import {
  doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, writeBatch,
  collection, query, where, orderBy, limit, increment, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

const NAME_MAX = 24;
export const cleanName = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

let S = null; // mùa đang dùng, vd "2027"
export function useSeason(y) { S = String(y); }

const sdoc = (y, ...p) => doc(db, "cd_seasons", String(y), ...p);
const scol = (y, ...p) => collection(db, "cd_seasons", String(y), ...p);
const userRef = (uid, y = S) => sdoc(y, "users", uid);
const users = (y = S) => scol(y, "users");
const periodCol = (kind, key, y = S) => scol(y, kind === "day" ? "days" : "weeks", key, "players");

/** Tạo hồ sơ mùa hiện tại nếu chưa có (tên + tỉnh mang sang từ mùa trước) */
export async function ensureUser(user) {
  const ref = userRef(user.uid);
  const snap = await getDoc(ref);
  const g = user.providerData.find((p) => p.providerId === "google.com");
  const base = { photoURL: g?.photoURL || null, isGuest: user.isAnonymous, lastSeen: serverTimestamp() };
  if (!snap.exists()) {
    let prev = null;
    try {
      const ps = await getDoc(userRef(user.uid, Number(S) - 1));
      if (ps.exists()) prev = ps.data();
    } catch {}
    const data = {
      ...base,
      name: prev?.name || (g?.displayName ? cleanName(g.displayName) : null),
      province: prev?.province || null,
      total: 0, streak: 0, createdAt: serverTimestamp(),
    };
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

/** Ghi 1 phát pháo: userPts vào tổng mùa, periodPts vào bảng ngày + tuần */
export function flush({ uid, name, photoURL, userPts, periodPts, day, week }) {
  const b = writeBatch(db);
  b.update(userRef(uid), { total: increment(userPts), lastAt: serverTimestamp(), lastSeen: serverTimestamp() });
  const p = { name: cleanName(name) || "Ẩn danh", photoURL: photoURL || null, pts: increment(periodPts), lastAt: serverTimestamp() };
  b.set(doc(periodCol("day", day), uid), p, { merge: true });
  b.set(doc(periodCol("week", week), uid), p, { merge: true });
  return b.commit();
}

const rows = (s, field) => s.docs.map((d) => {
  const x = d.data();
  return { uid: d.id, name: x.name, photoURL: x.photoURL, province: x.province, pts: x[field] || 0, lastSeen: x.lastSeen };
});

function boardQuery(kind, key, n, y = S) {
  if (kind === "season") return query(users(y), orderBy("total", "desc"), limit(n));
  return query(periodCol(kind, key, y), orderBy("pts", "desc"), limit(n));
}

/** Bảng xếp hạng: kind = "day" | "week" | "season". season = năm (mặc định mùa hiện tại) */
export async function fetchBoard(kind, key, n = 10, season = S) {
  return rows(await getDocs(boardQuery(kind, key, n, season)), kind === "season" ? "total" : "pts");
}

export async function fetchOnline(nowMs) {
  const since = Timestamp.fromMillis(nowMs - 150_000);
  return rows(await getDocs(query(users(), where("lastSeen", ">=", since), orderBy("lastSeen", "desc"), limit(15))), "total");
}

/** Gửi lời chúc + ghi lastWishAt vào hồ sơ (máy chủ dùng để chặn gửi dồn dập < 15 giây) */
export function addWish(uid, name, text) {
  const b = writeBatch(db);
  b.set(doc(scol(S, "wishes")), { uid, name: cleanName(name) || "Ẩn danh", text, createdAt: serverTimestamp() });
  b.update(userRef(uid), { lastWishAt: serverTimestamp() });
  return b.commit();
}
export async function fetchWishes(n = 8) {
  const s = await getDocs(query(scol(S, "wishes"), orderBy("createdAt", "desc"), limit(n)));
  return s.docs.map((d) => d.data());
}
/** "Người mở màn {year}": lời chúc đầu tiên sau giao thừa = lời chúc đầu tiên của mùa year+1 */
export async function fetchOpener(year) {
  const s = await getDocs(query(scol(year + 1, "wishes"), orderBy("createdAt", "asc"), limit(1)));
  return s.empty ? null : s.docs[0].data();
}

/** Điểm của tôi trong ngày / tuần */
export async function fetchMine(kind, key, uid) {
  const s = await getDoc(doc(periodCol(kind, key), uid));
  return s.exists() ? s.data().pts || 0 : 0;
}

// ---- Cập nhật tức thì (realtime) ----
/** Theo dõi bảng xếp hạng: cb(list) mỗi khi có người thay đổi điểm */
export function watchBoard(kind, key, cb, onErr, n = 10) {
  return onSnapshot(boardQuery(kind, key, n), (s) => cb(rows(s, kind === "season" ? "total" : "pts")), onErr);
}
/** Theo dõi người đang online (hoạt động trong 2,5 phút). Tự đăng ký lại mỗi phút. */
export function watchOnline(nowFn, cb, onErr) {
  let unsub = null;
  const y = S;
  const sub = () => {
    unsub?.();
    const since = Timestamp.fromMillis(nowFn() - 150_000);
    unsub = onSnapshot(query(users(y), where("lastSeen", ">=", since), orderBy("lastSeen", "desc"), limit(15)),
      (s) => cb(rows(s, "total")), onErr);
  };
  sub();
  const t = setInterval(sub, 60_000);
  return () => { clearInterval(t); unsub?.(); };
}
