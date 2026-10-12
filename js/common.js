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
    shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
})();
