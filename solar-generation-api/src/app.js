const express = require("express");
const provincesRouter = require("./routes/provinces");
const districtsRouter = require("./routes/districts");
const substationsRouter = require("./routes/substations");
const installationsRouter = require("./routes/installations");

const app = express();

app.use(express.json());

// Session 2 checkpoint
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        session: "NB6007CEM S2"
    });
});

// Feature routers
app.use("/provinces", provincesRouter);
app.use("/districts", districtsRouter);
app.use("/substations", substationsRouter);
app.use("/installations", installationsRouter);

// Central error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
});

module.exports = app;