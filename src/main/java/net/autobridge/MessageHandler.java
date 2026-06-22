package net.autobridge;

import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;
import org.java_websocket.WebSocket;

public class MessageHandler {
    private final BridgeWebSocketServer server;

    public MessageHandler(BridgeWebSocketServer server) {
        this.server = server;
    }

    public void handle(WebSocket conn, JsonObject message) {
        String type = message.has("type") ? message.get("type").getAsString() : "";
        String id = message.has("id") ? message.get("id").getAsString() : "";

        MinecraftServer mcServer = server.getServer();
        if (mcServer == null) {
            sendError(conn, id, "server_not_ready");
            return;
        }

        mcServer.execute(() -> {
            try {
                JsonObject response = dispatch(type, message, conn);
                if (response == null) {
                    response = new JsonObject();
                    response.addProperty("ok", false);
                    response.addProperty("error", "unknown_type");
                }
                if (!id.isEmpty()) response.addProperty("id", id);
                conn.send(response.toString());
            } catch (Exception e) {
                sendError(conn, id, e.getMessage());
            }
        });
    }

    private JsonObject dispatch(String type, JsonObject msg, WebSocket conn) {
        if (type.startsWith("player.")) return handlePlayer(type, msg);
        if (type.startsWith("world.")) return handleWorld(type, msg);
        if (type.startsWith("inventory.")) return handleInventory(type, msg);
        if (type.startsWith("system.")) return handleSystem(type, msg, conn);
        if (type.startsWith("event.")) return handleEvent(type, msg, conn);
        return null;
    }

    private JsonObject handlePlayer(String type, JsonObject msg) {
        var mc = server.getServer();
        var players = mc.getPlayerList().getPlayers();
        if (players.isEmpty()) return error("no_players_online");
        var controller = new PlayerController(players.getFirst());
        return switch (type) {
            case "player.move_to" -> {
                boolean ok = controller.moveTo(
                    msg.get("x").getAsDouble(),
                    msg.get("y").getAsDouble(),
                    msg.get("z").getAsDouble());
                yield ok ? ok("moved") : error("move_failed");
            }
            case "player.look_at" -> {
                controller.lookAt(
                    msg.get("x").getAsDouble(),
                    msg.get("y").getAsDouble(),
                    msg.get("z").getAsDouble());
                yield ok("looked");
            }
            case "player.send_message" -> {
                controller.sendMessage(msg.get("text").getAsString());
                yield ok("sent");
            }
            case "player.attack" -> { controller.attack(); yield ok("attacked"); }
            case "player.use_item" -> { controller.useItem(); yield ok("item_used"); }
            case "player.jump" -> { controller.jump(); yield ok("jumped"); }
            case "player.sneak" -> {
                controller.sneak(msg.get("sneaking").getAsBoolean());
                yield ok("sneak_toggled");
            }
            case "player.sprint" -> {
                controller.sprint(msg.get("sprinting").getAsBoolean());
                yield ok("sprint_toggled");
            }
            case "player.swing_hand" -> { controller.swingHand(); yield ok("swung"); }
            case "player.drop_item" -> {
                boolean full = msg.has("entire_stack") && msg.get("entire_stack").getAsBoolean();
                controller.dropItem(full);
                yield ok("dropped");
            }
            case "player.get_position" -> {
                var r = ok("position");
                r.add("position", controller.getPosition());
                yield r;
            }
            case "player.get_stats" -> {
                var r = ok("stats");
                r.addProperty("health", controller.getHealth());
                r.addProperty("hunger", controller.getHunger());
                yield r;
            }
            default -> null;
        };
    }

    private JsonObject handleWorld(String type, JsonObject msg) {
        var mc = server.getServer();
        var querier = new WorldQuerier(mc);
        return switch (type) {
            case "world.get_block" -> {
                var r = ok("block");
                r.add("block", querier.getBlock(
                    msg.get("x").getAsInt(),
                    msg.get("y").getAsInt(),
                    msg.get("z").getAsInt()));
                yield r;
            }
            case "world.get_entities" -> {
                var r = ok("entities");
                r.add("entities", querier.getEntities(msg.getAsJsonObject("options")));
                yield r;
            }
            case "world.get_time" -> {
                var r = ok("time");
                r.addProperty("time", querier.getTime());
                yield r;
            }
            case "world.get_weather" -> {
                var r = ok("weather");
                r.addProperty("weather", querier.getWeather());
                yield r;
            }
            case "world.find_blocks" -> {
                var r = ok("blocks");
                r.add("blocks", querier.findBlocks(
                    msg.get("pattern").getAsString(),
                    msg.get("x").getAsInt(),
                    msg.get("y").getAsInt(),
                    msg.get("z").getAsInt(),
                    msg.get("radius").getAsInt()));
                yield r;
            }
            default -> null;
        };
    }

    private JsonObject handleInventory(String type, JsonObject msg) {
        var mc = server.getServer();
        var players = mc.getPlayerList().getPlayers();
        if (players.isEmpty()) return error("no_players_online");
        var helper = new InventoryHelper(players.getFirst());
        return switch (type) {
            case "inventory.get" -> {
                var r = ok("inventory");
                r.add("inventory", helper.getInventory());
                yield r;
            }
            case "inventory.get_container" -> {
                var r = ok("container");
                r.add("container", helper.getContainer(
                    msg.get("x").getAsInt(),
                    msg.get("y").getAsInt(),
                    msg.get("z").getAsInt()));
                yield r;
            }
            case "inventory.click_slot" -> {
                boolean ok = helper.clickSlot(msg.get("slot").getAsString(), msg.get("button").getAsInt());
                yield ok ? ok("clicked") : error("click_failed");
            }
            case "inventory.drop_slot" -> {
                boolean ok = helper.dropSlot(msg.get("slot").getAsString());
                yield ok ? ok("dropped") : error("drop_failed");
            }
            case "inventory.move_items" -> {
                boolean ok = helper.moveItems(
                    msg.get("from_slot").getAsString(),
                    msg.get("to_slot").getAsString(),
                    msg.get("count").getAsInt());
                yield ok ? ok("moved") : error("move_failed");
            }
            default -> null;
        };
    }

    private JsonObject handleSystem(String type, JsonObject msg, WebSocket conn) {
        return switch (type) {
            case "system.ping" -> {
                var r = ok("pong");
                r.addProperty("timestamp", System.currentTimeMillis());
                yield r;
            }
            case "system.status" -> {
                var r = ok("status");
                r.addProperty("connections", server.getServer().getPlayerList().getPlayerCount());
                r.addProperty("uptime_ms", System.currentTimeMillis());
                r.addProperty("port", server.getConfig().getPort());
                yield r;
            }
            default -> null;
        };
    }

    private JsonObject handleEvent(String type, JsonObject msg, WebSocket conn) {
        return switch (type) {
            case "event.subscribe" -> {
                server.getEventEmitter().subscribe(conn, msg.get("events").getAsString());
                yield ok("subscribed");
            }
            case "event.unsubscribe" -> {
                server.getEventEmitter().unsubscribe(conn, msg.get("events").getAsString());
                yield ok("unsubscribed");
            }
            default -> null;
        };
    }

    private void sendError(WebSocket conn, String id, String errMsg) {
        JsonObject err = new JsonObject();
        err.addProperty("ok", false);
        err.addProperty("error", errMsg);
        if (!id.isEmpty()) err.addProperty("id", id);
        conn.send(err.toString());
    }

    private static JsonObject ok(String message) {
        JsonObject r = new JsonObject();
        r.addProperty("ok", true);
        r.addProperty("message", message);
        return r;
    }

    private static JsonObject error(String message) {
        JsonObject r = new JsonObject();
        r.addProperty("ok", false);
        r.addProperty("error", message);
        return r;
    }
}
