# Map ideas

Proposals for the saga map (components/map/SagaMap.tsx). Ordered by cost.

## Implemented now (no engine change)

1. **Signposts every 10 levels.** A wooden sign beside the path shows the level's title (from levelConfig). Gives the long road landmarks and tells the player what is coming. Pure map rendering.
2. **Seasonal sky.** The calendar month picks a sky dressing: Oct-Nov "Harvest Moon" (orange moon), Dec-Jan "First Snow" (snowfall). Visual only, no rewards, so nothing on the server changes. Hidden on `data-gfx='low'`.

Also in place: boss node every 50 levels (crown, red ring), reward chest every 25 (opens once cleared), 1-3 stars under cleared nodes (read from `localStorage.bb_stars`, see report), mascot that walks from the last level seen to the new one after a win.

## Extra biomes / themes (the 8 themes repeat every 8 acts today)

- **Candy Quarry** — pastel rock and sugar-crystal blocks; on brand for a match game.
- **Storm Spire** — floating rock in a thunderstorm, lightning flashes as ambient.
- **Clockwork Works** — brass gears turning in the midground layer.
- **Lantern Bay** — night harbour, floating lanterns, water reflections.
- **Moon Orchard** — silver trees, slow-falling petals.
- Rotation of 13 themes instead of 8 makes the repeat period 13 acts, so the
  same theme is far less noticeable across 1,000 acts. Each theme needs only a
  `Biome` entry plus a shape type in `sagaLayout.SHAPE`.

## Seasonal events

- Harvest Moon (Oct), First Snow (Dec), Lunar New Year lanterns (Feb), Ramadan night sky with crescent (dates vary), Independence Day 17 Aug red-white bunting (Indonesia), summer beach week.
- Event week path: a short side-branch of 20 event levels off the main path, with its own map tint. Needs a level source, so it is an engine/content change.

## Level variety (needs engine work unless noted)

- **Ice blocks**: a cell takes two clears; first clear cracks the ice.
- **Bombs with a countdown**: clear before N moves pass or the run ends.
- **Locked cells / chains**: a cell cannot move until a neighbour is cleared.
- **Goal types**: collect N of one block, clear all ice, bring an item to the bottom row, reach score in N moves, survive N moves.
- **Spreading hazard** (moss, lava): grows one cell per move if not cleared.
- **Portals**: pieces leaving one column enter another.
- **Hard / super-hard tags** on the map node (purple / red ring) — map-only once the level generator exposes a difficulty flag.

## Map polish next

- Short path "unlock" sparkle when the next node opens.
- Friend avatars on the nodes they reached (needs a friends API).
- Per-act gateway set piece (gate, bridge) at the top of each act.
