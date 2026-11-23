
import { districtAt } from './road-graph.js';
const DN={a:'Boulevard Art-Deco',n:'Distrik Neon',p:'Pelabuhan',r:'Bukit Residensial'};
const G={p:'Geng Dermaga',n:'Anak Neon'};
const STAR_FULL = '★';
const STAR_EMPTY = '☆';
const MAX_WANTED = 5;

const MINIMAP_RANGE = 140;

function pick(...vals) { for (const v of vals) if (v != null) return v; return undefined; }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function formatRupiah(n) { return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID'); }

function formatJam(t) {
  const v = Number(t) || 0;
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(v) % 24) + ':' + p(Math.floor((v % 1) * 60));
}

function normPoint(p) { if (!p || typeof p !== 'object') return null; return { x: typeof p.x === 'number' ? p.x : 0, z: typeof p.z === 'number' ? p.z : typeof p.y === 'number' ? p.y : 0 }; }

function resolveEndpoint(end, nodes) { return normPoint(typeof end === 'number' ? (nodes ? nodes[end] : null) : end); }

function edgePoints(edge, nodes) {
  if (!edge) return null;
  const a = resolveEndpoint(Array.isArray(edge) ? edge[0] : edge.a, nodes);
  const b = resolveEndpoint(Array.isArray(edge) ? edge[1] : edge.b, nodes);
  return a && b ? { a, b } : null;
}

function headingToAngle(h) { if (typeof h === 'number') return h; const p = normPoint(h); return p ? Math.atan2(p.x, -p.z) : 0; }

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'),
    minimap: $('minimap'),
    minimapWrap: $('minimap-wrap'),
    dispatchPanel: $('dispatch-panel'),
    healthBar: $('health-bar'),
    healthText: $('health-text'),
    armorBar: $('armor-bar'),
    armorText: $('armor-text'),
    wantedStars: $('wanted-stars'),
    money: $('money'),
    packagesCount: $('packages-count'),
    objectivePanel: $('objective-panel'),
    objectiveTitle: $('objective-title'),
    objectiveText: $('objective-text'),
    objectiveDistance: $('objective-distance'),
    missionStage: $('mission-stage'),
    missionBar: $('mission-bar'),
    missionNext: $('mission-next'),
    vehiclePanel: $('vehicle-panel'),
    vehicleName: $('vehicle-name'),
    vehicleHealthBar: $('vehicle-health-bar'),
    vehicleHealthText: $('vehicle-health-text') || $('vehicle-health'),
    menuTitle: $('menu-title'),
    menuPause: $('menu-pause'),
    menuControls: $('menu-controls'),
    toastEl: $('toast'),
    districtCard: $('district-card'),
    districtName: $('district-name'),
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
    packagesCount: null,
    wanted: null,
    escaping: null,
    blinkPhase: null,
    objectiveTitle: null,
    objectiveText: null,
    objectiveDistance: null,
    missionStage: null,
    missionDone: null,
    missionNext: null,
    dispatchKey: null,
    vehicleName: null,
    vehicleHealth: null,
    timeHours: null,
    speedKmh: null,
  };
  let cardTimer;
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

    const X0 = toX(0), Y0 = toY(0);
    mm.fillStyle = '#e89a80'; mm.fillRect(0, 0, X0, Y0);
    mm.fillStyle = '#f5c2ac'; mm.fillRect(X0, 0, w - X0, Y0);
    mm.fillStyle = '#d67e68'; mm.fillRect(0, Y0, X0, h - Y0);
    mm.fillStyle = '#e59a7e'; mm.fillRect(X0, Y0, w - X0, h - Y0);
    mm.font = 'bold 11px system-ui, sans-serif';
    mm.textAlign = 'center';
    mm.textBaseline = 'middle';
    mm.fillStyle = '#0e7fa8';
    mm.fillRect(0, 0, toX(-220), h);

    const graph = data.graph;
    if (graph && Array.isArray(graph.edges)) {
      mm.strokeStyle = '#3a2f22';
      mm.lineWidth = 7;
      mm.beginPath();
      for (const edge of graph.edges) {
        const pts = edgePoints(edge, graph.nodes);
        if (!pts) continue;
        if (!inView(pts.a.x, pts.a.z) && !inView(pts.b.x, pts.b.z)) continue;
        mm.moveTo(toX(pts.a.x), toY(pts.a.z));
        mm.lineTo(toX(pts.b.x), toY(pts.b.z));
      }
      mm.stroke();
      mm.strokeStyle = '#e8dcc0';
      mm.lineWidth = 4;
      mm.stroke();
      mm.strokeStyle = '#fff3d6';
      mm.lineWidth = 2;
      mm.stroke();
    }

    const safe = normPoint(data.safehouse);
    if (safe && inView(safe.x, safe.z)) {
      mm.fillStyle = '#2ecc71';
      mm.beginPath();
      mm.arc(toX(safe.x), toY(safe.z), 6, 0, Math.PI * 2);
      mm.fill();
      mm.fillStyle = '#fff';
      mm.fillText('H', toX(safe.x), toY(safe.z));
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
      mm.fillStyle = '#11141b';
      mm.fillText('?', mx, my);
    }

    const dots = (list, r) => {
      mm.strokeStyle = '#eef1f5';
      mm.lineWidth = 1.5;
      for (const it of list) {
        const p = normPoint(it && it.car ? it.car.pos : it);
        if (p && inView(p.x, p.z)) {
          mm.beginPath();
          mm.arc(toX(p.x), toY(p.z), r, 0, Math.PI * 2);
          mm.fill();
          mm.stroke();
        }
      }
    };
    if (Array.isArray(data.packages)) {
      mm.fillStyle = '#f2c94c';
      dots(data.packages, 3);
    }

    if (data.wanted > 0 && Array.isArray(data.policeUnits)) {
      mm.fillStyle = '#4f8ef7';
      dots(data.policeUnits, 3.5);
    }

    mm.save();
    mm.translate(cx, cy);
    mm.rotate(Math.PI - headingToAngle(data.playerHeading));
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

    const gr = mm.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2ec4b6');
    gr.addColorStop(1, '#4f8ef7');
    mm.strokeStyle = gr;
    mm.lineWidth = 2;
    mm.beginPath();
    mm.arc(cx, cy, r, 0, Math.PI * 2);
    mm.stroke();
    mm.fillStyle = '#eef1f5';
    mm.fillText('N', cx, 10);
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
      packagesCount: raw.packagesCount,
      wanted,
      escaping: !!escaping,
      missionTitle:
        pick(raw.missionTitle, raw.mission && raw.mission.title, mm.missionTitle || null),
      objectiveText: pick(raw.objectiveText, raw.objective),
      mission: raw.mission || null,
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
        packages: pick(mm.packages, raw.packages),
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

    if (typeof state.packagesCount === 'number' && state.packagesCount !== last.packagesCount) {
      last.packagesCount = state.packagesCount;
      if (el.packagesCount) el.packagesCount.textContent = `Paket ${state.packagesCount}/8`;
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
      const d = pp && districtAt(pp.x, pp.z);
      if (d && d !== last.district && el.districtCard && el.districtName) {
        last.district = d;
        el.districtName.textContent = DN[d[0]];
        el.districtCard.children[1].textContent=G[d[0]]||'TELUK CAHAYA';
        el.districtCard.style.display='block';
        clearTimeout(cardTimer);
        cardTimer = setTimeout(() => { el.districtCard.style.display='none'; }, 2800);
      }
    }
    if (distanceText !== last.objectiveDistance) {
      last.objectiveDistance = distanceText;
      if (el.objectiveDistance) el.objectiveDistance.textContent = distanceText;
    }
    const mi = state.mission;
    if (mi) {
      const st = mi.index == null ? 'FREE ROAM' : 'MISI ' + (mi.index + 1) + '/' + (mi.total || 11);
      if (st !== last.missionStage) { last.missionStage = st; if (el.missionStage) el.missionStage.textContent = st; }
      const dn = Math.round(100 * (mi.done || 0) / (mi.total || 11));
      if (dn !== last.missionDone) { last.missionDone = dn; setBar(el.missionBar, null, dn); }
      const nx = mi.next ? 'NEXT: ' + mi.next : '';
      if (nx !== last.missionNext) { last.missionNext = nx; if (el.missionNext) { el.missionNext.textContent = nx; el.missionNext.style.display = nx ? 'block' : 'none'; } }
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
        const vh = Math.round(state.vehicleHealth);
        el.vehicleHealthText.textContent = 'Kesehatan ' + vh + '% · Rusak ' + (100 - vh) + '%';
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
        packages: state.minimap.packages,
        wanted: state.wanted || 0,
      });
    }
    {
      const pp = normPoint(state.minimap.playerPos);
      const us = (state.minimap.policeUnits || []).filter((u) => u && u.state !== 'giveup');
      let k = '';
      if (state.wanted > 0 && pp && us.length) {
        k = us.map((u, i) => {
          const p = normPoint((u.car && u.car.pos) || u.pos || u);
          const d = p ? Math.round(Math.hypot(p.x - pp.x, p.z - pp.z)) : 0;
          const r = u.state === 'pursue' ? 'PENGEJAR' : u.state === 'search' ? 'PENCARI' : 'PATROLI';
          return 'UNIT ' + String(i + 1).padStart(2, '0') + ' ' + r + ' ' + d + 'm';
        }).join('|');
      }
      if (k !== last.dispatchKey) {
        last.dispatchKey = k;
        if (el.dispatchPanel) {
          el.dispatchPanel.style.display = k ? 'block' : 'none';
          el.dispatchPanel.innerHTML = k ? k.split('|').map((s) => '<div>' + s + '</div>').join('') : '';
        }
      }
    }
  }

  function setObjective(text) {
    if (typeof text !== 'string') return;
    last.objectiveText = text;
    if (el.objectiveText) el.objectiveText.textContent = text;
    if (el.objectivePanel) el.objectivePanel.style.display = text ? 'block' : 'none';
  }

  function showMenu(name) {
    for (const n of [el.minimapWrap, el.wantedStars, el.objectivePanel, el.vehiclePanel, el.toastEl, el.districtCard]) if (n) n.style.visibility = name === 'title' ? 'hidden' : '';
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
    el.toastEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toastEl.style.display = 'none';
    }, 3000);
  }

  return { update, setObjective, showMenu, hideMenus, toast };
}
