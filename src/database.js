/**
 * Módulo para manejar la base de datos MySQL
 * Almacenamiento persistente para los rankings de MIR4
 */

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { CONFIG } = require('./config');
const logger = require('./logger');
require('dotenv').config();

// Configuración de la base de datos desde variables de entorno
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4' // Especificar charset para evitar problemas de codificación
};

// Variable para almacenar la conexión de pool
let pool;

// Inicializar la conexión a la base de datos
async function initializeDatabase() {
    try {
        pool = mysql.createPool(DB_CONFIG);
        // Verificar conexión
        const connection = await pool.getConnection();
        logger.info(`Base de datos MySQL conectada en: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`, 'Database');
        connection.release();
        
        // Crear tablas si no existen
        await initDatabase();
        return true;
    } catch (error) {
        logger.error(`Error al conectar con la base de datos: ${error.message}`, 'Database');
        // No lanzar el error para permitir que la aplicación continúe
        return false;
    }
}

// Crear tablas si no existen
async function initDatabase() {
    try {
        // Tabla para servidores
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                region_name VARCHAR(100) NOT NULL,
                server_name VARCHAR(100) NOT NULL,
                region_id VARCHAR(50) NOT NULL,
                server_id VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_update DATETIME,
                UNIQUE KEY unique_region_server (region_name(50), server_name(50))
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

        // Crear índices si no existen (manejo de errores individual por índice)
        try {
            await pool.query(`CREATE INDEX idx_rankings_server_id ON rankings(server_id)`);
        } catch (e) {
            // Ignorar error si el índice ya existe
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        try {
            await pool.query(`CREATE INDEX idx_rankings_character ON rankings(character_name(50))`);
        } catch (e) {
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        try {
            await pool.query(`CREATE INDEX idx_rankings_clan ON rankings(clan(50))`);
        } catch (e) {
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        try {
            await pool.query(`CREATE INDEX idx_rankings_class ON rankings(class(50))`);
        } catch (e) {
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        try {
            await pool.query(`CREATE INDEX idx_rankings_collection_time ON rankings(collection_time)`);
        } catch (e) {
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        try {
            await pool.query(`CREATE INDEX idx_character_details_ranking_id ON character_details(ranking_id)`);
        } catch (e) {
            if (!e.message.includes('Duplicate key name')) throw e;
        }

        logger.success('Tablas de la base de datos inicializadas correctamente', 'Database');
    } catch (error) {
        logger.error(`Error al inicializar tablas de la base de datos: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Actualiza la tabla de servidores con la información más reciente
 * @param {Object} serverRegions - Objeto con la configuración de regiones y servidores
 */
async function updateServersDatabase(serverRegions) {
    try {
        // Crear una conexión del pool
        const connection = await pool.getConnection();
        
        try {
            // Iniciar transacción
            await connection.beginTransaction();
            
            for (const [regionName, regionData] of Object.entries(serverRegions)) {
                for (const [serverName, serverData] of Object.entries(regionData.servers)) {
                    // Insertar ignorando duplicados por clave única
                    await connection.query(
                        `INSERT IGNORE INTO servers (region_name, server_name, region_id, server_id) 
                         VALUES (?, ?, ?, ?)`,
                        [regionName, serverName, regionData.id, serverData.id]
                    );
                }
            }
            
            // Confirmar transacción
            await connection.commit();
            logger.success('Base de datos de servidores actualizada', 'Database');
        } catch (error) {
            // Revertir transacción en caso de error
            await connection.rollback();
            throw error;
        } finally {
            // Liberar la conexión
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
        const [result] = await pool.query(
            `UPDATE servers 
             SET is_active = 0, last_update = CURRENT_TIMESTAMP 
             WHERE region_name = ? AND server_name = ?`,
            [regionName, serverName]
        );
        
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
        const [result] = await pool.query(
            `UPDATE servers 
             SET is_active = 1, last_update = CURRENT_TIMESTAMP 
             WHERE region_name = ? AND server_name = ?`,
            [regionName, serverName]
        );
        
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
        // Obtener ID del servidor
        const [servers] = await pool.query(
            `SELECT id FROM servers WHERE region_name = ? AND server_name = ?`,
            [regionName, serverName]
        );
        
        if (!servers || servers.length === 0) {
            logger.warn(`No se encontró el servidor ${regionName} > ${serverName} en la base de datos`, 'Database');
            return;
        }
        const serverId = servers[0].id;
        
        // Marcar el servidor como activo ya que tenemos datos
        await markServerAsActive(regionName, serverName);
        
        // Crear una conexión del pool
        const connection = await pool.getConnection();
        
        try {
            // Iniciar transacción
            await connection.beginTransaction();
            
            // Eliminar rankings antiguos de este servidor
            await connection.query(`DELETE FROM rankings WHERE server_id = ?`, [serverId]);
            
            // Preparar datos para inserción masiva
            const values = rankings.map(player => [
                serverId,
                player.rank,
                player.character,
                player.clan,
                player.class,
                player.powerScore
            ]);
            
            if (values.length > 0) {
                // Insertar nuevos rankings
                await connection.query(
                    `INSERT INTO rankings (server_id, rank, character_name, clan, class, power_score)
                     VALUES ?`,
                    [values]
                );
            }
            
            // Confirmar transacción
            await connection.commit();
            logger.success(`${rankings.length} rankings guardados en la base de datos para ${regionName} > ${serverName}`, 'Database');
        } catch (error) {
            // Revertir transacción en caso de error
            await connection.rollback();
            throw error;
        } finally {
            // Liberar la conexión
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
 * @returns {boolean} - true si se actualizó o creó, false si se omitió por similitud
 */
async function saveCharacterDetails(rankingId, details) {
    try {
        const { calculateDetailsSimilarity } = require('./utils');
        
        // Verificar si ya existen detalles para este personaje
        const [existingDetailsRows] = await pool.query(
            `SELECT * FROM character_details WHERE ranking_id = ?`,
            [rankingId]
        );
        
        const achievementsJson = details.achievements ? JSON.stringify(details.achievements) : null;
        
        if (existingDetailsRows && existingDetailsRows.length > 0) {
            const existingDetails = existingDetailsRows[0];
            
            // Preparar el objeto de detalles existentes para comparación
            const formattedExistingDetails = {
                level: existingDetails.level,
                prestigeLevel: existingDetails.prestige_level,
                equipmentScore: existingDetails.equipment_score,
                spiritScore: existingDetails.spirit_score,
                energyScore: existingDetails.energy_score,
                magicalStoneScore: existingDetails.magical_stone_score,
                codexScore: existingDetails.codex_score,
                trophyScore: existingDetails.trophy_score,
                ethics: existingDetails.ethics,
                achievements: existingDetails.achievements
            };
            
            // Calcular similitud entre los datos existentes y los nuevos
            const similarityPercent = calculateDetailsSimilarity(formattedExistingDetails, details);
            
            // Si la similitud es mayor o igual al 80%, no actualizar
            if (similarityPercent >= 80) {
                logger.info(`Detalles del personaje con ranking ID: ${rankingId} omitidos por similitud del ${similarityPercent.toFixed(2)}%`, 'Database');
                return false;
            }
            
            // Actualizar detalles existentes solo si hay cambios significativos
            await pool.query(
                `UPDATE character_details
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
                     last_update = CURRENT_TIMESTAMP
                 WHERE ranking_id = ?`,
                [
                    details.level || 0,
                    details.prestigeLevel || 0,
                    details.equipmentScore || 0,
                    details.spiritScore || 0,
                    details.energyScore || 0,
                    details.magicalStoneScore || 0,
                    details.codexScore || 0,
                    details.trophyScore || 0,
                    details.ethics || 0,
                    achievementsJson,
                    rankingId
                ]
            );
            logger.success(`Detalles del personaje actualizados para ranking ID: ${rankingId} (similitud: ${similarityPercent.toFixed(2)}%)`, 'Database');
        } else {
            // Insertar nuevos detalles
            await pool.query(
                `INSERT INTO character_details (
                    ranking_id, level, prestige_level, equipment_score,
                    spirit_score, energy_score, magical_stone_score, 
                    codex_score, trophy_score, ethics, achievements
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
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
                    achievementsJson
                ]
            );
            logger.success(`Nuevos detalles de personaje guardados para ranking ID: ${rankingId}`, 'Database');
        }
        return true;
    } catch (error) {
        logger.error(`Error al guardar detalles del personaje: ${error.message}`, 'Database');
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
        const [rows] = await pool.query(
            `SELECT 
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
            LIMIT 1`,
            [characterName, regionName, serverName]
        );
        
        if (rows && rows.length > 0) {
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
        const [rows] = await pool.query(
            `SELECT r.id
             FROM rankings r
             JOIN servers s ON r.server_id = s.id
             WHERE r.character_name = ? AND s.region_name = ? AND s.server_name = ?`,
            [characterName, regionName, serverName]
        );
        
        return rows && rows.length > 0 ? rows[0].id : null;
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
        const [rows] = await pool.query(
            `SELECT region_name, server_name, region_id, server_id
             FROM servers 
             WHERE is_active = 1`
        );
        
        return rows || [];
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
        const [rows] = await pool.query(
            `SELECT r.rank, r.character_name as character, r.clan, r.class, r.power_score as powerScore
             FROM rankings r
             JOIN servers s ON r.server_id = s.id
             WHERE s.region_name = ? AND s.server_name = ?
             ORDER BY r.rank`,
            [regionName, serverName]
        );
        
        return rows || [];
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
        if (operation.status === 'running') {
            // Nueva operación
            const [result] = await pool.query(
                `INSERT INTO update_logs 
                 (update_type, description, status, start_time, affected_servers)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    operation.updateType,
                    operation.description,
                    operation.status,
                    operation.startTime.toISOString(),
                    operation.affectedServers || 0
                ]
            );
            
            operation.id = result.insertId;
        } else if (operation.status === 'completed' || operation.status === 'failed') {
            // Actualización de operación existente
            if (!operation.id) {
                throw new Error('Se requiere un ID de operación para actualizarla');
            }
            
            await pool.query(
                `UPDATE update_logs
                 SET status = ?, end_time = ?, error_message = ?
                 WHERE id = ?`,
                [
                    operation.status,
                    operation.endTime ? operation.endTime.toISOString() : null,
                    operation.errorMessage || null,
                    operation.id
                ]
            );
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
        const [servers] = await pool.query(
            `SELECT region_name, region_id, server_name, server_id
             FROM servers
             WHERE is_active = 1
             ORDER BY region_name, server_name`
        );
        
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

// Solo inicializar la base de datos automáticamente si no estamos en entorno de prueba
if (process.env.NODE_ENV !== 'test') {
    initializeDatabase().catch(err => {
        logger.error(`Error al inicializar la base de datos: ${err.message}`, 'Database');
        // No terminamos el proceso para permitir que la app funcione sin DB si es necesario
    });
}

module.exports = {
    pool,
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
    initializeDatabase // Exportamos la función para poder llamarla explícitamente cuando sea necesario
};