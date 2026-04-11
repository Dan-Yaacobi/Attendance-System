const express = require('express');
const attendanceRoutes = require('./attendance.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

router.use('/attendance', attendanceRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
