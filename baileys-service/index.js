require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');
const axios = require('axios'); // para chamar o Rails

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
let sock = null;

// Função para conectar ao WhatsApp
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  
  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
  });

  // Gera QR Code no console
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('📱 Escaneie o QR Code abaixo:');
      QRCode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada, reconectando...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp conectado com sucesso!');
    }
  });

  // Salva credenciais
  sock.ev.on('creds.update', saveCreds);

  // 🔔 Quando chega uma mensagem, envia para o Rails via webhook
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const buttonId = msg.message.interactiveResponseMessage?.body?.text || 
                     msg.message.templateButtonReplyMessage?.selectedId || 
                     msg.message.buttonsResponseMessage?.selectedButtonId || 
                     '';

    // Ignora mensagens enviadas por você mesmo (opcional)
    if (msg.key.fromMe) return;

    // Envia os dados para o Rails
    try {
      await axios.post(process.env.RAILS_WEBHOOK_URL, {
        from: from,
        text: text,
        buttonId: buttonId,
        messageId: msg.key.id
      });
    } catch (error) {
      console.error('Erro ao enviar webhook para Rails:', error.message);
    }
  });
}

// 📤 Rota para o RAILS enviar mensagens via API (self-hosted)
app.post('/send-message', async (req, res) => {
  const { to, text, buttons } = req.body;

  if (!sock) {
    return res.status(500).json({ error: 'WhatsApp não conectado' });
  }

  try {
    if (buttons && buttons.length > 0) {
      // Envia mensagem com botões interativos
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
      // Envia texto simples
      await sock.sendMessage(to, { text: text });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rota de saúde (para o Render saber que está vivo)
app.get('/health', (req, res) => res.send('OK'));

// Inicia servidor e conexão
app.listen(PORT, () => {
  console.log(`🟢 Serviço Baileys rodando na porta ${PORT}`);
  connectToWhatsApp();
});
