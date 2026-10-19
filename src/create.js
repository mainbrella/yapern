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
const name = document.querySelector("#new-board-name");
const description = document.querySelector("#new-board-description");
let boards = [];
let boardRequest = 0;
let boardsLoading = false;
let boardsFailed = false;
let saving = false;
let previousOverflow = "";

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
  boardSelect.disabled = saving || boardsLoading || boardsFailed || !boards.length;
  messageForm.querySelector("[type=submit]").disabled = saving || boardsLoading || boardsFailed || !selected ||
    !title.value.trim() || title.value.length > 200 || !body.value.trim() || body.value.length > 2000;
  boardForm.querySelector("[type=submit]").disabled = saving || !name.value.trim() || name.value.length > 80 || description.value.length > 2000;
  document.querySelector("#create-body-count").textContent = `${body.value.length}/2000`;
  document.querySelector("#create-selected-board").hidden = !selected || boardsLoading || boardsFailed;
  document.querySelector("#create-selected-name").textContent = selected?.name ?? "";
  document.querySelector("#create-selected-description").textContent = selected?.description ?? "";
}
messageForm.addEventListener("input", updateForms);
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
      ? boards.map(board => new Option(`board/${board.slug}`, board.id))
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
  const message = await createMessage(board.id, title.value, body.value);
  return messageHref(board.slug, message.id);
}, "Posting…", "Post"));
boardForm.addEventListener("submit", event => void submit(event, boardDialog, async () => {
  const board = await createBoard(name.value, description.value);
  return boardHref(board.slug);
}, "Creating…", "Create board"));
