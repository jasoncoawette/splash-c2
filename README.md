# Splash C2

A deliberately small command-and-control demo for supervising autonomous boats.

The first vertical slice loads two valid boats, assigns a three-waypoint mission to one boat, advances it deterministically, and proves the other remains idle. Domain code stays independent of React, Redux, MapLibre, sockets, and wall-clock time.

The chart carries no chrome: there is no top bar, no readouts over the water, and the Mapbox badges are hidden. Sea indicators and live traffic both come from [Open Waters](https://openwaters.io), neither of which needs an API key — [Seamap](https://tiles.openwaters.io/seamap/tiles.json) vector tiles for seamarks, lights and hazards, and [Open Waters AIS](https://ais.openwaters.io/v1/vessels/tiles.json) for real vessel positions, refreshed on the service's own 15 second cadence.

Clicking the chart drops the objective pin, which stays on the water rather than following the camera. Clicking a contact targets it instead, and the selection can then escort or monitor it: each boat is given a station in the target's frame, re-planned every tick, so a screen holds on a ship that is under way. "Raise perimeter" rings the objective with the selection; dragging the ring's centre or its rim re-plans the same missions in place rather than issuing new ones.

Both services are CC-BY and neither is for navigation. Hiding the Mapbox wordmark and attribution is a licensing decision, not a technical one — restore both, and credit Open Waters, before any public deployment.

The screen has two views. **Fleet** is the chart: a Mapbox GL map carrying procedural Three.js hulls, the route of every tasked boat, and one rail at the top of the chart. The rail carries the chart tools, and grows to carry the orders for the selection the moment there is one, so giving an order never means leaving the chart or chasing a bar around the water. A selection can be routed to one of five mission patterns around the objective. **Front view** is the helm of one boat, and it looks at the same chart the fleet view does — tipped over onto the water. The Standard basemap draws the land, the Mapbox DEM is displaced in 3D so the shore stands up and hides what is behind it, and the Open Waters layers come with it: depth areas, isobaths, soundings, seamarks and live AIS hulls, all in perspective. Only the boats are drawn by us, through the same custom layer the fleet chart uses, so a hull looks like itself in both views. A heading tape, propulsion, route and instrument panels sit over the top. Taking over hands the throttle and rudder to the operator while the boat keeps its mission, so releasing the helm resumes the route.

The current operations screen includes a Mapbox GL map, procedural Three.js Typhoon models, a synchronized boat grid, and immutable in-browser boat creation. Boats are selected and moved as a group on the chart: shift-drag over open water draws a marquee (hold alt to add to the selection), dragging any selected hull or the group anchor moves the whole group by the same screen offset, escape cancels a drag, and links from the anchor to each hull show what is moving together. The console is one chart with two panels over it — the fleet down the left, the selected vessel down the right — each collapsing on its own handle to clear the chart. A selected hull wears the objective's orange, the same colour as the pin and the route legs between them, so the boat in hand and the place it is being sent read as one thought. Taking a boat opens the helm: its own hull in 3D with contacts drawn at their true bearing and aspect, the leg to the next waypoint, speed, limit, charge and mode in the top-left cluster, and a course-up chart in the corner. Four camera stations — chase, aft, mast and bow — look at the same scene. Without a token, the map uses its built-in local tactical style. To enable Mapbox chart tiles:

```bash
cp .env.example .env.local
```

Then replace the placeholder in `.env.local` with a public Mapbox token and restart `pnpm dev`.

Read [REQUIREMENTS.md](./REQUIREMENTS.md) before adding a feature. Requirements are questioned and deleted before the surviving design is simplified, accelerated, and automated.

## Deploying

The repo ships a `Dockerfile`, which is all Railway needs: point a service at
this repo and it builds the image rather than guessing a buildpack.

```bash
docker build -t splash-c2 .
docker run --rm -p 3000:3000 splash-c2
```

Three things are worth knowing before the first deploy.

`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is baked into the client bundle **at build
time**, not read at boot — that is what the `NEXT_PUBLIC_` prefix means. Set it
as a Railway service variable so the build receives it; the Dockerfile declares
the matching `ARG`. Set it only as a runtime variable and the deploy will come
up with the local tactical style instead of Mapbox tiles, with no error to
explain why.

`PORT` is injected by Railway and read by the server; `HOSTNAME` is pinned to
`0.0.0.0` in the image, because a server bound to localhost is unreachable from
the proxy in front of it.

The build emits Next's standalone output (`output: "standalone"` in
`next.config.ts`), so the runtime stage carries the server and the traced
modules only — no pnpm, no sources, no dev dependencies.

## Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm verify
```

The test command intentionally uses Node's built-in runner and TypeScript stripping. The current core tests do not justify a browser test environment or additional testing dependencies.
