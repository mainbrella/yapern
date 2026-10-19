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
const previewId = "75f97719-a935-4a7d-a56e-8aeccda1c3df";
const pending = (image = null, retryAfter = "0.001") => new Response(JSON.stringify({
  image, source: image ? "favicon" : "placeholder", status: "pending", previewId,
  statusUrl: "https://attacker.example/steal-token",
}), { status: 202, headers: { "content-type": "application/json", "retry-after": retryAfter } });

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function advance(t, ms) {
  t.mock.timers.tick(ms);
  await flushMicrotasks();
}

test("posts a fragment-free link with project credentials and returns a ready image", async t => {
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
    assert.deepEqual(JSON.parse(options.body), { url: "https://example.com/a?x=1", projectId: messageBoardConfig.projectId });
    return Response.json({ image: "https://cdn.example/image.jpg", source: "og", status: "ready" });
  });
  assert.equal(image, "https://cdn.example/image.jpg");
});

test("ready metadata and cached images do not poll", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  for (const source of ["og", "twitter", "screenshot"]) {
    let calls = 0;
    const image = await fetchOgImage("https://example.com", async () => {
      calls++;
      return Response.json({ image: "https://cdn.example/image.jpg", source, status: "ready" });
    });
    assert.equal(image, "https://cdn.example/image.jpg");
    assert.equal(calls, 1);
  }
});

test("cached failure favicon and legacy image payloads remain usable", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  const failedFavicon = await fetchOgImage("https://example.com", async () => Response.json({
    image: "https://example.com/favicon.ico", source: "favicon", status: "failed",
  }));
  const legacyImage = await fetchOgImage("https://example.com", async () => Response.json({
    image: "https://cdn.example/legacy.jpg",
  }));
  const failedWithoutImage = await fetchOgImage("https://example.com", async () => Response.json({
    image: null, source: "placeholder", status: "failed",
  }));
  assert.equal(failedFavicon, "https://example.com/favicon.ico");
  assert.equal(legacyImage, "https://cdn.example/legacy.jpg");
  assert.equal(failedWithoutImage, null);
});

test("missing, malformed, and unsafe ready images return null", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  for (const payload of [null, {}, { image: null, status: "ready" },
    { image: "data:image/png;base64,AA==", status: "ready" },
    { image: "javascript:alert(1)", status: "ready" },
    { image: "https://user:pass@example.com/image", status: "ready" }]) {
    assert.equal(await fetchOgImage("https://example.com", async () => Response.json(payload)), null);
  }
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

test("pending previews keep polling past favicon until a screenshot is ready", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  const seen = [];
  let poll = 0;
  const imageRequest = fetchOgImage("https://example.com", async (url, options) => {
    seen.push({ url: new URL(url), options });
    if (options.method === "POST") return pending("https://example.com/favicon.ico", "3");
    poll++;
    return poll === 1 ? pending("https://example.com/favicon.ico", "3") :
      Response.json({ image: "https://cdn.example/screenshot.png", source: "screenshot", status: "ready" });
  });
  await flushMicrotasks();
  assert.equal(seen.length, 1);
  await advance(t, 2999);
  assert.equal(seen.length, 1);
  await advance(t, 1);
  assert.equal(seen.length, 2);
  await advance(t, 3000);
  const image = await imageRequest;
  assert.equal(image, "https://cdn.example/screenshot.png");
  assert.equal(seen.length, 3);
  for (const { url, options } of seen.slice(1)) {
    assert.equal(url.origin, messageBoardConfig.apiOrigin);
    assert.equal(url.pathname, `/bff/projects/${messageBoardConfig.projectId}/previews/${previewId}`);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.authorization, `Bearer ${session.token}`);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
  }
});

test("failed screenshot returns a validated favicon or null", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  const withFaviconRequest = fetchOgImage("https://example.com", async (_url, options) => options.method === "POST"
    ? pending("https://example.com/favicon.ico")
    : Response.json({ image: "https://example.com/final-favicon.png", source: "favicon", status: "failed" }));
  await flushMicrotasks();
  await advance(t, 1000);
  const withFavicon = await withFaviconRequest;
  assert.equal(withFavicon, "https://example.com/final-favicon.png");
  const withoutImageRequest = fetchOgImage("https://example.com", async (_url, options) => options.method === "POST"
    ? pending()
    : Response.json({ image: null, source: "placeholder", status: "failed" }));
  await flushMicrotasks();
  await advance(t, 1000);
  const withoutImage = await withoutImageRequest;
  assert.equal(withoutImage, null);
});

test("missing Retry-After defaults to three seconds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  let calls = 0;
  const request = fetchOgImage("https://example.com", async (_url, options) => {
    calls++;
    return options.method === "POST"
      ? new Response(JSON.stringify({ status: "pending", previewId }), { status: 202 })
      : Response.json({ image: "https://cdn.example/ready.jpg", status: "ready" });
  });
  await flushMicrotasks();
  await advance(t, 2999);
  assert.equal(calls, 1);
  await advance(t, 1);
  assert.equal(await request, "https://cdn.example/ready.jpg");
  assert.equal(calls, 2);
});

test("polling stops at the sixty-second bound", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  let calls = 0;
  const request = fetchOgImage("https://example.com", async (_url, options) => {
    calls++;
    return options.method === "POST" ? pending(null, "3") : pending(null, "3");
  });
  await flushMicrotasks();
  for (let i = 0; i < 19; i++) await advance(t, 3000);
  assert.equal(calls, 20);
  await advance(t, 3000);
  await assert.rejects(request, /preview unavailable/);
  assert.equal(calls, 20);
});

test("invalid pending IDs are rejected and poll errors reject the lookup", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  assert.equal(await fetchOgImage("https://example.com", async () => Response.json({
    image: "https://example.com/favicon.ico", status: "pending", previewId: "../other-project",
  }, { status: 202 })), null);
  const pollFailure = fetchOgImage("https://example.com", async (_url, options) => options.method === "POST"
    ? pending()
    : new Response(null, { status: 502 }));
  await flushMicrotasks();
  await advance(t, 1000);
  await assert.rejects(pollFailure, /preview unavailable/);
  await assert.rejects(fetchOgImage("https://example.com", async () => new Response("no json")), SyntaxError);
});

test("caller cancellation interrupts a poll wait without issuing a stale GET", async t => {
  t.after(() => storeSession(null));
  storeSession(session);
  const controller = new AbortController();
  let calls = 0;
  const pendingLookup = fetchOgImage("https://example.com", async (_url, options) => {
    calls++;
    assert.equal(options.signal.aborted, false);
    return pending();
  }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 30));
  controller.abort();
  await assert.rejects(pendingLookup, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("caller cancellation reaches an in-flight request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => storeSession(null));
  storeSession(session);
  const controller = new AbortController();
  let requestSignal, calls = 0;
  const pendingLookup = fetchOgImage("https://example.com", (_url, options) => {
    calls++;
    if (options.method === "POST") return pending(null, "3");
    requestSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  }, { signal: controller.signal });
  await flushMicrotasks();
  await advance(t, 3000);
  assert.ok(requestSignal instanceof AbortSignal);
  controller.abort();
  await assert.rejects(pendingLookup, { name: "AbortError" });
  assert.equal(calls, 2);
});
