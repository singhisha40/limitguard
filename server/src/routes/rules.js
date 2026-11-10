const express = require('express');
const mongoose = require('mongoose');
const Rule = require('../models/Rule');

module.exports = function rulesRouter({ ruleStore }) {
  const router = express.Router();

  const needsDb = (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB not connected; rules are read-only built-ins' });
    }
    next();
  };

  const pick = (body) => {
    const out = {};
    for (const f of ['name', 'algorithm', 'limit', 'windowSec', 'keyBy', 'enabled', 'description']) {
      if (body[f] !== undefined) out[f] = body[f];
    }
    return out;
  };

  router.get('/', async (req, res) => {
    res.json(await ruleStore.list());
  });

  router.post('/', needsDb, async (req, res) => {
    try {
      const rule = await Rule.create(pick(req.body));
      ruleStore.invalidate();
      res.status(201).json(rule);
    } catch (err) {
      const status = err.code === 11000 ? 409 : 400;
      res.status(status).json({ error: err.code === 11000 ? 'Rule name already exists' : err.message });
    }
  });

  router.put('/:name', needsDb, async (req, res) => {
    try {
      const update = pick(req.body);
      delete update.name; // names are identifiers, they never change
      const rule = await Rule.findOneAndUpdate({ name: req.params.name }, update, {
        new: true,
        runValidators: true,
      });
      if (!rule) return res.status(404).json({ error: 'Rule not found' });
      ruleStore.invalidate();
      res.json(rule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:name', needsDb, async (req, res) => {
    const rule = await Rule.findOneAndDelete({ name: req.params.name });
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    ruleStore.invalidate();
    res.status(204).end();
  });

  return router;
};
