package net.autobridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.MinecraftServer;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class BridgeWebSocketServer extends WebSocketServer {
    private final BridgeRateLimiter rateLimiter;
    private final MessageHandler messageHandler;
    private final EventEmitter eventEmitter;
    private final PendingRequest pendingRequest;
    private final Map<WebSocket, String> authenticatedConnections = new ConcurrentHashMap<>();
    private volatile BridgeConfig config;
    private volatile MinecraftServer server;

    public BridgeWebSocketServer(BridgeConfig config) {
        super(new InetSocketAddress(config.getPort()));
        this.config = config;
        this.rateLimiter = new BridgeRateLimiter(config);
        this.eventEmitter = new EventEmitter();
        this.pendingRequest = new PendingRequest(config.getRequestTimeout());
        this.messageHandler = new MessageHandler(this);
        setReuseAddr(true);
    }

    public void setServer(MinecraftServer server) { this.server = server; }
    public MinecraftServer getServer() { return server; }
    public void setConfig(BridgeConfig config) { this.config = config; }
    public BridgeConfig getConfig() { return config; }
    public EventEmitter getEventEmitter() { return eventEmitter; }
    public PendingRequest getPendingRequest() { return pendingRequest; }
    public boolean isAuthenticated(WebSocket conn) { return authenticatedConnections.containsKey(conn); }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        if (authenticatedConnections.size() >= config.getMaxConnections()) {
            conn.close(4003, "Max connections reached");
            return;
        }
        String key = config.getApiKey();
        if (!key.isEmpty()) {
            String auth = handshake.hasFieldValue("Authorization") ? handshake.getFieldValue("Authorization") : "";
            if (!key.equals(auth)) {
                conn.close(4001, "Unauthorized");
                return;
            }
        }
        authenticatedConnections.put(conn, "");
        AutoBridgeMod.LOGGER.info("Client connected: {}", conn.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        authenticatedConnections.remove(conn);
        eventEmitter.removeConnection(conn);
        rateLimiter.removeConnection(conn);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        if (!rateLimiter.allow(conn)) {
            conn.send("{\"error\":\"rate_limited\"}");
            return;
        }
        try {
            JsonObject json = JsonParser.parseString(message).getAsJsonObject();
            messageHandler.handle(conn, json);
        } catch (Exception e) {
            JsonObject err = new JsonObject();
            err.addProperty("error", "invalid_json");
            err.addProperty("message", e.getMessage());
            conn.send(err.toString());
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        AutoBridgeMod.LOGGER.error("WebSocket error: {}", ex.getMessage());
    }

    @Override
    public void onStart() {
        AutoBridgeMod.LOGGER.info("WebSocket server started on port {}", config.getPort());
    }
}
