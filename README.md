# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/burnfire1-ops/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/burnfire1-ops/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Teluk Cahaya — an original open-world crime game in the spirit of GTA 6, built for the make.fun gta6-01 bounty. A tropical coastal city to explore on foot and by car, with traffic and pedestrians, cars to steal, a wanted system and police, missions and a story, combat, a HUD with a minimap, a start and a save. Everything in it is original: the city, characters, vehicles, names, story, art, sound and music. No Rockstar Games content.

Playable offline in a desktop browser from static files: serve `game/` and open `game/index.html`.

## Build

`main.ts` (Node 22) hands the game in: it copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json`.
