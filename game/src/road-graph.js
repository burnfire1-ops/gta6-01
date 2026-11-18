
import { CITY } from './config.js';

const SPACING = CITY.roadSpacing;
const HALF = CITY.half;

export function districtAt(x, z) {
  if (x < 0 && z < 0) return 'artdeco';
  if (x >= 0 && z < 0) return 'neon';
  if (x < 0 && z >= 0) return 'port';
  return 'residential';
}

function nodeId(ix, iz) {
  return iz * 100 + ix;
}

export function createRoadGraph() {
  const coords = [];
  for (let v = -HALF; v <= HALF; v += SPACING) coords.push(v);
  const n = coords.length;
  const nodes = [];
  const nodeById = new Map();
  const adjacency = new Map();

  function addNode(id, x, z) {
    const node = { id, x, z, district: districtAt(x, z) };
    nodes.push(node);
    nodeById.set(id, node);
    adjacency.set(id, []);
    return node;
  }
  function addEdge(a, b) {
    const ea = nodeById.get(a);
    const eb = nodeById.get(b);
    const len = Math.hypot(eb.x - ea.x, eb.z - ea.z);
    const edge = { a, b, length: len };
    edges.push(edge);
    adjacency.get(a).push({ to: b, edge });
    adjacency.get(b).push({ to: a, edge });
    return edge;
  }

  const edges = [];
  // Grid nodes.
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      addNode(nodeId(ix, iz), coords[ix], coords[iz]);
    }
  }
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      if (ix + 1 < n) addEdge(nodeId(ix, iz), nodeId(ix + 1, iz));
      if (iz + 1 < n) addEdge(nodeId(ix, iz), nodeId(ix, iz + 1));
    }
  }
  // Kantor polisi Boulevard: node art-deco satu blok dari pusat kota.
  // policeStationNode() di police-pursuit.js memakai tanda ini.
  // Tanpa tanda, busted() jatuh ke nodes[0] (sudut peta) dan toast-nya bohong.
  const stIx = coords.indexOf(-20);
  const stNode = stIx >= 0 ? nodeById.get(nodeId(stIx, stIx)) : null;
  if (stNode) stNode.policeStation = true;

  const portNode = nodeId(0, 9); //
  void portNode;
  const bridgeStart = nodeId(0, 8); // (-220
  const b0 = 1000;
  const b1 = 1001;
  addNode(b0, -260, 120);
  addNode(b1, -300, 120);
  const linkNode = 1002;
  addNode(linkNode, -220, 120);
  addEdge(bridgeStart, linkNode);
  addEdge(linkNode, b0);
  addEdge(b0, b1);
  nodeById.get(b0).district = 'port';
  nodeById.get(b1).district = 'port';
  nodeById.get(linkNode).district = 'port';

  function nearestNode(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  function nearestPointOnGraph(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const edge of edges) {
      const a = nodeById.get(edge.a);
      const b = nodeById.get(edge.b);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq === 0 ? 0 : ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz, edgeId: `${edge.a}-${edge.b}`, t, edge };
      }
    }
    return best;
  }

  function projectToRoad(x, z) {
    const p = nearestPointOnGraph(x, z);
    return { x: p.x, z: p.z };
  }

  function isOnRoad(x, z, halfWidth = CITY.roadHalfWidth) {
    const p = nearestPointOnGraph(x, z);
    const d = Math.hypot(p.x - x, p.z - z);
    return d <= halfWidth;
  }

  function findPathAStar(startId, goalId) {
    if (startId === goalId) return [startId];
    if (!nodeById.has(startId) || !nodeById.has(goalId)) return [];
    const goal = nodeById.get(goalId);
    const open = [{ id: startId, f: 0 }];
    const cameFrom = new Map();
    const gScore = new Map([[startId, 0]]);
    const closed = new Set();
    const heuristic = (id) => {
      const nd = nodeById.get(id);
      return Math.hypot(nd.x - goal.x, nd.z - goal.z);
    };
    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const current = open.splice(bestIdx, 1)[0].id;
      if (current === goalId) {
        const path = [current];
        let c = current;
        while (cameFrom.has(c)) {
          c = cameFrom.get(c);
          path.unshift(c);
        }
        return path;
      }
      closed.add(current);
      const cur = nodeById.get(current);
      for (const { to, edge } of adjacency.get(current)) {
        if (closed.has(to)) continue;
        const tentative = gScore.get(current) + edge.length;
        if (tentative < (gScore.get(to) ?? Infinity)) {
          cameFrom.set(to, current);
          gScore.set(to, tentative);
          const f = tentative + heuristic(to);
          const existing = open.find((o) => o.id === to);
          if (existing) existing.f = f;
          else open.push({ id: to, f });
        }
      }
      void cur;
    }
    return [];
  }

  function randomRoadNode(rng, minDistFrom, minDist) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const node = nodes[Math.floor(rng() * nodes.length)];
      if (minDistFrom && minDist) {
        if (Math.hypot(node.x - minDistFrom.x, node.z - minDistFrom.z) < minDist) continue;
      }
      return node;
    }
    return nodes[Math.floor(rng() * nodes.length)];
  }

  /** Traffic lights cycle 30 s (18 s green, 12 s red), offset per intersection. */
  function trafficLightState(nodeIdValue, timeHours) {
    const seconds = timeHours * 3600;
    const phase = (seconds + (nodeIdValue % 97) * 7) % 30;
    return phase < 18 ? 'green' : 'red';
  }

  return {
    nodes,
    edges,
    nodeById,
    nearestPointOnGraph,
    projectToRoad,
    findPathAStar,
    nearestNode,
    randomRoadNode,
    isOnRoad,
    trafficLightState,
  };
}
