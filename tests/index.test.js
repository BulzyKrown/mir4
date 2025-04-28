const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../index');

describe('MIR4 Rankings API', () => {
    // Test para el endpoint principal de rankings
    describe('GET /api/rankings', () => {
        it('debería devolver la lista completa de rankings', async () => {
            const response = await request(app).get('/api/rankings');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeGreaterThan(0);
            
            // Verificar estructura de los datos
            const firstRank = response.body[0];
            expect(firstRank).toHaveProperty('rank');
            expect(firstRank).toHaveProperty('character');
            expect(firstRank).toHaveProperty('class');
            expect(firstRank).toHaveProperty('server');
            expect(firstRank).toHaveProperty('clan');
            expect(firstRank).toHaveProperty('powerScore');
        });
    });

    // Test para el endpoint de rango específico
    describe('GET /api/rankings/range/:start/:end', () => {
        it('debería devolver un rango específico de rankings', async () => {
            const response = await request(app).get('/api/rankings/range/1/10');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeLessThanOrEqual(10);
        });
        
        it('debería manejar rangos inválidos correctamente', async () => {
            const response = await request(app).get('/api/rankings/range/abc/xyz');
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });
    });

    // Test para búsqueda por servidor
    describe('GET /api/rankings/server/:server', () => {
        it('debería devolver rankings filtrados por servidor', async () => {
            const response = await request(app).get('/api/rankings/server/EU014');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            response.body.forEach(rank => {
                expect(rank.server).toContain('EU014');
            });
        });
        
        it('debería manejar servidores no encontrados', async () => {
            const response = await request(app).get('/api/rankings/server/SERVIDOR_INVALIDO');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBe(0);
        });
    });

    // Test para búsqueda por clan
    describe('GET /api/rankings/clan/:clan', () => {
        it('debería devolver rankings filtrados por clan', async () => {
            const response = await request(app).get('/api/rankings/clan/Ascendants');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
        });
        
        it('debería manejar clanes no encontrados', async () => {
            const response = await request(app).get('/api/rankings/clan/CLAN_INVALIDO_12345');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBe(0);
        });
    });

    // Test para estadísticas
    describe('GET /api/rankings/stats', () => {
        it('debería devolver estadísticas del ranking', async () => {
            const response = await request(app).get('/api/rankings/stats');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('totalPlayers');
            expect(response.body).toHaveProperty('averagePowerScore');
            expect(response.body).toHaveProperty('highestPowerScore');
            expect(response.body).toHaveProperty('lowestPowerScore');
            expect(response.body).toHaveProperty('serverDistribution');
            expect(response.body).toHaveProperty('classDistribution');
        });
    });

    // Test para búsqueda por clase
    describe('GET /api/rankings/class/:className', () => {
        it('debería devolver rankings filtrados por clase', async () => {
            const response = await request(app).get('/api/rankings/class/Guerrero');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            response.body.forEach(rank => {
                expect(rank.class).toBe('Guerrero');
            });
        });
        
        it('debería manejar clases no encontradas', async () => {
            const response = await request(app).get('/api/rankings/class/ClaseInvalida');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBe(0);
        });
    });
    
    // Test para listar servidores disponibles
    describe('GET /api/servers', () => {
        it('debería devolver el mapa de servidores y regiones', async () => {
            const response = await request(app).get('/api/servers');
            expect(response.status).toBe(200);
            
            // Verificar estructura de las regiones
            expect(response.body).toHaveProperty('ASIA1');
            expect(response.body.ASIA1).toHaveProperty('id');
            expect(response.body.ASIA1).toHaveProperty('servers');
            
            // Verificar estructura de los servidores
            const server = response.body.ASIA1.servers.ASIA011;
            expect(server).toHaveProperty('id');
            expect(server).toHaveProperty('name');
        });
    });

    // Test para último estado de carga 
    describe('GET /api/latest', () => {
        it('debería devolver información sobre el último conjunto de datos', async () => {
            const response = await request(app).get('/api/latest');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('servers');
        });
    });
    
    // Test para búsqueda de personaje global
    describe('GET /api/rankings/search/:characterName', () => {
        it('debería buscar un personaje en todos los servidores', async () => {
            const response = await request(app).get('/api/rankings/search/Personaje');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            
            // Verificar si el resultado contiene los campos de región y servidor
            if (response.body.length > 0) {
                expect(response.body[0]).toHaveProperty('regionName');
                expect(response.body[0]).toHaveProperty('serverName');
            }
        });
    });
    
    // Test para búsqueda por región y servidor específico
    describe('GET /api/rankings/region/:region/server/:server', () => {
        it('debería devolver rankings de un servidor específico', async () => {
            const response = await request(app).get('/api/rankings/region/ASIA1/server/ASIA041');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            
            if (response.body.length > 0) {
                expect(response.body[0]).toHaveProperty('server', 'ASIA041');
            }
        });
        
        it('debería manejar regiones o servidores inválidos', async () => {
            const response = await request(app).get('/api/rankings/region/REGION_INVALIDA/server/SERVIDOR_INVALIDO');
            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
        });
    });
    
    // Test para manejo de errores
    describe('Manejo de errores', () => {
        it('debería devolver 404 para rutas inexistentes', async () => {
            const response = await request(app).get('/api/ruta_inexistente');
            expect(response.status).toBe(404);
        });
        
        it('debería manejar errores en formato JSON', async () => {
            const response = await request(app).get('/api/rankings/range/no_numero/10');
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });
    });
});