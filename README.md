# MIR4 Rankings API

Esta API proporciona acceso a los datos del ranking de Power Score de MIR4, incluyendo información detallada sobre personajes, clases, servidores y clanes. Los datos se extraen directamente del sitio oficial de MIR4.

## Características

- Acceso a rankings globales de Power Score
- Búsqueda de jugadores en múltiples servidores y regiones
- Filtros por servidor, clan y clase de personaje
- Estadísticas generales del ranking
- Almacenamiento en caché para optimizar el rendimiento
- Actualizaciones periódicas de los datos
- Manejo de errores y reintentos automáticos

## Requisitos previos

- Node.js (v14 o superior)
- npm o yarn

## Instalación

```bash
# Clonar el repositorio
git clone [url-del-repositorio]
cd mir4-ranking-api

# Instalar dependencias
npm install
```

## Configuración

La configuración del proyecto se encuentra en `src/config.js`. Los principales parámetros que puedes modificar son:

- `PORT`: Puerto en el que se ejecutará la API (por defecto: 3000)
- `MAX_FILE_AGE_MS`: Tiempo de vida de las páginas scrapeadas (1 minuto en milisegundos)
- `CLEANUP_CRON`: Expresión cron para la limpieza de archivos (cada 5 minutos)
- `PREFETCH_CRON`: Expresión cron para prefetch automático (cada 12 horas)
- `SERVER_REGIONS`: Mapa de regiones y servidores con sus respectivos IDs

Crea un archivo `.env` basado en el archivo `example.env` proporcionado:

```bash
cp example.env .env
```

## Uso

Para iniciar el servidor:

```bash
# Modo desarrollo (con recarga automática)
npm run dev

# Modo producción
npm start
```

El servidor se iniciará en `http://localhost:3000`

## Endpoints

### Obtener todos los rankings
```http
GET /api/rankings
```
Retorna la lista completa de rankings con toda la información de cada jugador.

### Obtener rango específico
```http
GET /api/rankings/range/:start/:end
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `start` | `number` | Posición inicial del rango |
| `end` | `number` | Posición final del rango |

### Buscar por servidor
```http
GET /api/rankings/server/:server
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `server` | `string` | ID del servidor (ej: EU014, ASIA313) |

### Buscar por clan
```http
GET /api/rankings/clan/:clan
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `clan` | `string` | Nombre del clan |

### Buscar por clase
```http
GET /api/rankings/class/:className
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `className` | `string` | Nombre de la clase |

Clases disponibles:
- Guerrero
- Maga
- Taotista
- Ballestera
- Lancero
- Obscuraria

### Obtener estadísticas
```http
GET /api/rankings/stats
```
Retorna estadísticas generales incluyendo:
- Total de jugadores
- Power Score promedio
- Power Score más alto
- Power Score más bajo
- Distribución por servidor
- Distribución por clase

### Nuevos Endpoints

### Obtener últimos datos cargados
```http
GET /api/latest
```
Retorna información sobre el último conjunto de datos cargados, incluyendo timestamp y servidores procesados.

### Refrescar datos de todos los servidores
```http
GET /api/refresh
```
Fuerza una actualización de todos los datos de ranking de todos los servidores disponibles.

### Obtener datos de un servidor específico
```http
GET /api/server/:regionName/:serverName
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `regionName` | `string` | Nombre de la región (ej: ASIA1, EU1, SA2, etc.) |
| `serverName` | `string` | Nombre del servidor (ej: ASIA013, EU021, SA052, etc.) |

### Obtener estado de la recolección de datos
```http
GET /api/status
```
Retorna el estado actual de la recolección de datos, incluyendo servidores completados y en progreso.

### Debug del parser de HTML
```http
GET /api/debug/:fileId
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `fileId` | `string` | Identificador del archivo HTML almacenado (por ejemplo: "SA2_SA052_page_6") |

Retorna el resultado del parser sobre un archivo HTML específico, útil para depuración.

## Nuevas funcionalidades para múltiples servidores

### Listar todos los servidores disponibles
```http
GET /api/servers
```
Retorna un mapa de todas las regiones y servidores disponibles con sus IDs respectivos.

### Obtener ranking de un servidor específico
```http
GET /api/rankings/region/:region/server/:server
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `region` | `string` | Nombre de la región (ej: ASIA1, INMENA1, EU1, etc.) |
| `server` | `string` | Nombre del servidor (ej: ASIA011, INMENA021, etc.) |

Opcionalmente puede incluir el parámetro `refresh=true` para forzar un refresco del caché:
```http
GET /api/rankings/region/ASIA1/server/ASIA011?refresh=true
```

### Buscar un personaje en todos los servidores
```http
GET /api/rankings/search/:characterName
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `characterName` | `string` | Nombre del personaje a buscar |

Este endpoint busca en todos los servidores registrados y devuelve todas las coincidencias, ordenadas por Power Score de mayor a menor.

### Buscar clan en todos los servidores
```http
GET /api/rankings/clan-global/:clanName
```
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `clanName` | `string` | Nombre del clan a buscar |

Busca miembros del clan especificado en todos los servidores disponibles.

## Regiones y servidores soportados

La API ahora soporta todas las regiones y servidores oficiales de MIR4 con su estructura correcta:

### Regiones ASIA
- **ASIA1**: 
  - Grupo 01: ASIA011, ASIA012, ASIA013, ASIA014
  - Grupo 02: ASIA021, ASIA022, ASIA023, ASIA024
  - Grupo 03: ASIA031, ASIA032, ASIA033, ASIA034
  - Grupo 04: ASIA041, ASIA042, ASIA043, ASIA044
  
- **ASIA2**: 
  - Grupo 10: ASIA101, ASIA102, ASIA103, ASIA104
  - Grupo 11: ASIA111, ASIA112, ASIA113, ASIA114
  - Grupo 12: ASIA121, ASIA122, ASIA123, ASIA124
  
- **ASIA3**: 
  - Grupo 20: ASIA201, ASIA202, ASIA203, ASIA204
  - Grupo 21: ASIA211, ASIA212, ASIA213, ASIA214
  - Grupo 22: ASIA221, ASIA222, ASIA223, ASIA224
  
- **ASIA4**: 
  - Grupo 30: ASIA301, ASIA302, ASIA303, ASIA304
  - Grupo 31: ASIA311, ASIA312, ASIA313, ASIA314
  - Grupo 32: ASIA321, ASIA322, ASIA323, ASIA324

### Región INMENA (India, Oriente Medio, Norte de África)
- **INMENA1**: 
  - Grupo 01: INMENA011, INMENA012, INMENA013, INMENA014
  - Grupo 02: INMENA021, INMENA022, INMENA023, INMENA024
  - Grupo 03: INMENA031, INMENA032, INMENA033, INMENA034

### Región Europa
- **EU1**: 
  - Grupo 01: EU011, EU012, EU013, EU014
  - Grupo 02: EU021, EU022, EU023, EU024
  - Grupo 03: EU031, EU032, EU033, EU034

### Regiones Sudamérica
- **SA1**: 
  - Grupo 01: SA011, SA012, SA013, SA014
  - Grupo 02: SA021, SA022, SA023, SA024
  - Grupo 03: SA031, SA032, SA033, SA034
  - Grupo 04: SA041, SA042, SA043, SA044
  
- **SA2**: 
  - Grupo 05: SA051, SA052, SA053, SA054
  - Grupo 06: SA061, SA062, SA063, SA064
  - Grupo 07: SA071, SA072, SA073, SA074
  - Grupo 08: SA081, SA082, SA083, SA084

### Regiones Norteamérica
- **NA1**: 
  - Grupo 01: NA011, NA012, NA013, NA014
  - Grupo 02: NA021, NA022, NA023, NA024
  - Grupo 03: NA031, NA032, NA033, NA034
  
- **NA2**: 
  - Grupo 11: NA111, NA112, NA113, NA114
  - Grupo 12: NA121, NA122, NA123, NA124
  - Grupo 13: NA131, NA132, NA133, NA134

## Estructura de la respuesta

Los endpoints retornan datos en el siguiente formato:

```json
{
  "rank": 1,
  "character": "NombrePersonaje",
  "class": "NombreClase",
  "server": "SERVERID",
  "clan": "NombreClan",
  "powerScore": 123456,
  "regionName": "REGION",  // Solo en búsquedas multi-servidor
  "serverName": "SERVERID" // Solo en búsquedas multi-servidor
}
```

## Ejemplo de uso con JavaScript

```javascript
// Obtener los top 10 jugadores
fetch('http://localhost:3000/api/rankings/range/1/10')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// Buscar todos los Guerreros
fetch('http://localhost:3000/api/rankings/class/Guerrero')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));

// Buscar un personaje en todos los servidores disponibles
fetch('http://localhost:3000/api/rankings/search/NombrePersonaje')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

## Ejemplo de uso con curl

```bash
# Obtener top 10 jugadores
curl http://localhost:3000/api/rankings/range/1/10

# Buscar por servidor
curl http://localhost:3000/api/rankings/server/EU014

# Listar todos los servidores disponibles
curl http://localhost:3000/api/servers

# Obtener el ranking de un servidor específico
curl http://localhost:3000/api/rankings/region/ASIA1/server/ASIA011

# Buscar un personaje en todos los servidores
curl http://localhost:3000/api/rankings/search/NombrePersonaje
```

## Añadir nuevos servidores

Para añadir nuevos servidores al sistema, simplemente actualiza el objeto `SERVER_REGIONS` en el archivo `src/config.js` siguiendo el formato existente:

```javascript
'NOMBRE_REGION': {
    id: ID_REGION,
    servers: {
        'NOMBRE_SERVIDOR': { id: ID_SERVIDOR, name: 'NOMBRE_SERVIDOR' },
        // más servidores...
    }
}
```

La API automáticamente podrá buscar en estos nuevos servidores sin necesidad de modificar más código.

## Estructura del proyecto

```
├── data/                  # Datos persistentes y estado de prefetch
├── scraped_pages/         # HTML de páginas scrapeadas (temporal)
├── src/
│   ├── cache.js           # Sistema de caché
│   ├── config.js          # Configuración global
│   ├── logger.js          # Sistema de logs
│   ├── routes.js          # Definición de endpoints
│   ├── scraper.js         # Lógica de scraping
│   ├── prefetch.js        # Sistema de prefetch automático
│   └── utils.js           # Funciones auxiliares
├── tests/                 # Tests unitarios y de integración
├── index.js               # Punto de entrada
└── package.json           # Dependencias y scripts
```

## Manejo de Errores

El sistema incluye un mecanismo de manejo de errores para detectar y solucionar problemas durante el scraping. Los archivos de error (como `error_ASIA1_ASIA044_page_1.png`) son capturas de pantalla automáticas generadas cuando ocurre un error durante el scraping de un servidor específico.

### Tipos de errores comunes y soluciones:

1. **Errores de conexión**: Ocurren cuando hay problemas para conectar con el servidor de MIR4. El sistema reintentará la conexión automáticamente.

2. **Errores de estructura HTML**: Si la web de MIR4 cambia su estructura, estos errores se registran para actualizar el parser.

3. **Errores de tiempo de espera**: Cuando el servidor de MIR4 tarda demasiado en responder. El sistema aumenta gradualmente el tiempo de espera.

4. **Errores de región/servidor inválido**: Cuando se intenta acceder a un servidor que no existe o ha sido eliminado.

Para resolver errores persistentes:

1. Revisar las capturas de error en la raíz del proyecto
2. Verificar los logs para obtener detalles adicionales
3. Ajustar los tiempos de espera o reintentos en `src/config.js` si es necesario
4. Actualizar los selectores HTML si la web de MIR4 ha cambiado

## Pruebas

El proyecto incluye pruebas unitarias y de integración para garantizar su correcto funcionamiento. Se utilizan Jest y Supertest para las pruebas.

### Ejecución de pruebas

```bash
# Ejecutar todas las pruebas
npm test

# Ejecutar pruebas con coverage
npm test -- --coverage

# Ejecutar un grupo específico de pruebas
npm test -- routes.test.js

# Ejecutar pruebas en modo watch (útil durante desarrollo)
npm test -- --watch
```

### Estructura de pruebas

- **routes.test.js**: Prueba los endpoints de la API con datos reales
- **routes.mock.test.js**: Prueba los endpoints con datos simulados (sin dependencia externa)
- **index.test.js**: Prueba la inicialización y configuración de la aplicación
- **setup.js**: Configuración general para las pruebas
- **teardown.js**: Limpieza después de las pruebas

### Añadir nuevas pruebas

Para añadir nuevas pruebas, crea un archivo con el nombre `[nombre].test.js` en la carpeta `tests/` siguiendo el patrón existente:

```javascript
const request = require('supertest');
const app = require('../index');

describe('Nombre de la suite de pruebas', () => {
    it('debería hacer algo específico', async () => {
        const response = await request(app).get('/ruta/a/probar');
        expect(response.status).toBe(200);
        // Más aserciones...
    });
});
```

## Contribución

1. Haz un fork del proyecto
2. Crea una rama para tu función (`git checkout -b feature/nueva-funcion`)
3. Realiza tus cambios y añade tests si es necesario
4. Ejecuta los tests para asegurar que todo funcione
5. Haz commit de tus cambios (`git commit -am 'Añadir nueva función'`)
6. Haz push a la rama (`git push origin feature/nueva-funcion`)
7. Abre un Pull Request

## Licencia

Este proyecto está licenciado bajo la Licencia ISC - ver el archivo `LICENSE` para más detalles.

## Contacto

Si tienes preguntas o sugerencias, por favor abre un issue en el repositorio.