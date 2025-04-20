/**
 * Sistema de prefetch para datos de servidores MIR4
 * Realiza cargas programadas de todos los servidores para mantener el caché actualizado
 */

const { SERVER_REGIONS, CONFIG } = require('./config');
const { fetchServerRankingData } = require('./scraper');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

// Estado del prefetch
let prefetchStatus = {
    isRunning: false,
    lastCompleted: null,
    lastStarted: null,
    completedServers: 0,
    totalServers: 0,
    errors: []
};

// Archivo para persistir el estado del prefetch
const PREFETCH_STATUS_FILE = path.join(process.cwd(), CONFIG.DATA_DIR, 'prefetch_status.json');

/**
 * Guarda el estado actual del prefetch en un archivo
 */
function savePrefetchStatus() {
    try {
        // Asegurar que el directorio existe
        const dataDir = path.join(process.cwd(), CONFIG.DATA_DIR);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            logger.info(`Directorio creado: ${CONFIG.DATA_DIR}`, 'Prefetch');
        }
        
        fs.writeFileSync(PREFETCH_STATUS_FILE, JSON.stringify(prefetchStatus, null, 2));
    } catch (error) {
        logger.error(`Error al guardar estado de prefetch: ${error.message}`, 'Prefetch');
    }
}

/**
 * Carga el estado del prefetch desde un archivo
 */
function loadPrefetchStatus() {
    try {
        if (fs.existsSync(PREFETCH_STATUS_FILE)) {
            const data = fs.readFileSync(PREFETCH_STATUS_FILE, 'utf8');
            const savedStatus = JSON.parse(data);
            
            // Mezclar con el estado actual, preservando algunas propiedades
            prefetchStatus = {
                ...prefetchStatus,
                lastCompleted: savedStatus.lastCompleted,
                lastStarted: savedStatus.lastStarted,
                completedServers: savedStatus.completedServers || 0,
                totalServers: savedStatus.totalServers || 0,
                errors: savedStatus.errors || []
            };
            
            logger.info('Estado de prefetch cargado desde archivo', 'Prefetch');
        }
    } catch (error) {
        logger.error(`Error al cargar estado de prefetch: ${error.message}`, 'Prefetch');
    }
}

/**
 * Cuenta el número total de servidores en todas las regiones
 * @returns {number} - Número total de servidores
 */
function countTotalServers() {
    let count = 0;
    for (const regionName in SERVER_REGIONS) {
        count += Object.keys(SERVER_REGIONS[regionName].servers).length;
    }
    return count;
}

/**
 * Realiza el prefetch de un servidor específico
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {Promise<boolean>} - Promesa que resuelve a true si el prefetch fue exitoso
 */
async function prefetchServer(regionName, serverName) {
    try {
        logger.info(`Iniciando prefetch para ${regionName} > ${serverName}`, 'Prefetch');
        
        // Forzar refresco ya que es un prefetch programado
        await fetchServerRankingData(regionName, serverName, true);
        
        logger.success(`Prefetch completado para ${regionName} > ${serverName}`, 'Prefetch');
        return true;
    } catch (error) {
        const errorMsg = `Error en prefetch de ${regionName} > ${serverName}: ${error.message}`;
        logger.error(errorMsg, 'Prefetch');
        prefetchStatus.errors.push({
            regionName,
            serverName,
            timestamp: new Date().toISOString(),
            message: error.message
        });
        return false;
    }
}

/**
 * Realiza el prefetch de todos los servidores de forma secuencial
 * para evitar sobrecarga de recursos
 * @returns {Promise<void>}
 */
async function prefetchAllServers() {
    // Si ya hay un prefetch en ejecución, no iniciar otro
    if (prefetchStatus.isRunning) {
        logger.warn('Ya hay un prefetch en ejecución, ignorando la solicitud', 'Prefetch');
        return;
    }
    
    try {
        // Marcar inicio del prefetch
        prefetchStatus.isRunning = true;
        prefetchStatus.lastStarted = new Date().toISOString();
        prefetchStatus.errors = [];
        prefetchStatus.completedServers = 0;
        prefetchStatus.totalServers = countTotalServers();
        
        logger.info(`Iniciando prefetch de ${prefetchStatus.totalServers} servidores`, 'Prefetch');
        savePrefetchStatus();
        
        // Proceso secuencial para evitar problemas de recursos
        for (const regionName in SERVER_REGIONS) {
            const region = SERVER_REGIONS[regionName];
            
            for (const serverName in region.servers) {
                const success = await prefetchServer(regionName, serverName);
                if (success) {
                    prefetchStatus.completedServers++;
                }
                
                // Guardar estado después de cada servidor
                savePrefetchStatus();
                
                // Esperar un breve tiempo entre servidores para evitar sobrecargas
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Marcar finalización del prefetch
        prefetchStatus.isRunning = false;
        prefetchStatus.lastCompleted = new Date().toISOString();
        
        logger.success(`Prefetch global completado. ${prefetchStatus.completedServers}/${prefetchStatus.totalServers} servidores procesados.`, 'Prefetch');
        
        // Guardar estado final
        savePrefetchStatus();
    } catch (error) {
        prefetchStatus.isRunning = false;
        logger.error(`Error en prefetch global: ${error.message}`, 'Prefetch');
        savePrefetchStatus();
    }
}

/**
 * Inicia el programador para el prefetch automático
 * @returns {void}
 */
function initPrefetch() {
    // Cargar estado anterior si existe
    loadPrefetchStatus();
    
    logger.info(`Sistema de prefetch inicializado. Programación: ${CONFIG.PREFETCH_CRON}`, 'Prefetch');
    
    // No devolvemos el cron para que pueda ser usado por index.js
    return {
        prefetchAllServers,
        getPrefetchStatus: () => ({ ...prefetchStatus })
    };
}

module.exports = {
    initPrefetch,
    prefetchAllServers
};