// filepath: /workspaces/mir4/tests/teardown.js
/**
 * Limpieza global después de ejecutar todas las pruebas
 */

module.exports = async () => {
  // Limpiar cualquier recurso pendiente
  
  // Cerrar cualquier conexión a base de datos pendiente
  try {
    const database = require('../src/database');
    if (database && database.pool) {
      await database.pool.end();
      console.log('[TEST TEARDOWN] Conexiones de base de datos cerradas');
    }
  } catch (error) {
    // Ignorar errores aquí ya que probablemente estemos usando mocks
  }

  // Limpiar timers pendientes
  const pendingTimers = setTimeout(() => {}, 0);
  for (let i = 0; i < pendingTimers; i++) {
    clearTimeout(i);
  }
  
  console.log('[TEST TEARDOWN] Limpieza del entorno de pruebas completada');
};