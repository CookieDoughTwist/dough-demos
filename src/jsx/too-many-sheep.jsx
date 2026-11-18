import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// ---------------------------------------------------------------------------
// TOO MANY SHEEP
//
// A toy, not an explainer. Tap anywhere and a sheep jumps the fence while a
// voice counts. Tap faster and the sheep jam up, the count falls apart, the
// farmer turns up to complain, and the fence bursts. Build-up -> explode ->
// reset, forever. There is no score and nothing to lose: the pile-up IS the
// reward.
//
// Everything worth changing while watching a three-year-old play is in the
// TUNABLES block. The physics is rigid-body (Matter.js); all the squish is a
// lie told at draw time.
// ---------------------------------------------------------------------------

// --- TUNABLES --------------------------------------------------------------
const VW = 960, VH = 540;        // virtual canvas, scaled to fit any screen

const GROUND_Y = 452;            // top surface of the grass
const FENCE_X = 470;             // centre of the fence
const FENCE_TOP = 318;           // y of the top rail
const JUMP_X = 286;              // sheep leave the ground here — far enough back that
                                 // a rising sheep is above the rail's leading corner
const SPAWN_X = 90;
const BARN_DOOR_X = 782;         // sheep vanish into the barn here

const RUN_SPEED = 4.6;
const JUMP_VX = 5.4;             // enough carry to land past the rail, not on it
const JUMP_VY = -11.0;
const JUMP_JITTER = 0.04;        // ordinary variation; a solo sheep always clears
const SHORT_JUMP_CHANCE = 0.12;  // ...but this fraction come up short and catch the rail
const SHORT_JUMP = 0.12;
// Each sheep runs at its own speed, so a crowd bunches the way traffic does:
// harmless when there are two of them, a pile-up when there are twelve.
const RUN_VARY = 0.12;
const REJUMP_MS = 450;           // a sheep that bonks the fence has another go

const SHEEP_R = 23;
const MAX_SHEEP = 70;            // hard cap so an old iPad survives a palm-slam
const TAP_BURST_CAP = 5;         // one palm-slam spawns at most this many

const JAM_STUCK = 3;             // wedged sheep needed to summon the farmer
const JAM_TOTAL = 20;            // ...or this many on screen at once
const JAM_COUNT = 0;             // 0 = the count alone NEVER summons the farmer, so a
                                 // calm player counts up forever. Only a real traffic
                                 // jam ends a round. Set this > 0 to cap a round at a
                                 // number again.
const STUCK_SPEED = 0.7;
const STUCK_MS = 500;            // time below STUCK_SPEED before a sheep counts as wedged

// A sheep stalled this long starts fighting to get out. With nothing on top of
// it — a lone sheep straddling the rail, the sheep on top of the heap — it
// wriggles free and carries on, so stuck sheep no longer accumulate for ever
// across a quiet run. Buried sheep can only squirm: the weight above wins, and
// the pile-up still builds.
const WRIGGLE_MS = 1600;
const WRIGGLE_EVERY = 380;

const COUNT_SANE = 7;            // counts correctly to here, then falls apart. Low
                                 // enough that a typical cycle actually reaches the
                                 // wrong-numbers joke before the farmer turns up.
const SPEAK_GAP = 170;           // ms minimum between spoken numbers
const COUNT_SHOUT_EVERY = 10;    // past COUNT_SANE the numbers are nonsense, but every
                                 // tenth sheep gets its real number shouted, so a long
                                 // calm climb still reads as going somewhere

// Taps are queued rather than spawned at once. Dumping ten sheep on one spot
// builds a shapeless clump at the spawn point that never even reaches the
// fence; metering them in sends a stream at the fence, which is what produces
// mid-air collisions and sheep wedged on the rail. Every tap still counts.
// The gap shrinks as the queue grows, so the backlog is the measure of how
// hard he is mashing: a calm tap trickles sheep in and they all get over, a
// mash floods the lane faster than the fence can take and jams it. A fixed
// rate cannot do both.
const SPAWN_GAP_MS = 165;
const SPAWN_GAP_MIN = 95;
const SPAWN_QUEUE_MAX = 20;

const SURPRISE_CHANCE = 0.085;   // giant / tiny / cow
const IDLE_SLEEP_MS = 45000;     // no tapping for this long -> wind-down
const SHOW_COUNT = true;         // the one bit of on-screen text; flip to false
// ---------------------------------------------------------------------------

const NUMS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const WILD = ['seventeen', 'twenty', 'thirty', 'forty', 'fifty', 'eighty', 'a hundred'];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --- sound -----------------------------------------------------------------
// One AudioContext, unlocked by the first touch (iOS). Everything is
// synthesised: good enough to be funny, and it means the toy can be tested
// before anyone records a voice line.

let actx = null;
let noiseBuf = null;

function unlockAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const n = Math.floor(actx.sampleRate * 0.5);
    noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === 'suspended') actx.resume();
}

function env(gain, t0, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function bleat(pitch = 1, vol = 0.16) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const lfo = actx.createOscillator();
  const lfoG = actx.createGain();
  const g = actx.createGain();
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1800;
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(430 * pitch, t0);
  osc.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + 0.26);
  lfo.frequency.value = 22; lfoG.gain.value = 38 * pitch;
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  env(g, t0, vol, 0.015, 0.25);
  osc.connect(lp); lp.connect(g); g.connect(actx.destination);
  osc.start(t0); lfo.start(t0);
  osc.stop(t0 + 0.3); lfo.stop(t0 + 0.3);
}

function boing(pitch = 1) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(170 * pitch, t0);
  osc.frequency.exponentialRampToValueAtTime(520 * pitch, t0 + 0.07);
  osc.frequency.exponentialRampToValueAtTime(190 * pitch, t0 + 0.2);
  env(g, t0, 0.1, 0.01, 0.2);
  osc.connect(g); g.connect(actx.destination);
  osc.start(t0); osc.stop(t0 + 0.24);
}

function thunk(vol = 0.2) {
  if (!actx || !noiseBuf) return;
  const t0 = actx.currentTime;
  const src = actx.createBufferSource();
  const g = actx.createGain();
  const lp = actx.createBiquadFilter();
  src.buffer = noiseBuf;
  lp.type = 'lowpass'; lp.frequency.value = 420;
  env(g, t0, vol, 0.004, 0.11);
  src.connect(lp); lp.connect(g); g.connect(actx.destination);
  src.start(t0); src.stop(t0 + 0.14);
}

function creak() {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(rand(70, 95), t0);
  osc.frequency.linearRampToValueAtTime(rand(45, 62), t0 + 0.35);
  env(g, t0, 0.06, 0.08, 0.3);
  osc.connect(g); g.connect(actx.destination);
  osc.start(t0); osc.stop(t0 + 0.4);
}

function burstSound() {
  if (!actx || !noiseBuf) return;
  const t0 = actx.currentTime;
  const src = actx.createBufferSource();
  const g = actx.createGain();
  const bp = actx.createBiquadFilter();
  src.buffer = noiseBuf; src.loop = true;
  bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(260, t0);
  bp.frequency.exponentialRampToValueAtTime(1700, t0 + 0.45);
  env(g, t0, 0.3, 0.01, 0.5);
  src.connect(bp); bp.connect(g); g.connect(actx.destination);
  src.start(t0); src.stop(t0 + 0.55);
}

// Speech synthesis is a placeholder for recorded clips: free, and the way it
// stumbles when interrupted is exactly the joke. cancel() before each line
// keeps a mashing toddler from building a forty-utterance backlog.
function say(text, pitch = 1.3, rate = 1) {
  const ss = window.speechSynthesis;
  if (!ss) return;
  try {
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = clamp(pitch, 0, 2); u.rate = clamp(rate, 0.1, 10);
    ss.speak(u);
  } catch (e) { /* speech is a nice-to-have */ }
}

// Debug panel contents. Each entry pokes the live scene through the ref the
// effect publishes; the toy itself never reads this list.
const DEBUG_GROUPS = [
  [
    ['Sheep', (a) => a.spawn({})],
    ['Giant', (a) => a.spawn({ scale: 1.75 })],
    ['Tiny', (a) => a.spawn({ scale: 0.55 })],
    ['Cow', (a) => a.spawn({ kind: 'cow' })],
  ],
  [
    ['Short jump', (a) => a.spawn({ forceShort: true })],
    ['Giant cow', (a) => a.spawn({ kind: 'cow', scale: 2.1 })],
    ['+10', (a) => a.wave(10)],
  ],
  [
    ['Pile-up', (a) => a.pile()],
    ['Farmer', (a) => a.farmer()],
    ['Burst', (a) => a.burst()],
  ],
  [
    ['Count 97', (a) => a.setCount(97)],
    ['Sleep', (a) => a.sleep()],
    ['Reset', (a) => a.reset()],
  ],
];

export default function TooManySheep() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const apiRef = useRef(null);
  const [showDebug, setShowDebug] = useState(true);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const engine = Engine.create();
    engine.gravity.y = 1;
    engine.positionIterations = 8;
    engine.velocityIterations = 6;
    const world = engine.world;

    const ground = Bodies.rectangle(VW / 2, GROUND_Y + 300, VW * 3, 600, {
      isStatic: true, friction: 0.9, label: 'ground',
    });
    Composite.add(world, ground);

    // --- fence: two posts plus a thin top rail. A sheep that clips the rail
    // lands straddling it, which reads as wedged in profile.
    let fence = null;
    function addFence() {
      const railH = 12;
      const postL = Bodies.rectangle(FENCE_X - 42, (FENCE_TOP + GROUND_Y) / 2, 13, GROUND_Y - FENCE_TOP, { isStatic: true, label: 'fence' });
      const postR = Bodies.rectangle(FENCE_X + 42, (FENCE_TOP + GROUND_Y) / 2, 13, GROUND_Y - FENCE_TOP, { isStatic: true, label: 'fence' });
      const rail = Bodies.rectangle(FENCE_X, FENCE_TOP + railH / 2, 104, railH, { isStatic: true, friction: 0.95, label: 'fence' });
      fence = [postL, postR, rail];
      Composite.add(world, fence);
    }
    function removeFence() {
      if (fence) { fence.forEach((b) => Composite.remove(world, b)); fence = null; }
    }
    addFence();

    const S = {
      sheep: [],
      puffs: [],
      debris: [],
      count: 0,
      phase: 'play',          // play | farmer | burst | flood | sleep
      phaseT: 0,
      fenceUp: true,
      strain: 0,
      lastSpeak: 0,
      lastTap: performance.now(),
      shake: 0,
      sleepA: 0,
      pending: 0,
      lastSpawn: 0,
      farmerX: VW + 90,
      spoke: {},
      nextId: 1,
    };

    // --- spawning ----------------------------------------------------------
    // `forced` is the debug hook: { kind, scale, x, y, forceShort }. Anything it
    // leaves out falls back to the ordinary random sheep, so normal play calls
    // spawnSheep(now) and nothing else changes.
    function spawnSheep(now, forced) {
      if (S.sheep.length >= MAX_SHEEP) { bleat(rand(0.9, 1.2), 0.1); return; }
      let kind = 'sheep', scale = 1;
      if (forced) {
        kind = forced.kind || 'sheep';
        scale = forced.scale != null ? forced.scale : (kind === 'cow' ? 1.35 : 1);
      } else if (Math.random() < SURPRISE_CHANCE) {
        const r = Math.random();
        if (r < 0.4) scale = 1.75;
        else if (r < 0.8) scale = 0.55;
        else { kind = 'cow'; scale = 1.35; }
      }
      const r = SHEEP_R * scale;
      const sx = forced && forced.x != null ? forced.x : SPAWN_X;
      const sy = forced && forced.y != null ? forced.y : GROUND_Y - r - rand(0, 8);
      const body = Bodies.circle(sx, sy, r, {
        friction: 0.62, frictionStatic: 0.9, frictionAir: 0.002,
        // barely bouncy: springy sheep hop off each other, go airborne and
        // miss their jump, which turns a stream into a wall
        restitution: 0.12, density: 0.0014, label: 'sheep',
      });
      Body.setVelocity(body, { x: RUN_SPEED, y: 0 });
      const s = {
        id: S.nextId++, body, kind, scale,
        counted: false, lastJump: -9999, stuckFor: 0, stuck: false,
        lastWriggle: -9999, forceShort: !!(forced && forced.forceShort),
        squash: 0, legPhase: rand(0, 6.28), wiggle: 0, alpha: 1,
        vis: 0, pileTilt: rand(-0.55, 0.55),
        speed: RUN_SPEED * rand(1 - RUN_VARY, 1 + RUN_VARY),
        leaving: false, born: now,
      };
      body.plugin.sheep = s;
      S.sheep.push(s);
      Composite.add(world, body);
      bleat(rand(0.82, 1.3) / Math.sqrt(scale), 0.14);
    }

    function despawn(s) {
      Composite.remove(world, s.body);
      const i = S.sheep.indexOf(s);
      if (i >= 0) S.sheep.splice(i, 1);
    }

    // --- counting ----------------------------------------------------------
    // Counts properly to COUNT_SANE, then starts skipping and shouting wrong
    // numbers. The count breaking down is the best joke in the design, so it
    // gets to break noisily.
    function countOne(now) {
      S.count++;
      const n = S.count;
      const milestone = n > COUNT_SANE && n % COUNT_SHOUT_EVERY === 0;
      if (!milestone && now - S.lastSpeak < SPEAK_GAP) return;
      S.lastSpeak = now;
      if (n <= COUNT_SANE) {
        say(NUMS[n] || String(n), 1.35, 1);
      } else if (milestone) {
        say(String(n) + '!', rand(1.5, 1.7), 1.1);
      } else if (Math.random() < 0.55) {
        say(WILD[Math.floor(Math.random() * WILD.length)], rand(1.4, 1.75), rand(1.15, 1.45));
      }
    }

    // --- collisions: squash and thunks ------------------------------------
    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        const sa = a.plugin.sheep, sb = b.plugin.sheep;
        const hit = clamp(rv / 11, 0, 1);
        if (sa) sa.squash = Math.max(sa.squash, hit);
        if (sb) sb.squash = Math.max(sb.squash, hit);
        if (hit > 0.3) {
          thunk(0.06 + hit * 0.16);
          if (hit > 0.62 && Math.random() < 0.6) bleat(rand(1.0, 1.5), 0.1);
        }
        if ((a.label === 'fence' || b.label === 'fence') && hit > 0.25) creak();
      }
    });

    // --- jam / farmer / burst ---------------------------------------------
    function triggerJam(now) {
      S.phase = 'farmer'; S.phaseT = now; S.spoke = {}; S.pending = 0;
      say('too many!', 1.7, 1.25);
    }

    function doBurst(now) {
      S.phase = 'burst'; S.phaseT = now;
      S.fenceUp = false;
      removeFence();
      burstSound();
      S.shake = 16;
      for (let i = 0; i < 14; i++) {
        S.debris.push({
          x: FENCE_X + rand(-50, 50), y: rand(FENCE_TOP, GROUND_Y),
          vx: rand(-3, 9), vy: rand(-11, -2), rot: rand(0, 6.28), vrot: rand(-0.3, 0.3),
          w: rand(7, 16), h: rand(26, 60), life: 1,
        });
      }
      for (const s of S.sheep) {
        Body.setVelocity(s.body, { x: rand(5, 11), y: rand(-7, -1.5) });
        s.squash = 1;
      }
      for (let i = 0; i < 5; i++) bleat(rand(0.8, 1.6), 0.12);
    }

    function resetScene(now) {
      S.count = 0;
      S.fenceUp = true;
      addFence();
      S.phase = 'play'; S.phaseT = now;
      S.farmerX = VW + 90;
      S.strain = 0;
    }

    // --- input -------------------------------------------------------------
    function tapAt(cx, cy, now) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) {
        const vx = ((cx - rect.left) / rect.width) * VW;
        const vy = ((cy - rect.top) / rect.height) * VH;
        S.puffs.push({ x: vx, y: vy, r: 6, a: 0.5 });
      }
      // The tap location is deliberately irrelevant: sheep always enter from
      // the left, or a tap to the right of the fence would spawn one that has
      // already cleared it and the joke dies.
      if (S.phase === 'play') S.pending = Math.min(S.pending + 1, SPAWN_QUEUE_MAX);
    }

    function onPointer(e) {
      e.preventDefault();
      unlockAudio();
      const now = performance.now();
      const wasAsleep = S.phase === 'sleep';
      S.lastTap = now;
      if (wasAsleep) { S.phase = 'play'; S.phaseT = now; }
      const touches = e.changedTouches;
      if (touches && touches.length) {
        const n = Math.min(touches.length, TAP_BURST_CAP);
        for (let i = 0; i < n; i++) tapAt(touches[i].clientX, touches[i].clientY, now);
      } else {
        tapAt(e.clientX, e.clientY, now);
      }
    }

    canvas.addEventListener('touchstart', onPointer, { passive: false });
    canvas.addEventListener('mousedown', onPointer);
    const swallow = (e) => e.preventDefault();
    canvas.addEventListener('touchmove', swallow, { passive: false });
    canvas.addEventListener('touchend', swallow, { passive: false });
    canvas.addEventListener('contextmenu', swallow);
    canvas.addEventListener('dblclick', swallow);

    // --- sizing ------------------------------------------------------------
    let k = 1;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = wrap.clientWidth || window.innerWidth;
      const ch = wrap.clientHeight || window.innerHeight;
      const scale = Math.min(cw / VW, ch / VH);
      canvas.style.width = Math.round(VW * scale) + 'px';
      canvas.style.height = Math.round(VH * scale) + 'px';
      canvas.width = Math.round(VW * scale * dpr);
      canvas.height = Math.round(VH * scale * dpr);
      k = scale * dpr;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener('orientationchange', resize);

    // --- step --------------------------------------------------------------
    function step(now) {
      const grounded = (s) => s.body.position.y >= GROUND_Y - SHEEP_R * s.scale - 9;

      // Everything pressed up against this sheep, and how much of it is on top.
      // This is the whole difference between "wedged on the rail with an empty
      // field behind me" and "third from the bottom of the heap": the first can
      // scramble out, the second is held by its neighbours. Checking only what
      // is directly above is not enough — a sheep at the front of a heap has
      // clear air over its head and would hop away, unpacking the pile-up.
      function penned(s) {
        const b = s.body, r = SHEEP_R * s.scale;
        let near = 0, above = 0;
        for (const o of S.sheep) {
          if (o === s) continue;
          const ob = o.body;
          const reach = r + SHEEP_R * o.scale;
          const dx = ob.position.x - b.position.x, dy = ob.position.y - b.position.y;
          if (dx * dx + dy * dy > (reach * 1.45) * (reach * 1.45)) continue;
          near++;
          if (dy < -r * 0.45) above++;
        }
        return above > 0 || near > 1;
      }

      const spawnGap = Math.max(SPAWN_GAP_MIN, SPAWN_GAP_MS - S.pending * 14);
      if (S.phase === 'play' && S.pending > 0 && now - S.lastSpawn >= spawnGap) {
        S.pending--;
        S.lastSpawn = now;
        spawnSheep(now);
      }

      let stuckCount = 0;
      for (let i = S.sheep.length - 1; i >= 0; i--) {
        const s = S.sheep[i];
        const b = s.body;
        const spd = Math.hypot(b.velocity.x, b.velocity.y);
        const g = grounded(s);

        // wedged?
        // Anything stalled anywhere short of the barn is part of the traffic
        // jam — a heap that backs up past the jump line still counts.
        const nearFence = b.position.x > 150 && b.position.x < FENCE_X + 150;
        if (nearFence && spd < STUCK_SPEED && S.fenceUp) s.stuckFor += 16.666;
        else s.stuckFor = 0;
        s.stuck = s.stuckFor > STUCK_MS;
        if (s.stuck) stuckCount++;

        // stalled long enough to start fighting it
        if (s.stuck && s.stuckFor > WRIGGLE_MS && now - s.lastWriggle > WRIGGLE_EVERY) {
          s.lastWriggle = now;
          if (!penned(s)) {
            // nothing holding it in: scramble forwards and over
            Body.setVelocity(b, { x: JUMP_VX * 0.82, y: -7.6 });
            s.lastJump = now;
            s.squash = -0.6;
            s.stuckFor = 0;
            boing(rand(0.72, 0.95) / Math.sqrt(s.scale));
          } else {
            // boxed in. applyForce respects the weight and the contacts, so this
            // is a squirm, not an escape — the heap has to thin out first.
            Body.applyForce(b, b.position, { x: b.mass * 0.004, y: -b.mass * 0.006 });
            if (Math.random() < 0.25) bleat(rand(1.2, 1.6), 0.07);
          }
        }

        // run, jump, run to the barn
        const beforeFence = b.position.x < FENCE_X - 8;
        // Launching does not require being properly grounded. A sheep nudged
        // a few pixels into the air by the one behind it would otherwise sail
        // straight into the fence without jumping, and that one failed sheep
        // is what the whole pile then backs up behind. Low enough to be in the
        // run lane is enough; sheep up in the heap stay in the heap.
        const canLaunch = b.position.y > GROUND_Y - 95;
        if (!s.leaving) {
          if (S.fenceUp && beforeFence && canLaunch && b.position.x >= JUMP_X && now - s.lastJump > REJUMP_MS) {
            const short = s.forceShort || Math.random() < SHORT_JUMP_CHANCE;
            s.forceShort = false;
            const j = 1 + (short
              ? -SHORT_JUMP - rand(0, 0.04)
              : rand(-JUMP_JITTER, JUMP_JITTER));
            Body.setVelocity(b, { x: JUMP_VX * j, y: JUMP_VY * j });
            s.lastJump = now;
            s.squash = -0.8;
            boing(rand(0.85, 1.2) / Math.sqrt(s.scale));
          } else if (g && b.velocity.x < s.speed) {
            // gentle, re-applied every frame: when the lane is blocked this
            // becomes shoving pressure, which is what builds the pile.
            const push = (S.phase === 'flood' || S.phase === 'burst') ? 2.2 : 1;
            Body.setVelocity(b, {
              x: b.velocity.x + (s.speed * push - b.velocity.x) * 0.18,
              y: b.velocity.y,
            });
          }
        }

        // counted when it crosses the fence line in the air
        if (!s.counted && b.position.x > FENCE_X && b.position.y < GROUND_Y - 70) {
          s.counted = true;
          if (S.phase === 'play') countOne(now);
        }

        // into the barn
        if (!s.leaving && b.position.x > BARN_DOOR_X) s.leaving = true;
        if (s.leaving) {
          s.alpha -= 0.055;
          if (s.alpha <= 0) { despawn(s); continue; }
        }
        if (b.position.y > VH + 200 || b.position.x > VW + 300) { despawn(s); continue; }

        // The body is a circle and rolls like a wheel — needed, because a
        // circle that cannot roll can only slide, and friction then eats the
        // run. So the roll is never drawn. The visual angle is its own thing:
        // lean into the run, nose up over the jump, and a stable jumbled tilt
        // once a sheep is part of the heap.
        let tilt;
        if (g) tilt = clamp(b.velocity.x, -8, 8) * 0.018;
        else if (spd < 0.9) tilt = s.pileTilt;
        else tilt = clamp(b.velocity.y * 0.03, -0.4, 0.4) + clamp(b.angularVelocity * 0.7, -0.5, 0.5);
        s.vis += (tilt - s.vis) * 0.22;

        // draw-time state
        s.squash += (0 - s.squash) * 0.14;
        s.wiggle = s.stuck ? Math.sin(now * 0.028 + s.id) : s.wiggle * 0.9;
        if (g || s.stuck) s.legPhase += s.stuck ? 0.55 : clamp(Math.abs(b.velocity.x) * 0.09, 0.02, 0.5);
        else s.legPhase += 0.06;
      }

      const targetStrain = clamp(stuckCount / JAM_STUCK, 0, 1);
      if (targetStrain > S.strain + 0.24) creak();
      S.strain += (targetStrain - S.strain) * 0.08;

      // phase machine
      if (S.phase === 'play') {
        const jammed = stuckCount >= JAM_STUCK
          || S.sheep.length >= JAM_TOTAL
          || (JAM_COUNT > 0 && S.count >= JAM_COUNT);
        if (jammed) triggerJam(now);
        else if (now - S.lastTap > IDLE_SLEEP_MS) { S.phase = 'sleep'; S.phaseT = now; }
      } else if (S.phase === 'farmer') {
        const dt = now - S.phaseT;
        S.farmerX += (636 - S.farmerX) * 0.055;
        if (dt > 1500 && !S.spoke.line) {
          S.spoke.line = true;
          say("Oh my gosh, there's so many!", 0.65, 0.92);
        }
        if (dt > 3100) doBurst(now);
      } else if (S.phase === 'burst') {
        S.farmerX += (VW + 120 - S.farmerX) * 0.03;
        if (now - S.phaseT > 450) { S.phase = 'flood'; S.phaseT = now; }
      } else if (S.phase === 'flood') {
        S.farmerX += (VW + 120 - S.farmerX) * 0.04;
        if (S.sheep.length === 0 || now - S.phaseT > 4200) {
          for (const s of [...S.sheep]) despawn(s);
          resetScene(now);
        }
      }

      const wantSleep = S.phase === 'sleep' ? 1 : 0;
      S.sleepA += (wantSleep - S.sleepA) * 0.03;

      for (let i = S.puffs.length - 1; i >= 0; i--) {
        const p = S.puffs[i];
        p.r += 1.3; p.a -= 0.035;
        if (p.a <= 0) S.puffs.splice(i, 1);
      }
      for (let i = S.debris.length - 1; i >= 0; i--) {
        const d = S.debris[i];
        d.vy += 0.42; d.x += d.vx; d.y += d.vy; d.rot += d.vrot;
        if (d.y > GROUND_Y - 6) { d.y = GROUND_Y - 6; d.vy *= -0.3; d.vx *= 0.7; d.vrot *= 0.6; }
        d.life -= 0.009;
        if (d.life <= 0) S.debris.splice(i, 1);
      }

      S.shake *= 0.88;
      Engine.update(engine, 16.666);
    }

    // --- drawing -----------------------------------------------------------
    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      g.addColorStop(0, '#8fd3f4');
      g.addColorStop(0.65, '#c9e9f6');
      g.addColorStop(1, '#eaf6e4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, GROUND_Y);

      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.85;
      const clouds = [[140, 90, 40], [330, 58, 28], [620, 96, 34], [820, 62, 24]];
      for (const c of clouds) {
        const cx = c[0], cy = c[1], cr = c[2];
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, 6.2832);
        ctx.arc(cx + cr * 0.8, cy + 6, cr * 0.75, 0, 6.2832);
        ctx.arc(cx - cr * 0.85, cy + 8, cr * 0.65, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#a7d49b';
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.quadraticCurveTo(180, GROUND_Y - 95, 380, GROUND_Y - 10);
      ctx.quadraticCurveTo(560, GROUND_Y - 80, 960, GROUND_Y - 20);
      ctx.lineTo(VW, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }

    function drawGround() {
      const g = ctx.createLinearGradient(0, GROUND_Y, 0, VH);
      g.addColorStop(0, '#79c35e');
      g.addColorStop(1, '#4f9440');
      ctx.fillStyle = g;
      ctx.fillRect(0, GROUND_Y, VW, VH - GROUND_Y);
      ctx.strokeStyle = '#5faa4a';
      ctx.lineWidth = 2;
      for (let x = 8; x < VW; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y + 6);
        ctx.lineTo(x + 4, GROUND_Y - 4);
        ctx.stroke();
      }
    }

    function drawBarn() {
      const x = 672, w = 248, y = GROUND_Y, h = 168;
      ctx.fillStyle = '#b4452f';
      ctx.fillRect(x, y - h, w, h);
      ctx.fillStyle = '#7a2a1c';
      ctx.beginPath();
      ctx.moveTo(x - 18, y - h);
      ctx.lineTo(x + w / 2, y - h - 58);
      ctx.lineTo(x + w + 18, y - h);
      ctx.closePath();
      ctx.fill();

      const dw = 104, dh = 112;
      const dx = x + w / 2 - dw / 2;
      ctx.fillStyle = '#2a1714';
      ctx.fillRect(dx, y - dh, dw, dh);
      if (S.phase === 'flood' || S.phase === 'burst') {
        ctx.fillStyle = 'rgba(255,214,130,0.22)';
        ctx.fillRect(dx, y - dh, dw, dh);
      }
      ctx.strokeStyle = '#f1e6d8';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(dx, y - dh); ctx.lineTo(dx + dw, y);
      ctx.moveTo(dx + dw, y - dh); ctx.lineTo(dx, y);
      ctx.stroke();
      ctx.strokeRect(dx, y - dh, dw, dh);

      ctx.fillStyle = '#f1e6d8';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y - h - 6);
      ctx.lineTo(x + w / 2 + 22, y - h + 20);
      ctx.lineTo(x + w / 2 - 22, y - h + 20);
      ctx.closePath();
      ctx.fill();
    }

    function drawFence() {
      if (!S.fenceUp) return;
      const lean = S.strain * 0.11;
      ctx.save();
      ctx.translate(FENCE_X, GROUND_Y);
      ctx.rotate(lean);
      ctx.translate(-FENCE_X, -GROUND_Y);
      ctx.fillStyle = '#c99b63';
      ctx.strokeStyle = '#8f6a3e';
      ctx.lineWidth = 3;
      for (const px of [FENCE_X - 42, FENCE_X + 42]) {
        ctx.fillRect(px - 7, FENCE_TOP - 8, 14, GROUND_Y - FENCE_TOP + 8);
        ctx.strokeRect(px - 7, FENCE_TOP - 8, 14, GROUND_Y - FENCE_TOP + 8);
      }
      ctx.fillRect(FENCE_X - 52, FENCE_TOP, 104, 12);
      ctx.strokeRect(FENCE_X - 52, FENCE_TOP, 104, 12);
      ctx.fillRect(FENCE_X - 52, FENCE_TOP + 52, 104, 11);
      ctx.strokeRect(FENCE_X - 52, FENCE_TOP + 52, 104, 11);
      ctx.restore();
    }

    function drawLegs(r, phase, stuck, dark) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(3, r * 0.16);
      ctx.lineCap = 'round';
      const amp = stuck ? 0.9 : 0.38;
      for (let i = 0; i < 4; i++) {
        const lx = (-0.52 + (i % 2) * 0.1 + (i < 2 ? 0 : 0.95)) * r;
        const sw = Math.sin(phase + i * 1.9) * amp;
        ctx.beginPath();
        ctx.moveTo(lx, r * 0.42);
        ctx.lineTo(lx + sw * r * 0.5, r * 1.02 + (stuck ? Math.abs(sw) * r * 0.2 : 0));
        ctx.stroke();
      }
    }

    // One draw function per creature, taking only its state: swapping in a
    // scanned drawing later is a change here and nowhere else.
    function drawSheep(s, now) {
      const b = s.body;
      const r = SHEEP_R * s.scale;
      const sq = s.squash;
      const cow = s.kind === 'cow';
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(s.vis + s.wiggle * 0.22);
      ctx.scale(1 + sq * 0.3, 1 - sq * 0.3);

      drawLegs(r, s.legPhase, s.stuck, cow ? '#4a4038' : '#49454f');

      ctx.fillStyle = cow ? '#f6f3ee' : '#fbfbf7';
      ctx.strokeStyle = cow ? '#d6d0c6' : '#dedbd2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.2832;
        ctx.arc(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.42, r * 0.5, 0, 6.2832);
      }
      ctx.fill();
      ctx.stroke();

      if (cow) {
        ctx.fillStyle = '#35302c';
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.1, r * 0.32, 0, 6.2832);
        ctx.arc(r * 0.18, r * 0.22, r * 0.24, 0, 6.2832);
        ctx.fill();
      }

      const hx = r * 0.84, hy = -r * 0.36;
      ctx.fillStyle = cow ? '#f0e3dc' : '#4a4654';
      ctx.beginPath();
      ctx.ellipse(hx, hy, r * 0.36, r * 0.31, 0.25, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx - r * 0.2, hy - r * 0.26, r * 0.2, r * 0.1, -0.5, 0, 6.2832);
      ctx.fill();
      if (cow) {
        ctx.fillStyle = '#e8c9b8';
        ctx.beginPath();
        ctx.ellipse(hx + r * 0.22, hy + r * 0.12, r * 0.18, r * 0.14, 0.2, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = '#35302c';
        ctx.fillRect(hx - r * 0.34, hy - r * 0.46, r * 0.1, r * 0.2);
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx + r * 0.08, hy - r * 0.04, r * 0.095, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#16141c';
      ctx.beginPath();
      ctx.arc(hx + r * 0.11, hy - r * 0.04, r * 0.05, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = cow ? '#f6f3ee' : '#fbfbf7';
      ctx.beginPath();
      ctx.arc(hx - r * 0.1, hy - r * 0.3, r * 0.19, 0, 6.2832);
      ctx.fill();

      if (s.stuck) {
        ctx.globalAlpha = s.alpha * (0.4 + 0.3 * Math.sin(now * 0.012 + s.id));
        ctx.strokeStyle = '#ffd36b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.25, 0, 6.2832);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawFarmer(now) {
      if (S.farmerX > VW + 60) return;
      const bob = Math.sin(now * 0.012) * 4;
      ctx.save();
      ctx.translate(S.farmerX, GROUND_Y + bob);
      ctx.strokeStyle = '#3f5d8a';
      ctx.lineWidth = 11; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-6, -46); ctx.lineTo(-10, -4);
      ctx.moveTo(8, -46); ctx.lineTo(13, -4);
      ctx.stroke();
      ctx.fillStyle = '#4a6ea3';
      ctx.fillRect(-16, -96, 34, 54);
      ctx.fillStyle = '#c94f3d';
      ctx.fillRect(-16, -104, 34, 18);
      const w = Math.sin(now * 0.02) * 0.5;
      ctx.strokeStyle = '#c94f3d'; ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-14, -98); ctx.lineTo(-36 - w * 6, -128 + w * 10);
      ctx.moveTo(16, -98); ctx.lineTo(38 + w * 6, -128 - w * 10);
      ctx.stroke();
      ctx.fillStyle = '#f0c9a8';
      ctx.beginPath(); ctx.arc(1, -118, 15, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#d8b35e';
      ctx.beginPath(); ctx.ellipse(1, -130, 28, 7, 0, 0, 6.2832); ctx.fill();
      ctx.fillRect(-11, -146, 24, 16);
      ctx.fillStyle = '#5a2b25';
      ctx.beginPath(); ctx.ellipse(1, -112, 5, 7, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    function draw(now) {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const sh = S.shake;
      if (sh > 0.4) ctx.translate(rand(-sh, sh), rand(-sh, sh));
      ctx.clearRect(-40, -40, VW + 80, VH + 80);

      drawSky();
      drawGround();
      drawBarn();

      for (const d of S.debris) {
        ctx.save();
        ctx.globalAlpha = clamp(d.life, 0, 1);
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.fillStyle = '#c99b63';
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.restore();
      }

      // Sheep above the rail are drawn behind the fence, the rest in front, so
      // a sheep straddling the rail reads as caught in it.
      for (const s of S.sheep) if (s.body.position.y < FENCE_TOP + 40) drawSheep(s, now);
      drawFence();
      for (const s of S.sheep) if (s.body.position.y >= FENCE_TOP + 40) drawSheep(s, now);

      drawFarmer(now);

      ctx.globalAlpha = 1;
      for (const p of S.puffs) {
        ctx.globalAlpha = clamp(p.a, 0, 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (SHOW_COUNT && S.count > 0) {
        const tooMany = S.count > COUNT_SANE;
        ctx.font = (tooMany ? 'bold 92px' : 'bold 76px') + " 'IBM Plex Sans', system-ui, sans-serif";
        ctx.textAlign = 'left';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.fillStyle = tooMany ? '#e0452c' : '#3c4a63';
        ctx.save();
        ctx.translate(42, 108 + (tooMany ? Math.sin(now * 0.02) * 5 : 0));
        ctx.rotate(tooMany ? Math.sin(now * 0.015) * 0.05 : 0);
        ctx.strokeText(String(S.count), 0, 0);
        ctx.fillText(String(S.count), 0, 0);
        ctx.restore();
      }

      if (S.sleepA > 0.01) {
        ctx.fillStyle = 'rgba(6,8,20,' + (S.sleepA * 0.93).toFixed(3) + ')';
        ctx.fillRect(-40, -40, VW + 80, VH + 80);
        if (S.sleepA > 0.5) {
          ctx.globalAlpha = (S.sleepA - 0.5) * 2;
          ctx.fillStyle = '#9fb6d8';
          ctx.font = "bold 54px 'IBM Plex Sans', system-ui, sans-serif";
          ctx.textAlign = 'center';
          ctx.fillText('z  z  z', VW / 2 + Math.sin(now * 0.002) * 10, VH / 2 - 10);
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- loop: fixed physics step, so a frame hitch can't launch a sheep ---
    let raf = 0, acc = 0, last = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      let dt = now - last;
      last = now;
      if (dt > 120) dt = 120;
      acc += dt;
      let guard = 0;
      while (acc >= 16.666 && guard++ < 6) { step(now); acc -= 16.666; }
      draw(now);
    }
    raf = requestAnimationFrame(frame);

    // --- debug hooks -------------------------------------------------------
    // The silly cases are rare on purpose (SURPRISE_CHANCE), which makes them
    // miserable to tune by playing. These fire them on demand.
    function wake() {
      const now = performance.now();
      S.lastTap = now;
      if (S.phase === 'sleep') { S.phase = 'play'; S.phaseT = now; }
      return now;
    }
    apiRef.current = {
      spawn(forced) { unlockAudio(); spawnSheep(wake(), forced); },
      wave(n) { unlockAudio(); wake(); S.pending = Math.min(S.pending + n, SPAWN_QUEUE_MAX); },
      pile() {
        unlockAudio();
        const now = wake();
        // a block dumped on the fence: instant traffic jam, no mashing. Dense
        // enough that the sheep underneath are genuinely pinned, or the heap
        // just unpacks itself from the top and the farmer never comes.
        for (let i = 0; i < 15; i++) {
          spawnSheep(now, {
            x: FENCE_X - 96 + (i % 3) * 50,
            y: GROUND_Y - 34 - Math.floor(i / 3) * 50,
            forceShort: true,
          });
        }
      },
      farmer() { unlockAudio(); if (S.phase === 'play') triggerJam(wake()); },
      burst() { unlockAudio(); doBurst(wake()); },
      sleep() { const now = performance.now(); S.phase = 'sleep'; S.phaseT = now; S.lastTap = now - IDLE_SLEEP_MS; },
      setCount(n) { S.count = n; },
      reset() {
        const now = wake();
        for (const s of [...S.sheep]) despawn(s);
        S.pending = 0; S.debris.length = 0; S.shake = 0;
        removeFence();
        resetScene(now);
      },
    };

    if (import.meta.env && import.meta.env.DEV) window.__sheep = { S, engine };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('orientationchange', resize);
      canvas.removeEventListener('touchstart', onPointer);
      canvas.removeEventListener('mousedown', onPointer);
      canvas.removeEventListener('touchmove', swallow);
      canvas.removeEventListener('touchend', swallow);
      canvas.removeEventListener('contextmenu', swallow);
      canvas.removeEventListener('dblclick', swallow);
      apiRef.current = null;
      Events.off(engine);
      Composite.clear(world, false);
      Engine.clear(engine);
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed', left: 0, top: 0, width: '100vw', height: '100dvh',
        zIndex: 9999, background: '#0a0d14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', touchAction: 'none',
        userSelect: 'none', WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none',
        cursor: 'pointer',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none' }} />

      <div
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
          touchAction: 'manipulation',
          font: "500 12px/1 'IBM Plex Mono', ui-monospace, monospace",
        }}
      >
        <button style={{ ...chip, opacity: 0.75 }} onClick={() => setShowDebug((v) => !v)}>
          {showDebug ? 'hide debug' : 'debug'}
        </button>
        {showDebug && DEBUG_GROUPS.map((group, gi) => (
          <div key={gi} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {group.map(([label, run]) => (
              <button
                key={label}
                style={chip}
                onClick={() => { const a = apiRef.current; if (a) run(a); }}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const chip = {
  padding: '6px 9px',
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(10,13,20,0.62)',
  color: '#cfe0f5',
  font: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
