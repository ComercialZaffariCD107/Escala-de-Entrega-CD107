# Escala de Entrega — CD Nova Santa Rita

Planilha colaborativa em tempo real (estilo Google Sheets) para a escala de
expedição, com tema claro nas cores Stok Center / Comercial Zaffari.

## Como colocar para funcionar

### 1. Criar (ou reaproveitar) um projeto Firebase
1. Acesse https://console.firebase.google.com
2. Crie um projeto novo (ou use um já existente, ex: `controle-de-atividades-cd-107`)
3. Ative o **Firestore Database** (modo produção)
4. Em **Configurações do projeto → Seus apps → Web**, copie as chaves

### 2. Preencher `firebase-config.js`
Cole as chaves copiadas no lugar de `COLE_AQUI_SUA_API_KEY` etc.
Se for reaproveitar um projeto já existente, apenas troque o nome de
`COLLECTION_LINHAS` para não colidir com as coleções de outras ferramentas.

### 3. Regras do Firestore (multiusuário sem login)
Em **Firestore → Regras**, use (ajuste conforme sua necessidade de segurança):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> Como não há tela de login neste app (para agilizar o preenchimento em
> equipe), qualquer pessoa com o link consegue editar. Se quiser restringir,
> me avise que adiciono Firebase Auth como já fizemos no Relatório de
> Expedição.

### 4. Publicar no GitHub Pages
1. Suba os 4 arquivos (`index.html`, `style.css`, `script.js`, `firebase-config.js`)
   para o repositório, na mesma organização dos outros projetos
2. Ative o GitHub Pages apontando para a branch/pasta do projeto
3. Acesse o link gerado — os dados iniciais do PV 1 são carregados
   automaticamente na primeira abertura (só uma vez, se a coleção estiver vazia)

## Como funciona a colaboração em tempo real

- Cada célula é salva individualmente ao sair dela (Tab/Enter/clicar fora),
  como no Google Sheets
- Qualquer alteração feita por qualquer pessoa aparece nas telas de todos
  em segundos, via `onSnapshot` do Firestore
- Os contadores de FROTA (Rodotrem, Sider, Carreta... / Transpio, Darchel...)
  são recalculados automaticamente a partir das colunas **Tipo de Veículo**
  e **Frota**
- "+ Grupo PV" cria uma nova linha de cabeçalho (ex: "CARGAS DO PV 2") que
  pode ser editada e reposicionada ajustando o campo `ordem` no Firestore,
  se precisar reordenar manualmente

## Próximos passos possíveis
- Aplicar o mesmo padrão de auto-sync via File System Access API que você já
  usa na Pendência PTL, caso queira importar direto do export do Metabase
- Adicionar Firebase Auth por matrícula, igual ao Relatório de Expedição
- Ajustar a paleta assim que você enviar o print de referência do Stok Center
