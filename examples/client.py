#!/usr/bin/env python3
import asyncio
import json
import os
import sys

HOST = os.getenv("AUTOBRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("AUTOBRIDGE_PORT", "8765"))
API_KEY = os.getenv("AUTOBRIDGE_API_KEY", "")

try:
    import websockets
except ImportError:
    print("websockets not installed. Install it with: pip install websockets")
    sys.exit(1)


class AutoBridgeClient:
    def __init__(self):
        self.ws = None
        self.req_id = 0
        self.pending = {}
        self.connected = False
        self._listener_task = None

    async def connect(self):
        uri = f"ws://{HOST}:{PORT}"
        print(f"\033[36mConnecting to {uri}...\033[0m")
        for attempt in range(1, 4):
            try:
                self.ws = await websockets.connect(uri, ping_interval=20, ping_timeout=10)
                self.connected = True
                print(f"\033[32mConnected to {uri}\033[0m")
                if API_KEY:
                    resp = await self.send_command("auth", {"apiKey": API_KEY})
                    if resp.get("result", {}).get("success"):
                        print("\033[32mAuthenticated successfully\033[0m")
                    else:
                        print(f"\033[31mAuth failed: {resp}\033[0m")
                        return False
                self._listener_task = asyncio.create_task(self.listen())
                return True
            except (OSError, websockets.WebSocketException) as e:
                self.connected = False
                if attempt < 3:
                    print(f"\033[33mConnection attempt {attempt} failed: {e}. Retrying in 2s...\033[0m")
                    await asyncio.sleep(2)
                else:
                    print(f"\033[31mFailed to connect after 3 attempts: {e}\033[0m")
                    return False

    async def send_command(self, cmd_type, payload=None):
        self.req_id += 1
        msg_id = self.req_id
        msg = {"id": msg_id, "type": cmd_type, "payload": payload or {}}
        future = asyncio.get_event_loop().create_future()
        self.pending[msg_id] = future
        try:
            await self.ws.send(json.dumps(msg))
            result = await asyncio.wait_for(future, timeout=30)
            return result
        except asyncio.TimeoutError:
            self.pending.pop(msg_id, None)
            return {"error": {"message": "Command timed out after 30s"}}
        except websockets.WebSocketException as e:
            self.pending.pop(msg_id, None)
            return {"error": {"message": f"Connection lost: {e}"}}

    async def listen(self):
        while self.connected:
            try:
                raw = await self.ws.recv()
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            except websockets.WebSocketException:
                self.connected = False
                break

            msg_id = msg.get("id")
            if msg_id is not None and msg_id in self.pending:
                future = self.pending.pop(msg_id)
                if not future.done():
                    if "error" in msg:
                        future.set_result(msg)
                    else:
                        future.set_result(msg)
            elif msg.get("type") == "event":
                event_data = msg.get("data", {})
                event_name = event_data.get("event", "")
                event_payload = event_data.get("data", "")
                print(f"\033[36m[event] {event_name}: {json.dumps(event_payload)}\033[0m")
            elif "error" in msg:
                err = msg.get("error", {})
                print(f"\033[31m[error] {err.get('message', json.dumps(msg))}\033[0m")
            else:
                print(f"\033[37m{json.dumps(msg, indent=2)}\033[0m")

    async def repl(self):
        print()
        print("\033[1mAutoBridge Python Client\033[0m")
        print(f"  Host: {HOST}:{PORT}")
        print(f"  Auth: {'yes' if API_KEY else 'no'}")
        print()
        print("\033[2mCommands: <type> [payload_json | arg1 arg2 ...]\033[0m")
        print("\033[2m  move {\"x\": 100, \"y\": 64, \"z\": 0}\033[0m")
        print("\033[2m  getPosition\033[0m")
        print("\033[2m  subscribe {\"events\": [\"position\", \"health\"]}\033[0m")
        print("\033[2m  jump\033[0m")
        print("\033[2m  /quit  —  exit client\033[0m")
        print()
        while self.connected:
            try:
                line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
                line = line.strip()
                if not line:
                    continue
                if line == "/quit":
                    break
                parts = line.split(None, 1)
                cmd_type = parts[0]
                raw_args = parts[1] if len(parts) > 1 else ""
                payload = {}
                if raw_args:
                    try:
                        payload = json.loads(raw_args)
                    except json.JSONDecodeError:
                        args = raw_args.split()
                        if len(args) >= 3:
                            try:
                                payload = {"x": float(args[0]), "y": float(args[1]), "z": float(args[2])}
                            except ValueError:
                                payload = {"args": args}
                        else:
                            for i, a in enumerate(args):
                                try:
                                    payload[f"arg{i}"] = float(a) if "." in a else int(a)
                                except ValueError:
                                    payload[f"arg{i}"] = a
                result = await self.send_command(cmd_type, payload)
                if "error" in result:
                    err = result["error"]
                    print(f"\033[31m{err.get('message', json.dumps(err))}\033[0m")
                elif "result" in result:
                    r = result["result"]
                    if isinstance(r, dict):
                        print(json.dumps(r, indent=2))
                    else:
                        print(r)
                else:
                    print(json.dumps(result, indent=2))
            except EOFError:
                break
            except Exception as e:
                print(f"\033[31mError: {e}\033[0m")
        await self.close()

    async def close(self):
        self.connected = False
        if self._listener_task:
            self._listener_task.cancel()
        if self.ws:
            await self.ws.close()


async def main():
    client = AutoBridgeClient()
    connected = await client.connect()
    if connected:
        await client.repl()
    else:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
