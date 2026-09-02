const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100MB buffer for direct relay
});

// Almacén de clientes en memoria: id -> { socketId, peerId, password, info }
const clients = new Map();
const socketToId = new Map();

// Helper para generar ID único de 9 dígitos tipo "123 456 789"
function generateUniqueId() {
  let id;
  do {
    const raw = Math.floor(100000000 + Math.random() * 900000000).toString();
    id = `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6, 9)}`;
  } while (clients.has(id));
  return id;
}

// Endpoint de estado de salud
app.get('/health', (req, res) => {
  res.json({ status: 'online', activeClients: clients.size });
});

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  // Registro del Host o Cliente
  socket.on('register', (data, callback) => {
    let clientId = data?.preferredId;
    if (!clientId || clients.has(clientId)) {
      clientId = generateUniqueId();
    }

    clients.set(clientId, {
      socketId: socket.id,
      password: data?.password || '',
      deviceName: data?.deviceName || 'Equipo Remoto',
      os: data?.os || 'Windows',
      autoAccept: data?.autoAccept || false
    });
    socketToId.set(socket.id, clientId);

    console.log(`[Registro] Dispositivo ${clientId} (${data?.deviceName || 'Desconocido'}) registrado.`);
    if (typeof callback === 'function') {
      callback({ success: true, clientId });
    }
  });

  // Solicitud de conexión de un visor a un Host
  socket.on('request-session', (data, callback) => {
    const targetId = (data.targetId || '').trim();
    const target = clients.get(targetId);

    if (!target) {
      if (typeof callback === 'function') {
        return callback({ success: false, error: 'El ID remoto no existe o no está en línea.' });
      }
      return;
    }

    const requesterId = socketToId.get(socket.id);

    // Enviar solicitud de sesión al Host
    io.to(target.socketId).emit('session-request-incoming', {
      fromId: requesterId,
      fromName: data.fromName || 'Cliente AnyRed',
      providedPassword: data.providedPassword || ''
    });

    if (typeof callback === 'function') {
      callback({ success: true, message: 'Solicitud enviada al equipo remoto.' });
    }
  });

  // Respuesta del Host a la solicitud (Aceptar / Rechazar)
  socket.on('session-request-response', (data) => {
    const requester = clients.get(data.toId);
    if (requester) {
      io.to(requester.socketId).emit('session-request-resolved', {
        accepted: data.accepted,
        reason: data.reason || '',
        hostId: socketToId.get(socket.id)
      });
    }
  });

  // Señalización WebRTC: Oferta (Offer)
  socket.on('webrtc-offer', (data) => {
    const target = clients.get(data.targetId);
    if (target) {
      io.to(target.socketId).emit('webrtc-offer', {
        offer: data.offer,
        fromId: socketToId.get(socket.id)
      });
    }
  });

  // Señalización WebRTC: Respuesta (Answer)
  socket.on('webrtc-answer', (data) => {
    const target = clients.get(data.targetId);
    if (target) {
      io.to(target.socketId).emit('webrtc-answer', {
        answer: data.answer,
        fromId: socketToId.get(socket.id)
      });
    }
  });

  // Señalización WebRTC: Candidatos ICE
  socket.on('webrtc-ice-candidate', (data) => {
    const target = clients.get(data.targetId);
    if (target) {
      io.to(target.socketId).emit('webrtc-ice-candidate', {
        candidate: data.candidate,
        fromId: socketToId.get(socket.id)
      });
    }
  });

  // Fallback directo de control / Relay seguro si WebRTC se bloquea por firewall estricto
  socket.on('relay-remote-event', (data) => {
    const target = clients.get(data.targetId);
    if (target) {
      io.to(target.socketId).emit('remote-control-event', data.event);
    }
  });

  // Desconexión de sesión
  socket.on('end-session', (data) => {
    const target = clients.get(data.targetId);
    if (target) {
      io.to(target.socketId).emit('session-ended', {
        fromId: socketToId.get(socket.id)
      });
    }
  });

  socket.on('disconnect', () => {
    const id = socketToId.get(socket.id);
    if (id) {
      console.log(`[Desconexión] Dispositivo ${id} desconectado.`);
      clients.delete(id);
      socketToId.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 4545;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Info] El puerto ${PORT} ya está en uso.`);
  } else {
    console.error('Error en el servidor de señalización:', err);
  }
});

server.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`🚀 Servidor AnyRed Signaling activo en puerto ${PORT}`);
  console.log(`==========================================`);
});


