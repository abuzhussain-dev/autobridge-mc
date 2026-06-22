package net.autobridge;

import org.java_websocket.WebSocket;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class BridgeRateLimiter {
    private final int rate;
    private final int burst;
    private final Map<WebSocket, TokenBucket> buckets = new ConcurrentHashMap<>();

    public BridgeRateLimiter(BridgeConfig config) {
        this.rate = config.getRateLimit();
        this.burst = config.getRateLimitBurst();
    }

    public boolean allow(WebSocket conn) {
        return buckets.computeIfAbsent(conn, k -> new TokenBucket(rate, burst)).tryConsume();
    }

    public void removeConnection(WebSocket conn) {
        buckets.remove(conn);
    }

    private static class TokenBucket {
        private final int rate;
        private final int burst;
        private long tokens;
        private long lastRefillNanos;

        TokenBucket(int rate, int burst) {
            this.rate = rate;
            this.burst = burst;
            this.tokens = burst;
            this.lastRefillNanos = System.nanoTime();
        }

        synchronized boolean tryConsume() {
            refill();
            if (tokens > 0) {
                tokens--;
                return true;
            }
            return false;
        }

        private void refill() {
            long now = System.nanoTime();
            long elapsed = now - lastRefillNanos;
            long newTokens = elapsed * rate / 1_000_000_000L;
            if (newTokens > 0) {
                tokens = Math.min(burst, tokens + newTokens);
                lastRefillNanos = now;
            }
        }
    }
}
