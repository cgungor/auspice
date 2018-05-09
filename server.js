/* eslint no-console: off */
const path = require("path");
const express = require("express");
const expressStaticGzip = require("express-static-gzip");
const charon = require("./src/server/charon");
const globals = require("./src/server/globals");

/* documentation in the static site! */

const devServer = process.argv.indexOf("dev") !== -1;
globals.setGlobals({
  localStatic: process.argv.indexOf("localStatic") !== -1,
  localData: process.argv.indexOf("localData") !== -1
});

/* dev-specific libraries & imports */
let webpack;
let config;
let webpackDevMiddleware;
let webpackHotMiddleware;
if (devServer) {
  webpack = require("webpack"); // eslint-disable-line
  config = require("./webpack.config.dev"); // eslint-disable-line
  webpackDevMiddleware = require("webpack-dev-middleware"); // eslint-disable-line
  webpackHotMiddleware = require("webpack-hot-middleware"); // eslint-disable-line
}

const app = express();
app.set('port', process.env.PORT || 4000);

if (devServer) {
  const compiler = webpack(config);
  app.use(webpackDevMiddleware(compiler, {
    noInfo: true,
    publicPath: config.output.publicPath
  }));
  app.use(webpackHotMiddleware(compiler));
} else {
  app.use("/dist", expressStaticGzip("dist"));
  app.use('/dist', express.static('dist')); // why is this line here?
}

/* redirect www.nextstrain.org to nextstrain.org */
app.use(require('express-naked-redirect')({
  reverse: true
}));

/* loader.io token (needed to run tests) */
app.get("/loaderio-b65b3d7f32a7febf80e8e05678347cb3.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "loader.io-token.txt"));
});

app.get("/favicon.png", (req, res) => {
  res.sendFile(path.join(__dirname, "favicon.png"));
});

charon.applyCharonToApp(app);

app.get("*", (req, res) => {
  // console.log("Fallthrough request for " + req.originalUrl);
  res.sendFile(path.join(__dirname, "index.html"));
});

const server = app.listen(app.get('port'), () => {
  console.log("-----------------------------------");
  console.log("Auspice server started on port " + server.address().port);
  console.log(devServer ? "Serving dev bundle with hot-reloading enabled" : "Serving compiled bundle from /dist");
  console.log(global.LOCAL_DATA ? "Data is being sourced from /data" : "Data is being sourced from data.nextstrain.org (S3)");
  console.log(global.LOCAL_STATIC ? "Static content is being sourced from /static" : "Static content is being sourced from cdn.rawgit.com");
  console.log("-----------------------------------\n\n");
});
