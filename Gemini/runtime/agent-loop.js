// /Gemini/runtime/agent-loop.js

import { GoogleGenerativeAI } from '@google/generative-ai'
import * as tools from './tools/index.js'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-pro' })

/**
 * Estado interno do agente
 */
const agentState = {
  messages: [], // histórico de mensagens
  step: 0 // contador de iterações
}

/**
 * Envia mensagem para o Gemini e devolve a resposta estruturada
 */
async function sendToGemini(prompt) {
  const result = await model.generateContent({
    contents: [...agentState.messages, { role: 'user', parts: [{ text: prompt }] }]
  })

  const text = result.response.text()
  agentState.messages.push({ role: 'assistant', parts: [{ text }] })

  return text
}

/**
 * Identifica a fase do workflow a partir da resposta do agente
 */
function detectPhase(response) {
  const phases = ['PLAN', 'REQUEST', 'ANALYSIS', 'TESTS', 'PATCH', 'REVIEW', 'DONE']
  return phases.find((p) => response.startsWith(p + ':')) || 'UNKNOWN'
}

/**
 * Extrai bloco de código ou diff da resposta
 */
function extractBlock(response) {
  const match = response.match(/```([\s\S]*?)```/)
  return match ? match[1] : null
}

/**
 * Executa ferramentas conforme pedido do agente
 */
async function handleToolRequest(phase, response) {
  switch (phase) {
    case 'REQUEST': {
      // Exemplo: "Por favor envia-me src/index.js"
      const files = response.match(/- (.*)/g)?.map((f) => f.replace('- ', '').trim()) || []
      const results = {}

      for (const file of files) {
        results[file] = await tools.readFile(file)
      }

      return JSON.stringify(results, null, 2)
    }

    case 'TESTS': {
      return await tools.runTests()
    }

    case 'PATCH': {
      const diff = extractBlock(response)
      if (!diff) return 'Erro: patch não encontrado.'
      return await tools.applyPatch(diff)
    }

    default:
      return null
  }
}

/**
 * Loop principal do agente
 */
export async function runAgent(userMessage) {
  agentState.messages.push({ role: 'user', parts: [{ text: userMessage }] })

  while (agentState.step < 20) {
    agentState.step++

    const response = await sendToGemini(userMessage)
    const phase = detectPhase(response)

    console.log(`\n=== FASE DETECTADA: ${phase} ===`)
    console.log(response)

    if (phase === 'DONE') {
      return response
    }

    const toolResult = await handleToolRequest(phase, response)

    if (toolResult) {
      userMessage = `RESULTADO DA FERRAMENTA:\n${JSON.stringify(toolResult, null, 2)}`
    } else {
      // Se não há ferramenta, apenas continua o diálogo
      userMessage = 'Continua.'
    }
  }

  return 'Limite de passos atingido.'
}
