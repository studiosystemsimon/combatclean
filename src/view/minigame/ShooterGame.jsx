// SHOOTER minigame — a crowd/lane shooter (Count Masters / Mob Control style), ported from
// docs/mockups/shooter-minigame-mockup.html onto the minigame harness ({ input, onComplete }).
// It draws its ENEMIES + SCENERY from the player's current ZONE and its CROWD from the current SQUAD
// (both via the STANDARD minigame context `input`), and returns score = surviving crowd count at the end.
//
// Contract: mounts full-screen (engine headless underneath), auto-starts, calls onComplete({ score })
// EXACTLY ONCE at the terminal (boss dead = victory; crowd wiped = 0). The harness resolves the reward
// (reward + perScore × score) + reward popup.
//
// ALL gameplay tuning is data (SHOOTER_CONFIG ← _shooter.json). Scenery colours come from the zone biome.
// Art is resolved view-side (heroAsset / enemy.<slug> / zone keyArt). The perspective-projection +
// formation math and the transient particle/gate/beam colours are in-module structural constants.
import { useEffect, useRef } from 'react';
import { SHOOTER_CONFIG } from '../../data/config.js';
import { resolve, heroAsset } from '../assets.js';
import { zoneForLevel } from '../../data/zones.js';

export default function ShooterGame({ input, onComplete }) {
  const canvasRef = useRef(null);
  const inputRef = useRef(input);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onComplete);
  onDoneRef.current = onComplete;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const CFG = SHOOTER_CONFIG;
    const FIRE = CFG.fire, GATES = CFG.gates, FOECFG = CFG.foes, BOSS = CFG.boss, SNP = CFG.sniper, MINE = CFG.mine;
    const input = inputRef.current || {};
    const finish = (score) => { if (doneRef.current) return; doneRef.current = true; try { onDoneRef.current && onDoneRef.current({ score: Math.max(0, Math.floor(score || 0)) }); } catch { /* noop */ } };

    // ── art (resolved view-side; drawn when .complete — no blocking preload) ──
    const imgCache = {};
    const loadImg = (url) => { if (!url) return null; if (imgCache[url]) return imgCache[url]; const im = new Image(); im.src = url; imgCache[url] = im; return im; };
    const heroImg = (slug) => { try { return loadImg(heroAsset(slug).img); } catch { return null; } }; // heroAsset throws on a missing slug
    const heroImgs = (input.heroes || []).map((h) => heroImg(h.hero)).filter(Boolean);
    const FOE_DEFS = (input.enemies || []).map((e) => ({ hpMul: e.hpMul || 1, img: loadImg(resolve('enemy.' + e.slug).img) }));
    const bossImg = loadImg(input.bossSlug ? resolve('enemy.' + input.bossSlug).img : null);
    const sniperImg = input.accompliceSlug ? loadImg(resolve('enemy.' + input.accompliceSlug).img) : (FOE_DEFS.length ? FOE_DEFS[FOE_DEFS.length - 1].img : bossImg);
    const coinImg = loadImg(resolve('ui.coin').img), gemImg = loadImg(resolve('ui.gem').img);
    // scenery from the current zone
    const vzone = zoneForLevel(input.level) || {};
    const bgImg = loadImg(vzone.keyArt ? resolve(vzone.keyArt).img : null);
    const biome = vzone.biome || { from: '#1f4a2f', to: '#14301f', accent: '#8ce2a0' };

    // ── perspective lane projection (structural render-math): d = depth, 0 = near (bottom), 1 = far ──
    let W = 0, H = 0, dpr = 1;
    const HZ = 0.16, GB = 0.94, NH = 0.52, FH = 0.38, FS = 0.74, D_CROWD = 0.06;
    const projY = (d) => H * GB - d * (H * GB - H * HZ);
    const halfW = (d) => W * (NH + (FH - NH) * d);
    const projX = (lx, d) => W / 2 + lx * halfW(d);
    const scaleAt = (d) => 1 + (FS - 1) * d;
    function resize() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);

    // formation: geometric concentric-ring disc (structural)
    const RINGS = (() => { const slots = [], gap = 0.11; for (let r = 1; r <= 10; r++) { const cnt = Math.round(6 * r * 0.9); const ph = (r % 2) * (Math.PI / cnt); for (let k = 0; k < cnt; k++) { const a = ph + k / cnt * 6.2832; slots.push({ x: Math.cos(a) * r * gap, y: Math.sin(a) * r * gap }); } } return slots; })();
    const formSlot = (i) => { const s = RINGS[i % RINGS.length]; return { ox: s.x, od: s.y * 0.42 }; };

    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const squadStart = Math.max(1, (input.heroes || []).length);

    let state, last = 0, raf = 0, shake = 0, running = true, laneScroll = 0;
    function fresh() {
      return { steer: 0, lane: 0, squad: squadStart, fireCd: 0, walkT: 0, members: [], bullets: [], foes: [], gates: [], mines: [], snipers: [], parts: [], floats: [], drops: [],
        coins: 0, gems: 0, dist: 0, dirMs: CFG.startDelayMs, gatePairs: 0, boss: null, won: false, over: false, overTitle: '', overT: 0, overScore: 0 };
    }
    const burst = (x, y, color, n, spd) => { for (let i = 0; i < n; i++) { const a = rand(0, 6.28), s = rand(spd * 0.3, spd); state.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.7), t: 0, color, r: rand(2, 4), g: 1 }); } };
    const hitFlash = (x, y) => { for (let i = 0; i < 4; i++) { const a = rand(0, 6.28), s = rand(8, 38); state.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.07, 0.14), t: 0, color: '#fff', r: rand(1.2, 2.3), g: 0 }); } };
    const floatText = (x, y, txt, color, big) => state.floats.push({ x, y, txt, color, t: 0, life: big ? 1.1 : 0.8, big });

    // ── input (drag to steer) ──
    let dragging = false;
    const local = (e) => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const mv = (e) => { if (!dragging || !running || state.over) return; const p = local(e); state.steer = clamp((p.x - W / 2) / (W * NH * 0.92), -1, 1); if (e.cancelable) e.preventDefault(); };
    const dn = (e) => { if (!running || state.over) return; dragging = true; mv(e); if (e.cancelable) e.preventDefault(); };
    const up = () => { dragging = false; };
    cv.addEventListener('pointerdown', dn); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);

    // ── spawns ──
    function spawnGatePair() {
      state.gatePairs++;
      const good = () => { const r = Math.random(); if (r < GATES.addProb) return { type: 'add', val: GATES.addVals[Math.floor(Math.random() * GATES.addVals.length)] }; if (r < GATES.mul2Prob) return { type: 'mul', val: 2 }; return { type: 'mul', val: 3 }; };
      let L = good(), R = good();
      if (Math.random() < GATES.subTrapChance) { const sub = () => ({ type: 'sub', val: GATES.subVals[Math.floor(Math.random() * GATES.subVals.length)] }); if (Math.random() < 0.5) L = sub(); else R = sub(); }
      state.gates.push({ d: 1, side: -1, op: L, applied: false, pair: state.gatePairs });
      state.gates.push({ d: 1, side: 1, op: R, applied: false, pair: state.gatePairs });
    }
    function spawnFoeCluster() {
      const n = FOECFG.clusterBase + Math.floor(rand(0, FOECFG.clusterRandBase + state.dist / FOECFG.distClusterDiv));
      for (let i = 0; i < n; i++) {
        const def = FOE_DEFS.length ? FOE_DEFS[Math.floor(rand(0, FOE_DEFS.length))] : null;
        const hp = Math.max(1, Math.round((FOECFG.hpBase + Math.floor(state.dist / FOECFG.hpDistDiv) + Math.floor(rand(0, FOECFG.hpRand))) * (def ? def.hpMul : 1)));
        state.foes.push({ lane: rand(-0.8, 0.8), d: 1 + rand(0, 0.25), img: def ? def.img : null, hp, maxHp: hp, sz: rand(FOECFG.sizeMin, FOECFG.sizeMax), hitT: 0, swayT: rand(0, 6.28), sway: rand(0, 0.12) });
      }
    }
    function spawnBoss() { state.boss = { lane: 0, d: 0.66, hp: BOSS.hp, maxHp: BOSS.hp, hitT: 0, dir: 1, t: 0 }; while (state.snipers.length < BOSS.escortSnipers) spawnSniper(); shake = Math.max(shake, 9); floatText(W / 2, H * 0.34, '⚔ BOSS ⚔', '#ffd9a0', true); }
    function spawnMine() { state.mines.push({ lane: rand(-0.62, 0.62), d: 1 + rand(0, 0.2), radius: rand(MINE.radiusMin, MINE.radiusMax), t: 0 }); }
    function explodeMine(mn) {
      const mx = projX(mn.lane, D_CROWD), my = projY(D_CROWD), rx = mn.radius * halfW(D_CROWD), ry = rx * 0.55;
      const covers = (px, py) => { const nx = (px - mx) / rx, ny = (py - my) / ry; return nx * nx + ny * ny < 1; };
      let killed = 0;
      for (let i = state.members.length - 1; i >= 0; i--) { const m = state.members[i]; const px = projX(m.lane, m.d), py = projY(m.d); if (covers(px, py)) { burst(px, py, '#ff7a3a', 6, 190); state.members.splice(i, 1); killed++; } }
      const total = killed + (covers(projX(state.lane, D_CROWD), projY(D_CROWD)) ? 1 : 0);
      if (total > 0) { state.squad = Math.max(0, state.squad - total); floatText(mx, my - 34, '−' + total, '#ff8a8a', true); }
      burst(mx, my, '#ff5a2e', 30, 360); burst(mx, my, '#ffd45e', 18, 240); shake = Math.max(shake, 13);
      if (state.squad <= 0) endRun('WIPED!');
    }
    function spawnSniper() { state.snipers.push({ lane: rand(-0.55, 0.55), d: 0.9, dir: Math.random() < 0.5 ? -1 : 1, phase: 'move', cd: rand(SNP.initialCdMin, SNP.initialCdMax), aimT: 0, aimLane: 0, flash: 0 }); }
    function updateSnipers(dt) {
      for (const sn of state.snipers) { sn.flash = Math.max(0, sn.flash - dt);
        if (sn.phase === 'move') { sn.lane += sn.dir * SNP.speed * dt; if (sn.lane > 0.78) { sn.lane = 0.78; sn.dir = -1; } if (sn.lane < -0.78) { sn.lane = -0.78; sn.dir = 1; } sn.cd -= dt; if (sn.cd <= 0) { sn.phase = 'aim'; sn.aimT = SNP.aimMs; sn.aimLane = sn.lane; } }
        else if (sn.phase === 'aim') { sn.aimT -= dt; if (sn.aimT <= 0) { sniperFire(sn); sn.phase = 'move'; sn.cd = SNP.cd; } } }
    }
    function sniperFire(sn) { sn.flash = SNP.fireFlashMs; const hw = SNP.beamHalfW; let killed = 0;
      for (let i = state.members.length - 1; i >= 0; i--) { const m = state.members[i]; if (Math.abs(m.lane - sn.aimLane) < hw) { const px = projX(m.lane, m.d), py = projY(m.d); burst(px, py, '#ff2e4e', 7, 240); state.members.splice(i, 1); killed++; } }
      const total = killed + (Math.abs(state.lane - sn.aimLane) < hw ? 1 : 0);
      if (total > 0) { state.squad = Math.max(0, state.squad - total); const c = projX(sn.aimLane, D_CROWD); floatText(c, projY(D_CROWD) - 34, '−' + total, '#ff5a6e', true); }
      for (let k = 0; k <= 12; k++) { const d = k / 12; burst(projX(sn.aimLane, d), projY(d), '#ff6a3a', 2, 140); }
      burst(projX(sn.lane, sn.d), projY(sn.d) - 16, '#ffdca0', 14, 240); shake = Math.max(shake, 12);
      if (state.squad <= 0) endRun('SNIPED!');
    }
    function director(dt) {
      if (state.boss || state.won) return;
      state.dirMs -= dt * 1000;
      if (state.dirMs <= 0) {
        if (state.gatePairs >= BOSS.at) { state.dirMs = 1e9; spawnBoss(); return; }
        state.dirMs = GATES.pairMs; spawnGatePair();
        setTimeout(() => { if (running && !state.boss && !state.over) spawnFoeCluster(); }, FOECFG.spawnDelayMs);
        if (state.gatePairs >= MINE.afterPair && Math.random() < MINE.chance) setTimeout(() => { if (running && !state.boss && !state.over) spawnMine(); }, MINE.spawnDelayMs);
        if (state.gatePairs === SNP.midRunAt && state.snipers.length === 0) setTimeout(() => { if (running && !state.boss && !state.over) spawnSniper(); }, SNP.spawnDelayMs);
      }
    }
    function addSquad(op) {
      const before = state.squad;
      if (op.type === 'mul') state.squad = Math.min(CFG.crowdCap, state.squad * op.val);
      else if (op.type === 'add') state.squad = Math.min(CFG.crowdCap, state.squad + op.val);
      else state.squad = Math.max(0, state.squad - op.val);
      const d = state.squad - before, x = projX(state.lane, D_CROWD), y = projY(D_CROWD);
      if (d > 0) { floatText(x, y - 70, (op.type === 'mul' ? '×' + op.val : '+' + op.val), '#aef0b8', true); burst(x, y - 40, '#5ad17a', 18, 240); if (op.type === 'mul') burst(x, y - 40, '#ffd45e', 14, 200); shake = Math.max(shake, 5); }
      else if (d < 0) { floatText(x, y - 70, '−' + op.val, '#ff8a8a', true); burst(x, y - 40, '#ff5a6e', 14, 220); shake = Math.max(shake, 6); }
      if (state.squad <= 0) endRun('WIPED!');
    }
    const loseMembers = (k, x, y) => { state.squad = Math.max(0, state.squad - k); burst(x, y, '#ff6a6a', 10, 200); floatText(x, y - 30, '−' + k, '#ff8a8a'); shake = Math.max(shake, 6); if (state.squad <= 0) endRun('WIPED!'); };

    // ── crowd ──
    function syncMembers() { const n = Math.min(Math.max(0, state.squad - 1), CFG.renderCap);
      while (state.members.length < n) state.members.push({ lane: state.lane, d: D_CROWD, phase: rand(0, 6.28), step: rand(6.2, 7.8), fireCd: rand(0, FIRE.jit * 2), sprite: state.members.length % Math.max(1, heroImgs.length) });
      if (state.members.length > n) state.members.length = n;
    }
    const shoot = (lane, d) => state.bullets.push({ lane: clamp(lane, -1, 1), d: d + 0.02, spd: FIRE.bulletSpd * rand(0.92, 1.08) });
    function updateCrowd(dt) { state.walkT += dt; syncMembers(); const n = state.members.length, base = FIRE.ms / 1000, jit = FIRE.jit;
      state.fireCd -= dt; if (state.fireCd <= 0) { shoot(state.lane, D_CROWD); const x = projX(state.lane, D_CROWD); burst(x, projY(D_CROWD) - 24, '#ffe08a', 3, 90); state.fireCd = base + rand(-jit, jit); }
      for (let i = 0; i < n; i++) { const m = state.members[i], f = formSlot(i), tx = clamp(state.lane + f.ox, -1, 1), td = D_CROWD + f.od;
        m.lane += (tx - m.lane) * 0.15 + rand(-0.0016, 0.0016); m.d += (td - m.d) * 0.15; m.d = Math.max(0.02, m.d);
        m.fireCd -= dt; if (m.fireCd <= 0) { shoot(m.lane, m.d); m.fireCd = base + rand(-jit, jit); } }
    }

    function update(dt) {
      state.lane += (state.steer - state.lane) * CFG.ease;
      updateCrowd(dt);
      state.dist += CFG.distRate * dt;
      laneScroll = (laneScroll + CFG.runSpeed * dt) % 1;
      director(dt);
      for (let i = state.bullets.length - 1; i >= 0; i--) { const b = state.bullets[i]; b.d += b.spd * dt; if (b.d >= 1.02) { state.bullets.splice(i, 1); continue; }
        let hit = false;
        for (let j = state.foes.length - 1; j >= 0; j--) { const f = state.foes[j]; if (Math.abs(f.lane - b.lane) < FIRE.hitLane && Math.abs(f.d - b.d) < FIRE.hitDepth) { f.hp--; f.hitT = 0.12; hit = true; hitFlash(projX(f.lane, f.d), projY(f.d)); if (f.hp <= 0) { killFoe(f); state.foes.splice(j, 1); } break; } }
        if (!hit && state.boss) { const bo = state.boss, bs = BOSS.size * scaleAt(bo.d), bx = projX(bo.lane, bo.d), by = projY(bo.d) - bs * 0.35, br = bs * 0.42, px = projX(b.lane, b.d), py = projY(b.d);
          if ((px - bx) * (px - bx) + (py - by) * (py - by) < br * br) { bo.hp--; bo.hitT = 0.06; hit = true; hitFlash(px, py); if (bo.hp <= 0) bossDie(); } }
        if (hit) state.bullets.splice(i, 1);
      }
      for (let i = state.gates.length - 1; i >= 0; i--) { const g = state.gates[i]; g.d -= CFG.runSpeed * dt; if (!g.applied && g.d <= D_CROWD + 0.02) { g.applied = true; const inThis = (g.side < 0) ? state.lane < 0 : state.lane >= 0; if (inThis) addSquad(g.op); } if (g.d < -0.05) state.gates.splice(i, 1); }
      for (let i = state.mines.length - 1; i >= 0; i--) { const mn = state.mines[i]; mn.d -= CFG.runSpeed * dt; mn.t += dt; if (mn.d <= D_CROWD + 0.02) { explodeMine(mn); state.mines.splice(i, 1); continue; } if (mn.d < -0.05) state.mines.splice(i, 1); }
      updateSnipers(dt);
      for (let i = state.foes.length - 1; i >= 0; i--) { const f = state.foes[i]; f.d -= CFG.runSpeed * dt; f.swayT += dt; f.lane = clamp(f.lane + Math.sin(f.swayT) * f.sway * dt, -0.95, 0.95); if (f.hitT > 0) f.hitT -= dt;
        if (f.d <= D_CROWD + 0.02) { if (Math.abs(f.lane - state.lane) < FOECFG.contactLane) loseMembers(1 + Math.floor(f.maxHp / FOECFG.contactDmgDiv), projX(f.lane, D_CROWD), projY(D_CROWD)); const x = projX(f.lane, f.d), y = projY(f.d); burst(x, y, '#8a6a4a', 8, 160); state.foes.splice(i, 1); } }
      if (state.boss) { const bo = state.boss; bo.t += dt; bo.lane += bo.dir * BOSS.sweepSpeed * dt; if (bo.lane > 0.6) { bo.lane = 0.6; bo.dir = -1; } if (bo.lane < -0.6) { bo.lane = -0.6; bo.dir = 1; } if (bo.hitT > 0) bo.hitT -= dt; bo.d -= BOSS.creep * dt; if (bo.d <= D_CROWD + 0.1) loseMembers(state.squad, projX(state.lane, D_CROWD), projY(D_CROWD)); }
      for (let i = state.drops.length - 1; i >= 0; i--) { const dp = state.drops[i]; dp.d -= CFG.runSpeed * dt; if (dp.d <= D_CROWD + 0.04) { if (dp.kind === 'coin') state.coins++; else state.gems++; const x = projX(dp.lane, D_CROWD), y = projY(D_CROWD); burst(x, y, dp.kind === 'coin' ? '#ffcf4a' : '#7ad0ff', 6, 120); state.drops.splice(i, 1); continue; } if (dp.d < -0.05) state.drops.splice(i, 1); }
      for (let i = state.parts.length - 1; i >= 0; i--) { const q = state.parts[i]; q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 180 * (q.g ?? 1) * dt; if (q.t >= q.life) state.parts.splice(i, 1); }
      for (let i = state.floats.length - 1; i >= 0; i--) { const fl = state.floats[i]; fl.t += dt; fl.y -= 30 * dt; if (fl.t >= fl.life) state.floats.splice(i, 1); }
      if (shake > 0) shake = Math.max(0, shake - dt * 60);
    }
    function killFoe(f) { const x = projX(f.lane, f.d), y = projY(f.d); burst(x, y, '#8be27a', 10, 200); state.dist += FOECFG.killDistBonus; const r = Math.random(); if (r < FOECFG.gemChance) state.drops.push({ lane: f.lane, d: f.d, kind: 'gem' }); else if (r < FOECFG.coinChance) state.drops.push({ lane: f.lane, d: f.d, kind: 'coin' }); }
    function bossDie() { const bo = state.boss, x = projX(bo.lane, bo.d), y = projY(bo.d); burst(x, y, '#ff2e6e', 44, 340); burst(x, y, '#ffd45e', 34, 280); shake = 16; for (let k = 0; k < 10; k++) state.drops.push({ lane: rand(-0.5, 0.5), d: bo.d, kind: Math.random() < 0.5 ? 'gem' : 'coin' }); state.won = true; state.boss = null; floatText(W / 2, H * 0.4, 'VICTORY!', '#ffe08a', true); endRun('VICTORY!'); }

    // ── terminal: freeze sim, show a banner, then report score = surviving crowd (once) ──
    const BANNER_MS = 1.1;
    function endRun(title) { if (state.over) return; state.over = true; state.overTitle = title; state.overScore = state.squad; state.overT = 0; shake = Math.max(shake, 6); }

    // ── draw ──
    function drawImgC(img, x, y, w, h, flash) { if (!img || !img.complete || !img.naturalWidth) return; ctx.drawImage(img, x - w / 2, y - h / 2, w, h); if (flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, flash * 6); ctx.drawImage(img, x - w / 2, y - h / 2, w, h); ctx.restore(); } }
    function bolt(x, y, r, color) { ctx.save(); const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3); g.addColorStop(0, '#fff'); g.addColorStop(0.4, color); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 2.2, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
    const outlineText = (txt, x, y, color, px, align = 'center') => { ctx.font = '700 ' + px + 'px system-ui, sans-serif'; ctx.textAlign = align; ctx.fillStyle = '#000'; ctx.fillText(txt, x + 1.5, y + 1.5); ctx.fillStyle = color; ctx.fillText(txt, x, y); };
    function drawLane() {
      const hy = projY(1);
      if (bgImg && bgImg.complete && bgImg.naturalWidth) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hy + 40); ctx.clip(); const th = hy + 40, sc = Math.max(W / bgImg.width, th / bgImg.height), dw = bgImg.width * sc, dh = bgImg.height * sc; ctx.drawImage(bgImg, (W - dw) / 2, (th - dh) / 2, dw, dh); ctx.restore(); }
      else { ctx.fillStyle = biome.to; ctx.fillRect(0, 0, W, hy); }
      ctx.fillStyle = 'rgba(6,12,10,.45)'; ctx.fillRect(0, 0, W, hy + 40);
      ctx.beginPath(); ctx.moveTo(projX(-1, 0), projY(0)); ctx.lineTo(projX(1, 0), projY(0)); ctx.lineTo(projX(1, 1), projY(1)); ctx.lineTo(projX(-1, 1), projY(1)); ctx.closePath();
      const lg = ctx.createLinearGradient(0, projY(1), 0, projY(0)); lg.addColorStop(0, biome.to); lg.addColorStop(1, biome.from); ctx.fillStyle = lg; ctx.fill();
      const RUNGS = 18; ctx.lineWidth = 2; const acc = biome.accent;
      for (let k = 0; k < RUNGS; k++) { let d = (k / RUNGS - laneScroll) % 1; if (d < 0) d += 1; ctx.strokeStyle = hexA(acc, 0.08 + 0.16 * (1 - d)); ctx.beginPath(); ctx.moveTo(projX(-1, d), projY(d)); ctx.lineTo(projX(1, d), projY(d)); ctx.stroke(); }
      ctx.strokeStyle = hexA(acc, 0.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(projX(-1, 0), projY(0)); ctx.lineTo(projX(-1, 1), projY(1)); ctx.moveTo(projX(1, 0), projY(0)); ctx.lineTo(projX(1, 1), projY(1)); ctx.stroke();
    }
    function hexA(hex, a) { const h = (hex || '#8ce2a0').replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; const n = parseInt(f, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
    function drawGate(g) { const d = g.d; if (d > 1 || d < -0.05) return; const lx0 = g.side < 0 ? -1 : 0, lx1 = g.side < 0 ? 0 : 1, x0 = projX(lx0, d), x1 = projX(lx1, d), y = projY(d), topY = y - 190 * scaleAt(d), bad = g.op.type === 'sub', col = bad ? 'rgba(255,70,90,' : (g.op.type === 'mul' ? 'rgba(74,163,255,' : 'rgba(90,209,122,');
      ctx.fillStyle = col + '0.20)'; ctx.fillRect(Math.min(x0, x1), topY, Math.abs(x1 - x0), y - topY); ctx.strokeStyle = col + '0.9)'; ctx.lineWidth = 2; ctx.strokeRect(Math.min(x0, x1), topY, Math.abs(x1 - x0), y - topY);
      const txt = (bad ? '−' : (g.op.type === 'mul' ? '×' : '+')) + g.op.val, fs = Math.max(14, 42 * scaleAt(d)); ctx.textBaseline = 'middle'; outlineText(txt, (x0 + x1) / 2, topY + (y - topY) * 0.42, bad ? '#ffd0d6' : (g.op.type === 'mul' ? '#cfe6ff' : '#d6f7dd'), fs); ctx.textBaseline = 'alphabetic';
    }
    function drawMine(mn) { const d = mn.d; if (d > 1.05) return; const mx = projX(mn.lane, d), my = projY(d), rx = mn.radius * halfW(d), ry = rx * 0.42, pulse = 0.5 + 0.5 * Math.sin(mn.t * 9);
      ctx.save(); ctx.fillStyle = 'rgba(255,60,40,' + (0.10 + 0.06 * pulse) + ')'; ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, 6.28); ctx.fill(); ctx.setLineDash([7, 6]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,80,60,' + (0.5 + 0.4 * pulse) + ')'; ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, 6.28); ctx.stroke(); ctx.setLineDash([]);
      const s = Math.max(16, 26 * scaleAt(d)); ctx.font = s + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💣', mx, my - ry * 0.6); ctx.textBaseline = 'alphabetic'; ctx.restore(); }
    function beamPath(lx, hw, topD) { const yt = projY(topD), yb = projY(0); ctx.beginPath(); ctx.moveTo(projX(lx - hw, topD), yt); ctx.lineTo(projX(lx + hw, topD), yt); ctx.lineTo(projX(lx + hw, 0), yb); ctx.lineTo(projX(lx - hw, 0), yb); ctx.closePath(); }
    function drawSniperReticule(sn) { if (sn.phase !== 'aim') return; const lx = sn.aimLane, hw = SNP.beamHalfW, p = 1 - sn.aimT / SNP.aimMs, pulse = 0.5 + 0.5 * Math.sin(sn.aimT * 20); ctx.save(); beamPath(lx, hw, sn.d); ctx.fillStyle = 'rgba(255,40,40,' + (0.06 + 0.13 * p) + ')'; ctx.fill(); beamPath(lx, hw, sn.d); ctx.setLineDash([9, 7]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,70,60,' + (0.5 + 0.4 * pulse) + ')'; ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,130,90,' + (0.3 + 0.55 * p) + ')'; ctx.lineWidth = 1 + 2 * p; ctx.beginPath(); ctx.moveTo(projX(lx, sn.d), projY(sn.d)); ctx.lineTo(projX(lx, 0), projY(0)); ctx.stroke(); ctx.restore(); }
    function drawSniperBeam(sn) { if (sn.flash <= 0) return; const lx = sn.aimLane, hw = SNP.beamHalfW, a = sn.flash / SNP.fireFlashMs; ctx.save(); ctx.globalCompositeOperation = 'lighter'; beamPath(lx, hw, sn.d); ctx.fillStyle = 'rgba(255,90,60,' + (0.5 * a) + ')'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * a) + ')'; ctx.lineWidth = 5 + 9 * a; ctx.shadowColor = '#ff5a3a'; ctx.shadowBlur = 26 * a; ctx.beginPath(); ctx.moveTo(projX(lx, sn.d), projY(sn.d)); ctx.lineTo(projX(lx, 0), projY(0)); ctx.stroke(); ctx.restore(); }
    function drawUnit(lane, d, phase, step, lead, img) { const sc = scaleAt(d), w = state.walkT * step + phase, bob = Math.abs(Math.sin(w)) * 4.2 * sc, sway = Math.sin(w * 0.5) * 2.0 * sc, rot = Math.sin(w) * 0.055, s = CFG.memberW * sc * (lead ? 1.5 : 1.28);
      if (lead) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,214,94,.45)'; ctx.beginPath(); ctx.ellipse(projX(lane, d), projY(d), s * 0.42, s * 0.16, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
      ctx.save(); ctx.translate(projX(lane, d) + sway, projY(d) - bob); ctx.rotate(rot);
      if (img && img.complete && img.naturalWidth) { ctx.drawImage(img, -s / 2, -s * 0.86, s, s); if (lead) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22; ctx.drawImage(img, -s / 2, -s * 0.86, s, s); ctx.globalAlpha = 1; } }
      ctx.restore();
    }
    function drawCrowd() {
      const arr = state.members.slice().sort((a, b) => b.d - a.d);
      for (const m of arr) drawUnit(m.lane, m.d, m.phase, m.step, false, heroImgs[m.sprite % Math.max(1, heroImgs.length)]);
      drawUnit(state.lane, D_CROWD, 0, 7.0, true, heroImgs[0]);
      const cx = projX(state.lane, D_CROWD), cy = projY(D_CROWD) - CFG.memberW * 1.35; ctx.textBaseline = 'alphabetic'; outlineText(state.squad, cx, cy, '#fff', 26);
    }
    function drawHUD() {
      ctx.textBaseline = 'middle';
      outlineText('🏹 ' + state.squad, 14, 22, '#fff', 16, 'left');
      outlineText('◆ ' + state.gems, W - 14, 22, '#8fd6ff', 15, 'right');
      outlineText('⛁ ' + state.coins, W - 14, 42, '#ffd45e', 15, 'right');
      outlineText(Math.floor(state.dist) + 'm', W / 2, 20, '#fff', 18);
      if (state.boss) { const bw = W - 48, bx = 24, by = 44; ctx.fillStyle = '#0c1017'; ctx.fillRect(bx, by, bw, 12); ctx.fillStyle = '#ff2e6e'; ctx.fillRect(bx, by, bw * clamp(state.boss.hp / state.boss.maxHp, 0, 1), 12); ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 12); }
      ctx.textBaseline = 'alphabetic';
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      let sx = 0, sy = 0; if (shake > 0) { sx = rand(-shake, shake); sy = rand(-shake, shake); }
      ctx.save(); ctx.translate(sx, sy);
      drawLane();
      for (const sn of state.snipers) drawSniperReticule(sn);
      const world = [];
      for (const g of state.gates) world.push({ d: g.d, kind: 'gate', g });
      for (const mn of state.mines) world.push({ d: mn.d, kind: 'mine', mn });
      for (const f of state.foes) world.push({ d: f.d, kind: 'foe', f });
      for (const sn of state.snipers) world.push({ d: sn.d, kind: 'sniper', sn });
      for (const dp of state.drops) world.push({ d: dp.d, kind: 'drop', dp });
      if (state.boss) world.push({ d: state.boss.d, kind: 'boss' });
      world.sort((a, b) => b.d - a.d);
      for (const w of world) {
        if (w.kind === 'gate') drawGate(w.g);
        else if (w.kind === 'mine') drawMine(w.mn);
        else if (w.kind === 'foe') { const f = w.f; drawImgC(f.img, projX(f.lane, f.d), projY(f.d) - f.sz * scaleAt(f.d) * 0.35, f.sz * scaleAt(f.d), f.sz * scaleAt(f.d), f.hitT); }
        else if (w.kind === 'sniper') { const sn = w.sn, s = 70 * scaleAt(sn.d), glow = Math.max(sn.phase === 'aim' ? (1 - sn.aimT / SNP.aimMs) * 0.4 : 0, sn.flash > 0 ? sn.flash * 5 : 0); drawImgC(sniperImg, projX(sn.lane, sn.d), projY(sn.d) - s * 0.35, s, s, glow); }
        else if (w.kind === 'drop') { const dp = w.dp, im = dp.kind === 'coin' ? coinImg : gemImg, s = 26 * scaleAt(dp.d); if (im && im.complete && im.naturalWidth) ctx.drawImage(im, projX(dp.lane, dp.d) - s / 2, projY(dp.d) - s / 2, s, s); else { ctx.fillStyle = dp.kind === 'coin' ? '#ffcf4a' : '#7ad0ff'; ctx.beginPath(); ctx.arc(projX(dp.lane, dp.d), projY(dp.d), s * 0.4, 0, 6.28); ctx.fill(); } }
        else { const bo = state.boss, s = BOSS.size * scaleAt(bo.d); drawImgC(bossImg, projX(bo.lane, bo.d), projY(bo.d) - s * 0.35, s, s, bo.hitT); }
      }
      for (const b of state.bullets) bolt(projX(b.lane, b.d), projY(b.d), 3.2 * scaleAt(b.d) + 0.6, '#ffd45e');
      drawCrowd();
      for (const sn of state.snipers) drawSniperBeam(sn);
      for (const q of state.parts) { ctx.globalAlpha = Math.max(0, 1 - q.t / q.life); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.28); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.textAlign = 'center';
      for (const fl of state.floats) { ctx.globalAlpha = Math.max(0, 1 - fl.t / fl.life); outlineText(fl.txt, fl.x, fl.y, fl.color, fl.big ? 24 : 14); }
      ctx.globalAlpha = 1; ctx.restore();
      drawHUD();
      if (state.over) { ctx.save(); ctx.fillStyle = 'rgba(4,7,11,' + Math.min(0.6, state.overT * 1.2) + ')'; ctx.fillRect(0, 0, W, H); ctx.textAlign = 'center'; outlineText(state.overTitle, W / 2, H * 0.44, '#eafff0', 34); outlineText('Squad ' + state.overScore, W / 2, H * 0.44 + 34, '#ffd45e', 16); ctx.restore(); }
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.033, (now - last) / 1000 || 0); last = now;
      if (state.over) { state.overT += dt; for (let i = state.parts.length - 1; i >= 0; i--) { const q = state.parts[i]; q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 180 * (q.g ?? 1) * dt; if (q.t >= q.life) state.parts.splice(i, 1); } if (shake > 0) shake = Math.max(0, shake - dt * 60); draw(); if (state.overT >= BANNER_MS) { running = false; finish(state.overScore); return; } raf = requestAnimationFrame(frame); return; }
      update(dt); draw(); raf = requestAnimationFrame(frame);
    }

    state = fresh(); last = performance.now(); raf = requestAnimationFrame(frame);

    return () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      cv.removeEventListener('pointerdown', dn); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="mg-shooter"><canvas ref={canvasRef} /></div>;
}
