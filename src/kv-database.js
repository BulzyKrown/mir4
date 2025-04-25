/**
 * Módulo para manejar la base de datos Cloudflare KV
 * Reemplazo del anterior módulo database.js que usaba MySQL
 */

const logger = require('./logger');
const { CONFIG, SERVER_REGIONS } = require('./config');
const fetch = require('node-fetch').default;

// Configuración para Cloudflare API usando el objeto CONFIG
const CF_ACCOUNT_ID = CONFIG.CLOUDFLARE.ACCOUNT_ID;
const CF_API_TOKEN = CONFIG.CLOUDFLARE.API_TOKEN;
const CF_KV_NAMESPACE_ID = CONFIG.CLOUDFLARE.KV_NAMESPACE_ID;
const API_BASE_URL = CONFIG.CLOUDFLARE.API_BASE_URL;

/**
 * Valida que todas las variables de configuración necesarias estén presentes
 */
function validateConfig() {
  const requiredVars = ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_KV_NAMESPACE_ID'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.error(`Faltan variables de entorno: ${missing.join(', ')}`, 'KVDatabase');
    logger.error('Agrega estas variables en tu archivo .env', 'KVDatabase');
    return false;
  }
  return true;
}

// Variable para indicar si la base de datos está lista
let dbInitialized = false;

/**
 * Inicializa la conexión a Cloudflare KV
 */
async function initDatabase() {
  try {
    if (!validateConfig()) {
      throw new Error("Configuración incompleta para Cloudflare KV");
    }
    
    // Intenta hacer una llamada básica para verificar la configuración
    const headers = {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    };
    
    const url = `${API_BASE_URL}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error al verificar configuración de KV: ${response.status} ${errorText}`);
    }
    
    dbInitialized = true;
    logger.success('Conexión a Cloudflare KV establecida correctamente', 'KVDatabase');
    return true;
  } catch (error) {
    logger.error(`Error al inicializar Cloudflare KV: ${error.message}`, 'KVDatabase');
    throw error;
  }
}

// Inicializar la base de datos
initDatabase().catch(err => {
  logger.error(`Error fatal al inicializar Cloudflare KV: ${err.message}`, 'KVDatabase');
});

/**
 * Función auxiliar para realizar operaciones de PUT en KV
 * @param {string} key - Clave a guardar en KV
 * @param {any} value - Valor a guardar
 * @param {Object} metadata - Metadatos opcionales
 * @returns {boolean} - Éxito de la operación
 */
async function putToKV(key, value, metadata = {}) {
  if (!dbInitialized) {
    await initDatabase();
  }
  
  try {
    const url = `${API_BASE_URL}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`;
    
    // Convertir el valor a string si es un objeto
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;
    
    // Añadir timestamp a los metadatos
    const metadataWithTimestamp = {
      ...metadata,
      updated: Date.now()
    };
    
    // Enviar a Cloudflare KV
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: valueStr
    });
    
    // También guardamos los metadatos si están presentes
    if (Object.keys(metadataWithTimestamp).length > 0) {
      const metadataParam = new URLSearchParams({
        metadata: JSON.stringify(metadataWithTimestamp)
      }).toString();
      
      await fetch(`${url}?${metadataParam}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: valueStr
      });
    }
    
    if (response.ok) {
      logger.success(`Datos guardados en KV: ${key}`, 'KVDatabase');
      return true;
    } else {
      const errorText = await response.text();
      logger.error(`Error al guardar en KV: ${key} - ${response.status} ${errorText}`, 'KVDatabase');
      return false;
    }
  } catch (error) {
    logger.error(`Error de API de Cloudflare para ${key}: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Función auxiliar para realizar operaciones de GET en KV
 * @param {string} key - Clave a obtener de KV
 * @returns {Object|null} - Valor obtenido o null si hay error
 */
async function getFromKV(key) {
  if (!dbInitialized) {
    await initDatabase();
  }
  
  try {
    const url = `${API_BASE_URL}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${key}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`Clave no encontrada en KV: ${key}`, 'KVDatabase');
        return null;
      }
      const errorText = await response.text();
      logger.error(`Error al obtener de KV: ${key} - ${response.status} ${errorText}`, 'KVDatabase');
      return null;
    }
    
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      // Si no es JSON, devolvemos el texto tal cual
      return text;
    }
  } catch (error) {
    logger.error(`Error de API de Cloudflare para ${key}: ${error.message}`, 'KVDatabase');
    return null;
  }
}

/**
 * Obtiene una lista de todas las claves en KV
 * @returns {Array} - Lista de claves o array vacío si hay error
 */
async function listKVKeys(prefix = '') {
  if (!dbInitialized) {
    await initDatabase();
  }
  
  try {
    const url = `${API_BASE_URL}/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/keys`;
    
    const params = new URLSearchParams();
    if (prefix) {
      params.append('prefix', prefix);
    }
    
    const response = await fetch(`${url}?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Error al listar claves de KV: ${response.status} ${errorText}`, 'KVDatabase');
      return [];
    }
    
    const data = await response.json();
    return data.result || [];
  } catch (error) {
    logger.error(`Error de API de Cloudflare al listar claves: ${error.message}`, 'KVDatabase');
    return [];
  }
}

/**
 * Marca un servidor como inactivo
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
async function markServerAsInactive(regionName, serverName) {
  try {
    // Obtenemos la lista actual de servidores
    const serversList = await getActiveServersList();
    
    // Si la región existe, filtramos el servidor
    if (serversList[regionName]) {
      serversList[regionName].servers = serversList[regionName].servers.filter(
        server => server.name !== serverName
      );
      
      // Si no quedan servidores en la región, la eliminamos
      if (serversList[regionName].servers.length === 0) {
        delete serversList[regionName];
      }
    }
    
    // Guardamos la lista actualizada
    await putToKV('active_servers', serversList, { updated: Date.now() });
    logger.info(`Servidor ${regionName} > ${serverName} marcado como inactivo`, 'KVDatabase');
    
    return true;
  } catch (error) {
    logger.error(`Error al marcar servidor como inactivo: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Marca un servidor como activo
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
async function markServerAsActive(regionName, serverName) {
  try {
    // Obtenemos la lista actual de servidores
    let serversList = await getActiveServersList();
    
    // Si no existe la región, la creamos
    if (!serversList[regionName]) {
      const regionId = SERVER_REGIONS[regionName]?.id || 0;
      serversList[regionName] = {
        id: regionId,
        servers: []
      };
    }
    
    // Si el servidor no está en la lista, lo agregamos
    const serverExists = serversList[regionName].servers.some(s => s.name === serverName);
    if (!serverExists) {
      const serverId = SERVER_REGIONS[regionName]?.servers[serverName]?.id || 0;
      serversList[regionName].servers.push({
        id: serverId,
        name: serverName
      });
    }
    
    // Guardamos la lista actualizada
    await putToKV('active_servers', serversList, { updated: Date.now() });
    logger.info(`Servidor ${regionName} > ${serverName} marcado como activo`, 'KVDatabase');
    
    return true;
  } catch (error) {
    logger.error(`Error al marcar servidor como activo: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Actualiza la base de datos de servidores con la configuración más reciente
 * @param {Object} serverRegions - Objeto con la configuración de regiones y servidores
 */
async function updateServersDatabase(serverRegions) {
  try {
    let serversList = {};
    
    // Crear la estructura de servidores activos
    for (const [regionName, regionData] of Object.entries(serverRegions)) {
      serversList[regionName] = {
        id: regionData.id,
        servers: []
      };
      
      for (const [serverName, serverData] of Object.entries(regionData.servers)) {
        serversList[regionName].servers.push({
          id: serverData.id,
          name: serverName
        });
      }
    }
    
    // Guardar la lista actualizada
    await putToKV('active_servers', serversList, { updated: Date.now() });
    logger.success('Base de datos de servidores actualizada', 'KVDatabase');
    
    return true;
  } catch (error) {
    logger.error(`Error al actualizar base de datos de servidores: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Guarda los rankings de un servidor en la base de datos
 * @param {Array} rankings - Array con los rankings de jugadores
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
async function saveServerRankings(rankings, regionName, serverName) {
  if (!rankings || rankings.length === 0) {
    logger.warn(`No hay rankings para guardar de ${regionName} > ${serverName}`, 'KVDatabase');
    return false;
  }
  
  try {
    // Marcar el servidor como activo
    await markServerAsActive(regionName, serverName);
    
    // Generar clave única para el servidor
    const serverKey = `server_${regionName}_${serverName}`;
    
    // Formatear los datos para KV
    const now = new Date();
    const formattedRankings = rankings.map(player => ({
      rank: player.rank,
      character: player.character,
      clan: player.clan,
      class: player.class,
      powerScore: player.powerScore,
      regionName: regionName,
      serverName: serverName,
      collectionTime: now.toISOString()
    }));
    
    // Guardar en KV con metadatos
    const metadata = {
      region: regionName,
      server: serverName,
      count: formattedRankings.length,
      updated: now.getTime()
    };
    
    const success = await putToKV(serverKey, formattedRankings, metadata);
    
    if (success) {
      logger.success(`${formattedRankings.length} rankings guardados en KV para ${regionName} > ${serverName}`, 'KVDatabase');
      
      // Actualizar la información de última actualización
      await logUpdateOperation({
        updateType: 'rankings',
        description: `Actualización de rankings para ${regionName} > ${serverName}`,
        status: 'completed',
        startTime: now.toISOString(),
        endTime: new Date().toISOString(),
        affectedServers: 1
      });
      
      return true;
    } else {
      logger.error(`Error al guardar rankings en KV para ${regionName} > ${serverName}`, 'KVDatabase');
      return false;
    }
  } catch (error) {
    logger.error(`Error al guardar rankings en KV: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Guarda los detalles adicionales de un personaje
 * @param {number} rankingId - ID del ranking al que pertenece el personaje (formato: region_server_characterName)
 * @param {Object} details - Detalles del personaje
 */
async function saveCharacterDetails(rankingId, details) {
  try {
    // Generar clave única para los detalles del personaje
    const detailsKey = `character_${rankingId}`;
    
    // Añadir timestamp
    const detailsWithTimestamp = {
      ...details,
      lastUpdate: new Date().toISOString()
    };
    
    // Guardar en KV
    const success = await putToKV(detailsKey, detailsWithTimestamp);
    
    if (success) {
      logger.success(`Detalles del personaje guardados en KV para ID: ${rankingId}`, 'KVDatabase');
      return true;
    } else {
      logger.error(`Error al guardar detalles de personaje en KV para ID: ${rankingId}`, 'KVDatabase');
      return false;
    }
  } catch (error) {
    logger.error(`Error al guardar detalles de personaje en KV: ${error.message}`, 'KVDatabase');
    return false;
  }
}

/**
 * Obtiene los detalles completos de un personaje por su nombre y servidor
 * @param {string} characterName - Nombre del personaje
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {Object|null} - Detalles completos del personaje o null si no se encuentra
 */
async function getCharacterDetails(characterName, regionName, serverName) {
  try {
    // Primero buscamos el personaje en los rankings del servidor
    const serverKey = `server_${regionName}_${serverName}`;
    const serverRankings = await getFromKV(serverKey);
    
    if (!serverRankings) {
      logger.warn(`No se encontraron rankings para ${regionName} > ${serverName}`, 'KVDatabase');
      return null;
    }
    
    // Buscamos el personaje en los rankings
    const character = serverRankings.find(c => c.character.toLowerCase() === characterName.toLowerCase());
    
    if (!character) {
      logger.warn(`No se encontró el personaje ${characterName} en ${regionName} > ${serverName}`, 'KVDatabase');
      return null;
    }
    
    // Generamos el ID único para buscar los detalles
    const rankingId = `${regionName}_${serverName}_${characterName}`.replace(/\s+/g, '_');
    
    // Buscamos los detalles del personaje
    const detailsKey = `character_${rankingId}`;
    const details = await getFromKV(detailsKey);
    
    // Combinamos los datos básicos con los detalles
    return {
      ...character,
      ...(details || {})
    };
  } catch (error) {
    logger.error(`Error al obtener detalles de personaje: ${error.message}`, 'KVDatabase');
    return null;
  }
}

/**
 * Obtiene el ID de un ranking por nombre de personaje y servidor
 * @param {string} characterName - Nombre del personaje
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {string|null} - ID del ranking o null si no se encuentra
 */
async function getRankingId(characterName, regionName, serverName) {
  try {
    // Generamos el ID único
    return `${regionName}_${serverName}_${characterName}`.replace(/\s+/g, '_');
  } catch (error) {
    logger.error(`Error al obtener ID de ranking: ${error.message}`, 'KVDatabase');
    return null;
  }
}

/**
 * Obtiene los servidores activos de la base de datos
 * @returns {Array} - Lista de servidores activos
 */
async function getActiveServers() {
  try {
    const serversList = await getActiveServersList();
    
    // Aplanar la estructura para compatibilidad con el código existente
    const flatList = [];
    
    for (const [regionName, regionData] of Object.entries(serversList)) {
      for (const server of regionData.servers) {
        flatList.push({
          region_name: regionName,
          server_name: server.name,
          region_id: regionData.id,
          server_id: server.id
        });
      }
    }
    
    return flatList;
  } catch (error) {
    logger.error(`Error al obtener servidores activos: ${error.message}`, 'KVDatabase');
    return [];
  }
}

/**
 * Consulta los rankings más recientes de un servidor específico
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {Array} - Rankings del servidor
 */
async function getServerRankings(regionName, serverName) {
  try {
    // Generar clave única para el servidor
    const serverKey = `server_${regionName}_${serverName}`;
    
    // Obtener de KV
    const rankings = await getFromKV(serverKey);
    
    if (!rankings) {
      logger.warn(`No se encontraron rankings para ${regionName} > ${serverName}`, 'KVDatabase');
      return [];
    }
    
    // Devolver los rankings formateados como lo esperan las funciones existentes
    return rankings.map(r => ({
      rank: r.rank,
      character: r.character,
      clan: r.clan,
      class: r.class,
      powerScore: r.powerScore
    }));
  } catch (error) {
    logger.error(`Error al obtener rankings del servidor ${regionName} > ${serverName}: ${error.message}`, 'KVDatabase');
    return [];
  }
}

/**
 * Registra una operación de actualización en la base de datos
 * @param {Object} operation - Datos de la operación
 */
async function logUpdateOperation(operation) {
  try {
    // Generar clave única para la operación
    const opId = Date.now().toString();
    const operationKey = `log_${opId}`;
    
    // Guardar en KV
    await putToKV(operationKey, operation);
    
    // Actualizar lista de operaciones recientes
    const recentLogsKey = 'recent_logs';
    const recentLogs = await getFromKV(recentLogsKey) || [];
    
    // Añadir esta operación al inicio
    recentLogs.unshift({
      id: opId,
      ...operation
    });
    
    // Mantener solo las 50 operaciones más recientes
    const trimmedLogs = recentLogs.slice(0, 50);
    
    // Guardar lista actualizada
    await putToKV(recentLogsKey, trimmedLogs);
    
    return opId;
  } catch (error) {
    logger.error(`Error al registrar operación de actualización: ${error.message}`, 'KVDatabase');
    return null;
  }
}

/**
 * Obtiene información de los servidores agrupada por región
 * Solo incluye servidores activos
 * @returns {Object} - Objeto con regiones y sus servidores activos
 */
async function getActiveServersList() {
  try {
    // Intentar obtener la lista de servidores activos
    const serversList = await getFromKV('active_servers');
    
    // Si no existe, creamos una estructura vacía
    if (!serversList) {
      logger.warn('No se encontró lista de servidores activos, creando nueva', 'KVDatabase');
      return {};
    }
    
    return serversList;
  } catch (error) {
    logger.error(`Error al obtener lista de servidores activos: ${error.message}`, 'KVDatabase');
    return {};
  }
}

module.exports = {
  initDatabase,
  updateServersDatabase,
  markServerAsInactive,
  markServerAsActive,
  saveServerRankings,
  saveCharacterDetails,
  getCharacterDetails,
  getRankingId,
  getActiveServers,
  getServerRankings,
  logUpdateOperation,
  getActiveServersList,
  // Funciones adicionales específicas de KV
  putToKV,
  getFromKV,
  listKVKeys
};