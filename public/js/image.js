/* ================= Trang xem 1 ảnh: /i/:id ================= */

const host = document.getElementById("host");
const id = location.pathname.split("/").pop();

let isAuthed = false;

init();

async function init() {
  const me = await getMe();
  if (!me) {
    location.replace("/login");
    return;
  }
  isAuthed = true;
  await renderUserBox(document.getElementById("userBox"), me);

  let img;
  try {
    img = await api(`/api/images/${id}`);
  } catch (e) {
    host.innerHTML = `<div class="state"><div class="icon">🔍</div><h3>Không tìm thấy ảnh</h3><p>${escapeHtml(
      e.message
    )}</p><p style="margin-top:14px"><a class="btn" href="/">← Về thư viện</a></p></div>`;
    return;
  }

  document.title = `${img.title} — Thư viện ảnh`;
  const link = absUrl(img.url);
  const viewSrc = img.mediumUrl || img.url;

  host.innerHTML = `
    <div class="frame"><img src="${viewSrc}" alt="${escapeHtml(img.title)}" ${
      img.width && img.height ? `width="${img.width}" height="${img.height}"` : ""
    } /></div>
    <div class="panel">
      <h3 style="word-break:break-word;margin-bottom:4px">${escapeHtml(img.title)}</h3>
      <div class="sub" style="color:var(--muted);font-size:13px;margin-bottom:14px">
        ${formatSize(img.size)} · ${img.mimetype} · ${timeAgo(img.uploadedAt)}
      </div>
      <div class="link-row">
        <input type="text" id="rawLink" readonly value="${link}" />
        <button class="btn btn-sm" id="copyBtn">Sao chép</button>
      </div>
      <div class="modal-actions">
        <a class="btn btn-sm" href="${img.url}" target="_blank" rel="noopener">Mở ảnh gốc</a>
        <a class="btn btn-sm btn-ghost" href="/">← Thư viện</a>
        <span class="header-spacer"></span>
        ${isAuthed ? '<button class="btn btn-sm btn-danger" id="deleteBtn">Xoá ảnh</button>' : ""}
      </div>
    </div>`;

  document
    .getElementById("copyBtn")
    .addEventListener("click", () => copyText(link));

  const del = document.getElementById("deleteBtn");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Xoá vĩnh viễn ảnh này?")) return;
      try {
        await api(`/api/images/${id}`, { method: "DELETE" });
        location.href = "/";
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }
}
