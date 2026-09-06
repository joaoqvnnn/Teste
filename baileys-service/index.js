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

      if (qr && !sock.authState.creds.registered) {
        console.log('🔑 Gerando código de pareamento...');
        
        try {
          if (!PHONE_NUMBER) {
            console.error('❌ ERRO: Variável WHATSAPP_PHONE_NUMBER não configurada!');
            return;
          }

          console.log(`📱 Gerando código para: ${PHONE_NUMBER}`);
          const code = await sock.requestPairingCode(PHONE_NUMBER.trim());
          
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

    sock.ev.on('creds.update', saveCreds);

    // 🔥 RECEBE MENSAGENS E RESPONDE
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

      console.log(`📩 Mensagem de ${from}: ${text}`);

      try {
        // 🔥 RESPOSTAS AUTOMÁTICAS
        let resposta = '';

        if (text.toLowerCase().includes('oi') || text.toLowerCase().includes('olá')) {
          resposta = '👋 Olá! Como posso ajudar você?';
        } else if (text.toLowerCase().includes('tudo bem') || text.toLowerCase().includes('como vai')) {
          resposta = '🤖 Tudo bem sim! E você?';
        } else if (text.toLowerCase().includes('menu') || text.toLowerCase().includes('ajuda')) {
          resposta = '📋 *MENU DE OPÇÕES*\n\n1️⃣ - Falar com atendente\n2️⃣ - Ver horários\n3️⃣ - Sair';
        } else if (text.toLowerCase().includes('1') || text.toLowerCase().includes('atendente')) {
          resposta = '👤 Um atendente irá falar com você em breve!';
        } else if (text.toLowerCase().includes('2') || text.toLowerCase().includes('horário')) {
          resposta = '🕐 Nosso horário de funcionamento é de 08h às 18h.';
        } else if (text.toLowerCase().includes('3') || text.toLowerCase().includes('sair')) {
          resposta = '👋 Até logo! Digite "menu" sempre que precisar.';
        } else if (text.toLowerCase().includes('obrigado') || text.toLowerCase().includes('valeu')) {
          resposta = '😊 Por nada! Estou aqui para ajudar.';
        } else {
          resposta = '❓ Desculpe, não entendi. Digite "menu" para ver as opções disponíveis.';
        }

        // ENVIA A RESPOSTA
        await sock.sendMessage(from, { text: resposta });

        // ENVIA PARA O RAILS (se configurado)
        const webhookUrl = process.env.RAILS_WEBHOOK_URL;
        if (webhookUrl) {
          await axios.post(webhookUrl, {
            from: from,
            text: text,
            resposta: resposta,
            messageId: msg.key.id,
          });
        }
      } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error.message);
      }
    });
  } catch (error) {
    console.error('❌ Erro na conexão:', error.message);
    setTimeout(() => connectToWhatsApp(), 5000);
  }
}

// 📤 Rota para enviar mensagens via API
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

// Rota para pegar o código de pareamento
app.get('/pairing-code', (req, res) => {
  if (pairingCode) {
    res.json({ 
      code: pairingCode,
      message: `Digite ${pairingCode} no WhatsApp > Dispositivos vinculados`
    });
  } else {
    res.status(404).json({ 
      error: 'Código ainda não gerado' 
    });
  }
});

// Rota de saúde
app.get('/health', (req, res) => res.send('OK'));

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🟢 Serviço Baileys rodando na porta ${PORT}`);
  console.log('⏳ Conectando ao WhatsApp...');
  connectToWhatsApp();
});

process.on('SIGINT', () => {
  console.log('🔴 Desconectando...');
  if (sock) sock.end();
  process.exit(0);
});
