package net.autobridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;

import java.util.List;

public class WorldQuerier {
    private static final int MAX_BLOCKS = 512;
    private static final int MAX_ENTITIES = 50;

    private final MinecraftServer server;

    public WorldQuerier(MinecraftServer server) {
        this.server = server;
    }

    private ServerLevel getOverworld() {
        return server.getLevel(Level.OVERWORLD);
    }

    public JsonObject getBlock(int x, int y, int z) {
        ServerLevel level = getOverworld();
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = level.getBlockState(pos);
        ResourceLocation id = BuiltInRegistries.BLOCK.getKey(state.getBlock());
        JsonObject block = new JsonObject();
        block.addProperty("id", id.toString());
        block.addProperty("x", x);
        block.addProperty("y", y);
        block.addProperty("z", z);
        return block;
    }

    public JsonObject getEntities(JsonObject options) {
        ServerLevel level = getOverworld();
        double cx = options.has("x") ? options.get("x").getAsDouble() : 0;
        double cy = options.has("y") ? options.get("y").getAsDouble() : 0;
        double cz = options.has("z") ? options.get("z").getAsDouble() : 0;
        double radius = options.has("radius") ? options.get("radius").getAsDouble() : 10;
        int limit = options.has("limit") ? options.get("limit").getAsInt() : MAX_ENTITIES;
        String type = options.has("type") ? options.get("type").getAsString() : null;
        limit = Math.min(limit, MAX_ENTITIES);

        AABB aabb = new AABB(cx - radius, cy - radius, cz - radius, cx + radius, cy + radius, cz + radius);
        List<Entity> entities = level.getEntities((Entity) null, aabb, e -> {
            if (type != null) {
                ResourceLocation entityId = BuiltInRegistries.ENTITY_TYPE.getKey(e.getType());
                return entityId.toString().equals(type) || entityId.getPath().equals(type);
            }
            return true;
        });
        if (entities.size() > limit) entities = entities.subList(0, limit);

        JsonArray arr = new JsonArray();
        for (Entity e : entities) {
            JsonObject obj = new JsonObject();
            obj.addProperty("uuid", e.getUUID().toString());
            obj.addProperty("type", BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());
            obj.addProperty("x", e.getX());
            obj.addProperty("y", e.getY());
            obj.addProperty("z", e.getZ());
            obj.addProperty("name", e.getName().getString());
            arr.add(obj);
        }
        JsonObject result = new JsonObject();
        result.add("entities", arr);
        result.addProperty("count", arr.size());
        return result;
    }

    public long getTime() {
        return getOverworld().getDayTime();
    }

    public String getWeather() {
        ServerLevel level = getOverworld();
        if (level.isThundering()) return "thunder";
        if (level.isRaining()) return "rain";
        return "clear";
    }

    public JsonObject findBlocks(String pattern, int cx, int cy, int cz, int radius) {
        ServerLevel level = getOverworld();
        JsonArray arr = new JsonArray();
        int count = 0;
        for (BlockPos pos : BlockPos.betweenClosed(
                cx - radius, cy - radius, cz - radius,
                cx + radius, cy + radius, cz + radius)) {
            if (count >= MAX_BLOCKS) break;
            BlockState state = level.getBlockState(pos);
            ResourceLocation id = BuiltInRegistries.BLOCK.getKey(state.getBlock());
            if (id.toString().equals(pattern) || id.getPath().equals(pattern)) {
                JsonObject block = new JsonObject();
                block.addProperty("id", id.toString());
                block.addProperty("x", pos.getX());
                block.addProperty("y", pos.getY());
                block.addProperty("z", pos.getZ());
                arr.add(block);
                count++;
            }
        }
        JsonObject result = new JsonObject();
        result.add("blocks", arr);
        result.addProperty("count", arr.size());
        return result;
    }
}
