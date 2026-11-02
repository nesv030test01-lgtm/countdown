// Ảnh nền theo tỉnh/thành
//
// Chép ảnh vào thư mục background/ với tên không dấu: ho_chi_minh.jpg, ha_noi.jpg, da_nang.webp …
// Game tự nhận ảnh (không cần sửa code). Tên có dấu lấy từ bảng NAMES bên dưới;
// tên chưa có trong bảng sẽ tự viết hoa chữ cái đầu (vd. "my_tho" → "My Tho").
// Danh sách tự chọn (tuỳ chọn): background/list.json, ví dụ ["ha_noi.jpg", "ho_chi_minh.jpg"]
const FOLDER = "background/";
const EXTS = /\.(jpe?g|png|webp|avif)$/i;
const AUTO = "__auto__";
const ROTATE_MS = 15_000;

export const NAMES = {
  ha_noi: "Hà Nội", ho_chi_minh: "TP. Hồ Chí Minh", tp_ho_chi_minh: "TP. Hồ Chí Minh", sai_gon: "Sài Gòn",
  da_nang: "Đà Nẵng", hai_phong: "Hải Phòng", can_tho: "Cần Thơ", hue: "Huế", thua_thien_hue: "Thừa Thiên Huế",
  quang_ninh: "Quảng Ninh", ha_long: "Hạ Long", khanh_hoa: "Khánh Hòa", nha_trang: "Nha Trang",
  lam_dong: "Lâm Đồng", da_lat: "Đà Lạt", vung_tau: "Vũng Tàu", ba_ria_vung_tau: "Bà Rịa - Vũng Tàu",
  lao_cai: "Lào Cai", sa_pa: "Sa Pa", ha_giang: "Hà Giang", cao_bang: "Cao Bằng", lang_son: "Lạng Sơn",
  lai_chau: "Lai Châu", dien_bien: "Điện Biên", son_la: "Sơn La", yen_bai: "Yên Bái", tuyen_quang: "Tuyên Quang",
  thai_nguyen: "Thái Nguyên", bac_kan: "Bắc Kạn", phu_tho: "Phú Thọ", vinh_phuc: "Vĩnh Phúc", hoa_binh: "Hòa Bình",
  bac_ninh: "Bắc Ninh", bac_giang: "Bắc Giang", hung_yen: "Hưng Yên", hai_duong: "Hải Dương", thai_binh: "Thái Bình",
  nam_dinh: "Nam Định", ha_nam: "Hà Nam", ninh_binh: "Ninh Bình", thanh_hoa: "Thanh Hóa", nghe_an: "Nghệ An",
  ha_tinh: "Hà Tĩnh", quang_binh: "Quảng Bình", quang_tri: "Quảng Trị", quang_nam: "Quảng Nam", hoi_an: "Hội An",
  quang_ngai: "Quảng Ngãi", binh_dinh: "Bình Định", quy_nhon: "Quy Nhơn", phu_yen: "Phú Yên", ninh_thuan: "Ninh Thuận",
  binh_thuan: "Bình Thuận", phan_thiet: "Phan Thiết", kon_tum: "Kon Tum", gia_lai: "Gia Lai", dak_lak: "Đắk Lắk",
  buon_ma_thuot: "Buôn Ma Thuột", dak_nong: "Đắk Nông", binh_phuoc: "Bình Phước", binh_duong: "Bình Dương",
  dong_nai: "Đồng Nai", tay_ninh: "Tây Ninh", long_an: "Long An", tien_giang: "Tiền Giang", ben_tre: "Bến Tre",
  tra_vinh: "Trà Vinh", vinh_long: "Vĩnh Long", dong_thap: "Đồng Tháp", an_giang: "An Giang", kien_giang: "Kiên Giang",
  phu_quoc: "Phú Quốc", hau_giang: "Hậu Giang", soc_trang: "Sóc Trăng", bac_lieu: "Bạc Liêu", ca_mau: "Cà Mau",
};

export const keyOf = (file) => file.replace(/\.[^.]+$/, "").toLowerCase();
export function label(file) {
  const k = keyOf(file);
  return NAMES[k] || k.split(/[_\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
const url = (file) => FOLDER + file.split("/").map(encodeURIComponent).join("/");

async function discover() {
  const keep = (l) => l.filter((f) => typeof f === "string" && EXTS.test(f));
  try {
    const r = await fetch(FOLDER + "list.json", { cache: "no-store" });
    if (r.ok) { const l = keep(await r.json()); if (l.length) return l; }
  } catch {}
  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.split(".")[0];
    const repo = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
    const ck = `cd-bg-list-${repo}`;
    try { const c = JSON.parse(sessionStorage.getItem(ck)); if (c?.length) return c; } catch {}
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/background`);
      if (r.ok) {
        const l = keep((await r.json()).filter((x) => x.type === "file").map((x) => x.name))
          .sort((a, b) => label(a).localeCompare(label(b), "vi"));
        try { sessionStorage.setItem(ck, JSON.stringify(l)); } catch {}
        return l;
      }
    } catch {}
  }
  return [];
}

/**
 * Khởi động ảnh nền.
 * opts.h, opts.openModal, opts.closeModal: tiện ích giao diện
 * opts.onPick(key|null): gọi khi người chơi chọn tỉnh (null = tự đổi)
 * opts.initial: tỉnh đã lưu trong hồ sơ (nếu có)
 */
export async function initBackground(opts) {
  const stage = document.getElementById("stage");
  const chip = document.getElementById("chip-place");
  const layers = [...document.querySelectorAll(".bg-photo img")];
  let front = 0, timer = null, list = await discover();
  if (!list.length) { chip.classList.add("hidden"); return { setChoice() {} }; }

  let choice = null;
  try { choice = localStorage.getItem("cd-province"); } catch {}
  if (!choice && opts.initial) choice = opts.initial;
  stage.classList.add("has-photo");
  chip.classList.remove("hidden");

  function show(file) {
    const next = layers[1 - front];
    next.onload = () => {
      next.classList.add("on");
      layers[front].classList.remove("on");
      front = 1 - front;
    };
    next.onerror = () => { list = list.filter((f) => f !== file); if (list.length) apply(); };
    next.src = url(file);
    next.alt = label(file);
    chip.textContent = `📍 ${label(file)} ▾`;
  }
  function apply() {
    clearInterval(timer);
    const fixed = choice && choice !== AUTO && list.find((f) => keyOf(f) === choice);
    if (fixed) return show(fixed);
    let i = Math.floor(Math.random() * list.length);
    show(list[i]);
    if (list.length > 1) timer = setInterval(() => { i = (i + 1) % list.length; show(list[i]); }, ROTATE_MS);
  }
  function pick(key) {
    choice = key;
    try { localStorage.setItem("cd-province", key); } catch {}
    apply();
    opts.onPick?.(key === AUTO ? null : key);
    opts.closeModal();
  }

  chip.onclick = () => {
    const { h } = opts;
    opts.openModal((card) => {
      const grid = h("div", { class: "place-grid" },
        h("button", { class: "place auto" + (!choice || choice === AUTO ? " on" : ""), onclick: () => pick(AUTO) },
          h("span", { class: "place-ico" }, "🔄"), h("b", {}, "Tự đổi"), h("small", {}, "Lần lượt các tỉnh")),
        ...list.map((f) => h("button", { class: "place" + (keyOf(f) === choice ? " on" : ""), onclick: () => pick(keyOf(f)) },
          h("img", { src: url(f), alt: "", loading: "lazy" }), h("b", {}, label(f)))),
      );
      card.append(h("h2", {}, "📍 Bạn đón giao thừa ở đâu?"), h("p", {}, "Chọn tỉnh/thành của bạn — ảnh nền sẽ đổi theo."), grid);
    });
  };

  apply();
  return {
    setChoice(key) {
      let saved = null;
      try { saved = localStorage.getItem("cd-province"); } catch {}
      if (key && !saved) { choice = key; apply(); }
    },
  };
}
