import { messageBoardConfig } from "./config.js";
import { readStoredSession } from "./auth.js";

const isMessage = (message) => message &&
  ["id", "board_id", "user_id", "title", "body", "created_at"].every(key => typeof message[key] === "string") &&
  Number.isFinite(Date.parse(message.created_at));
const isBoard = (board) => board && typeof board.id === "string" &&
  typeof board.slug === "string" && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(board.slug) &&
  typeof board.name === "string" && typeof board.description === "string";

// The browser calls Mainbrella directly. The public key must allow the site's
// exact Origin; Mainbrella handles both CORS preflight and the table read.
async function readRows(table, params, fetcher) {
  const { apiOrigin, projectId, publicKey } = messageBoardConfig;
  const url = new URL(
    `/bff/data/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}`,
    apiOrigin,
  );
  url.search = new URLSearchParams(params).toString();
  const session = readStoredSession();
  const response = await fetcher(url, {
    headers: { apikey: publicKey, ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Sub-yap unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload?.data) || payload.data.length > Number(params.limit)) {
    throw new Error("Invalid sub-yap data");
  }
  return payload.data;
}

export async function fetchMessages(fetcher = fetch, { boardId, messageId } = {}) {
  const params = {
    select: "id,board_id,user_id,title,body,created_at",
    order: "created_at.desc",
    limit: messageId === undefined ? "20" : "1",
  };
  if (boardId !== undefined) params.board_id = `eq.${boardId}`;
  if (messageId !== undefined) params.id = `eq.${messageId}`;
  const messages = await readRows(messageBoardConfig.table, params, fetcher);
  if (
    !messages.every(
      (message) =>
        isMessage(message) &&
        (boardId === undefined || message.board_id === boardId) &&
        (messageId === undefined || message.id === messageId),
    )
  ) {
    throw new Error("Invalid messages");
  }
  return messages;
}

export async function fetchMessageAuthors(messages, fetcher = fetch) {
  const ids = [...new Set(messages.map(message => message.user_id))];
  // BFF supports equality filters, so look up each distinct author once.
  const authors = await Promise.all(ids.map(async id => {
    const users = await readRows("users", { select: "id,name", id: `eq.${id}`, limit: "1" }, fetcher);
    const user = users[0];
    if (user && (user.id !== id || typeof user.name !== "string")) {
      throw new Error("Invalid message author");
    }
    return [id, user?.name.trim() || "Unknown user"];
  }));
  return new Map(authors);
}

async function readBoards(params, fetcher) {
  const boards = await readRows("boards", {
    select: "id,slug,name,description", ...params,
  }, fetcher);
  if (!boards.every(isBoard)) {
    throw new Error("Invalid sub-yaps");
  }
  return boards;
}

export async function fetchBoards(fetcher = fetch) {
  const boards = [];
  for (let offset = 0; ; offset += 100) {
    const page = await readBoards({ order: "slug.asc", limit: "100", offset: String(offset) }, fetcher);
    boards.push(...page);
    if (page.length < 100) return boards;
  }
}

export async function fetchBoardPage(slug, messageId, fetcher = fetch) {
  const boards = await readBoards({ slug: `eq.${slug}`, limit: "1" }, fetcher);
  const board = boards[0];
  if (!board) return null;
  if (board.slug !== slug) throw new Error("Unexpected sub-yap");
  const messages = await fetchMessages(fetcher, { boardId: board.id, messageId });
  if (messageId !== undefined && !messages.length) return null;
  return { board, messages };
}

async function insertRow(table, values, validate, fetcher) {
  const session = readStoredSession();
  if (!session) throw new Error("Your session has expired. Open Account and sign in again to continue.");
  const { apiOrigin, projectId, publicKey } = messageBoardConfig;
  const url = new URL(`/bff/data/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}`, apiOrigin);
  let response;
  try {
    response = await fetcher(url, {
      method: "POST", mode: "cors", credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { apikey: publicKey, authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...values, user_id: session.session.user_id }),
    });
  } catch {
    throw new Error("Could not confirm creation. Check your connection and the sub-yap before trying again.");
  }
  if (response.status === 401) throw new Error("Your session has expired. Open Account and sign in again to continue.");
  if (response.status === 403) throw new Error(table === "boards"
    ? "You don’t have permission to create sub-yaps."
    : "You don’t have permission to post to this sub-yap.");
  if (response.status === 409 && table === "boards") throw new Error("A sub-yap with that name already exists. Choose another name.");
  if (!response.ok) throw new Error("Could not create this right now. Please try again.");
  const payload = await response.json().catch(() => null);
  const row = payload?.data?.[0];
  if (!Array.isArray(payload?.data) || payload.data.length !== 1 || !validate(row) || !row.id ||
    row.user_id !== session.session.user_id || Object.entries(values).some(([key, value]) => row[key] !== value)) {
    throw new Error("Could not confirm creation. Check the sub-yap before trying again.");
  }
  return row;
}

export async function createBoard(name, description, fetcher = fetch) {
  const cleanName = name.trim();
  const cleanDescription = description.trim();
  if (!cleanName || cleanName.length > 80) throw new Error("Enter a sub-yap name of 1–80 characters.");
  if (cleanDescription.length > 2000) throw new Error("Enter a description of at most 2000 characters.");
  const slug = cleanName.toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    throw new Error("Use letters (a–z), numbers, spaces, or hyphens in the sub-yap name, starting and ending with a letter or number.");
  }
  return insertRow("boards", { slug, name: cleanName, description: cleanDescription }, isBoard, fetcher);
}

export async function createMessage(boardId, title, body, fetcher = fetch) {
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (!boardId.trim()) throw new Error("Choose a sub-yap for your message.");
  if (!cleanTitle || cleanTitle.length > 200) throw new Error("Enter a title of 1–200 characters.");
  if (!cleanBody || cleanBody.length > 2000) throw new Error("Enter a message of 1–2000 characters.");
  return insertRow(messageBoardConfig.table, { board_id: boardId, title: cleanTitle, body: cleanBody }, isMessage, fetcher);
}
