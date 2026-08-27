# Thư viện ảnh

Trang web lưu trữ và chia sẻ ảnh kiểu Imgur — **kho ảnh riêng, phải đăng nhập mới vào**.

- Mở web là ra **màn hình đăng nhập**; đăng nhập xong mới thấy thư viện ảnh
- Đăng nhập để xem / tải lên / xoá ảnh
- File ảnh gốc trong `uploads/` vẫn mở qua link trực tiếp (để chia sẻ) — URL ngẫu nhiên, khó đoán
- Ảnh lưu trên ổ đĩa (`uploads/`), thông tin lưu ở `data/images.json` — không cần cài database

## Chạy

```bash
npm install
npm start
```

Mở http://localhost:5000 → màn hình đăng nhập.

Chạy lại tự động khi sửa code:

```bash
npm run dev
```

`npm install` sẽ kéo thêm `sharp` (tạo ảnh thu nhỏ) và `compression` (nén phản hồi).
Nếu máy không build được `sharp`, web **vẫn chạy** — chỉ là lưới ảnh tải ảnh gốc thay vì bản thu nhỏ
(dòng khởi động sẽ ghi `Thumbnail: TẮT`).

## Mở trên điện thoại (cùng Wi-Fi)

Web đã tối ưu cho điện thoại (giao diện co giãn, chạm/vuốt, ảnh thu nhỏ tiết kiệm 3G/4G).
Để mở từ điện thoại **cùng mạng Wi-Fi** với máy tính đang chạy server:

1. Trên máy tính, xem địa chỉ IP:

   ```powershell
   ipconfig
   ```

   Tìm dòng **IPv4 Address**, ví dụ `192.168.1.20`.

2. Cho phép cổng 5000 qua Windows Firewall (chạy PowerShell **quyền admin**, một lần duy nhất):

   ```powershell
   netsh advfirewall firewall add rule name="Thu vien anh 5000" dir=in action=allow protocol=TCP localport=5000
   ```

3. Trên điện thoại (cùng Wi-Fi) mở: `http://192.168.1.20:5000`

> Cài vào màn hình chính / xem offline như một app (PWA) sẽ làm sau — cần chạy web qua **HTTPS**.

## Đăng nhập

| Tài khoản      | Mật khẩu    |
| -------------- | ----------- |
| `admin`        | `admin`     |
| `linhxinhgai`  | `yeubelinh` |

Mọi tài khoản đều có quyền tải lên & xoá ảnh.

**Thêm / bớt tài khoản:** sửa object `USERS` ở đầu file `server.js`:

```js
const USERS = {
  admin: 'admin',
  linhxinhgai: 'yeubelinh',
  // themtaikhoan: 'matkhau',
};
```

Hoặc ghi đè khi chạy, không cần sửa code:

```powershell
# PowerShell
$env:USERS='{"sep":"matkhaumanh","linh":"123456"}'; $env:PORT="8080"; npm start
```

## Tính năng

- Tải lên nhiều ảnh: chạm chọn (điện thoại) hoặc kéo–thả (máy tính), xem trước, thanh tiến trình
- **Ảnh thu nhỏ tự động** (`sharp`): lưới tải bản ~640px webp (~20–40 KB) thay vì ảnh gốc vài MB
- Lưới masonry **cuộn vô hạn** (tải 30 ảnh mỗi lần), lazy-load, giữ đúng ô ảnh (không nhảy layout)
- Lightbox hợp điện thoại: **vuốt** trái/phải đổi ảnh, **vuốt xuống** đóng, **chạm hai lần** phóng to;
  trên máy tính dùng phím ←/→/Esc
- Copy link ảnh gốc, mở trang ảnh riêng `/i/:id`
- Xoá ảnh (cần đăng nhập) — xoá cả ảnh gốc, thumbnail lẫn bản ghi
- Định dạng nhận: JPG, PNG, GIF, WebP, AVIF, BMP, SVG, HEIC/HEIF · tối đa 25 MB/ảnh

## Cấu trúc

```
server.js            máy chủ Express + API + tạo thumbnail (sharp)
public/
  index.html         thư viện + khu tải lên
  login.html         trang đăng nhập
  image.html         trang xem 1 ảnh (/i/:id)
  css/style.css
  img/               ảnh trang trí trang đăng nhập (mèo động, nền trong suốt .webp)
  js/
    common.js        hàm dùng chung (kể cả khoá cuộn lightbox)
    app.js           logic thư viện + cuộn vô hạn + upload + lightbox/cử chỉ
    login.js         logic đăng nhập
    image.js         logic trang xem 1 ảnh
uploads/             ảnh gốc (tự tạo)
  thumb/             bản thu nhỏ ~640px webp (tự tạo)
  med/               bản vừa ~1600px webp cho lightbox (tự tạo)
data/images.json     metadata (tự tạo)
raw/                 video gốc của ảnh trang trí — không cần để chạy web
```

Ảnh trang trí ở `public/img/` được tách nền từ video trong `raw/` bằng `ffmpeg`
(mèo nền xanh → chromakey) và `rembg` (mèo khóc → cắt nền + bo tròn). Muốn đổi ảnh
khác thì thay video trong `raw/` rồi làm lại bằng 2 công cụ đó.

## API

| Method + đường dẫn       | Quyền     | Mô tả                    |
| ------------------------ | --------- | ------------------------ |
| `POST /api/login`        | -         | `{username, password}`   |
| `POST /api/logout`       | -         | Đăng xuất                |
| `GET /api/me`            | -         | Ai đang đăng nhập        |
| `GET /api/images`        | đăng nhập | Danh sách ảnh, phân trang: `?offset=0&limit=30` → `{items,total,nextOffset}` |
| `GET /api/images/:id`    | đăng nhập | Chi tiết 1 ảnh           |
| `POST /api/upload`       | đăng nhập | Tải lên (field `images`) |
| `DELETE /api/images/:id` | đăng nhập | Xoá ảnh                  |

Trang: `/` và `/i/:id` trả về **màn hình đăng nhập** nếu chưa đăng nhập, ngược lại trả
về thư viện / trang ảnh. `/login` tự chuyển về `/` nếu đã đăng nhập.

## Lưu ý bảo mật

Đây là bản demo học tập: mật khẩu để thẳng trong code, session secret sinh ngẫu nhiên mỗi lần khởi động. Nếu deploy thật, hãy đặt tài khoản qua biến môi trường `USERS`, đặt `SESSION_SECRET` cố định và bật HTTPS.
