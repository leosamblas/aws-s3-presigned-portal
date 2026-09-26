require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Bucket e Região (obtidos de variáveis de ambiente / .env)
const BUCKET_NAME = process.env.BUCKET_NAME || 'meu-bucket-s3-exemplo';
const REGION = process.env.AWS_REGION || 'us-east-1';

// Cliente S3 utilizando credenciais locais da AWS
const s3 = new S3Client({ region: REGION });

// Configuração do Multer para upload em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // Limite de 50MB
});

// Arquivos estáticos da interface web
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ====================================================================================
// 1. LISTAGEM DE ARQUIVOS
// ====================================================================================
app.get('/api/files', async (req, res) => {
  try {
    const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
    const response = await s3.send(command);

    const files = (response.Contents || []).map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified
    }));

    res.json({ bucket: BUCKET_NAME, files });
  } catch (error) {
    console.error('Erro ao listar arquivos:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================================================================
// VERTENTE 1: UPLOAD & DOWNLOAD VIA SERVIDOR (STREAM/BUFFER LOCAL)
// ====================================================================================

// Upload via Servidor (Cliente -> Servidor Node.js -> S3)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const fileKey = req.file.originalname;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    });

    await s3.send(command);
    res.json({ message: 'Arquivo enviado via Servidor com sucesso!', key: fileKey, method: 'server-buffer' });
  } catch (error) {
    console.error('Erro no upload via servidor para o S3:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download via Servidor (S3 -> Servidor Node.js -> Navegador)
app.get('/api/download/:key(*)', async (req, res) => {
  try {
    const fileKey = req.params.key;

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey
    });

    const response = await s3.send(command);

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(fileKey))}"`);
    if (response.ContentType) {
      res.setHeader('Content-Type', response.ContentType);
    }

    response.Body.pipe(res);
  } catch (error) {
    console.error('Erro ao baixar via servidor do S3:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================================================================
// VERTENTE 2: UPLOAD & DOWNLOAD VIA PRESIGNED URLS (S3 DIRETO)
// ====================================================================================

// Tempo de expiração das URLs pré-assinadas (em segundos)
const PRESIGNED_EXPIRES_IN = 60; // 60 segundos

// Gerar URL pré-assinada de Upload (PUT direto no S3)
app.post('/api/presigned/upload', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'O parâmetro filename é obrigatório.' });
    }

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
      ContentType: contentType || 'application/octet-stream'
    });

    // Link válido por 60 segundos
    const url = await getSignedUrl(s3, command, { expiresIn: PRESIGNED_EXPIRES_IN });

    res.json({
      url,
      key: filename,
      expiresIn: PRESIGNED_EXPIRES_IN,
      method: 'presigned-url'
    });
  } catch (error) {
    console.error('Erro ao gerar Presigned URL de upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gerar URL pré-assinada de Download (GET direto no S3)
app.get('/api/presigned/download/:key(*)', async (req, res) => {
  try {
    const fileKey = req.params.key;
    const shouldRedirect = req.query.redirect === 'true';

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(path.basename(fileKey))}"`
    });

    // Link válido por 60 segundos
    const url = await getSignedUrl(s3, command, { expiresIn: PRESIGNED_EXPIRES_IN });

    if (shouldRedirect) {
      return res.redirect(url);
    }

    res.json({
      url,
      key: fileKey,
      expiresIn: PRESIGNED_EXPIRES_IN,
      method: 'presigned-url'
    });
  } catch (error) {
    console.error('Erro ao gerar Presigned URL de download:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================================================================
// 4. DELEÇÃO DE ARQUIVOS
// ====================================================================================
app.delete('/api/files/:key(*)', async (req, res) => {
  try {
    const fileKey = req.params.key;

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey
    });

    await s3.send(command);
    res.json({ message: 'Arquivo removido com sucesso!' });
  } catch (error) {
    console.error('Erro ao deletar arquivo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor Web S3 atualizado!`);
  console.log(`📡 Acesse no seu navegador: http://localhost:${PORT}`);
  console.log(`📦 Bucket conectado: ${BUCKET_NAME} (${REGION})`);
  console.log(`⚡ Vertentes ativas:`);
  console.log(`   1. Upload/Download via Servidor (Stream/Multer)`);
  console.log(`   2. Upload/Download via Presigned URL (AWS S3 Direto)`);
  console.log(`======================================================\n`);
});
