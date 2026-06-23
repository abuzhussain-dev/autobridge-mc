# Minecraft 1.21.11 — Knowledge Graph for AI Planning

Extracted from `minecraft-data` npm package v3.111.0.

## Quick Start
```bash
cd mcdata/
node kg-query.js brew potion_of_strength     # brewing path
node kg-query.js recipe blaze_powder         # crafting recipe
node kg-query.js item nether_wart            # item details
node kg-query.js find potion                 # search items
node kg-query.js guide brewing               # brewing guide
```

## Brewing Chemistry

### The Potion Tree
```
Water Bottle
  └─ Nether Wart ──→ Awkward Potion (base for ALL effect potions)
       ├─ Blaze Powder          → Potion of Strength
       ├─ Ghast Tear            → Potion of Regeneration
       ├─ Sugar                 → Potion of Swiftness
       ├─ Rabbit's Foot         → Potion of Leaping
       ├─ Glistering Melon      → Potion of Healing
       ├─ Spider Eye            → Potion of Poison
       ├─ Magma Cream           → Potion of Fire Resistance
       ├─ Pufferfish            → Potion of Water Breathing
       ├─ Golden Carrot         → Potion of Night Vision
       ├─ Turtle Helmet         → Potion of Turtle Master
       ├─ Phantom Membrane      → Potion of Slow Falling
       └─ Fermented Spider Eye  → Potion of Harming / Weakness / Invisibility / Slowness
```

### Modifier Ordering (must apply in this order)
1. **Redstone** → Extended Duration (replaces glowstone)
2. **Glowstone Dust** → Power II (replaces redstone)
3. **Gunpowder** → Splash Potion (throwable)
4. **Dragon's Breath** → Lingering Potion (area cloud, must be splash first)

### Fermented Spider Eye Corruptions
| Input Potion | Result |
|-------------|--------|
| Strength | Weakness |
| Healing | Harming (II if Healing II) |
| Poison | Harming |
| Swiftness | Slowness |
| Leaping | Slowness |
| Night Vision | Invisibility |
| Regeneration | Poison |
| Water Breathing | Harming |
| Turtle Master | Slowness |
| Slow Falling | Harming |
| Awkward | Harming |

## Brewing Stand
```
┌─────────────────────┐
│   [4] Ingredient    │
│                     │
│  [1] [2] [3]        │  ← Potion bottles (input/output)
│                     │
│   [0] Fuel          │  ← Blaze Powder (20 brews per piece)
└─────────────────────┘
```

## All Effect Potions + Duration/Power

| Potion | Effect | Duration | Max Power | Splash OK | Extended OK |
|--------|--------|----------|-----------|-----------|-------------|
| Strength | Strength III | 3:00 / 8:00 | II (1:30) | ✅ | ✅ |
| Swiftness | Speed III | 3:00 / 8:00 | II (1:30) | ✅ | ✅ |
| Slowness | Slowness II | 1:30 / 4:00 | IV (0:20) | ✅ | ✅ |
| Healing | Instant Health | Instant | II | ✅ | ❌ |
| Harming | Instant Damage | Instant | II | ✅ | ❌ |
| Poison | Poison | 0:45 / 1:30 | II (0:21) | ✅ | ✅ |
| Regeneration | Regen III | 0:45 / 1:30 | II (0:22) | ✅ | ✅ |
| Fire Resistance | Fire Res | 3:00 / 8:00 | — | ✅ | ✅ |
| Water Breathing | Water Br | 3:00 / 8:00 | — | ✅ | ✅ |
| Invisibility | Invis | 3:00 / 8:00 | — | ✅ | ✅ |
| Night Vision | Night Vis | 3:00 / 8:00 | — | ✅ | ✅ |
| Leaping | Jump Boost III | 3:00 / 8:00 | II (1:30) | ✅ | ✅ |
| Turtle Master | Slowness IV + Res III | 0:20 / 0:40 | — | ✅ | ✅ |
| Weakness | Weakness | 1:30 / 4:00 | — | ✅ | ✅ |
| Slow Falling | Slow Falling | 1:30 / 4:00 | — | ✅ | ✅ |

## Key Item IDs for Bridge Commands
```json
{"nether_wart": 1119, "blaze_powder": 1124, "blaze_rod": 848,
 "glass_bottle": 1120, "brewing_stand": 1126, "water_bucket": 1128,
 "redstone": 717, "glowstone_dust": 1056, "gunpowder": 950,
 "dragon_breath": 1290, "fermented_spider_eye": 1123,
 "ghast_tear": 1117, "sugar": 1084, "rabbit_foot": 1252,
 "magma_cream": 1125, "glistering_melon_slice": 1129,
 "golden_carrot": 1232, "pufferfish": 1060, "turtle_helmet": 887,
 "phantom_membrane": 861, "potion": 1121, "splash_potion": 1291,
 "lingering_potion": 1294}
```

## Furnace/Blast Furnace Recipes (relevant items)
| Input | Fuel | Output |
|-------|------|--------|
| Nether Gold Ore | Any fuel | Gold Ingot |
| Gold Ore | Any fuel | Gold Ingot |
| Iron Ore | Any fuel | Iron Ingot |
| Ancient Debris | Any fuel | Netherite Scrap |

## Container Slot Layouts
| Container | Total | Input | Fuel | Output | Notes |
|-----------|-------|-------|------|--------|-------|
| Brewing Stand | 5 | slot 4 | slot 0 | slots 1-3 | 3 potions at once |
| Furnace | 3 | slot 0 | slot 1 | slot 2 | — |
| Blast Furnace | 3 | slot 0 | slot 1 | slot 2 | faster ores |
| Smoker | 3 | slot 0 | slot 1 | slot 2 | faster food |
| Crafting Table | 10 | grid 1-9 | — | slot 0 | 3×3 grid |
| Chest | 27 | — | — | — | all storage |
| Double Chest | 54 | — | — | — | two chests |
| Barrel | 27 | — | — | — | better than chest |

## Brewing Automation Loop (pseudo-code)
```
def brew_batch(ingredient, count=3):
  # input: 3 water bottles + ingredient + fuel
  # output: 3 potions
  
  1. Open brewing_stand                  # screen.getSlots/blocks 10-14
  2. Fill slots 1-3 with water bottles   # moveItem to slots 10-12
  3. Put ingredient in slot 4            # moveItem to slot 13
  4. Put blaze_powder in slot 0          # moveItem to slot 9
  5. Close screen                        # screen.close
  6. Wait 20s (brew completes)           # no action needed
  7. Open brewing_stand again            # screen.getSlots/blocks
  8. Take output potions from slots 1-3  # moveItem from slots 10-12
  9. Loop back to step 1 if more needed

def modify_batch(potions, modifier):
  # potions = items in brewing stand
  # modifier = redstone/glowstone/gunpowder/dragon_breath
  
  1. Put modifier in ingredient slot
  2. Wait brew cycle
  3. Repeat if adding gunpowder THEN dragon_breath
```
