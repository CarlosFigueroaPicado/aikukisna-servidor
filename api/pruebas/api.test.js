// Pruebas de la API con base en memoria: node --test pruebas/
process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { crearApp } = require('../src/app');
const { prepararBd } = require('../src/bd');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aikukisna-'));
let servidor;
let base;

before(async () => {
  await prepararBd(1);
  const app = crearApp({
    JWT_SECRETO: 'x'.repeat(40),
    ADMIN_USUARIO: 'admin',
    ADMIN_CONTRASENA_HASH: bcrypt.hashSync('contrasena-de-prueba', 4),
    CORS_ORIGENES: 'https://aikukisna.example',
    CARPETA_DESCARGAS: carpeta,
    COOKIE_SEGURA: 'false'
  });
  await new Promise((r) => { servidor = app.listen(0, r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

const json = (metodo, cuerpo, extra = {}) => ({
  method: metodo, headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(cuerpo)
});

test('salud responde con la base conectada', async () => {
  const r = await fetch(`${base}/api/salud`);
  assert.deepStrictEqual(await r.json(), { ok: true, bd: true, version: 'desarrollo' });
});

test('una ruta inexistente de la API responde un mensaje claro, no el texto técnico de Express', async () => {
  const r = await fetch(`${base}/api/no-existe`);
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(await r.json(), { error: 'No encontramos lo que buscas.' });
});

test('la solicitud de demo valida y se guarda', async () => {
  let r = await fetch(`${base}/api/demos`, json('POST', { nombre: 'Ana', correo: 'no-es-correo' }));
  assert.strictEqual(r.status, 400);
  r = await fetch(`${base}/api/demos`, json('POST', { nombre: 'Ana', correo: 'Ana@Ejemplo.com', organizacion: 'Escuela' }));
  assert.strictEqual(r.status, 201);
});

test('CORS solo permite el origen configurado', async () => {
  const permitido = await fetch(`${base}/api/salud`, { headers: { Origin: 'https://aikukisna.example' } });
  assert.strictEqual(permitido.headers.get('access-control-allow-origin'), 'https://aikukisna.example');
  const ajeno = await fetch(`${base}/api/salud`, { headers: { Origin: 'https://otro.example' } });
  assert.strictEqual(ajeno.headers.get('access-control-allow-origin'), null);
});

test('el panel exige sesión y gestiona demos y versiones', async () => {
  assert.strictEqual((await fetch(`${base}/api/admin/demos`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/admin/sesion`, json('POST', { usuario: 'admin', contrasena: 'mala' }))).status, 401);

  const sesion = await fetch(`${base}/api/admin/sesion`, json('POST', { usuario: 'admin', contrasena: 'contrasena-de-prueba' }));
  assert.strictEqual(sesion.status, 200);
  const cookie = sesion.headers.get('set-cookie').split(';')[0];

  const demos = await (await fetch(`${base}/api/admin/demos`, { headers: { cookie } })).json();
  assert.strictEqual(demos[0].correo, 'ana@ejemplo.com');
  const cambio = await fetch(`${base}/api/admin/demos/${demos[0].id}`, json('PATCH', { estado: 'contactada' }, { cookie }));
  assert.strictEqual(cambio.status, 200);

  const formulario = new FormData();
  formulario.append('plataforma', 'android');
  formulario.append('version', '1.0.0');
  formulario.append('archivo', new Blob([Buffer.from('apk de prueba')]), 'aikukisna.apk');
  const subida = await fetch(`${base}/api/admin/versiones`, { method: 'POST', headers: { cookie }, body: formulario });
  assert.strictEqual(subida.status, 201);
  assert.ok(fs.existsSync(path.join(carpeta, 'aikukisna-android-1.0.0.apk')));

  const publicas = await (await fetch(`${base}/api/versiones`)).json();
  assert.strictEqual(publicas.android.url, '/descargas/aikukisna-android-1.0.0.apk');
  assert.strictEqual(publicas.android.sha256.length, 64);

  const mala = new FormData();
  mala.append('plataforma', 'android');
  mala.append('version', '1.0.1');
  mala.append('archivo', new Blob([Buffer.from('x')]), 'virus.exe');
  assert.strictEqual((await fetch(`${base}/api/admin/versiones`, { method: 'POST', headers: { cookie }, body: mala })).status, 400);
  assert.deepStrictEqual(fs.readdirSync(carpeta), ['aikukisna-android-1.0.0.apk']);
});
