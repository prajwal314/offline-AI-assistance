const express = require("express");
const upload = require("../middleware/upload");
const { uploadDocument, listDocuments, getDocument, deleteDocument } = require("../controllers/documentController");

const router = express.Router();

router.post("/upload", upload.single("file"), uploadDocument);
router.get("/", listDocuments);
router.get("/:id", getDocument);
router.delete("/:id", deleteDocument);

module.exports = router;
