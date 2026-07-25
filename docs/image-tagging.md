# Image tagging: what was done, how locally, and at what energy cost

*Retrospective of the tagging work, July 2026 (v1 calibration → v4 bulk tier).
Written for two questions: how much of this can be done on local hardware,
and how much power it consumed.*

## What was built

Starting point (early July): 104 hand-calibrated AI tags covering 36% of the
54,173 openly-licensed photographs, driven by a small SigLIP 2 model reading
480px thumbnails.

End state (17 July, live at photography.nextepisode.nz):

| layer | scale | provenance |
|---|---|---|
| Calibrated tags | 104 terms | human thresholds (July sheet), transferred by set-size onto the new model |
| Audited tags | 87 terms | cross-model agreement + blind 4-photo vision audit ≥0.75 precision |
| Broad-match tags | 809 terms | every remaining English candidate at the 15% floor, labelled "not yet calibrated" |
| **Total browsable** | **1,000 terms · 622k assignments · 92.2% of photos** | per-tier labels on every browse page |
| Photographed text | 11,957 transcripts | 8B vision model read signage/imprints; only transcripts ≥50% corroborated by the record's own metadata shipped; search now matches words painted inside photographs |
| Reserved for human review | 32 terms | all te reo / te ao Māori subjects + all ethnicity classifiers — deliberately never machine-shipped |

Supporting layers: 54k × 1152-dim SigLIP 2 embeddings, 54k structured
captions (scene type, people count, building type — including 221 wharenui
identified across the collection), and an agreement engine that scores every
candidate term by whether two independent models and Te Papa's own
cataloguing point the same way.

## How much ran locally: nearly all of it

Every model inference in the pipeline ran on one consumer laptop (MacBook,
M5, 32GB RAM) with open-weight models. No image ever left the machine for
ML processing; Te Papa's API was touched only for metadata harvests and the
one-time image downloads.

**Local (the entire ML pipeline):**
- Harvest + downloads: 54k records, 1.6GB thumbnails, 5.5GB 1000px previews (one-time, rate-limited, ~90 API calls per metadata pass)
- SigLIP 2 embeddings: `siglip2-so400m-patch16-384` int8 via transformers.js/ONNX — 2.3 img/s on CPU, 7.1h for the full collection
- All vocabulary scoring: 1,039 terms × 54k images ≈ 1 minute per full pass (the beauty of embeddings: score once, re-threshold forever, no re-inference)
- VLM captioning: `qwen3-vl:8b-instruct` via Ollama on the GPU — the big job, ~11.6 s/photo sustained, ~175 wall-hours
- Caption embeddings (e5-small), agreement engine, transcript validation, all data builds: minutes each

**Cloud (Claude) — judgment, not inference:**
- Model bake-off blind judging, the 101-term tag audit (399 photo judgments), code-review fleets, and the orchestration/writing. Roughly 15–25M tokens across the project. Two lessons: vision agents reading full-size previews cost ~50–60k tokens per judgment task and can drain a 5-hour subscription window in minutes; and every one of these judgment layers is *substitutable by the human review sheet*, which costs nothing. The cloud was a convenience for scale of verification — never a requirement of the pipeline.

**Human:** 111 verdicts in the July calibration sheet (~an evening), plus the
32 reserved terms pending. This remains the irreplaceable layer — and the
per-model verdict store means it's never overwritten.

**Institutional takeaway:** a GLAM institution could replicate this whole
pipeline on a single current laptop with no ML budget line: open-weight
models, ~7GB of derivative images on disk, about a week of background
compute, and curator hours only where judgment genuinely matters.

## Power consumption

No wall meter was attached, so these are estimates from Apple-silicon package
power under the observed loads (GPU inference ~35–50W whole-system on this
class of machine, CPU inference ~30–45W). Durations are measured.

| job | duration | est. draw | est. energy |
|---|---|---|---|
| VLM caption pass (54,172 previews, 8B model, GPU) | ~175 h awake | ~40 W | **~7.0 kWh** |
| so400m re-embed (54k, int8 CPU) | 7.1 h | ~40 W | ~0.3 kWh |
| Original base-256 embed + CLIP/e5 passes (July) | ~2 h | ~40 W | ~0.1 kWh |
| Model benchmark sweep + VLM bake-off runs | ~3 h | ~40 W | ~0.1 kWh |
| All scoring/agreement/build runs combined | ~1 h | ~40 W | ~0.05 kWh |
| **Total local ML compute** | | | **≈ 7.5 kWh** (range 6–9) |

For scale: ~7.5 kWh is roughly one load in a clothes dryer, about NZ$2.30 of
electricity at 30c/kWh, or 2–3 days of a household fridge. Per photograph:
**≈ 0.14 Wh** — about what a phone screen uses in a minute. The captioning
pass dominates (>90%); the embedding/tagging layer that powers most of the
search experience cost well under half a kilowatt-hour.

The cloud-side (Claude) energy cannot be measured from here; the honest
proxy is the token count above. Note the asymmetry: the *repeatable* pipeline
(re-embedding, re-scoring, re-thresholding) is all in the cheap local
column — the expensive layers were one-off verification.

If a future long run wants real numbers: `sudo powermetrics
--samplers cpu_power -i 60000` alongside the run, or a $20 plug meter.

## Operational lessons (for the next long run)

- Multi-day jobs: detach (`nohup … & disown`) under a supervisor loop —
  session-tracked tasks die with the session; `caffeinate -i` cannot hold a
  MacBook awake on battery; OS updates reboot through everything. The
  resumable-JSONL design meant zero data loss across five interruptions.
- Bound every network call: a request interrupted by sleep can hang a socket
  forever (observed: live process, 4.5h silent).
- Ollama tag traps: bare `qwen3-vl:*` tags are *thinking* builds that ignore
  `think:false` (~2.5k hidden tokens/image = 10× slower); use `-instruct`.
  transformers.js `q8` = uint8, which is broken for so400m exports — `int8`
  is the sound quantization, and it matched fp32 to 0.001 AUC.
- Trust nothing unmeasured: every model choice here traces to
  `build/benchmark-results.json`, `vlm-bakeoff*.json`, `vlm-judge-verdicts.json`
  and `audit-results.json` — all committed, all reproducible on the same
  seeded samples.
