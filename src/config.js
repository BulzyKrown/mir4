/**
 * Archivo de configuración para la API de rankings de MIR4
 */

// Mapa de URLs de imágenes a clases de personajes
const CHARACTER_CLASSES = {
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_1.png': 'Guerrero',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_2.png': 'Maga',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_3.png': 'Taotista',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_4.png': 'Ballestera',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_5.png': 'Lancero',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_6.png': 'Obscuraria'
};

// Headers para la petición
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

// Configuraciones generales
const CONFIG = {
    PORT: 3000,
    RANKING_URL: 'https://forum.mir4global.com/rank?ranktype=1',
    MAX_FILE_AGE_MS: 1 * 60 * 1000, // 1 minuto en milisegundos
    CLEANUP_CRON: '*/5 * * * *', // Cada 5 minutos
    DATA_DIR: 'data', // Directorio para archivos de datos
    SCRAPED_PAGES_DIR: 'scraped_pages', // Directorio para páginas scrapeadas
    MAX_PAGES_TO_SCRAPE: 10, // Máximo número de páginas a scrapear (10 x 100 = 1000 jugadores)
    LOAD_MORE_BUTTON_SELECTOR: '#btn_morelist', // Selector correcto del botón "+ To see more (100)"
    WAIT_BETWEEN_CLICKS_MS: 2000, // Tiempo de espera entre clics en el botón "Ver más"
    BROWSER_HEADLESS: true // Ejecutar el navegador en modo headless
};

module.exports = {
    CHARACTER_CLASSES,
    HEADERS,
    CONFIG
};