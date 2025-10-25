// Script to add test data to the database
const { app } = require('electron');
const path = require('path');

// This would be run in the main process context
// For now, let's create a simple test by adding data through the IPC handlers

console.log('This script would add test data to the database');
console.log('Since we cannot directly run this in the main process context,');
console.log('we need to add test data through the application itself.');