import assert from "node:assert/strict";
import test from "node:test";
import { fetchOgImage } from "../src/messages-api.js";
import { storeSession } from "../src/auth.js";
import { messageBoardConfig } from "../src/config.js";

const session = {
  token: `bff_us_${"a".repeat(64)}`,
  session: { id: "session", user_id: "real-user", expires_at: new Date(Date.now() + 3600000).toISOString() },
  user: { id: "real-user", email: "person@example.com" },
};

test("posts a fragment-free link to the image BFF with the current project credentials", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  const image = await fetchOgImage("https://example.com/a?x=1#section", async (url, options) => {
    assert.equal(url.origin, messageBoardConfig.apiOrigin);
    assert.equal(url.pathname, "/bff/og-image");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, {
      apikey: messageBoardConfig.publicKey,
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    });
    assert.equal(options.mode, "cors");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { url: "https://example.com/a?x=1" });
    return Response.json({ image: "https://cdn.example/image.jpg" });
  });
  assert.equal(image, "https://cdn.example/image.jpg");
});

test("missing or expired sessions and invalid input skip the request", async t => {
  t.after(() => storeSession(null));
  const neverFetch = () => assert.fail("must not request a preview");
  storeSession(null);
  assert.equal(await fetchOgImage("https://example.com", neverFetch), null);
  storeSession({ ...session, session: { ...session.session, expires_at: "2000-01-01" } });
  assert.equal(await fetchOgImage("https://example.com", neverFetch), null);

  storeSession(session);
  for (const input of ["", " example.com ", "ftp://example.com", "javascript:alert(1)",
    "https://user:pass@example.com", "https://example.com:bad"]) {
    assert.equal(await fetchOgImage(input, neverFetch), null, input);
  }
});

test("missing, malformed, and unsafe image results return null; failed responses reject", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  for (const payload of [{}, { image: null }, { image: "data:image/png;base64,AA==" },
    { image: "javascript:alert(1)" }, { image: "https://user:pass@example.com/image" }]) {
    assert.equal(await fetchOgImage("https://example.com", async () => Response.json(payload)), null);
  }
  await assert.rejects(fetchOgImage("https://example.com", async () => new Response(null, { status: 502 })), /preview unavailable/);
  await assert.rejects(fetchOgImage("https://example.com", async () => new Response("no json")), SyntaxError);
});

test("caller cancellation reaches the BFF request and rejects the lookup", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  const controller = new AbortController();
  let requestSignal;
  const pending = fetchOgImage("https://example.com", (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requestSignal instanceof AbortSignal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
