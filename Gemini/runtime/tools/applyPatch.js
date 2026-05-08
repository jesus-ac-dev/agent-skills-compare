import { exec } from 'child_process'

export async function applyPatch(diff) {
  return new Promise((resolve) => {
    const patchProcess = exec('patch -p1', (err) => {
      if (err) {
        resolve({ error: 'Falha ao aplicar patch', details: err.message })
      } else {
        resolve({ status: 'applied' })
      }
    })

    patchProcess.stdin.write(diff)
    patchProcess.stdin.end()
  })
}
