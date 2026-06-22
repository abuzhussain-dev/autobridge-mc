package net.autobridge;

import com.google.gson.JsonObject;
import org.java_websocket.WebSocket;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class EventEmitter {
    private final Map<WebSocket, Set<String>> subscriptions = new ConcurrentHashMap<>();

    public void subscribe(WebSocket conn, String events) {
        String[] eventList = events.split(",");
        subscriptions.computeIfAbsent(conn, k -> ConcurrentHashMap.newKeySet())
            .addAll(Arrays.asList(eventList));
    }

    public void unsubscribe(WebSocket conn, String events) {
        Set<String> subs = subscriptions.get(conn);
        if (subs != null) {
            subs.removeAll(Arrays.asList(events.split(",")));
        }
    }

    public void removeConnection(WebSocket conn) {
        subscriptions.remove(conn);
    }

    public void emit(String eventName, JsonObject data) {
        JsonObject payload = new JsonObject();
        payload.addProperty("type", "event");
        payload.addProperty("event", eventName);
        payload.add("data", data);
        String message = payload.toString();
        for (Map.Entry<WebSocket, Set<String>> entry : subscriptions.entrySet()) {
            if (entry.getValue().contains(eventName)) {
                entry.getKey().send(message);
            }
        }
    }
}
