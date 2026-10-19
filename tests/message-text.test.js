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

test("adds embeds for YouTube watch links with valid video IDs", () => {
  const text = "https://www.youtube.com/watch?v=issziaa-dtY&t=45s and m.youtube.com/watch?t=45s&v=Abc_123-xYz";
  const parts = parseMessageText(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.youtubeEmbed).map(part => part.youtubeEmbed), [
    "https://www.youtube.com/embed/issziaa-dtY",
    "https://www.youtube.com/embed/Abc_123-xYz",
  ]);

  const bare = parseMessageText("youtube.com/watch?v=issziaa-dtY").find(part => part.href);
  assert.equal(bare.youtubeEmbed, "https://www.youtube.com/embed/issziaa-dtY");
});

test("does not add embeds for non-watch links, invalid IDs, or lookalike hosts", () => {
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
    assert.ok(parts.every(part => !part.youtubeEmbed), text);
  }
});

test("marks direct image URLs for inline rendering and preserves mixed message order", () => {
  const text = "Before https://images.example/Bh2omK9.png, then https://example.com/path and http://cdn.example/a/AbC9.GIF?width=640#image after.";
  const parts = parseMessageText(text);
  assert.equal(parts.map(part => part.text).join(""), text);
  assert.deepEqual(parts.filter(part => part.imageUrl).map(part => part.imageUrl), [
    "https://images.example/Bh2omK9.png",
    "http://cdn.example/a/AbC9.GIF?width=640#image",
  ]);
  assert.deepEqual(parts.filter(part => part.href && !part.imageUrl).map(part => part.text), [
    "https://example.com/path",
  ]);

  const bare = parseMessageText("cdn.example/a/Bh2omK9.webp?width=320#preview").find(part => part.href);
  assert.equal(bare.imageUrl, "https://cdn.example/a/Bh2omK9.webp?width=320#preview");
});

test("marks every supported image extension on any host, including nested paths", () => {
  for (const [text, expected] of [
    ["https://files.example/photo.png", "https://files.example/photo.png"],
    ["http://cdn.example/a/animation.GIF?size=large", "http://cdn.example/a/animation.GIF?size=large"],
    ["https://images.example/photos/photo.jpg#full", "https://images.example/photos/photo.jpg#full"],
    ["media.example/photos/photo.webp", "https://media.example/photos/photo.webp"],
    ["i.imgur.com/Bh2omK9.png", "https://i.imgur.com/Bh2omK9.png"],
  ]) {
    const part = parseMessageText(text).find(part => part.href);
    assert.equal(part.imageUrl, expected, text);
  }
});

test("leaves unsupported or nonterminal image extensions as ordinary links", () => {
  for (const text of [
    "https://i.imgur.com/Bh2omK9.jpeg",
    "https://images.example/photo.png.html",
    "https://images.example/photo.jpg/path",
    "https://images.example/page?file=photo.png",
    "https://images.example/page#photo.webp",
  ]) {
    const parts = parseMessageText(text);
    assert.equal(parts.map(part => part.text).join(""), text);
    assert.ok(parts.some(part => part.href), text);
    assert.ok(parts.every(part => !part.imageUrl), text);
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
