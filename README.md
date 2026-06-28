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

- Editorial masthead and gallery layout in self-hosted **Fraunces**; warm "paper"
  light theme with a dark mode.
- Free-text search across the open photography set.
- A "ways in" line of curated subsets (documentary, art, New Zealand, Brake,
  historical).
- An index of significant New Zealand photographers with one-line blurbs and live
  counts.
- A masonry grid with wall-label captions, infinite scroll, and a full-screen
  lightbox linking each work's licence, download, and Te Papa record.

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

## Deployment

Built to deploy on **Vercel** (static `public/` + the `api/search.js` serverless
function). Set `TEPAPA_API_KEY` in the project's Environment Variables. Intended to
live at `photos.nextepisode.nz`.

---

Images and data © Museum of New Zealand Te Papa Tongarewa, supplied under the
licence shown on each work. This is an independent, unofficial project.
