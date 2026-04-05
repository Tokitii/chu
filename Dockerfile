# Node.jsの環境を用意
FROM node:20-alpine

# 作業ディレクトリを作成
WORKDIR /app

# パッケージ情報をコピーしてインストール
COPY package*.json ./
RUN npm install

# ソースコード全体をコピー
COPY . .

# Reactアプリ（フロントエンド）をビルドして dist フォルダを作成
RUN npm run build

# Cloud Runが使うポートを開放
EXPOSE 8080

# サーバー起動（server.jsを実行）
CMD ["npm", "start"]
