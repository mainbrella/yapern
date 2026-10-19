import { messageBoardConfig } from "./config.js";
import { readStoredSession, storeSession } from "./auth.js";

const isMessage = (message) => message &&
  ["id", "board_id", "user_id", "title", "body", "created_at"].every(key => typeof message[key] === "string") &&
  Number.isFinite(Date.parse(message.created_at));
const isReply = (reply) => reply &&
  ["id", "message_id", "user_id", "body", "created_at"].every(key => typeof reply[key] === "string") &&
  reply.id.trim().length > 0 && reply.message_id.trim().length > 0 && reply.user_id.trim().length > 0 &&
  Number.isFinite(Date.parse(reply.created_at)) && reply.body.trim().length > 0 && reply.body.length <= 2000;
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

const previewTimeoutMs = 60_000;
const previewRequestTimeoutMs = 10_000;
const previewSources = new Set(["og", "twitter", "screenshot", "favicon", "placeholder"]);

function previewLog(level, event, details = {}) {
  console[level]("[link-preview]", event, details);
}

function previewSummary(payload) {
  const status = ["ready", "pending", "failed"].includes(payload?.status) ? payload.status : "unknown";
  const source = previewSources.has(payload?.source) ? payload.source : "unknown";
  const error = typeof payload?.error === "string" ? payload.error
    : typeof payload?.error?.code === "string" ? payload.error.code
      : payload?.code;
  const errorCode = typeof error === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(error) ? error : undefined;
  return {
    status,
    source,
    ...(typeof payload?.previewId === "string" && /^[0-9a-f-]{36}$/i.test(payload.previewId)
      ? { previewId: payload.previewId } : {}),
    imagePresent: typeof payload?.image === "string" && payload.image.length > 0,
    ...(errorCode ? { errorCode } : {}),
  };
}

function previewFailureKind(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (error?.name === "TypeError") return "network-or-cors";
  return "request-error";
}

function validatedImage(value) {
  if (typeof value !== "string") return null;
  try {
    const image = new URL(value);
    if (["http:", "https:"].includes(image.protocol) && !image.username && !image.password) return image.href;
  } catch {}
  return null;
}

function waitForPreview(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchOgImage(value, fetcher = fetch, { signal } = {}) {
  const session = readStoredSession();
  if (!session) {
    previewLog("info", "lookup skipped", { reason: "missing-or-expired-session" });
    return null;
  }
  let target;
  try {
    target = new URL(value.trim());
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
      previewLog("warn", "lookup skipped", { reason: "invalid-url" });
      return null;
    }
    target.hash = "";
  } catch {
    previewLog("warn", "lookup skipped", { reason: "invalid-url" });
    return null;
  }
  const { apiOrigin, projectId, publicKey } = messageBoardConfig;
  const deadline = Date.now() + previewTimeoutMs;
  const headers = {
    apikey: publicKey,
    authorization: `Bearer ${session.token}`,
  };
  const request = async (url, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Link preview unavailable.");
    const requestSignal = AbortSignal.timeout(Math.min(previewRequestTimeoutMs, remaining));
    const requestOptions = {
      mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
      ...options,
      headers: options.method === "POST" ? { ...headers, "content-type": "application/json" } : headers,
      signal: signal ? AbortSignal.any([signal, requestSignal]) : requestSignal,
    };
    const endpoint = new URL(url).pathname;
    previewLog("info", "request started", { method: options.method ?? "GET", endpoint, projectId, target: target.href });
    try {
      return await fetcher(url, requestOptions);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        previewLog("info", "request cancelled", { method: options.method ?? "GET", endpoint, projectId });
      } else {
        previewLog("warn", "request failed", {
          method: options.method ?? "GET", endpoint, projectId, reason: previewFailureKind(error),
        });
      }
      throw error;
    }
  };
  try {
    const response = await request(new URL("/bff/og-image", apiOrigin), {
      method: "POST",
      body: JSON.stringify({ url: target.href, projectId }),
    });
    let payload;
    try { payload = await response.json(); }
    catch (error) {
      previewLog("warn", "response payload unavailable", { status: response.status, reason: "invalid-json" });
      if (response.status !== 200 && response.status !== 202) throw new Error("Link preview unavailable.");
      throw error;
    }
    previewLog(response.status >= 400 ? "warn" : "info", "response received", {
      httpStatus: response.status, ...previewSummary(payload),
    });
    if (response.status !== 200 && response.status !== 202) {
      throw new Error("Link preview unavailable.");
    }
    if (response.status === 200) {
      if (![undefined, "ready", "failed"].includes(payload?.status)) {
        previewLog("warn", "terminal response invalid", { reason: "unknown-status", ...previewSummary(payload) });
        return null;
      }
      const image = validatedImage(payload?.image);
      if (!image) previewLog("info", "terminal response has no usable image", previewSummary(payload));
      return image;
    }

    const previewId = payload?.previewId;
    if (payload?.status !== "pending" || typeof previewId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewId)) {
      previewLog("warn", "pending response invalid", { reason: "invalid-preview-id-or-state", ...previewSummary(payload) });
      return null;
    }
    // Construct the poll URL from trusted configuration and the validated ID;
    // never follow a server-provided URL that could redirect credentials.
    const statusUrl = new URL(
      `/bff/projects/${encodeURIComponent(projectId)}/previews/${encodeURIComponent(previewId)}`,
      apiOrigin,
    );
    const fallbackImage = payload.source === "favicon" ? validatedImage(payload.image) : null;
    let retryAfter = Number(response.headers.get("Retry-After"));
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = 3;
    let delayMs = Math.min(previewTimeoutMs, Math.max(1000, retryAfter * 1000));
    let pollCount = 0;

    while (Date.now() < deadline) {
      previewLog("info", "poll waiting", { poll: pollCount + 1, delayMs });
      await waitForPreview(Math.min(delayMs, deadline - Date.now()), signal);
      if (Date.now() >= deadline) break;
      pollCount++;
      const pollResponse = await request(statusUrl, { method: "GET" });
      try { payload = await pollResponse.json(); }
      catch (error) {
        previewLog("warn", "poll payload unavailable", { poll: pollCount, status: pollResponse.status, reason: "invalid-json" });
        if (pollResponse.status !== 200 && pollResponse.status !== 202) throw new Error("Link preview unavailable.");
        throw error;
      }
      previewLog(pollResponse.status >= 400 ? "warn" : "info", "poll response received", {
        poll: pollCount, httpStatus: pollResponse.status, ...previewSummary(payload),
      });
      if (pollResponse.status !== 200 && pollResponse.status !== 202) throw new Error("Link preview unavailable.");
      if (payload?.status === "ready") {
        const image = validatedImage(payload.image);
        if (!image) previewLog("warn", "terminal response has no usable image", previewSummary(payload));
        return image;
      }
      if (payload?.status === "failed") {
        const image = validatedImage(payload.image) ?? fallbackImage;
        if (!image) previewLog("info", "terminal response has no usable image", previewSummary(payload));
        return image;
      }
      if (payload?.status !== "pending") {
        previewLog("warn", "poll response invalid", { poll: pollCount, reason: "unknown-status", ...previewSummary(payload) });
        return null;
      }
      if (payload.previewId !== undefined && payload.previewId !== previewId) {
        previewLog("warn", "poll response invalid", { poll: pollCount, reason: "preview-id-mismatch" });
        return null;
      }
      const nextRetry = Number(pollResponse.headers.get("Retry-After"));
      if (Number.isFinite(nextRetry) && nextRetry > 0) {
        delayMs = Math.min(previewTimeoutMs, Math.max(1000, nextRetry * 1000));
      }
    }
    previewLog("warn", "lookup timed out", { timeoutMs: previewTimeoutMs, polls: pollCount });
    throw new Error("Link preview unavailable.");
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      previewLog("info", "lookup cancelled");
    } else if (error?.message !== "Link preview unavailable.") {
      previewLog("warn", "lookup failed", { reason: previewFailureKind(error) });
    }
    throw error;
  }
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

export async function fetchReplies(messageId, fetcher = fetch) {
  if (typeof messageId !== "string" || !messageId.trim()) throw new Error("Choose a message to view replies.");
  const replies = [];
  for (let offset = 0; ; offset += 100) {
    const page = await readRows("replies", {
      select: "id,message_id,user_id,body,created_at",
      message_id: `eq.${messageId}`,
      order: "created_at.asc",
      limit: "100",
      offset: String(offset),
    }, fetcher);
    if (!page.every(reply => isReply(reply) && reply.message_id === messageId)) {
      throw new Error("Invalid replies");
    }
    replies.push(...page);
    if (page.length < 100) return replies;
  }
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
    : table === "replies"
      ? "You don’t have permission to reply to this message."
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

export async function deleteMessage(message, fetcher = fetch) {
  if (!["id", "board_id", "user_id"].every(key => typeof message?.[key] === "string" && message[key].trim())) {
    throw new Error("Choose a message to delete.");
  }
  const session = readStoredSession();
  if (!session) throw new Error("Your session has expired. Open Account and sign in again to continue.");
  if (message.user_id !== session.session.user_id) throw new Error("You can only delete your own messages.");
  const { apiOrigin, projectId, publicKey, table } = messageBoardConfig;
  const url = new URL(`/bff/data/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}`, apiOrigin);
  for (const key of ["id", "board_id", "user_id"]) url.searchParams.set(key, `eq.${message[key]}`);
  let response;
  try {
    response = await fetcher(url, {
      method: "DELETE", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { apikey: publicKey, authorization: `Bearer ${session.token}` },
    });
  } catch {
    throw new Error("Could not confirm deletion. Check your connection and reload the page before trying again.");
  }
  if (response.status === 401) {
    storeSession(null);
    throw new Error("Your session has expired. Open Account and sign in again to continue.");
  }
  if (response.status === 403) throw new Error("You don’t have permission to delete this message.");
  if (!response.ok) throw new Error("Could not delete this message right now. Please try again.");
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload?.data) || payload.data.length !== 0 || payload?.meta?.changes !== 1) {
    throw new Error("Could not confirm deletion. Reload the page to check whether the message still exists.");
  }
}

export async function createReply(messageId, body, fetcher = fetch) {
  if (typeof messageId !== "string" || typeof body !== "string") {
    throw new Error("Enter a message and reply.");
  }
  const cleanBody = body.trim();
  if (!messageId.trim()) throw new Error("Choose a message to reply to.");
  if (!cleanBody || cleanBody.length > 2000) throw new Error("Enter a reply of 1–2000 characters.");
  return insertRow("replies", { message_id: messageId, body: cleanBody }, isReply, fetcher);
}
