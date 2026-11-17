# MyoOsteo

A small practice game for memorising bones and muscles. One structure on an
anatomical drawing is highlighted and you type its name. There is no score:
it is a tool for learning, not a test.

This is the first, minimal version: one region (the hand) with two separate
layers (bones, muscles) and two typing modes.

- **Hint mode** — the name is shown large, in pale grey, under the drawing. Each correctly typed letter turns white. When the whole name is
  typed, the app moves on.
- **Recall mode** — no hint. Type the name from memory (English or Latin,
  case and extra spaces do not matter) and press Enter. If it is wrong, the
  correct name is shown; press Enter again to continue.

On the settings screen you also choose the **order**: anatomical neighbours
(stored in the data, not in the code) or random. Every structure is asked
once per session; the last choice is remembered in the browser.

**Mistakes** are counted per structure and saved in the browser
(`localStorage`). A structure counts as a mistake when the recall answer is
wrong or, in hint mode, when any wrong letter was typed. "Repeat my mistakes"
asks only those structures; answering one right on the first try there
removes it from the list.

At the end of a session a **summary** shows how many structures were right on
the first try and lists the ones with mistakes, with **Again** and **Repeat
mistakes** buttons.

**Keyboard:** Esc returns to the settings menu; Tab moves through the
controls in screen order. A screen-reader live region announces each new
structure (in recall mode without its name, since that is the answer).

## Run

Requires Node.js 18 or newer.

```bash
npm install
npm start        # http://localhost:5173
npm test         # unit tests (Vitest + jsdom)
npm run build    # copies the static site into dist/
```

The page loads its data with `fetch`, so open it through `npm start` (any
static server works), not by double-clicking `index.html`.

## Deploy (Vercel)

`vercel.json` is ready: Vercel runs `npm test && npm run build` and serves
`dist/`. Import the GitHub repository at https://vercel.com/new, keep the
default settings, and click Deploy. Every push to `main` deploys again.

## Project layout

```
index.html            page shell (start screen + quiz screen)
src/quiz.js           quiz logic: loading, checking answers, order. No DOM.
src/ui.js             everything that touches the DOM
src/styles.css
data/regions.json     list of regions and their layers
data/<region>/<layer>.json
data/<region>/<layer>.svg
tests/quiz.test.js    unit tests for src/quiz.js
scripts/serve.js      tiny dev server used by npm start
scripts/build.js      copies the site into dist/ (used by Vercel)
vercel.json           Vercel build settings
```

## Data format

`data/<region>/<layer>.json`:

```json
{
  "region": "hand",
  "layer": "bones",
  "svg": "bones.svg",
  "start": "scaphoid",
  "items": [
    { "id": "scaphoid", "name": "Scaphoid", "latin": "Os scaphoideum", "svgId": "scaphoid", "next": "lunate" }
  ]
}
```

| field   | meaning |
| ------- | ------- |
| `id`    | unique id of the structure in this layer |
| `name`  | English name (what hint mode shows) |
| `latin` | Latin name (also accepted in recall mode) |
| `svgId` | `id` of the shape in the layer's SVG |
| `next`  | `id` of the anatomical neighbour that comes next |
| `start` | optional, the first item of a session |

The `next` links should form one loop through all items, so a session visits
every structure and never shows the same one twice in a row. The tests check
this for every layer listed in `regions.json`.

## Add a region (no code changes)

1. Create `data/<region>/` with one JSON file and one SVG per layer, e.g.
   `data/foot/bones.json` + `data/foot/bones.svg`.
2. In each SVG, give every quiz shape (a single shape or a `<g>` group) an
   `id` matching `svgId` and the class `structure`. Shapes with class
   `context` are drawn but never asked. The SVG keeps its own colours; the
   app only recolours the active structure.
3. Add the region to `data/regions.json`:
   ```json
   { "id": "foot", "name": "Foot", "layers": [{ "id": "bones", "name": "Bones" }] }
   ```
4. Run `npm test`: it validates the new files and checks that every `svgId`
   exists in the SVG.
5. Record the image source and licence in `ASSETS.md`.

## Licence

Code: MIT, see `LICENSE`. Images: see `ASSETS.md`.
