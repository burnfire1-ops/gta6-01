# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/burnfire1-ops/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/burnfire1-ops/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Teluk Cahaya — an original open-world crime game in the spirit of GTA 6, built for the make.fun gta6-01 bounty. A tropical coastal city to explore on foot and by car, with traffic and pedestrians, cars to steal, a wanted system and police, missions and a story, combat, a HUD with a minimap, a start and a save. Everything in it is original: the city, characters, vehicles, names, story, art, sound and music. No Rockstar Games content.

Round 5 adds to the city: Cahaya Plaza mall, the Taman Ria ferris wheel on the beachfront, RS Teluk Cahaya hospital, two street gangs (Geng Dermaga and Anak Neon), three new delivery missions, a cinematic title screen over the golden-hour city, and a coloured big map with street names and a legend.

Playable offline in a desktop browser from static files: serve `game/` and open `game/index.html`.

## How to play

You are Raka, a freelance courier in Teluk Cahaya, a fictional tropical coastal city with four districts (Boulevard, Neon District, Port & Industry, Residential Hills). Walk the streets or drive: enter your teal sport car with **F**, steal locked cars by holding **F** — but only when nobody is watching.

- **WASD** move · **mouse** orbit camera · **Shift** run · **Space** jump / handbrake
- **F** interact / enter-exit car · **LMB** punch / shoot · **RMB** aim · **R** reload · **M** map · **Esc** pause
- **Wanted 1–5, witness-based**: the police only come when a cop sees you or a witness reports you (2 s). Lose them by hiding (6/10/15 s by stars), swapping cars in a quiet place, stopping in an alley, or paying for a respray. The safehouse clears 1–2 stars. Getting caught (BUSTED) or knocked out (WASTED) costs a fine — never game over.
- **11 story missions** from the courier office: deliveries, a car theft, your first wanted level, a night run through the Neon District, a car chase, a warehouse brawl, a timed three-stop convoy, and a cross-city escape. Fail a mission and you restart at its checkpoint with a small fine.
- **Combat**: fists plus one pistol (soft lock-on, ammo refills at the safehouse), and ramming with cars. No shooting from cars.
- **HUD + minimap** drawn from the same road graph the AI drives on (mission marker, police dots, search circle, hidden packages), menus, and versioned saves in localStorage (3 slots + autosave on mission complete / safehouse entry).
- **Synthesized audio**: adaptive music (Web Audio, no audio files) that tenses up with your wanted level, sirens, engine and city ambience. Day/night cycle ~12 minutes; traffic density follows the clock.

## Build

`main.ts` (Node 22) hands the game in: it copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json`.

Rebuild notes: the title-screen buttons (New Game, Continue, Resume, Quit) are wired synchronously at boot in `game/src/main.js`, so the menu responds even before the gameplay slices finish loading. The night screenshot is framed down the z=-200 neon avenue, facing away from the 64-unit glass tower, so the car and the street read clearly at night.
