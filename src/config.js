/**
 * Archivo de configuración para la API de rankings de MIR4
 */

// Cargar variables de entorno
require('dotenv').config();

// Mapa de URLs de imágenes a clases de personajes
const CHARACTER_CLASSES = {
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_1.png': 'Guerrero',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_2.png': 'Maga',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_3.png': 'Taotista',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_4.png': 'Ballestera',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_5.png': 'Lancero',
    'https://mir4-live-hp.wemade.com/mir4-forum/img/desktop/temp/char_6.png': 'Obscuraria'
};

// Función para generar el ID de un servidor basado en el patrón observado
function generateServerId(regionCode, serverGroup, serverNum) {
    // Los IDs parecen seguir un patrón específico por región
    const regionBaseMap = {
        'ASIA1': 800,
        'ASIA2': 100,
        'ASIA3': 200,
        'ASIA4': 300,
        'EU1': 700,
        'INMENA1': 200,
        'SA1': 800,
        'SA2': 100,
        'NA1': 1000,
        'NA2': 1100
    };
    
    // Calculamos el ID basado en el grupo y número de servidor
    const base = regionBaseMap[regionCode] || 0;
    const groupOffset = parseInt(serverGroup) * 10;
    return base + groupOffset + parseInt(serverNum);
}

// Mapa completo de regiones y servidores de MIR4 (actualizado según la estructura observada)
const SERVER_REGIONS = {
    // Región ASIA1
    'ASIA1': {
        id: 1,
        servers: {
            // Grupo 01
            'ASIA011': { id: generateServerId('ASIA1', '01', 1), name: 'ASIA011' },
            'ASIA012': { id: generateServerId('ASIA1', '01', 2), name: 'ASIA012' },
            'ASIA013': { id: generateServerId('ASIA1', '01', 3), name: 'ASIA013' },
            'ASIA014': { id: generateServerId('ASIA1', '01', 4), name: 'ASIA014' },
            
            // Grupo 02
            'ASIA021': { id: generateServerId('ASIA1', '02', 1), name: 'ASIA021' },
            'ASIA022': { id: generateServerId('ASIA1', '02', 2), name: 'ASIA022' },
            'ASIA023': { id: generateServerId('ASIA1', '02', 3), name: 'ASIA023' },
            'ASIA024': { id: generateServerId('ASIA1', '02', 4), name: 'ASIA024' },
            
            // Grupo 03
            'ASIA031': { id: generateServerId('ASIA1', '03', 1), name: 'ASIA031' },
            'ASIA032': { id: generateServerId('ASIA1', '03', 2), name: 'ASIA032' },
            'ASIA033': { id: generateServerId('ASIA1', '03', 3), name: 'ASIA033' },
            'ASIA034': { id: generateServerId('ASIA1', '03', 4), name: 'ASIA034' },
            
            // Grupo 04
            'ASIA041': { id: generateServerId('ASIA1', '04', 1), name: 'ASIA041' },
            'ASIA042': { id: generateServerId('ASIA1', '04', 2), name: 'ASIA042' },
            'ASIA043': { id: generateServerId('ASIA1', '04', 3), name: 'ASIA043' },
            'ASIA044': { id: generateServerId('ASIA1', '04', 4), name: 'ASIA044' },
        }
    },
    
    // Región ASIA2
    'ASIA2': {
        id: 2,
        servers: {
            // Grupo 01
            'ASIA101': { id: generateServerId('ASIA2', '01', 1), name: 'ASIA101' },
            'ASIA102': { id: generateServerId('ASIA2', '01', 2), name: 'ASIA102' },
            'ASIA103': { id: generateServerId('ASIA2', '01', 3), name: 'ASIA103' },
            'ASIA104': { id: generateServerId('ASIA2', '01', 4), name: 'ASIA104' },
            
            // Grupo 02
            'ASIA111': { id: generateServerId('ASIA2', '11', 1), name: 'ASIA111' },
            'ASIA112': { id: generateServerId('ASIA2', '11', 2), name: 'ASIA112' },
            'ASIA113': { id: generateServerId('ASIA2', '11', 3), name: 'ASIA113' },
            'ASIA114': { id: generateServerId('ASIA2', '11', 4), name: 'ASIA114' },
            
            // Grupo 03
            'ASIA121': { id: generateServerId('ASIA2', '12', 1), name: 'ASIA121' },
            'ASIA122': { id: generateServerId('ASIA2', '12', 2), name: 'ASIA122' },
            'ASIA123': { id: generateServerId('ASIA2', '12', 3), name: 'ASIA123' },
            'ASIA124': { id: generateServerId('ASIA2', '12', 4), name: 'ASIA124' },
        }
    },
    
    // Región ASIA3
    'ASIA3': {
        id: 3,
        servers: {
            // Grupo 01
            'ASIA201': { id: generateServerId('ASIA3', '20', 1), name: 'ASIA201' },
            'ASIA202': { id: generateServerId('ASIA3', '20', 2), name: 'ASIA202' },
            'ASIA203': { id: generateServerId('ASIA3', '20', 3), name: 'ASIA203' },
            'ASIA204': { id: generateServerId('ASIA3', '20', 4), name: 'ASIA204' },
            
            // Grupo 02
            'ASIA211': { id: generateServerId('ASIA3', '21', 1), name: 'ASIA211' },
            'ASIA212': { id: generateServerId('ASIA3', '21', 2), name: 'ASIA212' },
            'ASIA213': { id: generateServerId('ASIA3', '21', 3), name: 'ASIA213' },
            'ASIA214': { id: generateServerId('ASIA3', '21', 4), name: 'ASIA214' },
            
            // Grupo 03
            'ASIA221': { id: generateServerId('ASIA3', '22', 1), name: 'ASIA221' },
            'ASIA222': { id: generateServerId('ASIA3', '22', 2), name: 'ASIA222' },
            'ASIA223': { id: generateServerId('ASIA3', '22', 3), name: 'ASIA223' },
            'ASIA224': { id: generateServerId('ASIA3', '22', 4), name: 'ASIA224' },
        }
    },
    
    // Región ASIA4
    'ASIA4': {
        id: 4,
        servers: {
            // Grupo 01
            'ASIA301': { id: generateServerId('ASIA4', '30', 1), name: 'ASIA301' },
            'ASIA302': { id: generateServerId('ASIA4', '30', 2), name: 'ASIA302' },
            'ASIA303': { id: generateServerId('ASIA4', '30', 3), name: 'ASIA303' },
            'ASIA304': { id: generateServerId('ASIA4', '30', 4), name: 'ASIA304' },
            
            // Grupo 02
            'ASIA311': { id: generateServerId('ASIA4', '31', 1), name: 'ASIA311' },
            'ASIA312': { id: generateServerId('ASIA4', '31', 2), name: 'ASIA312' },
            'ASIA313': { id: generateServerId('ASIA4', '31', 3), name: 'ASIA313' },
            'ASIA314': { id: generateServerId('ASIA4', '31', 4), name: 'ASIA314' },
            
            // Grupo 03
            'ASIA321': { id: generateServerId('ASIA4', '32', 1), name: 'ASIA321' },
            'ASIA322': { id: generateServerId('ASIA4', '32', 2), name: 'ASIA322' },
            'ASIA323': { id: generateServerId('ASIA4', '32', 3), name: 'ASIA323' },
            'ASIA324': { id: generateServerId('ASIA4', '32', 4), name: 'ASIA324' },
        }
    },
    
    // Región INMENA (India, Middle East, North Africa)
    'INMENA1': {
        id: 6,
        servers: {
            // Grupo 01
            'INMENA011': { id: 221, name: 'INMENA011' },
            'INMENA012': { id: 222, name: 'INMENA012' },
            'INMENA013': { id: 223, name: 'INMENA013' },
            'INMENA014': { id: 224, name: 'INMENA014' },
            
            // Grupo 02
            'INMENA021': { id: 225, name: 'INMENA021' },
            'INMENA022': { id: 226, name: 'INMENA022' },
            'INMENA023': { id: 227, name: 'INMENA023' },
            'INMENA024': { id: 228, name: 'INMENA024' },
            
            // Grupo 03
            'INMENA031': { id: 231, name: 'INMENA031' },
            'INMENA032': { id: 232, name: 'INMENA032' },
            'INMENA033': { id: 233, name: 'INMENA033' },
            'INMENA034': { id: 234, name: 'INMENA034' },
        }
    },
    
    // Región EU (Europa)
    'EU1': {
        id: 7,
        servers: {
            // Grupo 01
            'EU011': { id: 711, name: 'EU011' },
            'EU012': { id: 712, name: 'EU012' },
            'EU013': { id: 713, name: 'EU013' },
            'EU014': { id: 714, name: 'EU014' },
            
            // Grupo 02
            'EU021': { id: 721, name: 'EU021' },
            'EU022': { id: 722, name: 'EU022' },
            'EU023': { id: 723, name: 'EU023' },
            'EU024': { id: 724, name: 'EU024' },
            
            // Grupo 03
            'EU031': { id: 731, name: 'EU031' },
            'EU032': { id: 732, name: 'EU032' },
            'EU033': { id: 733, name: 'EU033' },
            'EU034': { id: 734, name: 'EU034' },
        }
    },
    
    // Región SA (Sudamérica 1)
    'SA1': {
        id: 8,
        servers: {
            // Grupo 01
            'SA011': { id: 811, name: 'SA011' },
            'SA012': { id: 812, name: 'SA012' },
            'SA013': { id: 813, name: 'SA013' },
            'SA014': { id: 814, name: 'SA014' },
            
            // Grupo 02
            'SA021': { id: 821, name: 'SA021' },
            'SA022': { id: 822, name: 'SA022' },
            'SA023': { id: 823, name: 'SA023' },
            'SA024': { id: 824, name: 'SA024' },
            
            // Grupo 03
            'SA031': { id: 831, name: 'SA031' },
            'SA032': { id: 832, name: 'SA032' },
            'SA033': { id: 833, name: 'SA033' },
            'SA034': { id: 834, name: 'SA034' },
            
            // Grupo 04
            'SA041': { id: 841, name: 'SA041' },
            'SA042': { id: 842, name: 'SA042' },
            'SA043': { id: 843, name: 'SA043' },
            'SA044': { id: 844, name: 'SA044' },
        }
    },
    
    // Región SA (Sudamérica 2)
    'SA2': {
        id: 15, // ID correcto observado en la URL: worldgroupid=15
        servers: {
            // Grupo 05
            'SA051': { id: 151, name: 'SA051' },
            'SA052': { id: 178, name: 'SA052' }, // ID correcto observado en la URL: worldid=178
            'SA053': { id: 153, name: 'SA053' },
            'SA054': { id: 154, name: 'SA054' },
            
            // Grupo 06
            'SA061': { id: 161, name: 'SA061' },
            'SA062': { id: 162, name: 'SA062' },
            'SA063': { id: 163, name: 'SA063' },
            'SA064': { id: 164, name: 'SA064' },
            
            // Grupo 07
            'SA071': { id: 171, name: 'SA071' },
            'SA072': { id: 172, name: 'SA072' },
            'SA073': { id: 173, name: 'SA073' },
            'SA074': { id: 174, name: 'SA074' },
            
            // Grupo 08
            'SA081': { id: 181, name: 'SA081' },
            'SA082': { id: 182, name: 'SA082' },
            'SA083': { id: 183, name: 'SA083' },
            'SA084': { id: 184, name: 'SA084' },
        }
    },
    
    // Región NA (Norteamérica 1)
    'NA1': {
        id: 10,
        servers: {
            // Grupo 01
            'NA011': { id: 1011, name: 'NA011' },
            'NA012': { id: 1012, name: 'NA012' },
            'NA013': { id: 1013, name: 'NA013' },
            'NA014': { id: 1014, name: 'NA014' },
            
            // Grupo 02
            'NA021': { id: 1021, name: 'NA021' },
            'NA022': { id: 1022, name: 'NA022' },
            'NA023': { id: 1023, name: 'NA023' },
            'NA024': { id: 1024, name: 'NA024' },
            
            // Grupo 03
            'NA031': { id: 1031, name: 'NA031' },
            'NA032': { id: 1032, name: 'NA032' },
            'NA033': { id: 1033, name: 'NA033' },
            'NA034': { id: 1034, name: 'NA034' },
        }
    },
    
    // Región NA (Norteamérica 2)
    'NA2': {
        id: 11,
        servers: {
            // Grupo 01
            'NA111': { id: 1111, name: 'NA111' },
            'NA112': { id: 1112, name: 'NA112' },
            'NA113': { id: 1113, name: 'NA113' },
            'NA114': { id: 1114, name: 'NA114' },
            
            // Grupo 02
            'NA121': { id: 1121, name: 'NA121' },
            'NA122': { id: 1122, name: 'NA122' },
            'NA123': { id: 1123, name: 'NA123' },
            'NA124': { id: 1124, name: 'NA124' },
            
            // Grupo 03
            'NA131': { id: 1131, name: 'NA131' },
            'NA132': { id: 1132, name: 'NA132' },
            'NA133': { id: 1133, name: 'NA133' },
            'NA134': { id: 1134, name: 'NA134' },
        }
    }
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
    PORT: process.env.PORT || 3000,
    RANKING_URL: 'https://forum.mir4global.com/rank?ranktype=1',
    MAX_FILE_AGE_MS: 1 * 60 * 1000, // 1 minuto en milisegundos
    CLEANUP_CRON: '*/5 * * * *', // Cada 5 minutos
    DATA_DIR: 'data', // Directorio para archivos de datos
    SCRAPED_PAGES_DIR: 'scraped_pages', // Directorio para páginas scrapeadas
    MAX_PAGES_TO_SCRAPE: 10, // Máximo número de páginas a scrapear (10 x 100 = 1000 jugadores)
    LOAD_MORE_BUTTON_SELECTOR: '#btn_morelist', // Selector correcto del botón "+ To see more (100)"
    WAIT_BETWEEN_CLICKS_MS: 2000, // Tiempo de espera entre clics en el botón "Ver más"
    BROWSER_HEADLESS: true, // Ejecutar el navegador en modo headless
    SERVER_CACHE_TTL: 12 * 60 * 60 * 1000, // 12 horas en milisegundos para el caché de servidores
    PREFETCH_CRON: '0 */12 * * *', // Cada 12 horas (a las 00:00 y 12:00)
    
    // Configuración de MySQL usando variables de entorno
    MYSQL: {
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'mir4rankings',
        waitForConnections: true,
        connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10'),
        queueLimit: 0
    }
};

module.exports = {
    CHARACTER_CLASSES,
    HEADERS,
    CONFIG,
    SERVER_REGIONS,
    generateServerId
};