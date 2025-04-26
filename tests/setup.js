// filepath: /workspaces/mir4/tests/setup.js
/**
 * Configuración global antes de ejecutar todas las pruebas
 */

module.exports = async () => {
  // Configurar variables de entorno para pruebas
  process.env.NODE_ENV = 'test';
  
  // No intentamos mockar módulos aquí, ya que eso debe hacerse dentro de las pruebas
  console.log('[TEST SETUP] Entorno de pruebas configurado');
};