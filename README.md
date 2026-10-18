# website

```sh
npm ci
npm run dev       # Vite development server
npm run build     # Build the site and message-list JavaScript into dist/
npm test          # Check the read-only message endpoint and asset routing
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy the assets and read-only API Worker
```

The homepage keeps its interactive sample preview and adds a live **Latest
messages** list below the feature strip. It shows the newest 20 messages from
the same production Canopy project as `canopy/examples/message-board`.

`canopy.json` supplies project ID `90da3093-84b6-4cd7-a39a-a8afc39403b8`.
`src/config.js` contains the example's production API origin and public key.
No owner API key is needed to build, preview, or serve messages.

The browser reads `/api/messages`. In production, the Yapern Worker fetches the
public message table from `https://api.mainbrella.com`; Vite serves the same
endpoint during development. This uses the existing public-read permissions
without changing the backend's browser-origin allowlist. The endpoint only reads
the configured table and does not forward browser credentials or query parameters.
Loading, empty, and unavailable states appear inline, with retry on failure.

`npm run preview` runs the built assets and Worker together. Run `npm run build`
first. `npx wrangler deploy --dry-run` checks deployment without publishing.
