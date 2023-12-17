import { createServer } from "http";
import crypto from "crypto";

const PORT = 1337;
const WEB_SOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126;
const SIXTY_FOUR_BITS_INTEGER_MARKER = 127;

// parseInt("10000000", 2) -> 128
const FIRST_BIT = 128;

const MASK_KEY_BYTES_LENGTH = 4;

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
  socket.on("readable", () => onSocketReadable(socket));
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

function onSocketReadable(socket) {
  // consume optcode (first byte)
  socket.read(1);

  const [markerAndPayloadLength] = socket.read(1);
  // Because the first bit is always 1 for the client-to-server messages
  // you can subtract one bit (128 or 1000000)
  //from the second byte to get rid of the MASK bit
  const lengthIndicatorInBits = markerAndPayloadLength - FIRST_BIT;
  let messageLength = 0;

  if (lengthIndicatorInBits <= SEVEN_BITS_INTEGER_MARKER) {
    messageLength = lengthIndicatorInBits;
  } else {
    throw new Error("your message is too long! We don't handle 64-bit message");
  }

  const mask = socket.read(MASK_KEY_BYTES_LENGTH);
  const encodedMessage = socket.read(messageLength);
  const decodedMessage = unmaskData(encodedMessage, mask);

  const data = JSON.parse(decodedMessage.toString());
  const msg = JSON.stringify({
    message: data,
    at: new Date().toISOString(),
  })
  console.log(msg)
}

const fillWithEightZeros = (b) => b.padStart(8, "0");
const toBinary = (dec) => fillWithEightZeros(dec.toString(2))
const binaryToDecimal = (b) => parseInt(b, 2);
const getCharFromBinary = (n) => String.fromCharCode(binaryToDecimal(toBinary(n)));

function unmaskData(encodedBuffer, mask) {
  const finalBuffer = Buffer.from(encodedBuffer);
  for (let i = 0; i < encodedBuffer.length; i++) {
    finalBuffer[i] = encodedBuffer[i] ^ mask[i % 4];

    const logger = {
      unmaskingCal: `${toBinary(encodedBuffer[i])} ^ ${toBinary(mask[i % 4])} = ${toBinary(finalBuffer[i])}`,
      decoded: String.fromCharCode(finalBuffer[i]),
    }
    console.log(logger);
  }
  return finalBuffer;
}

server.on("upgrade", onSocketUpgrade);

const errorEvents = ['uncaughtException', 'unhandledRejection'];
errorEvents.forEach((event) => {
  process.on(event, (err) => {
    console.error(`something bad happened! event: ${event}, error: ${err.stack || err}`);
  })
})