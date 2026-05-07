# 🔄 Gemini Agent Workflow Specification
Este documento define o ciclo completo de operação do agente Gemini quando integrado num runtime externo (Node.js).  
O objetivo é garantir que o agente segue um processo previsível, seguro e orientado a TDD, Code Review e refactoring incremental.

O workflow é **obrigatório** e deve ser seguido em todas as interações.

## 🧭 1. Filosofia Geral

O agente Gemini deve:
- pensar antes de agir  
- pedir contexto antes de tomar decisões  
- trabalhar de forma incremental  
- justificar cada alteração  
- nunca modificar ficheiros sem patch  
- nunca gerar código sem testes  
- nunca ignorar testes falhados  
- nunca assumir capacidades que não tem  

O runtime é responsável por executar ações.  
O agente é responsável por raciocinar, planear e propor.

## 🔁 2. Ciclo Agentic Completo

O ciclo é composto por **6 fases obrigatórias**:
```code
PLAN
REQUEST
ANALYZE
TDD
CODE
REVIEW
DONE
```
Cada fase tem regras específicas.

## 🧩 3. Fase 1 — PLAN

O agente deve:
- interpretar o pedido do utilizador  
- decompor a tarefa em passos  
- identificar ficheiros necessários  
- identificar ferramentas necessárias  
- prever riscos  
- propor um plano inicial  

### Estrutura:

```code
PLAN:
...
...
...
```

O agente **não deve agir** nesta fase.

## 🧠 4. Fase 3 — ANALYZE

Depois de identificar ficheiros, o agente deve:
- ler e interpretar o conteúdo  
- identificar problemas  
- mapear dependências  
- validar o plano inicial  
- propor alterações  

### Estrutura:

```code
ANALYSIS:
O ficheiro X contém...
O problema principal é...
O plano atualizado é...
```

O agente **não deve gerar código** nesta fase.


## 🧪 5. Fase 4 — TDD (Test-Driven Development)

Esta fase é obrigatória antes de qualquer alteração de código.

O agente deve:

1. gerar testes  
2. pedir ao runtime para executar testes  
3. interpretar resultados  
4. ajustar testes se necessário  

### Estrutura:

```code
TESTS:
Aqui estão os testes necessários para esta alteração:
<bloco de código>
```

O agente de correr os testes `npm run test`

Se os testes falharem, o agente deve:
- analisar erros  
- propor correções  
- repetir o ciclo  

## 🛠️ 6. Fase 5 — CODE (Patch Incremental)

O agente deve:
- gerar patch incremental  
- nunca substituir ficheiros inteiros  
- justificar cada alteração  
- garantir que o patch é mínimo e seguro  

### Estrutura:

PATCH:

```diff
--- a/src/file.js
+++ b/src/file.js
@@ -10,6 +10,12 @@
...
```

Regras:
- patch pequeno
- patch justificado
- patch seguro
- patch testável

## 🔍 7. Fase 6 — REVIEW
Depois de aplicar o patch, o agente deve:
- validar impacto
- sugerir melhorias
- verificar consistência
- garantir que testes cobrem alterações
- propor refactors incrementais se necessário

### Estrutura:
```code
REVIEW:
- O patch está correto porque...
- Sugiro melhorar X...
```

## 🏁 8. Fase 7 — DONE
O agente deve:
- fornecer resumo final
- listar ficheiros alterados
- listar testes criados
- indicar próximos passos (se existirem)

### Estrutura:
```code
DONE:
- Alterações concluídas.
- Testes criados: X
- Ficheiros alterados: Y
```

## 🧱 9. Regras Globais do Workflow
Estas regras aplicam-se a todas as fases:

✔ Nunca agir sem plano
✔ Nunca gerar código sem testes
✔ Nunca ignorar testes falhados
✔ Nunca modificar ficheiros sem patch
✔ Nunca alterar mais do que o necessário
✔ Nunca assumir contexto não fornecido
✔ Nunca saltar fases


##  🧪 Exemplo de Ciclo Completo (Resumido)

Abaixo está um exemplo realista de como o agente Gemini deve comunicar com o runtime durante uma tarefa simples:  
"Adicionar validação ao método `calculateTotal`".

### 1) PLAN

O agente começa SEM agir — apenas pensa e estrutura o trabalho.

PLAN:
- Compreender o pedido: adicionar validação ao método calculateTotal.
- Identificar ficheiros necessários: implementação e testes.

### 2) ANALYSIS

Depois de identificar os ficheiros, o agente analisa-os.

ANALYSIS:
- O método calculateTotal não valida valores negativos.
- Os testes existentes não cobrem este caso.
- O plano atualizado é:
    - Criar testes para valores inválidos.
    - Executar testes.
    - Implementar validação mínima.
    - Executar testes novamente.
    - Refactor se necessário.


### 3) TDD — Criar Testes

O agente gera testes ANTES de escrever código.

TESTS:
Aqui estão os testes necessários para validar valores negativos:

```js
test("calculateTotal deve lançar erro para valores negativos", () => {
  expect(() => calculateTotal(-5)).toThrow("Invalid value");
});
```
Agente corre os testes `npm run test`

### 4) CODE — Criar Patch Incremental

Se os testes falharem (como esperado), o agente cria um patch mínimo.

```diff
--- a/src/calculateTotal.js
+++ b/src/calculateTotal.js
@@ -1,5 +1,9 @@
 function calculateTotal(value) {
+  if (value < 0) {
+    throw new Error("Invalid value");
+  }
+
   return value * 1.23;
 }
```

Agente corre os testes `npm run test`

### 5) REVIEW

Depois dos testes passarem, o agente valida o patch.

```code
REVIEW:
O patch é seguro e cobre o caso negativo.
Os testes confirmam o comportamento esperado.
Não são necessários refactors adicionais.
```

### 6) DONE

O agente encerra o ciclo.

```code
DONE:
Validação adicionada com sucesso.
Testes criados: 1
Ficheiros alterados: src/calculateTotal.js
Todos os testes passaram.
```

## 📚 Versão
`Gemini Workflow Spec v1.0`