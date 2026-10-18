import { fetchMessages } from "./messages-api.js";

const list = document.querySelector("#live-messages");
const status = document.querySelector("#messages-status");
const retry = document.querySelector("#messages-retry");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function messageRow(message) {
  const item = document.createElement("li");
  const article = document.createElement("article");
  const title = document.createElement("h3");
  title.textContent = message.title;
  const meta = document.createElement("p");
  meta.className = "live-message-meta";
  const author = document.createElement("span");
  author.textContent = message.user_id;
  const date = document.createElement("time");
  date.dateTime = message.created_at;
  date.textContent = dateFormat.format(new Date(message.created_at));
  meta.append(author, document.createTextNode(" · "), date);
  const body = document.createElement("p");
  body.className = "live-message-body";
  body.textContent = message.body;
  article.append(title, meta, body);
  item.append(article);
  return item;
}

async function loadMessages() {
  list.setAttribute("aria-busy", "true");
  retry.hidden = true;
  status.textContent = "Loading messages…";
  try {
    const data = await fetchMessages();
    list.replaceChildren(...data.map(messageRow));
    status.textContent = data.length ? "" : "No messages yet.";
  } catch {
    status.textContent = "Messages are unavailable right now. Please try again.";
    retry.hidden = false;
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

retry.addEventListener("click", loadMessages);
loadMessages();
