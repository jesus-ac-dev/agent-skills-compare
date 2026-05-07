# 🧩 Gemini Skills Specification

Este documento define as *skills* modulares que o agente Gemini pode ativar durante o ciclo de desenvolvimento.  
Cada skill representa um conjunto de comportamentos, heurísticas e protocolos que o agente deve seguir quando solicitado ou quando o workflow o exige.

As skills são independentes, combináveis e orientadas a TDD, Code Review e refactoring incremental.

# 🧪 1. Skill: TDD Workflow

A skill de TDD define como o agente deve gerar, executar e validar testes antes de implementar código.

## 🎯 Objetivos
- Garantir que todo o código é guiado por testes.
- Minimizar regressões.
- Criar ciclos curtos e seguros de desenvolvimento.

## 📐 Princípios
- **Testes primeiro.**
- **Código mínimo para passar testes.**
- **Refactor apenas com testes verdes.**
- **Nunca ignorar testes falhados.**

## 🔁 Ciclo TDD
1. Gerar testes
2. Executar testes
3. Implementar código mínimo
4. Executar testes novamente
5. Refactor
6. Validar
7. Code

## 🧠 Comportamento do Agente
- O agente deve pedir ficheiros relevantes antes de gerar testes.
- O agente deve justificar cada teste criado.
- O agente deve interpretar resultados de testes e propor correções.
- O agente nunca deve gerar código sem antes gerar testes.

# 🔍 2. Skill: Code Review
A skill de Code Review define como o agente avalia código existente ou patches gerados.

## 🎯 Objetivos
- Melhorar qualidade do código.
- Identificar problemas estruturais.
- Garantir consistência e boas práticas.

## 📐 Princípios
- **Feedback claro e acionável.**
- **Foco em segurança, clareza e manutenção.**
- **Refactors incrementais, nunca massivos.**

## 🧠 Comportamento do Agente
- Identificar code smells.
- Sugerir melhorias específicas.
- Avaliar impacto de alterações.
- Garantir que testes cobrem o comportamento alterado.
- Nunca aprovar código sem testes.

# 🧱 3. Skill: Architecture Reasoning
A skill de raciocínio arquitetural permite ao agente analisar a estrutura global do projeto.

## 🎯 Objetivos
- Melhorar organização.
- Reduzir duplicação.
- Criar boundaries claros.

## 📐 Princípios
- **Modularidade.**
- **Separação de responsabilidades.**
- **Simplicidade.**

## 🧠 Comportamento do Agente
- Identificar módulos mal definidos.
- Propor reorganização incremental.
- Sugerir extração de funções ou ficheiros.
- Avaliar impacto arquitetural de alterações.

# 🧩 4. Skill: Agentic Planning
A skill de planeamento permite ao agente decompor tarefas complexas.

## 🎯 Objetivos
- Criar planos claros.
- Reduzir incerteza.
- Evitar ações precipitadas.

## 📐 Princípios
- **Pensar antes de agir.**
- **Dividir em passos pequenos.**
- **Pedir contexto antes de avançar.**

## 🧠 Comportamento do Agente
- Criar um plano inicial antes de qualquer ação.
- Identificar ficheiros necessários.
- Solicitar contexto ao runtime.
- Atualizar o plano conforme necessário.

# 🛠️ 5. Skill: Refactoring
A skill de refactoring define como o agente melhora código existente.

## 🎯 Objetivos
- Melhorar legibilidade.
- Reduzir complexidade.
- Remover duplicação.

## 📐 Princípios
- **Refactors pequenos.**
- **Testes verdes antes e depois.**
- **Alterações justificadas.**

## 🧠 Comportamento do Agente
- Propor refactors incrementais.
- Gerar patches pequenos e seguros.
- Explicar cada alteração.
- Nunca alterar comportamento sem testes.

# 📝 6. Skill: Documentation
A skill de documentação define como o agente cria ou melhora docs.

## 🎯 Objetivos
- Criar documentação clara e útil.
- Explicar decisões técnicas.
- Ajudar onboarding de novos devs.

## 📐 Princípios
- **Clareza.**
- **Precisão.**
- **Contexto.**

## 🧠 Comportamento do Agente
- Gerar documentação baseada no código real.
- Criar exemplos quando necessário.
- Atualizar docs após alterações de código.


# 🧭 7. Combinação de Skills

As skills podem ser combinadas:
- **TDD + Code Review** → desenvolvimento seguro  
- **Planning + Architecture** → decisões estruturais  
- **Refactoring + TDD** → melhorias contínuas  
- **Documentation + Review** → qualidade global  

O agente deve ativar skills conforme o workflow definido em `Gemini-Workflow.md`.

# 📚 Versão

`Gemini Skills Spec v1.0`