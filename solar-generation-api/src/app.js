const path = require("path");
const express = require("express");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const authRouter = require("./routes/auth");
const provincesRouter = require("./routes/provinces");
const districtsRouter = require("./routes/districts");
const substationsRouter = require("./routes/substations");
const installationsRouter = require("./routes/installations");
const readingsRouter = require("./routes/readings");
const errorHandler = require("./middleware/errorHandler");

const app = express();
app.set('etag', false);

app.use(express.json());

// --- OpenAPI contract ------------------------------------------------------
// The spec lives in the project root; __dirname is <root>/src, so ".." lands on
// the project root.
const OPENAPI_PATH = path.join(__dirname, "..", "openapi.yaml");
const openapiDocument = YAML.load(OPENAPI_PATH);

// Raw spec, so tools (Postman, codegen, CI linting) can fetch the file itself.
app.get("/openapi.yaml", (req, res) => {
    res.sendFile(OPENAPI_PATH);
});

// Interactive documentation rendered from the same document.
app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openapiDocument, {
        customSiteTitle: "SLSEA Solar Generation API"
    })
);

// Session 2 checkpoint
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        session: "NB6007CEM S2"
    });
});

// Feature routers
app.use("/auth", authRouter);
app.use("/provinces", provincesRouter);
app.use("/districts", districtsRouter);
app.use("/substations", substationsRouter);
app.use("/installations", installationsRouter);
app.use("/installations/:id/readings", readingsRouter);

// Return JSON errors, including JSON parser errors, through one handler.
app.use(errorHandler);

module.exports = app;
