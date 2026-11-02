# 🎆 Countdown Online — đếm ngược đến 2027

Game web nhiều người chơi: cùng đếm ngược đến giao thừa 2027, bắn pháo hoa tích điểm, giữ chuỗi điểm danh, tranh top Hôm nay / Tuần / Mùa. Đúng 00:00 ngày 01/01/2027, top 10 lên **Bảng vàng 2027**.

**Hosting:** GitHub Pages · **Đăng nhập:** Firebase (Google + Khách) · **Dữ liệu:** Firestore — dùng **chung Firebase project với Đi Chùa Online**.

## Luật tính điểm

| | |
|---|---|
| Mỗi phát pháo | 1 điểm × hệ số thời gian × hệ số chuỗi × giờ vàng |
| Hệ số thời gian | Tháng 11 ×1 · Tháng 12 ×2 · 7 ngày cuối ×3 · Giờ cuối ×5 · 60 giây cuối ×10 |
| Chuỗi điểm danh | Mỗi ngày bấm **Điểm danh** (+10 × số ngày liên tiếp, tối đa 300). Hệ số chuỗi = 1 + ngày/30 (30 ngày → ×2). Quá 48 giờ không điểm danh → chuỗi về 1 |
| Giờ vàng | 20:00–20:15 mỗi tối (giờ VN): ×3 |
| Giao thừa | Sau 00:00 01/01/2027 không còn cộng điểm. Top 10 Mùa lên Bảng vàng. Người gửi lời chúc đầu tiên sau 00:00 là "Người mở màn 2027" |

**Giới hạn mỗi người:** 1 phát pháo / 15 giây và 1 lời chúc / 15 giây (nút hiện "CHỜ 12s"). Máy chủ (Firestore Rules) cũng chặn nếu 2 lần cách nhau dưới 15 giây, nên dùng bot/tool cũng không vượt được.

Chống gian lận khác: giờ lấy từ máy chủ; mỗi lần ghi tối đa điểm của đúng 1 phát theo hệ số thời gian; điểm danh chỉ 1 lần mỗi ~20 giờ.

## Cài đặt

1. **Firestore Rules:** mở `firestore.rules` → copy **toàn bộ** → Firebase Console → Firestore → Rules → dán đè → **Publish**.
   File này đã gộp luật của **cả Đi Chùa và Countdown** (2 app dùng chung 1 Firebase) — đừng dán file cũ của Đi Chùa đè lên.
2. `js/firebase-config.js` đã có sẵn config (giống Đi Chùa).
3. Tạo repo GitHub `countdown_online`, push, bật **Settings → Pages → main / (root)**.
   Domain `nesv030test01-lgtm.github.io` đã có trong Authorized domains nên đăng nhập dùng được ngay.
4. Mở `https://nesv030test01-lgtm.github.io/countdown_online/`

## Xem thử

- `?demo=1` — dữ liệu giả, không cần Firebase.
- `?demo=1&t=2026-12-31T20:05:00%2B07:00` — xem thử giờ vàng tuần cuối.
- `?demo=1&t=2026-12-31T23:59:50%2B07:00` — xem 10 giây cuối + Bảng vàng.
  (Khi có `t=…` điểm không được lưu.)

## 🏙️ Ảnh nền theo tỉnh

Chép ảnh vào thư mục `background/`, đặt tên không dấu nối bằng `_`: `ho_chi_minh.jpg`, `ha_noi.jpg`, `da_nang.webp`… rồi commit + push — game tự nhận.
- Ảnh thay cho bầu trời phía sau đồng hồ. Tên có dấu hiện tự động ("TP. Hồ Chí Minh"); bảng tên nằm trong `js/bg.js`.
- Người chơi bấm **📍** (dưới đồng hồ) để chọn nơi đón giao thừa, hoặc **Tự đổi** (mỗi 15 giây một tỉnh). Lựa chọn được lưu vào hồ sơ (trường `province`) — dùng được cho đấu theo tỉnh sau này.
- Nên dùng ảnh rộng ≥ 1080 px, dưới 500 KB. Chỉ dùng ảnh bạn được phép sử dụng.

## 🎵 Nhạc nền

Chép file nhạc (.mp3, .m4a, .ogg, .wav…) vào thư mục `audio/` rồi commit + push. Game tự phát **ngẫu nhiên**, hết bài tự sang bài khác — không cần sửa code.
- Trình duyệt chặn âm thanh cho đến lần chạm đầu tiên → trang hiện "🔊 Chạm vào màn hình để nghe nhạc".
- Nút **⏭** chuyển bài, **🔇 Tắt nhạc** để tắt. Thêm `?nhac=1` vào link để tự phát trong OBS.
- Đặt tên file không dấu, không khoảng trắng. Chỉ dùng nhạc bạn được phép sử dụng.

## Dữ liệu Firestore

```
cd_users/{uid}                     name, photoURL, total, streak, lastCheckinAt, lastAt, lastSeen
cd_days/{YYYY-MM-DD}/players/{uid} name, photoURL, pts, lastAt
cd_weeks/{YYYY-Www}/players/{uid}  name, photoURL, pts, lastAt
cd_wishes/{id}                     uid, name, text, createdAt
```

## Chi phí

Bảng xếp hạng và đám đông **cập nhật tức thì** (Firestore realtime): mỗi khi một người ghi điểm (tối đa 1 lần / 15 giây mỗi người), mỗi người đang xem nhận 1 lượt đọc cho bảng và 1 cho danh sách online.
Gói miễn phí (50.000 lượt đọc/ngày) đủ cho thử nghiệm và vài người chơi. Khi đông người (nhất là đêm giao thừa) nên nâng Firebase lên gói **Blaze** (trả theo dùng, khoảng 0,06 USD / 100.000 lượt đọc) — nếu không, hết hạn mức thì game ngừng ghi/đọc đến 0 giờ (giờ Mỹ) hôm sau.

**Khi sửa code:** tăng `?v=1` → `?v=2` ở 2 chỗ trong `index.html`.
