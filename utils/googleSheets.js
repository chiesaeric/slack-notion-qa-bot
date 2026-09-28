/**
 * Google Sheets API Integration
 * For fetching test coverage data from private spreadsheets
 */

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

/**
 * Initialize Google Sheets auth with service account
 */
function getSheetsClient() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!serviceAccountEmail || !privateKey) {
    throw new Error('Missing Google Service Account credentials');
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: SCOPES,
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Fetch specific cell values from a Google Sheet
 * @param {string} spreadsheetId - The spreadsheet ID from URL
 * @param {string} sheetName - Name of the sheet tab
 * @param {Object} cells - Object with cell references { label: 'A1' }
 * @returns {Promise<Object>} Cell values keyed by label
 */
async function fetchCells(spreadsheetId, sheetName, cells) {
  const sheets = getSheetsClient();
  
  // Build the range string: 'SheetName!A1,B2,C3'
  const ranges = Object.values(cells).map(cell => `${sheetName}!${cell}`);
  
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId,
    ranges: ranges,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const result = {};
  const valueRanges = response.data.valueRanges || [];
  
  Object.keys(cells).forEach((label, index) => {
    const values = valueRanges[index]?.values || [];
    result[label] = values[0]?.[0] ?? null;
  });

  return result;
}

/**
 * Fetch test coverage data from spreadsheet
 * @param {string} spreadsheetId - Spreadsheet ID from URL
 * @param {string} sheetName - Sheet tab name
 * @returns {Promise<Object>} Coverage data
 */
async function fetchTestCoverageData(spreadsheetId, sheetName) {
  const cells = {
    scopeTest: 'F5',
    coverage: 'F6',
    totalNotTested: 'I1',
    totalInTesting: 'I2',
    totalPassed: 'I3',
    totalFailed: 'I4',
  };

  const data = await fetchCells(spreadsheetId, sheetName, cells);
  
  return {
    scopeTest: data.scopeTest || '0',
    coverage: data.coverage || '0',
    totalNotTested: data.totalNotTested || '0',
    totalInTesting: data.totalInTesting || '0',
    totalPassed: data.totalPassed || '0',
    totalFailed: data.totalFailed || '0',
  };
}

/**
 * Extract spreadsheet ID from Google Sheets URL
 */
function parseSpreadsheetUrl(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

module.exports = {
  fetchTestCoverageData,
  parseSpreadsheetUrl,
};
