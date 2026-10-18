# website

```sh
npm ci
npm run dev       # Vite development server
npm run build     # Build the site and message-list JavaScript into dist/
npm test          # Check the browser's production API client
npm run preview   # Preview the built static site
npm run deploy    # Build, then deploy the static HTML, CSS, JS, and images
```

The homepage keeps its interactive sample preview and adds a live **Latest
messages** list below the feature strip. It shows the newest 20 messages from
the same production Canopy project as `canopy/examples/message-board`.

The homepage Login button opens `/login/`. One email/password form signs in or
creates a real project account through BFF, using
`/bff/data/<projectId>/auth/email`. Session checks and sign-out use
`/bff/data/<projectId>/auth/session` (GET/DELETE). This uses the same `bff_us_`
bearer sessions as `../mb`, rather than Mainbrella owner accounts or Alice/Bob
demo login. The token lives in sessionStorage for the current tab, expires after
one hour, and is sent with the public `apikey` on board requests. Passwords are
sent only to BFF and never stored in the browser.

When signed in, the header's **Account** button opens `/account/`. The account
page reads the current user's `id,name` from the existing `users` table and
updates only `name`, filtering by the authenticated user's ID. Names are trimmed
and must contain 1–80 characters. Loading, retry, save confirmation, expired
sessions, and sign-out appear inline. No schema migration is required.

The configured browser key must grant `users: ['select', 'update']`. The `users`
table policy must allow selects and own-row updates with `id` as `ownerColumn`;
insert and delete access are unnecessary. These permissions are configured for
the production key. For another deployment, with the owner's
`MAINBRELLA_API_KEY` available, use
`canopy --browser-keys` to find the configured key's ID, then add its
`canopy --grant users select --key <KEY_ID>` and
`canopy --grant users update --key <KEY_ID>` grants. The owner policy endpoint
`PUT /bff/projects/90da3093-84b6-4cd7-a39a-a8afc39403b8/policies/users`
accepts this policy:

```json
{ "select": "public", "insert": "none", "update": "own", "delete": "none", "ownerColumn": "id" }
```

Signed-in users see a **+ Create** dropdown on the homepage with **Create
message** and **Create board**. The dialogs follow `../mb`: messages include a
board selector, title, and body; boards include a name and optional description.
Both submit directly to BFF with the current session, preserve input on errors,
and open the created board or message after the API confirms the saved row.

Before publishing the login page, apply Canopy backend migration
`056_bff_email_accounts.sql` and deploy the updated BFF API. Credentials are
private salted scrypt hashes, separate from the board's public `users` rows.

`canopy.json` supplies project ID `90da3093-84b6-4cd7-a39a-a8afc39403b8`.
`src/config.js` contains the example's production API origin and public key.
No owner API key is needed to build, preview, or serve messages.

The deployed JavaScript calls `https://api.mainbrella.com/bff/data/<projectId>/tables/messages`
directly, sending the public key in the `apikey` header, a BFF bearer token when
signed in, and omitting cookies.
Mainbrella is the only backend; Yapern serves static files and has no Worker
entry point, API routes, or development API proxy. Loading, empty, and unavailable
states appear inline, with retry on failure.

Message metadata links each board slug to `/y/:slug`; message titles link
to `/y/:slug/:id`. These routes load the shared static `board.html`
page, then fetch their data in the browser using the same production API and key.
Board lists filter by board ID before selecting the latest 20 posts. Individual
message pages filter by both board and message ID, so older posts remain reachable.
Missing boards or messages display an inline not-found state.

Both detail views use the example's three-column layout: board navigation on
the left, the current board or message in the middle, and five recent posts on
the right. The active board is highlighted. Navigation and recent posts load
independently from the main content, with separate retry controls on failure.
On tablets the recent posts move below the content; on phones all columns stack
and the board menu can be collapsed. The homepage layout stays unchanged.

`public/_redirects` maps `/y/*` to `/board` (the static `board.html` page)
with a 200 rewrite, retaining the requested URL. Vite development and preview perform the
same static rewrite. There is no SSR. Other static hosts need an equivalent
rewrite for `/y/*` to `/board.html`. See [Cloudflare's static redirect
configuration](https://developers.cloudflare.com/workers/static-assets/redirects/).

The production browser key must allow the exact origin `https://yapern.com` for
CORS preflight and table reads. Additional origins such as a local development
URL must be explicitly allowed on that key too; paths and trailing slashes are
not part of an origin. Never put an owner/account API key in the site.

Run `npm run build` before `npm run preview`. The generated `dist/` directory can
be served by any static host. Wrangler publishes it as static assets only;
`npx wrangler deploy --dry-run` checks deployment without publishing.
