// Nhạc nền — phát lần lượt các bài trong thư mục audio/
//
// Thêm bài: chép file (.mp3 .m4a .ogg .wav …) vào thư mục audio/ rồi push. Không cần sửa code.
// Phát NGẪU NHIÊN (đổi CFG.shuffle = false để phát theo tên file 01-…, 02-…).
// Danh sách tự chọn (tuỳ chọn): audio/playlist.json, ví dụ  ["02-bai-b.mp3", "01-bai-a.m4a"]
//
// Tự phát: trình duyệt chặn âm thanh cho đến khi người xem chạm/bấm lần đầu → nhạc bắt đầu ngay lúc đó.
// Trong OBS (link có &nhac=1) nhạc tự phát luôn.
const CFG = {
  folder: "audio/",
  volume: 40, // 0–100
  exts: /\.(mp3|m4a|aac|ogg|oga|opus|wav|webm|flac)$/i,
  shuffle: true,
};
const KEY = "dichua-music"; // { name, t, off }

const pretty = (f) => f.replace(/\.[^.]+$/, "").replace(/^\d{2,}[\s._-]+/, "").replace(/[-_]+/g, " ").trim() || f;
const byName = (a, b) => a.localeCompare(b, "vi", { numeric: true });

export function initMusic(toast = () => {}) {
  const btn = document.getElementById("btn-music");
  const nextBtn = document.getElementById("btn-next");
  const params = new URLSearchParams(location.search);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} };

  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = CFG.volume / 100;

  let tracks = null, i = 0, on = false, errors = 0, armed = false;

  const setBtn = () => {
    btn.textContent = on ? "🔇 Tắt nhạc" : "🎵 Bật nhạc";
    btn.classList.toggle("on", on);
    btn.title = tracks?.length ? `Bài ${i + 1}/${tracks.length}: ${pretty(tracks[i])}` : "";
  };
  setBtn();

  async function load() {
    if (!tracks) tracks = await discover();
    return tracks;
  }

  function setTrack(idx, t = 0) {
    i = ((idx % tracks.length) + tracks.length) % tracks.length;
    audio.src = CFG.folder + tracks[i].split("/").map(encodeURIComponent).join("/");
    if (t > 0) audio.addEventListener("loadedmetadata", () => { if (t < audio.duration - 5) audio.currentTime = t; }, { once: true });
    saved.name = tracks[i]; saved.t = t; save();
    setBtn();
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: pretty(tracks[i]), artist: "Đi Chùa Online" }); } catch {}
    }
  }

  async function start() {
    await load();
    if (!tracks.length) { toast("Chưa có bài nhạc nào trong thư mục audio/"); return; }
    if (!audio.src) {
      if (CFG.shuffle) setTrack(randomOther(-1));
      else {
        const k = tracks.indexOf(saved.name); // nghe tiếp đúng bài lần trước
        setTrack(k >= 0 ? k : 0, k >= 0 ? saved.t || 0 : 0);
      }
    }
    on = true; saved.off = false; save(); setBtn();
    try {
      await audio.play();
      hint(false);
      toast(`🎵 ${pretty(tracks[i])}`);
    } catch {
      on = false; setBtn();
      hint(true);
      armGesture(); // trình duyệt chặn tự phát → phát ngay khi người xem chạm lần đầu
    }
  }

  function randomOther(cur) {
    if (tracks.length < 2) return 0;
    let k;
    do { k = Math.floor(Math.random() * tracks.length); } while (k === cur);
    return k;
  }

  // Dòng nhắc "Chạm để nghe nhạc" khi trình duyệt chặn tự phát
  let hintEl = null;
  function hint(show) {
    if (show && !hintEl) {
      hintEl = document.createElement("div");
      hintEl.className = "music-hint";
      hintEl.textContent = "🔊 Chạm vào màn hình để nghe nhạc";
      document.body.appendChild(hintEl);
    } else if (!show && hintEl) { hintEl.remove(); hintEl = null; }
  }

  function stop() {
    hint(false);
    on = false; audio.pause();
    saved.off = true; save(); setBtn();
  }

  function next() {
    if (!tracks?.length) return start();
    setTrack(CFG.shuffle ? randomOther(i) : i + 1);
    if (on) audio.play().then(() => toast(`🎵 ${pretty(tracks[i])}`)).catch(() => {});
    else start();
  }

  audio.addEventListener("ended", next);
  audio.addEventListener("playing", () => { errors = 0; });
  audio.addEventListener("error", () => {
    if (!tracks?.length) return;
    errors++;
    if (errors >= tracks.length) { toast("Không phát được bài nào — kiểm tra lại file trong audio/"); stop(); return; }
    toast(`Bỏ qua bài lỗi: ${pretty(tracks[i])}`);
    setTimeout(next, 800);
  });
  setInterval(() => { if (on && !audio.paused) { saved.t = Math.floor(audio.currentTime); save(); } }, 5000);

  function armGesture() {
    if (armed) return;
    armed = true;
    const go = (e) => {
      if (e.target.closest?.("#btn-music, #btn-next")) return; // nút nhạc tự xử lý
      document.removeEventListener("pointerdown", go, true);
      document.removeEventListener("keydown", go, true);
      armed = false;
      if (!saved.off) start();
    };
    document.addEventListener("pointerdown", go, true);
    document.addEventListener("keydown", go, true);
  }

  btn.onclick = () => (on ? stop() : start());
  if (nextBtn) nextBtn.onclick = () => next();

  // Mặc định bật nhạc (trừ khi người xem đã tự tắt lần trước)
  if (params.get("nhac") === "1" || !saved.off) start();
  else load();
}

// ---- Tìm danh sách bài ----
async function discover() {
  const keep = (list) => list.filter((f) => typeof f === "string" && CFG.exts.test(f));

  // 1) audio/playlist.json (nếu có) — tự chọn thứ tự
  try {
    const r = await fetch(CFG.folder + "playlist.json", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const list = keep(Array.isArray(j) ? j : j.tracks || []);
      if (list.length) return list;
    }
  } catch {}

  // 2) Chạy qua bridge trên máy (http://localhost:8787)
  try {
    const r = await fetch("/__audio-list", { cache: "no-store" });
    if (r.ok) {
      const list = keep(await r.json());
      if (list.length) return list.sort(byName);
    }
  } catch {}

  // 3) Trên GitHub Pages: đọc danh sách file trong thư mục audio/ của repo
  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
    const ck = `dichua-audio-list-${repo}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(ck));
      if (cached?.length) return cached;
    } catch {}
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CFG.folder.replace(/\/$/, "")}`);
      if (r.ok) {
        const list = keep((await r.json()).filter((x) => x.type === "file").map((x) => x.name)).sort(byName);
        try { sessionStorage.setItem(ck, JSON.stringify(list)); } catch {}
        return list;
      }
    } catch {}
  }
  return [];
}
