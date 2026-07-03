// build/compositions.js — the vocabulary of photographic composition & technique
// used to categorise the collection by *how* a picture is made, not what it shows.
//
// Each entry:
//   key    — stable slug (URL / lookup / storage)
//   label  — display name
//   def    — one-line plain-English definition (shown above the results)
//   prompt — a descriptive scene emphasising the compositional trait, fed to
//            CLIP (text→image) and the e5 caption signal, exactly as the
//            emotions pipeline does.
//
// Consumed by build/embed-compositions.js.  Grouped loosely for readability;
// the group is not stored.

export const COMPOSITIONS = [
  // ── Framing & the placement of the subject ─────────────────────────────
  { key: 'rule-of-thirds', label: 'Rule of thirds',
    def: 'the subject placed a third of the way into the frame rather than dead centre.',
    prompt: 'a photograph composed on the rule of thirds, the main subject set off to one side along a third line, balanced empty space around it' },
  { key: 'centred', label: 'Centred composition',
    def: 'the subject placed squarely in the middle of the frame for a formal, symmetrical feel.',
    prompt: 'a symmetrical photograph with the subject placed dead centre of the frame, formal and balanced' },
  { key: 'fill-the-frame', label: 'Fill the frame',
    def: 'the subject enlarged to crowd out almost all background, leaving no empty space.',
    prompt: 'a tightly cropped photograph where the subject fills the entire frame edge to edge, no background visible' },
  { key: 'negative-space', label: 'Negative space',
    def: 'a small subject surrounded by large areas of empty sky, wall or ground.',
    prompt: 'a minimal photograph of a small lone subject surrounded by vast empty space, plain sky or blank wall' },
  { key: 'frame-within-a-frame', label: 'Frame within a frame',
    def: 'the subject seen through a doorway, window or arch that frames it.',
    prompt: 'a photograph looking through a doorway, window or archway that frames the subject beyond' },
  { key: 'rule-of-odds', label: 'Rule of odds',
    def: 'an odd number of subjects — often three — grouped for a pleasing arrangement.',
    prompt: 'a photograph of three subjects grouped together, an odd-numbered pleasing arrangement' },

  // ── Lines, geometry & perspective ──────────────────────────────────────
  { key: 'leading-lines', label: 'Leading lines',
    def: 'roads, rails or fences that draw the eye into the picture.',
    prompt: 'a photograph with strong leading lines, a road railway or fence receding and drawing the eye deep into the scene' },
  { key: 'vanishing-point', label: 'Vanishing point',
    def: 'parallel lines converging to a single point deep in the frame.',
    prompt: 'a one-point linear perspective photograph, parallel lines converging to a single distant vanishing point' },
  { key: 'diagonal', label: 'Diagonal composition',
    def: 'a dominant slanting line running corner to corner for energy.',
    prompt: 'a dynamic photograph built on a strong diagonal line running from one corner to another' },
  { key: 'symmetry', label: 'Symmetry',
    def: 'the two halves of the frame mirroring one another.',
    prompt: 'a perfectly symmetrical photograph, the left and right halves mirroring each other' },
  { key: 'pattern-repetition', label: 'Pattern & repetition',
    def: 'a repeating motif — windows, arches, crowds — filling the frame.',
    prompt: 'a photograph of a repeating pattern, rows of identical windows arches or shapes filling the frame' },
  { key: 's-curve', label: 'S-curve',
    def: 'a sinuous S-shaped line — a river or path — winding through the scene.',
    prompt: 'a photograph with a graceful S-shaped curve, a winding river road or path snaking through the landscape' },
  { key: 'triangular', label: 'Triangular composition',
    def: 'the main elements arranged into a stable triangle.',
    prompt: 'a photograph whose main elements form a stable triangular arrangement' },

  // ── Point of view & angle ──────────────────────────────────────────────
  { key: 'birds-eye', label: 'Bird’s-eye view',
    def: 'shot looking straight down from high above.',
    prompt: 'an aerial photograph looking straight down from high above, a bird’s-eye overhead view of the ground' },
  { key: 'low-angle', label: 'Low angle',
    def: 'the camera tilted up from below, making the subject loom.',
    prompt: 'a low-angle photograph shot from below looking up, the towering subject looming against the sky' },
  { key: 'eye-level', label: 'Eye level',
    def: 'a straight-on, neutral view at the subject’s own height.',
    prompt: 'a straight-on eye-level photograph, the camera level with the subject, neutral and direct' },
  { key: 'dutch-angle', label: 'Dutch angle',
    def: 'the camera deliberately tilted so the horizon slants.',
    prompt: 'a photograph with a tilted dutch angle, the horizon deliberately slanted and off-kilter' },
  { key: 'over-the-shoulder', label: 'Over the shoulder',
    def: 'shot past a figure’s shoulder into the scene they face.',
    prompt: 'a photograph taken over the shoulder of a person in the foreground, looking past them into the scene' },

  // ── Depth & focus ──────────────────────────────────────────────────────
  { key: 'shallow-focus', label: 'Shallow focus',
    def: 'a sharp subject against a soft, blurred background.',
    prompt: 'a photograph with shallow depth of field, the sharp subject standing out against a soft blurred bokeh background' },
  { key: 'deep-focus', label: 'Deep focus',
    def: 'everything sharp from the near foreground to the far distance.',
    prompt: 'a photograph with deep focus, everything sharp from the nearest foreground to the far horizon' },
  { key: 'layered-depth', label: 'Layered depth',
    def: 'distinct foreground, middle and background layers building depth.',
    prompt: 'a photograph with clear foreground, middle-ground and background layers receding to build a sense of depth' },
  { key: 'sense-of-scale', label: 'Sense of scale',
    def: 'a tiny figure set against something vast to show its size.',
    prompt: 'a photograph with a strong sense of scale, a tiny lone human figure dwarfed by a vast mountain building or landscape' },

  // ── Light & tone ───────────────────────────────────────────────────────
  { key: 'silhouette', label: 'Silhouette',
    def: 'a dark shape outlined against a bright background.',
    prompt: 'a silhouette photograph, a dark subject shape outlined black against a bright glowing sky or window' },
  { key: 'backlighting', label: 'Backlighting',
    def: 'light coming from behind the subject, rimming its edges.',
    prompt: 'a backlit photograph, light streaming from behind the subject and rimming its edges with a glowing halo' },
  { key: 'chiaroscuro', label: 'Chiaroscuro',
    def: 'bold contrast of deep shadow and bright highlight.',
    prompt: 'a dramatic chiaroscuro photograph, a subject emerging from deep black shadow into a single shaft of bright light' },
  { key: 'high-key', label: 'High key',
    def: 'a bright, airy image of pale tones and few shadows.',
    prompt: 'a bright high-key photograph, pale luminous tones, white and light grey, almost no shadows, airy and soft' },
  { key: 'low-key', label: 'Low key',
    def: 'a dark, moody image dominated by shadow.',
    prompt: 'a dark moody low-key photograph, mostly deep shadow and black with only small pools of light' },
  { key: 'golden-hour', label: 'Golden hour',
    def: 'warm, low, raking sunlight near sunrise or sunset.',
    prompt: 'a golden-hour photograph bathed in warm low raking sunlight, long shadows, amber glow of sunrise or sunset' },
  { key: 'atmospheric-haze', label: 'Atmospheric haze',
    def: 'fog, mist or smoke softening the distance.',
    prompt: 'a moody atmospheric photograph, fog mist or smoke softening the distance into pale layers' },

  // ── Motion, time & minimalism ──────────────────────────────────────────
  { key: 'motion-blur', label: 'Motion blur',
    def: 'a moving subject streaked and blurred by the exposure.',
    prompt: 'a photograph with motion blur, a moving subject streaked and smeared across the frame by a slow exposure' },
  { key: 'long-exposure', label: 'Long exposure',
    def: 'a slow exposure smoothing water or trailing light.',
    prompt: 'a long-exposure photograph, water blurred to silk, clouds streaked, lights trailing over time' },
  { key: 'minimalism', label: 'Minimalism',
    def: 'a spare image reduced to one or two simple elements.',
    prompt: 'a minimalist photograph reduced to one or two simple elements against a clean plain background, spare and quiet' },
  { key: 'juxtaposition', label: 'Juxtaposition',
    def: 'two contrasting things set side by side for effect.',
    prompt: 'a photograph of striking juxtaposition, two contrasting subjects — old and new, large and small — set side by side' },

  // ── Reflection, texture & vantage on the subject ───────────────────────
  { key: 'reflection', label: 'Reflection',
    def: 'the subject mirrored in water, glass or a puddle.',
    prompt: 'a photograph of a reflection, the subject mirrored in still water wet ground or a pane of glass' },
  { key: 'texture', label: 'Texture',
    def: 'a close study of surface — bark, stone, rust, weave.',
    prompt: 'a close photograph emphasising surface texture, the grain of bark stone rust or woven cloth filling the frame' },
  { key: 'close-up', label: 'Close-up',
    def: 'a tight, detailed view of a small subject or a face.',
    prompt: 'a close-up photograph, a tightly framed detailed view of a face or small object' },
  { key: 'wide-shot', label: 'Wide shot',
    def: 'a sweeping view taking in the whole scene and setting.',
    prompt: 'a wide establishing photograph, a sweeping panoramic view taking in an entire landscape or setting' },

  // ── Portrait & arrangement modes ───────────────────────────────────────
  { key: 'profile', label: 'Profile',
    def: 'a face or figure seen side-on in profile.',
    prompt: 'a profile photograph of a person seen side-on, the face turned to show its outline against the background' },
  { key: 'group-arrangement', label: 'Group arrangement',
    def: 'several people posed and arranged together in the frame.',
    prompt: 'a formally arranged group photograph, several people posed together and composed within the frame' },
  { key: 'environmental-portrait', label: 'Environmental portrait',
    def: 'a person shown within the place that defines them.',
    prompt: 'an environmental portrait, a person photographed within their workplace home or landscape that describes who they are' },
  { key: 'still-life', label: 'Still life',
    def: 'objects deliberately arranged and lit on a surface.',
    prompt: 'a still-life photograph, objects deliberately arranged and lit on a table or surface' },
  { key: 'flat-lay', label: 'Flat lay',
    def: 'objects laid out and shot straight down from above.',
    prompt: 'a flat-lay photograph, objects neatly laid out on a surface and photographed straight down from directly above' },
];
