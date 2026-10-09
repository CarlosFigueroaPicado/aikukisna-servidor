// Rutas de la API. Se separa de servidor.js para poder probarla sin abrir un puerto.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { pool } = require('./bd');

const ESTADOS = ['nueva', 'contactada', 'agendada', 'descartada'];
const PLATAFORMAS = { android: '.apk', windows: '.exe', macos: '.dmg' };
const COOKIE = 'aikukisna_admin';
// Commit de GitHub desplegado (lo pone scripts/desplegar.sh): permite comprobar que Azure corre la rama main.
const VERSION = process.env.VERSION_CODIGO || 'desarrollo';

function crearApp(config = process.env) {
  const carpetaDescargas = config.CARPETA_DESCARGAS || '/datos/descargas';
  const secreto = config.JWT_SECRETO;
  if (!secreto || secreto.length < 32) throw new Error('JWT_SECRETO debe tener al menos 32 caracteres');
  fs.mkdirSync(carpetaDescargas, { recursive: true });

  const app = express();
  // Nginx está delante: la IP real del visitante llega en X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());

  // CORS: solo los orígenes de la landing (variable CORS_ORIGENES, separados por coma).
  const origenes = (config.CORS_ORIGENES || '').split(',').map((o) => o.trim()).filter(Boolean);
  app.use('/api', cors({
    origin(origen, listo) {
      // Sin cabecera Origin (misma página, curl, monitoreo) no aplica CORS.
      if (!origen || origenes.includes(origen)) return listo(null, true);
      return listo(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  // --- Público ---

  app.get('/api/salud', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, bd: true, version: VERSION });
    } catch {
      res.status(503).json({ ok: false, bd: false, version: VERSION });
    }
  });

  const limiteDemos = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' } });

  app.post('/api/demos', limiteDemos, async (req, res) => {
    const datos = limpiarSolicitud(req.body || {});
    if (datos.error) return res.status(400).json({ error: datos.error });
    // Campo trampa: los bots lo llenan, las personas no lo ven.
    if (req.body && req.body.sitio_web) return res.status(201).json({ ok: true });
    await pool.query(
      'INSERT INTO solicitud_demo (nombre, correo, organizacion, telefono, mensaje) VALUES ($1, $2, $3, $4, $5)',
      [datos.nombre, datos.correo, datos.organizacion, datos.telefono, datos.mensaje]
    );
    res.status(201).json({ ok: true });
  });

  app.get('/api/versiones', async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT id, plataforma, version, archivo, tamano_bytes, sha256, notas, publicado_en FROM version_app ORDER BY publicado_en DESC, id DESC'
    );
    // La más reciente de cada plataforma.
    const ultimas = {};
    for (const v of rows) if (!ultimas[v.plataforma]) ultimas[v.plataforma] = conUrl(v);
    res.json(ultimas);
  });

  // --- Administración ---

  const limiteSesion = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' } });

  app.post('/api/admin/sesion', limiteSesion, async (req, res) => {
    const { usuario, contrasena } = req.body || {};
    const valido = typeof usuario === 'string' && typeof contrasena === 'string' &&
      usuario === config.ADMIN_USUARIO && config.ADMIN_CONTRASENA_HASH &&
      await bcrypt.compare(contrasena, config.ADMIN_CONTRASENA_HASH);
    if (!valido) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = jwt.sign({ sub: usuario }, secreto, { expiresIn: '8h' });
    res.cookie(COOKIE, token, {
      httpOnly: true, secure: config.COOKIE_SEGURA !== 'false', sameSite: 'strict', maxAge: 8 * 3600 * 1000, path: '/api/admin'
    });
    res.json({ ok: true });
  });

  function soloAdmin(req, res, siguiente) {
    try {
      req.admin = jwt.verify(req.cookies[COOKIE] || '', secreto).sub;
      siguiente();
    } catch {
      res.status(401).json({ error: 'Inicia sesión' });
    }
  }

  app.post('/api/admin/salir', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/api/admin' });
    res.json({ ok: true });
  });

  app.get('/api/admin/yo', soloAdmin, (req, res) => res.json({ usuario: req.admin }));

  app.get('/api/admin/demos', soloAdmin, async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM solicitud_demo ORDER BY creado_en DESC, id DESC');
    res.json(rows);
  });

  app.patch('/api/admin/demos/:id', soloAdmin, async (req, res) => {
    const estado = req.body && req.body.estado;
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: `Estado inválido (${ESTADOS.join(', ')})` });
    const r = await pool.query('UPDATE solicitud_demo SET estado = $1 WHERE id = $2', [estado, Number(req.params.id)]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'No existe' });
    res.json({ ok: true });
  });

  // Los instalables pesan cientos de MB (la APK lleva el modelo de Tuki): se escriben directo a disco.
  const subida = multer({
    storage: multer.diskStorage({
      destination: carpetaDescargas,
      filename: (_req, _archivo, cb) => cb(null, `subiendo-${crypto.randomUUID()}`)
    }),
    limits: { fileSize: Number(config.MAX_INSTALABLE_MB || 1500) * 1024 * 1024, files: 1 }
  });

  app.post('/api/admin/versiones', soloAdmin, subida.single('archivo'), async (req, res) => {
    const temporal = req.file && req.file.path;
    try {
      const { plataforma, version, notas } = req.body || {};
      const extension = PLATAFORMAS[plataforma];
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
      if (!extension) return res.status(400).json({ error: 'Plataforma inválida (android, windows, macos)' });
      if (!/^[0-9A-Za-z._-]{1,40}$/.test(version || '')) return res.status(400).json({ error: 'Versión inválida (ej. 1.0.3)' });
      if (path.extname(req.file.originalname).toLowerCase() !== extension) {
        return res.status(400).json({ error: `Para ${plataforma} el archivo debe ser ${extension}` });
      }
      const nombre = `aikukisna-${plataforma}-${version}${extension}`;
      const destino = path.join(carpetaDescargas, nombre);
      const sha256 = await hashArchivo(temporal);
      fs.renameSync(temporal, destino);
      const { rows } = await pool.query(
        'INSERT INTO version_app (plataforma, version, archivo, tamano_bytes, sha256, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [plataforma, version, nombre, req.file.size, sha256, (notas || '').slice(0, 2000) || null]
      );
      res.status(201).json(conUrl(rows[0]));
    } finally {
      if (temporal && fs.existsSync(temporal)) fs.rmSync(temporal, { force: true });
    }
  });

  app.get('/api/admin/versiones', soloAdmin, async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM version_app ORDER BY publicado_en DESC, id DESC');
    res.json(rows.map(conUrl));
  });

  app.delete('/api/admin/versiones/:id', soloAdmin, async (req, res) => {
    const { rows } = await pool.query('DELETE FROM version_app WHERE id = $1 RETURNING archivo', [Number(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: 'No existe' });
    // Solo se borra el archivo si ninguna otra fila lo usa (misma versión subida dos veces).
    const enUso = await pool.query('SELECT 1 FROM version_app WHERE archivo = $1', [rows[0].archivo]);
    if (enUso.rows.length === 0) fs.rmSync(path.join(carpetaDescargas, path.basename(rows[0].archivo)), { force: true });
    res.json({ ok: true });
  });

  // Rutas inexistentes de la API: mensaje claro en JSON (Express respondía "Cannot GET ..." en HTML).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontramos lo que buscas.' }));

  app.use((err, _req, res, _siguiente) => {
    if (err instanceof multer.MulterError) {
      return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande' : err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un problema. Intenta de nuevo en unos segundos.' });
  });

  return app;
}

function conUrl(v) {
  return { ...v, tamano_bytes: Number(v.tamano_bytes), url: `/descargas/${encodeURIComponent(v.archivo)}` };
}

function texto(valor, maximo) {
  return typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, maximo) : null;
}

function limpiarSolicitud(cuerpo) {
  const nombre = texto(cuerpo.nombre, 120);
  const correo = texto(cuerpo.correo, 160);
  if (!nombre) return { error: 'Escribe tu nombre' };
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'Escribe un correo válido' };
  return {
    nombre,
    correo: correo.toLowerCase(),
    organizacion: texto(cuerpo.organizacion, 160),
    telefono: texto(cuerpo.telefono, 40),
    mensaje: texto(cuerpo.mensaje, 2000)
  };
}

function hashArchivo(ruta) {
  return new Promise((resolver, rechazar) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(ruta).on('data', (d) => hash.update(d)).on('end', () => resolver(hash.digest('hex'))).on('error', rechazar);
  });
}

module.exports = { crearApp, limpiarSolicitud };
