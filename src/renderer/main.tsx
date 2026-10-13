import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('ASTRA root element is missing');

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
