// Peta besar (M): x -300..220, z -220..220.
const S = 600/520;
const OX = 20;
const OY = 66;
const GOLD = '#f2c94c';
const LABELS = [
  ['Boulevard Art-Deco', -110, -110],
  ['Distrik Neon', 110, -110],
  ['Pelabuhan', -110, 110],
  ['Bukit Residensial', 110, 110],
];

function pt(p) {
  if (!p || typeof p !== 'object') return null;
  return { x: p.x ?? 0, z: p.z ?? p.y ?? 0 };
}

export function createBigMap(canvas) {
  const c = canvas ? canvas.getContext('2d') : null;
  const X = (x) => OX + (x + 300) * S;
  const Y = (z) => OY + (z + 220) * S;

  function draw(d) {
    if (!c || !d) return;
    const w = canvas.width;
    const h = canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#0e2f4d';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#22392c';
    c.fillRect(X(-220), Y(-220), 440 * S, 440 * S);
    c.fillRect(X(-300), Y(100), 80 * S, 40 * S);
    const g = d.graph;
    if (g && Array.isArray(g.edges)) {
      const byId = g.nodeById;
      c.strokeStyle = '#8b93a3';
      c.lineWidth = 2;
      c.beginPath();
      for (const e of g.edges) {
        const a = byId ? byId.get(e.a) : pt(e.a);
        const b = byId ? byId.get(e.b) : pt(e.b);
        if (!a || !b) continue;
        c.moveTo(X(a.x), Y(a.z));
        c.lineTo(X(b.x), Y(b.z));
      }
      c.stroke();
    }
    c.fillStyle = 'rgba(244,241,230,.85)';
    c.font = 'bold 15px sans-serif';
    c.textAlign = 'center';
    for (const [name, x, z] of LABELS) c.fillText(name, X(x), Y(z));
    if (g && Array.isArray(g.nodes)) {
      const st = g.nodes.find((n) => n && n.policeStation);
      if (st) {
        c.fillStyle = '#4f8ef7';
        c.fillRect(X(st.x) - 6, Y(st.z) - 6, 12, 12);
        c.strokeStyle = GOLD;
        c.lineWidth = 2;
        c.strokeRect(X(st.x) - 6, Y(st.z) - 6, 12, 12);
        c.fillStyle = '#eef1f5';
        c.font = 'bold 12px sans-serif';
        c.fillText('Kantor Polisi', X(st.x), Y(st.z) + 20);
      }
    }
    if (Array.isArray(d.packages)) {
      c.fillStyle = GOLD;
      for (const pk of d.packages) {
        const p = pt(pk);
        if (!p) continue;
        c.beginPath();
        c.arc(X(p.x), Y(p.z), 4, 0, Math.PI * 2);
        c.fill();
      }
    }
    const mk = pt(d.missionMarker);
    if (mk) {
      const mx = X(mk.x);
      const my = Y(mk.z);
      const pulse = 7 + 3 * Math.sin(performance.now() / 300);
      c.strokeStyle = 'rgba(242,201,76,.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(mx, my, pulse + 5, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = GOLD;
      c.beginPath();
      c.moveTo(mx, my - 8);
      c.lineTo(mx + 7, my);
      c.lineTo(mx, my + 8);
      c.lineTo(mx - 7, my);
      c.closePath();
      c.fill();
    }
    if (d.wanted > 0 && Array.isArray(d.police)) {
      c.fillStyle = '#4f8ef7';
      for (const u of d.police) {
        const p = pt((u.car && u.car.pos) || u.pos || u);
        if (!p) continue;
        c.beginPath();
        c.arc(X(p.x), Y(p.z), 4, 0, Math.PI * 2);
        c.fill();
      }
    }
    const pp = pt(d.playerPos);
    if (pp) {
      c.save();
      c.translate(X(pp.x), Y(pp.z));
      c.rotate(Math.PI - (typeof d.playerHeading === 'number' ? d.playerHeading : 0));
      c.fillStyle = GOLD;
      c.strokeStyle = '#11141b';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, -11);
      c.lineTo(8, 9);
      c.lineTo(0, 4);
      c.lineTo(-8, 9);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  return { draw };
}
