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
// Sheep walk in from off stage. The leading edge is on screen about 45 ms
// after the tap, so the toy still feels instant, but the backlog is now a
// visible line of sheep walking in rather than a number in a closure.
const SPAWN_X = -35;
const CULL_X = -600;             // anything shoved this far back is gone
const DOOR_X0 = 744;             // the barn doorway, as drawBarn() lays it out:
const DOOR_X1 = 848;             // sheep are clipped to this and swallowed by it
const DOOR_H = 112;

const RUN_SPEED = 4.6;
const JUMP_VX = 5.4;             // enough carry to land past the rail, not on it
const JUMP_VY = -11.0;
const JUMP_JITTER = 0.04;        // ordinary variation, rolled per jump
// Retired to 0: a per-jump dice roll made the same sheep good then bad, so no
// bumbler was ever recognisable, and 0.12 off a power of 1.0 lands at 0.88 —
// above the measured failure cliff, so it never actually failed on its own.
// The low tail of POWER_SIGMA does this job now, per sheep instead of per jump.
const SHORT_JUMP_CHANCE = 0;
const SHORT_JUMP = 0.12;
// Per-sheep jump traits, rolled once at spawn, so the bad jumpers are the same
// individuals every time and the player learns to recognise them. The spread
// is set against the measured failure cliff — see TOO_MANY_SHEEP_NOTES.md.
const POWER_SIGMA = 0.22;        // jump-power spread, 1.0 = a textbook jump
const LAUNCH_X_JITTER = 20;      // px either side of JUMP_X, per sheep. Measured
                                 // safe band is about -95..+32, so a late roll
                                 // scuffs the rail and only an unlucky late-and-
                                 // weak sheep actually clouts the post.
// Each sheep runs at its own speed, so a crowd bunches the way traffic does:
// harmless when there are two of them, a pile-up when there are twelve.
const RUN_VARY = 0.12;
const REJUMP_MS = 450;           // a sheep that bonks the fence has another go

// How much of the jump comes from how fast the sheep is actually moving when
// it leaves the ground. 0 = the old fixed-size jump. With it above zero a
// crowded lane is a slow lane, a slow sheep comes up short, and short sheep
// block the lane — so a pile-up feeds itself. This coefficient is the knob.
// Measured: at 0.35 a sheep merely slowed by traffic came up short, 58% of
// jumps failed and the lane never recovered — the cascade swallowed the calm
// climb exactly as the notes feared. At 0.18 a sheep has to be genuinely slow,
// or already weak, before the lane costs it the fence.
const JUMP_SPEED_COUPLING = 0.18;

// A sheep that fails runs at it harder next time, and gives up the extra once
// it is over. This is what guarantees it eventually clears on its own: every
// failed attempt strictly improves the next one, so no sheep's prospects can
// get worse over time. Distance alone cannot do it — locomotion saturates at
// the sheep's own top speed after about 65 px of run-up.
const DETERMINATION_STEP = 1.09; // speed multiplier per failed attempt
const DETERMINATION_CAP = 1.5;
// Locomotion saturates at the sheep's own top speed after about 65 px, so a
// longer run-up buys nothing — and every px of it is lane the queue behind
// cannot use. Measured: a failed jump blocks the lane for about a second, and
// at 15% failures that was most of the fence's capacity.
const RUNUP_WANT = 65;           // px of clear lane a sheep backs up for
const RETREAT_FORCE = 0.0022;    // force, not velocity: a crowded lane physically
                                 // prevents the trot-back, and there is never a
                                 // velocity fight between two opposing sheep
// The following distance IS the service rate: sheep run nose-to-tail at one
// body plus this gap, so the fence clears roughly RUN_SPEED / (2r + gap) sheep
// a second. At 54 px that worked out at 2.8/s, below the 4-5 taps a second a
// small child produces, and the toy was jammed from the first few taps.
const BRAKE_GAP = 22;            // look-ahead: start braking within this gap
const LOOK_AHEAD = 150;          // px in front a sheep pays attention to
// A sheep that has braked to a shuffle does not attempt the fence: it baulks
// and waits for the lane. Without this, a queued sheep jumps from a standstill,
// the speed coupling turns that into a hopeless jump, and every sheep in a
// queue fails — the queue could never serve anybody. Measured: at this speed
// the coupled jump lands just above the failure cliff, so a sheep that does
// commit, clears.
const MIN_LAUNCH_SPEED = RUN_SPEED * 0.7;
// ...but it will not baulk for ever. A sheep stood at the jump line this long
// has a go whatever speed it is doing, which it will probably muff. That is
// the point: the lane always does something, a muffed jump feeds the heap, and
// the heap is a ramp. Without it a dense enough queue is a gridlock that never
// resolves and never even summons the farmer.
const BAULK_MS = 1700;

// Measured, by sweeping solo sheep at graded power: below this multiplier a
// sheep cannot clear the rail from a standing start, above it it can. 0.78 is
// the knife edge where it lands straddling the rail. Everything about jump
// variance is set against this number rather than guessed.
const POWER_CLIFF = 0.80;
// A lame sheep is not a special creature with its own dice roll: it is simply
// the low tail of the ordinary power distribution. One mechanism, so the
// frequency of bumblers is POWER_SIGMA and nothing else, and a sheep that
// rolls under the cliff is the one that limps and has to work up to it.
const LAME_CHANCE = 0;           // > 0 forces this fraction into the low tail
const LAME_POWER = [0.70, 0.77];
const LAME_TRIES_TO_CLEAR = 0;   // 0 = off. Above zero, a lame sheep is simply
                                 // handed a clearing jump after this many tries,
                                 // which is the counter version of the same idea.
const LAUNCH_KICK = 0.5;         // how much of a jump is paid for by whatever it
                                 // pushed off. Accuracy is not the point.

const SHEEP_R = 23;
const MAX_SHEEP = 70;            // hard cap so an old iPad survives a palm-slam
const TAP_BURST_CAP = 5;         // one palm-slam spawns at most this many

const JAM_STUCK = 3;             // sheep both stalled AND boxed in, to summon the farmer
const JAM_TOTAL = 0;             // 0 = never summon the farmer for a head count. It
                                 // was 20, which is the same sin JAM_COUNT had: it
                                 // fires on a number rather than on a jam, and sheep
                                 // queueing off-screen would trip it with nothing wrong.
const JAM_COUNT = 0;             // 0 = the count alone NEVER summons the farmer, so a
                                 // calm player counts up forever. Only a real traffic
                                 // jam ends a round. Set this > 0 to cap a round at a
                                 // number again.
// The fence's own state of health, wound up by the impulses the sheep put
// into the rail and unwinding at STRAIN_DECAY a step (about 0.4 of it a
// second). Full strain is a fence about to go.
// Two ways to wind a fence up, because there are two ways to push one over.
// A sharp hit — a giant at speed, a sheep clouting the post — is an impulse.
// A heap leaning on it is a steady push that no collisionStart will ever
// report, because the contact only begins once. Measured: one sheep leaning
// settles the fence at about 0.14 strain, five at 0.7, ten take it out.
const STRAIN_PER_IMPULSE = 0.0035;
const STRAIN_PER_LEAN = 0.0009;  // per leaning sheep, per step
const STRAIN_DECAY = 0.985;
const STRAIN_BURSTS = true;      // a fully wound fence goes without waiting for
                                 // the farmer's 3.1 s cue, so the sheep are what
                                 // break it. false = the old timer alone.
const STUCK_SPEED = 0.7;
const STUCK_MS = 500;            // time below STUCK_SPEED before a sheep counts as wedged

// A sheep stalled this long starts fighting to get out. With nothing on top of
// it — a lone sheep straddling the rail, the sheep on top of the heap — it
// wriggles free and carries on, so stuck sheep no longer accumulate for ever
// across a quiet run. Buried sheep can only squirm: the weight above wins, and
// the pile-up still builds.
const WRIGGLE_MS = 1600;
const WRIGGLE_EVERY = 380;

const COUNT_SANE = 0;            // 0 = always say the real number. Above zero the
                                 // voice starts talking nonsense past this count,
                                 // which is the old wrong-numbers joke; it is off
                                 // because a number that causes nothing should not
                                 // be dressed up as an emergency.
// The voice is the flow meter. Every crossing cancels the line and starts the
// current number, so a number completing cleanly means the fence is keeping up
// and a stutter means it is being over-driven. Measured in Chromium: a restart
// less than ~130 ms after the last one usually produces no audio at all (100%
// silent at 40 ms, 50% at 100 ms, 0% at 170 ms), so the restart has a floor —
// below it the newest number is held and spoken the moment the floor expires,
// which keeps the stutter audible instead of silent. See the notes file.
const SPEAK_FLOOR = 220;
const COUNT_SHOUT_EVERY = 10;    // every tenth number is louder and higher

// Popcorn spawning: a tap puts a sheep on the lane at once, stacked above the
// last one if it has not walked off yet, and the stack avalanches into the
// lane. The backlog is then a physical queue walking in rather than a counter,
// and the spacing comes from geometry instead of from a rate.
// SPAWN_GAP_MS > 0 brings the old meter back: taps queue in S.pending and
// trickle in at that gap, shrinking towards SPAWN_GAP_MIN as the queue grows.
const SPAWN_GAP_MS = 0;          // 0 = popcorn, every tap lands immediately
const SPAWN_GAP_MIN = 95;        // only read when the meter is on
const SPAWN_QUEUE_MAX = 20;      // only read when the meter is on
const SPAWN_STACK = 5;           // sheep per column before a new one starts behind

const SURPRISE_CHANCE = 0.085;   // giant / tiny / cow
const IDLE_SLEEP_MS = 45000;     // no tapping for this long -> wind-down
const SHOW_COUNT = true;         // the one bit of on-screen text; flip to false
// ---------------------------------------------------------------------------

// Spoken out in full, however far the count gets: the number is the reward for
// a long calm run, and "a hundred and thirteen" takes long enough to say that
// the voice doubles as the flow meter.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];

function toWords(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const o = n % 10;
    return TENS[Math.floor(n / 10)] + (o ? '-' + ONES[o] : '');
  }
  if (n < 1000) {
    const r = n % 100;
    return ONES[Math.floor(n / 100)] + ' hundred' + (r ? ' and ' + toWords(r) : '');
  }
  if (n < 1000000) {
    const r = n % 1000;
    return toWords(Math.floor(n / 1000)) + ' thousand' + (r ? ' ' + toWords(r) : '');
  }
  return String(n);
}

// Only read when COUNT_SANE > 0, i.e. when the wrong-numbers joke is switched on.
const WILD = ['seventeen', 'twenty', 'thirty', 'forty', 'fifty', 'eighty', 'a hundred'];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// Two uniforms summed: a cheap bell with hard edges, so a trait can be given a
// fat tail (the hopeless jumpers) without any sheep rolling an absurd value.
const gauss = (sigma) => sigma * ((Math.random() + Math.random() + Math.random()) * 2 / 3 - 1) * 1.5;

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

function creak(vol = 0.06) {
  if (!actx) return;
  const t0 = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(rand(70, 95), t0);
  osc.frequency.linearRampToValueAtTime(rand(45, 62), t0 + 0.35);
  env(g, t0, clamp(vol, 0.01, 0.3), 0.08, 0.3);
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
    ['Lame', (a) => a.spawn({ lame: true })],
    ['Slow lane', (a) => a.slowLane()],
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
  // Closed by default: the panel lives in the top-right, which is exactly
  // where a small child's hand lands, and the toy is being played with now.
  const [showDebug, setShowDebug] = useState(false);

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
      strainAcc: 0,
      lastSpeak: 0,
      sayPending: false,
      lastCountAt: -9999,
      lastTap: performance.now(),
      shake: 0,
      sleepA: 0,
      pending: 0,
      lastSpawn: 0,
      farmerX: VW + 90,
      spoke: {},
      nextId: 1,
      // measurement hooks, read by the dev console only (window.__sheep):
      // noJam holds the farmer back so a rate can be measured over a long
      // window, crossed is a crossing count that survives a reset.
      noJam: false,
      crossed: 0,
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
      // Popcorn stacking. Two sheep spawned on the same point get a huge
      // positional correction out of Matter and separate explosively, which
      // can fling one across the field, so each new arrival is placed on top
      // of whatever is still standing at the gate. Circles do not stack, so
      // the column avalanches into the lane on its own.
      let sx = SPAWN_X, sy = GROUND_Y - r - rand(0, 8);
      if (forced && forced.x != null) {
        sx = forced.x;
        sy = forced.y != null ? forced.y : GROUND_Y - r - rand(0, 8);
      } else {
        let col = 0, inCol = 0;
        for (let guard = 0; guard < 6; guard++) {
          sx = SPAWN_X - col * SHEEP_R * 2.1;
          inCol = S.sheep.filter((o) => Math.abs(o.body.position.x - sx) < SHEEP_R * 1.1).length;
          if (inCol < SPAWN_STACK) break;
          col++;
        }
        sy = GROUND_Y - r - rand(0, 8) - inCol * (SHEEP_R * 2.1);
      }
      const body = Bodies.circle(sx, sy, r, {
        friction: 0.62, frictionStatic: 0.9, frictionAir: 0.002,
        // barely bouncy: springy sheep hop off each other, go airborne and
        // miss their jump, which turns a stream into a wall
        restitution: 0.12, density: 0.0014, label: 'sheep',
      });
      Body.setVelocity(body, { x: RUN_SPEED, y: 0 });
      const forceLame = (forced && forced.lame) || (!forced && LAME_CHANCE > 0 && Math.random() < LAME_CHANCE);
      const s = {
        id: S.nextId++, body, kind, scale,
        counted: false, lastJump: -9999, stuckFor: 0, stuck: false,
        lastWriggle: -9999, forceShort: !!(forced && forced.forceShort),
        squash: 0, bonk: 0, legPhase: rand(0, 6.28), wiggle: 0, alpha: 1,
        vis: 0, pileTilt: rand(-0.55, 0.55),
        speed: RUN_SPEED * rand(1 - RUN_VARY, 1 + RUN_VARY),
        dir: 1, overshot: false, born: now,
        // jump traits: how hard it can push off, and where it decides to go.
        // Jumping early lands you on the rail, late puts you into the post,
        // which is the actual cause of a short jump.
        power: forced && forced.power != null ? forced.power
          : forceLame ? rand(LAME_POWER[0], LAME_POWER[1]) : 1 + gauss(POWER_SIGMA),
        // Deliberately lopsided, because the measured safe band is lopsided:
        // about -95 px early to +32 px late. Jumping early costs a scuff;
        // jumping late puts the sheep into the post, where it fails hard
        // against the fence, cannot retreat for the queue behind it and cannot
        // jump for the sheep climbing over it. That one sheep is what turns a
        // busy lane into a jam, so the late tail is kept short.
        launchX: forced && forced.launchX != null ? forced.launchX
          : rand(-LAUNCH_X_JITTER * 1.6, LAUNCH_X_JITTER * 0.9),
        attempts: 0, tries: 0, tryOpen: false, retreatTo: -9999, atLine: now,
        rejumpMs: REJUMP_MS * rand(0.8, 1.35),
        contacts: [],
      };
      s.baseSpeed = s.speed;
      s.lame = s.power < POWER_CLIFF;   // it limps because it is weak, not the other way round
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
    // Every crossing asks for the voice, and the voice always says the real
    // current number. A crossing inside SPEAK_FLOOR does not get dropped: it
    // leaves the request standing, and trySpeak picks up the *then* current
    // number as soon as the floor expires. So mashing produces a stutter of
    // newest-numbers at the floor rate, and never silence.
    function countOne(now) {
      S.count++;
      S.crossed++;
      S.lastCountAt = now;
      S.sayPending = true;
      trySpeak(now);
    }

    function trySpeak(now) {
      if (!S.sayPending || now - S.lastSpeak < SPEAK_FLOOR) return;
      S.sayPending = false;
      S.lastSpeak = now;
      const n = S.count;
      const shout = COUNT_SHOUT_EVERY > 0 && n % COUNT_SHOUT_EVERY === 0;
      if (COUNT_SANE > 0 && n > COUNT_SANE && !shout) {
        say(WILD[Math.floor(Math.random() * WILD.length)], rand(1.4, 1.75), rand(1.15, 1.45));
      } else if (shout) {
        say(toWords(n) + '!', rand(1.5, 1.7), 1.1);
      } else {
        say(toWords(n), 1.35, 1);
      }
    }

    // --- collisions: squash and thunks ------------------------------------
    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        const sa = a.plugin.sheep, sb = b.plugin.sheep;
        const hit = clamp(rv / 11, 0, 1);
        if (sa) { sa.squash = Math.max(sa.squash, hit); sa.bonk = Math.max(sa.bonk, hit); }
        if (sb) { sb.squash = Math.max(sb.squash, hit); sb.bonk = Math.max(sb.bonk, hit); }
        if (hit > 0.3) {
          thunk(0.06 + hit * 0.16);
          if (hit > 0.62 && Math.random() < 0.6) bleat(rand(1.0, 1.5), 0.1);
          // a bump raises dust where the feet are
          const s = sa || sb;
          if (s && hit > 0.45) {
            S.puffs.push({ x: s.body.position.x + rand(-8, 8), y: GROUND_Y - 3, r: 5, a: 0.4 });
          }
        }
        // The fence's strain is what the sheep actually do to it: every
        // impulse into the rail winds it up, and it unwinds on its own. So a
        // pile backing away from the fence really does relieve it, and a
        // giant at speed really does wind it up faster than ten lambs leaning.
        if (a.label === 'fence' || b.label === 'fence') {
          const sheepBody = sa ? a : sb ? b : null;
          if (sheepBody) {
            const impulse = sheepBody.mass * rv;
            S.strainAcc = clamp(S.strainAcc + impulse * STRAIN_PER_IMPULSE, 0, 1.6);
            if (hit > 0.25) creak(0.04 + S.strain * 0.14);
          }
        }
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
      S.strainAcc = 0;
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
      if (S.phase !== 'play') return;
      if (SPAWN_GAP_MS > 0) S.pending = Math.min(S.pending + 1, SPAWN_QUEUE_MAX);
      else spawnSheep(now);
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

      // One predicate, four facts, so nothing can disagree with anything else:
      //
      //   footing  something solid under it — ground, rail, or another sheep.
      //            Real contacts from the engine, so the rail counts.
      //   air      nothing above or above-in-front, i.e. the launch arc is open.
      //   near/above  the crowding either side of it.
      //
      // footing && air is what lets a sheep jump, and it replaces the old
      // height gate. The top of a heap has footing and air, so it launches —
      // a pile-up sheds sheep over the fence out of its own top, which is the
      // funniest possible way for a jam to start solving itself. A buried
      // sheep has footing but no air, so it stays buried and still counts
      // towards the jam. The two happen at once in the same heap.
      //
      // penned() is derived from the same numbers: checking only what is
      // directly above is not enough, because a sheep at the front of a heap
      // has clear sky over its head and would hop away, unpacking the pile.
      function sense(s) {
        const b = s.body, r = SHEEP_R * s.scale;
        let near = 0, above = 0, air = true, footing = false;
        let support = null, ahead = null, aheadGap = LOOK_AHEAD;
        for (const c of s.contacts) {
          if (c.position.y - b.position.y > r * 0.3) {
            footing = true;
            if (c.plugin.sheep && (!support || c.position.y < support.position.y)) support = c;
          }
        }
        for (const o of S.sheep) {
          if (o === s) continue;
          const ob = o.body, orr = SHEEP_R * o.scale;
          const reach = r + orr;
          const dx = ob.position.x - b.position.x, dy = ob.position.y - b.position.y;
          // Only sheep on this side of the fence are in the way. One that has
          // landed just beyond the rail is not something to queue behind, and
          // braking for it stalls the whole lane right at the jump line.
          const sameSide = !S.fenceUp
            || (b.position.x < FENCE_X) === (ob.position.x < FENCE_X);
          if (sameSide && Math.abs(dy) < reach * 0.9 && dx * s.dir > 0) {
            const gap = Math.abs(dx) - reach;
            if (gap < aheadGap) { aheadGap = gap; ahead = o; }
          }
          if (dx * dx + dy * dy > (reach * 1.45) * (reach * 1.45)) continue;
          near++;
          if (dy < -r * 0.45) above++;
          // the launch arc: up, and up-and-forward. A sheep standing on the
          // ground in front is something to jump over, not something in the way.
          if (dy < -r * 0.35 && dx * s.dir > -r * 0.6) air = false;
        }
        return { footing, air, near, above, support, ahead, aheadGap };
      }
      const penned = (q) => q.above > 0 || q.near > 1;

      trySpeak(now);

      // Real contacts from the solver, refreshed once a step. Scanning
      // positions cannot tell a sheep resting on the fence rail from one
      // hovering a pixel above it, and that difference is the whole of
      // "can this sheep push off?".
      for (const s of S.sheep) s.contacts.length = 0;
      for (const pair of engine.pairs.list) {
        if (!pair.isActive) continue;
        const sa = pair.bodyA.plugin.sheep, sb = pair.bodyB.plugin.sheep;
        if (sa) sa.contacts.push(pair.bodyB);
        if (sb) sb.contacts.push(pair.bodyA);
      }

      if (SPAWN_GAP_MS > 0) {
        const spawnGap = Math.max(SPAWN_GAP_MIN, SPAWN_GAP_MS - S.pending * 14);
        if (S.phase === 'play' && S.pending > 0 && now - S.lastSpawn >= spawnGap) {
          S.pending--;
          S.lastSpawn = now;
          spawnSheep(now);
        }
      } else if (S.pending > 0 && S.phase === 'play') {
        // the meter is off, so a queued wave lands all at once
        const n = S.pending;
        S.pending = 0;
        for (let i = 0; i < n; i++) spawnSheep(now);
      }

      let stuckCount = 0;
      for (let i = S.sheep.length - 1; i >= 0; i--) {
        const s = S.sheep[i];
        const b = s.body;
        const r = SHEEP_R * s.scale;
        const spd = Math.hypot(b.velocity.x, b.velocity.y);
        const g = grounded(s);
        const look = sense(s);

        // wedged?
        // Anything stalled anywhere short of the barn is part of the traffic
        // jam — a heap that backs up past the jump line still counts.
        const nearFence = b.position.x > 150 && b.position.x < FENCE_X + 150;
        if (nearFence && spd < STUCK_SPEED && S.fenceUp) s.stuckFor += 16.666;
        else s.stuckFor = 0;
        s.stuck = s.stuckFor > STUCK_MS;

        // leaning on the fence: a steady push, for as long as it keeps pushing
        if (S.fenceUp && b.position.x < FENCE_X && b.velocity.x > -0.2) {
          for (const c of s.contacts) {
            if (c.label === 'fence') { S.strainAcc += b.mass * STRAIN_PER_LEAN; break; }
          }
        }
        // A jam is sheep that *cannot* get out, not sheep that happen to be
        // slow. A lone sheep straddling the rail, or a lame one trotting back
        // for another run-up, is stalled but free, and is about to sort itself
        // out — so it is not part of a jam. A mutually penned heap is.
        //
        // It also has to have *tried*: sheep queue politely now, so a line of
        // them waiting behind one bad jumper is stalled and technically penned
        // within half a second, and counting that brought the farmer out after
        // sixteen sheep of perfectly calm play. Waiting for the wriggle to
        // have failed is the honest test — it has had a go and is still there.
        if (s.stuckFor > WRIGGLE_MS && penned(look)) stuckCount++;

        // stalled long enough to start fighting it
        if (s.stuck && s.stuckFor > WRIGGLE_MS && now - s.lastWriggle > WRIGGLE_EVERY) {
          s.lastWriggle = now;
          if (!penned(look)) {
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
        // how long it has been loitering at the jump line
        if (!(beforeFence && b.position.x >= JUMP_X + s.launchX && g)) s.atLine = now;
        // A sheep may jump off whatever it is standing on, as long as its
        // launch arc is open. That is what makes a heap into a ramp.
        const canLaunch = look.footing && look.air;

        // Did the last attempt fail? A sheep back on the ground, still short
        // of the fence, a beat after it jumped, plainly did not make it.
        if (s.tryOpen && g && beforeFence && now - s.lastJump > 320) {
          s.tryOpen = false;
          s.tries++;
          s.speed = Math.min(s.baseSpeed * DETERMINATION_CAP, s.speed * DETERMINATION_STEP);
          if (LAME_TRIES_TO_CLEAR > 0 && s.tries >= LAME_TRIES_TO_CLEAR) s.power = 1;
          // Room to back up and have a proper run at it? The want is bounded
          // and saturating, and it never reverses past the first thing behind
          // it, so nothing here can escalate without end.
          let room = RUNUP_WANT;
          for (const o of S.sheep) {
            if (o === s) continue;
            const dx = b.position.x - o.body.position.x;
            if (dx > 0 && dx < room + r && Math.abs(o.body.position.y - b.position.y) < r * 1.2) {
              room = Math.min(room, dx - r - SHEEP_R * o.scale);
            }
          }
          if (room > 30) {
            s.dir = -1;
            s.retreatTo = b.position.x - room;
            s.squash = 0.35;
            if (Math.random() < 0.5) bleat(rand(0.95, 1.3), 0.09);
          }
        }
        // ...and it has backed up far enough, or run out of room trying.
        if (s.dir < 0 && beforeFence && (b.position.x <= s.retreatTo || (g && Math.abs(b.velocity.x) < 0.25 && now - s.lastJump > 900))) {
          s.dir = 1;
          S.puffs.push({ x: b.position.x, y: GROUND_Y - 4, r: 6, a: 0.4 });
        }

        if (S.fenceUp && beforeFence && canLaunch && s.dir > 0
            && (b.velocity.x > MIN_LAUNCH_SPEED || !g || now - s.atLine > BAULK_MS)
            && b.position.x >= JUMP_X + s.launchX && now - s.lastJump > s.rejumpMs) {
          const short = s.forceShort || Math.random() < SHORT_JUMP_CHANCE;
          s.forceShort = false;
          s.attempts++;
          s.tryOpen = true;
          // what it is actually running at, not what it would like to be
          const coupling = 1 + JUMP_SPEED_COUPLING * (Math.abs(b.velocity.x) / RUN_SPEED - 1);
          const j = clamp(s.power * coupling, 0.25, 2) + (short
            ? -SHORT_JUMP - rand(0, 0.04)
            : rand(-JUMP_JITTER, JUMP_JITTER));
          Body.setVelocity(b, { x: JUMP_VX * j, y: JUMP_VY * j });
          // Vague momentum conservation. setVelocity ignores the reaction, so
          // the kick has to be explicit: launching off a buried sheep drives
          // it further down and compacts the heap, launching off one standing
          // in the open shoves it backwards, which is a bumble for free.
          if (look.support) {
            const m = b.mass * LAUNCH_KICK;
            Body.applyForce(look.support, look.support.position, { x: -JUMP_VX * j * m * 0.0011, y: -JUMP_VY * j * m * 0.0011 });
          }
          s.lastJump = now;
          s.squash = -0.8;
          boing(rand(0.85, 1.2) / Math.sqrt(s.scale));
        } else if (s.dir < 0) {
          // Retreat by force, never by velocity: a crowded lane then
          // physically prevents the trot-back and there is no velocity fight
          // to lose, so two opposing sheep can never deadlock.
          Body.applyForce(b, b.position, { x: -b.mass * RETREAT_FORCE, y: 0 });
        } else if (g && b.velocity.x < s.speed) {
          // gentle, re-applied every frame: when the lane is blocked this
          // becomes shoving pressure, which is what builds the pile.
          const push = (S.phase === 'flood' || S.phase === 'burst') ? 2.2 : 1;
          let target = s.speed * push;
          // Right of way. Sheep do not walk into each other on purpose: brake
          // for the one in front, and stop altogether for one that is backing
          // up towards you. The queue is then something the sheep decide to
          // form, and a pile-up is fifteen small refusals rather than geometry.
          if (look.ahead && look.aheadGap < BRAKE_GAP && S.phase === 'play') {
            const a = look.ahead;
            // Slow for it, never stop dead for it. A full stop behind every
            // sheep that backs up froze the whole lane for about a second per
            // failed jump, which at four taps a second is most of the lane's
            // capacity. The retreat is done with force, so there is no
            // velocity fight to lose by keeping moving.
            target = a.dir < 0 ? Math.min(target, 0.8)
              : Math.min(target, Math.max(0.6, a.body.velocity.x));
          }
          Body.setVelocity(b, {
            x: b.velocity.x + (target - b.velocity.x) * 0.18,
            y: b.velocity.y,
          });
        }

        // Counted when it crosses the fence line in the air. A sheep squeezed
        // over by the heap without jumping still counts: it got over.
        if (!s.counted && b.position.x > FENCE_X && b.position.y < GROUND_Y - 70) {
          s.counted = true;
          // it is over: give up the extra effort, and take a bow if it took
          // some doing. One sheep however many goes it had.
          if (s.tries >= 2) {
            bleat(rand(1.45, 1.75), 0.2);
            for (let p = 0; p < 4; p++) {
              S.puffs.push({ x: b.position.x + rand(-14, 14), y: b.position.y + rand(-14, 14), r: 4, a: 0.5 });
            }
          }
          s.tries = 0; s.tryOpen = false; s.speed = s.baseSpeed;
          if (S.phase === 'play') countOne(now);
        }

        // Into the barn. Nothing fades: the sheep is drawn clipped to the
        // doorway, so the building is what hides it. A sheep arriving too fast
        // — a giant, or anything the burst threw — overshoots the door and has
        // to turn round and trot back, which nobody ever got to see when it
        // was culled off the right-hand edge instead.
        if (!s.overshot && b.position.x - r > DOOR_X1 && b.position.x < VW + 100) {
          s.overshot = true;
          s.dir = -1;
          S.puffs.push({ x: b.position.x, y: GROUND_Y - 4, r: 7, a: 0.45 });
          bleat(rand(1.1, 1.45), 0.1);
        }
        if (s.overshot && b.position.x < DOOR_X1 - 26) { s.overshot = false; s.dir = 1; }
        if (b.position.x > DOOR_X0 + 46 && !s.overshot) { despawn(s); continue; }
        if (b.position.y > VH + 200 || b.position.x > VW + 300 || b.position.x < CULL_X) { despawn(s); continue; }

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
        s.bonk *= 0.93;
        s.wiggle = s.stuck ? Math.sin(now * 0.028 + s.id) : s.wiggle * 0.9;
        if (g || s.stuck) s.legPhase += s.stuck ? 0.55 : clamp(Math.abs(b.velocity.x) * 0.09, 0.02, 0.5);
        else s.legPhase += 0.06;
        // dust on touchdown
        if (g && !s.wasGrounded && b.velocity.y > 2) {
          for (let p = 0; p < 2; p++) {
            S.puffs.push({ x: b.position.x + rand(-r * 0.7, r * 0.7), y: GROUND_Y - 3, r: 4, a: 0.42 });
          }
        }
        s.wasGrounded = g;
      }

      // Strain is now wound up by real collisions (see collisionStart) and
      // bleeds off on its own. The decay rate IS the patience window: stop
      // tapping, the sheep stop shoving, and the fence relaxes. The old
      // version was a count dressed up as a force, which kept climbing while
      // a pile was actually backing away from the fence.
      S.strainAcc *= STRAIN_DECAY;
      S.strain += (clamp(S.strainAcc, 0, 1) - S.strain) * 0.1;

      // phase machine
      if (S.phase === 'play') {
        const jammed = !S.noJam && (stuckCount >= JAM_STUCK
          || (JAM_TOTAL > 0 && S.sheep.length >= JAM_TOTAL)
          || (JAM_COUNT > 0 && S.count >= JAM_COUNT));
        if (jammed) triggerJam(now);
        else if (now - S.lastTap > IDLE_SLEEP_MS) { S.phase = 'sleep'; S.phaseT = now; }
      } else if (S.phase === 'farmer') {
        const dt = now - S.phaseT;
        S.farmerX += (636 - S.farmerX) * 0.055;
        if (dt > 1500 && !S.spoke.line) {
          S.spoke.line = true;
          say("Oh my gosh, there's so many!", 0.65, 0.92);
        }
        // the fence goes when the sheep have wound it right up, or when the
        // farmer has been standing there long enough, whichever comes first
        // ...but never before he has had his say
        if (dt > 3100 || (STRAIN_BURSTS && S.strain > 0.97 && dt > 2100)) doBurst(now);
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

      // An open doorway, not a gate: the sheep are drawn clipped to this
      // rectangle, so the dark has to be a hole they walk into. The old X
      // braces are gone — a sheep drawn over them read as standing in front
      // of a closed door.
      const dw = DOOR_X1 - DOOR_X0, dh = DOOR_H;
      const dx = DOOR_X0;
      ctx.fillStyle = '#2a1714';
      ctx.fillRect(dx, y - dh, dw, dh);
      // the light in the barn comes up with the count, so the door looks
      // increasingly worth walking into
      const warm = clamp(S.count / 40, 0, 1) * 0.16
        + (S.phase === 'flood' || S.phase === 'burst' ? 0.22 : 0);
      if (warm > 0.005) {
        const lg = ctx.createLinearGradient(0, y, 0, y - dh);
        lg.addColorStop(0, 'rgba(255,214,130,' + warm.toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(255,214,130,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(dx, y - dh, dw, dh);
      }
      ctx.strokeStyle = '#f1e6d8';
      ctx.lineWidth = 6;
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

    // The limp is the only badge a lame sheep gets. A bandage would announce
    // the failure before it happens, which spoils the one good surprise — an
    // ordinary-looking sheep face-planting into the rail — and it would put a
    // second meaning on wool colour, which the cow already owns.
    function drawLegs(r, phase, stuck, dark, limp) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(3, r * 0.16);
      ctx.lineCap = 'round';
      const amp = stuck ? 0.9 : 0.38;
      for (let i = 0; i < 4; i++) {
        const lx = (-0.52 + (i % 2) * 0.1 + (i < 2 ? 0 : 0.95)) * r;
        const sw = Math.sin(phase + i * 1.9) * amp * (limp && i === 1 ? 0.35 : 1);
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
      // Walking into the barn is occlusion, not a fade: once the sheep is
      // through the doorway the dark of the barn takes it. The clip only
      // stops it spilling out of the far side of the opening — it reaches
      // well back to the left, because a sheep whose rump is still outside is
      // standing in front of the wall and should be drawn whole.
      const depth = (b.position.x - DOOR_X0) / 46;
      if (depth > 0) {
        ctx.beginPath();
        ctx.rect(DOOR_X0 - 400, GROUND_Y - DOOR_H, (DOOR_X1 - 4) - (DOOR_X0 - 400), DOOR_H);
        ctx.clip();
      }
      ctx.globalAlpha = s.alpha;
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(s.vis + s.wiggle * 0.22);
      ctx.scale(1 + sq * 0.3, 1 - sq * 0.3);

      drawLegs(r, s.legPhase, s.stuck, cow ? '#4a4038' : '#49454f', s.lame);

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
      // The face is a reaction, not a decoration: eyes go wide on an impact,
      // and stay a bit wide while the sheep is stuck. At three years old this
      // is most of the joke, and it costs one extra number.
      const wide = clamp(s.bonk * 1.6 + (s.stuck ? 0.35 : 0), 0, 1.4);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx + r * 0.08, hy - r * 0.04, r * (0.095 + wide * 0.085), 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#16141c';
      ctx.beginPath();
      ctx.arc(hx + r * 0.11, hy - r * 0.04, r * (0.05 + wide * 0.012), 0, 6.2832);
      ctx.fill();
      // ears flop back on a bonk and while backing up for another go
      ctx.save();
      ctx.translate(hx - r * 0.1, hy - r * 0.3);
      ctx.rotate(wide * 0.9 + (s.dir < 0 ? 0.6 : 0));
      ctx.fillStyle = cow ? '#f6f3ee' : '#fbfbf7';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.19, r * (0.19 - wide * 0.05), 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      if (s.stuck) {
        ctx.globalAlpha = s.alpha * (0.4 + 0.3 * Math.sin(now * 0.012 + s.id));
        ctx.strokeStyle = '#ffd36b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.25, 0, 6.2832);
        ctx.stroke();
      }
      if (depth > 0) {
        // swallowed by the dark of the barn. Drawn in the sheep's own space so
        // it travels with it; the doorway clip keeps it off the barn wall.
        ctx.globalAlpha = clamp(depth, 0, 1);
        ctx.fillStyle = '#2a1714';
        ctx.fillRect(-r * 4, -r * 4, r * 8, r * 8);
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

      // Just a count. It no longer summons the farmer, so it no longer gets to
      // dress itself up as an emergency — the fence's lean is the alarm. The
      // only flourish is a small kick on the number as it lands.
      if (SHOW_COUNT && S.count > 0) {
        const fresh = clamp(1 - (now - S.lastCountAt) / 260, 0, 1);
        ctx.font = 'bold ' + Math.round(76 + fresh * 10) + "px 'IBM Plex Sans', system-ui, sans-serif";
        ctx.textAlign = 'left';
        ctx.lineWidth = 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.fillStyle = '#3c4a63';
        ctx.save();
        ctx.translate(42, 108);
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
      // A crowded lane is a slow lane, and a slow sheep comes up short. This
      // fills the run-up so that can be watched without mashing for it.
      slowLane() {
        unlockAudio();
        const now = wake();
        for (let i = 0; i < 7; i++) spawnSheep(now, { x: 40 + i * 34, y: GROUND_Y - SHEEP_R });
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

    // Dev console hook. `api` is the same list the debug panel drives, so a
    // measurement run is scriptable; see the report in TOO_MANY_SHEEP_NOTES.md.
    if (import.meta.env && import.meta.env.DEV) window.__sheep = { S, engine, api: apiRef.current };

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
