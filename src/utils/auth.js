/**
 * Optional Edge API Key authentication middleware.
 * When process.env.EDGE_API_KEY is set, requires a matching 'X-Edge-Key' header
 * or 'Authorization: Bearer <key>' header on mutating endpoints.
 * When unset, allows requests through for zero-config local/demo operation.
 */
function requireEdgeApiKey(req, res, next) {
    const expectedKey = process.env.EDGE_API_KEY;
    if (!expectedKey) {
        return next();
    }

    const headerKey = req.headers['x-edge-key'];
    const authHeader = req.headers.authorization || '';
    const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const providedKey = headerKey || bearerKey;

    if (providedKey && providedKey === expectedKey) {
        return next();
    }

    return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: valid X-Edge-Key or Bearer token required'
    });
}

module.exports = { requireEdgeApiKey };
