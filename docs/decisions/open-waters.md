# OpenWaters integration decision

## Decision

Use OpenWaters as a later MapLibre data and visualization layer, not as the authority that decides whether a simulated boat will collide.

## What survives requirement review

- Seascape raster DEM for depth shading, hillshade, and optional 3D seafloor terrain.
- Seascape vector depth areas, contours, spot soundings, and source-provenance coverage.
- Seamap seamarks, rocks, wrecks, obstructions, traffic schemes, restricted areas, and offshore infrastructure.
- A 2D/3D operator toggle. The default remains the clearest operational view after usability testing.
- Visible source attribution and a permanent “not for navigation” notice.
- A pinned, locally packaged San Pedro Bay dataset for the offline demo rather than a runtime dependency on public endpoints.

## What is deleted or deferred

- OpenWaters data is not collision truth.
- No autonomous rerouting or obstacle avoidance in the current simulation.
- No claim that 3D improves safety until an operator test demonstrates it.
- No live AIS, tides, or currents until the fixed-fleet mission flow and link-loss story work.
- No world-scale download for the regional demo.

## Collision boundary

Collision and hazard warnings belong in deterministic core functions operating on explicit inputs:

```text
boat state + predicted path + curated hazard geometry + safety margin
  -> clear | warning | violation
```

The first implementation should use a small, local, versioned set of San Pedro Bay hazard polygons and simulated vessel contacts. OpenWaters can supply visual context and may later contribute candidate geometry, but imported geometry must be normalized, versioned, and labeled with provenance before the core consumes it.

## Data responsibilities

```text
OpenWaters / local tile package
  -> visual depth, terrain, seamarks, chart context

Core collision functions
  -> deterministic distance/intersection calculations

Simulator
  -> authoritative simulated boat and contact positions

UI
  -> distinguishes contextual, predicted, and confirmed information
```

## Integration gate

Do not add MapLibre or OpenWaters dependencies before `stepBoat` and `stepFleet` pass their deterministic tests. When the map phase begins:

1. Load the published Seamap style as a disposable spike.
2. Add Seascape's Terrarium raster DEM as the terrain source.
3. Test one 2D/3D toggle with boat markers and labels.
4. Measure whether terrain obscures routes, labels, or hazards.
5. Pin the accepted San Pedro Bay assets locally.
6. Test a cold offline reload.
7. Preserve attribution from TileJSON and show “not for navigation.”

## Source caveats recorded

- Seascape depth data combines sources with varying resolution, age, and vertical datum.
- It does not account for current tide or water level.
- Gridded bathymetry can omit rocks, wrecks, obstructions, shoals, and aids to navigation.
- Seamap seamarks are crowd-sourced and may be incomplete, outdated, or wrong.
- Public visual data must never be presented as confirmed onboard perception.
