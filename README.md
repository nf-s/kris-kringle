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

Characters live in one library shared by every event. The admin imports them from a folder
(`characters.json` plus the images it names); importing a name that already exists replaces that
character's image. Each event has its own ordered list of attached characters, saved separately
from the draw. Deleting a character removes it from every event.

On a reveal page the event's characters kneel in a ring round the object, praying. They switch
to wailing one at a time as task progress increases: the first at 8%, the last at 90%. They all
jig once the name is out.

After 0.75 seconds without task
activity, characters become sad in a fresh random order, with uneven 0.15–0.45 second gaps and
0.25 second fades. Tapping a visible figure toggles just that figure between sad and the happy
pose for current progress, until actual task activity resets the group. The object takes touch
priority. Automatic sadness starts only after task activity, pauses while the tab is hidden,
and stops once the reveal is complete. Visible characters remain tappable after completion.
Reduced motion keeps state changes without animated transitions.

They stand behind the object, so each reveal reports the space its object takes up
(`footprint`) and nobody is placed where it would cover their face; on a narrow screen the ring
turns squarer and the figures smaller until everyone fits. A reveal link only ever serves the
characters attached to its own event, and never their names. Previews at `/preview/<kind>` show
no characters.

On a phone each reveal can also be done by moving the phone: shake it for the snow globe, twist
it back and forth for the jack-in-the-box, rock it from side to side for the egg, and flick it
for the present and the cracker. Moving the phone is meant to take about as much effort as
touch: the handle turns no faster than a finger could turn it, rocking has to be a real swing
from side to side rather than a shake, and it takes several flicks to pull the ribbon out a
notch or tear the cracker, fewer the sharper they are. The hint under the object names both
ways once the phone is reporting its movement, and everything still works by touch alone. A
"Motion on / Motion off" button appears under the sound button on phones that report movement;
on an iPhone it starts off, and turning it on brings up the system's permission prompt.

The draw prefers one loop through the whole group. If exclusions rule that out it falls back to
smaller loops, and reports an error if no draw fits.

A client that requests 20 unknown links within 15 minutes is blocked for the rest of that window,
so links cannot be guessed by brute force.

## Storage

One Durable Object holds every event. The original event stays under its original storage key
(`event`, shown as event id `main`) and cannot be deleted. Other events are stored as
`event:<id>`. Each event's attached character ids are stored on the event (`characterIds`).

The character library is one list under `characters` (id, name, creation time, oldest first).
Each character's sprite sheet is stored under its own key, `character-image:<id>`, as its content
type and bytes.

## Admin password

The Worker reads the password from the `ADMIN_PASSWORD` secret.

- Local: `.dev.vars` (`ADMIN_PASSWORD=...`, not committed).
- Production: `npx wrangler secret put ADMIN_PASSWORD`.

## Commands

| Command             | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Local dev server (Vite + workerd)                                            |
| `npm test`          | Unit tests: draw, API, phone motion, cast state and placement, sprite import |
| `npm run typecheck` | TypeScript, front end and Worker                                             |
| `npm run format`    | Prettier                                                                     |
| `npm run deploy`    | Build and deploy to Cloudflare                                               |

## Layout

- `worker/` — API. `event.ts` holds the draw logic, `app.ts` the routes, `index.ts` the Durable
  Object, `words.ts` the link word lists, `rate-limit.ts` the link-guessing limit,
  `characters.ts` the character library and upload validation.
- `shared/schema.ts` — Zod schemas shared by the API and the front end.
- `src/admin/` — admin page. `exclusions.ts` is the exclusion grid, `activity.ts` the chart,
  `characters.ts` the character library and each event's character picker.
- `src/reveal/` — reveal page. `stage.ts` runs the canvas loop, `kinds/` has one file per reveal,
  `cast.ts` places and animates the characters, `cast-state.ts` controls pose and idle state,
  `motion.ts` reads the phone's own movement,
  `draw.ts` has the shared drawing helpers including the ink outline every object is drawn with.
- `src/characters/` — `import.ts` builds a character's sprite sheet in the browser from the
  imported artwork, `sprite.ts` draws one. A sheet is three rows (praying, wailing, sad) of three
  384×480 panels (body, head, parts in front of the head); the sizes are in `shared/schema.ts`.
  Old two-row sheets and manifests without a sad pose remain supported, using prayer as the
  fallback. Artwork stays in the character library rather than the source repository.
