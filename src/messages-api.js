import { messageBoardConfig } from "./config.js";

// The browser calls Mainbrella directly. The public key must allow the site's
// exact Origin; Mainbrella handles both CORS preflight and the table read.
export async function fetchMessages(fetcher = fetch) {
  const { apiOrigin, projectId, publicKey, table } = messageBoardConfig;
  const url = new URL(
    `/bff/data/${encodeURIComponent(projectId)}/tables/${encodeURIComponent(table)}`,
    apiOrigin,
  );
  url.search = new URLSearchParams({
    select: "id,user_id,title,body,created_at",
    order: "created_at.desc",
    limit: "20",
  }).toString();
  const response = await fetcher(url, {
    headers: { apikey: publicKey },
    mode: "cors",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Messages unavailable");
  const payload = await response.json();
  if (
    !Array.isArray(payload?.data) ||
    payload.data.length > 20 ||
    !payload.data.every(
      (message) =>
        message &&
        ["id", "user_id", "title", "body", "created_at"].every(
          (key) => typeof message[key] === "string",
        ) &&
        Number.isFinite(Date.parse(message.created_at)),
    )
  ) {
    throw new Error("Invalid messages");
  }
  return payload.data;
}
