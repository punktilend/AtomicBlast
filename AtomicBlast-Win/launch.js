#!/usr/bin/env node
// Launcher that removes ELECTRON_RUN_AS_NODE (set by VSCode/Electron environments)
// so our Electron app runs as a proper browser process instead of plain Node.js.
const { spawn } = require('child_process')
const electronPath = require('electron') // returns binary path string in Node.js context

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  windowsHide: false,
  env
})

child.on('close', code => process.exit(code || 0))
