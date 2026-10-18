export function boardHref(slug) {
  return `/boards/${encodeURIComponent(slug)}`;
}

export function messageHref(slug, id) {
  return `${boardHref(slug)}/${encodeURIComponent(id)}`;
}

export function parseBoardRoute(pathname) {
  const match = /^\/boards\/([a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return { slug: match[1], messageId: match[2] === undefined ? undefined : decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}
