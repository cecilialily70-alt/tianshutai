import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ChatConfigProvider } from './context/ChatConfigContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChatConfigProvider>
      <App />
    </ChatConfigProvider>
  </React.StrictMode>,
);
