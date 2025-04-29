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
 * Comprueba si los datos de un servidor ya se han actualizado después del último reset del ranking
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {boolean} - true si los datos ya están actualizados después del último reset
 */
async function isServerDataUpdatedAfterReset(regionName, serverName) {
    try {
        // Obtener la última actualización del servidor desde la base de datos
        const serverData = db.prepare(`
            SELECT MAX(r.collection_time) as last_update
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            WHERE s.region_name = ? AND s.server_name = ?
        `).get(regionName, serverName);
        
        if (!serverData || !serverData.last_update) {
            // No hay datos previos, por lo que necesitamos actualizar
            return false;
        }
        
        // Convertir la última actualización a objeto Date
        const lastUpdate = new Date(serverData.last_update);
        
        // Obtener la fecha y hora actual en UTC
        const now = new Date();
        
        // Convertir a UTC+8 (Hora de reset de MIR4)
        const utcPlus8Hours = now.getUTCHours() + 8;
        // Si es mayor a 24 o negativo, ajustar
        const adjustedHours = utcPlus8Hours >= 24 ? utcPlus8Hours - 24 : (utcPlus8Hours < 0 ? utcPlus8Hours + 24 : utcPlus8Hours);
        
        // Crear fecha del último reset a las 00:00 UTC+8
        const lastResetDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            // Si son menos de las 00:00 UTC+8, el último reset fue ayer
            adjustedHours < 0 ? now.getUTCDate() - 1 : now.getUTCDate(),
            0, 0, 0, 0
        ));
        // Ajustar a UTC+8
        lastResetDate.setUTCHours(lastResetDate.getUTCHours() - 8);
        
        // Si la última actualización es posterior al último reset, los datos ya están actualizados
        const isUpdated = lastUpdate >= lastResetDate;
        
        if (isUpdated) {
            logger.info(`Servidor ${regionName} > ${serverName} ya tiene datos actualizados después del reset (${lastResetDate.toISOString()})`, 'Prefetch');
        }
        
        return isUpdated;
    } catch (error) {
        logger.error(`Error al verificar actualización de datos para ${regionName} > ${serverName}: ${error.message}`, 'Prefetch');
        return false; // En caso de error, actualizamos por precaución
    }
}

/**
 * Realiza el prefetch de todos los servidores registrados
 * @param {Object} options - Opciones de configuración para el prefetch
 * @param {boolean} options.interactive - Si se debe preguntar al usuario antes de continuar después de errores
 * @param {number} options.confirmEvery - Número de servidores a procesar antes de pedir confirmación
 * @param {boolean} options.forceUpdate - Si se debe forzar la actualización aunque los datos ya estén actualizados
 * @param {number} options.maxConsecutiveFailures - Máximo número de fallos consecutivos permitidos antes de pausar
 */
async function prefetchAllServers(options = {}) {
    const { 
        interactive = false, 
        confirmEvery = 5,
        forceUpdate = false,
        maxConsecutiveFailures = 5 // Nuevo parámetro para limitar fallos consecutivos
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
    prefetchStatus.skippedServers = 0; // Contador de servidores omitidos por estar actualizados
    prefetchStatus.consecutiveFailures = 0; // Nuevo contador para fallos consecutivos
    
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
        // Si el prefetch fue pausado por el usuario o alcanzamos el límite de fallos, salir del bucle
        if (prefetchStatus.paused) {
            logger.info('Prefetch detenido por el usuario', 'Prefetch');
            break;
        }

        // Verificar si hemos alcanzado el máximo de fallos consecutivos
        if (prefetchStatus.consecutiveFailures >= maxConsecutiveFailures) {
            logger.warn(`Se alcanzó el límite de ${maxConsecutiveFailures} fallos consecutivos. Pausando el prefetch.`, 'Prefetch');
            prefetchStatus.paused = true;
            break;
        }

        try {
            // Verificar si los datos ya están actualizados después del último reset (00:00 UTC+8)
            // Solo si no estamos forzando la actualización
            if (!forceUpdate && await isServerDataUpdatedAfterReset(server.regionName, server.serverName)) {
                logger.info(`Omitiendo servidor ${server.regionName} > ${server.serverName}: datos ya actualizados después del último reset`, 'Prefetch');
                prefetchStatus.skippedServers++;
                prefetchStatus.serversProcessed++; // Incrementar contador aunque se omita
                prefetchStatus.consecutiveFailures = 0; // Resetear contador de fallos cuando omitimos con éxito
                continue; // Saltar a la siguiente iteración
            }
            
            logger.info(`Procesando servidor: ${server.regionName} > ${server.serverName}`, 'Prefetch');
            
            const startTime = Date.now();
            
            // Configurar un timeout para la operación completa
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout: La operación tardó demasiado')), 300000); // 5 minutos de timeout
            });
            
            // Ejecutar el scraping con un timeout
            const rankingsPromise = fetchServerRankingData(server.regionName, server.serverName, true);
            
            // Esperar a que se complete el scraping o se alcance el timeout
            const rankings = await Promise.race([rankingsPromise, timeoutPromise]);
            
            const endTime = Date.now();
            
            if (rankings && rankings.length > 0) {
                // Guardar en caché para el sistema actual
                setServerCache(`${server.regionName}_${server.serverName}`, rankings);
                
                // Guardar en la base de datos para almacenamiento persistente
                saveServerRankings(rankings, server.regionName, server.serverName);
                
                logger.success(`Servidor ${server.regionName} > ${server.serverName} procesado: ${rankings.length} jugadores en ${(endTime - startTime) / 1000}s`, 'Prefetch');
                
                // Resetear contador de fallos consecutivos cuando tenemos éxito
                prefetchStatus.consecutiveFailures = 0;
            } else {
                // Si no hay rankings es probable que el servidor no exista
                logger.warn(`Servidor ${server.regionName} > ${server.serverName} no devolvió datos, posiblemente no existe`, 'Prefetch');
                
                // Marcar el servidor como inactivo en la base de datos
                markServerAsInactive(server.regionName, server.serverName);
                
                prefetchStatus.errors.push(`${server.regionName} > ${server.serverName}: Servidor posiblemente inexistente`);
                prefetchStatus.consecutiveFailures++;
                
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
            
            // Pequeña pausa para no sobrecargar el servidor objetivo y permitir la liberación de recursos
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 segundos de pausa (aumentado para dar tiempo al GC)
            
        } catch (error) {
            // Incrementar contador de fallos consecutivos
            prefetchStatus.consecutiveFailures++;
            
            logger.error(`Error al procesar servidor ${server.regionName} > ${server.serverName}: ${error.message}`, 'Prefetch');
            
            prefetchStatus.errors.push(`${server.regionName} > ${server.serverName}: ${error.message}`);
            prefetchStatus.lastError = {
                server: `${server.regionName} > ${server.serverName}`,
                message: error.message,
                timestamp: new Date().toISOString()
            };
            
            // Marcar el servidor como inactivo en caso de error
            markServerAsInactive(server.regionName, server.serverName);
            
            // Verificar si el error parece ser un problema de recursos o conexión
            const isResourceError = error.message.includes('Target closed') || 
                error.message.includes('Session closed') ||
                error.message.includes('frame got detached') ||
                error.message.includes('Cannot find browser') ||
                error.message.includes('out of memory') ||
                error.message.includes('Timeout');
                
            if (isResourceError) {
                logger.warn(`Error de recursos detectado. Esperando 10 segundos antes de continuar...`, 'Prefetch');
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 segundos de pausa
            }
            
            // Si estamos en modo interactivo, preguntar si continuar después de un error
            if (interactive) {
                const shouldContinue = await askToContinue(`Se produjo un error al procesar el servidor ${server.regionName} > ${server.serverName}: ${error.message}`);
                if (!shouldContinue) break;
            }
            
            // Verificar si hemos alcanzado el máximo de fallos consecutivos
            if (prefetchStatus.consecutiveFailures >= maxConsecutiveFailures) {
                logger.warn(`Se alcanzó el límite de ${maxConsecutiveFailures} fallos consecutivos. Pausando el prefetch.`, 'Prefetch');
                prefetchStatus.paused = true;
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
    
    logger.success(`Prefetch ${prefetchStatus.paused ? 'pausado' : 'completado'}: ${prefetchStatus.serversProcessed - prefetchStatus.skippedServers} servidores actualizados, ${prefetchStatus.skippedServers} omitidos (ya actualizados después del reset)`, 'Prefetch');
    
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