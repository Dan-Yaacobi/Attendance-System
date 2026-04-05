const express = require('express');

const router = express.Router();

router.post('/entry', (req, res) => {
  res.status(501).json({ message: 'POST /attendance/entry placeholder' });
});

router.post('/mark-by-device', (req, res) => {
  res.status(501).json({ message: 'POST /attendance/mark-by-device placeholder' });
});

router.post('/sign-in', (req, res) => {
  res.status(501).json({ message: 'POST /attendance/sign-in placeholder' });
});

router.post('/verify-device', (req, res) => {
  res.status(501).json({ message: 'POST /attendance/verify-device placeholder' });
});

module.exports = router;
