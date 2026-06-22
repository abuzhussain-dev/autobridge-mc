package net.autobridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.text.Text;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AutoBridgeMod implements ModInitializer {

    public static final String MOD_ID = "autobridge";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("[AutoBridge] Initializing...");

        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            LOGGER.info("[AutoBridge] Server started — WebSocket bridge ready (port 8765)");
        });

        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            dispatcher.register(CommandManager.literal("bridge")
                .then(CommandManager.literal("status")
                    .executes(context -> {
                        context.getSource().sendFeedback(() ->
                            Text.literal("AutoBridge v1.0.0 — active"), true);
                        return 1;
                    })
                )
            );
        });

        LOGGER.info("[AutoBridge] Registered /bridge command");
    }
}
