/**
 * Módulo de validación para asegurar la integridad de los datos
 * antes de su inserción en la base de datos
 */

const logger = require('./logger');
const errorQueue = require('./errorQueue');
const { withRetry } = require('./retry');

// Estrategias para manejar errores de validación
const ValidationErrorStrategies = {
    STRICT: 'strict',         // Rechaza el registro completo si hay algún error
    LOG_ONLY: 'log_only',     // Solo registra el error pero acepta el valor inválido
    DEFAULT_VALUE: 'default', // Reemplaza el valor inválido por uno predeterminado
    NULL_VALUE: 'null',       // Reemplaza el valor inválido por null
    QUEUE_ERROR: 'queue',     // Envía a la cola de errores para procesamiento posterior
    REPAIR_VALUE: 'repair'    // Intenta reparar automáticamente el valor inválido
};

// Validadores individuales
const validators = {
    /**
     * Valida que un valor sea un número entero
     * @param {any} value - Valor a validar
     * @param {Object} options - Opciones adicionales (min, max)
     * @returns {Object} Resultado de la validación {valid, value, error}
     */
    integer: (value, options = {}) => {
        // Procesar opciones
        const min = options.min !== undefined ? options.min : Number.MIN_SAFE_INTEGER;
        const max = options.max !== undefined ? options.max : Number.MAX_SAFE_INTEGER;
        const defaultValue = options.default !== undefined ? options.default : 0;
        
        // Si es undefined o null, usar el valor predeterminado
        if (value === undefined || value === null) {
            return {
                valid: false,
                value: defaultValue,
                error: 'Valor nulo o indefinido'
            };
        }
        
        let num;
        
        // Si ya es un número, usarlo directamente
        if (typeof value === 'number' && !isNaN(value)) {
            num = Math.floor(value); // Asegurar que sea entero
        } else {
            // Intentar convertir a número
            num = parseInt(value, 10);
        }
        
        // Comprobar si la conversión fue exitosa
        if (isNaN(num)) {
            return {
                valid: false,
                value: defaultValue,
                error: `No es un número entero válido: ${value}`
            };
        }
        
        // Validar rango
        if (num < min) {
            return {
                valid: false,
                value: Math.max(defaultValue, min),
                error: `Valor ${num} menor que el mínimo permitido (${min})`
            };
        }
        
        if (num > max) {
            return {
                valid: false,
                value: Math.min(defaultValue, max),
                error: `Valor ${num} mayor que el máximo permitido (${max})`
            };
        }
        
        return { valid: true, value: num };
    },
    
    /**
     * Valida que un valor sea una cadena de texto
     * @param {any} value - Valor a validar
     * @param {Object} options - Opciones adicionales (minLength, maxLength)
     * @returns {Object} - Resultado de la validación {valid, value, error}
     */
    string: (value, options = {}) => {
        const str = String(value || '');
        const minLength = options.minLength || 0;
        const maxLength = options.maxLength || Infinity;
        const defaultValue = options.default !== undefined ? options.default : '';
        
        if (str.length < minLength) {
            return {
                valid: false,
                value: defaultValue,
                error: `Longitud insuficiente: ${str.length} (mínimo: ${minLength})`
            };
        }
        
        if (str.length > maxLength) {
            // En caso de exceder el tamaño, truncamos
            return {
                valid: false,
                value: str.substring(0, maxLength),
                error: `Longitud excesiva: ${str.length} (máximo: ${maxLength})`
            };
        }
        
        return { valid: true, value: str };
    },
    
    /**
     * Valida que un valor esté dentro de un conjunto de valores permitidos
     * @param {any} value - Valor a validar
     * @param {Object} options - Opciones adicionales (allowedValues)
     * @returns {Object} - Resultado de la validación {valid, value, error}
     */
    enum: (value, options = {}) => {
        const allowedValues = options.allowedValues || [];
        const defaultValue = options.default !== undefined ? options.default : allowedValues[0];
        
        if (!allowedValues.includes(value)) {
            return {
                valid: false,
                value: defaultValue,
                error: `Valor no permitido: "${value}". Permitidos: ${allowedValues.join(', ')}`
            };
        }
        
        return { valid: true, value };
    },
    
    /**
     * Valida un objeto JSON
     * @param {any} value - Valor a validar
     * @param {Object} options - Opciones adicionales
     * @returns {Object} - Resultado de la validación {valid, value, error}
     */
    json: (value, options = {}) => {
        const defaultValue = options.default !== undefined ? options.default : {};
        
        // Si es string, intentamos parsearlo
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return { valid: true, value: parsed };
            } catch (error) {
                return {
                    valid: false,
                    value: defaultValue,
                    error: `JSON inválido: ${error.message}`
                };
            }
        }
        
        // Si ya es un objeto, lo aceptamos
        if (typeof value === 'object' && value !== null) {
            return { valid: true, value };
        }
        
        return {
            valid: false,
            value: defaultValue,
            error: `No es un objeto JSON válido`
        };
    },
    
    /**
     * Valida que un valor no sea nulo o undefined
     * @param {any} value - Valor a validar
     * @param {Object} options - Opciones adicionales
     * @returns {Object} - Resultado de la validación {valid, value, error}
     */
    required: (value, options = {}) => {
        if (value === null || value === undefined || value === '') {
            return {
                valid: false,
                value: options.default,
                error: 'Valor requerido'
            };
        }
        
        return { valid: true, value };
    },

    /**
     * Valida un servidor de MIR4
     * @param {string} serverName - Nombre del servidor a validar (ej. ASIA101)
     * @returns {Object} Resultado de la validación {valid, value, error}
     */
    serverName: (value, options = {}) => {
        const str = String(value || '');
        const serverPattern = /^(ASIA|EU|SA|NA|INMENA)\d{3}$/;
        const defaultValue = options.default !== undefined ? options.default : '';
        
        if (!serverPattern.test(str)) {
            return {
                valid: false,
                value: defaultValue,
                error: `Formato de servidor inválido: ${str}. Debe seguir el patrón: REGION + 3 dígitos`
            };
        }
        
        return { valid: true, value: str };
    },

    /**
     * Valida una clase de personaje en MIR4
     * @param {string} className - Nombre de la clase a validar
     * @returns {Object} Resultado de la validación {valid, value, error}
     */
    characterClass: (value, options = {}) => {
        const allowedClasses = options.allowedClasses || [
            'Guerrero', 'Maga', 'Taotista', 'Ballestera', 'Lancero', 'Obscuraria', 'Desconocido'
        ];
        const defaultValue = options.default !== undefined ? options.default : 'Desconocido';
        
        const className = String(value || '');
        
        if (!allowedClasses.includes(className)) {
            return {
                valid: false,
                value: defaultValue,
                error: `Clase de personaje inválida: ${className}. Permitidas: ${allowedClasses.join(', ')}`
            };
        }
        
        return { valid: true, value: className };
    }
};

// Esquemas de validación
const schemas = {
    // Esquema para validar datos de un jugador en ranking
    playerRanking: {
        rank: { 
            validator: 'integer', 
            options: { min: 1, max: 1000, default: 999 },
            required: true
        },
        character: { 
            validator: 'string', 
            options: { minLength: 1, maxLength: 100, default: 'Unknown' },
            required: true
        },
        class: { 
            validator: 'characterClass', 
            options: { 
                allowedClasses: ['Guerrero', 'Maga', 'Taotista', 'Ballestera', 'Lancero', 'Obscuraria', 'Desconocido'],
                default: 'Desconocido' 
            },
            required: false
        },
        clan: { 
            validator: 'string', 
            options: { maxLength: 100, default: '' },
            required: false
        },
        powerScore: { 
            validator: 'integer', 
            options: { min: 0, max: 10000000, default: 0 },
            required: true
        },
        server: {
            validator: 'serverName',
            options: { default: 'ASIA101' }, 
            required: false
        }
    },
    
    // Esquema para validar detalles de un personaje
    characterDetails: {
        level: { 
            validator: 'integer', 
            options: { min: 1, max: 500, default: 1 },
            required: true
        },
        prestigeLevel: { 
            validator: 'integer', 
            options: { min: 0, max: 100, default: 0 },
            required: false
        },
        equipmentScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        spiritScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        energyScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        magicalStoneScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        codexScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        trophyScore: { 
            validator: 'integer', 
            options: { min: 0, max: 5000000, default: 0 },
            required: false
        },
        ethics: { 
            validator: 'integer', 
            options: { min: 0, max: 10000, default: 0 },
            required: false
        },
        achievements: { 
            validator: 'json', 
            options: { default: [] },
            required: false
        }
    }
};

/**
 * Valida un objeto según un esquema definido
 * @param {Object} data - Datos a validar
 * @param {Object} schema - Esquema de validación
 * @param {string} strategy - Estrategia para manejar errores de validación
 * @returns {Object} - Objeto validado
 */
function validateObject(data, schema, strategy = ValidationErrorStrategies.STRICT) {
    if (!data || typeof data !== 'object') {
        const error = new Error('Los datos a validar deben ser un objeto');
        
        if (strategy === ValidationErrorStrategies.QUEUE_ERROR) {
            errorQueue.enqueue(
                errorQueue.ErrorTypes.VALIDATION_ERROR,
                data,
                error,
                errorQueue.ErrorActions.QUARANTINE,
                { schemaName: schema._name || 'unknown' }
            );
            return null;
        }
        
        throw error;
    }
    
    const validatedData = {};
    const invalidFields = [];
    let hasErrors = false;
    
    // Iterar sobre cada campo en el esquema
    for (const [field, rules] of Object.entries(schema)) {
        // Saltar propiedades que comienzan con _ (metadata)
        if (field.startsWith('_')) continue;
        
        const value = data[field];
        
        // Verificar si el campo es requerido
        if (rules.required && (value === undefined || value === null || value === '')) {
            hasErrors = true;
            const error = `Campo requerido no presente: ${field}`;
            
            invalidFields.push({
                field,
                value,
                error
            });
            
            if (strategy === ValidationErrorStrategies.STRICT) {
                throw new Error(error);
            } else if (strategy === ValidationErrorStrategies.DEFAULT_VALUE || strategy === ValidationErrorStrategies.NULL_VALUE) {
                validatedData[field] = strategy === ValidationErrorStrategies.NULL_VALUE ? null : rules.options.default;
            } else if (strategy === ValidationErrorStrategies.QUEUE_ERROR) {
                // Enviar a la cola de errores y continuar
                errorQueue.enqueue(
                    errorQueue.ErrorTypes.MISSING_REQUIRED_FIELD,
                    { field, value, schema: schema._name || 'unknown' },
                    error,
                    errorQueue.ErrorActions.QUARANTINE
                );
                validatedData[field] = rules.options.default;
            }
            
            continue;
        }
        
        // Si el campo no es requerido y no está presente, omitirlo
        if (value === undefined && !rules.required) {
            continue;
        }
        
        // Obtener el validador correspondiente
        const validator = validators[rules.validator];
        if (!validator) {
            throw new Error(`Validador no encontrado: ${rules.validator}`);
        }
        
        // Realizar la validación
        const validationResult = validator(value, rules.options);
        
        if (!validationResult.valid) {
            hasErrors = true;
            
            invalidFields.push({
                field,
                value,
                error: validationResult.error
            });
            
            if (strategy === ValidationErrorStrategies.STRICT) {
                throw new Error(`Error de validación en ${field}: ${validationResult.error}`);
            } else if (strategy === ValidationErrorStrategies.DEFAULT_VALUE) {
                validatedData[field] = validationResult.value;
            } else if (strategy === ValidationErrorStrategies.NULL_VALUE) {
                validatedData[field] = null;
            } else if (strategy === ValidationErrorStrategies.QUEUE_ERROR) {
                // Enviar a la cola de errores y usar el valor por defecto
                errorQueue.enqueue(
                    errorQueue.ErrorTypes.VALIDATION_ERROR,
                    { field, value, expected: rules.options, schema: schema._name || 'unknown' },
                    validationResult.error,
                    errorQueue.ErrorActions.QUARANTINE
                );
                validatedData[field] = validationResult.value;
            } else {
                // LOG_ONLY: usar el valor original
                validatedData[field] = value;
            }
        } else {
            validatedData[field] = validationResult.value;
        }
    }
    
    // Agregar campos que no están en el esquema pero sí en los datos
    for (const [field, value] of Object.entries(data)) {
        if (!schema[field] && !field.startsWith('_')) {
            validatedData[field] = value;
        }
    }
    
    // Si hay campos inválidos, agregarlos al resultado
    if (hasErrors && strategy !== ValidationErrorStrategies.STRICT) {
        validatedData._invalidFields = invalidFields;
        
        // Registrar métricas de validación fallida
        logger.metric('validation_errors', invalidFields.length, 'Validation');
        
        // Agregar un flag para identificar objetos con errores de validación
        validatedData._hasValidationErrors = true;
    }
    
    return validatedData;
}

/**
 * Valida una colección de objetos según un esquema definido
 * @param {Array} collection - Colección a validar
 * @param {Object} schema - Esquema de validación
 * @param {string} strategy - Estrategia para manejar errores de validación
 * @returns {Array} - Colección validada
 */
function validateCollection(collection, schema, strategy = ValidationErrorStrategies.STRICT) {
    if (!Array.isArray(collection)) {
        const error = new Error('La colección a validar debe ser un array');
        
        if (strategy === ValidationErrorStrategies.QUEUE_ERROR) {
            errorQueue.enqueue(
                errorQueue.ErrorTypes.VALIDATION_ERROR,
                collection,
                error,
                errorQueue.ErrorActions.QUARANTINE
            );
            return [];
        }
        
        throw error;
    }
    
    // Actualizar el esquema con metadatos
    const schemaWithMeta = { ...schema, _name: schema._name || 'collection_schema' };
    
    // Validar cada elemento y filtrar aquellos que son null (si se usa QUEUE_ERROR)
    const validatedItems = collection
        .map((item, index) => {
            try {
                return validateObject(item, schemaWithMeta, strategy);
            } catch (error) {
                if (strategy === ValidationErrorStrategies.QUEUE_ERROR) {
                    // En modo cola, registrar el error y continuar con el siguiente
                    errorQueue.enqueue(
                        errorQueue.ErrorTypes.VALIDATION_ERROR,
                        { item, index },
                        error.message,
                        errorQueue.ErrorActions.QUARANTINE,
                        { schemaName: schemaWithMeta._name }
                    );
                    return null;
                } else if (strategy === ValidationErrorStrategies.LOG_ONLY) {
                    // En modo log, registrar el error y continuar
                    logger.error(`Error validando elemento ${index}: ${error.message}`, 'Validation');
                    return null;
                } else {
                    // En otros modos, propagar el error
                    logger.error(`Error validando elemento ${index}: ${error.message}`, 'Validation');
                    throw error;
                }
            }
        })
        .filter(item => item !== null);
    
    // Registrar métricas
    const failedCount = collection.length - validatedItems.length;
    if (failedCount > 0) {
        logger.warn(`${failedCount} de ${collection.length} elementos fallaron en la validación`, 'Validation');
        logger.metric('validation_failed_items', failedCount, 'Validation');
    }
    
    return validatedItems;
}

/**
 * Valida rankings de jugadores
 * @param {Array} rankings - Rankings a validar
 * @param {string} strategy - Estrategia para manejar errores de validación
 * @returns {Array} - Rankings validados
 */
function validatePlayerRankings(rankings, strategy = ValidationErrorStrategies.STRICT) {
    const playerRankingSchema = {
        ...schemas.playerRanking,
        _name: 'playerRanking'
    };
    return validateCollection(rankings, playerRankingSchema, strategy);
}

/**
 * Valida detalles de un personaje
 * @param {Object} details - Detalles a validar
 * @param {string} strategy - Estrategia para manejar errores de validación
 * @returns {Object} - Detalles validados
 */
function validateCharacterDetails(details, strategy = ValidationErrorStrategies.STRICT) {
    const characterDetailsSchema = {
        ...schemas.characterDetails,
        _name: 'characterDetails'
    };
    return validateObject(details, characterDetailsSchema, strategy);
}

/**
 * Procesa la cola de errores de validación e intenta repararlos
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
async function processValidationErrorQueue() {
    return await errorQueue.processQueue(errorQueue.ErrorActions.FIX_AUTO, async (errorItem) => {
        try {
            // Intentar reparar datos según el tipo de error
            const { data, type, error: errorMessage } = errorItem;
            
            if (type === errorQueue.ErrorTypes.VALIDATION_ERROR) {
                // Si es un error de tipo de dato, intentar convertir
                if (data.field && data.value !== undefined) {
                    // Reparación para números
                    if (data.expected && data.expected.min !== undefined) {
                        // Probablemente un número
                        const asNumber = parseFloat(data.value);
                        if (!isNaN(asNumber)) {
                            logger.info(`Reparado automáticamente: campo ${data.field} convertido a número (${data.value} -> ${asNumber})`, 'Validation');
                            return { success: true, repairedValue: asNumber };
                        }
                    }
                    
                    // Reparación para strings demasiado largos
                    if (data.expected && data.expected.maxLength !== undefined) {
                        if (typeof data.value === 'string' && data.value.length > data.expected.maxLength) {
                            const truncated = data.value.substring(0, data.expected.maxLength);
                            logger.info(`Reparado automáticamente: campo ${data.field} truncado (${data.value.length} chars -> ${truncated.length} chars)`, 'Validation');
                            return { success: true, repairedValue: truncated };
                        }
                    }
                    
                    // Reparación para JSON inválido
                    if (errorMessage && errorMessage.toLowerCase().includes('json')) {
                        try {
                            // Si es una cadena, intentar arreglar comillas o escapado
                            if (typeof data.value === 'string') {
                                // Reemplazar comillas simples por dobles
                                const fixedJson = data.value.replace(/'/g, '"');
                                const parsed = JSON.parse(fixedJson);
                                logger.info(`Reparado automáticamente: JSON inválido reparado para ${data.field}`, 'Validation');
                                return { success: true, repairedValue: parsed };
                            }
                            // Si es un objeto, intentar convertirlo a JSON
                            else if (typeof data.value === 'object' && data.value !== null) {
                                return { success: true, repairedValue: data.value };
                            }
                        } catch (jsonError) {
                            // No se pudo reparar el JSON
                        }
                    }
                }
            } else if (type === errorQueue.ErrorTypes.MISSING_REQUIRED_FIELD) {
                // Para campos requeridos faltantes, usar un valor predeterminado sensato
                if (data.field) {
                    let defaultValue = null;
                    
                    // Intentar inferir un valor predeterminado basado en el nombre del campo
                    switch (data.field.toLowerCase()) {
                        case 'rank':
                            defaultValue = 999; // Un valor alto por defecto
                            break;
                        case 'character':
                        case 'name':
                            defaultValue = 'Unknown_' + Math.floor(Math.random() * 1000);
                            break;
                        case 'class':
                            defaultValue = 'Desconocido';
                            break;
                        case 'powerscore':
                            defaultValue = 0;
                            break;
                        case 'level':
                            defaultValue = 1;
                            break;
                        default:
                            defaultValue = null;
                    }
                    
                    if (defaultValue !== null) {
                        logger.info(`Reparado automáticamente: campo requerido ${data.field} establecido a valor por defecto (${defaultValue})`, 'Validation');
                        return { success: true, repairedValue: defaultValue };
                    }
                }
            } else if (type === errorQueue.ErrorTypes.DATA_INCONSISTENCY) {
                // Intentar resolver inconsistencias de datos
                if (data.actual !== undefined && data.expected !== undefined) {
                    logger.info(`Inconsistencia de datos detectada: ${data.actual} vs ${data.expected}`, 'Validation');
                    // Por ahora, simplemente reportamos la inconsistencia
                    return { success: false, error: "Inconsistencia de datos no reparable automáticamente" };
                }
            }
            
            // Si no se pudo reparar automáticamente, cambiar a cuarentena
            return { 
                success: false, 
                error: 'No se pudo reparar automáticamente', 
                nextAction: errorQueue.ErrorActions.QUARANTINE 
            };
        } catch (error) {
            logger.error(`Error al intentar reparar datos: ${error.message}`, 'Validation');
            return { success: false, error: error.message };
        }
    });
}

/**
 * Valida con reintentos usando backoff exponencial
 * @param {Function} validationFn - Función de validación a ejecutar
 * @param {Array|Object} data - Datos a validar
 * @param {string} strategy - Estrategia de validación
 * @param {Object} retryOptions - Opciones para reintentos
 * @returns {Promise<Array|Object>} - Datos validados
 */
async function validateWithRetry(validationFn, data, strategy, retryOptions = {}) {
    return await withRetry(
        async () => validationFn(data, strategy),
        retryOptions
    );
}

module.exports = {
    validatePlayerRankings,
    validateCharacterDetails,
    validateWithRetry,
    processValidationErrorQueue,
    validators,
    schemas,
    ValidationErrorStrategies
};