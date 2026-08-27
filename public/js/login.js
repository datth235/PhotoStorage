const form = document.getElementById("loginForm");
const errBox = document.getElementById("formError");
const submitBtn = document.getElementById("submitBtn");

// Nếu đã đăng nhập rồi thì về trang chủ luôn
getMe().then((user) => {
  if (user) location.href = "/";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang đăng nhập…";

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    location.href = "/";
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
    submitBtn.disabled = false;
    submitBtn.textContent = "Đăng nhập";
  }
});
