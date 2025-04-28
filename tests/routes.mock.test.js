// filepath: /workspaces/mir4/tests/routes.mock.test.js
/**
 * Pruebas para endpoints básicos de información con mocks adecuados
 */

// Mockear módulos antes de importar la aplicación
jest.mock('node-cron', () => ({
  schedule: jest.fn()
}));

jest.mock('../src/prefetch', () => ({
  initPrefetch: jest.fn().mockReturnValue({}),
  prefetchAllServers: jest.fn().mockResolvedValue([]),
  getPrefetchStatus: jest.fn().mockReturnValue({
    lastUpdate: new Date().toISOString(),
    completed: ['ASIA1_ASIA041', 'ASIA1_ASIA042'],
    inProgress: ['ASIA1_ASIA043'],
    failed: ['ASIA2_ASIA111'],
    errors: {
      'ASIA2_ASIA111': 'Error de conexión'
    }
  })
}));

jest.mock('../src/database', () => ({
  pool: null,
  initializeDatabase: jest.fn().mockResolvedValue(true),
  updateServersDatabase: jest.fn(),
  markServerAsInactive: jest.fn(),
  markServerAsActive: jest.fn(),
  saveServerRankings: jest.fn(),
  saveCharacterDetails: jest.fn(),
  getCharacterDetails: jest.fn(),
  getRankingId: jest.fn(),
  getActiveServers: jest.fn().mockResolvedValue([
    {regionName: 'ASIA1', serverName: 'ASIA041'},
    {regionName: 'ASIA1', serverName: 'ASIA042'}
  ]),
  getServerRankings: jest.fn().mockResolvedValue([
    {
      rank: 1,
      character: "NombrePersonaje1",
      class: "Guerrero",
      server: "ASIA041",
      clan: "ClanNombre1",
      powerScore: 100000
    },
    {
      rank: 2,
      character: "NombrePersonaje2",
      class: "Maga",
      server: "ASIA041",
      clan: "ClanNombre2",
      powerScore: 98000
    }
  ]),
  logUpdateOperation: jest.fn(),
  getActiveServersList: jest.fn().mockResolvedValue({
    'ASIA1': ['ASIA041', 'ASIA042', 'ASIA043'],
    'ASIA2': ['ASIA101', 'ASIA102']
  }),
  searchCharacterAcrossServers: jest.fn().mockResolvedValue([
    {
      rank: 5,
      character: "BuscadoPersonaje",
      class: "Lancero",
      server: "ASIA041",
      clan: "ClanBuscado",
      powerScore: 95000,
      regionName: "ASIA1",
      serverName: "ASIA041"
    }
  ]),
  searchClanAcrossServers: jest.fn().mockResolvedValue([
    {
      rank: 3,
      character: "MiembroClan1",
      class: "Taotista",
      server: "ASIA042",
      clan: "ClanBuscado",
      powerScore: 92000,
      regionName: "ASIA1",
      serverName: "ASIA042"
    },
    {
      rank: 7,
      character: "MiembroClan2",
      class: "Ballestera",
      server: "ASIA042",
      clan: "ClanBuscado",
      powerScore: 88000,
      regionName: "ASIA1",
      serverName: "ASIA042"
    }
  ])
}));

// Mockear el sistema de caché
jest.mock('../src/cache', () => ({
  getCachedData: jest.fn().mockImplementation((key) => {
    if (key === 'rankings') {
      return [
        {
          rank: 1,
          character: "CachedPersonaje1",
          class: "Guerrero",
          server: "ASIA041",
          clan: "CachedClan1",
          powerScore: 100000
        }
      ];
    } else if (key.startsWith('server_')) {
      return [
        {
          rank: 1,
          character: "CachedServerCharacter",
          class: "Maga",
          server: key.split('_')[1],
          clan: "CachedServerClan",
          powerScore: 95000
        }
      ];
    }
    return null;
  }),
  setCachedData: jest.fn(),
  invalidateCache: jest.fn(),
  clearAllCache: jest.fn()
}));

// Ahora importamos la aplicación después de configurar los mocks
const request = require('supertest');
const app = require('../index');

describe('MIR4 Rankings API - Endpoints de información (con mocks)', () => {
  // Test para el endpoint raíz
  describe('GET /api/', () => {
    it('debería devolver información básica sobre la API', async () => {
      const response = await request(app).get('/api/');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'MIR4 Rankings API');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('documentation');
      expect(response.body).toHaveProperty('status', 'active');
      
      // Verificar que el objeto endpoints contiene información sobre las rutas principales
      expect(response.body.endpoints).toHaveProperty('/');
      expect(response.body.endpoints).toHaveProperty('/docs');
      expect(response.body.endpoints).toHaveProperty('/rankings');
      expect(response.body.endpoints).toHaveProperty('/rankings/server/:server');
    });
  });

  // Test para el endpoint de documentación
  describe('GET /api/docs', () => {
    it('debería devolver la documentación completa de la API', async () => {
      const response = await request(app).get('/api/docs');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('baseUrl');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body).toHaveProperty('ejemplos');
      expect(response.body).toHaveProperty('estructuraDeDatos');
      
      // Verificar que la lista de endpoints contiene información detallada
      expect(Array.isArray(response.body.endpoints)).toBe(true);
      expect(response.body.endpoints.length).toBeGreaterThan(0);
      
      // Verificar la estructura de un endpoint en la documentación
      const firstEndpoint = response.body.endpoints[0];
      expect(firstEndpoint).toHaveProperty('path');
      expect(firstEndpoint).toHaveProperty('method');
      expect(firstEndpoint).toHaveProperty('description');
      expect(firstEndpoint).toHaveProperty('parameters');
      expect(firstEndpoint).toHaveProperty('response');
      
      // Verificar que los ejemplos tienen las URL completas
      const ejemplos = response.body.ejemplos;
      expect(ejemplos).toHaveProperty('obtenerTodosLosRankings');
      expect(ejemplos.obtenerTodosLosRankings).toContain('/rankings');
    });
  });
  
  // Test para el endpoint de servidores disponibles
  describe('GET /api/servers', () => {
    it('debería devolver la lista de todos los servidores configurados', async () => {
      const response = await request(app).get('/api/servers');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('ASIA1');
      expect(response.body.ASIA1).toHaveProperty('id');
      expect(response.body.ASIA1).toHaveProperty('servers');
    });
  });
  
  // Test para el endpoint de estado
  describe('GET /api/status', () => {
    it('debería devolver el estado actual de la recolección de datos', async () => {
      const response = await request(app).get('/api/status');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('lastUpdate');
      expect(response.body).toHaveProperty('completed');
      expect(response.body).toHaveProperty('inProgress');
      expect(response.body).toHaveProperty('failed');
      expect(response.body).toHaveProperty('errors');
      
      // Verificar que se incluyen las listas de servidores
      expect(Array.isArray(response.body.completed)).toBe(true);
      expect(response.body.completed).toContain('ASIA1_ASIA041');
      expect(response.body.inProgress).toContain('ASIA1_ASIA043');
      expect(response.body.failed).toContain('ASIA2_ASIA111');
    });
  });
  
  // Test para el endpoint de últimos datos cargados
  describe('GET /api/latest', () => {
    it('debería devolver información sobre los últimos datos cargados', async () => {
      const response = await request(app).get('/api/latest');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('servers');
      expect(Array.isArray(response.body.servers)).toBe(true);
    });
  });
  
  // Test para búsqueda de personaje global
  describe('GET /api/rankings/search/:characterName', () => {
    it('debería buscar un personaje en todos los servidores disponibles', async () => {
      const response = await request(app).get('/api/rankings/search/BuscadoPersonaje');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      const firstResult = response.body[0];
      expect(firstResult).toHaveProperty('character', 'BuscadoPersonaje');
      expect(firstResult).toHaveProperty('regionName');
      expect(firstResult).toHaveProperty('serverName');
    });
    
    it('debería retornar array vacío cuando no encuentra personajes', async () => {
      // Modificamos el mock temporalmente
      require('../src/database').searchCharacterAcrossServers.mockResolvedValueOnce([]);
      
      const response = await request(app).get('/api/rankings/search/PersonajeInexistente');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });
  });
  
  // Test para búsqueda de clan global
  describe('GET /api/rankings/clan-global/:clanName', () => {
    it('debería buscar miembros de un clan en todos los servidores', async () => {
      const response = await request(app).get('/api/rankings/clan-global/ClanBuscado');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      
      response.body.forEach(member => {
        expect(member).toHaveProperty('clan', 'ClanBuscado');
        expect(member).toHaveProperty('regionName');
        expect(member).toHaveProperty('serverName');
      });
    });
  });
  
  // Test para obtener rankings por región y servidor
  describe('GET /api/rankings/region/:region/server/:server', () => {
    it('debería devolver los rankings de un servidor específico', async () => {
      const response = await request(app).get('/api/rankings/region/ASIA1/server/ASIA041');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveProperty('server', 'ASIA041');
      }
    });
    
    it('debería devolver 404 para regiones o servidores inexistentes', async () => {
      const response = await request(app).get('/api/rankings/region/REGIONINVALIDA/server/SERVERINVALIDO');
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
    
    it('debería permitir forzar una actualización con el parámetro refresh', async () => {
      const response = await request(app).get('/api/rankings/region/ASIA1/server/ASIA041?refresh=true');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });
  
  // Test para el endpoint de actualización
  describe('GET /api/refresh', () => {
    it('debería iniciar el proceso de actualización de todos los servidores', async () => {
      const response = await request(app).get('/api/refresh');
      expect(response.status).toBe(202); // Accepted
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('iniciado');
    });
  });
  
  // Test para debug del parser
  describe('GET /api/debug/:fileId', () => {
    it('debería intentar parsear un archivo HTML específico', async () => {
      // Este test puede ser complicado sin archivos reales, pero al menos verificamos la ruta
      const response = await request(app).get('/api/debug/ASIA1_ASIA041_page_1');
      // Incluso si falla en encontrar el archivo, debería dar una respuesta coherente
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
    });
  });
});