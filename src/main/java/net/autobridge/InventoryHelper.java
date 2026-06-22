package net.autobridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;

public class InventoryHelper {
    private final ServerPlayer player;

    public InventoryHelper(ServerPlayer player) {
        this.player = player;
    }

    public JsonObject getInventory() {
        JsonArray slots = new JsonArray();
        var inventory = player.getInventory();
        for (int i = 0; i < inventory.getContainerSize(); i++) {
            ItemStack stack = inventory.getItem(i);
            if (!stack.isEmpty()) {
                JsonObject slot = new JsonObject();
                slot.addProperty("slot", i);
                slot.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                slot.addProperty("count", stack.getCount());
                slot.addProperty("name", stack.getDisplayName().getString());
                slots.add(slot);
            }
        }
        JsonObject result = new JsonObject();
        result.add("slots", slots);
        result.addProperty("selected", inventory.selected);
        result.addProperty("size", inventory.getContainerSize());
        return result;
    }

    public JsonObject getContainer(int x, int y, int z) {
        Level level = player.serverLevel();
        BlockPos pos = new BlockPos(x, y, z);
        BlockEntity be = level.getBlockEntity(pos);
        if (!(be instanceof Container container)) {
            JsonObject error = new JsonObject();
            error.addProperty("error", "not_a_container");
            return error;
        }
        JsonArray slots = new JsonArray();
        for (int i = 0; i < container.getContainerSize(); i++) {
            ItemStack stack = container.getItem(i);
            if (!stack.isEmpty()) {
                JsonObject slot = new JsonObject();
                slot.addProperty("slot", i);
                slot.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                slot.addProperty("count", stack.getCount());
                slots.add(slot);
            }
        }
        JsonObject result = new JsonObject();
        result.add("slots", slots);
        result.addProperty("size", container.getContainerSize());
        return result;
    }

    public boolean clickSlot(String slot, int button) {
        int slotIndex;
        try {
            slotIndex = Integer.parseInt(slot);
        } catch (NumberFormatException e) {
            return false;
        }
        player.containerMenu.clicked(slotIndex, button,
            net.minecraft.world.inventory.ClickType.PICKUP, player);
        return true;
    }

    public boolean dropSlot(String slot) {
        int slotIndex;
        try {
            slotIndex = Integer.parseInt(slot);
        } catch (NumberFormatException e) {
            return false;
        }
        ItemStack stack = player.getInventory().getItem(slotIndex);
        if (!stack.isEmpty()) {
            player.drop(stack, true, false);
            player.getInventory().setItem(slotIndex, ItemStack.EMPTY);
        }
        return true;
    }

    public boolean moveItems(String fromSlot, String toSlot, int count) {
        int from, to;
        try {
            from = Integer.parseInt(fromSlot);
            to = Integer.parseInt(toSlot);
        } catch (NumberFormatException e) {
            return false;
        }
        ItemStack source = player.getInventory().getItem(from);
        if (source.isEmpty()) return false;
        ItemStack target = player.getInventory().getItem(to);
        int moveCount = Math.min(count, source.getCount());
        if (target.isEmpty()) {
            ItemStack moved = source.split(moveCount);
            player.getInventory().setItem(to, moved);
        } else if (ItemStack.isSameItemSameComponents(source, target)) {
            int space = target.getMaxStackSize() - target.getCount();
            int toMove = Math.min(moveCount, space);
            source.shrink(toMove);
            target.grow(toMove);
            player.getInventory().setItem(to, target);
        } else {
            return false;
        }
        return true;
    }
}
