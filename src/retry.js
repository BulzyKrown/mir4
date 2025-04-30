/**
 * Módulo para manejar reintentos con backoff exponencial
 * para operaciones que podrían fallar temporalmente
 */

const logger = require('./logger');

/**
 * Configuración por defecto para los reintentos
 */
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 5,               // Número máximo de reintentos
    initialDelayMs: 1000,        // Retraso inicial en milisegundos
    maxDelayMs: 30000,           // Retraso máximo en milisegundos
    factor: 2,                   // Factor de multiplicación para el backoff
    jitter: 0.1,                 // Factor de aleatorización (0-1)
    retryableErrors: [           // Tipos de errores que justifican un reintento
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ESOCKETTIMEDOUT',
        'ENOTFOUND',
        'RATE_LIMITED',
        'NETWORK_ERROR',
        'TIMEOUT',
        'SERVER_ERROR'
    ]
};

/**
 * Verifica si un error es retryable según la configuración
 * @param {Error} error - El error a evaluar
 * @param {Object} config - Configuración con los tipos de errores retryables
 * @returns {boolean} - True si el error justifica un reintento
 */
function isRetryableError(error, config = DEFAULT_RETRY_CONFIG) {
    if (!error) return false;
    
    // Errores con código específico
    if (error.code && config.retryableErrors.includes(error.code)) {
        return true;
    }
    
    // Errores HTTP en rango 500 (error de servidor) o 429 (rate limit)
    if (error.status) {
        if (error.status === 429 || (error.status >= 500 && error.status < 600)) {
            return true;
        }
    }
    
    // Si el error tiene propiedad response (como en axios)
    if (error.response && error.response.status) {
        if (error.response.status === 429 || (error.response.status >= 500 && error.response.status < 600)) {
            return true;
        }
    }
    
    // Comprobar mensaje de error por palabras clave
    if (error.message) {
        const errorMsg = error.message.toLowerCase();
        if (
            errorMsg.includes('timeout') ||
            errorMsg.includes('econnreset') ||
            errorMsg.includes('econnrefused') ||
            errorMsg.includes('network') ||
            errorMsg.includes('rate limit') ||
            errorMsg.includes('socket hang up') ||
            errorMsg.includes('socket closed') ||
            errorMsg.includes('server error') ||
            errorMsg.includes('service unavailable')
        ) {
            return true;
        }
    }
    
    return false;
}

/**
 * Calcula el tiempo de retraso para el próximo reintento usando backoff exponencial
 * @param {number} attemptNumber - Número de intento actual (comenzando en 1)
 * @param {Object} config - Configuración para el cálculo del retraso
 * @returns {number} - Tiempo de retraso en milisegundos
 */
function calculateBackoff(attemptNumber, config = DEFAULT_RETRY_CONFIG) {
    // Aplicar backoff exponencial: delay = initial * (factor ^ attempt)
    const baseDelay = config.initialDelayMs * Math.pow(config.factor, attemptNumber - 1);
    
    // Aplicar jitter para evitar sincronización de reintentos entre múltiples clientes
    // Fórmula: baseDelay * (1 - jitter/2 + jitter*random)
    const jitterRange = config.jitter * baseDelay;
    const jitterOffset = (Math.random() * jitterRange) - (jitterRange / 2);
    
    // Aplicar jitter al delay base
    let delay = Math.max(baseDelay + jitterOffset, 0);
    
    // Limitar al máximo permitido
    delay = Math.min(delay, config.maxDelayMs);
    
    logger.debug(`Calculado retraso para reintento ${attemptNumber}: ${Math.floor(delay)}ms (base=${baseDelay}ms, jitter=${jitterOffset.toFixed(2)}ms)`, 'Retry');
    
    return Math.floor(delay);
}

/**
 * Ejecuta una función con reintentos automáticos en caso de error
 * @param {Function} fn - Función a ejecutar (debe devolver una promesa)
 * @param {Object} options - Opciones de configuración
 * @returns {Promise<any>} - Resultado de la función ejecutada
 */
async function withRetry(fn, options = {}) {
    // Combinar configuración por defecto con opciones proporcionadas
    const config = { ...DEFAULT_RETRY_CONFIG, ...options };
    let lastError;
    
    // Ejecutar la función con reintentos
    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
        try {
            // En el primer intento no se necesita esperar
            if (attempt > 1) {
                const delayMs = calculateBackoff(attempt - 1, config);
                logger.debug(`Reintento ${attempt - 1}/${config.maxRetries} después de ${delayMs}ms`, 'Retry');
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            // Ejecutar la función
            const result = await fn(attempt);
            
            // Si llegamos aquí, la función se ejecutó sin errores
            if (attempt > 1) {
                logger.success(`Operación exitosa después de ${attempt - 1} reintentos`, 'Retry');
            }
            
            return result;
            
        } catch (error) {
            lastError = error;
            
            // Verificar si el error justifica un reintento
            if (attempt <= config.maxRetries && isRetryableError(error, config)) {
                const nextDelayMs = calculateBackoff(attempt, config);
                logger.warn(`Error retryable: ${error.message}. Reintento ${attempt}/${config.maxRetries} en ${nextDelayMs}ms`, 'Retry');
                logger.metric(`retry_attempt_${attempt}`, 1, 'Retry');
            } else {
                // Si ya no hay más reintentos o el error no es retryable, propagar el error
                if (attempt > 1) {
                    logger.error(`Error después de ${attempt - 1} reintentos: ${error.message}`, 'Retry');
                }
                break;
            }
        }
    }
    
    // Si llegamos aquí, todos los reintentos fallaron
    logger.alert(`Operación fallida después de ${config.maxRetries} reintentos`, 'Retry');
    logger.metric('retry_exhausted', 1, 'Retry');
    throw lastError;
}

module.exports = {
    withRetry,
    isRetryableError,
    calculateBackoff,
    DEFAULT_RETRY_CONFIG
};