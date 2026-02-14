<div alt style="text-align: center; transform: scale(.5);">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tldraw/tldraw/main/assets/github-hero-dark.png" />
		<img alt="tldraw" src="https://raw.githubusercontent.com/tldraw/tldraw/main/assets/github-hero-light.png" />
	</picture>
</div>

This repo contains a template you can copy for using [tldraw](https://github.com/tldraw/tldraw) with the [Vite](https://vitejs.dev/) development environment.

## Local development

Install dependencies with `yarn` or `npm install`.

Run the development server with `yarn dev` or `npm run dev`.

Open `http://localhost:5173/` in your browser to see the app.

For **persistence** (drawings saved to MongoDB and optional Pusher sync), run the API server in another terminal:

```bash
npm run server
```

(Vite proxies `/api` to `http://localhost:5000` in development.)

## Deploying to Vercel

The app is set up for Vercel: the frontend is built with Vite and the API is implemented as serverless functions in `/api` (no need to run `server.js` on Vercel).

1. **Push to GitHub** and import the repo in [Vercel](https://vercel.com).
2. **Environment variables** (Project → Settings → Environment Variables). Add:
   - `MONGODB_URI` – MongoDB connection string (e.g. Atlas).
   - `PUSHER_APP_ID`, `PUSHER_SECRET`, `VITE_PUSHER_KEY`, `VITE_PUSHER_CLUSTER` – for real-time sync (optional; if missing, live sync is disabled but persistence still works).

   Use the same variable names so the build gets `VITE_*` and the serverless functions get the rest.
3. **Deploy.** Vercel will run `npm run build`, serve the `dist` output, and route `/api/drawing` and `/api/pusher-trigger` to the serverless handlers.

**Note:** Vercel has a ~4.5 MB request body limit per function. Very large canvas snapshots may need to stay under that (or use a paid plan with higher limits).

## License

This project is provided under the MIT license found [here](https://github.com/tldraw/vite-template/blob/main/LICENSE.md). The tldraw SDK is provided under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).

## Trademarks

Copyright (c) 2024-present tldraw Inc. The tldraw name and logo are trademarks of tldraw. Please see our [trademark guidelines](https://github.com/tldraw/tldraw/blob/main/TRADEMARKS.md) for info on acceptable usage.

## Distributions

You can find tldraw on npm [here](https://www.npmjs.com/package/@tldraw/tldraw?activeTab=versions).

## Contribution

Please see our [contributing guide](https://github.com/tldraw/tldraw/blob/main/CONTRIBUTING.md). Found a bug? Please [submit an issue](https://github.com/tldraw/tldraw/issues/new).

## Community

Have questions, comments or feedback? [Join our discord](https://discord.tldraw.com/?utm_source=github&utm_medium=readme&utm_campaign=sociallink). For the latest news and release notes, visit [tldraw.dev](https://tldraw.dev).

## Contact

Find us on Twitter/X at [@tldraw](https://twitter.com/tldraw).
