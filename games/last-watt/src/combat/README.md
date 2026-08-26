# `src/combat` — towers, enemies, statuses, reactions

Owner: Round 1 `R1-O3`, Round 2 `R2-O3`. Scope: everything under `src/combat/**`,
nothing outside it.

Implements GDD §7 (towers and the four combos), §8 (enemies and both bosses) and
the combat half of §9 (the master-overload ultimate). v1 scope: **no hero**.

Round 2 changed two things at the module boundary, both covered in detail below:
content ids are now the `data/*.json` primary keys (§2.1), and the presentation
layer binds to three stable signals instead of to reaction row ids (§6.1).

---

## 1. The one rule this module exists to enforce

> GDD §7.2: *"All combos go through one data-driven reaction table. Do not write
> hard-coded branches."*

So there is exactly one file that says what a combo is — [`data/reactions.ts`](data/reactions.ts) —
and the code that runs it ([`reaction/engine.ts`](reaction/engine.ts)) contains no
mention of ice, fire, lightning or overload. Grep the runtime for `frozen` and you
will find the status table, the frozen VFX signal name, and the breaker's
`priorityStatuses` list (§4.1) — all three are data. No branch anywhere decides
what to do because a target happens to be frozen.

Adding a fifth combo is a new row. Adding a new *verb* means one entry in
`reaction/conditions.ts` or `reaction/effects.ts` — those two registries are the
only place reaction behaviour is coded.

---

## 2. Module boundary

Combat imports **nothing** from sibling `src/` subtrees. The seams:

| Direction | Mechanism | Who implements |
|---|---|---|
| Grid / terrain queries in | `TerrainQuery` port | `src/gameplay` (`OpenFieldTerrain` is the headless default) |
| Movement in | `MovementDriver` port | `src/gameplay` flow field (`PolylineMovement` is the default) |
| Battery in | `PowerSupply` port | `src/gameplay` economy (`InfiniteBattery` is the default) |
| Everything out | `CombatEventBus` typed events | `src/vfx`, `src/ui`, `src/gameplay` |

Cell *coatings* (oil slicks, fire fields) are owned by combat, not by the grid:
combat is the only writer and the only reader. The renderer subscribes to
`cell_coating_changed`.

```ts
import { CombatSystem } from '@/combat';

const combat = new CombatSystem({ terrain, movement, power });
combat.buildTower('hydraulic_breaker', { cx: 4, cy: 6 });
combat.spawnEnemy('armored_truck', { position, path });
combat.update(dt);
```

Import from `src/combat/index.ts` only. Files inside the module are private.

### 2.1 Content ids

**`games/last-watt/data/*.json` owns every content primary key** (主调度 Round 2
ruling 3). A tower is `hydraulic_breaker` because `data/towers.json` says so, not
because combat picked a name. [`data/ids.ts`](data/ids.ts) mirrors those ids as
symbols (`TOWER_IDS`, `UPGRADE_IDS`, `ENEMY_IDS`, `ENEMY_PHASE_IDS`) so the
runtime tables reference them instead of restating string literals.

Round 1's combat-private vocabulary is gone as a primary key. It survives only as
a read-only alias table:

| Was (Round 1, combat) | Is (`data/*.json`) |
|---|---|
| `rivet_mg` | `mg_rivet` |
| `hydraulic_hammer` | `hydraulic_breaker` |
| `condenser` | `condenser_jet` |
| `flamethrower` | `flame_thrower` |
| `scurry_rats` | `swift_rat` |
| `armored_hauler` | `armored_truck` |
| `scout_bee` | `scout_wasp` |
| `sapper_crab` | `demo_sapper` |
| the 14 `mg_twin_link`-style upgrade names | the 14 `up_mg_twin`-style ids |
| `p1_armor` / `p2_sappers` / `p3_overdrive` | `p1_armor_plates` / `p2_sapper_release` / `p3_overdrive_dash` |

`buildTower`, `spawnEnemy`, `upgradeTower` and `ContentRegistry` still accept the
left column, so `src/gameplay`'s `ENEMY_IDS` keeps working untouched. Everything
combat *emits* — `tower_built.defId`, `enemy_spawned.defId`, every stats bucket —
is the right column. Two guards keep it that way: `ContentRegistry.validate()`
rejects an alias that shadows a canonical id, and the self-check (§7) diffs both
tables against the JSON in both directions.

The alias table is scaffolding. Delete a row from `LEGACY_*_IDS` the moment its
last caller is gone; the self-check will tell you if you were wrong.

---

## 3. Layout

```
types.ts          value types, grid helpers            (no deps)
events.ts         typed event bus — the outbound seam
vfxSignals.ts     the three stable VFX signal payloads (see §6.1)
ports.ts          inbound seams + headless defaults
terrain.ts        cell coating field (oil / fire)
damage.ts         damage request/result + balance telemetry
targeting.ts      first / strongest / air + priority statuses, cones, chains
combatSystem.ts   orchestrator; implements ReactionRuntime
scenarios.ts      headless probes (see §7)
selfcheck.ts      id parity + signal lifecycle assertions
selfcheck.run.ts  CLI entry for the above

status/           statusDef.ts  — defs, modifiers, registry
                  statusSet.ts  — per-enemy container + exclusivity rules
entities/         enemyDef.ts / enemy.ts
                  towerDef.ts / tower.ts / projectile.ts
reaction/         spec.ts       — the DSL (conditions, effects, rows)
                  conditions.ts — one evaluator per condition kind
                  effects.ts    — one executor per effect kind
                  engine.ts     — priority walk + mutex
                  context.ts    — what a row sees, what it may touch
data/             ids.ts        — the data/*.json primary keys + legacy aliases
                  tuning.ts     — every GDD number, in one place
                  statuses.ts / towers.ts / upgrades.ts / enemies.ts
                  reactions.ts  — THE reaction table
                  index.ts      — ContentRegistry + cross-table validation
```

---

## 4. The reaction table

Twelve rows cover all four combos plus their support behaviour:

Row ids match `docs/SYSTEMS.md` and `data/reactions.json`, which F3 owns.

| Row | Trigger | Fires when | Does |
|---|---|---|---|
| `chill_to_freeze` | status changed | 3 chill layers | freeze 2s |
| `fire_thaw` | hit | frozen + `fire` tag | half damage, thaw |
| `ice_shatter` | hit | frozen + single hit ≥ 40 | ×2.5, ignore armour, 1-cell splash |
| `leviathan_plate_break` | hit | `armor_plated` + `shatter` tag | +1 armour-broken stack |
| `oil_ignite` | hit | oiled + `fire` tag | burning 8/s for 4s |
| `oil_cell_ignites` | cell swept | `fire` tag over an oil cell | fire field 5s |
| `fire_field_burns` | cell entered | cell is on fire | burning |
| `oil_cell_coats` | cell entered | cell is oiled | oil coating + slow |
| `puddle_wets` | cell entered | terrain is water | wet 6s |
| `conduct` | hit | wet + `lightning` tag | +2 jumps, no falloff |
| `overload` | activate | battery ≥ cost | 3×3 overload, then overheat |
| `master_overload` | activate | — | global overload, no overheat, 1.5s EMP |

Two mechanisms are worth knowing before you edit the table:

**Mutex.** `fire_thaw` (300), `ice_shatter` (200) and `oil_ignite` (100) share the
`hit_match` mutex, so one hit matches at most one of them, in that fixed order —
`SYSTEMS.md`'s "命中一行即停". A flamethrower hitting a frozen enemy therefore
thaws it and can never shatter or ignite it, which is the deliberate anti-combo
of GDD §7.3.2, expressed as two data fields rather than as an `if`. `conduct`
stays outside the mutex because it is decided when the coil locks its primary
target, not when the hit lands.

**`{ param, fallback }`.** Rows read numbers either literally or from the
parameter bag the trigger carries. This is how a *tower upgrade* retunes a
*combo* without the combo leaving the table:

```ts
// data/towers.ts — the condenser stamps the freeze length onto the chill it applies
params: { freezeDuration: 2 }

// data/reactions.ts — the row reads it
{ kind: 'applyStatus', status: 'frozen', duration: { param: 'freezeDuration', fallback: 2 } }

// data/upgrades.ts — "冻结 2.5s" overrides the parameter, not the row
patch: { statusOverrides: [{ status: 'chilled', params: { freezeDuration: 2.5 } }] }
```

The same channel carries the flamethrower's fire-field duration, the tar slick's
slow strength, and the capacitor's overload/overheat windows.

**Derived damage is inert.** Only a *single hit* can shatter: the row rejects
sources tagged `splash`, `dot` or `chain`, and the shatter's own splash is
declared `canTriggerReactions: false`. There is no chain-reaction path through
the table (`SYSTEMS.md` decision D3).

### 4.1 Who gets hit: priority statuses

The table decides what a hit *does*; `targeting.ts` decides who receives it, and
the two have to agree or the combo never happens. A freeze lasts 2s while the
breaker swings every 2.5s, so a breaker picking targets in plain path order
mostly hits whoever is *not* frozen and a whole wave yields one or two shatters
(observed in Round 2).

Round 3 ruling 1 fixes that with one more data field rather than a rule about
ice. Any attack may list statuses that jump the queue:

```ts
// data/towers.ts — the breaker, the only tower whose single hit clears 40
attack: { kind: 'melee', damage: 45, /* ... */ priorityStatuses: ['frozen'] }
```

A target carrying one of those statuses outranks the rest of the field; the
tower's strategy (`first` / `strongest`) orders what is left, and an explicitly
chosen `air` strategy still wins over the preference, so arming a tower against
flyers does what it says. `targeting.ts` names no status, and towers that
declare nothing target exactly as before — the self-check (§7) asserts both
halves.

---

## 5. Status rules (GDD §7.2)

Both anti-slop rules are data, expressed as `group` on the status def:

- `group: 'coating'` — `wet` and `oil` evict each other, latest wins.
- `group: 'reaction_state'` — `frozen` and `burning` evict and cancel each other.

`frozen` additionally blocks `chilled` while active, and its `onEnd` hook grants
`chill_immune` for 3s **however the freeze ended** — expiry, shatter, or thaw.
`chill_immune` blocks both the layers and a directly applied freeze, but leaves
`wet` alone so a just-thawed target still conducts. Perma-freeze is therefore
structurally impossible rather than prevented by a special case in the freeze
code.

Two smaller rules, both data rather than branches: chill layers decay one at a
time (`decay: 'one_stack'`, 2s each) so stepping out of the spray does not reset
the build-up, and slows take the strongest value rather than multiplying
(`modifierMerge: 'strongest'`, `SYSTEMS.md` decision D12).

---

## 6. Events (for `src/vfx` and `src/ui`)

Full map in [`events.ts`](events.ts). The ones the presentation layer wants:

- `reaction_triggered` — carries the row's `ImpactSpec`: `vfx`, `sfx`, `hitstop`,
  `flash`, `shake`, `tip`. Combat only *declares* screen impact; the §15.2
  throttling rules ("at most one hitstop per 100ms") belong to the VFX layer.
- `combo_first_seen` — fires exactly once per combo per session, for the §14.2
  one-shot tip bar.
- `enemy_damaged` — carries `rawAmount` and `absorbedByArmor` so the grey `-5`
  chip-damage floater of the wave-3 teaching moment is drivable from one event.
- `chain_arc` — the tesla polyline plus an `empowered` flag for the thick conduct
  arc.
- `tower_state_changed`, `cell_coating_changed`, `enemy_leaked`, `bridge_destroyed`.

`CombatStats` (on `system.stats`) tracks damage share per combo and per tower,
which is the GDD §20 red line ("any combo above 40% of damage gets reverted")
measured directly rather than eyeballed.

### 6.1 Stable VFX signals

`reaction_triggered` is keyed by reaction row id and `status_applied` by status
id. Both are internals of the table: renaming a row, splitting the freeze in two,
or moving overload onto a different verb would silently break any VFX code that
switched on those strings. So combat publishes a second, much smaller channel on
the same bus whose three names are frozen ([`vfxSignals.ts`](vfxSignals.ts)):

| Signal | Lifecycle | Declared by | Carries |
|---|---|---|---|
| `ice_shatter` | one-shot | a row's `impact.signal` | position, splash radius, hit direction, final damage, the full `ImpactSpec` |
| `frozen` | `begin` / `end` | `StatusDef.signal` | enemy id, position, body radius, remaining duration, `endReason` |
| `overload` | `begin` / `end` | the `overloadTowers` effect verb | scope, capacitor origin, radius in cells, the towers actually reached, duration and the overheat that follows |

```ts
combat.bus.on('ice_shatter', (e) => vfx.play('ice-shatter', { position: world(e.position), splashRadius: e.splashRadius }));
combat.bus.on('frozen', (e) => (e.phase === 'begin' ? shells.start(e) : shells.stop(e.enemyId)));
combat.bus.on('overload', (e) => (e.phase === 'begin' ? vfx.play('overload-start', ...) : vfx.play('overload-end', ...)));
```

Three properties are worth relying on:

- **No hard-coded branches.** Every producer is a data field or an effect verb,
  so the anti-`if` rule of GDD §7.2 still holds. The capacitor's 3x3 surge and
  the §9 ultimate light up through the same code path because they use the same
  verb, not because anything tested for `master_overload`.
- **Exactly one producer per signal.** `ContentRegistry.validate()` fails if two
  rows both claim `ice_shatter` (double burst) or if a signal has no producer at
  all (VFX listening to silence).
- **Lifecycles always close.** `frozen` gets an `end` however the freeze ended —
  expiry, shatter, thaw — *and* when the host dies, leaks or is despawned mid
  freeze, so a looping emitter can never outlive its target. `overload` closes
  when its window elapses.

Ordering is fixed too: the shatter's `frozen:end` lands before its `ice_shatter`
burst, because the row removes the status before the signal is published. The
self-check asserts that.

---

## 7. Verification

`scenarios.ts` runs combat headlessly — no renderer, no grid module, no game loop:

```ts
import { runFrozenPriorityProbe, runIceShatterProbe, runOverloadProbe } from '@/combat';
const report = runIceShatterProbe();
```

On top of those probes, `selfcheck.ts` is the executable version of the two
contracts above — id parity against `data/*.json` and the signal lifecycles:

```
npx vite-node src/combat/selfcheck.run.ts
```

19 assertions, currently all passing. It reads `data/towers.json` and
`data/enemies.json` directly and diffs them against the runtime tables in both
directions — ids **and** prices — so a tower added to one and not the other, or
an upgrade repriced in one and not the other, fails here rather than three
systems downstream. `data/towers.json` is the tuning source of record: every
`cost` in `data/towers.ts` and `data/upgrades.ts` is a copy of a number in that
file, and this check is what keeps it a copy.

The probe walks the whole GDD §7.3.1 chain and returns what happened. Current
results, all matching the GDD:

| Check | Result |
|---|---|
| chill layers before freezing | 3 |
| freeze | t ≈ 1.05s |
| shatter | t ≈ 2.53s, one 45-damage swing |
| shatter damage | 112.5 (45 × 2.5) |
| armour ignored | yes (hauler's 5 armour bypassed) |
| splash | killed the bystander one cell away |
| hitstop / tip | 60ms, `tip_shatter` |
| chill during the grace window | blocked |

The other three combos, the overload/overheat cycle, the ultimate, the
upgrade-retunes-a-combo path and armour chip damage are all exercised the same
way, as is the Leviathan: P1 halving, shatter ×4, a plate knocked off per
shatter, the six sappers P2 releases, and P3's freeze immunity plus its flat
30 HP/s self-burn. `ContentRegistry.validate()` cross-checks the tables (missing
upgrades, unknown spawn ids, duplicate row ids) and currently reports zero
problems.

Three resolution details worth knowing, all deliberate:

- Reaction rows run *before* armour and multipliers, so the shatter that knocks
  a Leviathan plate off also benefits from it. A 45 swing into a frozen P1
  Leviathan lands for 281 rather than 225.
- `true` damage bypasses armour **and** damage-taken multipliers, which is what
  keeps P3's self-burn at a flat 30/s regardless of how many plates are gone.
- Armour leaves a floor of 1 damage through (`SYSTEMS.md` decision D2), while the
  grey "-5" chip floater reads `absorbedByArmor`, so the wave-3 lesson survives
  the floor.

`runFrozenPriorityProbe()` is the §4.1 rule in one deterministic frame: a breaker
in reach of two identical haulers, the frozen one trailing and the healthy one
leading. It reports who the breaker swung at, whether the swing shattered, and
who the machine gun standing beside it locked on to instead.

For `R2-G1` (tests): assert against `runIceShatterProbe()`, `runOverloadProbe()`,
`runFrozenPriorityProbe()`
and `runCombatSelfCheck()`, and build new probes out of `CombatSystem` +
`OpenFieldTerrain` directly — no mocking needed, every external dependency is
already a port with a headless default. The shatter report now also carries the
signal trace (`signals`, `shatterSplashRadius`), which is the cheapest way to
assert the VFX contract without standing up a renderer.

---

## 8. Known deferrals

- **Waves, gates, integrity, gold.** Not combat's job. Combat emits
  `enemy_leaked` with the integrity and gold numbers; `src/gameplay` applies them.
- **Blackout zones.** `setTowerPowered()` is the entry point; the zone→cell
  mapping lives in the grid module.
- **Bridges.** The sapper emits `bridge_destroyed`; the terrain edit is gameplay's.
- **Hero.** Out of v1 scope by GDD §4.1. Nothing here assumes its absence: a hero
  would be an entity with a ≥40 single hit, and the shatter row would pick it up
  with no changes — which is the point of tag-based rows.
