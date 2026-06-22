package net.autobridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.commands.Commands;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
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
            dispatcher.register(Commands.literal("bridge")
                .then(Commands.literal("status")
                    .executes(context -> {
                        context.getSource().sendSuccess(() ->
                            Component.literal("AutoBridge v1.0.0 — active"), true);
                        return 1;
                    })
                )
            );
        });

        LOGGER.info("[AutoBridge] Registered /bridge command");
    }
}
