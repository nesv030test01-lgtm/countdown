// Chế độ demo (?demo=1): dữ liệu giả, không cần Firebase. Dùng để xem thử giao diện.
import { now } from "./time.js";

const NAMES = ["Minh Anh", "Tuấn Kiệt", "Ngọc Hân", "Bảo Long", "Thu Trang", "Gia Huy", "Lan Chi", "Đức Mạnh", "Hà My", "Quang Vinh", "Khánh Linh", "Hoàng Nam"];

export function demoApi() {
  const people = NAMES.map((name, i) => ({ uid: "d" + i, name, photoURL: null, pts: 2000 - i * 140 + ((Math.random() * 80) | 0) }));
  const me = { name: "Bạn", photoURL: null, total: 860, streak: 4, lastCheckinAt: now() - 22 * 3600_000 };
  const day = new Map(people.map((p) => [p.uid, (p.pts / 6) | 0]));
  day.set("demo-me", 120);
  const wishes = [{ name: "Ngọc Hân", text: "Chúc cả nhà 2027 bình an, nhiều sức khỏe!" }, { name: "Bảo Long", text: "Năm mới thi đỗ đại học 🙏" }];
  let meCb = () => {};
  // người khác thỉnh thoảng tăng điểm
  setInterval(() => {
    const p = people[(Math.random() * people.length) | 0];
    const g = 3 + ((Math.random() * 30) | 0);
    p.pts += g;
    day.set(p.uid, (day.get(p.uid) || 0) + g);
  }, 1500);

  const sortList = (arr) => arr.sort((a, b) => b.pts - a.pts);
  return {
    ensureUser: async () => ({ ...me }),
    setName: async (_, name) => { me.name = name; meCb({ ...me }); },
    heartbeat: async () => {},
    watchMe: (_, cb) => { meCb = cb; cb({ ...me }); return () => {}; },
    checkin: async (_, streak, bonus) => { me.streak = streak; me.lastCheckinAt = now(); me.total += bonus; meCb({ ...me }); },
    flush: async ({ userPts, periodPts }) => { me.total += userPts; day.set("demo-me", (day.get("demo-me") || 0) + periodPts); meCb({ ...me }); },
    fetchMine: async (kind) => (kind === "day" ? day.get("demo-me") : 400),
    fetchBoard: async (kind, _, n = 10) => {
      if (kind === "season") return sortList([...people.map((p) => ({ ...p })), { uid: "demo-me", name: me.name, pts: me.total }]).slice(0, n);
      const src = kind === "day" ? day : new Map([...day].map(([k, v]) => [k, v * 4]));
      return sortList([...src].map(([uid, pts]) => ({ uid, pts, name: uid === "demo-me" ? me.name : people.find((p) => p.uid === uid)?.name }))).slice(0, n);
    },
    fetchOnline: async () => people.slice(0, 11).map((p) => ({ ...p })),
    addWish: async (_, name, text) => { wishes.unshift({ name, text }); },
    fetchWishes: async () => wishes.slice(0, 8),
    fetchOpener: async () => wishes[0] || null,
  };
}
