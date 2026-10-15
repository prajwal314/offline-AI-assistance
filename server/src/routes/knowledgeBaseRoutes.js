const express = require("express");
const { build, status } = require("../controllers/knowledgeBaseController");
const router = express.Router();
router.post("/build", build);
router.get("/status", status);
module.exports = router;
