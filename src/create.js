import { readStoredSession } from "./auth.js";
import { closeHeaderMenu } from "./auth-nav.js";
import { fetchBoards, createBoard, createMessage } from "./messages-api.js";
import { boardHref, messageHref } from "./board-routes.js";

const menu = document.querySelector("#create-menu");
const toggle = document.querySelector("#create-toggle");
const options = document.querySelector("#create-options");
const mobileNavigation = window.matchMedia("(max-width: 900px)");
const items = [...options.querySelectorAll("[role=menuitem]")];
const createActions = [...document.querySelectorAll("[data-create]")];
const messageDialog = document.querySelector("#create-message-dialog");
const boardDialog = document.querySelector("#create-board-dialog");
const messageForm = document.querySelector("#create-message-form");
const boardForm = document.querySelector("#create-board-form");
const boardSelect = document.querySelector("#create-board");
const boardsStatus = document.querySelector("#create-boards-status");
const boardsRetry = document.querySelector("#create-boards-retry");
const title = document.querySelector("#create-title");
const body = document.querySelector("#create-body");
const linkToggle = document.querySelector("#create-link-toggle");
const linkPanel = document.querySelector("#create-link-panel");
const linkUrl = document.querySelector("#create-link-url");
const linkRemove = document.querySelector("#create-link-remove");
const linkError = document.querySelector("#create-link-error");
const bodyRequirement = document.querySelector("#create-body-requirement");
const name = document.querySelector("#new-board-name");
const description = document.querySelector("#new-board-description");
let boards = [];
let boardRequest = 0;
let boardsLoading = false;
let boardsFailed = false;
let saving = false;
let previousOverflow = "";
let linkTouched = false;

function linkUrlError() {
  const value = linkUrl.value.trim();
  if (!/^https?:\/\//i.test(value)) return "Enter a full URL starting with http:// or https://.";
  try {
    const parsed = new URL(value);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) return "";
  } catch {}
  return "Enter a full URL starting with http:// or https://.";
}

function serializedMessageBody() {
  if (linkPanel.hidden) return body.value;
  const url = linkUrl.value.trim();
  const text = body.value.trim();
  return url ? (text ? `${url}\n\n${text}` : url) : text;
}

function syncLinkValidation() {
  const error = linkPanel.hidden ? "" : linkUrlError();
  linkUrl.setCustomValidity(error);
  linkUrl.setAttribute("aria-invalid", linkTouched && error ? "true" : "false");
  linkError.textContent = linkTouched ? error : "";
  return error;
}

function setLinkPanelOpen(open) {
  linkPanel.hidden = !open;
  linkToggle.setAttribute("aria-expanded", String(open));
  linkUrl.required = open;
  body.required = !open;
  bodyRequirement.textContent = open ? "(optional)" : "(required)";
  if (!open) {
    linkUrl.value = "";
    linkTouched = false;
    syncLinkValidation();
    updateForms();
    body.focus();
    return;
  }
  syncLinkValidation();
  updateForms();
  linkUrl.focus();
}

function closeMenu(restoreFocus = false) {
  options.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) toggle.focus();
}

function syncSession() {
  menu.hidden = !readStoredSession();
  if (menu.hidden) closeMenu();
}

function openMenu(index = 0) {
  syncSession();
  if (menu.hidden) return;
  options.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
  items[index].focus();
}

toggle.addEventListener("click", () => options.hidden ? openMenu() : closeMenu(true));
toggle.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openMenu(event.key === "ArrowUp" ? items.length - 1 : 0);
  }
});
options.addEventListener("keydown", event => {
  const index = items.indexOf(document.activeElement);
  const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
  if (next !== undefined) {
    event.preventDefault();
    items[next].focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  }
});
document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) closeMenu(); });
menu.addEventListener("focusout", event => { if (!menu.contains(event.relatedTarget)) closeMenu(); });
mobileNavigation.addEventListener("change", () => closeMenu());
window.addEventListener("pageshow", syncSession);
window.addEventListener("focus", syncSession);
syncSession();

function updateForms() {
  const selected = boards.find(board => board.id === boardSelect.value);
  const serializedBody = serializedMessageBody();
  const linkInvalid = !linkPanel.hidden && Boolean(syncLinkValidation());
  boardSelect.disabled = saving || boardsLoading || boardsFailed || !boards.length;
  linkUrl.disabled = saving || linkPanel.hidden;
  messageForm.querySelector("[type=submit]").disabled = saving || boardsLoading || boardsFailed || !selected ||
    !title.value.trim() || title.value.length > 200 || (!linkPanel.hidden && linkInvalid) ||
    (linkPanel.hidden && !body.value.trim()) || serializedBody.length > 2000;
  boardForm.querySelector("[type=submit]").disabled = saving || !name.value.trim() || name.value.length > 80 || description.value.length > 2000;
  const bodyCount = document.querySelector("#create-body-count");
  const tooLong = serializedBody.length > 2000;
  bodyCount.textContent = `${serializedBody.length}/2000${tooLong ? " · Shorten the message or link" : ""}`;
  bodyCount.classList.toggle("is-over-limit", tooLong);
  body.setAttribute("aria-invalid", String(tooLong));
  document.querySelector("#create-selected-board").hidden = !selected || boardsLoading || boardsFailed;
  document.querySelector("#create-selected-name").textContent = selected?.name ?? "";
  document.querySelector("#create-selected-description").textContent = selected?.description ?? "";
}
messageForm.addEventListener("input", updateForms);
linkToggle.addEventListener("click", () => setLinkPanelOpen(true));
linkRemove.addEventListener("click", () => setLinkPanelOpen(false));
linkUrl.addEventListener("blur", () => {
  linkTouched = true;
  syncLinkValidation();
  updateForms();
});
messageForm.addEventListener("reset", () => {
  linkPanel.hidden = true;
  linkToggle.setAttribute("aria-expanded", "false");
  linkUrl.required = false;
  body.required = true;
  bodyRequirement.textContent = "(required)";
  linkTouched = false;
  linkError.textContent = "";
  linkUrl.setCustomValidity("");
  linkUrl.setAttribute("aria-invalid", "false");
});
boardForm.addEventListener("input", updateForms);
boardSelect.addEventListener("change", updateForms);

async function loadBoards() {
  const request = ++boardRequest;
  boardsLoading = true;
  boardsFailed = false;
  boardsStatus.textContent = "Loading boards…";
  boardsRetry.hidden = true;
  updateForms();
  try {
    const result = await fetchBoards();
    if (request !== boardRequest) return;
    const previous = boardSelect.value;
    boards = result;
    boardSelect.replaceChildren(...(boards.length
      ? boards.map(board => new Option(`y/${board.slug}`, board.id))
      : [new Option("No boards available", "")]));
    if (boards.some(board => board.id === previous)) boardSelect.value = previous;
    boardsStatus.textContent = boards.length ? "" : "There are no boards to post to yet. Create a board from the Create menu.";
  } catch {
    if (request !== boardRequest) return;
    boardsFailed = true;
    boardsStatus.textContent = "Boards are unavailable right now. Please try again.";
    boardSelect.replaceChildren(new Option("Boards unavailable", ""));
    boardsRetry.hidden = false;
  } finally {
    if (request === boardRequest) {
      boardsLoading = false;
      updateForms();
    }
  }
}
boardsRetry.addEventListener("click", loadBoards);

createActions.forEach(item => item.addEventListener("click", () => {
  closeMenu(false);
  closeHeaderMenu();
  syncSession();
  if (menu.hidden) return;
  const dialog = item.dataset.create === "message" ? messageDialog : boardDialog;
  previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  dialog.showModal();
  if (dialog === messageDialog) void loadBoards();
  updateForms();
}));

for (const dialog of [messageDialog, boardDialog]) {
  dialog.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => {
    if (!saving) dialog.close();
  }));
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    if (dialog === messageDialog) boardRequest++;
    document.documentElement.style.overflow = previousOverflow;
    syncSession();
    const mobileToggle = document.querySelector("#header-toggle");
    const focusTarget = window.matchMedia("(max-width: 900px)").matches
      ? mobileToggle
      : (menu.hidden ? document.querySelector("[data-login-link]") : toggle);
    focusTarget?.focus();
  });
}

async function submit(event, dialog, action, pendingLabel, defaultLabel) {
  event.preventDefault();
  if (saving || event.currentTarget.querySelector("[type=submit]").disabled) return;
  const form = event.currentTarget;
  const error = form.querySelector(".create-error");
  const submitButton = form.querySelector("[type=submit]");
  saving = true;
  error.textContent = "";
  form.setAttribute("aria-busy", "true");
  dialog.querySelectorAll("button, input, select, textarea").forEach(control => { control.disabled = true; });
  submitButton.textContent = pendingLabel;
  try {
    const href = await action();
    form.reset();
    dialog.close();
    window.location.assign(href);
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "Could not create this right now. Please try again.";
  } finally {
    saving = false;
    form.setAttribute("aria-busy", "false");
    dialog.querySelectorAll("button, input, select, textarea").forEach(control => { control.disabled = false; });
    submitButton.textContent = defaultLabel;
    updateForms();
  }
}

messageForm.addEventListener("submit", event => void submit(event, messageDialog, async () => {
  const board = boards.find(row => row.id === boardSelect.value);
  const message = await createMessage(board.id, title.value, serializedMessageBody());
  return messageHref(board.slug, message.id);
}, "Posting…", "Post"));
boardForm.addEventListener("submit", event => void submit(event, boardDialog, async () => {
  const board = await createBoard(name.value, description.value);
  return boardHref(board.slug);
}, "Creating…", "Create board"));
