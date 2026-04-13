const express = require('express');
const { validateSessionForToday } = require('../services/session.service');
const {
  validateAttendanceEntryPayload,
  validateSignInPayload,
  validateMarkByDevicePayload
} = require('../validators/attendance.validator');
const { signInAndMarkAttendance } = require('../services/participant.service');
const { markAttendanceByDevice } = require('../services/device.service');
const { getQrDisplayPayload } = require('../services/qr-session.service');

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

router.post('/mark-by-device', async (req, res, next) => {
  try {
    const payload = validateMarkByDevicePayload(req.body);
    const result = await markAttendanceByDevice(payload);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sign-in', async (req, res, next) => {
  try {
    const payload = validateSignInPayload(req.body);
    const result = await signInAndMarkAttendance(payload);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});


router.get('/qr-display/:sessionId', async (req, res, next) => {
  try {
    const result = await getQrDisplayPayload(req.params.sessionId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-device', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'POST /attendance/verify-device placeholder'
    }
  });
});

module.exports = router;
