const mc = require('minecraft-data')('1.21.11');
const fs = require('fs');

function save(name, data) {
  fs.writeFileSync(name + '.json', JSON.stringify(data, null, 2));
  console.log('Wrote ' + name + '.json');
}

// === ITEMS ===
const items = mc.itemsArray.map(i => ({
  id: i.id, name: i.name, displayName: i.displayName, stackSize: i.stackSize
}));
save('items', items);

// === ITEMS BY NAME ===
save('itemsByName', items.reduce((a,i) => { a[i.name] = i; return a; }, {}));

// === BLOCKS ===
const blocks = mc.blocksArray.map(b => ({
  id: b.id, name: b.name, displayName: b.displayName,
  hardness: b.hardness, resistance: b.resistance, stackSize: b.stackSize,
  diggable: b.diggable, material: b.material,
  transparent: b.transparent, emitLight: b.emitLight, filterLight: b.filterLight,
  boundingBox: b.boundingBox, drops: b.drops
}));
save('blocks', blocks);

// === EFFECTS ===
const effects = mc.effectsArray.map(e => ({
  id: e.id, name: e.name, displayName: e.displayName, type: e.type
}));
save('effects', effects);

// === ENCHANTMENTS ===
const ench = mc.enchantmentsArray.map(e => ({
  id: e.id, name: e.name, displayName: e.displayName, maxLevel: e.maxLevel,
  category: e.category, treasureOnly: e.treasureOnly, curse: e.curse,
  exclude: e.exclude, weight: e.weight, tradeable: e.tradeable
}));
save('enchantments', ench);

// === WINDOWS ===
const windows = {};
mc.windowsArray.forEach(w => {
  windows[w.name] = {
    slots: w.slots ? w.slots.map(s => ({name: s.name || 'slot', index: s.index})) : []
  };
});
save('windows', windows);

// === FOODS ===
const foods = mc.foodsArray.map(f => ({
  id: f.id, name: f.name, displayName: f.displayName,
  foodPoints: f.foodPoints, saturation: f.saturation,
  effectiveQuality: f.effectiveQuality, saturationRatio: f.saturationRatio
}));
save('foods', foods);

// === RECIPES (crafting + smelting + others) ===
const recipes = {};
Object.keys(mc.recipes).forEach(k => {
  const arr = mc.recipes[k];
  if (!Array.isArray(arr)) return;
  const item = mc.items[k];
  const itemName = item ? item.name : 'unknown_' + k;
  recipes[itemName] = recipes[itemName] || [];
  arr.forEach(r => {
    const entry = { type: r.type || 'crafting' };
    if (r.inShape) entry.inShape = r.inShape;
    if (r.ingredients) entry.ingredients = r.ingredients;
    if (r.outShape) entry.outShape = r.outShape;
    if (r.count) entry.count = r.count;
    if (r.result) {
      const ri = mc.items[r.result.id];
      entry.result = { id: r.result.id, name: ri ? ri.name : 'unknown', count: r.result.count };
    }
    if (r.ingredient) {
      const ii = mc.items[r.ingredient.id];
      entry.ingredient = { id: r.ingredient.id, name: ii ? ii.name : 'unknown' };
    }
    recipes[itemName].push(entry);
  });
});
save('recipes', recipes);

// === POTION-RELATED ITEMS (full details) ===
const brewingIngredients = [
  'nether_wart', 'redstone', 'glowstone_dust', 'gunpowder', 'dragon_breath',
  'fermented_spider_eye', 'blaze_powder', 'ghast_tear', 'spider_eye',
  'sugar', 'rabbit_foot', 'magma_cream', 'glistering_melon_slice',
  'golden_carrot', 'pufferfish', 'turtle_helmet', 'phantom_membrane',
  'water_bottle'
];
const potionItems = ['potion', 'splash_potion', 'lingering_potion', 'water_bottle'];
const allPotionRelated = [...brewingIngredients, ...potionItems];
const potionData = {
  ingredients: {},
  potions: {},
};
allPotionRelated.forEach(name => {
  const item = mc.itemsByName[name];
  if (!item) {
    // water_bottle isn't a standard item name in minecraft-data
    if (name === 'water_bottle') {
      potionData.potions.water_bottle = {
        id: -1, name: 'water_bottle', displayName: 'Water Bottle', stackSize: 1
      };
    }
    return;
  }
  if (brewingIngredients.includes(name)) {
    potionData.ingredients[name] = {
      id: item.id, name: item.name, displayName: item.displayName, stackSize: item.stackSize
    };
  }
  if (potionItems.includes(name)) {
    potionData.potions[name] = {
      id: item.id, name: item.name, displayName: item.displayName, stackSize: item.stackSize
    };
  }
});
save('potion_data', potionData);

// === KNOWLEDGE GRAPH (AI-optimized) ===
const effectNames = {};
effects.forEach(e => { effectNames[e.name] = e.displayName; });

const kg = {
  version: '1.21.11',
  totalItems: items.length,
  totalBlocks: blocks.length,
  totalRecipes: Object.keys(recipes).length,
  brewingStand: {
    slotCount: 5,
    fuelSlot: 0,
    ingredientSlot: 4,
    potionSlots: [1, 2, 3]
  },
  brewingIngredients: {
    nether_wart: { type: 'base', effect: 'Awkward base potion', source: 'Nether Fortress' },
    redstone: { type: 'modifier', effect: 'Extends duration', maxLevel: 3 },
    glowstone_dust: { type: 'modifier', effect: 'Increases potency', maxLevel: 2 },
    gunpowder: { type: 'modifier', effect: 'Makes splash potion' },
    dragon_breath: { type: 'modifier', effect: 'Makes lingering potion' },
    fermented_spider_eye: { type: 'modifier', effect: 'Corrupts/Inverts potion effect' },
    blaze_powder: { type: 'fuel', effect: 'Brewing stand fuel' }
  },
  potionEffects: effects,
  potionBrewingTree: {
    base: { ingredient: 'nether_wart', result: 'awkward', from: 'water_bottle' },
    awkward_to_healing: { ingredient: 'glistering_melon_slice', result: 'healing', from: 'awkward' },
    awkward_to_fire_resistance: { ingredient: 'magma_cream', result: 'fire_resistance', from: 'awkward' },
    awkward_to_harming: { ingredient: 'fermented_spider_eye', result: 'harming', from: 'awkward' },
    awkward_to_leaping: { ingredient: 'rabbit_foot', result: 'leaping', from: 'awkward' },
    awkward_to_poison: { ingredient: 'spider_eye', result: 'poison', from: 'awkward' },
    awkward_to_regeneration: { ingredient: 'ghast_tear', result: 'regeneration', from: 'awkward' },
    awkward_to_slowness: { ingredient: 'fermented_spider_eye', result: 'slowness', from: 'awkward' },
    awkward_to_strength: { ingredient: 'blaze_powder', result: 'strength', from: 'awkward' },
    awkward_to_swiftness: { ingredient: 'sugar', result: 'swiftness', from: 'awkward' },
    awkward_to_turtle_master: { ingredient: 'turtle_helmet', result: 'turtle_master', from: 'awkward' },
    awkward_to_water_breathing: { ingredient: 'pufferfish', result: 'water_breathing', from: 'awkward' },
    awkward_to_slow_falling: { ingredient: 'phantom_membrane', result: 'slow_falling', from: 'awkward' },
    awkward_to_invisibility: { ingredient: 'fermented_spider_eye', result: 'invisibility', from: 'awkward' },
    healing_to_harming: { ingredient: 'fermented_spider_eye', result: 'harming_II', from: 'healing' },
    poison_to_harming: { ingredient: 'fermented_spider_eye', result: 'harming', from: 'poison' },
    leaping_to_slowness: { ingredient: 'fermented_spider_eye', result: 'slowness', from: 'leaping' },
    swiftness_to_slowness: { ingredient: 'fermented_spider_eye', result: 'slowness', from: 'swiftness' },
    night_vision_to_invisibility: { ingredient: 'fermented_spider_eye', result: 'invisibility', from: 'night_vision' },
    strength_to_weakness: { ingredient: 'fermented_spider_eye', result: 'weakness', from: 'strength' },
    regeneration_to_poison: { ingredient: 'fermented_spider_eye', result: 'poison', from: 'regeneration' },
    water_breathing_to_harming: { ingredient: 'fermented_spider_eye', result: 'harming', from: 'water_breathing' },
    turtle_master_to_slowness: { ingredient: 'fermented_spider_eye', result: 'slowness', from: 'turtle_master' },
    slow_falling_to_harming: { ingredient: 'fermented_spider_eye', result: 'harming', from: 'slow_falling' }
  },
  potionModifiers: {
    redstone_extended: { ingredient: 'redstone', effect: 'Extends duration', appliesTo: ['healing', 'fire_resistance', 'leaping', 'poison', 'regeneration', 'strength', 'swiftness', 'turtle_master', 'water_breathing', 'slow_falling', 'night_vision', 'invisibility', 'weakness'] },
    glowstone_upgraded: { ingredient: 'glowstone_dust', effect: 'Increases potency', appliesTo: ['healing', 'harming', 'leaping', 'poison', 'regeneration', 'strength', 'swiftness', 'turtle_master', 'slowness', 'weakness'] },
    gunpowder_splash: { ingredient: 'gunpowder', effect: 'Makes throwable splash potion', appliesTo: ['all'] },
    dragon_breath_lingering: { ingredient: 'dragon_breath', effect: 'Makes area-effect lingering potion', appliesTo: ['splash'] }
  },
  potionEffectsMap: {
    healing: { id: 6, name: 'instant_health', displayName: 'Instant Health' },
    fire_resistance: { id: 12, name: 'fire_resistance', displayName: 'Fire Resistance' },
    harming: { id: 7, name: 'instant_damage', displayName: 'Instant Damage' },
    leaping: { id: 9, name: 'jump_boost', displayName: 'Jump Boost' },
    poison: { id: 19, name: 'poison', displayName: 'Poison' },
    regeneration: { id: 10, name: 'regeneration', displayName: 'Regeneration' },
    slowness: { id: 2, name: 'slowness', displayName: 'Slowness' },
    strength: { id: 5, name: 'strength', displayName: 'Strength' },
    swiftness: { id: 1, name: 'speed', displayName: 'Speed' },
    turtle_master: { id: 25, name: 'slowness', displayName: 'Slowness IV + Resistance III' },
    water_breathing: { id: 13, name: 'water_breathing', displayName: 'Water Breathing' },
    slow_falling: { id: 28, name: 'slow_falling', displayName: 'Slow Falling' },
    invisibility: { id: 14, name: 'invisibility', displayName: 'Invisibility' },
    night_vision: { id: 16, name: 'night_vision', displayName: 'Night Vision' },
    weakness: { id: 18, name: 'weakness', displayName: 'Weakness' }
  },
  food: foods.map(f => ({ name: f.name, foodPoints: f.foodPoints, saturation: f.saturation })),
  containers: {
    chest: { type: 'single', slots: 27 },
    chest_double: { type: 'double', slots: 54 },
    barrel: { slots: 27 },
    furnace: { slots: 3, input: 0, fuel: 1, output: 2 },
    blast_furnace: { slots: 3, input: 0, fuel: 1, output: 2 },
    smoker: { slots: 3, input: 0, fuel: 1, output: 2 },
    brewing_stand: { slots: 5, fuel: 0, potionSlots: [1,2,3], ingredient: 4 },
    crafting_table: { slots: 10, grid: '3x3', output: 0 },
    enchanting_table: { slots: 3, target: 0, lapis: 1 },
    anvil: { slots: 3, left: 0, right: 1, output: 2 },
    beacon: { slots: 1, payment: 0 },
    hopper: { slots: 5 },
    dispenser: { slots: 9 },
    dropper: { slots: 9 },
    shulker_box: { slots: 27 }
  }
};
save('knowledge_graph', kg);

console.log('Done! All data extracted.');
