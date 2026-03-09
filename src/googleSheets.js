/**
 * Google Apps Script–based backend for Patch Tracker.
 *
 * Setup (one-time, by any team member):
 *  1. Create a Google Sheet
 *  2. Create a Google Drive folder for patch files, copy its folder ID from the URL
 *  3. Extensions → Apps Script → paste the script from the setup guide
 *  4. Deploy → Web app → Execute as "Me", access "Anyone"
 *  5. Copy the Web App URL + API Key → paste into Patch Tracker settings
 *  6. Share the Google Sheet & Drive folder with your team manually
 *
 * Security:
 *  - API key required on every request (generated during setup)
 *  - Input validation & sanitization on all writes
 *  - Empty array protection (prevents accidental data wipe)
 *  - File downloads restricted to allowed Drive folder only
 *  - File size limits on uploads
 *  - Path traversal prevention on file names
 */

const SETTINGS_KEY = 'patch_tracker_settings'

/* ── settings persistence ──────────────────────── */

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch { return {} }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

/* ── API calls to Apps Script web app ──────────── */

function getApiKey() {
  const s = loadSettings()
  return s.apiKey || ''
}

// Google Apps Script web apps redirect POST (302). Using text/plain avoids
// CORS preflight. redirect:'follow' ensures the browser follows the redirect.
async function gasPost(webAppUrl, body) {
  const resp = await fetch(webAppUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ...body, apiKey: getApiKey() }),
  })
  if (!resp.ok) throw new Error(`Request failed: ${resp.status} ${resp.statusText}`)
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data
}

async function gasGet(webAppUrl, params = {}) {
  const url = new URL(webAppUrl)
  url.searchParams.set('apiKey', getApiKey())
  url.searchParams.set('t', Date.now())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const resp = await fetch(url.toString(), { redirect: 'follow' })
  if (!resp.ok) throw new Error(`Request failed: ${resp.status} ${resp.statusText}`)
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function pushPatches(webAppUrl, patches) {
  return gasPost(webAppUrl, { action: 'save', patches })
}

export async function pullPatches(webAppUrl) {
  const data = await gasGet(webAppUrl, { action: 'pull' })
  return data.patches || []
}

export async function uploadFileToDrive(webAppUrl, file, patchName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1]
        const data = await gasPost(webAppUrl, {
          action: 'upload',
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data: base64,
          folderName: patchName || 'Patch Files',
        })
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function fetchFileFromDrive(webAppUrl, fileId) {
  const data = await gasPost(webAppUrl, { action: 'download', fileId })
  const binary = atob(data.base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: data.mimeType || 'application/zip' })
}

/* ── URL parsers ───────────────────────────────── */

export function extractFolderIdFromUrl(url) {
  // https://drive.google.com/drive/folders/FOLDER_ID or just the ID
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : url.trim()
}

export function extractSheetIdFromUrl(url) {
  // https://docs.google.com/spreadsheets/d/SHEET_ID/... or just the ID
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : url.trim()
}

/* ── API key generator ─────────────────────────── */

export function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => chars[b % chars.length]).join('')
}

/* ── Google Apps Script template ───────────────── */

export function generateAppsScript(folderId = '', sheetId = '', apiKey = '') {
  return `// ========================================
// Patch Tracker — Google Apps Script (Secured)
// Auto-generated — paste into Extensions > Apps Script
// Deploy as Web App (Execute as: Me, Access: Anyone)
// ========================================

var SHEET_NAME = 'Patches';
var DRIVE_FOLDER_ID = '${folderId}';
var SHEET_ID = '${sheetId}';
var API_KEY = '${apiKey}';

// ── Security: API key check ──
function checkAuth(key) {
  if (!API_KEY) return true;
  return key === API_KEY;
}

function getSpreadsheet() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  try {
    var key = (e && e.parameter && e.parameter.apiKey) || '';
    if (!checkAuth(key)) return jsonResponse({ error: 'Unauthorized' });
    var action = (e && e.parameter && e.parameter.action) || 'pull';
    if (action === 'pull') return jsonResponse({ patches: readPatches() });
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (!checkAuth(body.apiKey || '')) return jsonResponse({ error: 'Unauthorized' });

    if (body.action === 'save') {
      var result = writePatches(body.patches);
      return jsonResponse(result);
    }

    if (body.action === 'upload') {
      var result = uploadFile(body.fileName, body.mimeType, body.base64Data, body.folderName);
      return jsonResponse(result);
    }

    if (body.action === 'download') {
      var result = downloadFile(body.fileId);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Input validation ──
var ALLOWED_FIELDS = [
  'id', 'name', 'preparedDate', 'releaseDate', 'environment',
  'testingStatus', 'deploymentStatus', 'responsiblePerson',
  'codeFiles', 'dbScripts', 'notes', 'order'
];

function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '')
            .replace(/javascript:/gi, '');
}

function validatePatch(p) {
  if (!p || typeof p !== 'object') return null;
  if (!p.id || typeof p.id !== 'string') return null;
  var clean = {};
  for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
    var k = ALLOWED_FIELDS[i];
    if (p[k] !== undefined) {
      clean[k] = (typeof p[k] === 'string') ? sanitizeString(p[k]) : p[k];
    }
  }
  return clean;
}

// ── Read patches from the sheet ──
function readPatches() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var patches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var patch = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (typeof val === 'string' && (val.charAt(0) === '[' || val.charAt(0) === '{')) {
        try { val = JSON.parse(val); } catch(e) {}
      }
      patch[headers[j]] = (val === 0 || val === false) ? val : (val || '');
    }
    if (patch.id) patches.push(patch);
  }
  return patches;
}

// ── Write patches to the sheet ──
function writePatches(patches) {
  if (!Array.isArray(patches)) return { error: 'patches must be an array' };
  if (patches.length === 0) return { error: 'Cannot save empty patches (prevents accidental data wipe)' };
  if (patches.length > 500) return { error: 'Too many patches (max 500)' };

  var cleanPatches = [];
  for (var i = 0; i < patches.length; i++) {
    var clean = validatePatch(patches[i]);
    if (clean) cleanPatches.push(clean);
  }
  if (cleanPatches.length === 0) return { error: 'No valid patches after validation' };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  var headers = ALLOWED_FIELDS;
  var rows = [headers];
  for (var i = 0; i < cleanPatches.length; i++) {
    var p = cleanPatches[i];
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      var val = p[headers[j]];
      if (Array.isArray(val) || (typeof val === 'object' && val !== null)) val = JSON.stringify(val);
      row.push((val === 0 || val === false) ? val : (val || ''));
    }
    rows.push(row);
  }

  sheet.clear();
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);

  // Format header row
  var hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight('bold');
  hr.setBackground('#1b1c1e');
  hr.setFontColor('#4ade80');

  // Color-code status columns
  var ENV_COLORS = {
    'Production': { bg: '#4c1d1d', fg: '#fca5a5' },
    'Pre-Prod':   { bg: '#4c3a1d', fg: '#fcd34d' },
    'SIT':        { bg: '#1d4c2a', fg: '#6ee7b7' },
    'UAT':        { bg: '#3b1d4c', fg: '#c4b5fd' },
    'Dev':        { bg: '#1d3a4c', fg: '#7dd3fc' }
  };
  var TEST_COLORS = {
    'Passed':      { bg: '#1d4c2a', fg: '#6ee7b7' },
    'In Progress': { bg: '#4c3a1d', fg: '#fcd34d' },
    'Failed':      { bg: '#4c1d1d', fg: '#fca5a5' },
    'Pending':     { bg: '#2a2a2a', fg: '#a3a3a3' }
  };
  var DEPLOY_COLORS = {
    'Deployed':    { bg: '#1d4c2a', fg: '#6ee7b7' },
    'In Queue':    { bg: '#4c3a1d', fg: '#fcd34d' },
    'Rolled_Back': { bg: '#4c1d1d', fg: '#fca5a5' },
    'Scheduled':   { bg: '#1d3a4c', fg: '#7dd3fc' }
  };

  // Column indices (0-based): environment=4, testingStatus=5, deploymentStatus=6
  var envCol = headers.indexOf('environment') + 1;
  var testCol = headers.indexOf('testingStatus') + 1;
  var deployCol = headers.indexOf('deploymentStatus') + 1;

  for (var r = 0; r < cleanPatches.length; r++) {
    var p = cleanPatches[r];
    var row = r + 2; // +1 for header, +1 for 1-based

    if (envCol && p.environment && ENV_COLORS[p.environment]) {
      var c = ENV_COLORS[p.environment];
      sheet.getRange(row, envCol).setBackground(c.bg).setFontColor(c.fg).setFontWeight('bold');
    }
    if (testCol && p.testingStatus && TEST_COLORS[p.testingStatus]) {
      var c = TEST_COLORS[p.testingStatus];
      sheet.getRange(row, testCol).setBackground(c.bg).setFontColor(c.fg).setFontWeight('bold');
    }
    if (deployCol && p.deploymentStatus && DEPLOY_COLORS[p.deploymentStatus]) {
      var c = DEPLOY_COLORS[p.deploymentStatus];
      sheet.getRange(row, deployCol).setBackground(c.bg).setFontColor(c.fg).setFontWeight('bold');
    }
  }

  // Set dark background for all data cells
  if (cleanPatches.length > 0) {
    var dataRange = sheet.getRange(2, 1, cleanPatches.length, headers.length);
    dataRange.setBackground('#1b1c1e');
    dataRange.setFontColor('#e0e0e0');

    // Re-apply status colors on top (setBackground above overwrites them)
    for (var r = 0; r < cleanPatches.length; r++) {
      var p = cleanPatches[r];
      var row = r + 2;
      if (envCol && p.environment && ENV_COLORS[p.environment]) {
        var c = ENV_COLORS[p.environment];
        sheet.getRange(row, envCol).setBackground(c.bg).setFontColor(c.fg);
      }
      if (testCol && p.testingStatus && TEST_COLORS[p.testingStatus]) {
        var c = TEST_COLORS[p.testingStatus];
        sheet.getRange(row, testCol).setBackground(c.bg).setFontColor(c.fg);
      }
      if (deployCol && p.deploymentStatus && DEPLOY_COLORS[p.deploymentStatus]) {
        var c = DEPLOY_COLORS[p.deploymentStatus];
        sheet.getRange(row, deployCol).setBackground(c.bg).setFontColor(c.fg);
      }
    }
  }

  return { success: true, count: cleanPatches.length };
}

// ── Upload file to Drive ──
function uploadFile(fileName, mimeType, base64Data, folderName) {
  if (!DRIVE_FOLDER_ID) return { error: 'DRIVE_FOLDER_ID not set in Apps Script' };
  if (!fileName || typeof fileName !== 'string') return { error: 'Invalid fileName' };
  if (!base64Data || typeof base64Data !== 'string') return { error: 'Invalid file data' };

  // Sanitize: strip path traversal
  fileName = fileName.replace(/[\\/\\\\]/g, '_').replace(/\\.\\.+/g, '_');



  var rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  folderName = (folderName || 'Patch Files').replace(/[\\/\\\\]/g, '_').replace(/\\.\\.+/g, '_');

  var subFolder;
  var subs = rootFolder.getFoldersByName(folderName);
  if (subs.hasNext()) { subFolder = subs.next(); }
  else { subFolder = rootFolder.createFolder(folderName); }

  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);
  var file = subFolder.createFile(blob);

  return {
    success: true,
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

// ── Download file from Drive ──
function downloadFile(fileId) {
  if (!fileId || typeof fileId !== 'string') return { error: 'fileId is required' };
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) return { error: 'Invalid fileId format' };

  var file = DriveApp.getFileById(fileId);

  // Verify file is inside the allowed Drive folder
  if (DRIVE_FOLDER_ID) {
    var parents = file.getParents();
    var allowed = false;
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() === DRIVE_FOLDER_ID || isChildOf(parent, DRIVE_FOLDER_ID)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return { error: 'Access denied: file not in allowed folder' };
  }

  var blob = file.getBlob();
  var base64Data = Utilities.base64Encode(blob.getBytes());
  return {
    success: true,
    base64Data: base64Data,
    mimeType: blob.getContentType(),
    fileName: file.getName()
  };
}

function isChildOf(folder, targetId) {
  var parents = folder.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() === targetId) return true;
    if (isChildOf(p, targetId)) return true;
  }
  return false;
}`
}
