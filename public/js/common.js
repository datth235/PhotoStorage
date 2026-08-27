/* Hàm dùng chung cho mọi trang */

/** Gọi API JSON, tự ném lỗi kèm message từ server */
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* body rỗng */
  }
  if (!res.ok) throw new Error((data && data.error) || `Lỗi ${res.status}`);
  return data;
}

/** Lấy trạng thái đăng nhập hiện tại */
async function getMe() {
  try {
    const { user } = await api("/api/me");
    return user;
  } catch {
    return null;
  }
}

/** Vẽ hộp người dùng ở góc phải header (truyền sẵn user để khỏi gọi lại /api/me) */
async function renderUserBox(el, user) {
  if (user === undefined) user = await getMe();
  if (user) {
    el.innerHTML = `
      <span class="greet">Xin chào, <strong>${escapeHtml(user)}</strong></span>
      <button class="btn btn-sm btn-ghost" id="logoutBtn" type="button">Đăng xuất</button>`;
    el.querySelector("#logoutBtn").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      location.reload();
    });
  } else {
    el.innerHTML = `<a class="btn btn-sm btn-primary" href="/login">Đăng nhập</a>`;
  }
  return user;
}

/* ---- Khoá / mở cuộn nền (dùng cho lightbox, hoạt động cả trên iOS) ---- */
let _lockedScrollY = 0;
function lockScroll() {
  _lockedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${_lockedScrollY}px`;
  document.body.classList.add("modal-open");
}
function unlockScroll() {
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, _lockedScrollY);
}

/** Thoát ký tự HTML */
function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Định dạng dung lượng file */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** "3 phút trước", "2 ngày trước"… */
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "vừa xong";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(ts).toLocaleDateString("vi-VN");
}

/** Thông báo nổi */
function toast(message, type = "") {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return alert(message);
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

/** Sao chép văn bản vào clipboard */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Đã sao chép liên kết");
  } catch {
    const inp = document.createElement("input");
    inp.value = text;
    document.body.appendChild(inp);
    inp.select();
    document.execCommand("copy");
    inp.remove();
    toast("Đã sao chép liên kết");
  }
}

/** URL tuyệt đối tới ảnh gốc */
function absUrl(path) {
  return location.origin + path;
}
