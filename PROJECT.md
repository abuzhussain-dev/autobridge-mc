# AutoBridge — Minecraft AI Bridge

## Goal
Create a WebSocket bridge as a JsMacrosCE `.js` script (`autobridge.js`) for Fabric MC 1.21.11, allowing an external AI to connect and control the Minecraft player in real-time.

## Architecture
```
┌─────────────┐    WebSocket (JSON)    ┌──────────────────┐
│  External AI │ ◄────────────────────► │  autobridge.js   │
│  (Python/JS) │    localhost:8765      │  (JsMacrosCE)    │
└─────────────┘                         └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  Minecraft Client │
                                        │  (Fabric 1.21.11) │
                                        └──────────────────┘
```

## Protocol
JSON-RPC style: `{id, type, payload}` → `{id, type, result|error}`

### Player Commands
| type | payload | result |
|------|---------|--------|
| move | `{x, y, z}` | `{success: true}` |
| look | `{yaw, pitch}` | `{success: true}` |
| jump | `{}` | `{success: true}` |
| sprint | `{state: bool}` | `{success: true}` |
| sneak | `{state: bool}` | `{success: true}` |
| attack | `{}` | `{success: true}` |
| use | `{}` | `{success: true}` |
| sendChat | `{message}` | `{success: true}` |

### World Queries
| type | payload | result |
|------|---------|--------|
| getBlock | `{x, y, z}` | `{blockId, blockName}` |
| raycast | `{maxDistance}` | `{hit, x, y, z, blockId}` |
| getPosition | `{}` | `{x, y, z, yaw, pitch}` |

### Inventory Queries
| type | payload | result |
|------|---------|--------|
| getInventory | `{}` | `{slots: [{slot, itemId, count, name}]}` |
| getItem | `{slot}` | `{slot, itemId, count, name}` |
| moveItem | `{from, to}` | `{success: true}` |

### Server Events (pushed to client)
| event | trigger | data |
|-------|---------|------|
| position | on tick (20Hz) | `{x, y, z, yaw, pitch}` |
| health | on change | `{health, maxHealth, food, saturation}` |
| chat | on receive | `{message, sender, type}` |
| inventory | on slot change | `{slot, itemId, count}` |
| damage | on damage | `{source, amount}` |
| death | on death | `{}` |

## Tech Stack
- **Mod**: JsMacrosCE (Fabric 1.21.11) — no separate Fabric mod needed
- **Script**: Single `autobridge.js` file (JsMacrosCE JavaScript)
- **WS Server**: JsMacrosCE `WebSocket` API (or raw Java ServerSocket if unavailable)
- **Config**: `config.json` (port, auth, rate limits)

## Phased Build Plan

### Phase 0: Cleanup ✅ (DONE)
- Deleted `/root/autopotion/` (all old brewing scripts)
- Deleted `/root/autobridge/` (broken Fabric mod)
- Deleted `/root/autopotion.md` and `/root/ALL_INSTRUCTIONS.md`
- Will purge `abuzhussain-dev/autopotion-mc` repo
- Will repurpose `abuzhussain-dev/autobridge-mc` for JsMacrosCE scripts

### Phase 1: Core Bridge (NEXT — BUILDING)
**File:** `autobridge.js` (~400 lines)

**Features:**
- WebSocket server on localhost:8765
- JSON-RPC protocol handler
- Player movement commands (move, look, jump, sprint, sneak)
- Combat commands (attack, use)
- World queries (getBlock, raycast, getPosition)
- Inventory queries (getInventory, getItem, moveItem)
- Chat command
- Config loading from `config.json`

**JsMacrosCE APIs used:**
- `WebSocketServer` or Java `ServerSocket` → WebSocket upgrade
- `Player.move()` / `Player.lookAt()` for movement
- `World.getBlock()` for block queries
- `Player.getInventory()` for inventory
- `Client.getPlayer()`, `KeyBind.key()` for actions

### Phase 2: Event System
**File:** `autobridge.js` (+200 lines)

**Features:**
- Position stream (20Hz, throttled)
- Health/food/saturation change events
- Chat message forwarding
- Inventory slot change events
- Damage/death events
- Client-side subscribe/unsubscribe for events

**JsMacrosCE APIs used:**
- `JSEvent.onTick()` for position polling
- `JSEvent.onChat()` for chat forwarding
- `JSEvent.onInventoryChange()` for inventory events
- `World.getHealth()`, `World.getFood()` for health events

### Phase 3: Security & Polish
**File:** `autobridge.js` (+150 lines)

**Features:**
- API key authentication (first message must auth)
- Rate limiting (token bucket: 50 cmd/s, 100 events/s)
- Config file hot-reload
- Graceful shutdown on script unload
- Auto-reconnect helpers for clients
- Logging levels (DEBUG/INFO/WARN/ERROR)

### Phase 4: Documentation & Deployment
**Files:** README.md, config.json.example, examples/client.py, examples/client.js

**GitHub Repo:** `abuzhussain-dev/autobridge-mc`
```
autobridge.js
config.json.example
README.md
examples/
  client.py
  client.js
```

## Testing Strategy
| Method | How |
|--------|-----|
| Unit (no MC) | Mock Player/World, test handlers in Node.js |
| Integration (MC) | Load script in JsMacrosCE, connect via websocat or Python |
| Load test | 1000 rapid commands, verify rate limiting |

## Key Risks (from gap analysis)
| # | Risk | Probability | Impact | Mitigation | Fallback |
|---|------|-------------|--------|------------|----------|
| 1 | JsMacrosCE not truly async — single-threaded GraalVM JS blocks game loop | High | High | Offload WebSocket I/O to Java thread pool; never block in JS | Disable bridge on error; manual restart via chat command |
| 2 | WebSocket impl via Java interop — protocol complexity, no built-in WS API | High | High | Use `Java-WebSocket` library via `Java.type()`; avoid manual frame parsing | Fallback to HTTP long-polling |
| 3 | World scan freezes game (>50ms tick budget) | High | High | Chunked async scheduler: process N blocks/tick via `Client.waitTick()` yield; limit to loaded chunks | Degrade scan radius 16→8 blocks; return partial with `incomplete: true` |
| 4 | Script reload kills connections — no graceful shutdown, state loss | Medium | High | Register `onUnload` handler: close sockets, save state to file; reconnect protocol | Persist command queue; replay on reload |
| 5 | Localhost binding insufficient — attacker can connect, no TLS | Medium | High | Bind `127.0.0.1` only; API key + timestamp + HMAC per message; rate limit per command | Kill switch: `/autobridge stop` chat command |
| 6 | Fabric/MC version drift breaks interop | Medium | Medium | Pin Fabric version; use reflection for interop; CI test on each MC version | Document known-working versions |
| 7 | Anti-cheat detects programmatic movement — Watchdog bans | High (MP) | High | Human-like movement: bezier curves, random jitter, variable speed, look smoothing | Singleplayer mode only; document MP risk |
| 8 | Memory leaks in long-running script — listeners, buffers, command history | Medium | Medium | WeakRef caches; periodic cleanup every 1000 ticks; max history size | Auto-restart script daily |
| 9 | Uncaught exception crashes entire script | Medium | High | Global `try/catch` on all entry points; `Script.onError` handler; structured logging | Watchdog script that restarts on crash |
| 10 | Modded blocks/items not in registry | Low | Medium | Use registry names; fallback to `block.id` + `block.properties` | Return `unknown` type; AI handles gracefully |

## Missing Pieces (from gap analysis)
| # | Gap | Solution |
|---|-----|----------|
| 1 | Auto-start on MC launch | Place in `.minecraft/config/jsmacros/auto/` — JsMacrosCE auto-runs scripts there |
| 2 | Port discovery | Config file: `.minecraft/config/autobridge/config.json` → `{port: 8765, host: "127.0.0.1"}` |
| 3 | Mid-command disconnect | Command queue with IDs; idempotency keys for safe commands; require ACK + replay on reconnect |
| 4 | Concurrent commands | Single-threaded = natural FIFO queue; max 50 pending; reject with 429 if full |
| 5 | Long-running commands | Async pattern: `{status: "started"}` → periodic `progress` events → final `success`/`failed` |
| 6 | Response format & timeout | JSON-RPC 2.0 format; default 30s timeout per command |
| 7 | Modded Minecraft support | Registry-based lookups; config `modSupport: true` for `Registries.BLOCK.get(id)` |

## Architecture Recommendation (from gap analysis)
Use single `autobridge.js` with internal modular structure:
```
core/
├── websocket        # WebSocket server (Java-WebSocket wrapper)
├── command-handler  # Queue, routing, timeout, ACK
├── event-bus        # Pub/sub for position, health, chat
├── scheduler        # Tick-yielding task queue (spread work)
└── security         # API key, HMAC, rate limiting
commands/
├── movement         # move, look, jump, sneak, sprint
├── world            # getBlock, raycast
├── inventory        # get/set/swap
└── chat             # send, listen
```
Communication via shared state (`globalThis.bridge = {...}`) + event bus.
All Java interop via `Java.type()` at runtime.

## Merged File Structure
```
autobridge.js             # Single merged file (~899 lines)
├── Java imports          # ServerSocket, Client, Files, etc.
├── WebSocket server      # Manual WS handshake, frame encode/decode, ping/pong
│   ├── handleConnection  # Per-connection thread: handshake → frame loop
│   ├── add/remove        # Connection pool management (max 10)
│   └── API               # start, stop, broadcast, send, onMessage, onDisconnect
├── Command handlers      # 15 handlers registered via __bridge.commands
│   ├── movement          # move, look, jump, sprint, sneak
│   ├── combat            # attack, use
│   ├── world             # getBlock, raycast, getPosition, getTime
│   ├── inventory         # getInventory, getItem, moveItem
│   └── chat              # sendChat
└── Lifecycle             # Config, auth, rate limit, message routing, shutdown hook
    ├── loadConfig        # Reads config/autobridge/config.json
    ├── _handleMessage    # JSON-RPC parser with auth check + rate limiter
    ├── startBridge       # Binds WS + routes messages to handlers
    └── stopBridge        # Graceful shutdown on unload
```

## Current Status
Last updated: 2026-06-22

- [x] Phase 0: Cleanup (local files deleted)
- [x] Phase 1: Core WebSocket bridge (merged + pushed to GitHub)
- [x] Phase 2: Event system (position/health/death events, subscribe command, simulator 39/39 tests PASS)
- [ ] Phase 3: Security & polish (API key auth, rate limiting already in Phase 1)
- [ ] Phase 4: Documentation & deployment
