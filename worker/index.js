/**
 * MIR4 Rankings API - Versión para Cloudflare Workers
 */

// Configuración y constantes
const CONFIG = {
  CACHE_TTL: 300, // 5 minutos en segundos
  SERVER_CACHE_TTL: 43200, // 12 horas en segundos
};

// Manejador principal para solicitudes HTTP
export default {
  // Configuración para tareas programadas (reemplazo de node-cron)
  async scheduled(event, env, ctx) {
    console.log(`Ejecutando tarea programada: ${event.cron}`);
    
    // Aquí normalmente dispararíamos el proceso de scraping
    // Pero como Puppeteer no funciona en Workers, esto se haría externamente
    
    // Limpieza de datos antiguos (similar a cleanupOldFiles)
    await cleanupOldData(env);
    
    return new Response("Tarea programada ejecutada", { status: 200 });
  },
  
  // Manejador de solicitudes HTTP (reemplazo de Express)
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      // Middleware para registrar solicitudes (similar a tu código Express)
      console.log(`${request.method} ${url.pathname}`);
      
      // Configurar CORS para permitir solicitudes desde cualquier origen
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      
      // Manejar solicitudes OPTIONS (CORS preflight)
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: corsHeaders
        });
      }
      
      // Manejar la ruta raíz (/)
      if (path === "/" || path === "") {
        return new Response(JSON.stringify({
          name: "MIR4 Rankings API",
          description: "API para consultar rankings de MIR4",
          version: "1.0.0",
          docs: "/api/docs",
          endpoints: {
            rankings: "/api/rankings",
            server: "/api/server/{region}/{server}",
            clan: "/api/clan?name={clanName}",
            stats: "/api/stats/cache"
          }
        }, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // Rutas API (reemplazo de tus rutas Express)
      if (path.startsWith('/api')) {
        // Ruta de documentación
        if (path === '/api/docs' || path === '/doc') {
          return handleDocs(request, env, corsHeaders);
        }
        
        // Ruta para rankings generales
        if (path === '/api/rankings') {
          return handleRankings(request, env, corsHeaders);
        }
        
        // Ruta para rankings de servidor específico
        const serverMatch = path.match(/\/api\/server\/([^\/]+)\/([^\/]+)/);
        if (serverMatch) {
          const regionName = serverMatch[1];
          const serverName = serverMatch[2];
          return handleServerRankings(request, env, regionName, serverName, corsHeaders);
        }
        
        // Ruta para consulta por clan
        if (path === '/api/clan') {
          return handleClanQuery(request, env, corsHeaders);
        }
        
        // Ruta para estadísticas del caché
        if (path === '/api/stats/cache') {
          return handleCacheStats(env, corsHeaders);
        }
        
        // Otras rutas según tu API original...
      }
      
      // Ruta por defecto - no encontrado
      return new Response(JSON.stringify({ 
        error: 'Ruta no encontrada',
        message: 'La ruta solicitada no existe. Visita la ruta principal (/) para ver los endpoints disponibles.'
      }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
      
    } catch (error) {
      console.error(`Error en el Worker: ${error.message}`);
      
      return new Response(JSON.stringify({ 
        error: 'Error interno del servidor',
        message: error.message
      }), { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

/**
 * Maneja las solicitudes a la API de rankings general
 */
async function handleRankings(request, env, corsHeaders) {
  try {
    // Intentar obtener datos del KV
    const data = await env.MIR4_RANKINGS.get('main_rankings', { type: 'json' });
    
    if (!data) {
      return new Response(JSON.stringify({ 
        error: 'No hay datos disponibles',
        message: 'Los rankings no han sido importados aún o no están disponibles' 
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // Manejar parámetros de consulta (similar a tu API actual)
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const page = parseInt(url.searchParams.get('page') || '1');
    const classFilter = url.searchParams.get('class');
    
    // Aplicar filtros como en tu API original
    let filteredData = [...data];
    
    if (classFilter) {
      filteredData = filteredData.filter(player => 
        player.class.toLowerCase() === classFilter.toLowerCase()
      );
    }
    
    // Paginación
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedData = filteredData.slice(startIndex, endIndex);
    
    // Metadatos de respuesta
    const response = {
      success: true,
      total: filteredData.length,
      page,
      limit,
      results: paginatedData,
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error(`Error en handleRankings: ${error.message}`);
    
    return new Response(JSON.stringify({ 
      error: 'Error al procesar rankings',
      message: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

/**
 * Maneja las solicitudes de rankings por servidor específico
 */
async function handleServerRankings(request, env, regionName, serverName, corsHeaders) {
  try {
    // Clave para KV
    const key = `server_${regionName}_${serverName}`;
    
    // Intentar obtener datos del KV
    const data = await env.MIR4_RANKINGS.get(key, { type: 'json' });
    
    if (!data) {
      return new Response(JSON.stringify({ 
        error: 'No hay datos para este servidor',
        message: `No se encontraron datos para ${regionName} > ${serverName}` 
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // Aplicar filtros y paginación igual que en handleRankings
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const page = parseInt(url.searchParams.get('page') || '1');
    const classFilter = url.searchParams.get('class');
    
    let filteredData = [...data];
    
    if (classFilter) {
      filteredData = filteredData.filter(player => 
        player.class.toLowerCase() === classFilter.toLowerCase()
      );
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedData = filteredData.slice(startIndex, endIndex);
    
    const response = {
      success: true,
      region: regionName,
      server: serverName,
      total: filteredData.length,
      page,
      limit,
      results: paginatedData,
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error(`Error en handleServerRankings: ${error.message}`);
    
    return new Response(JSON.stringify({ 
      error: 'Error al procesar rankings de servidor',
      message: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

/**
 * Maneja consultas de jugadores por clan
 */
async function handleClanQuery(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const clanName = url.searchParams.get('name');
    
    if (!clanName) {
      return new Response(JSON.stringify({ 
        error: 'Parámetro requerido',
        message: 'El parámetro "name" es obligatorio' 
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // Buscar en los datos principales
    const mainData = await env.MIR4_RANKINGS.get('main_rankings', { type: 'json' }) || [];
    
    // Filtrar por clan
    const clanMembers = mainData.filter(player => 
      player.clan && player.clan.toLowerCase() === clanName.toLowerCase()
    );
    
    return new Response(JSON.stringify({
      success: true,
      clan: clanName,
      total: clanMembers.length,
      results: clanMembers,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error(`Error en handleClanQuery: ${error.message}`);
    
    return new Response(JSON.stringify({ 
      error: 'Error al procesar consulta de clan',
      message: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

/**
 * Devuelve estadísticas del caché (similar a tu getCacheStats)
 */
async function handleCacheStats(env, corsHeaders) {
  try {
    // Obtener lista de claves en KV
    const keys = await env.MIR4_RANKINGS.list();
    
    // Construir estadísticas básicas
    const stats = {
      mainCache: {
        active: keys.keys.some(k => k.name === 'main_rankings'),
        lastUpdated: null
      },
      serverCache: {
        count: keys.keys.filter(k => k.name.startsWith('server_')).length,
        keys: keys.keys.filter(k => k.name.startsWith('server_')).map(k => k.name)
      },
      config: {
        ttlSeconds: CONFIG.CACHE_TTL,
        serverTtlSeconds: CONFIG.SERVER_CACHE_TTL
      }
    };
    
    // Intentar obtener metadata para el caché principal
    const mainMeta = await env.MIR4_RANKINGS.getWithMetadata('main_rankings');
    if (mainMeta.metadata) {
      stats.mainCache.lastUpdated = mainMeta.metadata.updated;
    }
    
    return new Response(JSON.stringify(stats), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error(`Error en handleCacheStats: ${error.message}`);
    
    return new Response(JSON.stringify({ 
      error: 'Error al obtener estadísticas del caché',
      message: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

/**
 * Limpia datos antiguos del KV (similar a tu cleanupOldFiles)
 */
async function cleanupOldData(env) {
  try {
    console.log('Iniciando limpieza de datos antiguos...');
    
    // Obtener todas las claves
    const keys = await env.MIR4_RANKINGS.list();
    const serverKeys = keys.keys.filter(k => k.name.startsWith('server_'));
    
    // Verificar metadatos de cada clave para ver si están expirados
    let deletedCount = 0;
    
    for (const key of serverKeys) {
      try {
        const { metadata } = await env.MIR4_RANKINGS.getWithMetadata(key.name);
        
        if (metadata && metadata.updated) {
          const ageMs = Date.now() - metadata.updated;
          const ageHours = ageMs / (1000 * 60 * 60);
          
          // Si los datos tienen más de 7 días, eliminarlos
          if (ageHours > 7 * 24) {
            await env.MIR4_RANKINGS.delete(key.name);
            console.log(`Eliminada clave antigua: ${key.name} (${ageHours.toFixed(1)} horas)`);
            deletedCount++;
          }
        }
      } catch (keyError) {
        console.error(`Error al procesar clave ${key.name}: ${keyError.message}`);
      }
    }
    
    console.log(`Limpieza completada. Se eliminaron ${deletedCount} entradas antiguas.`);
    
  } catch (error) {
    console.error(`Error en cleanupOldData: ${error.message}`);
  }
}

/**
 * Documentación de la API
 */
async function handleDocs(request, env, corsHeaders) {
  const docsContent = {
    api: {
      name: "MIR4 Rankings API",
      description: "API para consultar rankings por poder en MIR4",
      version: "1.0.0",
      baseUrl: "https://mir4-ranking-api.darkmagiclost.workers.dev"
    },
    endpoints: [
      {
        path: "/api/rankings",
        method: "GET",
        description: "Obtiene el ranking general de jugadores",
        parameters: [
          { name: "page", in: "query", type: "integer", default: 1, description: "Número de página" },
          { name: "limit", in: "query", type: "integer", default: 100, description: "Cantidad de resultados por página" },
          { name: "class", in: "query", type: "string", description: "Filtrar por clase: Warrior, Sorcerer, Taoist, Arbalist, Lancer" }
        ],
        example: "/api/rankings?page=1&limit=10&class=Warrior"
      },
      {
        path: "/api/server/{region}/{server}",
        method: "GET",
        description: "Obtiene el ranking de jugadores para un servidor específico",
        parameters: [
          { name: "region", in: "path", required: true, type: "string", description: "ID de la región (ej: ASIA1, EU1, NA1)" },
          { name: "server", in: "path", required: true, type: "string", description: "ID del servidor (ej: ASIA011, EU011)" },
          { name: "page", in: "query", type: "integer", default: 1, description: "Número de página" },
          { name: "limit", in: "query", type: "integer", default: 100, description: "Cantidad de resultados por página" },
          { name: "class", in: "query", type: "string", description: "Filtrar por clase" }
        ],
        example: "/api/server/ASIA1/ASIA011?page=1&limit=20"
      },
      {
        path: "/api/clan",
        method: "GET",
        description: "Busca jugadores por nombre de clan",
        parameters: [
          { name: "name", in: "query", required: true, type: "string", description: "Nombre del clan a buscar" }
        ],
        example: "/api/clan?name=ClanName"
      },
      {
        path: "/api/stats/cache",
        method: "GET",
        description: "Obtiene estadísticas del caché de datos",
        example: "/api/stats/cache"
      }
    ],
    regiones: [
      { id: "ASIA1", servers: ["ASIA011", "ASIA012", "ASIA013", "ASIA014"] },
      { id: "ASIA2", servers: ["ASIA101", "ASIA102", "ASIA103", "ASIA104"] },
      { id: "EU1", servers: ["EU011", "EU012", "EU013", "EU014"] },
      { id: "NA1", servers: ["NA011", "NA012", "NA013", "NA014"] },
      { id: "INMENA1", servers: ["INMENA011", "INMENA012", "INMENA013", "INMENA014"] }
      // Nota: Lista simplificada, hay más servidores disponibles
    ],
    notas: [
      "La API utiliza paginación para todos los endpoints que devuelven listas",
      "Los datos se actualizan periódicamente cada 12 horas",
      "Todos los endpoints soportan CORS para uso en aplicaciones web"
    ],
    ejemploRespuesta: {
      success: true,
      total: 100,
      page: 1,
      limit: 10,
      results: [
        {
          rank: 1,
          character: "ExamplePlayer",
          class: "Warrior",
          imageUrl: "https://example.com/image.jpg",
          server: "Server1",
          clan: "ClanName",
          powerScore: 5000000
        }
        // ...más jugadores
      ],
      timestamp: "2025-04-25T12:00:00Z"
    },
    errores: [
      { status: 404, descripcion: "Datos no encontrados" },
      { status: 400, descripcion: "Parámetros de consulta incorrectos" },
      { status: 500, descripcion: "Error interno del servidor" }
    ]
  };

  return new Response(JSON.stringify(docsContent, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}