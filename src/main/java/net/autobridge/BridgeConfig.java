package net.autobridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class BridgeConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private int port = 2856;
    private String apiKey = "";
    private boolean debug = false;
    private int maxConnections = 10;
    private int rateLimit = 100;
    private int rateLimitBurst = 200;
    private int requestTimeout = 30000;

    public static BridgeConfig load() {
        Path path = FabricLoader.getInstance().getConfigDir().resolve("autobridge/bridge.json");
        if (Files.exists(path)) {
            try {
                return GSON.fromJson(Files.readString(path), BridgeConfig.class);
            } catch (IOException e) {
                AutoBridgeMod.LOGGER.error("Failed to load config", e);
            }
        }
        BridgeConfig cfg = new BridgeConfig();
        cfg.save();
        return cfg;
    }

    public void save() {
        Path path = FabricLoader.getInstance().getConfigDir().resolve("autobridge/bridge.json");
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, GSON.toJson(this));
        } catch (IOException e) {
            AutoBridgeMod.LOGGER.error("Failed to save config", e);
        }
    }

    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public boolean isDebug() { return debug; }
    public void setDebug(boolean debug) { this.debug = debug; }
    public int getMaxConnections() { return maxConnections; }
    public void setMaxConnections(int maxConnections) { this.maxConnections = maxConnections; }
    public int getRateLimit() { return rateLimit; }
    public void setRateLimit(int rateLimit) { this.rateLimit = rateLimit; }
    public int getRateLimitBurst() { return rateLimitBurst; }
    public void setRateLimitBurst(int rateLimitBurst) { this.rateLimitBurst = rateLimitBurst; }
    public int getRequestTimeout() { return requestTimeout; }
    public void setRequestTimeout(int requestTimeout) { this.requestTimeout = requestTimeout; }
}
