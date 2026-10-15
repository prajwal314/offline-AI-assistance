const express = require("express");
const { run, results, runs, importData, review, retrievalDebug } = require("../controllers/evaluationController");

const evaluationRouter = express.Router();
evaluationRouter.post("/run", run);
evaluationRouter.get("/results", results);
evaluationRouter.get("/runs", runs);
evaluationRouter.post("/dataset", importData);
evaluationRouter.get("/review", review);

// Development-only (guarded by EVAL_DEBUG_ENABLED=1 inside the controller).
const retrievalDebugRouter = express.Router();
retrievalDebugRouter.get("/debug/:queryId", retrievalDebug);

module.exports = { evaluationRouter, retrievalDebugRouter };
