const express = require('express');
const router = express.Router();
const storage = require('../services/storage');

// GET /api/templates - List all templates
router.get('/', (req, res) => {
  try {
    const templates = storage.getTemplates();
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates - Add a new template
router.post('/', (req, res) => {
  try {
    const { title, badge, category, imageUrl, desc, sample } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Template title is required.' });
    }

    const newTemplate = storage.addTemplate({
      title: title.trim(),
      badge: badge ? badge.trim() : undefined,
      category: category ? category.trim() : undefined,
      imageUrl: imageUrl ? imageUrl.trim() : undefined,
      desc: desc ? desc.trim() : undefined,
      sample: sample ? sample.trim() : undefined
    });

    res.status(201).json({ success: true, template: newTemplate });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/templates/:id - Delete a template
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Template ID is required.' });
    }

    const templates = storage.deleteTemplate(id);
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/templates/:id - Update a template
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = storage.updateTemplate(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }

    res.json({ success: true, template: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
