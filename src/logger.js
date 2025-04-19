/**
 * Módulo de logging con colores para mejorar la visualización en consola
 */

const chalk = require('chalk');

// Colores para diferentes tipos de mensajes
const colors = {
    info: chalk.blue,
    success: chalk.green,
    warn: chalk.yellow,
    error: chalk.red,
    debug: chalk.magenta,
    cache: chalk.cyan,
    scraper: chalk.greenBright,
    route: chalk.blueBright,
    system: chalk.gray,
    highlight: chalk.white.bold,
    time: chalk.gray
};

/**
 * Obtiene la marca de tiempo actual en formato legible
 * @returns {string} - Marca de tiempo formateada
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Registra un mensaje con el formato y color correspondiente
 * @param {string} message - El mensaje a registrar
 * @param {string} type - Tipo de mensaje (determina el color)
 * @param {Object} options - Opciones adicionales
 */
function log(message, type = 'info', options = {}) {
    const colorizer = colors[type] || colors.info;
    const timestamp = colors.time(`[${getTimestamp()}]`);
    const prefix = options.prefix ? colorizer(`[${options.prefix}]`) : '';
    
    console.log(`${timestamp} ${prefix} ${colorizer(message)}`);
}

// Métodos convenientes para diferentes tipos de mensajes
const logger = {
    info: (message, prefix = '') => log(message, 'info', { prefix }),
    success: (message, prefix = '') => log(message, 'success', { prefix }),
    warn: (message, prefix = '') => log(message, 'warn', { prefix }),
    error: (message, prefix = '') => log(message, 'error', { prefix }),
    debug: (message, prefix = '') => log(message, 'debug', { prefix }),
    
    // Loggers específicos para componentes
    cache: (message) => log(message, 'cache', { prefix: 'Cache' }),
    scraper: (message) => log(message, 'scraper', { prefix: 'Scraper' }),
    route: (message) => log(message, 'route', { prefix: 'API' }),
    system: (message) => log(message, 'system', { prefix: 'Sistema' }),
    
    // Para tablas o datos estructurados
    table: (data) => {
        console.log('\n');
        console.table(data);
        console.log('\n');
    }
};

module.exports = logger;