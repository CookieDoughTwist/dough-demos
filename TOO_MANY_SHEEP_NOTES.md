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
