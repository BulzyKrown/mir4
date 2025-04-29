/**
 * Gestión de secretos para la API de MIR4
 * Este módulo proporciona una capa de abstracción para acceder a credenciales y secretos
 * desde diferentes fuentes (variables de entorno, servicios de gestión de secretos, etc.)
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Prioridad de fuentes de secretos:
// 1. Variables de entorno (más seguro)
// 2. Gestor de secretos externo (si se configura en el futuro)
// 3. Archivo .env (fallback, menos seguro)

/**
 * Obtiene un secreto de las diferentes fuentes disponibles
 * @param {string} key - Clave del secreto a obtener
 * @param {string} defaultValue - Valor por defecto si no se encuentra
 * @returns {string} - El valor del secreto
 */
function getSecret(key, defaultValue = '') {
    // 1. Intentar obtener de variables de entorno (más seguro)
    if (process.env[key] !== undefined) {
        return process.env[key];
    }

    // 2. Aquí se podría implementar la integración con servicios como:
    // - AWS Secrets Manager
    // - Google Secret Manager
    // - HashiCorp Vault
    // - Azure Key Vault

    // 3. Fallback al archivo .env (menos seguro)
    try {
        logger.warn(`Usando .env para obtener secreto: ${key}. Se recomienda usar variables de entorno seguras.`, 'Seguridad');
    } catch (err) {
        // El logger podría no estar disponible durante la inicialización
    }
    
    return defaultValue;
}

/**
 * Obtiene la configuración de conexión a la base de datos
 * @returns {Object} Configuración de la base de datos
 */
function getDatabaseConfig() {
    return {
        dialect: getSecret('DB_DIALECT', 'mysql'),
        host: getSecret('DB_HOST', 'localhost'),
        port: parseInt(getSecret('DB_PORT', '3306'), 10),
        username: getSecret('DB_USER', ''),
        password: getSecret('DB_PASSWORD', ''),
        database: getSecret('DB_NAME', 'mir4_rankings'),
        storage: getSecret('DB_STORAGE', './database.sqlite'),
    };
}

/**
 * Obtiene la configuración del scraper
 * @returns {Object} Configuración del scraper
 */
function getScraperConfig() {
    return {
        delay: parseInt(getSecret('SCRAPER_DELAY', '2000'), 10),
        timeout: parseInt(getSecret('SCRAPER_TIMEOUT', '30000'), 10),
        retries: parseInt(getSecret('SCRAPER_RETRIES', '3'), 10),
    };
}

/**
 * Obtiene la configuración de seguridad de la API
 * @returns {Object} Configuración de seguridad
 */
function getSecurityConfig() {
    return {
        apiKeyEnabled: getSecret('API_KEY_ENABLED', 'false') === 'true',
        apiKey: getSecret('API_KEY', ''),
    };
}

module.exports = {
    getSecret,
    getDatabaseConfig,
    getScraperConfig,
    getSecurityConfig
};