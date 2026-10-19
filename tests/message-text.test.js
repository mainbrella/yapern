import assert from "node:assert/strict";
import test from "node:test";
import { parseMessageText } from "../src/message-text.js";

test("detects HTTP and HTTPS links without changing message text or whitespace", () => {
  const text = "👋 See HTTPS://example.com/a?x=1&y=2#section\n\n  and http://example.org:8080/path.";
  const parts = parseMessageText(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href), [
    { text: "HTTPS://example.com/a?x=1&y=2#section", href: "https://example.com/a?x=1&y=2#section" },
    { text: "http://example.org:8080/path", href: "http://example.org:8080/path" },
  ]);
});

test("makes bare domains and www addresses usable with HTTPS", () => {
  const parts = parseMessageText("Try example.com, www.example.org/path?q=one and café.fr.");
  assert.deepEqual(parts.filter(part => part.href), [
    { text: "example.com", href: "https://example.com/" },
    { text: "www.example.org/path?q=one", href: "https://www.example.org/path?q=one" },
    { text: "café.fr", href: "https://xn--caf-dma.fr/" },
  ]);
});

test("adds thumbnails for YouTube watch links with valid video IDs", () => {
  const text = "https://www.youtube.com/watch?v=issziaa-dtY&t=45s and m.youtube.com/watch?t=45s&v=Abc_123-xYz";
  const parts = parseMessageText(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.youtubeThumbnail).map(part => part.youtubeThumbnail), [
    "https://img.youtube.com/vi/issziaa-dtY/maxresdefault.jpg",
    "https://img.youtube.com/vi/Abc_123-xYz/maxresdefault.jpg",
  ]);

  const bare = parseMessageText("youtube.com/watch?v=issziaa-dtY").find(part => part.href);
  assert.equal(bare.youtubeThumbnail, "https://img.youtube.com/vi/issziaa-dtY/maxresdefault.jpg");
});

test("does not add thumbnails for non-watch links, invalid IDs, or lookalike hosts", () => {
  for (const text of [
    "https://youtube.com/shorts/issziaa-dtY",
    "https://youtube.com/watch?v=too-short",
    "https://youtube.com/watch?v=issziaa-dtYextra",
    "https://youtube.com/watch?t=45s",
    "https://youtube.com.evil.example/watch?v=issziaa-dtY",
    "https://evil-youtube.com/watch?v=issziaa-dtY",
    "https://youtu.be/issziaa-dtY",
  ]) {
    const parts = parseMessageText(text);
    assert.equal(parts.map(part => part.text).join(""), text);
    assert.ok(parts.every(part => !part.youtubeThumbnail), text);
  }
});

test("leaves surrounding punctuation outside links and preserves balanced URL brackets", () => {
  for (const [text, expected] of [
    ["(https://example.com/path).", "https://example.com/path"],
    ["Read https://example.com/wiki/Function_(mathematics).", "https://example.com/wiki/Function_(mathematics)"],
    ["[https://example.com/path],", "https://example.com/path"],
    ["“https://example.com/path”;", "https://example.com/path"],
    ["https://example.com/path?!", "https://example.com/path"],
    ["https://[::1]:8080/", "https://[::1]:8080/"],
  ]) {
    const parts = parseMessageText(text);
    assert.equal(parts.map(part => part.text).join(""), text);
    assert.deepEqual(parts.filter(part => part.href).map(part => part.text), [expected]);
  }
});

test("keeps unsupported schemes, email addresses, and malformed URLs as plain text", () => {
  for (const text of [
    "javascript:alert(1)", "javascript://example.com/a", "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/path", "file:///example.com/path", "mailto:hello@example.com",
    "hello@example.com", "/example.com/path", "https://", "https://?query", "https://example.com:99999",
    "No links here!", "1.2.3", "",
  ]) {
    const parts = parseMessageText(text);
    assert.equal(parts.map(part => part.text).join(""), text);
    assert.ok(parts.every(part => !part.href), text);
  }
});

test("preserves HTML-like text and only returns safe web destinations", () => {
  const text = '<img src=x onerror=alert(1)> https://example.com/?q=<script> " onclick="alert(1)';
  const parts = parseMessageText(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.href), [{ text: "https://example.com/?q=", href: "https://example.com/?q=" }]);
});
