/* ================= Hẹn hò: ghép đôi 2 tài khoản dùng chung thư viện ================= */

const cpEl = document.getElementById("couplePanel");

if (cpEl) initCouple();

async function initCouple() {
  const me = await getMe();
  if (!me) return;
  await refreshCouple();
}

async function refreshCouple() {
  let r;
  try {
    r = await api("/api/relationship");
  } catch {
    return;
  }
  renderCouple(r);
}

function renderCouple(r) {
  cpEl.hidden = false;

  if (r.partner) {
    cpEl.className = "couple together";
    // Chỉ linhxinhgai mới bấm được "Chia tay"; anhdatdeptrai thì nút bị làm mờ.
    const canBreakup = r.me !== "anhdatdeptrai";
    cpEl.innerHTML = `
      <div class="couple-head">
        <span class="couple-emoji">💞</span>
        <div>
          <div class="couple-title">Đang hẹn hò với <strong>${escapeHtml(r.partner)}</strong></div>
          <div class="couple-sub">Hai bạn đang dùng chung một thư viện ảnh · từ ${timeAgo(r.since)}</div>
        </div>
      </div>
      <button class="btn btn-sm btn-danger" id="cpBreakup" type="button" ${
        canBreakup ? "" : 'disabled title="Anh không được phép chia tay đâu 🥺"'
      }>Chia tay</button>`;
    if (canBreakup) {
      cpEl.querySelector("#cpBreakup").addEventListener("click", askBreakup);
    }
    return;
  }

  cpEl.className = "couple";
  const incoming = r.incoming
    .map(
      (u) => `
      <div class="couple-req">
        <span>💌 <strong>${escapeHtml(u)}</strong> muốn hẹn hò với bạn</span>
        <span class="couple-req-btns">
          <button class="btn btn-sm btn-primary" data-accept="${escapeHtml(u)}" type="button">Đồng ý</button>
          <button class="btn btn-sm btn-ghost" data-decline="${escapeHtml(u)}" type="button">Từ chối</button>
        </span>
      </div>`
    )
    .join("");

  const outgoing = r.outgoing
    .map(
      (u) => `
      <div class="couple-req">
        <span>⏳ Đã mời <strong>${escapeHtml(u)}</strong>, đang chờ đồng ý</span>
        <button class="btn btn-sm btn-ghost" data-cancel="${escapeHtml(u)}" type="button">Huỷ lời mời</button>
      </div>`
    )
    .join("");

  cpEl.innerHTML = `
    <div class="couple-head">
      <span class="couple-emoji">💗</span>
      <div>
        <div class="couple-title">Hẹn hò</div>
        <div class="couple-sub">Ghép đôi với một tài khoản khác để cùng quản lý chung một thư viện ảnh.</div>
      </div>
    </div>
    ${incoming}
    ${outgoing}
    <form class="couple-invite" id="cpForm">
      <input type="text" id="cpTarget" autocomplete="off" autocapitalize="none"
             spellcheck="false" placeholder="Nhập tên tài khoản người kia" />
      <button class="btn btn-sm btn-primary" id="cpSend" type="submit">Gửi lời mời</button>
    </form>`;

  cpEl.querySelector("#cpForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const to = cpEl.querySelector("#cpTarget").value.trim();
    if (!to) {
      toast("Hãy nhập tên tài khoản người kia.", "error");
      return;
    }
    cpAction("/api/relationship/request", { to });
  });

  cpEl.querySelectorAll("[data-accept]").forEach((b) =>
    b.addEventListener("click", () => cpAction("/api/relationship/accept", { from: b.dataset.accept }))
  );
  cpEl.querySelectorAll("[data-decline]").forEach((b) =>
    b.addEventListener("click", () => cpAction("/api/relationship/decline", { user: b.dataset.decline }))
  );
  cpEl.querySelectorAll("[data-cancel]").forEach((b) =>
    b.addEventListener("click", () => cpAction("/api/relationship/decline", { user: b.dataset.cancel }))
  );
}

/* ---- Hộp "chia tay": nút "Có" càng ấn càng bé, ấn 5 lần thì bó tay ---- */
function askBreakup() {
  if (document.querySelector(".cp-modal-overlay")) return;

  const ov = document.createElement("div");
  ov.className = "cp-modal-overlay";
  ov.innerHTML = `
    <div class="cp-modal">
      <p class="cp-modal-q">Em có chắc chắn chia tay không?</p>
      <div class="cp-modal-btns">
        <button class="btn btn-danger" id="cpYes" type="button">Có</button>
        <button class="btn btn-primary" id="cpNo" type="button">Không</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => ov.remove();
  const yes = ov.querySelector("#cpYes");

  ov.querySelector("#cpNo").addEventListener("click", close);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) close();
  });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", esc);
    }
  });

  let count = 0;
  yes.addEventListener("click", () => {
    count += 1;

    if (count >= 5) {
      ov.querySelector(".cp-modal").innerHTML = `
        <p class="cp-modal-q cp-modal-final">Không được chia tay em bé ơi 🥺💗</p>
        <div class="cp-modal-btns">
          <button class="btn btn-primary" id="cpOk" type="button">Dạ 🥰</button>
        </div>`;
      ov.querySelector("#cpOk").addEventListener("click", close);
      return;
    }

    yes.style.transition = "transform .18s ease";
    yes.style.transform = `scale(${(1 - count * 0.19).toFixed(2)})`;
  });
}

async function cpAction(url, body) {
  try {
    await api(url, { method: "POST", body: JSON.stringify(body || {}) });
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  await refreshCouple();
  // Thư viện thay đổi theo tình trạng hẹn hò -> tải lại
  if (typeof loadFirstPage === "function") loadFirstPage();
}
