// Landing de Aikukisna: enlace a la última APK publicada (si hay), formulario de demostración y la
// tarjeta que invita a descargar la app al enviar la solicitud. Sin dependencias; el contenido se
// inserta con textContent para no insertar HTML recibido.

/** Última APK de Android publicada desde el panel, o null si todavía no hay ninguna. */
const versionAndroid = fetch('/api/versiones')
  .then((r) => (r.ok ? r.json() : {}))
  .then((versiones) => versiones.android || null)
  .catch(() => null);

const megas = (bytes) => Math.round(bytes / 1048576);

(function enlaceDeDescarga() {
  // Bajo la bienvenida aparece una línea con el enlace de descarga si hay una APK publicada.
  const detalle = document.querySelector('[data-descarga-detalle]');
  if (!detalle) return;

  versionAndroid.then((android) => {
    if (!android) return;
    const enlace = document.createElement('a');
    enlace.href = android.url;
    enlace.setAttribute('download', '');
    enlace.textContent = 'Descarga la app para Android';
    detalle.replaceChildren(
      enlace, ` · versión ${android.version} · ${megas(android.tamano_bytes)} MB · funciona sin conexión`
    );
    detalle.hidden = false;
  });
})();

(function formularioDeDemo() {
  const formulario = document.getElementById('form-demo');
  if (!formulario) return;
  const estado = document.getElementById('estado-form');
  const boton = formulario.querySelector('button[type="submit"]');

  function mostrar(texto, tipo) {
    estado.textContent = texto;
    estado.className = `estado-form ${tipo}`;
  }

  formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(formulario));
    if (!datos.nombre.trim()) return mostrar('Escribe tu nombre.', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo.trim())) return mostrar('Escribe un correo válido.', 'error');

    boton.disabled = true;
    mostrar('Enviando…', '');
    try {
      const r = await fetch('/api/demos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(datos)
      });
      const respuesta = await r.json().catch(() => ({}));
      if (r.status === 201) {
        formulario.reset();
        mostrar('¡Gracias! Recibimos tu solicitud y te contactaremos pronto.', 'ok');
        mostrarCardDescarga(datos.nombre.trim().split(/\s+/)[0]);
      } else {
        mostrar(respuesta.error || 'No se pudo enviar. Intenta de nuevo.', 'error');
      }
    } catch {
      mostrar('Sin conexión. Revisa tu internet e intenta de nuevo.', 'error');
    } finally {
      boton.disabled = false;
    }
  });
})();

/** Tarjeta que aparece al enviar la solicitud: invita a descargar la app. */
async function mostrarCardDescarga(nombre) {
  const card = document.getElementById('card-descarga');
  if (!card) return;
  const titulo = document.getElementById('titulo-card');
  const botonDescarga = document.getElementById('boton-descarga-card');
  const detalle = document.getElementById('detalle-card');

  titulo.textContent = nombre ? `¡Gracias, ${nombre}!` : '¡Gracias por tu solicitud!';
  const android = await versionAndroid;
  if (android) {
    botonDescarga.href = android.url;
    botonDescarga.hidden = false;
    detalle.textContent = `Android · versión ${android.version} · ${megas(android.tamano_bytes)} MB · te recomendamos usar Wi-Fi`;
  } else {
    // Sin APK publicada todavía: la tarjeta solo agradece y avisa que se le contactará.
    botonDescarga.hidden = true;
    detalle.textContent = 'La descarga estará disponible muy pronto. Te escribiremos al correo que dejaste.';
  }

  if (typeof card.showModal === 'function') card.showModal();
  else card.setAttribute('open', '');
}

(function cerrarCardDescarga() {
  const card = document.getElementById('card-descarga');
  if (!card) return;
  const cerrar = () => (typeof card.close === 'function' ? card.close() : card.removeAttribute('open'));
  document.getElementById('cerrar-card').addEventListener('click', cerrar);
  // Tocar fuera de la tarjeta también la cierra.
  card.addEventListener('click', (e) => { if (e.target === card) cerrar(); });
})();
