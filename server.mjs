import { createServer } from "http";
import crypto from "crypto";

const PORT = 1337;
const WEB_SOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('hey there');
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`)
});

function onSocketUpgrade(req, socket, head) {
  const { 'sec-websocket-key': webClientSocketKey } = req.headers;

  const headers = prepareHandShakeHeaders(webClientSocketKey);
  socket.write(headers);
}

function prepareHandShakeHeaders(key) {
  const acceptKey = createSocketAccept(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
  ].map(l => l.concat('\r\n'));
  return headers.join('');
}

function createSocketAccept(key) {
  const shasum = crypto.createHash("sha1");
  return shasum.update(key + WEB_SOCKET_MAGIC_STRING).digest("base64");
}

server.on("upgrade", onSocketUpgrade);

const errorEvents = ['uncaughtException', 'unhandledRejection'];
errorEvents.forEach((event) => {
  process.on(event, (err) => {
    console.error(`something bad happened! event: ${event}, error: ${err.stack || err}`);
  })
})