package net.autobridge;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class PendingRequest {
    private final Map<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private final long timeoutMs;

    public PendingRequest(long timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    public CompletableFuture<String> put(String id) {
        CompletableFuture<String> future = new CompletableFuture<>();
        pending.put(id, future);
        executor.schedule(() -> {
            CompletableFuture<String> f = pending.remove(id);
            if (f != null && !f.isDone()) {
                f.completeExceptionally(new TimeoutException("Request timed out: " + id));
            }
        }, timeoutMs, TimeUnit.MILLISECONDS);
        return future;
    }

    public void complete(String id, String response) {
        CompletableFuture<String> future = pending.remove(id);
        if (future != null) {
            future.complete(response);
        }
    }
}
