# Craps Trainer + Play — Design Proposal

A companion to the Blackjack trainer (`tpcolburn/blackjack`), built on the **same single-file,
vanilla-JS, global-`G`-state, full-`render()` architecture**, the same casino visual language, the
same localStorage persistence, and the same PWA shell. No card counting (irrelevant to craps).

---

## 0. The core design problem (read this first)

In blackjack, skill lives in the **in-round decision** (hit/stand/double/split), so the trainer grades
*moves*. In craps, **the dice are memoryless and every roll is independent** — there is no "correct way
to roll." So a naive port has nothing to grade.

The insight that makes a craps *trainer* meaningful: in craps, **100% of the skill is in bet selection
and money management.** Two players at the same table with the same dice get wildly different expected
results purely from *which bets they make*. So the trainer grades:

1. **Bet-selection quality** — are you making low-house-edge bets (pass/come/don't + free odds) or
   bleeding on sucker bets (props, hardways, big 6/8, place 4/10)?
2. **Odds discipline** — free odds are the only 0% house-edge bet on the table; an optimal bettor always
   backs line bets with the maximum odds they can afford. Did you take/lay your odds?
3. **Money management** — bet sizing relative to bankroll, and adherence to a chosen betting system.

This maps *exactly* onto the blackjack app's existing dual-bankroll idea: we run a **counterfactual
"optimal-edge bettor" bankroll** beside the player's actual one and chart the gap. In blackjack that
counterfactual is "perfect basic strategy"; in craps it's "perfect bet selection" (same line bets the
player made, but always with full odds and never a prop). The trainer is fundamentally a **house-edge
literacy tool.**

---

## 1. Game model

### 1.1 Dice
Two independent d6. Distribution of the sum (out of 36):

| Total | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|------|---|---|---|---|---|---|---|---|----|----|----|
| Ways | 1 | 2 | 3 | 4 | 5 | 6 | 5 | 4 | 3  | 2  | 1  |
| Prob | 1/36 | 2/36 | 3/36 | 4/36 | 5/36 | 6/36 | 5/36 | 4/36 | 3/36 | 2/36 | 1/36 |

`roll()` = two `1+floor(rnd*6)`; keep both dice for hardway/pip rendering.

### 1.2 Round flow (the come-out / point loop)
```
        ┌─────────────── COME-OUT ROLL ───────────────┐
        │  7 or 11  → Pass wins,  Don't loses          │  (one-roll, stay on come-out)
        │  2,3,12   → Pass loses, Don't wins/push(12)  │
        │  4,5,6,8,9,10 → that number becomes the POINT │
        └──────────────────────┬───────────────────────┘
                               ▼  point established
        ┌──────────────── POINT IS ON ─────────────────┐
        │  roll == point → Pass wins, Don't loses; line │
        │                  odds pay true; round resets  │
        │  roll == 7     → "seven out": Pass loses,      │
        │                  Don't wins; ALL place/come    │
        │                  bets down; round resets       │
        │  any other     → roll again (come/place/field  │
        │                  bets resolve every roll)       │
        └────────────────────────────────────────────────┘
```

### 1.3 Bets, true odds, and house edge (the data table the trainer is built on)
Every bet object carries its house edge so the UI can teach it. `HE` = house edge per resolved bet
(per-roll edge in parens where the bet is multi-roll).

| Bet | Pays | House edge | Tier (trainer) | v1? |
|-----|------|-----------|----------------|-----|
| **Pass line** | 1:1 | **1.41%** | ✅ optimal core | **v1** |
| **Don't pass** | 1:1 (push 12) | **1.36%** | ✅ optimal core | **v1** |
| **Free odds (behind pass)** | true (2:1 on 4/10, 3:2 on 5/9, 6:5 on 6/8) | **0.00%** | ⭐ always take | **v1** |
| **Lay odds (behind don't)** | true (1:2, 2:3, 5:6) | **0.00%** | ⭐ always take | **v1** |
| **Come** | 1:1 (+odds) | 1.41% | ✅ optimal | v2 |
| **Don't come** | 1:1 (+odds) | 1.36% | ✅ optimal | v2 |
| **Place 6 / 8** | 7:6 | 1.52% | 🟡 acceptable | v2 |
| **Place 5 / 9** | 7:5 | 4.0% | 🟠 weak | v2 |
| **Place 4 / 10** | 9:5 | 6.7% | 🔴 sucker | v2 |
| **Field** | 1:1 (2:1 on 2, 3:1 on 12) | 2.78% (5.5% if 2&12 both 2:1) | 🟠 weak | v2 |
| **Big 6 / Big 8** | 1:1 | 9.1% | 🔴 sucker | v3 |
| **Hardways (4,10)** | 7:1 | 11.1% | 🔴 sucker | v3 |
| **Hardways (6,8)** | 9:1 | 9.1% | 🔴 sucker | v3 |
| **Any 7** | 4:1 | 16.7% | ☠️ worst | v3 |
| **Any craps / 2 / 12 / 11 / 3** | various | 11–16.7% | ☠️ sucker | v3 |

**v1 scope** keeps the whole game *correct and complete* with just the four bets that actually matter
(pass / don't / odds), which is also exactly what an optimal bettor uses — so the trainer's "ideal
policy" is fully expressible in v1.

---

## 2. Trainer concept

### 2.1 The optimal betting policy (what we grade against)
A concrete, defensible rubric (the "perfect player"):
- **Make a flat line bet** every come-out (pass or don't — both are near-optimal; either is graded
  "correct"). One unit.
- **Always back it with the maximum free odds** the table allows once a point is set (odds are 0% edge —
  declining them is the single most common −EV mistake, so this is the heaviest-weighted lesson).
- **Never make a prop / hardway / big 6-8 / field bet.** Place 6/8 tolerated (🟡); place 4/10 penalized.
- In v2+ with come bets: keep at most 2 come bets working + the pass line ("3-Point Molly"), all odds-backed.

### 2.2 What gets graded, and how
Grading happens **at resolution of each bet** (not per roll), because that's when EV is realized. Each
placed bet produces a graded decision record, mirroring blackjack's `recDec`:
```
dec = { bet:'pass', amount:25, oddsTaken:true, tier:'optimal', he:1.41,
        correct:true, note:'Pass + full odds — textbook.' }
```
Scoring categories (the craps analog of hard/soft/pair accuracy):
- **Line discipline** — did you have a pass/don't bet at all? (no bet = no edge to grind, flagged.)
- **Odds discipline** — when a point was on and you had a line bet, did you take full odds? (the big one.)
- **Edge avoidance** — fraction of your total wagered $ that went on sub-optimal (🟠/🔴/☠️) bets.

Accuracy % = weighted blend, shown by category on the stats screen with the same colored progress bars.

### 2.3 The counterfactual "optimal-edge" bankroll
Exactly analogous to blackjack's BS bankroll. For every roll sequence the player actually experienced,
we *replay the same dice* under the optimal policy:
- same line bet(s) the player made (or a default 1 unit if they made none),
- always full odds,
- no props.

We accumulate `optBankroll` alongside `actualBankroll` and chart both over time (reuse the SVG chart
verbatim). The "gap banner" reads e.g. *"Perfect bet selection would have saved you $180 over 120
rolls"* — because the dice are identical, the gap is **purely the cost of bet selection**, which is the
cleanest possible teaching signal. (Note: because odds are 0% EV, the gap is driven by props + missing
odds variance; over many rolls it converges to the edge difference. This is honest and we say so.)

### 2.4 Per-bet teaching
Tapping any bet zone shows its house edge and true odds before you commit ("Hardway 8 — pays 9:1, true
odds 10:1, **house edge 9.1%**. This is a sucker bet."). A live "blended house edge of your current
bets" readout sits on the table, turning abstract percentages into a number that moves as you bet.

---

## 3. Betting systems

The blackjack app's betting-system scaffold (mutually-exclusive modes, setup panel, live progress strip,
5,000-session Monte Carlo tester) ports directly. The **unit/base bet = the pass-line bet**; the system
governs how that base bet sizes round to round. Odds are always layered on top at max (kept outside the
progression, since they're 0% EV — pure variance, not part of the "system").

| System | Base bet rule | MC-testable? |
|--------|--------------|--------------|
| **Labouchère** | pass-line bet = (first+last) of sequence × unit; win cancels ends, loss appends | ✅ (reuse harness) |
| **Oscar's Grind** | pass-line bet steps up 1 unit after a win, holds after a loss, capped at +target/series | ✅ |
| **Iron Cross** (craps-native) | place 5,6,8 + field simultaneously so every number except 7 pays; teach that it *feels* safe but the blended HE is ~ -2.4%/roll | ✅ (great teaching demo) |
| **3-Point Molly** (craps-native) | pass + up to 2 come bets, all with full odds — this is *good* play, not a progression; "system" = discipline to always odds-up | ✅ |
| **Regression / press** (later) | start place 6&8 at 2 units, regress after one hit, press after two | ⚠️ later |

The Monte Carlo tester reuses the existing `simSession`/`runMC` structure, swapping blackjack's empirical
per-hand outcome distribution for the **exact craps per-roll resolution math** (we have closed-form
probabilities, so the sim is exact, not empirical — a strict upgrade). Iron Cross is the showcase: the MC
output ("completion vs bankroll-bust", peak exposure, p5/p95 session net) makes its hidden bleed obvious.

---

## 4. State model (`G`)

Mirrors the blackjack `G` shape; craps-specific parts in **bold**.
```js
var G = {
  screen:'game',                      // 'game' | 'stats'
  br:1000, unit:25,                   // bankroll, base unit
  phase:'comeout',                    // 'comeout' | 'point' | 'resolved'   ← replaces blackjack 'pp'
  point:null,                         // null on come-out, else 4/5/6/8/9/10
  dice:[3,4], rollNum:0,              // last roll + count this shoe-equivalent (session)
  bets:{                              // active bets keyed by type
    pass:{amt:25, odds:50}, dontpass:null,
    come:[/* {amt,odds,point} */], dontcome:[],
    place:{6:0,8:0,5:0,9:0,4:0,10:0},
    field:0, hard:{4:0,6:0,8:0,10:0}, props:{any7:0,/*…*/}
  },
  rollHist:[],                        // [{dice, total, resolutions:[…]}] for the log + chart replay
  handDecs:[], curDecs:[],            // graded bet decisions this round (→ stats)
  preRollBr:1000,                     // for net calc, analog of preDealBr
  gs:{ rolls:0, optBr:1000,           // counterfactual optimal bankroll
       cat:{ line:{ok,n}, odds:{ok,n}, edge:{wagered,wastedOnBad} },
       history:[] },                  // per-round records → chart + recent list
  lab:null, og:null, iron:null,       // betting-system state (mutually exclusive)
  labShow:false, ogShow:false
};
```
`saveState`/`loadState` persist the full thing, including in-progress bets and `rollHist` (we already
solved "persist mid-round state" for blackjack — same pattern, and craps has *no* hidden state like a
dealer hole card, so resume is even simpler).

---

## 5. UI / screens

### 5.1 Table (mobile-first, same felt/chip styling)
```
┌──────────────────────────────────────────────┐
│  $1,000        Optimal: $1,080 (+$80)  📊 Stats│   ← topbar (reuse)
├──────────────────────────────────────────────┤
│ ╭───────── FELT ─────────╮   POINT: ⑥          │
│ │   🎲 4   🎲 3   = 7      │   come-out: OFF     │   ← dice + state
│ │                         │   blended HE: 1.0% │   ← live teaching readout
│ │  ┌────┬────┬────┬────┐  │                     │
│ │  │ 4  │ 5  │SIX │ 8  │  │  ← POINT BOXES      │
│ │  └────┴────┴────┴────┘  │                     │
│ │  PASS LINE  [ $25 ]     │  ← your bets glow   │
│ │   └ odds    [ $50 ]     │                     │
│ │  DON'T PASS [  –  ]      │                     │
│ │  FIELD · BIG6/8 · HARD · PROPS  (🔴 tap=info) │
│ ╰─────────────────────────╯                     │
├──────────────────────────────────────────────┤
│  [ Place bets ]   →   [ 🎲 ROLL ]               │   ← controls (reuse btn styles)
│  💡 Point is 6. Back your pass line with odds — │   ← trainer hint (reuse hint-box)
│     it's the only 0% house-edge bet.            │
└──────────────────────────────────────────────┘
```

### 5.2 Flow
- **Come-out:** tap bet zones to stake (chips/`setBet` reused). `ROLL`. Resolutions animate as result
  boxes (reuse `.result-*`), e.g. "7 — Pass wins +$25." If a point sets, phase → point.
- **Point on:** an **odds prompt** appears if you have an unbacked line bet ("Take 2× odds? $50 → pays
  true"). `ROLL` repeats; each roll logs resolutions; seven-out or point hit ends the round.
- **Resolved:** round summary + graded decisions (reuse the blackjack "Decisions — N/M correct" panel)
  + betting-system update strip + "Next round →".

### 5.3 Stats (reuse wholesale)
Same three stat cards (Your bankroll / Optimal bankroll / Bet-quality %), same gap banner, same
bankroll-over-time SVG (actual vs optimal), accuracy-by-category bars (Line / Odds / Edge-avoidance),
recent-rounds list. A craps-specific extra: **"$ wagered by bet tier"** donut/bar (how much of your
action was optimal vs sucker).

---

## 6. Build plan

- **Phase 1 — MVP (the whole game, minimal bets):** dice, come-out/point loop, pass + don't pass +
  free/lay odds, correct resolution + payouts, roll log. *No trainer yet.* Proves the engine.
- **Phase 2 — Trainer:** decision grading (line/odds discipline), optimal-bettor counterfactual bankroll,
  stats screen + chart, per-bet house-edge info popovers, live blended-HE readout.
- **Phase 3 — More bets:** come / don't come (with traveling odds), place 6/8/5/9/4/10, field. Extend
  grading rubric + tier accounting.
- **Phase 4 — Betting systems:** Labouchère + Oscar's Grind on the pass line, Iron Cross + 3-Point Molly,
  each with setup panel, live strip, and the exact-math Monte Carlo tester.
- **Phase 5 — Props + polish:** hardways, big 6/8, one-roll props (all flagged sucker), PWA shell
  (manifest/icons/SW), persistence of in-progress bets, sound/haptic dice (optional).

---

## 7. Reuse map (blackjack → craps)

| Lift near-verbatim | Adapt | Net-new (craps-specific) |
|---|---|---|
| PWA shell (sw.js network-first, manifest, icon canvas) | `G` + render() pattern | Dice model + roll() |
| localStorage save/load (incl. mid-round resume) | Trainer grading harness (recDec→graded bet) | Come-out/point state machine |
| Chips, `setBet`, felt/btn/result CSS | Counterfactual bankroll (BS → optimal-edge) | Bet-zone table layout + resolution engine |
| Stats page + SVG bankroll chart | Category accuracy bars (hand-type → bet-discipline) | House-edge data table + teaching popovers |
| Monte Carlo `simSession`/`runMC` skeleton | per-outcome dist → exact craps roll math | Odds prompt UX; blended-HE readout |
| Betting-system scaffold (Labouchère, Oscar's) | base bet = pass line | Iron Cross / 3-Point Molly systems |
| Keyboard shortcuts, topbar, recent-N strip | — | "Roll" = primary action key (Space/Enter) |

**Bottom line:** ~60–70% of the blackjack codebase ports structurally; the genuinely new work is the
dice/round state machine, the bet-zone table + resolution engine, and reframing the trainer from
"grade the move" to "grade the bet." Card counting is dropped entirely, and the luck meter could
optionally carry over (residual vs the exact per-roll EV) but is out of the core scope.
