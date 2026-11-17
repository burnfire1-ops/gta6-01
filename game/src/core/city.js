// Teluk Cahaya road graph: the single source of truth for AI, minimap and
// missions. Grid of streets every 40 units, 13x13 intersections, 4 districts
// by quadrant. Pure, no three.js. Deterministic from the seed.
import { makeRng } from './rng.js';

export const GRID_N = 13;
export const SPACING = 40;
export const HALF = 240; // city extends -240..240 on x and z

export function nodeId(ix, iz) { return iz * GRID_N + ix; }
export function nodeCoords(id) {
  const ix = id % GRID_N, iz = Math.floor(id / GRID_N);
  return { x: -HALF + ix * SPACING, z: -HALF + iz * SPACING, ix, iz };
}
export function nodeIndexAt(x, z) {
  const ix = Math.round((x + HALF) / SPACING);
  const iz = Math.round((z + HALF) / SPACING);
  return { ix: Math.max(0, Math.min(GRID_N - 1, ix)), iz: Math.max(0, Math.min(GRID_N - 1, iz)) };
}
export function nearestNodeId(x, z) {
  const { ix, iz } = nodeIndexAt(x, z);
  return nodeId(ix, iz);
}

export function districtAt(x, z) {
  if (x < 0 && z < 0) return 'boulevard';
  if (x >= 0 && z < 0) return 'neon';
  if (x < 0 && z >= 0) return 'port';
  return 'residential';
}

const DISTRICT_HEIGHT = {
  boulevard: [6, 14], neon: [10, 28], port: [5, 10], residential: [5, 9],
};
const DISTRICT_COLORS = {
  boulevard: [0xf2a0a0, 0xf7c8a0, 0xf2d8a0, 0xe8b4c8],
  neon: [0x7fd4d4, 0x5fb8c8, 0x9adfe0, 0x6aa8d8],
  port: [0xb8a890, 0x9a8a78, 0xc0b098, 0x8a7a68],
  residential: [0xf2c8c8, 0xd8e8f2, 0xf7e8c8, 0xe8d8c8],
};

function segmentHitsAABB(x0, z0, x1, z1, b) {
  // 2D slab test: does segment (x0,z0)-(x1,z1) hit AABB b?
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < b.minX || x0 > b.maxX) return false;
  } else {
    let t1 = (b.minX - x0) / dx, t2 = (b.maxX - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < b.minZ || z0 > b.maxZ) return false;
  } else {
    let t1 = (b.minZ - z0) / dz, t2 = (b.maxZ - z0) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

export function createCity(seed) {
  const rng = makeRng(seed);
  const nodes = [];
  for (let iz = 0; iz < GRID_N; iz++) {
    for (let ix = 0; ix < GRID_N; ix++) {
      const x = -HALF + ix * SPACING, z = -HALF + iz * SPACING;
      nodes.push({ id: nodeId(ix, iz), x, z, ix, iz, district: districtAt(x, z) });
    }
  }
  // 4-neighbour edges.
  const edges = new Map();
  for (const n of nodes) {
    const list = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const ix = n.ix + dx, iz = n.iz + dz;
      if (ix < 0 || ix >= GRID_N || iz < 0 || iz >= GRID_N) continue;
      list.push({ to: nodeId(ix, iz), len: SPACING });
    }
    edges.set(n.id, list);
  }

  // Blocks (12x12) between intersections; each block holds 1-3 buildings.
  // Two open lots stay clear: the start plaza and the port warehouse yard.
  const openBlocks = new Set(['-20,-20', '-180,180']);
  const blocks = [];
  const buildings = [];
  for (let bz = -HALF; bz < HALF; bz += SPACING) {
    for (let bx = -HALF; bx < HALF; bx += SPACING) {
      const cx = bx + SPACING / 2, cz = bz + SPACING / 2;
      const district = districtAt(cx, cz);
      const block = { cx, cz, district, buildings: [] };
      blocks.push(block);
      if (openBlocks.has(`${cx},${cz}`)) continue;
      const count = rng.int(1, 3);
      for (let i = 0; i < count; i++) {
        const [hMin, hMax] = DISTRICT_HEIGHT[district];
        const w = rng.range(8, 15), d = rng.range(8, 15);
        const h = rng.range(hMin, hMax);
        const ox = rng.range(-8, 8), oz = rng.range(-8, 8);
        const x = cx + ox, z = cz + oz;
        const b = {
          x, z, w, d, h, district,
          color: rng.pick(DISTRICT_COLORS[district]),
          glass: district === 'neon' && rng.chance(0.35),
          minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
        };
        block.buildings.push(b);
        buildings.push(b);
      }
    }
  }
  // The tallest glass tower: neon district landmark.
  const tower = {
    x: 200, z: -200, w: 22, d: 22, h: 64, district: 'neon',
    color: 0x5fb8c8, glass: true, landmark: true,
    minX: 189, maxX: 211, minZ: -211, maxZ: -189,
  };
  buildings.push(tower);

  // Points of interest.
  const pois = {
    safehouse: { x: -180, z: -200, node: nearestNodeId(-180, -200) },
    garage: { x: -120, z: -200, node: nearestNodeId(-120, -200) },
    missionGiver: { x: -160, z: -196, node: nearestNodeId(-160, -200) },
    portWarehouse: { x: -180, z: 180, node: nearestNodeId(-180, 180) },
    neonCenter: { x: 200, z: -200, node: nearestNodeId(200, -200) },
    policeStation: { x: 160, z: 160, node: nearestNodeId(160, 160) },
    paintShop: { x: 200, z: -120, node: nearestNodeId(200, -120) },
    lighthouse: { x: -268, z: -268 },
  };
  // Hidden packages: 12 block corners, deterministic.
  const packages = [];
  for (let i = 0; i < 12; i++) {
    const bx = rng.int(0, 11), bz = rng.int(0, 11);
    packages.push({
      id: i, x: -HALF + bx * SPACING + 32, z: -HALF + bz * SPACING + 32,
      found: false,
    });
  }

  // Traffic lights at major intersections (every 80 units).
  const trafficLights = [];
  for (const n of nodes) {
    if (n.ix % 2 === 0 && n.iz % 2 === 0) {
      trafficLights.push({ nodeId: n.id, offset: ((n.ix + n.iz) % 4) * 3, period: 12 });
    }
  }

  const city = { seed, nodes, edges, blocks, buildings, pois, packages, trafficLights };

  city.astar = function astar(fromId, toId) {
    if (fromId === toId) return [fromId];
    const open = [{ id: fromId, g: 0, f: 0, parent: -1 }];
    const came = new Map([[fromId, -1]]);
    const gScore = new Map([[fromId, 0]]);
    const closed = new Set();
    const target = nodeCoords(toId);
    while (open.length > 0) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.id === toId) {
        const path = [toId];
        let p = came.get(toId);
        while (p !== -1 && p !== undefined) { path.unshift(p); p = came.get(p); }
        return path;
      }
      closed.add(cur.id);
      const c = nodeCoords(cur.id);
      for (const e of edges.get(cur.id)) {
        if (closed.has(e.to)) continue;
        const g = gScore.get(cur.id) + e.len;
        if (g < (gScore.get(e.to) ?? Infinity)) {
          gScore.set(e.to, g);
          came.set(e.to, cur.id);
          const t = nodeCoords(e.to);
          const h = Math.hypot(t.x - target.x, t.z - target.z);
          open.push({ id: e.to, g, f: g + h, parent: cur.id });
        }
      }
    }
    return [fromId];
  };

  city.randomRoute = function randomRoute(rngObj, fromId) {
    const to = rngObj.int(0, nodes.length - 1);
    return city.astar(fromId, to);
  };

  city.segmentBlocked = function segmentBlocked(x0, z0, x1, z1) {
    for (const b of buildings) {
      if (segmentHitsAABB(x0, z0, x1, z1, b)) return true;
    }
    return false;
  };

  city.lightState = function lightState(light, time) {
    // 6 s NS green, 6 s EW green, offset per light.
    const phase = (time + light.offset) % light.period;
    return phase < light.period / 2 ? 'ns' : 'ew';
  };

  city.collideCircle = function collideCircle(x, z, r) {
    // Push a circle out of building AABBs. Returns corrected {x, z, hit}.
    let hit = false;
    for (const b of buildings) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r; z = cz + (dz / d) * r;
        } else {
          // Centre inside the box: push out along the smallest penetration axis.
          const pl = x - (b.minX - r), pr = (b.maxX + r) - x;
          const pt = z - (b.minZ - r), pb = (b.maxZ + r) - z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = b.minX - r;
          else if (m === pr) x = b.maxX + r;
          else if (m === pt) z = b.minZ - r;
          else z = b.maxZ + r;
        }
      }
    }
    return { x, z, hit };
  };

  return city;
}
