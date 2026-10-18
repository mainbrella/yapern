import { messageBoardConfig } from "./config.js";
import { readStoredSession } from "./auth.js";

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
  if (!response.ok) throw new Error("Message board unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload?.data) || payload.data.length > Number(params.limit)) {
    throw new Error("Invalid message board data");
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
        message &&
        ["id", "board_id", "user_id", "title", "body", "created_at"].every(
          (key) => typeof message[key] === "string",
        ) &&
        Number.isFinite(Date.parse(message.created_at)) &&
        (boardId === undefined || message.board_id === boardId) &&
        (messageId === undefined || message.id === messageId),
    )
  ) {
    throw new Error("Invalid messages");
  }
  return messages;
}

async function readBoards(params, fetcher) {
  const boards = await readRows("boards", {
    select: "id,slug,name,description", ...params,
  }, fetcher);
  if (!boards.every(board => board && typeof board.id === "string" &&
    typeof board.slug === "string" && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(board.slug) &&
    typeof board.name === "string" && typeof board.description === "string")) {
    throw new Error("Invalid boards");
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
  if (board.slug !== slug) throw new Error("Unexpected board");
  const messages = await fetchMessages(fetcher, { boardId: board.id, messageId });
  if (messageId !== undefined && !messages.length) return null;
  return { board, messages };
}
