/**
 * Punto de entrada principal para la API de rankings MIR4
 */

const express = require('express');
const cron = require('node-cron');
const { CONFIG } = require('./src/config');
const { cleanupOldFiles } = require('./src/utils');
const { fetchRankingData } = require('./src/scraper');
const { initPrefetch, prefetchAllServers } = require('./src/prefetch');
const apiRoutes = require('./src/routes');
const logger = require('./src/logger');
const { createRateLimiter } = require('./src/rateLimit');
const { initDatabase } = require('./src/database');

// Inicializar la aplicación Express
const app = express();
const port = CONFIG.PORT || 3000;

// Inicializar la base de datos al inicio
initDatabase()
    .then(() => {
        logger.success('Base de datos inicializada correctamente', 'Sistema');
    })
    .catch(err => {
        logger.error(`Error al inicializar la base de datos: ${err.message}`, 'Sistema');
    });

// Banner de inicio
const showBanner = () => {
    console.log("\n");
    console.log("╔═════════════════════════════════════════════════╗");
    console.log("║                                                 ║");
    console.log("║             MIR4 RANKING API                    ║");
    console.log("║                                                 ║");
    console.log("║       API para consultar rankings de MIR4       ║");
    console.log("║                                                 ║");
    console.log("╚═════════════════════════════════════════════════╝");
    console.log("\n");
};

// Middleware para analizar JSON en solicitudes
app.use(express.json());

// Middleware para rate limiting
app.use(createRateLimiter());

// Middleware para registrar todas las solicitudes
app.use((req, res, next) => {
    logger.route(`${req.method} ${req.originalUrl}`);
    next();
});

// Configurar las rutas de la API con prefijo /api
app.use('/api', apiRoutes);

// Programar la limpieza de archivos antiguos
cron.schedule(CONFIG.CLEANUP_CRON, () => {
    logger.system(`Ejecutando limpieza programada de archivos (cron: ${CONFIG.CLEANUP_CRON})`);
    cleanupOldFiles();
});

// Inicializar el sistema de prefetch
const prefetchSystem = initPrefetch();

// Programar el prefetch automático cada 12 horas
cron.schedule(CONFIG.PREFETCH_CRON, () => {
    logger.system(`Ejecutando prefetch programado de servidores (cron: ${CONFIG.PREFETCH_CRON})`);
    // No forzamos actualización en el prefetch automático para respetar el reset de rankings
    prefetchAllServers({ forceUpdate: false });
});

// Ejecutar una búsqueda inicial al iniciar para probar el sistema
if (process.env.NODE_ENV !== 'test') {
    // Ejecutar inmediatamente un test de fetchRankingData
    logger.system('Ejecutando carga inicial de datos...');
    fetchRankingData()
        .then(() => logger.success('Carga inicial completada exitosamente', 'Sistema'))
        .catch(err => logger.error(`Error en carga inicial: ${err.message}`, 'Sistema'));
    
    // Iniciar el prefetch inicial después de un breve retraso para no saturar recursos al inicio
    setTimeout(() => {
        logger.system('Iniciando prefetch inicial de servidores...');
        // No forzamos la actualización para permitir que el sistema de comparación funcione
        prefetchAllServers({ forceUpdate: false });
    }, 10000);
}

// Iniciar el servidor solo si no estamos en modo test
if (process.env.NODE_ENV !== 'test') {
    showBanner();
    
    app.listen(port, () => {
        logger.success(`API de rankings MIR4 corriendo en http://localhost:${port}`, 'Sistema');
        logger.info(`Limpieza de archivos programada: ${CONFIG.CLEANUP_CRON}`, 'Sistema');
        logger.info(`Prefetch automático programado: ${CONFIG.PREFETCH_CRON}`, 'Sistema');
        
        // Ejecutar una limpieza inicial al iniciar el servidor
        cleanupOldFiles();
    });
}

module.exports = app;