# MIR4 Rankings API

Esta API proporciona acceso a los datos del ranking de Power Score de MIR4, incluyendo información detallada sobre personajes, clases, servidores y clanes. Los datos se extraen directamente del sitio oficial de MIR4.

## Características

- Acceso a rankings globales de Power Score
- Filtros por servidor, clan y clase de personaje
- Estadísticas generales del ranking
- Almacenamiento en caché para optimizar el rendimiento
- Actualizaciones periódicas de los datos

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

## Estructura de la respuesta

Los endpoints retornan datos en el siguiente formato:

```json
{
  "rank": 1,
  "character": "NombrePersonaje",
  "class": "NombreClase",
  "server": "SERVERID",
  "clan": "NombreClan",
  "powerScore": 123456
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
```

## Ejemplo de uso con curl

```bash
# Obtener top 10 jugadores
curl http://localhost:3000/api/rankings/range/1/10

# Buscar por servidor
curl http://localhost:3000/api/rankings/server/EU014
```

## Estructura del proyecto

```
├── data/                  # Datos persistentes
├── scraped_pages/         # HTML de páginas scrapeadas (temporal)
├── src/
│   ├── cache.js           # Sistema de caché
│   ├── config.js          # Configuración global
│   ├── logger.js          # Sistema de logs
│   ├── routes.js          # Definición de endpoints
│   ├── scraper.js         # Lógica de scraping
│   └── utils.js           # Funciones auxiliares
├── tests/                 # Tests unitarios y de integración
├── index.js               # Punto de entrada
└── package.json           # Dependencias y scripts
```

## Pruebas

Para ejecutar los tests:

```bash
npm test
```

Para generar un informe de cobertura:

```bash
npm test -- --coverage
```

## Desarrollo

Al iniciar el servidor en modo desarrollo, los cambios en el código se recargan automáticamente gracias a nodemon.

### Sistema de logs

La API incluye un sistema de logs en colores para facilitar el desarrollo:
- Verde: Información de éxito
- Azul: Información general
- Amarillo: Advertencias
- Rojo: Errores

## Manejo de archivos temporales

Los archivos HTML descargados se guardan temporalmente en la carpeta `scraped_pages/` y se eliminan automáticamente después de 1 minuto para no ocupar espacio innecesario.

## Limitaciones

- La API solo muestra los datos que están disponibles públicamente en la página de rankings de MIR4.
- Las actualizaciones de los rankings siguen el horario oficial del juego (02:00 UTC+8).
- El rendimiento puede verse afectado si se realizan demasiadas solicitudes simultáneas.

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