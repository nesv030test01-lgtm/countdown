// Giao diện: đám đông, bảng xếp hạng, thông báo, hộp thoại
const $ = (id) => document.getElementById(id);
export const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");

// ---- Vị trí người trong đám đông (% trong khung) ----
const ME_SLOT = { x: 50, y: 79, s: 1.3 };
const SLOTS = [
  { x: 34, y: 71, s: 1 }, { x: 66, y: 71, s: 1 }, { x: 18, y: 71, s: 1 }, { x: 82, y: 71, s: 1 },
  { x: 30, y: 78.5, s: 1.08 }, { x: 70, y: 78.5, s: 1.08 }, { x: 10, y: 78, s: 1.08 }, { x: 90, y: 78, s: 1.08 },
  { x: 24, y: 86, s: 1.16 }, { x: 76, y: 86, s: 1.16 }, { x: 42, y: 86.5, s: 1.16 }, { x: 58, y: 86.5, s: 1.16 },
];
const JACKETS = ["#e94f7c", "#4f8ef0", "#f0a830", "#3fbf8f", "#9b6bf0", "#f06d4f", "#47c4d9", "#d94fd0"];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

function figure(uid, sparkler) {
  const c = JACKETS[Math.abs(hash(uid)) % JACKETS.length];
  return `<svg class="fig-svg" viewBox="0 0 40 60" aria-hidden="true">
    <ellipse cx="20" cy="58" rx="13" ry="2.5" fill="rgba(0,0,0,.4)"/>
    <rect x="13" y="42" width="5.5" height="15" rx="2" fill="#1d1a33"/>
    <rect x="21.5" y="42" width="5.5" height="15" rx="2" fill="#1d1a33"/>
    <path d="M9 44 Q8 26 14 22 Q20 19 26 22 Q32 26 31 44 Z" fill="${c}"/>
    ${sparkler
      ? `<path d="M29 26 Q34 18 33 9" stroke="${c}" stroke-width="5" stroke-linecap="round" fill="none"/>
         <circle cx="33" cy="6" r="3.5" fill="#fff6c8"/><circle cx="33" cy="6" r="6" fill="#ffd36b" opacity=".45"/>`
      : `<path d="M29 26 Q33 32 31 40" stroke="${c}" stroke-width="5" stroke-linecap="round" fill="none"/>`}
    <path d="M11 26 Q7 32 9 40" stroke="${c}" stroke-width="5" stroke-linecap="round" fill="none"/>
    <circle cx="20" cy="13" r="7.5" fill="#2a2030"/>
  </svg>`;
}

export function renderPeople(me, others, ranks) {
  const box = $("people");
  const want = new Map();
  if (me) want.set(me.uid, { ...me, slot: ME_SLOT, isMe: true });
  others.slice(0, SLOTS.length).forEach((u, i) => want.set(u.uid, { ...u, slot: SLOTS[i] }));
  [...box.children].forEach((el) => { if (!want.has(el.dataset.uid)) el.remove(); });
  for (const [uid, u] of want) {
    const r = ranks.get(uid);
    const key = `${r && r <= 3 ? 1 : 0}`;
    let el = [...box.children].find((c) => c.dataset.uid === uid);
    if (!el || el.dataset.k !== key) {
      el?.remove();
      el = document.createElement("div");
      el.className = "person";
      el.dataset.uid = uid;
      el.dataset.k = key;
      el.innerHTML = figure(uid, key === "1") + `<div class="tag"><span class="rank"></span><img class="ava" alt="" referrerpolicy="no-referrer"><span class="nm"></span></div>`;
      box.appendChild(el);
    }
    el.classList.toggle("me", !!u.isMe);
    Object.assign(el.style, { left: u.slot.x + "%", top: u.slot.y + "%", zIndex: Math.round(u.slot.y * 10) });
    el.style.setProperty("--s", u.slot.s);
    el.querySelector(".nm").textContent = u.name || "Ẩn danh";
    const rk = el.querySelector(".rank");
    rk.textContent = r || "";
    rk.hidden = !r;
    rk.className = "rank " + (r === 1 ? "r1" : r === 2 ? "r2" : r === 3 ? "r3" : "");
    const img = el.querySelector(".ava");
    if (u.photoURL && !r) { if (img.getAttribute("src") !== u.photoURL) img.src = u.photoURL; img.hidden = false; }
    else img.hidden = true;
  }
}

export function cheer(uid) {
  const el = [...$("people").children].find((c) => c.dataset.uid === uid)?.querySelector(".fig-svg");
  if (!el) return;
  el.classList.remove("cheer");
  void el.getBoundingClientRect();
  el.classList.add("cheer");
}

/** Vị trí ngang (0–1) của một người trên màn hình — để bắn pháo từ chỗ người đó */
export function personX(uid) {
  const el = [...$("people").children].find((c) => c.dataset.uid === uid);
  return el ? parseFloat(el.style.left) / 100 : 0.2 + Math.random() * 0.6;
}

export function renderBoard(list, myUid, emptyText) {
  const ol = $("board-list");
  ol.innerHTML = "";
  if (!list.length) {
    ol.append(h("li", { class: "empty" }, emptyText || "Chưa có ai — bắn phát đầu tiên nào! 🎆"));
    return;
  }
  list.slice(0, 7).forEach((u, i) => {
    ol.append(h("li", { class: u.uid === myUid ? "mine" : "" },
      h("span", { class: "rank " + (i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "rn") }, String(i + 1)),
      h("span", { class: "nm" }, u.name || "Ẩn danh"),
      h("span", { class: "pts" }, fmt(u.pts)),
    ));
  });
}

// ---- Thông báo chạy ----
const queue = [];
let busy = false;
export function pushBanner(text) {
  if (queue.length > 4) queue.shift();
  queue.push(text);
  if (!busy) nextBanner();
}
function nextBanner() {
  const b = $("banner");
  const t = queue.shift();
  if (!t) { busy = false; return; }
  busy = true;
  b.textContent = t;
  b.classList.add("show");
  setTimeout(() => { b.classList.remove("show"); setTimeout(nextBanner, 300); }, 2400);
}

export function floatText(text, xFrac = 0.5, yPct = 60) {
  const el = document.createElement("div");
  el.className = "float";
  el.textContent = text;
  el.style.left = xFrac * 100 + "%";
  el.style.top = yPct + "%";
  $("float-layer").appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---- Âm thanh pháo (tổng hợp, không cần file) ----
let actx;
export function boom(big = false) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = actx.sampleRate * (big ? 0.9 : 0.5);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = big ? 900 : 1400;
    const g = actx.createGain();
    g.gain.value = big ? 0.5 : 0.25;
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
  } catch {}
}

// ---- Hộp thoại ----
let locked = false;
export function openModal(build, opts = {}) {
  locked = !!opts.locked;
  const card = $("modal-card");
  card.innerHTML = "";
  build(card);
  $("modal").classList.remove("hidden");
}
export function closeModal() { $("modal").classList.add("hidden"); $("modal-card").innerHTML = ""; }
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal" && !locked) closeModal(); });

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el[k] = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}
