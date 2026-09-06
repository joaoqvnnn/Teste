require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
let sock = null;
let pairingCode = null;

// 🔥 PEGA O NÚMERO DAS VARIÁVEIS DE AMBIENTE
const PHONE_NUMBER = process.env.WHATSAPP_PHONE_NUMBER || '';

console.log(`📱 Número configurado: ${PHONE_NUMBER || 'NÃO CONFIGURADO'}`);

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '120.0.0'],
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Se tiver QR Code e não estiver registrado, gera código de pareamento
      if (qr && !sock.authState.creds.registered) {
        console.log('🔑 Gerando código de pareamento...');
        
        try {
          if (!PHONE_NUMBER) {
            console.error('❌ ERRO: Variável WHATSAPP_PHONE_NUMBER não configurada!');
            console.log('💡 Configure no Render: WHATSAPP_PHONE_NUMBER = 5544998691568');
            return;
          }

          console.log(`📱 Gerando código para: ${PHONE_NUMBER}`);
          const code = await sock.requestPairingCode(PHONE_NUMBER.trim());
          
          console.log(`\n✅ SEU CÓDIGO DE PAREAMENTO: ${code}\n`);
          console.log(`📲 Abra o WhatsApp > Dispositivos vinculados > Vincular com número de telefone`);
          console.log(`🔢 Digite: ${code}\n`);
          console.log(`🌐 Ou acesse: https://teste-fomx.onrender.com/pairing-code`);
          
          pairingCode = code;
        } catch (error) {
          console.error('❌ Erro ao gerar código de pareamento:', error.message);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ Conexão fechada', shouldReconnect ? 'reconectando em 5s...' : 'desconectado permanentemente');
        
        if (shouldReconnect) {
          setTimeout(() => connectToWhatsApp(), 5000);
        } else {
          console.log('🔴 Faça logout e tente novamente');
          process.exit(0);
        }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp conectado com sucesso!');
        console.log(`📱 Número conectado: ${sock.user.id}`);
        console.log(`🎉 Seu bot está pronto para usar!`);
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
        const webhookUrl = process.env.RAILS_WEBHOOK_URL;
        if (webhookUrl) {
          await axios.post(webhookUrl, {
            from: from,
            text: text,
            messageId: msg.key.id,
          });
        }
      } catch (error) {
        console.error('❌ Erro ao enviar webhook:', error.message);
      }
    });
  } catch (error) {
    console.error('❌ Erro na conexão:', error.message);
    setTimeout(() => connectToWhatsApp(), 5000);
  }
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
    res.json({ 
      code: pairingCode,
      message: `Digite ${pairingCode} no WhatsApp > Dispositivos vinculados > Vincular com número de telefone`
    });
  } else {
    res.status(404).json({ 
      error: 'Código ainda não gerado. Aguarde alguns segundos e tente novamente.' 
    });
  }
});

// Rota de saúde
app.get('/health', (req, res) => res.send('OK'));

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🟢 Serviço Baileys rodando na porta ${PORT}`);
  console.log(`🔗 URL: https://teste-fomx.onrender.com`);
  console.log('⏳ Conectando ao WhatsApp...');
  connectToWhatsApp();
});

// Trata fechamento
process.on('SIGINT', () => {
  console.log('🔴 Desconectando...');
  if (sock) sock.end();
  process.exit(0);
});
