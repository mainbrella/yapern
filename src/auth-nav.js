import { readStoredSession } from "./auth.js";

if (readStoredSession()) {
  document.querySelectorAll("[data-login-link]").forEach(link => { link.textContent = "Account"; });
}
