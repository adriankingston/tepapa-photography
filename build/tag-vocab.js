// build/tag-vocab.js — the curated tagging vocabulary for image classification.
//
// Every term must be CONCRETE and DEPICTABLE: something a vision model can see
// in the frame, tuned to what this collection actually holds (19th–20th c.
// Aotearoa New Zealand photography). No abstract concepts, no genres/formats
// (Te Papa's own cataloguing covers those), no dates/places/names (never let a
// model guess what the catalogue already knows).
//
//   key    — stable slug, used in tags.json / the client
//   label  — display form, museum-style plural where natural
//   prompt — the visual noun phrase scored by the model; the embed script
//            wraps it as "a black and white photograph of {prompt}."
//   group  — for the calibration review sheet + eventual browse UI
//
// Cultural note: the Māori-subject terms are standard descriptive terms Te Papa
// itself catalogues with. They carry the highest cost if mis-tagged, so the
// calibration pass should set their thresholds strictest of all.

export const GROUPS = {
  people: 'People & portraits',
  maori: 'Te ao Māori',
  rural: 'Rural life & farming',
  industry: 'Industry & work',
  transport: 'Rail & road',
  maritime: 'Ships & the sea',
  built: 'Towns & buildings',
  landscape: 'Landscape & nature',
  animals: 'Animals',
  events: 'Events & recreation',
  military: 'Military',
  disasters: 'Disasters & weather',
};

export const VOCAB = [
  // ---- People & portraits --------------------------------------------------
  { key: 'portrait-man', label: 'Portraits of men', prompt: 'a studio portrait of a man', group: 'people' },
  { key: 'portrait-woman', label: 'Portraits of women', prompt: 'a studio portrait of a woman', group: 'people' },
  { key: 'portrait-child', label: 'Portraits of children', prompt: 'a studio portrait of a child', group: 'people' },
  { key: 'family-group', label: 'Family groups', prompt: 'a posed family group portrait', group: 'people' },
  { key: 'couple', label: 'Couples', prompt: 'a posed portrait of a couple', group: 'people' },
  { key: 'baby', label: 'Babies', prompt: 'a baby in a christening gown or on a chair', group: 'people' },
  { key: 'wedding', label: 'Weddings', prompt: 'a bride in a wedding dress with a groom', group: 'people' },
  { key: 'elderly', label: 'Elderly people', prompt: 'a portrait of an elderly person with white hair', group: 'people' },
  { key: 'school-group', label: 'School groups', prompt: 'rows of schoolchildren posed for a class photograph', group: 'people' },
  { key: 'sports-team', label: 'Sports teams', prompt: 'a sports team posed in rows with a ball or trophy', group: 'people' },
  { key: 'brass-band', label: 'Brass bands', prompt: 'a brass band with instruments', group: 'people' },
  { key: 'nurse', label: 'Nurses', prompt: 'a nurse in uniform with a white apron and veil', group: 'people' },
  { key: 'clergy', label: 'Clergy', prompt: 'a clergyman in religious robes or a clerical collar', group: 'people' },
  { key: 'children-playing', label: 'Children playing', prompt: 'children playing outdoors', group: 'people' },
  { key: 'crowd', label: 'Crowds', prompt: 'a large crowd of people gathered outdoors', group: 'people' },
  { key: 'women-victorian-dress', label: 'Victorian & Edwardian dress', prompt: 'women in long Victorian dresses and hats', group: 'people' },
  { key: 'man-with-beard', label: 'Bearded men', prompt: 'a man with a long full beard', group: 'people' },
  { key: 'smoking-pipe', label: 'Pipe smokers', prompt: 'a man smoking a tobacco pipe', group: 'people' },

  // ---- Te ao Māori -----------------------------------------------------------
  { key: 'marae', label: 'Marae', prompt: 'a marae with carved buildings and an open courtyard', group: 'maori' },
  { key: 'wharenui', label: 'Wharenui', prompt: 'a Māori meeting house with carved gable and bargeboards', group: 'maori' },
  { key: 'whare', label: 'Whare', prompt: 'a traditional Māori raupo or timber dwelling', group: 'maori' },
  { key: 'pataka', label: 'Pātaka', prompt: 'a carved Māori storehouse raised on posts', group: 'maori' },
  { key: 'waka', label: 'Waka', prompt: 'a Māori canoe on water or shore', group: 'maori' },
  { key: 'carving', label: 'Whakairo (carving)', prompt: 'intricate Māori wood carving with spiral patterns', group: 'maori' },
  { key: 'korowai', label: 'Kākahu (cloaks)', prompt: 'a person wearing a woven Māori cloak', group: 'maori' },
  { key: 'moko', label: 'Tā moko', prompt: 'a Māori person with facial tā moko tattoo', group: 'maori' },
  { key: 'poi', label: 'Poi', prompt: 'Māori women performing with poi on strings', group: 'maori' },
  { key: 'kapa-haka', label: 'Kapa haka', prompt: 'a Māori cultural performance group in traditional dress', group: 'maori' },
  { key: 'weaving', label: 'Raranga (weaving)', prompt: 'woven flax baskets or mats', group: 'maori' },
  { key: 'hangi', label: 'Hāngī', prompt: 'people cooking food in an earth oven', group: 'maori' },
  { key: 'pa-site', label: 'Pā', prompt: 'a fortified hilltop settlement with terraces or palisades', group: 'maori' },

  // ---- Rural life & farming -------------------------------------------------
  { key: 'sheep', label: 'Sheep', prompt: 'a flock of sheep', group: 'rural' },
  { key: 'shearing', label: 'Sheep shearing', prompt: 'men shearing sheep inside a woolshed', group: 'rural' },
  { key: 'sheep-yards', label: 'Sheep yards', prompt: 'sheep penned in wooden stockyards', group: 'rural' },
  { key: 'wool-bales', label: 'Wool bales', prompt: 'large pressed wool bales stacked or on a wagon', group: 'rural' },
  { key: 'cattle', label: 'Cattle', prompt: 'cattle grazing or being driven', group: 'rural' },
  { key: 'dairy', label: 'Dairying', prompt: 'milking cows or milk cans at a dairy', group: 'rural' },
  { key: 'ploughing', label: 'Ploughing', prompt: 'a farmer ploughing a field with horses', group: 'rural' },
  { key: 'haymaking', label: 'Haymaking', prompt: 'workers stacking hay with pitchforks', group: 'rural' },
  { key: 'harvest', label: 'Harvesting', prompt: 'a harvest scene with sheaves of grain or a traction engine', group: 'rural' },
  { key: 'farmhouse', label: 'Farmhouses', prompt: 'an isolated farmhouse in open country', group: 'rural' },
  { key: 'orchard', label: 'Orchards', prompt: 'fruit trees in an orchard', group: 'rural' },
  { key: 'garden', label: 'Gardens', prompt: 'a cultivated flower or vegetable garden', group: 'rural' },
  { key: 'fencing', label: 'Fences', prompt: 'a post and wire or post and rail farm fence', group: 'rural' },
  { key: 'swagger', label: 'Swaggers', prompt: 'a man walking a country road carrying a swag', group: 'rural' },

  // ---- Industry & work --------------------------------------------------------
  { key: 'sawmill', label: 'Sawmills', prompt: 'a timber sawmill with stacked sawn timber', group: 'industry' },
  { key: 'logging', label: 'Logging', prompt: 'bushmen felling or hauling huge logs', group: 'industry' },
  { key: 'kauri-log', label: 'Kauri logs', prompt: 'an enormous log with men standing beside it for scale', group: 'industry' },
  { key: 'gold-mining', label: 'Gold mining', prompt: 'gold miners with sluices or a mine entrance', group: 'industry' },
  { key: 'gold-dredge', label: 'Gold dredges', prompt: 'a bucket dredge on a river', group: 'industry' },
  { key: 'coal-mining', label: 'Coal mining', prompt: 'coal miners or a colliery with coal wagons', group: 'industry' },
  { key: 'gum-digging', label: 'Gum digging', prompt: 'gum diggers with spades on scrubby ground', group: 'industry' },
  { key: 'flax-milling', label: 'Flax milling', prompt: 'workers with drying flax fibre at a flax mill', group: 'industry' },
  { key: 'freezing-works', label: 'Freezing works', prompt: 'a large meat freezing works building', group: 'industry' },
  { key: 'factory-interior', label: 'Factory interiors', prompt: 'workers at machines inside a factory', group: 'industry' },
  { key: 'blacksmith', label: 'Blacksmiths', prompt: 'a blacksmith at a forge or anvil', group: 'industry' },
  { key: 'workshop', label: 'Workshops', prompt: 'a workshop interior with tools and benches', group: 'industry' },
  { key: 'construction', label: 'Construction', prompt: 'a building under construction with scaffolding', group: 'industry' },
  { key: 'bridge-building', label: 'Bridge building', prompt: 'a bridge under construction', group: 'industry' },
  { key: 'road-building', label: 'Road building', prompt: 'workers building a road with picks and barrows', group: 'industry' },
  { key: 'surveyors', label: 'Surveyors', prompt: 'surveyors with a theodolite on a tripod', group: 'industry' },
  { key: 'shop-interior', label: 'Shop interiors', prompt: 'the interior of a shop with goods on shelves and a counter', group: 'industry' },
  { key: 'office', label: 'Offices', prompt: 'clerks at desks in an office', group: 'industry' },
  { key: 'printing', label: 'Printing', prompt: 'a printing press or compositors at type cases', group: 'industry' },
  { key: 'brewery', label: 'Breweries', prompt: 'a brewery with barrels', group: 'industry' },

  // ---- Rail & road -------------------------------------------------------------
  { key: 'steam-locomotive', label: 'Steam locomotives', prompt: 'a steam locomotive with smoke', group: 'transport' },
  { key: 'railway-station', label: 'Railway stations', prompt: 'a railway station platform with buildings', group: 'transport' },
  { key: 'railway-viaduct', label: 'Railway viaducts', prompt: 'a train crossing a tall viaduct', group: 'transport' },
  { key: 'tram', label: 'Trams', prompt: 'an electric or horse-drawn tram in a street', group: 'transport' },
  { key: 'horse-cart', label: 'Horse-drawn vehicles', prompt: 'a horse-drawn cart wagon or buggy', group: 'transport' },
  { key: 'coach', label: 'Coaches', prompt: 'a horse-drawn passenger coach', group: 'transport' },
  { key: 'bullock-team', label: 'Bullock teams', prompt: 'a team of bullocks hauling a load', group: 'transport' },
  { key: 'bicycle', label: 'Bicycles', prompt: 'a person with a bicycle', group: 'transport' },
  { key: 'motorcar', label: 'Motorcars', prompt: 'an early motorcar', group: 'transport' },
  { key: 'motorcycle', label: 'Motorcycles', prompt: 'a motorcycle with rider', group: 'transport' },
  { key: 'bus', label: 'Buses', prompt: 'a motor bus or charabanc', group: 'transport' },
  { key: 'aeroplane', label: 'Aeroplanes', prompt: 'an early aeroplane on the ground or in flight', group: 'transport' },

  // ---- Ships & the sea -----------------------------------------------------------
  { key: 'sailing-ship', label: 'Sailing ships', prompt: 'a sailing ship with masts and rigging', group: 'maritime' },
  { key: 'steamship', label: 'Steamships', prompt: 'a steamship with funnels', group: 'maritime' },
  { key: 'wharf', label: 'Wharves', prompt: 'ships berthed at a wharf with cargo', group: 'maritime' },
  { key: 'harbour', label: 'Harbours', prompt: 'a harbour with moored vessels', group: 'maritime' },
  { key: 'lighthouse', label: 'Lighthouses', prompt: 'a lighthouse on the coast', group: 'maritime' },
  { key: 'fishing-boat', label: 'Fishing boats', prompt: 'a small fishing boat with nets or catch', group: 'maritime' },
  { key: 'rowing-boat', label: 'Rowing boats', prompt: 'people in a small rowing boat', group: 'maritime' },
  { key: 'yacht', label: 'Yachts', prompt: 'a yacht under sail', group: 'maritime' },
  { key: 'ferry', label: 'Ferries', prompt: 'a passenger ferry crossing water', group: 'maritime' },
  { key: 'shipwreck', label: 'Shipwrecks', prompt: 'a wrecked ship aground or breaking up', group: 'maritime' },
  { key: 'ship-deck', label: 'On deck', prompt: 'passengers or crew on the deck of a ship', group: 'maritime' },
  { key: 'whaling', label: 'Whaling', prompt: 'a whale carcass or whaling station', group: 'maritime' },

  // ---- Towns & buildings ------------------------------------------------------------
  { key: 'city-street', label: 'City streets', prompt: 'a busy town street with shops and people', group: 'built' },
  { key: 'shopfront', label: 'Shopfronts', prompt: 'a shopfront with signage and window displays', group: 'built' },
  { key: 'hotel', label: 'Hotels', prompt: 'a hotel building with verandah and signage', group: 'built' },
  { key: 'church', label: 'Churches', prompt: 'a church with steeple or bell tower', group: 'built' },
  { key: 'wooden-villa', label: 'Villas & cottages', prompt: 'a wooden house with verandah and fretwork', group: 'built' },
  { key: 'public-building', label: 'Public buildings', prompt: 'a grand masonry public building with columns', group: 'built' },
  { key: 'bridge', label: 'Bridges', prompt: 'a road or foot bridge over a river', group: 'built' },
  { key: 'war-memorial', label: 'War memorials', prompt: 'a stone war memorial or cenotaph', group: 'built' },
  { key: 'monument', label: 'Monuments & statues', prompt: 'a statue or monument on a plinth', group: 'built' },
  { key: 'town-view', label: 'Town panoramas', prompt: 'a panoramic view over a town and its rooftops', group: 'built' },
  { key: 'house-interior', label: 'Domestic interiors', prompt: 'a furnished parlour or sitting room interior', group: 'built' },
  { key: 'band-rotunda', label: 'Band rotundas', prompt: 'an ornate band rotunda in a park', group: 'built' },
  { key: 'windmill', label: 'Windmills', prompt: 'a windmill with sails or wind pump', group: 'built' },
  { key: 'tent-camp', label: 'Camps & tents', prompt: 'canvas tents pitched at a camp', group: 'built' },

  // ---- Landscape & nature ---------------------------------------------------------------
  { key: 'mountain', label: 'Mountains', prompt: 'a high mountain peak', group: 'landscape' },
  { key: 'snow', label: 'Snow', prompt: 'a snow-covered landscape', group: 'landscape' },
  { key: 'glacier', label: 'Glaciers', prompt: 'a glacier with crevassed ice', group: 'landscape' },
  { key: 'lake', label: 'Lakes', prompt: 'a still lake with reflections', group: 'landscape' },
  { key: 'river', label: 'Rivers', prompt: 'a river running through a valley', group: 'landscape' },
  { key: 'waterfall', label: 'Waterfalls', prompt: 'a waterfall dropping over rocks', group: 'landscape' },
  { key: 'gorge', label: 'Gorges', prompt: 'a steep rocky gorge', group: 'landscape' },
  { key: 'beach', label: 'Beaches', prompt: 'a beach with surf', group: 'landscape' },
  { key: 'cliffs', label: 'Cliffs', prompt: 'coastal cliffs above the sea', group: 'landscape' },
  { key: 'cave', label: 'Caves', prompt: 'the mouth of a cave or people inside a cave', group: 'landscape' },
  { key: 'geyser', label: 'Geysers', prompt: 'a geyser erupting steam and water', group: 'landscape' },
  { key: 'thermal', label: 'Thermal areas', prompt: 'steaming hot springs and silica terraces', group: 'landscape' },
  { key: 'volcano', label: 'Volcanoes', prompt: 'a volcanic cone mountain', group: 'landscape' },
  { key: 'native-bush', label: 'Native bush', prompt: 'dense native forest', group: 'landscape' },
  { key: 'tree-ferns', label: 'Tree ferns', prompt: 'tall tree ferns with spreading fronds', group: 'landscape' },
  { key: 'big-tree', label: 'Giant trees', prompt: 'a giant tree trunk with people beside it for scale', group: 'landscape' },
  { key: 'waterfront-rocks', label: 'Rock formations', prompt: 'unusual rock formations', group: 'landscape' },
  { key: 'farmland', label: 'Farmland', prompt: 'rolling farmland with paddocks and fences', group: 'landscape' },
  { key: 'island', label: 'Islands', prompt: 'a small island offshore', group: 'landscape' },
  { key: 'sunset-sky', label: 'Dramatic skies', prompt: 'a dramatic sky with clouds over the horizon', group: 'landscape' },

  // ---- Animals ------------------------------------------------------------------------------
  { key: 'horse', label: 'Horses', prompt: 'a horse or horses', group: 'animals' },
  { key: 'dog', label: 'Dogs', prompt: 'a dog', group: 'animals' },
  { key: 'cat', label: 'Cats', prompt: 'a cat', group: 'animals' },
  { key: 'pigs', label: 'Pigs', prompt: 'pigs in a sty or paddock', group: 'animals' },
  { key: 'poultry', label: 'Poultry', prompt: 'chickens ducks or geese', group: 'animals' },
  { key: 'birds', label: 'Birds', prompt: 'wild birds', group: 'animals' },
  { key: 'seals', label: 'Seals', prompt: 'seals on rocks', group: 'animals' },
  { key: 'deer', label: 'Deer', prompt: 'deer or a hunter with antlers', group: 'animals' },

  // ---- Events & recreation ---------------------------------------------------------------------
  { key: 'parade', label: 'Parades & processions', prompt: 'a parade or procession in a street', group: 'events' },
  { key: 'rugby', label: 'Rugby', prompt: 'a rugby match in progress', group: 'events' },
  { key: 'cricket', label: 'Cricket', prompt: 'a cricket match with batsmen on a pitch', group: 'events' },
  { key: 'horse-racing', label: 'Horse racing', prompt: 'horses racing on a racecourse', group: 'events' },
  { key: 'regatta', label: 'Regattas', prompt: 'rowing or sailing races with spectators', group: 'events' },
  { key: 'athletics', label: 'Athletics', prompt: 'runners or field athletes competing', group: 'events' },
  { key: 'picnic', label: 'Picnics', prompt: 'a group picnicking on the grass', group: 'events' },
  { key: 'tramping', label: 'Tramping & climbing', prompt: 'climbers or trampers with packs and ice axes', group: 'events' },
  { key: 'hunting-fishing', label: 'Hunting & fishing', prompt: 'anglers with rods or hunters with game', group: 'events' },
  { key: 'swimming', label: 'Swimming & bathing', prompt: 'bathers in old-fashioned swimming costumes', group: 'events' },
  { key: 'agricultural-show', label: 'A&P shows', prompt: 'an agricultural show with livestock and crowds', group: 'events' },
  { key: 'exhibition', label: 'Exhibitions', prompt: 'grand exhibition halls or displays', group: 'events' },
  { key: 'circus', label: 'Circuses & fairs', prompt: 'a circus tent or fairground', group: 'events' },
  { key: 'theatre', label: 'Theatre & performance', prompt: 'performers in costume on a stage', group: 'events' },
  { key: 'golf-tennis', label: 'Golf & tennis', prompt: 'people playing golf or tennis', group: 'events' },
  { key: 'skiing', label: 'Skiing & skating', prompt: 'people skiing or ice skating', group: 'events' },

  // ---- Military -----------------------------------------------------------------------------------
  { key: 'soldiers', label: 'Soldiers', prompt: 'soldiers in military uniform', group: 'military' },
  { key: 'military-camp', label: 'Military camps', prompt: 'rows of army tents at a military camp', group: 'military' },
  { key: 'troops-marching', label: 'Troops marching', prompt: 'troops marching in formation', group: 'military' },
  { key: 'warship', label: 'Warships', prompt: 'a naval warship', group: 'military' },
  { key: 'artillery', label: 'Artillery', prompt: 'cannons or field guns with crews', group: 'military' },
  { key: 'troopship', label: 'Troopships', prompt: 'soldiers crowded on a departing ship', group: 'military' },

  // ---- Disasters & weather ---------------------------------------------------------------------------
  { key: 'flood', label: 'Floods', prompt: 'flood waters through streets or farmland', group: 'disasters' },
  { key: 'fire-damage', label: 'Fires', prompt: 'a burning building or smoking fire ruins', group: 'disasters' },
  { key: 'earthquake', label: 'Earthquake damage', prompt: 'collapsed buildings and rubble from an earthquake', group: 'disasters' },
  { key: 'eruption', label: 'Volcanic eruptions', prompt: 'an erupting volcano with ash cloud', group: 'disasters' },
  { key: 'storm-sea', label: 'Storms', prompt: 'storm waves breaking over a seawall', group: 'disasters' },
];

// sanity: unique keys, known groups
const seen = new Set();
for (const t of VOCAB) {
  if (seen.has(t.key)) throw new Error('duplicate key: ' + t.key);
  seen.add(t.key);
  if (!GROUPS[t.group]) throw new Error('unknown group: ' + t.group + ' on ' + t.key);
}
