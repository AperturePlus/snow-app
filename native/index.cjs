const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const nativeDir = __dirname
const candidates = [
  join(nativeDir, 'snow_native.darwin-arm64.node'),
  join(nativeDir, 'snow_native.darwin-x64.node'),
  join(nativeDir, 'snow_native.linux-x64-gnu.node'),
  join(nativeDir, 'snow_native.win32-x64-msvc.node'),
  ...readdirSync(nativeDir)
    .filter((file) => file.endsWith('.node'))
    .map((file) => join(nativeDir, file))
]

const nativeBinding = candidates.find((candidate) => existsSync(candidate))

if (!nativeBinding) {
  throw new Error('Unable to locate compiled snow_native *.node binding. Run `npm run build:rust`.')
}

module.exports = require(nativeBinding)
