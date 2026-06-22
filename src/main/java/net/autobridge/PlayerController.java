package net.autobridge;

import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.network.chat.Component;

public class PlayerController {
    private final ServerPlayer player;

    public PlayerController(ServerPlayer player) {
        this.player = player;
    }

    public void moveTo(double x, double y, double z) {
        player.connection.teleport(x, y, z, player.getYRot(), player.getXRot());
    }

    public void lookAt(double x, double y, double z) {
        double dx = x - player.getX();
        double dy = y - player.getEyeY();
        double dz = z - player.getZ();
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) Math.toDegrees(-Math.atan2(dy, horizontal));
        player.connection.teleport(player.getX(), player.getY(), player.getZ(), yaw, pitch);
    }

    public void sendMessage(String text) {
        player.server.getPlayerList().broadcastSystemMessage(
            Component.literal("<" + player.getDisplayName().getString() + "> " + text), false);
    }

    public void attack() {
        player.swing(InteractionHand.MAIN_HAND);
    }

    public void useItem() {
        player.swing(InteractionHand.MAIN_HAND);
        player.gameMode.useItem(player, player.serverLevel(), player.getMainHandItem(), InteractionHand.MAIN_HAND);
    }

    public void jump() {
        player.jumpFromGround();
    }

    public void sneak(boolean sneaking) {
        player.setShiftKeyDown(sneaking);
    }

    public void sprint(boolean sprinting) {
        player.setSprinting(sprinting);
    }

    public void swingHand() {
        player.swing(InteractionHand.MAIN_HAND);
    }

    public void dropItem(boolean entireStack) {
        player.drop(entireStack);
    }

    public JsonObject getPosition() {
        JsonObject pos = new JsonObject();
        pos.addProperty("x", player.getX());
        pos.addProperty("y", player.getY());
        pos.addProperty("z", player.getZ());
        pos.addProperty("yaw", player.getYRot());
        pos.addProperty("pitch", player.getXRot());
        pos.addProperty("dimension", player.level().dimension().location().toString());
        return pos;
    }

    public float getHealth() {
        return player.getHealth();
    }

    public float getHunger() {
        return player.getFoodData().getFoodLevel();
    }
}
