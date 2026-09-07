// ============================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================
// Preencha com as chaves do SEU projeto Firebase (o mesmo painel
// do console.firebase.google.com que você já usa nos outros
// projetos, ex: controle-de-atividades-cd-107, ou crie um novo
// projeto exclusivo para a Escala de Expedição).
//
// Console > Configurações do projeto > Seus apps > SDK setup
// ============================================================

const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Nome da coleção usada por esta escala. Se você reaproveitar um
// projeto Firebase já existente, troque este nome para não colidir
// com as coleções de outras ferramentas (ex: "escala_expedicao_pv1").
const COLLECTION_LINHAS = "escala_expedicao_linhas";
const DOC_META = "escala_expedicao_meta/config";
