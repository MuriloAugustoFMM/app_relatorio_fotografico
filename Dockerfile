# 1. Usa uma imagem oficial leve do Node.js
FROM node:18-alpine

# 2. Cria e define a pasta de trabalho dentro do container
WORKDIR /app

# 3. Copia os arquivos de dependências primeiro (para otimizar o cache do Docker)
COPY package*.json ./

# 4. Instala as dependências do projeto
RUN npm install

# 5. Copia todo o restante do código do projeto para dentro do container
COPY . .

# 6. Informa a porta que a aplicação vai expor
EXPOSE 3000

# 7. Comando para iniciar a aplicação
CMD ["npm", "start"]