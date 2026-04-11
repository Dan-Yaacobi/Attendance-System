const express = require('express');
const attendanceRoutes = require('./attendance.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

router.use('/v1/attendance', attendanceRoutes);
router.use('/v1/admin', adminRoutes);

module.exports = router;
