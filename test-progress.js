// Simple test script to check database functionality
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Use the same path as Electron would use
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'local-language-learning-app');
const dbPath = path.join(userDataPath, 'language_learning.db');

console.log('Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Check if database exists and has tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables);
  
  // Check words table
  const wordCount = db.prepare("SELECT COUNT(*) as count FROM words").get();
  console.log('Word count:', wordCount);
  
  // Check progress table
  const progressCount = db.prepare("SELECT COUNT(*) as count FROM progress").get();
  console.log('Progress count:', progressCount);
  
  // Test getStudyStats query
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as totalWords,
      COUNT(CASE WHEN last_studied IS NOT NULL THEN 1 END) as wordsStudied,
      AVG(CASE WHEN last_studied IS NOT NULL THEN strength ELSE NULL END) as averageStrength,
      MAX(last_studied) as lastStudyDate
    FROM words
    WHERE ignored = FALSE
  `).get();
  console.log('Study stats:', stats);
  
  // Test getRecentStudySessions query
  const sessions = db.prepare(`
    SELECT id, words_studied, when_studied
    FROM progress
    ORDER BY when_studied DESC
    LIMIT 5
  `).all();
  console.log('Recent sessions:', sessions);
  
  db.close();
} catch (error) {
  console.error('Error:', error);
}