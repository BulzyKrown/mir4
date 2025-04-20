/**
 * Sistema de prefetch para servidores MIR4
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { SERVER_REGIONS, CONFIG } = require('./config');
const { fetchServerRankingData } = require('./scraper');
const { setServerCache } = require('./cache');
const logger = require('./logger');
const { db, markServerAsInactive, saveServerRankings, updateServersDatabase, logUpdateOperation } = require('./database');

// Ruta del archivo de estado del prefetch
const PREFETCH_STATUS_FILE = path.join(process.cwd(), CONFIG.DATA_DIR, 'prefetch_status.json');

// Estado del prefetch
let prefetchStatus = {
    isRunning: false,
    startTime: null,
    endTime: null,
    lastCompleted: null,
    serversProcessed: 0,
    totalServers: 0,
    errors: [],
    lastError: null,
    paused: false
};

// Crear una interfaz de readline para interacciones con el usuario
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Función para preguntar al usuario si desea continuar con la iteración
 * @param {string} reason - Razón por la que se pide confirmación
 * @returns {Promise<boolean>} - Promesa que resuelve a true si el usuario desea continuar
 */
function askToContinue(reason) {
    return new Promise((resolve) => {
        logger.info(`${reason}`, 'Prefetch');
        rl.question('¿Desea continuar con la iteración? (s/n): ', (answer) => {
            const shouldContinue = answer.toLowerCase() === 's' || answer.toLowerCase() === 'si' || answer.toLowerCase() === 'sí';
            if (shouldContinue) {
                logger.info('Continuando con el prefetch...', 'Prefetch');
            } else {
                logger.info('Prefetch pausado por el usuario', 'Prefetch');
                prefetchStatus.paused = true;
            }
            resolve(shouldContinue);
        });
    });
}

/**
 * Inicializa el sistema de prefetch
 */
function initPrefetch() {
    // Asegurar que existe el directorio de datos
    const dataDir = path.join(process.cwd(), CONFIG.DATA_DIR);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        logger.info(`Directorio de datos creado: ${dataDir}`, 'Prefetch');
    }
    
    // Cargar estado anterior si existe
    if (fs.existsSync(PREFETCH_STATUS_FILE)) {
        try {
            const statusData = fs.readFileSync(PREFETCH_STATUS_FILE, 'utf8');
            const savedStatus = JSON.parse(statusData);
            
            // Solo mantener algunos valores del estado guardado
            prefetchStatus.lastCompleted = savedStatus.lastCompleted;
            prefetchStatus.serversProcessed = savedStatus.serversProcessed || 0;
            prefetchStatus.totalServers = savedStatus.totalServers || 0;
            prefetchStatus.paused = false; // Siempre iniciar sin pausa
            
            logger.info('Estado del prefetch cargado correctamente', 'Prefetch');
        } catch (error) {
            logger.error(`Error al cargar estado del prefetch: ${error.message}`, 'Prefetch');
        }
    }
    
    // Actualizar la base de datos con la información de los servidores desde la configuración
    updateServersDatabase(SERVER_REGIONS);
    
    return prefetchStatus;
}

/**
 * Guarda el estado actual del prefetch
 */
function savePrefetchStatus() {
    try {
        fs.writeFileSync(PREFETCH_STATUS_FILE, JSON.stringify(prefetchStatus, null, 2));
        logger.debug('Estado del prefetch guardado', 'Prefetch');
    } catch (error) {
        logger.error(`Error al guardar estado del prefetch: ${error.message}`, 'Prefetch');
    }
}

/**
 * Realiza el prefetch de todos los servidores registrados
 * @param {Object} options - Opciones de configuración para el prefetch
 * @param {boolean} options.interactive - Si se debe preguntar al usuario antes de continuar después de errores
 * @param {number} options.confirmEvery - Número de servidores a procesar antes de pedir confirmación
 */
async function prefetchAllServers(options = {}) {
    const { 
        interactive = false, 
        confirmEvery = 5 
    } = options;
    
    // Evitar ejecuciones simultáneas
    if (prefetchStatus.isRunning) {
        logger.warn('Ya hay un prefetch en ejecución, ignorando solicitud', 'Prefetch');
        return prefetchStatus;
    }
    
    // Iniciar prefetch
    prefetchStatus.isRunning = true;
    prefetchStatus.startTime = new Date();
    prefetchStatus.errors = [];
    prefetchStatus.lastError = null;
    prefetchStatus.serversProcessed = 0;
    prefetchStatus.paused = false;
    
    // Crear lista de todos los servidores
    const servers = [];
    for (const [regionName, regionData] of Object.entries(SERVER_REGIONS)) {
        for (const serverName of Object.keys(regionData.servers)) {
            servers.push({ regionName, serverName });
        }
    }
    
    prefetchStatus.totalServers = servers.length;
    logger.info(`Iniciando prefetch para ${servers.length} servidores...`, 'Prefetch');
    
    // Guardar estado inicial
    savePrefetchStatus();
    
    // Iniciar operación en la base de datos
    const updateOperation = {
        updateType: 'prefetch',
        description: 'Prefetch periódico de todos los servidores',
        status: 'running',
        startTime: prefetchStatus.startTime,
        affectedServers: prefetchStatus.totalServers
    };
    logUpdateOperation(updateOperation);
    
    // Procesar cada servidor secuencialmente para no saturar el sistema
    for (const server of servers) {
        // Si el prefetch fue pausado por el usuario, salir del bucle
        if (prefetchStatus.paused) {
            logger.info('Prefetch detenido por el usuario', 'Prefetch');
            break;
        }

        try {
            logger.info(`Procesando servidor: ${server.regionName} > ${server.serverName}`, 'Prefetch');
            
            const startTime = Date.now();
            const rankings = await fetchServerRankingData(server.regionName, server.serverName, true);
            const endTime = Date.now();
            
            if (rankings && rankings.length > 0) {
                // Guardar en caché para el sistema actual
                setServerCache(`${server.regionName}_${server.serverName}`, rankings);
                
                // Guardar en la base de datos para almacenamiento persistente
                saveServerRankings(rankings, server.regionName, server.serverName);
                
                logger.success(`Servidor ${server.regionName} > ${server.serverName} procesado: ${rankings.length} jugadores en ${(endTime - startTime) / 1000}s`, 'Prefetch');
            } else {
                // Si no hay rankings es probable que el servidor no exista
                logger.warn(`Servidor ${server.regionName} > ${server.serverName} no devolvió datos, posiblemente no existe`, 'Prefetch');
                
                // Marcar el servidor como inactivo en la base de datos
                markServerAsInactive(server.regionName, server.serverName);
                
                prefetchStatus.errors.push(`${server.regionName} > ${server.serverName}: Servidor posiblemente inexistente`);
                
                // Si estamos en modo interactivo, preguntar si continuar después de un servidor sin datos
                if (interactive) {
                    const shouldContinue = await askToContinue(`Servidor ${server.regionName} > ${server.serverName} no devolvió datos. Es probable que el servidor no exista o esté inactivo.`);
                    if (!shouldContinue) break;
                }
            }
            
            // Actualizar contador
            prefetchStatus.serversProcessed++;
            
            // Guardar estado periódicamente
            if (prefetchStatus.serversProcessed % 5 === 0) {
                savePrefetchStatus();
            }
            
            // Si estamos en modo interactivo y hemos procesado 'confirmEvery' servidores, preguntar si continuar
            if (interactive && prefetchStatus.serversProcessed % confirmEvery === 0) {
                const shouldContinue = await askToContinue(`Se han procesado ${prefetchStatus.serversProcessed} de ${prefetchStatus.totalServers} servidores.`);
                if (!shouldContinue) break;
            }
            
            // Pequeña pausa para no sobrecargar el servidor objetivo
            await new Promise(resolve => setTimeout(resolve, CONFIG.PREFETCH_DELAY));
            
        } catch (error) {
            logger.error(`Error al procesar servidor ${server.regionName} > ${server.serverName}: ${error.message}`, 'Prefetch');
            
            prefetchStatus.errors.push(`${server.regionName} > ${server.serverName}: ${error.message}`);
            prefetchStatus.lastError = {
                server: `${server.regionName} > ${server.serverName}`,
                message: error.message,
                timestamp: new Date().toISOString()
            };
            
            // Marcar el servidor como inactivo en caso de error
            markServerAsInactive(server.regionName, server.serverName);
            
            // Si estamos en modo interactivo, preguntar si continuar después de un error
            if (interactive) {
                const shouldContinue = await askToContinue(`Se produjo un error al procesar el servidor ${server.regionName} > ${server.serverName}: ${error.message}`);
                if (!shouldContinue) break;
            }
        }
    }
    
    // Finalizar prefetch
    prefetchStatus.isRunning = false;
    prefetchStatus.endTime = new Date();
    prefetchStatus.lastCompleted = new Date().toISOString();
    
    // Finalizar la operación en la base de datos
    updateOperation.status = prefetchStatus.paused ? 'paused' : 'completed';
    updateOperation.endTime = prefetchStatus.endTime;
    logUpdateOperation(updateOperation);
    
    // Guardar estado final
    savePrefetchStatus();
    
    // Cerrar la interfaz de readline si estamos en modo interactivo
    if (interactive) {
        rl.close();
    }
    
    logger.success(`Prefetch ${prefetchStatus.paused ? 'pausado' : 'completado'}: ${prefetchStatus.serversProcessed}/${prefetchStatus.totalServers} servidores procesados`, 'Prefetch');
    
    if (prefetchStatus.errors.length > 0) {
        logger.warn(`Se encontraron ${prefetchStatus.errors.length} errores durante el prefetch`, 'Prefetch');
        logger.debug(prefetchStatus.errors.join('\n'), 'Prefetch');
    }
    
    return prefetchStatus;
}

module.exports = {
    initPrefetch,
    prefetchAllServers,
    prefetchStatus
};