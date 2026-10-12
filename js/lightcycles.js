(() => {
  'use strict';

  const COLS = 96, ROWS = 60, CELL = 10;
  const W = COLS * CELL, H = ROWS * CELL;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // 0 cima, 1 direita, 2 baixo, 3 esquerda
  const WINS_NEEDED = 3;

  const RIDERS = [
    { name: 'VOCÊ', color: '#00e5ff' },
    { name: 'KERNEL', color: '#ff8a00' },
    { name: 'DAEMON', color: '#ffe600' },
    { name: 'PROXY', color: '#ff2bd6' },
    { name: 'CACHE', color: '#39ff14' },
    { name: 'BYTE', color: '#ff3b3b' },
  ];
  const SPAWNS = [
    { x: 8, y: 30, dir: 1 },
    { x: 87, y: 29, dir: 3 },
    { x: 48, y: 6, dir: 2 },
    { x: 47, y: 53, dir: 0 },
    { x: 20, y: 6, dir: 2 },
    { x: 75, y: 53, dir: 0 },
  ];
  // speed = células/segundo; look = alcance do flood fill da IA; react = chance de "pensar" a cada passo
  const DIFF = {
    facil:   { speed: 12, noise: 40, aggr: 0,   look: 120, react: 0.7 },
    normal:  { speed: 14, noise: 12, aggr: 0.6, look: 260, react: 0.93 },
    dificil: { speed: 16, noise: 3,  aggr: 1.3, look: 420, react: 1 },
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const panels = {
    menu: document.getElementById('menuPanel'),
    pause: document.getElementById('pausePanel'),
    end: document.getElementById('endPanel'),
  };
  const hudEl = document.getElementById('hud');
  const ctrlHelp = document.getElementById('ctrlHelp');
  const endTitle = document.getElementById('endTitle');
  const endBody = document.getElementById('endBody');
  const stage = document.getElementById('stage');
  const joyL = new VJoy(document.getElementById('joyL'));
  const joyR = new VJoy(document.getElementById('joyR'));
  const btnL = Grid.holdButton(document.getElementById('btnL'));
  const btnR = Grid.holdButton(document.getElementById('btnR'));
  const padRight = document.getElementById('padRight');
  const labelL = document.getElementById('labelL');
  const labelR = document.getElementById('labelR');

  const storedDiff = Grid.store.get('lc_diff', 'normal');
  const settings = {
    mode: Grid.store.get('lc_mode', '1p') === '2p' ? '2p' : '1p',
    ais: parseInt(Grid.store.get('lc_ais', '3'), 10),
    diff: DIFF[storedDiff] ? storedDiff : 'normal',
  };
  if (!Number.isFinite(settings.ais)) settings.ais = 3;

  const grid = new Uint8Array(COLS * ROWS);   // 0 = livre, id+1 = dono do rastro
  const stamp = new Int32Array(COLS * ROWS);
  const fq = new Int32Array(COLS * ROWS);
  let stampId = 0;

  let k = 1, bg = null;
  let bikes = [], particles = [];
  let cfg = DIFF.normal;
  let state = 'countdown', pausedFrom = null;
  let attract = true;
  let round = 0, countdown = 0, lastBeep = 0, roundTime = 0, timeScale = 1, stateT = 0;
  let msg = null;
  let shake = 0, time = 0;
  let hum = null;
  const boostKeys = { p1: false, p2: false };
  const extraBoost = { p1: false, p2: false }; // joystick na tela / controle físico

  const idx = (x, y) => y * COLS + x;
  const free = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !grid[y * COLS + x];
  const sfx = (name, arg) => { if (!attract) Sfx[name](arg); };

  /* ---------------- partida / rounds ---------------- */

  function makeBike(i, human) {
    let name = RIDERS[i].name;
    if (human === 'p1' && settings.mode === '2p') name = 'P1';
    if (human === 'p2') name = 'P2';
    if (!human && i === 0) name = 'TRACER';
    return {
      id: i, name, color: RIDERS[i].color, human, wins: 0,
      x: 0, y: 0, dir: 0, queue: [], alive: true, trail: [],
      progress: 0, energy: 1, boosting: false, aiBoostT: 0, fade: 0, cleared: true,
    };
  }

  function newMatch(isAttract) {
    attract = isAttract;
    cfg = attract ? DIFF.normal : DIFF[settings.diff];
    bikes = [];
    if (attract) {
      for (let i = 0; i < 4; i++) bikes.push(makeBike(i, null));
    } else {
      bikes.push(makeBike(0, 'p1'));
      if (settings.mode === '2p') bikes.push(makeBike(1, 'p2'));
      for (let i = 0; i < settings.ais; i++) bikes.push(makeBike(bikes.length, null));
    }
    round = 0;
    newRound();
  }

  function newRound() {
    grid.fill(0);
    particles = [];
    round++;
    roundTime = 0;
    timeScale = 1;
    msg = null;
    bikes.forEach((b, i) => {
      const s = SPAWNS[i];
      Object.assign(b, {
        x: s.x, y: s.y, dir: s.dir, queue: [], alive: true, trail: [{ x: s.x, y: s.y }],
        progress: 0, energy: 1, boosting: false, aiBoostT: 0, fade: 0, cleared: false,
      });
      grid[idx(s.x, s.y)] = b.id + 1;
    });
    state = 'countdown';
    countdown = attract ? 1 : 3;
    lastBeep = 0;
    updateHud();
  }

  function endRound(winner) {
    state = 'roundEnd';
    stateT = attract ? 1.5 : 2.6;
    stopHum();
    if (winner) winner.wins++;
    if (!attract) {
      if (winner) {
        msg = { text: `${winner.name} VENCE O ROUND`, color: winner.color, t: 0, dur: 2.6 };
        if (winner.human) Sfx.win(); else Sfx.lose();
      } else {
        msg = { text: 'EMPATE', sub: 'todos derezzados', color: '#ffffff', t: 0, dur: 2.6 };
        Sfx.lose();
      }
    }
    updateHud();
  }

  function endMatch(champ) {
    state = 'matchEnd';
    const solo = settings.mode === '1p';
    const sorted = [...bikes].sort((a, b) => b.wins - a.wins);
    endTitle.textContent = champ.human ? (solo ? 'VITÓRIA' : `${champ.name} VENCEU`) : 'DEREZZADO';
    endTitle.style.color = champ.color;
    const line = champ.human && solo
      ? 'Você foi o último programa de pé na grade.'
      : `${champ.name} venceu a partida.`;
    endBody.innerHTML = `<p class="sub">${line}</p><ol class="standings">${
      sorted.map(b => `<li style="--c:${b.color}"><span>${b.name}</span><b>${b.wins}</b></li>`).join('')
    }</ol>`;
    showPanel('end');
  }

  /* ---------------- simulação ---------------- */

  function update(dt) {
    time += dt;
    pollInputs();
    if (state === 'paused' || state === 'matchEnd') return;
    shake = Math.max(0, shake - dt * 30);
    updateParticles(dt);
    updateFades(dt);
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }

    if (state === 'countdown') {
      countdown -= dt;
      const n = Math.ceil(countdown);
      if (n !== lastBeep && n > 0) { lastBeep = n; sfx('beep', false); }
      if (countdown <= 0) {
        state = 'playing';
        if (!attract) {
          Sfx.beep(true);
          msg = { text: 'GO!', color: '#ffffff', t: 0, dur: 0.7 };
          startHum();
        }
      }
    } else if (state === 'playing') {
      stepWorld(dt * timeScale);
    } else if (state === 'roundEnd') {
      stateT -= dt;
      if (stateT <= 0) {
        const champ = bikes.find(b => b.wins >= WINS_NEEDED);
        if (champ && !attract) { endMatch(champ); return; }
        if (champ) bikes.forEach(b => { b.wins = 0; });
        newRound();
      }
    }

    if (hum) {
      const p = bikes.find(b => b.human === 'p1');
      hum.set(p && p.boosting ? 125 : 70 + Math.min(roundTime, 45) * 0.6);
    }
  }

  function stepWorld(dt) {
    roundTime += dt;
    const speed = cfg.speed * (1 + Math.min(roundTime, 45) / 90); // acelera até 1.5x
    const order = Grid.shuffle(bikes.filter(b => b.alive));
    for (const b of order) {
      if (!b.alive) continue;
      let want;
      if (b.human) want = boostKeys[b.human] || extraBoost[b.human];
      else { b.aiBoostT -= dt; want = b.aiBoostT > 0; }
      const was = b.boosting;
      b.boosting = want && (was ? b.energy > 0 : b.energy > 0.15);
      if (b.boosting && !was && b.human) sfx('boost');
      b.energy = b.boosting ? Math.max(0, b.energy - dt * 0.6) : Math.min(1, b.energy + dt * 0.14);
      b.progress += speed * (b.boosting ? 1.8 : 1) * dt;
      let guard = 0;
      while (b.progress >= 1 && b.alive && guard++ < 5) {
        b.progress -= 1;
        if (!b.human) aiThink(b);
        stepBike(b);
      }
    }
    const alive = bikes.filter(b => b.alive);
    if (alive.length <= 1) { endRound(alive[0] || null); return; }
    // jogador(es) derezzados: acelera a simulação até sobrar um
    if (!attract && !alive.some(b => b.human)) timeScale = 3;
  }

  function stepBike(b) {
    if (b.queue.length) {
      const d = b.queue.shift();
      if (d !== b.dir && d !== (b.dir + 2) % 4) {
        b.dir = d;
        b.trail.push({ x: b.x, y: b.y });
        if (b.human) sfx('turn');
      }
    }
    const nx = b.x + DX[b.dir], ny = b.y + DY[b.dir];
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { kill(b); return; }
    const owner = grid[idx(nx, ny)];
    if (owner) {
      // colisão de frente: os dois são derezzados
      const other = bikes[owner - 1];
      if (other && other !== b && other.alive && other.x === nx && other.y === ny &&
          other.dir === (b.dir + 2) % 4) kill(other);
      kill(b);
      return;
    }
    b.x = nx; b.y = ny;
    grid[idx(nx, ny)] = b.id + 1;
  }

  function kill(b) {
    if (!b.alive) return;
    b.alive = false;
    b.fade = 1;
    explode(b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, b.color);
    if (!attract) {
      Sfx.explode();
      shake = Math.max(shake, b.human ? 14 : 7);
    }
    if (b.human === 'p1') stopHum();
    updateHud();
  }

  // Rastro de quem foi derezzado pisca e some, liberando espaço na arena.
  function updateFades(dt) {
    for (const b of bikes) {
      if (b.alive || b.cleared) continue;
      b.fade -= dt * 0.9;
      if (b.fade <= 0) {
        b.fade = 0;
        b.cleared = true;
        const tag = b.id + 1;
        for (let i = 0; i < grid.length; i++) if (grid[i] === tag) grid[i] = 0;
        b.trail = [];
      }
    }
  }

  /* ---------------- IA ---------------- */

  function flood(sx, sy, limit) {
    stampId++;
    let head = 0, tail = 0, count = 0;
    const s = idx(sx, sy);
    stamp[s] = stampId;
    fq[tail++] = s;
    while (head < tail && count < limit) {
      const c = fq[head++];
      count++;
      const cx = c % COLS, cy = (c / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const n = ny * COLS + nx;
        if (grid[n] || stamp[n] === stampId) continue;
        stamp[n] = stampId;
        fq[tail++] = n;
      }
    }
    return count;
  }

  function aiThink(b) {
    const aheadFree = free(b.x + DX[b.dir], b.y + DY[b.dir]);
    if (aheadFree && Math.random() > cfg.react) return;

    let target = null, td = Infinity;
    for (const o of bikes) {
      if (o === b || !o.alive) continue;
      const d = Math.abs(o.x - b.x) + Math.abs(o.y - b.y);
      if (d < td) { td = d; target = o; }
    }

    const opts = [b.dir, (b.dir + 1) % 4, (b.dir + 3) % 4];
    let best = b.dir, bestScore = -Infinity;
    for (const d of opts) {
      const nx = b.x + DX[d], ny = b.y + DY[d];
      let score;
      if (!free(nx, ny)) {
        score = -1e9;
      } else {
        const space = flood(nx, ny, cfg.look);
        let run = 0, rx = nx, ry = ny;
        while (run < 30 && free(rx + DX[d], ry + DY[d])) { rx += DX[d]; ry += DY[d]; run++; }
        score = space * 4 + run * 1.5;
        if (d === b.dir) score += 6;
        // evita a célula para onde outra moto está indo (batida de frente)
        for (const o of bikes) {
          if (o !== b && o.alive && o.x + DX[o.dir] === nx && o.y + DY[o.dir] === ny) score -= 400;
        }
        // agressividade: tenta cortar a frente do adversário mais próximo
        if (target && cfg.aggr > 0 && space >= cfg.look * 0.9) {
          const tx = target.x + DX[target.dir] * 6, ty = target.y + DY[target.dir] * 6;
          score -= (Math.abs(tx - nx) + Math.abs(ty - ny)) * cfg.aggr * 5;
        }
        score += Math.random() * cfg.noise;
      }
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (best !== b.dir) b.queue = [best];

    if (b.aiBoostT <= 0 && b.energy > 0.6 && aheadFree && Math.random() < 0.012 * (1 + cfg.aggr)) {
      b.aiBoostT = 0.4 + Math.random() * 0.6;
    }
  }

  /* ---------------- efeitos ---------------- */

  function explode(x, y, color) {
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 240;
      const life = 0.5 + Math.random() * 0.9;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        color: Math.random() < 0.25 ? '#ffffff' : color, size: Math.random() < 0.5 ? 2 : 4,
      });
    }
  }

  function updateParticles(dt) {
    const drag = Math.pow(0.08, dt);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= drag; p.vy *= drag;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function startHum() {
    stopHum();
    const p = bikes.find(b => b.human === 'p1');
    if (!attract && p && p.alive) hum = Sfx.hum();
  }
  function stopHum() { if (hum) { hum.stop(); hum = null; } }

  /* ---------------- render ---------------- */

  function buildBg() {
    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const g = bg.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#02050b';
    g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
    rg.addColorStop(0, 'rgba(0, 90, 140, 0.2)');
    rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1 / k;
    for (let x = 0; x <= COLS; x++) {
      g.strokeStyle = x % 4 === 0 ? 'rgba(0, 170, 220, 0.22)' : 'rgba(0, 170, 220, 0.06)';
      g.beginPath(); g.moveTo(x * CELL, 0); g.lineTo(x * CELL, H); g.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      g.strokeStyle = y % 4 === 0 ? 'rgba(0, 170, 220, 0.22)' : 'rgba(0, 170, 220, 0.06)';
      g.beginPath(); g.moveTo(0, y * CELL); g.lineTo(W, y * CELL); g.stroke();
    }
    g.strokeStyle = '#00e5ff';
    g.shadowColor = '#00e5ff';
    g.shadowBlur = 16;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
  }

  function headPos(b) {
    let fx = b.x, fy = b.y;
    if (b.alive && state === 'playing' && free(b.x + DX[b.dir], b.y + DY[b.dir])) {
      const p = Math.min(b.progress, 1);
      fx += DX[b.dir] * p; fy += DY[b.dir] * p;
    }
    return [fx * CELL + CELL / 2, fy * CELL + CELL / 2];
  }

  function drawTrail(b) {
    const t = b.trail;
    if (!t.length) return;
    const alpha = b.alive ? 1 : b.fade * (0.45 + Math.random() * 0.55);
    if (alpha <= 0) return;
    const [hx, hy] = headPos(b);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(t[0].x * CELL + CELL / 2, t[0].y * CELL + CELL / 2);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x * CELL + CELL / 2, t[i].y * CELL + CELL / 2);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function drawBike(b) {
    const [hx, hy] = headPos(b);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate((b.dir - 1) * Math.PI / 2);
    if (b.boosting) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.5 + Math.random() * 0.4;
      ctx.beginPath();
      ctx.moveTo(-8, -3); ctx.lineTo(-20 - Math.random() * 8, 0); ctx.lineTo(-8, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(3, -4.5); ctx.lineTo(-8, -4.5); ctx.lineTo(-8, 4.5); ctx.lineTo(3, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-4, -1.5, 9, 3);
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  function text(str, x, y, size, color, align = 'center', blur = 20) {
    ctx.save();
    ctx.font = `900 ${size}px Orbitron, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function drawUi() {
    if (attract) return;
    if (state === 'countdown') {
      const n = Math.ceil(countdown);
      const f = countdown - Math.floor(countdown);
      text(`ROUND ${round}`, W / 2, H / 2 - 90, 28, '#9feaff');
      text(String(n), W / 2, H / 2, 90 + f * 40, '#ffffff', 'center', 30);
      const p1 = bikes.find(b => b.human === 'p1');
      if (p1 && round === 1) {
        const [hx, hy] = headPos(p1);
        text('VOCÊ', hx + 8, hy - 22, 13, p1.color, 'left', 10);
      }
    }
    if (msg) {
      const a = Math.min(1, msg.t * 6, (msg.dur - msg.t) * 3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      text(msg.text, W / 2, H / 2, msg.text.length > 12 ? 40 : 64, msg.color);
      if (msg.sub) text(msg.sub.toUpperCase(), W / 2, H / 2 + 46, 18, '#9feaff', 'center', 8);
      ctx.restore();
    }
    if (timeScale > 1 && state === 'playing') {
      text('DEREZZADO ▸▸ SIMULANDO O RESTO DO ROUND', W / 2, 26, 13, '#9feaff', 'center', 6);
    }
    // barras de turbo dos humanos
    const humans = bikes.filter(b => b.human);
    humans.forEach((b, i) => {
      const x = i === 0 ? 16 : W - 156, y = H - 22;
      ctx.save();
      ctx.font = '700 10px Orbitron, sans-serif';
      ctx.fillStyle = b.color;
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${b.name} TURBO`, x, y - 3);
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.6;
      ctx.strokeRect(x + 0.5, y + 0.5, 140, 8);
      ctx.globalAlpha = 1;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(x + 2, y + 2, 137 * b.energy, 5);
      ctx.restore();
    });
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    for (const b of bikes) drawTrail(b);
    for (const b of bikes) if (b.alive) drawBike(b);
    drawParticles();
    drawUi();
  }

  /* ---------------- HUD / menus ---------------- */

  function updateHud() {
    if (attract) {
      hudEl.innerHTML = '<span class="hud-dim">DEMO: escolha um modo para jogar</span>';
      return;
    }
    const pips = b => Array.from({ length: WINS_NEEDED }, (_, i) => `<i class="${i < b.wins ? 'on' : ''}"></i>`).join('');
    hudEl.innerHTML = `<span class="hud-round">ROUND ${round}</span>` + bikes.map(b =>
      `<span class="chip${b.alive ? '' : ' dead'}" style="--c:${b.color}"><span class="chip-name">${b.name}</span><span class="pips">${pips(b)}</span></span>`
    ).join('');
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

  function syncMenu() {
    const minAi = settings.mode === '2p' ? 0 : 1;
    const maxAi = settings.mode === '2p' ? 4 : 5;
    settings.ais = Math.max(minAi, Math.min(maxAi, settings.ais));
    panels.menu.querySelectorAll('.seg').forEach(seg => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach(btn => {
        const v = key === 'ais' ? +btn.dataset.value : btn.dataset.value;
        btn.classList.toggle('on', v === settings[key]);
        btn.setAttribute('aria-pressed', v === settings[key] ? 'true' : 'false');
        if (key === 'ais') btn.disabled = v < minAi || v > maxAi;
      });
    });
    Grid.store.set('lc_mode', settings.mode);
    Grid.store.set('lc_ais', settings.ais);
    Grid.store.set('lc_diff', settings.diff);
    ctrlHelp.innerHTML = settings.mode === '2p'
      ? `<div><b style="color:#00e5ff">P1</b>: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> virar · <kbd>Espaço</kbd> turbo</div>
         <div><b style="color:#ff8a00">P2</b>: <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> virar · <kbd>Enter</kbd> turbo</div>
         <div><kbd>P</kbd>/<kbd>Esc</kbd> pausa · <kbd>M</kbd> som</div>
         <div>Na tela: joystick e TURBO de cada lado (🎮 mostra/esconde). Controles físicos: 1º = P1, 2º = P2.</div>`
      : `<div><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> ou <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> virar · <kbd>Espaço</kbd> turbo</div>
         <div><kbd>P</kbd>/<kbd>Esc</kbd> pausa · <kbd>M</kbd> som</div>
         <div>Na tela: joystick para virar e botão TURBO (🎮 mostra/esconde). Também dá pra deslizar o dedo no campo.</div>
         <div>Controle de videogame: analógico/direcional vira, <kbd>A</kbd>/<kbd>RT</kbd> turbo, <kbd>Start</kbd> pausa.</div>`;
    syncPads();
  }

  // Monta os controles na tela conforme o modo: 1P = joystick + TURBO; 2P = um par para cada jogador.
  function syncPads() {
    const two = settings.mode === '2p';
    btnL.el.hidden = !two;
    joyR.el.hidden = !two;
    labelL.textContent = two ? 'P1' : 'DIREÇÃO';
    labelR.textContent = two ? 'P2' : '';
    padRight.style.setProperty('--accent', two ? RIDERS[1].color : '');
    padRight.style.setProperty('--accent-dim', two ? 'rgba(255, 138, 0, 0.3)' : '');
  }

  function togglePause() {
    if (state === 'paused') {
      state = pausedFrom;
      showPanel(null);
      if (state === 'playing') startHum();
    } else if (state === 'countdown' || state === 'playing' || state === 'roundEnd') {
      pausedFrom = state;
      state = 'paused';
      stopHum();
      boostKeys.p1 = boostKeys.p2 = false;
      showPanel('pause');
    }
  }

  panels.menu.querySelectorAll('.seg').forEach(seg => {
    seg.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const key = seg.dataset.setting;
      settings[key] = key === 'ais' ? +btn.dataset.value : btn.dataset.value;
      syncMenu();
    });
  });

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    Sfx.ensure();
    switch (a.dataset.action) {
      case 'start': showPanel(null); newMatch(false); break;
      case 'resume': togglePause(); break;
      case 'menu': stopHum(); newMatch(true); showPanel('menu'); break;
    }
  });

  /* ---------------- input ---------------- */

  const WASD = { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 };
  const ARROWS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
  const bikeOf = h => bikes.find(b => b.human === h);

  function queueDir(b, d) {
    const last = b.queue.length ? b.queue[b.queue.length - 1] : b.dir;
    if (d === last || d === (last + 2) % 4) return;
    if (b.queue.length < 3) b.queue.push(d);
  }

  function boostOwner(code) {
    if (settings.mode === '1p') return (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') ? 'p1' : null;
    if (code === 'Space' || code === 'ShiftLeft') return 'p1';
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'ShiftRight' || code === 'Numpad0' || code === 'ControlRight') return 'p2';
    return null;
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyM') { Grid.toggleMute(); return; }
    if (attract || state === 'matchEnd') return;
    if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); e.preventDefault(); return; }
    if (state === 'paused') return;
    let h = null, d = null;
    if (e.code in WASD) { h = 'p1'; d = WASD[e.code]; }
    else if (e.code in ARROWS) { h = settings.mode === '1p' ? 'p1' : 'p2'; d = ARROWS[e.code]; }
    if (h) {
      const b = bikeOf(h);
      if (b && b.alive) queueDir(b, d);
      e.preventDefault();
      return;
    }
    const bo = boostOwner(e.code);
    if (bo) { boostKeys[bo] = true; e.preventDefault(); }
  });

  window.addEventListener('keyup', e => {
    const bo = boostOwner(e.code);
    if (bo) boostKeys[bo] = false;
  });

  window.addEventListener('blur', () => { boostKeys.p1 = boostKeys.p2 = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !attract && state !== 'paused' && state !== 'matchEnd') togglePause();
  });

  // Toque: deslizar no campo vira a moto do P1.
  let swipe = null;
  canvas.addEventListener('pointerdown', e => {
    Sfx.ensure();
    if (e.pointerType === 'mouse') return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 22) return;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    const b = bikeOf('p1');
    if (b && b.alive && !attract && state !== 'paused') queueDir(b, d);
    swipe.x = e.clientX; swipe.y = e.clientY;
  });
  const endSwipe = () => { swipe = null; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  // Joysticks (na tela e físicos) viram a moto quando a direção dominante muda.
  const stickPrev = {};
  let prevStart = false;

  function stickDir(x, y, prev) {
    if (Math.hypot(x, y) < 0.45) return null;
    const ax = Math.abs(x), ay = Math.abs(y);
    let horiz;
    if (prev === 1 || prev === 3) horiz = ax * 1.3 > ay;      // histerese evita zigue-zague na diagonal
    else if (prev === 0 || prev === 2) horiz = ax > ay * 1.3;
    else horiz = ax > ay;
    return horiz ? (x > 0 ? 1 : 3) : (y > 0 ? 2 : 0);
  }

  function feedStick(src, h, x, y) {
    const d = stickDir(x, y, stickPrev[src]);
    if (d !== null && d !== stickPrev[src] && !attract && (state === 'countdown' || state === 'playing')) {
      const b = bikeOf(h);
      if (b && b.alive) queueDir(b, d);
    }
    stickPrev[src] = d;
  }

  function pollInputs() {
    const two = settings.mode === '2p';
    feedStick('joyL', 'p1', joyL.x, joyL.y);
    if (two) feedStick('joyR', 'p2', joyR.x, joyR.y);
    extraBoost.p1 = two ? btnL.down : btnR.down;
    extraBoost.p2 = two && btnR.down;

    let start = false;
    for (let i = 0; i < (two ? 2 : 1); i++) {
      const g = Grid.gamepad(i);
      if (!g) continue;
      const h = i === 0 ? 'p1' : 'p2';
      feedStick('pad' + i, h, g.lx, g.ly);
      if (g.a || g.rt || g.rb) extraBoost[h] = true;
      start = start || g.start;
    }
    if (start && !prevStart) {
      if (attract || state === 'matchEnd') { Sfx.ensure(); showPanel(null); newMatch(false); }
      else togglePause();
    }
    prevStart = start;
  }

  /* ---------------- boot ---------------- */

  function resize() { k = Grid.fit(canvas, W, H); buildBg(); }
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
  syncMenu();
  newMatch(true);
  showPanel('menu');
  requestAnimationFrame(frame);
})();
