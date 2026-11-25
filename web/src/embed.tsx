// Point d'entrée des pages d'outils du site (pagio.site/fusionner-pdf/…) : l'outil s'affiche dans la page, entre la
// présentation et les questions fréquentes. <div id="pagio-tool" data-tool="merge"></div> + ce script.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Workspace from './pages/Workspace';
import './workspace.css';

const el = document.getElementById('pagio-tool');
if (el?.dataset.tool) createRoot(el).render(<StrictMode><Workspace id={el.dataset.tool} /></StrictMode>);
