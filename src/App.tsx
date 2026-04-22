// ============================================================================
// IMPORTS
// ============================================================================
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import JSZip from 'jszip';
import { AnimatePresence, motion, Reorder } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Upload, FileSpreadsheet, Settings, ArrowRight, ArrowLeft, Download, RefreshCw, AlertCircle, AlertTriangle, CheckCircle2, Scale, Lock, Sun, Moon, Search, ArrowUpDown, ArrowUp, ArrowDown, Save, Trash2, ListFilter, Check, ScanText, Files, FileText, X, Filter, FileSearch, Layers, Eye, EyeOff, ExternalLink, History, Sparkles, LogOut, LayoutDashboard, Database, ShieldCheck, CloudUpload, Palette, Pipette, ChevronDown } from 'lucide-react';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, collection, addDoc, query, where, getDocs, deleteDoc, doc, updateDoc, serverTimestamp, orderBy, limit, User } from './lib/firebase';
import { suggestMapping, analyzeAnomalies } from './lib/gemini';

// Configuration du worker PDF.js pour la lecture de documents PDF
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ============================================================================
// CONSTANTES ET CONFIGURATION
// ============================================================================

/**
 * Définition des champs standards du Fichier des Écritures Comptables (FEC).
 * `req` indique si le champ est obligatoire.
 * `aliases` permet une reconnaissance automatique (mapping) lors de l'import.
 */
const FIELDS = [
  { key: 'JournalCode', label: 'Code Journal', req: false, aliases: ['journalcode', 'codejournal', 'journal', 'codjnl', 'jnl_code', 'jnlcode', 'journal_id'] },
  { key: 'JournalLib', label: 'Libellé Journal', req: false, aliases: ['journallib', 'libellejournal', 'nomjournal', 'libjnl', 'libelle_journal', 'journal_name', 'nom_journal'] },
  { key: 'EcritureNum', label: 'N° Écriture', req: false, aliases: ['ecriturenum', 'numecriture', 'ecritnum', 'num_ecriture', 'no_ecriture', 'écritnum', 'num_ecrit', 'folio'] },
  { key: 'EcritureDate', label: 'Date Écriture ★', req: true, aliases: ['ecrituredate', 'dateecriture', 'date', 'dt_ecrit', 'date_comptable', 'date_ope', 'dt_op'] },
  { key: 'CompteNum', label: 'N° Compte ★', req: true, aliases: ['comptenum', 'numerocompte', 'compte', 'accountnum', 'numcompte', 'cpte', 'cpte_num', 'account_id', 'gl_account'] },
  { key: 'CompteLib', label: 'Libellé Compte', req: false, aliases: ['comptelib', 'libellecompte', 'nomcompte', 'libcpte', 'lib_compte', 'account_name', 'nom_compte'] },
  { key: 'CompAuxNum', label: 'Cpte Auxiliaire', req: false, aliases: ['compauxnum', 'compteauxiliaire', 'auxnum', 'cpteaux', 'cpte_aux', 'tier_num', 'aux_account'] },
  { key: 'CompAuxLib', label: 'Lib. Auxiliaire', req: false, aliases: ['compauxlib', 'libelleauxiliaire', 'libaux', 'lib_aux', 'tier_name', 'aux_name'] },
  { key: 'PieceRef', label: 'Réf. Pièce', req: false, aliases: ['pierceref', 'pieceref', 'reference', 'refpiece', 'no_piece', 'num_piece', 'pce_ref', 'piece_id'] },
  { key: 'PieceDate', label: 'Date Pièce', req: false, aliases: ['piecedate', 'datepiece', 'datefacture', 'dt_piece', 'date_piece', 'date_jnl'] },
  { key: 'EcritureLib', label: 'Libellé Écriture ★', req: true, aliases: ['ecriturelib', 'libelle', 'libellecriture', 'label', 'description', 'lib_ope', 'libelle_ope', 'commentaire'] },
  { key: 'Debit', label: 'Débit', req: false, aliases: ['debit', 'débit', 'montant_d', 'montantdebit', 'flux_d', 'mouvement_d', 'deb'] },
  { key: 'Credit', label: 'Crédit', req: false, aliases: ['credit', 'crédit', 'montant_c', 'montantcredit', 'flux_c', 'mouvement_c', 'cre'] },
  { key: 'Montant', label: 'Montant (unique)', req: false, aliases: ['montant', 'amount', 'valeur', 'prix', 'total', 'ca'] },
  { key: 'Sens', label: 'Sens D/C', req: false, aliases: ['sens', 'dc', 'signe', 'type_mouvement', 'sens_flux'] },
];

/**
 * Libellés raccourcis pour l'affichage dans le tableau d'aperçu.
 */
const PREVIEW_LABELS: Record<string, string> = {
  'JournalCode': 'Journal', 'JournalLib': 'Lib. Journal', 'EcritureNum': 'N° Écrit.',
  'EcritureDate': 'Date', 'CompteNum': 'Compte', 'CompteLib': 'Lib. Compte',
  'CompAuxNum': 'Aux.', 'CompAuxLib': 'Lib. Aux.', 'PieceRef': 'Réf.',
  'PieceDate': 'D. Pièce', 'EcritureLib': 'Libellé', 'Debit': 'Débit', 'Credit': 'Crédit'
};

/**
 * Formats de nombres disponibles pour l'export Excel.
 */
const NUMBER_FORMATS = [
  { value: '#,##0.00', label: 'Standard (1 234,56)' },
  { value: '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-', label: 'Comptabilité (Aligné)' },
  { value: '0.00', label: 'Simple (1234,56)' },
  { value: '#,##0', label: 'Sans décimales (1 235)' },
];

/**
 * Formats de dates disponibles pour l'export Excel.
 */
const DATE_FORMATS = [
  { value: 'dd/mm/yyyy', label: 'JJ/MM/AAAA (31/12/2024)' },
  { value: 'mm/dd/yyyy', label: 'MM/JJ/AAAA (12/31/2024)' },
  { value: 'yyyy-mm-dd', label: 'AAAA-MM-JJ (2024-12-31)' },
  { value: 'dd-mm-yyyy', label: 'JJ-MM-AAAA (31-12-2024)' },
  { value: 'd mmm yyyy', label: 'J MMM AAAA (31 déc 2024)' },
];

/**
 * Langues supportées pour la reconnaissance de texte (OCR).
 */
const OCR_LANGUAGES = [
  { value: 'fra', label: 'Français (FRA)' },
  { value: 'eng', label: 'Anglais (ENG)' },
  { value: 'deu', label: 'Allemand (DEU)' },
  { value: 'ita', label: 'Italien (ITA)' },
  { value: 'spa', label: 'Espagnol (SPA)' },
  { value: 'por', label: 'Portugais (POR)' },
  { value: 'nld', label: 'Néerlandais (NLD)' },
  { value: 'tur', label: 'Turc (TUR)' },
  { value: 'pol', label: 'Polonais (POL)' },
  { value: 'rus', label: 'Russe (RUS)' },
  { value: 'fra+eng', label: 'Multilingue (FR+EN)' },
];

const PREDEFINED_THEMES = [
  { id: 'indigo', name: 'Indigo (BDO)', color: '#6366f1' },
  { id: 'emerald', name: 'Émeraude', color: '#10b981' },
  { id: 'amber', name: 'Ambre', color: '#f59e0b' },
  { id: 'rose', name: 'Rose', color: '#f43f5e' },
  { id: 'slate', name: 'Ardoise', color: '#475569' },
  { id: 'violet', name: 'Violet', color: '#8b5cf6' },
  { id: 'custom', name: 'Personnalisé', color: 'linear-gradient(to right, #6366f1, #10b981)' },
];

const STEP_CONFIG = [
  { id: 1, label: 'Importation Data', icon: FileSpreadsheet },
  { id: 2, label: 'Configuration Mapping', icon: Layers },
  { id: 3, label: 'Analyse & Export', icon: LayoutDashboard },
  { id: 4, label: 'Réconciliation Balance', icon: Scale },
] as const;

// ============================================================================
// FONCTIONS UTILITAIRES (Helpers)
// ============================================================================

/**
 * Détecte l'encodage d'un fichier texte et le décode.
 * @param file Le fichier à analyser.
 * @param encOverride Forçage manuel de l'encodage (ex: 'auto', 'utf-8', 'iso-8859-1').
 */
async function detectAndDecode(file: File, encOverride: string) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (encOverride && encOverride !== 'auto') {
    return { text: new TextDecoder(encOverride).decode(buf), encoding: encOverride };
  }
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    return { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8 BOM' };
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: t, encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('iso-8859-1').decode(buf), encoding: 'Latin-1 (ANSI)' };
  }
}

/**
 * Détecte le séparateur de colonnes le plus probable dans un fichier CSV.
 * @param text Le contenu texte du fichier.
 * @param override Forçage manuel du séparateur.
 */
function detectSep(text: string, override: string) {
  if (override && override !== 'auto') return override;
  const s = text.split('\n').slice(0, 5).join('\n');
  const c: Record<string, number> = { '\t': 0, ';': 0, ',': 0, '|': 0 };
  for (const k of Object.keys(c)) c[k] = (s.split(k).length - 1);
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Parse une ligne CSV en tenant compte des guillemets.
 */
function parseLine(line: string, sep: string) {
  const r: string[] = []; let q = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === sep && !q) { r.push(cur.trim()); cur = ''; }
    else cur += line[i];
  }
  r.push(cur.trim());
  return r;
}

/**
 * Parse le contenu complet d'un fichier CSV en extrayant les en-têtes et les lignes de données.
 */
function parseCSV(text: string, sep: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseLine(lines[0], sep).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l, sep);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => row[h] = (vals[i] || '').replace(/^["']|["']$/g, '').trim());
    return row;
  }).filter(r => Object.values(r).some(v => v !== ''));
  return { headers, rows };
}

/**
 * Tente de mapper automatiquement les colonnes du fichier source aux champs FEC
 * en se basant sur les alias définis dans `FIELDS` et sur l'analyse heuristique des données.
 */
function autoMap(headers: string[], sampleRows: any[] = []) {
  const lh = headers.map(h => h.toLowerCase().trim());
  const m: Record<string, string> = {};
  const mappedHeaders = new Set<string>();

  // 1. Analyse par Alias (Priorité 1)
  FIELDS.forEach(f => {
    const found = f.aliases.find(a => lh.includes(a.toLowerCase()));
    if (found) {
      const originalHeader = headers[lh.indexOf(found.toLowerCase())];
      m[f.key] = originalHeader;
      mappedHeaders.add(originalHeader);
    }
  });

  // 2. Analyse Heuristique par données (si champ non trouvé par alias)
  if (sampleRows.length > 0) {
    headers.forEach(h => {
      if (mappedHeaders.has(h)) return;

      const values = sampleRows.map(r => String(r[h] || '').trim()).filter(v => v !== '');
      if (values.length === 0) return;

      // Heuristique : CompteNum (commence par des chiffres, souvent 4, 5, 6, 7)
      if (!m.CompteNum && values.every(v => /^[0-9]{3,}/.test(v)) && h.toLowerCase().includes('comp')) {
         m.CompteNum = h;
         mappedHeaders.add(h);
      }
      
      // Heuristique : Dates
      if (!m.EcritureDate && values.every(v => /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$|^\d{8}$/.test(v))) {
         m.EcritureDate = h;
         mappedHeaders.add(h);
      }

      // Heuristique : Montants
      if (!m.Debit && !m.Credit && values.every(v => !isNaN(parseAmt(v))) && (h.toLowerCase().includes('mont') || h.toLowerCase().includes('val'))) {
         if (!m.Montant || m.Montant === '__ignore__') m.Montant = h;
      }
    });
  }

  // Remplissage par défaut pour les champs non trouvés
  FIELDS.forEach(f => {
    if (!m[f.key]) m[f.key] = '__ignore__';
  });

  return m;
}

/**
 * Normalise une chaîne de caractères représentant une date au format JJ/MM/AAAA.
 */
function normDate(s: string) {
  if (!s || !s.trim()) return '';
  const t = s.trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const [y, m, d] = t.split('-'); return `${d}/${m}/${y}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) { const [d, m, y] = t.split('-'); return `${d}/${m}/${y}`; }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(t)) { const [d, m, y] = t.split('.'); return `${d}/${m}/${y}`; }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(t)) { const [y, m, d] = t.split('/'); return `${d}/${m}/${y}`; }
  return t;
}

/**
 * Parse un montant (chaîne ou nombre) en un nombre décimal valide.
 * Gère différents formats (ex: "1 234,56", "1.234,56", "1234.56").
 */
function parseAmt(s: any): number {
  if (s === null || s === undefined || s === '') return NaN;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/\s/g, '').replace(/\u00A0/g, '');
  if (t.includes('.') && t.includes(',')) {
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (t.includes(',')) {
    t = t.replace(',', '.');
  }
  const n = parseFloat(t.replace(/[^\d.\-]/g, ''));
  return n;
}

/**
 * Détermine si une ligne correspond à une ligne de totalisation (ex: "Total", "Report à nouveau").
 * Ces lignes doivent souvent être ignorées lors de l'import.
 */
function isTotalRow(row: Record<string, string>, mapping: Record<string, string>) {
  const cNum = (row[mapping.CompteNum] || '').trim();
  const lib = (row[mapping.EcritureLib] || '').toLowerCase();
  const totPat = /\btotal\b|\breport\b|à nouveau|\ban\b/;
  return (cNum === '' && totPat.test(lib)) || /\btotal\b/i.test(cNum);
}

/**
 * Formate une feuille Excel pour l'export Pennylane.
 */
function formatExcelSheet(ws: XLSX.WorkSheet, dateFormat: string, numberFormat: string) {
  ws['!cols'] = [14, 22, 16, 14, 14, 30, 18, 14, 40, 16, 16].map(w => ({ wch: w }));
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:K1');
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const dEc = ws[XLSX.utils.encode_cell({ r: R, c: 3 })]; // Date Écriture (D)
    const dPi = ws[XLSX.utils.encode_cell({ r: R, c: 7 })]; // Date Pièce (H)
    const deb = ws[XLSX.utils.encode_cell({ r: R, c: 9 })]; // Débit (J)
    const cre = ws[XLSX.utils.encode_cell({ r: R, c: 10 })]; // Crédit (K)
    if (dEc && (dEc.t === 'd' || dEc.t === 'n')) dEc.z = dateFormat;
    if (dPi && (dPi.t === 'd' || dPi.t === 'n')) dPi.z = dateFormat;
    if (deb && deb.t === 'n') deb.z = numberFormat;
    if (cre && cre.t === 'n') cre.z = numberFormat;
  }
}

/**
 * Transforme les lignes brutes du fichier source en lignes formatées pour le FEC.
 * Applique le mapping, normalise les dates, fusionne les comptes auxiliaires (pour Pennylane),
 * et gère les différents formats de montants (Débit/Crédit séparés ou Montant/Sens).
 */
function transformRows(rows: any[], mapping: Record<string, string>, fmt: string) {
  const logs: { line: number, type: 'date' | 'amt', msg: string }[] = [];
  
  const transData = rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => !isTotalRow(row, mapping))
    .map(({ row, index }) => {
      const out: any = { _lineNum: index + 2 };
      FIELDS.forEach(f => {
        if (['Debit', 'Credit', 'Montant', 'Sens'].includes(f.key)) return;
        const src = mapping[f.key];
        out[f.key] = (src && src !== '__ignore__' && row[src] !== undefined) ? row[src] : '';
      });

      const rawDate = out.EcritureDate;
      out.EcritureDate = normDate(out.EcritureDate);
      if (!out.EcritureDate && rawDate) {
        logs.push({ line: index + 2, type: 'date', msg: `Date d'écriture invalide : "${rawDate}"` });
      }

      if (out.PieceDate) {
        const rawPDate = out.PieceDate;
        out.PieceDate = normDate(out.PieceDate);
        if (!out.PieceDate && rawPDate) {
          logs.push({ line: index + 2, type: 'date', msg: `Date de pièce invalide : "${rawPDate}"` });
        }
      }

      // Fusion des comptes auxiliaires pour Pennylane
      const auxNum = (out.CompAuxNum || '').trim();
      if (auxNum) {
        const baseCompte = (out.CompteNum || '').trim();
        out.CompteNum = baseCompte.substring(0, 3) + auxNum;
        const auxLib = (out.CompAuxLib || '').trim();
        if (auxLib) {
          out.CompteLib = auxLib;
        }
      }

      if (fmt === 'A') {
        const ds = mapping.Debit !== '__ignore__' ? mapping.Debit : null;
        const cs = mapping.Credit !== '__ignore__' ? mapping.Credit : null;
        const rawD = ds ? parseAmt(row[ds]) : 0;
        const rawC = cs ? parseAmt(row[cs]) : 0;
        
        let d = isNaN(rawD) ? 0 : rawD;
        let c = isNaN(rawC) ? 0 : rawC;

        if (ds && isNaN(rawD) && row[ds]) logs.push({ line: index+2, type: 'amt', msg: `Montant débit invalide : "${row[ds]}"` });
        if (cs && isNaN(rawC) && row[cs]) logs.push({ line: index+2, type: 'amt', msg: `Montant crédit invalide : "${row[cs]}"` });

        // Raffinement : Un débit négatif est comptablement un crédit positif, et vice-versa.
        if (d < 0) {
          c = (c || 0) + Math.abs(d);
          d = 0;
        }
        if (c < 0) {
          d = (d || 0) + Math.abs(c);
          c = 0;
        }
        
        out.Debit = d;
        out.Credit = c;
      } else if (fmt === 'B') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const ss = mapping.Sens !== '__ignore__' ? mapping.Sens : null;
        const rawAmt = ms ? parseAmt(row[ms]) : 0;
        let amt = isNaN(rawAmt) ? 0 : rawAmt;
        let rawSens = ss ? (row[ss] || '').trim().toUpperCase() : 'D';
        
        // Normalisation du sens (plus robuste : gère 1/2, +/-, etc.)
        let isDebit = ['D', 'DEBIT', 'DÉBIT', '1', '+'].includes(rawSens);
        let isCredit = ['C', 'CREDIT', 'CRÉDIT', '2', '-'].includes(rawSens);
        
        if (ms && isNaN(rawAmt) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });

        // Si le montant est négatif, on inverse le sens
        if (amt < 0) {
          amt = Math.abs(amt);
          // Inversion de la variable de sens détectée
          if (isDebit) { isDebit = false; isCredit = true; }
          else if (isCredit) { isCredit = false; isDebit = true; }
          else { isDebit = false; isCredit = true; } // Par défaut sur crédit si on bascule un négatif inconnu
        }
        
        out.Debit = isDebit ? amt : 0;
        out.Credit = isCredit ? amt : 0;
      } else if (fmt === 'C_pos_debit') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const rawAmt = ms ? parseAmt(row[ms]) : 0;
        const amt = isNaN(rawAmt) ? 0 : rawAmt;
        if (ms && isNaN(rawAmt) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });
        out.Debit = Math.max(0, amt); out.Credit = Math.max(0, -amt);
      } else if (fmt === 'C_pos_credit') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const rawAmt = ms ? parseAmt(row[ms]) : 0;
        const amt = isNaN(rawAmt) ? 0 : rawAmt;
        if (ms && isNaN(rawAmt) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });
        out.Credit = Math.max(0, amt); out.Debit = Math.max(0, -amt);
      }
      return out;
    });

  return { data: transData, logs };
}

/**
 * Formate un nombre avec 2 décimales selon la locale française.
 */
function fmt2(n: number) { return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/**
 * Retourne un libellé lisible pour les séparateurs CSV courants.
 */
function sepLabel(s: string) { return s === '\t' ? 'Tabulation' : s === ';' ? 'Point-virgule' : s === ',' ? 'Virgule' : s === '|' ? 'Pipe' : s; }

/**
 * Détermine le format des montants (A, B, C_pos_debit, C_pos_credit) en fonction du mapping.
 * A: Colonnes Débit et Crédit séparées.
 * B: Colonne Montant et colonne Sens (D/C).
 * C: Colonne Montant unique avec convention de signe.
 */
function det(mapping: Record<string, string>, signConv: string) {
  const hD = mapping.Debit !== '__ignore__', hC = mapping.Credit !== '__ignore__';
  const hM = mapping.Montant !== '__ignore__', hS = mapping.Sens !== '__ignore__';
  if (hD && hC) return 'A';
  if (hM && hS) return 'B';
  if (hM) return signConv;
  return null;
}

/**
 * Valide les comptes comptables pour détecter les anomalies :
 * - Caractères invalides (non alphanumériques).
 * - Numéros trop courts (< 3 caractères).
 * - Libellés multiples pour un même numéro de compte.
 * @returns Un objet contenant les anomalies détectées.
 */
/**
 * Utilitaire de recherche avancée supportant les opérateurs booléens (AND, OR, NOT), 
 * les phrases exactes (entre guillemets), les exclusions (signe moins) et les préfixes de champs.
 * Exemple : journal:VENTE AND (client:Dupont OR client:Durand) -facture
 */
function matchAdvancedQuery(item: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const qWithSpaces = query.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ');
  const q = qWithSpaces.trim();

  // Préparation des données de l'item (mise en minuscule et stringification)
  const isString = typeof item === 'string';
  const data: Record<string, string> = isString 
    ? { _all: item.toLowerCase() } 
    : Object.entries(item).reduce((acc, [k, v]) => {
        acc[k.toLowerCase()] = (v || '').toString().toLowerCase();
        return acc;
      }, {} as Record<string, string>);

  const globalText = isString ? data._all : Object.values(data).join(' ');

  const evaluate = (subQuery: string): boolean => {
    let processed = subQuery.trim();
    if (!processed) return true;

    // 1. Résolution récursive des parenthèses
    while (processed.includes('(')) {
      let start = -1;
      let depth = 0;
      for (let i = 0; i < processed.length; i++) {
        if (processed[i] === '(') {
          if (start === -1) start = i;
          depth++;
        } else if (processed[i] === ')') {
          depth--;
          if (depth === 0 && start !== -1) {
            const inner = processed.slice(start + 1, i);
            const res = evaluate(inner);
            processed = processed.slice(0, start) + (res ? ' TRUE_TOKEN ' : ' FALSE_TOKEN ') + processed.slice(i + 1);
            break;
          }
        }
      }
      if (depth !== 0) break; // Mal formé
    }

    // 2. Gestion du OU (OR) - Priorité basse
    const orParts = processed.split(/\s+or\s+/i);
    if (orParts.length > 1) {
      return orParts.some(p => evaluate(p));
    }

    // 3. Gestion du ET (AND)
    const andParts = processed.split(/\s+and\s+/i);
    if (andParts.length > 1) {
      return andParts.every(p => evaluate(p));
    }

    // 4. Termes individuels, expressions, etc.
    const tokens = processed.match(/"[^"]+"|\S+/g) || [];
    let overallResult = true;

    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i];
      if (token === 'TRUE_TOKEN') continue;
      if (token === 'FALSE_TOKEN') { overallResult = false; continue; }

      let isNegated = false;
      if (token.toLowerCase() === 'not' && i + 1 < tokens.length) {
        isNegated = true; i++; token = tokens[i];
      } else if (token.startsWith('-')) {
        isNegated = true; token = token.slice(1);
      }
      if (!token) continue;

      let prefix = '';
      let val = token;
      if (val.includes(':') && !val.startsWith('"')) {
        const idx = val.indexOf(':');
        prefix = val.slice(0, idx).toLowerCase();
        val = val.slice(idx + 1);
      }

      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      const searchVal = val.toLowerCase();
      if (!searchVal && !prefix) continue;

      let found = false;
      if (prefix) {
        if (prefix === 'journal' || prefix === 'j') {
          found = (data.journalcode || '').includes(searchVal) || (data.journallib || '').includes(searchVal);
        } else if (prefix === 'compte' || prefix === 'c' || prefix === 'client') {
          found = (data.comptenum || '').includes(searchVal) || (data.comptelib || '').includes(searchVal);
        } else if (prefix === 'piece' || prefix === 'p' || prefix === 'ref') {
          found = (data.pieceref || '').includes(searchVal);
        } else if (prefix === 'lib' || prefix === 'e') {
          found = (data.ecriturelib || '').includes(searchVal);
        } else if (prefix === 'num') {
          found = (data.ecriturenum || '').includes(searchVal);
        } else if (prefix === 'date') {
          found = (data.ecrituredate || '').includes(searchVal);
        } else {
          found = (data[prefix] || '').includes(searchVal);
        }
      } else {
        found = globalText.includes(searchVal);
      }

      if (isNegated) {
        if (found) return false;
      } else {
        if (!found) overallResult = false;
      }
    }
    return overallResult;
  };

  return evaluate(q);
}

function validateAccounts(rows: any[]) {
  const accountMap = new Map<string, Map<string, { lib: string, lines: number[] }>>();
  const invalidAccountsMap = new Map<string, { reason: string, firstLib: string, lines: number[] }>();
  
  rows.forEach(r => {
    const num = (r.CompteNum || '').trim();
    const lib = (r.CompteLib || '').trim();
    const lineNum = r._lineNum;

    if (num) {
      if (!/^[A-Z0-9]+$/i.test(num)) {
        if (!invalidAccountsMap.has(num)) {
          invalidAccountsMap.set(num, { reason: 'Caractères invalides (non alphanumériques)', firstLib: lib, lines: [] });
        }
        invalidAccountsMap.get(num)!.lines.push(lineNum);
      } else if (num.length < 3) {
        if (!invalidAccountsMap.has(num)) {
          invalidAccountsMap.set(num, { reason: 'Numéro trop court (< 3 caractères)', firstLib: lib, lines: [] });
        }
        invalidAccountsMap.get(num)!.lines.push(lineNum);
      }

      if (lib) {
        if (!accountMap.has(num)) {
          accountMap.set(num, new Map());
        }
        const normalizedLib = lib.replace(/\s+/g, ' ').toUpperCase();
        if (!accountMap.get(num)!.has(normalizedLib)) {
          accountMap.get(num)!.set(normalizedLib, { lib, lines: [] });
        }
        accountMap.get(num)!.get(normalizedLib)!.lines.push(lineNum);
      }
    }
  });

  const multipleLibs: { compte: string, variants: { lib: string, lines: number[] }[] }[] = [];
  accountMap.forEach((libMap, num) => {
    if (libMap.size > 1) {
      multipleLibs.push({
        compte: num,
        variants: Array.from(libMap.values())
      });
    }
  });

  const invalidAccounts = Array.from(invalidAccountsMap.entries()).map(([compte, data]) => ({ compte, ...data }));

  return { multipleLibs, invalidAccounts };
}

/**
 * Convertit une chaîne de date (JJ/MM/AAAA) en un objet Date pour l'export Excel.
 */
function parseDateToExcel(s: string) {
  if (!s) return '';
  const parts = s.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return new Date(Date.UTC(+y, +m - 1, +d));
  }
  return s;
}

/**
 * Extrait le texte d'un fichier PDF en conservant l'ordre des lignes (basé sur les coordonnées Y).
 * Propose une option OCR via Tesseract.js pour les scans d'images.
 */
async function extractTextFromPDF(file: File, useOcr = false, lang = 'fra', onProgress?: (p: number) => void) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise.catch((err: any) => {
      if (err.name === 'PasswordException') throw new Error("Le fichier PDF est protégé.");
      if (err.name === 'InvalidPDFException') throw new Error("Le fichier PDF est invalide ou corrompu.");
      throw new Error(`Erreur d'ouverture PDF : ${err.message}`);
    });

    if (pdf.numPages === 0) throw new Error("Le document PDF ne contient aucune page.");

    let fullText = '';
    
    // Chargement dynamique de Tesseract.js si nécessaire
    let tesseractService: any = null;
    if (useOcr) {
      tesseractService = (await import('tesseract.js')).default;
    }
    
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress((i / pdf.numPages) * 100);
      
      try {
        const page = await pdf.getPage(i);
        
        if (useOcr && tesseractService) {
          // Mode OCR : rendu de la page en image puis Tesseract
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error("Impossible d'initialiser le contexte canvas.");
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({ canvasContext: context, viewport }).promise;
          const { data: { text } } = await tesseractService.recognize(canvas, lang);
          fullText += text + '\n';
        } else {
          // Mode standard : extraction de la couche texte
          const textContent = await page.getTextContent();
          if (textContent.items.length === 0 && i === 1 && pdf.numPages === 1) {
            // Tentative auto-détection scan sur page unique
            console.warn("Aucun texte détecté sur la page 1, suggérez l'OCR.");
          }
          
          const itemsByY: Record<number, any[]> = {};
          textContent.items.forEach((item: any) => {
            if (!item.transform || item.transform.length < 6) return;
            const y = Math.round(item.transform[5]);
            if (!itemsByY[y]) itemsByY[y] = [];
            itemsByY[y].push(item);
          });
          
          const sortedY = Object.keys(itemsByY).map(Number).sort((a, b) => b - a);
          for (const y of sortedY) {
            const lineItems = itemsByY[y].sort((a, b) => a.transform[4] - b.transform[4]);
            fullText += lineItems.map(item => item.str).join(' ') + '\n';
          }
        }
      } catch (pageErr: any) {
        console.warn(`Erreur page ${i} :`, pageErr);
      }
    }
    
    if (!fullText.trim() && !useOcr) {
      throw new Error("Aucun texte extrait. Essayez d'activer l'option OCR pour ce document scanné.");
    }
    
    return fullText;
  } catch (err: any) {
    throw err;
  }
}

/**
 * Parse un fichier de balance (PDF, XLS, XLSX, CSV) pour extraire les soldes par compte.
 * @returns Un dictionnaire associant chaque numéro de compte à son libellé et son solde.
 */
async function parseBalanceFile(file: File, useOcr = false, lang = 'fra', onProgress?: (p: number) => void) {
  if (file.size === 0) throw new Error("Le fichier de balance est vide et ne peut pas être traité. Veuillez vous assurer que le fichier contient des données avant de l'importer.");
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  if (!['pdf', 'xls', 'xlsx', 'csv'].includes(ext || '')) {
    throw new Error(`Format de fichier non supporté pour la balance (.${ext}). Veuillez utiliser un fichier .pdf, .xls, .xlsx ou .csv.`);
  }

  const balSoldes: Record<string, { lib: string, solde: number }> = {};

  if (ext === 'pdf') {
    const text = await extractTextFromPDF(file, useOcr, lang, onProgress);
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimLine = line.trim();
      if (!trimLine) return;

      // Recherche d'un numéro de compte (3 à 15 chiffres)
      const accMatch = trimLine.match(/^([0-9]{3,15})\s+(.*)/);
      if (accMatch) {
        const acc = accMatch[1];
        const rest = accMatch[2].trim();
        
        // On cherche les montants en fin de ligne (plusieurs colonnes possibles : Débit, Crédit, Solde)
        // On extrait tous les blocs numériques identifiables
        const numBlocks = rest.match(/((?:^|\s)-?[\d\s]+[.,]\d+|(?:\s|^)-?\d+)/g);
        
        if (numBlocks && numBlocks.length > 0) {
          // Le libellé est ce qui reste entre le compte et les nombres
          const lastNumBlock = numBlocks[numBlocks.length - 1];
          const lib = rest.slice(0, rest.lastIndexOf(lastNumBlock)).trim();
          
          const nums = numBlocks.map(v => parseAmt(v)).filter(n => !isNaN(n));
          if (nums.length > 0) {
            let solde = 0;
            // APPLICATION REGLE : Solde = débits - crédit si plusieurs colonnes
            if (nums.length >= 2) {
              // On prend les deux premiers montants identifiés comme Débit et Crédit
              solde = nums[0] - nums[1];
            } else {
              // Une seule colonne : c'est le solde direct
              solde = nums[0];
            }
            
            balSoldes[acc] = { lib, solde };
          }
        }
      }
    });
  } else {
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    rows.forEach(row => {
      if (!row || !row.length) return;
      const acc = String(row[0] || '').trim();
      if (/^[1-9][0-9a-zA-Z]{2,14}$/.test(acc)) {
        const lib = String(row[1] || '').trim();
        const nums = row.slice(2).map(v => parseAmt(String(v))).filter(v => !isNaN(v));
        let solde = 0;
        
        // APPLICATION REGLE : Solde = débits - crédit si au moins 2 colonnes de montants
        if (nums.length >= 2) {
          // On calcule le solde net (Débit - Crédit)
          solde = nums[0] - nums[1];
        } else if (nums.length === 1) {
          // Un seul montant présent : on le considère comme le solde
          solde = nums[0];
        }
        
        balSoldes[acc] = { lib, solde };
      }
    });
  }
  
  if (Object.keys(balSoldes).length === 0) {
    throw new Error("Aucun compte n'a pu être extrait. Vérifiez que la balance contient bien des numéros de compte et des montants lisibles.");
  }
  
  return balSoldes;
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function App() {
  // --- Authentification Cloud ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- Thème ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' || 
           (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const [themeId, setThemeId] = useState(() => localStorage.getItem('app_theme_id') || 'indigo');
  const [customColors, setCustomColors] = useState(() => {
    const saved = localStorage.getItem('app_custom_colors');
    return saved ? JSON.parse(saved) : {
      bgPrimary: '',
      bgSecondary: '',
      textPrimary: '',
      accentPrimary: ''
    };
  });
  const [showThemeSettings, setShowThemeSettings] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }

    // Application des couleurs
    if (themeId !== 'custom') {
      const theme = PREDEFINED_THEMES.find(t => t.id === themeId);
      if (theme) {
        root.style.setProperty('--accent-primary', theme.color);
        root.style.setProperty('--accent-hover', theme.color + 'E6');
        // Reset custom backgrounds/text
        root.style.removeProperty('--bg-primary');
        root.style.removeProperty('--bg-secondary');
        root.style.removeProperty('--text-primary');
      }
    } else {
      if (customColors.bgPrimary) root.style.setProperty('--bg-primary', customColors.bgPrimary);
      if (customColors.bgSecondary) root.style.setProperty('--bg-secondary', customColors.bgSecondary);
      if (customColors.textPrimary) root.style.setProperty('--text-primary', customColors.textPrimary);
      if (customColors.accentPrimary) {
        root.style.setProperty('--accent-primary', customColors.accentPrimary);
        root.style.setProperty('--accent-hover', customColors.accentPrimary + 'E6');
      }
    }

    localStorage.setItem('app_theme_id', themeId);
    localStorage.setItem('app_custom_colors', JSON.stringify(customColors));
  }, [isDarkMode, themeId, customColors]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (user) {
        fetchCloudPresets(user.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setPresets([]);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  // --- Synchronisation Cloud & Locale des Presets ---
  const fetchCloudPresets = async (userId: string) => {
    try {
      const q = query(collection(db, 'mappingProfiles'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      const cloudPresets: any[] = [];
      querySnapshot.forEach((doc) => {
        cloudPresets.push({ id: doc.id, ...doc.data(), isCloud: true });
      });
      
      // On fusionne avec le local
      const localPresets = JSON.parse(localStorage.getItem('fec_mapping_presets') || '[]');
      const merged = [...cloudPresets];
      localPresets.forEach((lp: any) => {
        if (!merged.find(cp => cp.name === lp.name)) {
          merged.push({ ...lp, isCloud: false });
        }
      });
      
      setPresets(merged);
    } catch (error) {
      console.error("Error fetching presets:", error);
    }
  };

  const savePreset = async (name: string, mappingData: any, fmt: string) => {
    if (!name.trim()) return;
    
    const newPreset = { name, mapping: mappingData, amtFmt: fmt };
    
    // 1. Sauvegarde locale
    const localPresets = JSON.parse(localStorage.getItem('fec_mapping_presets') || '[]');
    const updatedLocal = [...localPresets.filter((p: any) => p.name !== name), newPreset];
    localStorage.setItem('fec_mapping_presets', JSON.stringify(updatedLocal));

    // 2. Sauvegarde Cloud si connecté
    if (currentUser) {
      try {
        const docRef = await addDoc(collection(db, 'mappingProfiles'), {
          userId: currentUser.uid,
          ...newPreset,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setPresets(prev => [...prev.filter(p => p.name !== name), { id: docRef.id, ...newPreset, isCloud: true }]);
      } catch (error) {
        console.error("Error toggling cloud save:", error);
        setPresets(updatedLocal.map(p => ({ ...p, isCloud: false })));
      }
    } else {
      setPresets(updatedLocal.map(p => ({ ...p, isCloud: false })));
    }
    
    setActivePreset(name);
    setNewPresetName('');
  };

  const deletePreset = async (preset: { id?: string, name: string, isCloud?: boolean }) => {
    try {
      // Suppression Cloud
      if (preset.isCloud && preset.id) {
        await deleteDoc(doc(db, 'mappingProfiles', preset.id));
      }
      
      // Suppression Locale
      const localPresets = JSON.parse(localStorage.getItem('fec_mapping_presets') || '[]');
      const updatedLocal = localPresets.filter((p: any) => p.name !== preset.name);
      localStorage.setItem('fec_mapping_presets', JSON.stringify(updatedLocal));
      
      setPresets(prev => prev.filter(p => p.name !== preset.name));
      if (activePreset === preset.name) setActivePreset(null);
    } catch (error) {
      console.error("Error deleting preset:", error);
    }
  };

  // --- Intelligence Artificielle (Gemini) ---
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const handleAiMappingSuggestion = async () => {
    if (!rawData) return;
    setIsAiLoading(true);
    const suggestion = await suggestMapping(rawData.headers, FIELDS);
    if (suggestion) {
      setMapping(prev => ({ ...prev, ...suggestion }));
      setAmtFmt(det({ ...mapping, ...suggestion }, signConv) || 'A');
    }
    setIsAiLoading(false);
  };

  const handleAiAnomalyAnalysis = async () => {
    if (!accountAnomalies) return;
    setIsAiLoading(true);
    const analysis = await analyzeAnomalies(accountAnomalies);
    setAiAnalysis(analysis);
    setIsAiLoading(false);
  };

  // --- État du processus d'import/export ---
  type StepId = typeof STEP_CONFIG[number]['id'];
  const [step, setStep] = useState<StepId>(1); // 1: Upload, 2: Mapping, 3: Preview, 4: Balance Check
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [rawData, setRawData] = useState<{ headers: string[], rows: any[], encoding: string, separator: string } | null>(null);
  const [encOpt, setEncOpt] = useState('auto');
  const [sepOpt, setSepOpt] = useState('auto');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [amtFmt, setAmtFmt] = useState('A');
  const [signConv, setSignConv] = useState('C_pos_debit');
  const [transformed, setTransformed] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [warns, setWarns] = useState<string[]>([]);
  
  // --- Options d'export et d'affichage ---
  const [exportFileName, setExportFileName] = useState('');
  const [numberFormat, setNumberFormat] = useState(NUMBER_FORMATS[0].value);
  const [dateFormat, setDateFormat] = useState(DATE_FORMATS[0].value);
  const [searchQuery, setSearchQuery] = useState('');
  const [libFilter, setLibFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['JournalCode', 'EcritureDate', 'CompteNum', 'EcritureLib', 'Debit', 'Credit']);
  const [showColSelector, setShowColSelector] = useState(false);
  const [colSearch, setColSearch] = useState('');
  
  // --- Organisation du Mapping (Étape 2) ---
  const [mapSearch, setMapSearch] = useState('');
  const [mapFieldsOrder, setMapFieldsOrder] = useState<string[]>(FIELDS.map(f => f.key));
  const [visibleMapFields, setVisibleMapFields] = useState<string[]>(FIELDS.map(f => f.key));
  const [showMapFieldsSelector, setShowMapFieldsSelector] = useState(false);
  
  // --- Anomalies détectées ---
  const [accountAnomalies, setAccountAnomalies] = useState<{
    multipleLibs: { compte: string, variants: { lib: string, lines: number[] }[] }[],
    invalidAccounts: { compte: string, reason: string, lines: number[] }[]
  } | null>(null);
  const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<'all' | 'invalid' | 'multiple'>('all');
  const [anomalySearch, setAnomalySearch] = useState('');
  const [anomalySort, setAnomalySort] = useState<'asc' | 'desc'>('asc');

  // --- Presets de mapping ---
  const [presets, setPresets] = useState<{ id?: string, name: string, mapping: Record<string, string>, amtFmt: string, isCloud?: boolean }[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // --- Mode Batch ---
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [currentFileIdx, setCurrentFileIdx] = useState<number | null>(null);
  const [batchResults, setBatchResults] = useState<{ 
    name: string, 
    rows: number, 
    debit: number, 
    credit: number, 
    error?: string, 
    data?: any[], 
    status: 'pending' | 'processing' | 'success' | 'error',
    progress: number,
    duration?: number
  }[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);
  const [currentFileStep, setCurrentFileStep] = useState('');
  const [batchLogs, setBatchLogs] = useState<string[]>([]);
  const [batchResFilter, setBatchResFilter] = useState<'all' | 'success' | 'error'>('all');

  // --- Vérification de la balance ---
  const [balanceFile, setBalanceFile] = useState<File | null>(null);
  const [balSoldes, setBalSoldes] = useState<Record<string, { lib: string, solde: number }>>({});
  const [loadingBal, setLoadingBal] = useState(false);
  const [balProgress, setBalProgress] = useState(0);
  const [useOcr, setUseOcr] = useState(false);
  const [ocrLanguage, setOcrLanguage] = useState('fra');
  const [balanceTolerance, setBalanceTolerance] = useState(0.01);
  const [errBal, setErrBal] = useState('');
  const [fileNameBal, setFileNameBal] = useState('');
  const [balFilter, setBalFilter] = useState<'all' | 'errors' | 'missing-fec' | 'missing-bal' | 'ok' | 'diff-only'>('all');
  const [balSearch, setBalSearch] = useState('');
  const [balSortConfig, setBalSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [showBalRaw, setShowBalRaw] = useState(false);
  const [balRawText, setBalRawText] = useState('');
  const [normLevel, setNormLevel] = useState<'full' | '3' | '6'>('full');
  const [selectedNorm, setSelectedNorm] = useState<string | null>(null);
  const [sidePanelSearch, setSidePanelSearch] = useState('');
  const [lastSuccessfulBal, setLastSuccessfulBal] = useState<{ name: string, soldes: Record<string, { lib: string, solde: number }> } | null>(null);
  const [pdfRetryWithOcr, setPdfRetryWithOcr] = useState<File | null>(null);

  // --- Références DOM ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const balInputRef = useRef<HTMLInputElement>(null);

  // ============================================================================
  // GESTION DES FICHIERS ET ACTIONS
  // ============================================================================

  /**
   * Gère le téléchargement et le parsing initial du fichier FEC.
   */
  const handleFile = async (f: File, eOpt = encOpt, sOpt = sepOpt) => {
    setLoading(true); setErr(''); setWarns([]);
    try {
      if (f.size === 0) {
        throw new Error("Le fichier FEC est vide (0 octet). Suggestion : Vérifiez l'intégrité de votre export depuis votre logiciel comptable.");
      }
      
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (!['txt', 'csv'].includes(ext || '')) {
        throw new Error(`Format .${ext} non supporté. Suggestion : Le format FEC officiel doit être un fichier texte (.txt) ou CSV (.csv). Veuillez convertir votre document.`);
      }

      const { text, encoding } = await detectAndDecode(f, eOpt === 'auto' ? '' : eOpt);
      const sep = detectSep(text, sOpt === 'auto' ? '' : sOpt);
      const { headers, rows } = parseCSV(text, sep);
      
      if (!headers.length || headers.every(h => !h)) {
        throw new Error(`Structure illisible. Suggestion : Le séparateur (${sepLabel(sep)}) semble incorrect ou l'encodage (${encoding}) est inadapté. Tentez de forcer l'encodage sur 'Latin-1 (ANSI)' dans les paramètres.`);
      }
      
      if (!rows.length) {
        throw new Error("Fichier vide de données. Suggestion : Le fichier contient des en-têtes mais aucune écriture comptable n'a été détectée.");
      }

      // Vérification sommaire de la validité (au moins 18 colonnes attendues pour un FEC)
      if (headers.length < 5) {
        setWarns(prev => [...prev, `Anomalie de structure : Seulement ${headers.length} colonnes détectées. Un FEC standard (norme A47) contient normalement au moins 18 colonnes obligatoires.`]);
      }
      
      setRawData({ headers, rows, encoding, separator: sep });
      setFile(f);
      setFileName(f.name);
      
      const defaultExportName = f.name.replace(/\.[^.]+$/, '') + '_pennylane';
      setExportFileName(defaultExportName);
      
      // Si un profil de mapping est actif, on l'applique
      const presetToApply = presets.find(p => p.name === activePreset);
      if (presetToApply) {
        const filteredMap: Record<string, string> = {};
        Object.entries(presetToApply.mapping).forEach(([k, v]) => {
          if (headers.includes(v as string) || v === '__ignore__') {
            filteredMap[k] = v as string;
          }
        });
        setMapping(filteredMap);
        setAmtFmt(presetToApply.amtFmt);
        if (presetToApply.amtFmt.startsWith('C_')) setSignConv(presetToApply.amtFmt);
      } else {
        const initialMap = autoMap(headers, rows.slice(0, 10));
        setMapping(initialMap);
        setAmtFmt(det(initialMap, signConv) || 'A');
      }

      setErr('');
    } catch (e: any) {
      setErr(e.message || 'Erreur inconnue lors de la lecture du fichier FEC.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Gère le chargement de plusieurs fichiers (Mode Batch).
   */
  const handleBatchFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    // Filtrage des fichiers supportés
    const validFiles = fileList.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ['txt', 'csv'].includes(ext || '');
    });

    if (validFiles.length < fileList.length) {
      const skippedCount = fileList.length - validFiles.length;
      setWarns(prev => [...prev, `${skippedCount} fichier(s) ignoré(s) car le format n'est pas .txt ou .csv.`]);
    }

    if (validFiles.length === 0) {
      setErr("Aucun fichier valide sélectionné. Suggestion : Assurez-vous d'importer des fichiers FEC au format texte (.txt) ou .csv.");
      return;
    }
    
    if (validFiles.length === 1) {
      setBatchFiles([]);
      handleFile(validFiles[0]);
    } else {
      setBatchFiles(validFiles);
      // On utilise le premier fichier comme template pour le mapping
      handleFile(validFiles[0]);
    }
  };

  /**
   * Gère le glisser-déposer d'un fichier.
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      handleBatchFiles(e.dataTransfer.files);
    }
  };

  /**
   * Gère le glisser-déposer d'un fichier de balance.
   */
  const handleBalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleBalanceCheck(f);
  };

  /**
   * Valide le mapping des colonnes et lance la transformation des données.
   * Vérifie que les champs obligatoires sont bien mappés.
   */
  const handleValidateMapping = async () => {
    const req = FIELDS.filter(f => f.req).map(f => f.key);
    const mapped = Object.entries(mapping).filter(([_, v]) => v && v !== '__ignore__');
    const missing = req.filter(k => !mapping[k] || mapping[k] === '__ignore__');
    
    if (missing.length) {
      setErr('Champs obligatoires manquants : ' + missing.map(k => FIELDS.find(f => f.key === k)?.label).join(', '));
      return;
    }

    // Détection des conflits de mapping (même colonne source utilisée pour plusieurs champs cibles distincts)
    // Sauf cas particuliers autorisés (ex: PieceRef et PieceDate peuvent parfois provenir de la même colonne si mal formés, mais c'est rare)
    const sourceUsage: Record<string, string[]> = {};
    mapped.forEach(([target, source]) => {
      const src = source as string;
      if (!sourceUsage[src]) sourceUsage[src] = [];
      sourceUsage[src].push(FIELDS.find(f => f.key === target)?.label || target);
    });

    const conflicts = Object.entries(sourceUsage).filter(([_, targets]) => targets.length > 1);
    if (conflicts.length > 0) {
      const conflictMsg = conflicts.map(([src, targets]) => `La colonne "${src}" est associée à : ${targets.join(', ')}`).join('\n');
      setWarns([`Attention, des colonnes sources sont utilisées plusieurs fois :\n${conflictMsg}`]);
    } else {
      setWarns([]);
    }

    if (!amtFmt) {
      setErr('Veuillez sélectionner un format de montant pour interpréter les débits et crédits.');
      return;
    }

    setLoading(true); setErr('');
    setBatchProgress(0);
    setCurrentFileIdx(null);
    setCurrentFileStep('');

    if (batchFiles.length > 1) {
      // INITIALISATION DES RÉSULTATS BATCH
      const initialResults = batchFiles.map(f => ({
        name: f.name,
        rows: 0,
        debit: 0,
        credit: 0,
        status: 'pending' as const,
        progress: 0
      }));
      setBatchResults(initialResults);

      try {
        const finalResults = [...initialResults];
        
        for (let i = 0; i < batchFiles.length; i++) {
          const f = batchFiles[i];
          setCurrentFileIdx(i);
          setCurrentFileStep('Chargement...');
          
          // Mise à jour du statut en "processing"
          finalResults[i] = { ...finalResults[i], status: 'processing', progress: 10 };
          setBatchResults([...finalResults]);
          
          await new Promise(r => setTimeout(r, 50)); // UI Breath

          try {
            const startTime = performance.now();
            setCurrentFileStep('Décodage et détection...');
            const { text } = await detectAndDecode(f, encOpt === 'auto' ? '' : encOpt);
            finalResults[i].progress = 30;
            setBatchResults([...finalResults]);
            await new Promise(r => setTimeout(r, 20));

            setCurrentFileStep('Analyse structurelle (CSV)...');
            const sep = detectSep(text, sepOpt === 'auto' ? '' : sepOpt);
            const { rows, headers } = parseCSV(text, sep);
            finalResults[i].progress = 60;
            setBatchResults([...finalResults]);
            
            if (headers.length < 5) throw new Error("Format non reconnu");
            
            setCurrentFileStep('Transformation des données...');
            const { data: trans } = transformRows(rows, mapping, amtFmt);
            
            const endTime = performance.now();
            finalResults[i] = {
              ...finalResults[i],
              rows: trans.length,
              debit: trans.reduce((s, r) => s + (r.Debit || 0), 0),
              credit: trans.reduce((s, r) => s + (r.Credit || 0), 0),
              data: trans,
              status: 'success',
              progress: 100,
              duration: endTime - startTime
            };
            setCurrentFileStep('Terminé !');
          } catch (e: any) {
            finalResults[i] = { 
              ...finalResults[i],
              status: 'error', 
              error: e.message || 'Erreur inconnue',
              progress: 100,
              duration: 0
            };
            setCurrentFileStep('Échec');
          }

          setBatchResults([...finalResults]);
          setBatchProgress(Math.round(((i + 1) / batchFiles.length) * 100));
          await new Promise(r => setTimeout(r, 100)); // Pause visuelle
        }
        
        setCurrentFileIdx(null);
        setCurrentFileStep('');
        setStep(3);
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    } else {
      // MODE UNIQUE
      setTimeout(() => {
        try {
          const { data: res, logs } = transformRows(rawData!.rows, mapping, amtFmt);
          if (!res.length) throw new Error('Aucune ligne après transformation.');
          
          if (logs.length > 0) {
            setWarns(prev => [...prev, `${logs.length} ligne(s) présentent des anomalies de données (dates ou montants mal formés). Elles ont été intégrées mais pourraient poser problème.`]);
          }

          const anomalies = validateAccounts(res);
          setAccountAnomalies(anomalies);

          setTransformed(res);
          setStep(3);
          setErr('');
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setLoading(false);
        }
      }, 50);
    }
  };

  /**
   * Exporte les données transformées au format Excel (.xlsx).
   * Applique les formats de nombres et de dates sélectionnés.
   */
  const exportXLSX = () => {
    const wb = XLSX.utils.book_new();
    const data = transformed.map(r => ({
      'Code Journal': r.JournalCode, 'Libellé Journal': r.JournalLib,
      'N° Écriture': r.EcritureNum, 'Date Écriture': parseDateToExcel(r.EcritureDate),
      'N° Compte': r.CompteNum, 'Libellé Compte': r.CompteLib,
      'Réf. Pièce': r.PieceRef, 'Date Pièce': parseDateToExcel(r.PieceDate),
      'Libellé Écriture': r.EcritureLib,
      'Débit': r.Debit, 'Crédit': r.Credit,
    }));
    
    const ws = XLSX.utils.json_to_sheet(data, { cellDates: true });
    formatExcelSheet(ws, dateFormat, numberFormat);
    XLSX.utils.book_append_sheet(wb, ws, 'Écritures');

    const journaux = Array.from(new Set(transformed.map(r => r.JournalCode || '(vide)')));
    const recap = journaux.map(jc => {
      const rows = transformed.filter(r => (r.JournalCode || '(vide)') === jc);
      const tD = rows.reduce((s, r) => s + r.Debit, 0);
      const tC = rows.reduce((s, r) => s + r.Credit, 0);
      return {
        'Code Journal': jc, 'Libellé': rows[0]?.JournalLib || '', 'Nb Écritures': rows.length,
        'Total Débit': tD, 'Total Crédit': tC, 'Équilibré': Math.abs(tD - tC) < 0.01 ? 'OUI' : 'NON'
      };
    });
    
    const wsR = XLSX.utils.json_to_sheet(recap);
    wsR['!cols'] = [14, 24, 14, 16, 16, 12].map(w => ({ wch: w }));
    
    // Apply number formatting to Recap sheet (Total Debit = D, Total Credit = E)
    const rangeR = XLSX.utils.decode_range(wsR['!ref'] || 'A1:F1');
    for (let R = rangeR.s.r + 1; R <= rangeR.e.r; ++R) {
      const debitCell = wsR[XLSX.utils.encode_cell({ r: R, c: 3 })]; // D
      const creditCell = wsR[XLSX.utils.encode_cell({ r: R, c: 4 })]; // E
      if (debitCell && debitCell.t === 'n') debitCell.z = numberFormat;
      if (creditCell && creditCell.t === 'n') creditCell.z = numberFormat;
    }

    XLSX.utils.book_append_sheet(wb, wsR, 'Récapitulatif');

    const finalName = exportFileName.endsWith('.xlsx') ? exportFileName : exportFileName + '.xlsx';
    XLSX.writeFile(wb, finalName);
  };

  /**
   * Filtrage des résultats batch pour l'affichage et l'exportation.
   */
  const filteredBatchResults = React.useMemo(() => {
    if (batchResFilter === 'all') return batchResults;
    return batchResults.filter(r => r.status === batchResFilter);
  }, [batchResults, batchResFilter]);

  /**
   * Exporte un rapport CSV détaillé du traitement par lots (respecte le filtre).
   */
  const exportBatchReportCSV = () => {
    const dataToExport = filteredBatchResults;
    if (dataToExport.length === 0) return;
    
    let csv = "\uFEFFNom du Fichier;Statut;Nombre de Lignes;Total Débit;Total Crédit;Durée (ms);Détails / Erreurs\n";
    dataToExport.forEach(res => {
      const statusLabel = res.status === 'success' ? 'Succès' : 'Échec';
      const errorDetail = res.error ? res.error.replace(/"/g, '""') : '';
      const durationStr = res.duration ? Math.round(res.duration).toString() : '0';
      csv += `${res.name};${statusLabel};${res.rows};${res.debit.toFixed(2)};${res.credit.toFixed(2)};${durationStr};"${errorDetail}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rapport_batch_${batchResFilter !== 'all' ? batchResFilter + '_' : ''}${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  /**
   * Exporte un fichier ZIP contenant tous les fichiers Excel du batch (respecte le filtre).
   */
  const exportBatchZIP = async () => {
    const dataToExport = filteredBatchResults.filter(r => r.status === 'success' && r.data);
    if (dataToExport.length === 0) return;
    setLoading(true);
    const zip = new JSZip();
    
    for (const res of dataToExport) {
      if (!res.data) continue;
      
      const wb = XLSX.utils.book_new();
      const data = res.data.map(r => ({
        'Code Journal': r.JournalCode, 'Libellé Journal': r.JournalLib,
        'N° Écriture': r.EcritureNum, 'Date Écriture': parseDateToExcel(r.EcritureDate),
        'N° Compte': r.CompteNum, 'Libellé Compte': r.CompteLib,
        'Réf. Pièce': r.PieceRef, 'Date Pièce': parseDateToExcel(r.PieceDate),
        'Libellé Écriture': r.EcritureLib,
        'Débit': r.Debit, 'Crédit': r.Credit,
      }));
      
      const ws = XLSX.utils.json_to_sheet(data, { cellDates: true });
      formatExcelSheet(ws, dateFormat, numberFormat);
      XLSX.utils.book_append_sheet(wb, ws, 'Écritures');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${res.name.replace(/\.[^.]+$/, '')}_converted.xlsx`, excelBuffer);
    }
    
    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fec_batch_export_${batchResFilter !== 'all' ? batchResFilter + '_' : ''}${new Date().toISOString().slice(0,10)}.zip`;
      link.click();
    } catch (e) {
      console.error("ZIP Error:", e);
      setErr("Erreur lors de la génération de l'archive ZIP.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Exporte la liste des anomalies (comptes invalides et libellés multiples)
   * dans un fichier CSV pour faciliter les corrections.
   */
  const exportAnomaliesCSV = () => {
    if (!accountAnomalies) return;
    
    // En-tête du fichier CSV (BOM pour Excel UTF-8)
    let csvContent = "\uFEFFType;Compte;Libellés;Raison / Détails;Lignes FEC\n";
    
    // Ajout des comptes invalides
    accountAnomalies.invalidAccounts.forEach(a => {
      const lineRefs = a.lines.join(', ');
      csvContent += `Compte Invalide;${a.compte || ''};"${(a.firstLib || '').replace(/"/g, '""')}";"${a.reason.replace(/"/g, '""')}";"${lineRefs}"\n`;
    });
    
    // Ajout des libellés multiples
    accountAnomalies.multipleLibs.forEach(a => {
      const libs = a.variants.map(v => v.lib).join(' | ');
      const lineRefs = a.variants.map(v => v.lines.join(' ')).join(' | ');
      csvContent += `Libellés Multiples;${a.compte};"${libs.replace(/"/g, '""')}";"Conflit de libellés rencontrés";"${lineRefs}"\n`;
    });
    
    // Création du blob et téléchargement
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `anomalies_${fileName.replace(/\.[^.]+$/, '')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Exporte le résultat du contrôle de balance au format Excel.
   */
  const exportBalanceXLSX = () => {
    const wb = XLSX.utils.book_new();
    const data = comparisonData.map(r => ({
      'Compte': r.compte,
      'Libellé': r.lib,
      'Solde FEC': r.soldeFec,
      'Solde Balance': r.soldeBal,
      'Écart': r.ecart,
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [14, 40, 16, 16, 16].map(w => ({ wch: w }));
    
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:E1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const fecCell = ws[XLSX.utils.encode_cell({ r: R, c: 2 })]; // C
      const balCell = ws[XLSX.utils.encode_cell({ r: R, c: 3 })]; // D
      const ecartCell = ws[XLSX.utils.encode_cell({ r: R, c: 4 })]; // E
      
      if (fecCell && fecCell.t === 'n') fecCell.z = numberFormat;
      if (balCell && balCell.t === 'n') balCell.z = numberFormat;
      if (ecartCell && ecartCell.t === 'n') ecartCell.z = numberFormat;
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Contrôle Balance');
    
    const finalName = `controle_balance_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, finalName);
  };

  /**
   * Exporte les écritures FEC détaillées d'un groupe de comptes spécifique vers Excel.
   */
  const exportDetailedFecXLSX = (norm: string) => {
    const normalizeAccount = (acc: string) => {
      if (normLevel === 'full') return acc;
      return acc.substring(0, parseInt(normLevel));
    };

    const groupRows = transformed.filter(r => normalizeAccount(r.CompteNum) === norm);
    if (groupRows.length === 0) return;

    const wb = XLSX.utils.book_new();
    const data = groupRows.map(r => ({
      'Date': r.EcritureDate,
      'Journal': r.JournalCode,
      'N° Écr': r.EcritureNum,
      'Compte': r.CompteNum,
      'Libellé Compte': r.CompteLib,
      'Libellé Écriture': r.EcritureLib,
      'Débit': r.Debit || 0,
      'Crédit': r.Credit || 0,
      'Pièce Ref': r.PieceRef || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [12, 10, 10, 12, 30, 40, 12, 12, 15].map(w => ({ wch: w }));

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:H1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const debitCell = ws[XLSX.utils.encode_cell({ r: R, c: 6 })];
      const creditCell = ws[XLSX.utils.encode_cell({ r: R, c: 7 })];
      if (debitCell && debitCell.t === 'n') debitCell.z = numberFormat;
      if (creditCell && creditCell.t === 'n') creditCell.z = numberFormat;
    }

    XLSX.utils.book_append_sheet(wb, ws, `Détail ${norm}`);
    const finalName = `detail_fec_${norm}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, finalName);
  };

  /**
   * Réinitialise complètement l'application pour traiter un nouveau fichier.
   */
  const reset = () => {
    setStep(1); setFile(null); setFileName(''); setRawData(null);
    setMapping({}); setTransformed([]); setErr(''); setExportFileName('');
    setBalanceFile(null); setBalSoldes({}); setErrBal('');
    setAccountAnomalies(null);
  };

  /**
   * Filtre et trie les anomalies de comptes pour l'affichage.
   */
  const filteredAnomalies = React.useMemo(() => {
    if (!accountAnomalies) return { invalid: [], multiple: [] };

    const filterBySearch = (item: any, type: 'invalid' | 'multiple') => {
      if (!anomalySearch.trim()) return true;
      
      let searchableText = item.compte;
      if (type === 'invalid') {
        searchableText += ' ' + (item.reason || '');
      } else {
        searchableText += ' ' + (item.variants || []).map((v: any) => v.lib).join(' ');
      }
      
      return matchAdvancedQuery(searchableText, anomalySearch);
    };

    const sortFn = (a: { compte: string }, b: { compte: string }) => {
      const cmp = a.compte.localeCompare(b.compte, undefined, { numeric: true });
      return anomalySort === 'asc' ? cmp : -cmp;
    };

    let invalid = accountAnomalies.invalidAccounts.filter(a => filterBySearch(a, 'invalid')).sort(sortFn);
    let multiple = accountAnomalies.multipleLibs.filter(a => filterBySearch(a, 'multiple')).sort(sortFn);

    if (anomalyTypeFilter === 'invalid') multiple = [];
    if (anomalyTypeFilter === 'multiple') invalid = [];

    return { invalid, multiple };
  }, [accountAnomalies, anomalyTypeFilter, anomalySearch, anomalySort]);

  /**
   * Gère le téléchargement et l'analyse du fichier de balance (PDF/Excel/CSV).
   * Compare ensuite les soldes extraits avec ceux calculés à partir du FEC.
   */
  const handleBalanceCheck = async (f: File) => {
    setLoadingBal(true);
    setBalProgress(0);
    setErrBal('');
    setBalRawText('');
    setPdfRetryWithOcr(null);
    try {
      const isPdf = f.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const text = await extractTextFromPDF(f, useOcr, ocrLanguage, (p) => setBalProgress(Math.round(p)));
        setBalRawText(text);
        
        if (useOcr && (!text || text.trim().length === 0)) {
          throw new Error("L'analyse OCR n'a détecté aucun texte. Vérifiez que le document est lisible, que la langue sélectionnée est correcte ou essayez une autre option de langue.");
        }
      }
      const extractedSoldes = await parseBalanceFile(f, useOcr, ocrLanguage, (p) => setBalProgress(Math.round(p)));
      
      // Si on n'a rien extrait d'un PDF alors qu'on n'est pas en OCR, c'est probablement un scan
      if (isPdf && !useOcr && Object.keys(extractedSoldes).length === 0) {
        setPdfRetryWithOcr(f);
        throw new Error("Aucune donnée extraite. Ce document semble être une image (scan) ou est protégé.");
      }

      // Si l'OCR a fonctionné mais que le parseur n'a trouvé aucun compte/solde
      if (isPdf && useOcr && Object.keys(extractedSoldes).length === 0) {
        throw new Error("Le texte a été extrait par OCR mais aucune structure de balance n'a été identifiée. Vérifiez la langue de l'OCR ou la mise en page du document.");
      }

      setBalSoldes(extractedSoldes);
      setBalanceFile(f);
      setFileNameBal(f.name);
      
      // Sauvegarde pour réutilisation future
      const balData = { name: f.name, soldes: extractedSoldes };
      setLastSuccessfulBal(balData);
      localStorage.setItem('fec_last_balance', JSON.stringify(balData));
    } catch (e: any) {
      setErrBal(e.message || 'Erreur inconnue lors de la lecture de la balance.');
      // Si c'est un PDF et qu'on n'est pas en OCR, on propose le retry même si y'a eu une erreur technique
      if (f.name.toLowerCase().endsWith('.pdf') && !useOcr) {
        setPdfRetryWithOcr(f);
      }
    } finally {
      setLoadingBal(false);
    }
  };

  /**
   * Réutilise la dernière balance sauvegardée.
   */
  const handleReuseLastBalance = () => {
    if (lastSuccessfulBal) {
      setBalSoldes(lastSuccessfulBal.soldes);
      setFileNameBal(lastSuccessfulBal.name);
      // On ne met pas de balanceFile car on n'a plus l'objet File réel
    }
  };

  /**
   * Calcule les données de comparaison entre le FEC et la balance.
   */
  const comparisonData = React.useMemo(() => {
    if (Object.keys(balSoldes).length === 0) return [];

    const normalizeAccount = (acc: string) => {
      if (normLevel === 'full') return acc;
      return acc.substring(0, parseInt(normLevel));
    };

    const grouped: Record<string, { 
      comptesFec: Set<string>, 
      comptesBal: Set<string>, 
      libs: Set<string>, 
      soldeFec: number, 
      soldeBal: number 
    }> = {};

    transformed.forEach(r => {
      const acc = r.CompteNum;
      const norm = normalizeAccount(acc);
      if (!grouped[norm]) {
        grouped[norm] = { comptesFec: new Set(), comptesBal: new Set(), libs: new Set(), soldeFec: 0, soldeBal: 0 };
      }
      grouped[norm].comptesFec.add(acc);
      if (r.CompteLib) grouped[norm].libs.add(r.CompteLib);
      grouped[norm].soldeFec += (r.Debit || 0) - (r.Credit || 0);
    });

    Object.entries(balSoldes).forEach(([acc, data]) => {
      const norm = normalizeAccount(acc);
      if (!grouped[norm]) {
        grouped[norm] = { comptesFec: new Set(), comptesBal: new Set(), libs: new Set(), soldeFec: 0, soldeBal: 0 };
      }
      grouped[norm].comptesBal.add(acc);
      const d = data as { lib: string, solde: number };
      if (d.lib) grouped[norm].libs.add(d.lib);
      grouped[norm].soldeBal += d.solde;
    });

    let entries = Object.keys(grouped).sort().map(norm => {
      const g = grouped[norm];
      const allComptes = Array.from(new Set([...g.comptesFec, ...g.comptesBal])).sort();
      const diff = g.soldeFec - g.soldeBal;
      return {
        norm,
        compte: allComptes.join(' / '),
        lib: Array.from(g.libs).join(' / '),
        soldeFec: g.soldeFec,
        soldeBal: g.soldeBal,
        ecart: diff,
        hasFec: g.comptesFec.size > 0,
        hasBal: g.comptesBal.size > 0
      };
    });

    if (balFilter === 'errors') {
      entries = entries.filter(r => Math.abs(r.ecart) > balanceTolerance);
    } else if (balFilter === 'missing-bal') {
      entries = entries.filter(r => r.hasFec && !r.hasBal);
    } else if (balFilter === 'missing-fec') {
      entries = entries.filter(r => !r.hasFec && r.hasBal);
    } else if (balFilter === 'ok') {
      entries = entries.filter(r => Math.abs(r.ecart) <= balanceTolerance);
    } else if (balFilter === 'diff-only') {
      entries = entries.filter(r => r.hasFec && r.hasBal && Math.abs(r.ecart) > balanceTolerance);
    }

    if (balSearch.trim()) {
      const q = balSearch.toLowerCase();
      entries = entries.filter(r => 
        r.compte.toLowerCase().includes(q) || 
        r.lib.toLowerCase().includes(q)
      );
    }

    if (balSortConfig) {
      entries.sort((a: any, b: any) => {
        const valA = a[balSortConfig.key];
        const valB = b[balSortConfig.key];
        const dir = balSortConfig.direction === 'asc' ? 1 : -1;
        
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * dir;
        }
        return String(valA).localeCompare(String(valB)) * dir;
      });
    }

    return entries;
  }, [transformed, balSoldes, balanceFile, normLevel, balFilter, balanceTolerance, balSortConfig]);


  /**
   * Gère le tri des colonnes dans le tableau d'aperçu.
   */
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleBalSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (balSortConfig && balSortConfig.key === key && balSortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setBalSortConfig({ key, direction });
  };

  /**
   * Mémorise et applique le tri et la recherche sur les données transformées
   * pour l'affichage de l'aperçu.
   */
  const sortedTransformed = React.useMemo(() => {
    let sortableItems = [...transformed];
    if (searchQuery.trim()) {
      sortableItems = sortableItems.filter(r => matchAdvancedQuery(r, searchQuery));
    }
    if (libFilter.trim()) {
      const q = libFilter.toLowerCase();
      sortableItems = sortableItems.filter(r => (r.EcritureLib || '').toLowerCase().includes(q));
    }
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const valA = a[sortConfig.key] || '';
        const valB = b[sortConfig.key] || '';
        if (valA < valB) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [transformed, sortConfig, searchQuery]);

  const totals = React.useMemo(() => {
    return transformed.reduce((acc, r) => ({
      debit: acc.debit + (r.Debit || 0),
      credit: acc.credit + (r.Credit || 0)
    }), { debit: 0, credit: 0 });
  }, [transformed]);

  // --- Gestion des Presets de Mapping ---
  useEffect(() => {
    const savedMapping = localStorage.getItem('fec_mapping_presets');
    if (savedMapping) {
      try {
        const local = JSON.parse(savedMapping);
        if (!currentUser) {
          setPresets(local.map((p: any) => ({ ...p, isCloud: false })));
        }
      } catch (e) {
        console.error("Erreur lors du chargement des presets", e);
      }
    }

    const savedBal = localStorage.getItem('fec_last_balance');
    if (savedBal) {
      try {
        setLastSuccessfulBal(JSON.parse(savedBal));
      } catch (e) {
        console.error("Erreur lors du chargement de la dernière balance", e);
      }
    }
  }, []);

  // --- Nettoyage des anciennes fonctions locales ---
  // Nous utilisons maintenant savePreset et deletePreset.

  const applyPreset = (p: { name: string, mapping: Record<string, string>, amtFmt: string }) => {
    setActivePreset(p.name);
    if (!rawData) return;
    const filteredMap: Record<string, string> = {};
    Object.entries(p.mapping).forEach(([k, v]) => {
      if (rawData.headers.includes(v) || v === '__ignore__') {
        filteredMap[k] = v;
      }
    });
    setMapping(filteredMap);
    setAmtFmt(p.amtFmt);
    if (p.amtFmt.startsWith('C_')) setSignConv(p.amtFmt);
  };

  const canNavigateToStep = (targetStep: StepId) => {
    if (targetStep === 1) return true;
    if (targetStep === 2) return !!rawData;
    return transformed.length > 0;
  };

  // ============================================================================
  // RENDU DU COMPOSANT
  // ============================================================================

  // --- Écran de connexion Cloud ---
  if (authLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">Initialisation sécurisée...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-primary)]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md glass-panel p-10 rounded-[32px] text-center"
        >
          <div className="bg-indigo-600 w-20 h-20 rounded-[24px] flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-indigo-500/30">
            <ShieldCheck className="w-10 h-10 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-[var(--text-primary)] mb-4">FEC Cloud</h1>
          <p className="text-[var(--text-secondary)] mb-10 text-sm leading-relaxed max-w-[280px] mx-auto font-medium">
            Accédez à vos outils de conversion comptable et réconciliation bancaire en un clic.
          </p>
          
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] py-4 px-6 rounded-2xl font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-900 hover:scale-[1.02] transition-all duration-300 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Se connecter avec un compte Google"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="" aria-hidden="true" referrerPolicy="no-referrer" />
            Connexion avec Google
          </button>
          
          <div className="mt-12 pt-8 border-t border-[var(--border-color)] flex flex-col items-center gap-4 opacity-40">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Powered by BDO Innovation</span>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // --- Application principale ---
  return (
    <div className="min-h-screen flex bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans antialiased overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-72 border-r border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col hidden lg:flex shrink-0 relative z-20">
        <div className="p-8">
          <div 
            className="flex items-center gap-4 mb-10 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-2xl p-1" 
            role="button"
            tabIndex={0}
            aria-label="Réinitialiser et retourner à l'accueil"
            onClick={() => { reset(); setStep(1); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { reset(); setStep(1); } }}
          >
            <div className="bg-indigo-600 w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
              <Database className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <span className="text-xl font-black tracking-tight block">FEC Explorer</span>
              <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Enterprise Cloud</span>
            </div>
          </div>
          
          <nav className="space-y-2" aria-label="Navigation principale">
            {STEP_CONFIG.map((item) => (
              <button 
                key={item.id}
                onClick={() => { if (canNavigateToStep(item.id)) setStep(item.id); }}
                disabled={!canNavigateToStep(item.id)}
                aria-current={step === item.id ? 'step' : undefined}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all ${step === item.id ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20' : 'text-[var(--text-secondary)] hover:bg-slate-100 dark:hover:bg-slate-950 disabled:opacity-30'}`}
              >
                <item.icon className="w-4 h-4" aria-hidden="true" /> {item.label}
              </button>
            ))}
          </nav>
        </div>
        
        <div className="mt-auto p-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-4 p-4 rounded-3xl bg-slate-50 dark:bg-slate-900/40 border border-[var(--border-color)]">
            <img 
              src={currentUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.email}`} 
              alt={`Photo de profil de ${currentUser.displayName}`} 
              className="w-12 h-12 rounded-2xl border-2 border-white dark:border-slate-800" 
              referrerPolicy="no-referrer" 
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black truncate">{currentUser.displayName}</p>
              <p className="text-[10px] text-[var(--text-secondary)] font-bold truncate">{currentUser.email}</p>
            </div>
            <button 
              onClick={handleLogout} 
              className="text-slate-400 hover:text-red-500 transition-colors p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              aria-label="Se déconnecter"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto bg-[var(--bg-primary)] flex flex-col relative z-10 transition-colors duration-300">
        {/* Top Header */}
        <header className="h-20 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-[var(--border-color)] text-[var(--text-secondary)] transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label={isDarkMode ? "Passer en mode clair" : "Passer en mode sombre"}
              title={isDarkMode ? "Passer en mode clair" : "Passer en mode sombre"}
            >
              {isDarkMode ? <Sun className="w-5 h-5" aria-hidden="true" /> : <Moon className="w-5 h-5" aria-hidden="true" />}
            </button>
            <button 
              onClick={() => setShowThemeSettings(!showThemeSettings)}
              className={`p-2.5 rounded-xl border transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${showThemeSettings ? 'bg-amber-50 border-amber-500 text-amber-600 shadow-inner' : 'bg-slate-50 dark:bg-slate-900 border-[var(--border-color)] text-[var(--text-secondary)]'}`}
              aria-label="Personnaliser le thème"
              aria-expanded={showThemeSettings}
              title="Personnaliser le thème"
            >
              <Palette className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="h-6 w-px bg-[var(--border-color)]" aria-hidden="true" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Workspace</span>
              <span className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-bold border border-indigo-100 dark:border-indigo-900/50">Production v2.5</span>
            </div>
            <div className="lg:hidden ml-2">
              <label htmlFor="mobile-step-nav" className="sr-only">Aller à une étape</label>
              <div className="relative">
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id="mobile-step-nav"
                  value={step}
                  onChange={(e) => {
                    const nextStep = Number(e.target.value) as StepId;
                    if (canNavigateToStep(nextStep)) setStep(nextStep);
                  }}
                  className="appearance-none pr-7 pl-2 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {STEP_CONFIG.map((item) => (
                    <option key={item.id} value={item.id} disabled={!canNavigateToStep(item.id)}>
                      Étape {item.id} · {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6" aria-label="Progression du processus">
            <div className="hidden sm:flex items-center gap-2" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4}>
              {[1, 2, 3, 4].map((s) => (
                <div 
                  key={s} 
                  className={`h-1.5 rounded-full transition-all duration-700 ${step === s ? 'w-8 bg-indigo-600' : 'w-4 bg-slate-200 dark:bg-slate-800'}`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        </header>

        <div className="p-8 lg:p-12 animate-slide-up">
          <div className="max-w-6xl mx-auto space-y-10">

            {/* --- Panneau de réglages du thème --- */}
            <AnimatePresence>
              {showThemeSettings && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-[var(--bg-secondary)] border border-amber-200 dark:border-amber-900/50 rounded-3xl p-8 mb-4 shadow-xl shadow-amber-500/5 relative">
                    <button 
                      onClick={() => setShowThemeSettings(false)}
                      className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      aria-label="Fermer les réglages du thème"
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>

                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 bg-amber-100 dark:bg-amber-900/20 rounded-xl" aria-hidden="true">
                        <Palette className="w-6 h-6 text-amber-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Personnalisation de l'interface</h3>
                        <p className="text-xs text-[var(--text-secondary)] font-medium">Choisissez une ambiance ou créez la vôtre.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                      {/* Thèmes prédéfinis */}
                      <section aria-labelledby="themes-predefined-title">
                        <h4 id="themes-predefined-title" className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Thèmes Prédéfinis</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {PREDEFINED_THEMES.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setThemeId(t.id)}
                              aria-pressed={themeId === t.id}
                              className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${themeId === t.id ? 'border-amber-500 bg-amber-50/50 shadow-sm' : 'border-[var(--border-color)] hover:border-slate-300 dark:hover:border-slate-700 bg-[var(--bg-primary)]/50'}`}
                            >
                              <div 
                                className="w-10 h-10 rounded-xl shadow-inner border-2 border-white dark:border-slate-800"
                                style={{ background: t.color }}
                                aria-hidden="true"
                              />
                              <span className={`text-[10px] font-black uppercase text-center ${themeId === t.id ? 'text-amber-700' : 'text-slate-500'}`}>
                                {t.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>

                      {/* Personnalisation avancée */}
                      <section 
                        className={`transition-opacity duration-300 ${themeId !== 'custom' ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}
                        aria-labelledby="themes-custom-title"
                        aria-disabled={themeId !== 'custom'}
                      >
                        <h4 id="themes-custom-title" className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
                          <span>Configuration Manuelle</span>
                          {themeId === 'custom' && <Pipette className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />}
                        </h4>
                        
                        <div className="space-y-4">
                          {[
                            { label: 'Accent Principal', key: 'accentPrimary', icon: Palette, id: 'clr-accent' },
                            { label: 'Fond Principal', key: 'bgPrimary', icon: Sun, id: 'clr-bg1' },
                            { label: 'Fond Secondaire', key: 'bgSecondary', icon: Layers, id: 'clr-bg2' },
                            { label: 'Texte Titres', key: 'textPrimary', icon: FileText, id: 'clr-text' },
                          ].map(cfg => (
                            <div key={cfg.key} className="flex items-center justify-between p-3 border border-[var(--border-color)] rounded-xl bg-[var(--bg-primary)]/30">
                              <div className="flex items-center gap-3">
                                <cfg.icon className="w-4 h-4 text-slate-400" aria-hidden="true" />
                                <label htmlFor={cfg.id} className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">{cfg.label}</label>
                              </div>
                              <input 
                                id={cfg.id}
                                type="color" 
                                className="w-8 h-8 rounded-lg overflow-hidden border-none p-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                                value={(customColors as any)[cfg.key] || (cfg.key.startsWith('bg') ? '#F8FAFC' : cfg.key.startsWith('text') ? '#0F172A' : '#6366f1')}
                                onChange={(e) => setCustomColors({ ...customColors, [cfg.key]: e.target.value })}
                                disabled={themeId !== 'custom'}
                              />
                            </div>
                          ))}
                        </div>

                        {themeId === 'custom' && (
                          <div className="mt-4 flex justify-end">
                            <button 
                              onClick={() => setCustomColors({ bgPrimary: '', bgSecondary: '', textPrimary: '', accentPrimary: '' })}
                              className="text-[10px] font-black text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest"
                            >
                              Réinitialiser les couleurs
                            </button>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

      {/* ============================================================================ */}
      {/* ÉTAPE 1 : IMPORTATION */}
      {/* ============================================================================ */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 flex flex-col gap-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-black tracking-tight">Source des Données</h2>
              <p className="text-[var(--text-secondary)] font-medium">Téléversez vos flux de trésorerie et journaux d'écritures.</p>
            </div>

            <div 
              className={`relative overflow-hidden group cursor-pointer border-2 border-dashed rounded-[40px] p-20 transition-all duration-500 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 ${rawData ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-[var(--bg-secondary)] border-[var(--border-color)] hover:border-indigo-500/50 hover:bg-indigo-500/[0.02]'}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-indigo-500', 'bg-indigo-500/5'); }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-500/5'); }}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Zone de dépôt de fichiers. Cliquez ou glissez vos fichiers FEC ici."
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".txt,.csv" 
                multiple 
                onChange={(e) => e.target.files && handleBatchFiles(e.target.files)} 
                aria-hidden="true"
                tabIndex={-1}
              />
              
              <div className="flex flex-col items-center text-center relative z-10">
                <div className={`w-24 h-24 rounded-[32px] flex items-center justify-center mb-8 shadow-2xl transition-all group-hover:scale-110 group-hover:rotate-3 ${rawData ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-indigo-600 text-white shadow-indigo-600/40'}`}>
                  {rawData ? <CheckCircle2 className="w-12 h-12" /> : <Upload className="w-12 h-12" />}
                </div>
                
                <div className="space-y-3">
                  <p className="text-2xl font-black">
                    {batchFiles.length > 1 ? (
                      <span className="flex items-center justify-center gap-3">
                        <Files className="w-6 h-6 text-indigo-500" /> 
                        {batchFiles.length} FEC Sélectionnés
                      </span>
                    ) : fileName ? (
                      <span className="text-emerald-600">{fileName}</span>
                    ) : (
                      <span>Flux Comptables</span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)] font-medium max-w-xs mx-auto opacity-70">
                    Déposez un ou plusieurs fichiers Sage 1000 (.txt / .csv).
                  </p>
                  {!rawData && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="mt-6 bg-white text-indigo-600 px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl border border-indigo-100 hover:bg-indigo-50 transition-all active:scale-95"
                    >
                      Parcourir les fichiers
                    </button>
                  )}
                </div>

                {rawData && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-10 flex gap-4">
                    <div className="px-5 py-2 bg-emerald-500/10 text-emerald-600 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-emerald-500/20 backdrop-blur-sm">
                      {rawData.rows.length.toLocaleString()} Lignes
                    </div>
                    <div className="px-5 py-2 bg-indigo-500/10 text-indigo-600 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-indigo-500/20 backdrop-blur-sm">
                      {rawData.encoding}
                    </div>
                  </motion.div>
                )}
              </div>
              
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
                <LayoutDashboard className="w-64 h-64" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-panel p-6 rounded-[32px] flex items-center gap-5 group hover:border-indigo-500/30 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-[var(--text-secondary)] group-hover:text-indigo-500">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest mb-1">Sécurité Bancaire</h4>
                  <p className="text-[10px] font-medium text-[var(--text-secondary)]">Données chiffrées de bout en bout.</p>
                </div>
              </div>
              <div className="glass-panel p-6 rounded-[32px] flex items-center gap-5 group hover:border-indigo-500/30 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-[var(--text-secondary)] group-hover:text-indigo-500">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest mb-1">Mapping IA</h4>
                  <p className="text-[10px] font-medium text-[var(--text-secondary)]">Suggestion automatique des colonnes.</p>
                </div>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-4 space-y-6">
            <div className="glass-panel p-8 rounded-[40px] space-y-8 sticky top-28">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Configuration</h3>
                <Settings className="w-4 h-4 text-slate-300" />
              </div>

              <section className="rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-900/10 p-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3">Checklist import</h4>
                <ul className="space-y-2">
                  {[
                    { done: !!fileName, label: 'Fichier sélectionné' },
                    { done: !!rawData?.headers?.length, label: 'En-têtes détectés' },
                    { done: (rawData?.rows?.length || 0) > 0, label: 'Lignes exploitables trouvées' },
                  ].map((item) => (
                    <li key={item.label} className="flex items-center gap-2 text-xs font-semibold">
                      <span className={`w-5 h-5 rounded-full grid place-items-center ${item.done ? 'bg-emerald-500/20 text-emerald-600' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      </span>
                      <span className={item.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-secondary)]'}>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label htmlFor="active-preset-select" className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 cursor-pointer">Profil Actif</label>
                  <div className="relative group">
                    <select 
                      id="active-preset-select"
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer pr-10"
                      value={activePreset || ''}
                      onChange={(e) => {
                        const p = presets.find(pr => pr.name === e.target.value);
                        if (p) applyPreset(p);
                        else setActivePreset(null);
                      }}
                    >
                      <option value="">Analyse Prédictive IA</option>
                      {presets.map((p, idx) => (
                        <option key={p.id || `preset-${idx}`} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none group-focus-within:text-indigo-500 transition-colors" aria-hidden="true" />
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="encoding-select" className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 cursor-pointer">Décodage</label>
                  <div className="relative group">
                    <select 
                      id="encoding-select"
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer pr-10"
                      value={encOpt} 
                      onChange={(e) => { setEncOpt(e.target.value); if (file) handleFile(file, e.target.value, sepOpt); }}
                    >
                      <option value="auto">Détection Auto</option>
                      <option value="utf-8">UTF-8 Universal</option>
                      <option value="iso-8859-1">Latin-1 (Sage Legacy)</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none group-focus-within:text-indigo-500 transition-colors" aria-hidden="true" />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setStep(2)}
                  disabled={!rawData}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white rounded-[24px] py-5 flex items-center justify-center gap-3 font-black text-[13px] uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-100"
                >
                  Configurer <ArrowRight className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 justify-center">
                <Lock className="w-3 h-3" />
                Infrastructure Certifiée Cloud us-west1
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ============================================================================ */}
      {/* ÉTAPE 2 : MAPPING DES COLONNES */}
      {/* ============================================================================ */}
      {step === 2 && rawData && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          {/* --- Liste des fichiers Batch --- */}
          {batchFiles.length > 1 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4 shadow-sm">
              <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Files className="w-4 h-4" /> File d'attente Batch ({batchFiles.length} fichiers)
              </h3>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {batchFiles.map((f, i) => {
                  const isProcessing = currentFileIdx === i;
                  const isDone = currentFileIdx !== null && currentFileIdx > i;
                  return (
                    <div 
                      key={`${f.name}-${i}`} 
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm transition-all border ${
                        isProcessing 
                          ? 'bg-amber-50 border-amber-300 text-amber-700 ring-2 ring-amber-200' 
                          : isDone 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-indigo-200 text-indigo-800'
                      }`}
                    >
                      {isProcessing ? (
                        <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      )}
                      {f.name}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-indigo-500 mt-2 italic">Le mapping sera appliqué uniformément à tous les fichiers.</p>
            </div>
          )}

          {/* --- Presets de mapping --- */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-4 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <Settings className="w-24 h-24 text-white" />
            </div>
            
            <h2 id="profiles-title" className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
              <Layers className="w-4 h-4" aria-hidden="true" /> Profils de Configuration
            </h2>
            
            {presets.length > 0 && (
              <div className="mb-8" role="group" aria-labelledby="mes-profils-label">
                <label id="mes-profils-label" className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Mes Profils :</label>
                <div className="flex flex-wrap gap-3">
                  {presets.map((p, idx) => (
                    <div key={p.id || `preset-btn-${idx}`} className={`flex items-center rounded-xl overflow-hidden shadow-lg transition-all border ${activePreset === p.name ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-700'}`}>
                      <button 
                        onClick={() => applyPreset(p)}
                        aria-pressed={activePreset === p.name}
                        className={`px-4 py-2 text-xs font-black transition-colors flex items-center gap-2 ${activePreset === p.name ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                      >
                        {p.isCloud ? <ShieldCheck className="w-3 h-3 text-indigo-300" aria-hidden="true" /> : <Save className="w-3 h-3 text-slate-500" aria-hidden="true" />}
                        {p.name}
                      </button>
                      <button 
                        onClick={() => deletePreset(p)}
                        className="px-3 py-2 bg-slate-800 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors border-l border-slate-700"
                        title={`Supprimer le profil ${p.name}`}
                        aria-label={`Supprimer le profil ${p.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => setActivePreset(null)}
                    aria-pressed={!activePreset}
                    className={`px-4 py-2 text-xs font-black rounded-xl border transition-all ${!activePreset ? 'bg-slate-700 border-slate-600 text-white' : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'}`}
                  >
                    Auto-Détection
                  </button>
                </div>
              </div>
            )}

            <div className="bg-slate-800/50 p-5 rounded-xl border border-slate-700/50">
              <label htmlFor="save-mapping-input" className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Sauvegarder le mapping actuel :</label>
              <div className="flex gap-2">
                <input 
                  id="save-mapping-input"
                  type="text" 
                  placeholder="Nom du profil (ex: Sage 1000 v2...)" 
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                />
                <button 
                  onClick={() => savePreset(newPresetName, mapping, amtFmt)}
                  disabled={!newPresetName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" aria-hidden="true" /> Sauvegarder
                </button>
              </div>
              <p className="mt-3 text-[10px] text-slate-500 italic">
                {currentUser ? "Votre profil sera synchronisé sur le Cloud et disponible sur tous vos appareils." : "Connectez-vous pour synchroniser vos profils sur le Cloud."}
              </p>
            </div>
          </div>

          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                ② Mapping des colonnes
                <span className="text-[10px] font-normal lowercase text-slate-400">({visibleMapFields.length} champs)</span>
              </span>
              
              <div className="flex items-center gap-2">
                {/* Barre de recherche de champs */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <input 
                    type="text"
                    placeholder="Filtrer les champs..."
                    className="pl-9 pr-3 py-2 text-[11px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none w-40 sm:w-56 transition-all font-medium text-[var(--text-primary)]"
                    value={mapSearch}
                    onChange={(e) => setMapSearch(e.target.value)}
                    aria-label="Rechercher un champ de mapping"
                  />
                </div>

                {/* Sélecteur de visibilité / Réorganisation */}
                <div className="relative">
                  <button 
                    onClick={() => setShowMapFieldsSelector(!showMapFieldsSelector)}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${showMapFieldsSelector ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                    aria-expanded={showMapFieldsSelector}
                    aria-haspopup="true"
                    aria-label="Réorganiser et filtrer les champs de mapping visible"
                  >
                    <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                    Champs
                  </button>

                  <AnimatePresence>
                    {showMapFieldsSelector && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowMapFieldsSelector(false)}></div>
                        <motion.div 
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute right-0 mt-3 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-30 overflow-hidden flex flex-col max-h-[500px]"
                        >
                          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                            <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest flex items-center justify-between">
                              Configuration du Mapping
                              <span className="text-[9px] bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full lowercase font-bold">
                                {visibleMapFields.length} / {FIELDS.length} actifs
                              </span>
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-1">Glissez pour réordonner les champs dans la grille.</p>
                          </div>

                          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                            <Reorder.Group 
                              axis="y" 
                              values={mapFieldsOrder} 
                              onReorder={setMapFieldsOrder}
                              className="space-y-1"
                            >
                              {mapFieldsOrder.map(fieldKey => {
                                const f = FIELDS.find(x => x.key === fieldKey);
                                if (!f) return null;
                                const isVisible = visibleMapFields.includes(fieldKey);
                                const matchesSearch = f.label.toLowerCase().includes(mapSearch.toLowerCase());
                                
                                if (!matchesSearch && !isVisible) return null;

                                return (
                                  <Reorder.Item 
                                    key={fieldKey} 
                                    value={fieldKey}
                                    className={`group relative cursor-grab active:cursor-grabbing rounded-xl transition-all border ${isVisible ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 shadow-sm' : 'bg-slate-50/50 dark:bg-slate-900/30 border-transparent opacity-60'}`}
                                  >
                                    <div className="flex items-center justify-between px-3 py-2.5">
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-40 transition-opacity">
                                          <div className="w-3 h-0.5 bg-slate-500 rounded-full"></div>
                                          <div className="w-3 h-0.5 bg-slate-500 rounded-full"></div>
                                        </div>
                                        <div>
                                          <div className={`text-[11px] font-bold ${isVisible ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400'}`}>
                                            {f.label}
                                            {f.req && <span className="text-amber-500 ml-1">★</span>}
                                          </div>
                                          <div className="text-[9px] text-slate-400 font-medium">Clé: {f.key}</div>
                                        </div>
                                      </div>
                                      
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isVisible) {
                                            if (f.req) {
                                              if (window.confirm(`Le champ "${f.label}" est recommandé/obligatoire. Êtes-vous sûr de vouloir le masquer ?`)) {
                                                setVisibleMapFields(prev => prev.filter(k => k !== fieldKey));
                                              }
                                            } else {
                                              setVisibleMapFields(prev => prev.filter(k => k !== fieldKey));
                                            }
                                          } else {
                                            setVisibleMapFields(prev => [...prev, fieldKey]);
                                          }
                                        }}
                                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${isVisible ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-slate-800'}`}
                                        aria-pressed={isVisible}
                                      >
                                        {isVisible ? <CheckCircle2 className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                      </button>
                                    </div>
                                  </Reorder.Item>
                                );
                              })}
                            </Reorder.Group>
                          </div>

                          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex justify-end">
                            <button 
                              onClick={() => {
                                setVisibleMapFields(FIELDS.map(f => f.key));
                                setMapFieldsOrder(FIELDS.map(f => f.key));
                              }}
                              className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 hover:underline uppercase tracking-widest"
                            >
                              Réinitialiser par défaut
                            </button>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                <button 
                  onClick={handleAiMappingSuggestion}
                  disabled={isAiLoading}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:from-indigo-600 hover:to-violet-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 disabled:opacity-50"
                  aria-label="Utiliser l'IA pour suggérer un mapping"
                >
                  {isAiLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Suggestion IA
                </button>
              </div>
            </h2>
            <div className="p-3 bg-blue-50 text-blue-700 border-l-4 border-blue-500 rounded-r-md mb-6 text-sm">
              Les colonnes ont été pré-remplies automatiquement. Corrigez si nécessaire. <strong className="text-amber-600">★ = champ obligatoire</strong>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="group" aria-label="Mapping des colonnes">
              {mapFieldsOrder
                .filter(key => visibleMapFields.includes(key))
                .filter(key => {
                  const f = FIELDS.find(x => x.key === key);
                  return f && f.label.toLowerCase().includes(mapSearch.toLowerCase());
                })
                .map(key => {
                  const f = FIELDS.find(x => x.key === key)!;
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-50/50 dark:bg-slate-800/30 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-900 transition-all group">
                      <label htmlFor={`map-${f.key}`} className={`text-xs font-bold cursor-pointer flex items-center justify-between ${f.req ? 'text-amber-600' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                        <span>
                          {f.label} {f.req && <span aria-hidden="true" className="text-amber-500">★</span>}
                          {f.req && <span className="sr-only">(obligatoire)</span>}
                        </span>
                        {f.req && <span className="text-[10px] bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded text-amber-600 border border-amber-100 dark:border-amber-900/50 font-black uppercase">Obligatoire</span>}
                      </label>
                      <div className="relative">
                        <select 
                          id={`map-${f.key}`}
                          className="w-full pl-3 pr-8 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm text-[var(--text-primary)] transition-all appearance-none cursor-pointer"
                          value={mapping[f.key] || '__ignore__'}
                          onChange={(e) => {
                            const newMap = { ...mapping, [f.key]: e.target.value };
                            setMapping(newMap);
                            const autoFmt = det(newMap, signConv);
                            if (autoFmt && autoFmt !== signConv) setAmtFmt(autoFmt);
                          }}
                        >
                          <option value="__ignore__">(Champ non présent)</option>
                          {rawData.headers.map((h, i) => <option key={`${h}-${i}`} value={h}>{h || `[Colonne ${i+1}]`}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      </div>
                    </div>
                  );
                })}
              
              {/* Message aucun champ trouvé */}
              {mapFieldsOrder.filter(key => visibleMapFields.includes(key)).filter(key => FIELDS.find(x => x.key === key)!.label.toLowerCase().includes(mapSearch.toLowerCase())).length === 0 && (
                <div className="col-span-full py-12 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                  <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aucun champ ne correspond à "{mapSearch}"</p>
                  <button 
                    onClick={() => setMapSearch('')}
                    className="mt-4 text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:underline"
                  >
                    Effacer la recherche
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Format des montants</h2>
            <div className="flex flex-wrap gap-3">
              {[
                { v: 'A', l: 'Débit + Crédit', hint: 'Colonnes séparées Débit et Crédit' },
                { v: 'B', l: 'Montant + Sens D/C', hint: 'Une colonne Montant + une colonne Sens' },
                { v: 'C_pos_debit', l: 'Montant signé (+ = Débit)', hint: 'Un montant unique signé' },
                { v: 'C_pos_credit', l: 'Montant signé (+ = Crédit)', hint: 'Un montant unique signé' },
              ].map(f => (
                <button 
                  key={f.v}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${amtFmt === f.v ? 'bg-amber-100 border-amber-500 text-amber-700' : 'bg-slate-50 border-slate-300 text-slate-600 hover:border-amber-500'}`}
                  title={f.hint}
                  onClick={() => { setAmtFmt(f.v); if (f.v.startsWith('C_')) setSignConv(f.v); }}
                >
                  {f.l}
                </button>
              ))}
            </div>
            
            {amtFmt && warns.length > 0 && (
              <div className="mt-4 space-y-2">
                {warns.map((w, idx) => (
                  <div key={`warn-${idx}-${w.substring(0, 20)}`} className="p-3 bg-amber-50 text-amber-700 border-l-4 border-amber-500 rounded-r-md flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> 
                    <span className="text-sm whitespace-pre-wrap">{w}</span>
                  </div>
                ))}
              </div>
            )}
            {!det(mapping, signConv) && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md text-sm">Mappez au moins Débit+Crédit ou Montant.</div>}
            {err && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md text-sm flex items-center gap-2"><AlertCircle className="w-5 h-5 shrink-0" /> {err}</div>}
          </div>

              <AnimatePresence>
                {loading && batchFiles.length > 1 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-slate-800">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${batchProgress}%` }}
                        className="h-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.6)]"
                      />
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 mt-2">
                      <div className="flex items-center gap-4">
                        <div className="bg-indigo-600/20 p-3 rounded-2xl">
                          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-white leading-tight">Traitement en cours</h3>
                          <p className="text-indigo-400 font-bold text-sm">
                            Fichier {currentFileIdx !== null ? currentFileIdx + 1 : '-' } sur {batchFiles.length}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-4xl font-black text-white tabular-nums">{batchProgress}%</div>
                        <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-1">Progression Globale</div>
                      </div>
                    </div>

                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {batchResults.map((res, idx) => {
                        const isActive = idx === currentFileIdx;
                        return (
                          <div 
                            key={`proc-${idx}-${res.name}`}
                            className={`p-4 rounded-2xl border transition-all duration-300 ${isActive ? 'bg-indigo-600/10 border-indigo-500/50 scale-[1.02]' : res.status === 'success' ? 'bg-slate-800/50 border-emerald-500/20' : res.status === 'error' ? 'bg-red-950/20 border-red-500/20' : 'bg-slate-800/30 border-slate-700/50 opacity-40'}`}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-3">
                                {res.status === 'success' ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                ) : res.status === 'error' ? (
                                  <AlertCircle className="w-4 h-4 text-red-500" />
                                ) : isActive ? (
                                  <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border-2 border-slate-700" />
                                )}
                                <span className={`text-sm font-bold truncate max-w-[200px] ${isActive ? 'text-white' : 'text-slate-400'}`}>
                                  {res.name}
                                </span>
                              </div>
                              <span className={`text-[10px] font-black uppercase tracking-wider ${isActive ? 'text-indigo-400' : res.status === 'success' ? 'text-emerald-400' : res.status === 'error' ? 'text-red-400' : 'text-slate-600'}`}>
                                {isActive ? currentFileStep : res.status === 'success' ? 'Terminé' : res.status === 'error' ? 'Échec' : 'En attente'}
                              </span>
                            </div>
                            
                            {(isActive || res.status !== 'pending') && (
                              <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden shadow-inner">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${res.progress}%` }}
                                  className={`h-full transition-all duration-500 ${res.status === 'error' ? 'bg-red-500' : res.status === 'success' ? 'bg-emerald-500' : 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'}`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-between mt-8">
            <button className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-4 py-2 font-medium" onClick={() => setStep(1)}>
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>
            <button 
              className={`flex items-center gap-2 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm ${loading ? 'bg-slate-400 animate-pulse' : 'bg-amber-600 hover:bg-amber-700'}`}
              onClick={handleValidateMapping}
              disabled={loading}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> 
                  Traitement {batchFiles.length > 1 ? `(${batchProgress}%)` : '...'}
                </>
              ) : (
                <>
                  {batchFiles.length > 1 ? `Lancer le traitement (${batchFiles.length})` : 'Valider et transformer'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* ÉTAPE 3 : RÉSULTAT ET EXPORT */}
      {/* ============================================================================ */}
      {step === 3 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          {batchResults.length > 0 ? (
            /* --- VUE BATCH --- */
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center gap-3">
                  Résumé du traitement Batch
                  <span className="text-xs font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                    {batchResults.filter(r => r.status === 'success').length} succès / {batchResults.length} fichiers
                  </span>
                </h2>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setBatchResFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${batchResFilter === 'all' ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    Tous
                  </button>
                  <button 
                    onClick={() => setBatchResFilter('success')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${batchResFilter === 'success' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    Succès ({batchResults.filter(r => r.status === 'success').length})
                  </button>
                  <button 
                    onClick={() => setBatchResFilter('error')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${batchResFilter === 'error' ? 'bg-red-600 border-red-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    Échecs ({batchResults.filter(r => r.status === 'error').length})
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto border border-slate-100 rounded-xl mb-6">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Fichier</th>
                      <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Lignes</th>
                      <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Total Débit</th>
                      <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Total Crédit</th>
                      <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredBatchResults.map((res, i) => (
                      <React.Fragment key={`${res.name}-${i}`}>
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 text-sm font-medium text-slate-700">{res.name}</td>
                          <td className="p-4 text-sm font-mono text-slate-600">{res.rows.toLocaleString()}</td>
                          <td className="p-4 text-sm font-mono text-slate-600">{fmt2(res.debit)} €</td>
                          <td className="p-4 text-sm font-mono text-slate-600">{fmt2(res.credit)} €</td>
                          <td className="p-4 text-sm">
                            {res.status === 'error' ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className="flex items-center gap-1.5 text-red-600 font-semibold text-xs">
                                  <AlertCircle className="w-3.5 h-3.5" /> Échec
                                </span>
                                <span className="text-[10px] text-red-400 font-medium max-w-[150px] truncate" title={res.error}>
                                  {res.error}
                                </span>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1.5 text-emerald-600 font-semibold text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Succès
                              </span>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    ))}
                    {filteredBatchResults.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-slate-400 italic">
                          Aucun fichier ne correspond à ce filtre.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                <div className="flex items-start gap-3">
                  <div className="bg-indigo-600 p-2 rounded-lg">
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-indigo-900">Exportation groupée</h4>
                    <p className="text-xs text-indigo-700 mt-1">Générez une archive ZIP des documents convertis ou un rapport CSV.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={exportBatchReportCSV}
                    className="flex items-center gap-2 bg-white text-indigo-700 hover:bg-slate-50 border border-indigo-200 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all active:scale-95"
                  >
                    <FileText className="w-4 h-4" /> Rapport (.csv)
                  </button>
                  <button 
                    onClick={exportBatchZIP}
                    disabled={loading || batchResults.filter(r => r.status === 'success').length === 0}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95 disabled:bg-indigo-300"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Files className="w-5 h-5" />}
                    Télécharger ZIP ({batchResults.filter(r => r.status === 'success').length})
                  </button>
                </div>
              </div>
              
              <div className="mt-8 pt-8 border-t border-slate-100 flex justify-center">
                <button className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-bold text-sm" onClick={reset}>
                  <RefreshCw className="w-4 h-4" /> Traiter une nouvelle série de fichiers
                </button>
              </div>
            </div>
          ) : (
            /* --- VUE UNIQUE --- */
            <>
              {fileName && (
                <div className="flex items-center gap-3 mb-6 bg-indigo-50 border border-indigo-100 p-4 rounded-xl shadow-sm">
                  <div className="bg-white p-2 rounded-lg shadow-sm border border-indigo-50">
                    <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Document Source</p>
                    <p className="text-sm font-bold text-indigo-900">{fileName}</p>
                  </div>
                </div>
              )}

              {/* --- Indicateurs clés (Metrics) --- */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" role="list" aria-label="Statistiques de conversion">
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm" role="listitem">
                  <div className="text-xs text-slate-500 mb-1">Lignes converties</div>
                  <div className="text-xl font-semibold font-mono text-slate-800 dark:text-slate-100">{transformed.length.toLocaleString('fr-FR')}</div>
                </div>
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm" role="listitem">
                  <div className="text-xs text-slate-500 mb-1">Total Débit</div>
                  <div className="text-xl font-semibold font-mono text-slate-800 dark:text-slate-100">{fmt2(totals.debit)} €</div>
                </div>
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-4 shadow-sm" role="listitem">
                  <div className="text-xs text-slate-500 mb-1">Total Crédit</div>
                  <div className="text-xl font-semibold font-mono text-slate-800 dark:text-slate-100">{fmt2(totals.credit)} €</div>
                </div>
                <div className={`border rounded-xl p-4 shadow-sm ${Math.abs(totals.debit - totals.credit) < 0.01 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`} role="listitem">
                  <div className={`text-xs mb-1 ${Math.abs(totals.debit - totals.credit) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {Math.abs(totals.debit - totals.credit) < 0.01 ? 'Fichier équilibré' : 'Déséquilibre détecté'}
                  </div>
                  <div className={`text-xl font-semibold font-mono ${Math.abs(totals.debit - totals.credit) < 0.01 ? 'text-emerald-800' : 'text-red-800'}`}>
                    {fmt2(Math.abs(totals.debit - totals.credit))} €
                  </div>
                </div>
              </div>

              {/* --- Graphique de synthèse --- */}
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-6 shadow-sm overflow-hidden h-[300px]">
                <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Visualisation des Flux (Débit vs Crédit)</h2>
                <ResponsiveContainer width="100%" height="80%">
                  <BarChart data={[
                    { name: 'Total Débit', value: totals.debit, color: '#6366f1' },
                    { name: 'Total Crédit', value: totals.credit, color: '#10b981' }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(val) => `${(val / 1000).toFixed(1)}k`}
                    />
                    <Tooltip 
                      cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }} 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                      formatter={(val: number) => [`${fmt2(val)} €`, 'Montant']}
                    />
                    <Bar dataKey="value" radius={[10, 10, 0, 0]} barSize={80}>
                      {[{ color: '#6366f1' }, { color: '#10b981' }].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* --- Options d'export Excel --- */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Options d'export Excel
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="export-filename-input" className="text-sm font-medium text-slate-700 cursor-pointer">Nom du fichier de sortie</label>
                <div className="relative">
                  <input 
                    id="export-filename-input"
                    type="text" 
                    className="w-full p-2.5 border border-slate-300 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none pr-12 text-[var(--text-primary)] shadow-sm"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="export_pennylane"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium" aria-hidden="true">.xlsx</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="num-format-select" className="text-sm font-medium text-slate-700 cursor-pointer">Format des nombres</label>
                <select 
                  id="num-format-select"
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none shadow-sm cursor-pointer"
                  value={numberFormat}
                  onChange={(e) => setNumberFormat(e.target.value)}
                >
                  {NUMBER_FORMATS.map(fmt => (
                    <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="date-format-select" className="text-sm font-medium text-slate-700 cursor-pointer">Format des dates</label>
                <select 
                  id="date-format-select"
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none shadow-sm cursor-pointer"
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value)}
                >
                  {DATE_FORMATS.map(fmt => (
                    <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* --- Affichage des anomalies de comptes --- */}
          {accountAnomalies && (accountAnomalies.multipleLibs.length > 0 || accountAnomalies.invalidAccounts.length > 0) ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-red-100 rounded-lg shrink-0">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-bold text-red-900 mb-1 flex items-center gap-2">
                        Anomalies de Plan Comptable
                        <span className="text-[10px] bg-red-200 text-red-700 px-2 py-0.5 rounded-full uppercase tracking-widest font-black">
                          {accountAnomalies.invalidAccounts.length + accountAnomalies.multipleLibs.length} alertes
                        </span>
                      </h3>
                      <p className="text-sm text-red-700 opacity-80 max-w-xl">
                        Des incohérences ont été détectées. Ces comptes seront exportés tels quels, mais une vérification est fortement recommandée.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={handleAiAnomalyAnalysis}
                        disabled={isAiLoading}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50"
                      >
                        {isAiLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Analyse IA
                      </button>
                      <button 
                        onClick={exportAnomaliesCSV}
                        className="flex items-center gap-2 bg-white text-red-700 hover:bg-red-50 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border border-red-200 transition-all shadow-sm shrink-0 active:scale-95"
                      >
                        <Download className="w-4 h-4" /> Exporter (.csv)
                      </button>
                    </div>
                  </div>

                  {aiAnalysis && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mb-6 p-5 bg-indigo-900/5 dark:bg-indigo-400/5 border border-indigo-200 dark:border-indigo-800 rounded-2xl relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Sparkles className="w-12 h-12 text-indigo-500" />
                      </div>
                      <h4 className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        Assistant IA Expert-Comptable
                      </h4>
                      <div className="text-xs text-indigo-900 dark:text-indigo-200 leading-relaxed font-medium whitespace-pre-wrap">
                        {aiAnalysis}
                      </div>
                    </motion.div>
                  )}

                  {/* Barre de Filtres */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                    <div className="sm:col-span-2 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
                      <input 
                        type="text" 
                        placeholder="Rechercher un compte..." 
                        className="w-full pl-9 pr-4 py-2 bg-white border border-red-200 rounded-xl text-sm text-red-900 placeholder:text-red-300 focus:ring-2 focus:ring-red-500 outline-none transition-all"
                        value={anomalySearch}
                        onChange={(e) => setAnomalySearch(e.target.value)}
                      />
                    </div>
                    <div>
                      <select 
                        className="w-full px-3 py-2 bg-white border border-red-200 rounded-xl text-sm text-red-900 font-bold focus:ring-2 focus:ring-red-500 outline-none"
                        value={anomalyTypeFilter}
                        onChange={(e) => setAnomalyTypeFilter(e.target.value as any)}
                      >
                        <option value="all">Tous les types</option>
                        <option value="invalid">Invalides uniquement</option>
                        <option value="multiple">Doublons de libellés</option>
                      </select>
                    </div>
                    <button 
                      onClick={() => setAnomalySort(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="flex items-center justify-between px-4 py-2 bg-white border border-red-200 rounded-xl text-sm text-red-700 font-bold hover:bg-red-50 transition-colors"
                    >
                      <span>Compte</span>
                      {anomalySort === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                    </button>
                  </div>
                  
                  <div className="max-h-80 overflow-y-auto bg-white/50 backdrop-blur-sm rounded-2xl border border-red-100 p-1 space-y-1">
                    
                    {filteredAnomalies.invalid.length === 0 && filteredAnomalies.multiple.length === 0 && (
                      <div className="p-10 text-center">
                        <FileSearch className="w-10 h-10 text-red-200 mx-auto mb-2" />
                        <p className="text-sm font-medium text-red-400">Aucune anomalie ne correspond à vos filtres.</p>
                        <button 
                          onClick={() => { setAnomalySearch(''); setAnomalyTypeFilter('all'); }}
                          className="text-xs font-bold text-red-600 mt-2 hover:underline"
                        >
                          Réinitialiser les filtres
                        </button>
                      </div>
                    )}

                    {filteredAnomalies.invalid.length > 0 && (
                      <div className="p-4">
                        <h4 className="text-[10px] font-black text-red-900/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5" /> Numéros Invalides
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {filteredAnomalies.invalid.map((anomaly, idx) => (
                            <div key={`${anomaly.compte}-${idx}`} className="bg-[var(--bg-secondary)] p-3 rounded-xl border border-[var(--border-color)] shadow-sm group hover:border-red-300 transition-all">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="font-mono text-sm font-black text-slate-800 bg-red-50 px-2 py-1 rounded-lg border border-red-100">
                                  {anomaly.compte || '(vide)'}
                                </span>
                                <span className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase">
                                  {anomaly.reason}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-medium">
                                Lignes : {anomaly.lines.slice(0, 8).join(', ')}
                                {anomaly.lines.length > 8 && ` +${anomaly.lines.length - 8}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {filteredAnomalies.multiple.length > 0 && (
                      <div className="p-4 border-t border-red-100/50">
                        <h4 className="text-[10px] font-black text-amber-900/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5" /> Libellés Multiples
                        </h4>
                        <div className="space-y-3">
                          {filteredAnomalies.multiple.map((anomaly, idx) => (
                            <div key={`${anomaly.compte}-${idx}`} className="bg-[var(--bg-secondary)] p-4 rounded-2xl border border-[var(--border-color)] shadow-sm hover:border-amber-300 transition-all">
                              <span className="font-mono text-xs font-black text-slate-800 bg-amber-50 px-3 py-1 rounded-lg border border-amber-100 mb-3 inline-block">
                                Compte {anomaly.compte}
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {anomaly.variants.map((variant, i) => (
                                  <div key={`${variant.lib}-${i}`} className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                    <div className="font-bold text-slate-700 text-xs mb-1 line-clamp-1" title={variant.lib}>
                                      {variant.lib}
                                    </div>
                                    <div className="text-[9px] text-slate-400 font-medium">
                                      {variant.lines.length} occurrence(s)
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>
            </div>
          ) : accountAnomalies && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-6 shadow-sm">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="text-base font-semibold text-emerald-800">
                    Aucune anomalie détectée
                  </h3>
                  <p className="text-sm text-emerald-700">
                    Tous les numéros de compte sont valides et chaque compte possède un libellé unique.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* --- Aperçu des données --- */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-6 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Aperçu — 50 premières lignes</h2>
              
              <div className="flex flex-wrap items-center gap-2">
                {/* Sélecteur de colonnes */}
                <div className="relative">
                  <button 
                    onClick={() => setShowColSelector(!showColSelector)}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${showColSelector ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <ListFilter className="w-4 h-4" />
                    Colonnes
                  </button>
                  
                  {showColSelector && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => { setShowColSelector(false); setColSearch(''); }}></div>
                      <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 p-0 animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[450px] overflow-hidden">
                        
                        {/* Barre de recherche */}
                        <div className="p-3 border-b border-slate-100 bg-slate-50/50">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input 
                              type="text" 
                              placeholder="Rechercher une colonne..."
                              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                              value={colSearch}
                              onChange={(e) => setColSearch(e.target.value)}
                              autoFocus
                            />
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 custom-scrollbar">
                          {/* Section Actives (Réordonnables) */}
                          <div className="mb-4">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-2 flex items-center justify-between">
                              <span>Colonnes Actives</span>
                              <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded italic normal-case font-medium">Glisser pour réorganiser</span>
                            </div>
                            
                            <Reorder.Group 
                              axis="y" 
                              values={visibleColumns} 
                              onReorder={setVisibleColumns}
                              className="space-y-1"
                            >
                              {visibleColumns.filter(c => !colSearch || (PREVIEW_LABELS[c] || c).toLowerCase().includes(colSearch.toLowerCase())).map(col => (
                                <Reorder.Item 
                                  key={col} 
                                  value={col}
                                  className="group relative cursor-grab active:cursor-grabbing"
                                >
                                  <div className="flex items-center justify-between px-3 py-2 text-sm rounded-lg bg-white border border-slate-100 hover:border-amber-200 hover:bg-amber-50/30 transition-all shadow-sm">
                                    <div className="flex items-center gap-2">
                                      <div className="flex flex-col gap-0.5 opacity-30 group-hover:opacity-100">
                                        <div className="w-3 h-0.5 bg-slate-400 rounded-full"></div>
                                        <div className="w-3 h-0.5 bg-slate-400 rounded-full"></div>
                                      </div>
                                      <span className="text-slate-900 font-bold text-xs">
                                        {PREVIEW_LABELS[col] || col}
                                      </span>
                                    </div>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (visibleColumns.length > 1) {
                                          setVisibleColumns(visibleColumns.filter(c => c !== col));
                                        }
                                      }}
                                      className="p-1 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded transition-colors"
                                    >
                                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    </button>
                                  </div>
                                </Reorder.Item>
                              ))}
                            </Reorder.Group>
                          </div>

                          {/* Section Disponibles */}
                          {Object.keys(PREVIEW_LABELS).filter(c => !visibleColumns.includes(c)).filter(c => !colSearch || (PREVIEW_LABELS[c] || c).toLowerCase().includes(colSearch.toLowerCase())).length > 0 && (
                            <div>
                              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-2">Autres Colonnes</div>
                              <div className="space-y-1">
                                {Object.keys(PREVIEW_LABELS)
                                  .filter(c => !visibleColumns.includes(c))
                                  .filter(c => !colSearch || (PREVIEW_LABELS[c] || c).toLowerCase().includes(colSearch.toLowerCase()))
                                  .map(col => (
                                    <button
                                      key={col}
                                      onClick={() => setVisibleColumns([...visibleColumns, col])}
                                      className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all text-slate-500 hover:text-slate-900 group"
                                    >
                                      <span className="font-medium">{PREVIEW_LABELS[col] || col}</span>
                                      <div className="w-4 h-4 rounded-full border border-slate-200 group-hover:border-emerald-500 flex items-center justify-center transition-colors">
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                      </div>
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}

                          {/* État vide recherche */}
                          {Object.keys(PREVIEW_LABELS).filter(c => (PREVIEW_LABELS[c] || c).toLowerCase().includes(colSearch.toLowerCase())).length === 0 && (
                            <div className="p-8 text-center bg-slate-50 rounded-xl m-2 border border-dashed border-slate-200">
                              <p className="text-[10px] font-bold text-slate-400 italic">Aucun résultat pour "{colSearch}"</p>
                            </div>
                          )}
                        </div>

                        <div className="p-3 border-t border-slate-100 flex justify-between gap-2 bg-slate-50/50">
                          <button 
                            onClick={() => setVisibleColumns(['JournalCode', 'EcritureDate', 'CompteNum', 'EcritureLib', 'Debit', 'Credit'])}
                            className="text-[10px] font-black uppercase text-slate-500 hover:text-indigo-600 transition-colors"
                          >
                            Réinitialiser
                          </button>
                          <button 
                            onClick={() => { setShowColSelector(false); setColSearch(''); }}
                            className="text-[10px] font-black uppercase text-amber-600 hover:text-amber-700 transition-colors"
                          >
                            Fermer
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <label htmlFor="lib-filter-input" className="sr-only">Filtrer par libellé</label>
                  <input 
                    id="lib-filter-input"
                    type="text" 
                    placeholder="Filtrer par libellé..." 
                    className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-sm transition-all shadow-sm"
                    value={libFilter}
                    onChange={(e) => setLibFilter(e.target.value)}
                  />
                  {libFilter && (
                    <button 
                      onClick={() => setLibFilter('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      aria-label="Effacer le filtre libellé"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="relative w-full sm:w-80 group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                  <label htmlFor="preview-search-input" className="sr-only">Rechercher dans les lignes converties</label>
                  <input 
                    id="preview-search-input"
                    type="text" 
                    placeholder='Filtrer (ex: journal:VENTE AND lib:"achat")...' 
                    className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none text-sm transition-all shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      aria-label="Effacer la recherche"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 cursor-help text-slate-300 hover:text-amber-500 transition-colors">
                    <AlertCircle className="w-4 h-4" />
                    <div className="absolute bottom-full right-0 mb-2 w-72 bg-slate-800 text-white p-3 rounded-xl shadow-xl text-[10px] leading-relaxed hidden group-hover:block z-50">
                      <p className="font-bold mb-1 text-amber-400 uppercase tracking-widest">Recherche Avancée</p>
                      <ul className="space-y-1 opacity-90">
                        <li>• <code className="text-amber-200">AND</code>, <code className="text-amber-200">OR</code>, <code className="text-amber-200">NOT</code> (ou <code className="text-amber-200">-</code>)</li>
                        <li>• <code className="text-amber-200">"phrase exacte"</code> entre guillemets</li>
                        <li>• Parenthèses <code className="text-amber-200">( ... )</code> pour la priorité</li>
                        <li>• Préfixes : <code className="text-amber-200">journal:</code>, <code className="text-amber-200">compte:</code>, <code className="text-amber-200">client:</code>, <code className="text-amber-200">piece:</code>, <code className="text-amber-200">lib:</code></li>
                      </ul>
                      <p className="mt-2 text-[9px] italic border-top border-white/10 pt-1">Ex: journal:VENTE AND (client:Dupont OR client:Durand) -facture</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse min-w-[800px] preview-table" role="grid" aria-label="Aperçu des écritures converties">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 preview-header-row" role="row">
                    {visibleColumns.map(c => (
                      <th 
                        key={c} 
                        className="p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors select-none preview-header-cell"
                        onClick={() => handleSort(c)}
                        role="columnheader"
                        aria-sort={sortConfig?.key === c ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSort(c); }}
                      >
                        <div className="flex items-center gap-1">
                          {PREVIEW_LABELS[c] || c}
                          {sortConfig?.key === c ? (
                            sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" aria-hidden="true" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100" role="rowgroup">
                  {sortedTransformed.length === 0 ? (
                    <tr role="row">
                      <td colSpan={visibleColumns.length} className="p-12 text-center text-slate-400 italic" role="gridcell">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="w-8 h-8 opacity-20" aria-hidden="true" />
                          <p>Aucune écriture ne correspond à vos critères de recherche</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedTransformed
                      .slice(0, 50)
                      .map((r, i) => (
                      <tr key={`${r.EcritureNum}-${i}`} className="hover:bg-slate-50 preview-body-row" role="row">
                        {visibleColumns.map(c => (
                          <td key={c} className={`p-3 text-sm text-slate-700 truncate max-w-[200px] ${['Debit', 'Credit'].includes(c) ? 'font-mono text-right' : ''} preview-body-cell`} role="gridcell">
                            {['Debit', 'Credit'].includes(c) ? fmt2(r[c]) : r[c] || ''}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex gap-4">
              <button className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-4 py-2 font-medium" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
              <button className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-4 py-2 font-medium" onClick={reset}>
                <RefreshCw className="w-4 h-4" /> Nouveau fichier
              </button>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <button 
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-xl font-semibold shadow-sm transition-colors flex-1 sm:flex-none justify-center"
                onClick={() => setStep(4)}
              >
                <Scale className="w-5 h-5" /> Contrôler avec une balance
              </button>
              <button 
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-semibold shadow-sm transition-colors flex-1 sm:flex-none justify-center"
                onClick={exportXLSX}
              >
                <Download className="w-5 h-5" /> Télécharger Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* ÉTAPE 4 : CONTRÔLE DE BALANCE */}
      {/* ============================================================================ */}
      {step === 4 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-6 mb-4 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                  ④ Contrôle de Balance
                </h2>
                <p className="text-sm text-slate-500">
                  Comparez votre FEC avec une balance extraite de votre ancien logiciel.
                </p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Tolérance */}
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  <label htmlFor="tolerance-input" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Tolérance</label>
                  <input 
                    type="number" 
                    id="tolerance-input"
                    step="0.01"
                    min="0"
                    className="w-14 bg-transparent border-none p-0 text-xs font-mono focus:ring-0 text-slate-700 font-bold"
                    value={balanceTolerance}
                    onChange={(e) => setBalanceTolerance(parseFloat(e.target.value) || 0)}
                  />
                  <span className="text-slate-400 text-[10px] font-bold">€</span>
                </div>

                {/* Normalisation */}
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <select 
                    className="bg-transparent border-none p-0 text-xs font-bold text-slate-600 focus:ring-0 outline-none cursor-pointer"
                    value={normLevel}
                    onChange={(e) => setNormLevel(e.target.value as any)}
                  >
                    <option value="full">Détail complet</option>
                    <option value="3">Niveau 3 chiffres</option>
                    <option value="6">Niveau 6 chiffres</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                  <input 
                    type="checkbox" 
                    id="ocr-toggle" 
                    className="w-3.5 h-3.5 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500"
                    checked={useOcr}
                    onChange={(e) => setUseOcr(e.target.checked)}
                  />
                  <label htmlFor="ocr-toggle" className="text-[10px] font-bold text-indigo-700 flex items-center gap-1.5 cursor-pointer select-none uppercase tracking-wider">
                    <ScanText className="w-3.5 h-3.5" /> OCR
                  </label>
                </div>
              </div>
            </div>
            
            {/* --- Zone de dépôt du fichier de balance --- */}
            {Object.keys(balSoldes).length === 0 ? (
              <div className="space-y-4">
                <div 
                  className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-colors bg-slate-50 relative overflow-hidden"
                  onClick={() => balInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleBalDrop}
                >
                  <input type="file" ref={balInputRef} className="hidden" accept=".xls,.xlsx,.csv,.pdf" onChange={(e) => e.target.files?.[0] && handleBalanceCheck(e.target.files[0])} />
                  <div className="bg-white w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                    <Upload className="w-8 h-8 text-indigo-500" />
                  </div>
                  <p className="text-slate-700 font-bold text-lg mb-1">
                    Déposez votre fichier de Balance
                  </p>
                  <p className="text-sm text-slate-500">Formats acceptés : PDF · Excel · CSV</p>
                  {loadingBal && (
                    <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300 z-10 rounded-[32px]">
                      <div className="relative mb-6">
                        <RefreshCw className="w-16 h-16 text-indigo-600 animate-spin" />
                        {useOcr && (
                          <div className="absolute -bottom-2 -right-2 bg-amber-500 text-white p-2 rounded-xl shadow-lg border-2 border-white dark:border-slate-900 animate-bounce">
                            <ScanText className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <h3 className="text-indigo-900 dark:text-indigo-100 font-black text-xl mb-1">
                        {useOcr ? 'Analyse OCR Active' : 'Extraction PDF'}
                      </h3>
                      <p className="text-[var(--text-secondary)] text-sm mb-8 font-medium">
                        {balProgress < 100 ? `Lecture du document : ${balProgress}%` : "Finalisation de l'analyse..."}
                      </p>
                      <div className="w-full max-w-xs bg-indigo-100 dark:bg-indigo-950 rounded-full h-3 mb-3 shadow-inner overflow-hidden border border-indigo-200/50">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${balProgress}%` }}
                          className="bg-indigo-600 h-full rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                        />
                      </div>
                      <div className="text-xs font-black text-indigo-500 uppercase tracking-widest tabular-nums">Traitement en cours</div>
                    </div>
                  )}
                  {errBal && <div className="mt-4 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center gap-3"><AlertCircle className="w-5 h-5" /> {errBal}</div>}
                  
                  {pdfRetryWithOcr && !loadingBal && (
                    <div className="mt-4 p-5 bg-amber-50 border border-amber-200 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <div className="flex items-start gap-4">
                        <div className="p-2 bg-amber-100 rounded-xl">
                          <ScanText className="w-6 h-6 text-amber-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-bold text-amber-900 mb-1">Activer l'OCR (Reconnaissance de texte) ?</h4>
                          <p className="text-xs text-amber-700 leading-relaxed mb-4">
                            L'extraction standard n'a rien retourné. Ce PDF est probablement un document numérisé (image). 
                            L'analyse par OCR est plus lente mais permet de lire le texte directement sur les images.
                          </p>

                          <div className="flex flex-col gap-4 mb-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Langue du document</label>
                              <select 
                                value={ocrLanguage}
                                onChange={(e) => setOcrLanguage(e.target.value)}
                                className="bg-white/50 border border-amber-200 rounded-lg p-2 text-xs outline-none focus:border-amber-500 transition-colors"
                              >
                                {OCR_LANGUAGES.map(lang => (
                                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => {
                                setUseOcr(true);
                                handleBalanceCheck(pdfRetryWithOcr);
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-sm transition-all active:scale-95 flex items-center gap-2"
                            >
                              <Check className="w-3.5 h-3.5" /> Lancer l'analyse OCR
                            </button>
                            <button 
                              onClick={() => setPdfRetryWithOcr(null)}
                              className="text-[10px] font-bold text-amber-500 hover:text-amber-700 uppercase tracking-widest"
                            >
                              Ignorer
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {lastSuccessfulBal && !loadingBal && (
                  <button 
                    onClick={handleReuseLastBalance}
                    className="w-full bg-indigo-50 border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-100/50 p-4 rounded-xl transition-all group flex items-center justify-between shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-white p-2 rounded-lg shadow-sm border border-indigo-50 group-hover:scale-110 transition-transform">
                        <History className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-0.5">Réutiliser la dernière balance</p>
                        <p className="text-xs text-indigo-600 font-medium opacity-70 italic">{lastSuccessfulBal.name}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
              </div>
            ) : (
              <div className="animate-in fade-in duration-500">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="bg-white p-2 rounded-lg shadow-sm">
                      <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Balance active</p>
                      <p className="text-sm font-bold text-slate-700">{fileNameBal || 'Balance importée'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => { setBalanceFile(null); setBalSoldes({}); setBalRawText(''); setFileNameBal(''); }}
                      className="text-xs text-red-600 hover:text-red-700 font-bold bg-white px-3 py-1.5 rounded-lg border border-red-100 hover:border-red-200 transition-all shadow-sm active:scale-95"
                    >
                      Détacher le fichier
                    </button>
                    <button 
                      onClick={exportBalanceXLSX}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95"
                      aria-label="Exporter le rapport des écarts"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" /> Export Rapport
                    </button>
                  </div>
                </div>

                {/* --- Résultats de la comparaison --- */}
                
                {/* Dashboard Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" role="list" aria-label="Récapitulatif des écarts">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm transition-all hover:shadow-md" role="listitem">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Écart Absolu</span>
                    </div>
                    <div className="text-2xl font-black font-mono text-slate-800">
                      {fmt2(comparisonData.reduce((sum, row) => sum + Math.abs(row.ecart), 0))} €
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm" role="listitem">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                       <CheckCircle2 className="w-4 h-4 text-red-500" aria-hidden="true" />
                       <span className="text-[10px] font-bold uppercase tracking-wider">Écarts ({'>'}{balanceTolerance}€)</span>
                    </div>
                    <div className="text-2xl font-black font-mono text-slate-800">
                      {comparisonData.filter(r => Math.abs(r.ecart) > balanceTolerance).length}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm" role="listitem">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                       <FileSearch className="w-4 h-4 text-blue-500" aria-hidden="true" />
                       <span className="text-[10px] font-bold uppercase tracking-wider">Absent Balance</span>
                    </div>
                    <div className="text-2xl font-black font-mono text-slate-800">
                      {comparisonData.filter(r => r.hasFec && !r.hasBal).length}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm" role="listitem">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                       <Files className="w-4 h-4 text-indigo-500" aria-hidden="true" />
                       <span className="text-[10px] font-bold uppercase tracking-wider">Absent FEC</span>
                    </div>
                    <div className="text-2xl font-black font-mono text-slate-800">
                      {comparisonData.filter(r => !r.hasFec && r.hasBal).length}
                    </div>
                  </div>
                </div>

                {/* Filters and Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pt-2">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar" role="group" aria-label="Filtres de balance">
                    <button 
                      onClick={() => setBalFilter('all')}
                      aria-pressed={balFilter === 'all'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'all' ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Tous ({comparisonData.length})
                    </button>
                    <button 
                      onClick={() => setBalFilter('errors')}
                      aria-pressed={balFilter === 'errors'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'errors' ? 'bg-red-600 border-red-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Écarts ({comparisonData.filter(r => Math.abs(r.ecart) > balanceTolerance).length})
                    </button>
                    <button 
                      onClick={() => setBalFilter('missing-bal')}
                      aria-pressed={balFilter === 'missing-bal'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'missing-bal' ? 'bg-amber-600 border-amber-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Manque Balance ({comparisonData.filter(r => r.hasFec && !r.hasBal).length})
                    </button>
                    <button 
                      onClick={() => setBalFilter('missing-fec')}
                      aria-pressed={balFilter === 'missing-fec'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'missing-fec' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Manque FEC ({comparisonData.filter(r => !r.hasFec && r.hasBal).length})
                    </button>
                    <button 
                      onClick={() => setBalFilter('diff-only')}
                      aria-pressed={balFilter === 'diff-only'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'diff-only' ? 'bg-orange-600 border-orange-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      title="Présent dans les deux mais avec un écart"
                    >
                      Écarts Rapproch. ({comparisonData.filter(r => r.hasFec && r.hasBal && Math.abs(r.ecart) > balanceTolerance).length})
                    </button>
                    <button 
                      onClick={() => setBalFilter('ok')}
                      aria-pressed={balFilter === 'ok'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${balFilter === 'ok' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Équilibrés ({comparisonData.filter(r => Math.abs(r.ecart) <= balanceTolerance).length})
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative group hidden lg:block">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" aria-hidden="true" />
                      <label htmlFor="balance-account-search" className="sr-only">Filtrer par compte</label>
                      <input 
                        id="balance-account-search"
                        type="text"
                        placeholder="Filtrer un compte..."
                        className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all w-48 focus:w-64"
                        value={balSearch}
                        onChange={e => setBalSearch(e.target.value)}
                      />
                    </div>
                  <button 
                      onClick={exportBalanceXLSX}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:scale-105 active:scale-95"
                      title="Exporter le tableau des écarts vers Excel"
                      aria-label="Exporter le rapport des écarts"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      Export .xlsx
                    </button>
                    {balRawText && (
                      <button 
                        onClick={() => setShowBalRaw(!showBalRaw)}
                        aria-expanded={showBalRaw}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${showBalRaw ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      >
                        {showBalRaw ? <EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                        {showBalRaw ? 'Masquer Extraction' : 'Voir Extraction'}
                      </button>
                    )}
                    <button onClick={() => { setBalanceFile(null); setBalSoldes({}); setBalRawText(''); }} className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 transition-colors">
                      Changer de fichier
                    </button>
                  </div>
                </div>

                {/* Raw text extractor debugger */}
                {showBalRaw && balRawText && (
                  <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
                    <div className="bg-slate-900 rounded-xl p-4 overflow-hidden border border-slate-800 shadow-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <ScanText className="w-3.5 h-3.5" /> Debug : Texte extrait du PDF
                        </h4>
                        <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Brut</span>
                      </div>
                      <pre className="text-[10px] font-mono text-slate-400 bg-slate-950/50 p-4 rounded-lg max-h-[300px] overflow-y-auto whitespace-pre-wrap leading-relaxed select-all">
                        {balRawText}
                      </pre>
                    </div>
                  </div>
                )}

                {/* --- Message global (succès ou erreur) --- */}
                {(() => {
                  const totalAbsEcart = comparisonData.reduce((sum, row) => sum + Math.abs(row.ecart), 0);
                  const hasEcarts = comparisonData.some(r => Math.abs(r.ecart) > balanceTolerance);
                  const isHighDiscrepancy = totalAbsEcart > 1000;

                  if (hasEcarts) {
                    return (
                      <div 
                        role="alert"
                        aria-live="assertive"
                        className={`p-6 border rounded-2xl mb-6 shadow-2xl flex flex-col md:flex-row items-start gap-6 animate-in slide-in-from-bottom-4 duration-500 overflow-hidden relative ${isHighDiscrepancy ? 'bg-red-950 border-red-800 text-red-50' : 'bg-red-50 border-red-200 text-red-800'}`}
                      >
                        {isHighDiscrepancy && <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none text-red-500"><AlertCircle className="w-32 h-32" aria-hidden="true" /></div>}
                        
                        <div className={`p-3 rounded-2xl shrink-0 ${isHighDiscrepancy ? 'bg-red-500 text-white shadow-lg' : 'bg-red-100 text-red-600'}`}>
                          <AlertCircle className="w-8 h-8" aria-hidden="true" />
                        </div>
                        
                        <div className="flex-1 space-y-4">
                          <div>
                            <h4 className={`text-xl font-black uppercase tracking-tight mb-2 ${isHighDiscrepancy ? 'text-white' : 'text-red-900'}`}>
                              {isHighDiscrepancy ? 'CRITICAL : Anomalie de rapprochement majeure' : 'Anomalies de rapprochement détectées'}
                            </h4>
                            <p className={`text-sm leading-relaxed opacity-90 ${isHighDiscrepancy ? 'text-red-100' : 'text-red-700'}`}>
                              L'écart absolu cumulé s'élève à <strong className="font-mono text-lg underline decoration-amber-400 decoration-2 underline-offset-4">{fmt2(totalAbsEcart)} €</strong>, dépassant largement le seuil de tolérance défini.
                            </p>
                          </div>

                          {isHighDiscrepancy && (
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                              <h5 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <Search className="w-3.5 h-3.5" /> Pistes de vérification recommandées :
                              </h5>
                              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                  { t: 'Formats de date', d: 'Inversion jour/mois ou année sur 2 chiffres.' },
                                  { t: 'Sens des écritures', d: 'Avoirs ou montants négatifs mal interprétés.' },
                                  { t: 'Auxiliaires fusionnés', d: 'Comptes de tiers non détaillés dans la balance.' },
                                  { t: 'Erreurs OCR', d: 'Chiffre 9 lu comme 0, virgules mal placées sur PDF scanné.' },
                                  { t: 'Paramètres Conversion', d: 'Vérifiez les paramètres d\'encodage au chargement.' },
                                  { t: 'Solde Initial', d: 'Le solde à nouveau est-il inclus dans la balance ?' }
                                ].map((step, i) => (
                                  <li key={step.t} className="flex items-start gap-2 text-xs">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                                    <div>
                                      <span className="font-bold text-white">{step.t} :</span>{' '}
                                      <span className="text-red-200">{step.d}</span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <p className={`text-[10px] uppercase font-bold tracking-wider pt-2 ${isHighDiscrepancy ? 'text-red-400' : 'text-red-500'}`}>
                            {isHighDiscrepancy ? '⚠️ Une revue manuelle ligne par ligne est impérative.' : 'Une vérification est conseillée pour les comptes en rouge ci-dessous.'}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-6 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-emerald-800">Balance parfaitement équilibrée</h4>
                        <p className="text-sm text-emerald-700 mt-1">Tous les soldes du FEC correspondent à la balance importée (Tolérance: {balanceTolerance} €).</p>
                      </div>
                    </div>
                  );
                })()}

                {/* --- Tableau détaillé des écarts --- */}
                <div className="overflow-hidden border border-slate-200 rounded-2xl shadow-sm bg-white">
                  <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead className="sticky top-0 bg-white/95 backdrop-blur-sm shadow-sm z-10">
                        <tr className="border-b border-slate-100 bg-slate-50/30">
                          {[
                            { label: 'Compte', key: 'compte', align: 'left', width: 'w-1/6' },
                            { label: 'Libellé', key: 'lib', align: 'left', width: 'w-1/4' },
                            { label: 'Solde FEC', key: 'soldeFec', align: 'right', width: 'w-1/6', color: 'text-indigo-600' },
                            { label: 'Solde Balance', key: 'soldeBal', align: 'right', width: 'w-1/6', color: 'text-amber-600' },
                            { label: 'Écart', key: 'ecart', align: 'right', width: 'w-1/6' }
                          ].map(h => (
                            <th 
                              key={h.key}
                              onClick={() => handleBalSort(h.key)}
                              className={`p-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] cursor-pointer hover:bg-slate-50 transition-colors ${h.align === 'right' ? 'text-right' : 'text-left'} ${h.width}`}
                            >
                              <div className={`flex items-center gap-2 ${h.align === 'right' ? 'justify-end' : 'justify-start'}`}>
                                <span className={h.color}>{h.label}</span>
                                {balSortConfig?.key === h.key ? (
                                  balSortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-500" /> : <ArrowDown className="w-3 h-3 text-indigo-500" />
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-20" />
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {comparisonData.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-12 text-center">
                              <div className="flex flex-col items-center gap-2 text-slate-400">
                                <Search className="w-10 h-10 opacity-20" />
                                <p className="italic">Aucun compte ne correspond aux filtres sélectionnés.</p>
                              </div>
                            </td>
                          </tr>
                        ) : comparisonData.map((r, i) => {
                          const isErr = Math.abs(r.ecart) > balanceTolerance;
                          const isMissingBal = r.hasFec && !r.hasBal;
                          const isMissingFec = !r.hasFec && r.hasBal;
                          const isPerfect = !isErr && r.hasFec && r.hasBal;

                          return (
                            <tr 
                              key={normLevel + r.compte + i} 
                              onClick={() => r.hasFec && setSelectedNorm(r.norm)}
                              className={`group transition-all duration-200 border-l-4 cursor-pointer hover:bg-slate-50
                                ${isErr ? 'bg-red-50 hover:bg-red-100/50 border-l-red-500' : 
                                  isMissingBal || isMissingFec ? 'bg-amber-50/50 hover:bg-amber-100/50 border-l-amber-400' : 
                                  'border-l-transparent'}`}
                            >
                              <td className="p-4 text-sm font-bold font-mono tracking-tight">
                                <div className="flex items-center gap-2">
                                  {r.compte}
                                  {r.hasFec && <ExternalLink className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                </div>
                                {isErr && <div className="text-[9px] font-black text-red-600 uppercase tracking-tighter mt-1">Anomalie</div>}
                                {isMissingBal && <div className="text-[9px] font-black text-amber-600 uppercase tracking-tighter mt-1">Absent Balance</div>}
                                {isMissingFec && <div className="text-[9px] font-black text-blue-600 uppercase tracking-tighter mt-1">Absent FEC</div>}
                              </td>
                              <td className="p-4 text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                                <div className="truncate max-w-[250px] font-medium" title={r.lib}>
                                  {r.lib || '-'}
                                </div>
                              </td>
                              <td className={`p-4 text-sm font-mono text-right tabular-nums ${!r.hasFec ? 'opacity-20 italic' : 'text-indigo-700 font-bold'}`}>
                                {r.hasFec ? fmt2(r.soldeFec) : '(néant)'}
                              </td>
                              <td className={`p-4 text-sm font-mono text-right tabular-nums ${!r.hasBal ? 'opacity-20 italic' : 'text-amber-700 font-bold'}`}>
                                {r.hasBal ? fmt2(r.soldeBal) : '(néant)'}
                              </td>
                              <td className={`p-4 text-sm font-mono text-right tabular-nums transition-all`}>
                                <div className={`inline-block px-3 py-1 rounded-lg border font-black ${
                                  isErr ? 'bg-red-500 text-white border-red-600 shadow-sm shadow-red-200 scale-105' : 
                                  isPerfect ? 'text-emerald-700 border-emerald-100 bg-emerald-50' : 
                                  'text-slate-400 border-slate-100 bg-slate-50'
                                }`}>
                                  {fmt2(r.ecart)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* --- Actions de l'étape 4 --- */}
          <div className="flex justify-between items-center mt-6">
            <button className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-4 py-2 font-medium transition-colors" onClick={() => setStep(3)}>
              <ArrowLeft className="w-4 h-4" /> Retour à l'export
            </button>
            {fileNameBal && (
              <button 
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-sm transition-all active:scale-95"
                onClick={exportBalanceXLSX}
              >
                <Download className="w-5 h-5" /> Télécharger Excel (.xlsx)
              </button>
            )}
          </div>

          <AnimatePresence>
            {selectedNorm && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => { setSelectedNorm(null); setSidePanelSearch(''); }}
                  className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
                />
                <motion.div 
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="fixed top-0 right-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200"
                >
                  <div className="p-6 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
                          <FileText className="w-5 h-5 text-indigo-500" />
                          Détail des écritures FEC
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                          Regroupement : <span className="font-mono font-bold text-indigo-600">{selectedNorm}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => selectedNorm && exportDetailedFecXLSX(selectedNorm)}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 transition-all hover:scale-105 active:scale-95"
                          title="Exporter ce détail vers Excel"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export .xlsx</span>
                        </button>
                        <button 
                          onClick={() => { setSelectedNorm(null); setSidePanelSearch(''); }}
                          className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          <X className="w-6 h-6" />
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Rechercher une écriture, un montant ou un libellé..."
                        className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                        value={sidePanelSearch}
                        onChange={e => setSidePanelSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <div className="space-y-4">
                      {(() => {
                        const normalizeAccount = (acc: string) => {
                          if (normLevel === 'full') return acc;
                          return acc.substring(0, parseInt(normLevel));
                        };

                        const filtered = transformed.filter(r => {
                          const matchesNorm = normalizeAccount(r.CompteNum) === selectedNorm;
                          if (!matchesNorm) return false;
                          
                          if (!sidePanelSearch.trim()) return true;
                          const q = sidePanelSearch.toLowerCase();
                          
                          // Nettoyage pour recherche numérique
                          const searchNum = parseFloat(q.replace(',', '.').replace(/\s/g, ''));
                          const matchesAmount = !isNaN(searchNum) && (
                            Math.abs(r.Debit - searchNum) < 0.01 || 
                            Math.abs(r.Credit - searchNum) < 0.01
                          );

                          return (
                            (r.EcritureLib || '').toLowerCase().includes(q) ||
                            (r.CompteLib || '').toLowerCase().includes(q) ||
                            (r.CompteNum || '').includes(q) ||
                            (r.EcritureNum || '').toString().includes(q) ||
                            matchesAmount
                          );
                        });

                        if (filtered.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400 italic">
                              <Search className="w-12 h-12 opacity-10 mb-4" />
                              <p>Aucune écriture ne correspond à votre recherche.</p>
                            </div>
                          );
                        }

                        return filtered.map((r, i) => (
                          <div key={`${r.CompteNum}-${r.EcritureDate}-${i}`} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-colors group">
                            <div className="flex justify-between items-start mb-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                    {r.JournalCode}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {r.JournalLib}
                                  </span>
                                </div>
                                <div className="text-sm font-bold text-slate-800 leading-tight group-hover:text-indigo-900 transition-colors">
                                  {r.EcritureLib}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] font-mono font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded">N° {r.EcritureNum}</div>
                                <div className="text-[10px] font-black text-slate-500 mt-1 uppercase tracking-tighter">{r.EcritureDate}</div>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded shadow-inner">
                                  {r.CompteNum}
                                </span>
                                <span className="text-slate-500 italic max-w-[220px] truncate">{r.CompteLib}</span>
                              </div>
                              <div className="flex gap-4 font-mono text-sm tabular-nums">
                                {r.Debit > 0 && (
                                  <div className="flex flex-col items-end">
                                    <span className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter">Débit</span>
                                    <span className="text-emerald-700 font-black">{fmt2(r.Debit)}</span>
                                  </div>
                                )}
                                {r.Credit > 0 && (
                                  <div className="flex flex-col items-end">
                                    <span className="text-[9px] font-black text-amber-600 uppercase tracking-tighter">Crédit</span>
                                    <span className="text-amber-700 font-black">{fmt2(r.Credit)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="p-6 bg-white border-t border-slate-200 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)]">
                    <div className="flex justify-between items-center">
                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                          Résumé du groupe
                        </div>
                        <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 inline-block font-sans">
                          {(() => {
                            const normalizeAccount = (acc: string) => {
                              if (normLevel === 'full') return acc;
                              return acc.substring(0, parseInt(normLevel));
                            };
                            return transformed.filter(r => normalizeAccount(r.CompteNum) === selectedNorm).length;
                          })()} écritures au total
                        </div>
                      </div>
                      <div className="flex gap-6">
                        <div className="text-right relative">
                          <div className="text-[9px] text-emerald-500 uppercase font-black tracking-widest mb-1">Total Débit</div>
                          <div className="text-xl font-black text-slate-900 tabular-nums leading-none">
                            {fmt2(transformed.filter(r => {
                              const normalizeAccount = (acc: string) => {
                                if (normLevel === 'full') return acc;
                                return acc.substring(0, parseInt(normLevel));
                              };
                              return normalizeAccount(r.CompteNum) === selectedNorm;
                            }).reduce((s, r) => s + (r.Debit || 0), 0))} <span className="text-xs font-bold text-slate-400">€</span>
                          </div>
                          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-emerald-500/20 rounded-full" />
                        </div>
                        <div className="text-right relative">
                          <div className="text-[9px] text-amber-500 uppercase font-black tracking-widest mb-1">Total Crédit</div>
                          <div className="text-xl font-black text-slate-900 tabular-nums leading-none">
                            {fmt2(transformed.filter(r => {
                              const normalizeAccount = (acc: string) => {
                                if (normLevel === 'full') return acc;
                                return acc.substring(0, parseInt(normLevel));
                              };
                              return normalizeAccount(r.CompteNum) === selectedNorm;
                            }).reduce((s, r) => s + (r.Credit || 0), 0))} <span className="text-xs font-bold text-slate-400">€</span>
                          </div>
                          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-amber-500/20 rounded-full" />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}
          </div>
        </div>
      </main>
    </div>
  );
}
