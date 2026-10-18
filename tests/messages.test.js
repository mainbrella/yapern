import assert from "node:assert/strict";
import test from "node:test";
import { handleMessagesRequest } from "../src/messages-api.js";
import { messageBoardConfig } from "../src/config.js";
import worker from "../src/worker.js";

const message = {
  id: "welcome",
  user_id: "alice",
  title: "Welcome",
  body: "Hello from Canopy!",
  created_at: "2026-10-17T06:19:23.111Z",
};

test("reads only the production project's newest 20 public messages", async () => {
  const request = new Request("https://yapern.com/api/messages?limit=999&table=users", {
    headers: { authorization: "Bearer private", cookie: "private=1", origin: "https://yapern.com" },
  });
  const response = await handleMessagesRequest(request, async (url, options) => {
    assert.equal(url.origin, "https://api.mainbrella.com");
    assert.equal(url.pathname, "/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      select: "id,user_id,title,body,created_at",
      order: "created_at.desc",
      limit: "20",
    });
    assert.deepEqual(options.headers, { apikey: messageBoardConfig.publicKey });
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ data: [{ ...message, private_field: "omit" }], meta: { internal: true } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { data: [message] });
});

test("returns an empty list for a project with no messages", async () => {
  const response = await handleMessagesRequest(new Request("https://yapern.com/api/messages"),
    async () => Response.json({ data: [] }));
  assert.deepEqual(await response.json(), { data: [] });
});

test("rejects writes without calling the backend", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handleMessagesRequest(new Request("https://yapern.com/api/messages", { method }),
      () => assert.fail("Must not call the backend"));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  }
});

test("HEAD returns no body without calling the backend", async () => {
  const response = await handleMessagesRequest(new Request("https://yapern.com/api/messages", { method: "HEAD" }),
    () => assert.fail("Must not call the backend"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("upstream failures and malformed messages return a safe, retryable error", async () => {
  const failures = [
    async () => { throw new Error("Sensitive upstream details"); },
    async () => new Response("Sensitive upstream details", { status: 403 }),
    async () => new Response(null, { status: 302, headers: { Location: "https://other.example" } }),
    async () => new Response("not json"),
    async () => Response.json({ data: null }),
    async () => Response.json({ data: [{ ...message, created_at: "invalid" }] }),
    async () => Response.json({ data: [{ ...message, body: null }] }),
    async () => Response.json({ data: Array(21).fill(message) }),
  ];
  for (const fetcher of failures) {
    const response = await handleMessagesRequest(new Request("https://yapern.com/api/messages"), fetcher);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "Messages are unavailable right now. Please try again.",
    });
  }
});

test("the Worker leaves existing homepage, legal, download, and missing routes to assets", async () => {
  for (const path of ["/", "/privacy/", "/terms/", "/download/", "/missing"]) {
    const request = new Request(`https://yapern.com${path}`);
    const expected = new Response(path, { status: path === "/missing" ? 404 : 200 });
    const response = await worker.fetch(request, {
      ASSETS: { fetch: async (assetRequest) => {
        assert.equal(assetRequest, request);
        return expected;
      } },
    });
    assert.equal(response, expected);
  }
});
