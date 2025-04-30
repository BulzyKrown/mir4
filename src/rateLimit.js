/**
 * Módulo para gestionar límites de tasa (rate limiting) para la API
 * Protege contra uso excesivo y abuse de la API
 */

const logger = require('./logger');

// Configuración de límites por defecto
const DEFAULT_LIMITS = {
    // Límite general para todas las rutas
    global: {
        windowMs: 60 * 1000,         // 1 minuto
        maxRequests: 60,             // 60 solicitudes por minuto
        message: 'Demasiadas solicitudes, por favor intente nuevamente en un minuto.'
    },
    // Límite para rutas específicas
    routes: {
        '/api/refresh': {
            windowMs: 5 * 60 * 1000,  // 5 minutos
            maxRequests: 1,           // 1 solicitud cada 5 minutos
            message: 'Operación de actualización limitada a una vez cada 5 minutos.'
        },
        '/api/cache/clear': {
            windowMs: 60 * 1000,      // 1 minuto
            maxRequests: 2,           // 2 solicitudes por minuto
            message: 'Operación de limpieza de caché limitada a 2 veces por minuto.'
        }
    }
};

// Almacenamiento de solicitudes por IP
const requestStore = new Map();

/**
 * Limpia entradas antiguas del almacén de solicitudes
 */
function cleanupStore() {
    const now = Date.now();
    
    requestStore.forEach((data, ip) => {
        // Limpiar contadores obsoletos
        Object.keys(data.counters).forEach(route => {
            const routeData = data.counters[route];
            
            // Filtrar solo las solicitudes dentro de la ventana de tiempo activa
            const activeRequests = routeData.requests.filter(timestamp => {
                const windowMs = getRouteLimit(route).windowMs;
                return now - timestamp < windowMs;
            });
            
            if (activeRequests.length === 0) {
                // Eliminar el contador de esta ruta si no hay solicitudes activas
                delete data.counters[route];
            } else {
                // Actualizar la lista de solicitudes activas
                routeData.requests = activeRequests;
            }
        });
        
        // Si no hay contadores para esta IP, eliminarla del almacén
        if (Object.keys(data.counters).length === 0) {
            requestStore.delete(ip);
        }
    });
}

/**
 * Obtiene la configuración de límites para una ruta específica
 * @param {string} route - Ruta de la solicitud
 * @returns {Object} - Configuración de límites
 */
function getRouteLimit(route) {
    // Buscar primero una configuración específica para la ruta
    for (const [pattern, config] of Object.entries(DEFAULT_LIMITS.routes)) {
        // Coincidencia exacta de ruta
        if (route === pattern) {
            return config;
        }
        
        // En el futuro podemos agregar soporte para patrones más complejos con expresiones regulares
    }
    
    // Si no hay configuración específica, usar la configuración global
    return DEFAULT_LIMITS.global;
}

/**
 * Verifica si una solicitud debe ser limitada
 * @param {string} ip - Dirección IP del cliente
 * @param {string} route - Ruta solicitada
 * @returns {Object} - Resultado de la verificación {limited, message, resetTime}
 */
function shouldLimit(ip, route) {
    const now = Date.now();
    const routeLimit = getRouteLimit(route);
    
    // Inicializar datos de la IP si no existen
    if (!requestStore.has(ip)) {
        requestStore.set(ip, {
            counters: {},
            lastRequest: now
        });
    }
    
    const ipData = requestStore.get(ip);
    
    // Inicializar contador de ruta si no existe
    if (!ipData.counters[route]) {
        ipData.counters[route] = {
            requests: []
        };
    }
    
    const routeData = ipData.counters[route];
    
    // Filtrar las solicitudes dentro de la ventana de tiempo actual
    const windowMs = routeLimit.windowMs;
    routeData.requests = routeData.requests.filter(timestamp => now - timestamp < windowMs);
    
    // Verificar si se ha excedido el límite
    const requestsCount = routeData.requests.length;
    const limited = requestsCount >= routeLimit.maxRequests;
    
    // Si no está limitado, registrar la solicitud actual
    if (!limited) {
        routeData.requests.push(now);
        ipData.lastRequest = now;
    }
    
    // Calcular tiempo de reseteo
    let resetTime = 0;
    if (routeData.requests.length > 0) {
        // El tiempo de reseteo es cuando expire la solicitud más antigua
        resetTime = routeData.requests[0] + windowMs;
    }
    
    return {
        limited,
        message: routeLimit.message,
        resetTime,
        remaining: Math.max(0, routeLimit.maxRequests - requestsCount),
        limit: routeLimit.maxRequests,
        windowMs
    };
}

/**
 * Middleware Express para limitar tasas de solicitudes
 * @returns {Function} - Middleware Express
 */
function createRateLimiter() {
    // Ejecutar limpieza del almacén cada 5 minutos
    setInterval(cleanupStore, 5 * 60 * 1000);
    
    return function rateLimiter(req, res, next) {
        const ip = req.ip || req.connection.remoteAddress;
        const route = req.originalUrl || req.url;
        
        const result = shouldLimit(ip, route);
        
        // Añadir encabezados de límite de tasa
        res.setHeader('X-RateLimit-Limit', result.limit);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
        
        if (result.limited) {
            // Registrar evento de limitación
            logger.warn(`Rate limit alcanzado para ${ip} en ruta ${route}`, 'RateLimit');
            logger.metric('rate_limit_exceeded', 1, 'RateLimit');
            
            // Enviar respuesta de error
            res.status(429).json({
                error: 'Too Many Requests',
                message: result.message,
                retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
            });
        } else {
            next(); // Continuar con la siguiente función middleware
        }
    };
}

module.exports = {
    createRateLimiter,
    shouldLimit,
    getRouteLimit,
    cleanupStore
};