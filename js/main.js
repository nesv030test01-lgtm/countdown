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
const subs = {};          // các kênh cập nhật tức thì
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
  unsubscribeAll();
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
  startBackground();
  if (!me.name) askName(true);
  else if (!localStorage.getItem("cd-rules-seen")) openRules();

  api.watchMe(u.uid, (d) => { if (d) { me = { uid: u.uid, ...d }; renderMe(); } }, (e) => console.warn(e));
  await refreshMine();
  subscribe();
  timers.push(
    setInterval(tick, 200),
    setInterval(doFlush, T.RULES.flushEveryMs),
    setInterval(subscribe, 60_000), // sang ngày / tuần mới → đổi bảng
    setInterval(ambient, 2500),
    setInterval(() => { if (document.visibilityState === "visible") api.heartbeat(u.uid).catch(() => {}); }, 60_000),
  );
  tick();
  renderMe();
}

// ---------- Ảnh nền theo tỉnh ----------
let bgCtl = null;
async function startBackground() {
  if (bgCtl) return bgCtl.setChoice(me?.province);
  bgCtl = { setChoice() {} };
  try {
    const bg = await import(`./bg.js?v=${V}`);
    bgCtl = await bg.initBackground({
      h, openModal: ui.openModal, closeModal: ui.closeModal, initial: me?.province,
      onPick: (key) => {
        if (!me || DEMO) return;
        me.province = key;
        api.setProvince(me.uid, key).catch((e) => console.warn(e));
      },
    });
  } catch (e) { console.warn(e); }
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
    $("my-per").textContent = `+${T.shotPoints(t, me.streak)}`;
    renderCheckin(t);
    renderCooldowns(t);
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
// Thời gian chờ mỗi loại (lưu trong máy để tải lại trang vẫn giữ). Máy chủ cũng chặn nếu < 15 giây.
const CD_KEY = "cd-cooldowns";
let cooldowns = {};
try { cooldowns = JSON.parse(localStorage.getItem(CD_KEY)) || {}; } catch {}
const cdLeft = (k) => Math.max(0, (cooldowns[k] || 0) - Date.now());
function startCooldown(k, ms) {
  cooldowns[k] = Date.now() + ms;
  try { localStorage.setItem(CD_KEY, JSON.stringify(cooldowns)); } catch {}
}
function renderCooldowns(t) {
  // Đang chờ → khoá nút, ẩn nội dung, chỉ hiện đồng hồ "⏳ 12s"
  const set = (btn, left, total) => {
    const cooling = left > 0;
    btn.disabled = cooling;
    btn.classList.toggle("cooling", cooling);
    btn.dataset.wait = cooling ? `⏳ ${Math.ceil(left / 1000)}s` : "";
    btn.style.setProperty("--p", cooling ? (1 - left / total).toFixed(3) : 1);
  };
  set($("btn-shoot"), cdLeft("shot"), T.RULES.shotCooldownMs);
  set($("btn-wish"), cdLeft("wish"), T.RULES.wishCooldownMs);
  const per = T.shotPoints(t, me.streak);
  $("shoot-sub").textContent = per ? `+${per} ĐIỂM` : "HẾT GIỜ";
  $("wish-sub").textContent = "LỜI CHÚC";
}

$("btn-shoot").onclick = () => {
  if (!me) return;
  if (cdLeft("shot") > 0) return; // đang chờ 15 giây (nút đã bị khoá)
  const t = T.now();
  const pts = T.shotPoints(t, me.streak);
  launch(0.5 + (Math.random() - 0.5) * 0.3, pts >= 10 ? 2 : 1);
  ui.boom(pts >= 10);
  ui.cheer(me.uid);
  if (!pts) return ui.toast("Mùa đếm ngược đã kết thúc — chúc mừng năm mới! 🎉");
  startCooldown("shot", T.RULES.shotCooldownMs);
  renderCooldowns(t);
  pending.user += pts;
  pending.period += pts;
  ui.floatText(`+${pts}`, 0.5, 70);
  renderMe();
  doFlush(); // ghi ngay lên máy chủ
};

async function doFlush() {
  // Chỉ ghi khi có phát pháo chưa lưu (điểm danh thưởng đi kèm lần ghi này)
  if (flushing || !me || !pending.user) return;
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
    // trả lại để thử ghi lần sau (giới hạn bằng mức máy chủ cho phép cho 1 phát)
    pending.user = Math.min(pending.user + inflight.user, 6 * Math.max(1, T.timeMult()));
    pending.period = Math.min(pending.period + inflight.period, 6 * Math.max(1, T.timeMult()) + 300);
    if (e?.code === "permission-denied") {
      startCooldown("shot", T.RULES.shotCooldownMs);
      ui.toast("Máy chủ yêu cầu chờ 15 giây giữa 2 phát — điểm sẽ được ghi ở phát sau.");
    }
  } finally {
    inflight = { user: 0, period: 0 };
    flushing = false;
    renderMe();
  }
}
addEventListener("pagehide", doFlush);
document.addEventListener("visibilitychange", () => { if (document.hidden) doFlush(); });

// ---------- Hiển thị của tôi ----------
function myPts(kind) {
  if (kind === "season") return (me.total || 0) + pending.user + inflight.user;
  const row = boards[kind]?.list.find((x) => x.uid === me.uid);
  const saved = Math.max(row?.pts || 0, kind === "day" ? myDay : myWeek);
  return saved + pending.period + inflight.period;
}
/** Bảng đã gộp điểm mới nhất của tôi (chưa kịp lưu) để thứ hạng nhảy ngay khi bắn */
function mergedBoard(kind) {
  const list = (boards[kind]?.list || []).map((x) => ({ ...x }));
  if (!me) return list;
  const pts = myPts(kind);
  const row = list.find((x) => x.uid === me.uid);
  if (row) { row.pts = pts; row.name = me.name || row.name; }
  else if (pts > 0) list.push({ uid: me.uid, name: me.name || "Ẩn danh", pts });
  return list.sort((a, b) => b.pts - a.pts).slice(0, 10);
}

function renderMe() {
  if (!me) return;
  $("me-name").textContent = me.name || "Ẩn danh";
  const img = $("me-ava");
  img.classList.toggle("hidden", !me.photoURL);
  if (me.photoURL && img.getAttribute("src") !== me.photoURL) img.src = me.photoURL;
  $("my-total").textContent = ui.fmt(myPts("season"));
  $("my-day").textContent = ui.fmt(myPts("day"));
  const day = mergedBoard("day");
  const i = day.findIndex((x) => x.uid === me.uid);
  $("my-rank").textContent = i >= 0 ? `#${i + 1}` : day.length >= 10 ? ">10" : "—";
  ranks = new Map(day.slice(0, 5).map((x, k) => [x.uid, k + 1]));
  ui.renderBoard(mergedBoard(tab), me.uid, tab === "season" ? "Chưa có ai trên bảng mùa này." : undefined);
  drawPeople();
}

function drawPeople() {
  if (!me) return;
  const others = online.filter((x) => x.uid !== me.uid);
  ui.renderPeople(me, others, ranks);
  $("online-count").textContent = ui.fmt(others.length + 1);
}

// ---------- Cập nhật tức thì: bảng xếp hạng + người đang online ----------
async function refreshMine() {
  try {
    [myDay, myWeek] = await Promise.all([api.fetchMine("day", T.dayKey(), me.uid), api.fetchMine("week", T.weekKey(), me.uid)]);
  } catch {}
}
const warn = (e) => { console.warn(e); if (e?.code === "permission-denied") ui.toast(errMsg(e)); };
function unsubscribeAll() {
  for (const k of ["day", "tab", "online"]) { subs[k]?.(); subs[k] = null; }
  subs.dayKey = subs.tabKey = null;
  boards = {};
  online = [];
  prevTotals = new Map();
}
function subscribe() {
  if (!me) return;
  const dk = T.dayKey();
  if (subs.dayKey !== dk) {
    subs.day?.();
    subs.dayKey = dk;
    if (myDay && boards.day && boards.day.key !== dk) myDay = 0; // sang ngày mới
    subs.day = api.watchBoard("day", dk, (list) => { boards.day = { key: dk, list }; renderMe(); }, warn);
  }
  const tk = tab === "week" ? T.weekKey() : tab === "season" ? "season" : null;
  if (tab === "day") { subs.tab?.(); subs.tab = null; subs.tabKey = null; }
  else if (subs.tabKey !== tab + tk) {
    subs.tab?.();
    subs.tabKey = tab + tk;
    const kind = tab;
    subs.tab = api.watchBoard(kind, tk, (list) => { boards[kind] = { key: tk, list }; renderMe(); }, warn);
  }
  if (!subs.online) subs.online = api.watchOnline(T.now, onOnline, warn);
}
function onOnline(on) {
  // Ai vừa bắn pháo (điểm tăng) → thông báo + pháo hoa từ chỗ họ
  for (const x of on) {
    const before = prevTotals.get(x.uid);
    if (x.uid !== me.uid && before != null && x.pts > before) {
      const gain = x.pts - before;
      ui.pushBanner(`🎆 ${x.name || "Ẩn danh"} vừa bắn pháo (+${ui.fmt(gain)} điểm)`);
      setTimeout(() => { launch(ui.personX(x.uid), gain > 50 ? 2 : 1); ui.cheer(x.uid); }, Math.random() * 800);
    }
    prevTotals.set(x.uid, x.pts);
  }
  online = on;
  renderMe();
}
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    subscribe();
    renderMe();
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
      h("li", {}, "Mỗi người được bắn 1 phát pháo mỗi 15 giây, và gửi 1 lời chúc mỗi 15 giây — hãy canh giờ thật chuẩn!"),
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
  if (cdLeft("wish") > 0) return; // đang chờ 15 giây
  const after = T.now() >= T.TARGET;
  const ta = h("textarea", { maxlength: 120, rows: 3, placeholder: after ? "Chúc mừng năm mới 2027! …" : "Năm 2027 mình mong…" });
  const list = h("ul", { class: "wish-list" });
  const send = h("button", { class: "btn btn-gold" }, "🏮 Gửi lời chúc");
  send.onclick = async () => {
    const text = ta.value.replace(/\s+/g, " ").trim();
    if (!text) return ui.toast("Hãy viết lời chúc trước nhé.");
    if (cdLeft("wish") > 0) return;
    send.disabled = true;
    try {
      await api.addWish(me.uid, me.name, text);
      startCooldown("wish", T.RULES.wishCooldownMs);
      renderCooldowns(T.now());
      ui.closeModal();
      ui.toast("Đã gửi lời chúc 🏮");
      launch(0.5, 2);
      if (after) setTimeout(showGolden, 1500);
    } catch (e) {
      send.disabled = false;
      if (e?.code === "permission-denied") { startCooldown("wish", T.RULES.wishCooldownMs); ui.toast("Chờ 15 giây giữa 2 lời chúc nhé ⏳"); }
      else ui.toast(errMsg(e));
    }
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
