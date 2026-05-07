# 🛠️ Gemini Runtime Tools Specification

Este documento define todas as ferramentas expostas pelo runtime (Node.js) ao agente Gemini.  
O agente **não tem acesso direto ao sistema de ficheiros, testes ou execução de código** — tudo é feito através destas ferramentas.

Cada ferramenta é uma função remota que o agente pode invocar através do protocolo definido no `agent-loop.js`.


## 🧩 1. Filosofia das Ferramentas

As ferramentas devem ser:
- **seguras** — nunca permitem operações destrutivas
- **determinísticas** — sempre o mesmo output para o mesmo input
- **mínimas** — apenas o necessário para o workflow agentic
- **auditáveis** — todas as ações ficam registadas
- **incrementais** — nunca substituem ficheiros inteiros sem patch

O agente Gemini **nunca deve assumir** que uma ferramenta existe sem estar listada aqui.


## 📁 2. Lista de Ferramentas Disponíveis
Abaixo estão todas as ferramentas que o runtime expõe ao agente.


### 📝 `read_file(path)`

#### Descrição
Lê um ficheiro do projeto e devolve o conteúdo como string.

```json
Input
{ "path": "src/index.js" }
Output
json
{ "content": "..." }
```
#### Regras
- Apenas leitura.
- Se o ficheiro não existir, devolver erro estruturado.
- Nunca devolver ficheiros fora do workspace.

### 📄 write_file(path, content)

#### Descrição
Escreve conteúdo num ficheiro, mas apenas após patch aprovado.

```json
Input
json
{
  "path": "src/index.js",
  "content": "novo conteúdo"
}
Output
json
{ "status": "ok" }
```
#### Regras
- Nunca substituir ficheiros inteiros sem patch.
- O runtime deve validar que o patch foi aplicado antes.

### 🔍 search(pattern)
#### Descrição
Pesquisa texto no projeto e devolve uma lista de ocorrências.
```json
Input
json
{ "pattern": "calculateTotal" }
Output
json
{
  "results": [
    { "path": "src/calc.js", "line": 12, "context": "..." }
  ]
}
```
#### Regras
- Apenas pesquisa textual.
- Nunca executa regex perigosas.

### 📂 list_files()
#### Descrição
Lista todos os ficheiros do projeto.

```json
Output
json
{
  "files": [
    "src/index.js",
    "src/utils.js",
    "tests/index.test.js"
  ]
}
```
#### Regras
- Apenas caminhos relativos.
- Nunca expor ficheiros fora do workspace.

### 🧪 run_tests()

#### Descrição
Executa a suite de testes (Jest, Vitest, Mocha, etc.) e devolve resultados estruturados.

```json
Output
json
{
  "passed": true,
  "summary": {
    "total": 12,
    "passed": 12,
    "failed": 0
  },
  "failures": []
}
```
#### Regras
- O agente nunca executa testes diretamente.
- O runtime pode delegar para Husky, CI, Jest, Vitest, etc.
- Deve devolver erros completos quando falham.

### 🧩 apply_patch(diff)
#### Descrição
Aplica um patch incremental no formato diff.
```diff
Input
diff
--- a/src/index.js
+++ b/src/index.js
@@ -1,5 +1,9 @@
 function calculateTotal(value) {
+  if (value < 0) {
+    throw new Error("Invalid value");
+  }
   return value * 1.23;
 }
Output
json
{ "status": "applied" }
```
#### Regras
- Validar sintaxe do patch.
- Rejeitar patches que alterem ficheiros inteiros.
- Rejeitar patches que removam mais de X linhas (configurável).
- Rejeitar patches que criem ficheiros fora do workspace.

### 🧠 get_context()
#### Descrição
Devolve contexto adicional do projeto.
```json
Output
json
{
  "project_name": "agent-skills-compare",
  "language": "javascript",
  "test_framework": "vitest"
}
```
#### Regras
- Apenas metadados.
- Nunca expor variáveis de ambiente sensíveis.

## 🔐 3. Segurança das Ferramentas
Todas as ferramentas devem:
- validar inputs
- rejeitar caminhos absolutos
- rejeitar caminhos com ../
- rejeitar patches perigosos
- registar todas as ações
- nunca executar código arbitrário

## 🔄 4. Interação com o Workflow
As ferramentas são usadas em fases específicas:

| Fase | Ferramentas Permitidas |
| --- | --- | 
| PLAN | nenhuma |
| REQUEST | nenhuma |
| ANALYZE | read_file, list_files, search |
| TDD | run_tests |
| CODE | apply_patch, write_file |
| REVIEW | read_file, search |
| DONE |nenhuma |


## 🧭 5. Exemplo de Chamada Real
Runtime executa:
```js
const result = await run_tests();
Runtime devolve ao agente:
json
{
  "passed": false,
  "failures": [
    {
      "test": "calculateTotal deve lançar erro para valores negativos",
      "message": "Expected function to throw"
    }
  ]
}
```

## 📚 Versão
`Gemini Tools Spec v1.0`