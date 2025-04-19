/**
 * Lógica principal para el scraping de rankings de MIR4
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { CHARACTER_CLASSES, HEADERS, CONFIG } = require('./config');
const { extractImageUrlFromStyle, saveScrapedHtml } = require('./utils');
const { getMainCache, setMainCache } = require('./cache');
const logger = require('./logger');

/**
 * Obtiene y parsea los datos del ranking de MIR4
 * @param {boolean} forceRefresh - Si es true, ignora el caché y hace un nuevo scraping
 * @returns {Promise<Array>} - Datos de rankings procesados
 */
async function fetchRankingData(forceRefresh = false) {
    try {
        // Verificar si tenemos datos en caché y no se forzó refresco
        if (!forceRefresh) {
            const cachedData = getMainCache();
            if (cachedData) {
                return cachedData;
            }
        }
        
        logger.scraper('Obteniendo datos del ranking desde la fuente...');
        const response = await axios.get(CONFIG.RANKING_URL, {
            headers: HEADERS
        });
        
        // Guardar el HTML scrapeado
        await saveScrapedHtml(response.data);
        
        const $ = cheerio.load(response.data);
        const rankings = [];

        // Seleccionar las filas del ranking
        $('tr.list_article').each((index, element) => {
            try {
                const $row = $(element);
                
                // Extraer rank (número de ranking)
                const rankElement = $row.find('.rank_num .num');
                const rank = rankElement.text().trim();
                
                // Extraer character y la URL de la imagen
                const characterElement = $row.find('.user_name');
                const character = characterElement.text().trim();
                
                const userIconElement = $row.find('.user_icon');
                const styleAttr = userIconElement.attr('style');
                const imgUrl = extractImageUrlFromStyle(styleAttr);
                const characterClass = imgUrl ? (CHARACTER_CLASSES[imgUrl] || 'Desconocido') : 'Desconocido';
                
                // Extraer server
                const serverElement = $row.find('td:nth-child(3) span');
                const server = serverElement.text().trim();
                
                // Extraer clan
                const clanElement = $row.find('td:nth-child(4) span');
                const clan = clanElement.text().trim();
                
                // Extraer powerScore
                const powerScoreElement = $row.find('td.text_right span');
                const powerScoreText = powerScoreElement.text().trim();
                const powerScore = powerScoreText ? parseInt(powerScoreText.replace(/,/g, '')) : 0;
                
                if (rank && character) {
                    const playerData = {
                        rank: parseInt(rank) || index + 1,
                        character,
                        class: characterClass,
                        imageUrl: imgUrl,
                        server,
                        clan,
                        powerScore
                    };
                    
                    rankings.push(playerData);
                    if (index < 5 || index % 50 === 0) { // Limitar el logging para no saturar la consola
                        logger.debug(`Rank ${rank}: ${character} (${characterClass})`, 'Scraper');
                    }
                }
            } catch (rowError) {
                logger.error(`Error procesando fila: ${rowError}`, 'Scraper');
            }
        });

        if (rankings.length === 0) {
            logger.error('No se encontraron datos en la página', 'Scraper');
            throw new Error('No se encontraron datos en la página');
        }

        // Mostrar resumen de clases
        const classCount = rankings.reduce((acc, curr) => {
            acc[curr.class] = (acc[curr.class] || 0) + 1;
            return acc;
        }, {});

        logger.scraper('Scraping completado exitosamente');
        logger.table(classCount);
        
        // Guardar los datos en caché para futuras consultas
        setMainCache(rankings);
        
        return rankings;
    } catch (error) {
        logger.error(`Error fetchRankingData: ${error.message}`, 'Scraper');
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`, 'Scraper');
        }
        throw error;
    }
}

module.exports = {
    fetchRankingData
};