# Catbox

Catbox is a lightweight image-hosting service built with [Cloudflare Workers](https://workers.cloudflare.com/) and [Cloudflare R2](https://developers.cloudflare.com/r2/). Upload an image through the web interface or HTTP API and get a permanent URL to share.

## Features

- Drag-and-drop or file-picker uploads, with per-file progress.
- Bulk uploads: select or drop many images, review the queue, and upload them with concurrent requests.
- PNG, JPEG, GIF, WebP, AVIF, and SVG support.
- A 10 MiB upload limit and server-side file-format detection.
- Copyable direct-link, Markdown, HTML, and BBCode formats.
- One-click light/dark theme toggle: Classic (light) and Bootstrap (dark), following the browser preference on first visit.
- Images stored in R2 and served with long-lived caching.
- Missing image URLs return the bundled Catbox logo instead of a plain 404.
- A JSON upload API with CORS enabled.

## Requirements

- Node.js 18 or later and npm.
- A Cloudflare account with R2 enabled to deploy.

## Local development

Install dependencies and start the local Worker:

```sh
npm install
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). Wrangler provides a local R2 implementation for development using the `IMAGES` binding configured in `wrangler.jsonc`.

## Deploy

Authenticate with Cloudflare, create the R2 bucket configured for this project, and deploy:

```sh
npx wrangler login
npx wrangler r2 bucket create catbox-images
npm run deploy
```

The Worker is configured in [`wrangler.jsonc`](./wrangler.jsonc), which binds the `catbox-images` bucket as `IMAGES`. Update the Worker name or bucket name there if you use different resources.

## Upload API

Send a multipart `POST` request to `/upload` with the image in the `fileToUpload` field:

```sh
curl -F "fileToUpload=@cat.png" http://localhost:8787/upload
```

Successful API requests return **201 Created** with a JSON response:

```json
{
  "url": "https://your-domain.example/abc1234.png",
  "name": "cat.png"
}
```

The service checks the file contents to identify its image format, regardless of the filename or browser-supplied MIME type. Uploads larger than 10 MiB are rejected.

Uploads are limited to 120 per minute per client and Cloudflare location; excess requests receive **429 Too Many Requests** with a `Retry-After` header. The browser queue uploads one file per request with two requests in flight, and retries rate-limited or failed requests automatically. Non-multipart requests receive **415 Unsupported Media Type**, and malformed multipart bodies receive **400 Bad Request**.

## Routes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Image upload interface. Use `?theme=classic`, `?theme=dark`, or `?theme=bootstrap` to select a theme, or `?theme=auto` to follow the browser preference. |
| `POST` | `/upload` | Upload an image as multipart form data. |
| `GET` | `/:filename` | Retrieve an uploaded image, or the Catbox logo when the key is missing. |

## Default image

A request for a valid image key that is not stored in R2 returns the bundled Catbox logo at `/default-image.png` with **200 OK** instead of a plain 404. This keeps broken or deleted image embeds showing the Catbox branding.

The logo is a static asset, so the fallback works on a fresh deployment and in local development with an empty R2 bucket. Fallback responses are cached for five minutes, allowing a later upload at the same key to take over. Non-image paths continue to return 404.

## Themes

The header button toggles between **Classic (light)** and **Bootstrap (dark)**.

On a first visit the page follows the browser preference: a light color scheme uses Classic, and a dark one uses Bootstrap. The choice is applied before first paint and updates if the operating system switches while the page is open.

Clicking the toggle stores the chosen theme in the `catbox_theme` cookie and overrides the system preference. Append `?theme=auto` to the URL to clear that choice and follow the browser again. The additional **Dark** palette remains available with `?theme=dark`.

## Type checking

```sh
npm run typecheck
```

## License

[MIT](./LICENSE)
