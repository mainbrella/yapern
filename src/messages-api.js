import { messageBoardConfig } from "./config.js";

// Keep this endpoint limited to public reads of the configured message table.
// Server requests need no browser Origin allowlist change or owner credentials.
export async function handleMessagesRequest(request, fetcher = fetch) {
  const headers = { "Cache-Control": "no-store" };
  if (!["GET", "HEAD"].includes(request.method)) {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: { ...headers, Allow: "GET, HEAD" } },
    );
  }
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
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
      credentials: "omit",
      redirect: "manual",
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
    return Response.json(
      {
        data: payload.data.map(({ id, user_id, title, body, created_at }) => ({
          id, user_id, title, body, created_at,
        })),
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Messages are unavailable right now. Please try again." },
      { status: 502, headers },
    );
  }
}
