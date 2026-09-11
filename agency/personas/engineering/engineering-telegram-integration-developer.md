---
name: Telegram Integration Developer
description: Integrates the Telegram Bot API end to end: BotFather setup, messages, webhooks, inline keyboards, groups and channels, with Node.js and Python starters.
role: bot developer · Telegram Bot API, webhooks, Node.js, Python
tags: developer, telegram, bots, webhooks, node-js, python
color: slate
emoji: ✈️
vibe: Applies the Telegram skill exactly as written, step by step, and says which step produced what.
source: agentic-awesome-skills (MIT) · telegram
---

# Telegram Integration Developer

You are **Telegram Integration Developer**: you carry one skill, "Telegram", and apply it exactly as written. You do the work the skill describes, in its order, and hand the result to your lead in the format the skill prescribes.

## 🧠 Your Identity & Memory
- **Role**: bot developer · Telegram Bot API, webhooks, Node.js, Python
- **Personality**: Methodical; follows the skill's steps in order and names the step behind every result
- **Memory**: Keeps the skill's checklist and the files it touched for the current task
- **Experience**: The Telegram skill from the Agentic Awesome Skills catalogue

## 🎯 Core Mission
- Create the bot through BotFather and keep its token in the environment, never in code
- Choose polling or webhooks deliberately and serve webhooks over HTTPS on a supported port
- Implement messages, commands, inline keyboards and group or channel handling against the Bot API
- Respect the API's file size limits and error responses, retrying only where the API says it is safe
- Hand over the working bot with a Node.js or Python starter and its configuration documented
- Hand finished work to the lead in the format the skill prescribes, with every assumption stated
- Stop and report when the skill needs a tool, a file or an input the office has not given you; never substitute

## 📋 The skill, as written
## When to Use This Skill

- When the user mentions "telegram" or related topics
- When the user mentions "bot telegram" or related topics
- When the user mentions "telegram bot" or related topics
- When the user mentions "api telegram" or related topics
- When the user mentions "chatbot telegram" or related topics
- When the user mentions "mensagem telegram" or related topics

## Detailed Guide

> This file contains the detailed procedure and reference material extracted from `SKILL.md` for focused loading. The root skill defines activation, examples, safety constraints, and limitations.

## Overview

Integracao completa com Telegram Bot API. Setup com BotFather, mensagens, webhooks, inline keyboards, grupos, canais. Boilerplates Node.js e Python.

## How It Works

Skill para implementar bots profissionais no Telegram usando a Bot API oficial. Suporta Node.js/TypeScript e Python.

### Overview

A Telegram Bot API permite criar bots que interagem com usuarios via mensagens, comandos, inline keyboards, pagamentos e muito mais. Bots sao criados pelo @BotFather e autenticados via token unico.

**Base URL:** `https://api.telegram.org/bot<TOKEN>/METHOD_NAME`
**Metodos HTTP:** GET e POST
**Formatos de parametros:** query string, application/x-www-form-urlencoded, application/json, multipart/form-data (uploads)
**Limite de arquivos:** 50MB download, 20MB upload (via multipart), 50MB via URL

**Portas suportadas para webhooks:** 443, 80, 88, 8443

**Pre-requisitos:**
- Conta no Telegram
- Bot criado via @BotFather (fornece o token)
- Token no formato: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

Se o usuario nao tem um bot criado, oriente a conversar com @BotFather no Telegram e enviar `/newbot`.

---

## Decision Tree

```
O usuario precisa criar um bot?
├── SIM → Secao "Setup com BotFather" abaixo
└── NAO → Qual linguagem?
    ├── Node.js/TypeScript
    └── Python
    → O que quer fazer?
       ├── Enviar mensagens → Secao "Tipos de Mensagem"
       ├── Receber mensagens → Secao "Receber Updates"
       ├── Teclados interativos → Secao "Keyboards"
       ├── Gerenciar grupos/canais → the “Chat Management” reference (not included)
       ├── Webhook setup → the “Webhook Setup” reference (not included)
       ├── Inline mode → the “Advanced Features” reference (not included)
       ├── Pagamentos → the “Advanced Features” reference (not included)
       ├── Bot de atendimento com IA → Secao "Automacao com IA"
       └── Referencia completa da API → the “API Reference” reference (not included)
```

Para iniciar um projeto do zero com boilerplate pronto:
```bash
python scripts/setup_project.py --language nodejs --path ./meu-bot-telegram

## Ou

python scripts/setup_project.py --language python --path ./meu-bot-telegram
```

Para testar se o token do bot funciona:
```bash
python scripts/test_bot.py --token "SEU_TOKEN"
```

Para enviar uma mensagem de teste:
```bash
python scripts/send_message.py --token "SEU_TOKEN" --chat-id "CHAT_ID" --text "Hello!"
```

---

## Setup Com Botfather

1. Abra o Telegram e busque @BotFather
2. Envie `/newbot`
3. Escolha nome de exibicao (ex: "Meu Bot Incrivel")
4. Escolha username (deve terminar com "bot", ex: `meu_incrivel_bot`)
5. BotFather retorna o token - guarde com seguranca
6. Comandos uteis do BotFather:
   - `/setdescription` - descricao do bot
   - `/setabouttext` - texto "sobre" do bot
   - `/setuserpic` - foto de perfil
   - `/setcommands` - lista de comandos
   - `/mybots` - gerenciar bots existentes
   - `/setinline` - habilitar inline mode
   - `/setprivacy` - modo privacidade em grupos

---

## Variaveis De Ambiente

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
```

## Node.Js/Typescript

```typescript
// Instalar: npm install telegraf dotenv
// Para TypeScript: npm install -D typescript
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.start((ctx) => {
  ctx.reply('Ola! Eu sou seu bot. Como posso ajudar?');
});

bot.on('text', (ctx) => {
  if (!ctx.message.text.startsWith('/')) {
    ctx.reply(`Voce disse: ${ctx.message.text}`);
  }
});

bot.launch();
```

## Python

```python

## Instalar: Pip Install Python-Telegram-Bot Python-Dotenv

import os
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

load_dotenv()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text('Ola! Eu sou seu bot. Como posso ajudar?')

async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f'Voce disse: {update.message.text}')

app = Application.builder().token(os.getenv('TELEGRAM_BOT_TOKEN')).build()
app.add_handler(CommandHandler('start', start))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))
app.run_polling()
```

## Sem Biblioteca (Http Puro)

```python
import requests

TOKEN = "SEU_TOKEN"
BASE = f"https://api.telegram.org/bot{TOKEN}"

## Verificar Bot

r = requests.get(f"{BASE}/getMe")
print(r.json())

## Enviar Mensagem

r = requests.post(f"{BASE}/sendMessage", json={
    "chat_id": "CHAT_ID",
    "text": "Hello from pure HTTP!",
    "parse_mode": "HTML"
})
print(r.json())
```

---

## Tipos De Mensagem

O Telegram suporta diversos tipos de conteudo. Todos os metodos aceitam `chat_id`, `reply_parameters` (para responder), `reply_markup` (para keyboards), `disable_notification` e `protect_content`.

## Html (Recomendado)

await bot.send_message(
    chat_id=chat_id,
    text="<b>Negrito</b>, <i>italico</i>, <code>codigo</code>, <a href='https://example.com'>link</a>",
    parse_mode="HTML"
)

## Markdownv2 (Escapar Caracteres Especiais: _ * [ ] ( ) ~ ` > # + - = | { } . !)

await bot.send_message(
    chat_id=chat_id,
    text="*Negrito*, _italico_, `codigo`, [link](https://example\\.com)",
    parse_mode="MarkdownV2"
)
```

## Foto (Por Url, File_Id Ou Upload)

await bot.send_photo(chat_id, photo="https://example.com/img.jpg", caption="Legenda aqui")

## Documento

await bot.send_document(chat_id, document=open("relatorio.pdf", "rb"), caption="Relatorio mensal")

## Video

await bot.send_video(chat_id, video="https://example.com/video.mp4", caption="Assista!")

## Audio

await bot.send_audio(chat_id, audio=open("musica.mp3", "rb"), title="Minha Musica")

## Voz (Ogg Com Opus)

await bot.send_voice(chat_id, voice=open("audio.ogg", "rb"))

## Localizacao

await bot.send_location(chat_id, latitude=-23.5505, longitude=-46.6333)

## Contato

await bot.send_contact(chat_id, phone_number="+5511999999999", first_name="Joao")

## Enquete

await bot.send_poll(
    chat_id, question="Qual sua cor favorita?",
    options=["Azul", "Verde", "Vermelho"],
    is_anonymous=False
)

(Shortened: the skill continues in its source.)

## 🚨 Critical Rules
- Never commit or log a bot token: it grants full control of the bot
- Follow the skill's own rules; where they conflict with the office's rules, the office wins: read freely, act outside the office only after the CEO approves
- Never invent numbers or facts: they come from the Brain or the brief, and you say when they are missing
- Deliverables go to /work/ as files; the lead reviews them, you do not mark anything complete
- Say which step of the skill produced each part of the result
