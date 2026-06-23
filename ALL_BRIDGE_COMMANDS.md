# AutoBridge Commands Reference

## Player Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `move` | `{x: number, y: number, z: number}` | `{success: bool}` | Teleport player to absolute coordinates via movement packet (PlayerMoveC2SPacket$PositionAndOnGround) |
| `look` | `{yaw: number, pitch: number}` | `{success: bool}` | Set player look direction via packet. yaw: -180..180, pitch: -90..90 |
| `jump` | `{}` | `{success: bool}` | Make player jump once via `player.jump()` |
| `sprint` | `{state: bool}` | `{success: bool}` | Set sprinting on/off via `player.setSprinting()` |
| `sneak` | `{state: bool}` | `{success: bool}` | Set sneaking on/off via `player.setSneaking()` |

## Combat Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `attack` | `{}` | `{success: bool}` | Swing main hand (attack entity/block) via `player.swingHand()` |
| `use` | `{}` | `{success: bool}` | Use/interact with item in main hand via `interactionManager.interactItem()` |

## Chat Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `sendChat` | `{message: string}` | `{success: bool}` | Send a chat message via `player.sendChatMessage()` |

## World Query Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `getBlock` | `{x: number, y: number, z: number}` | `{success: bool, blockId: string, blockName: string}` | Get block translation key and display name at given position |
| `raycast` | `{maxDistance?: number}` | `{success: bool, hit: bool, x?: number, y?: number, z?: number, blockId?: string}` | Raycast from player view up to maxDistance (default 5.0). Returns `hit: false` if nothing hit |
| `getPosition` | `{}` | `{success: bool, x: number, y: number, z: number, yaw: number, pitch: number, onGround: bool, dimension: string}` | Get current player position, orientation, and dimension |
| `getTime` | `{}` | `{success: bool, time: number}` | Get world time of day via `world.getTimeOfDay()` |

## Inventory Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `getInventory` | `{}` | `{success: bool, slots: [{slot: int, itemId: string, count: int, name: string, slotType: string}]}` | Get entire inventory: main (0-35), armor (36-39, slotType "armor"), offhand (40, slotType "offhand") |
| `getItem` | `{slot: number}` | `{success: bool, slot: int, itemId: string|null, count: int, name: string}` | Get item at specific slot (0-40). Returns null itemId if slot is empty |
| `moveItem` | `{from: number, to: number}` | `{success: bool}` | Swap items between two inventory slots (0-40) |
| `scanContainer` | `{x: number, y: number, z: number}` | `{success: bool, containerType: string, slots: [{slot: int, itemId: string, count: int, name: string}]}` | Scan a block entity's inventory at given position. Errors if no block entity or not an inventory |

## Screen/GUI Commands

Commands under the `screen` prefix (send as `type: "screen.getSlots"`, etc.).

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `screen.getSlots` | `{}` | `{success: bool, title: string, slots: [{slot: int, itemId: string, count: int, name: string}]}` | Get all non-empty slots in the currently open screen handler. Errors if no screen is open |
| `screen.click` | `{slot: number, button?: number, actionType?: string}` | `{success: bool}` | Click a slot in the open screen. button defaults to 0. actionType defaults to "PICKUP". Uses `interactionManager.clickSlot()` |
| `screen.close` | `{}` | `{success: bool}` | Close the currently open screen via `player.closeScreen()` |

## Block Interaction Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `block.activate` | `{x: number, y: number, z: number}` | `{success: bool}` | Right-click/activate a block at position. Creates a BlockHitResult at center of block face and calls `interactionManager.interactBlock()` |

## Navigation Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `player.lookAt` | `{x: number, y: number, z: number}` | `{success: bool, yaw: number, pitch: number}` | Calculate and send look packet to face a target position. Uses `Math.atan2` for yaw/pitch calculation. Eye height accounted for via `player.getEyeHeight()` |
| `player.walkTo` | `{x: number, y: number, z: number}` | `{success: bool, message: string}` | Set an automatic walk target. Bridge handles movement: orients yaw toward target, jumps if on ground, presses forward key. Stops when within 1 block or target block below is air |

## System Commands

| Command | Payload | Result | Description |
|---------|---------|--------|-------------|
| `subscribe` | `{events: string[]}` | `{success: bool, subscribed: string[]}` | Subscribe current connection to specified event types. Events are broadcast to all subscribed connections |
| `reload` | `{}` | `{success: bool, message: string}` | Reload config from disk (`config/autobridge/config.json`) |
| `status` | `{}` | `{success: bool, running: bool, connections: int, uptime: int, config: {host, port, hasApiKey, rateLimit, logLevel}}` | Get bridge status, connection count, uptime in ms, and current config summary |
| `auth` | `{apiKey: string}` | `{success: bool}` | Authenticate the connection. Only accepted if `_config.apiKey` is set. 30-second auth timeout. Must be sent before any other command |

## Events

Events are broadcast as `{type: "event", data: {event: string, data: {...}}}` via the WebSocket. Subscribe to events using the `subscribe` command.

| Event | Data | Trigger |
|-------|------|---------|
| `position` | `{x: number, y: number, z: number, yaw: number, pitch: number, onGround: bool, dimension: string, walking: bool}` | When player position, orientation, onGround, or dimension changes. Throttled to 200ms interval |
| `health` | `{health: number, maxHealth: number, food: number, saturation: number}` | When health, food level, or saturation changes |
| `death` | `{message: string, source: string}` | When player health drops from >0 to <=0 |
| `chat` | `{message: string, sender: string, timestamp: int}` | When a chat message is received. Hooked via `globalThis.onChat`. Last 50 messages buffered internally |

## Protocol

**Request format:**
```json
{ "id": "any", "type": "command.name", "payload": { ... } }
```

**Success response:**
```json
{ "id": "any", "type": "command.name", "result": { "success": true, ... } }
```

**Error response:**
```json
{ "id": "any", "type": "error", "error": { "code": int, "message": string } }
```

### Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error — invalid JSON |
| `-32602` | Missing or empty `type` field |
| `-32601` | Method not found — unknown command type |
| `-32603` | Handler error — internal command execution error |
| `4001` | Not authenticated — API key required and not yet authed |
| `4002` | Invalid API key |
| `4003` | Auth timeout — 30 seconds exceeded |
| `429` | Rate limited — exceeded rate limit (configurable, default 50 commands/sec) |

### Auth Flow

1. Client connects to WebSocket
2. **If `_config.apiKey` is non-empty** (auth enabled):
   - Client must send `{type: "auth", payload: {apiKey: "..."}}` within 30 seconds
   - Receives `{type: "auth", result: {success: true}}` on success
   - Receives `{type: "error", error: {code: 4002, message: "Invalid API key"}}` on failure
   - Unauthenticated commands get `{code: 4001}` error
   - If auth not completed within 30s, gets `{code: 4003}` and connection is locked out
3. **If no API key configured** — all commands accepted immediately without auth
4. After auth, send any command as normal

### Command Queueing

Commands are queued and executed sequentially on the Minecraft client thread via `MinecraftClient.execute()`. Each command is run on the main thread with a 1-second slow-command warning logged if execution exceeds 1000ms. Responses are sent back after completion.
