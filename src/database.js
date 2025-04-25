/**
 * Módulo para manejar la base de datos MySQL
 * Almacenamiento persistente para los rankings de MIR4
 */

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { CONFIG } = require('./config');
const logger = require('./logger');

// Pool de conexiones a la base de datos MySQL
let pool;

// Inicializar la conexión a la base de datos
async function initializeConnectionPool() {
    try {
        pool = mysql.createPool(CONFIG.MYSQL);
        
        // Verificar que la conexión funciona
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        
        logger.info(`Base de datos MySQL conectada en: ${CONFIG.MYSQL.host}:${CONFIG.MYSQL.port}/${CONFIG.MYSQL.database}`, 'Database');
        return true;
    } catch (error) {
        logger.error(`Error al conectar con la base de datos MySQL: ${error.message}`, 'Database');
        throw error;
    }
}

// Variable para indicar si la base de datos está lista
let dbInitialized = false;

// Crear tablas si no existen
async function initDatabase() {
    try {
        await initializeConnectionPool();
        
        // Tabla para servidores
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                region_name VARCHAR(50) NOT NULL,
                server_name VARCHAR(50) NOT NULL,
                region_id VARCHAR(50) NOT NULL,
                server_id VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_update DATETIME,
                UNIQUE(region_name, server_name)
            )
        `);

        // Tabla para rankings
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rankings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                server_id INT,
                rank INT,
                character_name VARCHAR(100),
                clan VARCHAR(100),
                class VARCHAR(50),
                power_score INT,
                collection_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(server_id) REFERENCES servers(id)
            )
        `);

        // Nueva tabla para detalles de personajes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS character_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ranking_id INT,
                level INT,
                prestige_level INT DEFAULT 0,
                equipment_score INT DEFAULT 0,
                spirit_score INT DEFAULT 0,
                energy_score INT DEFAULT 0,
                magical_stone_score INT DEFAULT 0,
                codex_score INT DEFAULT 0,
                trophy_score INT DEFAULT 0,
                ethics INT DEFAULT 0,
                achievements TEXT,
                last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(ranking_id) REFERENCES rankings(id)
            )
        `);

        // Tabla para el registro de operaciones de actualización
        await pool.query(`
            CREATE TABLE IF NOT EXISTS update_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                update_type VARCHAR(50) NOT NULL,
                description TEXT,
                status VARCHAR(20) NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                affected_servers INT DEFAULT 0,
                error_message TEXT
            )
        `);

        // Índices para mejorar rendimiento
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rankings_server_id ON rankings(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rankings_character_name ON rankings(character_name)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rankings_clan ON rankings(clan)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rankings_class ON rankings(class)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_rankings_collection_time ON rankings(collection_time)`);
        
        // Índices para la tabla de detalles de personajes
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_character_details_ranking_id ON character_details(ranking_id)`);

        // Marcar la base de datos como inicializada
        dbInitialized = true;
        
        logger.success('Tablas de la base de datos inicializadas correctamente', 'Database');
        return true;
    } catch (error) {
        logger.error(`Error al inicializar tablas de la base de datos: ${error.message}`, 'Database');
        throw error;
    }
}

// Inicializar la base de datos
initDatabase().catch(err => {
    logger.error(`Error fatal al inicializar la base de datos: ${err.message}`, 'Database');
});

// Helper para asegurar que la conexión a la BD está disponible
async function ensureDbConnection() {
    if (!dbInitialized) {
        logger.warn("La conexión a la base de datos no está inicializada aún. Esperando...", 'Database');
        // Intentar esperar hasta que la BD esté inicializada
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (dbInitialized) break;
        }
        
        if (!dbInitialized) {
            throw new Error("No se pudo establecer la conexión a la base de datos después de varios intentos.");
        }
    }
    return pool;
}

/**
 * Actualiza la tabla de servidores con la información más reciente
 * @param {Object} serverRegions - Objeto con la configuración de regiones y servidores
 */
async function updateServersDatabase(serverRegions) {
    try {
        await ensureDbConnection();
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            for (const [regionName, regionData] of Object.entries(serverRegions)) {
                for (const [serverName, serverData] of Object.entries(regionData.servers)) {
                    await connection.query(`
                        INSERT IGNORE INTO servers (region_name, server_name, region_id, server_id) 
                        VALUES (?, ?, ?, ?)
                    `, [regionName, serverName, regionData.id, serverData.id]);
                }
            }
            
            await connection.commit();
            logger.success('Base de datos de servidores actualizada', 'Database');
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger.error(`Error al actualizar base de datos de servidores: ${error.message}`, 'Database');
    }
}

/**
 * Marca un servidor como inactivo en la base de datos
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
async function markServerAsInactive(regionName, serverName) {
    try {
        await ensureDbConnection();
        const [result] = await pool.query(`
            UPDATE servers 
            SET is_active = 0, last_update = NOW() 
            WHERE region_name = ? AND server_name = ?
        `, [regionName, serverName]);
        
        if (result.affectedRows > 0) {
            logger.info(`Servidor ${regionName} > ${serverName} marcado como inactivo`, 'Database');
        }
    } catch (error) {
        logger.error(`Error al marcar servidor como inactivo: ${error.message}`, 'Database');
    }
}

/**
 * Marca un servidor como activo en la base de datos
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
async function markServerAsActive(regionName, serverName) {
    try {
        await ensureDbConnection();
        const [result] = await pool.query(`
            UPDATE servers 
            SET is_active = 1, last_update = NOW() 
            WHERE region_name = ? AND server_name = ?
        `, [regionName, serverName]);
        
        if (result.affectedRows > 0) {
            logger.info(`Servidor ${regionName} > ${serverName} marcado como activo`, 'Database');
        }
    } catch (error) {
        logger.error(`Error al marcar servidor como activo: ${error.message}`, 'Database');
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
        logger.warn(`No hay rankings para guardar de ${regionName} > ${serverName}`, 'Database');
        return;
    }
    
    try {
        await ensureDbConnection();
        // Obtener ID del servidor
        const [serverRows] = await pool.query(`
            SELECT id FROM servers WHERE region_name = ? AND server_name = ?
        `, [regionName, serverName]);
        
        if (serverRows.length === 0) {
            logger.warn(`No se encontró el servidor ${regionName} > ${serverName} en la base de datos`, 'Database');
            return;
        }
        
        const serverId = serverRows[0].id;
        
        // Marcar el servidor como activo ya que tenemos datos
        await markServerAsActive(regionName, serverName);
        
        // Usar una estrategia sin deadlocks: 
        // 1. Insertar con un timestamp actual
        // 2. Eliminar registros antiguos después
        
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace('T', ' ');
        
        // Insertar nuevos rankings con el timestamp actual
        const connection = await pool.getConnection();
        
        try {
            // No usamos transacción para el bloque de inserciones para evitar bloqueos largos
            for (const player of rankings) {
                await connection.query(`
                    INSERT INTO rankings (server_id, rank, character_name, clan, class, power_score, collection_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    serverId,
                    player.rank,
                    player.character,
                    player.clan,
                    player.class,
                    player.powerScore,
                    timestamp
                ]);
            }
            
            // Después de insertar todos, eliminamos los registros antiguos
            // Solo conservamos los más recientes
            await connection.query(`
                DELETE FROM r1
                USING rankings r1, rankings r2
                WHERE r1.server_id = ? 
                AND r1.server_id = r2.server_id
                AND r1.character_name = r2.character_name
                AND r1.collection_time < r2.collection_time
            `, [serverId]);
            
            logger.success(`${rankings.length} rankings guardados en la base de datos para ${regionName} > ${serverName}`, 'Database');
        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger.error(`Error al guardar rankings en la base de datos: ${error.message}`, 'Database');
    }
}

/**
 * Guarda los detalles adicionales de un personaje
 * @param {number} rankingId - ID del ranking al que pertenece el personaje
 * @param {Object} details - Detalles del personaje
 */
async function saveCharacterDetails(rankingId, details) {
    try {
        await ensureDbConnection();
        // Verificar si ya existen detalles para este personaje
        const [existingRows] = await pool.query(`
            SELECT id FROM character_details WHERE ranking_id = ?
        `, [rankingId]);
        
        if (existingRows.length > 0) {
            // Actualizar detalles existentes
            await pool.query(`
                UPDATE character_details
                SET level = ?,
                    prestige_level = ?,
                    equipment_score = ?,
                    spirit_score = ?,
                    energy_score = ?,
                    magical_stone_score = ?,
                    codex_score = ?,
                    trophy_score = ?,
                    ethics = ?,
                    achievements = ?,
                    last_update = NOW()
                WHERE ranking_id = ?
            `, [
                details.level || 0,
                details.prestigeLevel || 0,
                details.equipmentScore || 0,
                details.spiritScore || 0,
                details.energyScore || 0,
                details.magicalStoneScore || 0,
                details.codexScore || 0,
                details.trophyScore || 0,
                details.ethics || 0,
                details.achievements ? JSON.stringify(details.achievements) : null,
                rankingId
            ]);
            logger.success(`Detalles del personaje actualizados para ranking ID: ${rankingId}`, 'Database');
        } else {
            // Insertar nuevos detalles
            await pool.query(`
                INSERT INTO character_details (
                    ranking_id, level, prestige_level, equipment_score,
                    spirit_score, energy_score, magical_stone_score, 
                    codex_score, trophy_score, ethics, achievements
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                rankingId,
                details.level || 0,
                details.prestigeLevel || 0,
                details.equipmentScore || 0,
                details.spiritScore || 0,
                details.energyScore || 0,
                details.magicalStoneScore || 0,
                details.codexScore || 0,
                details.trophyScore || 0,
                details.ethics || 0,
                details.achievements ? JSON.stringify(details.achievements) : null
            ]);
            logger.success(`Nuevos detalles de personaje guardados para ranking ID: ${rankingId}`, 'Database');
        }
    } catch (error) {
        logger.error(`Error al guardar detalles del personaje: ${error.message}`, 'Database');
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
        await ensureDbConnection();
        const [rows] = await pool.query(`
            SELECT 
                r.id as ranking_id,
                r.rank,
                r.character_name as character,
                r.clan,
                r.class,
                r.power_score as powerScore,
                r.collection_time as collectionTime,
                cd.level,
                cd.prestige_level as prestigeLevel,
                cd.equipment_score as equipmentScore,
                cd.spirit_score as spiritScore,
                cd.energy_score as energyScore,
                cd.magical_stone_score as magicalStoneScore,
                cd.codex_score as codexScore,
                cd.trophy_score as trophyScore,
                cd.ethics,
                cd.achievements,
                cd.last_update as lastUpdate
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            LEFT JOIN character_details cd ON r.id = cd.ranking_id
            WHERE r.character_name = ? AND s.region_name = ? AND s.server_name = ?
            ORDER BY r.collection_time DESC
            LIMIT 1
        `, [characterName, regionName, serverName]);
        
        if (rows.length > 0) {
            const characterData = rows[0];
            
            if (characterData.achievements) {
                try {
                    characterData.achievements = JSON.parse(characterData.achievements);
                } catch (e) {
                    characterData.achievements = [];
                }
            }
            
            return characterData;
        }
        
        return null;
    } catch (error) {
        logger.error(`Error al obtener detalles del personaje ${characterName}: ${error.message}`, 'Database');
        return null;
    }
}

/**
 * Obtiene el ID de un ranking por nombre de personaje y servidor
 * @param {string} characterName - Nombre del personaje
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {number|null} - ID del ranking o null si no se encuentra
 */
async function getRankingId(characterName, regionName, serverName) {
    try {
        await ensureDbConnection();
        const [rows] = await pool.query(`
            SELECT r.id
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            WHERE r.character_name = ? AND s.region_name = ? AND s.server_name = ?
        `, [characterName, regionName, serverName]);
        
        return rows.length > 0 ? rows[0].id : null;
    } catch (error) {
        logger.error(`Error al obtener ranking ID para ${characterName}: ${error.message}`, 'Database');
        return null;
    }
}

/**
 * Obtiene los servidores activos de la base de datos
 * @returns {Array} - Lista de servidores activos
 */
async function getActiveServers() {
    try {
        await ensureDbConnection();
        const [rows] = await pool.query(`
            SELECT region_name, server_name, region_id, server_id
            FROM servers 
            WHERE is_active = 1
        `);
        
        return rows;
    } catch (error) {
        logger.error(`Error al obtener servidores activos: ${error.message}`, 'Database');
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
        await ensureDbConnection();
        const [rows] = await pool.query(`
            SELECT r.rank, r.character_name as character, r.clan, r.class, r.power_score as powerScore
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            WHERE s.region_name = ? AND s.server_name = ?
            ORDER BY r.rank
        `, [regionName, serverName]);
        
        return rows;
    } catch (error) {
        logger.error(`Error al obtener rankings del servidor ${regionName} > ${serverName}: ${error.message}`, 'Database');
        return [];
    }
}

/**
 * Registra una operación de actualización en la base de datos
 * @param {Object} operation - Datos de la operación
 */
async function logUpdateOperation(operation) {
    try {
        await ensureDbConnection();
        if (operation.status === 'running') {
            // Nueva operación
            const [result] = await pool.query(`
                INSERT INTO update_logs 
                (update_type, description, status, start_time, affected_servers)
                VALUES (?, ?, ?, ?, ?)
            `, [
                operation.updateType,
                operation.description,
                operation.status,
                operation.startTime,
                operation.affectedServers || 0
            ]);
            
            operation.id = result.insertId;
        } else if (operation.status === 'completed' || operation.status === 'failed') {
            // Actualización de operación existente
            if (!operation.id) {
                throw new Error('Se requiere un ID de operación para actualizarla');
            }
            
            await pool.query(`
                UPDATE update_logs
                SET status = ?, end_time = ?, error_message = ?
                WHERE id = ?
            `, [
                operation.status,
                operation.endTime || null,
                operation.errorMessage || null,
                operation.id
            ]);
        }
    } catch (error) {
        logger.error(`Error al registrar operación de actualización: ${error.message}`, 'Database');
    }
}

/**
 * Obtiene información de los servidores agrupada por región
 * Solo incluye servidores activos
 * @returns {Object} - Objeto con regiones y sus servidores activos
 */
async function getActiveServersList() {
    try {
        await ensureDbConnection();
        const [servers] = await pool.query(`
            SELECT region_name, region_id, server_name, server_id
            FROM servers
            WHERE is_active = 1
            ORDER BY region_name, server_name
        `);
        
        // Organizar los resultados por región
        const serverList = {};
        
        for (const server of servers) {
            // Crear la región si no existe
            if (!serverList[server.region_name]) {
                serverList[server.region_name] = {
                    id: server.region_id,
                    servers: []
                };
            }
            
            // Añadir el servidor a la región
            serverList[server.region_name].servers.push({
                id: server.server_id,
                name: server.server_name
            });
        }
        
        return serverList;
    } catch (error) {
        logger.error(`Error al obtener lista de servidores activos: ${error.message}`, 'Database');
        return {};
    }
}

module.exports = {
    pool,
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
    getActiveServersList
};