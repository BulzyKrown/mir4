/**
 * Sistema de caché en memoria para la API de rankings MIR4
 */

const logger = require('./logger');
const { CONFIG } = require('./config');

// Configuración de caché
const CACHE_CONFIG = {
    // Tiempo de vida de los datos en caché para consultas generales (5 minutos en milisegundos)
    TTL: 5 * 60 * 1000,
    // Tiempo de vida del caché para servidores (12 horas en milisegundos)
    SERVER_TTL: CONFIG.SERVER_CACHE_TTL,
    // Límite de entradas en el caché (evita crecimiento excesivo de memoria)
    MAX_ENTRIES: 50
};

// Cache principal para datos de ranking
let rankingCache = {
    data: null,          // Datos del ranking
    timestamp: null,     // Hora en que se almacenó
    hits: 0              // Contador de hits al caché
};

// Cache para resultados de servidores específicos
const serverCache = new Map();

// Cache para consultas específicas (server, clan, class, range, etc.)
const queryCache = new Map();

/**
 * Verifica si el caché ha expirado
 * @param {number} timestamp - Timestamp cuando se almacenó en caché
 * @param {number} ttl - Tiempo de vida del caché en milisegundos
 * @returns {boolean} - true si el caché expiró, false si sigue válido
 */
function isCacheExpired(timestamp, ttl = CACHE_CONFIG.TTL) {
    if (!timestamp) return true;
    return Date.now() - timestamp > ttl;
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
 * Almacena datos de un servidor específico en caché
 * @param {string} serverKey - Clave del servidor (regionName_serverName)
 * @param {Array} data - Datos a almacenar en caché
 */
function setServerCache(serverKey, data) {
    // Limpiar caché si excede el tamaño máximo
    if (serverCache.size >= CACHE_CONFIG.MAX_ENTRIES) {
        // Encontrar la entrada más antigua para eliminar
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [k, entry] of serverCache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = k;
            }
        }
        
        if (oldestKey) {
            serverCache.delete(oldestKey);
            logger.warn(`Eliminada entrada de servidor antigua: ${oldestKey}`, 'Cache');
        }
    }
    
    // Almacenar nueva entrada
    serverCache.set(serverKey, {
        data,
        timestamp: Date.now(),
        hits: 0
    });
    
    logger.cache(`Datos de servidor cacheados: ${serverKey} - ${data.length} registros`);
}

/**
 * Obtiene datos de un servidor específico del caché
 * @param {string} serverKey - Clave del servidor (regionName_serverName)
 * @returns {Array|null} - Datos en caché o null si no existen o expiraron
 */
function getServerCache(serverKey) {
    if (!serverCache.has(serverKey)) {
        logger.debug(`MISS servidor: ${serverKey}`, 'Cache');
        return null;
    }
    
    const cacheEntry = serverCache.get(serverKey);
    
    // Usar TTL específico para servidores (12 horas)
    if (isCacheExpired(cacheEntry.timestamp, CACHE_CONFIG.SERVER_TTL)) {
        logger.warn(`Datos de servidor expirados: ${serverKey}`, 'Cache');
        serverCache.delete(serverKey);
        return null;
    }
    
    cacheEntry.hits++;
    logger.success(`HIT servidor: ${serverKey} (hits: ${cacheEntry.hits})`, 'Cache');
    return cacheEntry.data;
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
    
    serverCache.clear();
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
        serverCache: {
            size: serverCache.size,
            keys: Array.from(serverCache.keys()),
            ttlMs: CACHE_CONFIG.SERVER_TTL
        },
        queryCache: {
            size: queryCache.size,
            maxSize: CACHE_CONFIG.MAX_ENTRIES,
            keys: Array.from(queryCache.keys()),
            ttlMs: CACHE_CONFIG.TTL
        },
        config: {
            ttlMs: CACHE_CONFIG.TTL
        }
    };
}

module.exports = {
    setMainCache,
    getMainCache,
    setServerCache,
    getServerCache,
    setQueryCache,
    getQueryCache,
    clearCache,
    getCacheStats,
    CACHE_CONFIG
};