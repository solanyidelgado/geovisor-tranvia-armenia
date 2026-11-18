/* ============================================================
   GEOVISOR TRANVÍA URBANO · ARMENIA, QUINDÍO
   script.js
   ------------------------------------------------------------
   Organizado por las fases del proyecto:
     0. Configuración y utilidades
     1. Base del geovisor (mapa y mapas base)
     2. Capas de entrada, grupos y leyenda dinámica
     3. Herramientas (buscador, coordenadas, escala, medición,
        pantalla completa, localización)
     4. Resultados (aptitud, corredor, estaciones, buffers, popups)
     5. Aspecto profesional (inicio, panel lateral, modelo AHP)
   ============================================================ */


/* ============================================================
   0. CONFIGURACIÓN
   ============================================================ */

const CONFIG = {
    centro: [4.5339, -75.6811],
    zoom: 13,
    rutaDatos: 'data/',                       // carpeta de los GeoJSON
    // Caja de búsqueda de direcciones (oeste, sur, este, norte)
    cajaArmenia: [-75.76, 4.48, -75.62, 4.59],
    // Street View: déjelo vacío para usar el visor de Google sin clave.
    // Si saca una clave gratuita de "Maps Embed API" en Google Cloud, péguela aquí
    // y el visor usa la versión oficial (más estable).
    claveGoogle: '',
    // Vuelo de entrada: el mapa arranca mostrando Colombia y se acerca hasta Armenia
    vuelo: {
        inicio: [4.4, -74.2],     // centro de Colombia
        zoomInicio: 5,
        segundos: 4.5,            // duración del vuelo: súbalo para que vaya más despacio
        zoomMinimo: 11            // zoom mínimo del geovisor después del vuelo
    }
};

// Sistema de referencia del proyecto: MAGNA-SIRGAS / Origen Nacional (Tabla 5)
proj4.defs('EPSG:9377',
    '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// Tabla 1 del informe · Densidad poblacional por comuna (proyección 2025)
const COMUNAS = [
    { n: 1,  nombre: 'Centenario',                     hab: 39383, dens: 7414  },
    { n: 2,  nombre: 'Rufino José Cuervo',             hab: 59420, dens: 18609 },
    { n: 3,  nombre: 'Alfonso López',                  hab: 39736, dens: 16557 },
    { n: 4,  nombre: 'Francisco de Paula Santander',   hab: 13159, dens: 7112  },
    { n: 5,  nombre: 'El Bosque',                      hab: 19720, dens: 15197 },
    { n: 6,  nombre: 'San José',                       hab: 43726, dens: 16212 },
    { n: 7,  nombre: 'El Cafetero',                    hab: 17830, dens: 7114  },
    { n: 8,  nombre: 'Libertadores',                   hab: 12115, dens: 11065 },
    { n: 9,  nombre: 'Fundadores',                     hab: 16645, dens: 11489 },
    { n: 10, nombre: 'Quimbaya',                       hab: 62935, dens: 6322  }
];

/* Población beneficiada por estación (tabla del análisis en ArcGIS Pro).
   La clave es el número de la estación (1 = extremo sur del corredor).  */
const POBLACION_ESTACIONES = {
    1:  { p500: 7933,  p1000: 27632 },
    2:  { p500: 8045,  p1000: 34476 },
    3:  { p500: 15335, p1000: 47424 },
    4:  { p500: 11930, p1000: 48452 },
    5:  { p500: 12966, p1000: 41596 },
    6:  { p500: 13357, p1000: 36422 },
    7:  { p500: 13232, p1000: 32997 },
    8:  { p500: 10400, p1000: 25507 },
    9:  { p500: 7720,  p1000: 17341 },
    10: { p500: 4536,  p1000: 9704  }
};

/* ---------- Utilidades ---------- */

// Quita tildes y pasa a minúsculas: "Rufino José" → "rufino jose"
function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();
}

// Lee un atributo sin importar mayúsculas: campo(props, ['NOMBRE','name'])
function campo(props, nombres) {
    if (!props) return undefined;
    const claves = Object.keys(props);
    for (const n of nombres) {
        const k = claves.find(c => c.toLowerCase() === n.toLowerCase());
        if (k !== undefined && props[k] !== null && props[k] !== '') return props[k];
    }
    return undefined;
}

// Evita que un texto de los datos se interprete como HTML
function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const num = (v, dec = 0) => Number(v).toLocaleString('es-CO',
    { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Plantilla común de las ventanas emergentes
function popupHTML(titulo, subtitulo, filas, nota) {
    const cuerpo = filas
        .filter(f => f[1] !== undefined && f[1] !== null && f[1] !== '')
        .map(f => `<tr><td>${esc(f[0])}</td><td>${f[1]}</td></tr>`).join('');
    return `
        <div class="popup-cabecera">${esc(titulo)}<small>${esc(subtitulo)}</small></div>
        <div class="popup-cuerpo">
            <table>${cuerpo}</table>
            ${nota ? `<p class="nota mb-0">${nota}</p>` : ''}
        </div>`;
}


/* ============================================================
   FASE 1 · BASE DEL GEOVISOR
   ============================================================ */

// El mapa arranca lejos (Colombia); al entrar al geovisor vuela hasta Armenia
const map = L.map('map', {
    zoomControl: false,
    minZoom: CONFIG.vuelo.zoomInicio,
    maxZoom: 19
}).setView(CONFIG.vuelo.inicio, CONFIG.vuelo.zoomInicio);

L.control.zoom({ position: 'topright' }).addTo(map);

/* ---------- Mapas base ---------- */
const MAPAS_BASE = {
    osm: {
        nombre: 'OpenStreetMap', icono: 'fa-map',
        capa: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap', maxZoom: 19
        })
    },
    satelite: {
        nombre: 'Satélite', icono: 'fa-satellite',
        capa: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics', maxZoom: 19
        })
    },
    topo: {
        nombre: 'Topográfico', icono: 'fa-mountain',
        capa: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri', maxZoom: 19
        })
    }
};

let mapaBaseActual = null;

function cambiarMapaBase(id) {
    if (mapaBaseActual) map.removeLayer(MAPAS_BASE[mapaBaseActual].capa);
    MAPAS_BASE[id].capa.addTo(map);
    mapaBaseActual = id;
    document.querySelectorAll('.mapa-base').forEach(el =>
        el.classList.toggle('activo', el.dataset.id === id));
}

function construirMapasBase() {
    const cont = document.getElementById('panelMapasBase');
    cont.innerHTML = Object.entries(MAPAS_BASE).map(([id, m]) => `
        <div class="mapa-base" data-id="${id}">
            <i class="fa-solid ${m.icono}"></i>${m.nombre}
        </div>`).join('');
    cont.querySelectorAll('.mapa-base').forEach(el =>
        el.addEventListener('click', () => cambiarMapaBase(el.dataset.id)));
    cambiarMapaBase('osm');
}


/* ============================================================
   FASE 2 · CAPAS DE ENTRADA DEL ANÁLISIS MULTICRITERIO
   ------------------------------------------------------------
   Cada capa lee un GeoJSON de la carpeta data/.
   Exporte desde ArcGIS Pro con "Features To JSON" marcando
   "Output to GeoJSON" y "Project to WGS_1984" (EPSG:4326).
   Si un archivo no existe, la capa aparece como "sin datos"
   y el resto del geovisor sigue funcionando.
   ============================================================ */

const GRUPOS = {
    area:          { nombre: 'Área de estudio',      icono: 'fa-map-location-dot' },
    criterios:     { nombre: 'Criterios de aptitud', icono: 'fa-sliders' },
    restricciones: { nombre: 'Restricciones',        icono: 'fa-ban' },
    resultados:    { nombre: 'Resultados',           icono: 'fa-route' }
};

/* ---------- Funciones de clasificación ---------- */

// Busca la comuna de un polígono por nombre o por número
function datosComuna(props) {
    if (!props) return null;
    for (const [clave, valor] of Object.entries(props)) {
        const t = normalizar(valor);
        const c = COMUNAS.find(c => t && (t === normalizar(c.nombre) || t.endsWith(normalizar(c.nombre))));
        if (c) return c;
        if (/comuna|cod|num|id_c/i.test(clave)) {
            const n = parseInt(valor, 10);
            const porNumero = COMUNAS.find(c => c.n === n);
            if (porNumero) return porNumero;
        }
    }
    return null;
}

function nombreComuna(props) {
    const d = datosComuna(props);
    return d ? d.nombre : (campo(props, ['NOMBRE', 'NOM_COMUNA', 'COMUNA', 'name']) || 'Comuna');
}

// Clases 1-2-3 (raster reclasificado y convertido a polígonos: campo gridcode)
function clase123(props, camposTexto) {
    const v = campo(props, ['gridcode', 'CLASE', 'VALUE', ...camposTexto]);
    const t = normalizar(v);
    if (t === '1' || t.includes('baja')) return 'c1';
    if (t === '2' || t.includes('media') || t.includes('moder')) return 'c2';
    if (t === '3' || t.includes('alta')) return 'c3';
    return 'otro';
}

/* ---------- Pendiente: escala de 7 clases (a – g) ---------- */
const CLASES_PENDIENTE = {
    a: { rango: '0 – 3 %',    max: 3,        color: '#5a9e32', descripcion: 'A nivel / casi nivel' },
    b: { rango: '3 – 5 %',    max: 5,        color: '#8dc63f', descripcion: 'Ligeramente inclinada / ligeramente ondulada' },
    c: { rango: '5 – 12 %',   max: 12,       color: '#c4df5b', descripcion: 'Moderadamente inclinada / moderadamente ondulada' },
    d: { rango: '12 – 25 %',  max: 25,       color: '#ffff55', descripcion: 'Fuertemente inclinada / fuertemente ondulada / moderadamente quebrada' },
    e: { rango: '25 – 50 %',  max: 50,       color: '#f7b347', descripcion: 'Fuertemente quebrada / ligeramente escarpada' },
    f: { rango: '50 – 75 %',  max: 75,       color: '#ee6b30', descripcion: 'Moderadamente escarpada' },
    g: { rango: '75 – 100 %', max: Infinity, color: '#e03a2a', descripcion: 'Fuertemente escarpada (incluye escarpes subverticales y verticales)' }
};
Object.entries(CLASES_PENDIENTE).forEach(([k, c]) => c.etiqueta = `${k} · ${c.rango} · ${c.descripcion}`);

CLASES_PENDIENTE.otro = { etiqueta: 'Sin clasificar', color: '#cfd8dc', rango: '—', descripcion: 'Sin clasificar' };

/* Clasifica cada polígono de data/pendiente.geojson. Acepta:
   - un campo con la pendiente en %  (PENDIENTE, SLOPE, PEND_PCT)
   - un campo con la clase 1 a 7     (gridcode, CLASE, VALUE)  → 1 = a … 7 = g
   - un campo con la letra a – g     (SIMBOLO, CLASE)                        */
function clasificarPendiente(props) {
    const pct = campo(props, ['PENDIENTE', 'SLOPE', 'PEND_PCT']);
    if (pct !== undefined && !isNaN(Number(pct))) {
        const v = Number(pct);
        return Object.keys(CLASES_PENDIENTE).find(k => k !== 'otro' && v <= CLASES_PENDIENTE[k].max);
    }
    const letra = normalizar(campo(props, ['SIMBOLO', 'CLASE', 'gridcode', 'VALUE']));
    if (/^[a-g]$/.test(letra)) return letra;
    const n = parseInt(letra, 10);
    if (n >= 1 && n <= 7) return 'abcdefg'[n - 1];
    return 'otro';
}

/* ---------- Uso del suelo (tejidos urbanos) ---------- */
function clasificarUsoSuelo(props) {
    // Solo se usa la columna "Uso_su" de la tabla de atributos
    const t = normalizar(campo(props, ['Uso_su']));
    if (/paisaj/.test(t)) return 'paisajistico';
    if (/\buas\b/.test(t)) return 'uas';
    if (/central/.test(t)) return 'central';
    if (/empresarial|comerc/.test(t)) return 'empresarial';
    if (/industr/.test(t)) return 'industrial';
    if (/residen/.test(t)) return 'residencial';
    return 'otro';
}

// Color para valores de "Uso_su" que no encajan en ninguna categoría conocida:
// cada valor distinto recibe su propio color (siempre el mismo para el mismo texto).
const PALETA_USOS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac',
    '#f06292', '#a1887f', '#90a4ae', '#dce775', '#7986cb', '#ff8a65'];
function colorOtroUso(texto) {
    const t = normalizar(texto);
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return PALETA_USOS[h % PALETA_USOS.length];
}

function clasificarVia(props) {
    const t = normalizar(campo(props, ['JERARQUIA', 'highway', 'TIPO', 'CLASE', 'fclass']));
    if (t.includes('trunk') || t.includes('primar') || t.includes('arteria')) return 'primaria';
    if (t.includes('secund') || t.includes('secondary')) return 'secundaria';
    if (t.includes('terci') || t.includes('tertiary')) return 'terciaria';
    return 'otro';
}

/* ---------- Equipamientos ----------
   Se revisan el tipo y el nombre. El orden importa: por ejemplo,
   "Universidad" se revisa antes que "Colegio".                        */
function clasificarTexto(t) {
    if (!t) return 'otro';
    if (/justicia|courthouse|juzgado|tribunal|fiscal|procuradur|defensor/.test(t)) return 'justicia';
    if (/contralor|dane\b|estadistica|migracion|registradur|notaria|dian\b|ministerio|gobernaci|alcald|townhall|government|gobierno|secretar|camara de comercio|consumidor|superintendencia|entidad|oficina|administrativ/.test(t)) return 'entidad';
    if (/muse/.test(t)) return 'museo';
    if (/universi|college|catolica|politecnico|sena\b|tecnologic/.test(t)) return 'universidad';
    if (/hospital|clinic|salud|health|doctor|\beps\b|\bips\b|especialista|asmet|medic|laboratorio|odontolog|oftalm|\bevl\b|vision/.test(t)) return 'hospital';
    if (/colegio|escuela|school|kindergarten|educa|institut|jardin infantil|liceo|gimnasio/.test(t)) return 'colegio';
    if (/cultur|biblioteca|library|teatro|theatre|arts_centre|community_centre|auditorio|casa de la cultura/.test(t)) return 'cultural';
    if (/deport|sports|stadium|estadio|coliseo|cancha|pitch|polideport|piscina|gimnasio/.test(t)) return 'deporte';
    if (/parque|park|playground|plaza|plazoleta/.test(t)) return 'parque';
    if (/iglesia|catedral|parroquia|templo|capilla|church/.test(t)) return 'iglesia';
    if (/banco|bancol|davivienda|bbva|bank|cajero|corporacion|cooperativa/.test(t)) return 'banco';
    if (/policia|cai\b|estacion de policia|ejercito|batallon|militar/.test(t)) return 'policia';
    if (/bombero|defensa civil|cruz roja/.test(t)) return 'emergencia';
    if (/terminal|transporte|bus\b|estacion de servicio|aeropuerto/.test(t)) return 'transporte';
    if (/centro comercial|mall|almacen|supermercado|exito|olimpica|mercado|plaza de mercado|comercial|tienda/.test(t)) return 'comercio';
    if (/hotel|hostal|hospedaje/.test(t)) return 'hotel';
    if (/restaurante|cafe|cafeter/.test(t)) return 'restaurante';
    return 'otro';
}
function clasificarEquipamiento(props) {
    // Solo se usa la columna "Nombre" de la tabla de atributos
    return clasificarTexto(normalizar(campo(props, ['Nombre'])));
}

/* ---------- Densidad poblacional ----------
   Lee el valor de densidad de un campo del GeoJSON (DENSIDAD, DENS, DENS_POB…;
   sirve cualquier campo numérico cuyo nombre contenga "dens").           */
const UNIDAD_DENSIDAD = 'hab/m²';

function valorDensidad(props) {
    const v = campo(props, ['DENSIDAD', 'DENS', 'DENS_POB', 'DENSIDAD_P', 'DENSIDAD_POB', 'HAB_KM2']);
    if (v !== undefined && !isNaN(Number(v))) return Number(v);
    const clave = Object.keys(props || {}).find(k => /dens/i.test(k) && !isNaN(Number(props[k])) && props[k] !== null && props[k] !== '');
    return clave ? Number(props[clave]) : null;
}

function clasificarDensidad(props) {
    const v = valorDensidad(props);
    if (v === null) return 'otro';
    if (v <= 0.007) return 'd1';
    if (v <= 0.024) return 'd2';
    if (v <= 0.047) return 'd3';
    if (v <= 0.104) return 'd4';
    return 'd5';
}

/* ---------- Definición de capas ----------
   archivo: nombre del GeoJSON dentro de data/
   z:       orden de dibujo (más alto = más arriba)
   peso:    peso AHP (Tabla 9 del informe)            */

const CAPAS = [

    // ---------------- ÁREA DE ESTUDIO ----------------
    {
        id: 'perimetro', grupo: 'area', nombre: 'Perímetro urbano',
        archivo: 'perimetro_urbano.geojson', z: 455, visible: true,
        estilo: () => ({ color: '#1d2b24', weight: 2.5, dashArray: '8 5', fill: false }),
        leyenda: [{ tipo: 'linea', color: '#1d2b24', etiqueta: 'Límite urbano' }]
    },

    // ---------------- CRITERIOS DE APTITUD ----------------
    {
        id: 'densidad', grupo: 'criterios', nombre: 'Densidad poblacional', peso: 0.4058,
        archivo: 'comunas.geojson', z: 415, visible: false,
        simbolo: 'relleno', clasificar: f => clasificarDensidad(f.properties),
        tooltip: f => {
            const v = valorDensidad(f.properties);
            return `${nombreComuna(f.properties)} · ${v === null ? 'sin dato' : `${num(v, 3)} ${UNIDAD_DENSIDAD}`}`;
        },
        buscable: { icono: 'fa-draw-polygon', sub: 'Comuna', texto: f => nombreComuna(f.properties) },
        categorias: {
            d1: { etiqueta: `0,001 – 0,007 ${UNIDAD_DENSIDAD}`, color: '#fdeee2' },
            d2: { etiqueta: `0,008 – 0,024 ${UNIDAD_DENSIDAD}`, color: '#f5c79a' },
            d3: { etiqueta: `0,025 – 0,047 ${UNIDAD_DENSIDAD}`, color: '#e8956a' },
            d4: { etiqueta: `0,048 – 0,104 ${UNIDAD_DENSIDAD}`, color: '#cc4b37' },
            d5: { etiqueta: `0,105 – 0,304 ${UNIDAD_DENSIDAD}`, color: '#7a1212' },
            otro: { etiqueta: 'Sin dato',                        color: '#cfd8dc' }
        },
        popup: f => {
            const v = valorDensidad(f.properties);
            return popupHTML(nombreComuna(f.properties), 'Densidad poblacional', [
                ['Densidad', v === null ? '—' : `${num(v, 3)} ${UNIDAD_DENSIDAD}`]
            ]);
        }
    },
    {
        id: 'uso_suelo', grupo: 'criterios', nombre: 'Uso del suelo', peso: 0.2564,
        archivo: 'uso_suelo.geojson', z: 420, visible: false,
        simbolo: 'relleno', clasificar: f => clasificarUsoSuelo(f.properties),
        leyendaPorCampo: ['Uso_su'],   // la leyenda muestra los valores de esta columna
        colorOtro: colorOtroUso,       // color propio para valores no reconocidos
        estilo: f => {
            const k = clasificarUsoSuelo(f.properties);
            const v = campo(f.properties, ['Uso_su']);
            const color = (k === 'otro' && v) ? colorOtroUso(v) : capaPorId('uso_suelo').categorias[k].color;
            return { color: '#ffffff', weight: 0.5, fillColor: color, fillOpacity: 0.7 };
        },
        categorias: {
            paisajistico: { etiqueta: 'Paisajístico',                   color: '#d4f08c' },
            central:      { etiqueta: 'Tejido central',                 color: '#a88437' },
            empresarial:  { etiqueta: 'Tejido empresarial y comercial', color: '#f2b33d' },
            industrial:   { etiqueta: 'Tejido industrial',              color: '#c63bf0' },
            residencial:  { etiqueta: 'Tejido residencial',             color: '#fff4c2' },
            uas:          { etiqueta: 'UAS',                            color: '#4f8fb5' },
            otro:         { etiqueta: 'Otros usos',                     color: '#cfd8dc' }
        }
    },
    {
        id: 'pendiente', grupo: 'criterios', nombre: 'Pendiente del terreno', peso: 0.0793,
        archivo: 'pendiente.geojson', z: 425, visible: false,
        simbolo: 'relleno', clasificar: f => clasificarPendiente(f.properties),
        categorias: CLASES_PENDIENTE,
        popup: f => {
            const k = clasificarPendiente(f.properties);
            const c = CLASES_PENDIENTE[k];
            const pct = campo(f.properties, ['PENDIENTE', 'SLOPE', 'PEND_PCT']);
            return popupHTML('Pendiente del terreno', k === 'otro' ? 'Sin clasificar' : `Clase ${k}`, [
                ['Pendiente', pct !== undefined && !isNaN(Number(pct)) ? `${num(Number(pct), 1)} %` : undefined],
                ['Rango', c.rango],
                ['Descripción', esc(c.descripcion)]
            ]);
        }
    },
    {
        id: 'equipamientos', grupo: 'criterios', nombre: 'Equipamientos', peso: 0.0817,
        archivo: 'equipamientos.geojson', z: 470, visible: false,
        simbolo: 'punto', clasificar: f => clasificarEquipamiento(f.properties),
        leyendaPorCampo: ['Nombre'],  // solo la columna "Nombre" de la tabla de atributos
        categorias: {
            parque:      { etiqueta: 'Parques',            color: '#d4a106', icono: 'fa-tree' },
            colegio:     { etiqueta: 'Colegios',           color: '#7b3fa0', icono: 'fa-school' },
            universidad: { etiqueta: 'Universidad',        color: '#1f5fa8', icono: 'fa-graduation-cap' },
            hospital:    { etiqueta: 'Hospitales',         color: '#d62728', icono: 'fa-hospital' },
            cultural:    { etiqueta: 'Centros culturales', color: '#c2185b', icono: 'fa-masks-theater' },
            museo:       { etiqueta: 'Museos',             color: '#e67e22', icono: 'fa-landmark-dome' },
            deporte:     { etiqueta: 'Centros de deporte', color: '#2e9e5b', icono: 'fa-futbol' },
            justicia:    { etiqueta: 'Palacio de justicia', color: '#455a9c', icono: 'fa-scale-balanced' },
            gobernacion: { etiqueta: 'Gobernación',        color: '#0b6e8a', icono: 'fa-building-flag' },
            entidad:     { etiqueta: 'Entidades públicas', color: '#5d4037', icono: 'fa-building-columns' },
            iglesia:     { etiqueta: 'Iglesias',           color: '#8e6bbf', icono: 'fa-church' },
            banco:       { etiqueta: 'Bancos',             color: '#00796b', icono: 'fa-money-bill-wave' },
            policia:     { etiqueta: 'Policía / Fuerza pública', color: '#1a237e', icono: 'fa-shield-halved' },
            emergencia:  { etiqueta: 'Emergencias',        color: '#bf360c', icono: 'fa-truck-medical' },
            transporte:  { etiqueta: 'Transporte',         color: '#37474f', icono: 'fa-bus' },
            comercio:    { etiqueta: 'Comercio',           color: '#ef6c00', icono: 'fa-bag-shopping' },
            hotel:       { etiqueta: 'Hoteles',            color: '#6a1b9a', icono: 'fa-hotel' },
            restaurante: { etiqueta: 'Restaurantes',       color: '#a1472b', icono: 'fa-utensils' },
            otro:        { etiqueta: 'Otros',              color: '#7f8c8d', icono: 'fa-building' }
        },
        buscable: {
            icono: 'fa-building', sub: 'Equipamiento',
            texto: f => campo(f.properties, ['NOMBRE', 'name', 'Name'])
        }
    },
    {
        id: 'jerarquia_vial', grupo: 'criterios', nombre: 'Jerarquía vial', peso: 0.1768,
        archivo: 'jerarquia_vial.geojson', z: 450, visible: false,
        simbolo: 'linea', clasificar: f => clasificarVia(f.properties),
        categorias: {
            primaria:   { etiqueta: 'Vía primaria',   color: '#c0392b', grosor: 4 },
            secundaria: { etiqueta: 'Vía secundaria', color: '#e67e22', grosor: 3 },
            terciaria:  { etiqueta: 'Vía terciaria',  color: '#f1c40f', grosor: 2 },
            otro:       { etiqueta: 'Otras vías',     color: '#95a5a6', grosor: 1 }
        }
    },

    // ---------------- RESTRICCIONES ----------------
    {
        id: 'proteccion', grupo: 'restricciones', nombre: 'Áreas de protección ambiental',
        archivo: 'areas_proteccion.geojson', z: 430, visible: false,
        estilo: () => ({ color: '#1b5e20', weight: 1.5, dashArray: '4 3', fillColor: '#2e7d32', fillOpacity: 0.35 }),
        leyenda: [{ tipo: 'relleno', color: 'rgba(46,125,50,.45)', borde: '#1b5e20', etiqueta: 'Suelo de protección / SINAP' }]
    },
    {
        id: 'rondas', grupo: 'restricciones', nombre: 'Rondas hídricas',
        archivo: 'rondas_hidricas.geojson', z: 432, visible: false,
        estilo: () => ({ color: '#64b5f6', weight: 0.8, fillColor: '#90caf9', fillOpacity: 0.45 }),
        leyenda: [{ tipo: 'relleno', color: '#90caf9', borde: '#64b5f6', etiqueta: 'Ronda hídrica' }]
    },
    {
        id: 'hidrografia', grupo: 'restricciones', nombre: 'Cauces (hidrografía)',
        archivo: 'hidrografia.geojson', z: 445, visible: false,
        estilo: () => ({ color: '#1e88e5', weight: 2, fillColor: '#1e88e5', fillOpacity: 0.4 }),
        leyenda: [{ tipo: 'linea', color: '#1e88e5', etiqueta: 'Cauce / drenaje' }]
    },

    // ---------------- FASE 4 · RESULTADOS ----------------
    {
        id: 'aptitud', grupo: 'resultados', nombre: 'Aptitud territorial (WLC)',
        archivo: 'aptitud.geojson', z: 410, visible: true,
        simbolo: 'relleno', clasificar: f => clase123(f.properties, ['APTITUD']),
        categorias: {
            c1: { etiqueta: 'Aptitud baja',  color: '#d73027' },
            c2: { etiqueta: 'Aptitud media', color: '#fee08b' },
            c3: { etiqueta: 'Aptitud alta',  color: '#1a9850' },
            otro: { etiqueta: 'Sin clasificar', color: '#cfd8dc' }
        }
    },
    {
        id: 'buffer_1000', grupo: 'resultados', nombre: 'Área de influencia 1 km',
        derivada: true, z: 435, visible: false,
        estilo: () => ({ color: '#13693b', weight: 1.5, dashArray: '6 4', fillColor: '#2e9e5b', fillOpacity: 0.07 }),
        popup: f => popupBuffer(f),
        leyenda: [{ tipo: 'relleno', color: 'rgba(46,158,91,.15)', borde: '#13693b', etiqueta: 'Radio 1 km' }]
    },
    {
        id: 'buffer_500', grupo: 'resultados', nombre: 'Área de influencia 500 m',
        derivada: true, z: 436, visible: true,
        estilo: () => ({ color: '#b98900', weight: 1.5, dashArray: '4 4', fillColor: '#f2b705', fillOpacity: 0.15 }),
        popup: f => popupBuffer(f),
        leyenda: [{ tipo: 'relleno', color: 'rgba(242,183,5,.3)', borde: '#b98900', etiqueta: 'Radio 500 m' }]
    },
    {
        id: 'corredor', grupo: 'resultados', nombre: 'Corredor potencial',
        archivo: 'corredor.geojson', z: 460, visible: true,
        crear: crearCorredor,
        leyenda: [
            { tipo: 'linea', color: '#0b4d2c', etiqueta: 'Corredor de menor costo', grosor: 6 },
            { tipo: 'tren', etiqueta: 'Tranvía en recorrido' }
        ]
    },
    {
        id: 'estaciones', grupo: 'resultados', nombre: 'Estaciones propuestas',
        archivo: 'estaciones.geojson', z: 480, visible: true,
        crear: crearEstaciones,
        buscable: { icono: 'fa-train-tram', sub: 'Estación propuesta', texto: (f, i) => nombreEstacion(f, i) },
        leyenda: [{ tipo: 'estacion', etiqueta: 'Estación preliminar' }]
    }
];

const capaPorId = id => CAPAS.find(c => c.id === id);

/* ---------- Estilo para capas por categorías ---------- */
function estiloCategorico(capa) {
    return f => {
        const c = capa.categorias[capa.clasificar(f)] || capa.categorias.otro;
        if (capa.simbolo === 'linea') return { color: c.color, weight: c.grosor || 2, opacity: 0.95 };
        if (capa.simbolo === 'punto') return { radius: 6, color: '#fff', weight: 1.5, fillColor: c.color, fillOpacity: 0.95 };
        return { color: '#ffffff', weight: 0.5, fillColor: c.color, fillOpacity: 0.7 };
    };
}

CAPAS.forEach(capa => {
    if (capa.categorias && !capa.estilo) capa.estilo = estiloCategorico(capa);
    // Cada capa tiene su propio "pane": así se controla el orden y la opacidad
    capa.pane = 'pane_' + capa.id;
    map.createPane(capa.pane).style.zIndex = capa.z;
});

/* ---------- Carga de archivos (con caché: un archivo se lee una sola vez) ---------- */
const cacheArchivos = {};

function obtenerJSON(archivo) {
    if (!cacheArchivos[archivo]) {
        cacheArchivos[archivo] = fetch(CONFIG.rutaDatos + archivo).then(r => {
            if (!r.ok) throw new Error(`No se encontró data/${archivo}`);
            return r.json();
        });
    }
    return cacheArchivos[archivo];
}

/* ---------- Creación genérica de una capa GeoJSON ---------- */
function crearCapaGeoJSON(capa, datos) {
    let indice = 0;
    return L.geoJSON(datos, {
        pane: capa.pane,
        style: f => capa.estilo ? capa.estilo(f) : {},
        pointToLayer: (f, latlng) => {
            // Si la categoría tiene ícono (equipamientos), se dibuja un marcador con ícono
            const cat = capa.categorias ? (capa.categorias[capa.clasificar(f)] || capa.categorias.otro) : null;
            if (cat && cat.icono) {
                return L.marker(latlng, {
                    pane: capa.pane,
                    icon: L.divIcon({
                        className: '',
                        html: `<div class="icono-equipamiento" style="background:${cat.color}">
                                   <i class="fa-solid ${cat.icono}"></i></div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12],
                        popupAnchor: [0, -12]
                    })
                });
            }
            return L.circleMarker(latlng, { pane: capa.pane, ...(capa.estilo ? capa.estilo(f) : {}) });
        },
        onEachFeature: (f, layer) => {
            layer.bindPopup(() => (capa.popup ? capa.popup(f) : popupGenerico(capa, f)), { maxWidth: 320 });
            if (capa.tooltip) layer.bindTooltip(esc(capa.tooltip(f)), { sticky: true });
            registrarBusqueda(capa, f, layer, indice++);
        }
    });
}

async function cargarCapa(capa) {
    try {
        const datos = await obtenerJSON(capa.archivo);
        capa.datos = datos;
        capa.layer = (capa.crear || crearCapaGeoJSON)(capa, datos);
        capa.bounds = L.geoJSON(datos).getBounds();
        marcarEstado(capa, 'ok');
    } catch (e) {
        marcarEstado(capa, 'faltante', location.protocol === 'file:'
            ? 'Abra el proyecto con Live Server (no con doble clic)'
            : e.message);
    }
}

/* ---------- Panel de capas agrupadas ---------- */
function construirPanelCapas() {
    const cont = document.getElementById('panelCapas');

    if (location.protocol === 'file:') {
        cont.insertAdjacentHTML('beforeend', `
            <div class="alert alert-warning small">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Está abriendo el archivo directamente. Para cargar los GeoJSON abra
                <b>index.html</b> con <b>Live Server</b> en VS Code.
            </div>`);
    }

    Object.entries(GRUPOS).forEach(([idGrupo, g]) => {
        const capas = CAPAS.filter(c => c.grupo === idGrupo);
        const grupo = document.createElement('div');
        grupo.className = 'grupo';
        grupo.innerHTML = `
            <button class="grupo-titulo" type="button">
                <i class="fa-solid ${g.icono}"></i>${g.nombre}
                <i class="fa-solid fa-chevron-down flecha"></i>
            </button>
            <div class="grupo-contenido">
                ${capas.map(c => `
                    <div class="capa">
                        <div class="capa-fila">
                            <input type="checkbox" id="chk_${c.id}" disabled>
                            <label for="chk_${c.id}">${c.nombre}</label>
                            ${c.peso ? `<span class="peso" title="Peso AHP">${num(c.peso * 100, 1)} %</span>` : ''}
                            <span class="estado" id="est_${c.id}">cargando…</span>
                            <button class="btn-zoom" id="zoom_${c.id}" title="Acercar a la capa">
                                <i class="fa-solid fa-magnifying-glass-plus"></i>
                            </button>
                        </div>
                        <div class="opacidad">
                            <i class="fa-solid fa-droplet" style="font-size:.7rem;color:#9aa"></i>
                            <input type="range" min="0" max="100" value="100" id="op_${c.id}">
                            <span id="opv_${c.id}">100 %</span>
                        </div>
                    </div>`).join('')}
            </div>`;
        cont.appendChild(grupo);

        // Plegar / desplegar grupo
        const titulo = grupo.querySelector('.grupo-titulo');
        titulo.addEventListener('click', () => {
            titulo.classList.toggle('colapsado');
            grupo.querySelector('.grupo-contenido').classList.toggle('oculto');
        });
    });

    // Eventos de cada capa
    CAPAS.forEach(c => {
        document.getElementById('chk_' + c.id).addEventListener('change', e => {
            mostrarCapa(c, e.target.checked);
        });
        document.getElementById('op_' + c.id).addEventListener('input', e => {
            map.getPane(c.pane).style.opacity = e.target.value / 100;
            document.getElementById('opv_' + c.id).textContent = e.target.value + ' %';
        });
        document.getElementById('zoom_' + c.id).addEventListener('click', () => {
            if (c.bounds && c.bounds.isValid()) {
                mostrarCapa(c, true);
                map.fitBounds(c.bounds, { padding: [30, 30] });
            }
        });
    });
}

function marcarEstado(capa, estado, mensaje) {
    const chk = document.getElementById('chk_' + capa.id);
    const badge = document.getElementById('est_' + capa.id);
    if (estado === 'ok') {
        if (badge) badge.remove();
        chk.disabled = false;
        mostrarCapa(capa, capa.visible);
    } else {
        badge.textContent = 'sin datos';
        badge.classList.add('error');
        badge.title = mensaje || '';
    }
}

function mostrarCapa(capa, visible) {
    if (!capa.layer) return;
    document.getElementById('chk_' + capa.id).checked = visible;
    if (visible) map.addLayer(capa.layer);
    else map.removeLayer(capa.layer);
    actualizarLeyenda();
}

/* ---------- Leyenda dinámica ----------
   Muestra solo las capas encendidas y, en las capas por
   categorías, solo las clases presentes en los datos.      */
function simboloHTML(item) {
    if (item.tipo === 'linea') {
        return `<span class="simbolo linea" style="border-top-color:${item.color};border-top-width:${item.grosor || 3}px"></span>`;
    }
    if (item.tipo === 'punto') {
        if (item.icono) {
            return `<span class="icono-equipamiento" style="background:${item.color}">
                        <i class="fa-solid ${item.icono}"></i></span>`;
        }
        return `<span class="simbolo punto" style="background:${item.color}"></span>`;
    }
    if (item.tipo === 'tren') {
        return `<img src="img/tren.png" alt="" style="width:26px;height:26px;flex-shrink:0">`;
    }
    if (item.tipo === 'estacion') {
        return `<span class="icono-estacion" style="width:20px;height:20px;font-size:9px;animation:none;margin:0 1px">
                    <i class="fa-solid fa-train-tram"></i></span>`;
    }
    return `<span class="simbolo" style="background:${item.color};border-color:${item.borde || 'rgba(0,0,0,.25)'}"></span>`;
}

function itemsLeyenda(capa) {
    if (!capa.categorias) return capa.leyenda || [];
    const conteo = {};
    (capa.datos?.features || []).forEach(f => {
        const k = capa.clasificar(f);
        conteo[k] = (conteo[k] || 0) + 1;
    });
    const tipo = capa.simbolo === 'linea' ? 'linea' : capa.simbolo === 'punto' ? 'punto' : 'relleno';

    // Leyenda con los valores de un campo (equipamientos: columna "Nombre")
    if (capa.leyendaPorCampo) {
        const campos = [].concat(capa.leyendaPorCampo);
        const vistos = new Map();
        (capa.datos?.features || []).forEach(f => {
            const v = campo(f.properties, campos);
            const k = capa.clasificar(f);
            const c = capa.categorias[k] || capa.categorias.otro;
            // Si el elemento no trae nombre, se usa el nombre de su categoría
            const txt = v ? String(v).trim() : '';
            const etiqueta = txt || (k !== 'otro' ? c.etiqueta : 'Sin nombre');
            const clave = normalizar(etiqueta);
            if (!vistos.has(clave)) vistos.set(clave, { tipo, color: (k === 'otro' && txt && capa.colorOtro) ? capa.colorOtro(txt) : c.color, icono: c.icono, etiqueta });
        });
        console.info('[Leyenda ' + capa.nombre + '] campos buscados:', campos,
            '| campos reales del GeoJSON:', Object.keys(capa.datos?.features?.[0]?.properties || {}),
            '| entradas:', vistos.size);
        return [...vistos.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
    }

    return Object.entries(capa.categorias)
        .filter(([k]) => conteo[k])
        .map(([k, c]) => ({ tipo, color: c.color, grosor: c.grosor, icono: c.icono, etiqueta: c.etiqueta }));
}

function actualizarLeyenda() {
    const cont = document.getElementById('panelLeyenda');
    const visibles = CAPAS.filter(c => c.layer && map.hasLayer(c.layer)).sort((a, b) => b.z - a.z);
    if (!visibles.length) {
        cont.innerHTML = '<div class="leyenda-vacia"><i class="fa-regular fa-eye-slash fa-2x mb-2"></i><br>No hay capas encendidas</div>';
        return;
    }
    cont.innerHTML = visibles.map(c => `
        <div class="leyenda-bloque">
            <h6>${c.nombre}${c.peso ? ` <span class="peso">w = ${num(c.peso, 4)}</span>` : ''}</h6>
            ${itemsLeyenda(c).map(i => `<div class="leyenda-item">${simboloHTML(i)}${esc(i.etiqueta)}</div>`).join('')}
        </div>`).join('');
}


/* ============================================================
   FASE 3 · HERRAMIENTAS
   ============================================================ */

/* ---------- Escala ---------- */
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

/* ---------- Coordenadas (WGS84 y MAGNA-SIRGAS Origen Nacional) ---------- */
map.on('mousemove', e => {
    const { lat, lng } = e.latlng;
    document.getElementById('coordGeo').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    const [este, norte] = proj4('EPSG:4326', 'EPSG:9377', [lng, lat]);
    document.getElementById('coordPlanas').textContent = `E ${num(este, 1)} m · N ${num(norte, 1)} m`;
});

const actualizarZoom = () => document.getElementById('nivelZoom').textContent = map.getZoom();
map.on('zoomend', actualizarZoom);
actualizarZoom();

/* ---------- Barra de herramientas sobre el mapa ---------- */
const Herramientas = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
        const div = L.DomUtil.create('div', 'herramientas leaflet-bar');
        div.innerHTML = `
            <button id="hInicio"   title="Vista general"><i class="fa-solid fa-expand"></i></button>
            <button id="hUbicar"   title="Mi ubicación"><i class="fa-solid fa-location-crosshairs"></i></button>
            <button id="hDistancia" title="Medir distancia"><i class="fa-solid fa-ruler"></i></button>
            <button id="hArea"     title="Medir área"><i class="fa-solid fa-draw-polygon"></i></button>
            <button id="hStreet"   title="Street View: clic en el mapa"><i class="fa-solid fa-street-view"></i></button>
            <button id="hBorrar"   title="Borrar mediciones"><i class="fa-solid fa-eraser"></i></button>
            <button id="hPantalla" title="Pantalla completa"><i class="fa-solid fa-maximize"></i></button>
            <button id="hTren"     title="Mover el tren"><i class="fa-solid fa-play"></i></button>`;
        L.DomEvent.disableClickPropagation(div);
        return div;
    }
});
map.addControl(new Herramientas());

/* ---------- Mover / detener el tren ----------
   El tren arranca quieto en el extremo sur; solo se mueve con este botón. */
let trenActivo = false;
document.getElementById('hTren').addEventListener('click', () => {
    trenActivo = !trenActivo;
    const b = document.getElementById('hTren');
    b.classList.toggle('activo', trenActivo);
    b.title = trenActivo ? 'Detener el tren' : 'Mover el tren';
    b.querySelector('i').className = trenActivo ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    if (trenActivo) mostrarCapa(capaPorId('corredor'), true);
});

/* ---------- Vista general ---------- */
function vistaGeneral() {
    const per = capaPorId('perimetro');
    if (per.bounds && per.bounds.isValid()) map.fitBounds(per.bounds, { padding: [20, 20] });
    else map.setView(CONFIG.centro, CONFIG.zoom);
}
document.getElementById('hInicio').addEventListener('click', vistaGeneral);

/* ---------- Localización ---------- */
const capaUbicacion = L.layerGroup().addTo(map);

document.getElementById('hUbicar').addEventListener('click', () => {
    map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true });
});

map.on('locationfound', e => {
    capaUbicacion.clearLayers();
    L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }).addTo(capaUbicacion);
    L.marker(e.latlng, { icon: L.divIcon({ className: '', html: '<div class="icono-ubicacion"></div>', iconSize: [16, 16] }) })
        .bindPopup(`Usted está aquí<br><small>Precisión ± ${num(e.accuracy)} m</small>`)
        .addTo(capaUbicacion).openPopup();
});

map.on('locationerror', () => alert('No fue posible obtener su ubicación. Revise los permisos del navegador.'));

/* ---------- Pantalla completa ---------- */
document.getElementById('hPantalla').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
});

document.addEventListener('fullscreenchange', () => {
    document.querySelector('#hPantalla i').className =
        document.fullscreenElement ? 'fa-solid fa-minimize' : 'fa-solid fa-maximize';
    setTimeout(() => map.invalidateSize(), 200);
});

/* ---------- Medición de distancias y áreas ---------- */
map.createPane('paneMedicion').style.zIndex = 590;

const medicion = {
    modo: null,                       // 'distancia' | 'area' | null
    puntos: [],
    capa: L.layerGroup().addTo(map),
    temporal: null
};

const formatoDistancia = m => m < 1000 ? `${num(m, 1)} m` : `${num(m / 1000, 2)} km`;
const formatoArea = m2 => m2 < 10000 ? `${num(m2, 0)} m²`
    : m2 < 1e6 ? `${num(m2 / 10000, 2)} ha` : `${num(m2 / 1e6, 3)} km²`;

function longitud(puntos) {
    let total = 0;
    for (let i = 1; i < puntos.length; i++) total += map.distance(puntos[i - 1], puntos[i]);
    return total;
}

function area(puntos) {
    if (puntos.length < 3) return 0;
    const anillo = puntos.map(p => [p.lng, p.lat]);
    anillo.push(anillo[0]);
    return turf.area(turf.polygon([anillo]));
}

function avisar(texto) {
    const aviso = document.getElementById('avisoMedicion');
    aviso.textContent = texto || '';
    aviso.classList.toggle('visible', !!texto);
}

function iniciarMedicion(modo) {
    const repetido = medicion.modo === modo;
    terminarMedicion();
    modoStreet(false);
    if (repetido) return;
    medicion.modo = modo;
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('midiendo');
    document.getElementById(modo === 'distancia' ? 'hDistancia' : 'hArea').classList.add('activo');
    avisar('Haga clic para agregar vértices · doble clic para terminar · Esc para cancelar');
}

function dibujarTemporal(cursor) {
    if (medicion.temporal) medicion.capa.removeLayer(medicion.temporal);
    const pts = cursor ? [...medicion.puntos, cursor] : medicion.puntos;
    if (pts.length < 2) return;
    const opciones = { pane: 'paneMedicion', color: '#0b4d2c', weight: 3, dashArray: '6 6', interactive: false };
    medicion.temporal = medicion.modo === 'area'
        ? L.polygon(pts, { ...opciones, fillColor: '#f2b705', fillOpacity: 0.2 })
        : L.polyline(pts, opciones);
    medicion.capa.addLayer(medicion.temporal);
    const valor = medicion.modo === 'area' ? formatoArea(area(pts)) : formatoDistancia(longitud(pts));
    avisar(`${medicion.modo === 'area' ? 'Área' : 'Distancia'}: ${valor} · doble clic para terminar`);
}

function cerrarFigura() {
    const pts = medicion.puntos;
    const minimo = medicion.modo === 'area' ? 3 : 2;
    if (pts.length >= minimo) {
        const opciones = { pane: 'paneMedicion', color: '#0b4d2c', weight: 3, interactive: false };
        const figura = medicion.modo === 'area'
            ? L.polygon(pts, { ...opciones, fillColor: '#f2b705', fillOpacity: 0.25 })
            : L.polyline(pts, opciones);
        const texto = medicion.modo === 'area'
            ? `${formatoArea(area(pts))} · perímetro ${formatoDistancia(longitud([...pts, pts[0]]))}`
            : formatoDistancia(longitud(pts));
        figura.addTo(medicion.capa).bindTooltip(texto, {
            permanent: true, direction: 'center', className: 'etiqueta-medida'
        });
    }
    if (medicion.temporal) medicion.capa.removeLayer(medicion.temporal);
    medicion.temporal = null;
    medicion.puntos = [];
}

function terminarMedicion() {
    if (medicion.modo) cerrarFigura();
    medicion.modo = null;
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove('midiendo');
    document.querySelectorAll('#hDistancia, #hArea').forEach(b => b.classList.remove('activo'));
    avisar('');
}

map.on('click', e => {
    if (!medicion.modo) return;
    const ultimo = medicion.puntos[medicion.puntos.length - 1];
    // Evita el punto duplicado que produce el doble clic
    if (ultimo && map.latLngToContainerPoint(ultimo).distanceTo(e.containerPoint) < 4) return;
    medicion.puntos.push(e.latlng);
    dibujarTemporal();
});

map.on('mousemove', e => { if (medicion.modo && medicion.puntos.length) dibujarTemporal(e.latlng); });
map.on('dblclick', () => { if (medicion.modo) terminarMedicion(); });
map.on('contextmenu', () => { if (medicion.modo) terminarMedicion(); });

document.getElementById('hDistancia').addEventListener('click', () => iniciarMedicion('distancia'));
document.getElementById('hArea').addEventListener('click', () => iniciarMedicion('area'));
document.getElementById('hBorrar').addEventListener('click', () => {
    terminarMedicion();
    medicion.capa.clearLayers();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (medicion.modo) { medicion.puntos = []; terminarMedicion(); }
        if (street.modoClic) modoStreet(false);
        ocultarResultados();
    }
});

/* ---------- Street View (Google) ----------
   - Botón de la barra: clic en cualquier punto del mapa.
   - Si el clic cae a menos de 150 m del corredor, se "pega" a la línea
     y se puede recorrer el corredor de 100 en 100 m.
   - También se abre desde la ventana de cada estación y del corredor. */
const PASO_STREET_KM = 0.1;          // salto de los botones ◀ ▶ (0.1 = 100 m)
const PASO_AUTO_KM = 0.03;           // salto del recorrido automático (0.03 = 30 m): más chico = más suave
const DIST_PEGAR_KM = 0.15;          // a menos de esto, el clic se pega al corredor

let lineaCorredor = null, largoCorredor = 0;
const street = { modoClic: false, distancia: null, sentido: 1, marcador: null };

map.createPane('paneStreet').style.zIndex = 495;

function urlStreetEmbed(lat, lng, rumbo) {
    if (CONFIG.claveGoogle) {
        return `https://www.google.com/maps/embed/v1/streetview?key=${CONFIG.claveGoogle}` +
            `&location=${lat},${lng}&heading=${rumbo.toFixed(0)}&pitch=0&fov=90`;
    }
    return `https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}` +
        `&cbp=11,${rumbo.toFixed(0)},0,0,0&source=embed&output=svembed`;
}

const urlStreetGoogleMaps = (lat, lng, rumbo) =>
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=${rumbo.toFixed(0)}`;

// Rumbo (0–360°, desde el norte) del corredor en una abscisa, mirando de sur a norte
function rumboCorredor(d) {
    const a = turf.along(lineaCorredor, Math.max(d - 0.02, 0));
    const b = turf.along(lineaCorredor, Math.min(d + 0.02, largoCorredor));
    return (turf.bearing(a, b) + 360) % 360;
}

function marcadorStreet(lat, lng, rumbo) {
    if (!street.marcador) {
        street.marcador = L.marker([lat, lng], {
            pane: 'paneStreet', interactive: false,
            icon: L.divIcon({
                className: '',
                html: '<div class="icono-street"><div class="cono"></div><i class="fa-solid fa-person-walking"></i></div>',
                iconSize: [56, 56], iconAnchor: [28, 28]
            })
        }).addTo(map);
    }
    street.marcador.setLatLng([lat, lng]);
    const cono = street.marcador.getElement()?.querySelector('.cono');
    if (cono) cono.style.transform = `rotate(${rumbo}deg)`;
}

// Carga la imagen en el visor escondido y, cuando está lista, la muestra con un fundido.
// Así no se ve el pantallazo en blanco entre un punto y otro.
let cargaStreet = 0;
function cargarEnVisor(url) {
    const marcos = [...document.querySelectorAll('.street-marco')];
    const visible = marcos.find(m => m.classList.contains('activo'));
    const panelAbierto = document.getElementById('panelStreet').classList.contains('visible');
    if (!panelAbierto || !visible.src || visible.src === 'about:blank') {   // primera vez: directo
        visible.src = url;
        return;
    }
    const escondido = marcos.find(m => m !== visible);
    const turno = ++cargaStreet;
    escondido.onload = () => {
        if (turno !== cargaStreet) return;        // ya se pidió otro punto
        // pequeña espera para que Google termine de pintar la panorámica
        setTimeout(() => {
            if (turno !== cargaStreet) return;
            escondido.classList.add('activo');
            visible.classList.remove('activo');
        }, 500);
    };
    escondido.src = url;
}

// Abre el visor en un punto. distancia = abscisa en el corredor (o null si es un punto suelto)
function abrirStreetView(lat, lng, rumbo = 0, distancia = null) {
    street.distancia = distancia;
    if (distancia === null) pausarAutoStreet();   // punto suelto: no hay ruta que seguir
    cargarEnVisor(urlStreetEmbed(lat, lng, rumbo));
    document.getElementById('streetEnlace').href = urlStreetGoogleMaps(lat, lng, rumbo);
    document.getElementById('streetInfo').textContent = distancia !== null
        ? `Corredor · K${num(distancia, 2)} de K${num(largoCorredor, 2)} · rumbo ${rumbo.toFixed(0)}°`
        : `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    document.getElementById('streetNav').style.display = distancia !== null ? '' : 'none';
    document.getElementById('panelStreet').classList.add('visible');
    marcadorStreet(lat, lng, rumbo);
    map.closePopup();
    if (!map.getBounds().pad(-0.1).contains([lat, lng])) map.panTo([lat, lng]);
}

// Abre el visor sobre el corredor en la abscisa d (km)
function streetEnCorredor(d) {
    if (!lineaCorredor) return;
    d = Math.min(Math.max(d, 0), largoCorredor);
    const [lng, lat] = turf.along(lineaCorredor, d).geometry.coordinates;
    const rumbo = (rumboCorredor(d) + (street.sentido < 0 ? 180 : 0)) % 360;
    abrirStreetView(lat, lng, rumbo, d);
}

// Desde la ventana de una estación o del corredor
function streetEnPunto(lat, lng) {
    if (lineaCorredor) {
        const p = turf.nearestPointOnLine(lineaCorredor, turf.point([lng, lat]));
        if (p.properties.dist <= DIST_PEGAR_KM) return streetEnCorredor(p.properties.location);
    }
    abrirStreetView(lat, lng, 0, null);
}

// Desde la ventana del corredor: arranca en el extremo sur y avanza solo
function recorrerCorredorStreet() {
    street.sentido = 1;
    streetEnCorredor(0);
    reproducirAutoStreet();
}

function modoStreet(activo) {
    street.modoClic = activo;
    if (activo) terminarMedicion();
    document.getElementById('hStreet').classList.toggle('activo', activo);
    map.getContainer().classList.toggle('midiendo', activo || !!medicion.modo);
    if (activo) avisar('Haga clic en el mapa donde quiere ver Street View · Esc para cancelar');
    else if (!medicion.modo) avisar('');
}

document.getElementById('hStreet').addEventListener('click', () => modoStreet(!street.modoClic));

map.on('click', e => {
    if (!street.modoClic) return;
    modoStreet(false);
    streetEnPunto(e.latlng.lat, e.latlng.lng);
});

document.getElementById('streetAtras').addEventListener('click', () =>
    streetEnCorredor(street.distancia - PASO_STREET_KM * street.sentido));
document.getElementById('streetAdelante').addEventListener('click', () =>
    streetEnCorredor(street.distancia + PASO_STREET_KM * street.sentido));
document.getElementById('streetGirar').addEventListener('click', () => {
    street.sentido *= -1;
    streetEnCorredor(street.distancia);
});

/* ---------- Recorrido automático ----------
   Avanza 100 m cada pocos segundos (selector 3 / 5 / 8 s) y se detiene
   al llegar al final del corredor. El tiempo da espacio a que Google
   cargue cada imagen.                                                   */
let temporizadorStreet = null;

function pausarAutoStreet() {
    clearInterval(temporizadorStreet);
    temporizadorStreet = null;
    const b = document.getElementById('streetPlay');
    b.classList.remove('activo');
    b.innerHTML = '<i class="fa-solid fa-play"></i> <span>Reproducir</span>';
}

function reproducirAutoStreet() {
    if (street.distancia === null) return;
    // Si ya está en el final, vuelve a empezar desde el otro extremo
    const fin = street.sentido > 0 ? largoCorredor : 0;
    if (Math.abs(street.distancia - fin) < 0.005) streetEnCorredor(street.sentido > 0 ? 0 : largoCorredor);

    const segundos = Number(document.getElementById('streetVelocidad').value);
    const b = document.getElementById('streetPlay');
    b.classList.add('activo');
    b.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Pausar</span>';

    clearInterval(temporizadorStreet);
    temporizadorStreet = setInterval(() => {
        const siguiente = street.distancia + PASO_AUTO_KM * street.sentido;
        const llego = street.sentido > 0 ? siguiente >= largoCorredor : siguiente <= 0;
        streetEnCorredor(siguiente);
        if (llego) pausarAutoStreet();
    }, segundos * 1000);
}

document.getElementById('streetPlay').addEventListener('click', () =>
    temporizadorStreet ? pausarAutoStreet() : reproducirAutoStreet());

// Si cambia la velocidad mientras reproduce, se aplica de inmediato
document.getElementById('streetVelocidad').addEventListener('change', () => {
    if (temporizadorStreet) reproducirAutoStreet();
});

document.getElementById('streetAgrandar').addEventListener('click', () => {
    const p = document.getElementById('panelStreet');
    p.classList.toggle('grande');
    document.querySelector('#streetAgrandar i').className =
        p.classList.contains('grande') ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
});

document.getElementById('streetCerrar').addEventListener('click', () => {
    pausarAutoStreet();
    document.getElementById('panelStreet').classList.remove('visible', 'grande');
    cargaStreet++;
    document.querySelectorAll('.street-marco').forEach((m, i) => {
        m.onload = null;
        m.src = 'about:blank';
        m.classList.toggle('activo', i === 0);
    });
    if (street.marcador) { map.removeLayer(street.marcador); street.marcador = null; }
});

// Botón que se agrega al final de las ventanas emergentes
const botonStreet = (accion, texto) => `
    <div class="popup-acciones">
        <button class="btn-street" onclick="${accion}">
            <i class="fa-solid fa-street-view"></i> ${texto}
        </button>
    </div>`;

/* ---------- Buscador ----------
   1) Busca en los datos cargados (estaciones, comunas, equipamientos)
   2) Si no encuentra, busca direcciones en Armenia (Nominatim / OSM) */
const indiceBusqueda = [];
const capaBusqueda = L.layerGroup().addTo(map);
const txtBuscar = document.getElementById('txtBuscar');
const cajaResultados = document.getElementById('resultadosBusqueda');

function registrarBusqueda(capa, f, layer, i) {
    if (!capa.buscable) return;
    const texto = capa.buscable.texto(f, i);
    if (texto) indiceBusqueda.push({ texto: String(texto), sub: capa.buscable.sub, icono: capa.buscable.icono, capa, layer });
}

function ocultarResultados() { cajaResultados.classList.remove('visible'); }

function pintarResultados(items) {
    cajaResultados.innerHTML = items.map((r, i) => `
        <div class="resultado" data-i="${i}">
            <i class="fa-solid ${r.icono}"></i>
            <div>${esc(r.texto)}<small>${esc(r.sub)}</small></div>
        </div>`).join('');
    cajaResultados.classList.add('visible');
    cajaResultados.querySelectorAll('.resultado').forEach(el =>
        el.addEventListener('click', () => seleccionarResultado(items[el.dataset.i])));
}

function buscarLocal(q) {
    const t = normalizar(q);
    return indiceBusqueda.filter(r => normalizar(r.texto).includes(t)).slice(0, 8);
}

async function buscarDireccion(q) {
    const [o, s, e, n] = CONFIG.cajaArmenia;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=co` +
        `&viewbox=${o},${n},${e},${s}&bounded=1&q=${encodeURIComponent(q)}`;
    try {
        const r = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const datos = await r.json();
        return datos.map(d => ({
            texto: d.display_name.split(',').slice(0, 2).join(','),
            sub: 'Dirección / lugar (OpenStreetMap)',
            icono: 'fa-location-dot',
            latlng: L.latLng(+d.lat, +d.lon)
        }));
    } catch {
        return [];
    }
}

function seleccionarResultado(r) {
    if (r.direccion) return ejecutarDireccion(r.direccion);   // opción "buscar como dirección"
    if (!r.layer && !r.latlng) return;                        // mensaje "sin resultados"
    ocultarResultados();
    txtBuscar.value = r.texto;
    capaBusqueda.clearLayers();
    if (r.layer) {
        mostrarCapa(r.capa, true);
        if (r.layer.getBounds) map.fitBounds(r.layer.getBounds(), { padding: [40, 40], maxZoom: 17 });
        else map.setView(r.layer.getLatLng(), 17);
        setTimeout(() => r.layer.openPopup(), 400);
    } else {
        map.setView(r.latlng, 17);
        L.marker(r.latlng).addTo(capaBusqueda).bindPopup(esc(r.texto)).openPopup();
    }
}

let esperaBusqueda;
txtBuscar.addEventListener('input', () => {
    clearTimeout(esperaBusqueda);
    const q = txtBuscar.value.trim();
    if (q.length < 2) return ocultarResultados();
    esperaBusqueda = setTimeout(() => {
        const locales = buscarLocal(q);
        pintarResultados([...locales, {
            texto: `Buscar «${q}» como dirección`, sub: 'Presione Enter', icono: 'fa-magnifying-glass', direccion: q
        }]);
    }, 250);
});

async function ejecutarDireccion(q) {
    const res = await buscarDireccion(q);
    if (res.length) pintarResultados(res);
    else pintarResultados([{ texto: 'Sin resultados en Armenia', sub: 'Pruebe con otra dirección', icono: 'fa-circle-exclamation' }]);
}

txtBuscar.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = txtBuscar.value.trim();
    if (!q) return;
    const locales = buscarLocal(q);
    if (locales.length) seleccionarResultado(locales[0]);
    else ejecutarDireccion(q);
});

document.addEventListener('click', e => {
    if (!e.target.closest('.buscador')) ocultarResultados();
});


/* ============================================================
   FASE 4 · RESULTADOS
   ============================================================ */

// Las estaciones se llaman "Estación 1" … "Estación 10", numeradas de sur a norte
function nombreEstacion(f, i) {
    if (f.properties && f.properties._numero) return `Estación ${f.properties._numero}`;
    return campo(f.properties, ['NOMBRE', 'Nombre', 'name', 'ESTACION']) || `Estación ${i + 1}`;
}

// Numera las estaciones de sur a norte (de menor a mayor latitud)
function numerarEstaciones(datos) {
    const puntos = (datos.features || []).filter(f => f.geometry && f.geometry.type === 'Point');
    [...puntos]
        .sort((a, b) => a.geometry.coordinates[1] - b.geometry.coordinates[1])
        .forEach((f, k) => {
            f.properties = f.properties || {};
            f.properties._numero = k + 1;
        });
}

/* ---------- Corredor (línea con animación de flujo) ---------- */
function crearCorredor(capa, datos) {
    lineaCorredor = unirLineas(datos);
    if (lineaCorredor) largoCorredor = turf.length(lineaCorredor, { units: 'kilometers' });
    const base = L.geoJSON(datos, {
        pane: capa.pane,
        style: { color: '#0b4d2c', weight: 8, opacity: 0.9, lineCap: 'round' },
        onEachFeature: (f, layer) => layer.bindPopup(() => popupCorredor(), { maxWidth: 320 })
    });
    const flujo = L.geoJSON(datos, {
        pane: capa.pane,
        interactive: false,
        style: { color: '#f2b705', weight: 3, className: 'corredor-animado' }
    });
    const tren = crearTren(datos);
    return L.layerGroup(tren ? [base, flujo, tren] : [base, flujo]);
}

/* ---------- Tren animado que recorre el corredor ----------
   Sale del extremo sur, va al norte y regresa, parando en cada estación. */
map.createPane('paneTren').style.zIndex = 490;      // por encima del corredor y las estaciones

const SEGUNDOS_POR_KM = 6;                          // velocidad: súbalo para que vaya más lento
const PAUSA_ESTACION_MS = 1000;                     // tiempo detenido en cada estación (1000 = 1 s)
const DIST_MAX_ESTACION_KM = 0.15;                  // estación a menos de 150 m de la línea = parada

// Une las líneas del corredor en una sola, orientada de sur a norte (para Street View)
function unirLineas(datos) {
    let coords = [];
    turf.flattenEach(datos, f => {
        if (f.geometry && f.geometry.type === 'LineString') {
            coords = coords.concat(coords.length ? f.geometry.coordinates.slice(1) : f.geometry.coordinates);
        }
    });
    if (coords.length < 2) return null;
    if (coords[0][1] > coords[coords.length - 1][1]) coords.reverse();
    return turf.lineString(coords);
}

function crearTren(datos) {
    // Une las líneas del corredor en una sola
    let coords = [];
    turf.flattenEach(datos, f => {
        if (f.geometry && f.geometry.type === 'LineString') {
            coords = coords.concat(coords.length ? f.geometry.coordinates.slice(1) : f.geometry.coordinates);
        }
    });
    if (coords.length < 2) return null;

    // Arranca por el extremo sur (menor latitud) para ir de sur a norte
    if (coords[0][1] > coords[coords.length - 1][1]) coords.reverse();

    const linea = turf.lineString(coords);
    const largo = turf.length(linea, { units: 'kilometers' });
    const msPorKm = Math.max(SEGUNDOS_POR_KM * 1000, 15000 / largo);   // mínimo 15 s por recorrido

    const marcador = L.marker([coords[0][1], coords[0][0]], {
        pane: 'paneTren',
        interactive: false,
        icon: L.divIcon({
            className: '',
            html: '<img src="img/tren.png" class="icono-tren-img" alt="Tren">',
            iconSize: [44, 44],
            iconAnchor: [22, 22]
        })
    });

    // Itinerario: tramos de movimiento y pausas, de sur a norte y de regreso
    let itinerario = [], cicloMs = 1, conParadas = false;

    function armarItinerario() {
        const est = capaPorId('estaciones');
        const paradas = [];
        if (est && est.datos) {
            conParadas = true;
            est.datos.features.forEach(f => {
                if (!f.geometry || f.geometry.type !== 'Point') return;
                const p = turf.nearestPointOnLine(linea, f, { units: 'kilometers' });
                if (p.properties.dist <= DIST_MAX_ESTACION_KM) paradas.push(p.properties.location);
            });
        }
        // Puntos de parada en orden: extremo sur, estaciones, extremo norte
        const puntos = [0, ...paradas.filter(d => d > 0.01 && d < largo - 0.01).sort((a, b) => a - b), largo];
        const ida = [];
        for (let k = 0; k < puntos.length; k++) {
            ida.push({ desde: puntos[k], hasta: puntos[k], ms: PAUSA_ESTACION_MS });           // pausa
            if (k < puntos.length - 1) {
                ida.push({ desde: puntos[k], hasta: puntos[k + 1], ms: (puntos[k + 1] - puntos[k]) * msPorKm });
            }
        }
        // El regreso es la ida al revés
        const vuelta = [...ida].reverse().map(t => ({ desde: t.hasta, hasta: t.desde, ms: t.ms }));
        itinerario = [];
        let t = 0;
        // Se quita la primera pausa de cada sentido para que en los extremos no pare dos veces
        [...ida.slice(1), ...vuelta.slice(1)].forEach(tr => { itinerario.push({ ...tr, t0: t }); t += tr.ms; });
        cicloMs = t;
    }
    armarItinerario();

    function distanciaEn(ms) {
        const tc = ms % cicloMs;
        const tr = itinerario.find(x => tc < x.t0 + x.ms) || itinerario[itinerario.length - 1];
        const f = tr.ms ? (tc - tr.t0) / tr.ms : 1;
        return tr.desde + (tr.hasta - tr.desde) * Math.min(Math.max(f, 0), 1);
    }

    let inicio = null, recorrido = 0, estabaActivo = false;
    function paso(t) {
        if (!conParadas && capaPorId('estaciones').datos) {   // las estaciones cargan después
            armarItinerario();
            inicio = null;
            recorrido = 0;
        }
        // Solo se mueve si el botón del tren está activo y el corredor encendido;
        // al detenerlo queda quieto donde estaba y al reanudar sigue desde ahí
        const mover = trenActivo && map.hasLayer(marcador);
        if (mover) {
            if (inicio === null || !estabaActivo) inicio = t - recorrido;
            recorrido = t - inicio;
            const p = turf.along(linea, distanciaEn(recorrido), { units: 'kilometers' });
            const [lng, lat] = p.geometry.coordinates;
            marcador.setLatLng([lat, lng]);
        }
        estabaActivo = mover;
        requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
    return marcador;
}

/* ---------- Estaciones (marcador con pulso) ---------- */
function crearEstaciones(capa, datos) {
    numerarEstaciones(datos);
    let i = 0;
    return L.geoJSON(datos, {
        pointToLayer: (f, latlng) => L.marker(latlng, {
            pane: capa.pane,
            icon: L.divIcon({
                className: '',
                html: '<div class="icono-estacion"><i class="fa-solid fa-train-tram"></i></div>',
                iconSize: [26, 26],
                iconAnchor: [13, 13],
                popupAnchor: [0, -14]
            })
        }),
        onEachFeature: (f, layer) => {
            f.properties = f.properties || {};
            const idx = i++;
            f.properties._indice = idx;
            layer.bindPopup(() => popupEstacion(f), { maxWidth: 320 });
            layer.bindTooltip(esc(nombreEstacion(f, idx)), { direction: 'top', offset: [0, -14] });
            registrarBusqueda(capa, f, layer, idx);
        }
    });
}

/* ---------- Análisis de estaciones ----------
   - Buffers de 500 m y 1 km (Turf)
   - Población por ponderación areal: Σ área(buffer ∩ comuna) × densidad
   - Equipamientos dentro de cada buffer
   - Distancia entre estaciones a lo largo del corredor        */

/* Densidad (hab/m²) de un polígono de comunas.geojson:
   1) el campo de densidad del propio GeoJSON (el mismo de la capa de densidad)
   2) si no lo tiene, la Tabla 1 del informe por nombre de comuna (hab/km² → hab/m²) */
function densidadM2(props) {
    const v = valorDensidad(props);
    if (v !== null && v > 0) return v;
    const d = datosComuna(props);
    return d ? d.dens / 1e6 : null;
}

function poblacionEn(poligono, comunasFC) {
    if (!comunasFC) return null;
    let total = 0, alguna = false;
    comunasFC.features.forEach(c => {
        const dens = densidadM2(c.properties);
        if (dens === null || !c.geometry) return;
        try {
            const inter = turf.intersect(poligono, c);
            if (inter) { total += turf.area(inter) * dens; alguna = true; }
        } catch (e) { /* geometría inválida: se omite */ }
    });
    if (!alguna) console.warn('[Población] Ningún polígono de comunas.geojson tiene densidad ni nombre de comuna reconocible.',
        'Campos:', Object.keys(comunasFC.features?.[0]?.properties || {}));
    return alguna ? Math.round(total) : null;
}

async function procesarResultados() {
    const est = capaPorId('estaciones');
    const b500 = capaPorId('buffer_500');
    const b1000 = capaPorId('buffer_1000');

    if (!est.datos) {
        marcarEstado(b500, 'faltante', 'Requiere data/estaciones.geojson');
        marcarEstado(b1000, 'faltante', 'Requiere data/estaciones.geojson');
        return;
    }

    // La población se estima con las comunas (Tabla 1 del informe) de data/comunas.geojson
    let comunasFC = null;
    try { comunasFC = await obtenerJSON('comunas.geojson'); } catch { /* sin comunas: población "—" */ }
    const equipFC = capaPorId('equipamientos').datos;
    const corredorFC = capaPorId('corredor').datos;

    const puntosEquip = equipFC ? turf.featureCollection(equipFC.features
        .filter(f => f.geometry)
        .map(f => f.geometry.type === 'Point' ? f : turf.centroid(f))) : null;

    const fc500 = [], fc1000 = [];
    const estaciones = est.datos.features.filter(f => f.geometry && f.geometry.type === 'Point');

    estaciones.forEach((f, i) => {
        const nombre = nombreEstacion(f, f.properties._indice ?? i);
        const r500 = turf.buffer(f, 0.5, { units: 'kilometers', steps: 32 });
        const r1000 = turf.buffer(f, 1, { units: 'kilometers', steps: 32 });

        const stats = {
            nombre,
            pob500: poblacionEn(r500, comunasFC),
            pob1000: poblacionEn(r1000, comunasFC),
            eq500: puntosEquip ? turf.pointsWithinPolygon(puntosEquip, r500).features.length : null,
            eq1000: puntosEquip ? turf.pointsWithinPolygon(puntosEquip, r1000).features.length : null
        };
        f.properties._stats = stats;
        r500.properties = { _stats: stats, _radio: '500 m' };
        r1000.properties = { _stats: stats, _radio: '1 km' };
        fc500.push(r500);
        fc1000.push(r1000);
    });

    // Distancia entre estaciones sobre el corredor (o en línea recta si no hay corredor)
    // Se usa la línea orientada de sur a norte (la misma del tren y de Street View),
    // así la abscisa K0 queda en el extremo sur, donde está la Estación 1
    let linea = lineaCorredor;
    if (!linea && corredorFC) {
        try {
            const lineas = corredorFC.features.filter(f => /LineString/.test(f.geometry?.type));
            linea = lineas.length === 1 ? lineas[0] : turf.combine(turf.featureCollection(lineas)).features[0];
        } catch { linea = null; }
    }

    if (linea) {
        estaciones.forEach(f => {
            f.properties._stats.pk = turf.nearestPointOnLine(linea, f, { units: 'kilometers' }).properties.location;
        });
        const orden = [...estaciones].sort((a, b) => a.properties._stats.pk - b.properties._stats.pk);
        orden.forEach((f, i) => {
            const s = f.properties._stats;
            s.orden = i + 1;
            // Numeración en el orden en que el tranvía pasa por ellas (de sur a norte
            // siguiendo la línea), no solo por latitud: así no salta de la 3 a la 5
            f.properties._numero = i + 1;
            s.nombre = `Estación ${i + 1}`;
            if (i > 0) s.distAnterior = (s.pk - orden[i - 1].properties._stats.pk) * 1000;
            if (i < orden.length - 1) s.distSiguiente = (orden[i + 1].properties._stats.pk - s.pk) * 1000;
        });
        // Actualiza las etiquetas y el buscador con la nueva numeración
        if (est.layer) est.layer.eachLayer(l => l.feature && l.setTooltipContent(esc(nombreEstacion(l.feature, 0))));
        indiceBusqueda.filter(r => r.capa === est && r.layer.feature)
            .forEach(r => r.texto = nombreEstacion(r.layer.feature, 0));
    } else {
        estaciones.forEach(f => {
            const otras = estaciones.filter(o => o !== f);
            if (otras.length) {
                f.properties._stats.distCercana = Math.min(...otras.map(o =>
                    turf.distance(f, o, { units: 'kilometers' }))) * 1000;
            }
        });
    }

    // Población de cada estación: se usa la tabla del análisis (POBLACION_ESTACIONES)
    estaciones.forEach(f => {
        const t = POBLACION_ESTACIONES[f.properties._numero];
        if (!t) return;
        const s = f.properties._stats;
        s.pob500 = t.p500;
        s.pob1000 = t.p1000;
        s.pobTabla = true;
    });

    // Resumen del corredor: población dentro de 500 m del conjunto de estaciones (sin doble conteo)
    const corredor = capaPorId('corredor');
    corredor.stats = { estaciones: estaciones.length };
    if (linea) corredor.stats.longitud = turf.length(linea, { units: 'kilometers' });
    try {
        const union500 = fc500.reduce((a, b) => turf.union(a, b));
        corredor.stats.pob500 = poblacionEn(union500, comunasFC);
        const union1000 = fc1000.reduce((a, b) => turf.union(a, b));
        corredor.stats.pob1000 = poblacionEn(union1000, comunasFC);
    } catch { /* sin estaciones o geometría inválida */ }

    // Crear las capas de buffers
    [[b500, fc500], [b1000, fc1000]].forEach(([capa, feats]) => {
        capa.datos = turf.featureCollection(feats);
        capa.layer = crearCapaGeoJSON(capa, capa.datos);
        capa.bounds = capa.layer.getBounds();
        marcarEstado(capa, 'ok');
    });
}

/* ---------- Ventanas emergentes ---------- */
const fmtPob = (v, exacto) => (v === null || v === undefined) ? '—' : (exacto ? '' : '≈ ') + num(v) + ' hab';
const fmtEq = v => (v === null || v === undefined) ? '—' : num(v);
const fmtM = v => (v === undefined) ? undefined : formatoDistancia(v);

function popupEstacion(f) {
    const s = f.properties._stats || {};
    const nombre = s.nombre || nombreEstacion(f, f.properties._indice ?? 0);
    return popupHTML(nombre, 'Estación propuesta (preliminar)', [
        ['Población beneficiada en un radio de 500 m', fmtPob(s.pob500, s.pobTabla)],
        ['Población beneficiada en un radio de 1 km', fmtPob(s.pob1000, s.pobTabla)],
        ['Equipamientos a 500 m', fmtEq(s.eq500)],
        ['Equipamientos a 1 km', fmtEq(s.eq1000)],
        ['Abscisa en el corredor', s.pk !== undefined ? `K${num(s.pk, 2)}` : undefined],
        ['Distancia a la anterior', fmtM(s.distAnterior)],
        ['Distancia a la siguiente', fmtM(s.distSiguiente)],
        ['Estación más cercana', fmtM(s.distCercana)]
    ]) + botonStreet(
        `streetEnPunto(${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})`, 'Ver en Street View');
}

function popupBuffer(f) {
    const s = f.properties._stats || {};
    const es500 = f.properties._radio === '500 m';
    return popupHTML(`Área de influencia ${f.properties._radio}`, s.nombre || '', [
        [`Población beneficiada en un radio de ${f.properties._radio}`, fmtPob(es500 ? s.pob500 : s.pob1000, s.pobTabla)],
        ['Equipamientos', fmtEq(es500 ? s.eq500 : s.eq1000)]
    ]);
}

function popupCorredor() {
    const s = capaPorId('corredor').stats || {};
    return popupHTML('Corredor potencial de tranvía', 'Ruta de menor costo sobre la superficie de aptitud', [
        ['Longitud', s.longitud !== undefined ? `${num(s.longitud, 2)} km` : '—'],
        ['Estaciones propuestas', s.estaciones ?? '—'],
        ['Población beneficiada en un radio de 500 m', fmtPob(s.pob500)],
        ['Población beneficiada en un radio de 1 km', fmtPob(s.pob1000)]
    ]) + botonStreet('recorrerCorredorStreet()', 'Recorrer el corredor en Street View');
}

function popupComuna(f) {
    const d = datosComuna(f.properties);
    let areaKm2;
    try { areaKm2 = turf.area(f) / 1e6; } catch { /* sin geometría */ }
    return popupHTML(nombreComuna(f.properties), d ? `Comuna ${d.n}` : 'Comuna', [
        ['Habitantes (2025)', d ? num(d.hab) : '—'],
        ['Densidad', d ? `${num(d.dens)} hab/km²` : '—'],
        ['Área calculada', areaKm2 ? `${num(areaKm2, 2)} km²` : undefined]
    ]);
}

function popupGenerico(capa, f) {
    const omitir = /^(_|objectid|fid|shape_|globalid|id$)/i;
    const filas = Object.entries(f.properties || {})
        .filter(([k, v]) => !omitir.test(k) && v !== null && v !== '' && typeof v !== 'object')
        .slice(0, 10)
        .map(([k, v]) => [k, esc(typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : v)]);
    const cat = capa.categorias ? (capa.categorias[capa.clasificar(f)] || {}).etiqueta : null;
    const titulo = campo(f.properties, ['NOMBRE', 'name', 'Name']) || cat || capa.nombre;
    return popupHTML(titulo, capa.nombre, filas.length ? filas : [['Atributos', 'sin atributos']]);
}


/* ============================================================
   FASE 5 · ASPECTO PROFESIONAL
   ============================================================ */

/* ---------- Página de inicio ---------- */
const inicio = document.getElementById('inicio');
let vueloHecho = false;

// Durante el vuelo se esconden las capas (Leaflet las estira mientras anima el zoom
// y se ven deformadas); al llegar aparecen con un fundido
function capasDelMapa() {
    const fijos = ['overlayPane', 'markerPane', 'shadowPane', 'tooltipPane', 'popupPane', 'paneTren', 'paneStreet', 'paneMedicion'];
    return [...CAPAS.map(c => c.pane), ...fijos].map(n => map.getPane(n)).filter(Boolean);
}

function ocultarCapasVuelo(ocultar) {
    capasDelMapa().forEach(p => {
        p.classList.add('pane-fundido');
        p.classList.toggle('oculto-vuelo', ocultar);
    });
}

// Vuelo de entrada: de Colombia a Armenia (solo la primera vez que se entra)
function vueloEntrada() {
    if (vueloHecho) return;
    vueloHecho = true;
    const per = capaPorId('perimetro');
    const opciones = { duration: CONFIG.vuelo.segundos, easeLinearity: 0.2 };
    map.once('moveend', () => {
        map.setMinZoom(CONFIG.vuelo.zoomMinimo);
        ocultarCapasVuelo(false);
    });
    if (per.bounds && per.bounds.isValid()) map.flyToBounds(per.bounds, { ...opciones, padding: [20, 20] });
    else map.flyTo(CONFIG.centro, CONFIG.zoom, opciones);
}

document.getElementById('btnEntrar').addEventListener('click', () => {
    inicio.classList.add('oculto');
    setTimeout(() => map.invalidateSize(), 600);
    // Espera a que se cargue el perímetro y a que termine de desaparecer la portada
    listo.finally(() => setTimeout(vueloEntrada, 650));
});
document.getElementById('btnInicio').addEventListener('click', () => {
    inicio.classList.remove('oculto', 'sin-transicion');
});


/* ---------- Panel lateral plegable ---------- */
const panel = document.getElementById('panel');
if (window.innerWidth <= 768) panel.classList.add('cerrado');

document.getElementById('btnPanel').addEventListener('click', () => {
    panel.classList.toggle('cerrado');
    setTimeout(() => map.invalidateSize(), 380);
});

/* ---------- Pestaña Modelo: pesos AHP y tabla de densidad ---------- */
function construirPanelModelo() {
    const criterios = CAPAS.filter(c => c.peso).sort((a, b) => b.peso - a.peso);
    document.getElementById('panelPesos').innerHTML = criterios.map(c => `
        <div class="barra-peso">
            <div class="fila"><span>${c.nombre}</span><strong>${num(c.peso * 100, 2)} %</strong></div>
            <div class="pista"><div class="relleno" data-ancho="${c.peso / criterios[0].peso * 100}"></div></div>
        </div>`).join('');

    dibujarGraficaPoblacion('p500');
    document.querySelectorAll('#radioGrafica button').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#radioGrafica button').forEach(x => x.classList.toggle('activo', x === btn));
        dibujarGraficaPoblacion(btn.dataset.campo);
    }));

    // Animación de las barras al abrir la pestaña
    document.querySelector('[data-bs-target="#tabModelo"]').addEventListener('shown.bs.tab', () => {
        document.querySelectorAll('.barra-peso .relleno').forEach(b => {
            b.style.width = '0';
            requestAnimationFrame(() => requestAnimationFrame(() => b.style.width = b.dataset.ancho + '%'));
        });
    });
}


/* ---------- Pestaña Modelo: torta de población beneficiada por estación ---------- */
const COLORES_ESTACIONES = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

function dibujarGraficaPoblacion(campoPob) {
    const datos = Object.entries(POBLACION_ESTACIONES).map(([n, v]) => ({ n: Number(n), v: v[campoPob] }));
    const total = datos.reduce((a, d) => a + d.v, 0);
    const cx = 110, cy = 110, r = 100;
    let ang = -Math.PI / 2;                     // arranca arriba, sentido horario
    const punto = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];

    const porciones = datos.map((d, i) => {
        const pct = d.v / total;
        const a0 = ang, a1 = ang + pct * 2 * Math.PI;
        ang = a1;
        const [x0, y0] = punto(a0, r), [x1, y1] = punto(a1, r);
        const [tx, ty] = punto((a0 + a1) / 2, r * 0.68);
        const grande = a1 - a0 > Math.PI ? 1 : 0;
        return `
            <g class="porcion" data-n="${d.n}">
                <title>Estación ${d.n}: ${num(d.v)} hab (${num(pct * 100, 1)} %)</title>
                <path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${grande} 1 ${x1},${y1} Z"
                      fill="${COLORES_ESTACIONES[i]}" stroke="#fff" stroke-width="1.5"></path>
                ${pct >= 0.035 ? `<text x="${tx}" y="${ty}">${Math.round(pct * 100)} %</text>` : ''}
            </g>`;
    }).join('');

    const filas = datos.map((d, i) => `
        <tr data-n="${d.n}" title="Ir a la estación ${d.n}">
            <td><span class="simbolo" style="background:${COLORES_ESTACIONES[i]}"></span>Estación ${d.n}</td>
            <td>${num(d.v)}</td>
            <td>${num(d.v / total * 100, 1)} %</td>
        </tr>`).join('');

    document.getElementById('graficaPoblacion').innerHTML = `
        <svg viewBox="0 0 220 220" class="torta">${porciones}</svg>
        <table class="tabla-densidad tabla-poblacion">
            <tr><th>Estación</th><th>Habitantes</th><th>%</th></tr>
            ${filas}
            <tr class="total"><td>Total</td><td>${num(total)}</td><td>100 %</td></tr>
        </table>`;

    // Clic en la torta o en la tabla: va a la estación en el mapa
    document.querySelectorAll('#graficaPoblacion [data-n]').forEach(el =>
        el.addEventListener('click', () => irAEstacion(Number(el.dataset.n))));
}

function irAEstacion(n) {
    const est = capaPorId('estaciones');
    if (!est.layer) return;
    est.layer.eachLayer(l => {
        if (l.feature?.properties?._numero !== n) return;
        mostrarCapa(est, true);
        map.setView(l.getLatLng(), 16);
        setTimeout(() => l.openPopup(), 300);
        if (window.innerWidth <= 768) panel.classList.add('cerrado');
    });
}


/* ============================================================
   ARRANQUE
   ============================================================ */
async function iniciar() {
    ocultarCapasVuelo(true);          // las capas aparecen al terminar el vuelo de entrada
    construirMapasBase();
    construirPanelCapas();
    construirPanelModelo();
    actualizarLeyenda();

    await Promise.all(CAPAS.filter(c => !c.derivada).map(cargarCapa));
    await procesarResultados();
    actualizarLeyenda();
    // La vista final la pone el vuelo de entrada (al pulsar "Explorar el geovisor")
}

const listo = iniciar();

// Al volver de la vista 3D (index.html#mapa): sin portada ni vuelo, directo a Armenia
if (location.hash === '#mapa') {
    vueloHecho = true;
    map.setMinZoom(CONFIG.vuelo.zoomMinimo);
    map.setView(CONFIG.centro, CONFIG.zoom, { animate: false });
    history.replaceState(null, '', location.pathname + location.search);   // limpia el #mapa de la dirección
    listo.finally(() => {
        const per = capaPorId('perimetro');
        if (per.bounds && per.bounds.isValid()) map.fitBounds(per.bounds, { padding: [20, 20], animate: false });
        ocultarCapasVuelo(false);
    });
}
