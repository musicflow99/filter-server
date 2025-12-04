const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static('public'));
app.use(express.json());

// STORE DATA IN MEMORY (Use a Database for real production)
let connectedClients = {}; // Maps socketID to user details
let blockedSites = ['facebook.com', 'tiktok.com', 'instagram.com'];
let globalSuspended = false;

// 1. Serve the Admin Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Handle Socket Connections (The "Tether")
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Register the client
    connectedClients[socket.id] = { id: socket.id, suspended: false };
    
    // Send initial config to extension
    socket.emit('update-config', { blockedSites, suspended: false });

    socket.on('disconnect', () => {
        delete connectedClients[socket.id];
        io.emit('client-list-update', connectedClients);
    });
    
    // Notify admin dashboard of new client
    io.emit('client-list-update', connectedClients);
});

// 3. API for Admin Controls
app.post('/admin/suspend', (req, res) => {
    const { socketId, status } = req.body; // status: true (suspend) or false (unsuspend)
    if(connectedClients[socketId]) {
        connectedClients[socketId].suspended = status;
        // Tell specific extension to lock down
        io.to(socketId).emit('set-suspension', status); 
    }
    res.json({ success: true });
});

app.post('/admin/notify', (req, res) => {
    const { socketId, message } = req.body;
    io.to(socketId).emit('send-notification', message);
    res.json({ success: true });
});

app.post('/admin/block-site', (req, res) => {
    const { url } = req.body;
    blockedSites.push(url);
    io.emit('update-config', { blockedSites }); // Update all clients
    res.json({ success: true });
});

http.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
File: index.html (The Admin Dashboard UI)
Place this in the root folder alongside server.js.
code
Html
<!DOCTYPE html>
<html>
<head>
    <title>Admin Control Center</title>
    <style>
        body { font-family: sans-serif; padding: 20px; background: #f0f0f0; }
        .client-card { background: white; padding: 15px; margin-bottom: 10px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .btn { padding: 5px 10px; cursor: pointer; border: none; border-radius: 4px; color: white; margin-right: 5px;}
        .suspend { background: #e74c3c; }
        .unsuspend { background: #2ecc71; }
        .notify { background: #3498db; }
    </style>
</head>
<body>
    <h1>Web Filter Admin</h1>
    
    <div>
        <h3>Add Blocked Site</h3>
        <input type="text" id="siteInput" placeholder="example.com">
        <button onclick="addSite()">Block</button>
    </div>

    <h3>Connected Users</h3>
    <div id="userList">Waiting for connections...</div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();

        // Listen for updates on who is connected
        socket.on('client-list-update', (clients) => {
            const list = document.getElementById('userList');
            list.innerHTML = '';
            Object.values(clients).forEach(client => {
                const div = document.createElement('div');
                div.className = 'client-card';
                div.innerHTML = `
                    <strong>User ID:</strong> ${client.id} <br>
                    <strong>Status:</strong> ${client.suspended ? '<span style="color:red">SUSPENDED</span>' : 'Active'} <br><br>
                    <button class="btn suspend" onclick="toggleSuspend('${client.id}', true)">Suspend</button>
                    <button class="btn unsuspend" onclick="toggleSuspend('${client.id}', false)">Unsuspend</button>
                    <button class="btn notify" onclick="sendNotify('${client.id}')">Msg</button>
                `;
                list.appendChild(div);
            });
        });

        function toggleSuspend(id, status) {
            fetch('/admin/suspend', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ socketId: id, status: status })
            });
            // Force refresh list (in real app, wait for server response)
            setTimeout(() => window.location.reload(), 500); 
        }

        function sendNotify(id) {
            const msg = prompt("Enter message:");
            if(msg) {
                fetch('/admin/notify', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ socketId: id, message: msg })
                });
            }
        }

        function addSite() {
            const url = document.getElementById('siteInput').value;
            fetch('/admin/block-site', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            });
        }
    </script>
</body>
</html>
Part 2: The Extension (The Enforcer)
Create a separate folder named web-filter-extension.
1. manifest.json
This tells Chrome what permissions the extension needs.
code
JSON
{
  "manifest_version": 3,
  "name": "Tethered Web Filter",
  "version": "1.0",
  "permissions": [
    "tabs",
    "storage",
    "notifications"
  ],
  "host_permissions": [
    "<all_urls>",
    "http://localhost:3000/*"
  ],
  "background": {
    "service_worker": "background.js"
  }
}
