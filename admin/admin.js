// Panel administrativo de Aikukisna. Todo el contenido se inserta con textContent (nunca innerHTML)
// para que los datos de los formularios públicos no puedan inyectar código.
const $ = (id) => document.getElementById(id);
const ESTADOS = ['nueva', 'contactada', 'agendada', 'descartada'];

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { credentials: 'same-origin', ...opciones });
  if (r.status === 401 && ruta !== '/api/admin/sesion') {
    mostrarSesion();
    throw new Error('Inicia sesión');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

function celda(fila, texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto ?? '';
  if (clase) td.className = clase;
  fila.appendChild(td);
  return td;
}

const fecha = (iso) => new Date(iso).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' });
const tamano = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);

function mostrarSesion() {
  $('vista-panel').hidden = true;
  $('salir').hidden = true;
  $('vista-sesion').hidden = false;
}

function mostrarPanel() {
  $('vista-sesion').hidden = true;
  $('vista-panel').hidden = false;
  $('salir').hidden = false;
  cargarDemos();
  cargarVersiones();
}

// --- Sesión ---

$('form-sesion').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error-sesion').textContent = '';
  const datos = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/admin/sesion', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos)
    });
    e.target.reset();
    mostrarPanel();
  } catch (err) {
    $('error-sesion').textContent = err.message;
  }
});

$('salir').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/admin/salir', { method: 'POST' }).catch(() => {});
  mostrarSesion();
});

// --- Pestañas (diseño de dashi.html: la activa usa .cubo, la otra .cubo2) ---

document.querySelectorAll('[data-pestana]').forEach((boton) => {
  boton.addEventListener('click', () => {
    document.querySelectorAll('[data-pestana]').forEach((b) => {
      const activa = b === boton;
      b.className = activa ? 'cubo' : 'cubo2';
      b.setAttribute('aria-selected', String(activa));
    });
    $('pestana-solicitudes').hidden = boton.dataset.pestana !== 'solicitudes';
    $('pestana-cargar').hidden = boton.dataset.pestana !== 'cargar';
  });
});

// --- Solicitudes de demo ---

async function cargarDemos() {
  const demos = await api('/api/admin/demos');
  const cuerpo = $('lista-demos');
  cuerpo.replaceChildren();
  $('total-demos').textContent = demos.length ? `(${demos.length})` : '';
  $('sin-demos').hidden = demos.length > 0;
  for (const d of demos) {
    const fila = document.createElement('tr');
    celda(fila, fecha(d.creado_en));
    celda(fila, d.nombre);
    const correo = celda(fila, '');
    const enlace = document.createElement('a');
    enlace.href = `mailto:${d.correo}`;
    enlace.textContent = d.correo;
    correo.appendChild(enlace);
    celda(fila, d.organizacion);
    celda(fila, d.telefono);
    celda(fila, d.mensaje, 'mensaje');
    const select = document.createElement('select');
    for (const estado of ESTADOS) select.add(new Option(estado, estado, false, estado === d.estado));
    select.addEventListener('change', async () => {
      try {
        await api(`/api/admin/demos/${d.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: select.value })
        });
      } catch (err) {
        alert(err.message);
        select.value = d.estado;
      }
    });
    celda(fila, '').appendChild(select);
    cuerpo.appendChild(fila);
  }
}

$('recargar-demos').addEventListener('click', () => cargarDemos().catch((e) => alert(e.message)));

// --- Versiones instalables ---

async function cargarVersiones() {
  const versiones = await api('/api/admin/versiones');
  const cuerpo = $('lista-versiones');
  cuerpo.replaceChildren();
  for (const v of versiones) {
    const fila = document.createElement('tr');
    celda(fila, v.plataforma);
    const version = celda(fila, '');
    const enlace = document.createElement('a');
    enlace.href = v.url;
    enlace.textContent = v.version;
    version.appendChild(enlace);
    celda(fila, tamano(v.tamano_bytes));
    celda(fila, v.sha256, 'hash');
    celda(fila, fecha(v.publicado_en));
    const borrar = document.createElement('button');
    borrar.className = 'peligro';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar ${v.plataforma} ${v.version}? El archivo dejará de estar disponible.`)) return;
      try {
        await api(`/api/admin/versiones/${v.id}`, { method: 'DELETE' });
        cargarVersiones();
      } catch (err) {
        alert(err.message);
      }
    });
    celda(fila, '').appendChild(borrar);
    cuerpo.appendChild(fila);
  }
}

// XMLHttpRequest en lugar de fetch: muestra el progreso de subidas de cientos de MB.
$('form-version').addEventListener('submit', (e) => {
  e.preventDefault();
  const formulario = e.target;
  const boton = $('boton-subir');
  const progreso = $('progreso');
  const estado = $('estado-subida');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/admin/versiones');
  xhr.upload.addEventListener('progress', (ev) => {
    if (!ev.lengthComputable) return;
    progreso.value = Math.round((ev.loaded / ev.total) * 100);
    estado.textContent = `${progreso.value} % · ${tamano(ev.loaded)} de ${tamano(ev.total)}`;
  });
  xhr.addEventListener('load', () => {
    boton.disabled = false;
    progreso.hidden = true;
    let respuesta = {};
    try { respuesta = JSON.parse(xhr.responseText); } catch { /* respuesta vacía */ }
    if (xhr.status === 401) return mostrarSesion();
    if (xhr.status !== 201) {
      estado.textContent = respuesta.error || `Error ${xhr.status}`;
      return;
    }
    estado.textContent = `Publicada ${respuesta.plataforma} ${respuesta.version}.`;
    formulario.reset();
    cargarVersiones();
  });
  xhr.addEventListener('error', () => {
    boton.disabled = false;
    progreso.hidden = true;
    estado.textContent = 'Se cortó la conexión durante la subida.';
  });
  boton.disabled = true;
  progreso.hidden = false;
  progreso.value = 0;
  estado.textContent = 'Subiendo…';
  xhr.send(new FormData(formulario));
});

// --- Inicio ---

api('/api/admin/yo').then(mostrarPanel).catch(mostrarSesion);
