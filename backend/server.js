require('dotenv').config();

const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const adminRoutes = require('./routes/admin.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const errorHandler = require('./middleware/error.middleware');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: process.env.CORS_ALLOWED_ORIGIN || '*',
    credentials: true
  })
);
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', routes);
app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
