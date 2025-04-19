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
    });

    // Test para búsqueda por clan
    describe('GET /api/rankings/clan/:clan', () => {
        it('debería devolver rankings filtrados por clan', async () => {
            const response = await request(app).get('/api/rankings/clan/Ascendants');
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
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
    });
});