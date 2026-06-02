const express = require('express');
const cors = require('cors');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors());
const port = 3000;

// 1. Configuração do Banco de Dados (PostgreSQL Local)
const pool = new Pool({
    user: 'admin',
    host: process.env.DB_HOST || 'localhost', // <-- Se estiver no Docker, usa 'postgres'
    database: 'app_fotos_pdf',
    password: 'senha_secreta_123',
    port: 5432,
});

// Criar a tabela de histórico caso ela não exista
const inicializarBanco = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS historico_pdfs (
            id SERIAL PRIMARY KEY,
            nome_arquivo VARCHAR(255) NOT NULL,
            caminho_bucket VARCHAR(255) NOT NULL,
            quantidade_fotos INT NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};
inicializarBanco().catch(console.error);

// 2. Configuração do Bucket Local (MinIO)
const s3Client = new S3Client({
    endpoint: process.env.BUCKET_ENDPOINT || "http://localhost:9000", // <-- Se estiver no Docker, usa 'http://minio:9000'
    region: "us-east-1",
    credentials: {
        accessKeyId: "admin_bucket",
        secretAccessKey: "senha_bucket_123",
    },
    forcePathStyle: true,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static('public'));

function obterDataHoraFormatada() {
    const agora = new Date();
    return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}-${String(agora.getMinutes()).padStart(2, '0')}`;
}

// 3. Rota principal atualizada
app.post('/upload', upload.array('fotos'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhuma foto enviada.' });
        }

        let nomeBase = req.body.nomeBase || 'documento';
        nomeBase = nomeBase.replace(/[/\\?%*:|"<>]/g, '-');
        const nomeArquivo = `${nomeBase}_${obterDataHoraFormatada()}.pdf`;

        // Gerar o PDF na memória (Buffer) em vez de salvar direto no disco
        const doc = new PDFDocument({ autoFirstPage: false });
        let buffers = [];
        
        doc.on('data', buffers.push.bind(buffers));
        
        const pdfGerdadoPromise = new Promise((resolve) => {
            doc.on('end', () => {
                let pdfBuffer = Buffer.concat(buffers);
                resolve(pdfBuffer);
            });
        });

        req.files.forEach((file) => {
            doc.addPage({ size: 'A4' });
            doc.image(file.buffer, 20, 20, { fit: [555, 802], align: 'center', valign: 'center' });
        });
        doc.end();

        const pdfBuffer = await pdfGerdadoPromise;

        // Enviar o PDF para o Bucket local (MinIO)
        const caminhoBucket = `pdfs/${nomeArquivo}`;
        await s3Client.send(new PutObjectCommand({
            Bucket: "midias-pdf", // Certifique-se de criar esse bucket no painel do MinIO
            Key: caminhoBucket,
            Body: pdfBuffer,
            ContentType: "application/pdf"
        }));

        // Salvar o registro do arquivo no Banco de Dados
        await pool.query(
            'INSERT INTO historico_pdfs (nome_arquivo, caminho_bucket, quantidade_fotos) VALUES ($1, $2, $3)',
            [nomeArquivo, caminhoBucket, req.files.length]
        );

        console.log(`🚀 PDF e dados salvos com sucesso! Arquivo: ${nomeArquivo}`);
        res.json({ success: true, message: `PDF salvo no bucket local como: ${nomeArquivo}` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Erro ao processar e salvar os dados.' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando localmente na porta ${port}`);
});