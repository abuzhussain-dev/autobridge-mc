# AutoBridge Command Reference

**File:** `autobridge.js` — 3,387 lines, 1,546+ commands
**Runtime:** JsMacrosCE (Minecraft 1.21.11 Fabric)
**Protocol:** WebSocket JSON (127.0.0.1:8765)
**Auth:** API key (optional, via config)

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  External AI │ ◄──────────────► │  autobridge.js    │
│  (Python/JS) │    JSON msgs     │  (JsMacrosCE)     │
└─────────────┘                   └──────────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │  cmdQueue    │
                                    │  mc.execute()│
                                    └──────┬──────┘
                                           │
                                    ┌──────┴──────┐
                                    │  Minecraft   │
                                    │  Client API  │
                                    └─────────────┘
```

- **Config:** `config/autobridge/config.json` (auto-created)
- **Auth:** API key validation with 30s timeout
- **Rate limiting:** Token bucket (configurable msg/s)
- **Events:** position/health/death/chat (broadcast to all clients)
- **Threading:** cmdQueue with mc.execute() main-thread dispatch

## Quick Start

```json
// Request format
{ "type": "player.health", "id": 1, "payload": {} }
// Response format
{ "id": 1, "type": "player.health", "result": { "success": true, "health": 20.0, ... } }
// Error format
{ "id": 1, "type": "error", "error": { "code": -32601, "message": "Method not found: xxx" } }
// Event format (server push)
{ "type": "event", "event": "position", "data": { "x": 0, "y": 64, "z": 0, ... } }
```

---

## 1. Original Handlers (24)

| Command | Description | Payload | Returns |
|---------|-------------|---------|---------|
| `move` | Move player to position | `{x, y, z}` | Success |
| `look` | Set yaw/pitch | `{yaw, pitch}` | Success |
| `jump` | Make player jump | `{}` | Success |
| `sprint` | Set sprint state | `{state: bool}` | Sprinting state |
| `sneak` | Set sneak state | `{state: bool}` | Sneaking state |
| `attack` | Swing main hand | `{}` | Success |
| `use` | Interact with held item | `{}` | Success |
| `sendChat` | Send chat message | `{message: string}` | Success |
| `getBlock` | Get block at position | `{x, y, z}` | Block data |
| `raycast` | Raycast from player | `{maxDistance}` | Hit result |
| `getPosition` | Get player position | `{}` | Position data |
| `getTime` | Get world time | `{}` | Time data |
| `getInventory` | Get full inventory | `{}` | Items list |
| `getItem` | Get specific slot | `{slot: num}` | Item data |
| `moveItem` | Move item between slots | `{from, to}` | Success |
| `scanContainer` | Scan container at pos | `{x, y, z}` | Container contents |
| `screen.*` | Screen operations | varies | Screen data |
| `player.lookAt` | Look at coordinate | `{x, y, z}` | Yaw/pitch |
| `player.walkTo` | Walk to coordinate | `{x, y, z}` | Walking status |
| `subscribe` | Subscribe to events | `{event: string}` | Subscription status |
| `reload` | Reload bridge config | `{}` | Success |
| `status` | Get bridge status | `{}` | Status object |
| `auth` | Authenticate | `{apiKey: string}` | Auth result |
| `selectSlot` | Select hotbar slot | `{slot: 0-8}` | Selected slot |
| `wait` | Wait for N ms | `{ms: number}` | Success |

---

## 2. Perception — perceive.*

### perceive.blocks.* — Find blocks by type in radius

| Command | Description |
|---------|-------------|
| `perceive.blocks.all` | Find all blocks |
| `perceive.blocks.chest` | Find chests |
| `perceive.blocks.barrel` | Find barrels |
| `perceive.blocks.brewing_stand` | Find brewing stands |
| `perceive.blocks.furnace` | Find furnaces |
| `perceive.blocks.crafting_table` | Find crafting tables |
| `perceive.blocks.anvil` | Find anvils |
| `perceive.blocks.enchanting_table` | Find enchanting tables |
| `perceive.blocks.hopper` | Find hoppers |
| `perceive.blocks.dispenser` | Find dispensers |
| `perceive.blocks.dropper` | Find droppers |
| `perceive.blocks.shulker_box` | Find shulker boxes |
| `perceive.blocks.beacon` | Find beacons |
| `perceive.blocks.campfire` | Find campfires |
| `perceive.blocks.smoker` | Find smokers |
| `perceive.blocks.blast_furnace` | Find blast furnaces |
| `perceive.blocks.stonecutter` | Find stonecutters |
| `perceive.blocks.grindstone` | Find grindstones |
| `perceive.blocks.loom` | Find looms |
| `perceive.blocks.cartography_table` | Find cartography tables |
| `perceive.blocks.smithing_table` | Find smithing tables |
| `perceive.blocks.door` | Find doors |
| `perceive.blocks.trapdoor` | Find trapdoors |
| `perceive.blocks.gate` | Find fence gates |
| `perceive.blocks.lever` | Find levers |
| `perceive.blocks.button` | Find buttons |
| `perceive.blocks.pressure_plate` | Find pressure plates |
| `perceive.blocks.ore` | Find ores |
| `perceive.blocks.wood` | Find logs |
| `perceive.blocks.plant` | Find plants |
| `perceive.blocks.water` | Find water |
| `perceive.blocks.lava` | Find lava |
| `perceive.blocks.bed` | Find beds |
| `perceive.blocks.workbench` | Find workbenches |
| `perceive.blocks.crops` | Find crops |
| `perceive.blocks.nether_wart` | Find nether wart |
| `perceive.blocks.rail` | Find rails |
| `perceive.blocks.torch` | Find torches |
| `perceive.blocks.ladder` | Find ladders |
| `perceive.blocks.sapling` | Find saplings |
| `perceive.blocks.flower` | Find flowers |
| `perceive.blocks.tall_grass` | Find tall grass |
| `perceive.blocks.vine` | Find vines |
| `perceive.blocks.mushroom` | Find mushrooms |
| `perceive.blocks.cactus` | Find cacti |
| `perceive.blocks.sugar_cane` | Find sugar cane |
| `perceive.blocks.bamboo` | Find bamboo |
| `perceive.blocks.cocoa` | Find cocoa |
| `perceive.blocks.pumpkin` | Find pumpkins |
| `perceive.blocks.melon` | Find melons |
| `perceive.blocks.moss` | Find moss |
| `perceive.blocks.amethyst` | Find amethyst |
| `perceive.blocks.sculk` | Find sculk |
| `perceive.blocks.spawner` | Find spawners |
| `perceive.blocks.portal` | Find portals |
| `perceive.blocks.candle` | Find candles |
| `perceive.blocks.chain` | Find chains |
| `perceive.blocks.lantern` | Find lanterns |

**Payload:** `{radius: 16, max: 50}`

### perceive.entity.* — Find entities by type

| Command | Description |
|---------|-------------|
| `perceive.entity.all` | Find all entities |
| `perceive.entity.player` | Find players |
| `perceive.entity.mob_hostile` | Find hostile mobs |
| `perceive.entity.mob_passive` | Find passive mobs |
| `perceive.entity.villager` | Find villagers |
| `perceive.entity.animal` | Find animals |
| `perceive.entity.monster` | Find monsters |
| `perceive.entity.item_drop` | Find item drops |
| `perceive.entity.nearest` | Find nearest entity |

---

## 3. World Queries — world.*

| Command | Description |
|---------|-------------|
| `world.biome` | Current biome |
| `world.light` | Light level at position |
| `world.difficulty` | World difficulty |
| `world.weather` | Weather state |
| `world.time` | Time of day / game time |
| `world.dimension` | Current dimension |
| `world.spawn` | World spawn point |
| `world.height` | World height limits |
| `world.seed` | World seed |
| `world.moonPhase` | Moon phase |
| `world.slimeChunk` | Is current chunk slime chunk? |
| `world.structure` | List available structures |
| `world.entityCount` | Total entity count |
| `world.fullBright` | Is fullbright enabled? |
| `world.hardcore` | Is hardcore mode? |
| `world.block` | Single block query at position |

---

## 4. Player State — player.*

| Command | Description |
|---------|-------------|
| `player.effects` | Active status effects |
| `player.xp` | Experience level/progress |
| `player.health` | Health/food/saturation |
| `player.selectedSlot` | Selected hotbar slot |
| `player.gamemode` | Current gamemode |
| `player.abilities` | Player abilities |
| `player.score` | Player score |
| `player.sleepTimer` | Sleep timer |
| `player.hunger` | Hunger details (food/saturation/exhaustion) |
| `player.oxygen` | Air supply |
| `player.armor` | Armor value |
| `player.velocity` | Player velocity |
| `player.frozenTicks` | Frozen ticks |
| `player.fireTicks` | Fire ticks |
| `player.fallDistance` | Fall distance |
| `player.absorption` | Absorption health |
| `player.mainHand` | Main hand item |
| `player.offHand` | Off hand item |
| `player.yaw` | Player yaw |
| `player.pitch` | Player pitch |
| `player.pos` | Player position (x,y,z) |
| `player.blockPos` | Player block position |
| `player.headYaw` | Head yaw |
| `player.bodyYaw` | Body yaw |
| `player.isInWater` | In water check |
| `player.isInLava` | In lava check |
| `player.isOnGround` | On ground check |
| `player.isSneaking` | Sneaking state |
| `player.isSprinting` | Sprinting state |
| `player.isFlying` | Flying state |
| `player.isSleeping` | Sleeping state |
| `player.isWet` | Wet state |
| `player.isRiding` | Riding state |
| `player.statusEffects` | Detailed status effects |

---

## 5. Item Details — item.*

| Command | Description |
|---------|-------------|
| `item.info` | Basic item info (id, count, name) |
| `item.nbt` | Item NBT data |
| `item.durability` | Item durability |
| `item.enchantments` | Item enchantments |
| `item.components` | Item components |
| `item.food` | Food properties |
| `item.potion` | Potion effects |
| `item.full` | All item data |
| **Payload:** `{slot: <number>}` | |

---

## 6. Inventory — inv.*

| Command | Description |
|---------|-------------|
| `inv.slot.{0-40}.get` | Get inventory slot contents |
| `inv.slot.{0-40}.set` | Set inventory slot |
| `inv.hotbar.{0-8}.get` | Get hotbar slot |
| `inv.hotbar.{0-8}.set` | Set hotbar slot |
| `inv.armor.{0-3}.get` | Get armor slot |
| `inv.search` | Search inventory for item |
| `inv.count` | Count total of item |
| `inv.isEmpty` | Check if inventory empty |
| `inv.firstSlot` | Find first slot with item |
| `inv.hotbar` | Get all hotbar slots |
| `inv.armor` | Get all armor slots |
| `inv.offhand` | Get offhand item |
| `inv.clear` | Clear entire inventory |

**Payload:** `{slot: <number>}` or `{itemName: "<filter>"}`

---

## 7. Screen/GUI — screen.*

| Command | Description |
|---------|-------------|
| `screen.getSlots` | Get all screen slots |
| `screen.getCursor` | Get cursor stack |
| `screen.close` | Close screen |
| `screen.title` | Send title text |
| `screen.actionBar` | Send action bar text |
| `screen.slot.{0-53}.get` | Get screen slot contents |

### screen.click.*.slot.{0-53} (324 commands)

| Action Type | Description | Button |
|-------------|-------------|--------|
| `screen.click.PICKUP.slot.{0-53}` | Pickup/place item | 0 |
| `screen.click.QUICK_MOVE.slot.{0-53}` | Shift-click | 0 |
| `screen.click.SWAP.slot.{0-53}` | Swap items | 0 |
| `screen.click.THROW.slot.{0-53}` | Throw item | 0 |
| `screen.click.CLONE.slot.{0-53}` | Clone stack (creative) | 0 |
| `screen.click.QUICK_CRAFT.slot.{0-53}` | Quick craft | 0 |

---

## 8. Player Actions — act.*

| Command | Description | Payload |
|---------|-------------|---------|
| `act.jump` | Jump | `{}` |
| `act.sprint` | Toggle sprint | `{state: bool}` |
| `act.sneak` | Toggle sneak | `{state: bool}` |
| `act.stop` | Stop all movement | `{}` |
| `act.forward` | Press forward key | `{state: bool}` |
| `act.backward` | Press backward key | `{state: bool}` |
| `act.strafeLeft` | Press left key | `{state: bool}` |
| `act.strafeRight` | Press right key | `{state: bool}` |
| `act.look` | Set camera angle | `{yaw, pitch}` |
| `act.lookAt` | Look at coordinate | `{x, y, z}` |
| `act.move` | Teleport (packet) | `{x, y, z}` |
| `act.attack` | Swing hand | `{}` |
| `act.use` | Use held item | `{}` |
| `act.drop` | Drop item | `{slot: num}` |
| `act.selectSlot.{0-8}` | Select hotbar slot | (none) |
| `act.swapHands` | Swap main/offhand | `{}` |
| `act.fly` | Toggle flight | `{state: bool}` |
| `act.swimUp` | Swim upward | `{}` |

---

## 9. Block Interaction — block.*

| Command | Description | Payload |
|---------|-------------|---------|
| `block.activate` | Right-click block | `{x, y, z, face}` |
| `block.break` | Break block | `{x, y, z}` |
| `block.mine` | Start mining | `{x, y, z, direction}` |
| `block.place` | Place block | `{x, y, z, face}` |
| `block.attack` | Attack block | `{x, y, z, direction}` |

---

## 10. Navigation — nav.*

| Command | Description | Payload |
|---------|-------------|---------|
| `nav.walkTo` | Walk to coordinate | `{x, y, z}` |
| `nav.walkStatus` | Walking status | `{}` |
| `nav.cancelWalk` | Cancel walking | `{}` |
| `nav.teleport` | Teleport player | `{x, y, z}` |
| `nav.walkToBlock` | Walk to block | `{x, y, z}` |
| `nav.jump` | Jump action | `{}` |
| `nav.climb` | Climb ladder | `{state: bool}` |
| `nav.swim` | Swim forward | `{state: bool}` |

---

## 11. Chat — chat.*

| Command | Description | Payload |
|---------|-------------|---------|
| `chat.send` | Send chat message | `{message: string}` |
| `chat.command` | Execute command | `{command: string}` |
| `chat.history` | Get chat history | `{limit: 20}` |
| `chat.whisper` | Whisper to player | `{message: string}` |
| `chat.say` | Say message | `{message: string}` |
| `chat.tell` | Tell player | `{message: string}` |
| `chat.teamMsg` | Team message | `{message: string}` |
| `chat.clear` | Clear chat history | `{}` |

---

## 12. Container Operations — container.*

| Command | Description | Payload |
|---------|-------------|---------|
| `container.scan` | Scan container | `{x, y, z}` |
| `container.search` | Search container | `{x, y, z, itemName}` |
| `container.count` | Count items in container | `{x, y, z, itemName}` |
| `container.brewingInfo` | Brewing stand status | `{x, y, z}` |
| `container.furnaceInfo` | Furnace status | `{x, y, z}` |

---

## 13. Event Operations — event.*

| Command | Description | Payload |
|---------|-------------|---------|
| `event.subscribe` | Subscribe to event | `{event: "position"}` |
| `event.unsubscribe` | Unsubscribe from event | `{event: "position"}` |
| `event.list` | List subscriptions | `{}` |
| `event.broadcast` | Broadcast custom event | `{event: "custom", data: {}}` |

**Built-in event broadcasts (always active):**
- `position` — Player position changes (200ms throttle)
- `health` — Health/food changes
- `death` — Player death
- `chat` — Incoming chat messages

---

## 14. Utility — Math

| Command | Description |
|---------|-------------|
| `util.math.add` | a + b |
| `util.math.sub` | a - b |
| `util.math.mul` | a * b |
| `util.math.div` | a / b |
| `util.math.floor` | Math.floor(a) |
| `util.math.ceil` | Math.ceil(a) |
| `util.math.round` | Math.round(a) |
| `util.math.abs` | Math.abs(a) |
| `util.math.min` | Math.min(a,b) |
| `util.math.max` | Math.max(a,b) |
| `util.math.sqrt` | Math.sqrt(a) |
| `util.math.pow` | Math.pow(a,b) |
| `util.math.clamp` | Clamp a between min/max |
| `util.math.random` | Math.random() |
| `util.math.randomInt` | Random int in range |
| `util.math.sum` | Sum of array |
| `util.math.avg` | Average of array |
| `util.math.median` | Median of array |
| `util.math.mod` | a % b |
| `util.math.dist` | sqrt(a² + b²) |
| `util.math.dist3d` | 3D distance |
| `util.math.toRad` | Degrees to radians |
| `util.math.toDeg` | Radians to degrees |
| `util.math.sin` | Math.sin(a) |
| `util.math.cos` | Math.cos(a) |
| `util.math.tan` | Math.tan(a) |
| `util.math.atan2` | Math.atan2(a,b) |
| `util.math.log` | Math.log(a) |
| `util.math.exp` | Math.exp(a) |
| `util.math.sign` | Sign of a |
| `util.math.lerp` | Linear interpolation |
| `util.math.normalize` | Normalize to range |
| `util.math.pi` | Math.PI |
| `util.math.e` | Math.E |
| `util.math.radians` | Degrees to radians |
| `util.math.degrees` | Radians to degrees |

---

## 15. Utility — String

| Command | Description |
|---------|-------------|
| `util.string.length` | String length |
| `util.string.concat` | Concatenate with other |
| `util.string.upper` | To uppercase |
| `util.string.lower` | To lowercase |
| `util.string.trim` | Trim whitespace |
| `util.string.replace` | Replace first match |
| `util.string.split` | Split by delimiter |
| `util.string.padStart` | Pad start |
| `util.string.padEnd` | Pad end |
| `util.string.repeat` | Repeat string |
| `util.string.replaceAll` | Replace all matches |
| `util.string.join` | Join array with separator |
| `util.string.indexOf` | Index of substring |
| `util.string.includes` | Check if includes |
| `util.string.startsWith` | Check prefix |
| `util.string.endsWith` | Check suffix |
| `util.string.substring` | Extract substring |
| `util.string.charAt` | Character at index |
| `util.string.charCodeAt` | Char code at index |
| `util.string.parseFloat` | Parse float |
| `util.string.parseInt` | Parse int |
| `util.string.format` | Format string |

---

## 16. Utility — JSON

| Command | Description |
|---------|-------------|
| `util.json.parse` | Parse JSON string |
| `util.json.stringify` | Stringify to JSON |
| `util.json.get` | Get value by path |
| `util.json.keys` | Get object keys |
| `util.json.values` | Get object values |
| `util.json.has` | Check if key exists |
| `util.json.merge` | Merge two objects |
| `util.json.type` | Get value type |

---

## 17. Utility — Array

| Command | Description |
|---------|-------------|
| `util.array.length` | Array length |
| `util.array.get` | Get by index |
| `util.array.first` | First element |
| `util.array.last` | Last element |
| `util.array.slice` | Slice array |
| `util.array.filter` | Filter by key/value |
| `util.array.push` | Push element |
| `util.array.pop` | Pop element |
| `util.array.shift` | Shift element |
| `util.array.unshift` | Unshift element |
| `util.array.includes` | Check if includes |
| `util.array.indexOf` | Index of element |
| `util.array.join` | Join with separator |
| `util.array.concat` | Concatenate arrays |
| `util.array.sort` | Sort array |
| `util.array.reverse` | Reverse array |
| `util.array.every` | Every element matches |
| `util.array.some` | Some element matches |

---

## 18. Utility — Random

| Command | Description |
|---------|-------------|
| `util.random.int` | Random integer in range |
| `util.random.float` | Random float 0-1 |
| `util.random.boolean` | Random boolean |
| `util.random.uuid` | Generate UUID |
| `util.random.string` | Random string |
| `util.random.shuffle` | Shuffle array |
| `util.random.choice` | Random element |

---

## 19. Utility — Time / Compare / Base64

| Command | Description |
|---------|-------------|
| `util.time.now` | Current ISO timestamp |
| `util.time.ms` | Current epoch ms |
| `util.time.format` | Format date |
| `util.time.sleep` | Blocking sleep (ms) |
| `util.base64.encode` | Base64 encode |
| `util.base64.decode` | Base64 decode |
| `util.compare.eq` | a == b |
| `util.compare.neq` | a != b |
| `util.compare.gt` | a > b |
| `util.compare.gte` | a >= b |
| `util.compare.lt` | a < b |
| `util.compare.lte` | a <= b |
| `util.type` | Get type of value |
| `util.clone` | Deep clone value |

---

## Usage Examples

### Python Client
```python
import websocket, json

ws = websocket.create_connection("ws://127.0.0.1:8765")

# Auth (if configured)
ws.send(json.dumps({"type": "auth", "id": 1, "payload": {"apiKey": "your-key"}}))
resp = json.loads(ws.recv())

# Get player health
ws.send(json.dumps({"type": "player.health", "id": 2, "payload": {}}))
resp = json.loads(ws.recv())
print(resp["result"]["health"])  # 20.0

# Walk to coordinates
ws.send(json.dumps({"type": "nav.walkTo", "id": 3, "payload": {"x": 100, "y": 64, "z": 200}}))
resp = json.loads(ws.recv())

# Read container
ws.send(json.dumps({"type": "container.scan", "id": 4, "payload": {"x": 10, "y": 64, "z": 20}}))
```

### JavaScript (Node.js)
```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8765');

ws.on('open', () => {
  ws.send(JSON.stringify({type: 'player.health', id: 1, payload: {}}));
});
ws.on('message', (data) => {
  console.log(JSON.parse(data.toString()));
});
```

### Event Listener Pattern
```python
ws = websocket.create_connection("ws://127.0.0.1:8765")

# Subscribe to position events
ws.send(json.dumps({"type": "event.subscribe", "id": 1, "payload": {"event": "position"}}))

# Receive events automatically
while True:
    msg = json.loads(ws.recv())
    if msg.get("type") == "event":
        print(f"Event: {msg['event']} -> {msg['data']}")
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| 4001 | Not authenticated |
| 4002 | Invalid API key |
| 4003 | Auth timeout |
| 429 | Rate limited |

## Config (`config/autobridge/config.json`)

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "apiKey": "",
  "rateLimit": 50,
  "logLevel": "INFO"
}
```
