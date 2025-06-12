const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Create Socket.IO server with updated CORS
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3001", 
      "https://memerivals.netlify.app"
      // Add other CLIENT domains here that need to connect to your server
      // Do NOT add your own server domain here
    ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "Access-Control-Allow-Origin"]
  }
});

// Add CORS headers for regular HTTP requests
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3001',
    'https://memerivals.netlify.app'
    // Add other CLIENT domains here that need to connect to your server
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Add this debugging middleware to the server to track all events
io.use((socket, next) => {
  console.log(`New socket connection attempt: ${socket.id}`);
  
  // Log all incoming events
  const onevent = socket.onevent;
  socket.onevent = function(packet) {
    const args = packet.data || [];
    console.log(`[${socket.id}] Event: ${args[0]}`, args.slice(1));
    onevent.call(this, packet);
  };
  
  next();
});

// Serve static files from the current directory
app.use(express.static('./'));

// Serve index.html for the root path with error handling
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  
  // Check if index.html exists
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // If index.html doesn't exist, send a basic HTML response
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Memecoin Rivals Server</title>
      </head>
      <body>
        <h1>Memecoin Rivals Multiplayer Server</h1>
        <p>Server is running on port ${process.env.PORT || 3000}</p>
        <p>This is a WebSocket server for the Memecoin Rivals game.</p>
        <p>Connect from your game client to start playing!</p>
      </body>
      </html>
    `);
  }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    players: Object.keys(players).length,
    timestamp: new Date().toISOString()
  });
});

// Store connected players
const players = {};
let playerCount = 0;

// Handle socket connections
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Assign unique ID to this connection
  const playerId = socket.id;
  
  // Handle player joining
  socket.on('player_join', (data) => {
    console.log(`Player ${playerId} joined with data:`, data);
    
    // Validate the data to prevent errors
    const validData = {
      name: (data && data.name) || `Player${++playerCount}`,
      class: (data && data.class) || 'warrior',
      position: (data && data.position) || { x: 0, y: 0, z: 0 }
    };
    
    // Store player data with validated values
    players[playerId] = {
      id: playerId,
      name: validData.name,
      class: validData.class,
      position: validData.position,
      rotation: { y: 0 },
      action: 'idle',
      joinTime: Date.now()
    };
    
    // Log the current players
    console.log(`Current players (${Object.keys(players).length}):`, 
      Object.keys(players).map(id => `${players[id].name} (${id})`));
    
    // Send success message to the connected player
    socket.emit('connection_success', {
      id: playerId,
      players: Object.keys(players).length
    });
    
    // Send the current list of other players to this new player
    socket.emit('players_list', players);
    
    // Announce this new player to all other players
    socket.broadcast.emit('player_joined', players[playerId]);
    
    // Send system message to all players
    io.emit('system_message', {
      sender: 'Server',
      message: `${players[playerId].name} has joined the game.`
    });
  });
  
  // Handle player updates (position, rotation, action)
  socket.on('player_update', (data) => {
    // Update player data
    if (players[playerId]) {
      if (data.position) players[playerId].position = data.position;
      if (data.rotation) players[playerId].rotation = data.rotation;
      if (data.action) players[playerId].action = data.action;
      
      // Send update to all other players
      // Create an object with just this player's update
      const update = {};
      update[playerId] = {
        position: players[playerId].position,
        rotation: players[playerId].rotation,
        action: players[playerId].action
      };
      
      socket.broadcast.emit('player_update', update);
    }
  });
  
  // Handle chat messages
  socket.on('chat_message', (data) => {
    if (!players[playerId]) return;
    
    console.log(`Chat from ${players[playerId].name}: ${data.message}`);
    
    // Broadcast to all players
    io.emit('chat_message', {
      senderId: playerId,
      sender: players[playerId].name,
      message: data.message
    });
  });
  
  // Handle private messages (whispers)
  socket.on('whisper', (data) => {
    if (!players[playerId] || !players[data.targetId]) return;
    
    console.log(`Whisper from ${players[playerId].name} to ${players[data.targetId].name}: ${data.message}`);
    
    // Send only to the target player
    io.to(data.targetId).emit('whisper', {
      senderId: playerId,
      message: data.message
    });
  });
  
  // Handle emotes
  socket.on('player_emote', (data) => {
    if (!players[playerId]) return;
    
    console.log(`Emote from ${players[playerId].name}: ${data.emote}`);
    
    // Broadcast to all players
    socket.broadcast.emit('player_emote', {
      playerId: playerId,
      emote: data.emote,
      targetId: data.targetId
    });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${playerId}`);
    
    if (players[playerId]) {
      const playerName = players[playerId].name;
      
      // Remove from players list
      delete players[playerId];
      
      // Inform other players
      socket.broadcast.emit('player_left', playerId);
      
      // Send system message
      io.emit('system_message', {
        sender: 'Server',
        message: `${playerName} has left the game.`
      });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Memecoin Rivals multiplayer server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server URL: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
});
