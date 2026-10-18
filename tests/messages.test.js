import assert from "node:assert/strict";
import test from "node:test";
import { fetchMessages, fetchBoards, fetchBoardPage } from "../src/messages-api.js";
import { messageBoardConfig } from "../src/config.js";
import { boardHref, messageHref, parseBoardRoute } from "../src/board-routes.js";

const message = {
  id: "welcome",
  board_id: "general",
  user_id: "alice",
  title: "Welcome",
  body: "Hello from Canopy!",
  created_at: "2026-10-17T06:19:23.111Z",
};

test("reads the production project's newest 20 messages directly using CORS", async () => {
  const messages = await fetchMessages(async (url, options) => {
    assert.equal(url.origin, "https://api.mainbrella.com");
    assert.equal(url.pathname, "/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      select: "id,board_id,user_id,title,body,created_at",
      order: "created_at.desc",
      limit: "20",
    });
    assert.deepEqual(options.headers, { apikey: messageBoardConfig.publicKey });
    assert.equal(options.mode, "cors");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ data: [message] });
  });
  assert.deepEqual(messages, [message]);
});

const board = { id: "general", slug: "general", name: "General", description: "General discussion." };

test("board lookups paginate so messages can link to boards beyond the first 100", async () => {
  const boards = await fetchBoards(async url => {
    assert.ok(url.pathname.endsWith("/tables/boards"));
    assert.equal(url.searchParams.get("limit"), "100");
    const offset = url.searchParams.get("offset");
    assert.ok(["0", "100"].includes(offset));
    return Response.json({ data: offset === "0" ? Array.from({ length: 100 }, (_, i) => ({
      ...board, id: String(i), slug: `board-${i}`,
    })) : [board] });
  });
  assert.equal(boards.length, 101);
  assert.deepEqual(boards[100], board);
});

test("board pages filter messages by the looked-up board before applying the limit", async () => {
  const result = await fetchBoardPage("general", undefined, async url => {
    if (url.pathname.endsWith("/tables/boards")) {
      assert.equal(url.searchParams.get("slug"), "eq.general");
      assert.equal(url.searchParams.get("limit"), "1");
      return Response.json({ data: [board] });
    }
    assert.equal(url.searchParams.get("board_id"), "eq.general");
    assert.equal(url.searchParams.get("limit"), "20");
    assert.equal(url.searchParams.get("order"), "created_at.desc");
    return Response.json({ data: [message] });
  });
  assert.deepEqual(result, { board, messages: [message] });
});

test("message pages filter by both board and message ID, including older messages", async () => {
  const id = "older / post?";
  const result = await fetchBoardPage("general", id, async url => {
    if (url.pathname.endsWith("/tables/boards")) return Response.json({ data: [board] });
    assert.equal(url.searchParams.get("board_id"), "eq.general");
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    assert.equal(url.searchParams.get("limit"), "1");
    return Response.json({ data: [{ ...message, id }] });
  });
  assert.equal(result.messages[0].id, id);
});

test("missing boards and missing messages return null, while empty boards remain valid", async () => {
  assert.equal(await fetchBoardPage("missing", undefined, async () => Response.json({ data: [] })), null);
  const fetcher = async url => Response.json({ data: url.pathname.endsWith("/tables/boards") ? [board] : [] });
  assert.equal(await fetchBoardPage("general", "missing", fetcher), null);
  assert.deepEqual(await fetchBoardPage("general", undefined, fetcher), { board, messages: [] });
});

test("rejects a mismatched board, message ID, or messages belonging to another board", async () => {
  await assert.rejects(() => fetchBoardPage("other", undefined, async () => Response.json({ data: [board] })));
  for (const wrong of [{ ...message, board_id: "other" }, { ...message, id: "other" }]) {
    await assert.rejects(() => fetchBoardPage("general", "welcome", async url => Response.json({
      data: url.pathname.endsWith("/tables/boards") ? [board] : [wrong],
    })));
  }
});

test("links use root board routes and encode message IDs", () => {
  assert.equal(boardHref("video-games"), "/boards/video-games");
  assert.equal(messageHref("general", "older / post?"), "/boards/general/older%20%2F%20post%3F");
  assert.deepEqual(parseBoardRoute("/boards/general/"), { slug: "general", messageId: undefined });
  assert.deepEqual(parseBoardRoute(messageHref("general", "older / post?")), { slug: "general", messageId: "older / post?" });
  for (const path of ["/boards/", "/boards/-invalid", "/boards/general/id/extra", "/boards/general/%ZZ"]) {
    assert.equal(parseBoardRoute(path), null);
  }
});

test("returns an empty list for a project with no messages", async () => {
  assert.deepEqual(await fetchMessages(async () => Response.json({ data: [] })), []);
});

test("rejects network, permission, redirect, and malformed data failures", async () => {
  const failures = [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("Forbidden", { status: 403 }),
    async () => new Response(null, { status: 302, headers: { Location: "https://other.example" } }),
    async () => new Response("not json"),
    async () => Response.json({ data: null }),
    async () => Response.json({ data: [{ ...message, created_at: "invalid" }] }),
    async () => Response.json({ data: [{ ...message, body: null }] }),
    async () => Response.json({ data: Array(21).fill(message) }),
  ];
  for (const fetcher of failures) await assert.rejects(() => fetchMessages(fetcher));
});
