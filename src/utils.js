/**
 * Utilidades para el scraping de rankings MIR4
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, SELECTORS } = require('./config');
const logger = require('./logger');
const crypto = require('crypto');

/**
 * Extrae la URL de imagen del estilo CSS background-image
 * @param {string} styleAttr - Atributo de estilo que contiene la URL de imagen
 * @returns {string|null} - URL extraída o null si no se encuentra
 */
function extractImageUrlFromStyle(styleAttr) {
    if (!styleAttr) return null;
    
    try {
        // Usar el regex definido en los selectores configurables
        const match = styleAttr.match(SELECTORS.STYLE_BACKGROUND_REGEX);
        return match ? match[1] : null;
    } catch (error) {
        logger.error(`Error al extraer URL de imagen: ${error.message}`, 'Utils');
        return null;
    }
}

/**
 * Guarda el HTML scrapeado en un archivo
 * @param {string} html - Contenido HTML a guardar
 * @param {string} [customPrefix] - Prefijo personalizado para el nombre del archivo
 * @returns {string} - Ruta del archivo guardado
 */
async function saveScrapedHtml(html, customPrefix = 'scraped_ranking') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${customPrefix}_${timestamp}.html`;
    const scrapedPagesDir = path.join(process.cwd(), CONFIG.SCRAPED_PAGES_DIR);
    const filePath = path.join(scrapedPagesDir, fileName);

    // Crear directorio si no existe
    if (!fs.existsSync(scrapedPagesDir)) {
        fs.mkdirSync(scrapedPagesDir, { recursive: true });
        logger.info(`Directorio creado: ${CONFIG.SCRAPED_PAGES_DIR}`, 'Sistema');
    }

    // Guardar el HTML
    fs.writeFileSync(filePath, html);
    logger.success(`HTML guardado: ${fileName}`, 'Sistema');
    
    // Registrar métrica
    logger.metric('html_saved', 1, 'Utils');
    
    return filePath;
}

/**
 * Elimina archivos HTML antiguos y archivos PNG del directorio de páginas scrapeadas y del directorio raíz
 */
function cleanupOldFiles() {
    try {
        // Limpieza de archivos HTML y PNG en el directorio de páginas scrapeadas
        const scrapedPagesDir = path.join(process.cwd(), CONFIG.SCRAPED_PAGES_DIR);
        let removedHtmlCount = 0;
        let removedScrapedPngCount = 0;
        let removedRootPngCount = 0;
        
        // Verificar si el directorio existe
        if (fs.existsSync(scrapedPagesDir)) {
            const currentTime = new Date().getTime();
            const maxAgeMs = CONFIG.MAX_FILE_AGE_MS;
            
            // Leer todos los archivos en el directorio
            const files = fs.readdirSync(scrapedPagesDir);
            logger.info(`Revisando ${files.length} archivos para limpieza en ${CONFIG.SCRAPED_PAGES_DIR}...`, 'Sistema');
            
            files.forEach(file => {
                const filePath = path.join(scrapedPagesDir, file);
                
                // Verificar si es un archivo HTML o PNG
                if (file.endsWith('.html')) {
                    const stats = fs.statSync(filePath);
                    const fileAge = currentTime - stats.mtimeMs;
                    
                    // Si el archivo es más antiguo que el tiempo máximo permitido, eliminarlo
                    if (fileAge > maxAgeMs) {
                        fs.unlinkSync(filePath);
                        logger.warn(`Archivo HTML eliminado: ${file} (antigüedad: ${Math.round(fileAge/1000)} segundos)`, 'Sistema');
                        removedHtmlCount++;
                    }
                } else if (file.endsWith('.png')) {
                    // Eliminar archivos PNG dentro del directorio scraped_pages
                    fs.unlinkSync(filePath);
                    logger.warn(`Archivo PNG eliminado de ${CONFIG.SCRAPED_PAGES_DIR}: ${file}`, 'Sistema');
                    removedScrapedPngCount++;
                }
            });
        } else {
            logger.warn(`El directorio ${CONFIG.SCRAPED_PAGES_DIR} no existe.`, 'Sistema');
        }
        
        // Limpieza de archivos PNG en el directorio raíz
        const rootDir = process.cwd();
        
        // Leer todos los archivos en el directorio raíz
        const rootFiles = fs.readdirSync(rootDir);
        logger.info(`Revisando archivos PNG en el directorio raíz...`, 'Sistema');
        
        rootFiles.forEach(file => {
            // Verificar si es un archivo PNG
            if (file.endsWith('.png')) {
                const filePath = path.join(rootDir, file);
                
                // Eliminar archivo PNG del directorio raíz
                fs.unlinkSync(filePath);
                logger.warn(`Archivo PNG eliminado del directorio raíz: ${file}`, 'Sistema');
                removedRootPngCount++;
            }
        });
        
        // Mostrar resumen de la limpieza
        const totalRemoved = removedHtmlCount + removedScrapedPngCount + removedRootPngCount;
        if (totalRemoved > 0) {
            logger.success(`Limpieza completada: ${removedHtmlCount} archivos HTML, ${removedScrapedPngCount} archivos PNG de ${CONFIG.SCRAPED_PAGES_DIR} y ${removedRootPngCount} archivos PNG del directorio raíz eliminados`, 'Sistema');
        } else {
            logger.info('Limpieza completada: No se eliminaron archivos', 'Sistema');
        }
    } catch (error) {
        logger.error(`Error al limpiar archivos: ${error.message}`, 'Sistema');
    }
}

/**
 * Calcula el tiempo de espera para un reintento usando backoff exponencial
 * @param {number} retryCount - Número de reintentos realizados hasta ahora
 * @param {number} baseDelayMs - Tiempo base de espera en milisegundos
 * @param {number} maxDelayMs - Tiempo máximo de espera en milisegundos
 * @param {boolean} addJitter - Si se debe añadir un factor aleatorio para evitar sincronización
 * @returns {number} - Tiempo de espera en milisegundos
 */
function calculateExponentialBackoff(retryCount, baseDelayMs = 1000, maxDelayMs = 60000, addJitter = true) {
    // Cálculo base de backoff exponencial: baseDelay * 2^retryCount
    let delay = baseDelayMs * Math.pow(2, retryCount);
    
    // Aplicar un límite máximo
    delay = Math.min(delay, maxDelayMs);
    
    // Añadir jitter (variación aleatoria) para evitar sincronización de reintentos
    if (addJitter) {
        // Añadir hasta un 30% de variación aleatoria (entre 0.85 y 1.15 veces el delay)
        const jitterFactor = 0.85 + (Math.random() * 0.3);
        delay = Math.floor(delay * jitterFactor);
    }
    
    return delay;
}

/**
 * Ejecuta una función con reintentos automáticos usando backoff exponencial
 * @param {Function} fn - Función asíncrona a ejecutar
 * @param {Object} options - Opciones de configuración
 * @param {number} options.maxRetries - Número máximo de reintentos
 * @param {number} options.baseDelayMs - Tiempo base de espera entre reintentos
 * @param {number} options.maxDelayMs - Tiempo máximo de espera entre reintentos
 * @param {boolean} options.addJitter - Si se debe añadir variación aleatoria
 * @param {Function} options.onRetry - Callback ejecutado antes de cada reintento
 * @param {Function} options.shouldRetry - Función para decidir si se debe reintentar según el error
 * @param {Array} args - Argumentos para pasar a la función
 * @returns {Promise<*>} - El resultado de la función ejecutada con éxito
 * @throws {Error} - Si se agotan los reintentos sin éxito
 */
async function withRetry(fn, options = {}, ...args) {
    const {
        maxRetries = 5,
        baseDelayMs = 1000,
        maxDelayMs = 60000,
        addJitter = true,
        onRetry = null,
        shouldRetry = () => true
    } = options;
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // En el primer intento no es un reintento
            if (attempt > 0) {
                logger.warn(`Reintento ${attempt}/${maxRetries} para ${fn.name || 'función anónima'}`, 'Retry');
            }
            
            // Ejecutar la función con los argumentos
            return await fn(...args);
            
        } catch (error) {
            lastError = error;
            
            // Si es el último intento o no debemos reintentar para este error, propagar el error
            if (attempt >= maxRetries || !shouldRetry(error)) {
                if (attempt >= maxRetries) {
                    logger.error(`Agotados los reintentos (${maxRetries}) para ${fn.name || 'función anónima'}: ${error.message}`, 'Retry');
                } else {
                    logger.error(`No se reintentará para este error: ${error.message}`, 'Retry');
                }
                throw error;
            }
            
            // Calcular el tiempo de espera para el próximo reintento
            const delayMs = calculateExponentialBackoff(attempt, baseDelayMs, maxDelayMs, addJitter);
            
            logger.warn(`Error en ${fn.name || 'función anónima'} (reintento ${attempt+1}/${maxRetries} en ${delayMs}ms): ${error.message}`, 'Retry');
            
            // Ejecutar callback onRetry si existe
            if (typeof onRetry === 'function') {
                await onRetry(attempt, delayMs, error);
            }
            
            // Esperar antes de reintentar
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    
    // Este punto nunca debería alcanzarse debido al manejo de errores anterior,
    // pero por seguridad lanzamos el último error registrado
    throw lastError || new Error(`Error desconocido después de ${maxRetries} reintentos`);
}

/**
 * Calcula la similitud entre dos objetos de detalles de personaje
 * @param {Object} existingDetails - Detalles existentes del personaje
 * @param {Object} newDetails - Nuevos detalles del personaje
 * @returns {number} - Porcentaje de similitud (0-100)
 */
function calculateDetailsSimilarity(existingDetails, newDetails) {
    const keyFields = [
        'level', 'prestigeLevel', 'equipmentScore', 
        'spiritScore', 'energyScore', 'magicalStoneScore',
        'codexScore', 'trophyScore', 'ethics'
    ];
    
    let totalFields = keyFields.length;
    let matchingFields = 0;
    
    // Comparar campos numéricos
    for (const field of keyFields) {
        // Si los valores son idénticos o muy cercanos (diferencia menor al 5%)
        if (existingDetails[field] === newDetails[field] || 
            (existingDetails[field] > 0 && newDetails[field] > 0 && 
             Math.abs(existingDetails[field] - newDetails[field]) / existingDetails[field] < 0.05)) {
            matchingFields++;
        }
    }
    
    // Comparar logros si existen
    if (existingDetails.achievements && newDetails.achievements) {
        totalFields++;
        
        // Si los arrays de logros tienen longitud similar y al menos 80% de logros coinciden
        const existingAchievements = Array.isArray(existingDetails.achievements) ? 
            existingDetails.achievements : JSON.parse(existingDetails.achievements || '[]');
            
        const newAchievements = Array.isArray(newDetails.achievements) ? 
            newDetails.achievements : [];
            
        if (Math.abs(existingAchievements.length - newAchievements.length) <= 2) {
            const similarAchievements = existingAchievements.filter(a => 
                newAchievements.some(na => na.id === a.id || na.name === a.name)
            ).length;
            
            if (existingAchievements.length === 0 || 
                similarAchievements / existingAchievements.length >= 0.8) {
                matchingFields++;
            }
        }
    }
    
    // Calcular porcentaje de similitud
    return (matchingFields / totalFields) * 100;
}

/**
 * Genera un hash simple para un objeto o array
 * @param {Object|Array} data - Los datos a hashear
 * @returns {number} - Valor hash calculado
 */
function generateSimpleHash(data) {
    try {
        // Convertir a JSON y luego calcular hash básico
        const str = JSON.stringify(data);
        
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convertir a entero de 32 bits
        }
        
        return hash;
    } catch (error) {
        logger.error(`Error al generar hash: ${error.message}`, 'Utils');
        return 0;
    }
}

/**
 * Compara dos conjuntos de datos y determina si son suficientemente similares
 * @param {Array|Object} dataA - Primer conjunto de datos
 * @param {Array|Object} dataB - Segundo conjunto de datos
 * @param {Object} options - Opciones de comparación
 * @param {string[]} options.keyFields - Campos clave a considerar para la comparación
 * @param {number} options.threshold - Umbral de similitud para considerar los datos similares (0-100)
 * @returns {Object} - Resultado de la comparación con métricas
 */
function compareDataSets(dataA, dataB, options = {}) {
    const {
        keyFields = null,
        threshold = 80 // Umbral de similitud por defecto: 80%
    } = options;
    
    // Si alguno de los conjuntos es nulo o vacío
    if (!dataA || !dataB) {
        return {
            similar: false,
            similarityPercentage: 0,
            reason: 'Uno de los conjuntos de datos es nulo',
            hashA: null,
            hashB: null
        };
    }
    
    // Si son arrays, comparamos sus longitudes
    if (Array.isArray(dataA) && Array.isArray(dataB)) {
        // Si tienen longitudes muy diferentes, no son similares
        const lengthA = dataA.length;
        const lengthB = dataB.length;
        const lengthDiffPercentage = Math.min(lengthA, lengthB) / Math.max(lengthA, lengthB) * 100;
        
        if (lengthDiffPercentage < threshold * 0.8) { // 80% del umbral
            return {
                similar: false,
                similarityPercentage: lengthDiffPercentage,
                reason: `Longitudes muy diferentes: ${lengthA} vs ${lengthB}`,
                hashA: null,
                hashB: null
            };
        }
        
        // Si no se especificaron campos clave, usamos hashes para comparación
        if (!keyFields || keyFields.length === 0) {
            const hashA = generateSimpleHash(dataA);
            const hashB = generateSimpleHash(dataB);
            
            // Comparación simple de hashes
            const similar = hashA === hashB;
            
            return {
                similar,
                similarityPercentage: similar ? 100 : 0,
                reason: similar ? 'Hashes idénticos' : 'Hashes diferentes',
                hashA,
                hashB
            };
        }
        
        // Comparación basada en campos clave
        // Limitar la comparación a un máximo de 100 elementos para eficiencia
        const limit = Math.min(100, Math.max(lengthA, lengthB));
        let matches = 0;
        
        for (let i = 0; i < Math.min(limit, lengthA); i++) {
            // Buscar un elemento similar en el otro conjunto
            const itemA = dataA[i];
            
            const matchB = dataB.find(itemB => {
                // Contar cuántos campos clave coinciden
                let matchingFields = 0;
                
                for (const field of keyFields) {
                    if (itemA[field] === itemB[field]) {
                        matchingFields++;
                    }
                }
                
                // Considerar una coincidencia si al menos el 80% de los campos clave coinciden
                return matchingFields / keyFields.length >= 0.8;
            });
            
            if (matchB) {
                matches++;
            }
        }
        
        const similarityPercentage = (matches / Math.min(limit, lengthA)) * 100;
        const similar = similarityPercentage >= threshold;
        
        return {
            similar,
            similarityPercentage,
            reason: similar ? `${matches} elementos coincidentes de ${Math.min(limit, lengthA)}` : `Insuficientes coincidencias (${matches}/${Math.min(limit, lengthA)})`,
            matches,
            total: Math.min(limit, lengthA)
        };
    }
    
    // Si no son arrays, simplemente comparamos sus hashes
    const hashA = generateSimpleHash(dataA);
    const hashB = generateSimpleHash(dataB);
    
    const similar = hashA === hashB;
    
    return {
        similar,
        similarityPercentage: similar ? 100 : 0,
        reason: similar ? 'Objetos idénticos' : 'Objetos diferentes',
        hashA,
        hashB
    };
}

/**
 * Crea un algoritmo de backoff exponencial para reintentos
 * @param {Object} options - Opciones de configuración
 * @returns {Function} - Función para ejecutar con reintentos
 */
function createExponentialBackoff(options = {}) {
    const defaultOptions = {
        maxRetries: 5,
        initialDelay: 1000,  // 1 segundo
        maxDelay: 60000,     // 1 minuto
        factor: 2,           // Factor de crecimiento exponencial
        jitter: 0.2,         // Factor de aleatoriedad (0 a 1)
        onRetry: (attempt, error) => {
            logger.warn(`Intento ${attempt}: Error - ${error.message}`, 'Backoff');
        },
        retryableErrors: null // Función para determinar si un error es reintentable
    };

    const config = { ...defaultOptions, ...options };

    /**
     * Ejecuta una función con reintentos usando backoff exponencial
     * @param {Function} fn - Función a ejecutar (debe devolver una promesa)
     * @param {any} context - Contexto para registrar en logs
     * @returns {Promise<any>} - Resultado de la función
     */
    return async function executeWithRetries(fn, context = '') {
        let retries = 0;
        let delay = config.initialDelay;
        
        while (true) {
            try {
                return await fn();
            } catch (error) {
                retries++;
                
                // Si superamos el número máximo de reintentos, lanzar el error
                if (retries >= config.maxRetries) {
                    logger.error(`Error después de ${retries} intentos: ${error.message}`, 'Backoff');
                    throw error;
                }
                
                // Si hay una función para filtrar errores reintentables y este no lo es, lanzar
                if (config.retryableErrors && !config.retryableErrors(error)) {
                    logger.error(`Error no reintentable: ${error.message}`, 'Backoff');
                    throw error;
                }
                
                // Calcular el próximo delay con jitter (variación aleatoria)
                const jitterAmount = delay * config.jitter;
                const jitteredDelay = Math.floor(
                    delay - (jitterAmount / 2) + (Math.random() * jitterAmount)
                );
                
                // Llamar al callback onRetry si existe
                if (config.onRetry) {
                    config.onRetry(retries, error, context);
                }
                
                logger.warn(`⏳ Backoff: esperando ${jitteredDelay}ms antes del reintento ${retries}/${config.maxRetries} para ${context}`, 'Backoff');
                
                // Esperar antes del siguiente intento
                await new Promise(resolve => setTimeout(resolve, jitteredDelay));
                
                // Incrementar el delay para el siguiente intento (exponencial)
                delay = Math.min(delay * config.factor, config.maxDelay);
            }
        }
    };
}

/**
 * Genera un hash MD5 de los datos proporcionados
 * @param {any} data - Datos para generar hash
 * @returns {string} - Hash MD5 como string hexadecimal
 */
function generateHash(data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Crea un delay con tiemOut (Promise)
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise} - Promesa que se resuelve después del tiempo indicado
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Intenta parsear un string a JSON, devuelve valor por defecto si falla
 * @param {string} str - String a parsear
 * @param {any} defaultValue - Valor por defecto si falla el parsing
 * @returns {any} - Objeto parseado o valor por defecto
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return defaultValue;
    }
}

module.exports = {
    extractImageUrlFromStyle,
    saveScrapedHtml,
    cleanupOldFiles,
    calculateExponentialBackoff,
    withRetry,
    generateSimpleHash,
    compareDataSets,
    calculateDetailsSimilarity,
    createExponentialBackoff,
    generateHash,
    delay,
    safeJsonParse
};