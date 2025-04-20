/**
 * Lógica principal para el scraping de rankings de MIR4
 */

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { CHARACTER_CLASSES, HEADERS, CONFIG, SERVER_REGIONS } = require('./config');
const { extractImageUrlFromStyle, saveScrapedHtml } = require('./utils');
const { getMainCache, setMainCache, getServerCache, setServerCache } = require('./cache');
const logger = require('./logger');

/**
 * Procesa el HTML del ranking para extraer los datos de los jugadores
 * @param {string} html - El HTML a procesar
 * @returns {Array} - Datos de rankings procesados
 */
function parseRankingHtml(html) {
    const $ = cheerio.load(html);
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
                if (parseInt(rank) <= 5 || parseInt(rank) % 50 === 0) { // Limitar el logging
                    logger.debug(`Rank ${rank}: ${character} (${characterClass})`, 'Scraper');
                }
            }
        } catch (rowError) {
            logger.error(`Error procesando fila: ${rowError}`, 'Scraper');
        }
    });

    return rankings;
}

/**
 * Construye la URL de un servidor específico
 * @param {string} regionName - Nombre de la región
 * @param {string} serverName - Nombre del servidor
 * @returns {string} - URL completa del servidor
 */
function buildServerUrl(regionName, serverName) {
    try {
        const region = SERVER_REGIONS[regionName];
        if (!region) {
            throw new Error(`Región no encontrada: ${regionName}`);
        }
        
        const server = region.servers[serverName];
        if (!server) {
            throw new Error(`Servidor no encontrado: ${serverName} en región ${regionName}`);
        }
        
        return `${CONFIG.RANKING_URL}&worldgroupid=${region.id}&worldid=${server.id}&classtype=&searchname=`;
    } catch (error) {
        logger.error(`Error construyendo URL de servidor: ${error.message}`, 'Scraper');
        throw error;
    }
}

/**
 * Obtiene y parsea los datos del ranking de MIR4 para un servidor específico
 * @param {string} regionName - Nombre de la región (ej: ASIA, IMENA)
 * @param {string} serverName - Nombre del servidor (ej: ASIA011, IMENA011)
 * @param {boolean} forceRefresh - Si es true, ignora el caché y hace un nuevo scraping
 * @returns {Promise<Array>} - Datos de rankings procesados
 */
async function fetchServerRankingData(regionName, serverName, forceRefresh = false) {
    try {
        // Clave para el caché específico de este servidor
        const cacheKey = `${regionName}_${serverName}`;
        
        // Verificar si tenemos datos en caché y no se forzó refresco
        if (!forceRefresh) {
            const cachedData = getServerCache(cacheKey);
            if (cachedData) {
                logger.scraper(`Usando datos en caché para ${regionName} > ${serverName} (${cachedData.length} jugadores)`);
                return cachedData;
            }
        }
        
        logger.scraper(`Iniciando scraping del ranking para ${regionName} > ${serverName}...`);
        
        // Construir la URL específica del servidor
        const serverUrl = buildServerUrl(regionName, serverName);
        logger.scraper(`URL del servidor: ${serverUrl}`);
        
        // Iniciar el navegador
        const browser = await puppeteer.launch({
            headless: CONFIG.BROWSER_HEADLESS,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // Establecer los headers
        await page.setExtraHTTPHeaders(HEADERS);
        
        try {
            // Navegar a la página de ranking del servidor específico
            logger.scraper(`Navegando a ${serverUrl}`);
            await page.goto(serverUrl, { 
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            
            // Aceptar cookies si aparece el diálogo
            try {
                logger.scraper('Comprobando si hay diálogo de cookies...');
                const cookieButton = await page.$('button.btn_accept_cookies');
                if (cookieButton) {
                    await cookieButton.click();
                    logger.scraper('Aceptadas las cookies');
                    await page.waitForTimeout(1000);
                }
            } catch (cookieError) {
                logger.debug('No se encontró diálogo de cookies');
            }
            
            let currentPageHtml = await page.content();
            let allRankings = parseRankingHtml(currentPageHtml);
            
            logger.scraper(`Página 1 cargada para ${regionName} > ${serverName}: ${allRankings.length} jugadores`);
            
            // Guardar el HTML inicial
            const htmlFileName = `${regionName}_${serverName}`;
            await saveScrapedHtml(currentPageHtml, htmlFileName);
            
            // Cargar más páginas haciendo clic en el botón "Ver más"
            let pagesLoaded = 1;
            
            while (pagesLoaded < CONFIG.MAX_PAGES_TO_SCRAPE) {
                try {
                    // Resto de la lógica igual que en fetchRankingData...
                    // Comprobar si existe el botón "Ver más"
                    logger.scraper(`Buscando botón "Ver más" con selector: ${CONFIG.LOAD_MORE_BUTTON_SELECTOR}`);
                    
                    // Esperar a que el botón sea visible y esté habilitado
                    await page.waitForSelector(CONFIG.LOAD_MORE_BUTTON_SELECTOR, { 
                        visible: true,
                        timeout: 5000
                    });
                    
                    const loadMoreButton = await page.$(CONFIG.LOAD_MORE_BUTTON_SELECTOR);
                    if (!loadMoreButton) {
                        logger.scraper('No hay más páginas para cargar (botón no encontrado)');
                        break;
                    }
                    
                    // Hacer clic en el botón y esperar a que se carguen los datos
                    logger.scraper(`Haciendo clic para cargar página ${pagesLoaded + 1}...`);
                    
                    // Extraer el texto del botón para debugging
                    const buttonText = await page.evaluate(button => button.textContent, loadMoreButton);
                    logger.scraper(`Texto del botón: "${buttonText}"`);
                    
                    // Contar elementos antes del clic
                    const countBefore = await page.$$eval('tr.list_article', rows => rows.length);
                    logger.scraper(`Elementos antes del clic: ${countBefore}`);
                    
                    // Hacer clic en el botón
                    await loadMoreButton.click();
                    
                    // Esperar a que se carguen los nuevos datos (esperar a que aumente el número de filas)
                    logger.scraper(`Esperando a que se carguen nuevos datos...`);
                    await page.waitForFunction(
                        (previousCount) => {
                            const currentCount = document.querySelectorAll('tr.list_article').length;
                            return currentCount > previousCount;
                        },
                        { timeout: 10000 },
                        countBefore
                    );
                    
                    // Esperar un tiempo adicional para asegurar que todo se haya cargado
                    await page.waitForTimeout(CONFIG.WAIT_BETWEEN_CLICKS_MS);
                    
                    // Contar elementos después del clic
                    const countAfter = await page.$$eval('tr.list_article', rows => rows.length);
                    logger.scraper(`Elementos después del clic: ${countAfter} (añadidos: ${countAfter - countBefore})`);
                    
                    // Obtener el nuevo contenido y parsear los datos
                    currentPageHtml = await page.content();
                    const newRankings = parseRankingHtml(currentPageHtml);
                    
                    // Verificar si se obtuvieron nuevos datos
                    if (newRankings.length <= allRankings.length) {
                        logger.scraper(`No se obtuvieron nuevos datos (actual: ${newRankings.length}, anterior: ${allRankings.length}), deteniendo el scraping`);
                        break;
                    }
                    
                    pagesLoaded++;
                    logger.scraper(`Página ${pagesLoaded} cargada para ${regionName} > ${serverName}: ${newRankings.length} jugadores en total`);
                    
                    // Actualizar la lista completa de rankings
                    allRankings = newRankings;
                    
                    // Guardar el HTML de cada página para debugging
                    await saveScrapedHtml(currentPageHtml, `${htmlFileName}_page_${pagesLoaded}`);
                } catch (btnError) {
                    logger.error(`Error al cargar más páginas: ${btnError}`, 'Scraper');
                    // Tomar una captura de pantalla para debugging
                    await page.screenshot({path: `error_${regionName}_${serverName}_page_${pagesLoaded}.png`});
                    logger.scraper(`Se guardó una captura de pantalla en error_${regionName}_${serverName}_page_${pagesLoaded}.png`);
                    break;
                }
            }
            
            // Cerrar el navegador
            await browser.close();
            
            if (allRankings.length === 0) {
                logger.error(`No se encontraron datos en la página de ${regionName} > ${serverName}`, 'Scraper');
                throw new Error(`No se encontraron datos en la página de ${regionName} > ${serverName}`);
            }

            // Mostrar resumen de clases
            const classCount = allRankings.reduce((acc, curr) => {
                acc[curr.class] = (acc[curr.class] || 0) + 1;
                return acc;
            }, {});

            logger.scraper(`Scraping completado exitosamente para ${regionName} > ${serverName}: ${allRankings.length} jugadores en total`);
            logger.table(classCount);
            
            // Guardar los datos en caché para futuras consultas
            setServerCache(cacheKey, allRankings);
            
            // Añadir información de región/servidor a cada jugador
            allRankings = allRankings.map(player => ({
                ...player,
                regionName,
                serverName
            }));
            
            return allRankings;
        } catch (pageError) {
            logger.error(`Error en la navegación para ${regionName} > ${serverName}: ${pageError}`, 'Scraper');
            await browser.close();
            throw pageError;
        }
    } catch (error) {
        logger.error(`Error fetchServerRankingData para ${regionName} > ${serverName}: ${error.message}`, 'Scraper');
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`, 'Scraper');
        }
        throw error;
    }
}

/**
 * Obtiene y parsea los datos del ranking de MIR4 usando Puppeteer para cargar todos los jugadores
 * @param {boolean} forceRefresh - Si es true, ignora el caché y hace un nuevo scraping
 * @returns {Promise<Array>} - Datos de rankings procesados
 */
async function fetchRankingData(forceRefresh = false) {
    try {
        // Verificar si tenemos datos en caché y no se forzó refresco
        if (!forceRefresh) {
            const cachedData = getMainCache();
            if (cachedData) {
                logger.scraper(`Usando datos en caché (${cachedData.length} jugadores)`);
                return cachedData;
            }
        }
        
        logger.scraper('Iniciando scraping completo del ranking desde la fuente...');
        
        // Iniciar el navegador
        const browser = await puppeteer.launch({
            headless: CONFIG.BROWSER_HEADLESS,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // Establecer los headers
        await page.setExtraHTTPHeaders(HEADERS);
        
        try {
            // Navegar a la página de ranking
            logger.scraper(`Navegando a ${CONFIG.RANKING_URL}`);
            await page.goto(CONFIG.RANKING_URL, { 
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            
            // Aceptar cookies si aparece el diálogo
            try {
                logger.scraper('Comprobando si hay diálogo de cookies...');
                const cookieButton = await page.$('button.btn_accept_cookies');
                if (cookieButton) {
                    await cookieButton.click();
                    logger.scraper('Aceptadas las cookies');
                    await page.waitForTimeout(1000);
                }
            } catch (cookieError) {
                logger.debug('No se encontró diálogo de cookies');
            }
            
            let currentPageHtml = await page.content();
            let allRankings = parseRankingHtml(currentPageHtml);
            
            logger.scraper(`Página 1 cargada: ${allRankings.length} jugadores`);
            
            // Guardar el HTML inicial
            await saveScrapedHtml(currentPageHtml);
            
            // Cargar más páginas haciendo clic en el botón "Ver más"
            let pagesLoaded = 1;
            
            while (pagesLoaded < CONFIG.MAX_PAGES_TO_SCRAPE) {
                try {
                    // Comprobar si existe el botón "Ver más"
                    logger.scraper(`Buscando botón "Ver más" con selector: ${CONFIG.LOAD_MORE_BUTTON_SELECTOR}`);
                    
                    // Esperar a que el botón sea visible y esté habilitado
                    await page.waitForSelector(CONFIG.LOAD_MORE_BUTTON_SELECTOR, { 
                        visible: true,
                        timeout: 5000
                    });
                    
                    const loadMoreButton = await page.$(CONFIG.LOAD_MORE_BUTTON_SELECTOR);
                    if (!loadMoreButton) {
                        logger.scraper('No hay más páginas para cargar (botón no encontrado)');
                        break;
                    }
                    
                    // Hacer clic en el botón y esperar a que se carguen los datos
                    logger.scraper(`Haciendo clic para cargar página ${pagesLoaded + 1}...`);
                    
                    // Extraer el texto del botón para debugging
                    const buttonText = await page.evaluate(button => button.textContent, loadMoreButton);
                    logger.scraper(`Texto del botón: "${buttonText}"`);
                    
                    // Contar elementos antes del clic
                    const countBefore = await page.$$eval('tr.list_article', rows => rows.length);
                    logger.scraper(`Elementos antes del clic: ${countBefore}`);
                    
                    // Hacer clic en el botón
                    await loadMoreButton.click();
                    
                    // Esperar a que se carguen los nuevos datos (esperar a que aumente el número de filas)
                    logger.scraper(`Esperando a que se carguen nuevos datos...`);
                    await page.waitForFunction(
                        (previousCount) => {
                            const currentCount = document.querySelectorAll('tr.list_article').length;
                            return currentCount > previousCount;
                        },
                        { timeout: 10000 },
                        countBefore
                    );
                    
                    // Esperar un tiempo adicional para asegurar que todo se haya cargado
                    await page.waitForTimeout(CONFIG.WAIT_BETWEEN_CLICKS_MS);
                    
                    // Contar elementos después del clic
                    const countAfter = await page.$$eval('tr.list_article', rows => rows.length);
                    logger.scraper(`Elementos después del clic: ${countAfter} (añadidos: ${countAfter - countBefore})`);
                    
                    // Obtener el nuevo contenido y parsear los datos
                    currentPageHtml = await page.content();
                    const newRankings = parseRankingHtml(currentPageHtml);
                    
                    // Verificar si se obtuvieron nuevos datos
                    if (newRankings.length <= allRankings.length) {
                        logger.scraper(`No se obtuvieron nuevos datos (actual: ${newRankings.length}, anterior: ${allRankings.length}), deteniendo el scraping`);
                        break;
                    }
                    
                    pagesLoaded++;
                    logger.scraper(`Página ${pagesLoaded} cargada: ${newRankings.length} jugadores en total`);
                    
                    // Actualizar la lista completa de rankings
                    allRankings = newRankings;
                    
                    // Guardar el HTML de cada página para debugging
                    await saveScrapedHtml(currentPageHtml, `ranking_page_${pagesLoaded}`);
                } catch (btnError) {
                    logger.error(`Error al cargar más páginas: ${btnError}`, 'Scraper');
                    // Tomar una captura de pantalla para debugging
                    await page.screenshot({path: `error_page_${pagesLoaded}.png`});
                    logger.scraper(`Se guardó una captura de pantalla en error_page_${pagesLoaded}.png`);
                    break;
                }
            }
            
            // Cerrar el navegador
            await browser.close();
            
            if (allRankings.length === 0) {
                logger.error('No se encontraron datos en la página', 'Scraper');
                throw new Error('No se encontraron datos en la página');
            }

            // Mostrar resumen de clases
            const classCount = allRankings.reduce((acc, curr) => {
                acc[curr.class] = (acc[curr.class] || 0) + 1;
                return acc;
            }, {});

            logger.scraper(`Scraping completado exitosamente: ${allRankings.length} jugadores en total`);
            logger.table(classCount);
            
            // Guardar los datos en caché para futuras consultas
            setMainCache(allRankings);
            
            return allRankings;
        } catch (pageError) {
            logger.error(`Error en la navegación: ${pageError}`, 'Scraper');
            await browser.close();
            throw pageError;
        }
    } catch (error) {
        logger.error(`Error fetchRankingData: ${error.message}`, 'Scraper');
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`, 'Scraper');
        }
        throw error;
    }
}

module.exports = {
    fetchRankingData,
    fetchServerRankingData,
    parseRankingHtml,
    buildServerUrl
};