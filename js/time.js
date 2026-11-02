// Thời gian & cách tính điểm
//
// Mọi thứ tính theo GIỜ MÁY CHỦ (không tin đồng hồ điện thoại) và theo giờ Việt Nam (UTC+7).
// Các mốc ở đây PHẢI KHỚP với firestore.rules (tgt/dec1/tMult).

// ---- Mùa (mỗi năm một mùa) ----
// Mùa Y = đếm ngược đến 00:00:00 ngày 01/01/Y (giờ VN). Mùa đầu tiên: 2027.
// Đúng giao thừa, game tự chuyển sang mùa Y+1. Dữ liệu mỗi mùa lưu riêng (cd_seasons/{Y}/…).
export const FIRST_SEASON = 2027;
export const targetOf = (y) => Date.UTC(y - 1, 11, 31, 17, 0, 0); // 00:00 01/01/y giờ VN
export const dec1Of = (y) => Date.UTC(y - 1, 10, 30, 17, 0, 0);   // 00:00 01/12/(y-1) giờ VN
/** Mùa hiện tại = năm (giờ VN) + 1 */
export function seasonOf(t = now()) {
  return new Date(t + 7 * 3600_000).getUTCFullYear() + 1;
}
const VN = 7 * 3600_000;

export const RULES = {
  shotCooldownMs: 15000, // mỗi người: 1 phát pháo / 15 giây (máy chủ cũng kiểm tra)
  wishCooldownMs: 15000, // mỗi người: 1 lời chúc / 15 giây (máy chủ cũng kiểm tra)
  flushEveryMs: 5000,    // thử ghi lại điểm chưa lưu được (nếu mạng lỗi)
  goldenStartHour: 20,   // giờ vàng 20:00–20:15 mỗi tối
  goldenMinutes: 15,
  goldenMult: 3,
  checkinPerDay: 10,     // điểm danh: 10 × số ngày liên tiếp (tối đa 30 ngày → 300)
};

// ---- Đồng hồ máy chủ ----
let offset = 0;
let simulated = false;

/** Đồng bộ giờ với máy chủ (đọc header Date). ?t=2026-12-31T23:59:30+07:00 để xem thử thời điểm khác. */
export async function syncClock() {
  const sim = new URLSearchParams(location.search).get("t");
  if (sim && !Number.isNaN(Date.parse(sim))) {
    offset = Date.parse(sim) - Date.now();
    simulated = true;
    return;
  }
  try {
    const t0 = Date.now();
    const r = await fetch(location.href.split("#")[0], { method: "HEAD", cache: "no-store" });
    const t1 = Date.now();
    const d = Date.parse(r.headers.get("date"));
    if (d) offset = d + 500 - (t0 + t1) / 2; // header Date làm tròn giây → cộng 0,5 s
  } catch {}
}
export const now = () => Date.now() + offset;
export const isSimulated = () => simulated;

// ---- Ngày / tuần theo giờ VN ----
const vnDate = (t) => new Date(t + VN);
export function dayKey(t = now()) {
  return vnDate(t).toISOString().slice(0, 10);
}
export function weekKey(t = now()) {
  // Tuần ISO (bắt đầu thứ Hai)
  const d = vnDate(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---- Hệ số ----
export function timeMult(t = now()) {
  const y = seasonOf(t);
  const left = targetOf(y) - t;
  if (left <= 0) return 0;
  if (left <= 60_000) return 10;
  if (left <= 3600_000) return 5;
  if (left <= 7 * 864e5) return 3;
  if (t >= dec1Of(y)) return 2;
  return 1;
}
export function timeMultLabel(t = now()) {
  const m = timeMult(t), left = targetOf(seasonOf(t)) - t;
  if (!m) return "Đã kết thúc";
  if (left <= 60_000) return "60 giây cuối";
  if (left <= 3600_000) return "Giờ cuối cùng";
  if (left <= 7 * 864e5) return "Tuần cuối";
  if (m === 2) return "Tháng 12";
  return "Thường";
}
export function streakMult(streak) {
  return 1 + Math.min(streak || 0, 30) / 30; // 30 ngày liên tiếp → ×2
}
export function isGolden(t = now()) {
  const d = vnDate(t);
  return d.getUTCHours() === RULES.goldenStartHour && d.getUTCMinutes() < RULES.goldenMinutes;
}
/** Thời điểm bắt đầu giờ vàng kế tiếp (ms) */
export function nextGolden(t = now()) {
  const d = vnDate(t);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RULES.goldenStartHour) - VN;
  if (t >= start) start += 864e5;
  return start;
}
export function goldenEnd(t = now()) {
  const d = vnDate(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RULES.goldenStartHour, RULES.goldenMinutes) - VN;
}

/** Điểm cho 1 phát pháo tại thời điểm t */
export function shotPoints(t, streak) {
  const m = timeMult(t);
  if (!m) return 0;
  return Math.max(1, Math.round(m * streakMult(streak) * (isGolden(t) ? RULES.goldenMult : 1)));
}

export function checkinBonus(streak) {
  return RULES.checkinPerDay * Math.min(streak, 30);
}

/** Tách thời gian còn lại thành ngày/giờ/phút/giây */
export function parts(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
export const pad = (n) => String(n).padStart(2, "0");
