/**
 * Lógica principal para el scraping de rankings de MIR4
 */

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { CHARACTER_CLASSES, HEADERS, CONFIG, SERVER_REGIONS } = require('./config');
const { extractImageUrlFromStyle, saveScrapedHtml } = require('./utils');
const { getMainCache, setMainCache, getServerCache, setServerCache } = require('./cache');
const { getServerRankings } = require('./database');
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
 * Compara los datos existentes en la base de datos con los datos recién scrapeados
 * para determinar si es necesario continuar con el scraping completo
 * 
 * @param {Array} scrapedData - Datos recién scrapeados (al menos de la primera página)
 * @param {string} regionName - Nombre de la región (opcional, para servidor específico)
 * @param {string} serverName - Nombre del servidor (opcional, para servidor específico)
 * @returns {boolean} - True si es necesario continuar con el scraping, false si los datos son similares
 */
async function shouldContinueScraping(scrapedData, regionName = null, serverName = null) {
    try {
        // Si no hay datos scrapeados, debemos continuar el scraping
        if (!scrapedData || scrapedData.length === 0) {
            logger.scraper('No hay datos scrapeados para comparar, continuando con el scraping completo');
            return true;
        }

        logger.scraper(`➡️ OPTIMIZACIÓN: Iniciando comparación de datos scrapeados (${scrapedData.length} jugadores)`);
        
        // Obtener datos existentes de la base de datos
        const existingData = regionName && serverName 
            ? getServerRankings(regionName, serverName)  // Para un servidor específico
            : getMainCache();  // Para el ranking general
        
        // Si no hay datos en la base de datos, debemos continuar el scraping
        if (!existingData || existingData.length === 0) {
            logger.scraper(`➡️ OPTIMIZACIÓN: No hay datos existentes para comparar en ${regionName || 'caché principal'} > ${serverName || ''}. Continuando con el scraping completo`);
            return true;
        }

        logger.scraper(`➡️ OPTIMIZACIÓN: Se encontraron ${existingData.length} jugadores en ${regionName ? 'la base de datos' : 'el caché principal'} para comparar`);

        // Mostrar los primeros 5 jugadores de cada conjunto para diagnóstico
        logger.scraper('➡️ MUESTRA DE DATOS SCRAPEADOS (top 5):');
        for (let i = 0; i < Math.min(5, scrapedData.length); i++) {
            logger.scraper(`   [${i+1}] Rank ${scrapedData[i].rank}: ${scrapedData[i].character} (${scrapedData[i].class}) - PS: ${scrapedData[i].powerScore}`);
        }
        
        logger.scraper('➡️ MUESTRA DE DATOS EXISTENTES (top 5):');
        for (let i = 0; i < Math.min(5, existingData.length); i++) {
            logger.scraper(`   [${i+1}] Rank ${existingData[i].rank}: ${existingData[i].character} (${existingData[i].class}) - PS: ${existingData[i].powerScore}`);
        }

        // Verificar si es hora del reset diario de rankings
        const now = new Date();
        const resetHour = 4; // Asumiendo que el reset es a las 4:00 UTC
        if (now.getUTCHours() === resetHour && now.getUTCMinutes() < 15) {
            logger.scraper('➡️ OPTIMIZACIÓN: Es hora del reset diario de rankings, forzando scraping completo');
            return true;
        }

        // Comparar jugadores en el top (limitado a la cantidad de datos scrapeados)
        const comparisonLimit = Math.min(scrapedData.length, existingData.length, 100); // Limitar a máximo 100 para la comparación
        let matchCount = 0;
        let nameMatchCount = 0; // Solo para nombres, sin considerar posición
        let detail = [];

        // Crear mapa de jugadores existentes por nombre para búsqueda rápida
        const existingPlayers = new Map();
        existingData.forEach(player => {
            existingPlayers.set(player.character, player);
        });

        // Comparar jugadores por nombre, posición de ranking y puntuación de poder
        for (let i = 0; i < comparisonLimit; i++) {
            const scrapedPlayer = scrapedData[i];
            const existingPlayer = existingPlayers.get(scrapedPlayer.character);
            
            if (existingPlayer) {
                // El nombre coincide
                nameMatchCount++;
                
                // Considerar una coincidencia si tienen el mismo nombre y posición similar (+/- 3 posiciones)
                const rankDiff = Math.abs(scrapedPlayer.rank - existingPlayer.rank);
                const powerDiff = Math.abs(scrapedPlayer.powerScore - existingPlayer.powerScore);
                
                if (rankDiff <= 3) { // Ampliamos margen a 3 posiciones
                    matchCount++;
                    if (detail.length < 5) {
                        detail.push(`✅ ${scrapedPlayer.character}: rank ${scrapedPlayer.rank}→${existingPlayer.rank} (diff: ${rankDiff}), PS: ${scrapedPlayer.powerScore}→${existingPlayer.powerScore}`);
                    }
                } else {
                    if (detail.length < 10) {
                        detail.push(`❌ ${scrapedPlayer.character}: rank ${scrapedPlayer.rank}→${existingPlayer.rank} (diff: ${rankDiff}), PS: ${scrapedPlayer.powerScore}→${existingPlayer.powerScore}`);
                    }
                }
            }
        }

        // Calcular porcentajes de similitud
        const similarityPercentage = (matchCount / comparisonLimit) * 100;
        const nameMatchPercentage = (nameMatchCount / comparisonLimit) * 100;
        
        logger.scraper(`➡️ OPTIMIZACIÓN: Similitud de nombres: ${nameMatchPercentage.toFixed(2)}% (${nameMatchCount} de ${comparisonLimit} coincidencias)`);
        logger.scraper(`➡️ OPTIMIZACIÓN: Similitud de posición: ${similarityPercentage.toFixed(2)}% (${matchCount} de ${comparisonLimit} coincidencias)`);
        
        // Mostrar detalles de algunas coincidencias/diferencias
        detail.forEach(d => logger.scraper(`   ${d}`));

        // Si la similitud de nombres es alta (>60%) pero la de posiciones es baja (<20%), 
        // puede ser que los rankings cambiaron significativamente pero son los mismos jugadores
        if (nameMatchPercentage >= 60 && similarityPercentage < 20) {
            logger.scraper(`⚠️ OPTIMIZACIÓN: Alta coincidencia de nombres pero baja coincidencia de posiciones. Posible cambio significativo en el ranking.`);
        }

        // Si la similitud es mayor o igual al 80%, no es necesario continuar con el scraping
        const SIMILARITY_THRESHOLD = 80; // Umbral de similitud aumentado a 80%
        
        if (similarityPercentage >= SIMILARITY_THRESHOLD) {
            logger.scraper(`✅ OPTIMIZACIÓN: Datos suficientemente similares (${similarityPercentage.toFixed(2)}%), omitiendo scraping completo`);
            return false;
        } else {
            logger.scraper(`⚠️ OPTIMIZACIÓN: Datos insuficientemente similares (${similarityPercentage.toFixed(2)}%), continuando con scraping completo`);
            return true;
        }
    } catch (error) {
        logger.error(`❌ OPTIMIZACIÓN: Error al comparar datos: ${error.message}`, 'Scraper');
        logger.error(error.stack);
        // En caso de error, continuamos con el scraping para asegurar datos actualizados
        return true;
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
                    // Reemplazar waitForTimeout con una espera usando setTimeout
                    await new Promise(resolve => setTimeout(resolve, 1000));
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
            
            // Verificar si es necesario continuar con el scraping
            if (!forceRefresh) {
                const shouldContinue = await shouldContinueScraping(allRankings, regionName, serverName);
                if (!shouldContinue) {
                    logger.scraper(`Usando datos existentes para ${regionName} > ${serverName}, omitiendo scraping adicional`);
                    await browser.close();
                    
                    const existingData = getServerCache(cacheKey);
                    if (existingData) {
                        // Añadir información de región/servidor a cada jugador
                        return existingData.map(player => ({
                            ...player,
                            regionName,
                            serverName
                        }));
                    }
                    
                    // Si no hay datos en caché, usar los de la base de datos
                    const dbData = getServerRankings(regionName, serverName);
                    if (dbData && dbData.length > 0) {
                        // Guardar en caché para futuras consultas
                        setServerCache(cacheKey, dbData);
                        return dbData;
                    }
                }
            }
            
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
                    // Reemplazar waitForTimeout con una espera usando setTimeout
                    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_BETWEEN_CLICKS_MS));
                    
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
                    // Reemplazar waitForTimeout con una espera usando setTimeout
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (cookieError) {
                logger.debug('No se encontró diálogo de cookies');
            }
            
            let currentPageHtml = await page.content();
            let allRankings = parseRankingHtml(currentPageHtml);
            
            logger.scraper(`Página 1 cargada: ${allRankings.length} jugadores`);
            
            // Guardar el HTML inicial
            await saveScrapedHtml(currentPageHtml);
            
            // Verificar si es necesario continuar con el scraping
            if (!forceRefresh) {
                const shouldContinue = await shouldContinueScraping(allRankings);
                if (!shouldContinue) {
                    logger.scraper('Usando datos existentes, omitiendo scraping adicional');
                    await browser.close();
                    return getMainCache();
                }
            }
            
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
                    // Reemplazar waitForTimeout con una espera usando setTimeout
                    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_BETWEEN_CLICKS_MS));
                    
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