/**
 * Módulo para gestionar una cola de errores de datos
 * Permite almacenar registros problemáticos para su análisis posterior
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getSecret } = require('./secrets');

// Directorio para almacenar la cola de errores
const ERROR_QUEUE_DIR = path.join(process.cwd(), 'data', 'error_queue');

// Asegurar que el directorio exista
if (!fs.existsSync(ERROR_QUEUE_DIR)) {
    fs.mkdirSync(ERROR_QUEUE_DIR, { recursive: true });
    logger.info(`Directorio para cola de errores creado: ${ERROR_QUEUE_DIR}`, 'ErrorQueue');
}

/**
 * Tipos de errores que pueden ocurrir en el procesamiento de datos
 */
const ErrorTypes = {
    VALIDATION_ERROR: 'validation_error',
    PARSING_ERROR: 'parsing_error',
    MISSING_REQUIRED_FIELD: 'missing_required_field',
    DATA_INCONSISTENCY: 'data_inconsistency',
    SCRAPER_ERROR: 'scraper_error',
    DATABASE_ERROR: 'database_error',
    UNKNOWN_ERROR: 'unknown_error'
};

/**
 * Acción a realizar con los datos en error
 */
const ErrorActions = {
    DISCARD: 'discard',          // Descartar los datos
    QUARANTINE: 'quarantine',    // Poner en cuarentena para revisión manual
    RETRY_LATER: 'retry_later',  // Reintentar procesamiento más tarde
    FIX_AUTO: 'fix_auto'         // Intentar arreglar automáticamente
};

/**
 * Agrega un elemento a la cola de errores
 * @param {string} type - Tipo de error (de ErrorTypes)
 * @param {Object} data - Datos que provocaron el error
 * @param {string} error - Mensaje o detalle del error
 * @param {string} action - Acción recomendada (de ErrorActions)
 * @param {Object} metadata - Metadatos adicionales sobre el error
 * @returns {string} - ID del error en la cola
 */
function enqueue(type, data, error, action = ErrorActions.QUARANTINE, metadata = {}) {
    const timestamp = new Date();
    const errorId = `${type}_${timestamp.getTime()}_${Math.random().toString(36).substring(2, 10)}`;
    const errorMaxSize = parseInt(getSecret('ERROR_QUEUE_MAX_SIZE', '1000'));
    
    // Crear el objeto de error
    const errorEntry = {
        id: errorId,
        type,
        timestamp: timestamp.toISOString(),
        action,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        metadata: {
            ...metadata,
            processingAttempts: 0
        },
        data
    };
    
    // Guardar el error en un archivo JSON
    const errorFilePath = path.join(ERROR_QUEUE_DIR, `${errorId}.json`);
    fs.writeFileSync(errorFilePath, JSON.stringify(errorEntry, null, 2));
    
    // Registrar el error en el log
    logger.error(`Datos con error añadidos a la cola: ${errorId} [${type}] - ${errorEntry.error}`, 'ErrorQueue');
    logger.metric('error_queue_entries', 1, 'ErrorQueue');
    
    // Limpiar errores antiguos si se supera el tamaño máximo
    cleanupQueue(errorMaxSize);
    
    return errorId;
}

/**
 * Obtiene un elemento de la cola de errores por ID
 * @param {string} errorId - ID del error a obtener
 * @returns {Object|null} - Elemento de la cola o null si no existe
 */
function getById(errorId) {
    try {
        const errorFilePath = path.join(ERROR_QUEUE_DIR, `${errorId}.json`);
        if (fs.existsSync(errorFilePath)) {
            const errorData = JSON.parse(fs.readFileSync(errorFilePath, 'utf8'));
            return errorData;
        }
    } catch (err) {
        logger.error(`Error al leer elemento de la cola: ${err.message}`, 'ErrorQueue');
    }
    
    return null;
}

/**
 * Obtiene todos los elementos de la cola de errores
 * @param {Object} filters - Filtros a aplicar
 * @returns {Array} - Lista de elementos de la cola
 */
function getAll(filters = {}) {
    try {
        // Leer todos los archivos en el directorio
        const files = fs.readdirSync(ERROR_QUEUE_DIR);
        
        // Filtrar por archivos JSON
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        
        // Leer y parsear cada archivo
        let items = jsonFiles.map(file => {
            try {
                const filePath = path.join(ERROR_QUEUE_DIR, file);
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (err) {
                logger.error(`Error al leer archivo de cola ${file}: ${err.message}`, 'ErrorQueue');
                return null;
            }
        }).filter(item => item !== null);
        
        // Aplicar filtros si los hay
        if (filters.type) {
            items = items.filter(item => item.type === filters.type);
        }
        
        if (filters.action) {
            items = items.filter(item => item.action === filters.action);
        }
        
        if (filters.fromDate) {
            const fromDate = new Date(filters.fromDate);
            items = items.filter(item => new Date(item.timestamp) >= fromDate);
        }
        
        if (filters.toDate) {
            const toDate = new Date(filters.toDate);
            items = items.filter(item => new Date(item.timestamp) <= toDate);
        }
        
        // Ordenar por timestamp (más reciente primero)
        items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Aplicar paginación si se especifica
        if (filters.limit && filters.limit > 0) {
            const offset = filters.offset || 0;
            items = items.slice(offset, offset + filters.limit);
        }
        
        return items;
        
    } catch (err) {
        logger.error(`Error al obtener elementos de la cola: ${err.message}`, 'ErrorQueue');
        return [];
    }
}

/**
 * Actualiza el estado de un elemento en la cola de errores
 * @param {string} errorId - ID del error a actualizar
 * @param {Object} updates - Campos a actualizar
 * @returns {boolean} - True si se actualizó correctamente
 */
function updateById(errorId, updates) {
    try {
        const errorFilePath = path.join(ERROR_QUEUE_DIR, `${errorId}.json`);
        
        // Verificar que el archivo existe
        if (!fs.existsSync(errorFilePath)) {
            logger.warn(`No se encontró el error ${errorId} para actualizar`, 'ErrorQueue');
            return false;
        }
        
        // Leer el error actual
        const errorData = JSON.parse(fs.readFileSync(errorFilePath, 'utf8'));
        
        // Actualizar campos
        const updatedErrorData = {
            ...errorData,
            ...updates,
            metadata: {
                ...errorData.metadata,
                ...(updates.metadata || {}),
                lastUpdated: new Date().toISOString()
            }
        };
        
        // Guardar cambios
        fs.writeFileSync(errorFilePath, JSON.stringify(updatedErrorData, null, 2));
        logger.info(`Elemento de cola actualizado: ${errorId}`, 'ErrorQueue');
        
        return true;
        
    } catch (err) {
        logger.error(`Error al actualizar elemento de la cola ${errorId}: ${err.message}`, 'ErrorQueue');
        return false;
    }
}

/**
 * Elimina un elemento de la cola de errores
 * @param {string} errorId - ID del error a eliminar
 * @returns {boolean} - True si se eliminó correctamente
 */
function removeById(errorId) {
    try {
        const errorFilePath = path.join(ERROR_QUEUE_DIR, `${errorId}.json`);
        
        // Verificar que el archivo existe
        if (!fs.existsSync(errorFilePath)) {
            logger.warn(`No se encontró el error ${errorId} para eliminar`, 'ErrorQueue');
            return false;
        }
        
        // Eliminar archivo
        fs.unlinkSync(errorFilePath);
        logger.info(`Elemento de cola eliminado: ${errorId}`, 'ErrorQueue');
        logger.metric('error_queue_processed', 1, 'ErrorQueue');
        
        return true;
        
    } catch (err) {
        logger.error(`Error al eliminar elemento de la cola ${errorId}: ${err.message}`, 'ErrorQueue');
        return false;
    }
}

/**
 * Limpia la cola de errores, manteniendo solo un número máximo de elementos
 * @param {number} maxSize - Tamaño máximo de la cola
 * @returns {number} - Número de elementos eliminados
 */
function cleanupQueue(maxSize = 1000) {
    try {
        // Leer todos los archivos en el directorio
        const files = fs.readdirSync(ERROR_QUEUE_DIR);
        
        // Filtrar por archivos JSON
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        
        // Si no excedemos el máximo, no hacer nada
        if (jsonFiles.length <= maxSize) {
            return 0;
        }
        
        // Obtener información de los archivos
        const fileInfos = jsonFiles.map(file => {
            const filePath = path.join(ERROR_QUEUE_DIR, file);
            const stats = fs.statSync(filePath);
            return {
                file,
                path: filePath,
                mtime: stats.mtime
            };
        });
        
        // Ordenar por fecha de modificación (más antiguo primero)
        fileInfos.sort((a, b) => a.mtime - b.mtime);
        
        // Determinar cuántos archivos eliminar
        const toDelete = fileInfos.length - maxSize;
        
        if (toDelete <= 0) {
            return 0;
        }
        
        // Eliminar los archivos más antiguos
        let deletedCount = 0;
        for (let i = 0; i < toDelete; i++) {
            try {
                fs.unlinkSync(fileInfos[i].path);
                deletedCount++;
            } catch (err) {
                logger.warn(`No se pudo eliminar el archivo ${fileInfos[i].file}: ${err.message}`, 'ErrorQueue');
            }
        }
        
        logger.info(`Limpieza de cola: ${deletedCount} elementos antiguos eliminados`, 'ErrorQueue');
        logger.metric('error_queue_cleaned', deletedCount, 'ErrorQueue');
        
        return deletedCount;
        
    } catch (err) {
        logger.error(`Error al limpiar la cola: ${err.message}`, 'ErrorQueue');
        return 0;
    }
}

/**
 * Obtiene estadísticas de la cola de errores
 * @returns {Object} - Estadísticas de la cola
 */
function getQueueStats() {
    try {
        // Leer todos los archivos en el directorio
        const files = fs.readdirSync(ERROR_QUEUE_DIR);
        
        // Filtrar por archivos JSON
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        
        // Leer y parsear cada archivo para análisis
        const items = jsonFiles.map(file => {
            try {
                const filePath = path.join(ERROR_QUEUE_DIR, file);
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (err) {
                return null;
            }
        }).filter(item => item !== null);
        
        // Calcular estadísticas por tipo de error
        const typeStats = {};
        const actionStats = {};
        
        items.forEach(item => {
            // Contar por tipo
            typeStats[item.type] = (typeStats[item.type] || 0) + 1;
            
            // Contar por acción
            actionStats[item.action] = (actionStats[item.action] || 0) + 1;
        });
        
        // Encontrar el error más antiguo y más reciente
        let oldestTimestamp = Date.now();
        let newestTimestamp = 0;
        
        items.forEach(item => {
            const timestamp = new Date(item.timestamp).getTime();
            if (timestamp < oldestTimestamp) {
                oldestTimestamp = timestamp;
            }
            if (timestamp > newestTimestamp) {
                newestTimestamp = timestamp;
            }
        });
        
        return {
            totalItems: items.length,
            typeBreakdown: typeStats,
            actionBreakdown: actionStats,
            oldest: items.length > 0 ? new Date(oldestTimestamp).toISOString() : null,
            newest: items.length > 0 ? new Date(newestTimestamp).toISOString() : null
        };
        
    } catch (err) {
        logger.error(`Error al obtener estadísticas de la cola: ${err.message}`, 'ErrorQueue');
        return {
            totalItems: 0,
            typeBreakdown: {},
            actionBreakdown: {},
            oldest: null,
            newest: null,
            error: err.message
        };
    }
}

/**
 * Procesa los elementos de la cola que tengan una acción específica
 * @param {string} action - Acción a procesar (de ErrorActions)
 * @param {Function} processorFn - Función que procesa cada elemento
 * @returns {Object} - Resultado del procesamiento
 */
async function processQueue(action, processorFn) {
    // Obtener elementos con la acción especificada
    const items = getAll({ action });
    
    if (items.length === 0) {
        logger.info(`No hay elementos con acción ${action} para procesar`, 'ErrorQueue');
        return { processed: 0, success: 0, failed: 0 };
    }
    
    logger.info(`Procesando ${items.length} elementos con acción ${action}`, 'ErrorQueue');
    
    let success = 0;
    let failed = 0;
    
    // Procesar cada elemento
    for (const item of items) {
        try {
            // Actualizar contador de intentos
            updateById(item.id, {
                metadata: {
                    processingAttempts: (item.metadata?.processingAttempts || 0) + 1,
                    lastProcessingAttempt: new Date().toISOString()
                }
            });
            
            // Procesar el elemento
            const result = await processorFn(item);
            
            if (result.success) {
                // Si el procesamiento fue exitoso, eliminar de la cola
                removeById(item.id);
                success++;
            } else {
                // Si falló, actualizar con el resultado
                updateById(item.id, {
                    metadata: {
                        processingResult: result.error || 'Unknown processing error',
                        nextAction: result.nextAction || item.action
                    },
                    action: result.nextAction || item.action
                });
                failed++;
            }
        } catch (err) {
            // Error durante el procesamiento
            logger.error(`Error al procesar elemento ${item.id}: ${err.message}`, 'ErrorQueue');
            
            updateById(item.id, {
                metadata: {
                    processingError: err.message,
                    processingErrorStack: err.stack
                }
            });
            
            failed++;
        }
    }
    
    logger.info(`Procesamiento completado: ${success} exitosos, ${failed} fallidos`, 'ErrorQueue');
    
    return { processed: items.length, success, failed };
}

module.exports = {
    enqueue,
    getById,
    getAll,
    updateById,
    removeById,
    cleanupQueue,
    getQueueStats,
    processQueue,
    ErrorTypes,
    ErrorActions
};