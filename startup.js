// Azure App Service startup file
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Azure App Service...');
console.log('Current directory:', process.cwd());
console.log('Node version:', process.version);

// Start the main application
const app = spawn('node', ['app.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

app.on('error', (err) => {
  console.error('Failed to start app:', err);
  process.exit(1);
});

app.on('exit', (code) => {
  console.log(`App exited with code ${code}`);
  process.exit(code);
});
