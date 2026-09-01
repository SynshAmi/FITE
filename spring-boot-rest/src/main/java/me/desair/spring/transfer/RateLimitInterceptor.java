package me.desair.spring.transfer;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.Refill;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final Map<String, Bucket> createBuckets = new ConcurrentHashMap<>();
    private final Map<String, Bucket> lookupBuckets = new ConcurrentHashMap<>();
    private final Map<String, Bucket> chunkBuckets = new ConcurrentHashMap<>();

    // Rate: 5 per minute per IP
    private Bucket getCreateBucket(String ip) {
        return createBuckets.computeIfAbsent(ip, k -> Bucket.builder()
                .addLimit(Bandwidth.classic(5, Refill.intervally(5, Duration.ofMinutes(1))))
                .build());
    }

    // Rate: 30 per minute per IP
    private Bucket getLookupBucket(String ip) {
        return lookupBuckets.computeIfAbsent(ip, k -> Bucket.builder()
                .addLimit(Bandwidth.classic(30, Refill.intervally(30, Duration.ofMinutes(1))))
                .build());
    }

    // Rate: 100 per minute per IP
    private Bucket getChunkBucket(String ip) {
        return chunkBuckets.computeIfAbsent(ip, k -> Bucket.builder()
                .addLimit(Bandwidth.classic(100, Refill.intervally(100, Duration.ofMinutes(1))))
                .build());
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String path = request.getRequestURI();
        if (path.startsWith("/health")) {
            return true;
        }

        String ip = getClientIP(request);
        String method = request.getMethod();

        Bucket bucket;

        if (path.matches("^/api/transfers$") && "POST".equalsIgnoreCase(method)) {
            bucket = getCreateBucket(ip);
        } else if (path.matches("^/api/transfers/[^/]+$") && "GET".equalsIgnoreCase(method)) {
            bucket = getLookupBucket(ip);
        } else if (path.matches("^/api/transfers/[^/]+/chunks$") && "GET".equalsIgnoreCase(method)) {
            // Polling
            bucket = getLookupBucket(ip);
        } else if (path.matches("^/api/transfers/[^/]+/chunks/\\d+$")) {
            // Chunk upload or download
            bucket = getChunkBucket(ip);
        } else {
            // Fallback for completion or other
            bucket = getLookupBucket(ip);
        }

        if (bucket.tryConsume(1)) {
            return true;
        } else {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            return false;
        }
    }

    private String getClientIP(HttpServletRequest request) {
        String xfHeader = request.getHeader("X-Forwarded-For");
        if (xfHeader == null) {
            return request.getRemoteAddr();
        }
        return xfHeader.split(",")[0];
    }
}
