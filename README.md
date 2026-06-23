# AutoBridge — Minecraft AI Bridge

Connect external AI agents to Minecraft via WebSocket using JsMacrosCE.

## Quick Start

1. Install JsMacrosCE (Fabric 1.21.11)
2. Copy `autobridge.js` to `.minecraft/config/jsmacros/scripts/`
3. Start Minecraft — script auto-loads
4. Connect with Python client:

```python
python3 examples/client.py
```

## Features

- **15 commands**: move, look, jump, sprint, sneak, attack, use, sendChat, getBlock, raycast, getPosition, getInventory, getItem, moveItem, getTime
- **Events**: position (20Hz throttled to 5Hz), health/food/saturation changes, death detection
- **Security**: API key auth, rate limiting, localhost-only binding
- **Subscribe**: opt-in per-connection event filtering

## Protocol

JSON-RPC style over WebSocket at `ws://127.0.0.1:8765`

### Request
```json
{"id": 1, "type": "move", "payload": {"x": 100, "y": 64, "z": 200}}
```

### Response
```json
{"id": 1, "type": "move", "result": {"success": true}}
```

### Event
```json
{"type": "event", "event": "health", "data": {"health": 18, "maxHealth": 20, "food": 20, "saturation": 5}}
```

### Authentication
```json
{"id": 1, "type": "auth", "payload": {"apiKey": "your-key-here"}}
```

## Command Reference

| type | payload | description |
|------|---------|-------------|
| move | {x, y, z} | Teleport player to position |
| look | {yaw, pitch} | Set camera direction |
| jump | {} | Make player jump |
| sprint | {state: bool} | Toggle sprinting |
| sneak | {state: bool} | Toggle sneaking |
| attack | {} | Swing main hand |
| use | {} | Interact with item |
| sendChat | {message} | Send chat message |
| getBlock | {x, y, z} | Get block at position |
| raycast | {maxDistance} | Raycast from player eyes |
| getPosition | {} | Get current player position |
| getInventory | {} | List all inventory items |
| getItem | {slot} | Get item in specific slot (0-40) |
| moveItem | {from, to} | Swap items between slots |
| getTime | {} | Get world time |
| subscribe | {events: []} | Subscribe to events |

## Events

| event | trigger | data |
|-------|---------|------|
| position | 5Hz throttled tick | {x, y, z, yaw, pitch, onGround, dimension} |
| health | on change | {health, maxHealth, food, saturation} |
| death | on death | {} |

## Configuration

Edit `config/autobridge/config.json` (auto-created on first run):

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "apiKey": "",
  "rateLimit": 50,
  "logLevel": "INFO"
}
```

## Architecture

autobridge.js is a single-file JsMacrosCE script containing:
- Raw WebSocket server (java.net.ServerSocket, no dependencies)
- 15 command handlers using Fabric MC client APIs
- Auth + rate limiting lifecycle
- Position/health/death event broadcaster

## Testing

```bash
node tests/simulator.js    # 39 mock MC tests (no Minecraft needed)
```

## Repo

https://github.com/abuzhussain-dev/autobridge-mc
