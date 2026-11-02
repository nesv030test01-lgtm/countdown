import { isConfigured } from "./firebase-config.js";
import * as T from "./time.js";
import * as ui from "./ui.js";
import { initFx, launch, finale } from "./fx.js";

const V = new URL(import.meta.url).searchParams.get("v") || "0";
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const $ = (id) => document.getElementById(id);
const { h } = ui;

const errMsg = (e) =>
  ({
    "auth/popup-closed-by-user": "Bạn đã đóng cửa sổ đăng nhập.",
    "auth/unauthorized-domain": "Domain này chưa được thêm vào Authorized domains trong Firebase.",
    "auth/admin-restricted-operation": "Chưa bật đăng nhập Anonymous trong Firebase.",
    "auth/operation-not-allowed": "Phương thức đăng nhập này chưa được bật trong Firebase.",
    "permission-denied": "Máy chủ từ chối (hãy Publish file firestore.rules mới nhất).",
  })[e?.code] || e?.message || "Có lỗi xảy ra.";

function show(id) {
  ["screen-login", "screen-game"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
  $("loading").classList.add("hidden");
}

// ---------- Nhạc nền: bật ngay khi mở trang (lần chạm đầu tiên sẽ mở tiếng) ----------
import(`./music.js?v=${V}`).then((m) => m.initMusic(ui.toast)).catch((e) => console.warn(e));

// ---------- Khởi động ----------
await T.syncClock();
let api, auth;
if (DEMO) {
  api = (await import(`./demo.js?v=${V}`)).demoApi();
} else if (!isConfigured) {
  $("loading").textContent = "Chưa cấu hình Firebase (xem README).";
} else {
  [api, auth] = await Promise.all([import(`./db.js?v=${V}`), import(`./auth.js?v=${V}`)]);
}

// ---------- Trạng thái ----------
let user = null;           // tài khoản Firebase
let me = null;             // hồ sơ: { uid, name, photoURL, total, streak, lastCheckinAt }
let myDay = 0, myWeek = 0; // điểm ngày / tuần (đã lưu)
let pending = { user: 0, period: 0 }, inflight = { user: 0, period: 0 }, flushing = false;
let lastShot = 0;
let tab = "day";
let boards = {};           // cache bảng xếp hạng
let online = [];
let prevTotals = new Map();
let ranks = new Map();
let goldenShown = false;
let simWarned = false;
let timers = [];
const tsMs = (x) => (x?.toMillis ? x.toMillis() : typeof x === "number" ? x : null);

if (DEMO) boot({ uid: "demo-me", isAnonymous: true, providerData: [] });
else if (auth) {
  $("btn-google").onclick = () => auth.loginGoogle().catch((e) => ($("login-error").textContent = errMsg(e)));
  $("btn-guest").onclick = () => auth.loginGuest().catch((e) => ($("login-error").textContent = errMsg(e)));
  auth.watchAuth((u) => (u ? boot(u) : (me = null, show("screen-login"))));
}

async function boot(u) {
  timers.forEach(clearInterval);
  timers = [];
  user = u;
  me = null;
  // Tạo / đọc hồ sơ. Thử lại vài lần; nếu vẫn lỗi thì báo rõ và dừng (không chạy tiếp với hồ sơ rỗng).
  let lastErr = null;
  for (let i = 0; i < 3 && !me; i++) {
    try {
      const d = await api.ensureUser(u);
      me = { uid: u.uid, ...d };
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  if (!me) {
    show("screen-login");
    $("login-error").textContent = "Không tạo được hồ sơ: " + errMsg(lastErr) + " Hãy tải lại trang.";
    console.error(lastErr);
    return;
  }

  show("screen-game");
  initFx($("fx"));
  if (!me.name) askName(true);
  else if (!localStorage.getItem("cd-rules-seen")) openRules();

  api.watchMe(u.uid, (d) => { if (d) { me = { uid: u.uid, ...d }; renderMe(); } }, (e) => console.warn(e));
  await refreshMine();
  refresh();
  timers.push(
    setInterval(tick, 200),
    setInterval(doFlush, T.RULES.flushEveryMs),
    setInterval(refresh, 45_000),
    setInterval(ambient, 2500),
    setInterval(() => { if (document.visibilityState === "visible") api.heartbeat(u.uid).catch(() => {}); }, 60_000),
  );
  tick();
  renderMe();
}

// ---------- Đồng hồ ----------
function tick() {
  const t = T.now();
  const left = T.TARGET - t;
  const p = T.parts(left);
  $("cd-d").textContent = T.pad(p.d);
  $("cd-h").textContent = T.pad(p.h);
  $("cd-m").textContent = T.pad(p.m);
  $("cd-s").textContent = T.pad(p.s);

  const m = T.timeMult(t);
  const chip = $("chip-time");
  chip.textContent = m ? `×${m} ${T.timeMultLabel(t)}` : "Đã sang 2027";
  chip.classList.toggle("hot", m >= 3);

  const g = $("chip-golden");
  if (T.isGolden(t)) {
    const r = T.parts(T.goldenEnd(t) - t);
    g.textContent = `⭐ GIỜ VÀNG ×3 · còn ${T.pad(r.m)}:${T.pad(r.s)}`;
    g.classList.add("on");
  } else {
    const r = T.parts(T.nextGolden(t) - t);
    g.textContent = `⭐ Giờ vàng 20:00 · ${r.h ? r.h + "g " : ""}${T.pad(r.m)}:${T.pad(r.s)}`;
    g.classList.remove("on");
  }
  if (me) {
    $("chip-streak").textContent = `🔥 Chuỗi ${me.streak || 0} ngày ×${T.streakMult(me.streak).toFixed(2)}`;
    const per = T.shotPoints(t, me.streak);
    $("my-per").textContent = `+${per}`;
    $("shoot-sub").textContent = per ? `+${per} ĐIỂM` : "HẾT GIỜ";
    renderCheckin(t);
  }

  // 10 giây cuối
  const fin = $("final");
  if (left > 0 && left <= 10_000) {
    const n = String(Math.ceil(left / 1000));
    if (fin.textContent !== n) {
      fin.textContent = n;
      fin.classList.remove("hidden", "tick");
      void fin.offsetWidth;
      fin.classList.add("tick");
      launch(undefined, 2);
    }
  } else if (!fin.classList.contains("hidden")) fin.classList.add("hidden");

  if (left <= 0 && !goldenShown) { goldenShown = true; showGolden(); }
}

// ---------- Điểm danh ----------
function checkinState(t = T.now()) {
  const last = tsMs(me?.lastCheckinAt);
  const can = !last || t - last >= 20 * 3600_000;
  const next = last && t - last < 48 * 3600_000 ? (me.streak || 0) + 1 : 1;
  return { can, next, wait: last ? last + 20 * 3600_000 - t : 0 };
}
function renderCheckin(t) {
  const b = $("btn-checkin");
  const s = checkinState(t);
  if (s.can && T.TARGET > t) {
    b.classList.remove("done");
    $("checkin-sub").textContent = `+${T.checkinBonus(s.next)} ĐIỂM`;
  } else {
    b.classList.add("done");
    const w = T.parts(s.wait);
    $("checkin-sub").textContent = s.wait > 0 ? `SAU ${w.h}g${T.pad(w.m)}` : "ĐÃ XONG";
  }
}
$("btn-checkin").onclick = async () => {
  if (!me) return;
  const s = checkinState();
  if (!s.can) return ui.toast("Hôm nay bạn đã điểm danh rồi. Quay lại vào ngày mai để giữ chuỗi 🔥");
  if (T.TARGET <= T.now()) return;
  if (T.isSimulated()) return ui.toast("Đang xem thử thời gian — không lưu điểm.");
  const bonus = T.checkinBonus(s.next);
  try {
    $("btn-checkin").disabled = true;
    await api.checkin(me.uid, s.next, bonus);
    pending.period += bonus; // cộng vào bảng ngày/tuần ở lần ghi kế tiếp
    ui.floatText(`+${bonus}`, 0.17, 88);
    ui.toast(s.next > 1 ? `🔥 Chuỗi ${s.next} ngày! +${bonus} điểm` : `Điểm danh +${bonus} điểm. Mai quay lại để giữ chuỗi nhé!`);
    launch(0.5, 2);
  } catch (e) { ui.toast(errMsg(e)); }
  finally { $("btn-checkin").disabled = false; }
};

// ---------- Bắn pháo ----------
$("btn-shoot").onclick = () => {
  if (!me) return;
  const t = T.now();
  if (t - lastShot < T.RULES.shotCooldownMs) return;
  lastShot = t;
  const pts = T.shotPoints(t, me.streak);
  launch(0.5 + (Math.random() - 0.5) * 0.3, pts >= 10 ? 2 : 1);
  ui.boom(pts >= 10);
  ui.cheer(me.uid);
  if (!pts) return ui.toast("Mùa đếm ngược đã kết thúc — chúc mừng năm mới! 🎉");
  pending.user += pts;
  pending.period += pts;
  ui.floatText(`+${pts}`, 0.5, 70);
  renderMe();
};

async function doFlush() {
  if (flushing || !me || (!pending.user && !pending.period)) return;
  if (T.isSimulated()) {
    if (!simWarned) { simWarned = true; ui.toast("Đang xem thử thời gian (?t=…) — điểm không được lưu."); }
    return;
  }
  flushing = true;
  inflight = pending;
  pending = { user: 0, period: 0 };
  try {
    await api.flush({
      uid: me.uid, name: me.name, photoURL: me.photoURL,
      userPts: inflight.user, periodPts: inflight.period,
      day: T.dayKey(), week: T.weekKey(),
    });
    myDay += inflight.period;
    myWeek += inflight.period;
  } catch (e) {
    console.warn(e);
    // trả lại để ghi lần sau (giới hạn để không vượt mức máy chủ cho phép)
    pending.user = Math.min(pending.user + inflight.user, 100);
    pending.period = Math.min(pending.period + inflight.period, 300);
    if (e?.code === "permission-denied") ui.toast(errMsg(e));
  } finally {
    inflight = { user: 0, period: 0 };
    flushing = false;
    renderMe();
  }
}
addEventListener("pagehide", doFlush);
document.addEventListener("visibilitychange", () => { if (document.hidden) doFlush(); });

// ---------- Hiển thị của tôi ----------
function renderMe() {
  if (!me) return;
  $("me-name").textContent = me.name || "Ẩn danh";
  const img = $("me-ava");
  img.classList.toggle("hidden", !me.photoURL);
  if (me.photoURL && img.getAttribute("src") !== me.photoURL) img.src = me.photoURL;
  $("my-total").textContent = ui.fmt((me.total || 0) + pending.user + inflight.user);
  $("my-day").textContent = ui.fmt(myDay + pending.period + inflight.period);
  const day = boards.day?.list || [];
  const i = day.findIndex((x) => x.uid === me.uid);
  $("my-rank").textContent = i >= 0 ? `#${i + 1}` : day.length >= 10 ? ">10" : "—";
  drawPeople();
}

function drawPeople() {
  if (!me) return;
  const others = online.filter((x) => x.uid !== me.uid);
  ui.renderPeople(me, others, ranks);
  $("online-count").textContent = ui.fmt(others.length + 1);
}

// ---------- Làm mới bảng xếp hạng / người đang online ----------
async function refreshMine() {
  try {
    [myDay, myWeek] = await Promise.all([api.fetchMine("day", T.dayKey(), me.uid), api.fetchMine("week", T.weekKey(), me.uid)]);
  } catch {}
}
async function loadBoard(kind, force) {
  const key = kind === "day" ? T.dayKey() : kind === "week" ? T.weekKey() : "season";
  const c = boards[kind];
  if (!force && c && c.key === key && Date.now() - c.at < 20_000) return c.list;
  const list = await api.fetchBoard(kind, key);
  boards[kind] = { key, list, at: Date.now() };
  return list;
}
async function refresh() {
  if (!me) return;
  try {
    const [list, on] = await Promise.all([loadBoard(tab, true), api.fetchOnline(T.now())]);
    if (tab !== "day") await loadBoard("day");
    ranks = new Map((boards.day?.list || []).slice(0, 5).map((x, i) => [x.uid, i + 1]));
    ui.renderBoard(list, me.uid, tab === "season" ? "Chưa có ai trên bảng mùa này." : undefined);
    // Ai vừa bắn pháo (điểm tăng so với lần trước) → thông báo + pháo hoa từ chỗ họ
    for (const x of on) {
      const before = prevTotals.get(x.uid);
      if (x.uid !== me.uid && before != null && x.pts > before) {
        const gain = x.pts - before;
        ui.pushBanner(`🎆 ${x.name} vừa bắn pháo (+${ui.fmt(gain)} điểm)`);
        setTimeout(() => { launch(ui.personX(x.uid), gain > 50 ? 2 : 1); ui.cheer(x.uid); }, Math.random() * 1500);
      }
      prevTotals.set(x.uid, x.pts);
    }
    online = on;
    renderMe();
  } catch (e) { console.warn(e); }
}
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = async () => {
    tab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    try { ui.renderBoard(await loadBoard(tab), me?.uid); } catch (e) { console.warn(e); }
  };
});

// Pháo hoa nền: dày hơn vào giờ vàng và giờ cuối
function ambient() {
  const t = T.now();
  const m = T.timeMult(t);
  const rate = (T.isGolden(t) ? 0.9 : 0.35) + (m >= 5 ? 0.6 : 0);
  if (Math.random() < rate) launch();
}

// ---------- Hộp thoại ----------
function askName(first) {
  const input = h("input", { maxlength: 24, placeholder: "Tên hiển thị trên bảng xếp hạng", value: me?.name || "" });
  const err = h("p", { class: "error" });
  const save = async (name) => {
    name = (name || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name) return (err.textContent = "Hãy nhập tên (1–24 ký tự).");
    try {
      try {
        await api.setName(me.uid, name);
      } catch (e) {
        if (e?.code !== "not-found" || DEMO) throw e;
        await api.ensureUser(user); // hồ sơ chưa có → tạo rồi lưu tên lại
        await api.setName(me.uid, name);
      }
      me.name = name;
      renderMe();
      ui.closeModal();
      if (first && !localStorage.getItem("cd-rules-seen")) openRules();
    } catch (e) { err.textContent = errMsg(e); }
  };
  ui.openModal((card) => {
    card.append(
      h("h2", {}, first ? "Bạn tên gì?" : "Đổi tên"),
      h("p", {}, "Tên sẽ hiện trong đám đông và trên Bảng vàng 2027."),
      input, err,
      h("div", { class: "row" },
        first ? h("button", { class: "btn btn-ghost", onclick: () => save(`Người chơi ${me.uid.slice(0, 4)}`) }, "Để sau") : null,
        h("button", { class: "btn btn-gold", onclick: () => save(input.value) }, "Lưu"),
      ),
    );
    input.onkeydown = (e) => { if (e.key === "Enter") save(input.value); };
    setTimeout(() => input.focus(), 50);
  }, { locked: first });
}

function openRules() {
  try { localStorage.setItem("cd-rules-seen", "1"); } catch {}
  ui.openModal((card) => card.append(
    h("h2", {}, "🎆 Cách tranh top"),
    h("ul", { class: "rules" },
      h("li", {}, "Mỗi phát pháo được điểm. Càng gần giao thừa càng nhiều: tháng 11 ×1, tháng 12 ×2, tuần cuối ×3, giờ cuối ×5, 60 giây cuối ×10."),
      h("li", {}, "Điểm danh mỗi ngày để giữ chuỗi 🔥 — chuỗi càng dài, mỗi phát càng nhiều điểm (30 ngày liên tiếp ×2). Bỏ 1 ngày là mất chuỗi!"),
      h("li", {}, "⭐ Giờ vàng 20:00–20:15 mỗi tối: điểm ×3."),
      h("li", {}, "3 bảng xếp hạng: Hôm nay, Tuần này, cả Mùa."),
      h("li", {}, "Đúng 00:00 ngày 01/01/2027: top 10 của Mùa lên Bảng vàng 2027. Người gửi lời chúc đầu tiên sau giao thừa là \"Người mở màn 2027\"."),
    ),
    h("button", { class: "btn btn-gold", onclick: ui.closeModal }, "Bắt đầu bắn pháo! 🎆"),
  ));
}

$("btn-me").onclick = () => {
  if (!me) return;
  ui.openModal((card) => card.append(
    h("h2", {}, me.name || "Ẩn danh"),
    h("p", {}, DEMO ? "Chế độ demo" : user.isAnonymous ? "Khách — chưa liên kết Google" : (user.email || "Tài khoản Google")),
    h("div", { class: "stats-mini" },
      h("div", {}, h("b", {}, ui.fmt(me.total)), "Điểm mùa"),
      h("div", {}, h("b", {}, ui.fmt(myWeek)), "Tuần này"),
      h("div", {}, h("b", {}, String(me.streak || 0)), "Chuỗi ngày"),
    ),
    h("button", { class: "btn btn-ghost", onclick: openRules }, "📜 Luật chơi"),
    h("button", { class: "btn btn-ghost", onclick: () => askName(false) }, "✏️ Đổi tên"),
    !DEMO && user.isAnonymous ? h("button", { class: "btn btn-google", onclick: linkGoogle }, h("span", { class: "g" }, "G"), " Liên kết Google để giữ điểm") : null,
    !DEMO ? h("button", { class: "btn btn-ghost", onclick: logout }, "Đăng xuất") : null,
  ));
};

async function linkGoogle() {
  try {
    const res = await auth.linkGuestToGoogle();
    if (res.conflict) {
      if (confirm("Tài khoản Google này đã có điểm từ trước. Chuyển sang tài khoản đó? (Điểm khách hiện tại không được gộp.)")) {
        ui.closeModal(); await auth.logout(); await auth.loginGoogle();
      }
      return;
    }
    await api.ensureUser(res.user);
    ui.closeModal();
    ui.toast("Đã liên kết Google 🎉");
  } catch (e) { ui.toast(errMsg(e)); }
}
async function logout() {
  if (user?.isAnonymous && !confirm("Bạn đang là khách. Đăng xuất sẽ mất điểm nếu chưa liên kết Google. Tiếp tục?")) return;
  await doFlush();
  ui.closeModal();
  auth.logout();
}

$("btn-wish").onclick = () => openWish();
function openWish() {
  const after = T.now() >= T.TARGET;
  const ta = h("textarea", { maxlength: 120, rows: 3, placeholder: after ? "Chúc mừng năm mới 2027! …" : "Năm 2027 mình mong…" });
  const list = h("ul", { class: "wish-list" });
  const send = h("button", { class: "btn btn-gold" }, "🏮 Gửi lời chúc");
  send.onclick = async () => {
    const text = ta.value.replace(/\s+/g, " ").trim();
    if (!text) return ui.toast("Hãy viết lời chúc trước nhé.");
    send.disabled = true;
    try {
      await api.addWish(me.uid, me.name, text);
      ui.closeModal();
      ui.toast("Đã gửi lời chúc 🏮");
      launch(0.5, 2);
      if (after) setTimeout(showGolden, 1500);
    } catch (e) { send.disabled = false; ui.toast(errMsg(e)); }
  };
  ui.openModal((card) => {
    card.append(
      h("h2", {}, "🏮 Lời chúc năm mới"),
      h("p", {}, after ? "Người gửi lời chúc ĐẦU TIÊN sau 00:00 là \"Người mở màn 2027\"!" : "Lời chúc hiện cho mọi người cùng xem. Sau đúng 00:00, người gửi đầu tiên sẽ là \"Người mở màn 2027\"."),
      ta, send, h("p", { style: "margin-top:14px" }, "Lời chúc mới nhất:"), list,
    );
    setTimeout(() => ta.focus(), 50);
  });
  api.fetchWishes().then((ws) => {
    if (!ws.length) list.append(h("li", {}, "Chưa có lời chúc nào."));
    ws.forEach((w) => list.append(h("li", {}, h("b", {}, w.name + ": "), w.text)));
  }).catch(() => {});
}

// ---------- Bảng vàng giao thừa ----------
async function showGolden() {
  finale(10);
  ui.boom(true);
  const box = $("golden");
  box.classList.remove("hidden");
  box.innerHTML = "";
  const card = h("div", { class: "golden-card" },
    h("h2", {}, "CHÚC MỪNG NĂM MỚI"),
    h("div", { class: "big-year" }, "2027"),
    h("p", { style: "color:var(--gold);font-weight:800;margin:6px 0 0" }, "🏆 BẢNG VÀNG 2027"),
  );
  const ol = h("ol");
  const opener = h("div", { class: "opener" }, "Đang tìm Người mở màn 2027…");
  card.append(ol, opener,
    h("div", { class: "row", style: "display:flex;gap:8px" },
      h("button", { class: "btn btn-gold", onclick: openWish }, "🏮 Gửi lời chúc"),
      h("button", { class: "btn btn-ghost", onclick: () => box.classList.add("hidden") }, "Đóng"),
    ),
  );
  box.append(card);
  try {
    const top = await api.fetchBoard("season", "season", 10);
    top.forEach((u, i) => ol.append(h("li", {},
      h("span", { class: "rank " + (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "rn") }, String(i + 1)),
      u.name || "Ẩn danh", h("span", { class: "pts" }, ui.fmt(u.pts)))));
    const op = await api.fetchOpener();
    opener.textContent = op ? `🌅 Người mở màn 2027: ${op.name} — “${op.text}”` : "🌅 Chưa có ai — gửi lời chúc ngay để trở thành Người mở màn 2027!";
  } catch (e) { console.warn(e); }
}
