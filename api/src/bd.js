// Conexión a PostgreSQL (contenedor "bd"). En las pruebas se usa una base en memoria.
const { Pool } = require('pg');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS solicitud_demo (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(160) NOT NULL,
  organizacion VARCHAR(160),
  telefono VARCHAR(40),
  mensaje TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'nueva',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS version_app (
  id SERIAL PRIMARY KEY,
  plataforma VARCHAR(20) NOT NULL,
  version VARCHAR(40) NOT NULL,
  archivo VARCHAR(200) NOT NULL,
  tamano_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  notas TEXT,
  publicado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

function crearPool() {
  if (process.env.NODE_ENV === 'test') {
    const { newDb } = require('pg-mem');
    const { Pool: PoolMemoria } = newDb().adapters.createPg();
    return new PoolMemoria();
  }
  return new Pool({
    host: process.env.BD_HOST || 'bd',
    port: Number(process.env.BD_PUERTO || 5432),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 10
  });
}

const pool = crearPool();

/** Crea las tablas; reintenta mientras el contenedor de la base termina de arrancar. */
async function prepararBd(intentos = 20) {
  for (let i = 1; ; i++) {
    try {
      await pool.query(ESQUEMA);
      return;
    } catch (e) {
      if (i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

module.exports = { pool, prepararBd };
