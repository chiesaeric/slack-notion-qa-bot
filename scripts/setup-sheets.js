#!/usr/bin/env node
/**
 * Google Sheets Setup Helper
 * 
 * Run this script to verify your Google Sheets integration:
 * node scripts/setup-sheets.js
 */

const { parseSpreadsheetUrl } = require('../utils/googleSheets');

const TEST_URL = process.argv[2];

if (!TEST_URL) {
  console.log('Usage: node scripts/setup-sheets.js <spreadsheet-url>');
  console.log('Example: node scripts/setup-sheets.js https://docs.google.com/spreadsheets/d/ABC123.../edit');
  process.exit(1);
}

const spreadsheetId = parseSpreadsheetUrl(TEST_URL);

if (spreadsheetId) {
  console.log(`✅ Valid spreadsheet URL`);
  console.log(`Spreadsheet ID: ${spreadsheetId}`);
} else {
  console.log(`❌ Invalid spreadsheet URL`);
  console.log(`Make sure the URL is from Google Sheets and includes the spreadsheet ID`);
}
