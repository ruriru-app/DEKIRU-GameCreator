function requiredError(row, column) {
  return {
    sourceRow: row.sourceRow,
    code: 'required',
    field: column.key,
    message: `${row.sourceRow}行目の「${column.label}」を入力してください。`,
  };
}

export function validateRows(rows, schema) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ sourceRow: null, code: 'empty', field: null, message: '問題を1問以上入力してください。' }];
  }

  const errors = [];
  for (const row of rows) {
    for (const column of schema) {
      if (column.required && String(row[column.key] ?? '').trim() === '') {
        errors.push(requiredError(row, column));
      }
    }
  }
  return errors;
}

export function parseTabularRows(text, schema) {
  const rows = [];
  const errors = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const sourceRow = index + 1;
    const cells = line.split('\t').map((cell) => cell.trim());

    if (cells.length !== schema.length) {
      errors.push({
        sourceRow,
        code: 'column-count',
        field: undefined,
        message: `${sourceRow}行目は${schema.length}列で入力してください（現在${cells.length}列）。`,
      });
    }

    if (cells.length > schema.length) return;
    while (cells.length < schema.length) cells.push('');

    const row = { sourceRow };
    schema.forEach((column, cellIndex) => {
      row[column.key] = cells[cellIndex];
    });
    rows.push(row);
  });

  errors.push(...validateRows(rows, schema));
  errors.sort((left, right) => {
    const rowDifference = (left.sourceRow ?? Number.MAX_SAFE_INTEGER) - (right.sourceRow ?? Number.MAX_SAFE_INTEGER);
    if (rowDifference !== 0) return rowDifference;
    return left.code === 'column-count' ? -1 : right.code === 'column-count' ? 1 : 0;
  });
  return { rows, errors };
}
