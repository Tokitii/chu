# 1. 安定板のNode.js環境を用意
FROM node:20-slim

# 2. 作業ディレクトリを /app に設定
WORKDIR /app

# 3. 依存関係のファイル（package.jsonなど）を先にコピー
COPY package*.json ./

# 4. パッケージをインストール
RUN npm install

# 5. アプリケーションの全ソースコードをコピー
COPY . .

# 6. Vite (React) のフロントエンドコードをビルド（distフォルダが作られます）
RUN npm run build

# 7. Cloud Runが使用するポートを指定
EXPOSE 8080
ENV PORT=8080

# 8. コンテナ起動時にサーバーを実行
CMD ["npm", "run", "start"]
