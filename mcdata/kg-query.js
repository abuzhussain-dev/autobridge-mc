const mc = require('minecraft-data')('1.21.11');
const fs = require('fs');
const { performance } = require('perf_hooks');

const items = mc.itemsArray;
const itemsByName = {};
items.forEach(i => { itemsByName[i.name] = i; });

const blocks = mc.blocksArray;
const blocksByName = {};
blocks.forEach(b => { blocksByName[b.name] = b; });

function findItem(search) {
  search = search.toLowerCase();
  const exact = items.find(i => i.name === search || i.displayName.toLowerCase() === search);
  if (exact) return exact;
  return items.find(i => i.name.includes(search) || i.displayName.toLowerCase().includes(search));
}

function findBlock(search) {
  search = search.toLowerCase();
  const exact = blocks.find(b => b.name === search || b.displayName.toLowerCase() === search);
  if (exact) return exact;
  return blocks.find(b => b.name.includes(search) || b.displayName.toLowerCase().includes(search));
}

const POTION_INGREDIENTS = {
  nether_wart: { step: 0, label: 'Base ingredient', makes: 'Awkward Potion' },
  glowstone_dust: { step: 1, label: 'Modifier: Power II', conflicts: ['redstone'] },
  redstone: { step: 2, label: 'Modifier: Extended duration', conflicts: ['glowstone_dust'] },
  gunpowder: { step: 3, label: 'Modifier: Splash' },
  dragon_breath: { step: 4, label: 'Modifier: Lingering' },
  fermented_spider_eye: { step: 5, label: 'Modifier: Corrupted/Inverted' }
};

const POTION_TREE = {
  water_bottle: [{ ingredient: 'nether_wart', result: 'awkward' }],
  awkward: [
    { ingredient: 'glistering_melon_slice', result: 'potion_of_healing' },
    { ingredient: 'magma_cream', result: 'potion_of_fire_resistance' },
    { ingredient: 'rabbit_foot', result: 'potion_of_leaping' },
    { ingredient: 'spider_eye', result: 'potion_of_poison' },
    { ingredient: 'ghast_tear', result: 'potion_of_regeneration' },
    { ingredient: 'blaze_powder', result: 'potion_of_strength' },
    { ingredient: 'sugar', result: 'potion_of_swiftness' },
    { ingredient: 'turtle_helmet', result: 'potion_of_turtle_master' },
    { ingredient: 'pufferfish', result: 'potion_of_water_breathing' },
    { ingredient: 'phantom_membrane', result: 'potion_of_slow_falling' },
    { ingredient: 'golden_carrot', result: 'potion_of_night_vision' }
  ]
};

console.log(`
╔══════════════════════════════════════════════╗
║    Minecraft 1.21.11 Knowledge Graph Query   ║
╚══════════════════════════════════════════════╝

Total Items: ${items.length}  |  Blocks: ${blocks.length}  |  Recipes: ${Object.keys(mc.recipes).length}

Available commands:
  node kg-query.js item <name>
  node kg-query.js block <name>
  node kg-query.js recipe <item-name>
  node kg-query.js potion <effect>
  node kg-query.js brew <target-potion>
  node kg-query.js plan <task-description>
  node kg-query.js find <search-term>
  node kg-query.js guide brewing
  node kg-query.js guide containers
`);

const q = process.argv[2];
const arg = process.argv.slice(3).join(' ');

if (!q) process.exit(0);

switch (q) {
  case 'item': {
    const item = findItem(arg);
    if (!item) { console.log('Item not found'); break; }
    const recipe = mc.recipes[item.id];
    console.log(JSON.stringify({
      id: item.id, name: item.name, displayName: item.displayName,
      stackSize: item.stackSize,
      hasRecipe: !!recipe && recipe.length > 0,
      recipeCount: recipe ? recipe.length : 0
    }, null, 2));
    break;
  }

  case 'block': {
    const block = findBlock(arg);
    if (!block) { console.log('Block not found'); break; }
    console.log(JSON.stringify({
      id: block.id, name: block.name, displayName: block.displayName,
      hardness: block.hardness, resistance: block.resistance,
      diggable: block.diggable, material: block.material,
      transparent: block.transparent, emitLight: block.emitLight,
      boundingBox: block.boundingBox, drops: block.drops
    }, null, 2));
    break;
  }

  case 'recipe': {
    const item = findItem(arg);
    if (!item) { console.log('Item not found'); break; }
    const recipe = mc.recipes[item.id];
    if (!recipe || recipe.length === 0) { console.log('No recipes for ' + item.name); break; }
    const enriched = recipe.map(r => {
      const e = { type: r.type };
      if (r.inShape) {
        e.shape = r.inShape.map(row => row.map(id => {
          const ri = mc.items[id];
          return ri ? ri.name : id;
        }));
      }
      if (r.ingredients) {
        e.ingredients = r.ingredients.map(id => {
          const ri = mc.items[id];
          return ri ? ri.name : id;
        });
      }
      if (r.ingredient) {
        const ri = mc.items[r.ingredient.id];
        e.ingredient = ri ? ri.name : r.ingredient.id;
      }
      if (r.result) {
        const ri = mc.items[r.result.id];
        e.result = { name: ri ? ri.name : r.result.id, count: r.result.count };
      }
      e.count = r.count;
      return e;
    });
    console.log(JSON.stringify({ item: item.name, recipes: enriched }, null, 2));
    break;
  }

  case 'potion': {
    const effect = arg.toLowerCase();
    const effects = {
      healing: 'Instant Health', fire_resistance: 'Fire Resistance',
      harming: 'Instant Damage', leaping: 'Jump Boost',
      poison: 'Poison', regeneration: 'Regeneration',
      slowness: 'Slowness', strength: 'Strength',
      swiftness: 'Speed', turtle_master: 'Slowness IV + Resistance III',
      water_breathing: 'Water Breathing', slow_falling: 'Slow Falling',
      invisibility: 'Invisibility', night_vision: 'Night Vision',
      weakness: 'Weakness', awkward: 'Awkward Base',
      mundane: 'Mundane Base', thick: 'Thick Base'
    };
    const found = Object.keys(effects).filter(k => k.includes(effect) || effects[k].toLowerCase().includes(effect));
    if (found.length === 0) { console.log('No potion effects match "' + arg + '"'); break; }
    found.forEach(e => console.log(e + ' → ' + effects[e]));
    break;
  }

  case 'brew': {
    const target = arg.toLowerCase();
    const path = [];
    const reverseTree = {};
    Object.keys(POTION_TREE).forEach(base => {
      POTION_TREE[base].forEach(step => {
        reverseTree[step.result] = { from: base, ingredient: step.ingredient };
      });
    });

    let current = target;
    while (current && reverseTree[current]) {
      const step = reverseTree[current];
      path.unshift({ action: 'Add ' + step.ingredient + ' to ' + step.from, result: current });
      current = step.from;
    }
    if (current === 'water_bottle') {
      path.unshift({ action: 'Start with water bottle', result: 'water_bottle' });
    } else if (current && current !== target) {
      path.unshift({ action: 'Start with ' + current, result: current });
    }

    if (path.length === 0) { console.log('Unknown potion: ' + target); break; }

    console.log('Brewing path for ' + target + ':');
    path.forEach((p, i) => console.log('  ' + (i+1) + '. ' + p.action + ' → ' + p.result));
    console.log('');
    console.log('Modifier options:');
    if (['potion_of_healing','potion_of_fire_resistance','potion_of_leaping',
         'potion_of_regeneration','potion_of_strength','potion_of_swiftness',
         'potion_of_turtle_master','potion_of_water_breathing',
         'potion_of_slow_falling','potion_of_night_vision'].includes(target)) {
      console.log('  - Add redstone → Extended duration');
      console.log('  - Add glowstone_dust → Power II');
    }
    if (['potion_of_healing','potion_of_harming','potion_of_poison',
         'potion_of_regeneration','potion_of_strength',
         'potion_of_swiftness','potion_of_slowness',
         'potion_of_weakness'].includes(target)) {
      console.log('  - Add glowstone_dust → Power II');
    }
    console.log('  - Add gunpowder → Splash variant');
    console.log('  - Add dragon_breath → Lingering variant (must be splash first)');
    break;
  }

  case 'guide': {
    if (arg === 'brewing') {
      console.log(`
BREWING GUIDE:
===============
1. Fuel: Blaze Powder (powers 20 brews per piece)
2. Base: Water bottle + Nether Wart → Awkward Potion
3. Effect ingredient: Add to Awkward → target potion
4. Modifiers (can stack some):
   - Redstone → Extended duration
   - Glowstone Dust → Power II
   - Fermented Spider Eye → Corrupt/Invert
5. Form modifiers (applied last):
   - Gunpowder → Splash Potion
   - Dragon's Breath → Lingering Potion

Container: Brewing Stand has 5 slots:
  Slot 0: Fuel (Blaze Powder)
  Slots 1-3: Potion bottles (input/output)
  Slot 4: Ingredient

Key items needed:
  - Blaze rods → Blaze Powder (crafting)
  - Nether Wart (drops from Nether Fortress)
  - Glass bottles → Water bottles (fill at water source)
  - Dragon's Breath (collected from ender dragon breath)
      `);
    } else if (arg === 'containers') {
      console.log(`
CONTAINER GUIDE:
=================
Chest: 27 slots (54 if double)
Barrel: 27 slots
Furnace: 3 slots (input, fuel, output)
Blast Furnace: 3 slots (smelts ores faster)
Smoker: 3 slots (cooks food faster)
Brewing Stand: 5 slots (fuel, 3 potions, ingredient)
Crafting Table: 3x3 grid + output
Enchanting Table: 3 slots (item, lapis x2)
Anvil: 3 slots (left item, right item, output)
Beacon: 1 slot (payment item)
Hopper: 5 slots (item transport)
Dispenser/Dropper: 9 slots
Shulker Box: 27 slots (portable)
      `);
    }
    break;
  }

  case 'find': {
    const term = arg.toLowerCase();
    const matchedItems = items.filter(i =>
      i.name.includes(term) || i.displayName.toLowerCase().includes(term)
    ).slice(0, 20);
    const matchedBlocks = blocks.filter(b =>
      b.name.includes(term) || b.displayName.toLowerCase().includes(term)
    ).slice(0, 20);
    if (matchedItems.length + matchedBlocks.length === 0) {
      console.log('No matches for "' + term + '"');
      break;
    }
    if (matchedItems.length) {
      console.log('Items (' + matchedItems.length + ' found, showing first 20):');
      matchedItems.forEach(i => console.log('  [' + i.id + '] ' + i.name + ' = ' + i.displayName));
    }
    if (matchedBlocks.length) {
      console.log('Blocks (' + matchedBlocks.length + ' found, showing first 20):');
      matchedBlocks.forEach(b => console.log('  [' + b.id + '] ' + b.name + ' = ' + b.displayName));
    }
    break;
  }
}
