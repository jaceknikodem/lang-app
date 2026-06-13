// Intercepts require('electron') so scripts run outside Electron.
// All getPath('userData') calls return the real KotobaAI user data directory.
const Module = require('module');
const os = require('os');
const path = require('path');

const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'KotobaAI');

const originalLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return userDataPath;
          if (name === 'temp') return os.tmpdir();
          return userDataPath;
        },
        isPackaged: false,
        getName: () => 'KotobaAI',
      },
      systemPreferences: {
        getMediaAccessStatus: () => 'granted',
        askForMediaAccess: () => Promise.resolve(true),
      },
    };
  }
  return originalLoad(request, parent, isMain);
};
