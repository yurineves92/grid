// Renderizador 3D do Space Paranoids (Three.js + bloom).
// A lógica do jogo continua num plano 2D; aqui só desenhamos:
// x do jogo -> x, y do jogo -> z, altura -> y.
const SP3D = (() => {
  function supported() {
    if (!window.THREE) return false;
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      return false;
    }
  }

  function create({ W, H, TILE, COLS, ROWS, wallColor, mount, spawns, playerSpawn }) {
    const T = THREE;
    const WALL_H = 30;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    const renderer = new T.WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.75));
    renderer.setClearColor(0x010308, 1);
    const canvas = renderer.domElement;
    canvas.className = 'gl-canvas';
    mount.prepend(canvas);

    const scene = new T.Scene();
    scene.fog = new T.Fog(0x010308, 700, 1700);
    const camera = new T.PerspectiveCamera(50, W / H, 5, 5000);
    const X = x => x - W / 2;
    const Z = y => y - H / 2;

    // Pós-processamento: bloom dá o brilho neon. Sem ele, renderiza direto.
    let composer = null;
    if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass && T.ShaderPass && T.CopyShader) {
      composer = new T.EffectComposer(renderer);
      composer.addPass(new T.RenderPass(scene, camera));
      composer.addPass(new T.UnrealBloomPass(new T.Vector2(W, H), 1.15, 0.5, 0.1));
    }

    const colorCache = new Map();
    const col = c => { let v = colorCache.get(c); if (!v) { v = new T.Color(c); colorCache.set(c, v); } return v; };

    /* ---------- chão ---------- */
    const floor = new T.Mesh(new T.PlaneGeometry(W, H), new T.MeshBasicMaterial({ color: 0x010309 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const gp = [], gc = [];
    const major = new T.Color(0x1650a8), minor = new T.Color(0x08204a);
    const gline = (x1, z1, x2, z2, c) => { gp.push(x1, 0.3, z1, x2, 0.3, z2); gc.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    for (let x = 0; x <= W; x += TILE / 2) gline(X(x), Z(0), X(x), Z(H), x % TILE === 0 ? major : minor);
    for (let y = 0; y <= H; y += TILE / 2) gline(X(0), Z(y), X(W), Z(y), y % TILE === 0 ? major : minor);
    const gridGeo = new T.BufferGeometry();
    gridGeo.setAttribute('position', new T.Float32BufferAttribute(gp, 3));
    gridGeo.setAttribute('color', new T.Float32BufferAttribute(gc, 3));
    scene.add(new T.LineSegments(gridGeo, new T.LineBasicMaterial({ vertexColors: true })));

    const outer = new T.GridHelper(4000, 50, 0x0b2448, 0x07162e);
    outer.position.y = -0.5;
    scene.add(outer);

    const ringMat = (c, o) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: T.DoubleSide, depthWrite: false });
    for (const s of spawns) {
      const r = new T.Mesh(new T.RingGeometry(14, 17, 32), ringMat(0xff3b3b, 0.45));
      r.rotation.x = -Math.PI / 2; r.position.set(X(s.x), 0.6, Z(s.y));
      scene.add(r);
    }
    {
      const r = new T.Mesh(new T.RingGeometry(16, 19, 32), ringMat(0x00e5ff, 0.5));
      r.rotation.x = -Math.PI / 2; r.position.set(X(playerSpawn.x), 0.6, Z(playerSpawn.y));
      scene.add(r);
    }

    /* ---------- paredes ---------- */
    let wallGroup = null;
    let curMap = null;
    const wallAt = (x, y) => {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || (curMap && curMap[ty * COLS + tx] === 1);
    };
    function dispose(obj) {
      obj.traverse(o => {
        if (o.userData && o.userData.shared) return;
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }

    function buildMap(map) {
      if (wallGroup) { scene.remove(wallGroup); dispose(wallGroup); }
      wallGroup = new T.Group();
      curMap = map;
      const isWall = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || map[ty * COLS + tx] === 1;
      const tiles = [];
      for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) if (map[ty * COLS + tx] === 1) tiles.push([tx, ty]);

      const m = new T.Matrix4();
      const blocks = new T.InstancedMesh(new T.BoxGeometry(TILE, WALL_H, TILE), new T.MeshBasicMaterial({ color: 0x030f1c }), tiles.length);
      tiles.forEach(([tx, ty], i) => {
        m.makeTranslation(X(tx * TILE + TILE / 2), WALL_H / 2, Z(ty * TILE + TILE / 2));
        blocks.setMatrixAt(i, m);
      });
      wallGroup.add(blocks);

      // contornos: barras finas nas arestas expostas (o bloom faz o brilho)
      const bars = [];
      const posts = new Set();
      const edge = (x1, y1, x2, y2) => {
        bars.push([x1, y1, x2, y2, WALL_H]);
        bars.push([x1, y1, x2, y2, 0.8]);
        posts.add(`${x1},${y1}`); posts.add(`${x2},${y2}`);
      };
      for (const [tx, ty] of tiles) {
        const x = tx * TILE, y = ty * TILE;
        if (!isWall(tx, ty - 1)) edge(x, y, x + TILE, y);
        if (!isWall(tx, ty + 1)) edge(x, y + TILE, x + TILE, y + TILE);
        if (!isWall(tx - 1, ty)) edge(x, y, x, y + TILE);
        if (!isWall(tx + 1, ty)) edge(x + TILE, y, x + TILE, y + TILE);
      }
      const TH = 2.2;
      const n = bars.length + posts.size;
      const edges = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: wallColor }), n);
      const pos = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
      let i = 0;
      for (const [x1, y1, x2, y2, h] of bars) {
        pos.set(X((x1 + x2) / 2), h, Z((y1 + y2) / 2));
        sc.set(Math.abs(x2 - x1) + TH, TH, Math.abs(y2 - y1) + TH);
        edges.setMatrixAt(i++, m.compose(pos, q, sc));
      }
      for (const key of posts) {
        const [px, py] = key.split(',').map(Number);
        pos.set(X(px), WALL_H / 2, Z(py));
        sc.set(TH, WALL_H, TH);
        edges.setMatrixAt(i++, m.compose(pos, q, sc));
      }
      wallGroup.add(edges);
      scene.add(wallGroup);
    }

    /* ---------- fábricas de objetos ---------- */
    function edgeBox(w, h, d, line, fill) {
      const geo = new T.BoxGeometry(w, h, d);
      const mesh = new T.Mesh(geo, fill);
      mesh.add(new T.LineSegments(new T.EdgesGeometry(geo), line));
      return mesh;
    }

    function makeTank(color) {
      const c = new T.Color(color);
      const line = new T.LineBasicMaterial({ color: c.clone() });
      const fill = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.13) });
      const glow = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.55) });
      const g = new T.Group();
      const body = edgeBox(24, 9, 18, line, fill); body.position.y = 9; g.add(body);
      for (const s of [-1, 1]) { const tr = edgeBox(30, 7, 6, line, glow); tr.position.set(0, 4, s * 11); g.add(tr); }
      const nose = edgeBox(6, 5, 12, line, fill); nose.position.set(13, 8, 0); g.add(nose);
      const turret = new T.Group(); turret.position.y = 14; g.add(turret);
      const domeGeo = new T.CylinderGeometry(6, 7.5, 6, 10);
      const dome = new T.Mesh(domeGeo, fill);
      dome.add(new T.LineSegments(new T.EdgesGeometry(domeGeo), line));
      turret.add(dome);
      const barrel = edgeBox(18, 3, 3, line, glow); barrel.position.set(12, 1, 0); turret.add(barrel);
      g.userData.turret = turret;
      g.userData.lines = [line, glow];
      g.userData.base = [c.clone(), c.clone().multiplyScalar(0.55)];
      return g;
    }

    function makeRec(color) {
      const c = new T.Color(color);
      const line = new T.LineBasicMaterial({ color: c.clone() });
      const fill = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.16) });
      const glow = new T.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.7) });
      const g = new T.Group();
      const body = new T.Group(); g.add(body);
      const bar = edgeBox(66, 12, 16, line, fill); bar.position.y = 66; body.add(bar);
      const strip = new T.Mesh(new T.BoxGeometry(58, 2, 17), glow); strip.position.y = 61; body.add(strip);
      for (const s of [-1, 1]) {
        const leg = edgeBox(12, 40, 16, line, fill); leg.position.set(s * 27, 40, 0); body.add(leg);
        const foot = new T.Mesh(new T.BoxGeometry(13, 2, 17), glow); foot.position.set(s * 27, 20, 0); body.add(foot);
      }
      const head = edgeBox(20, 10, 12, line, fill); head.position.y = 55; body.add(head);
      const shadow = new T.Mesh(new T.RingGeometry(24, 30, 40), ringMat(c, 0.35));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.7;
      g.add(shadow);
      g.userData.body = body;
      g.userData.lines = [line, glow];
      g.userData.base = [c.clone(), c.clone().multiplyScalar(0.7)];
      return g;
    }

    const bulletGeo = new T.SphereGeometry(1, 10, 8);
    const basicCache = new Map();
    const basic = c => { let m = basicCache.get(c); if (!m) { m = new T.MeshBasicMaterial({ color: c }); basicCache.set(c, m); } return m; };
    function makeBullet(color) {
      const mesh = new T.Mesh(bulletGeo, basic(color));
      mesh.userData.shared = true;
      return mesh;
    }

    const PICK_GEO = {
      shield: new T.OctahedronGeometry(10),
      rapid: new T.TetrahedronGeometry(11),
      life: new T.BoxGeometry(13, 13, 13),
    };
    function makePickup(type, color) {
      const g = new T.Group();
      const geo = PICK_GEO[type];
      const inner = new T.Mesh(geo.clone(), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(0.25) }));
      inner.add(new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color })));
      g.add(inner);
      g.userData.inner = inner;
      return g;
    }

    function makeSpawnFx(color) {
      const g = new T.Group();
      const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false });
      const beam = new T.Mesh(new T.CylinderGeometry(2.5, 2.5, 1, 8), mat);
      g.add(beam);
      const ring = new T.Mesh(new T.RingGeometry(0.85, 1, 32), mat.clone());
      ring.material.side = T.DoubleSide;
      ring.rotation.x = -Math.PI / 2; ring.position.y = 1;
      g.add(ring);
      g.userData.beam = beam; g.userData.ring = ring;
      return g;
    }

    function makePlayerExtras() {
      const g = new T.Group();
      const shield = new T.Mesh(new T.SphereGeometry(24, 18, 12),
        new T.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.35 }));
      shield.position.y = 10;
      g.add(shield);
      const aimGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(24, 13, 0), new T.Vector3(170, 13, 0)]);
      const aim = new T.Line(aimGeo, new T.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.35 }));
      g.add(aim);
      g.userData.shield = shield; g.userData.aim = aim;
      return g;
    }

    /* ---------- partículas ---------- */
    const MAXP = 4000;
    const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
    const points = new T.Points(pGeo, new T.PointsMaterial({
      size: 4, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    points.frustumCulled = false;
    scene.add(points);

    /* ---------- sincronização com o estado do jogo ---------- */
    const live = new Map();
    let frame = 0;
    function obtain(key, factory) {
      let o = live.get(key);
      if (!o) { o = factory(); scene.add(o); live.set(key, o); }
      o.userData.frame = frame;
      return o;
    }
    const keyOf = (obj, name) => (obj[name] || (obj[name] = {}));

    function tint(o, flash) {
      const [a, b] = o.userData.lines, [ba, bb] = o.userData.base;
      if (flash) { a.color.setRGB(1, 1, 1); b.color.setRGB(1, 1, 1); }
      else { a.color.copy(ba); b.color.copy(bb); }
    }

    /* ---------- câmera ---------- */
    const camPos = new T.Vector3(0, 600, 500), camLook = new T.Vector3();
    const tmpPos = new T.Vector3(), tmpLook = new T.Vector3();
    let camReady = false;

    function updateCamera(v, dt) {
      const p = v.player;
      if (v.mode === 'menu') {
        const a = v.time * 0.12;
        tmpPos.set(Math.cos(a) * 640, 420, Math.sin(a) * 520);
        tmpLook.set(0, 0, 0);
      } else if (v.cam === 'chase' && p && p.alive) {
        // atrás do tanque; se houver parede no caminho, a câmera chega mais perto e sobe
        const a = p.angle, ca = Math.cos(a), sa = Math.sin(a);
        let d = 135;
        for (let t = 8; t <= 135; t += 4) {
          if (wallAt(p.x - ca * t, p.y - sa * t)) { d = Math.max(26, t - 14); break; }
        }
        const h = 70 + (135 - d) * 0.75;
        const ahead = 40 + d * 0.7; // mais perto = olha mais para baixo, para o tanque continuar no quadro
        tmpPos.set(X(p.x) - ca * d, h, Z(p.y) - sa * d);
        tmpLook.set(X(p.x) + ca * ahead, 4, Z(p.y) + sa * ahead);
      } else {
        let tx = 0, tz = 0;
        if (p && p.alive) {
          tx = Math.max(-W / 2 + 280, Math.min(W / 2 - 280, X(p.x)));
          tz = Math.max(-H / 2 + 170, Math.min(H / 2 - 170, Z(p.y)));
        }
        tmpLook.set(tx, 0, tz - 20);
        tmpPos.set(tx, 540, tz + 250);
      }
      const f = camReady ? 1 - Math.exp(-dt * (v.cam === 'chase' ? 6 : 4)) : 1;
      camPos.lerp(tmpPos, f);
      camLook.lerp(tmpLook, f);
      camReady = true;
      camera.position.copy(camPos);
      if (v.shake) {
        camera.position.x += (Math.random() - 0.5) * v.shake;
        camera.position.y += (Math.random() - 0.5) * v.shake;
      }
      camera.lookAt(camLook);
    }

    /* ---------- render ---------- */
    function render(v) {
      frame++;
      const t = v.time, dt = Math.min(0.05, v.dt || 0.016);

      const p = v.player;
      if (p && p.alive) {
        const tank = obtain(p, () => makeTank(v.playerColor));
        tank.position.set(X(p.x), 0, Z(p.y));
        tank.rotation.y = -p.angle;
        tank.userData.turret.rotation.y = -(p.turret - p.angle);
        tank.visible = !(p.inv > 0 && Math.floor(t * 12) % 2);
        tint(tank, false);
        const ex = obtain(keyOf(p, '_fx3d'), makePlayerExtras);
        ex.position.set(X(p.x), 0, Z(p.y));
        ex.userData.shield.visible = p.shield > 0;
        ex.userData.shield.rotation.y = t;
        ex.userData.aim.rotation.y = -p.turret;
        ex.userData.aim.visible = v.mode !== 'menu';
      }

      for (const e of v.enemies) {
        const color = v.etypes[e.type].color;
        if (e.spawnT > 0) {
          const fx = obtain(keyOf(e, '_spawn3d'), () => makeSpawnFx(color));
          const k = 1 - Math.max(0, e.spawnT) / 1.1;
          fx.position.set(X(e.x), 0, Z(e.y));
          fx.userData.beam.scale.y = 10 + 160 * k;
          fx.userData.beam.position.y = (10 + 160 * k) / 2;
          const rr = 6 + ((k * 3) % 1) * 30;
          fx.userData.ring.scale.set(rr, rr, rr);
          fx.userData.ring.material.opacity = 1 - rr / 40;
          continue;
        }
        if (e.type === 'rec') {
          const o = obtain(e, () => makeRec(color));
          o.position.set(X(e.x), 0, Z(e.y));
          o.rotation.y = -(e.angle + Math.PI / 2);
          o.userData.body.position.y = Math.sin(t * 2.4 + e.wobble) * 5;
          tint(o, e.flash > 0);
        } else {
          const o = obtain(e, () => makeTank(color));
          const s = e.r / 14;
          o.scale.set(s, s, s);
          o.position.set(X(e.x), 0, Z(e.y));
          o.rotation.y = -e.angle;
          o.userData.turret.rotation.y = -(e.turret - e.angle);
          tint(o, e.flash > 0);
        }
      }

      for (const b of v.bullets) {
        const o = obtain(b, () => makeBullet(b.color));
        o.position.set(X(b.x), 12, Z(b.y));
        o.scale.setScalar(b.r);
      }

      for (const u of v.pickups) {
        const c = v.pickupTypes[u.type].color;
        const o = obtain(u, () => makePickup(u.type, c));
        o.position.set(X(u.x), 16 + Math.sin(t * 3 + u.x) * 3, Z(u.y));
        o.userData.inner.rotation.set(t * 0.7, t * 1.6, 0);
        o.visible = !(u.life < 3 && Math.floor(t * 8) % 2);
      }

      for (const [key, o] of live) {
        if (o.userData.frame !== frame) { scene.remove(o); dispose(o); live.delete(key); }
      }

      const ps = v.particles;
      const n = Math.min(ps.length, MAXP);
      for (let i = 0; i < n; i++) {
        const q = ps[i];
        const a = Math.max(0, q.life / q.max);
        const c = col(q.color);
        pPos[i * 3] = X(q.x); pPos[i * 3 + 1] = q.h || 8; pPos[i * 3 + 2] = Z(q.y);
        pCol[i * 3] = c.r * a; pCol[i * 3 + 1] = c.g * a; pCol[i * 3 + 2] = c.b * a;
      }
      pGeo.setDrawRange(0, n);
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      updateCamera(v, dt);
      if (composer) composer.render(); else renderer.render(scene, camera);
    }

    function resize(w, h) {
      renderer.setSize(w, h, false);
      if (composer) composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    const raycaster = new T.Raycaster();
    const aimPlane = new T.Plane(new T.Vector3(0, 1, 0), -12);
    const hit = new T.Vector3(), ndc = new T.Vector2();
    function pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return null;
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(aimPlane, hit)) return null;
      return { x: hit.x + W / 2, y: hit.z + H / 2 };
    }

    function setVisible(on) { canvas.style.display = on ? '' : 'none'; }
    function resetCamera() { camReady = false; }

    return { buildMap, render, resize, pick, setVisible, resetCamera };
  }

  return { supported, create };
})();
