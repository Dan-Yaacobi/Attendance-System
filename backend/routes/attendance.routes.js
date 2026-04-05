const express = require('express');
const { validateSessionForToday } = require('../services/session.service');
const { validateAttendanceEntryPayload } = require('../validators/attendance.validator');

const router = express.Router();

router.post('/entry', async (req, res, next) => {
  try {
    const payload = validateAttendanceEntryPayload(req.body);
    const result = await validateSessionForToday(payload.course_id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
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
