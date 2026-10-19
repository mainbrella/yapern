import { fetchMessages, fetchBoards, fetchBoardPage, fetchMessageAuthors } from "./messages-api.js";
import { boardHref, messageHref, parseBoardRoute } from "./board-routes.js";
import { mountBoardSidebars } from "./board-sidebars.js";
import { parseMessageText } from "./message-text.js";
import { mountReplies } from "./replies.js";

const list = document.querySelector("#live-messages");
const status = document.querySelector("#messages-status");
const retry = document.querySelector("#messages-retry");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const heading = document.querySelector("#messages-title");
const description = document.querySelector("#board-description");
const isBoardPage = document.body.classList.contains("board-page");
const route = isBoardPage ? parseBoardRoute(window.location.pathname) : null;

function messageRow(message, board, authors) {
  const item = document.createElement("li");
  const article = document.createElement("article");
  const title = message.title === undefined ? null : document.createElement(isBoardPage ? "h2" : "h3");
  if (title) {
    title.className = "live-message-title";
    if (board) {
      const link = document.createElement("a");
      link.href = messageHref(board.slug, message.id);
      link.textContent = message.title;
      title.append(link);
    } else {
      title.textContent = message.title;
    }
  }
  const meta = document.createElement("p");
  meta.className = "live-message-meta";
  if (board) {
    const link = document.createElement("a");
    link.className = "live-message-board";
    link.href = boardHref(board.slug);
    link.textContent = `y/${board.slug}`;
    meta.append(link, document.createTextNode(" · "));
  }
  const author = document.createElement("span");
  author.textContent = authors.get(message.user_id) ?? "Name unavailable";
  const date = document.createElement("time");
  date.dateTime = message.created_at;
  date.textContent = dateFormat.format(new Date(message.created_at));
  meta.append(author, document.createTextNode(" · "), date);
  const body = document.createElement("p");
  body.className = "live-message-body";
  const youtubeParts = [];
  for (const part of parseMessageText(message.body)) {
    if (part.youtubeEmbed) {
      youtubeParts.push(part);
    } else if (part.imgurImage) {
      const image = document.createElement("img");
      image.className = "live-message-image";
      image.referrerPolicy = "no-referrer";
      image.src = part.imgurImage;
      image.alt = "Image shared via Imgur";
      image.loading = "lazy";
      image.decoding = "async";
      body.append(image);
    } else if (part.href) {
      const link = document.createElement("a");
      link.href = part.href;
      link.textContent = part.text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.append(link);
    } else {
      body.append(document.createTextNode(part.text));
    }
  }
  article.append(meta);
  if (title) article.append(title);
  article.append(body);
  for (const part of youtubeParts) {
    const video = document.createElement("iframe");
    video.className = "live-message-video";
    video.width = 560;
    video.height = 315;
    video.src = part.youtubeEmbed;
    video.title = "YouTube video player";
    video.setAttribute("frameborder", "0");
    video.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    video.referrerPolicy = "strict-origin-when-cross-origin";
    video.allowFullscreen = true;
    video.loading = "lazy";
    article.append(video);
  }
  item.append(article);
  return item;
}

async function loadMessages() {
  list.setAttribute("aria-busy", "true");
  retry.hidden = true;
  status.textContent = "Loading messages…";
  try {
    let data;
    let boards;
    if (isBoardPage) {
      const result = route && await fetchBoardPage(route.slug, route.messageId);
      if (!result) {
        const resource = route?.messageId === undefined ? "Sub-yap" : "Message";
        heading.textContent = `${resource} not found`;
        document.title = `${resource} not found · Yapern`;
        status.textContent = `We couldn't find that ${resource.toLowerCase()}.`;
        list.replaceChildren();
        return;
      }
      data = result.messages;
      boards = [result.board];
      heading.textContent = `y/${result.board.slug}`;
      description.textContent = route.messageId === undefined ? result.board.description : "";
      document.title = `${route.messageId === undefined ? `y/${result.board.slug}` : data[0].title} · Yapern`;
    } else {
      [data, boards] = await Promise.all([fetchMessages(), fetchBoards()]);
    }
    // Keep posts readable if profile lookups are temporarily unavailable.
    const authors = await fetchMessageAuthors(data).catch(() => new Map());
    const byId = new Map(boards.map(board => [board.id, board]));
    list.replaceChildren(...data.map(message => messageRow(message, byId.get(message.board_id), authors)));
    status.textContent = data.length ? "" : "No messages yet.";
    if (route?.messageId !== undefined && data.length) {
      mountReplies(data[0].id, (reply, replyAuthors) => messageRow(reply, null, replyAuthors));
    }
  } catch {
    status.textContent = "Messages are unavailable right now. Please try again.";
    retry.hidden = false;
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

retry.addEventListener("click", loadMessages);
if (route) heading.textContent = `y/${route.slug}`;
mountBoardSidebars(route?.slug);
loadMessages();
