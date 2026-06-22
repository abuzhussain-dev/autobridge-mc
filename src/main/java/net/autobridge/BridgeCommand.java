package net.autobridge;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

public class BridgeCommand {
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, BridgeWebSocketServer ws) {
        dispatcher.register(Commands.literal("bridge")
            .requires(source -> source.hasPermission(2))
            .then(Commands.literal("status").executes(ctx -> status(ctx, ws)))
            .then(Commands.literal("config").executes(ctx -> showConfig(ctx, ws)))
            .then(Commands.literal("reload").executes(ctx -> reload(ctx, ws)))
            .then(Commands.literal("stop").executes(ctx -> stop(ctx, ws)))
        );
    }

    private static int status(CommandContext<CommandSourceStack> ctx, BridgeWebSocketServer ws) {
        var src = ctx.getSource();
        var cfg = ws.getConfig();
        src.sendSuccess(() -> Component.literal("\u00a76[AutoBridge] Status:"), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Port: \u00a7f" + cfg.getPort()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Connections: \u00a7f" + ws.getConnections().size()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Running: \u00a7f" + (ws.isRunning() ? "\u00a7ayes" : "\u00a7cno")), false);
        return 1;
    }

    private static int showConfig(CommandContext<CommandSourceStack> ctx, BridgeWebSocketServer ws) {
        var src = ctx.getSource();
        var cfg = ws.getConfig();
        src.sendSuccess(() -> Component.literal("\u00a76[AutoBridge] Config:"), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Port: \u00a7f" + cfg.getPort()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Auth: \u00a7f" + (cfg.getApiKey().isEmpty() ? "disabled" : "enabled")), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Debug: \u00a7f" + cfg.isDebug()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Max Connections: \u00a7f" + cfg.getMaxConnections()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Rate Limit: \u00a7f" + cfg.getRateLimit() + "/s burst " + cfg.getRateLimitBurst()), false);
        src.sendSuccess(() -> Component.literal("  \u00a77Request Timeout: \u00a7f" + cfg.getRequestTimeout() + "ms"), false);
        return 1;
    }

    private static int reload(CommandContext<CommandSourceStack> ctx, BridgeWebSocketServer ws) {
        ws.setConfig(BridgeConfig.load());
        ctx.getSource().sendSuccess(() -> Component.literal("\u00a7a[AutoBridge] Config reloaded from disk"), false);
        return 1;
    }

    private static int stop(CommandContext<CommandSourceStack> ctx, BridgeWebSocketServer ws) {
        ws.stop();
        ctx.getSource().sendSuccess(() -> Component.literal("\u00a7c[AutoBridge] WebSocket server stopped"), false);
        return 1;
    }
}
