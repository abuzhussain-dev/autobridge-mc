#!/usr/bin/env python3
import asyncio
import json
import sys
import os
from datetime import datetime

TARGET_POTIONS = 100
BREW_WAIT_SECONDS = 22

os.environ.setdefault("AUTOBRIDGE_HOST", "127.0.0.1")
os.environ.setdefault("AUTOBRIDGE_PORT", "8765")
os.environ.setdefault("AUTOBRIDGE_API_KEY", "")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from examples.client import AutoBridgeClient

CHEST = {"x": 100, "y": 64, "z": 99}
BREW = {"x": 102, "y": 64, "z": 100}

def log(msg):
    t = datetime.now().strftime("%H:%M:%S")
    print(f"\033[36m[{t}] {msg}\033[0m")

async def ensure_ok(resp, label=""):
    if resp is None:
        log(f"\033[31m{label}: no response\033[0m")
        return False
    if "error" in resp:
        log(f"\033[31m{label}: {resp['error']}\033[0m")
        return False
    return True

async def walk_to_block(client, x, y, z):
    label = f"walk_to_block({x},{y},{z})"
    resp = await client.send_command("nav.walkTo", {"x": x, "y": y, "z": z})
    if not await ensure_ok(resp, label):
        return False
    for _ in range(60):
        s = await client.send_command("nav.walkStatus")
        if "error" in s:
            await asyncio.sleep(1)
            continue
        r = s.get("result", {})
        if not r.get("walking", False):
            return True
        await asyncio.sleep(1)
    log(f"\033[33mWalk to ({x},{y},{z}) timed out\033[0m")
    return False

async def activate_block(client, x, y, z):
    resp = await client.send_command("block.activate", {"x": x, "y": y, "z": z})
    if not await ensure_ok(resp, f"activate({x},{y},{z})"):
        return False
    await asyncio.sleep(1)
    return True

async def click_slot(client, slot, action="PICKUP", button=0):
    resp = await client.send_command("screen.click", {"slot": slot, "button": button, "actionType": action})
    if not await ensure_ok(resp, f"click slot {slot} {action}"):
        return False
    await asyncio.sleep(0.3)
    return True

async def close_screen(client):
    resp = await client.send_command("screen.close")
    return await ensure_ok(resp, "close_screen")

async def get_item_in_slot(client, slot):
    resp = await client.send_command("screen.getSlots")
    if "error" in resp:
        return None
    slots = resp.get("result", [])
    for s in slots:
        if s.get("slot") == slot:
            return s.get("item")
    return None

async def find_item_inventory_slot(client, item_id_substring):
    resp = await client.send_command("screen.getSlots")
    if "error" in resp:
        return None
    slots = resp.get("result", [])
    for s in slots:
        snum = s.get("slot", -1)
        if snum < 5:
            continue
        item = s.get("item")
        if item and item.get("id") and item_id_substring in item["id"]:
            return snum
    return None

async def find_item_in_container(client, item_id_substring):
    resp = await client.send_command("screen.getSlots")
    if "error" in resp:
        return None
    slots = resp.get("result", [])
    for s in slots:
        snum = s.get("slot", -1)
        if snum > 26:
            continue
        item = s.get("item")
        if item and item.get("id") and item_id_substring in item["id"]:
            return snum
    return None

async def move_item_to_brewing_slot(client, source_slot, target_slot):
    if not await click_slot(client, source_slot, "PICKUP"):
        return False
    await asyncio.sleep(0.2)
    if not await click_slot(client, target_slot, "PICKUP"):
        return False
    return True

async def quick_move_slot(client, slot):
    return await click_slot(client, slot, "QUICK_MOVE")

async def deposit_fuel(client):
    slot = await find_item_inventory_slot(client, "blaze_powder")
    if slot is None:
        log("\033[33mNo blaze powder in inventory for fuel\033[0m")
        return False
    return await quick_move_slot(client, slot)

async def place_water_bottles(client):
    for bottle_slot in range(3):
        item = await get_item_in_slot(client, bottle_slot)
        if item and "water" in item.get("id", "").lower():
            continue
        inv_slot = await find_item_inventory_slot(client, "potion")
        if inv_slot is None:
            log("\033[33mNo water bottles in inventory\033[0m")
            return False
        if not await move_item_to_brewing_slot(client, inv_slot, bottle_slot):
            return False
    return True

async def place_ingredient(client, item_id_substring):
    inv_slot = await find_item_inventory_slot(client, item_id_substring)
    if inv_slot is None:
        log(f"\033[33mNo {item_id_substring} in inventory\033[0m")
        return False
    return await move_item_to_brewing_slot(client, inv_slot, 3)

async def take_slots_to_inventory(client, slots):
    for s in slots:
        if not await quick_move_slot(client, s):
            return False
    return True

async def put_slots_from_inventory(client, target_slots, item_id_substring):
    for ts in target_slots:
        inv_slot = await find_item_inventory_slot(client, item_id_substring)
        if inv_slot is None:
            log(f"\033[33mNo {item_id_substring} to place in slot {ts}\033[0m")
            return False
        if not await move_item_to_brewing_slot(client, inv_slot, ts):
            return False
    return True

async def wait_for_brew(client, timeout=BREW_WAIT_SECONDS):
    log(f"Waiting {timeout}s for brewing...")
    for _ in range(timeout):
        resp = await client.send_command("container.brewingInfo", {"x": BREW["x"], "y": BREW["y"], "z": BREW["z"]})
        if "error" not in resp:
            info = resp.get("result", {})
            if not info.get("brewing", True):
                log("Brewing complete")
                return True
        await asyncio.sleep(1)
    log("\033[33mBrew wait timer expired, proceeding\033[0m")
    return True

async def brew_cycle(client):
    log("--- Starting brew cycle ---")

    if not await walk_to_block(client, BREW["x"], BREW["y"], BREW["z"]):
        return False
    await asyncio.sleep(1)
    if not await activate_block(client, BREW["x"], BREW["y"], BREW["z"]):
        return False
    await asyncio.sleep(1)

    if not await deposit_fuel(client):
        log("\033[33mFuel deposit failed, continuing anyway\033[0m")
    if not await place_water_bottles(client):
        return False

    if not await place_ingredient(client, "nether_wart"):
        return False
    if not await wait_for_brew(client):
        return False

    if not await take_slots_to_inventory(client, [0, 1, 2]):
        return False
    if not await put_slots_from_inventory(client, [0, 1, 2], "awkward"):
        return False

    if not await place_ingredient(client, "blaze_powder"):
        return False
    if not await wait_for_brew(client):
        return False

    if not await take_slots_to_inventory(client, [0, 1, 2]):
        return False
    if not await put_slots_from_inventory(client, [0, 1, 2], "strength"):
        return False

    if not await place_ingredient(client, "glowstone"):
        return False
    if not await wait_for_brew(client):
        return False

    if not await take_slots_to_inventory(client, [0, 1, 2]):
        return False

    if not await close_screen(client):
        return False
    log("--- Brew cycle done (3 potions) ---")
    return True

async def check_ingredients(client):
    log("Checking ingredients in chest...")
    if not await walk_to_block(client, CHEST["x"], CHEST["y"], CHEST["z"]):
        return False
    await asyncio.sleep(1)
    if not await activate_block(client, CHEST["x"], CHEST["y"], CHEST["z"]):
        return False
    await asyncio.sleep(1)

    needed = []
    for item_id in ["nether_wart", "blaze_powder", "glowstone"]:
        slot = await find_item_in_container(client, item_id)
        if slot is not None:
            log(f"Found {item_id} in chest (slot {slot}), moving to inventory")
            await quick_move_slot(client, slot)
            needed.append(item_id)
        else:
            inv = await find_item_inventory_slot(client, item_id)
            if inv is not None:
                log(f"{item_id} already in inventory")
                needed.append(item_id)

    await close_screen(client)
    log(f"Ingredients available: {needed}")
    return True

async def main():
    client = AutoBridgeClient()
    connected = await client.connect()
    if not connected:
        sys.exit(1)

    log(f"Starting potion brewer — target: {TARGET_POTIONS} strength II potions")
    potions_made = 0

    try:
        while potions_made < TARGET_POTIONS:
            await check_ingredients(client)
            if await brew_cycle(client):
                potions_made += 3
                log(f"\033[32mProgress: {potions_made}/{TARGET_POTIONS} potions\033[0m")
            else:
                log("\033[31mBrew cycle failed, retrying...\033[0m")
                await asyncio.sleep(3)
    except KeyboardInterrupt:
        log("\033[33mInterrupted by user\033[0m")
    finally:
        await client.close()
        log(f"\033[32mDone. Made {potions_made} potions.\033[0m")

if __name__ == "__main__":
    asyncio.run(main())
