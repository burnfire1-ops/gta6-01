
const STAR_FULL = '★';
const STAR_EMPTY = '☆';
const MAX_WANTED = 5;

const MINIMAP_RANGE = 140;

/** Nilai pertama yang bukan null/undefined (alias rantai `??`). */
function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function formatRupiah(n) {
  const v = Math.round(Number(n) || 0);
  return 'Rp ' + v.toLocaleString('id-ID');
}

function formatJam(timeHours) {
  const h = Math.floor(Number(timeHours) || 0) % 24;
  const m = Math.floor(((Number(timeHours) || 0) % 1) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function normPoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = typeof p.x === 'number' ? p.x : 0;
  const z = typeof p.z === 'number' ? p.z : typeof p.y === 'number' ? p.y : 0;
  return { x, z };
}

function resolveEndpoint(end, nodes) {
  if (typeof end === 'number') return normPoint(nodes ? nodes[end] : null);
  return normPoint(end);
}

function edgePoints(edge, nodes) {
  if (!edge) return null;
  if (Array.isArray(edge)) {
    const a = resolveEndpoint(edge[0], nodes);
    const b = resolveEndpoint(edge[1], nodes);
    return a && b ? { a, b } : null;
  }
  const a = resolveEndpoint(edge.a ?? edge.from ?? edge.n1 ?? edge.u ?? edge.start, nodes);
  const b = resolveEndpoint(edge.b ?? edge.to ?? edge.n2 ?? edge.v ?? edge.end, nodes);
  return a && b ? { a, b } : null;
}

function headingToAngle(heading) {
  if (typeof heading === 'number') return heading;
  const p = normPoint(heading);
  if (!p) return 0;
  return Math.atan2(p.x, -p.z);
}

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'),
    minimap: $('minimap'),
    healthBar: $('health-bar'),
    healthText: $('health-text'),
    armorBar: $('armor-bar'),
    armorText: $('armor-text'),
    wantedStars: $('wanted-stars'),
    money: $('money'),
    objectivePanel: $('objective-panel'),
    objectiveTitle: $('objective-title'),
    objectiveText: $('objective-text'),
    objectiveDistance: $('objective-distance'),
    vehiclePanel: $('vehicle-panel'),
    vehicleName: $('vehicle-name'),
    vehicleHealthBar: $('vehicle-health-bar'),
    vehicleHealthText: $('vehicle-health-text') || $('vehicle-health'),
    menuTitle: $('menu-title'),
    menuPause: $('menu-pause'),
    menuControls: $('menu-controls'),
    toastEl: $('toast'),
    clock: $('clock'),
    speed: $('speed'),
  };

  if (el.minimap) {
    try {
      const wrap = document.getElementById('minimap-wrap');
      if (wrap && el.minimap.parentElement !== wrap) {
        wrap.insertBefore(el.minimap, wrap.firstChild);
      }
    } catch {
    }
  }

  const last = {
    health: null,
    armor: null,
    money: null,
    wanted: null,
    escaping: null,
    blinkPhase: null,
    objectiveTitle: null,
    objectiveText: null,
    objectiveDistance: null,
    vehicleName: null,
    vehicleHealth: null,
    timeHours: null,
    speedKmh: null,
  };
  let lastMinimapAt = 0;
  let lastMinimapPlayer = null;
  let toastTimer = null;

  const mm = el.minimap ? el.minimap.getContext('2d') : null;

  function setBar(barEl, textEl, pct, label) {
    if (!barEl && !textEl) return;
    const p = clamp(Math.round(pct), 0, 100);
    if (barEl) {
      const fill = barEl.querySelector ? barEl.querySelector(':scope > div') : null;
      const target = fill || barEl;
      if (target.tagName === 'PROGRESS') target.value = p;
      else target.style.width = p + '%';
      barEl.setAttribute('aria-valuenow', String(p));
    }
    if (textEl) textEl.textContent = label != null ? label : String(p);
  }

  function drawMinimap(data) {
    if (!mm || !el.minimap || !data) return;
    const now = performance.now();
    const playerPos = normPoint(data.playerPos);
    if (!playerPos) return;
    if (
      now - lastMinimapAt < 100 &&
      lastMinimapPlayer &&
      Math.hypot(playerPos.x - lastMinimapPlayer.x, playerPos.z - lastMinimapPlayer.z) < 1
    ) {
      return;
    }
    lastMinimapAt = now;
    lastMinimapPlayer = playerPos;

    const w = el.minimap.width || 180;
    const h = el.minimap.height || 180;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 2;
    const scale = r / MINIMAP_RANGE;
    const toX = (x) => cx + (x - playerPos.x) * scale;
    const toY = (z) => cy + (z - playerPos.z) * scale;
    const inView = (x, z) => {
      const dx = toX(x) - cx;
      const dy = toY(z) - cy;
      return dx * dx + dy * dy <= r * r;
    };

    mm.clearRect(0, 0, w, h);
    mm.save();
    mm.beginPath();
    mm.arc(cx, cy, r, 0, Math.PI * 2);
    mm.clip();

    mm.fillStyle = 'rgba(10, 16, 32, 0.85)';
    mm.fillRect(0, 0, w, h);

    const graph = data.graph;
    if (graph && Array.isArray(graph.edges)) {
      mm.strokeStyle = '#8b93a3';
      mm.lineWidth = 2;
      mm.beginPath();
      for (const edge of graph.edges) {
        const pts = edgePoints(edge, graph.nodes);
        if (!pts) continue;
        if (!inView(pts.a.x, pts.a.z) && !inView(pts.b.x, pts.b.z)) continue;
        mm.moveTo(toX(pts.a.x), toY(pts.a.z));
        mm.lineTo(toX(pts.b.x), toY(pts.b.z));
      }
      mm.stroke();
    }

    const safe = normPoint(data.safehouse);
    if (safe && inView(safe.x, safe.z)) {
      mm.fillStyle = '#2ecc71';
      mm.fillRect(toX(safe.x) - 4, toY(safe.z) - 4, 8, 8);
    }

    const marker = normPoint(data.missionMarker);
    if (marker && inView(marker.x, marker.z)) {
      const mx = toX(marker.x);
      const my = toY(marker.z);
      const pulse = 6 + 3 * Math.sin(now / 300);
      mm.strokeStyle = 'rgba(242, 201, 76, 0.8)';
      mm.lineWidth = 1.5;
      mm.beginPath();
      mm.arc(mx, my, pulse + 4, 0, Math.PI * 2);
      mm.stroke();
      mm.fillStyle = '#f2c94c';
      mm.beginPath();
      mm.moveTo(mx, my - 6);
      mm.lineTo(mx + 5, my);
      mm.lineTo(mx, my + 6);
      mm.lineTo(mx - 5, my);
      mm.closePath();
      mm.fill();
    }

    if (data.wanted > 0 && Array.isArray(data.policeUnits)) {
      mm.fillStyle = '#4f8ef7';
      for (const u of data.policeUnits) {
        const p = normPoint(u);
        if (p && inView(p.x, p.z)) {
          mm.beginPath();
          mm.arc(toX(p.x), toY(p.z), 3.5, 0, Math.PI * 2);
          mm.fill();
        }
      }
    }

    mm.save();
    mm.translate(cx, cy);
    mm.rotate(headingToAngle(data.playerHeading));
    mm.fillStyle = '#f2c94c';
    mm.strokeStyle = '#11141b';
    mm.lineWidth = 1;
    mm.beginPath();
    mm.moveTo(0, -9);
    mm.lineTo(6, 7);
    mm.lineTo(0, 3);
    mm.lineTo(-6, 7);
    mm.closePath();
    mm.fill();
    mm.stroke();
    mm.restore();

    mm.restore();

    mm.strokeStyle = 'rgba(238, 241, 245, 0.9)';
    mm.lineWidth = 2;
    mm.beginPath();
    mm.arc(cx, cy, r, 0, Math.PI * 2);
    mm.stroke();
    mm.fillStyle = '#eef1f5';
    mm.font = 'bold 11px system-ui, sans-serif';
    mm.textAlign = 'center';
    mm.textBaseline = 'top';
    mm.fillText('N', cx, 4);
  }

  function normalize(raw) {
    const mm = raw.minimap || {};
    const policeUnits = pick(mm.policeUnits, raw.policeUnits, Array.isArray(raw.police) ? raw.police : []);
    const wanted = pick(raw.wanted, 0);
    let escaping = raw.wantedEscaping;
    if (typeof escaping !== 'boolean') {
      escaping =
        wanted > 0 &&
        Array.isArray(policeUnits) &&
        policeUnits.length > 0 &&
        policeUnits.every((u) => u && u.canSee === false);
    }
    return {
      health: pick(raw.playerHealth, raw.health),
      armor: raw.armor,
      money: raw.money,
      wanted,
      escaping: !!escaping,
      missionTitle:
        pick(raw.missionTitle, raw.mission && raw.mission.title, mm.missionTitle || null),
      objectiveText: pick(raw.objectiveText, raw.objective),
      vehicleName: pick(raw.vehicleName, raw.vehicle),
      vehicleHealth: raw.vehicleHealth,
      timeHours: raw.timeHours,
      speedKmh:
        typeof raw.speedKmh === 'number'
          ? raw.speedKmh
          : typeof raw.speed === 'number'
            ? raw.speed * 3.6
            : undefined,
      minimap: {
        graph: pick(mm.graph, raw.graph),
        playerPos: pick(mm.playerPos, raw.playerPos),
        playerHeading: pick(mm.playerHeading, raw.playerHeading),
        policeUnits,
        missionMarker: pick(mm.missionMarker, raw.missionMarker),
        safehouse: pick(mm.safehouse, raw.safehouse),
      },
    };
  }

  function update(rawState) {
    if (!rawState || typeof rawState !== 'object') return;
    const state = normalize(rawState);

    if (typeof state.health === 'number' && state.health !== last.health) {
      last.health = state.health;
      setBar(el.healthBar, el.healthText, state.health, String(Math.round(state.health)));
      if (el.healthBar) {
        el.healthBar.classList.toggle('low', state.health < 25);
      }
    }

    if (typeof state.armor === 'number' && state.armor !== last.armor) {
      last.armor = state.armor;
      setBar(el.armorBar, el.armorText, state.armor, String(Math.round(state.armor)));
    }

    if (typeof state.money === 'number' && state.money !== last.money) {
      last.money = state.money;
      if (el.money) {
        el.money.textContent = formatRupiah(state.money);
        el.money.classList.remove('flash');
        void el.money.offsetWidth;
        el.money.classList.add('flash');
      }
    }

    {
      const wanted = clamp(Math.round(state.wanted || 0), 0, MAX_WANTED);
      const escaping = state.escaping;
      if (wanted !== last.wanted || escaping !== last.escaping) {
        last.wanted = wanted;
        last.escaping = escaping;
        if (el.wantedStars) {
          el.wantedStars.innerHTML = Array.from({ length: MAX_WANTED }, (_, i) => {
            const filled = i < wanted;
            const cls = filled ? (escaping ? 'hot' : '') : 'off';
            return `<span class="${cls}">${filled ? STAR_FULL : STAR_EMPTY}</span>`;
          }).join('');
          el.wantedStars.setAttribute('aria-label', `Wanted level ${wanted} dari ${MAX_WANTED}`);
        }
      }
    }

    const missionTitle = typeof state.missionTitle === 'string' ? state.missionTitle : null;
    if (missionTitle !== last.objectiveTitle) {
      last.objectiveTitle = missionTitle;
      if (el.objectiveTitle) el.objectiveTitle.textContent = missionTitle || '';
    }
    if (typeof state.objectiveText === 'string' && state.objectiveText !== last.objectiveText) {
      last.objectiveText = state.objectiveText;
      if (el.objectiveText) el.objectiveText.textContent = state.objectiveText;
    }
    let distanceText = '';
    {
      const pp = normPoint(state.minimap.playerPos);
      const mk = normPoint(state.minimap.missionMarker);
      if (pp && mk) {
        distanceText = Math.round(Math.hypot(mk.x - pp.x, mk.z - pp.z)) + ' m';
      }
    }
    if (distanceText !== last.objectiveDistance) {
      last.objectiveDistance = distanceText;
      if (el.objectiveDistance) el.objectiveDistance.textContent = distanceText;
    }
    if (el.objectivePanel) {
      el.objectivePanel.style.display =
        last.objectiveTitle || last.objectiveText ? 'block' : 'none';
    }

    const driving = typeof state.vehicleName === 'string' && state.vehicleName.length > 0;
    if (state.vehicleName !== last.vehicleName) {
      last.vehicleName = state.vehicleName || null;
      if (el.vehicleName) el.vehicleName.textContent = state.vehicleName || '';
    }
    if (typeof state.vehicleHealth === 'number' && state.vehicleHealth !== last.vehicleHealth) {
      last.vehicleHealth = state.vehicleHealth;
      if (el.vehicleHealthBar) {
        setBar(el.vehicleHealthBar, el.vehicleHealthText, state.vehicleHealth, String(Math.round(state.vehicleHealth)));
      } else if (el.vehicleHealthText) {
        el.vehicleHealthText.textContent = 'Kesehatan ' + Math.round(state.vehicleHealth) + '%';
      }
    }
    if (el.vehiclePanel) {
      el.vehiclePanel.style.display = driving ? 'block' : 'none';
    }

    if (typeof state.timeHours === 'number' && state.timeHours !== last.timeHours) {
      last.timeHours = state.timeHours;
      if (el.clock) el.clock.textContent = formatJam(state.timeHours);
    }
    if (typeof state.speedKmh === 'number' && Math.round(state.speedKmh) !== last.speedKmh) {
      last.speedKmh = Math.round(state.speedKmh);
      if (el.speed) el.speed.textContent = last.speedKmh + ' km/jam';
    }

    if (state.minimap) {
      drawMinimap({
        graph: state.minimap.graph,
        playerPos: state.minimap.playerPos,
        playerHeading: state.minimap.playerHeading,
        policeUnits: state.minimap.policeUnits,
        missionMarker: state.minimap.missionMarker,
        safehouse: state.minimap.safehouse,
        wanted: state.wanted || 0,
      });
    }
  }

  function setObjective(text) {
    if (typeof text !== 'string') return;
    last.objectiveText = text;
    if (el.objectiveText) el.objectiveText.textContent = text;
    if (el.objectivePanel) el.objectivePanel.style.display = text ? 'block' : 'none';
  }

  function showMenu(name) {
    const show = (node, on) => {
      if (!node) return;
      node.style.display = on ? 'flex' : 'none';
      if (node.classList) node.classList.toggle('open', on);
    };
    show(el.menuTitle, name === 'title');
    show(el.menuPause, name === 'pause');
    show(el.menuControls, name === 'controls');
    const visible =
      name === 'title' ? el.menuTitle : name === 'pause' ? el.menuPause
        : name === 'controls' ? el.menuControls : null;
    if (visible) {
      try {
        const btn = visible.querySelector('button');
        if (btn) btn.focus();
      } catch {
      }
    }
  }

  function hideMenus() {
    showMenu('none');
  }

  function toast(msg) {
    if (!el.toastEl || typeof msg !== 'string' || !msg) return;
    el.toastEl.textContent = msg;
    el.toastEl.style.display = 'block'; // C
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toastEl.style.display = 'none';
    }, 3000);
  }

  return { update, setObjective, showMenu, hideMenus, toast };
}
