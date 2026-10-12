// Shared helpers: synth sound effects, canvas fitting, storage, mute button.
const Sfx = (() => {
  let ac = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('grid_muted') === '1'; } catch (e) { /* no storage */ }

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, dur = 0.1, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur = 0.4, vol = 0.3, cutoff = 1500, delay = 0) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  // Continuous engine drone; returns a controller or null.
  function hum() {
    const c = ensure(); if (!c) return null;
    const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 70;
    f.type = 'lowpass'; f.frequency.value = 380;
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.035, c.currentTime, 0.1);
    o.connect(f); f.connect(g); g.connect(master); o.start();
    return {
      set(freq) { o.frequency.setTargetAtTime(freq, c.currentTime, 0.08); },
      stop() { g.gain.setTargetAtTime(0.0001, c.currentTime, 0.05); o.stop(c.currentTime + 0.3); },
    };
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('grid_muted', m ? '1' : '0'); } catch (e) { /* no storage */ }
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  return {
    ensure, tone, noise, hum, setMuted,
    isMuted: () => muted,
    explode() { noise(0.7, 0.55, 2000); tone(130, 0.5, 'sawtooth', 0.12, 35); },
    turn() { tone(620, 0.035, 'square', 0.04); },
    beep(hi) { tone(hi ? 880 : 440, hi ? 0.3 : 0.14, 'square', 0.14); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.11, null, i * 0.11)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, null, i * 0.14)); },
    boost() { tone(180, 0.35, 'sawtooth', 0.06, 640); },
    shoot() { tone(980, 0.12, 'square', 0.07, 240); },
    enemyShoot() { tone(420, 0.16, 'sawtooth', 0.06, 130); },
    bounce() { tone(1400, 0.04, 'square', 0.03); },
    hit() { noise(0.15, 0.25, 3500); },
    pickup() { tone(700, 0.08, 'square', 0.1); tone(1050, 0.14, 'square', 0.1, null, 0.08); },
    materialize() { tone(160, 0.6, 'sine', 0.07, 900); },
    shield() { tone(300, 0.25, 'triangle', 0.15, 1200); },
  };
})();

// Joystick virtual na tela: arrastar com dedo ou mouse. x/y vão de -1 a 1.
class VJoy {
  constructor(el) {
    this.el = el;
    this.knob = el.querySelector('.vjoy-knob');
    this.x = 0; this.y = 0; this.id = null;
    el.addEventListener('pointerdown', e => {
      if (this.id !== null) return;
      Sfx.ensure();
      this.id = e.pointerId;
      el.classList.add('active');
      this.move(e);
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro já liberado */ }
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === this.id) this.move(e); });
    const end = e => {
      if (e.pointerId !== this.id) return;
      this.id = null; this.x = 0; this.y = 0;
      el.classList.remove('active');
      this.knob.style.transform = '';
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  move(e) {
    const r = this.el.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.x = dx; this.y = dy;
    this.knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  }
  get active() { return this.id !== null; }
  get mag() { return Math.hypot(this.x, this.y); }
}

const Grid = (() => {
  const muteButtons = [];

  function syncMute() {
    for (const b of muteButtons) {
      b.textContent = Sfx.isMuted() ? '🔇' : '🔊';
      b.setAttribute('aria-label', Sfx.isMuted() ? 'Ativar som' : 'Silenciar');
    }
  }

  return {
    // Scales the canvas to fit its parent, keeping aspect ratio.
    // Returns the factor between backing-store pixels and logical units.
    fit(canvas, W, H) {
      const stage = canvas.parentElement;
      const cs = getComputedStyle(stage);
      const pw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ph = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const s = Math.max(0.2, Math.min(pw / W, ph / H));
      const cssW = Math.floor(W * s), cssH = Math.floor(H * s);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      return canvas.width / W;
    },
    bindMute(btn) {
      muteButtons.push(btn);
      btn.addEventListener('click', () => { Sfx.ensure(); Grid.toggleMute(); btn.blur(); });
      syncMute();
    },
    toggleMute() { Sfx.setMuted(!Sfx.isMuted()); syncMute(); },
    store: {
      get(key, def) {
        try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
      },
      set(key, v) {
        try { localStorage.setItem(key, String(v)); } catch (e) { /* no storage */ }
      },
    },
    // Botão 🎮 que mostra/esconde os controles na tela (padrão: visível).
    setupPads(stage, btn, onChange) {
      let on = Grid.store.get('grid_pads', '1') === '1';
      const apply = () => {
        stage.classList.toggle('no-pads', !on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on ? 'Esconder controles na tela' : 'Mostrar controles na tela';
        onChange();
      };
      btn.addEventListener('click', () => { on = !on; Grid.store.set('grid_pads', on ? '1' : '0'); apply(); btn.blur(); });
      apply();
    },
    // Botão que conta enquanto está pressionado (toque ou mouse).
    holdButton(el) {
      const st = { el, down: false };
      const up = () => { st.down = false; el.classList.remove('active'); };
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); Sfx.ensure();
        st.down = true; el.classList.add('active');
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro já liberado */ }
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
      el.addEventListener('contextmenu', e => e.preventDefault());
      return st;
    },
    // Controle físico (Gamepad API). i = 0 para o primeiro conectado, 1 para o segundo.
    gamepad(i) {
      const list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      const g = list[i];
      if (!g) return null;
      const ax = n => { const v = g.axes[n] || 0; return Math.abs(v) > 0.2 ? v : 0; };
      const b = n => !!(g.buttons[n] && g.buttons[n].pressed);
      let lx = ax(0), ly = ax(1);
      if (b(14)) lx = -1; if (b(15)) lx = 1; if (b(12)) ly = -1; if (b(13)) ly = 1;
      return { lx, ly, rx: ax(2), ry: ax(3), a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: b(6), rt: b(7), start: b(9) };
    },
    shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
})();
