/**
 * Utilidades para el scraping de rankings MIR4
 */

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./config');
const logger = require('./logger');

/**
 * Extrae la URL de imagen del estilo CSS background-image
 * @param {string} styleAttr - Atributo de estilo que contiene la URL de imagen
 * @returns {string|null} - URL extraída o null si no se encuentra
 */
function extractImageUrlFromStyle(styleAttr) {
    if (!styleAttr) return null;
    
    const match = styleAttr.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
    return match ? match[1] : null;
}

/**
 * Guarda el HTML scrapeado en un archivo
 * @param {string} html - Contenido HTML a guardar
 * @param {string} [customPrefix] - Prefijo personalizado para el nombre del archivo
 * @returns {string} - Ruta del archivo guardado
 */
async function saveScrapedHtml(html, customPrefix = 'scraped_ranking') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${customPrefix}_${timestamp}.html`;
    const scrapedPagesDir = path.join(process.cwd(), CONFIG.SCRAPED_PAGES_DIR);
    const filePath = path.join(scrapedPagesDir, fileName);

    // Crear directorio si no existe
    if (!fs.existsSync(scrapedPagesDir)) {
        fs.mkdirSync(scrapedPagesDir, { recursive: true });
        logger.info(`Directorio creado: ${CONFIG.SCRAPED_PAGES_DIR}`, 'Sistema');
    }

    // Guardar el HTML
    fs.writeFileSync(filePath, html);
    logger.success(`HTML guardado: ${fileName}`, 'Sistema');
    return filePath;
}

/**
 * Elimina archivos HTML antiguos y archivos PNG del directorio de páginas scrapeadas
 */
function cleanupOldFiles() {
    try {
        // Limpieza de archivos HTML y PNG en el directorio de páginas scrapeadas
        const scrapedPagesDir = path.join(process.cwd(), CONFIG.SCRAPED_PAGES_DIR);
        let removedHtmlCount = 0;
        let removedPngCount = 0;
        
        // Verificar si el directorio existe
        if (fs.existsSync(scrapedPagesDir)) {
            const currentTime = new Date().getTime();
            const maxAgeMs = CONFIG.MAX_FILE_AGE_MS;
            
            // Leer todos los archivos en el directorio
            const files = fs.readdirSync(scrapedPagesDir);
            logger.info(`Revisando ${files.length} archivos para limpieza en ${CONFIG.SCRAPED_PAGES_DIR}...`, 'Sistema');
            
            files.forEach(file => {
                const filePath = path.join(scrapedPagesDir, file);
                
                // Verificar si es un archivo HTML o PNG
                if (file.endsWith('.html')) {
                    const stats = fs.statSync(filePath);
                    const fileAge = currentTime - stats.mtimeMs;
                    
                    // Si el archivo es más antiguo que el tiempo máximo permitido, eliminarlo
                    if (fileAge > maxAgeMs) {
                        fs.unlinkSync(filePath);
                        logger.warn(`Archivo HTML eliminado: ${file} (antigüedad: ${Math.round(fileAge/1000)} segundos)`, 'Sistema');
                        removedHtmlCount++;
                    }
                } else if (file.endsWith('.png')) {
                    // Eliminar archivos PNG dentro del directorio scraped_pages
                    fs.unlinkSync(filePath);
                    logger.warn(`Archivo PNG eliminado de ${CONFIG.SCRAPED_PAGES_DIR}: ${file}`, 'Sistema');
                    removedPngCount++;
                }
            });
        } else {
            logger.warn(`El directorio ${CONFIG.SCRAPED_PAGES_DIR} no existe.`, 'Sistema');
        }
        
        // Mostrar resumen de la limpieza
        if (removedHtmlCount > 0 || removedPngCount > 0) {
            logger.success(`Limpieza completada: ${removedHtmlCount} archivos HTML y ${removedPngCount} archivos PNG eliminados`, 'Sistema');
        } else {
            logger.info('Limpieza completada: No se eliminaron archivos', 'Sistema');
        }
    } catch (error) {
        logger.error(`Error al limpiar archivos: ${error.message}`, 'Sistema');
    }
}

module.exports = {
    extractImageUrlFromStyle,
    saveScrapedHtml,
    cleanupOldFiles
};