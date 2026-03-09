/**
 * Google Apps Script–based backend for Patch Tracker.
 *
 * Setup (one-time, by any team member):
 *  1. Create a Google Sheet
 *  2. Extensions → Apps Script → paste the script from the setup guide
 *  3. Deploy → Web app → Execute as "Me", access "Anyone"
 *  4. Copy the Web App URL → paste into Patch Tracker settings
 *  5. Share the Google Sheet & Drive folder with your team
 *
 * The Apps Script handles reading/writing the Sheet and uploading files to Drive.
 * No OAuth, no Google Cloud Console needed.
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

export async function pushPatches(webAppUrl, patches) {
  const resp = await fetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'save', patches }),
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function pullPatches(webAppUrl) {
  const resp = await fetch(`${webAppUrl}?action=pull&t=${Date.now()}`)
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data.patches || []
}

export async function uploadFileToDrive(webAppUrl, file, patchName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1]
        const resp = await fetch(webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'upload',
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64Data: base64,
            folderName: patchName || 'Patch Files',
          }),
        })
        const data = await resp.json()
        if (data.error) throw new Error(data.error)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/* ── Google Apps Script template ───────────────── */

export const APPS_SCRIPT_CODE = `
// ========================================
// Patch Tracker — Google Apps Script
// Paste this into Extensions > Apps Script
// Deploy as Web App (Execute as: Me, Access: Anyone)
// ========================================

const SHEET_NAME = 'Patches';
const DRIVE_FOLDER_NAME = 'Patch Tracker Files';

function doGet(e) {
  try {
    const action = e.parameter.action || 'pull';
    if (action === 'pull') {
      return ContentService.createTextOutput(
        JSON.stringify({ patches: readPatches() })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(
      JSON.stringify({ error: 'Unknown action' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.action === 'save') {
      writePatches(body.patches);
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, count: body.patches.length })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'upload') {
      const result = uploadFile(body.fileName, body.mimeType, body.base64Data, body.folderName);
      return ContentService.createTextOutput(
        JSON.stringify(result)
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ error: 'Unknown action' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function readPatches() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const patches = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const patch = {};
    headers.forEach((h, idx) => {
      let val = row[idx];
      // Parse JSON fields (codeFiles, dbScripts)
      if ((h === 'codeFiles' || h === 'dbScripts') && typeof val === 'string' && val.startsWith('[')) {
        try { val = JSON.parse(val); } catch(e) { val = []; }
      }
      patch[h] = val || '';
    });
    if (patch.id) patches.push(patch);
  }
  return patches;
}

function writePatches(patches) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = [
    'id', 'name', 'preparedDate', 'releaseDate',
    'environment', 'testingStatus', 'deploymentStatus',
    'responsiblePerson', 'codeFiles', 'dbScripts'
  ];

  const rows = [headers];
  patches.forEach(p => {
    rows.push(headers.map(h => {
      const val = p[h];
      if (Array.isArray(val)) return JSON.stringify(val);
      return val || '';
    }));
  });

  sheet.clear();
  if (rows.length > 0) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  }

  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1b1c1e');
  headerRange.setFontColor('#4ade80');
}

function uploadFile(fileName, mimeType, base64Data, folderName) {
  // Find or create folder
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  let rootFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);

  // Find or create sub-folder for this patch
  let subFolder;
  const subs = rootFolder.getFoldersByName(folderName);
  if (subs.hasNext()) {
    subFolder = subs.next();
  } else {
    subFolder = rootFolder.createFolder(folderName);
  }

  // Decode and create file
  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decoded, mimeType, fileName);
  const file = subFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    success: true,
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
  };
}
`.trim()
