import { exec } from 'child_process'

export async function runTests() {
  return new Promise((resolve) => {
    exec('npm test --silent --json', (err, stdout) => {
      if (err && !stdout) {
        resolve({
          passed: false,
          error: 'Erro ao executar testes',
          details: err.message
        })
        return
      }

      try {
        const result = JSON.parse(stdout)
        resolve(result)
      } catch {
        resolve({
          passed: false,
          error: 'Output de testes inválido',
          raw: stdout
        })
      }
    })
  })
}
