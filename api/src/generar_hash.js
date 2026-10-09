// Uso: docker compose run --rm api npm run hash -- "contraseña"
// Imprime el hash bcrypt para ADMIN_CONTRASENA_HASH (la contraseña nunca se guarda en claro).
const bcrypt = require('bcryptjs');

const contrasena = process.argv[2];
if (!contrasena || contrasena.length < 12) {
  console.error('Escribe una contraseña de al menos 12 caracteres');
  process.exit(1);
}
console.log(bcrypt.hashSync(contrasena, 12));
