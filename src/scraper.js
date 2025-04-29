/**
 * Lógica principal para el scraping de rankings de MIR4
 */

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { CHARACTER_CLASSES, HEADERS, CONFIG, SERVER_REGIONS, SELECTORS, SCRAPER_BEHAVIOR, URLS } = require('./config');
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

    // Seleccionar las filas del ranking usando los selectores configurables
    $(SELECTORS.RANKING_ROW).each((index, element) => {
        try {
            const $row = $(element);
            
            // Extraer rank (número de ranking)
            const rankElement = $row.find(SELECTORS.RANK_NUMBER);
            const rank = rankElement.text().trim();
            
            // Extraer character y la URL de la imagen
            const characterElement = $row.find(SELECTORS.CHARACTER_NAME);
            const character = characterElement.text().trim();
            
            const userIconElement = $row.find(SELECTORS.CHARACTER_ICON);
            const styleAttr = userIconElement.attr('style');
            const imgUrl = extractImageUrlFromStyle(styleAttr);
            
            const characterClass = imgUrl ? (CHARACTER_CLASSES[imgUrl] || 'Desconocido') : 'Desconocido';
            
            // Extraer server
            const serverElement = $row.find(SELECTORS.SERVER_NAME);
            const server = serverElement.text().trim();
            
            // Extraer clan
            const clanElement = $row.find(SELECTORS.CLAN_NAME);
            const clan = clanElement.text().trim();
            
            // Extraer powerScore
            const powerScoreElement = $row.find(SELECTORS.POWER_SCORE);
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
 * Versión optimizada que usa digests para comparación más eficiente
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

        logger.scraper(`➡️ OPTIMIZACIÓN: Iniciando comparación eficiente de datos scrapeados (${scrapedData.length} jugadores)`);
        
        const { getServerDigest, getServerRankings } = require('./database');
        const { compareDataSets } = require('./utils');
        
        // Si estamos scrapeando un servidor específico, usar su digest para comparar
        if (regionName && serverName) {
            // Obtener digest del servidor (datos resumidos con hash)
            const serverDigest = await getServerDigest(regionName, serverName);
            
            if (!serverDigest) {
                logger.scraper(`➡️ OPTIMIZACIÓN: No hay datos existentes para ${regionName} > ${serverName}. Continuando con el scraping completo.`);
                return true;
            }
            
            logger.scraper(`➡️ OPTIMIZACIÓN: Digest obtenido para ${regionName} > ${serverName} (${serverDigest.stats.total_players} jugadores, hash: ${serverDigest.hash})`);
            
            // Verificar si es hora del reset diario de rankings
            const now = new Date();
            const resetHour = 4; // Asumiendo que el reset es a las 4:00 UTC
            if (now.getUTCHours() === resetHour && now.getUTCMinutes() < 15) {
                logger.scraper('➡️ OPTIMIZACIÓN: Es hora del reset diario de rankings, forzando scraping completo');
                return true;
            }
            
            // Primera comparación rápida: número de jugadores
            if (Math.abs(scrapedData.length - serverDigest.stats.total_players) > serverDigest.stats.total_players * 0.1) {
                logger.scraper(`➡️ OPTIMIZACIÓN: Diferencia significativa en el número de jugadores (${scrapedData.length} vs ${serverDigest.stats.total_players}). Continuando con scraping completo.`);
                return true;
            }
            
            // Segunda comparación: top 10 jugadores
            // Extraer top 10 de scrapedData
            const scrapedTop10 = scrapedData.filter(p => p.rank <= 10);
            
            // Crear un objeto para comparar más fácilmente
            const digestTop10Names = new Set(serverDigest.topPlayers.map(p => p.character_name));
            const scrapedTop10Names = new Set(scrapedTop10.map(p => p.character));
            
            // Contar cuántos nombres coinciden
            let matches = 0;
            scrapedTop10Names.forEach(name => {
                if (digestTop10Names.has(name)) matches++;
            });
            
            const matchPercentage = (matches / Math.max(digestTop10Names.size, 1)) * 100;
            logger.scraper(`➡️ OPTIMIZACIÓN: Top 10 coincidencia: ${matchPercentage.toFixed(2)}% (${matches} de ${digestTop10Names.size})`);
            
            // Si más del 70% del top 10 coincide, considerar los datos similares
            if (matchPercentage >= 70) {
                logger.scraper(`✅ OPTIMIZACIÓN: Datos suficientemente similares (${matchPercentage.toFixed(2)}%), omitiendo scraping completo`);
                return false;
            } else {
                logger.scraper(`⚠️ OPTIMIZACIÓN: Cambios significativos en top 10 (${matchPercentage.toFixed(2)}%), continuando con scraping completo`);
                return true;
            }
        }
        
        // Para el ranking general, usar una comparación más simple con los datos existentes
        const existingData = getServerRankings(regionName, serverName);  

        // Si no hay datos en la base de datos, debemos continuar el scraping
        if (!existingData || existingData.length === 0) {
            logger.scraper(`➡️ OPTIMIZACIÓN: No hay datos existentes para comparar. Continuando con el scraping completo`);
            return true;
        }

        // Usar compareDataSets para determinar similitud
        const comparison = compareDataSets(existingData, scrapedData, {
            keyFields: ['character', 'rank', 'class'],
            threshold: 80 // 80% de similitud es suficiente para considerar los datos similares
        });
        
        logger.scraper(`➡️ OPTIMIZACIÓN: Similitud: ${comparison.similarityPercentage.toFixed(2)}% - ${comparison.reason}`);
        
        if (comparison.similar) {
            logger.scraper(`✅ OPTIMIZACIÓN: Datos suficientemente similares, omitiendo scraping completo`);
            return false;
        } else {
            logger.scraper(`⚠️ OPTIMIZACIÓN: Datos insuficientemente similares, continuando con scraping completo`);
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
 * Verifica si el sitio permite el scraping según robots.txt
 * @returns {Promise<boolean>} - True si está permitido, false si no
 */
async function checkRobotsTxt() {
    try {
        // Si no se debe respetar robots.txt, siempre retornar true
        if (!SCRAPER_BEHAVIOR.RESPECT_ROBOTS_TXT) {
            logger.warn('No se está respetando robots.txt según configuración', 'Scraper');
            return true;
        }
        
        const response = await axios.get(URLS.ROBOTS_TXT, { timeout: 5000 });
        const robotsTxt = response.data;
        
        // Verificar si hay reglas para User-agent: * o para nuestro User-Agent específico
        const userAgentPattern = HEADERS['User-Agent'].includes('Mozilla') ? 'Mozilla' : '*';
        const lines = robotsTxt.split('\n');
        
        let applyingRules = false;
        let allowedToScrape = true;
        
        for (const line of lines) {
            const trimmedLine = line.trim().toLowerCase();
            
            // Identificar bloques de reglas para nuestro User-Agent
            if (trimmedLine.startsWith('user-agent:')) {
                const agent = trimmedLine.split(':')[1].trim();
                applyingRules = (agent === '*' || agent.includes(userAgentPattern.toLowerCase()));
            } 
            // Aplicar reglas de Disallow solo si estamos en un bloque relevante
            else if (applyingRules && trimmedLine.startsWith('disallow:')) {
                const path = trimmedLine.split(':')[1].trim();
                // Verificar si la ruta de ranking está prohibida
                if (path === '/' || URLS.RANKING_BASE.includes(path)) {
                    allowedToScrape = false;
                    break;
                }
            }
        }
        
        if (allowedToScrape) {
            logger.info('El scraping está permitido según robots.txt', 'Scraper');
        } else {
            logger.warn('El scraping NO está permitido según robots.txt', 'Scraper');
        }
        
        return allowedToScrape;
    } catch (error) {
        logger.warn(`No se pudo verificar robots.txt: ${error.message}. Asumiendo que está permitido.`, 'Scraper');
        return true;
    }
}

/**
 * Obtiene y parsea los datos del ranking de MIR4 para un servidor específico
 * @param {string} regionName - Nombre de la región (ej: ASIA, IMENA)
 * @param {string} serverName - Nombre del servidor (ej: ASIA011, IMENA011)
 * @param {boolean} forceRefresh - Si es true, ignora el caché y hace un nuevo scraping
 * @param {number} retryCount - Número de intentos realizados (para manejo de reintentos)
 * @returns {Promise<Array>} - Datos de rankings procesados
 */
async function fetchServerRankingData(regionName, serverName, forceRefresh = false, retryCount = 0) {
    let browser = null;
    
    try {
        // Registrar inicio del scraping para este servidor
        logger.startScraperRun(`${regionName}>${serverName}`);
        logger.metric(`scraper_start_${regionName}_${serverName}`, 1);
        
        // Clave para el caché específico de este servidor
        const cacheKey = `${regionName}_${serverName}`;
        
        // Verificar si tenemos datos en caché y no se forzó refresco
        if (!forceRefresh) {
            const cachedData = getServerCache(cacheKey);
            if (cachedData) {
                logger.scraper(`Usando datos en caché para ${regionName} > ${serverName} (${cachedData.length} jugadores)`);
                logger.endScraperRun(true, `Usado caché para ${regionName}>${serverName} (${cachedData.length} jugadores)`);
                logger.metric(`scraper_cache_hit_${regionName}_${serverName}`, 1);
                return cachedData;
            }
        }
        
        // Verificar robots.txt si está configurado para respetarlo
        if (SCRAPER_BEHAVIOR.RESPECT_ROBOTS_TXT) {
            const allowedToScrape = await checkRobotsTxt();
            if (!allowedToScrape) {
                logger.alert(`El scraping no está permitido según robots.txt para ${regionName} > ${serverName}`, 'Scraper');
                throw new Error(`El scraping no está permitido según robots.txt`);
            }
        }
        
        logger.scraper(`Iniciando scraping del ranking para ${regionName} > ${serverName}...`);
        
        // Construir la URL específica del servidor
        const serverUrl = buildServerUrl(regionName, serverName);
        logger.scraper(`URL del servidor: ${serverUrl}`);
        
        // Iniciar el navegador
        const browser = await puppeteer.launch({
            headless: SCRAPER_BEHAVIOR.BROWSER_HEADLESS,
            args: SCRAPER_BEHAVIOR.BROWSER_ARGS,
            timeout: 60000 // 60 segundos para iniciar el navegador
        });
        
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(60000); // 60 segundos para la navegación
        await page.setDefaultTimeout(30000); // 30 segundos para otras operaciones
        await page.setViewport({ width: 1280, height: 800 });
        
        // Establecer los headers
        await page.setExtraHTTPHeaders(HEADERS);
        
        // Manejar errores de página
        page.on('error', error => {
            logger.error(`Error de página para ${regionName} > ${serverName}: ${error}`, 'Scraper');
        });
        
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
                const cookieButton = await page.$(SELECTORS.COOKIE_ACCEPT_BUTTON);
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
                    browser = null;
                    
                    // Si no hay datos en caché, usar los de la base de datos
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
                        timeout: SCRAPER_BEHAVIOR.WAIT_FOR_SELECTOR_MS
                    }).catch(err => {
                        logger.debug(`Botón no encontrado: ${err.message}`, 'Scraper');
                        return null;
                    });
                    
                    const loadMoreButton = await page.$(CONFIG.LOAD_MORE_BUTTON_SELECTOR);
                    if (!loadMoreButton) {
                        logger.scraper('No hay más páginas para cargar (botón no encontrado)');
                        break;
                    }
                    
                    // Hacer clic en el botón y esperar a que se carguen los datos
                    logger.scraper(`Haciendo clic para cargar página ${pagesLoaded + 1}...`);
                    
                    // Extraer el texto del botón para debugging
                    const buttonText = await page.evaluate(button => button.textContent, loadMoreButton)
                        .catch(err => {
                            logger.debug(`No se pudo obtener texto del botón: ${err.message}`, 'Scraper');
                            return "Desconocido";
                        });
                    logger.scraper(`Texto del botón: "${buttonText}"`);
                    
                    // Contar elementos antes del clic
                    const countBefore = await page.$$eval(SELECTORS.RANKING_ROW, rows => rows.length)
                        .catch(err => {
                            logger.debug(`Error al contar elementos: ${err.message}`, 'Scraper');
                            return 0;
                        });
                    logger.scraper(`Elementos antes del clic: ${countBefore}`);
                    
                    // Hacer clic en el botón
                    await loadMoreButton.click().catch(err => {
                        logger.error(`Error al hacer clic en el botón: ${err.message}`, 'Scraper');
                        throw err; // Propagar el error
                    });
                    
                    // Esperar a que se carguen los nuevos datos con manejo de errores
                    logger.scraper(`Esperando a que se carguen nuevos datos...`);
                    try {
                        await page.waitForFunction(
                            (previousCount, selector) => {
                                const currentCount = document.querySelectorAll(selector).length;
                                return currentCount > previousCount;
                            },
                            { timeout: SCRAPER_BEHAVIOR.WAIT_FOR_NAVIGATION_MS },
                            countBefore,
                            SELECTORS.RANKING_ROW
                        );
                    } catch (waitError) {
                        logger.error(`Error al esperar nuevos datos: ${waitError.message}`, 'Scraper');
                        // Verificar si la página todavía está disponible
                        if (waitError.message.includes('Target closed') || 
                            waitError.message.includes('Session closed') || 
                            waitError.message.includes('frame got detached')) {
                            throw waitError; // Propagar errores críticos
                        }
                        // Para otros errores, intentamos continuar
                        break;
                    }
                    
                    // Esperar un tiempo adicional para asegurar que todo se haya cargado
                    await new Promise(resolve => setTimeout(resolve, SCRAPER_BEHAVIOR.WAIT_BETWEEN_CLICKS_MS));
                    
                    // Contar elementos después del clic
                    const countAfter = await page.$$eval(SELECTORS.RANKING_ROW, rows => rows.length)
                        .catch(err => {
                            logger.debug(`Error al contar elementos después: ${err.message}`, 'Scraper');
                            return 0;
                        });
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
                    
                    // Registrar métrica de progreso
                    logger.metric(`scraper_page_loaded_${regionName}_${serverName}`, pagesLoaded);

                } catch (btnError) {
                    logger.error(`Error al cargar más páginas: ${btnError}`, 'Scraper');
                    
                    // Verificar si es un error crítico relacionado con el cierre de sesión
                    if (btnError.message.includes('Target closed') || 
                        btnError.message.includes('Session closed') || 
                        btnError.message.includes('frame got detached')) {
                        throw btnError; // Propagar el error para reintentar
                    }
                    
                    // Para otros errores, intentamos tomar una captura y continuamos
                    try {
                        await page.screenshot({path: `error_${regionName}_${serverName}_page_${pagesLoaded}.png`}).catch(() => {});
                        logger.scraper(`Se guardó una captura de pantalla en error_${regionName}_${serverName}_page_${pagesLoaded}.png`);
                    } catch (screenshotError) {
                        logger.error(`No se pudo tomar captura de pantalla: ${screenshotError.message}`, 'Scraper');
                    }
                    break;
                }
            }
            
            // Cerrar el navegador correctamente
            await browser.close();
            browser = null;
            
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
            
            // Registrar éxito
            logger.endScraperRun(true, `${regionName}>${serverName}: ${allRankings.length} jugadores en ${pagesLoaded} páginas`);
            logger.metric(`scraper_success_${regionName}_${serverName}`, allRankings.length);
            
            return allRankings;
        } catch (pageError) {
            logger.error(`Error en la navegación para ${regionName} > ${serverName}: ${pageError}`, 'Scraper');
            
            // Cerrar el navegador si aún está abierto
            if (browser) {
                await browser.close().catch(() => {});
                browser = null;
            }
            
            throw pageError;
        }
    } catch (error) {
        // Cerrar el navegador si aún está abierto
        if (browser) {
            await browser.close().catch(() => {});
        }
        
        logger.error(`Error fetchServerRankingData para ${regionName} > ${serverName}: ${error.message}`, 'Scraper');
        
        // Registrar fallo
        logger.endScraperRun(false, `${regionName}>${serverName}: ${error.message}`);
        logger.metric(`scraper_error_${regionName}_${serverName}`, 1);
        
        // Implementar reintentos para errores relacionados con el cierre de la sesión
        const MAX_RETRIES = SCRAPER_BEHAVIOR.MAX_RETRIES;
        if (retryCount < MAX_RETRIES && (
            error.message.includes('Target closed') || 
            error.message.includes('Session closed') || 
            error.message.includes('frame got detached')
        )) {
            // Esperar un poco antes de reintentar
            const waitTime = (retryCount + 1) * SCRAPER_BEHAVIOR.RETRY_DELAY_MS; // Espera incremental
            logger.warn(`Reintentando en ${waitTime/1000}s (intento ${retryCount + 1} de ${MAX_RETRIES})...`, 'Scraper');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            return fetchServerRankingData(regionName, serverName, forceRefresh, retryCount + 1);
        }
        
        throw error;
    }
}

/**
 * Obtiene y parsea los datos del ranking de MIR4 usando Puppeteer para cargar todos los jugadores
 * @param {boolean} forceRefresh - Si es true, ignora el caché y hace un nuevo scraping
 * @param {number} retryCount - Número de intentos realizados (para manejo de reintentos)
 * @returns {Promise<Array>} - Datos de rankings procesados
 */
async function fetchRankingData(forceRefresh = false, retryCount = 0) {
    let browser = null;
    
    try {
        // Registrar inicio del scraping
        logger.startScraperRun();
        logger.metric('scraper_start_global', 1);
        
        // Verificar si tenemos datos en caché y no se forzó refresco
        if (!forceRefresh) {
            const cachedData = getMainCache();
            if (cachedData) {
                logger.scraper(`Usando datos en caché (${cachedData.length} jugadores)`);
                logger.endScraperRun(true, `Usado caché global (${cachedData.length} jugadores)`);
                logger.metric('scraper_cache_hit', cachedData.length);
                return cachedData;
            }
        }
        
        // Verificar robots.txt si está configurado para respetarlo
        if (SCRAPER_BEHAVIOR.RESPECT_ROBOTS_TXT) {
            const allowedToScrape = await checkRobotsTxt();
            if (!allowedToScrape) {
                logger.alert('El scraping no está permitido según robots.txt', 'Scraper');
                throw new Error('El scraping no está permitido según robots.txt');
            }
        }
        
        logger.scraper('Iniciando scraping completo del ranking desde la fuente...');
        
        // Iniciar el navegador
        const browser = await puppeteer.launch({
            headless: SCRAPER_BEHAVIOR.BROWSER_HEADLESS,
            args: SCRAPER_BEHAVIOR.BROWSER_ARGS,
            timeout: 60000 // 60 segundos para iniciar el navegador
        });
        
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(60000); // 60 segundos para la navegación
        await page.setDefaultTimeout(30000); // 30 segundos para otras operaciones
        await page.setViewport({ width: 1280, height: 800 });
        
        // Establecer los headers
        await page.setExtraHTTPHeaders(HEADERS);
        
        // Manejar errores de página
        page.on('error', error => {
            logger.error(`Error de página: ${error}`, 'Scraper');
        });
        
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
                const cookieButton = await page.$(SELECTORS.COOKIE_ACCEPT_BUTTON);
                if (cookieButton) {
                    await cookieButton.click();
                    logger.scraper('Aceptadas las cookies');
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
                    browser = null;
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
                        timeout: SCRAPER_BEHAVIOR.WAIT_FOR_SELECTOR_MS
                    }).catch(err => {
                        logger.debug(`Botón no encontrado: ${err.message}`, 'Scraper');
                        return null;
                    });
                    
                    const loadMoreButton = await page.$(CONFIG.LOAD_MORE_BUTTON_SELECTOR);
                    if (!loadMoreButton) {
                        logger.scraper('No hay más páginas para cargar (botón no encontrado)');
                        break;
                    }
                    
                    // Hacer clic en el botón y esperar a que se carguen los datos
                    logger.scraper(`Haciendo clic para cargar página ${pagesLoaded + 1}...`);
                    
                    // Extraer el texto del botón para debugging
                    const buttonText = await page.evaluate(button => button.textContent, loadMoreButton)
                        .catch(err => {
                            logger.debug(`No se pudo obtener texto del botón: ${err.message}`, 'Scraper');
                            return "Desconocido";
                        });
                    logger.scraper(`Texto del botón: "${buttonText}"`);
                    
                    // Contar elementos antes del clic
                    const countBefore = await page.$$eval(SELECTORS.RANKING_ROW, rows => rows.length)
                        .catch(err => {
                            logger.debug(`Error al contar elementos: ${err.message}`, 'Scraper');
                            return 0;
                        });
                    logger.scraper(`Elementos antes del clic: ${countBefore}`);
                    
                    // Hacer clic en el botón
                    await loadMoreButton.click().catch(err => {
                        logger.error(`Error al hacer clic en el botón: ${err.message}`, 'Scraper');
                        throw err; // Propagar el error
                    });
                    
                    // Esperar a que se carguen los nuevos datos con manejo de errores
                    logger.scraper(`Esperando a que se carguen nuevos datos...`);
                    try {
                        await page.waitForFunction(
                            (previousCount, selector) => {
                                const currentCount = document.querySelectorAll(selector).length;
                                return currentCount > previousCount;
                            },
                            { timeout: SCRAPER_BEHAVIOR.WAIT_FOR_NAVIGATION_MS },
                            countBefore,
                            SELECTORS.RANKING_ROW
                        );
                    } catch (waitError) {
                        logger.error(`Error al esperar nuevos datos: ${waitError.message}`, 'Scraper');
                        // Verificar si la página todavía está disponible
                        if (waitError.message.includes('Target closed') || 
                            waitError.message.includes('Session closed') || 
                            waitError.message.includes('frame got detached')) {
                            throw waitError; // Propagar errores críticos
                        }
                        // Para otros errores, intentamos continuar
                        break;
                    }
                    
                    // Esperar un tiempo adicional para asegurar que todo se haya cargado
                    await new Promise(resolve => setTimeout(resolve, CONFIG.WAIT_BETWEEN_CLICKS_MS));
                    
                    // Contar elementos después del clic
                    const countAfter = await page.$$eval(SELECTORS.RANKING_ROW, rows => rows.length)
                        .catch(err => {
                            logger.debug(`Error al contar elementos después: ${err.message}`, 'Scraper');
                            return 0;
                        });
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
                    
                    // Registrar métrica de progreso
                    logger.metric('scraper_page_loaded', pagesLoaded);
                    
                } catch (btnError) {
                    logger.error(`Error al cargar más páginas: ${btnError}`, 'Scraper');
                    
                    // Verificar si es un error crítico relacionado con el cierre de sesión
                    if (btnError.message.includes('Target closed') || 
                        btnError.message.includes('Session closed') || 
                        btnError.message.includes('frame got detached')) {
                        throw btnError; // Propagar el error para reintentar
                    }
                    
                    // Para otros errores, intentamos tomar una captura y continuamos
                    try {
                        await page.screenshot({path: `error_page_${pagesLoaded}.png`}).catch(() => {});
                        logger.scraper(`Se guardó una captura de pantalla en error_page_${pagesLoaded}.png`);
                    } catch (screenshotError) {
                        logger.error(`No se pudo tomar captura de pantalla: ${screenshotError.message}`, 'Scraper');
                    }
                    break;
                }
            }
            
            // Cerrar el navegador correctamente
            await browser.close();
            browser = null;
            
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
            
            // Registrar éxito
            logger.endScraperRun(true, `Global: ${allRankings.length} jugadores en ${pagesLoaded} páginas`);
            logger.metric('scraper_success', allRankings.length);
            
            return allRankings;
        } catch (pageError) {
            logger.error(`Error en la navegación: ${pageError}`, 'Scraper');
            
            // Cerrar el navegador si aún está abierto
            if (browser) {
                await browser.close().catch(() => {});
                browser = null;
            }
            
            throw pageError;
        }
    } catch (error) {
        // Cerrar el navegador si aún está abierto
        if (browser) {
            await browser.close().catch(() => {});
        }
        
        logger.error(`Error fetchRankingData: ${error.message}`, 'Scraper');
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`, 'Scraper');
        }
        
        // Registrar fallo
        logger.endScraperRun(false, `Global: ${error.message}`);
        logger.metric('scraper_error', 1);
        
        // Implementar reintentos para errores relacionados con el cierre de la sesión
        const MAX_RETRIES = SCRAPER_BEHAVIOR.MAX_RETRIES;
        if (retryCount < MAX_RETRIES && (
            error.message.includes('Target closed') || 
            error.message.includes('Session closed') || 
            error.message.includes('frame got detached')
        )) {
            // Esperar un poco antes de reintentar
            const waitTime = (retryCount + 1) * SCRAPER_BEHAVIOR.RETRY_DELAY_MS;
            logger.warn(`Reintentando en ${waitTime/1000}s (intento ${retryCount + 1} de ${MAX_RETRIES})...`, 'Scraper');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            return fetchRankingData(forceRefresh, retryCount + 1);
        }
        
        throw error;
    }
}

module.exports = {
    fetchRankingData,
    fetchServerRankingData,
    parseRankingHtml,
    buildServerUrl,
    checkRobotsTxt
};