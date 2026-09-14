const express = require("express");
const { chat, getHistory, getStats } = require("../controllers/chatController");

const router = express.Router();

router.post("/", chat);
router.get("/history", getHistory);
router.get("/stats", getStats);

module.exports = router;
