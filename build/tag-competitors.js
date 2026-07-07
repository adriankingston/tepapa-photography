// build/tag-competitors.js — contrastive distractor prompts for confusable tags.
//
// Some visual categories sit too close for a plain threshold. The known case
// is wharenui: ornate carved wooden CHURCHES score >0.9 on it (probed
// 2026-07-05 — dark carved-timber interiors and steep gables read the same to
// the model), so no threshold can separate them. The fix is assign-to-argmax:
// build-tags.js scores each competitor prompt through the same template, and a
// photo keeps the tag only when the tag's own probability beats every
// competitor's.
//
// Keyed by term key (as in tag-candidates.json); terms without an entry are
// unaffected. Competitors are raw PROMPTS, not term keys — they don't have to
// be shipped tags themselves. Add an entry whenever calibration turns up a
// systematic confusion the threshold can't cut.
export const COMPETITORS = {
  wharenui: [
    'an ornate wooden church',
    'a wooden church with a steeple',
    'a church interior with carved pews and an altar',
  ],
};
