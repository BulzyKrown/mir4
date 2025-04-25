/**
 * Script para migrar datos de MySQL a Cloudflare KV
 * Extrae los rankings de la base de datos y los sube al almacenamiento KV
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fetch = require('node-fetch').default;
const { CONFIG, SERVER_REGIONS } = require('../src/config');
const logger = require('../src/logger');

// Configuración de la base de datos MySQL
const mysqlConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'mir4rankings',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10'),
    queueLimit: 0
};

// Configuración de Cloudflare KV
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;

// Función para obtener rankings de MySQL
async function getMyRankingsFromMySQL() {
    const pool = mysql.createPool(mysqlConfig);
    let connection;

    try {
        logger.info('Conectando a la base de datos MySQL...', 'Migration');
        connection = await pool.getConnection();
        
        // Consulta para obtener los rankings más recientes por servidor
        const [servers] = await connection.query(`
            SELECT id, region_name, server_name, region_id, server_id 
            FROM servers 
            WHERE is_active = 1
        `);
        
        const allRankings = {};
        
        for (const server of servers) {
            logger.info(`Obteniendo datos para ${server.region_name} > ${server.server_name}`, 'Migration');
            
            // Obtenemos solo los rankings más recientes para cada servidor
            const [rankings] = await connection.query(`
                SELECT r1.* 
                FROM rankings r1
                INNER JOIN (
                    SELECT server_id, character_name, MAX(collection_time) as max_time
                    FROM rankings
                    WHERE server_id = ?
                    GROUP BY server_id, character_name
                ) r2 ON r1.server_id = r2.server_id AND r1.character_name = r2.character_name AND r1.collection_time = r2.max_time
                ORDER BY r1.rank
            `, [server.id]);
            
            // Transformar los datos al formato adecuado para KV
            const formattedRankings = rankings.map(row => ({
                rank: row.rank,
                character: row.character_name,
                server: server.server_name,
                clan: row.clan,
                class: row.class,
                powerScore: row.power_score,
                regionName: server.region_name,
                serverName: server.server_name,
                collectionTime: row.collection_time
            }));
            
            // Guardar los datos organizados por servidor
            const serverKey = `${server.region_name}_${server.server_name}`;
            allRankings[serverKey] = formattedRankings;
            
            logger.success(`Obtenidos ${formattedRankings.length} registros de ${serverKey}`, 'Migration');
        }
        
        return allRankings;
        
    } catch (error) {
        logger.error(`Error al obtener datos de MySQL: ${error.message}`, 'Migration');
        throw error;
    } finally {
        if (connection) connection.release();
        await pool.end();
    }
}

// Función para guardar datos en Cloudflare KV
async function saveToCloudflareKV(data) {
    try {
        logger.info('Guardando datos en Cloudflare KV...', 'Migration');

        // Si no tenemos las credenciales de Cloudflare, mostramos un error
        if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
            logger.error('Las credenciales de Cloudflare no están configuradas en el archivo .env', 'Migration');
            logger.info('Por favor, configura las variables CF_ACCOUNT_ID, CF_API_TOKEN y CF_KV_NAMESPACE_ID', 'Migration');
            return false;
        }
            
        // Usar la API de Cloudflare
        const headers = {
            'Authorization': `Bearer ${CF_API_TOKEN}`,
            'Content-Type': 'application/json'
        };
        
        logger.info('Conectando con la API de Cloudflare...', 'Migration');
        
        // Guardar cada servidor en una clave separada
        for (const [serverKey, rankings] of Object.entries(data)) {
            const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${serverKey}`;
            
            const response = await fetch(url, {
                method: 'PUT',
                headers,
                body: JSON.stringify(rankings)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error al guardar ${serverKey}: ${response.status} ${errorText}`);
            }
            
            logger.success(`Guardados ${rankings.length} registros en Cloudflare KV para ${serverKey}`, 'Migration');
        }
        
        // Guardar una lista de servidores disponibles
        const serverList = Object.keys(data);
        const listUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/available_servers`;
        
        await fetch(listUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify(serverList)
        });
        
        // Guardar la última fecha de actualización
        const updateInfo = {
            lastUpdate: new Date().toISOString(),
            serverCount: Object.keys(data).length,
            totalPlayers: Object.values(data).reduce((acc, arr) => acc + arr.length, 0)
        };
        
        const infoUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/update_info`;
        
        await fetch(infoUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify(updateInfo)
        });
        
        return true;
    } catch (error) {
        logger.error(`Error al guardar datos en Cloudflare KV: ${error.message}`, 'Migration');
        throw error;
    }
}

// Función principal para ejecutar la migración
async function migrateToKV() {
    logger.info('🚀 Iniciando migración de MySQL a Cloudflare KV', 'Migration');
    try {
        // 1. Extraer datos de MySQL
        const rankings = await getMyRankingsFromMySQL();
        const totalServers = Object.keys(rankings).length;
        const totalPlayers = Object.values(rankings).reduce((acc, arr) => acc + arr.length, 0);
        logger.success(`Extraídos datos de ${totalPlayers} jugadores en ${totalServers} servidores`, 'Migration');
        
        // 2. Guardar datos en Cloudflare KV
        await saveToCloudflareKV(rankings);
        
        logger.success('✅ Migración completada exitosamente', 'Migration');
        process.exit(0);
    } catch (error) {
        logger.error(`❌ Error en la migración: ${error.message}`, 'Migration');
        process.exit(1);
    }
}

// Ejecutar la migración
migrateToKV();