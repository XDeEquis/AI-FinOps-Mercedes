require('dotenv').config();

var express = require('express');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var { initializeDatabase } = require('./db');

// Importamos nuestra nueva ruta del proxy
var proxyRouter = require('./routes/proxy');

var app = express();

app.use(logger('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Instanciamos/migramos la base de datos SQLite antes de aceptar tráfico.
// Sin esto, las tablas consumers/models/audit_logs no existirían nunca.
initializeDatabase()
    .then(() => console.log('[DB] SQLite inicializada correctamente (finops.db).'))
    .catch((error) => console.error('[DB] Error al inicializar SQLite:', error.message));

// Aquí montamos el interceptor principal
app.use('/', proxyRouter);

// Manejador de errores básico para la API
app.use(function (err, req, res, next) {
    res.status(err.status || 500).json({
        error: {
            message: err.message,
            status: err.status || 500
        }
    });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ¡Backend corriendo con éxito en http://localhost:${PORT}!`);
});

module.exports = app;
