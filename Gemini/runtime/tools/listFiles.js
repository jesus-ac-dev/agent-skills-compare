import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

export async function listFiles() {
  const files = []

  function walk(dir) {
    const entries = fs.readdirSync(dir)

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else {
        files.push(fullPath.replace(ROOT + '/', ''))
      }
    }
  }

  walk(ROOT)

  return { files }
}
