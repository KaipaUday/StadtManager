// 3D-Modell – Kombi: Draufsicht exakt nach Karte (OSM), Trakte + Stockwerke nach Gebäudeplan, Innenleben aus Bauplänen (three.js)
// Einbinden: import { mountCampusKombi } from "./campus3d-kombi/campus-kombi.js";
//            mountCampusKombi(document.querySelector("#el"), { planBaseUrl: "/campus3d-karte/plans/" });
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OSM_CONTEXT_BUILDINGS, OSM_AREAS, OSM_WAYS, OSM_TREES } from "./osm-umgebung.js";
import { FLOOR_HEIGHT, TRAKTE, NOT_IN_MAP } from "./kombi-data.js";

const OBJECT_COLORS = { heizung: 0xe4572e, elektro: 0x2e86de, aufzug: 0x10ac84 };
const OBJECT_LABELS = { heizung: "Heizung", elektro: "Elektro", aufzug: "Aufzug" };

function injectStyles() {
  if (document.getElementById("ct-styles")) return;
  const s = document.createElement("style");
  s.id = "ct-styles";
  s.textContent = `
  .ct-root{position:relative;width:100%;height:100%;min-height:480px;display:flex;font:14px/1.4 system-ui,sans-serif;color:#1d2433;background:#eef2f6;overflow:hidden;border-radius:8px}
  .ct-canvas{flex:1;position:relative;min-width:0}
  .ct-canvas canvas{display:block;width:100%;height:100%;outline:none}
  .ct-side{width:260px;flex:none;background:#fff;border-left:1px solid #d9e0e8;overflow:auto;padding:12px;box-sizing:border-box}
  .ct-side h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#5b6678;margin:14px 0 6px}
  .ct-side h3:first-child{margin-top:0}
  .ct-trakt{display:flex;align-items:center;gap:6px;width:100%;border:1px solid transparent;background:none;padding:4px 6px;border-radius:6px;cursor:pointer;text-align:left;font:inherit;color:inherit}
  .ct-trakt:hover{background:#f1f4f8}.ct-trakt.on{border-color:#3d6bd6;background:#eef3ff}
  .ct-dot{width:12px;height:12px;border-radius:3px;flex:none}
  .ct-floors{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px 24px}
  .ct-floors button{font:12px system-ui;border:1px solid #c8d1dc;background:#fff;border-radius:4px;padding:2px 6px;cursor:pointer}
  .ct-floors button.on{background:#3d6bd6;color:#fff;border-color:#3d6bd6}
  .ct-floors button.plan::after{content:" ▦";opacity:.6}
  .ct-row{display:flex;align-items:center;gap:8px;margin:6px 0}
  .ct-row input[type=range]{flex:1}
  .ct-btn{font:13px system-ui;border:1px solid #c8d1dc;background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer}
  .ct-info{position:absolute;left:12px;bottom:12px;max-width:min(380px,70%);background:rgba(255,255,255,.95);border:1px solid #d9e0e8;border-radius:8px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.08);font-size:13px}
  .ct-info:empty{display:none}.ct-info b{font-size:14px}.ct-info small{color:#6b7587;display:block;margin-top:4px}
  .ct-hint{position:absolute;right:12px;top:10px;font-size:12px;color:#5b6678;background:rgba(255,255,255,.8);padding:3px 8px;border-radius:6px;pointer-events:none}
  .ct-legend span{display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:12px}
  .ct-legend i{width:10px;height:10px;border-radius:50%;display:inline-block}
  .ct-note{font-size:11px;color:#6b7587;margin-top:10px}
  @media (max-width:700px){.ct-root{flex-direction:column}.ct-side{width:100%;max-height:40%;border-left:0;border-top:1px solid #d9e0e8}}
  `;
  document.head.append(s);
}

export function mountCampusKombi(container, options = {}) {
  const planBaseUrl = options.planBaseUrl ?? "./plans/";
  injectStyles();
  const listeners = { select: [] };
  const emit = (name, detail) => {
    listeners[name]?.forEach((fn) => fn(detail));
    container.dispatchEvent(new CustomEvent(`campus3d:${name}`, { detail }));
  };

  // ---------- DOM ----------
  const root = document.createElement("div");
  root.className = "ct-root";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "ct-canvas";
  const side = document.createElement("div");
  side.className = "ct-side";
  const info = document.createElement("div");
  info.className = "ct-info";
  const hint = document.createElement("div");
  hint.className = "ct-hint";
  hint.textContent = "Ziehen: drehen · Mausrad: zoomen · Rechtsklick: verschieben";
  canvasWrap.append(info, hint);
  root.append(canvasWrap, side);
  container.replaceChildren(root);

  // ---------- Szene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  canvasWrap.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe3e9ef);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 8;
  controls.maxDistance = 900;
  controls.screenSpacePanning = true;
  const resetCamera = () => { camera.position.set(-160, 170, 230); controls.target.set(10, 0, -10); };
  resetCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-120, 200, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 10, far: 700 });
  scene.add(sun);

  const shapeOf = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const flatPoly = (pts, color, y) => {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(pts)).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color }));
    m.position.y = y;
    m.receiveShadow = true;
    return m;
  };
  const polyArea = (pts) => Math.abs(pts.reduce((s, [x, z], i) => { const [x2, z2] = pts[(i + 1) % pts.length]; return s + x * z2 - x2 * z; }, 0) / 2);

  // ---------- Gelände (OSM) ----------
  const siteGroup = new THREE.Group();
  scene.add(siteGroup);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xb9cba3 }));
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  siteGroup.add(ground);
  const school = flatPoly(OSM_AREAS.school, 0xd8d2c4, 0.0);
  school.userData.pick = { type: "gelaende", id: "osm-51350823", data: { name: "Schulgelände", note: "Umriss aus OpenStreetMap" } };
  siteGroup.add(school);
  OSM_AREAS.grass.forEach((p) => siteGroup.add(flatPoly(p, 0x8fbf6a, 0.02)));
  OSM_AREAS.parking.forEach((p, i) => {
    const m = flatPoly(p, 0x8d939b, 0.04);
    m.userData.pick = { type: "gelaende", id: `parkplatz-${i + 1}`, data: { name: "Parkplatz", note: "Aus OpenStreetMap" } };
    siteGroup.add(m);
    const c = p.reduce((a, [x, z]) => [a[0] + x / p.length, a[1] + z / p.length], [0, 0]);
    const s = makeSign("P", "#1f6fc5", "#ffffff", true);
    s.position.set(c[0], 6, c[1]);
    siteGroup.add(s);
  });
  OSM_CONTEXT_BUILDINGS.forEach((p) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(p), { depth: 7, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xe9e6df }));
    m.castShadow = m.receiveShadow = true;
    siteGroup.add(m);
  });
  const wayMat = { road: new THREE.MeshLambertMaterial({ color: 0x6f747b }), path: new THREE.MeshLambertMaterial({ color: 0xcdb99a }) };
  OSM_WAYS.forEach(([width, pts, name]) => {
    const mat = width >= 4 ? wayMat.road : wayMat.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len + width * 0.5, 0.08, width), mat);
      seg.position.set((x1 + x2) / 2, 0.06 + (width >= 4 ? 0 : 0.02), (z1 + z2) / 2);
      seg.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      seg.receiveShadow = true;
      seg.userData.pick = { type: "weg", id: `weg-${name}`, data: { name, note: "Aus OpenStreetMap" } };
      siteGroup.add(seg);
    }
  });
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 6), crownGeo = new THREE.SphereGeometry(2.6, 10, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), crownMat = new THREE.MeshLambertMaterial({ color: 0x4f8a3c });
  OSM_TREES.forEach(([x, z], i) => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 1.5;
    const crown = new THREE.Mesh(crownGeo, crownMat); crown.position.y = 4.6;
    trunk.castShadow = crown.castShadow = true;
    t.add(trunk, crown);
    t.position.set(x, 0, z);
    t.traverse((o) => (o.userData.pick = { type: "baum", id: `baum-${i + 1}`, data: { name: "Baum", note: "Position aus OpenStreetMap" } }));
    siteGroup.add(t);
  });

  // ---------- Gebäude ----------
  const buildings = TRAKTE.map((t) => ({ ...t, floorH: FLOOR_HEIGHT, pts: t.polys.flat() }));
  // Grundriss-Rahmen -> Weltkoordinaten (u: links->rechts, v: oben->unten im Plan)
  const frameToWorld = (fr, u, v) => {
    const a = (fr.rotYDeg * Math.PI) / 180;
    const eu = [Math.cos(a), -Math.sin(a)], ev = [Math.sin(a), Math.cos(a)];
    const du = (u - 0.5) * fr.w, dv = (v - 0.5) * fr.d;
    return [fr.cx + du * eu[0] + dv * ev[0], fr.cz + du * eu[1] + dv * ev[1]];
  };
  const LEVEL_NAME = { UG: "Untergeschoss", EG: "Erdgeschoss", "1OG": "1. OG", "2OG": "2. OG", "3OG": "3. OG", "4OG": "4. OG" };
  const levelName = (l) => LEVEL_NAME[l] ?? l;

  const texLoader = new THREE.TextureLoader();
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x2b3240, transparent: true, opacity: 0.5 });
  const pickables = [];
  const state = new Map();

  for (const b of buildings) {
    const group = new THREE.Group();
    scene.add(group);
    const area = Math.round(b.polys.reduce((s, p) => s + polyArea(p), 0));
    const floors = b.floors.map((f, fi) => {
      const fg = new THREE.Group();
      fg.userData.baseY = fi * b.floorH;
      group.add(fg);
      const pick = { type: "stockwerk", id: `${b.id}-${f.level}`, data: { building: b.id, level: f.level, floorIndex: fi } };
      const wallMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.15), transparent: true });
      const geo = new THREE.ExtrudeGeometry(b.polys.map(shapeOf), { depth: b.floorH - 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2);
      const body = new THREE.Mesh(geo, wallMat);
      body.position.y = 0.3;
      body.castShadow = body.receiveShadow = true;
      body.userData.pick = pick;
      body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat));
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(b.polys.map(shapeOf), { depth: 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf4f1ea }));
      slab.userData.pick = pick;
      fg.add(body, slab);
      pickables.push(body, slab);
      let planMesh = null;
      if (f.plan && b.planFrame) {
        const fr = b.planFrame;
        const tex = texLoader.load(planBaseUrl + f.plan.file);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.offset.set(f.plan.x0, 1 - f.plan.y1);
        tex.repeat.set(f.plan.x1 - f.plan.x0, f.plan.y1 - f.plan.y0);
        planMesh = new THREE.Mesh(new THREE.PlaneGeometry(fr.w, fr.d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex }));
        planMesh.position.set(fr.cx, 0.32, fr.cz);
        planMesh.rotation.y = (fr.rotYDeg * Math.PI) / 180;
        planMesh.visible = false;
        planMesh.userData.pick = pick;
        fg.add(planMesh);
        pickables.push(planMesh);
      }
      const objects = (f.objects ?? []).map((o) => {
        const color = OBJECT_COLORS[o.type] ?? 0x444444;
        const g = new THREE.Group();
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), new THREE.MeshBasicMaterial({ color }));
        pin.position.y = 1.1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
        head.position.y = 2.4;
        g.add(pin, head);
        const [wx, wz] = frameToWorld(b.planFrame, o.u, o.v);
        g.position.set(wx, 0.3, wz);
        g.visible = false;
        pin.userData.pick = head.userData.pick = { type: "objekt", id: o.id, data: { ...o, building: b.id, level: f.level } };
        pickables.push(pin, head);
        fg.add(g);
        return g;
      });
      return { group: fg, wallMat, body, planMesh, objects };
    });
    const roofGroup = new THREE.Group();
    roofGroup.userData.baseY = b.floors.length * b.floorH;
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad, transparent: true });
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(b.polys.map(shapeOf), { depth: 0.5, bevelEnabled: false }).rotateX(-Math.PI / 2), roofMat);
    roof.castShadow = true;
    roof.userData.pick = { type: "dach", id: `${b.id}-dach`, data: { building: b.id, name: `${b.name} – Dach`, flaecheM2: area } };
    roofGroup.add(roof);
    pickables.push(roof);
    group.add(roofGroup);
    const c = b.pts.reduce((a, [x, z]) => [a[0] + x / b.pts.length, a[1] + z / b.pts.length], [0, 0]);
    const label = makeSign(b.id.startsWith("N") ? "·" : b.id, "#ffffff", "#1d2433", false);
    label.position.set(c[0], roofGroup.userData.baseY + 5, c[1]);
    label.userData.baseY = roofGroup.userData.baseY + 5;
    group.add(label);
    state.set(b.id, { b, group, floors, roofGroup, roofMat, label, area });
  }

  function makeSign(text, bg, fg, square) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = bg;
    g.beginPath();
    if (square) g.roundRect(8, 8, 112, 112, 18); else g.arc(64, 64, 54, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = square ? "#ffffff" : "#2b3240";
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = fg;
    g.font = `bold ${square ? 84 : 64}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 64, 70);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.scale.set(7, 7, 1);
    s.renderOrder = 10;
    return s;
  }

  // ---------- Ansicht ----------
  const view = { sel: null, level: null, explode: 0, roofs: true, site: true };
  function applyView() {
    for (const [id, st] of state) {
      const active = !view.sel || view.sel === id, isSel = view.sel === id;
      const fIdx = isSel && view.level ? st.b.floors.findIndex((f) => f.level === view.level) : -1;
      const gap = isSel ? view.explode : 0;
      st.floors.forEach((fl, i) => {
        fl.group.position.y = fl.group.userData.baseY + i * gap;
        fl.group.visible = !(fIdx >= 0 && i > fIdx);
        const open = i === fIdx;
        fl.wallMat.opacity = active ? (open ? 0.18 : 1) : 0.12;
        fl.wallMat.depthWrite = fl.wallMat.opacity > 0.9;
        fl.body.children[0].visible = active;
        if (fl.planMesh) fl.planMesh.visible = open;
        fl.objects.forEach((o) => (o.visible = open || (isSel && fIdx < 0 && view.explode > 0)));
      });
      const n = st.floors.length;
      st.roofGroup.position.y = st.roofGroup.userData.baseY + n * gap;
      st.roofGroup.visible = view.roofs && fIdx < 0;
      st.roofMat.opacity = active ? 1 : 0.15;
      st.label.position.y = st.label.userData.baseY + n * gap;
      st.label.visible = active;
    }
    siteGroup.visible = view.site;
    renderSide();
  }
  function focusOn(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(c);
    camera.position.copy(c).add(dir.multiplyScalar(Math.max(size * 1.4, 30)));
  }
  function select(id, level = null, focus = true) {
    view.sel = id; view.level = level;
    applyView();
    const st = id && state.get(id);
    if (!st) return showInfo(null);
    if (focus) focusOn(st.group);
    const f = level && st.b.floors.find((x) => x.level === level);
    showInfo(level
      ? { id: `${id}-${level}`, title: `${st.b.name} – ${levelName(level)}`, lines: [f?.plan ? "Grundriss vorhanden (1966)" : "Kein Grundriss vorhanden – innen leer", f?.objects?.length ? `${f.objects.length} Objekte aus dem Plan` : ""], note: f?.note }
      : { id, title: st.b.name, lines: [`${st.b.floors.length} Ebene(n)`, `Grundfläche ca. ${st.area} m²`], note: st.b.note });
  }
  function showInfo(s) {
    if (!s) return info.replaceChildren();
    const el = document.createElement("div");
    const b = document.createElement("b"); b.textContent = s.title; el.append(b);
    s.lines.filter(Boolean).forEach((l) => { const d = document.createElement("div"); d.textContent = l; el.append(d); });
    if (s.note) { const sm = document.createElement("small"); sm.textContent = s.note; el.append(sm); }
    const idl = document.createElement("small"); idl.style.opacity = ".7"; idl.textContent = `ID: ${s.id}`; el.append(idl);
    info.replaceChildren(el);
  }
  function renderSide() {
    side.replaceChildren();
    const h = (t) => Object.assign(document.createElement("h3"), { textContent: t });
    const r1 = document.createElement("div"); r1.className = "ct-row";
    const range = Object.assign(document.createElement("input"), { type: "range", min: 0, max: 12, step: 0.5, value: view.explode, disabled: !view.sel });
    range.oninput = () => { view.explode = +range.value; applyView(); };
    r1.append(Object.assign(document.createElement("label"), { textContent: "Ebenen spreizen" }), range);
    const r2 = document.createElement("div"); r2.className = "ct-row";
    const tg = (k, t) => { const l = document.createElement("label"); const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: view[k] }); cb.onchange = () => { view[k] = cb.checked; applyView(); }; l.append(cb, " " + t); return l; };
    r2.append(tg("roofs", "Dächer"), tg("site", "Umgebung"));
    const r3 = document.createElement("div"); r3.className = "ct-row";
    const all = Object.assign(document.createElement("button"), { className: "ct-btn", textContent: "Gesamtansicht" });
    all.onclick = () => { view.explode = 0; select(null); resetCamera(); };
    r3.append(all);
    side.append(h("Ansicht"), r1, r2, r3, h("Gebäude"));
    buildings.forEach((b, i) => {
      const btn = document.createElement("button");
      btn.className = "ct-trakt" + (view.sel === b.id ? " on" : "");
      const dot = Object.assign(document.createElement("span"), { className: "ct-dot" });
      dot.style.background = "#" + b.color.toString(16).padStart(6, "0");
      btn.append(dot, b.name);
      btn.onclick = () => select(view.sel === b.id && !view.level ? null : b.id);
      side.append(btn);
      if (view.sel === b.id) {
        const fw = document.createElement("div"); fw.className = "ct-floors";
        [...b.floors].reverse().forEach((f) => {
          const fb = document.createElement("button");
          fb.textContent = f.level.replace("OG", ". OG").replace("Ebene ", "E");
          fb.className = (view.level === f.level ? "on " : "") + (f.plan ? "plan" : "");
          fb.onclick = () => select(b.id, view.level === f.level ? null : f.level, false);
          fw.append(fb);
        });
        side.append(fw);
      }
    });
    const lg = document.createElement("div"); lg.className = "ct-legend";
    for (const [k, c] of Object.entries(OBJECT_COLORS)) { const s = document.createElement("span"); const i = document.createElement("i"); i.style.background = "#" + c.toString(16).padStart(6, "0"); s.append(i, OBJECT_LABELS[k]); lg.append(s); }
    side.append(h("Legende"), lg, Object.assign(document.createElement("div"), { className: "ct-note", textContent: `▦ = Grundriss vorhanden. Umrisse von oben aus OpenStreetMap; Trakt-Grenzen innerhalb des Hauptgebäudes und Stockwerkszahlen nach dem Gebäudeplan der Schulwebseite (geschätzt). Trakt ${NOT_IN_MAP.join(" und ")} sind in den Kartendaten nicht enthalten und deshalb nicht gezeichnet. Objekte nur, wenn sie im Plan eingezeichnet sind. Kartendaten © OpenStreetMap-Mitwirkende.` }));
  }

  // ---------- Klick ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...pickables, ...siteGroup.children], true).find((h) => h.object.userData.pick && shown(h.object) && !(h.object.material?.opacity < 0.3));
    if (!hit) return;
    const s = hit.object.userData.pick;
    if (s.type === "stockwerk") { if (view.sel !== s.data.building) select(s.data.building); else select(s.data.building, s.data.level, false); }
    else if (s.type === "dach") { select(s.data.building); showInfo({ id: s.id, title: s.data.name, lines: [`Fläche ca. ${s.data.flaecheM2} m² (aus Grundriss-Umriss)`], note: "Dachform und Belegung sind in Plänen + OSM nicht erfasst." }); }
    else if (s.type === "objekt") showInfo({ id: s.id, title: s.data.name, lines: [`${OBJECT_LABELS[s.data.type]} · ${levelName(s.data.level)}`, `Quelle: ${s.data.source}`], note: "Position aus Plan abgelesen" });
    else showInfo({ id: s.id, title: s.data.name, lines: [], note: s.data.note });
    emit("select", s);
  });
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

  // ---------- Loop ----------
  const resize = () => { const w = canvasWrap.clientWidth || 600, hh = canvasWrap.clientHeight || 480; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(canvasWrap); resize();
  let raf = 0;
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  applyView();
  return {
    select,
    on(n, fn) { (listeners[n] ??= []).push(fn); return () => (listeners[n] = listeners[n].filter((f) => f !== fn)); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); container.replaceChildren(); },
  };
}
