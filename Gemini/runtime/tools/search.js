import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

export async function search(pattern) {
  const results = []

  function walk(dir) {
    const files = fs.readdirSync(dir)

    for (const file of files) {
      const fullPath = path.join(dir, file)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else {
        const content = fs.readFileSync(fullPath, 'utf8')
        const lines = content.split('\n')

        lines.forEach((line, index) => {
          if (line.includes(pattern)) {
            results.push({
              path: fullPath.replace(ROOT + '/', ''),
              line: index + 1,
              context: line.trim()
            })
          }
        })
      }
    }
  }

  walk(ROOT)

  return { results }
}
