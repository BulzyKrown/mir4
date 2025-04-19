/**
 * Sistema de caché en memoria para la API de rankings MIR4
 */

const logger = require('./logger');

// Configuración de caché
const CACHE_CONFIG = {
    // Tiempo de vida de los datos en caché (5 minutos en milisegundos)
    TTL: 5 * 60 * 1000,
    // Límite de entradas en el caché (evita crecimiento excesivo de memoria)
    MAX_ENTRIES: 50
};

// Cache principal para datos de ranking
let rankingCache = {
    data: null,          // Datos del ranking
    timestamp: null,     // Hora en que se almacenó
    hits: 0              // Contador de hits al caché
};

// Cache para consultas específicas (server, clan, class, range, etc.)
const queryCache = new Map();

/**
 * Verifica si el caché ha expirado
 * @param {number} timestamp - Timestamp cuando se almacenó en caché
 * @returns {boolean} - true si el caché expiró, false si sigue válido
 */
function isCacheExpired(timestamp) {
    if (!timestamp) return true;
    return Date.now() - timestamp > CACHE_CONFIG.TTL;
}

/**
 * Almacena datos en el caché principal
 * @param {Array} data - Datos a almacenar en caché
 */
function setMainCache(data) {
    rankingCache = {
        data: data,
        timestamp: Date.now(),
        hits: 0
    };
    logger.cache(`Datos principales almacenados: ${data.length} registros`);
}

/**
 * Obtiene datos del caché principal si son válidos
 * @returns {Array|null} - Datos en caché o null si no hay o están expirados
 */
function getMainCache() {
    if (!rankingCache.data || isCacheExpired(rankingCache.timestamp)) {
        logger.cache(`Caché principal expirado o vacío`);
        return null;
    }
    
    rankingCache.hits++;
    logger.success(`HIT caché principal (hits: ${rankingCache.hits})`, 'Cache');
    return rankingCache.data;
}

/**
 * Almacena resultados de una consulta específica en caché
 * @param {string} key - Clave única para identificar la consulta
 * @param {any} data - Datos a almacenar en caché
 */
function setQueryCache(key, data) {
    // Limpiar caché si excede el tamaño máximo
    if (queryCache.size >= CACHE_CONFIG.MAX_ENTRIES) {
        // Encontrar la entrada más antigua para eliminar
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [k, entry] of queryCache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = k;
            }
        }
        
        if (oldestKey) {
            queryCache.delete(oldestKey);
            logger.warn(`Eliminada entrada antigua: ${oldestKey}`, 'Cache');
        }
    }
    
    // Almacenar nueva entrada
    queryCache.set(key, {
        data,
        timestamp: Date.now(),
        hits: 0
    });
    
    logger.cache(`Consulta cacheada: ${key}`);
}

/**
 * Obtiene resultados de una consulta específica del caché
 * @param {string} key - Clave de la consulta
 * @returns {any|null} - Datos en caché o null si no existen o expiraron
 */
function getQueryCache(key) {
    if (!queryCache.has(key)) {
        logger.debug(`MISS consulta: ${key}`, 'Cache');
        return null;
    }
    
    const cacheEntry = queryCache.get(key);
    
    if (isCacheExpired(cacheEntry.timestamp)) {
        logger.warn(`Consulta expirada: ${key}`, 'Cache');
        queryCache.delete(key);
        return null;
    }
    
    cacheEntry.hits++;
    logger.success(`HIT consulta: ${key} (hits: ${cacheEntry.hits})`, 'Cache');
    return cacheEntry.data;
}

/**
 * Limpia todo el caché
 */
function clearCache() {
    rankingCache = {
        data: null,
        timestamp: null,
        hits: 0
    };
    
    queryCache.clear();
    logger.cache(`Caché limpiado completamente`);
}

/**
 * Devuelve estadísticas del caché
 * @returns {Object} - Estadísticas del caché
 */
function getCacheStats() {
    return {
        mainCache: {
            active: rankingCache.data !== null,
            ageMs: rankingCache.timestamp ? Date.now() - rankingCache.timestamp : null,
            hits: rankingCache.hits,
            recordCount: rankingCache.data ? rankingCache.data.length : 0
        },
        queryCache: {
            size: queryCache.size,
            maxSize: CACHE_CONFIG.MAX_ENTRIES,
            keys: Array.from(queryCache.keys())
        },
        config: {
            ttlMs: CACHE_CONFIG.TTL
        }
    };
}

module.exports = {
    setMainCache,
    getMainCache,
    setQueryCache,
    getQueryCache,
    clearCache,
    getCacheStats,
    CACHE_CONFIG
};