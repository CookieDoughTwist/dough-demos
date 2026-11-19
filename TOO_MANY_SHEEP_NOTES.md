# Too Many Sheep — notes

## This round (2026-11-17)

**The count is no longer capped.** `JAM_COUNT` was 16: hitting sixteen sheep
summoned the farmer on its own, pile-up or no pile-up. It is now `0`, which
means "never" — only a real jam ends a round. Set it above zero to bring the
number cap back.

**Second, quieter cap: rail-sitters never left.** A sheep that caught the rail
lodged there permanently — it is past `beforeFence`, so it never re-jumps, and
too high for `canLaunch`, so it never runs. Each one counted as wedged for
ever, so three of them anywhere in a long calm session tripped the farmer even
with an empty field. Sheep now *fight to get out*: after `WRIGGLE_MS` stalled,
a sheep checks whether it is `penned()` — anything on top of it, or more than
one neighbour pressed against it. Free sheep scramble forwards and over
(velocity, a real hop). Penned sheep get `applyForce` instead, which respects
the weight and the contacts, so they squirm and stay put. The pile-up survives
because a heap is mutually penned; a lone sheep on the rail lets itself out.

Measured after the change:

| scenario | before | after |
| --- | --- | --- |
| calm taps, ~2/sec | farmer at 16 | counted to 113, no reset, nothing stuck |
| mashing | farmer | farmer at 2.7s (20 on screen) |
| debug Pile-up | — | farmer at 6.9s, from 3 genuinely wedged sheep |

Checking only what was *above* a sheep was not enough: a sheep at the front of
a heap has clear air over its head and hopped away, unpacking the pile-up from
the front. Counting close neighbours in any direction is what holds the heap
together.

**Debug panel**, top-right, collapsible: Sheep / Giant / Tiny / Cow / Giant cow
spawn a forced creature, Short jump forces a rail-catcher, +10 queues a wave,
Pile-up dumps fifteen sheep onto the fence, Farmer / Burst / Sleep / Reset jump
the phase machine, Count 97 tests big numbers. They poke the live scene through
a ref (`apiRef`) the effect publishes; `spawnSheep(now, forced)` takes
`{ kind, scale, x, y, forceShort }` and falls back to the ordinary random sheep
when `forced` is omitted, so normal play is unchanged.

## Next round: making it feel physical

The sheep are *already* independent agents — each is its own rigid body with
its own run speed, its own decision to jump when it reaches `JUMP_X`, its own
roll against `SHORT_JUMP_CHANCE`. Nobody scripts the pile-up; it already
emerges. What is missing is not agency, it is **bodies and perception**. In
rough order of payoff per unit of work:

1. **They see nothing.** A sheep decides to jump from its own `x` alone — it
   never looks at the sheep in front of it. Real jams come from reaction. Give
   each sheep a one-line look-ahead (nearest sheep in a short cone in front):
   brake behind it, and *baulk* at the fence when the landing is occupied —
   skid, trot back a few pixels, have another go. Queues then form because
   sheep decide to queue, and the heap is the result of fifteen small refusals
   rather than of collision geometry. This is the single biggest change.

2. **They are circles.** A circle is the one shape that cannot wedge: it rolls,
   it has no back to land on and no neck to hook over a rail. Replace the body
   with a two-circle compound (chest + rump) or a capsule, and sheep can lie
   across the rail, nose-dive, and stack in shapes that are not round. Roughly
   2x the bodies — still nothing at 20–70.

3. **The fence breaks on a timer.** `doBurst` fires 3.1s after the farmer
   arrives. Accumulate strain from actual collision impulses on the rail and
   break it when strain crosses a threshold — then the sheep break the fence,
   and a giant sheep at speed breaks it faster than ten lambs leaning on it.
   (`S.strain` already exists; it is driven by a count, not by force.)

4. **Legs are a drawing.** Locomotion is `setVelocity` re-applied every frame,
   which is why shoving feels like a conveyor belt. Drive it from the leg
   cycle instead — an impulse per stride, `applyForce` — and a buried sheep
   physically cannot push off, which is the same rule `penned()` approximates
   today, but emergent instead of tested for.

5. **Wool is soft.** Not worth real soft bodies at this count. Cheaper: drive
   the draw-time squash from actual contact normals rather than from speed, and
   draw at a radius slightly larger than the body so sheep visually
   interpenetrate. Reads as squeeze for about six lines.

6. **Weight classes.** `density` is constant, so a cow is just a big sheep.
   Make the cow heavy enough to be a genuine roadblock and the lamb light
   enough to be shoved aside.

7. **Panic.** One shared scalar, raised when the farmer appears, feeding speed
   and jump variance. Cheap, and crowd panic is funny.

If 1, 2 and 3 land, the `stuckCount >= JAM_STUCK` heuristic can probably go
away entirely: "a jam" becomes "N sheep making no forward progress", which is
the thing itself rather than a proxy for it.


## Round plan — agreed in a discussion session (2026-11-17/18)

No code changed this session. The list above stays as the standing backlog;
items 1, 2 and 3 of it are folded into the plan here.

**The headline from playtesting: the bumbling is the product.** A three-year-old
finds sheep falling over funny on its own — no build-up, no burst, no count
needed. So the ranking rule for everything below is *how much more bumbling
does this produce, and how much more legible is each bumble*. The
build-up / farmer / burst cycle is the frame around the joke, not the joke.

The three asks are one idea from three sides: **the toy is a queue, and
everything should display or cause the queue rather than annotate it.** Sheep
arrive at a rate the player sets, the fence serves them at a rate the fence
sets, and when arrival beats service the backlog has to go somewhere. Today the
backlog is invisible (`S.pending` is a number in a closure) and the
consequences are announced by proxies: a red counter, wrong numbers,
`JAM_TOTAL`.

### 1. The count is a count; the fence is the alarm

Drop the red/wobble state and the wrong numbers. With `JAM_COUNT = 0` the
number causes nothing, so a big number dressed as an emergency is a lie — the
toy promises an escalation that the count no longer drives. The honest alarm is
already drawn: `drawFence()` leans by `S.strain`. Drive `S.strain` from real
collision impulses on the rail (backlog item 3) and the lean becomes the danger
display, with creak volume as its sound. Calm play: upright fence, count climbs
for ever. Mashing: visible lean, creaking, then it goes.

- `COUNT_SANE` stays as a tunable set to `0` = never (same treatment `JAM_COUNT`
  got), so the wrong-numbers joke can be switched back on.
- `JAM_TOTAL = 20` is the same sin as `JAM_COUNT` and needs the same fix: it
  summons the farmer for a number, not for a jam. It also breaks under ask 2 —
  sheep walking in from off-screen count towards `S.sheep.length` while nothing
  is wrong. Retire it to `0` once strain drives the burst.

### 2. The stutter is the flow meter

**Decided: always speak the full, correct number, and let every crossing cancel
and restart the line.** "F-f-f-f-forty-seven" is the joke, and it is not a
degradation — it is the honest read-out of the queue, in audio:

- numbers completing cleanly = arrival rate at or under the fence's service rate
- stuttering = over-driving the fence, pile-up coming
- one long clean number after a stutter = the field has drained

Which retires last round's open question about a numeric flow readout. The play
field keeps the one big count and nothing else; the voice is the flow display,
and a child can read it without reading. Better still, the cadence that keeps
the voice intelligible is roughly the cadence that keeps the fence clear, so
"find the rhythm" is a real, learnable skill with an audible reward — and
nothing is lost by failing at it.

So the mechanism is mostly *already there* and wants un-suppressing:

- `say()` already calls `ss.cancel()` before each line. Keep it.
- `SPEAK_GAP = 170` is what has to go (to `0`, kept as a tunable): today it
  returns early without speaking, so fast crossings are silent rather than
  stuttering.
- Drop the decade-dropping and the auctioneer rate from last round's plan. Not
  needed; full numbers every time.
- `toWords(n)` is still needed, since `NUMS` stops at 15 and `WILD` goes away.
- `COUNT_SHOUT_EVERY` stays as emphasis only (every tenth louder and higher).

**Measure this first, before building on it.** The stutter is a browser
side-effect, not a guaranteed API behaviour, and three things could spoil it:

1. `cancel()` immediately followed by `speak()` is flaky in Chrome — it can
   leave the synth wedged so later `speak()` calls are ignored. Needs a run of
   a few hundred cancels to see.
2. There is a start-up latency of maybe 50-150 ms before audio. Below some
   interval the restart produces *silence*, not a plosive. Find that floor; if
   it is high, the fix is a floor on cancelling (let an utterance that started
   under N ms ago finish) and the stutter then has a natural top speed.
3. iOS Safari is worse on both counts. Test on the actual iPad before trusting
   it.

Instrument with `onstart` / `onend` / `onerror` and log the interval between
`speak()` and `onstart`, plus how many utterances reach `onend`. Fallback if
the API will not cooperate: about 30 recorded clips (one to twenty, the tens,
"hundred") played through the existing `AudioContext`, where re-triggering is
exact and free. That is the eventual destination anyway.

### 3. Walk in from off-screen, walk into the barn

More stage to bumble on, and the backlog becomes physical.

- Spawn at about `x = -35` so the leading edge is on screen within ~0.1 s — the
  tap puff and the bleat already cover the gap, but keep the invisible period
  under ~250 ms or the toy feels slow to a three-year-old.
- Better than metering: spawn a queued sheep *behind whatever is already in the
  lane* (leftmost sheep minus a body), and let geometry do the spacing instead
  of `SPAWN_GAP_MS`. Backlog then reads as a line of sheep walking in. Keep the
  gap constant as a floor so two sheep never share a point.
- Arithmetic behind that, from the constants (confirm in the browser): run speed
  4.6 px/step = 276 px/s, so spacing at `SPAWN_GAP_MS` 165 is **45.5 px** and at
  `SPAWN_GAP_MIN` 95 is **26.2 px**, against a sheep diameter of **46 px**. The
  default meter already spawns sheep exactly bumper to bumper and the
  queue-driven speed-up packs them at 57% of a body — physically impossible, so
  they must collide. The spawn meter is not a safety valve; it is the jam's
  cause. In-rate therefore tops out near 6/s, 10.5/s mashing. **Measure the
  fence's clear-rate** — that ratio is the whole game.
- The ground body is `VW * 3` wide and centred, so it already spans about
  -960..1920; no change needed. Add a low cull (`x < -600`) for safety, since
  the despawn guard only has an upper bound today.
- Barn: the door is already drawn at roughly x 744..848. Replace the
  `alpha -= 0.055` fade with **occlusion** — draw barn wall, draw the dark
  doorway, draw the sheep clipped to the doorway rect, then the facade in front.
  The sheep walks in and is hidden by the building, which is the real cause of
  it disappearing.
- Free gag that falls out of this: a sheep going too fast (a giant, or one
  launched by the burst) **overshoots the door**, then turns round and trots
  back to it. Today it is culled at `x > VW + 300` and nobody sees the mistake.
- Free charm: door light brightening with the count; sheep bunching politely at
  the door. No false farmer risk — stuck detection stops at `FENCE_X + 150`
  (620), the door is at 782.

### 4. Varied sheep, and the lame one

Move variation off the per-jump dice roll and onto the sheep, so the bad
jumpers are consistently the same individuals and the player learns to
recognise them.

- Per-sheep traits at spawn: `power` (centre 1.0, sigma ~0.08, fat low tail),
  `launchX` (`JUMP_X` plus or minus ~18 px — jumping early lands you on the
  rail, late puts you into the post, which is the actual cause of a short jump),
  per-sheep re-jump delay, and later `boldness` for the look-ahead in backlog
  item 1. `SHORT_JUMP_CHANCE` then becomes the low tail of the distribution
  rather than a special case.
- **Jump impulse scales with run speed at launch** (`JUMP_SPEED_COUPLING`, 0 =
  today, start ~0.35). One change, several consequences: a crowded lane is a
  slow lane, a slow sheep comes up short, short sheep block the lane — the
  pile-up becomes self-reinforcing. Watch for the cascade swallowing the long
  calm climb; that coefficient is the knob.
- **The lame sheep, without a claw-machine counter.** Each failed attempt, it
  backs up further for a longer run-up, so it is faster at launch and
  eventually genuinely clears — guaranteed payoff, caused by run-up distance
  rather than by a hidden count. And when the field is busy it *cannot* back up,
  so it stays wedged and plugs the lane. Harmless alone, a cork when busy.
  - For lame sheep the `WRIGGLE_MS` escape becomes the trot-back rather than a
    hop, so the two mechanisms do not fight.
  - Keep a `LAME_TRIES_TO_CLEAR` tunable at `0` = off, so the counter version
    can come back.
  - A cheer when it finally gets over. It counts as one sheep however many tries.
  - **Not rare.** Bumbling is the product, so this is not a `SURPRISE_CHANCE`
    creature — start around 1 in 7 and tune by playing. It still gets a debug
    button (`Lame`), plus one that forces a slow lane.

**Visual indicator: no badge on the body, mark the state instead.**
The behaviour is already the clearest possible tell, and it is funnier than a
label: the limp (asymmetric `legPhase` amplitude) reads while it runs, and a
sheep *trotting backwards* to line up another go is unmistakable even to a
three-year-old. A bandage or a patch pre-announces the failure before it
happens, which spoils the surprise, costs the comic beat of a sheep that looked
ordinary face-planting into the rail, and adds a second meaning to wool colour
that the cow already owns. Do the bumble, not the badge.

What *is* worth drawing is state, which the toy already does — the `#ffd36b`
stuck halo. Extend that vocabulary rather than the breed vocabulary: a dust
puff on the trot-back, ears back and a determined squash while reversing, wide
eyes on impact. All of it disappears the moment the sheep clears, which is the
point: the player is reading a situation, not an identity.

### 5. Recoverability: a jam is sheep that *cannot* get out

The ask is that a few bumblers should normally resolve themselves if the player
stops tapping. That is a tuning property, and one test is in the way of it:
`JAM_STUCK = 3` counts sheep that are *slow*, and a lame sheep trotting back
for another run-up is slow while being in no trouble at all. Three bumblers
anywhere summon the farmer mid-recovery, and the "be patient and it sorts
itself out" lesson never lands.

The fix needs no new machinery — `penned()` already exists and already
distinguishes the two cases. **Count a sheep towards the jam only if it is both
stalled and penned.** A lone sheep straddling the rail, or a lame one reversing
with clear space behind it, is then not a jam, because it is not one: it is
about to get out. A mutually-penned heap still is.

This pairs with the impulse-driven strain in section 1: a recovering pile is
backing *away* from the rail, so real strain decays while a count-based proxy
keeps climbing. Strain decay rate becomes the patience window, and it is
honest.

Ship sections 4 and 5 together, or raise `JAM_STUCK` as an interim — section 4
alone makes the farmer trigger-happy.

### 6. Amplifying the bumble (new, from playtesting)

Ranked by comedy per line of code:

1. **Capsule or two-circle bodies** (backlog item 2) — promoted. A circle is
   the one shape that cannot look foolish: no back to land on, no neck to hook
   over a rail, no stupid angle to be stuck at. This is the single biggest
   amplifier of the thing the player already finds funniest, and it roughly
   doubles the body count, which is nothing at 20-70.
2. **Reaction faces.** Scale the eye white by `squash`, flop the ears on
   impact. One extra draw state, enormous payoff at three years old.
3. **A catalogue of distinct failure modes**, so the bumbling has variety and
   not just volume: straddles the rail (exists), lands on another sheep
   (incidental), face-plants into the rail from jumping early, clouts the post
   from jumping late, gets shoved mid-run and launches sideways, rolls
   backwards down the heap, clears the fence and lands on a sheep standing past
   it, overshoots the barn door and trots back. Most of these fall out of
   `launchX` jitter and capsule bodies for free.
4. **Dust puffs** on landing, on the trot-back, on a bonk.
5. **More bleat variety** on collisions; a whoop for a mid-air collision.

The no-fail promise stands: nothing punishes the player, and every bumble
resolves if left alone.


### 7. The retreating sheep must not loop

**Correction to section 4 first.** "Backs up for a longer run-up, so it is
faster at launch" does not work as written. Locomotion is
`setVelocity(x = lerp(toward s.speed))` re-applied every frame, so a sheep
reaches `s.speed` in roughly 20 frames — about 65 px — and then saturates.
Distance beyond ~100 px buys nothing at all. So a retreat gets a sheep back to
*full* speed, which matters when it is stalled 30 px short of `JUMP_X`, but it
cannot make a sheep faster than `s.speed`, and a lame sheep that failed at full
speed would fail identically for ever. The escalation has to live in `s.speed`
itself:

- **Determination.** Each failed attempt, `s.speed *= 1.06`, capped at ~1.35x,
  decaying back once it clears. With the speed-to-jump coupling this converts
  straight into jump height, so attempt one fails and attempt five clears. A
  sheep with a low `power` roll needs more determination and therefore takes
  longer and is funnier. It is also visible — the sheep is plainly running at it
  harder each time — and a sheep that overcooks it clouts the post, which is
  another gag rather than a bug.
- **Run-up need is saturating and bounded**: a sheep wants about 100 px of clear
  lane, takes `min(wanted, available)`, and never reverses further than the
  first thing it touches. No unbounded escalation anywhere.

**The invariant to implement and test against: progress is monotone.** Every
failed attempt must strictly improve the next one — more determination, or a
thinner heap. There must be no state in which a sheep's prospects get worse
over time. If that holds, every sheep clears in a bounded number of attempts
given space, and "given space" is the player's to grant by stopping.

Three mechanisms keep the two-sheep case out of a loop:

1. **Right of way.** A retreating sheep yields to nothing; a running sheep
   brakes for a retreating one ahead. This is the look-ahead from backlog item
   1, and it is socially legible — sheep queue behind the one setting up,
   because sheep do not walk into each other on purpose. Without it, two
   opposing `setVelocity` calls in contact produce a frame-order-dependent
   stalemate with visible jitter and no resolution, which is the actual
   mechanical risk here.
2. **Retreat by force, not velocity.** `applyForce` for the trot-back, so a
   crowded lane physically prevents the retreat and there is never a velocity
   fight to lose. This is the behaviour section 4 already wants ("when busy it
   cannot back up"), arrived at honestly.
3. **A second option when there is no room: scramble.** A sheep that cannot
   retreat clambers at the fence instead — the existing `WRIGGLE_MS` hop. So
   space means back up and run, no space means scramble, and neither branch
   waits on the other. Nothing can sit in a state with no available action.

The head-on case the player asked about — a retreating sheep bumping an
incoming one so both fail — is a feature and will happen. What makes it safe is
that it is bounded by inflow, not by internal state: stop tapping and the lane
drains, determination has only gone up, and everyone gets over. The failure
case to watch in testing is **two lame sheep adjacent**, where the front one
cannot retreat because the rear one is in the way; it should fall through to
scramble, and if it instead dithers between the two behaviours that is the bug.

Minor, pleasant edge cases found while thinking this through:

- A retreating sheep crossing back past x = 150 leaves the `nearFence` window
  and so clears its own `stuckFor`. That is correct by accident.
- A sheep squeezed over the fence by the heap without jumping still counts.
  Keep it. It got over.
- Capsules will want attention to `slop`, inertia and an angular-velocity cap,
  or they will spin like propellers when squeezed. Another reason to give them
  their own round (see section 8).

### 8. Consequences and loose ends

**A 3-4 year old taps at 4-5/s, which changes what the fence is for.** That is
below the 6/s the spawn meter allows and well below the 10.5/s a palm-slam
reaches through `TAP_BURST_CAP`, so `SPAWN_GAP_MIN` still earns its keep for
slams only. More importantly, if the measured fence clear-rate turns out to be
near 6/s, **he cannot jam the fence by tapping at all** — pile-ups would then
come almost entirely from bumbling sheep. That is fine, and arguably better,
but it means **lame-sheep frequency becomes the pacing control for the whole
build-up / farmer / burst cycle**. A much better dial than tap rate, because it
does not depend on how hard a small child is willing to work. Measure
clear-rate before tuning anything else.

**Does the count still want to reset to 0?** This is a consequence of section 1
that last round's plan missed. The reset used to be a relief: the count had
become nonsense, so losing it cost nothing. With every number spoken correctly
and no red panic state, a long calm climb to 200 is an achievement, and
zeroing it on a burst reads as punishment — against the no-fail promise. Worth
trying: keep a running total of sheep in the barn that never resets, and let
the big number be the current run. Or have the farmer hand it back ("...right,
off we go again"). Needs a decision before section 1 lands.

**The debug panel defaults to open, in the top-right, where a small child's
hand lands.** `showDebug` starts `true`. Default it closed now that the toy is
actually being played with, and consider hiding the reveal behind something a
toddler will not do by accident.

**`MAX_SHEEP = 70` now includes the off-screen lane.** Queued sheep walking in
consume the cap while invisible. Either count only sheep past the left edge
towards the cap, or raise it. Low stakes, easy to forget.

**Performance before capsules.** 70 sheep as two-body compounds is ~141 bodies
at 8 position iterations, on an old iPad. Measure frame time during a `Pile-up`
first.

**Proposal: capsules get their own round.** They touch every drawing and
collision assumption in the file and will need a tuning pass of their own.
Shipping them alongside the retreat behaviour, the traits and the jam test
makes it impossible to tell which change made the feel worse. Behaviour next
session, bodies the session after.


### 9. Decisions, 2026-11-18 — the pile-up is the way out of the pile-up

**Launching off each other is the anti-loop, and it is the one that is worth
watching.** A sheep with footing may jump, whatever it is standing on. A heap
at the fence therefore becomes a ramp, and sheep pop out of the top of it and
over — the jam partly solves itself, visibly, and the fix is the funniest thing
on screen rather than a rule nobody can see.

This reverses the `canLaunch = b.position.y > GROUND_Y - 95` height gate, which
exists precisely to stop sheep in the heap from jumping, and it reopens the
failure last round diagnosed: heaps that unpack from the top never reach the
farmer. The resolution is that **shedding and jamming happen at different
places in the heap**, and `penned()` already tells them apart:

- Replace the height gate with two tests: **footing** (a support contact below —
  ground or another body, low relative velocity) and **clear air** in the launch
  arc (forward and up, a narrower cone than `penned()` uses).
- Top of the heap: footing yes, air yes, so it launches. The heap sheds from the
  top at roughly one sheep per `REJUMP_MS`.
- Buried: footing yes, air no, so it cannot launch. Still wedged, still counts
  towards the jam under the penned-and-stalled test in section 5.

So a pile-up pops sheep out of its top while its bottom compresses into a jam
that eventually takes the fence with it. Both at once, no new thresholds, and
the farmer still comes if the heap is fed faster than it sheds.

Write one predicate that returns both facts (support below, air ahead and
above) and derive `penned()` from it, rather than two functions that can
disagree.

**Vague momentum conservation: yes, and it does real work.** `setVelocity`
ignores reaction, so the kick has to be explicit — `applyForce` on the support
body, opposite to the launch, scaled by a tunable around 0.5. Accuracy is not
the point; the consequences are:

- launching off a buried sheep drives it further down, so shedding *compacts*
  the heap, which makes the remaining jam tighter rather than looser
- launching off a free sheep on open ground shoves it backwards, which is a
  bumble generator for the sheep that got used as a trampoline

**Determination stays, for the solo case.** A lone lame sheep has nothing to
climb, so it still needs `s.speed` to creep up per failed attempt (section 7).
The two answers cover the two situations: climb your friends when there is a
crowd, try harder when there is not. Popcorn either way.

**Vanilla sheep should fail sometimes too.** Wider per-sheep variance, so the
steady state is *continuously slightly broken* rather than clean until it
breaks. The variance should not be guessed — **measure the cliff first**:
`JUMP_JITTER` is ±0.04 and `SHORT_JUMP` is −0.12, so the power multiplier that
just catches the rail sits somewhere between, and the same goes for how far
`launchX` can slip before a sheep clouts the post. Find both edges, then place
the distribution against them, aiming at roughly 5–10% of vanilla jumps failing.

That failure rate subtracts directly from the fence's clear-rate, which gives a
principled way to set it: **tune vanilla failure so the effective clear-rate
lands just above a comfortable tap rate (4–5/s)**. Relaxed play then stays on
top of the fence, determined mashing jams it, and the toy sits right on the edge
where it is most interesting. One measurement sets a number that three design
choices were otherwise going to fight over.

**Spawning: metering is out, popcorn is in.** Every tap spawns at once at the
off-screen point, stacked vertically, and the pile avalanches into the lane.
`SPAWN_GAP_MS` / `SPAWN_GAP_MIN` / `SPAWN_QUEUE_MAX` and `S.pending` go, kept as
tunables set to off. Two mechanical notes:

- Stagger each new sheep up by about `2r` instead of spawning them inside one
  another. Co-located bodies get a large positional correction out of Matter and
  separate explosively — occasionally funny, but uncontrollable, and it can
  fling a sheep across the field.
- Locomotion only runs when `g` (grounded) is true, so a sheep partway up a
  stack does not run. Circles will not stack stably and will roll off almost
  immediately, so the stack drains itself — but this is exactly the thing to
  re-check when capsule bodies land, because capsules *will* stack, and an
  off-screen stack that sits there is an invisible stall. Watch it.

**Settled:** the count resets to zero when the fence goes. No running total; the
burst is a clean slate. The debug panel stays open by default.

### Order for next session

Implementation round. Measure first, then build, then drive it in the browser
and report real numbers.

1. **Measurements that the rest depends on**: the stutter (speech restart
   latency, and the interval floor below which a restart is silent); the fence's
   clear-rate; the jump-failure cliff (power multiplier and `launchX` slip that
   just catch the rail or the post).
2. Walk-in lane, popcorn spawn, barn-door occlusion (sections 3, 9).
3. Speech: `toWords`, `SPEAK_GAP` to `0`, red state out, `COUNT_SANE` to off
   (sections 1, 2).
4. Per-sheep traits with the variance set from step 1, speed-to-jump coupling,
   determination, the lame sheep (sections 4, 7).
5. Footing-and-clear-air launching with the reaction kick, and `penned()`
   rewritten as its derivative; penned-and-stalled jam test (sections 5, 9).
6. Reaction faces and dust puffs (6.2, 6.4).
7. Strain from real impulses; `JAM_TOTAL` to `0` (section 1).

Capsule bodies (6.1) deferred to a round of their own.

Report, per repo rules: speech restart latency and the silence floor; fence
clear-rate sustained; in-rate vs clear-rate at 4–5 taps/sec and at a palm slam;
time-to-jam from each; the measured failure cliff and the resulting vanilla
failure rate; attempts-to-clear distribution for the lame sheep and whether any
sheep ever fails to clear given space; how many sheep a heap sheds over the
fence before the farmer arrives; how often a few bumblers resolve without the
farmer; frame time during a Pile-up; and the invisible period between tap and
sheep.
