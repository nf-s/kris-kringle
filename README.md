# Kris Kringle

Secret-gift draw with an interactive reveal for each person. Runs on Cloudflare Workers
(Hono API, one Durable Object for storage, static assets for the front end).

## How it works

- `/admin` — password protected. Create events, add people, pick each person's reveal, set
  exclusions, draw names, copy links, and see who has opened their link over time. Assignments are
  behind a toggle.
- `/r/<link>` — a person's private link. They have to open an object before the name is shown. New
  links look like `lilac-magpie-nick`: two random words then the person's first name. Links made
  before this format keep working unchanged.
- `/r/<link>?preview` — the same page without recording a view or reveal. The admin's Preview links
  use this once names are drawn.
- `/preview/<kind>` — try a reveal with sample data. Kinds: `egg`, `jack`, `present`, `cracker`,
  `globe`.

Adding or removing people clears the draw. Redrawing keeps the same links. Saving exclusions only
clears the draw if it gives someone a person they are now excluded from.

The draw prefers one loop through the whole group. If exclusions rule that out it falls back to
smaller loops, and reports an error if no draw fits.

A client that requests 20 unknown links within 15 minutes is blocked for the rest of that window,
so links cannot be guessed by brute force.

## Storage

One Durable Object holds every event. The original event stays under its original storage key
(`event`, shown as event id `main`) and cannot be deleted. Other events are stored as
`event:<id>`.

## Admin password

The Worker reads the password from the `ADMIN_PASSWORD` secret.

- Local: `.dev.vars` (`ADMIN_PASSWORD=...`, not committed).
- Production: `npx wrangler secret put ADMIN_PASSWORD`.

## Commands

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `npm run dev`       | Local dev server (Vite + workerd) |
| `npm test`          | Unit tests for the draw and API   |
| `npm run typecheck` | TypeScript, front end and Worker  |
| `npm run format`    | Prettier                          |
| `npm run deploy`    | Build and deploy to Cloudflare    |

## Layout

- `worker/` — API. `event.ts` holds the draw logic, `app.ts` the routes, `index.ts` the Durable
  Object, `words.ts` the link word lists, `rate-limit.ts` the link-guessing limit.
- `shared/schema.ts` — Zod schemas shared by the API and the front end.
- `src/admin/` — admin page. `exclusions.ts` is the exclusion grid, `activity.ts` the chart.
- `src/reveal/` — reveal page. `stage.ts` runs the canvas loop, `kinds/` has one file per reveal.
