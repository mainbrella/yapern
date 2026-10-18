import assert from "node:assert/strict";
import test from "node:test";
import { createAuthClient, isSession, readStoredSession, storeSession } from "../src/auth.js";
import { messageBoardConfig } from "../src/config.js";
import { fetchMessages } from "../src/messages-api.js";

function session() {
  return {
    token: `bff_us_${"a".repeat(64)}`,
    session: { id: "session", user_id: "real-user", created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() },
    user: { id: "real-user", email: "person@example.com" }, created: true,
  };
}

test("email login uses project BFF auth with a public key and no cookies, and reuses its bearer for board data", async t => {
  t.after(() => storeSession(null));
  const saved = session();
  const auth = createAuthClient(async (url, options) => {
    assert.equal(url, `https://api.mainbrella.com/bff/data/${messageBoardConfig.projectId}/auth/email`);
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.apikey, messageBoardConfig.publicKey);
    assert.equal(options.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { email: "person@example.com", password: " Exact password " });
    return Response.json(saved, { status: 201 });
  });
  assert.deepEqual(await auth.signInWithEmail(" Person@Example.COM ", " Exact password "), saved);
  assert.deepEqual(readStoredSession(), saved);
  await fetchMessages(async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${saved.token}`);
    assert.equal(options.credentials, "omit");
    return Response.json({ data: [] });
  });
});

test("session checks discard revoked sessions; sign-out revokes the exact project token", async t => {
  t.after(() => storeSession(null));
  const saved = session();
  storeSession(saved);
  const auth = createAuthClient(async (url, options) => {
    assert.ok(url.endsWith("/auth/session"));
    assert.equal(options.headers.authorization, `Bearer ${saved.token}`);
    assert.equal(options.credentials, "omit");
    if (options.method === "DELETE") return Response.json({ revoked: true });
    return Response.json({ session: saved.session, user: saved.user });
  });
  assert.deepEqual(await auth.readSession(), { token: saved.token, session: saved.session, user: saved.user });
  await auth.signOut();
  assert.equal(readStoredSession(), null);
  storeSession(saved);
  assert.equal(await createAuthClient(async () => new Response(null, { status: 401 })).readSession(), null);
  assert.equal(readStoredSession(), null);
});

test("expired, malformed, and mismatched sessions cannot be stored as authenticated users", async t => {
  t.after(() => storeSession(null));
  for (const invalid of [null, {}, { ...session(), token: "owner-token" },
    { ...session(), user: { id: "someone-else", email: "other@example.com" } }]) {
    assert.equal(isSession(invalid), false);
  }
  const expired = session();
  expired.session.expires_at = "2000-01-01";
  storeSession(expired);
  assert.equal(readStoredSession(), null);
  await assert.rejects(createAuthClient(async () => Response.json(expired)).signInWithEmail("a@example.com", "password"));
});

test("auth reports useful errors and retains the session when logout fails", async t => {
  t.after(() => storeSession(null));
  for (const [code, message] of [["invalid_credentials", /incorrect/], ["weak_password", /8 characters/], ["rate_limited", /Too many attempts/]]) {
    const auth = createAuthClient(async () => Response.json({ error: code }, { status: 400 }));
    await assert.rejects(auth.signInWithEmail("person@example.com", "password"), message);
  }
  const auth = createAuthClient(async () => { throw new TypeError("network"); });
  await assert.rejects(auth.signInWithEmail("person@example.com", "password"), /Check your connection/);
  const saved = session();
  storeSession(saved);
  await assert.rejects(auth.signOut());
  assert.deepEqual(readStoredSession(), saved);
});
