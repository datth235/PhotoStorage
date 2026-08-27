/* ================= Kỷ niệm: album ảnh có tên, con của Thư viện ảnh ================= */

const mEl = (id) => document.getElementById(id);

let memSelected = []; // file đang chọn trong hộp tạo kỷ niệm
let memCurrent = null; // kỷ niệm đang mở trong khung xem

if (mEl("memSection")) initMemories();

async function initMemories() {
  const me = await getMe();
  if (!me) return;

  mEl("memSection").hidden = false;
  const lh = mEl("loosePhotosHead");
  if (lh) lh.hidden = false;
  setupMemModal();
  setupMemView();
  await loadMemories();
}

/* ---------------- Danh sách kỷ niệm ---------------- */
async function loadMemories() {
  let data;
  try {
    data = await api("/api/memories");
  } catch (e) {
    mEl("memories").innerHTML = `<div class="state small"><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }

  const host = mEl("memories");
  host.innerHTML = "";

  // Ô "Tạo kỷ niệm" luôn đứng đầu
  const add = document.createElement("button");
  add.type = "button";
  add.className = "memory-card memory-add";
  add.innerHTML = `<span class="plus">＋</span><span>Tạo kỷ niệm</span>`;
  add.addEventListener("click", () => openMemModal());
  host.appendChild(add);

  mEl("memCount").textContent = data.items.length ? `${data.items.length} kỷ niệm` : "";

  for (const mem of data.items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "memory-card";
    const cover = mem.cover ? mem.cover.thumbUrl || mem.cover.url : "";
    card.innerHTML = `
      <div class="memory-cover">${
        cover ? `<img src="${cover}" alt="" loading="lazy" />` : `<div class="memory-empty">📷</div>`
      }<span class="memory-badge">${mem.count}</span></div>
      <div class="memory-name">${escapeHtml(mem.name)}</div>
      <div class="memory-sub">${timeAgo(mem.createdAt)}</div>`;
    card.addEventListener("click", () => openMemView(mem.id));
    host.appendChild(card);
  }
}

/* ---------------- Hộp tạo kỷ niệm ---------------- */
function setupMemModal() {
  const drop = mEl("memDrop");
  const input = mEl("memFiles");

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    addMemFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    addMemFiles(input.files);
    input.value = "";
  });

  mEl("memName").addEventListener("input", refreshMemSubmit);
  mEl("memSubmit").addEventListener("click", submitMemory);
  mEl("memCancel").addEventListener("click", closeMemModal);
  mEl("memModalClose").addEventListener("click", closeMemModal);
  mEl("memModal").addEventListener("click", (e) => {
    if (e.target === mEl("memModal")) closeMemModal();
  });
}

function openMemModal() {
  memSelected = [];
  mEl("memName").value = "";
  renderMemPreviews();
  mEl("memProgress").classList.add("hidden");
  mEl("memModal").classList.remove("hidden");
  mEl("memModal").setAttribute("aria-hidden", "false");
  lockScroll();
  setTimeout(() => mEl("memName").focus(), 50);
}

function closeMemModal() {
  mEl("memModal").classList.add("hidden");
  mEl("memModal").setAttribute("aria-hidden", "true");
  memSelected = [];
  unlockScroll();
}

function addMemFiles(fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith("image/")) {
      toast(`Bỏ qua “${f.name}” (không phải ảnh)`, "error");
      continue;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast(`Bỏ qua “${f.name}” (lớn hơn 25 MB)`, "error");
      continue;
    }
    memSelected.push(f);
  }
  renderMemPreviews();
}

function renderMemPreviews() {
  const strip = mEl("memPreview");
  strip.innerHTML = "";
  memSelected.forEach((f, i) => {
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
      memSelected.splice(i, 1);
      renderMemPreviews();
    });
    div.append(img, btn);
    strip.appendChild(div);
  });
  refreshMemSubmit();
}

function refreshMemSubmit() {
  const ok = mEl("memName").value.trim().length > 0 && memSelected.length > 0;
  mEl("memSubmit").disabled = !ok || !navigator.onLine;
  mEl("memSubmit").textContent = memSelected.length
    ? `Tạo kỷ niệm (${memSelected.length} ảnh)`
    : "Tạo kỷ niệm";
}

function submitMemory() {
  const name = mEl("memName").value.trim();
  if (!name || !memSelected.length) return;

  const fd = new FormData();
  fd.append("name", name);
  memSelected.forEach((f) => fd.append("images", f));

  uploadWithProgress("/api/memories", fd, mEl("memProgress"), mEl("memSubmit"), async (resp) => {
    toast(`Đã tạo kỷ niệm “${name}”`);
    closeMemModal();
    await loadMemories();
  });
}

/* ---------------- Khung xem 1 kỷ niệm ---------------- */
function setupMemView() {
  mEl("memViewClose").addEventListener("click", closeMemView);
  mEl("memView").addEventListener("click", (e) => {
    if (e.target === mEl("memView")) closeMemView();
  });
  mEl("memDelete").addEventListener("click", deleteMemory);
  mEl("memAddMore").addEventListener("click", () => {
    if (!memCurrent) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.multiple = true;
    picker.addEventListener("change", () => {
      if (!picker.files.length) return;
      const fd = new FormData();
      for (const f of picker.files) fd.append("images", f);
      uploadWithProgress(
        `/api/memories/${memCurrent}/images`,
        fd,
        null,
        mEl("memAddMore"),
        async () => {
          toast("Đã thêm ảnh vào kỷ niệm");
          await openMemView(memCurrent);
          await loadMemories();
        }
      );
    });
    picker.click();
  });
}

async function openMemView(id) {
  let mem;
  try {
    mem = await api(`/api/memories/${id}`);
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  memCurrent = id;
  mEl("memViewName").textContent = mem.name;
  mEl("memViewCount").textContent = `${mem.count} ảnh · ${timeAgo(mem.createdAt)}`;

  const grid = mEl("memViewGrid");
  grid.innerHTML = "";
  if (!mem.images.length) {
    grid.innerHTML = `<div class="state small"><p>Kỷ niệm này chưa có ảnh.</p></div>`;
  }
  mem.images.forEach((img) => {
    const fig = document.createElement("figure");
    fig.className = "card";
    const im = document.createElement("img");
    im.src = img.thumbUrl || img.url;
    im.alt = img.title || "";
    im.loading = "lazy";
    const cap = document.createElement("figcaption");
    cap.className = "meta";
    cap.innerHTML = `<div class="sub">${formatSize(img.size)} · ${timeAgo(img.uploadedAt)}</div>`;
    fig.append(im, cap);
    fig.addEventListener("click", () => (location.href = `/i/${img.id}`));
    grid.appendChild(fig);
  });

  mEl("memView").classList.remove("hidden");
  mEl("memView").setAttribute("aria-hidden", "false");
  lockScroll();
}

function closeMemView() {
  mEl("memView").classList.add("hidden");
  mEl("memView").setAttribute("aria-hidden", "true");
  memCurrent = null;
  unlockScroll();
}

async function deleteMemory() {
  if (!memCurrent) return;
  if (!confirm("Xoá kỷ niệm này? Toàn bộ ảnh trong kỷ niệm cũng bị xoá.")) return;
  try {
    await api(`/api/memories/${memCurrent}`, { method: "DELETE" });
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  toast("Đã xoá kỷ niệm");
  closeMemView();
  await loadMemories();
}

/* ---------------- Tiện ích tải lên kèm thanh tiến trình ---------------- */
function uploadWithProgress(url, formData, barEl, btnEl, onDone) {
  if (!navigator.onLine) {
    toast("Đang ngoại tuyến — không thể tải lên.", "error");
    return;
  }
  const oldLabel = btnEl ? btnEl.textContent : "";
  if (btnEl) btnEl.disabled = true;
  let fill = null;
  if (barEl) {
    barEl.classList.remove("hidden");
    fill = barEl.querySelector("span");
    fill.style.width = "0%";
  }

  const xhr = new XMLHttpRequest();
  xhr.open("POST", url);
  xhr.upload.addEventListener("progress", (e) => {
    if (fill && e.lengthComputable) fill.style.width = (e.loaded / e.total) * 100 + "%";
  });
  xhr.addEventListener("load", async () => {
    if (barEl) barEl.classList.add("hidden");
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = oldLabel;
    }
    let resp = {};
    try {
      resp = JSON.parse(xhr.responseText);
    } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      await onDone(resp);
    } else {
      toast(resp.error || `Tải lên thất bại (${xhr.status})`, "error");
    }
  });
  xhr.addEventListener("error", () => {
    if (barEl) barEl.classList.add("hidden");
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = oldLabel;
    }
    toast("Lỗi mạng khi tải lên", "error");
  });
  xhr.send(formData);
}
