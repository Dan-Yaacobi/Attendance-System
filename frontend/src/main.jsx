import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminApp from './AdminApp';
import QrDisplayPage from './QrDisplayPage';

const pathname = window.location.pathname;
const isAdminRoute = pathname.startsWith('/admin');
const isQrDisplayRoute = pathname.startsWith('/qr-display/');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : isQrDisplayRoute ? <QrDisplayPage /> : <App />}
  </React.StrictMode>
);
