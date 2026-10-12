(() => {
  'use strict';

  const TILE = 40, COLS = 24, ROWS = 16;
  const W = COLS * TILE, H = ROWS * TILE; // 960 x 640
  const TAU = Math.PI * 2;
  const PLAYER_SPEED = 165;
  const PLAYER_COLOR = '#00e5ff';
  const WALL_COLOR = '#2fa8ff';

  const PLAYER_SPAWN = { x: W / 2, y: (ROWS - 2) * TILE + TILE / 2 };
  const ENEMY_SPAWNS = [
    { x: 100, y: 100 }, { x: W - 100, y: 100 }, { x: W / 2, y: 100 },
    { x: 60, y: 320 }, { x: W - 60, y: 320 },
  ];

  const ETYPES = {
    tank:   { r: 14, hp: 1, speed: 75,  fireRate: 1.9, bulletSpeed: 250, bounces: 0, color: '#ff3b3b', score: 100, turn: 2.2 },
    elite:  { r: 15, hp: 2, speed: 95,  fireRate: 1.2, bulletSpeed: 300, bounces: 1, color: '#ffb300', score: 250, turn: 3.2 },
    hunter: { r: 12, hp: 1, speed: 135, fireRate: 2.3, bulletSpeed: 280, bounces: 0, color: '#ff2bd6', score: 200, turn: 3.0 },
    rec:    { r: 26, hp: 6, speed: 52,  color: '#ff6a1f', score: 500 },
  };
  const PICKUPS = {
    shield: { color: '#00e5ff', label: 'S' },
    rapid:  { color: '#ffe600', label: 'R' },
    life:   { color: '#39ff14', label: '+' },
  };
  const SHAPES = [
    [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1]], [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [3, 0]],
  ];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const panels = {
    menu: document.getElementById('menuPanel'),
    pause: document.getElementById('pausePanel'),
    over: document.getElementById('overPanel'),
  };
  const hud = {
    score: document.getElementById('hScore'),
    hi: document.getElementById('hHi'),
    level: document.getElementById('hLevel'),
    lives: document.getElementById('hLives'),
    status: document.getElementById('hStatus'),
  };

  let k = 1, bg = null;
  let map = new Uint8Array(COLS * ROWS);
  let state = 'menu', pausedFrom = null, stateT = 0;
  let level = 1, score = 0, lives = 3, maxActive = 3;
  let hiscore = parseInt(Grid.store.get('sp_hi', '0'), 10) || 0;
  let player, enemies = [], bullets = [], particles = [], pickups = [], pending = [];
  let spawnTimer = 0, shake = 0, time = 0, msg = null;
  let lastHud = '';

  const stage = document.getElementById('stage');
  const joyL = new VJoy(document.getElementById('joyL'));
  const joyR = new VJoy(document.getElementById('joyR'));
  const btnFire = Grid.holdButton(document.getElementById('btnFire'));
  let prevStart = false;

  const keys = new Set();
  const mouse = { x: W / 2, y: H / 2, active: false, down: false };
  let joy = null, touchAim = null, manualAimT = 99;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const rotateToward = (a, target, step) => { const d = angDiff(a, target); return Math.abs(d) <= step ? target : a + Math.sign(d) * step; };

  /* ---------------- mapa ---------------- */

  const isWall = (tx, ty) => tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || map[ty * COLS + tx] === 1;
  const wallAt = (px, py) => isWall(Math.floor(px / TILE), Math.floor(py / TILE));
  const tileOf = p => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });

  function inClear(x, y) {
    if (x >= 10 && x <= 13 && (y <= 3 || y >= 12)) return true;
    if ((x <= 3 || x >= 20) && (y <= 3 || y >= 12)) return true;
    if ((x <= 2 || x >= 21) && y >= 6 && y <= 9) return true;
    return false;
  }

  function reachable(m, start) {
    const seen = new Uint8Array(COLS * ROWS);
    const q = [start.y * COLS + start.x];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const n = ny * COLS + nx;
        if (m[n] || seen[n]) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    return seen;
  }

  // Labirinto simétrico (espelhado nos 4 quadrantes) com áreas de spawn livres.
  function genMap(L) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const m = new Uint8Array(COLS * ROWS);
      for (let x = 0; x < COLS; x++) { m[x] = 1; m[(ROWS - 1) * COLS + x] = 1; }
      for (let y = 0; y < ROWS; y++) { m[y * COLS] = 1; m[y * COLS + COLS - 1] = 1; }
      const pieces = Math.max(2, 5 + Math.min(L, 5) - (attempt >> 3));
      for (let i = 0; i < pieces; i++) {
        const sh = pick(SHAPES);
        const ox = 2 + ((Math.random() * 10) | 0), oy = 2 + ((Math.random() * 6) | 0);
        for (const [dx, dy] of sh) {
          const x = ox + dx, y = oy + dy;
          if (x >= COLS / 2 || y >= ROWS / 2) continue;
          for (const [mx, my] of [[x, y], [COLS - 1 - x, y], [x, ROWS - 1 - y], [COLS - 1 - x, ROWS - 1 - y]]) {
            if (!inClear(mx, my)) m[my * COLS + mx] = 1;
          }
        }
      }
      const seen = reachable(m, tileOf(PLAYER_SPAWN));
      if (!ENEMY_SPAWNS.every(s => { const t = tileOf(s); return seen[t.y * COLS + t.x]; })) continue;
      for (let i = 0; i < m.length; i++) if (!m[i] && !seen[i]) m[i] = 1; // fecha bolsões inalcançáveis
      return m;
    }
    const m = new Uint8Array(COLS * ROWS);
    for (let x = 0; x < COLS; x++) { m[x] = 1; m[(ROWS - 1) * COLS + x] = 1; }
    for (let y = 0; y < ROWS; y++) { m[y * COLS] = 1; m[y * COLS + COLS - 1] = 1; }
    return m;
  }

  function bfsPath(s, g) {
    if (isWall(g.x, g.y) || isWall(s.x, s.y)) return [];
    const N = COLS * ROWS;
    const prev = new Int16Array(N).fill(-1);
    const si = s.y * COLS + s.x, gi = g.y * COLS + g.x;
    if (si === gi) return [];
    prev[si] = si;
    const q = [si];
    for (let h = 0; h < q.length && prev[gi] === -1; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (isWall(nx, ny)) continue;
        const n = ny * COLS + nx;
        if (prev[n] !== -1) continue;
        prev[n] = c;
        q.push(n);
      }
    }
    if (prev[gi] === -1) return [];
    const path = [];
    for (let c = gi; c !== si; c = prev[c]) path.push({ x: c % COLS, y: (c / COLS) | 0 });
    return path.reverse();
  }

  function randomOpenTile() {
    for (let i = 0; i < 200; i++) {
      const x = (Math.random() * COLS) | 0, y = (Math.random() * ROWS) | 0;
      if (!isWall(x, y)) return { x, y };
    }
    return tileOf(PLAYER_SPAWN);
  }

  function hasLOS(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (wallAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  function circleHitsWall(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isWall(tx, ty)) continue;
        const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
        const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  function moveCircle(e, dx, dy) {
    if (dx && !circleHitsWall(e.x + dx, e.y, e.r)) e.x += dx;
    if (dy && !circleHitsWall(e.x, e.y + dy, e.r)) e.y += dy;
  }

  /* ---------------- fluxo do jogo ---------------- */

  function makePlayer() {
    return {
      x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, r: 13, vx: 0, vy: 0,
      angle: -Math.PI / 2, turret: -Math.PI / 2,
      fireCd: 0, alive: true, inv: 2.5, shield: 0, rapid: 0, respawnT: 0,
    };
  }

  function buildWave(L) {
    const list = [];
    const total = Math.min(3 + L, 14);
    for (let i = 0; i < total; i++) {
      const r = Math.random();
      if (L >= 3 && r < Math.min(0.15 + L * 0.05, 0.5)) list.push('elite');
      else if (L >= 5 && r > 0.8) list.push('hunter');
      else list.push('tank');
    }
    const recs = L >= 2 ? Math.min(Math.floor(L / 2), 4) : 0;
    for (let i = 0; i < recs; i++) {
      const at = 2 + ((Math.random() * (list.length - 1)) | 0);
      list.splice(at, 0, 'rec');
    }
    return list;
  }

  function startAttract() {
    state = 'menu';
    map = genMap(3);
    buildBg();
    player = makePlayer();
    player.alive = false;
    enemies = []; bullets = []; particles = []; pickups = []; pending = [];
    msg = null;
    for (let i = 0; i < 4; i++) {
      const s = ENEMY_SPAWNS[i];
      enemies.push(makeEnemy(i === 3 ? 'rec' : pick(['tank', 'elite', 'hunter']), s.x, s.y, 0));
    }
    updateHud();
    showPanel('menu');
  }

  function startGame() {
    level = 1; score = 0; lives = 3;
    startLevel();
  }

  function startLevel() {
    map = genMap(level);
    buildBg();
    player = makePlayer();
    enemies = []; bullets = []; particles = []; pickups = [];
    pending = buildWave(level);
    maxActive = Math.min(2 + Math.ceil(level / 2), 6);
    spawnTimer = 0.5;
    state = 'intro';
    stateT = 2;
    const hasRec = pending.includes('rec');
    msg = {
      text: `SETOR ${level}`,
      sub: level === 1 ? 'destrua todos os tanques inimigos' : hasRec ? 'alerta: Recognizers detectados' : `${pending.length} inimigos`,
      color: '#ff8a00', t: 0, dur: 2.2,
    };
    Sfx.beep(false);
    showPanel(null);
    updateHud();
  }

  function levelClear() {
    state = 'clear';
    stateT = 3;
    const bonus = 500 * level;
    score += bonus;
    bullets = bullets.filter(b => b.owner === 'p');
    msg = { text: 'SETOR LIMPO', sub: `bônus +${bonus}`, color: '#39ff14', t: 0, dur: 3 };
    Sfx.win();
  }

  function gameOver() {
    state = 'gameover';
    const record = score > hiscore;
    if (record) { hiscore = score; Grid.store.set('sp_hi', hiscore); }
    document.getElementById('overScore').textContent = score.toLocaleString('pt-BR');
    document.getElementById('overInfo').textContent = `Você chegou ao setor ${level}. Recorde: ${hiscore.toLocaleString('pt-BR')}.`;
    document.getElementById('overRecord').hidden = !record;
    Sfx.lose();
    updateHud();
    showPanel('over');
  }

  function respawn() {
    player = makePlayer();
    player.inv = 3;
    bullets = bullets.filter(b => b.owner === 'p' || dist(b, player) > 180);
  }

  function hurtPlayer() {
    const p = player;
    if (!p.alive || p.inv > 0) return;
    if (p.shield > 0) {
      p.shield = 0;
      p.inv = 1;
      burst(p.x, p.y, PLAYER_COLOR, 24, 200);
      Sfx.shield();
      return;
    }
    p.alive = false;
    p.respawnT = 2.2;
    lives--;
    burst(p.x, p.y, PLAYER_COLOR, 70, 300);
    burst(p.x, p.y, '#ffffff', 20, 150);
    shake = 16;
    Sfx.explode();
  }

  /* ---------------- inimigos ---------------- */

  function makeEnemy(type, x, y, spawnT = 1.1) {
    const t = ETYPES[type];
    const hp = t.hp + (type === 'rec' ? Math.floor(level / 3) : 0);
    return {
      type, x, y, r: t.r, hp, maxHp: hp,
      angle: Math.PI / 2, turret: Math.PI / 2,
      fireCd: 1 + Math.random() * (t.fireRate || 1),
      path: [], pathT: Math.random() * 0.5, spawnT, flash: 0,
      strafeT: 0, strafeDir: 1, stuckT: 0, wobble: Math.random() * TAU,
    };
  }

  function spawnEnemy(type) {
    const pts = ENEMY_SPAWNS.filter(s => dist(s, player) > 220 && !enemies.some(e => dist(e, s) < 44));
    if (!pts.length) return false;
    const s = pick(pts);
    enemies.push(makeEnemy(type, s.x, s.y));
    Sfx.materialize();
    return true;
  }

  function updateEnemies(dt) {
    const target = player && player.alive ? player : null;
    for (const e of enemies) {
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      e.flash = Math.max(0, e.flash - dt);
      const t = ETYPES[e.type];

      if (e.type === 'rec') {
        const goal = target || { x: W / 2 + Math.cos(time * 0.4 + e.wobble) * 300, y: H / 2 + Math.sin(time * 0.6 + e.wobble) * 200 };
        const a = Math.atan2(goal.y - e.y, goal.x - e.x);
        e.angle = rotateToward(e.angle, a, 1.3 * dt);
        const sp = t.speed + level * 3;
        e.x = Math.max(e.r, Math.min(W - e.r, e.x + Math.cos(e.angle) * sp * dt));
        e.y = Math.max(e.r, Math.min(H - e.r, e.y + Math.sin(e.angle) * sp * dt));
        continue;
      }

      const los = target && hasLOS(e.x, e.y, target.x, target.y);
      const d = target ? dist(e, target) : Infinity;

      e.pathT -= dt;
      if (target && e.pathT <= 0) {
        e.pathT = 0.5 + Math.random() * 0.5;
        e.path = bfsPath(tileOf(e), tileOf(target));
      } else if (!target && (!e.path.length || e.pathT < -8)) {
        e.pathT = 0;
        e.path = bfsPath(tileOf(e), randomOpenTile());
      }

      let mvx = 0, mvy = 0;
      if (los && d < 260) {
        // mantém distância e anda de lado
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = 0.8 + Math.random() * 1.2; e.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        const a = Math.atan2(target.y - e.y, target.x - e.x) + e.strafeDir * Math.PI / 2;
        mvx = Math.cos(a); mvy = Math.sin(a);
        if (d < 150) { mvx -= Math.cos(a - e.strafeDir * Math.PI / 2); mvy -= Math.sin(a - e.strafeDir * Math.PI / 2); }
      } else if (e.path.length) {
        const wp = e.path[0];
        const wx = wp.x * TILE + TILE / 2, wy = wp.y * TILE + TILE / 2;
        if (Math.hypot(wx - e.x, wy - e.y) < 8) e.path.shift();
        else { mvx = wx - e.x; mvy = wy - e.y; }
      }

      if (mvx || mvy) {
        const desired = Math.atan2(mvy, mvx);
        e.angle = rotateToward(e.angle, desired, 5 * dt);
        if (Math.abs(angDiff(e.angle, desired)) < 0.8) {
          const ox = e.x, oy = e.y;
          moveCircle(e, Math.cos(e.angle) * t.speed * dt, Math.sin(e.angle) * t.speed * dt);
          const moved = Math.hypot(e.x - ox, e.y - oy);
          e.stuckT = moved < t.speed * dt * 0.3 ? e.stuckT + dt : 0;
          if (e.stuckT > 0.7) { e.stuckT = 0; e.path = []; e.pathT = 0; e.strafeDir *= -1; e.angle += rand(-1.5, 1.5); }
        }
      }

      // torre: mira com antecipação quando vê o jogador
      let aim = e.angle;
      if (los) {
        const lead = (d / t.bulletSpeed) * 0.6;
        aim = Math.atan2(target.y + target.vy * lead - e.y, target.x + target.vx * lead - e.x);
      }
      e.turret = rotateToward(e.turret, aim, t.turn * dt);
      e.fireCd -= dt;
      if (los && state === 'playing' && e.fireCd <= 0 && Math.abs(angDiff(e.turret, aim)) < 0.12 && d < 620) {
        if (fire('e', e, e.turret, t.bulletSpeed, t.color, t.bounces)) Sfx.enemyShoot();
        e.fireCd = t.fireRate * rand(0.8, 1.2) * Math.max(0.6, 1 - level * 0.03);
      }
    }
  }

  function hitEnemy(e) {
    e.hp--;
    e.flash = 0.12;
    const t = ETYPES[e.type];
    if (e.hp > 0) {
      burst(e.x, e.y, t.color, 10, 160);
      Sfx.hit();
      return;
    }
    score += t.score;
    burst(e.x, e.y, t.color, e.type === 'rec' ? 90 : 50, e.type === 'rec' ? 340 : 260);
    burst(e.x, e.y, '#ffffff', 14, 140);
    shake = Math.max(shake, e.type === 'rec' ? 14 : 7);
    Sfx.explode();
    enemies.splice(enemies.indexOf(e), 1);
    if (Math.random() < (e.type === 'rec' ? 0.6 : 0.14)) {
      const r = Math.random();
      pickups.push({ x: e.x, y: e.y, type: r < 0.12 ? 'life' : r < 0.56 ? 'shield' : 'rapid', life: 10 });
    }
  }

  /* ---------------- jogador, tiros, itens ---------------- */

  function fire(owner, from, angle, speed, color, bounces) {
    const tipX = from.x + Math.cos(angle) * 22, tipY = from.y + Math.sin(angle) * 22;
    if (wallAt(tipX, tipY) || !hasLOS(from.x, from.y, tipX, tipY)) {
      burst(tipX, tipY, color, 4, 60);
      return false;
    }
    bullets.push({
      x: tipX, y: tipY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: owner === 'p' ? 3.5 : 4, owner, bounces, life: 2.6, color,
    });
    return true;
  }

  function updatePlayer(dt) {
    const p = player;
    if (!p.alive) return;
    p.inv = Math.max(0, p.inv - dt);
    p.rapid = Math.max(0, p.rapid - dt);
    p.fireCd -= dt;

    let mx = 0, my = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    if (joy) {
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
      if (d > 8) { const m = Math.min(1, d / 60); mx = dx / d * m; my = dy / d * m; }
    }
    if (joyL.mag > 0.15) { mx = joyL.x; my = joyL.y; }
    const g = Grid.gamepad(0);
    if (g && (g.lx || g.ly)) { mx = g.lx; my = g.ly; }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    const ox = p.x, oy = p.y;
    if (mx || my) {
      p.angle = rotateToward(p.angle, Math.atan2(my, mx), 10 * dt);
      moveCircle(p, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt);
    }
    if (dt > 0) { p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt; }

    let firing = keys.has('Space') || mouse.down || btnFire.down || !!(g && (g.rt || g.rb || g.a));
    const padAim = g && Math.hypot(g.rx, g.ry) > 0.35;
    if (joyR.mag > 0.3 || padAim) {
      // joystick de mira: aponta a torre e atira enquanto estiver inclinado
      const ax = joyR.mag > 0.3 ? joyR.x : g.rx, ay = joyR.mag > 0.3 ? joyR.y : g.ry;
      p.turret = rotateToward(p.turret, Math.atan2(ay, ax), 16 * dt);
      if (Math.hypot(ax, ay) > 0.55) firing = true;
      mouse.active = false;
      manualAimT = 0;
    } else if (touchAim) {
      p.turret = rotateToward(p.turret, Math.atan2(touchAim.y - p.y, touchAim.x - p.x), 14 * dt);
      firing = true;
    } else if (mouse.active) {
      p.turret = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    } else {
      const q = keys.has('KeyQ'), e = keys.has('KeyE');
      if (q) { p.turret -= 3.6 * dt; manualAimT = 0; }
      if (e) { p.turret += 3.6 * dt; manualAimT = 0; }
      manualAimT += dt;
      if (!q && !e && manualAimT > 1.2 && (mx || my)) p.turret = rotateToward(p.turret, Math.atan2(my, mx), 7 * dt);
    }

    if (firing && p.fireCd <= 0) {
      const maxB = p.rapid > 0 ? 8 : 4;
      if (bullets.filter(b => b.owner === 'p').length < maxB && fire('p', p, p.turret, 460, '#9ff6ff', 1)) {
        p.fireCd = p.rapid > 0 ? 0.11 : 0.3;
        Sfx.shoot();
      } else {
        p.fireCd = 0.05;
      }
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.life -= dt;
      let nx = b.x + b.vx * dt;
      if (wallAt(nx, b.y)) { b.vx = -b.vx; b.bounces--; nx = b.x; if (b.bounces >= 0) Sfx.bounce(); }
      let ny = b.y + b.vy * dt;
      if (wallAt(nx, ny)) { b.vy = -b.vy; b.bounces--; ny = b.y; if (b.bounces >= 0) Sfx.bounce(); }
      b.x = nx; b.y = ny;
      if (b.bounces < 0 || b.life <= 0) { b.dead = true; burst(b.x, b.y, b.color, 6, 90); }
    }
    bullets = bullets.filter(b => !b.dead);
  }

  function updatePickups(dt) {
    for (const u of pickups) {
      u.life -= dt;
      if (player.alive && dist(u, player) < player.r + 12) {
        u.life = 0;
        Sfx.pickup();
        burst(u.x, u.y, PICKUPS[u.type].color, 16, 120);
        if (u.type === 'shield') player.shield = 1;
        else if (u.type === 'rapid') player.rapid = 8;
        else lives = Math.min(lives + 1, 6);
      }
    }
    pickups = pickups.filter(u => u.life > 0);
  }

  function collisions() {
    const p = player;
    for (const b of bullets) {
      if (b.dead) continue;
      if (b.owner === 'p') {
        for (const e of enemies) {
          if (e.spawnT > 0) continue;
          if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) { b.dead = true; hitEnemy(e); break; }
        }
      } else if (p.alive && p.inv <= 0 && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r) ** 2) {
        b.dead = true;
        hurtPlayer();
      }
    }
    // tiro contra tiro se anulam
    for (const a of bullets) {
      if (a.dead || a.owner !== 'p') continue;
      for (const b of bullets) {
        if (b.dead || b.owner === 'p') continue;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 81) {
          a.dead = b.dead = true;
          burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffffff', 10, 120);
          Sfx.bounce();
          break;
        }
      }
    }
    bullets = bullets.filter(b => !b.dead);

    // tanques se empurram
    const tanks = enemies.filter(e => e.type !== 'rec' && e.spawnT <= 0);
    if (p.alive) tanks.push(p);
    for (let i = 0; i < tanks.length; i++) {
      for (let j = i + 1; j < tanks.length; j++) {
        const a = tanks[i], b = tanks[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d > 0 && d < min) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          moveCircle(a, -nx * push, -ny * push);
          moveCircle(b, nx * push, ny * push);
        }
      }
    }

    // Recognizer esmaga quem toca
    if (p.alive && p.inv <= 0) {
      for (const e of enemies) {
        if (e.type === 'rec' && e.spawnT <= 0 && dist(e, p) < e.r + p.r - 6) { hurtPlayer(); break; }
      }
    }
  }

  /* ---------------- partículas ---------------- */

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.2 + Math.random() * 0.8);
      const life = 0.3 + Math.random() * 0.7;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, len: 2 + Math.random() * 5 });
    }
  }

  function updateParticles(dt) {
    const drag = Math.pow(0.1, dt);
    for (const q of particles) {
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= drag; q.vy *= drag;
      q.life -= dt;
    }
    particles = particles.filter(q => q.life > 0);
  }

  /* ---------------- loop ---------------- */

  function pollStart() {
    const g = Grid.gamepad(0);
    const start = !!(g && g.start);
    if (start && !prevStart) {
      if (state === 'menu' || state === 'gameover') { Sfx.ensure(); startGame(); }
      else if (playing() || state === 'paused') togglePause();
    }
    prevStart = start;
  }

  function update(dt) {
    time += dt;
    pollStart();
    if (state === 'paused') return;
    shake = Math.max(0, shake - dt * 25);
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }
    updateParticles(dt);

    if (state === 'menu' || state === 'gameover') {
      updateEnemies(dt);
      updateBullets(dt);
      return;
    }

    updatePlayer(dt);
    updateBullets(dt);
    updatePickups(dt);

    if (state === 'intro') {
      stateT -= dt;
      if (stateT <= 0) state = 'playing';
    } else if (state === 'playing') {
      spawnTimer -= dt;
      if (pending.length && enemies.length < maxActive && spawnTimer <= 0) {
        if (spawnEnemy(pending[0])) { pending.shift(); spawnTimer = Math.max(0.8, 2.2 - level * 0.1); }
        else spawnTimer = 0.3;
      }
      updateEnemies(dt);
      collisions();
      if (!pending.length && !enemies.length) levelClear();
    } else if (state === 'clear') {
      stateT -= dt;
      if (stateT <= 0) { level++; startLevel(); return; }
    }

    if (!player.alive && state !== 'gameover') {
      player.respawnT -= dt;
      if (player.respawnT <= 0) { if (lives > 0) respawn(); else gameOver(); }
    }
    updateHud();
  }

  /* ---------------- render ---------------- */

  function buildBg() {
    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const g = bg.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#010308';
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1 / k;
    for (let x = 0; x <= W; x += TILE / 2) {
      g.strokeStyle = x % TILE === 0 ? 'rgba(47, 120, 255, 0.14)' : 'rgba(47, 120, 255, 0.05)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    for (let y = 0; y <= H; y += TILE / 2) {
      g.strokeStyle = y % TILE === 0 ? 'rgba(47, 120, 255, 0.14)' : 'rgba(47, 120, 255, 0.05)';
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    // plataformas de spawn
    g.lineWidth = 1.5;
    for (const s of ENEMY_SPAWNS) {
      g.strokeStyle = 'rgba(255, 59, 59, 0.35)';
      g.beginPath(); g.arc(s.x, s.y, 16, 0, TAU); g.stroke();
    }
    g.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    g.beginPath(); g.arc(PLAYER_SPAWN.x, PLAYER_SPAWN.y, 18, 0, TAU); g.stroke();
    // blocos
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isWall(tx, ty)) continue;
        g.fillStyle = '#04111e';
        g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        g.strokeStyle = 'rgba(47, 168, 255, 0.12)';
        g.lineWidth = 1;
        g.strokeRect(tx * TILE + 6, ty * TILE + 6, TILE - 12, TILE - 12);
      }
    }
    // contornos brilhantes onde a parede encontra o chão
    g.beginPath();
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isWall(tx, ty)) continue;
        const x = tx * TILE, y = ty * TILE;
        if (!isWall(tx, ty - 1)) { g.moveTo(x, y); g.lineTo(x + TILE, y); }
        if (!isWall(tx, ty + 1)) { g.moveTo(x, y + TILE); g.lineTo(x + TILE, y + TILE); }
        if (!isWall(tx - 1, ty)) { g.moveTo(x, y); g.lineTo(x, y + TILE); }
        if (!isWall(tx + 1, ty)) { g.moveTo(x + TILE, y); g.lineTo(x + TILE, y + TILE); }
      }
    }
    g.strokeStyle = WALL_COLOR;
    g.shadowColor = WALL_COLOR;
    g.shadowBlur = 14;
    g.lineWidth = 2;
    g.lineCap = 'square';
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(220, 245, 255, 0.6)';
    g.lineWidth = 0.8;
    g.stroke();
  }

  function drawTank(x, y, angle, turret, color, size, flash) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    ctx.save();
    ctx.rotate(angle);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = flash ? '#ffffff' : color;
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.6)' : 'rgba(0, 0, 0, 0.88)';
    ctx.lineWidth = 2;
    ctx.fillRect(-14, -14, 28, 6); ctx.strokeRect(-14, -14, 28, 6);
    ctx.fillRect(-14, 8, 28, 6); ctx.strokeRect(-14, 8, 28, 6);
    ctx.fillRect(-11, -8, 22, 16); ctx.strokeRect(-11, -8, 22, 16);
    ctx.beginPath(); ctx.moveTo(6, -5); ctx.lineTo(10, 0); ctx.lineTo(6, 5); ctx.stroke();
    ctx.restore();
    ctx.rotate(turret);
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = flash ? '#ffffff' : color;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(21, 0); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawRec(e) {
    const t = ETYPES.rec;
    ctx.save();
    ctx.translate(e.x, e.y);
    // sombra no chão: ele está voando
    ctx.fillStyle = 'rgba(255, 106, 31, 0.1)';
    ctx.beginPath(); ctx.ellipse(10, 16, 30, 14, 0, 0, TAU); ctx.fill();
    const s = 1 + Math.sin(time * 3 + e.wobble) * 0.05;
    ctx.scale(s, s);
    ctx.rotate(e.angle + Math.PI / 2);
    const col = e.flash ? '#ffffff' : t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = col;
    ctx.fillStyle = 'rgba(20, 6, 0, 0.92)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-28, -16); ctx.lineTo(28, -16); ctx.lineTo(28, 18); ctx.lineTo(18, 18);
    ctx.lineTo(18, -4); ctx.lineTo(-18, -4); ctx.lineTo(-18, 18); ctx.lineTo(-28, 18);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8, -4); ctx.lineTo(8, -4); ctx.lineTo(5, 7); ctx.lineTo(-5, 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(-24, -10); ctx.lineTo(24, -10);
    ctx.moveTo(-23, -10); ctx.lineTo(-23, 14);
    ctx.moveTo(23, -10); ctx.lineTo(23, 14);
    ctx.stroke();
    ctx.restore();
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(e.x - 22, e.y - 36, 44, 4);
      ctx.fillStyle = t.color;
      ctx.fillRect(e.x - 22, e.y - 36, 44 * (e.hp / e.maxHp), 4);
    }
  }

  function drawSpawn(e) {
    const t = ETYPES[e.type];
    const p = 1 - Math.max(0, e.spawnT) / 1.1;
    ctx.save();
    ctx.strokeStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 14;
    for (let i = 0; i < 3; i++) {
      const r = ((p * 3 + i) % 3) / 3 * 30 + 4;
      ctx.globalAlpha = 1 - r / 34;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = p * 0.6;
    ctx.fillStyle = t.color;
    ctx.fillRect(e.x - 2, e.y - 40 * p, 4, 40 * p);
    ctx.restore();
  }

  function drawPickups() {
    for (const u of pickups) {
      if (u.life < 3 && Math.floor(time * 8) % 2) continue;
      const c = PICKUPS[u.type].color;
      ctx.save();
      ctx.translate(u.x, u.y + Math.sin(time * 4 + u.x) * 2);
      ctx.save();
      ctx.rotate(time * 1.5);
      ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(12, 0); ctx.lineTo(0, 12); ctx.lineTo(-12, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = c;
      ctx.font = '900 11px Orbitron, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(PICKUPS[u.type].label, 0, 1);
      ctx.restore();
    }
  }

  function drawPlayer() {
    const p = player;
    if (p.inv > 0 && Math.floor(time * 12) % 2) ctx.globalAlpha = 0.35;
    drawTank(p.x, p.y, p.angle, p.turret, PLAYER_COLOR, 1, false);
    ctx.globalAlpha = 1;
    if (p.shield > 0) {
      ctx.save();
      ctx.strokeStyle = PICKUPS.shield.color;
      ctx.shadowColor = PICKUPS.shield.color;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 + Math.sin(time * 6) * 0.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bullets) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.r;
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx / sp * 14, b.y - b.vy / sp * 14); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    for (const q of particles) {
      const sp = Math.hypot(q.vx, q.vy) || 1;
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.strokeStyle = q.color;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx / sp * q.len, q.y - q.vy / sp * q.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function text(str, x, y, size, color, blur = 20) {
    ctx.save();
    ctx.font = `900 ${size}px Orbitron, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function drawUi() {
    if (msg) {
      const a = Math.max(0, Math.min(1, msg.t * 5, (msg.dur - msg.t) * 3));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, H / 2 - 56, W, 112);
      text(msg.text, W / 2, H / 2 - 12, 50, msg.color);
      if (msg.sub) text(msg.sub.toUpperCase(), W / 2, H / 2 + 32, 16, '#cfefff', 6);
      ctx.restore();
    }
    if (!player.alive && lives > 0 && state !== 'menu' && state !== 'gameover') {
      text('RECARREGANDO PROGRAMA…', W / 2, H - 70, 16, PLAYER_COLOR, 8);
    }
    if (joy) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,229,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 60, 0, TAU); ctx.stroke();
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy), m = Math.min(d, 60) / (d || 1);
      ctx.fillStyle = 'rgba(0,229,255,0.35)';
      ctx.beginPath(); ctx.arc(joy.ox + dx * m, joy.oy + dy * m, 22, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (touchAim) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,138,0,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(touchAim.x, touchAim.y, 18, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    drawPickups();
    for (const e of enemies) {
      if (e.spawnT > 0) { drawSpawn(e); continue; }
      if (e.type !== 'rec') drawTank(e.x, e.y, e.angle, e.turret, ETYPES[e.type].color, e.r / 14, e.flash > 0);
    }
    if (player.alive) drawPlayer();
    drawBullets();
    for (const e of enemies) if (e.type === 'rec' && e.spawnT <= 0) drawRec(e);
    drawParticles();
    drawUi();
  }

  /* ---------------- HUD / menus ---------------- */

  function updateHud() {
    const status = [];
    if (player && player.shield > 0) status.push('ESCUDO');
    if (player && player.rapid > 0) status.push(`RAJADA ${Math.ceil(player.rapid)}s`);
    const key = `${score}|${hiscore}|${level}|${lives}|${status.join()}|${state === 'menu'}`;
    if (key === lastHud) return;
    lastHud = key;
    const inMenu = state === 'menu';
    hud.score.textContent = inMenu ? '0' : score.toLocaleString('pt-BR');
    hud.hi.textContent = Math.max(hiscore, inMenu ? 0 : score).toLocaleString('pt-BR');
    hud.level.textContent = inMenu ? '-' : level;
    hud.lives.innerHTML = inMenu ? '' : '<i class="life"></i>'.repeat(Math.max(0, lives));
    hud.status.textContent = status.join(' · ');
  }

  function showPanel(name) {
    overlay.hidden = !name;
    if (!name && document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
    if (name) {
      const btn = panels[name].querySelector('.btn-primary');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function togglePause() {
    if (state === 'paused') {
      state = pausedFrom;
      showPanel(null);
    } else if (state === 'playing' || state === 'intro' || state === 'clear') {
      pausedFrom = state;
      state = 'paused';
      keys.clear();
      mouse.down = false;
      showPanel('pause');
    }
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    Sfx.ensure();
    switch (a.dataset.action) {
      case 'start': startGame(); break;
      case 'resume': togglePause(); break;
      case 'menu': startAttract(); break;
    }
  });

  /* ---------------- input ---------------- */

  const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE']);
  const playing = () => state === 'playing' || state === 'intro' || state === 'clear';

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyM') { Grid.toggleMute(); return; }
    if ((e.code === 'KeyP' || e.code === 'Escape') && (playing() || state === 'paused')) {
      togglePause(); e.preventDefault(); return;
    }
    if (!playing()) return;
    if (GAME_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code === 'KeyQ' || e.code === 'KeyE') mouse.active = false;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) togglePause(); });

  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }

  canvas.addEventListener('pointerdown', e => {
    Sfx.ensure();
    const p = toGame(e);
    if (e.pointerType === 'mouse') {
      mouse.x = p.x; mouse.y = p.y; mouse.active = true;
      if (e.button === 0) mouse.down = true;
    } else if (p.x < W / 2 && !joy) {
      joy = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
    } else if (!touchAim) {
      touchAim = { id: e.pointerId, x: p.x, y: p.y };
    }
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    const p = toGame(e);
    if (e.pointerType === 'mouse') { mouse.x = p.x; mouse.y = p.y; mouse.active = true; return; }
    if (joy && joy.id === e.pointerId) { joy.x = p.x; joy.y = p.y; }
    if (touchAim && touchAim.id === e.pointerId) { touchAim.x = p.x; touchAim.y = p.y; }
  });
  const release = e => {
    if (e.pointerType === 'mouse') { if (e.button === 0 || e.type === 'pointercancel') mouse.down = false; return; }
    if (joy && joy.id === e.pointerId) joy = null;
    if (touchAim && touchAim.id === e.pointerId) touchAim = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /* ---------------- boot ---------------- */

  function resize() { k = Grid.fit(canvas, W, H); if (map) buildBg(); }
  window.addEventListener('resize', resize);
  Grid.setupPads(stage, document.getElementById('padBtn'), resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  Grid.bindMute(document.getElementById('muteBtn'));
  k = Grid.fit(canvas, W, H);
  startAttract();
  requestAnimationFrame(frame);
})();
