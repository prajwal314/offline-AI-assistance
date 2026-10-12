const express = require("express");
const { chat, getHistory, getStats, listSessions, createSession, getSessionMessages, renameSession, deleteSession } = require("../controllers/chatController");

const router = express.Router();

router.post("/", chat);
router.get("/history", getHistory);
router.get("/stats", getStats);

router.get("/sessions", listSessions);
router.post("/sessions", createSession);
router.get("/sessions/:id/messages", getSessionMessages);
router.patch("/sessions/:id", renameSession);
router.delete("/sessions/:id", deleteSession);

module.exports = router;
