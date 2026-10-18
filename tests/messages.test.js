import assert from "node:assert/strict";
import test from "node:test";
import { fetchMessages } from "../src/messages-api.js";
import { messageBoardConfig } from "../src/config.js";

const message = {
  id: "welcome",
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
      select: "id,user_id,title,body,created_at",
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
