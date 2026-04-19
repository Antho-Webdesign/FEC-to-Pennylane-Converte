// ============================================================================
// IMPORTS
// ============================================================================
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import Tesseract from 'tesseract.js';
import JSZip from 'jszip';
import { Upload, FileSpreadsheet, Settings, ArrowRight, ArrowLeft, Download, RefreshCw, AlertCircle, AlertTriangle, CheckCircle2, Scale, Lock, Sun, Moon, Search, ArrowUpDown, ArrowUp, ArrowDown, Save, Trash2, ListFilter, Check, ScanText, Files, FileText, X } from 'lucide-react';

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
  { key: 'JournalCode', label: 'Code Journal', req: false, aliases: ['journalcode', 'codejournal', 'journal'] },
  { key: 'JournalLib', label: 'Libellé Journal', req: false, aliases: ['journallib', 'libellejournal', 'nomjournal'] },
  { key: 'EcritureNum', label: 'N° Écriture', req: false, aliases: ['ecriturenum', 'numecriture', 'ecritnum'] },
  { key: 'EcritureDate', label: 'Date Écriture ★', req: true, aliases: ['ecrituredate', 'dateecriture', 'date'] },
  { key: 'CompteNum', label: 'N° Compte ★', req: true, aliases: ['comptenum', 'numerocompte', 'compte', 'accountnum', 'numcompte'] },
  { key: 'CompteLib', label: 'Libellé Compte', req: false, aliases: ['comptelib', 'libellecompte', 'nomcompte'] },
  { key: 'CompAuxNum', label: 'Cpte Auxiliaire', req: false, aliases: ['compauxnum', 'compteauxiliaire', 'auxnum'] },
  { key: 'CompAuxLib', label: 'Lib. Auxiliaire', req: false, aliases: ['compauxlib', 'libelleauxiliaire'] },
  { key: 'PieceRef', label: 'Réf. Pièce', req: false, aliases: ['pierceref', 'pieceref', 'reference', 'refpiece'] },
  { key: 'PieceDate', label: 'Date Pièce', req: false, aliases: ['piecedate', 'datepieced', 'datefacture'] },
  { key: 'EcritureLib', label: 'Libellé Écriture ★', req: true, aliases: ['ecriturelib', 'libelle', 'libellecriture', 'label', 'description'] },
  { key: 'Debit', label: 'Débit', req: false, aliases: ['debit', 'débit', 'montant_d', 'montantdebit'] },
  { key: 'Credit', label: 'Crédit', req: false, aliases: ['credit', 'crédit', 'montant_c', 'montantcredit'] },
  { key: 'Montant', label: 'Montant (unique)', req: false, aliases: ['montant', 'amount', 'valeur'] },
  { key: 'Sens', label: 'Sens D/C', req: false, aliases: ['sens', 'dc', 'signe'] },
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
 * en se basant sur les alias définis dans `FIELDS`.
 */
function autoMap(headers: string[]) {
  const lh = headers.map(h => h.toLowerCase());
  const m: Record<string, string> = {};
  FIELDS.forEach(f => {
    const found = f.aliases.find(a => lh.includes(a.toLowerCase()));
    m[f.key] = found ? headers[lh.indexOf(found.toLowerCase())] : '__ignore__';
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
function parseAmt(s: any) {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/\s/g, '').replace(/\u00A0/g, '');
  if (t.includes('.') && t.includes(',')) {
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    if (lastComma > lastDot) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      t = t.replace(/,/g, '');
    }
  } else if (t.includes(',')) {
    t = t.replace(',', '.');
  }
  const n = parseFloat(t.replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
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
        let d = ds ? parseAmt(row[ds]) : 0;
        let c = cs ? parseAmt(row[cs]) : 0;
        
        if (ds && isNaN(parseAmt(row[ds])) && row[ds]) logs.push({ line: index+2, type: 'amt', msg: `Montant débit invalide : "${row[ds]}"` });
        if (cs && isNaN(parseAmt(row[cs])) && row[cs]) logs.push({ line: index+2, type: 'amt', msg: `Montant crédit invalide : "${row[cs]}"` });

        // Gestion des montants négatifs dans les colonnes séparées
        if (d < 0) { c += Math.abs(d); d = 0; }
        if (c < 0) { d += Math.abs(c); c = 0; }
        
        out.Debit = d;
        out.Credit = c;
      } else if (fmt === 'B') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const ss = mapping.Sens !== '__ignore__' ? mapping.Sens : null;
        let amt = ms ? parseAmt(row[ms]) : 0;
        let sens = ss ? (row[ss] || '').trim().toUpperCase() : 'D';
        
        if (ms && isNaN(parseAmt(row[ms])) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });

        // Si le montant est négatif, on inverse le sens
        if (amt < 0) {
          amt = Math.abs(amt);
          sens = (['D', 'DEBIT', 'DÉBIT'].includes(sens)) ? 'C' : 'D';
        }
        
        out.Debit = ['D', 'DEBIT', 'DÉBIT'].includes(sens) ? amt : 0;
        out.Credit = ['C', 'CREDIT', 'CRÉDIT'].includes(sens) ? amt : 0;
      } else if (fmt === 'C_pos_debit') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const amt = ms ? parseAmt(row[ms]) : 0;
        if (ms && isNaN(parseAmt(row[ms])) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });
        out.Debit = Math.max(0, amt); out.Credit = Math.max(0, -amt);
      } else if (fmt === 'C_pos_credit') {
        const ms = mapping.Montant !== '__ignore__' ? mapping.Montant : null;
        const amt = ms ? parseAmt(row[ms]) : 0;
        if (ms && isNaN(parseAmt(row[ms])) && row[ms]) logs.push({ line: index+2, type: 'amt', msg: `Montant invalide : "${row[ms]}"` });
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
function validateAccounts(rows: any[]) {
  const accountMap = new Map<string, Map<string, { lib: string, lines: number[] }>>();
  const invalidAccountsMap = new Map<string, { reason: string, lines: number[] }>();
  
  rows.forEach(r => {
    const num = (r.CompteNum || '').trim();
    const lib = (r.CompteLib || '').trim();
    const lineNum = r._lineNum;

    if (num) {
      if (!/^[A-Z0-9]+$/i.test(num)) {
        if (!invalidAccountsMap.has(num)) invalidAccountsMap.set(num, { reason: 'Caractères invalides (non alphanumériques)', lines: [] });
        invalidAccountsMap.get(num)!.lines.push(lineNum);
      } else if (num.length < 3) {
        if (!invalidAccountsMap.has(num)) invalidAccountsMap.set(num, { reason: 'Numéro trop court (< 3 caractères)', lines: [] });
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
async function extractTextFromPDF(file: File, useOcr = false, onProgress?: (p: number) => void) {
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
    
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress((i / pdf.numPages) * 100);
      
      try {
        const page = await pdf.getPage(i);
        
        if (useOcr) {
          // Mode OCR : rendu de la page en image puis Tesseract
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error("Impossible d'initialiser le contexte canvas.");
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({ canvasContext: context, viewport }).promise;
          const { data: { text } } = await Tesseract.recognize(canvas, 'fra');
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
async function parseBalanceFile(file: File, useOcr = false, onProgress?: (p: number) => void) {
  if (file.size === 0) throw new Error("Le fichier de balance est vide et ne peut pas être traité. Veuillez vous assurer que le fichier contient des données avant de l'importer.");
  const ext = file.name.split('.').pop()?.toLowerCase();
  
  if (!['pdf', 'xls', 'xlsx', 'csv'].includes(ext || '')) {
    throw new Error(`Format de fichier non supporté pour la balance (.${ext}). Veuillez utiliser un fichier .pdf, .xls, .xlsx ou .csv.`);
  }

  const balSoldes: Record<string, { lib: string, solde: number }> = {};

  if (ext === 'pdf') {
    const text = await extractTextFromPDF(file, useOcr, onProgress);
    const lines = text.split('\n');
    lines.forEach(line => {
      // Expression régulière plus flexible pour capturer : [Compte] [Libellé] [Montants...]
      // On cherche un début de ligne qui ressemble à un compte comptable (3 à 15 caractères alphanumériques commençant par 1-9)
      const match = line.trim().match(/^([1-9][0-9a-zA-Z]{2,14})\s+(.*?)\s+([\d\s.,\-]+)$/);
      if (match) {
        const acc = match[1];
        const lib = match[2].trim();
        const numsStr = match[3].trim();
        
        // Extraction de tous les blocs numériques (montants débiteurs, créditeurs, soldes)
        const numMatches = numsStr.match(/(?:^|\s)-?[\d\s]+[.,]\d+|(?:\s|^)-?\d+/g);
        if (numMatches) {
          const nums = numMatches.map(v => parseAmt(v)).filter(n => !isNaN(n));
          if (nums.length > 0) {
            let solde = 0;
            if (nums.length >= 2) {
              solde = nums[0] - nums[1];
            } else if (nums.length === 1) {
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
        if (nums.length >= 2) {
          solde = nums[0] - nums[1];
        } else if (nums.length === 1) {
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
  // --- État d'authentification ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  
  // --- Thème ---
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // --- État du processus d'import/export ---
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1); // 1: Upload, 2: Mapping, 3: Preview, 4: Balance Check
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
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['JournalCode', 'EcritureDate', 'CompteNum', 'EcritureLib', 'Debit', 'Credit']);
  const [showColSelector, setShowColSelector] = useState(false);
  
  // --- Anomalies détectées ---
  const [accountAnomalies, setAccountAnomalies] = useState<{
    multipleLibs: { compte: string, variants: { lib: string, lines: number[] }[] }[],
    invalidAccounts: { compte: string, reason: string, lines: number[] }[]
  } | null>(null);

  // --- Presets de mapping ---
  const [presets, setPresets] = useState<{ name: string, mapping: Record<string, string>, amtFmt: string }[]>([]);
  const [newPresetName, setNewPresetName] = useState('');

  // --- Mode Batch ---
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<{ name: string, rows: number, debit: number, credit: number, error?: string, data?: any[] }[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);

  // --- Vérification de la balance ---
  const [balanceFile, setBalanceFile] = useState<File | null>(null);
  const [comparisonData, setComparisonData] = useState<any[]>([]);
  const [loadingBal, setLoadingBal] = useState(false);
  const [balProgress, setBalProgress] = useState(0);
  const [useOcr, setUseOcr] = useState(false);
  const [balanceTolerance, setBalanceTolerance] = useState(0.01);
  const [errBal, setErrBal] = useState('');

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
      if (f.size === 0) throw new Error("Le fichier FEC est vide (0 octet).");
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (!['txt', 'csv'].includes(ext || '')) {
        throw new Error(`Format de fichier non supporté pour le FEC (.${ext}). Veuillez utiliser un fichier .txt ou .csv.`);
      }

      const { text, encoding } = await detectAndDecode(f, eOpt === 'auto' ? '' : eOpt);
      const sep = detectSep(text, sOpt === 'auto' ? '' : sOpt);
      const { headers, rows } = parseCSV(text, sep);
      
      if (!headers.length || headers.every(h => !h)) {
        throw new Error("Impossible de détecter les colonnes. Vérifiez que le séparateur (" + sepLabel(sep) + ") est correct ou essayez un autre encodage.");
      }
      
      if (!rows.length) {
        throw new Error("Le fichier FEC ne contient aucune ligne de données après l'en-tête.");
      }

      // Vérification sommaire de la validité (au moins 5 colonnes attendues pour un FEC)
      if (headers.length < 5) {
        setWarns(prev => [...prev, `Attention : Seulement ${headers.length} colonnes détectées. Un fichier FEC standard en contient généralement au moins 15.`]);
      }
      
      setRawData({ headers, rows, encoding, separator: sep });
      setFile(f);
      setFileName(f.name);
      
      const defaultExportName = f.name.replace(/\.[^.]+$/, '') + '_pennylane';
      setExportFileName(defaultExportName);
      
      const initialMap = autoMap(headers);
      setMapping(initialMap);
      setAmtFmt(det(initialMap, signConv) || 'A');
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
    
    if (fileList.length === 1) {
      setBatchFiles([]);
      handleFile(fileList[0]);
    } else {
      setBatchFiles(fileList);
      // On utilise le premier fichier comme template pour le mapping
      handleFile(fileList[0]);
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
    setBatchResults([]);
    setBatchProgress(0);

    if (batchFiles.length > 1) {
      // MODE BATCH
      try {
        const results = [];
        for (let i = 0; i < batchFiles.length; i++) {
          const f = batchFiles[i];
          setBatchProgress(Math.round(((i) / batchFiles.length) * 100));
          try {
            const { text } = await detectAndDecode(f, encOpt === 'auto' ? '' : encOpt);
            const sep = detectSep(text, sepOpt === 'auto' ? '' : sepOpt);
            const { rows } = parseCSV(text, sep);
            const { data: trans } = transformRows(rows, mapping, amtFmt);
            
            results.push({
              name: f.name,
              rows: trans.length,
              debit: trans.reduce((s, r) => s + (r.Debit || 0), 0),
              credit: trans.reduce((s, r) => s + (r.Credit || 0), 0),
              data: trans
            });
          } catch (e: any) {
            results.push({ name: f.name, rows: 0, debit: 0, credit: 0, error: e.message });
          }
        }
        setBatchResults(results);
        setBatchProgress(100);
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
    
    // Apply column widths
    ws['!cols'] = [14, 22, 16, 14, 14, 30, 18, 14, 40, 16, 16].map(w => ({ wch: w }));
    
    // Apply number formatting to Debit (J) and Credit (K) columns
    // Apply date formatting to Date Écriture (D) and Date Pièce (H) columns
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:K1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const dateEcritureCell = ws[XLSX.utils.encode_cell({ r: R, c: 3 })]; // D
      const datePieceCell = ws[XLSX.utils.encode_cell({ r: R, c: 7 })]; // H
      const debitCell = ws[XLSX.utils.encode_cell({ r: R, c: 9 })]; // J
      const creditCell = ws[XLSX.utils.encode_cell({ r: R, c: 10 })]; // K
      
      if (dateEcritureCell && (dateEcritureCell.t === 'd' || dateEcritureCell.t === 'n')) dateEcritureCell.z = dateFormat;
      if (datePieceCell && (datePieceCell.t === 'd' || datePieceCell.t === 'n')) datePieceCell.z = dateFormat;
      if (debitCell && debitCell.t === 'n') debitCell.z = numberFormat;
      if (creditCell && creditCell.t === 'n') creditCell.z = numberFormat;
    }

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
   * Exporte un fichier ZIP contenant tous les fichiers Excel du batch.
   */
  const downloadBatchZIP = async () => {
    if (batchResults.length === 0) return;
    setLoading(true);
    const zip = new JSZip();
    
    for (const res of batchResults) {
      if (res.error || !res.data) continue;
      
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
      ws['!cols'] = [14, 22, 16, 14, 14, 30, 18, 14, 40, 16, 16].map(w => ({ wch: w }));
      
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:K1');
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        if (ws[XLSX.utils.encode_cell({r:R, c:3})]) ws[XLSX.utils.encode_cell({r:R, c:3})].z = dateFormat;
        if (ws[XLSX.utils.encode_cell({r:R, c:7})]) ws[XLSX.utils.encode_cell({r:R, c:7})].z = dateFormat;
        if (ws[XLSX.utils.encode_cell({r:R, c:9})]) ws[XLSX.utils.encode_cell({r:R, c:9})].z = numberFormat;
        if (ws[XLSX.utils.encode_cell({r:R, c:10})]) ws[XLSX.utils.encode_cell({r:R, c:10})].z = numberFormat;
      }
      
      XLSX.utils.book_append_sheet(wb, ws, 'Écritures');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${res.name.replace(/\.[^.]+$/, '')}_pennylane.xlsx`, excelBuffer);
    }
    
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fec_batch_export_${new Date().toISOString().slice(0,10)}.zip`;
    link.click();
    setLoading(false);
  };

  /**
   * Exporte la liste des anomalies (comptes invalides et libellés multiples)
   * dans un fichier CSV pour faciliter les corrections.
   */
  const exportAnomaliesCSV = () => {
    if (!accountAnomalies) return;
    
    // En-tête du fichier CSV (BOM pour Excel UTF-8)
    let csvContent = "\uFEFFType;Compte;Raison / Libellés;Lignes Source\n";
    
    // Ajout des comptes invalides
    accountAnomalies.invalidAccounts.forEach(a => {
      const lineRefs = a.lines.join(', ');
      csvContent += `Compte Invalide;${a.compte || ''};"${a.reason.replace(/"/g, '""')}";"${lineRefs}"\n`;
    });
    
    // Ajout des libellés multiples
    accountAnomalies.multipleLibs.forEach(a => {
      const libs = a.variants.map(v => v.lib).join(' | ');
      const lineRefs = a.variants.map(v => v.lines.join(' ')).join(' | ');
      csvContent += `Libellés Multiples;${a.compte};"${libs.replace(/"/g, '""')}";"${lineRefs}"\n`;
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
   * Réinitialise complètement l'application pour traiter un nouveau fichier.
   */
  const reset = () => {
    setStep(1); setFile(null); setFileName(''); setRawData(null);
    setMapping({}); setTransformed([]); setErr(''); setExportFileName('');
    setBalanceFile(null); setComparisonData([]); setErrBal('');
    setAccountAnomalies(null);
  };

  /**
   * Gère le téléchargement et l'analyse du fichier de balance (PDF/Excel/CSV).
   * Compare ensuite les soldes extraits avec ceux calculés à partir du FEC.
   */
  const handleBalanceCheck = async (f: File) => {
    setLoadingBal(true);
    setBalProgress(0);
    setErrBal('');
    try {
      const balSoldes = await parseBalanceFile(f, useOcr, (p) => setBalProgress(Math.round(p)));
      
      const normalizeAccount = (acc: string) => {
        let normalized = acc.replace(/0+$/, '');
        if (normalized.length < 3 && acc.length >= 3) {
          normalized = acc.substring(0, 3);
        }
        return normalized;
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
        if (data.lib) grouped[norm].libs.add(data.lib);
        grouped[norm].soldeBal += data.solde;
      });

      const compData = Object.keys(grouped).sort().map(norm => {
        const g = grouped[norm];
        const allComptes = Array.from(new Set([...g.comptesFec, ...g.comptesBal])).sort();
        const diff = g.soldeFec - g.soldeBal;
        return {
          compte: allComptes.join(' / '),
          lib: Array.from(g.libs).join(' / '),
          soldeFec: g.soldeFec,
          soldeBal: g.soldeBal,
          ecart: diff
        };
      });

      setComparisonData(compData);
      setBalanceFile(f);
    } catch (e: any) {
      setErrBal(e.message || 'Erreur inconnue lors de la lecture de la balance.');
    } finally {
      setLoadingBal(false);
    }
  };

  /**
   * Gère la soumission du formulaire de connexion.
   */
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginUser === 'bdoSupport' && loginPass === 'AdminBdoSoftware') {
      setIsAuthenticated(true);
      setLoginErr('');
    } else {
      setLoginErr('Identifiant ou mot de passe incorrect.');
    }
  };

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

  /**
   * Mémorise et applique le tri et la recherche sur les données transformées
   * pour l'affichage de l'aperçu.
   */
  const sortedTransformed = React.useMemo(() => {
    let sortableItems = [...transformed];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      sortableItems = sortableItems.filter(r => 
        (r.EcritureLib || '').toString().toLowerCase().includes(q)
      );
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

  // --- Gestion des Presets de Mapping ---
  useEffect(() => {
    const saved = localStorage.getItem('fec_mapping_presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {
        console.error("Erreur lors du chargement des presets", e);
      }
    }
  }, []);

  const savePreset = () => {
    if (!newPresetName.trim()) return;
    const newPresets = [...presets, { name: newPresetName.trim(), mapping, amtFmt }];
    setPresets(newPresets);
    localStorage.setItem('fec_mapping_presets', JSON.stringify(newPresets));
    setNewPresetName('');
  };

  const deletePreset = (index: number) => {
    const newPresets = presets.filter((_, i) => i !== index);
    setPresets(newPresets);
    localStorage.setItem('fec_mapping_presets', JSON.stringify(newPresets));
  };

  const applyPreset = (p: { mapping: Record<string, string>, amtFmt: string }) => {
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

  // ============================================================================
  // RENDU DU COMPOSANT
  // ============================================================================

  // --- Écran de connexion ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans relative">
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="absolute top-4 right-4 p-2 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shadow-sm"
        >
          {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md border border-slate-100">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-100 p-4 rounded-2xl">
              <Lock className="w-8 h-8 text-indigo-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">Connexion</h1>
          <p className="text-center text-slate-500 mb-8">Accès réservé au support BDO</p>
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Identifiant</label>
              <input 
                type="text" 
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                value={loginUser}
                onChange={e => setLoginUser(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
              <input 
                type="password" 
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                required
              />
            </div>
            
            {loginErr && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2 border border-red-100">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {loginErr}
              </div>
            )}
            
            <button 
              type="submit" 
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors mt-2 shadow-sm"
            >
              Se connecter
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Application principale ---
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 font-sans text-slate-800">
      <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl mb-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">FEC → Pennylane Converter</h1>
            <p className="text-sm text-slate-500">Convertisseur de fichier FEC vers Excel Pennylane</p>
          </div>
        </div>
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="p-2 rounded-full bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
          title="Basculer le thème"
        >
          {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {/* ============================================================================ */}
      {/* INDICATEUR D'ÉTAPE (Stepper) */}
      {/* ============================================================================ */}
      <div className="flex items-center mb-8 px-2">
        {[ { n: 1, label: 'Fichier' }, { n: 2, label: 'Mapping' }, { n: 3, label: 'Export' }, { n: 4, label: 'Contrôle' } ].map((s, i) => (
          <div key={s.n} className="flex items-center flex-1 last:flex-none">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
              ${step > s.n ? 'bg-amber-600 text-white' : step === s.n ? 'bg-amber-100 text-amber-700 border-2 border-amber-600' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}>
              {step > s.n ? <CheckCircle2 className="w-5 h-5" /> : s.n}
            </div>
            <span className={`text-sm ml-3 mr-4 whitespace-nowrap ${step === s.n ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>
              {s.label}
            </span>
            {i < 3 && <div className="flex-1 h-px bg-slate-200 mr-4"></div>}
          </div>
        ))}
      </div>

      {/* ============================================================================ */}
      {/* ÉTAPE 1 : IMPORT DU FICHIER FEC */}
      {/* ============================================================================ */}
      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              ① Chargement du fichier FEC
            </h2>
            
            <div 
              className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-amber-500 hover:bg-amber-50 transition-colors bg-slate-50"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-amber-500', 'bg-amber-50'); }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('border-amber-500', 'bg-amber-50'); }}
              onDrop={handleDrop}
            >
              <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.csv" multiple onChange={(e) => e.target.files && handleBatchFiles(e.target.files)} />
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <p className="text-slate-700 font-medium">
                {batchFiles.length > 1 ? (
                  <span className="flex items-center justify-center gap-2">
                    <Files className="w-5 h-5 text-amber-600" /> 
                    <strong>{batchFiles.length} fichiers FEC sélectionnés</strong>
                  </span>
                ) : fileName ? (
                  <span>Fichier sélectionné : <strong className="text-amber-600">{fileName}</strong></span>
                ) : (
                  <span><strong>Déposez vos fichiers FEC</strong> ou cliquez pour parcourir</span>
                )}
              </p>
              <p className="text-sm text-slate-500 mt-1">Formats acceptés : .txt · .csv (Multisélection possible)</p>
              
              {rawData && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">✓ {rawData.rows.length} lignes (premier fichier)</span>
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">Encodage : {rawData.encoding}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Encodage</label>
                <select className="p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none" value={encOpt} onChange={(e) => { setEncOpt(e.target.value); if (file) handleFile(file, e.target.value, sepOpt); }}>
                  <option value="auto">Détection automatique</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="iso-8859-1">Latin-1 (ANSI)</option>
                  <option value="utf-8-sig">UTF-8 BOM</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Séparateur</label>
                <select className="p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none" value={sepOpt} onChange={(e) => { setSepOpt(e.target.value); if (file) handleFile(file, encOpt, e.target.value); }}>
                  <option value="auto">Détection automatique</option>
                  <option value="\t">Tabulation</option>
                  <option value=";">Point-virgule</option>
                  <option value=",">Virgule</option>
                  <option value="|">Pipe</option>
                </select>
              </div>
            </div>
            
            {err && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md flex items-center gap-2"><AlertCircle className="w-5 h-5 shrink-0" /> {err}</div>}
            {warns.length > 0 && (
              <div className="mt-4 space-y-2">
                {warns.map((w, idx) => (
                  <div key={idx} className="p-3 bg-amber-50 text-amber-700 border-l-4 border-amber-500 rounded-r-md flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> 
                    <span className="text-sm whitespace-pre-wrap">{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex justify-end">
            <button 
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!rawData || loading}
              onClick={() => setStep(2)}
            >
              Suivant — Mapper les colonnes <ArrowRight className="w-4 h-4" />
            </button>
          </div>
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
                {batchFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-white border border-indigo-200 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-800 shadow-sm">
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    {f.name}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-indigo-500 mt-2 italic">Le mapping sera appliqué uniformément à tous les fichiers.</p>
            </div>
          )}

          {/* --- Presets de mapping --- */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-amber-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Presets de mapping
            </h2>
            
            {presets.length > 0 && (
              <div className="mb-6">
                <label className="block text-xs font-semibold text-amber-700 mb-2">Charger un preset existant :</label>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p, idx) => (
                    <div key={idx} className="flex items-center bg-white border border-amber-300 rounded-lg overflow-hidden shadow-sm">
                      <button 
                        onClick={() => applyPreset(p)}
                        className="px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors"
                      >
                        {p.name}
                      </button>
                      <button 
                        onClick={() => deletePreset(idx)}
                        className="px-2 py-1.5 bg-amber-50 text-amber-500 hover:text-red-500 transition-colors border-l border-amber-200"
                        title="Supprimer ce preset"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-end gap-3">
              <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-amber-700 mb-1.5 text-left">Sauvegarder le mapping actuel :</label>
                <input 
                  type="text" 
                  placeholder="Nom du preset (ex: Sage 1000, Quadratus...)"
                  className="w-full px-4 py-2 bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                />
              </div>
              <button 
                onClick={savePreset}
                disabled={!newPresetName.trim()}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Save className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">② Mapping des colonnes</h2>
            <div className="p-3 bg-blue-50 text-blue-700 border-l-4 border-blue-500 rounded-r-md mb-6 text-sm">
              Les colonnes ont été pré-remplies automatiquement. Corrigez si nécessaire. <strong className="text-amber-600">★ = champ obligatoire</strong>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {FIELDS.map(f => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label className={`text-xs font-semibold ${f.req ? 'text-amber-600' : 'text-slate-500'}`}>{f.label}</label>
                  <select 
                    className="p-2 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 outline-none text-sm"
                    value={mapping[f.key] || '__ignore__'}
                    onChange={(e) => {
                      const newMap = { ...mapping, [f.key]: e.target.value };
                      setMapping(newMap);
                      const autoFmt = det(newMap, signConv);
                      if (autoFmt && autoFmt !== signConv) setAmtFmt(autoFmt);
                    }}
                  >
                    <option value="__ignore__">(ignorer)</option>
                    {rawData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4 shadow-sm">
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
                  <div key={idx} className="p-3 bg-amber-50 text-amber-700 border-l-4 border-amber-500 rounded-r-md flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> 
                    <span className="text-sm whitespace-pre-wrap">{w}</span>
                  </div>
                ))}
              </div>
            )}
            {!det(mapping, signConv) && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md text-sm">Mappez au moins Débit+Crédit ou Montant.</div>}
            {err && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md text-sm flex items-center gap-2"><AlertCircle className="w-5 h-5 shrink-0" /> {err}</div>}
          </div>

          <div className="flex justify-between">
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
            <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 mb-6 flex items-center justify-between">
                Résumé du traitement Batch
                <span className="text-xs font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                  {batchResults.filter(r => !r.error).length} succès / {batchResults.length} fichiers
                </span>
              </h2>
              
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
                    {batchResults.map((res, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 text-sm font-medium text-slate-700">{res.name}</td>
                        <td className="p-4 text-sm font-mono text-slate-600">{res.rows.toLocaleString()}</td>
                        <td className="p-4 text-sm font-mono text-slate-600">{fmt2(res.debit)} €</td>
                        <td className="p-4 text-sm font-mono text-slate-600">{fmt2(res.credit)} €</td>
                        <td className="p-4 text-sm">
                          {res.error ? (
                            <span className="flex items-center gap-1.5 text-red-600 font-semibold text-xs">
                              <AlertCircle className="w-3.5 h-3.5" /> Erreur
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-emerald-600 font-semibold text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
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
                    <p className="text-xs text-indigo-700 mt-1">Générez une archive ZIP contenant tous les fichiers convertis.</p>
                  </div>
                </div>
                <button 
                  onClick={downloadBatchZIP}
                  disabled={loading}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95 disabled:bg-indigo-300"
                >
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Files className="w-5 h-5" />}
                  Télécharger le ZIP (.zip)
                </button>
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
              {/* --- Indicateurs clés (Metrics) --- */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">Lignes converties</div>
                  <div className="text-xl font-semibold font-mono text-slate-800">{transformed.length.toLocaleString('fr-FR')}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">Total Débit</div>
                  <div className="text-xl font-semibold font-mono text-slate-800">{fmt2(transformed.reduce((s, r) => s + r.Debit, 0))} €</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">Total Crédit</div>
                  <div className="text-xl font-semibold font-mono text-slate-800">{fmt2(transformed.reduce((s, r) => s + r.Credit, 0))} €</div>
                </div>
                <div className={`border rounded-xl p-4 shadow-sm ${Math.abs(transformed.reduce((s, r) => s + r.Debit, 0) - transformed.reduce((s, r) => s + r.Credit, 0)) < 0.01 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <div className={`text-xs mb-1 ${Math.abs(transformed.reduce((s, r) => s + r.Debit, 0) - transformed.reduce((s, r) => s + r.Credit, 0)) < 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {Math.abs(transformed.reduce((s, r) => s + r.Debit, 0) - transformed.reduce((s, r) => s + r.Credit, 0)) < 0.01 ? 'Fichier équilibré' : 'Déséquilibre détecté'}
                  </div>
                  <div className={`text-xl font-semibold font-mono ${Math.abs(transformed.reduce((s, r) => s + r.Debit, 0) - transformed.reduce((s, r) => s + r.Credit, 0)) < 0.01 ? 'text-emerald-800' : 'text-red-800'}`}>
                    {fmt2(Math.abs(transformed.reduce((s, r) => s + r.Debit, 0) - transformed.reduce((s, r) => s + r.Credit, 0)))} €
                  </div>
                </div>
              </div>
            </>
          )}

          {/* --- Options d'export Excel --- */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Options d'export Excel
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">Nom du fichier de sortie</label>
                <div className="relative">
                  <input 
                    type="text" 
                    className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none pr-12"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="export_pennylane"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">.xlsx</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">Format des nombres</label>
                <select 
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                  value={numberFormat}
                  onChange={(e) => setNumberFormat(e.target.value)}
                >
                  {NUMBER_FORMATS.map(fmt => (
                    <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">Format des dates</label>
                <select 
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
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
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-red-800 mb-0.5">
                        Anomalies détectées dans les comptes
                      </h3>
                      <p className="text-sm text-red-700">
                        Des problèmes ont été détectés dans les numéros ou libellés de compte. 
                      </p>
                    </div>
                    <button 
                      onClick={exportAnomaliesCSV}
                      className="flex items-center gap-2 bg-white text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm font-bold border border-red-200 transition-colors shadow-sm shrink-0"
                    >
                      <Download className="w-4 h-4" /> Exporter la liste (.csv)
                    </button>
                  </div>
                  
                  <div className="max-h-80 overflow-y-auto bg-white rounded-lg border border-red-100 p-4 space-y-6">
                    
                    {accountAnomalies.invalidAccounts.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          Numéros de compte invalides ({accountAnomalies.invalidAccounts.length})
                        </h4>
                        <ul className="space-y-3">
                          {accountAnomalies.invalidAccounts.map((anomaly, idx) => (
                            <li key={idx} className="text-sm border-l-2 border-red-200 pl-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                                  {anomaly.compte || '(vide)'}
                                </span>
                                <span className="text-red-600 font-medium">{anomaly.reason}</span>
                              </div>
                              <div className="text-slate-500 text-xs">
                                Lignes source : {anomaly.lines.slice(0, 10).join(', ')}
                                {anomaly.lines.length > 10 && ` et ${anomaly.lines.length - 10} autres`}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {accountAnomalies.multipleLibs.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          Libellés multiples pour un même compte ({accountAnomalies.multipleLibs.length})
                        </h4>
                        <ul className="space-y-4">
                          {accountAnomalies.multipleLibs.map((anomaly, idx) => (
                            <li key={idx} className="text-sm border-l-2 border-amber-200 pl-3">
                              <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded mb-2 inline-block">
                                {anomaly.compte}
                              </span>
                              <div className="space-y-2 mt-1">
                                {anomaly.variants.map((variant, i) => (
                                  <div key={i} className="text-slate-600 bg-slate-50 p-2 rounded">
                                    <div className="font-medium text-slate-700 mb-1">{variant.lib}</div>
                                    <div className="text-slate-400 text-xs">
                                      Lignes source : {variant.lines.slice(0, 5).join(', ')}
                                      {variant.lines.length > 5 && ` et ${variant.lines.length - 5} autres`}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
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
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm overflow-hidden">
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
                      <div className="fixed inset-0 z-20" onClick={() => setShowColSelector(false)}></div>
                      <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-30 p-2 animate-in fade-in zoom-in-95 duration-100">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 mb-1">Afficher / Masquer</div>
                        <div className="max-h-64 overflow-y-auto">
                          {Object.keys(PREVIEW_LABELS).map(col => (
                            <button
                              key={col}
                              onClick={() => {
                                if (visibleColumns.includes(col)) {
                                  if (visibleColumns.length > 1) {
                                    setVisibleColumns(visibleColumns.filter(c => c !== col));
                                  }
                                } else {
                                  setVisibleColumns([...visibleColumns, col]);
                                }
                              }}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-slate-50 transition-colors group"
                            >
                              <span className={visibleColumns.includes(col) ? 'text-slate-900 font-medium' : 'text-slate-400'}>
                                {PREVIEW_LABELS[col]}
                              </span>
                              {visibleColumns.includes(col) && <Check className="w-4 h-4 text-emerald-500" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Filtrer par libellé..." 
                    className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse min-w-[800px] preview-table">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 preview-header-row">
                    {visibleColumns.map(c => (
                      <th 
                        key={c} 
                        className="p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors select-none preview-header-cell"
                        onClick={() => handleSort(c)}
                      >
                        <div className="flex items-center gap-1">
                          {PREVIEW_LABELS[c] || c}
                          {sortConfig?.key === c ? (
                            sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedTransformed.length === 0 ? (
                    <tr>
                      <td colSpan={visibleColumns.length} className="p-12 text-center text-slate-400 italic">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="w-8 h-8 opacity-20" />
                          <p>Aucune écriture ne correspond à votre recherche "{searchQuery}"</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedTransformed
                      .slice(0, 50)
                      .map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 preview-body-row">
                        {visibleColumns.map(c => (
                          <td key={c} className={`p-3 text-sm text-slate-700 truncate max-w-[200px] ${['Debit', 'Credit'].includes(c) ? 'font-mono text-right' : ''} preview-body-cell`}>
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
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              ④ Contrôle de Balance
            </h2>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <p className="text-sm text-slate-600">
                Importez la balance de l'ancien logiciel (XLS, CSV, PDF) pour vérifier que les soldes correspondent aux écritures FEC générées.
              </p>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
                  <label htmlFor="tolerance-input" className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Tolérance (€)</label>
                  <input 
                    type="number" 
                    id="tolerance-input"
                    step="0.01"
                    min="0"
                    className="w-16 bg-transparent border-none p-0 text-sm font-mono focus:ring-0 text-slate-700"
                    value={balanceTolerance}
                    onChange={(e) => setBalanceTolerance(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="flex items-center gap-3 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">
                  <input 
                    type="checkbox" 
                    id="ocr-toggle" 
                    className="w-4 h-4 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500"
                    checked={useOcr}
                    onChange={(e) => setUseOcr(e.target.checked)}
                  />
                  <label htmlFor="ocr-toggle" className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5 cursor-pointer select-none">
                    <ScanText className="w-3.5 h-3.5" /> Activer l'OCR (pour scans)
                  </label>
                </div>
              </div>
            </div>
            
            {/* --- Zone de dépôt du fichier de balance --- */}
            {!balanceFile ? (
              <div 
                className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-colors bg-slate-50 relative overflow-hidden"
                onClick={() => balInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleBalDrop}
              >
                <input type="file" ref={balInputRef} className="hidden" accept=".xls,.xlsx,.csv,.pdf" onChange={(e) => e.target.files?.[0] && handleBalanceCheck(e.target.files[0])} />
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-700 font-medium">
                  <strong>Déposez votre fichier de Balance</strong> ou cliquez pour parcourir
                </p>
                <p className="text-sm text-slate-500 mt-1">Formats acceptés : .xls · .xlsx · .csv · .pdf</p>
                {loadingBal && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
                    <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                    <div className="text-indigo-700 font-semibold mb-2">Analyse {useOcr ? 'OCR' : ''} en cours...</div>
                    <div className="w-full max-w-xs bg-indigo-100 rounded-full h-2 mb-1">
                      <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${balProgress}%` }}></div>
                    </div>
                    <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">{balProgress}%</div>
                  </div>
                )}
                {errBal && <div className="mt-4 p-3 bg-red-50 text-red-700 border-l-4 border-red-500 rounded-r-md flex items-center gap-2"><AlertCircle className="w-5 h-5" /> {errBal}</div>}
              </div>
            ) : (
              <div>
                {/* --- Résultats de la comparaison --- */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-800">Résultats de la comparaison</h3>
                  <button onClick={() => setBalanceFile(null)} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">Changer de fichier</button>
                </div>

                {/* --- Message global (succès ou erreur) --- */}
                {comparisonData.some(r => Math.abs(r.ecart) > balanceTolerance) ? (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-6 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-red-800">Des écarts ont été détectés</h4>
                      <p className="text-sm text-red-700 mt-1">L'écart absolu total est de {fmt2(comparisonData.reduce((sum, row) => sum + Math.abs(row.ecart), 0))} €. Vérifiez les comptes en rouge ci-dessous (Tolérance: {balanceTolerance} €).</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-6 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-emerald-800">Balance parfaitement équilibrée</h4>
                      <p className="text-sm text-emerald-700 mt-1">Tous les soldes du FEC correspondent à la balance importée (Tolérance: {balanceTolerance} €).</p>
                    </div>
                  </div>
                )}

                {/* --- Tableau détaillé des écarts --- */}
                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px] overflow-y-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="sticky top-0 bg-slate-50 shadow-sm z-10">
                      <tr className="border-b border-slate-200">
                        <th className="p-3 text-xs font-semibold text-slate-500 uppercase">Compte</th>
                        <th className="p-3 text-xs font-semibold text-slate-500 uppercase">Libellé</th>
                        <th className="p-3 text-xs font-semibold text-slate-500 uppercase text-right">Solde FEC</th>
                        <th className="p-3 text-xs font-semibold text-slate-500 uppercase text-right">Solde Balance</th>
                        <th className="p-3 text-xs font-semibold text-slate-500 uppercase text-right">Écart</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comparisonData.filter(r => Math.abs(r.soldeFec) > balanceTolerance || Math.abs(r.soldeBal) > balanceTolerance).map((r, i) => {
                        const isErr = Math.abs(r.ecart) > balanceTolerance;
                        return (
                          <tr key={i} className={`hover:bg-slate-50 ${isErr ? 'bg-red-50/50' : ''}`}>
                            <td className="p-3 text-sm font-mono text-slate-700">{r.compte}</td>
                            <td className="p-3 text-sm text-slate-700 truncate max-w-[200px]">{r.lib}</td>
                            <td className="p-3 text-sm font-mono text-right text-slate-700">{fmt2(r.soldeFec)}</td>
                            <td className="p-3 text-sm font-mono text-right text-slate-700">{fmt2(r.soldeBal)}</td>
                            <td className={`p-3 text-sm font-mono text-right font-medium ${isErr ? 'text-red-600' : 'text-emerald-600'}`}>
                              {fmt2(r.ecart)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* --- Actions de l'étape 4 --- */}
          <div className="flex justify-between items-center">
            <button className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-4 py-2 font-medium" onClick={() => setStep(3)}>
              <ArrowLeft className="w-4 h-4" /> Retour à l'export
            </button>
            {balanceFile && (
              <button 
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-sm transition-colors"
                onClick={exportBalanceXLSX}
              >
                <Download className="w-5 h-5" /> Télécharger Excel (.xlsx)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
