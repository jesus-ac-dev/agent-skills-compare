import fs from 'fs/promises'
import path from 'path'

const ROOT = process.cwd()

export async function readFile(filePath) {
  const safePath = path.join(ROOT, filePath)

  try {
    const content = await fs.readFile(safePath, 'utf8')
    return { content }
  } catch (err) {
    return { error: `Erro ao ler ficheiro: ${filePath}`, details: err.message }
  }
}
