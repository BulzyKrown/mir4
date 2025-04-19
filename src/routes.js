/**
 * Rutas para la API de rankings de MIR4
 */

const express = require('express');
const { fetchRankingData } = require('./scraper');
const { getQueryCache, setQueryCache, clearCache, getCacheStats } = require('./cache');
const logger = require('./logger');

const router = express.Router();

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

module.exports = router;