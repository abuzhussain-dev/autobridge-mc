var Client = Java.type('net.minecraft.client.MinecraftClient').getInstance();

globalThis.__bridge = globalThis.__bridge || {};

globalThis.__bridge.commands = {
  handlers: {},
  register: function(handlers) {
    for (var type in handlers) {
      if (handlers.hasOwnProperty(type)) {
        this.handlers[type] = handlers[type];
      }
    }
  },
  handle: function(type, payload) {
    var handler = this.handlers[type];
    if (!handler) {
      return { success: false, error: "Unknown command: " + type };
    }
    try {
      return handler(payload || {});
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};

function _check() {
  if (!Client.player) throw new Error("Player not available");
  if (!Client.world) throw new Error("World not available");
}

globalThis.__bridge.commands.register({
  move: function(payload) {
    try {
      _check();
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number' || typeof payload.z !== 'number') {
        return { success: false, error: "Invalid move payload: x, y, z must be numbers" };
      }
      var Packet = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$PositionAndOnGround');
      Client.player.networkHandler.sendPacket(new Packet(payload.x, payload.y, payload.z, true));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  look: function(payload) {
    try {
      _check();
      if (typeof payload.yaw !== 'number' || typeof payload.pitch !== 'number') {
        return { success: false, error: "Invalid look payload: yaw and pitch must be numbers" };
      }
      var Packet = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$LookAndOnGround');
      Client.player.networkHandler.sendPacket(new Packet(payload.yaw, payload.pitch, true));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  jump: function(payload) {
    try {
      _check();
      Client.player.jump();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sprint: function(payload) {
    try {
      _check();
      Client.player.setSprinting(!!payload.state);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sneak: function(payload) {
    try {
      _check();
      Client.player.setSneaking(!!payload.state);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  attack: function(payload) {
    try {
      _check();
      Client.player.swingHand(Java.type('net.minecraft.util.Hand').MAIN_HAND);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  use: function(payload) {
    try {
      _check();
      Client.interactionManager.interactItem(Client.player, Client.world, Java.type('net.minecraft.util.Hand').MAIN_HAND);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sendChat: function(payload) {
    try {
      _check();
      if (!payload.message || typeof payload.message !== 'string') {
        return { success: false, error: "Invalid message" };
      }
      Client.player.sendChatMessage(payload.message);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getBlock: function(payload) {
    try {
      _check();
      var BlockPos = Java.type('net.minecraft.util.math.BlockPos');
      var pos = new BlockPos(Math.floor(payload.x), Math.floor(payload.y), Math.floor(payload.z));
      var state = Client.world.getBlockState(pos);
      var block = state.getBlock();
      return {
        success: true,
        blockId: block.getTranslationKey(),
        blockName: block.getName().getString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  raycast: function(payload) {
    try {
      _check();
      var maxDist = payload.maxDistance || 5.0;
      var hit = Client.player.raycast(maxDist, 0.0, false);
      if (hit.getType().name() === 'MISS') {
        return { success: true, hit: false };
      }
      var pos = hit.getPos();
      var BlockPos = Java.type('net.minecraft.util.math.BlockPos');
      var blockPos = new BlockPos(pos.x, pos.y, pos.z);
      var state = Client.world.getBlockState(blockPos);
      return {
        success: true,
        hit: true,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        blockId: state.getBlock().getTranslationKey()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getPosition: function(payload) {
    try {
      _check();
      var pos = Client.player.getPos();
      return {
        success: true,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: Client.player.getYaw(),
        pitch: Client.player.getPitch(),
        onGround: Client.player.isOnGround(),
        dimension: Client.world.getRegistryKey().getValue().toString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getInventory: function(payload) {
    try {
      _check();
      var inv = Client.player.getInventory();
      var slots = [];
      var main = inv.main;
      for (var i = 0; i < main.size(); i++) {
        var stack = main.get(i);
        if (!stack.isEmpty()) {
          slots.push({
            slot: i,
            itemId: stack.getItem().getTranslationKey(),
            count: stack.getCount(),
            name: stack.getName().getString(),
            slotType: 'main'
          });
        }
      }
      var armor = inv.armor;
      for (var i = 0; i < armor.size(); i++) {
        var stack = armor.get(i);
        if (!stack.isEmpty()) {
          slots.push({
            slot: 36 + i,
            itemId: stack.getItem().getTranslationKey(),
            count: stack.getCount(),
            name: stack.getName().getString(),
            slotType: 'armor'
          });
        }
      }
      var offHand = inv.offHand;
      var stack = offHand.get(0);
      if (!stack.isEmpty()) {
        slots.push({
          slot: 40,
          itemId: stack.getItem().getTranslationKey(),
          count: stack.getCount(),
          name: stack.getName().getString(),
          slotType: 'offhand'
        });
      }
      return { success: true, slots: slots };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getItem: function(payload) {
    try {
      _check();
      if (typeof payload.slot !== 'number' || payload.slot < 0 || payload.slot > 40) {
        return { success: false, error: "Invalid slot: must be a number between 0 and 40" };
      }
      var stack = Client.player.getInventory().getStack(payload.slot);
      if (stack.isEmpty()) {
        return { success: true, slot: payload.slot, itemId: null, count: 0, name: '' };
      }
      return {
        success: true,
        slot: payload.slot,
        itemId: stack.getItem().getTranslationKey(),
        count: stack.getCount(),
        name: stack.getName().getString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  moveItem: function(payload) {
    try {
      _check();
      if (typeof payload.from !== 'number' || typeof payload.to !== 'number' || payload.from < 0 || payload.from > 40 || payload.to < 0 || payload.to > 40) {
        return { success: false, error: "Invalid moveItem payload: from and to must be numbers between 0 and 40" };
      }
      var inv = Client.player.getInventory();
      var temp = inv.getStack(payload.from);
      inv.setStack(payload.from, inv.getStack(payload.to));
      inv.setStack(payload.to, temp);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getTime: function(payload) {
    try {
      _check();
      return { success: true, time: Client.world.getTimeOfDay() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
});
