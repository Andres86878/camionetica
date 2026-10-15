// =====================================================================
//  CAMIONETICA · Servidor v2
//  Pasajeros (billetera + pago por QR), choferes (GPS desde el celular)
//  y administración de flota. Datos guardados en data/db.json.
// =====================================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const OLD_DB_FILE = path.join(__dirname, 'database.json');

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
const uid = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const ahora = () => new Date().toISOString();
const aCent = (bs) => Math.round(Number(bs) * 100);       // Bs -> céntimos
const aBs = (c) => (c / 100).toFixed(2);                  // céntimos -> "10.00"

function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(clave), salt, 32).toString('hex');
    return { salt, hash };
}
function verificarClave(clave, salt, hash) {
    const h = crypto.scryptSync(String(clave), salt, 32);
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
// Normaliza teléfonos venezolanos: "+58 412-123.45.67" -> "04121234567"
const limpiarTel = (t) => {
    let d = String(t || '').replace(/\D/g, '');
    if (d.startsWith('58') && d.length === 12) d = '0' + d.slice(2);
    if (d.length === 10 && d.startsWith('4')) d = '0' + d;
    return d;
};
const telValido = (t) => /^04(12|14|16|22|24|26)\d{7}$/.test(t);
function nuevoQR() {
    // Código único que va impreso en el QR físico de cada unidad
    return 'CMT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
const PAGO_MOVIL_DEFECTO = { banco: 'Banesco (0134)', telefono: '0412-000-0000', documento: 'J-00000000-0', titular: 'Camionetica C.A.' };
const pagoMovil = () => db.config.pagoMovil || PAGO_MOVIL_DEFECTO;
function hoyInicio() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

// ---------------------------------------------------------------------
//  Base de datos (archivo JSON)
// ---------------------------------------------------------------------
function semilla() {
    const db = {
        config: { tarifaCent: 1000, moneda: 'Bs', adminKey: crypto.randomBytes(6).toString('hex') },
        usuarios: [], autobuses: [], transacciones: [], sesiones: {}
    };
    // Unidades de demostración (se mueven solas mientras no haya GPS real)
    const demo = [
        ['Catia - Chacaíto', 'Línea Catia', 'AB123CD', 'Pedro Pérez', 10.5060, -66.9530, 0.00015, 0.00025],
        ['Petare - La Bandera', 'Línea Petare', 'EF456GH', 'José Rodríguez', 10.4850, -66.8150, -0.0001, 0.0002],
        ['Antímano - Plaza Venezuela', 'Línea Antímano', 'IJ789KL', 'Luis González', 10.4950, -66.8790, 0.00012, -0.00018]
    ];
    demo.forEach(([ruta, linea, placa, chofer, lat, lng, dLat, dLng], i) => {
        const { salt, hash } = hashClave('1234');
        db.autobuses.push({
            id: `BUS-00${i + 1}`, linea_transporte: linea, ruta, placa, chofer_nombre: chofer,
            qr_codigo: `CMT-DEMO0${i + 1}`, clave_salt: salt, clave_hash: hash,
            latitud: lat, longitud: lng, ultima_actualizacion: ahora(), activo: true,
            simulado: true, dLat, dLng
        });
    });
    const { salt, hash } = hashClave('1234');
    db.usuarios.push({
        id: 'USR-DEMO', nombre: 'Pasajero Demo', email: 'demo@camionetica.app', telefono: '04120000000',
        pin_salt: salt, pin_hash: hash, saldoCent: 6000, creado_en: ahora()
    });
    return db;
}

function cargarDB() {
    try {
        if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.error('No se pudo leer data/db.json, se crea una nueva.', e.message); }
    const db = semilla();
    // Migra el saldo del archivo viejo (database.json de la v1) al usuario demo
    try {
        if (fs.existsSync(OLD_DB_FILE)) {
            const viejo = JSON.parse(fs.readFileSync(OLD_DB_FILE, 'utf8'));
            if (typeof viejo.saldoUsuario === 'number') db.usuarios[0].saldoCent = aCent(viejo.saldoUsuario);
        }
    } catch (_) { }
    return db;
}

let db = cargarDB();
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Si existe DATABASE_URL (PostgreSQL, p. ej. Neon), los datos se guardan allí
// para que no se pierdan cuando el servidor en la nube se reinicia.
const DATABASE_URL = process.env.DATABASE_URL;
let pg = null;
async function conectarPG() {
    if (!DATABASE_URL) return;
    const { Pool } = require('pg');
    pg = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
    await pg.query('CREATE TABLE IF NOT EXISTS camionetica_estado (id TEXT PRIMARY KEY, data JSONB NOT NULL, actualizado TIMESTAMPTZ DEFAULT now())');
    const r = await pg.query("SELECT data FROM camionetica_estado WHERE id = 'principal'");
    if (r.rows.length) db = r.rows[0].data;
    console.log('🗄️  Datos guardados en PostgreSQL');
}

let guardadoPendiente = null;
let cadenaPG = Promise.resolve();
function guardar() {
    // Guardado agrupado: archivo local (atómico) y, si hay base de datos, PostgreSQL
    if (guardadoPendiente) return;
    guardadoPendiente = setTimeout(() => {
        guardadoPendiente = null;
        const json = JSON.stringify(db);
        try {
            const tmp = DB_FILE + '.tmp';
            fs.writeFileSync(tmp, json);
            fs.renameSync(tmp, DB_FILE);
        } catch (e) { console.error('No se pudo escribir data/db.json', e.message); }
        if (pg) cadenaPG = cadenaPG.then(() => pg.query(
            "INSERT INTO camionetica_estado (id, data, actualizado) VALUES ('principal', $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, actualizado = now()", [json]
        )).catch(e => console.error('Error guardando en PostgreSQL', e.message));
    }, 300);
}

// Freno contra adivinar PINs: 6 intentos fallidos por teléfono/IP cada 15 min
const intentos = new Map();
function bloqueado(clave) {
    const r = intentos.get(clave);
    if (!r) return false;
    if (Date.now() - r.desde > 15 * 60e3) { intentos.delete(clave); return false; }
    return r.n >= 6;
}
function fallo(clave) {
    const r = intentos.get(clave);
    if (!r || Date.now() - r.desde > 15 * 60e3) intentos.set(clave, { n: 1, desde: Date.now() });
    else r.n++;
}

// ---------------------------------------------------------------------
//  Sesiones
// ---------------------------------------------------------------------
const DIAS_SESION = 30;
function crearSesion(tipo, id) {
    const token = crypto.randomBytes(24).toString('hex');
    db.sesiones[token] = { tipo, id, exp: Date.now() + DIAS_SESION * 864e5 };
    guardar();
    return token;
}
function auth(tipo) {
    return (req, res, next) => {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        const s = db.sesiones[token];
        if (!s || s.tipo !== tipo || s.exp < Date.now()) {
            return res.status(401).json({ exito: false, mensaje: 'Sesión vencida. Inicia sesión de nuevo.' });
        }
        req.sesion = s;
        next();
    };
}
function soloAdmin(req, res, next) {
    const key = req.headers['x-admin-key'] || '';
    if (key !== (process.env.ADMIN_KEY || db.config.adminKey)) {
        return res.status(401).json({ exito: false, mensaje: 'Clave de administrador incorrecta.' });
    }
    next();
}

// ---------------------------------------------------------------------
//  Vistas públicas de los datos
// ---------------------------------------------------------------------
const MIN_SIN_GPS = 3; // si un chofer real no reporta en 3 min, la unidad sale del mapa
function busVisible(b) {
    if (!b.activo) return false;
    if (b.simulado) return true;
    return Date.now() - new Date(b.ultima_actualizacion).getTime() < MIN_SIN_GPS * 60e3;
}
const busPublico = (b) => ({
    id: b.id, ruta: b.ruta, linea: b.linea_transporte, placa: b.placa,
    lat: b.latitud, lng: b.longitud, actualizado: b.ultima_actualizacion, simulado: !!b.simulado
});
function txPasajero(t) {
    const bus = db.autobuses.find(b => b.id === t.autobus_id);
    return {
        id: t.id, tipo: t.tipo, estado: t.estado, creado_en: t.creado_en, monto: aBs(t.montoCent),
        busId: t.tipo === 'recarga' ? 'RECARGA' : (bus ? bus.id : t.autobus_id),
        ruta: t.tipo === 'recarga' ? `Recarga vía ${t.metodo}` : (bus ? bus.ruta : ''),
        referencia: t.referencia || null, placa: t.tipo === 'recarga' || !bus ? null : bus.placa
    };
}
function perfil(u) {
    const historial = db.transacciones.filter(t => t.usuario_id === u.id).slice(-40).reverse().map(txPasajero);
    return {
        exito: true,
        usuario: { id: u.id, nombre: u.nombre, telefono: u.telefono, email: u.email },
        saldo: aBs(u.saldoCent), tarifa: aBs(db.config.tarifaCent), moneda: db.config.moneda, historial,
        pagoMovil: pagoMovil()
    };
}

// ---------------------------------------------------------------------
//  Pasajeros
// ---------------------------------------------------------------------
app.post('/api/auth/registro', (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const telefono = limpiarTel(req.body.telefono);
    const email = String(req.body.email || '').trim().toLowerCase();
    const pin = String(req.body.pin || '');
    if (nombre.length < 3) return res.json({ exito: false, mensaje: 'Escribe tu nombre completo.' });
    if (!telValido(telefono)) return res.json({ exito: false, mensaje: 'Escribe un celular venezolano válido (ej. 0412 123 4567).' });
    if (!/^\d{4,6}$/.test(pin)) return res.json({ exito: false, mensaje: 'El PIN debe tener de 4 a 6 números.' });
    if (db.usuarios.some(u => u.telefono === telefono)) return res.json({ exito: false, mensaje: 'Ese teléfono ya está registrado. Inicia sesión.' });
    if (email && db.usuarios.some(u => u.email === email)) return res.json({ exito: false, mensaje: 'Ese correo ya está registrado.' });
    const { salt, hash } = hashClave(pin);
    const u = { id: uid('USR'), nombre, email, telefono, pin_salt: salt, pin_hash: hash, saldoCent: 0, creado_en: ahora() };
    db.usuarios.push(u); guardar();
    res.json({ ...perfil(u), token: crearSesion('pasajero', u.id) });
});

app.post('/api/auth/login', (req, res) => {
    const tel = limpiarTel(req.body.telefono);
    const llave = 'p:' + tel + ':' + req.ip;
    if (bloqueado(llave)) return res.json({ exito: false, mensaje: 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.' });
    const u = db.usuarios.find(x => x.telefono === tel);
    if (!u || !verificarClave(req.body.pin || '', u.pin_salt, u.pin_hash)) {
        fallo(llave);
        return res.json({ exito: false, mensaje: 'Teléfono o PIN incorrecto.' });
    }
    res.json({ ...perfil(u), token: crearSesion('pasajero', u.id) });
});

app.post('/api/auth/salir', (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    delete db.sesiones[token]; guardar();
    res.json({ exito: true });
});

app.post('/api/auth/cambiar-pin', auth('pasajero'), (req, res) => {
    const u = db.usuarios.find(x => x.id === req.sesion.id);
    if (!verificarClave(req.body.actual || '', u.pin_salt, u.pin_hash)) return res.json({ exito: false, mensaje: 'Tu PIN actual no es correcto.' });
    if (!/^\d{4,6}$/.test(String(req.body.nuevo || ''))) return res.json({ exito: false, mensaje: 'El PIN nuevo debe tener de 4 a 6 números.' });
    const { salt, hash } = hashClave(req.body.nuevo);
    u.pin_salt = salt; u.pin_hash = hash; guardar();
    res.json({ exito: true, mensaje: 'PIN actualizado.' });
});

app.get('/api/me', auth('pasajero'), (req, res) => {
    const u = db.usuarios.find(x => x.id === req.sesion.id);
    if (!u) return res.status(401).json({ exito: false, mensaje: 'Usuario no encontrado.' });
    res.json(perfil(u));
});

// El QR puede traer "CMT-XXXX", "camionetica:CMT-XXXX" o una URL .../pagar?qr=CMT-XXXX
function leerCodigoQR(texto) {
    const m = String(texto || '').toUpperCase().match(/CMT-[A-Z0-9]+/);
    return m ? m[0] : null;
}

app.post('/api/pagar', auth('pasajero'), (req, res) => {
    const u = db.usuarios.find(x => x.id === req.sesion.id);
    const codigo = leerCodigoQR(req.body.qr);
    const bus = codigo && db.autobuses.find(b => b.qr_codigo === codigo);
    if (!bus) return res.json({ exito: false, mensaje: 'Código QR no válido. Verifica que sea el de la unidad.' });
    if (!bus.activo) return res.json({ exito: false, mensaje: `La unidad ${bus.id} no está en servicio ahora.` });

    // Evita cobros dobles por escanear dos veces seguidas
    const ultimo = db.transacciones.slice().reverse().find(t => t.usuario_id === u.id && t.tipo === 'pasaje' && t.estado === 'completado');
    const segundos = ultimo ? (Date.now() - new Date(ultimo.creado_en).getTime()) / 1000 : Infinity;
    if (ultimo && ultimo.autobus_id === bus.id && segundos < 90 && !req.body.confirmarOtro) {
        return res.json({ exito: false, duplicado: true, mensaje: `Ya pagaste en ${bus.id} hace ${Math.round(segundos)} s. ¿Pagar otro pasaje?` });
    }

    const tarifa = db.config.tarifaCent;
    if (u.saldoCent < tarifa) {
        db.transacciones.push({ id: uid('TX'), tipo: 'pasaje', usuario_id: u.id, autobus_id: bus.id, montoCent: tarifa, estado: 'fallido', creado_en: ahora() });
        guardar();
        return res.json({ exito: false, mensaje: `Saldo insuficiente. El pasaje cuesta ${aBs(tarifa)} Bs. Recarga tu cuenta.` });
    }
    u.saldoCent -= tarifa;
    const tx = { id: uid('TX'), tipo: 'pasaje', usuario_id: u.id, autobus_id: bus.id, montoCent: tarifa, estado: 'completado', creado_en: ahora() };
    db.transacciones.push(tx);
    guardar();
    res.json({ ...perfil(u), mensaje: `¡Pasaje pagado en ${bus.id}! Buen viaje`, bus: busPublico(bus), chofer: bus.chofer_nombre, transaccion: txPasajero(tx) });
});

app.post('/api/recargar', auth('pasajero'), (req, res) => {
    const u = db.usuarios.find(x => x.id === req.sesion.id);
    const montoCent = aCent(req.body.monto);
    const metodo = String(req.body.metodo || 'Pago Móvil').slice(0, 60);
    const referencia = String(req.body.referencia || '').replace(/\D/g, '');
    if (!montoCent || montoCent < 100 || montoCent > 100000000) return res.json({ exito: false, mensaje: 'Monto inválido.' });
    if (referencia.length < 4) return res.json({ exito: false, mensaje: 'Escribe los últimos 4 o más dígitos de la referencia del pago.' });
    if (db.transacciones.some(t => t.tipo === 'recarga' && t.referencia === referencia && t.metodo === metodo)) {
        return res.json({ exito: false, mensaje: 'Esa referencia ya fue usada.' });
    }
    // MVP: se acredita al momento. En producción esto queda "pendiente" hasta conciliar con el banco.
    u.saldoCent += montoCent;
    db.transacciones.push({ id: uid('TX'), tipo: 'recarga', usuario_id: u.id, autobus_id: null, montoCent, metodo, referencia, estado: 'completado', creado_en: ahora() });
    guardar();
    res.json({ ...perfil(u), mensaje: `¡Recarga de ${aBs(montoCent)} Bs acreditada!` });
});

app.get('/api/buses', (req, res) => {
    res.json(db.autobuses.filter(busVisible).map(busPublico));
});

// ---------------------------------------------------------------------
//  Choferes
// ---------------------------------------------------------------------
app.post('/api/chofer/login', (req, res) => {
    const id = String(req.body.unidad || '').trim().toUpperCase();
    const llave = 'c:' + id + ':' + req.ip;
    if (bloqueado(llave)) return res.json({ exito: false, mensaje: 'Demasiados intentos. Espera 15 minutos.' });
    const bus = db.autobuses.find(b => b.id === id || b.placa === id || b.qr_codigo === id);
    if (!bus || !verificarClave(req.body.clave || '', bus.clave_salt, bus.clave_hash)) {
        fallo(llave);
        return res.json({ exito: false, mensaje: 'Unidad o clave incorrecta.' });
    }
    res.json({ exito: true, token: crearSesion('chofer', bus.id), bus: busPublico(bus), chofer: bus.chofer_nombre });
});

app.post('/api/chofer/gps', auth('chofer'), (req, res) => {
    const bus = db.autobuses.find(b => b.id === req.sesion.id);
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    if (!bus) return res.status(404).json({ exito: false });
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.json({ exito: false, mensaje: 'Coordenadas inválidas.' });
    }
    bus.latitud = lat; bus.longitud = lng; bus.ultima_actualizacion = ahora();
    bus.activo = true; bus.simulado = false; // desde que llega GPS real deja de ser demo
    guardar();
    res.json({ exito: true });
});

app.post('/api/chofer/turno', auth('chofer'), (req, res) => {
    const bus = db.autobuses.find(b => b.id === req.sesion.id);
    bus.activo = !!req.body.activo; guardar();
    res.json({ exito: true, activo: bus.activo });
});

app.get('/api/chofer/resumen', auth('chofer'), (req, res) => {
    const bus = db.autobuses.find(b => b.id === req.sesion.id);
    const desde = hoyInicio();
    const hoy = db.transacciones.filter(t => t.autobus_id === bus.id && t.tipo === 'pasaje' && t.estado === 'completado' && new Date(t.creado_en).getTime() >= desde);
    const ultimos = hoy.slice(-20).reverse().map(t => {
        const u = db.usuarios.find(x => x.id === t.usuario_id);
        const nom = u ? u.nombre.split(' ')[0] + ' ' + (u.nombre.split(' ')[1] || '').charAt(0) + '.' : 'Pasajero';
        return { id: t.id, pasajero: nom.trim(), monto: aBs(t.montoCent), creado_en: t.creado_en };
    });
    res.json({
        exito: true, bus: busPublico(bus), chofer: bus.chofer_nombre, activo: bus.activo, qr_codigo: bus.qr_codigo,
        pasajerosHoy: hoy.length, recaudadoHoy: aBs(hoy.reduce((s, t) => s + t.montoCent, 0)), ultimos
    });
});

// ---------------------------------------------------------------------
//  Administración de flota
// ---------------------------------------------------------------------
app.get('/api/admin/resumen', soloAdmin, (req, res) => {
    const desde = hoyInicio();
    const hoy = db.transacciones.filter(t => new Date(t.creado_en).getTime() >= desde && t.estado === 'completado');
    res.json({
        exito: true,
        tarifa: aBs(db.config.tarifaCent), pagoMovil: pagoMovil(),
        usuarios: db.usuarios.length,
        pasajesHoy: hoy.filter(t => t.tipo === 'pasaje').length,
        recaudadoHoy: aBs(hoy.filter(t => t.tipo === 'pasaje').reduce((s, t) => s + t.montoCent, 0)),
        recargasHoy: aBs(hoy.filter(t => t.tipo === 'recarga').reduce((s, t) => s + t.montoCent, 0)),
        autobuses: db.autobuses.map(b => ({
            ...busPublico(b), chofer: b.chofer_nombre, qr_codigo: b.qr_codigo, activo: b.activo, enMapa: busVisible(b),
            pasajesHoy: hoy.filter(t => t.autobus_id === b.id && t.tipo === 'pasaje').length
        }))
    });
});

app.post('/api/admin/autobuses', soloAdmin, (req, res) => {
    const { linea_transporte, ruta, placa, chofer_nombre, clave } = req.body;
    if (!ruta || !placa || !chofer_nombre) return res.json({ exito: false, mensaje: 'Completa ruta, placa y chofer.' });
    if (!/^\d{4,6}$/.test(String(clave || ''))) return res.json({ exito: false, mensaje: 'La clave del chofer debe tener de 4 a 6 números.' });
    const placaN = String(placa).toUpperCase().replace(/\s/g, '');
    if (db.autobuses.some(b => b.placa === placaN)) return res.json({ exito: false, mensaje: 'Ya existe una unidad con esa placa.' });
    let n = db.autobuses.length + 1, id;
    do { id = 'BUS-' + String(n++).padStart(3, '0'); } while (db.autobuses.some(b => b.id === id));
    let qr; do { qr = nuevoQR(); } while (db.autobuses.some(b => b.qr_codigo === qr));
    const { salt, hash } = hashClave(clave);
    const bus = {
        id, linea_transporte: linea_transporte || ruta, ruta, placa: placaN, chofer_nombre, qr_codigo: qr,
        clave_salt: salt, clave_hash: hash, latitud: 10.4900, longitud: -66.8900,
        ultima_actualizacion: ahora(), activo: false, simulado: false
    };
    db.autobuses.push(bus); guardar();
    res.json({ exito: true, bus: { ...busPublico(bus), qr_codigo: qr, chofer: chofer_nombre } });
});

app.post('/api/admin/pagomovil', soloAdmin, (req, res) => {
    const { banco, telefono, documento, titular } = req.body;
    if (!banco || !telefono || !documento) return res.json({ exito: false, mensaje: 'Completa banco, teléfono y cédula/RIF.' });
    db.config.pagoMovil = { banco: String(banco).slice(0, 60), telefono: String(telefono).slice(0, 20), documento: String(documento).slice(0, 20), titular: String(titular || '').slice(0, 60) };
    guardar();
    res.json({ exito: true, pagoMovil: db.config.pagoMovil });
});

app.post('/api/admin/tarifa', soloAdmin, (req, res) => {
    const c = aCent(req.body.tarifa);
    if (!c || c <= 0) return res.json({ exito: false, mensaje: 'Tarifa inválida.' });
    db.config.tarifaCent = c; guardar();
    res.json({ exito: true, tarifa: aBs(c) });
});

// ---------------------------------------------------------------------
//  Simulación de las unidades demo (solo las que aún no tienen GPS real)
// ---------------------------------------------------------------------
setInterval(() => {
    db.autobuses.filter(b => b.simulado && b.activo).forEach(b => {
        b.latitud += b.dLat; b.longitud += b.dLng;
        if (b.latitud > 10.53 || b.latitud < 10.45) b.dLat *= -1;
        if (b.longitud > -66.78 || b.longitud < -67.00) b.dLng *= -1;
        b.ultima_actualizacion = ahora();
    });
}, 2000);

// Limpieza de sesiones vencidas
setInterval(() => {
    const t = Date.now();
    for (const k in db.sesiones) if (db.sesiones[k].exp < t) delete db.sesiones[k];
    guardar();
}, 3600e3);

conectarPG().catch(e => console.error('⚠️  No se pudo conectar a PostgreSQL, se usa el archivo local:', e.message))
.then(() => { guardar(); app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚐 Camionetica v2 corriendo en http://localhost:${PORT}`);
    console.log(`   Pasajeros:  http://localhost:${PORT}/`);
    console.log(`   Choferes:   http://localhost:${PORT}/chofer.html`);
    console.log(`   Admin:      http://localhost:${PORT}/admin.html   (clave: ${process.env.ADMIN_KEY || db.config.adminKey})\n`);
}); });
