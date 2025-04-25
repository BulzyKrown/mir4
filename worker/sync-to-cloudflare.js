/**
 * Script para sincronizar datos de MIR4 scrapeados a Cloudflare KV
 * 
 * Este script actúa como puente entre tu aplicación de scraping existente
 * y el Worker de Cloudflare. Se encarga de leer los datos locales y 
 * enviarlos a Cloudflare KV para que estén disponibles en el Worker.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getMainCache, getServerCache } = require('../src/cache');
const { CONFIG, SERVER_REGIONS } = require('../src/config');
const logger = require('../src/logger');

// Configuración para Cloudflare API
const CF_CONFIG = {
  // Estos valores deben estar en tu archivo .env
  ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
  API_TOKEN: process.env.CF_API_TOKEN,
  NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID,
  API_BASE_URL: 'https://api.cloudflare.com/client/v4'
};

/**
 * Valida que todas las variables de configuración necesarias estén presentes
 */
function validateConfig() {
  const requiredVars = ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_KV_NAMESPACE_ID'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.error(`Faltan variables de entorno: ${missing.join(', ')}`, 'CloudflareSync');
    logger.error('Agrega estas variables en tu archivo .env', 'CloudflareSync');
    process.exit(1);
  }
}

/**
 * Genera datos de prueba para usar cuando no hay datos en el caché
 */
function generateTestData() {
  logger.info('Generando datos de prueba para la sincronización', 'CloudflareSync');
  
  // Clases de personaje para datos de prueba
  const classes = ['Warrior', 'Sorcerer', 'Taoist', 'Arbalist', 'Lancer'];
  
  // Función para generar un jugador aleatorio
  const generatePlayer = (rank) => ({
    rank,
    character: `Player${rank}_${Math.floor(Math.random() * 1000)}`,
    class: classes[Math.floor(Math.random() * classes.length)],
    imageUrl: `https://example.com/image${rank}.jpg`,
    server: `Server${Math.floor(Math.random() * 10) + 1}`,
    clan: `Clan${Math.floor(Math.random() * 50) + 1}`,
    powerScore: Math.floor(Math.random() * 5000000) + 1000000
  });
  
  // Generar 100 jugadores de prueba
  const testPlayers = Array.from({ length: 100 }, (_, i) => generatePlayer(i + 1));
  
  logger.success(`Datos de prueba generados: ${testPlayers.length} jugadores`, 'CloudflareSync');
  return testPlayers;
}

/**
 * Envía datos a Cloudflare KV mediante la API de Cloudflare
 */
async function putToKV(key, value, metadata = {}) {
  try {
    const url = `${CF_CONFIG.API_BASE_URL}/accounts/${CF_CONFIG.ACCOUNT_ID}/storage/kv/namespaces/${CF_CONFIG.NAMESPACE_ID}/values/${key}`;
    
    // Convertir el valor a string si es un objeto
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;
    
    // Añadir timestamp a los metadatos
    const metadataWithTimestamp = {
      ...metadata,
      updated: Date.now()
    };
    
    // Enviar a Cloudflare KV
    const response = await axios({
      method: 'PUT',
      url,
      data: valueStr,
      headers: {
        'Authorization': `Bearer ${CF_CONFIG.API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      params: {
        metadata: JSON.stringify(metadataWithTimestamp)
      }
    });
    
    if (response.data && response.data.success) {
      logger.success(`Datos sincronizados a KV: ${key}`, 'CloudflareSync');
      return true;
    } else {
      logger.error(`Error al sincronizar a KV: ${key} - ${JSON.stringify(response.data)}`, 'CloudflareSync');
      return false;
    }
  } catch (error) {
    logger.error(`Error de API de Cloudflare para ${key}: ${error.message}`, 'CloudflareSync');
    if (error.response) {
      logger.error(`Respuesta: ${JSON.stringify(error.response.data)}`, 'CloudflareSync');
    }
    return false;
  }
}

/**
 * Sincroniza los datos del caché principal a Cloudflare KV
 */
async function syncMainCache() {
  let mainData = getMainCache();
  
  if (!mainData || mainData.length === 0) {
    logger.warn('No hay datos en el caché principal, usando datos de prueba', 'CloudflareSync');
    mainData = generateTestData();
  }
  
  logger.info(`Sincronizando ${mainData.length} jugadores a Cloudflare KV`, 'CloudflareSync');
  
  // Metadatos adicionales sobre los datos
  const metadata = {
    count: mainData.length,
    source: mainData === getMainCache() ? 'main-cache' : 'test-data',
  };
  
  // Enviar a KV
  return await putToKV('main_rankings', mainData, metadata);
}

/**
 * Sincroniza los datos de servidores específicos a Cloudflare KV
 */
async function syncServerCaches() {
  logger.info('Sincronizando datos de servidores específicos a Cloudflare KV', 'CloudflareSync');
  
  const results = {
    success: 0,
    failed: 0,
    skipped: 0
  };
  
  // Vamos a generar datos de prueba para algunos servidores específicos
  const testServers = [
    { region: 'ASIA1', server: 'ASIA011' },
    { region: 'ASIA1', server: 'ASIA012' },
    { region: 'INMENA1', server: 'INMENA011' },
    { region: 'EU1', server: 'EU011' },
    { region: 'NA1', server: 'NA011' }
  ];
  
  // Sincronizar datos de prueba para servidores específicos
  for (const { region, server } of testServers) {
    // Clave para KV
    const kvKey = `server_${region}_${server}`;
    
    // Generar datos de prueba específicos para este servidor
    const serverData = generateTestData().map(player => ({
      ...player,
      regionName: region,
      serverName: server
    }));
    
    // Metadatos adicionales
    const metadata = {
      region,
      server,
      count: serverData.length,
      source: 'test-data'
    };
    
    // Enviar a KV
    const success = await putToKV(kvKey, serverData, metadata);
    
    if (success) {
      logger.success(`Sincronizado ${serverData.length} jugadores de prueba para ${region} > ${server}`, 'CloudflareSync');
      results.success++;
    } else {
      logger.error(`Error al sincronizar datos de prueba para ${region} > ${server}`, 'CloudflareSync');
      results.failed++;
    }
    
    // Pequeña pausa para no sobrecargar la API
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  logger.info(`Sincronización de servidores de prueba completada: ${results.success} exitosos, ${results.failed} fallidos`, 'CloudflareSync');
  return results;
}

/**
 * Función principal que ejecuta la sincronización completa
 */
async function runSync() {
  logger.info('Iniciando sincronización de datos a Cloudflare KV', 'CloudflareSync');
  
  // Validar configuración
  validateConfig();
  
  // Sincronizar caché principal
  const mainSuccess = await syncMainCache();
  
  // Sincronizar caché de servidores
  const serverResults = await syncServerCaches();
  
  logger.info('Sincronización completa', 'CloudflareSync');
  
  return {
    mainSuccess,
    serverResults
  };
}

// Si se ejecuta directamente desde la línea de comandos
if (require.main === module) {
  runSync()
    .then(results => {
      logger.success(`Sincronización completada: ${JSON.stringify(results)}`, 'CloudflareSync');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Error en la sincronización: ${error.message}`, 'CloudflareSync');
      process.exit(1);
    });
}

module.exports = { runSync, syncMainCache, syncServerCaches };