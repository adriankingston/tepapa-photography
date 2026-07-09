// build/vlm-prompt.js — THE prompt + output schema for the VLM caption pass.
// Shared by benchmark-vlm.js (the bake-off that validated it) and
// caption-previews.js (the production run), so what ships is provably what
// was measured. v2, validated 2026-07-09: zero place/date leakage on the
// bait sample for 4b/8b; wharenui classification unlocked by Exception 2;
// visible_text gives transcription a sanctioned outlet (LOW TRUST — both
// models garble old inscriptions; cross-validate before surfacing).
export const PROMPT = `Describe this historical photograph for a museum search index.

STRICT RULES — this is a test of restraint:
- Describe ONLY what is visible in the image itself.
- In the caption and objects, NEVER name places, regions, buildings, mountains, people, iwi, or events — even if the scene looks famous or familiar to you. NEVER guess dates, decades, or eras.
- Exception 1: if words are printed or written ON the photograph, its mount, or objects in it, transcribe them EXACTLY (and only exactly) in visible_text. Names are allowed there because they are visible, not guessed. Use "" if there is no text.
- Exception 2: building_type is a CLASSIFICATION, not a naming — always pick the best-fitting category. Choose "wharenui (Maori meeting house)" whenever a building shows carved bargeboards, carved entrance posts, or a carved gable figure; that is a generic building category like "church", not an identification.
- If you are not sure something is present, leave it out. Silence is better than a guess.

Return JSON: a one-to-two sentence caption; the concrete visible objects (lowercase, singular); any visible text; the scene type; how many people; and the building type if any building is prominent.`;

export const SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    objects: { type: 'array', items: { type: 'string' } },
    visible_text: { type: 'string' },
    scene: { type: 'string', enum: ['portrait', 'landscape', 'street', 'interior', 'marine', 'architecture', 'group of people', 'other'] },
    people: { type: 'string', enum: ['none', 'one', 'two', 'small group', 'crowd'] },
    building_type: { type: 'string', enum: ['none', 'church', 'wharenui (Maori meeting house)', 'house', 'commercial', 'industrial', 'other building'] },
  },
  required: ['caption', 'objects', 'visible_text', 'scene', 'people', 'building_type'],
};
