/**
 * Módulo de gestión de base de datos
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('./config');
const logger = require('./logger');
const { generateHash } = require('./utils');
const { validatePlayerRankings, validateCharacterDetails, ValidationErrorStrategies } = require('./validation');

// Ruta a la base de datos
const dbPath = path.join(process.cwd(), CONFIG.DATABASE_PATH);

// Asegurar que el directorio existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Instancia de la base de datos
let db = null;

/**
 * Inicializa la conexión a la base de datos
 * @returns {Promise<sqlite3.Database>} Instancia de la base de datos
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        logger.info(`Inicializando base de datos: ${dbPath}`, 'Database');
        
        db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                logger.error(`Error al conectar a la base de datos: ${err.message}`, 'Database');
                reject(err);
                return;
            }
            
            try {
                await createTables();
                logger.success('Base de datos inicializada correctamente', 'Database');
                resolve(db);
            } catch (error) {
                logger.error(`Error al crear las tablas: ${error.message}`, 'Database');
                reject(error);
            }
        });
    });
}

/**
 * Crea las tablas necesarias si no existen
 */
function createTables() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Tabla para almacenar snapshots de rankings
            db.run(`
                CREATE TABLE IF NOT EXISTS ranking_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    server TEXT NOT NULL,
                    source TEXT NOT NULL,
                    hash TEXT NOT NULL,
                    data_count INTEGER NOT NULL
                )
            `, (err) => {
                if (err) {
                    logger.error(`Error al crear tabla ranking_snapshots: ${err.message}`, 'Database');
                    reject(err);
                    return;
                }
            });
            
            // Tabla para almacenar personajes (normalizada)
            db.run(`
                CREATE TABLE IF NOT EXISTS characters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    class TEXT,
                    server TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    first_seen TEXT NOT NULL,
                    UNIQUE(name, server)
                )
            `, (err) => {
                if (err) {
                    logger.error(`Error al crear tabla characters: ${err.message}`, 'Database');
                    reject(err);
                    return;
                }
            });
            
            // Tabla para almacenar las entradas individuales de los rankings
            db.run(`
                CREATE TABLE IF NOT EXISTS ranking_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_id INTEGER NOT NULL,
                    character_id INTEGER NOT NULL,
                    rank INTEGER NOT NULL,
                    clan TEXT,
                    power_score INTEGER NOT NULL,
                    timestamp TEXT NOT NULL,
                    FOREIGN KEY (snapshot_id) REFERENCES ranking_snapshots(id),
                    FOREIGN KEY (character_id) REFERENCES characters(id)
                )
            `, (err) => {
                if (err) {
                    logger.error(`Error al crear tabla ranking_entries: ${err.message}`, 'Database');
                    reject(err);
                    return;
                }
            });
            
            // Tabla para almacenar los detalles de los personajes
            db.run(`
                CREATE TABLE IF NOT EXISTS character_details (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    character_id INTEGER NOT NULL,
                    level INTEGER NOT NULL,
                    prestige_level INTEGER DEFAULT 0,
                    equipment_score INTEGER DEFAULT 0,
                    spirit_score INTEGER DEFAULT 0,
                    energy_score INTEGER DEFAULT 0,
                    magical_stone_score INTEGER DEFAULT 0,
                    codex_score INTEGER DEFAULT 0,
                    trophy_score INTEGER DEFAULT 0,
                    ethics INTEGER DEFAULT 0,
                    achievements TEXT,
                    timestamp TEXT NOT NULL,
                    FOREIGN KEY (character_id) REFERENCES characters(id)
                )
            `, (err) => {
                if (err) {
                    logger.error(`Error al crear tabla character_details: ${err.message}`, 'Database');
                    reject(err);
                    return;
                }
            });
            
            // Índices para optimizar consultas frecuentes
            db.run(`CREATE INDEX IF NOT EXISTS idx_ranking_entries_snapshot_id ON ranking_entries(snapshot_id)`, (err) => {
                if (err) logger.warn(`Error al crear índice idx_ranking_entries_snapshot_id: ${err.message}`, 'Database');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_ranking_entries_character_id ON ranking_entries(character_id)`, (err) => {
                if (err) logger.warn(`Error al crear índice idx_ranking_entries_character_id: ${err.message}`, 'Database');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_character_details_character_id ON character_details(character_id)`, (err) => {
                if (err) logger.warn(`Error al crear índice idx_character_details_character_id: ${err.message}`, 'Database');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_ranking_snapshots_server ON ranking_snapshots(server)`, (err) => {
                if (err) logger.warn(`Error al crear índice idx_ranking_snapshots_server: ${err.message}`, 'Database');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_ranking_snapshots_timestamp ON ranking_snapshots(timestamp)`, (err) => {
                if (err) logger.warn(`Error al crear índice idx_ranking_snapshots_timestamp: ${err.message}`, 'Database');
            });
            
            resolve();
        });
    });
}

/**
 * Inserta un nuevo snapshot de ranking
 * @param {Array} rankings - Array con los datos del ranking
 * @param {string} server - Nombre del servidor
 * @param {string} source - Fuente de los datos
 * @returns {Promise<Object>} Información del snapshot insertado
 */
async function insertRankingSnapshot(rankings, server, source = 'scraper') {
    if (!rankings || !Array.isArray(rankings) || rankings.length === 0) {
        throw new Error('No se proporcionaron datos de ranking válidos');
    }

    // Validar los datos antes de insertarlos
    let validatedRankings;
    try {
        validatedRankings = validatePlayerRankings(rankings, ValidationErrorStrategies.DEFAULT_VALUE);
        logger.info(`Datos de ranking validados: ${validatedRankings.length} registros`, 'Database');
    } catch (error) {
        logger.error(`Error en la validación de datos: ${error.message}`, 'Database');
        throw error;
    }

    // Generar hash para comparación rápida de datos
    const dataHash = generateHash(validatedRankings);
    const timestamp = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            db.run('BEGIN TRANSACTION');
            
            try {
                // 1. Insertar el snapshot
                const snapshotResult = await runAsync(
                    `INSERT INTO ranking_snapshots (timestamp, server, source, hash, data_count) VALUES (?, ?, ?, ?, ?)`,
                    [timestamp, server, source, dataHash, validatedRankings.length]
                );
                
                const snapshotId = snapshotResult.lastID;
                
                // 2. Procesar cada entrada del ranking
                for (const entry of validatedRankings) {
                    // 2.1 Buscar o crear el personaje
                    const characterResult = await getOrCreateCharacter(entry.character, entry.class, server, timestamp);
                    const characterId = characterResult.id;
                    
                    // 2.2 Insertar la entrada del ranking
                    await runAsync(
                        `INSERT INTO ranking_entries (snapshot_id, character_id, rank, clan, power_score, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
                        [snapshotId, characterId, entry.rank, entry.clan || '', entry.powerScore, timestamp]
                    );
                }
                
                // Confirmar la transacción
                db.run('COMMIT');
                
                logger.success(`Snapshot de ranking insertado correctamente. ID: ${snapshotId}, Registros: ${validatedRankings.length}`, 'Database');
                resolve({
                    id: snapshotId,
                    timestamp,
                    server,
                    recordCount: validatedRankings.length,
                    hash: dataHash
                });
                
            } catch (error) {
                db.run('ROLLBACK');
                logger.error(`Error al insertar snapshot de ranking: ${error.message}`, 'Database');
                reject(error);
            }
        });
    });
}

/**
 * Obtiene o crea un registro de personaje
 * @param {string} name - Nombre del personaje
 * @param {string} characterClass - Clase del personaje
 * @param {string} server - Servidor del personaje
 * @param {string} timestamp - Marca de tiempo
 * @returns {Promise<Object>} - Datos del personaje
 */
async function getOrCreateCharacter(name, characterClass, server, timestamp) {
    // Buscar si el personaje ya existe
    try {
        const existingCharacter = await getAsync(
            `SELECT id FROM characters WHERE name = ? AND server = ?`,
            [name, server]
        );
        
        if (existingCharacter) {
            // Actualizar la fecha de último avistamiento
            await runAsync(
                `UPDATE characters SET last_seen = ?, class = COALESCE(NULLIF(?, ''), class) WHERE id = ?`,
                [timestamp, characterClass || '', existingCharacter.id]
            );
            
            return existingCharacter;
        }
        
        // Si no existe, crearlo
        const result = await runAsync(
            `INSERT INTO characters (name, class, server, last_seen, first_seen) VALUES (?, ?, ?, ?, ?)`,
            [name, characterClass || '', server, timestamp, timestamp]
        );
        
        return { id: result.lastID };
        
    } catch (error) {
        logger.error(`Error al obtener/crear personaje ${name}: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Inserta o actualiza los detalles de un personaje
 * @param {string} characterName - Nombre del personaje
 * @param {string} server - Servidor del personaje
 * @param {Object} details - Detalles del personaje
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function insertCharacterDetails(characterName, server, details) {
    if (!characterName || !server || !details) {
        throw new Error('Parámetros insuficientes para insertar detalles de personaje');
    }
    
    // Validar los detalles antes de insertarlos
    let validatedDetails;
    try {
        validatedDetails = validateCharacterDetails(details, ValidationErrorStrategies.DEFAULT_VALUE);
        logger.info(`Detalles de personaje validados para ${characterName}`, 'Database');
    } catch (error) {
        logger.error(`Error en la validación de detalles: ${error.message}`, 'Database');
        throw error;
    }

    const timestamp = new Date().toISOString();
    
    // Asegurar que achievements sea un string JSON si existe
    if (validatedDetails.achievements && typeof validatedDetails.achievements !== 'string') {
        validatedDetails.achievements = JSON.stringify(validatedDetails.achievements);
    }
    
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // 1. Obtener el personaje (o crearlo si no existe)
                const character = await getOrCreateCharacter(characterName, validatedDetails.class, server, timestamp);
                const characterId = character.id;
                
                // 2. Verificar si ya hay detalles recientes para este personaje (últimas 24h)
                const recentDetails = await getAsync(`
                    SELECT id, timestamp FROM character_details 
                    WHERE character_id = ? 
                    ORDER BY timestamp DESC LIMIT 1
                `, [characterId]);
                
                // Si hay detalles recientes, decidir si actualizarlos
                if (recentDetails) {
                    const recentTimestamp = new Date(recentDetails.timestamp);
                    const now = new Date(timestamp);
                    const hoursSinceLastUpdate = (now - recentTimestamp) / (1000 * 60 * 60);
                    
                    // Si han pasado menos de 24 horas, comparar datos para ver si hay cambios significativos
                    if (hoursSinceLastUpdate < 24) {
                        // Obtener los detalles anteriores para comparar
                        const previousDetails = await getAsync(`
                            SELECT level, prestige_level, equipment_score, spirit_score, 
                                   energy_score, magical_stone_score, codex_score, 
                                   trophy_score, ethics, achievements
                            FROM character_details
                            WHERE id = ?
                        `, [recentDetails.id]);
                        
                        // Si los detalles son muy similares, no actualizar
                        const hasSignificantChanges = detailsHaveSignificantChanges(previousDetails, validatedDetails);
                        if (!hasSignificantChanges) {
                            logger.info(`No hay cambios significativos para ${characterName}, omitiendo actualización`, 'Database');
                            return resolve({ updated: false, reason: 'no_significant_changes', characterId });
                        }
                    }
                }
                
                // 3. Insertar los nuevos detalles
                const result = await runAsync(`
                    INSERT INTO character_details (
                        character_id, level, prestige_level, equipment_score, 
                        spirit_score, energy_score, magical_stone_score, 
                        codex_score, trophy_score, ethics, achievements, timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    characterId, 
                    validatedDetails.level, 
                    validatedDetails.prestigeLevel || 0,
                    validatedDetails.equipmentScore || 0,
                    validatedDetails.spiritScore || 0,
                    validatedDetails.energyScore || 0,
                    validatedDetails.magicalStoneScore || 0,
                    validatedDetails.codexScore || 0,
                    validatedDetails.trophyScore || 0,
                    validatedDetails.ethics || 0,
                    validatedDetails.achievements || null,
                    timestamp
                ]);
                
                logger.success(`Detalles insertados para ${characterName} (ID: ${result.lastID})`, 'Database');
                resolve({ updated: true, detailsId: result.lastID, characterId });
                
            } catch (error) {
                logger.error(`Error al insertar detalles de personaje ${characterName}: ${error.message}`, 'Database');
                reject(error);
            }
        });
    });
}

/**
 * Determina si hay cambios significativos entre dos conjuntos de detalles
 * @param {Object} oldDetails - Detalles anteriores
 * @param {Object} newDetails - Nuevos detalles
 * @returns {boolean} - true si hay cambios significativos
 */
function detailsHaveSignificantChanges(oldDetails, newDetails) {
    // Cambio significativo si el nivel o prestigio cambió
    if (oldDetails.level !== newDetails.level || oldDetails.prestige_level !== newDetails.prestigeLevel) {
        return true;
    }
    
    // Cambio significativo si algún puntaje cambió más del 5%
    const scoreFields = [
        { old: 'equipment_score', new: 'equipmentScore' },
        { old: 'spirit_score', new: 'spiritScore' },
        { old: 'energy_score', new: 'energyScore' },
        { old: 'magical_stone_score', new: 'magicalStoneScore' },
        { old: 'codex_score', new: 'codexScore' },
        { old: 'trophy_score', new: 'trophyScore' },
        { old: 'ethics', new: 'ethics' }
    ];
    
    for (const field of scoreFields) {
        const oldValue = oldDetails[field.old] || 0;
        const newValue = newDetails[field.new] || 0;
        
        // Si ambos valores son 0, no hay cambio
        if (oldValue === 0 && newValue === 0) continue;
        
        // Si uno es 0 y el otro no, hay cambio significativo
        if (oldValue === 0 || newValue === 0) return true;
        
        // Calcular el cambio porcentual
        const percentChange = Math.abs(newValue - oldValue) / oldValue * 100;
        if (percentChange > 5) {
            logger.info(`Campo ${field.new} cambió ${percentChange.toFixed(2)}% (${oldValue} → ${newValue})`, 'Database');
            return true;
        }
    }
    
    // Comparar logros
    const oldAchievements = typeof oldDetails.achievements === 'string' 
        ? JSON.parse(oldDetails.achievements || '[]') 
        : (oldDetails.achievements || []);
        
    const newAchievements = typeof newDetails.achievements === 'string'
        ? JSON.parse(newDetails.achievements || '[]')
        : (newDetails.achievements || []);
        
    if (oldAchievements.length !== newAchievements.length) {
        return true;
    }
    
    return false;
}

/**
 * Obtiene la lista de snapshots disponibles
 * @param {Object} filters - Filtros para la consulta
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>} - Lista de snapshots
 */
function getSnapshotsList(filters = {}, limit = 100) {
    const { server, fromDate, toDate, minEntries } = filters;
    
    let query = `SELECT id, timestamp, server, source, hash, data_count FROM ranking_snapshots`;
    const params = [];
    
    // Construir WHERE según filtros
    const conditions = [];
    
    if (server) {
        conditions.push(`server = ?`);
        params.push(server);
    }
    
    if (fromDate) {
        conditions.push(`timestamp >= ?`);
        params.push(fromDate);
    }
    
    if (toDate) {
        conditions.push(`timestamp <= ?`);
        params.push(toDate);
    }
    
    if (minEntries) {
        conditions.push(`data_count >= ?`);
        params.push(minEntries);
    }
    
    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    
    // Ordenar por timestamp descendente
    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);
    
    return allAsync(query, params);
}

/**
 * Obtiene los detalles de un snapshot específico
 * @param {number} snapshotId - ID del snapshot
 * @returns {Promise<Object>} - Datos del snapshot con sus entradas
 */
async function getSnapshotDetails(snapshotId) {
    if (!snapshotId) {
        throw new Error('Se requiere el ID del snapshot');
    }
    
    try {
        // Obtener datos del snapshot
        const snapshot = await getAsync(
            `SELECT id, timestamp, server, source, hash, data_count 
             FROM ranking_snapshots WHERE id = ?`,
            [snapshotId]
        );
        
        if (!snapshot) {
            throw new Error(`Snapshot no encontrado: ${snapshotId}`);
        }
        
        // Obtener las entradas del snapshot
        const entries = await allAsync(
            `SELECT re.rank, c.name as character, c.class, re.clan, re.power_score as powerScore,
                    re.timestamp, c.id as characterId
             FROM ranking_entries re
             JOIN characters c ON c.id = re.character_id
             WHERE re.snapshot_id = ?
             ORDER BY re.rank ASC`,
            [snapshotId]
        );
        
        return {
            ...snapshot,
            entries
        };
    } catch (error) {
        logger.error(`Error al obtener detalles del snapshot ${snapshotId}: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Obtiene el histórico de rankings de un personaje
 * @param {string} characterName - Nombre del personaje
 * @param {string} server - Servidor del personaje
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} - Histórico de rankings
 */
async function getCharacterRankingHistory(characterName, server, options = {}) {
    if (!characterName || !server) {
        throw new Error('Se requiere nombre del personaje y servidor');
    }
    
    const { limit = 100, fromDate, toDate } = options;
    
    try {
        // Primero obtener el ID del personaje
        const character = await getAsync(
            `SELECT id FROM characters WHERE name = ? AND server = ?`,
            [characterName, server]
        );
        
        if (!character) {
            return []; // Personaje no encontrado
        }
        
        // Construir la consulta para el histórico
        let query = `
            SELECT re.rank, re.clan, re.power_score as powerScore, re.timestamp,
                   rs.server, rs.id as snapshotId
            FROM ranking_entries re
            JOIN ranking_snapshots rs ON rs.id = re.snapshot_id
            WHERE re.character_id = ?
        `;
        
        const params = [character.id];
        
        // Aplicar filtros adicionales
        if (fromDate) {
            query += ` AND re.timestamp >= ?`;
            params.push(fromDate);
        }
        
        if (toDate) {
            query += ` AND re.timestamp <= ?`;
            params.push(toDate);
        }
        
        // Ordenar por timestamp descendente y limitar resultados
        query += ` ORDER BY re.timestamp DESC LIMIT ?`;
        params.push(limit);
        
        // Ejecutar la consulta
        const history = await allAsync(query, params);
        
        return history;
        
    } catch (error) {
        logger.error(`Error al obtener histórico del personaje ${characterName}: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Obtiene el snapshot más reciente según criterios
 * @param {Object} filters - Filtros para la búsqueda
 * @returns {Promise<Object|null>} - Snapshot encontrado o null
 */
async function getLatestSnapshot(filters = {}) {
    const { server } = filters;
    
    let query = `
        SELECT id, timestamp, server, source, hash, data_count 
        FROM ranking_snapshots
    `;
    
    const params = [];
    const conditions = [];
    
    if (server) {
        conditions.push(`server = ?`);
        params.push(server);
    }
    
    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    
    query += ` ORDER BY timestamp DESC LIMIT 1`;
    
    try {
        return await getAsync(query, params);
    } catch (error) {
        logger.error(`Error al obtener el último snapshot: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Compara dos snapshots y devuelve las diferencias
 * @param {number} oldSnapshotId - ID del snapshot anterior
 * @param {number} newSnapshotId - ID del snapshot nuevo
 * @returns {Promise<Object>} - Diferencias encontradas
 */
async function compareSnapshots(oldSnapshotId, newSnapshotId) {
    if (!oldSnapshotId || !newSnapshotId) {
        throw new Error('Se requieren los IDs de ambos snapshots');
    }
    
    try {
        // Verificar que los snapshots existen
        const oldSnapshot = await getAsync(
            `SELECT id, timestamp, server, hash FROM ranking_snapshots WHERE id = ?`,
            [oldSnapshotId]
        );
        
        const newSnapshot = await getAsync(
            `SELECT id, timestamp, server, hash FROM ranking_snapshots WHERE id = ?`,
            [newSnapshotId]
        );
        
        if (!oldSnapshot || !newSnapshot) {
            throw new Error('Uno o ambos snapshots no existen');
        }
        
        // Verificar que sean del mismo servidor
        if (oldSnapshot.server !== newSnapshot.server) {
            throw new Error('Los snapshots deben ser del mismo servidor');
        }
        
        // Si los hashes son iguales, no hay diferencias
        if (oldSnapshot.hash === newSnapshot.hash) {
            return {
                hasChanges: false,
                reason: 'Snapshots idénticos (mismo hash)',
                server: oldSnapshot.server,
                oldTimestamp: oldSnapshot.timestamp,
                newTimestamp: newSnapshot.timestamp
            };
        }
        
        // Obtener todos los personajes del snapshot antiguo
        const oldCharacters = await allAsync(`
            SELECT re.rank, c.name as character, c.class, re.clan, re.power_score as powerScore,
                   c.id as characterId
            FROM ranking_entries re
            JOIN characters c ON c.id = re.character_id
            WHERE re.snapshot_id = ?
            ORDER BY re.rank ASC
        `, [oldSnapshotId]);
        
        // Obtener todos los personajes del snapshot nuevo
        const newCharacters = await allAsync(`
            SELECT re.rank, c.name as character, c.class, re.clan, re.power_score as powerScore,
                   c.id as characterId
            FROM ranking_entries re
            JOIN characters c ON c.id = re.character_id
            WHERE re.snapshot_id = ?
            ORDER BY re.rank ASC
        `, [newSnapshotId]);
        
        // Crear mapas para búsqueda eficiente
        const oldCharMap = new Map(oldCharacters.map(c => [c.character.toLowerCase(), c]));
        const newCharMap = new Map(newCharacters.map(c => [c.character.toLowerCase(), c]));
        
        // Encontrar personajes nuevos
        const newEntries = newCharacters.filter(c => 
            !oldCharMap.has(c.character.toLowerCase())
        );
        
        // Encontrar personajes que salieron del ranking
        const removedEntries = oldCharacters.filter(c => 
            !newCharMap.has(c.character.toLowerCase())
        );
        
        // Encontrar personajes que cambiaron
        const changedEntries = [];
        
        newCharMap.forEach((newChar, name) => {
            const oldChar = oldCharMap.get(name);
            if (oldChar) {
                const changes = {};
                let hasChanges = false;
                
                // Comparar rank
                if (oldChar.rank !== newChar.rank) {
                    changes.rank = {
                        old: oldChar.rank,
                        new: newChar.rank,
                        change: oldChar.rank - newChar.rank // positivo = subió, negativo = bajó
                    };
                    hasChanges = true;
                }
                
                // Comparar clan
                if (oldChar.clan !== newChar.clan) {
                    changes.clan = {
                        old: oldChar.clan,
                        new: newChar.clan
                    };
                    hasChanges = true;
                }
                
                // Comparar powerScore
                if (oldChar.powerScore !== newChar.powerScore) {
                    changes.powerScore = {
                        old: oldChar.powerScore,
                        new: newChar.powerScore,
                        change: newChar.powerScore - oldChar.powerScore,
                        percentChange: ((newChar.powerScore - oldChar.powerScore) / oldChar.powerScore) * 100
                    };
                    hasChanges = true;
                }
                
                // Comparar clase (podría haber cambiado si antes era null y ahora se conoce)
                if (oldChar.class !== newChar.class && (oldChar.class || newChar.class)) {
                    changes.class = {
                        old: oldChar.class || 'Desconocido',
                        new: newChar.class || 'Desconocido'
                    };
                    hasChanges = true;
                }
                
                if (hasChanges) {
                    changedEntries.push({
                        character: newChar.character,
                        characterId: newChar.characterId,
                        changes
                    });
                }
            }
        });
        
        // Calcular estadísticas generales
        const timeGap = new Date(newSnapshot.timestamp) - new Date(oldSnapshot.timestamp);
        const timeGapHours = timeGap / (1000 * 60 * 60);
        
        return {
            hasChanges: true,
            server: oldSnapshot.server,
            oldTimestamp: oldSnapshot.timestamp,
            newTimestamp: newSnapshot.timestamp,
            timeGapHours,
            stats: {
                totalOld: oldCharacters.length,
                totalNew: newCharacters.length,
                newEntries: newEntries.length,
                removedEntries: removedEntries.length,
                changedEntries: changedEntries.length
            },
            newEntries,
            removedEntries,
            changedEntries
        };
        
    } catch (error) {
        logger.error(`Error al comparar snapshots: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Obtiene los detalles de un personaje
 * @param {string} characterName - Nombre del personaje
 * @param {string} server - Servidor del personaje
 * @param {boolean} includeHistory - Si se debe incluir el histórico de detalles
 * @returns {Promise<Object>} - Datos del personaje
 */
async function getCharacterDetails(characterName, server, includeHistory = false) {
    if (!characterName || !server) {
        throw new Error('Se requiere nombre del personaje y servidor');
    }
    
    try {
        // Obtener información básica del personaje
        const character = await getAsync(`
            SELECT id, name, class, server, last_seen, first_seen
            FROM characters
            WHERE name = ? AND server = ?
        `, [characterName, server]);
        
        if (!character) {
            return null; // Personaje no encontrado
        }
        
        // Obtener los detalles más recientes
        const latestDetails = await getAsync(`
            SELECT cd.level, cd.prestige_level AS prestigeLevel, cd.equipment_score AS equipmentScore,
                   cd.spirit_score AS spiritScore, cd.energy_score AS energyScore,
                   cd.magical_stone_score AS magicalStoneScore, cd.codex_score AS codexScore,
                   cd.trophy_score AS trophyScore, cd.ethics, cd.achievements, cd.timestamp
            FROM character_details cd
            WHERE cd.character_id = ?
            ORDER BY cd.timestamp DESC
            LIMIT 1
        `, [character.id]);
        
        // Obtener el ranking actual (el más reciente)
        const currentRanking = await getAsync(`
            WITH LatestSnapshot AS (
                SELECT id
                FROM ranking_snapshots
                WHERE server = ?
                ORDER BY timestamp DESC
                LIMIT 1
            )
            SELECT re.rank, re.clan, re.power_score AS powerScore, re.timestamp
            FROM ranking_entries re
            JOIN LatestSnapshot ls ON re.snapshot_id = ls.id
            WHERE re.character_id = ?
        `, [server, character.id]);
        
        const result = {
            ...character,
            details: latestDetails || null,
            currentRanking: currentRanking || null
        };
        
        // Si se solicita el histórico, obtenerlo
        if (includeHistory) {
            // Histórico de detalles (últimos 10)
            result.detailsHistory = await allAsync(`
                SELECT level, prestige_level AS prestigeLevel, equipment_score AS equipmentScore,
                       spirit_score AS spiritScore, energy_score AS energyScore,
                       magical_stone_score AS magicalStoneScore, codex_score AS codexScore,
                       trophy_score AS trophyScore, ethics, achievements, timestamp
                FROM character_details
                WHERE character_id = ?
                ORDER BY timestamp DESC
                LIMIT 10
            `, [character.id]);
            
            // Histórico de rankings (últimos 30)
            result.rankingHistory = await allAsync(`
                SELECT re.rank, re.clan, re.power_score AS powerScore,
                       re.timestamp, rs.id AS snapshotId
                FROM ranking_entries re
                JOIN ranking_snapshots rs ON rs.id = re.snapshot_id
                WHERE re.character_id = ?
                ORDER BY re.timestamp DESC
                LIMIT 30
            `, [character.id]);
        }
        
        // Parsear achievements si existen
        if (result.details && result.details.achievements) {
            try {
                result.details.achievements = JSON.parse(result.details.achievements);
            } catch (error) {
                logger.warn(`Error al parsear achievements para ${characterName}: ${error.message}`, 'Database');
                result.details.achievements = [];
            }
        }
        
        // También para el histórico si se solicitó
        if (includeHistory && result.detailsHistory) {
            result.detailsHistory.forEach(detail => {
                if (detail.achievements) {
                    try {
                        detail.achievements = JSON.parse(detail.achievements);
                    } catch (error) {
                        detail.achievements = [];
                    }
                }
            });
        }
        
        return result;
        
    } catch (error) {
        logger.error(`Error al obtener detalles del personaje ${characterName}: ${error.message}`, 'Database');
        throw error;
    }
}

/**
 * Ejecuta una consulta que devuelve múltiples filas (ALL)
 * @param {string} query - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<Array>} - Resultados de la consulta
 */
function allAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        });
    });
}

/**
 * Ejecuta una consulta que devuelve una sola fila (GET)
 * @param {string} query - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<Object|null>} - Resultado de la consulta o null si no hay resultados
 */
function getAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

/**
 * Ejecuta una consulta que modifica la base de datos (RUN)
 * @param {string} query - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<Object>} - Información de la operación
 */
function runAsync(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) {
                reject(err);
                return;
            }
            
            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

/**
 * Cierra la conexión a la base de datos
 * @returns {Promise<void>}
 */
function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }
        
        db.close(err => {
            if (err) {
                reject(err);
                return;
            }
            
            db = null;
            logger.info('Conexión a la base de datos cerrada', 'Database');
            resolve();
        });
    });
}

module.exports = {
    initDatabase,
    insertRankingSnapshot,
    insertCharacterDetails,
    getSnapshotsList,
    getSnapshotDetails,
    getCharacterRankingHistory,
    getLatestSnapshot,
    compareSnapshots,
    getCharacterDetails,
    closeDatabase
};