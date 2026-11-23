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
- Open Graph and Twitter Card link previews with a Catbox logo image.
- A JSON upload API with CORS enabled.
- A `catbox` CLI for single-image and folder uploads, built on [Usage](https://usage.jdx.dev/).

## Requirements

- Node.js 22 or later and npm.
- [Usage](https://usage.jdx.dev/) for the CLI, installed by `mise install`.
- A Cloudflare account with R2 enabled to deploy.

## Local development

Install the mise-managed tools and dependencies, then start the local Worker:

```sh
mise install
npm install
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). Wrangler provides a local R2 implementation for development using the `IMAGES` binding configured in `wrangler.jsonc`.

## Pre-commit checks

Install [pre-commit](https://pre-commit.com/#install) and run these commands from the repository root:

```sh
pre-commit install
pre-commit run --all-files
```

The hook checks browser scripts and JavaScript tests for syntax errors. Pre-commit installs the pinned Node.js and ESLint versions in an isolated environment; the hook does not need the project's `node_modules`.

## Deploy

Authenticate with Cloudflare, create the R2 bucket configured for this project, and deploy:

```sh
npx wrangler login
npx wrangler r2 bucket create catbox-images
npm run deploy
```

The Worker is configured in [`wrangler.jsonc`](./wrangler.jsonc), which binds the `catbox-images` bucket as `IMAGES`. Update the Worker name or bucket name there if you use different resources.

### Rate limits and Cloudflare free-tier capacity

Catbox's `UPLOAD_RATE_LIMITER` applies only to `POST /upload`, before multipart parsing and R2 writes. It allows approximately **120 attempts per minute per client IP per Cloudflare location**. Clients behind the same IP share a bucket at that location, and requests without `CF-Connecting-IP` share a fallback bucket. Rejections return `429` with `Retry-After: 60`. The browser and CLI each start at most one upload every 550 ms per instance (about 109 per minute); separate tabs or processes do not coordinate. This is an abuse throttle, not a global quota or a billing cap. See [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

| Layer | Free allowance or limit | What it means for Catbox |
| --- | --- | --- |
| [Workers Free](https://developers.cloudflare.com/workers/platform/limits/#daily-requests) | 100,000 requests/day per account, resetting at 00:00 UTC | Upload attempts that reach the Worker use this budget even when rejected, including by Catbox's `429`. Home, API preflights and image requests also share it. Cloudflare's quota error is separate from Catbox's throttle. |
| [Workers runtime](https://developers.cloudflare.com/workers/platform/limits/) | 10 ms CPU per HTTP request; 128 MB memory per isolate | The 10 MiB Catbox file cap is below the 100 MB incoming body limit for a Cloudflare Free zone. It does not guarantee CPU or memory headroom: Catbox parses multipart data, reads the file for format detection and hashes tokenized uploads for retries. Profile representative uploads before raising the cap. |
| [R2 Standard storage](https://developers.cloudflare.com/r2/pricing/#free-tier) | 10 GB-month/month | Uploads accumulate; Catbox does not delete old objects. For a full month, about 9,500 retained 1 MiB images (or 950 at 10 MiB each) use nearly all the free storage allowance, even with no new requests. |
| [R2 operations](https://developers.cloudflare.com/r2/pricing/#class-a-operations) | 1 million Class A and 10 million Class B operations/month; no egress charge | A typical new upload calls `PutObject` (Class A) once; collisions can cause additional calls and a retried upload can still call R2 even when it reuses a URL. An image lookup that reaches R2 calls `GetObject` (Class B), including lookups that find no object. |

At an even rate over 30 days, 1 million Class A operations averages about **33,333/day**, before any other account usage. That is not a safe upload target: stored bytes can run out of free allowance much sooner. R2's allowances are monthly billing thresholds for Standard storage, not hard stops; usage above them can incur charges. [Workers Cache](https://developers.cloudflare.com/workers/cache/#pricing) hits avoid Worker execution and R2 reads, but still use the Workers request budget when Workers Cache is enabled, as it is in this repo.

Keep the current throttle for normal bulk uploads and track daily Workers requests and monthly R2 storage and operations separately. If upload bursts threaten the request budget on a custom Cloudflare zone, consider a [WAF rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) for `POST /upload` to reject traffic before it reaches the Worker. WAF counters are also location-scoped; neither limiter replaces a strict global request or storage budget.

## CLI

The `catbox` command uploads one image or a folder of images.

Install the tools and expose the command:

```sh
mise install
npm link
```

Alternatively, run `./cli/catbox` directly or add `cli/` to `PATH`. The command uses [Usage](https://usage.jdx.dev/) for argument parsing, validation, help, and completions.

Upload a single file:

```sh
catbox image.png
```

Upload every supported image directly inside a folder:

```sh
catbox folder/
```

Include nested folders:

```sh
catbox folder/ --recursive
```

Print structured JSON instead of one URL per line:

```sh
catbox folder/ --recursive --json
```

The CLI defaults to `https://catbox.tigefa.workers.dev`. Target local development with `--base-url` or `CATBOX_URL`:

```sh
catbox image.png --base-url http://localhost:8787
CATBOX_URL=http://localhost:8787 catbox folder/
```

Folder scans use PNG, JPEG, GIF, WebP, AVIF, and SVG extensions, skip hidden entries and symlinks, and are non-recursive unless `--recursive` is given. Files over 10 MiB are rejected before upload.

Uploads use `--concurrency` (default 2, range 1-8) and start a request every 550 ms to stay under the service's 120-per-minute limit. The CLI retries 429, 5xx, and network failures, prints one URL per successful upload, and exits non-zero if any file fails.
Each file gets a fresh upload token. With an updated Catbox Worker, automatic retries of the same bytes reuse the original URL instead of storing a duplicate. Running the CLI again starts a new upload. Older Workers ignore the token.

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

Upload attempts are subject to an approximate limit of 120 per minute per client IP and Cloudflare location; rejected attempts receive **429 Too Many Requests** with a `Retry-After` header. See [Rate limits and Cloudflare free-tier capacity](#rate-limits-and-cloudflare-free-tier-capacity) for the separate platform quotas. The browser queue uploads one file per request with two requests in flight, and retries rate-limited or failed requests automatically. Non-multipart requests receive **415 Unsupported Media Type**, and malformed multipart bodies receive **400 Bad Request**.

## Routes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Image upload interface. Use `?theme=classic`, `?theme=dark`, or `?theme=bootstrap` to select a theme, or `?theme=auto` to follow the browser preference. |
| `POST` | `/upload` | Upload an image as multipart form data. |
| `GET` | `/:filename` | Retrieve an uploaded image, or the Catbox logo when the key is missing. |

## Default image

A request for a valid image key that is not stored in R2 returns the bundled Catbox logo at `/default-image.png` with **200 OK** instead of a plain 404. This keeps broken or deleted image embeds showing the Catbox branding.

The logo is a static asset, so the fallback works on a fresh deployment and in local development with an empty R2 bucket. Fallback responses are cached for five minutes, allowing a later upload at the same key to take over. Non-image paths continue to return 404.

## Social previews

The home page includes Open Graph and Twitter Card metadata. Link previews on Discord, Slack, X, and similar services use `/og-image.png` (1200×630) with the Catbox logo.

If Discord keeps showing an older preview, re-post the URL or add a query string to bypass its cache.

## Themes

The header button toggles between **Classic (light)** and **Bootstrap (dark)**.

On a first visit the page follows the browser preference: a light color scheme uses Classic, and a dark one uses Bootstrap. The choice is applied before first paint and updates if the operating system switches while the page is open.

Clicking the toggle stores the chosen theme in the `catbox_theme` cookie and overrides the system preference. Append `?theme=auto` to the URL to clear that choice and follow the browser again. The additional **Dark** palette remains available with `?theme=dark`.

## Testing

```sh
npm run typecheck
npm run test:cli
```

`test:cli` runs the CLI integration tests against a local mock server; it needs `usage` on `PATH` (provided by `mise install`).

## License

[MIT](./LICENSE)
