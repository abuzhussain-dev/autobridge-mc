# AutoBridge Script Flaw Analysis

## make_potions.js — 26 flaws found

### CRITICAL Brewing Logic Flaws (will produce wrong potions or nothing)

| # | Flaw | Impact |
|---|------|--------|
| 1 | **Wrong brewing order** — MC requires 3 stages: water bottle + nether wart → Awkward (20s), Awkward + blaze powder → Strength I (20s), Strength I + glowstone → Strength II (20s). Script does only 2 stages (wart → glowstone, skips blaze powder entirely) | Produces wrong potions (Awkward + glowstone = Mundane, not Strength II) |
| 2 | **No fuel** — Brewing stand needs blaze powder in slot 4 (fuel). Script never deposits fuel | Stand won't brew, script silently fails |
| 3 | **Missing inventory click to pick item** — To place ingredient in slot 3, you must first click the item in your inventory (slots 5-41) to pick it up, THEN click slot 3. Script just clicks slot 3 directly | If slot 3 empty, cursor empty → nothing happens. If slot 3 has item → picks it up instead of placing |
| 4 | **No water bottleneck** — After 3-stage brew, bottles in slots 0-2 are now Strength II. Script never replaces them with fresh water bottles for the next batch | Only 3 potions max, never reaches 100 |
| 5 | **No ingredient count validation** — 100 potions needs: 100 nether wart, 100 blaze powder, 100 glowstone, 100+ empty bottles, 34 blaze powder for fuel. Script never checks | Runs out mid-batch silently |

### HIGH Script Execution Flaws (will break at runtime)

| # | Flaw | Impact |
|---|------|--------|
| 6 | **No response checking** — Commands return `{success, error}` but script never reads responses | Continues blindly after failure (e.g., walkTo blocked by wall) |
| 7 | **No timing sync** — Comments say "wait 2-3s" / "wait 20s" but JSON has no wait mechanism | Client sends all commands at once, race conditions |
| 8 | **Hardcoded coordinates** — Chest at 100,64,99 and brewing stand at 102,64,100 are fixed | Works only in one specific world at one spot |
| 9 | **No container auto-discovery** — No "find nearest chest" or "scan area" command | Can't adapt to different layouts |
| 10 | **walkTo has no completion signal** — Sets `_walkTarget` and returns immediately. No way to know when player arrives | Next command executes while player is still walking |
| 11 | **walkTo has no timeout** — If path is blocked by terrain, walk key stays pressed forever | Player stuck, script hangs |
| 12 | **No pre-flight GUI check** — Opens brewing stand but never reads `screen.getSlots` to verify bottles are in slots 0-2 | Blindly clicks slots, may move wrong items |
| 13 | **No batch loop** — Each brewing stand handles only 3 bottles. 100 potions = 34 batches × 60s each. Script does ONE batch | Gets 3 potions, not 100 |
| 14 | **No error recovery** — Any failed command stops progress with no retry | One failure wastes all progress |

### MEDIUM Bridge Architecture Gaps (missing commands needed for full potion flow)

| # | Flaw | Impact |
|---|------|--------|
| 15 | **No `wait` command** — No bridge command for pausing. Timings must be client-side | Client needs its own script engine with delay support |
| 16 | **No `selectSlot` command** — Can't pick which hotbar slot is active | Can't equip bottle for placing in brewing stand |
| 17 | **No `getWalkStatus` command** — No way to poll if walkTo completed | Blind fire-and-forget |
| 18 | **No cursor state query** — After `screen.click(PICKUP)`, cursor may hold an item. No way to check | Don't know if click picked up or placed |
| 19 | **No furnace/crafting commands** — If user needs blaze powder from rods, can't craft | Blocked if only have blaze rods |
| 20 | **scanContainer has no position range** — Requires exact x,y,z. No `findContainer(type, radius)` command | Must know every container's coordinates |

### LOW Implementation Flaws (annoyances)

| # | Flaw | Impact |
|---|------|--------|
| 21 | **Comment-delimited JSON** — Script has JS comments `//` but is consumed line-by-line as JSON | Raw JSON parsers will choke on comments |
| 22 | **Item IDs are translation keys** — Bridge returns `"block.minecraft.nether_wart"` not `"minecraft:nether_wart"` | Need translation layer between game state and script |
| 23 | **No session recovery** — If bridge disconnects mid-batch, no way to resume from checkpoint | Must restart from scratch |
| 24 | **No progress feedback** — 40-minute brew has no intermediate status updates | User watches silent player for 40 min |
| 25 | **No idle timeout protection** — If script pauses mid-batch, player may auto-log | Timer keeps running server-side |
| 26 | **Hardcoded actionType** — Uses `PICKUP` for all clicks. Brewing stand fuel (slot 4) needs `QUICK_MOVE` | Wrong click type for different operations |

---

## Priority Fix Recommendations

### Fix now (blocks demo from working):
1. Fix brewing order: nether wart → Awkward, blaze powder → Strength I, glowstone → Strength II
2. Add fuel deposit to slot 4 (QUICK_MOVE)
3. Add `selectSlot` command to bridge
4. Add `wait` command to bridge

### Fix before production:
5. Add `getWalkStatus` + walk-complete event
6. Add batch loop + inventory management
7. Add error recovery + retry logic
8. Add `findContainer(type, radius)` command

### Fix for polish:
9. Add progress events
10. Add session checkpoint/resume
11. Strip comments from script format
12. Add cursor state query command
