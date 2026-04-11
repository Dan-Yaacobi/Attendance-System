const express = require('express');

const router = express.Router();

router.post('/auth/login', (req, res) => {
  res.status(501).json({ message: 'POST /admin/auth/login placeholder' });
});

router.post('/auth/logout', (req, res) => {
  res.status(501).json({ message: 'POST /admin/auth/logout placeholder' });
});

router.get('/auth/me', (req, res) => {
  res.status(501).json({ message: 'GET /admin/auth/me placeholder' });
});

module.exports = router;
