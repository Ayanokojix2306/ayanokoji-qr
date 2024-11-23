/* NO ONE HELPED ME IN THE DEVELOPMENT OF QR CODE METHOD OF SOPHIA MD I DID IT ALL ON MY OWN
SO DON'T BELIEVE ANYONE THAT TELLS YOU THEY HELPED ME.
*/

const express = require('express');
const QRCode = require('qrcode');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const makeWASocket = require('@whiskeysockets/baileys').default;
const useMongoDBAuthState = require('./mongoAuthState');

const mongoURL = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'whatsapp_sessions';
const collectionName = 'auth_info_baileys';

const app = express();
const port = 5000;

let qrCodeData = ''; // Holds the current QR code data URL
let sessionStatus = 'waiting'; // 'waiting', 'scanned', 'expired', 'error'

async function generateSession() {
  const mongoClient = new MongoClient(mongoURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await mongoClient.connect();
    const collection = mongoClient.db(dbName).collection(collectionName);
    const { state, saveCreds } = await useMongoDBAuthState(collection);

    const extraRandom = Math.random().toString(36).substring(2, 12).toUpperCase();
    const sessionId = `SOPHIA_MD-${uuidv4().replace(/-/g, '').toUpperCase()}${extraRandom}`;

    const sock = makeWASocket({
      auth: state,
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        qrCodeData = await QRCode.toDataURL(qr);
        sessionStatus = 'waiting'; // Reset status to waiting
        console.log('New QR code generated:', sessionId);
      }

      if (connection === 'open') {
        sessionStatus = 'scanned';
        qrCodeData = ''; // Clear QR code
        await collection.insertOne({
          sessionId,
          creds: state.creds,
          status: 'generated',
          createdAt: new Date(),
        });
        console.log('Session stored successfully:', sessionId);
        await sock.logout(); // Clean up after successful scan
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        if (reason === 408) {
          sessionStatus = 'expired';
          console.log('QR Code expired. Retrying...');
          generateSession(); // Retry session generation on timeout
        } else {
          sessionStatus = 'error';
          console.error('Connection error:', reason);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Error generating session:', error);
  } finally {
    await mongoClient.close();
  }
}

generateSession();

// Serve QR code and session status
app.get('/qr', (req, res) => {
  if (sessionStatus === 'expired') {
    return res.send('<h1>QR Code expired. Reload the page to generate a new one.</h1>');
  }

  if (qrCodeData) {
    return res.send(`
      <h1>Scan this QR Code</h1>
      <img src="${qrCodeData}" alt="QR Code" />
      <p>Status: ${sessionStatus === 'waiting' ? 'Waiting for scan...' : ''}</p>
    `);
  } else {
    return res.send('<h1>Generating QR Code...</h1>');
  }
});

// Check session status
app.get('/status', (req, res) => {
  res.json({ status: sessionStatus });
});

// Default route
app.get('/', (req, res) => {
  res.redirect('/qr');
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
