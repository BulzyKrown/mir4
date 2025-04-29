/**
 * Utilidades para el scraping de rankings MIR4
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, SELECTORS } = require('./config');
const logger = require('./logger');

/**
 * Extrae la URL de imagen del estilo CSS background-image
 * @param {string} styleAttr - Atributo de estilo que contiene la URL de imagen
 * @returns {string|null} - URL extraída o null si no se encuentra
 */
function extractImageUrlFromStyle(styleAttr) {
    if (!styleAttr) return null;
    
    try {
        // Usar el regex definido en los selectores configurables
        const match = styleAttr.match(SELECTORS.STYLE_BACKGROUND_REGEX);
        return match ? match[1] : null;
    } catch (error) {
        logger.error(`Error al extraer URL de imagen: ${error.message}`, 'Utils');
        return null;
    }
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
 * Elimina archivos HTML antiguos y archivos PNG del directorio de páginas scrapeadas y del directorio raíz
 */
function cleanupOldFiles() {
    try {
        // Limpieza de archivos HTML y PNG en el directorio de páginas scrapeadas
        const scrapedPagesDir = path.join(process.cwd(), CONFIG.SCRAPED_PAGES_DIR);
        let removedHtmlCount = 0;
        let removedScrapedPngCount = 0;
        let removedRootPngCount = 0;
        
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
                    removedScrapedPngCount++;
                }
            });
        } else {
            logger.warn(`El directorio ${CONFIG.SCRAPED_PAGES_DIR} no existe.`, 'Sistema');
        }
        
        // Limpieza de archivos PNG en el directorio raíz
        const rootDir = process.cwd();
        
        // Leer todos los archivos en el directorio raíz
        const rootFiles = fs.readdirSync(rootDir);
        logger.info(`Revisando archivos PNG en el directorio raíz...`, 'Sistema');
        
        rootFiles.forEach(file => {
            // Verificar si es un archivo PNG
            if (file.endsWith('.png')) {
                const filePath = path.join(rootDir, file);
                
                // Eliminar archivo PNG del directorio raíz
                fs.unlinkSync(filePath);
                logger.warn(`Archivo PNG eliminado del directorio raíz: ${file}`, 'Sistema');
                removedRootPngCount++;
            }
        });
        
        // Mostrar resumen de la limpieza
        const totalRemoved = removedHtmlCount + removedScrapedPngCount + removedRootPngCount;
        if (totalRemoved > 0) {
            logger.success(`Limpieza completada: ${removedHtmlCount} archivos HTML, ${removedScrapedPngCount} archivos PNG de ${CONFIG.SCRAPED_PAGES_DIR} y ${removedRootPngCount} archivos PNG del directorio raíz eliminados`, 'Sistema');
        } else {
            logger.info('Limpieza completada: No se eliminaron archivos', 'Sistema');
        }
    } catch (error) {
        logger.error(`Error al limpiar archivos: ${error.message}`, 'Sistema');
    }
}

/**
 * Calcula la similitud entre dos objetos de detalles de personaje
 * @param {Object} existingDetails - Detalles existentes del personaje
 * @param {Object} newDetails - Nuevos detalles del personaje
 * @returns {number} - Porcentaje de similitud (0-100)
 */
function calculateDetailsSimilarity(existingDetails, newDetails) {
    const keyFields = [
        'level', 'prestigeLevel', 'equipmentScore', 
        'spiritScore', 'energyScore', 'magicalStoneScore',
        'codexScore', 'trophyScore', 'ethics'
    ];
    
    let totalFields = keyFields.length;
    let matchingFields = 0;
    
    // Comparar campos numéricos
    for (const field of keyFields) {
        // Si los valores son idénticos o muy cercanos (diferencia menor al 5%)
        if (existingDetails[field] === newDetails[field] || 
            (existingDetails[field] > 0 && newDetails[field] > 0 && 
             Math.abs(existingDetails[field] - newDetails[field]) / existingDetails[field] < 0.05)) {
            matchingFields++;
        }
    }
    
    // Comparar logros si existen
    if (existingDetails.achievements && newDetails.achievements) {
        totalFields++;
        
        // Si los arrays de logros tienen longitud similar y al menos 80% de logros coinciden
        const existingAchievements = Array.isArray(existingDetails.achievements) ? 
            existingDetails.achievements : JSON.parse(existingDetails.achievements || '[]');
            
        const newAchievements = Array.isArray(newDetails.achievements) ? 
            newDetails.achievements : [];
            
        if (Math.abs(existingAchievements.length - newAchievements.length) <= 2) {
            const similarAchievements = existingAchievements.filter(a => 
                newAchievements.some(na => na.id === a.id || na.name === a.name)
            ).length;
            
            if (existingAchievements.length === 0 || 
                similarAchievements / existingAchievements.length >= 0.8) {
                matchingFields++;
            }
        }
    }
    
    // Calcular porcentaje de similitud
    return (matchingFields / totalFields) * 100;
}

module.exports = {
    extractImageUrlFromStyle,
    saveScrapedHtml,
    cleanupOldFiles,
    calculateDetailsSimilarity
};