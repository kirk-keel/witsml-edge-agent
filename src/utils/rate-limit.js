/**
 * Lightweight Sliding-Window Edge Rate Limiter
 * Protects the edge server from runaway rig sensor loops while exposing
 * standard X-RateLimit-* headers.
 */

const ipBuckets = new Map();

function edgeRateLimiter(req, res, next) {
    const maxPerMinute = Number(process.env.EDGE_RATE_LIMIT_PER_MIN) || 300;
    const now = Date.now();
    const windowMs = 60000;
    const key = req.ip || req.socket?.remoteAddress || 'local';

    let bucket = ipBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
        bucket = { windowStart: now, count: 0 };
        ipBuckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxPerMinute - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(maxPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (bucket.count > maxPerMinute) {
        return res.status(429).json({
            status: 'error',
            message: 'Rate limit exceeded. Reduce WITSML polling frequency or increase EDGE_RATE_LIMIT_PER_MIN.'
        });
    }

    return next();
}

function resetRateLimiter() {
    ipBuckets.clear();
}

module.exports = { edgeRateLimiter, resetRateLimiter };
