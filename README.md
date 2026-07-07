# Te Papa Photographs

An editorial, typographic browser for the **openly-licensed** photographs in the
Museum of New Zealand Te Papa Tongarewa collection — every image shown is free to
download and reuse.

It reads the [Te Papa Collections API](https://data.tepapa.govt.nz/) live, drawing
from the pool of photographs that are *not* "All Rights Reserved":

```
collection:"Photography" AND hasRepresentation.rights.allowsDownload:true
```

filtered to `type:Object` (~54,000 records). A record qualifies if it has at least
one downloadable image, and the page only ever displays that openly-licensed image
(a qualifying record can still carry an All-Rights-Reserved plate alongside it).

## Features

- Editorial masthead and gallery layout in self-hosted **Fraunces**, **Archivo**
  and **Tourney**; warm "paper" light theme with a dark mode (shared with the
  sibling collections browser).
- Free-text search across the open photography set.
- Three "ways in" marquees — curated subjects, the 154 emotions of *The Book of
  Human Emotions*, and photographic composition & technique terms — the latter
  two matched by CLIP + text embeddings baked offline in `build/`.
- A decade filter (year each photograph was taken) that composes with every
  other browse mode.
- AI image tags: a curated vocabulary scored against every photograph with
  SigLIP 2, each shipped term individually human-calibrated
  (`build/tag-verdicts.json`); searchable, browsable, and shown as clearly
  labelled "Suggested from the image (AI)" chips in the detail view.
- A masonry grid with wall-label captions and infinite scroll.
- A full-screen record view with IIIF deep zoom (OpenSeadragon against Te Papa's
  image server), rich catalogue metadata (description, subjects, credit line),
  and each work's licence, download, and Te Papa record links.

In-copyright photographers (e.g. Ans Westra) and the famous international names are
deliberately absent — their work is not openly licensed, so it falls outside this
set.

## Running locally

1. `cp .env.example .env` and add your Te Papa API key
   ([register free](https://data.tepapa.govt.nz/docs/register.html)).
2. `npm start`
3. Open <http://localhost:4500>.

The zero-dependency Node server serves `public/` and proxies the API (injecting the
`x-api-key` server-side, since the API has no CORS). In production each file under
`api/` runs as its own serverless function.

## Data pipeline (offline)

Everything under `build/` runs locally (Node + transformers.js, CPU only) and
bakes the committed files in `public/data/`. Shared plumbing — API access, the
id-range enumeration that dodges the API's ~50k paging cap, and the record-set
stamp — lives in `build/lib.js`. Run order:

1. `node build/harvest.js` — every openly-licensed photography record →
   `build/records.json` + `public/data/index.json`, plus the record-set stamp
   (`build/set-stamp.json`). Every later step verifies its inputs against the
   stamp, so a re-harvest can never silently misalign the derived artifacts.
2. `node build/download-thumbs.js` — thumbnails to disk, resumable
   (`download-previews.js` fetches the 1000px derivatives for VLM work).
3. `node build/embed-clip.js` + `embed-text.js` — CLIP and e5 embeddings, then
   `embed-emotions.js` / `embed-compositions.js` for the two baked marquees.
4. `node build/embed-siglip2.js` — SigLIP 2 image embeddings for the tag layer;
   `score-tags.js` scores the candidate vocabulary; `tag-review-sheet.js` makes
   the in-browser calibration sheet (export verdicts to `build/tag-verdicts.json`);
   `build-tags.js` ships the calibrated terms (`tag-competitors.js` holds
   contrastive prompts for confusable ones).
5. `node build/build-shards.js` — split the index into `public/data/decade/` and
   `public/data/tag/` files (deriving `decades-index.json`), so the client only
   downloads the slice it's browsing.

## Deployment

Built to deploy on **Vercel** (static `public/` + the `api/search.js` serverless
function). Set `TEPAPA_API_KEY` in the project's Environment Variables. Intended to
live at `photography.nextepisode.nz`.

---

Images and data © Museum of New Zealand Te Papa Tongarewa, supplied under the
licence shown on each work. This is an independent, unofficial project.
