// filepath: /workspaces/mir4/jest.config.js
module.exports = {
  // Establece el timeout más corto para las pruebas
  testTimeout: 10000,
  // Archivos a ignorar
  testPathIgnorePatterns: ['/node_modules/'],
  // Configuración del entorno de pruebas
  testEnvironment: 'node',
  // Configurar un archivo global de setup
  globalSetup: '<rootDir>/tests/setup.js',
  // Configurar un archivo global de teardown
  globalTeardown: '<rootDir>/tests/teardown.js',
  // Forzar a Jest a salir después de ciertos milisegundos
  forceExit: true,
  // Detectar manejadores abiertos (sockets, DB, etc) que no se cerraron
  detectOpenHandles: true,
};