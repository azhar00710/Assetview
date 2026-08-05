/**
 * fileParser.js — Universal CSV + Excel (.xls/.xlsx) file parser.
 *
 * Parses uploaded files client-side and returns a unified structure
 * with all sheets, all columns, headers, and sample rows.
 *
 * Uses SheetJS (xlsx) for Excel parsing.
 */
import { read, utils } from 'xlsx';

/**
 * Parse a File object (CSV, XLS, or XLSX) into a unified structure.
 *
 * @param {File} file - The uploaded file
 * @returns {Promise<ParsedFile>}
 *
 * @typedef {Object} ParsedFile
 * @property {string} fileName - Original filename
 * @property {string} fileType - 'csv' | 'excel'
 * @property {number} fileSize - Bytes
 * @property {ParsedSheet[]} sheets - All sheets (CSV = 1 sheet)
 *
 * @typedef {Object} ParsedSheet
 * @property {string} name - Sheet name (CSV uses filename)
 * @property {string[]} headers - Column headers (first row)
 * @property {number} rowCount - Data rows (excluding header)
 * @property {string[][]} sampleRows - First 5 data rows for preview
 * @property {string} csvText - Full sheet as CSV text (for backend)
 */
export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const isExcel = ['xls', 'xlsx', 'xlsm', 'xlsb'].includes(ext);

  if (isExcel) {
    return parseExcel(file);
  }
  return parseCsv(file);
}

/**
 * Parse a CSV file.
 */
async function parseCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = lines.length > 0 ? parseCsvLine(lines[0]) : [];
  const dataLines = lines.slice(1);

  const sampleRows = dataLines.slice(0, 5).map(l => parseCsvLine(l));

  return {
    fileName: file.name,
    fileType: 'csv',
    fileSize: file.size,
    sheets: [{
      name: file.name.replace(/\.[^.]+$/, ''),
      headers,
      rowCount: dataLines.length,
      sampleRows,
      csvText: text,
    }],
  };
}

/**
 * Parse an Excel file — processes ALL sheets.
 */
async function parseExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array' });

  const sheets = workbook.SheetNames.map(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    // Convert to array of arrays
    const aoa = utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (aoa.length === 0) {
      return { name: sheetName, headers: [], rowCount: 0, sampleRows: [], csvText: '' };
    }

    // First non-empty row is headers
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      const row = aoa[i];
      const nonEmpty = row.filter(c => String(c).trim()).length;
      if (nonEmpty >= 2) {
        headerRowIdx = i;
        break;
      }
    }

    const headers = aoa[headerRowIdx].map(c => String(c).trim());
    const dataRows = aoa.slice(headerRowIdx + 1).filter(row =>
      row.some(c => String(c).trim())
    );

    const sampleRows = dataRows.slice(0, 5).map(row =>
      row.map(c => String(c).trim())
    );

    // Convert to CSV text for backend transmission
    const csvText = utils.sheet_to_csv(sheet);

    return {
      name: sheetName,
      headers,
      rowCount: dataRows.length,
      sampleRows,
      csvText,
    };
  }).filter(s => s.rowCount > 0); // Skip empty sheets

  return {
    fileName: file.name,
    fileType: 'excel',
    fileSize: file.size,
    sheets,
  };
}

/**
 * Parse multiple files in parallel.
 * @param {File[]} files
 * @returns {Promise<ParsedFile[]>}
 */
export async function parseFiles(files) {
  return Promise.all(Array.from(files).map(parseFile));
}

/**
 * Simple CSV line parser handling quoted fields.
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
