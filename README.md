# Gemini Mobile Bridge

Interface web **mobile-first (PWA instalável)** para interagir pelo celular com seus chats locais do **Gemini / Antigravity CLI (`agy`)** rodando no seu PC, com suporte a **texto, áudio nativo, câmera/imagens, streaming em tempo real e resposta por voz (TTS)**.

## Recursos

- **Ponte direta com o `agy` local**: cria novos chats ou **importa sessões existentes do PC** (`~/.gemini/antigravity-cli/brain`) e continua a conversa real com `--conversation`.
- **Entrada por voz nativa**: grava áudio direto no celular, converte automaticamente via `ffmpeg` para MP3 16kHz mono e envia para o Gemini ouvir e responder (além de botão opcional de ditado para texto).
- **Saída em voz (TTS)**: botão "Ouvir" em cada resposta + botão no topo para ativar leitura automática das respostas.
- **Fotos e câmera**: anexe imagens da galeria ou tire fotos direto pela câmera do celular.
- **Streaming em tempo real + Markdown**: respostas aparecem aos poucos com blocos de código copiáveis, tabelas e painel colapsável das ferramentas executadas pelo agente.
- **Múltiplos chats persistidos em SQLite (Prisma)**: criar, buscar, renomear, apagar, escolher modelo (`agy models`), pasta de projeto (`cwd`) e modo de execução (`auto`, `plan`, `accept-edits`, `dangerous`).
- **Segurança por senha**: login com cookie assinado (`HMAC-SHA256`, `HttpOnly`) para acesso remoto seguro.
- **PWA instalável**: adicione à tela inicial do Android ou iPhone como app nativo.

## Configuração

Edite o arquivo `.env` (veja `.env.example`):

```env
DATABASE_URL="file:./dev.db"
APP_PASSWORD="sua-senha-segura-aqui"
AUTH_SECRET="um-segredo-longo-e-aleatorio"
AGY_BIN="/usr/bin/agy"
WORKSPACES_ROOT="/path/to/your/repos"
UPLOADS_DIR="./data/uploads"
```

## Como rodar

```bash
# Modo desenvolvimento (aceitando conexões da rede/celular)
npm run dev -- -H 0.0.0.0 -p 3000

# Ou build de produção
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

## Acessando pelo celular (com Microfone funcionando!)

> **Importante:** Navegadores mobile (iOS Safari e Android Chrome) exigem **HTTPS** para liberar o microfone (`MediaRecorder`). Em `http://192.168.x.x:3000` o texto e fotos funcionam, mas o microfone fica bloqueado pelo navegador.

Use uma das duas opções gratuitas abaixo para ter **HTTPS válido instantâneo** apontando para o seu PC:

### Opção 1: Tailscale Serve (Recomendado — privado só nos seus dispositivos)
```bash
tailscale serve --bg 3000
```
Depois abra a URL `https://<seu-pc>.<sua-tailnet>.ts.net` no celular e toque em **"Adicionar à Tela Inicial"**!

### Opção 2: Cloudflare Tunnel (rápido, sem abrir portas no roteador)
```bash
cloudflared tunnel --url http://localhost:3000
```
Abra a URL `https://....trycloudflare.com` no celular e faça login com a sua `APP_PASSWORD`.
