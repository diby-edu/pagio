// Catalogue des outils de l'application web. `id` = identifiant de l'outil côté serveur (réglages et limites du
// tableau de bord). `where` : « local » = dans le navigateur, « server » = par le serveur Pagio (compte requis).
import type { Key } from './i18n';

export interface WebTool { id: string; where: 'local' | 'server'; accept: string; multiple: boolean; icon: string; color: string }

export const TOOLS: WebTool[] = [
  { id: 'merge', where: 'local', accept: 'application/pdf,.pdf', multiple: true, icon: '⧉', color: '#4535c9' },
  { id: 'extract_pages', where: 'local', accept: 'application/pdf,.pdf', multiple: false, icon: '⇱', color: '#7a5cf0' },
  { id: 'delete_pages', where: 'local', accept: 'application/pdf,.pdf', multiple: false, icon: '✂', color: '#e5484d' },
  { id: 'rotate', where: 'local', accept: 'application/pdf,.pdf', multiple: false, icon: '↻', color: '#0ea5e9' },
  { id: 'images_to_pdf', where: 'local', accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', multiple: true, icon: '▣', color: '#14a37f' },
  { id: 'page_numbers', where: 'local', accept: 'application/pdf,.pdf', multiple: false, icon: '#', color: '#f59e0b' },
  { id: 'watermark', where: 'local', accept: 'application/pdf,.pdf', multiple: false, icon: '≋', color: '#ff7a66' },
  { id: 'office_to_pdf', where: 'server', accept: '.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.txt', multiple: false, icon: 'W', color: '#2563eb' },
  { id: 'assistant', where: 'server', accept: 'application/pdf,.pdf', multiple: false, icon: '✦', color: '#9333ea' },
];

export const title = (id: string) => `t_${id}` as Key;
export const desc = (id: string) => `d_${id}` as Key;
