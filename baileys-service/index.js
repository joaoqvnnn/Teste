require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const axios = require('axios');
const readline = require('readline');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
let sock = null;
let pairingCode = null;

// Função para fazer perguntas no terminal (para pegar o número)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

// Função principal de conexão
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: false, // Desativa QR Code
    auth: state,
    browser: ['Ubuntu', 'Chrome', '120.0.0'],
  });

  // Evento para gerar o código de pareamento
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Se pedir QR Code, geramos o código de pareamento
    if (qr && !sock.authState.creds.registered) {
      console.log('🔑 Gerando código de pareamento...');
      
      try {
        // Pega o número do usuário (ex: 5511999999999)
        const phoneNumber = await question('📱 Digite seu número com DDD e país (ex: 5511999999999): ');
        const code = await sock.requestPairingCode(phoneNumber.trim());
        
        console.log(`\n✅ SEU CÓDIGO DE PAREAMENTO: ${code}\n`);
        console.log(`📲 Abra o WhatsApp > Dispositivos vinculados > Vincular com número de telefone`);
        console.log(`🔢 Digite: ${code}\n`);
        
        pairingCode = code;
      } catch (error) {
        console.error('❌ Erro ao gerar código de pareamento:', error.message);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Conexão fechada', shouldReconnect ? 'reconectando...' : 'desconectado permanentemente');
      
      if (shouldReconnect) {
        connectToWhatsApp();
      } else {
        console.log('🔴 Faça logout e tente novamente');
        process.exit(0);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp conectado com sucesso!');
      console.log(`📱 Número conectado: ${sock.user.id}`);
      rl.close(); // Fecha a pergunta do terminal
    }
  });

  // Salva credenciais
  sock.ev.on('creds.update', saveCreds);

  // Recebe mensagens e envia para o Rails
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || 
                 msg.message.extendedTextMessage?.text || 
                 msg.message.interactiveResponseMessage?.body?.text ||
                 msg.message.buttonsResponseMessage?.selectedButtonId ||
                 '';

    if (msg.key.fromMe) return;

    try {
      await axios.post(process.env.RAILS_WEBHOOK_URL, {
        from: from,
        text: text,
        messageId: msg.key.id,
      });
    } catch (error) {
      console.error('❌ Erro ao enviar webhook:', error.message);
    }
  });
}

// 📤 Rota para enviar mensagens
app.post('/send-message', async (req, res) => {
  const { to, text, buttons } = req.body;

  if (!sock) {
    return res.status(500).json({ error: 'WhatsApp não conectado' });
  }

  try {
    if (buttons && buttons.length > 0) {
      const buttonsFormatted = buttons.map((b) => ({
        buttonId: b.id,
        buttonText: { displayText: b.title },
        type: 1,
      }));

      await sock.sendMessage(to, {
        text: text,
        buttons: buttonsFormatted,
        headerType: 1,
      });
    } else {
      await sock.sendMessage(to, { text: text });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para pegar o código de pareamento via API
app.get('/pairing-code', (req, res) => {
  if (pairingCode) {
    res.json({ code: pairingCode });
  } else {
    res.status(404).json({ error: 'Código ainda não gerado' });
  }
});

// Rota de saúde
app.get('/health', (req, res) => res.send('OK'));

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🟢 Serviço Baileys rodando na porta ${PORT}`);
  console.log('⏳ Aguardando conexão...');
  connectToWhatsApp();
});

// Trata fechamento
process.on('SIGINT', () => {
  console.log('🔴 Desconectando...');
  if (sock) sock.end();
  process.exit(0);
});
