package net.autobridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AutoBridgeMod implements ModInitializer {
    public static final String MOD_ID = "autobridge";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private BridgeConfig config;
    private BridgeWebSocketServer webSocketServer;

    @Override
    public void onInitialize() {
        LOGGER.info("Initializing AutoBridge");
        this.config = BridgeConfig.load();
        this.webSocketServer = new BridgeWebSocketServer(config);

        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            webSocketServer.setServer(server);
            webSocketServer.start();
        });

        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            webSocketServer.stop();
        });

        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
            BridgeCommand.register(dispatcher, webSocketServer));

        LOGGER.info("AutoBridge initialized");
    }
}
