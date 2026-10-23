// Utilidades CSV propias (sin dependencias): parser RFC 4180 y escape para exportación.

export const detectDelimiter = (text: string): ',' | ';' => {
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') break;
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
};

// Devuelve las filas (sin filas totalmente vacías). Lanza Error si hay comillas sin cerrar.
export const parseCsv = (input: string): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let wasQuoted = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === '' )) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '' && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (inQuotes) throw new Error('El archivo tiene comillas sin cerrar.');
  if (cell !== '' || row.length > 0 || wasQuoted) endRow();
  return rows;
};

// Evita la inyección de fórmulas al abrir el CSV en una hoja de cálculo.
export const escapeFormula = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

// Inversa de escapeFormula, para que exportar e importar no cambie los datos.
export const unescapeFormula = (value: string): string =>
  /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;

export const csvCell = (value: unknown): string => {
  const s = escapeFormula(value === null || value === undefined ? '' : String(value));
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
