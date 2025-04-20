/**
 * Módulo para manejar la base de datos SQLite
 * Almacenamiento persistente para los rankings de MIR4
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { CONFIG } = require('./config');
const logger = require('./logger');

// Ruta de la base de datos
const DB_PATH = path.join(process.cwd(), CONFIG.DATA_DIR, 'mir4rankings.db');

// Asegurar que existe el directorio para la base de datos
const dataDir = path.join(process.cwd(), CONFIG.DATA_DIR);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Inicializar la conexión a la base de datos
let db;
try {
    db = new Database(DB_PATH);
    logger.info(`Base de datos SQLite conectada en: ${DB_PATH}`, 'Database');
} catch (error) {
    logger.error(`Error al conectar con la base de datos: ${error.message}`, 'Database');
    throw error;
}

// Crear tablas si no existen
function initDatabase() {
    try {
        // Tabla para servidores
        db.prepare(`
            CREATE TABLE IF NOT EXISTS servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                region_name TEXT NOT NULL,
                server_name TEXT NOT NULL,
                region_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                last_update DATETIME,
                UNIQUE(region_name, server_name)
            )
        `).run();

        // Tabla para rankings
        db.prepare(`
            CREATE TABLE IF NOT EXISTS rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id INTEGER,
                rank INTEGER,
                character TEXT,
                clan TEXT,
                class TEXT,
                power_score INTEGER,
                collection_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(server_id) REFERENCES servers(id)
            )
        `).run();

        // Nueva tabla para detalles de personajes
        db.prepare(`
            CREATE TABLE IF NOT EXISTS character_details (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ranking_id INTEGER,
                level INTEGER,
                prestige_level INTEGER DEFAULT 0,
                equipment_score INTEGER DEFAULT 0,
                spirit_score INTEGER DEFAULT 0,
                energy_score INTEGER DEFAULT 0,
                magical_stone_score INTEGER DEFAULT 0,
                codex_score INTEGER DEFAULT 0,
                trophy_score INTEGER DEFAULT 0,
                ethics INTEGER DEFAULT 0,
                achievements TEXT,
                last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(ranking_id) REFERENCES rankings(id)
            )
        `).run();

        // Tabla para el registro de operaciones de actualización
        db.prepare(`
            CREATE TABLE IF NOT EXISTS update_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                update_type TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                affected_servers INTEGER DEFAULT 0,
                error_message TEXT
            )
        `).run();

        // Índices para mejorar rendimiento
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_rankings_server_id ON rankings(server_id)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_rankings_character ON rankings(character)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_rankings_clan ON rankings(clan)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_rankings_class ON rankings(class)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_rankings_collection_time ON rankings(collection_time)`).run();
        
        // Índices para la tabla de detalles de personajes
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_character_details_ranking_id ON character_details(ranking_id)`).run();

        logger.success('Tablas de la base de datos inicializadas correctamente', 'Database');
    } catch (error) {
        logger.error(`Error al inicializar tablas de la base de datos: ${error.message}`, 'Database');
        throw error;
    }
}

// Inicializar la base de datos
initDatabase();

/**
 * Actualiza la tabla de servidores con la información más reciente
 * @param {Object} serverRegions - Objeto con la configuración de regiones y servidores
 */
function updateServersDatabase(serverRegions) {
    const insertServer = db.prepare(`
        INSERT OR IGNORE INTO servers (region_name, server_name, region_id, server_id) 
        VALUES (?, ?, ?, ?)
    `);
    
    const transaction = db.transaction((regions) => {
        for (const [regionName, regionData] of Object.entries(regions)) {
            for (const [serverName, serverData] of Object.entries(regionData.servers)) {
                insertServer.run(regionName, serverName, regionData.id, serverData.id);
            }
        }
    });
    
    try {
        transaction(serverRegions);
        logger.success('Base de datos de servidores actualizada', 'Database');
    } catch (error) {
        logger.error(`Error al actualizar base de datos de servidores: ${error.message}`, 'Database');
    }
}

/**
 * Marca un servidor como inactivo en la base de datos
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 */
function markServerAsInactive(regionName, serverName) {
    try {
        const result = db.prepare(`
            UPDATE servers 
            SET is_active = 0, last_update = CURRENT_TIMESTAMP 
            WHERE region_name = ? AND server_name = ?
        `).run(regionName, serverName);
        
        if (result.changes > 0) {
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
function markServerAsActive(regionName, serverName) {
    try {
        const result = db.prepare(`
            UPDATE servers 
            SET is_active = 1, last_update = CURRENT_TIMESTAMP 
            WHERE region_name = ? AND server_name = ?
        `).run(regionName, serverName);
        
        if (result.changes > 0) {
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
function saveServerRankings(rankings, regionName, serverName) {
    if (!rankings || rankings.length === 0) {
        logger.warn(`No hay rankings para guardar de ${regionName} > ${serverName}`, 'Database');
        return;
    }
    
    try {
        // Obtener ID del servidor
        const serverId = db.prepare(`
            SELECT id FROM servers WHERE region_name = ? AND server_name = ?
        `).get(regionName, serverName);
        
        if (!serverId) {
            logger.warn(`No se encontró el servidor ${regionName} > ${serverName} en la base de datos`, 'Database');
            return;
        }
        
        // Marcar el servidor como activo ya que tenemos datos
        markServerAsActive(regionName, serverName);
        
        // Eliminar rankings antiguos de este servidor
        db.prepare(`DELETE FROM rankings WHERE server_id = ?`).run(serverId.id);
        
        // Insertar nuevos rankings
        const insertRanking = db.prepare(`
            INSERT INTO rankings (server_id, rank, character, clan, class, power_score)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const transaction = db.transaction((serverRankings) => {
            for (const player of serverRankings) {
                insertRanking.run(
                    serverId.id,
                    player.rank,
                    player.character,
                    player.clan,
                    player.class,
                    player.powerScore
                );
            }
        });
        
        transaction(rankings);
        
        logger.success(`${rankings.length} rankings guardados en la base de datos para ${regionName} > ${serverName}`, 'Database');
    } catch (error) {
        logger.error(`Error al guardar rankings en la base de datos: ${error.message}`, 'Database');
    }
}

/**
 * Guarda los detalles adicionales de un personaje
 * @param {number} rankingId - ID del ranking al que pertenece el personaje
 * @param {Object} details - Detalles del personaje
 */
function saveCharacterDetails(rankingId, details) {
    try {
        // Verificar si ya existen detalles para este personaje
        const existingDetails = db.prepare(`
            SELECT id FROM character_details WHERE ranking_id = ?
        `).get(rankingId);
        
        if (existingDetails) {
            // Actualizar detalles existentes
            db.prepare(`
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
                    last_update = CURRENT_TIMESTAMP
                WHERE ranking_id = ?
            `).run(
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
            );
            logger.success(`Detalles del personaje actualizados para ranking ID: ${rankingId}`, 'Database');
        } else {
            // Insertar nuevos detalles
            db.prepare(`
                INSERT INTO character_details (
                    ranking_id, level, prestige_level, equipment_score,
                    spirit_score, energy_score, magical_stone_score, 
                    codex_score, trophy_score, ethics, achievements
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
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
            );
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
function getCharacterDetails(characterName, regionName, serverName) {
    try {
        const characterData = db.prepare(`
            SELECT 
                r.id as ranking_id,
                r.rank,
                r.character,
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
            WHERE r.character = ? AND s.region_name = ? AND s.server_name = ?
            ORDER BY r.collection_time DESC
            LIMIT 1
        `).get(characterName, regionName, serverName);
        
        if (characterData && characterData.achievements) {
            try {
                characterData.achievements = JSON.parse(characterData.achievements);
            } catch (e) {
                characterData.achievements = [];
            }
        }
        
        return characterData || null;
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
function getRankingId(characterName, regionName, serverName) {
    try {
        const result = db.prepare(`
            SELECT r.id
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            WHERE r.character = ? AND s.region_name = ? AND s.server_name = ?
        `).get(characterName, regionName, serverName);
        
        return result ? result.id : null;
    } catch (error) {
        logger.error(`Error al obtener ranking ID para ${characterName}: ${error.message}`, 'Database');
        return null;
    }
}

/**
 * Obtiene los servidores activos de la base de datos
 * @returns {Array} - Lista de servidores activos
 */
function getActiveServers() {
    try {
        return db.prepare(`
            SELECT region_name, server_name, region_id, server_id
            FROM servers 
            WHERE is_active = 1
        `).all();
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
function getServerRankings(regionName, serverName) {
    try {
        return db.prepare(`
            SELECT r.rank, r.character, r.clan, r.class, r.power_score as powerScore
            FROM rankings r
            JOIN servers s ON r.server_id = s.id
            WHERE s.region_name = ? AND s.server_name = ?
            ORDER BY r.rank
        `).all(regionName, serverName);
    } catch (error) {
        logger.error(`Error al obtener rankings del servidor ${regionName} > ${serverName}: ${error.message}`, 'Database');
        return [];
    }
}

/**
 * Registra una operación de actualización en la base de datos
 * @param {Object} operation - Datos de la operación
 */
function logUpdateOperation(operation) {
    try {
        if (operation.status === 'running') {
            // Nueva operación
            const result = db.prepare(`
                INSERT INTO update_logs 
                (update_type, description, status, start_time, affected_servers)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                operation.updateType,
                operation.description,
                operation.status,
                operation.startTime.toISOString(),
                operation.affectedServers || 0
            );
            
            operation.id = result.lastInsertRowid;
        } else if (operation.status === 'completed' || operation.status === 'failed') {
            // Actualización de operación existente
            if (!operation.id) {
                throw new Error('Se requiere un ID de operación para actualizarla');
            }
            
            db.prepare(`
                UPDATE update_logs
                SET status = ?, end_time = ?, error_message = ?
                WHERE id = ?
            `).run(
                operation.status,
                operation.endTime ? operation.endTime.toISOString() : null,
                operation.errorMessage || null,
                operation.id
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
function getActiveServersList() {
    try {
        const servers = db.prepare(`
            SELECT region_name, region_id, server_name, server_id
            FROM servers
            WHERE is_active = 1
            ORDER BY region_name, server_name
        `).all();
        
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
    db,
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