/* ================= Trang chính: thư viện + tải lên ================= */

let isAuthed = false;
let images = []; // ảnh đã tải về (cộng dồn theo trang)
let total = 0;
let nextOffset = 0; // offset trang kế; null = đã hết
let loading = false;

let selectedFiles = [];

const el = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const zoom = { scale: 1, x: 0, y: 0 }; // trạng thái phóng to/kéo của lightbox

init();

async function init() {
  const me = await getMe();
  if (!me) {
    location.replace("/login");
    return;
  }
  isAuthed = true;
  await renderUserBox(el("userBox"), me);

  el("uploader").hidden = false;
  setupUploader();
  updateOnlineState();
  addEventListener("online", updateOnlineState);
  addEventListener("offline", updateOnlineState);
  setupModal();
  setupInfiniteScroll();
  await loadFirstPage();
}

/* ---------------- Thư viện ---------------- */
async function fetchPage(offset) {
  try {
    return await api(`/api/images?offset=${offset}&limit=30`);
  } catch (e) {
    if (offset === 0) {
      el("galleryHost").innerHTML =
        `<div class="state"><div class="icon">⚠️</div><p>${escapeHtml(e.message)}</p></div>`;
    } else {
      toast(e.message, "error");
    }
    return null;
  }
}

async function loadFirstPage() {
  images = [];
  total = 0;
  nextOffset = 0;
  loading = true;
  el("loadMore").textContent = "";
  el("galleryHost").innerHTML =
    '<div class="state"><div class="icon">⏳</div><p>Đang tải…</p></div>';

  const page = await fetchPage(0);
  loading = false;
  if (!page) return;

  total = page.total;
  nextOffset = page.nextOffset;
  images = page.items.slice();
  el("count").textContent = total ? `${total} ảnh` : "";

  if (!images.length) {
    el("galleryHost").innerHTML = `
      <div class="state">
        <div class="icon">📭</div>
        <h3>Chưa có ảnh nào</h3>
        <p>Dùng khung “Chạm để chọn ảnh” phía trên để tải lên.</p>
      </div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "gallery";
  el("galleryHost").innerHTML = "";
  el("galleryHost").appendChild(grid);
  addCardsToGrid(page.items);
  fillViewport();
}

async function loadMore() {
  if (loading || nextOffset === null) return;
  loading = true;
  el("loadMore").textContent = "Đang tải thêm…";

  const page = await fetchPage(nextOffset);
  loading = false;
  el("loadMore").textContent = "";
  if (!page) return;

  total = page.total;
  nextOffset = page.nextOffset;
  images.push(...page.items);
  addCardsToGrid(page.items);
  el("count").textContent = total ? `${total} ảnh` : "";
  fillViewport();
}

/* Nếu sentinel vẫn nằm trong tầm nhìn (màn hình cao / trang ngắn) thì tải tiếp */
function fillViewport() {
  if (nextOffset === null || loading) return;
  const r = el("scrollSentinel").getBoundingClientRect();
  if (r.top < window.innerHeight + 600) loadMore();
}

function addCardsToGrid(items) {
  const grid = document.querySelector(".gallery");
  if (!grid) return;
  const startIndex = images.length - items.length;
  const frag = document.createDocumentFragment();

  items.forEach((img, i) => {
    const index = startIndex + i;
    const fig = document.createElement("figure");
    fig.className = "card";

    const im = document.createElement("img");
    im.src = img.thumbUrl || img.url;
    im.alt = img.title || "";
    im.loading = "lazy";
    im.decoding = "async";
    if (img.width && img.height) {
      im.width = img.width;
      im.height = img.height;
    }

    const cap = document.createElement("figcaption");
    cap.className = "meta";
    cap.innerHTML =
      `<div class="title">${escapeHtml(img.title)}</div>` +
      `<div class="sub">${formatSize(img.size)} · ${timeAgo(img.uploadedAt)}</div>`;

    fig.append(im, cap);
    fig.addEventListener("click", () => openModal(index));
    frag.appendChild(fig);
  });

  grid.appendChild(frag);
}

function setupInfiniteScroll() {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { rootMargin: "600px 0px" }
  );
  io.observe(el("scrollSentinel"));
}

/* ---------------- Tải lên ---------------- */
function setupUploader() {
  const dz = el("dropzone");
  const fileInput = el("fileInput");

  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  el("uploadBtn").addEventListener("click", doUpload);
  el("clearBtn").addEventListener("click", () => {
    selectedFiles = [];
    renderPreviews();
  });
}

function addFiles(fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith("image/")) {
      toast(`Bỏ qua “${f.name}” (không phải ảnh)`, "error");
      continue;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast(`Bỏ qua “${f.name}” (lớn hơn 25 MB)`, "error");
      continue;
    }
    selectedFiles.push(f);
  }
  renderPreviews();
}

function renderPreviews() {
  const strip = el("previewStrip");
  strip.innerHTML = "";
  selectedFiles.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "preview-thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.setAttribute("aria-label", "Bỏ ảnh này");
    btn.addEventListener("click", () => {
      selectedFiles.splice(i, 1);
      renderPreviews();
    });
    div.append(img, btn);
    strip.appendChild(div);
  });
  refreshUploadButton();
}

function refreshUploadButton() {
  const has = selectedFiles.length > 0;
  el("uploadBtn").disabled = !has || !navigator.onLine;
  el("clearBtn").disabled = !has;
  el("uploadBtn").textContent = has
    ? `Tải lên ${selectedFiles.length} ảnh`
    : "Tải lên";
}

function updateOnlineState() {
  const note = el("uploadNote");
  if (!navigator.onLine) {
    note.hidden = false;
    note.classList.add("warn");
    note.textContent = "⚠ Đang ngoại tuyến — cần mạng để tải ảnh lên.";
  } else if (note.classList.contains("warn")) {
    note.hidden = true;
    note.classList.remove("warn");
    note.textContent = "";
  }
  refreshUploadButton();
}

function doUpload() {
  if (!selectedFiles.length) return;
  if (!navigator.onLine) {
    toast("Đang ngoại tuyến — không thể tải lên.", "error");
    return;
  }

  const fd = new FormData();
  selectedFiles.forEach((f) => fd.append("images", f));
  const title = el("titleInput").value.trim();
  if (title) fd.append("title", title);

  const bar = el("progress");
  const fill = bar.querySelector("span");
  bar.classList.remove("hidden");
  fill.style.width = "0%";
  el("uploadBtn").disabled = true;
  el("clearBtn").disabled = true;

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");

  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) fill.style.width = (e.loaded / e.total) * 100 + "%";
  });

  xhr.addEventListener("load", async () => {
    bar.classList.add("hidden");
    let resp = {};
    try {
      resp = JSON.parse(xhr.responseText);
    } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      toast(`Đã tải lên ${resp.images?.length || selectedFiles.length} ảnh`);
      selectedFiles = [];
      el("titleInput").value = "";
      renderPreviews();
      await loadFirstPage();
    } else {
      uploadFailed(resp.error || `Tải lên thất bại (${xhr.status})`);
    }
  });

  xhr.addEventListener("error", () => uploadFailed("Lỗi mạng khi tải lên"));
  xhr.addEventListener("abort", () => uploadFailed("Đã huỷ tải lên"));

  xhr.send(fd);
}

function uploadFailed(msg) {
  el("progress").classList.add("hidden");
  toast(msg, "error");
  el("uploadBtn").disabled = false;
  el("clearBtn").disabled = false;
  el("uploadBtn").textContent = "Thử lại";
}

/* ---------------- Lightbox ---------------- */
let modalIndex = -1;

function prettyType(mime) {
  return (mime || "").split("/")[1]?.split("+")[0].toUpperCase() || "ẢNH";
}

function setupModal() {
  el("closeModal").addEventListener("click", closeModal);
  el("prevBtn").addEventListener("click", () => step(-1));
  el("nextBtn").addEventListener("click", () => step(1));
  el("modal").addEventListener("click", (e) => {
    if (e.target === el("modal")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (el("modal").classList.contains("hidden")) return;
    if (e.key === "Escape") closeModal();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  el("copyBtn").addEventListener("click", () => copyText(el("modalLink").value));
  el("deleteBtn").addEventListener("click", doDelete);
  setupGestures();
}

function openModal(i) {
  showModalAt(i);
  el("modal").classList.remove("hidden");
  el("modal").setAttribute("aria-hidden", "false");
  lockScroll();
}

function closeModal() {
  el("modal").classList.add("hidden");
  el("modal").setAttribute("aria-hidden", "true");
  el("modal").style.background = "";
  resetZoom(false);
  modalIndex = -1;
  unlockScroll();
}

function showModalAt(i) {
  if (i < 0 || i >= images.length) return;
  modalIndex = i;
  const img = images[i];

  resetZoom(false);
  el("modal").style.background = "";
  const m = el("modalImg");
  m.src = img.mediumUrl || img.url;
  m.alt = img.title || "";
  el("modalTitle").textContent = img.title || "";
  el("modalSub").textContent =
    `${formatSize(img.size)} · ${prettyType(img.mimetype)} · ${timeAgo(img.uploadedAt)}`;
  el("modalLink").value = absUrl(img.url);
  el("openRaw").href = img.url;
  el("openPage").href = `/i/${img.id}`;
  el("deleteBtn").hidden = !isAuthed;

  const many = images.length > 1;
  el("prevBtn").hidden = !many;
  el("nextBtn").hidden = !many;

  if (i >= images.length - 5) loadMore(); // nạp thêm khi sắp hết
}

function step(dir) {
  if (modalIndex < 0 || images.length < 2) return;
  let ni = modalIndex + dir;
  if (ni < 0) ni = images.length - 1;
  else if (ni >= images.length) ni = 0;
  showModalAt(ni);
}

async function doDelete() {
  if (modalIndex < 0) return;
  const img = images[modalIndex];
  if (!confirm("Xoá vĩnh viễn ảnh này?")) return;
  try {
    await api(`/api/images/${img.id}`, { method: "DELETE" });
    toast("Đã xoá ảnh");
    closeModal();
    await loadFirstPage();
  } catch (e) {
    toast(e.message, "error");
  }
}

/* ---- Cử chỉ chạm: vuốt đổi ảnh / vuốt xuống đóng / chạm hai lần phóng to ----
   (Pinch 2 ngón có thể bổ sung sau — hiện dùng chạm-hai-lần để zoom.)          */
function resetZoom(animate) {
  const m = el("modalImg");
  zoom.scale = 1;
  zoom.x = 0;
  zoom.y = 0;
  m.classList.toggle("animating", !!animate);
  m.classList.remove("zoomed");
  m.style.transform = "";
}

function setupGestures() {
  const wrap = el("modalImgWrap");
  const m = el("modalImg");
  const pts = new Map();
  let g = null; // gesture hiện tại
  let lastTapT = 0;

  const draw = (dx = 0, dy = 0, extraScale = 1, animate = false) => {
    m.classList.toggle("animating", !!animate);
    m.style.transform =
      `translate(${zoom.x + dx}px, ${zoom.y + dy}px) scale(${zoom.scale * extraScale})`;
  };

  const clampPan = () => {
    const r = m.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = wrap.clientHeight || window.innerHeight;
    const mx = Math.max(0, (r.width - vw) / 2 + 40);
    const my = Math.max(0, (r.height - vh) / 2 + 40);
    zoom.x = clamp(zoom.x, -mx, mx);
    zoom.y = clamp(zoom.y, -my, my);
  };

  wrap.addEventListener("pointerdown", (e) => {
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      g = {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        axis: null,
        mode: zoom.scale > 1 ? "pan" : "swipe",
      };
      m.classList.remove("animating");
    } else {
      g = null; // đa chạm (2 ngón) — huỷ cử chỉ 1 ngón đang chờ
    }
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!g || !pts.has(e.pointerId) || pts.size !== 1) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (g.mode === "pan") {
      zoom.x += e.clientX - pts.get(e.pointerId).x;
      zoom.y += e.clientY - pts.get(e.pointerId).y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clampPan();
      draw();
      return;
    }

    // swipe: chốt trục sau khi vượt 10px
    if (!g.axis && Math.hypot(dx, dy) > 10) g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (g.axis === "x") {
      draw(dx, 0);
    } else if (g.axis === "y" && dy > 0) {
      const k = clamp(1 - dy / 500, 0, 1);
      draw(0, dy, 0.9 + 0.1 * k);
      el("modal").style.background = `rgba(0,0,0,${0.86 * k})`;
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;

    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = Date.now() - g.t;
    const tap = Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 250;

    if (tap) {
      const now = Date.now();
      if (now - lastTapT < 300) {
        lastTapT = 0;
        toggleZoom();
      } else {
        lastTapT = now;
      }
      if (g.mode === "swipe") {
        draw(0, 0, 1, true);
        el("modal").style.background = "";
      }
      g = null;
      return;
    }

    if (g.mode === "pan") {
      g = null;
      return;
    }

    if (g.axis === "x" && Math.abs(dx) > 55) {
      step(dx < 0 ? 1 : -1);
    } else if (g.axis === "y" && dy > 90) {
      closeModal();
    } else {
      draw(0, 0, 1, true);
      el("modal").style.background = "";
    }
    g = null;
  };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);

  function toggleZoom() {
    const m2 = el("modalImg");
    if (zoom.scale > 1) {
      resetZoom(true);
      return;
    }
    zoom.scale = 2.4;
    zoom.x = 0;
    zoom.y = 0;
    m2.classList.add("zoomed", "animating");
    m2.style.transform = "scale(2.4)";
  }
}
