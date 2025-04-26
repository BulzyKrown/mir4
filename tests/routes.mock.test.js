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
  prefetchAllServers: jest.fn().mockResolvedValue([])
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
  getActiveServers: jest.fn().mockResolvedValue([]),
  getServerRankings: jest.fn().mockResolvedValue([]),
  logUpdateOperation: jest.fn(),
  getActiveServersList: jest.fn().mockResolvedValue({})
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
});