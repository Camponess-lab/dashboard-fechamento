const APP_NAME = 'Sistema de Fechamento Gerencial';
const SPREADSHEET_NAME = 'Base - Sistema Fechamento Gerencial Completo';
const SHEET_NAME = 'FECHAMENTOS';
const PROP_SPREADSHEET_ID = 'FECHAMENTO_SPREADSHEET_ID';

// ATENÇÃO: Em produção, mova as senhas para PropertiesService.
// Execute uma vez no editor: PropertiesService.getScriptProperties().setProperties({ LOGIN_PASS_admin: 'suasenha', ... })
// e substitua LOGIN_USERS[user] por props.getProperty('LOGIN_PASS_' + user).
const LOGIN_USERS = {
  essantana: '1234',
  estevao: '1234',
  admin: '1234',
  brranda: '2469'
};

const USER_DISPLAY_NAMES = {
  essantana: 'Estevão Santana',
  estevao: 'Estevão',
  admin: 'Administrador',
  brranda: 'Bruno Randa'
};

function checkLogin(usuario, senha) {
  const user = String(usuario || '').trim().toLowerCase();
  const pass = String(senha || '').trim();
  if (!user || !pass) {
    return { ok: false, message: 'Informe usuário e senha.' };
  }
  if (LOGIN_USERS[user] && LOGIN_USERS[user] === pass) {
    return {
      ok: true,
      usuario: user,
      nome: USER_DISPLAY_NAMES[user] || user,
      message: 'Login realizado com sucesso.'
    };
  }
  return { ok: false, message: 'Usuário ou senha inválidos.' };
}


function doGet(e) {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle(APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupManual() {
  const ss = getOrCreateSpreadsheet_();
  ensureSheetHeaders_(ss);
  return {
    ok: true,
    name: ss.getName(),
    id: ss.getId(),
    url: ss.getUrl(),
    message: 'Base criada/configurada com sucesso.'
  };
}

function getAppInfo() {
  const ss = getOrCreateSpreadsheet_();
  return {
    appName: APP_NAME,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    user: getActiveEmail_(),
    timezone: Session.getScriptTimeZone()
  };
}

function saveFechamento(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido.');
  }

  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const now = new Date();
  const id = payload.id || Utilities.getUuid();
  payload.id = id;
  payload.updatedAt = now.toISOString();
  if (!payload.createdAt) payload.createdAt = now.toISOString();

  const existingRow = findRowById_(sh, id);
  let createdAt = now;
  if (existingRow > 1) {
    const oldCreated = sh.getRange(existingRow, 2).getValue();
    if (oldCreated) createdAt = oldCreated;
  }

  const k = payload.kpis || {};
  const m = payload.metrics || {};
  const row = [
    id,
    createdAt,
    now,
    getActiveEmail_(),
    payload.date || '',
    payload.shift || '',
    payload.title || '',
    safeCell_(k.absT1),
    safeCell_(k.dotT1),
    safeCell_(k.ootT1),
    safeCell_(k.dotDia),
    safeCell_(k.ootDia),
    safeCell_(k.dotSemana),
    safeCell_(m.avgDot),
    safeCell_(m.totalPcts),
    safeCell_(m.totalParsedLoss),
    safeCell_(m.worstHour),
    safeCell_(payload.statusResumo),
    JSON.stringify(payload)
  ];

  if (existingRow > 1) {
    sh.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }

  formatSheet_(sh);
  return {
    ok: true,
    id: id,
    savedAt: Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    sheetUrl: ss.getUrl(),
    message: 'Fechamento salvo com sucesso.'
  };
}

function listFechamentos(limit) {
  limit = Number(limit || 20);
  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];

  const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  return values
    .filter(row => row[0])
    .slice(-limit)
    .reverse()
    .map(row => ({
      id: row[0],
      createdAt: formatMaybeDate_(row[1]),
      updatedAt: formatMaybeDate_(row[2]),
      user: row[3] || '',
      date: formatDateOnly_(row[4]),
      shift: row[5] || '',
      title: row[6] || '',
      absT1: row[7] || '',
      dotT1: row[8] || '',
      ootT1: row[9] || '',
      dotDia: row[10] || '',
      ootDia: row[11] || '',
      dotSemana: row[12] || '',
      avgDot: row[13] || '',
      totalPcts: row[14] || '',
      totalParsedLoss: row[15] || '',
      worstHour: row[16] || '',
      statusResumo: row[17] || ''
    }));
}

function getFechamento(id) {
  if (!id) throw new Error('ID não informado.');
  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const row = findRowById_(sh, id);
  if (row <= 1) throw new Error('Fechamento não encontrado.');
  const json = sh.getRange(row, 19).getValue();
  if (!json) throw new Error('Registro sem JSON salvo.');
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('JSON do fechamento está corrompido: ' + e.message);
  }
}

function deleteFechamento(id) {
  if (!id) throw new Error('ID não informado.');
  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const row = findRowById_(sh, id);
  if (row <= 1) throw new Error('Fechamento não encontrado.');
  sh.deleteRow(row);
  return { ok: true, message: 'Fechamento excluído.' };
}

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty(PROP_SPREADSHEET_ID);

  if (savedId) {
    try {
      const ss = SpreadsheetApp.openById(savedId);
      ensureSheetHeaders_(ss);
      return ss;
    } catch (err) {
      props.deleteProperty(PROP_SPREADSHEET_ID);
    }
  }

  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  ensureSheetHeaders_(ss);
  return ss;
}

function ensureSheetHeaders_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  const headers = [
    'ID',
    'Criado em',
    'Atualizado em',
    'Usuário',
    'Data',
    'Turno',
    'Título',
    'ABS T1',
    'DOT T1',
    'OOT T1',
    'DOT Dia',
    'OOT Dia',
    'DOT Semana',
    'DOT médio HH',
    'Total PCTS',
    'Total perdas lidas',
    'Hora crítica',
    'Status resumo',
    'JSON completo'
  ];

  const current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.join('') === '' || current[0] !== 'ID') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    formatSheet_(sh);
  }

  return sh;
}

function formatSheet_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 19);
  sh.getRange(1, 1, 1, lastCol)
    .setFontWeight('bold')
    .setBackground('#FFE600')
    .setFontColor('#202124')
    .setWrap(true);
  sh.setFrozenRows(1);

  const widths = [190, 130, 130, 210, 95, 70, 220, 80, 80, 80, 80, 80, 90, 100, 100, 120, 140, 160, 520];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 2, sh.getLastRow() - 1, 2).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    sh.getRange(2, 5, sh.getLastRow() - 1, 1).setNumberFormat('dd/mm/yyyy');
  }
}

function findRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return -1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.indexOf(id);
  return idx >= 0 ? idx + 2 : -1;
}

function getActiveEmail_() {
  try {
    return Session.getActiveUser().getEmail() || 'Usuário não identificado';
  } catch (err) {
    return 'Usuário não identificado';
  }
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatMaybeDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  }
  return String(value);
}

function formatDateOnly_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(value);
}
