/**
 * Rutas para la API de rankings de MIR4
 */

const express = require('express');
const { fetchRankingData, fetchServerRankingData, buildServerUrl } = require('./scraper');
const { getQueryCache, setQueryCache, clearCache, getCacheStats, getServerCache } = require('./cache');
const { SERVER_REGIONS, CONFIG } = require('./config');
const logger = require('./logger');

const router = express.Router();

// Endpoint para la ruta raíz con información básica
router.get('/', (req, res) => {
    try {
        logger.route('Acceso a la página principal de la API');
        res.json({
            name: 'MIR4 Rankings API',
            version: '1.0.0',
            description: 'API para consultar rankings de jugadores en MIR4',
            endpoints: {
                '/': 'Información básica sobre la API',
                '/docs': 'Documentación completa de la API',
                '/rankings': 'Obtener todos los rankings',
                '/rankings/range/:start/:end': 'Obtener un rango específico de rankings',
                '/rankings/server/:server': 'Buscar por servidor',
                '/rankings/clan/:clan': 'Buscar por clan',
                '/rankings/class/:className': 'Filtrar por clase',
                '/servers': 'Listar todas las regiones y servidores disponibles',
                '/rankings/search/:characterName': 'Buscar un personaje en todos los servidores'
            },
            documentation: '/docs',
            status: 'active'
        });
        logger.success('Información básica de la API enviada', 'API');
    } catch (error) {
        logger.error(`Error al servir la página principal: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para documentación detallada de la API
router.get('/docs', (req, res) => {
    try {
        logger.route('Acceso a la documentación de la API');
        res.json({
            title: 'Documentación de MIR4 Rankings API',
            version: '1.0.0',
            description: 'API para consultar rankings de jugadores en MIR4, permitiendo búsquedas por servidor, clan, clase y personaje.',
            baseUrl: `${req.protocol}://${req.get('host')}`,
            endpoints: [
                {
                    path: '/',
                    method: 'GET',
                    description: 'Información básica sobre la API y sus endpoints',
                    parameters: [],
                    response: 'Objeto JSON con información general sobre la API y sus endpoints disponibles'
                },
                {
                    path: '/docs',
                    method: 'GET',
                    description: 'Documentación completa de la API',
                    parameters: [],
                    response: 'Objeto JSON con documentación detallada de todos los endpoints de la API'
                },
                {
                    path: '/rankings',
                    method: 'GET',
                    description: 'Obtener el ranking completo de jugadores',
                    parameters: [],
                    response: 'Array de objetos con información de cada jugador'
                },
                {
                    path: '/rankings/refresh',
                    method: 'POST',
                    description: 'Forzar actualización del caché de rankings',
                    parameters: [],
                    response: 'Objeto JSON con confirmación de actualización y conteo de registros'
                },
                {
                    path: '/rankings/range/:start/:end',
                    method: 'GET',
                    description: 'Obtener un rango específico de rankings',
                    parameters: [
                        { name: 'start', type: 'number', description: 'Posición inicial del rango' },
                        { name: 'end', type: 'number', description: 'Posición final del rango' }
                    ],
                    response: 'Array de objetos con los jugadores en el rango especificado'
                },
                {
                    path: '/rankings/server/:server',
                    method: 'GET',
                    description: 'Buscar jugadores por servidor',
                    parameters: [
                        { name: 'server', type: 'string', description: 'Nombre del servidor a buscar' }
                    ],
                    response: 'Array de objetos con jugadores del servidor especificado'
                },
                {
                    path: '/rankings/clan/:clan',
                    method: 'GET',
                    description: 'Buscar jugadores por clan',
                    parameters: [
                        { name: 'clan', type: 'string', description: 'Nombre del clan a buscar' }
                    ],
                    response: 'Array de objetos con jugadores del clan especificado'
                },
                {
                    path: '/rankings/class/:className',
                    method: 'GET',
                    description: 'Filtrar jugadores por clase',
                    parameters: [
                        { name: 'className', type: 'string', description: 'Nombre de la clase a filtrar' }
                    ],
                    response: 'Array de objetos con jugadores de la clase especificada'
                },
                {
                    path: '/rankings/stats',
                    method: 'GET',
                    description: 'Obtener estadísticas básicas del ranking',
                    parameters: [],
                    response: 'Objeto JSON con estadísticas como promedio de power score, distribución por servidor y por clase'
                },
                {
                    path: '/servers',
                    method: 'GET',
                    description: 'Listar todas las regiones y servidores disponibles',
                    parameters: [],
                    response: 'Objeto JSON con todas las regiones y servidores organizados jerárquicamente'
                },
                {
                    path: '/rankings/region/:region/server/:server',
                    method: 'GET',
                    description: 'Obtener el ranking de un servidor específico',
                    parameters: [
                        { name: 'region', type: 'string', description: 'Nombre de la región' },
                        { name: 'server', type: 'string', description: 'Nombre del servidor' },
                        { name: 'refresh', type: 'boolean', description: 'Opcional. Si es "true" fuerza una actualización del caché', in: 'query' }
                    ],
                    response: 'Array de objetos con jugadores del servidor específico'
                },
                {
                    path: '/rankings/search/:characterName',
                    method: 'GET',
                    description: 'Buscar un personaje en todos los servidores registrados',
                    parameters: [
                        { name: 'characterName', type: 'string', description: 'Nombre del personaje a buscar' }
                    ],
                    response: 'Array de objetos con los resultados encontrados en todos los servidores'
                },
                {
                    path: '/rankings/clan-global/:clanName',
                    method: 'GET',
                    description: 'Buscar jugadores por clan en todos los servidores',
                    parameters: [
                        { name: 'clanName', type: 'string', description: 'Nombre del clan a buscar' }
                    ],
                    response: 'Array de objetos con los resultados encontrados en todos los servidores'
                },
                {
                    path: '/cache/stats',
                    method: 'GET',
                    description: 'Ver estadísticas del caché',
                    parameters: [],
                    response: 'Objeto JSON con estadísticas del sistema de caché'
                },
                {
                    path: '/cache/clear',
                    method: 'POST',
                    description: 'Limpiar el caché del sistema',
                    parameters: [],
                    response: 'Objeto JSON con confirmación de limpieza'
                },
                {
                    path: '/prefetch/status',
                    method: 'GET',
                    description: 'Ver el estado actual del prefetch',
                    parameters: [],
                    response: 'Objeto JSON con información sobre el estado del proceso de prefetch'
                },
                {
                    path: '/prefetch/start',
                    method: 'POST',
                    description: 'Iniciar manualmente un proceso de prefetch',
                    parameters: [],
                    response: 'Objeto JSON con confirmación de inicio del proceso'
                }
            ],
            ejemplos: {
                "obtenerTodosLosRankings": `${req.protocol}://${req.get('host')}/rankings`,
                "buscarPorServidor": `${req.protocol}://${req.get('host')}/rankings/server/ASIA011`,
                "buscarPorClan": `${req.protocol}://${req.get('host')}/rankings/clan/Dragon`,
                "buscarPorClase": `${req.protocol}://${req.get('host')}/rankings/class/Warrior`,
                "buscarPersonaje": `${req.protocol}://${req.get('host')}/rankings/search/DragonSlayer`
            },
            estructuraDeDatos: {
                "jugador": {
                    "rank": "Posición en el ranking",
                    "character": "Nombre del personaje",
                    "powerScore": "Puntuación de poder",
                    "level": "Nivel del personaje",
                    "clan": "Clan al que pertenece",
                    "class": "Clase del personaje",
                    "server": "Servidor del jugador"
                }
            }
        });
        logger.success('Documentación de la API enviada', 'API');
    } catch (error) {
        logger.error(`Error al servir la documentación: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Endpoint para obtener todo el ranking
router.get('/rankings', async (req, res) => {
    try {
        logger.route('Solicitando rankings completos');
        const rankings = await fetchRankingData();
        logger.success(`Rankings enviados: ${rankings.length} registros`, 'API');
        res.json(rankings);
    } catch (error) {
        logger.error(`Error al obtener rankings: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener los rankings' });
    }
});

// Endpoint para forzar actualización del caché
router.post('/rankings/refresh', async (req, res) => {
    try {
        logger.route('Forzando actualización del caché');
        const rankings = await fetchRankingData(true); // forzar refresco
        logger.success('Caché refrescado exitosamente', 'API');
        res.json({
            success: true,
            message: 'Caché refrescado exitosamente',
            count: rankings.length
        });
    } catch (error) {
        logger.error(`Error al refrescar caché: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al refrescar los rankings' });
    }
});

// Endpoint para obtener un rango específico de rankings
router.get('/rankings/range/:start/:end', async (req, res) => {
    try {
        const start = parseInt(req.params.start);
        const end = parseInt(req.params.end);
        const cacheKey = `range_${start}_${end}`;
        
        logger.route(`Solicitando rango de rankings: ${start}-${end}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Rango enviado desde caché: ${cachedResult.length} registros`, 'API');
            return res.json(cachedResult);
        }
        
        const rankings = await fetchRankingData();
        const rangeRankings = rankings.slice(start - 1, end);
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, rangeRankings);
        
        logger.success(`Rango enviado: ${rangeRankings.length} registros`, 'API');
        res.json(rangeRankings);
    } catch (error) {
        logger.error(`Error al obtener rango: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener el rango de rankings' });
    }
});

// Endpoint para buscar por servidor
router.get('/rankings/server/:server', async (req, res) => {
    try {
        const server = req.params.server.toUpperCase();
        const cacheKey = `server_${server}`;
        
        logger.route(`Buscando por servidor: ${server}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Resultados de servidor desde caché: ${cachedResult.length} registros`, 'API');
            return res.json(cachedResult);
        }
        
        const rankings = await fetchRankingData();
        const serverRankings = rankings.filter(rank => rank.server.includes(server));
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, serverRankings);
        
        logger.success(`Resultados de servidor enviados: ${serverRankings.length} registros`, 'API');
        res.json(serverRankings);
    } catch (error) {
        logger.error(`Error al buscar por servidor: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al buscar por servidor' });
    }
});

// Endpoint para buscar por clan
router.get('/rankings/clan/:clan', async (req, res) => {
    try {
        const clan = req.params.clan;
        const cacheKey = `clan_${clan.toLowerCase()}`;
        
        logger.route(`Buscando por clan: ${clan}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Resultados de clan desde caché: ${cachedResult.length} registros`, 'API');
            return res.json(cachedResult);
        }
        
        const rankings = await fetchRankingData();
        const clanRankings = rankings.filter(rank => 
            rank.clan.toLowerCase().includes(clan.toLowerCase())
        );
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, clanRankings);
        
        logger.success(`Resultados de clan enviados: ${clanRankings.length} registros`, 'API');
        res.json(clanRankings);
    } catch (error) {
        logger.error(`Error al buscar por clan: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al buscar por clan' });
    }
});

// Endpoint para filtrar por clase
router.get('/rankings/class/:className', async (req, res) => {
    try {
        const className = req.params.className;
        const cacheKey = `class_${className.toLowerCase()}`;
        
        logger.route(`Buscando por clase: ${className}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Resultados de clase desde caché: ${cachedResult.length} registros`, 'API');
            return res.json(cachedResult);
        }
        
        const rankings = await fetchRankingData();
        const classRankings = rankings.filter(rank => 
            rank.class.toLowerCase() === className.toLowerCase()
        );
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, classRankings);
        
        logger.success(`Resultados de clase enviados: ${classRankings.length} registros`, 'API');
        res.json(classRankings);
    } catch (error) {
        logger.error(`Error al buscar por clase: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al buscar por clase' });
    }
});

// Endpoint para obtener estadísticas básicas
router.get('/rankings/stats', async (req, res) => {
    try {
        const cacheKey = 'stats';
        
        logger.route('Solicitando estadísticas');
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success('Estadísticas enviadas desde caché', 'API');
            return res.json(cachedResult);
        }
        
        const rankings = await fetchRankingData();
        const stats = {
            totalPlayers: rankings.length,
            averagePowerScore: Math.floor(
                rankings.reduce((acc, curr) => acc + curr.powerScore, 0) / rankings.length
            ),
            highestPowerScore: Math.max(...rankings.map(r => r.powerScore)),
            lowestPowerScore: Math.min(...rankings.map(r => r.powerScore)),
            serverDistribution: rankings.reduce((acc, curr) => {
                acc[curr.server] = (acc[curr.server] || 0) + 1;
                return acc;
            }, {}),
            classDistribution: rankings.reduce((acc, curr) => {
                acc[curr.class] = (acc[curr.class] || 0) + 1;
                return acc;
            }, {})
        };
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, stats);
        
        logger.success('Estadísticas enviadas', 'API');
        res.json(stats);
    } catch (error) {
        logger.error(`Error al obtener estadísticas: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener las estadísticas' });
    }
});

// NUEVOS ENDPOINTS PARA SERVIDOR ESPECÍFICO

// Endpoint para listar todas las regiones y servidores disponibles
router.get('/servers', (req, res) => {
    try {
        logger.route('Solicitando lista de servidores disponibles');
        
        const serverList = {};
        
        // Convertir el objeto de regiones a un formato más amigable para la API
        for (const [regionName, regionData] of Object.entries(SERVER_REGIONS)) {
            serverList[regionName] = {
                id: regionData.id,
                servers: Object.keys(regionData.servers).map(serverName => ({
                    id: regionData.servers[serverName].id,
                    name: serverName,
                    url: buildServerUrl(regionName, serverName)
                }))
            };
        }
        
        logger.success('Lista de servidores enviada', 'API');
        res.json(serverList);
    } catch (error) {
        logger.error(`Error al obtener lista de servidores: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener la lista de servidores' });
    }
});

// Endpoint para obtener el ranking de un servidor específico
router.get('/rankings/region/:region/server/:server', async (req, res) => {
    try {
        const regionName = req.params.region.toUpperCase();
        const serverName = req.params.server.toUpperCase();
        
        logger.route(`Solicitando ranking para servidor específico: ${regionName} > ${serverName}`);
        
        // Verificar si la región y servidor existen
        if (!SERVER_REGIONS[regionName]) {
            logger.warn(`Región solicitada no existe: ${regionName}`, 'API');
            return res.status(404).json({ error: `La región '${regionName}' no está registrada en el sistema` });
        }
        
        if (!SERVER_REGIONS[regionName].servers[serverName]) {
            logger.warn(`Servidor solicitado no existe: ${serverName} en región ${regionName}`, 'API');
            return res.status(404).json({ error: `El servidor '${serverName}' no está registrado en la región '${regionName}'` });
        }
        
        // Obtener los datos
        const forceRefresh = req.query.refresh === 'true';
        const rankings = await fetchServerRankingData(regionName, serverName, forceRefresh);
        
        logger.success(`Rankings de servidor enviados: ${rankings.length} registros de ${regionName} > ${serverName}`, 'API');
        res.json(rankings);
    } catch (error) {
        logger.error(`Error al obtener ranking de servidor: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener los rankings del servidor' });
    }
});

// Endpoint para buscar un personaje en todos los servidores registrados
router.get('/rankings/search/:characterName', async (req, res) => {
    try {
        const characterName = req.params.characterName;
        const cacheKey = `search_${characterName.toLowerCase()}`;
        
        logger.route(`Buscando personaje en todos los servidores: ${characterName}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Resultados de búsqueda desde caché para '${characterName}': ${cachedResult.length} resultados`, 'API');
            return res.json(cachedResult);
        }
        
        // Buscar en todas las regiones y servidores
        const results = [];
        const searchPromises = [];
        
        // Primera búsqueda en el ranking principal (si está disponible)
        try {
            const mainRankings = getServerCache('main');
            if (mainRankings) {
                const matches = mainRankings.filter(player => 
                    player.character.toLowerCase().includes(characterName.toLowerCase())
                );
                results.push(...matches);
            }
        } catch (e) {
            logger.debug('No hay datos en caché principal para buscar');
        }
        
        // Preparar promesas para buscar en cada servidor
        for (const [regionName, regionData] of Object.entries(SERVER_REGIONS)) {
            for (const [serverName] of Object.entries(regionData.servers)) {
                // Verificar si ya tenemos datos en caché para este servidor
                const serverKey = `${regionName}_${serverName}`;
                const cachedServerData = getServerCache(serverKey);
                
                if (cachedServerData) {
                    // Si tenemos datos en caché, filtrar directamente
                    const matches = cachedServerData.filter(player => 
                        player.character.toLowerCase().includes(characterName.toLowerCase())
                    );
                    
                    // Agregar información de región/servidor a cada resultado
                    const enhancedMatches = matches.map(player => ({
                        ...player,
                        regionName,
                        serverName
                    }));
                    
                    results.push(...enhancedMatches);
                } else {
                    // Si no hay caché, preparar una promesa para buscar en este servidor
                    const serverPromise = fetchServerRankingData(regionName, serverName)
                        .then(rankings => {
                            const matches = rankings.filter(player => 
                                player.character.toLowerCase().includes(characterName.toLowerCase())
                            );
                            
                            // Agregar información de región/servidor a cada resultado
                            const enhancedMatches = matches.map(player => ({
                                ...player,
                                regionName,
                                serverName
                            }));
                            
                            results.push(...enhancedMatches);
                            
                            logger.debug(`Encontrados ${matches.length} resultados en ${regionName} > ${serverName}`);
                            return matches;
                        })
                        .catch(err => {
                            logger.error(`Error al buscar en ${regionName} > ${serverName}: ${err.message}`, 'API');
                            return [];
                        });
                    
                    searchPromises.push(serverPromise);
                }
            }
        }
        
        // Esperar a que todas las búsquedas terminen
        if (searchPromises.length > 0) {
            await Promise.all(searchPromises);
        }
        
        // Ordenar resultados por PowerScore descendente
        results.sort((a, b) => b.powerScore - a.powerScore);
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, results);
        
        logger.success(`Búsqueda completada para '${characterName}': ${results.length} resultados encontrados`, 'API');
        res.json(results);
    } catch (error) {
        logger.error(`Error al buscar personaje: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al buscar el personaje en los servidores' });
    }
});

// Endpoint para buscar jugadores por clan en todos los servidores
router.get('/rankings/clan-global/:clanName', async (req, res) => {
    try {
        const clanName = req.params.clanName;
        const cacheKey = `clan_global_${clanName.toLowerCase()}`;
        
        logger.route(`Buscando clan en todos los servidores: ${clanName}`);
        
        // Intentar obtener del caché
        const cachedResult = getQueryCache(cacheKey);
        if (cachedResult) {
            logger.success(`Resultados de búsqueda de clan desde caché para '${clanName}': ${cachedResult.length} resultados`, 'API');
            return res.json(cachedResult);
        }
        
        // Buscar en todas las regiones y servidores
        const results = [];
        const searchPromises = [];
        
        // Preparar promesas para buscar en cada servidor
        for (const [regionName, regionData] of Object.entries(SERVER_REGIONS)) {
            for (const [serverName] of Object.entries(regionData.servers)) {
                // Verificar si ya tenemos datos en caché para este servidor
                const serverKey = `${regionName}_${serverName}`;
                const cachedServerData = getServerCache(serverKey);
                
                if (cachedServerData) {
                    // Si tenemos datos en caché, filtrar directamente
                    const matches = cachedServerData.filter(player => 
                        player.clan.toLowerCase().includes(clanName.toLowerCase())
                    );
                    
                    // Agregar información de región/servidor a cada resultado
                    const enhancedMatches = matches.map(player => ({
                        ...player,
                        regionName,
                        serverName
                    }));
                    
                    results.push(...enhancedMatches);
                } else {
                    // Si no hay caché, preparar una promesa para buscar en este servidor
                    const serverPromise = fetchServerRankingData(regionName, serverName)
                        .then(rankings => {
                            const matches = rankings.filter(player => 
                                player.clan.toLowerCase().includes(clanName.toLowerCase())
                            );
                            
                            // Agregar información de región/servidor a cada resultado
                            const enhancedMatches = matches.map(player => ({
                                ...player,
                                regionName,
                                serverName
                            }));
                            
                            results.push(...enhancedMatches);
                            
                            logger.debug(`Encontrados ${matches.length} resultados para clan '${clanName}' en ${regionName} > ${serverName}`);
                            return matches;
                        })
                        .catch(err => {
                            logger.error(`Error al buscar clan en ${regionName} > ${serverName}: ${err.message}`, 'API');
                            return [];
                        });
                    
                    searchPromises.push(serverPromise);
                }
            }
        }
        
        // Esperar a que todas las búsquedas terminen
        if (searchPromises.length > 0) {
            await Promise.all(searchPromises);
        }
        
        // Ordenar resultados por PowerScore descendente
        results.sort((a, b) => b.powerScore - a.powerScore);
        
        // Guardar en caché para futuras consultas
        setQueryCache(cacheKey, results);
        
        logger.success(`Búsqueda de clan completada para '${clanName}': ${results.length} resultados encontrados`, 'API');
        res.json(results);
    } catch (error) {
        logger.error(`Error al buscar clan: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al buscar el clan en los servidores' });
    }
});

// Endpoint para ver estadísticas del caché
router.get('/cache/stats', (req, res) => {
    try {
        logger.route('Solicitando estadísticas del caché');
        const stats = getCacheStats();
        logger.success('Estadísticas de caché enviadas', 'API');
        res.json(stats);
    } catch (error) {
        logger.error(`Error al obtener estadísticas de caché: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener estadísticas del caché' });
    }
});

// Endpoint para limpiar el caché
router.post('/cache/clear', (req, res) => {
    try {
        logger.route('Solicitando limpieza del caché');
        clearCache();
        logger.success('Caché limpiado exitosamente', 'API');
        res.json({ 
            success: true,
            message: 'Caché limpiado exitosamente' 
        });
    } catch (error) {
        logger.error(`Error al limpiar caché: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al limpiar el caché' });
    }
});

// NUEVOS ENDPOINTS PARA LA GESTIÓN DEL PREFETCH

// Importar el módulo de prefetch
const { prefetchAllServers } = require('./prefetch');
const fs = require('fs');
const path = require('path');

// Ruta del archivo de estado del prefetch
const PREFETCH_STATUS_FILE = path.join(process.cwd(), CONFIG.DATA_DIR, 'prefetch_status.json');

// Endpoint para ver el estado actual del prefetch
router.get('/prefetch/status', (req, res) => {
    try {
        logger.route('Solicitando estado del prefetch');
        
        if (fs.existsSync(PREFETCH_STATUS_FILE)) {
            const statusData = fs.readFileSync(PREFETCH_STATUS_FILE, 'utf8');
            const status = JSON.parse(statusData);
            
            // Calcular tiempo desde la última actualización
            if (status.lastCompleted) {
                const lastCompletedDate = new Date(status.lastCompleted);
                status.timeSinceLastUpdate = {
                    ms: Date.now() - lastCompletedDate.getTime(),
                    formatted: getTimeDifferenceFormatted(lastCompletedDate)
                };
                
                // Calcular próxima actualización programada
                const nextUpdateTime = new Date(lastCompletedDate.getTime() + CONFIG.SERVER_CACHE_TTL);
                status.nextScheduledUpdate = {
                    timestamp: nextUpdateTime.toISOString(),
                    in: getTimeDifferenceFormatted(new Date(), nextUpdateTime)
                };
            }
            
            logger.success('Estado del prefetch enviado', 'API');
            res.json(status);
        } else {
            logger.warn('No se encontró archivo de estado del prefetch', 'API');
            res.json({
                error: 'No hay información de estado del prefetch',
                isRunning: false
            });
        }
    } catch (error) {
        logger.error(`Error al obtener estado del prefetch: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al obtener el estado del prefetch' });
    }
});

// Endpoint para iniciar manualmente un prefetch
router.post('/prefetch/start', (req, res) => {
    try {
        logger.route('Solicitando inicio manual del prefetch');
        
        // Verificar si hay un prefetch en ejecución
        let isRunning = false;
        if (fs.existsSync(PREFETCH_STATUS_FILE)) {
            const statusData = fs.readFileSync(PREFETCH_STATUS_FILE, 'utf8');
            const status = JSON.parse(statusData);
            isRunning = status.isRunning;
        }
        
        if (isRunning) {
            logger.warn('Se solicitó prefetch pero ya hay uno en ejecución', 'API');
            return res.status(409).json({ 
                error: 'Ya hay un proceso de prefetch en ejecución',
                message: 'Espera a que termine el proceso actual antes de iniciar uno nuevo' 
            });
        }
        
        // Iniciar el prefetch en segundo plano
        logger.info('Iniciando prefetch manual', 'API');
        
        // No esperar a que termine, ejecutar en segundo plano
        prefetchAllServers().catch(err => {
            logger.error(`Error en prefetch manual: ${err.message}`, 'API');
        });
        
        res.json({ 
            success: true,
            message: 'Proceso de prefetch iniciado exitosamente',
            note: 'Este proceso se ejecuta en segundo plano y puede tardar varios minutos en completarse'
        });
    } catch (error) {
        logger.error(`Error al iniciar prefetch: ${error.message}`, 'API');
        res.status(500).json({ error: 'Error al iniciar el proceso de prefetch' });
    }
});

/**
 * Obtiene una representación legible de la diferencia de tiempo entre dos fechas
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin (opcional, por defecto es la fecha actual)
 * @returns {string} - Diferencia de tiempo en formato legible
 */
function getTimeDifferenceFormatted(startDate, endDate = new Date()) {
    const diff = Math.abs(endDate - startDate);
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} día(s) y ${hours % 24} hora(s)`;
    } else if (hours > 0) {
        return `${hours} hora(s) y ${minutes % 60} minuto(s)`;
    } else if (minutes > 0) {
        return `${minutes} minuto(s) y ${seconds % 60} segundo(s)`;
    } else {
        return `${seconds} segundo(s)`;
    }
}

module.exports = router;