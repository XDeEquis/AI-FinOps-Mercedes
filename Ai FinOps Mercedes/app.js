var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// Importamos nuestra nueva ruta del proxy
var proxyRouter = require('./routes/proxy');

var app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Aquí montamos el interceptor principal
app.use('/', proxyRouter);

// Manejador de errores básico para la API
app.use(function(err, req, res, next) {
  res.status(err.status || 500).json({
    error: {
      message: err.message,
      status: err.status || 500
    }
  });
});

module.exports = app;