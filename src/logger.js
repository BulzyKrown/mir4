/**
 * Módulo de logging con colores para mejorar la visualización en consola
 * Incluye capacidades de monitoreo y alertas
 */

const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

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
    time: chalk.gray,
    alert: chalk.bgRed.white,  // Nuevo: Para alertas críticas
    metric: chalk.blueBright   // Nuevo: Para métricas
};

// Estado de monitoreo
const monitor = {
    scraperRuns: 0,
    scraperSuccess: 0,
    scraperFailed: 0,
    scraperLastRun: null,
    scraperLastError: null,
    scraperErrors: [],       // Almacena los últimos errores (máximo 10)
    startTime: new Date(),
    metrics: {},             // Métricas adicionales
    alerts: []               // Alertas generadas
};

// Directorio para logs
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

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
    
    const logMessage = `${timestamp} ${prefix} ${message}`;
    console.log(`${timestamp} ${prefix} ${colorizer(message)}`);
    
    // Guardar en archivo (solo errores y alertas para no sobrecargar)
    if (type === 'error' || type === 'alert' || type === 'warn') {
        const logFile = path.join(LOG_DIR, `${type}_log_${new Date().toISOString().split('T')[0]}.txt`);
        fs.appendFileSync(logFile, logMessage + '\n');
    }
    
    return logMessage; // Útil para tests y para guardar el mensaje
}

// Métodos convenientes para diferentes tipos de mensajes
const logger = {
    info: (message, prefix = '') => log(message, 'info', { prefix }),
    success: (message, prefix = '') => log(message, 'success', { prefix }),
    warn: (message, prefix = '') => log(message, 'warn', { prefix }),
    error: (message, prefix = '') => {
        // Guardar errores en el monitor para análisis
        monitor.scraperErrors.unshift({
            timestamp: new Date(),
            message: message,
            context: prefix
        });
        
        // Mantener solo los últimos 10 errores
        if (monitor.scraperErrors.length > 10) {
            monitor.scraperErrors.pop();
        }
        
        return log(message, 'error', { prefix });
    },
    debug: (message, prefix = '') => {
        // Solo mostrar mensajes debug si el nivel de log lo permite
        const logLevel = process.env.LOG_LEVEL || 'info';
        if (logLevel === 'debug') {
            return log(message, 'debug', { prefix });
        }
        return null;
    },
    
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
    },
    
    // Nuevo: Funciones de monitoreo
    startScraperRun: () => {
        monitor.scraperRuns++;
        monitor.scraperLastRun = new Date();
        return log('Iniciando ejecución del scraper', 'scraper', { prefix: 'Monitor' });
    },
    
    endScraperRun: (success = true, details = '') => {
        if (success) {
            monitor.scraperSuccess++;
            return log(`Scraper completado exitosamente${details ? ': ' + details : ''}`, 'success', { prefix: 'Monitor' });
        } else {
            monitor.scraperFailed++;
            monitor.scraperLastError = new Date();
            
            // Alertar si hay múltiples fallos consecutivos
            if (monitor.scraperFailed > 2) {
                logger.alert(`El scraper ha fallado ${monitor.scraperFailed} veces consecutivas: ${details}`);
            }
            
            return log(`Scraper fallido${details ? ': ' + details : ''}`, 'error', { prefix: 'Monitor' });
        }
    },
    
    // Métricas para diferentes aspectos del sistema
    metric: (metricName, value, context = 'Sistema') => {
        if (!monitor.metrics[metricName]) {
            monitor.metrics[metricName] = [];
        }
        
        monitor.metrics[metricName].push({
            timestamp: new Date(),
            value: value,
            context: context
        });
        
        // Mantener solo las últimas 100 métricas de cada tipo
        if (monitor.metrics[metricName].length > 100) {
            monitor.metrics[metricName].shift();
        }
        
        return log(`Métrica: ${metricName} = ${value}`, 'metric', { prefix: context });
    },
    
    // Sistema de alertas
    alert: (message, context = 'Sistema') => {
        const alert = {
            message,
            context,
            timestamp: new Date()
        };
        
        monitor.alerts.push(alert);
        
        // Mantener solo las últimas 50 alertas
        if (monitor.alerts.length > 50) {
            monitor.alerts.shift();
        }
        
        // Aquí se podría implementar la integración con sistemas de notificación externos
        // como email, SMS, webhooks, Slack, etc.
        
        return log(`¡ALERTA! ${message}`, 'alert', { prefix: context });
    },
    
    // Obtener estado del monitor para APIs o reportes
    getMonitorStatus: () => {
        return {
            uptime: Math.floor((new Date() - monitor.startTime) / 1000),
            scraperStats: {
                totalRuns: monitor.scraperRuns,
                successfulRuns: monitor.scraperSuccess,
                failedRuns: monitor.scraperFailed,
                lastRun: monitor.scraperLastRun,
                lastError: monitor.scraperLastError
            },
            recentErrors: monitor.scraperErrors,
            recentAlerts: monitor.alerts.slice(0, 10)
        };
    }
};

module.exports = logger;