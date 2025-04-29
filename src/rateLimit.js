/**
 * Módulo para implementar rate limiting en la API
 * Previene abuso y uso excesivo
 */

const logger = require('./logger');

/**
 * Clase para gestionar rate limiting basado en tokens bucket
 */
class TokenBucket {
    /**
     * @param {number} capacity - Número máximo de tokens
     * @param {number} fillPerSecond - Tokens que se regeneran por segundo
     */
    constructor(capacity, fillPerSecond) {
        this.capacity = capacity;
        this.fillPerSecond = fillPerSecond;
        this.tokens = capacity;
        this.lastFilled = Date.now();
    }

    /**
     * Obtiene tokens del bucket
     * @param {number} count - Cantidad de tokens a consumir
     * @returns {boolean} - true si hay suficientes tokens, false en caso contrario
     */
    getTokens(count) {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            return true;
        }
        return false;
    }

    /**
     * Rellena tokens según el tiempo transcurrido
     */
    refill() {
        const now = Date.now();
        const deltaSeconds = (now - this.lastFilled) / 1000;
        
        // Calcular nuevos tokens a añadir
        const newTokens = deltaSeconds * this.fillPerSecond;
        
        // Si hay nuevos tokens que añadir
        if (newTokens > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + newTokens);
            this.lastFilled = now;
        }
    }
}

// Map para almacenar los buckets por IP
const ipRateLimiters = new Map();
const pathRateLimiters = new Map();

// Configuración por defecto para rate limiting
const DEFAULT_CONFIG = {
    tokensPerSecond: 5,    // 5 solicitudes por segundo en promedio
    bucketSize: 10,        // Máximo 10 solicitudes en ráfaga
    ipTokenCost: 1,        // Coste de una solicitud normal por IP
    pathTokenCost: 1,      // Coste de una solicitud por ruta
    costPenaltyFactor: 2,  // Factor de coste para penalizar abuso
};

/**
 * Aplica rate limiting a una solicitud
 * @param {Object} req - Request de Express 
 * @param {Object} res - Response de Express
 * @param {Function} next - Función para continuar al siguiente middleware
 */
function rateLimiterMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const path = req.path;
    
    // Saltar rate limiting para IPs locales/de desarrollo
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.includes('192.168.') || ip.includes('::ffff:127.0.0.1')) {
        return next();
    }

    // Obtener o crear limitador para esta IP
    if (!ipRateLimiters.has(ip)) {
        ipRateLimiters.set(ip, new TokenBucket(
            DEFAULT_CONFIG.bucketSize,
            DEFAULT_CONFIG.tokensPerSecond
        ));
    }

    // Obtener o crear limitador para esta ruta
    const routeKey = `${req.method}:${path}`;
    if (!pathRateLimiters.has(routeKey)) {
        pathRateLimiters.set(routeKey, new TokenBucket(
            DEFAULT_CONFIG.bucketSize * 5, // Mayor capacidad para rutas específicas
            DEFAULT_CONFIG.tokensPerSecond * 2 // Más tokens por segundo para rutas específicas
        ));
    }

    // Calcular coste de esta solicitud
    let requestCost = DEFAULT_CONFIG.ipTokenCost;
    
    // Coste adicional para rutas que acceden a datos completos
    if (path.includes('/api/rankings') || path.includes('/api/details')) {
        requestCost = DEFAULT_CONFIG.ipTokenCost * 2;
    }
    
    // Coste adicional para peticiones que fuerzan refresco
    if (req.query.forceRefresh === 'true' || req.query.force === 'true') {
        requestCost = requestCost * DEFAULT_CONFIG.costPenaltyFactor;
    }
    
    // Verificar si la IP tiene suficientes tokens
    const ipLimiter = ipRateLimiters.get(ip);
    const pathLimiter = pathRateLimiters.get(routeKey);
    
    const ipAllowed = ipLimiter.getTokens(requestCost);
    const pathAllowed = pathLimiter.getTokens(DEFAULT_CONFIG.pathTokenCost);
    
    // Si ambos limitadores permiten la solicitud
    if (ipAllowed && pathAllowed) {
        // Establecer cabeceras informativas
        res.setHeader('X-RateLimit-Limit', DEFAULT_CONFIG.bucketSize);
        res.setHeader('X-RateLimit-Remaining', Math.floor(ipLimiter.tokens));
        res.setHeader('X-RateLimit-Reset', Math.ceil(
            (DEFAULT_CONFIG.bucketSize - ipLimiter.tokens) / DEFAULT_CONFIG.tokensPerSecond
        ));
        
        return next();
    }
    
    // Si se alcanzó el límite, registrar información
    logger.warn(`Rate limit alcanzado para IP ${ip} en ${routeKey} (IP tokens: ${ipLimiter.tokens.toFixed(2)}, Path tokens: ${pathLimiter.tokens.toFixed(2)})`, 'API');
    
    // Establecer cabeceras de respuesta para rate limiting
    res.status(429).setHeader('Retry-After', Math.ceil(
        (requestCost - ipLimiter.tokens) / DEFAULT_CONFIG.tokensPerSecond
    ));
    
    return res.json({
        error: 'Demasiadas solicitudes, por favor inténtalo más tarde',
        retryAfter: Math.ceil((requestCost - ipLimiter.tokens) / DEFAULT_CONFIG.tokensPerSecond)
    });
}

/**
 * Limpia los limitadores antiguos (ejecutar periódicamente)
 * @param {number} maxAgeMs - Tiempo máximo sin uso (en ms) antes de eliminar un limitador
 */
function cleanupRateLimiters(maxAgeMs = 3600000) { // 1 hora por defecto
    const now = Date.now();
    
    // Limpiar limitadores por IP
    for (const [ip, limiter] of ipRateLimiters.entries()) {
        if (now - limiter.lastFilled > maxAgeMs) {
            ipRateLimiters.delete(ip);
        }
    }
    
    // Limpiar limitadores por ruta
    for (const [path, limiter] of pathRateLimiters.entries()) {
        if (now - limiter.lastFilled > maxAgeMs) {
            pathRateLimiters.delete(path);
        }
    }
    
    logger.debug(`Limpieza de rate limiters: ${ipRateLimiters.size} IPs, ${pathRateLimiters.size} rutas`, 'API');
}

/**
 * Configura la limpieza periódica de rate limiters
 * @param {number} intervalMs - Intervalo entre limpiezas en ms
 */
function setupCleanupInterval(intervalMs = 1800000) { // 30 minutos por defecto
    setInterval(() => {
        cleanupRateLimiters();
    }, intervalMs);
    
    logger.info(`Limpieza automática de rate limiters configurada cada ${intervalMs/60000} minutos`, 'API');
}

// Iniciar limpieza periódica
setupCleanupInterval();

module.exports = {
    rateLimiterMiddleware,
    cleanupRateLimiters,
    DEFAULT_CONFIG,
    TokenBucket
};