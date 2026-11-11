# Kris Kringle

Secret-gift draw with an interactive reveal for each person. Runs on Cloudflare Workers
(Hono API, one Durable Object for storage, static assets for the front end).

## How it works

- `/admin` — password protected. Add people, pick each person's reveal, draw names, copy links,
  see who has opened their link and (behind a toggle) who is buying for whom.
- `/r/<token>` — a person's private link. They have to open an object before the name is shown.
- `/preview/<kind>` — try a reveal with sample data. Kinds: `egg`, `jack`, `present`, `cracker`,
  `globe`.

Adding or removing people clears the draw. Redrawing keeps the same links.

## Admin password

The Worker reads the password from the `ADMIN_PASSWORD` secret.

- Local: `.dev.vars` (`ADMIN_PASSWORD=...`, not committed).
- Production: `npx wrangler secret put ADMIN_PASSWORD`.

## Commands

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `npm run dev`       | Local dev server (Vite + workerd) |
| `npm test`          | Unit tests for the draw logic     |
| `npm run typecheck` | TypeScript, front end and Worker  |
| `npm run format`    | Prettier                          |
| `npm run deploy`    | Build and deploy to Cloudflare    |

## Layout

- `worker/` — API. `event.ts` holds the draw logic, `app.ts` the routes, `index.ts` the Durable
  Object.
- `shared/schema.ts` — Zod schemas shared by the API and the front end.
- `src/admin/` — admin page.
- `src/reveal/` — reveal page. `stage.ts` runs the canvas loop, `kinds/` has one file per reveal.
