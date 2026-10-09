const { crearApp } = require('./app');
const { prepararBd, pool } = require('./bd');

const PUERTO = Number(process.env.PUERTO || 3000);

prepararBd()
  .then(() => {
    const servidor = crearApp().listen(PUERTO, () => console.log(`API de Aikukisna escuchando en el puerto ${PUERTO}`));
    // Subidas de instalables grandes con conexiones lentas.
    servidor.requestTimeout = 15 * 60 * 1000;
    const cerrar = () => servidor.close(() => pool.end().finally(() => process.exit(0)));
    process.on('SIGTERM', cerrar);
    process.on('SIGINT', cerrar);
  })
  .catch((e) => {
    console.error('No se pudo preparar la base de datos:', e.message);
    process.exit(1);
  });
